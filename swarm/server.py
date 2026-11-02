"""The web app: `python -m swarm.server`, then open http://127.0.0.1:8300"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import traceback
import uuid
from dataclasses import dataclass, field

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from . import agents, config
from .data import ProjectData
from .runner import run_review

MOCK_DELAY = 0.8  # seconds per scripted model turn, so a person can follow the run
KEEP_RUNS = 20
RUNS_DIR = config.ROOT / "data" / "runs"

app = FastAPI(title="Progress Claim Check")


@dataclass
class Live:
    id: str
    mode: str
    events: list = field(default_factory=list)
    done: bool = False
    report: dict | None = None
    task: asyncio.Task | None = None
    listeners: set = field(default_factory=set)

    def emit(self, event: dict) -> None:
        self.events.append(event)
        for wake in self.listeners:
            wake.set()


LIVE: dict[str, Live] = {}


class StartRun(BaseModel):
    mode: str = "mock"
    confirm_paid: bool = False


@app.get("/")
def index() -> FileResponse:
    return FileResponse(config.ROOT / "web" / "index.html")


@app.get("/api/config")
def get_config() -> dict:
    return {"gemini_ready": config.gemini_ready(), "max_usd": config.MAX_USD, "max_llm_calls": config.MAX_LLM_CALLS,
            "models": {"lead": config.MODEL_LEAD, "worker": config.MODEL_WORKER, "vision": config.MODEL_VISION}}


@app.get("/api/project")
def get_project() -> dict:
    data = ProjectData.load()
    return {"project": data.project, "agents": agents.AGENTS,
            "lines": [{"code": c, "name": data.boq[c]["name"], "area": data.boq[c]["area"], "value": data.boq[c]["value"],
                       "claimed_pct": data.claim[c]["claimed_pct"], "amount_claimed": data.claim[c]["amount"]} for c in data.codes]}


@app.post("/api/runs")
async def start_run(body: StartRun) -> dict:
    if body.mode not in ("mock", "gemini"):
        raise HTTPException(400, "unknown mode")
    if body.mode == "gemini":
        if not config.gemini_ready():
            raise HTTPException(400, "a real run needs GOOGLE_API_KEY in this repository's .env")
        if not body.confirm_paid:
            raise HTTPException(400, "a real run spends money and must be confirmed")
        if any(x.mode == "gemini" and not x.done for x in LIVE.values()):
            raise HTTPException(409, "a real run is already going")
    run_id = f"run-{uuid.uuid4().hex[:10]}"
    live = Live(id=run_id, mode=body.mode)
    LIVE[run_id] = live
    for old in [k for k, v in LIVE.items() if v.done][:-KEEP_RUNS]:
        del LIVE[old]

    async def work() -> None:
        try:
            live.report = await run_review(mode=body.mode, emit=live.emit, delay=MOCK_DELAY, run_id=run_id)
        except Exception as e:
            traceback.print_exc()
            live.emit({"type": "error", "message": f"{type(e).__name__}: {e}"})
        finally:
            live.done = True
            live.emit({"type": "done"})
            _save(live)

    live.task = asyncio.create_task(work())
    return {"run_id": run_id}


def _case_id() -> str:
    """Identifies the case a run was made on: a saved run's evidence IDs only mean something on that same case."""
    folder = ProjectData.load().folder
    return hashlib.sha1(b"".join((folder / name).read_bytes() for name in ("boq.json", "claim.json", "daily_logs.json", "photos.json"))).hexdigest()


def _save(live: Live) -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    (RUNS_DIR / f"{live.id}.json").write_text(json.dumps({"id": live.id, "mode": live.mode, "case": _case_id(), "events": live.events, "report": live.report}), encoding="utf-8")
    for old in sorted(RUNS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime)[:-KEEP_RUNS]:
        old.unlink()


def _live(run_id: str) -> Live:
    live = LIVE.get(run_id)
    if live:
        return live
    path = RUNS_DIR / f"{run_id}.json"
    if not re.fullmatch(r"run-[0-9a-f]+", run_id) or not path.exists():
        raise HTTPException(404, "no such run")
    saved = json.loads(path.read_text(encoding="utf-8"))
    return Live(id=saved["id"], mode=saved["mode"], events=saved["events"], done=True, report=saved["report"])


@app.get("/api/runs/latest")
def latest_run() -> dict:
    """The last real run on the current case if there is one, else the last mock run on it."""
    runs = []
    case = _case_id()
    for path in RUNS_DIR.glob("*.json") if RUNS_DIR.exists() else []:
        saved = json.loads(path.read_text(encoding="utf-8"))
        if saved.get("case") == case:
            runs.append((saved["mode"] != "mock", path.stat().st_mtime, saved["id"], saved["mode"]))
    if not runs:
        return {"id": None}
    _, _, run_id, mode = max(runs)
    return {"id": run_id, "mode": mode}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict:
    live = _live(run_id)
    return {"id": live.id, "mode": live.mode, "done": live.done, "report": live.report}


@app.get("/api/runs/{run_id}/events")
async def run_events(run_id: str, since: int = 0) -> StreamingResponse:
    live = _live(run_id)

    async def stream():
        sent = max(0, since)
        wake = asyncio.Event()
        live.listeners.add(wake)
        try:
            while True:
                wake.clear()
                while sent < len(live.events):
                    yield f"data: {json.dumps(live.events[sent])}\n\n"
                    sent += 1
                if live.done and sent >= len(live.events):
                    return
                try:
                    await asyncio.wait_for(wake.wait(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": still here\n\n"
        finally:
            live.listeners.discard(wake)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/evidence/{evidence_id}")
def get_evidence(evidence_id: str) -> dict:
    record = ProjectData.load().evidence(evidence_id)
    if record is None:
        raise HTTPException(404, "no such evidence")
    return {"id": evidence_id, **record}


@app.get("/api/photos/{photo_id}")
def get_photo(photo_id: str) -> FileResponse:
    data = ProjectData.load()
    photo = data.photo(photo_id)  # looked up by ID, never a path from the request
    if not photo:
        raise HTTPException(404, "no such photo")
    return FileResponse(data.folder / "photos" / photo["file"])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8300, log_level="warning")

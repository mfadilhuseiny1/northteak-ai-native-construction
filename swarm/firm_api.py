"""The API behind the AI Agent Swarm and Agents tabs: `python -m swarm.firm_api`, then run the UI in ui/ (npm run dev, port 8310)."""

from __future__ import annotations

import asyncio
import json
import re
import traceback
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import config, firm, planner, planning_case, project
from .mock_firm import MockFirmLlm
from .mock_plan import MockPlanLlm
from .project_api import router as project_router

STORE = config.ROOT / "data" / "firm"
MOCK_DELAY = 0.5
MAX_USD = float(config.setting("SWARM_MAX_USD", "150"))  # the Meta API credit
app = FastAPI(title="SiteSwarm")
app.include_router(project_router)
RUNS: dict[str, dict] = {}
TASKS: dict[str, asyncio.Task] = {}
PROJECTS: dict[str, dict] = {}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _save_run(r: dict) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    (STORE / f"{r['run']['id']}.json").write_text(json.dumps(r), encoding="utf-8")


def _save_projects() -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    (STORE / "projects.json").write_text(json.dumps(PROJECTS), encoding="utf-8")


def _load() -> None:
    if not STORE.exists():
        return
    if (STORE / "projects.json").exists():
        PROJECTS.update(json.loads((STORE / "projects.json").read_text(encoding="utf-8")))
    for path in STORE.glob("run-*.json"):
        r = json.loads(path.read_text(encoding="utf-8"))
        if r["run"]["status"] == "running":  # cut by a restart
            r["run"]["status"] = "cancelled"
        RUNS[r["run"]["id"]] = r


_load()


def model_of(mode: str, jenis: str = "disruption"):
    def make(key: str, model: str, max_tokens: int):
        if mode == "mock":
            return (MockPlanLlm if jenis == "plan" else MockFirmLlm)(model=f"mock/{key}", agent_key=key, delay=MOCK_DELAY)
        from google.adk.models.lite_llm import LiteLlm

        return LiteLlm(model=f"openai/{model}", api_base="https://api.meta.ai/v1", api_key=config.setting("META_API_KEY"), max_tokens=max_tokens, temperature=0.1, num_retries=2, timeout=300)
    return make


class Start(BaseModel):
    nama: str = ""
    fokus: str | None = ""
    proyek: str | None = None
    versi: str = "muse"
    jenis: str = "disruption"  # disruption: a recovery plan. plan: a consultant's documents into an OPC


class ProjectIn(BaseModel):
    nama: str
    brief: str = ""
    fokus: str = ""
    batas_usd: float | None = None
    paralel: int = 8
    model: dict = {}


@app.get("/api/aip/agents")
def agents() -> dict:
    return firm.catalogue()


@app.get("/api/aip/konsultan/tim")
def team() -> dict:
    t, why = firm.roster()
    return {"tim": t, "mesin": firm.MACHINES, "jumlah_agen": len(t), "keluarga_model": {firm.SPARK: sum(1 for a in t if a["model"] == firm.SPARK), firm.WONDER: sum(1 for a in t if a["model"] == firm.WONDER)},
            "brief": firm.BRIEF, "ukuran": why, "lini": {}}


def _sources() -> dict:
    rows = [("Schedule", "worked out by code"), ("Documents", "contract, specification, inspections, orders, subcontracts"), ("Messages", "WhatsApp, Slack and Gmail over MCP (demo server)"), ("Daily logs and site photos", "synthetic")]
    return {"sumber": "Harbor Point Block B (fictional)", "tipe": [{"tipe": a, "wajib": True, "dipakai": b, "ada": True, "objek": 0} for a, b in rows], "siap": True, "kurang": [], "pendukung_kurang": []}


@app.get("/api/aip/konsultan/konfigurasi")
def konfigurasi() -> dict:
    muse = bool(config.setting("META_API_KEY"))
    seat = lambda k, label, m: {"kursi": k, "label": label, "dipakai": m, "default": m}  # noqa: E731
    return {"sumber": _sources(), "kursi": [seat("analyst", "Analysts and leads", firm.SPARK), seat("validator", "Orchestrator, QA and validator", firm.WONDER)],
            "model": [{"id": m, "label": m, "vendor": "Meta", "keluarga": m, "siap": muse, "alasan": None if muse else "add META_API_KEY", "harga": {"input": p[0], "output": p[1]}} for m, p in firm.PRICE.items()],
            "paralel": {"min": 1, "default": firm.CONCURRENT, "maks": 12}, "batas_usd": {"min": 1, "maks": 150}, "brief": firm.BRIEF,
            "versi": {"muse": {"nama": "Muse (real models)", "ringkas": "Muse Spark and Muse Wonder through the Meta Model API", "tambahan": None}, "mock": {"nama": "Offline mock (no cost)", "ringkas": "Scripted answers: shows the wiring, not accuracy", "tambahan": None}}}


@app.get("/api/aip/konsultan/sumber")
def sumber() -> dict:
    return _sources()


@app.get("/api/aip/konsultan/proyek")
def projects() -> list[dict]:
    return sorted(PROJECTS.values(), key=lambda p: p["dibuat_pada"], reverse=True)


@app.post("/api/aip/konsultan/proyek")
def create_project(p: ProjectIn) -> dict:
    rec = {"id": f"pr-{uuid.uuid4().hex[:10]}", **p.model_dump(), "dibuat_pada": now()}
    rec["brief"] = rec["brief"] or firm.BRIEF
    PROJECTS[rec["id"]] = rec
    _save_projects()
    return rec


@app.put("/api/aip/konsultan/proyek/{pid}")
def update_project(pid: str, p: ProjectIn) -> dict:
    if pid not in PROJECTS:
        raise HTTPException(404, "no such project")
    PROJECTS[pid].update(p.model_dump())
    _save_projects()
    return PROJECTS[pid]


@app.delete("/api/aip/konsultan/proyek/{pid}")
def delete_project(pid: str) -> dict:
    if any(r["run"].get("proyek") == pid and r["run"]["status"] == "running" for r in RUNS.values()):
        raise HTTPException(409, "a review of this project is running")
    PROJECTS.pop(pid, None)
    gone = [k for k, r in RUNS.items() if r["run"].get("proyek") == pid]
    for k in gone:
        RUNS.pop(k)
        (STORE / f"{k}.json").unlink(missing_ok=True)
    _save_projects()
    return {"dihapus": pid, "reviews": gone}


@app.get("/api/aip/konsultan/runs")
def runs(limit: int = 40) -> list[dict]:
    return sorted((r["run"] for r in RUNS.values()), key=lambda x: x["created_at"], reverse=True)[:limit]


@app.get("/api/aip/konsultan/terakhir")
def latest() -> dict:
    done = [r["run"] for r in RUNS.values() if r["run"]["status"] == "succeeded"]
    if not done:
        return {"ada": False}
    last = max(done, key=lambda x: x["created_at"])
    return {"ada": True, "run": last["id"], "pada": last["finished_at"], "biaya_usd": last["spent_usd"]}


@app.post("/api/aip/konsultan")
async def start(body: Start) -> dict:
    if any(r["run"]["status"] == "running" for r in RUNS.values()):
        raise HTTPException(409, "one review is already running")
    mode = "mock" if body.versi == "mock" else "muse"
    if mode == "muse" and not config.setting("META_API_KEY"):
        raise HTTPException(400, "a real run needs META_API_KEY in this repository's .env.local")
    setup = PROJECTS.get(body.proyek or "") or {}
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    rec = {"run": {"id": run_id, "kind": "swarm", "status": "running", "q": planning_case.BRIEF if body.jenis == "plan" else setup.get("brief") or firm.BRIEF, "jenis": body.jenis, "nama": body.nama, "fokus": body.fokus, "proyek": body.proyek, "versi": mode, "created_at": now(), "finished_at": None,
                   "spent_usd": 0, "agents_usage": {}, "budget_usd": setup.get("batas_usd") or MAX_USD}, "events": []}
    RUNS[run_id] = rec

    def emit(ev: dict) -> None:
        rec["events"].append({**ev, "seq": len(rec["events"])})
        if ev.get("type") == "rfi_draft":  # an agent's draft joins the register, for a person to issue
            project.add_rfi({k: ev[k] for k in ("subject", "question", "to", "activity", "impact", "drafted_by")}, "draft", project.SWARM)

    async def go() -> None:
        f = (planner.PlanningFirm if body.jenis == "plan" else firm.Firm)(model_of(mode, body.jenis), rec["run"]["budget_usd"], rec["run"]["q"], body.fokus or "", mock=mode == "mock")
        rec["firm"] = f
        firm._emit.set(emit)
        status = "succeeded"
        try:
            await f.engagement()
            if f.stopped:
                status = "failed"
        except asyncio.CancelledError:
            status = "cancelled"
        except Exception as e:  # noqa: BLE001 - the trail shows what happened
            traceback.print_exc()
            emit({"type": "error", "agent": None, "message": f"{type(e).__name__}: {str(e)[:400]}", "t": now()[:19]})
            status = "failed"
        if status == "succeeded":
            try:
                (project.record_plan if body.jenis == "plan" else project.record_review)(run_id, f, mode)
            except Exception as e:  # noqa: BLE001 - a run must always end, or it blocks the next one
                traceback.print_exc()
                emit({"type": "error", "agent": None, "message": f"The plan could not be recorded. {type(e).__name__}: {str(e)[:400]}", "t": now()[:19]})
                status = "failed"
        rec["run"].update(status=status, finished_at=now(), spent_usd=round(f.spent, 4), agents_usage=f.usage)
        rec.pop("firm", None)
        _save_run(rec)

    TASKS[run_id] = asyncio.create_task(go())
    return {"run": run_id, "jumlah_agen": len(firm.roster()[0])}


@app.delete("/api/aip/konsultan/{run_id}")
def delete_run(run_id: str) -> dict:
    r = RUNS.get(run_id)
    if not r:
        raise HTTPException(404, "no such review")
    if r["run"]["status"] == "running":
        raise HTTPException(409, "it is still running")
    RUNS.pop(run_id)
    (STORE / f"{run_id}.json").unlink(missing_ok=True)
    return {"dihapus": run_id}


@app.get("/api/aip/runs/{run_id}")
def run(run_id: str, after: int = 0) -> dict:
    r = RUNS.get(run_id)
    if not r or not re.fullmatch(r"run-[0-9a-f]+", run_id):
        raise HTTPException(404, "no such review")
    f = r.get("firm")
    head = {**r["run"], **({"spent_usd": round(f.spent, 4), "agents_usage": f.usage} if f else {})}
    return {"run": head, "events": r["events"][max(0, after):], "next": len(r["events"])}


@app.post("/api/aip/runs/{run_id}/cancel")
def cancel(run_id: str) -> dict:
    task = TASKS.get(run_id)
    if task and not task.done():
        task.cancel()
    return {"status": "cancelled"}


@app.get("/api/aip/register")
def register() -> dict:
    for r in sorted(RUNS.values(), key=lambda x: x["run"]["created_at"], reverse=True):
        for e in reversed(r["events"]):
            if e.get("type") == "machine" and e.get("key") == "register" and e.get("status") == "selesai":
                h = e.get("hasil") or {}
                return {"ringkasan": h, "jalur": {}, "kelompok_arti": {}, "total": h.get("items", 0), "per_status": {}, "kelompok": {}}
    return {"ringkasan": None, "jalur": {}, "kelompok_arti": {}, "total": 0, "per_status": {}, "kelompok": {}}


@app.get("/api/aip/agen-swarm")
def agent_config_list() -> dict:
    t, _ = firm.roster()
    return {"agen": t, "agents": t}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8300, log_level="warning")

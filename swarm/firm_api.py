"""The API behind the app: `python -m swarm.firm_api`, then run the UI in ui/ (npm run dev, port 8310)."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import threading
import time
import traceback
import uuid
from collections import Counter
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import accounts, config, firm, llm, memory, model3d, operator, package, package_firm, planner, planning_case, project, translator
from .mock_firm import MockFirmLlm
from .mock_package import MockPackageLlm
from .mock_plan import MockPlanLlm
from .project_api import router as project_router

STORE = config.ROOT / "data" / "firm"
MOCK_DELAY = 0.5
SAVE_EVERY = 20  # seconds between saves of a run still going
MAX_USD = float(config.setting("SWARM_MAX_USD", "150"))  # the Meta API credit
app = FastAPI(title="NorthTeak")
app.add_middleware(accounts.Gate)
app.middleware("http")(translator.in_language)
app.include_router(project_router)
app.include_router(translator.router)
RUNS: dict[str, dict] = {}
TASKS: dict[str, asyncio.Task] = {}
PROJECTS: dict[str, dict] = {}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _save_run(r: dict) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    path = STORE / f"{r['run']['id']}.json"
    part = path.with_suffix(".part")
    part.write_text(json.dumps({k: v for k, v in r.items() if k != "firm"}), encoding="utf-8")
    part.replace(path)


def _save_projects() -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    (STORE / "projects.json").write_text(json.dumps(PROJECTS), encoding="utf-8")


def _load() -> None:
    if not STORE.exists():
        return
    try:
        if (STORE / "projects.json").exists():
            PROJECTS.update(json.loads((STORE / "projects.json").read_text(encoding="utf-8")))
    except (json.JSONDecodeError, OSError) as e:
        print(f"projects.json could not be read and was skipped: {e}")
    for path in STORE.glob("run-*.json"):
        try:
            r = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            print(f"{path.name} could not be read and was skipped: {e}")
            continue
        if r["run"]["status"] == "running":  # cut by a restart
            r["run"]["status"] = "cancelled"
        RUNS[r["run"]["id"]] = r


_load()


def model_of(mode: str, jenis: str = "disruption"):
    def make(key: str, model: str, max_tokens: int):
        if mode == "mock":
            return {"plan": MockPlanLlm, "package": MockPackageLlm}.get(jenis, MockFirmLlm)(model=f"mock/{key}", agent_key=key, delay=MOCK_DELAY)
        if jenis == "package":
            return llm.muse(model, package_firm.TOKENS, effort=package_firm.EFFORT)
        return llm.muse(model, max_tokens)
    return make


class Start(BaseModel):
    nama: str = ""
    fokus: str | None = ""
    proyek: str | None = None
    versi: str = "muse"
    jenis: str = "disruption"  # disruption: a recovery plan. plan: a consultant's documents into a WBS


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


def _check_project(p: ProjectIn) -> None:
    if p.batas_usd is not None and not 1 <= p.batas_usd <= 150:
        raise HTTPException(400, "batas_usd must be between 1 and 150")
    if not 1 <= p.paralel <= 12:
        raise HTTPException(400, "paralel must be between 1 and 12")


@app.post("/api/aip/konsultan/proyek")
def create_project(p: ProjectIn) -> dict:
    _check_project(p)
    rec = {"id": f"pr-{uuid.uuid4().hex[:10]}", **p.model_dump(), "dibuat_pada": now()}
    rec["brief"] = rec["brief"] or firm.BRIEF
    PROJECTS[rec["id"]] = rec
    _save_projects()
    return rec


@app.put("/api/aip/konsultan/proyek/{pid}")
def update_project(pid: str, p: ProjectIn) -> dict:
    _check_project(p)
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


@app.get("/api/aip/konsultan/simulasi")
def simulasi(proyek: str | None = None) -> dict:
    """The swarm as an animation only: a finished review's trail replayed, or an offline mock run made now. No real model is called either way."""
    done = [r for r in RUNS.values() if r["run"]["status"] == "succeeded" and (not proyek or r["run"].get("proyek") == proyek)]
    if done:
        r = max(done, key=lambda x: x["run"]["created_at"])
        return {"run": {**r["run"], "simulation": True}, "events": r["events"], "sumber": f"the finished review {r['run']['id']}", "catatan": "A replay of a finished review's trail: no model is called."}
    if project.is_blank():
        raise HTTPException(409, "a simulation reads the scenario's documents and records: open the scenario to run one")
    if any(r["run"]["status"] == "running" for r in RUNS.values()):
        raise HTTPException(409, "one review is already running")
    events: list[dict] = []

    def collect(ev: dict) -> None:
        events.append({**ev, "seq": len(events)})

    global MOCK_DELAY
    delay, MOCK_DELAY = MOCK_DELAY, 0
    f = firm.Firm(model_of("mock"), MAX_USD, firm.BRIEF, "", mock=True)
    firm._emit.set(collect)
    try:
        asyncio.run(f.engagement())
    finally:
        MOCK_DELAY = delay
    run = {"id": f"run-{uuid.uuid4().hex[:12]}", "kind": "swarm", "simulation": True, "status": "succeeded", "versi": "mock", "jenis": "disruption", "created_at": now(), "finished_at": now(), "spent_usd": 0, "agents_usage": f.usage}
    return {"run": run, "events": events, "sumber": "an offline mock review, run now", "catatan": "Scripted answers: the wiring is real, and no real model is called."}


@app.get("/api/aip/konsultan/terakhir")
def latest() -> dict:
    done = [r["run"] for r in RUNS.values() if r["run"]["status"] == "succeeded"]
    if not done:
        return {"ada": False}
    last = max(done, key=lambda x: x["created_at"])
    return {"ada": True, "run": last["id"], "pada": last["finished_at"], "biaya_usd": last["spent_usd"]}


@app.post("/api/aip/konsultan")
async def start(body: Start) -> dict:
    if body.versi not in ("mock", "muse"):
        raise HTTPException(400, "versi must be mock or muse")
    if any(r["run"]["status"] == "running" for r in RUNS.values()):
        raise HTTPException(409, "one review is already running")
    if project.busy == "translator":
        raise HTTPException(409, "the translator is at work on this project: wait for it to finish")
    if body.jenis == "package":
        if not project.is_blank():
            raise HTTPException(409, "the scenario has its own package: use a work plan here. To plan from your own documents, start a project of your own")
        if not package.uploads():
            raise HTTPException(409, "upload a document, or tell the agents what you are planning, first")
        if project.has_started():
            raise HTTPException(409, "this project already has an approved plan with work on the board")
    elif project.is_blank():
        raise HTTPException(409, "a review reads the scenario's documents and records: open the scenario to run one")
    mode = body.versi
    if mode == "muse" and not config.setting("META_API_KEY"):
        raise HTTPException(400, "a real run needs META_API_KEY in this repository's .env.local")
    setup = PROJECTS.get(body.proyek or "") or {}
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    project.busy = run_id
    rec = {"run": {"id": run_id, "kind": "swarm", "status": "running", "q": planning_case.BRIEF if body.jenis == "plan" else "" if body.jenis == "package" else setup.get("brief") or firm.BRIEF, "jenis": body.jenis, "nama": body.nama, "fokus": body.fokus, "proyek": body.proyek, "project": project.projects()["active"], "versi": mode, "created_at": now(), "finished_at": None,
                   "spent_usd": 0, "agents_usage": {}, "budget_usd": setup.get("batas_usd") or MAX_USD}, "events": []}
    RUNS[run_id] = rec
    saved = [time.time()]

    def emit(ev: dict) -> None:
        rec["events"].append({**ev, "seq": len(rec["events"])})
        if time.time() - saved[0] > SAVE_EVERY:  # so a restart part way through leaves a record of the run, not only its answers
            saved[0] = time.time()
            if rec.get("firm"):
                rec["run"].update(spent_usd=round(rec["firm"].spent, 4), agents_usage=rec["firm"].usage)
            _save_run(rec)
        if ev.get("type") == "rfi_draft":  # an agent's draft joins the register, for a person to issue
            project.add_rfi({k: ev[k] for k in ("subject", "question", "to", "activity", "impact", "drafted_by")}, "draft", project.SWARM)

    async def go() -> None:
        firm._emit.set(emit)
        status = "succeeded"
        f = None
        try:
            f = {"plan": planner.PlanningFirm, "package": package_firm.PackageFirm}.get(body.jenis, firm.Firm)(model_of(mode, body.jenis), rec["run"]["budget_usd"], rec["run"]["q"], body.fokus or "", mock=mode == "mock", parallel=setup.get("paralel") or None)
            rec["firm"] = f
            if body.jenis == "package":
                f.keep_in = project.answers_folder()
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
                saved = {"plan": project.record_plan, "package": project.record_package_plan}.get(body.jenis, project.record_review)(run_id, f, mode)
            except Exception as e:  # noqa: BLE001 - a run must always end, or it blocks the next one
                traceback.print_exc()
                emit({"type": "error", "agent": None, "message": f"The plan could not be recorded. {type(e).__name__}: {str(e)[:400]}", "t": now()[:19]})
                status = "failed"
            else:
                if body.jenis == "package" and saved:
                    shutil.rmtree(f.keep_in, ignore_errors=True)  # a plan came of them. The next analysis asks afresh
                    try:  # the last stage: the 3D timeline needs the WBS and the schedule, which exist only now
                        f.stage("model3d", "running")
                        note, checks = model3d.summary(model3d.build())
                        if checks:
                            project.patch("plan", saved["id"], {"plan": {**saved["plan"], "checks": [*saved["plan"]["checks"], *checks]}}, project.SWARM, "built the 3D timeline", note)
                        f.stage("model3d", "done", note=note)
                    except Exception as e:  # noqa: BLE001 - the plan stands without it, and the tab says what it can
                        traceback.print_exc()
                        f.stage("model3d", "failed", note=f"The 3D timeline could not be built: {type(e).__name__}: {str(e)[:200]}")
        rec["run"].update(status=status, finished_at=now(), spent_usd=round(f.spent, 4) if f else 0, agents_usage=f.usage if f else {})
        rec.pop("firm", None)
        try:
            _save_run(rec)
        finally:
            project.busy = ""  # whatever happened, the project must not stay locked to a run that has ended

    TASKS[run_id] = asyncio.create_task(go())
    return {"run": run_id, "jumlah_agen": len(firm.roster()[0])}


@app.get("/api/aip/analysis")
def analysis() -> dict:
    """How the analysis stands on the open project: its stages, what it has cost, and whether a plan came of it. The latest run only, and only this project's."""
    active = project.projects()["active"]
    mine = [r for r in RUNS.values() if r["run"].get("project", "scenario") == active and r["run"].get("jenis") in ("plan", "package")]
    if not mine:
        return {"run": None, "stages": [], "packages": [], "problems": [], "kept": project.kept_answers()}
    r = max(mine, key=lambda x: x["run"]["created_at"])
    stages: dict[str, dict] = {}
    done: dict[str, dict] = {}
    problems = []
    for e in r["events"]:
        if e.get("type") == "stage":
            stages[e["key"]] = {**stages.get(e["key"], {}), **{k: e[k] for k in ("key", "label", "status", "note", "done", "of", "by") if k in e}}
        elif e.get("type") == "phase":
            stages[e["phase"]] = {"key": e["phase"], "label": e.get("label") or e["phase"], "status": "done" if e.get("status") == "selesai" else "running"}
        elif e.get("type") == "wp":
            done[e["no"]] = e
        elif e.get("type") == "error":
            problems.append(e.get("message") or "")
    f = r.get("firm")
    return {"run": {**{k: r["run"].get(k) for k in ("id", "status", "jenis", "versi", "created_at", "finished_at", "budget_usd")}, "spent_usd": round(f.spent, 4) if f else r["run"].get("spent_usd", 0)}, "stages": list(stages.values()), "packages": list(done.values()), "problems": problems[-5:], "kept": project.kept_answers()}


# ------------------------------------------------------------------------------------------------ a run read back, live or finished

TOLD = ("agent", "status", "key", "label", "note", "done", "of", "by", "no", "name", "tasks", "message", "ms", "calls", "kept", "accounts")


def _when(e: dict) -> float:
    return datetime.fromisoformat(e["t"]).replace(tzinfo=timezone.utc).timestamp() if e.get("t") else 0.0


def _who(a: dict) -> dict:
    name = str(a.get("name") or a.get("key") or "")
    return {"key": a.get("key"), "name": name, "role": a.get("peran") or "", "model": a.get("model") or "", **({"no": name.split("· ", 1)[-1]} if a.get("instans_dari") == "planner" else {})}


def _usage(r: dict) -> dict:
    f = r.get("firm")
    return (f.usage if f else r["run"].get("agents_usage")) or {}


def _timeline(r: dict, after: int) -> list[dict]:
    """A run's moments, without the pages and prompts: what happened, when, and what each finished turn cost. Time is seconds from the start, so a screen can stand at any point of it."""
    events = r["events"]
    start = next((_when(e) for e in events if e.get("t")), 0.0)
    usage = _usage(r)
    turns = Counter(e.get("agent") for e in events if e.get("type") == "agent_status" and e.get("status") in ("selesai", "gagal"))
    out = []
    at = 0
    for n, e in enumerate(events):
        at = max(at, round(_when(e) - start)) if e.get("t") else at
        kind = e.get("type")
        if n < after or kind not in ("firm", "instances", "agent_status", "stage", "wp", "error", "outline", "done"):
            continue
        row = {"seq": n, "at": at, "type": kind, **{k: e[k] for k in TOLD if k in e}}
        if kind == "firm":
            row.update(stages=[{"key": s["id"], "label": s["label"]} for s in e.get("fase") or []], team=[_who(a) for a in e.get("tim") or []])
        elif kind == "instances":
            row["agents"] = [_who(a) for a in e.get("agents") or []]
        elif kind == "agent_status" and e.get("status") in ("selesai", "gagal"):
            row["usd"] = round(((usage.get(e.get("agent")) or {}).get("usd", 0)) / max(1, turns[e.get("agent")]), 4)
        out.append(row)
    return out


def _plan_of(r: dict) -> dict | None:
    """The plan a run made, if it made one and its project is the one open."""
    if r["run"].get("project", "scenario") != project.projects()["active"]:
        return None
    return next((p for p in project.all_of("plan") if p.get("run") == r["run"]["id"]), None)


def _outline(r: dict) -> list[dict]:
    """The work the planners were given, by control account."""
    told = next((e["accounts"] for e in reversed(r["events"]) if e.get("type") == "outline"), None)
    if told:
        return told
    plan = _plan_of(r)
    if plan:
        return [{"name": a["name"], "packages": [{"no": w["no"], "name": w["name"]} for w in a["packages"]]} for a in plan["plan"].get("accounts") or []]
    groups: dict[str, list[dict]] = {}
    for e in r["events"]:  # a run stopped before this screen existed names each planner's work, and that is all there is
        for a in (e.get("agents") or []) if e.get("type") == "instances" else []:
            if a.get("instans_dari") == "planner":
                no = str(a.get("name", "")).split("· ", 1)[-1]
                groups.setdefault(no.split(".")[0], []).append({"no": no, "name": str(a.get("peran", "")).replace(f"writes the tasks and procedures of {no} ", "")})
    return [{"name": k, "packages": v} for k, v in groups.items()]


def _head(r: dict) -> dict:
    f = r.get("firm")
    return {**{k: r["run"].get(k) for k in ("id", "status", "created_at", "finished_at", "budget_usd")}, "spent_usd": round(f.spent, 4) if f else r["run"].get("spent_usd", 0)}


@app.get("/api/aip/running")
def running() -> dict:
    """The analysis going now, if one is."""
    return {"run": next((r["run"]["id"] for r in RUNS.values() if r["run"]["status"] == "running" and r["run"].get("jenis") == "package"), None)}


@app.get("/api/aip/swarm")
def swarm(run: str = "", after: int = 0) -> dict:
    """The open project's analyses, and one of them as a timeline, the latest unless it names another. After a point, it gives only what came since, so a screen can follow a run as it goes."""
    active = project.projects()["active"]
    mine = sorted((r for r in RUNS.values() if r["run"].get("project", "scenario") == active and r["run"].get("jenis") == "package"), key=lambda x: x["run"]["created_at"], reverse=True)
    kept = project.kept_answers()
    if not mine:
        return {"runs": [], "run": None, "events": [], "next": 0, "outline": [], "by": package_firm.BY, "kept": kept}
    r = next((x for x in mine if x["run"]["id"] == run), mine[0])
    plan = None if r["run"]["status"] == "running" else _plan_of(r)  # a plan record is large, and a screen following a run asks every second or so
    events = r["events"]
    start = next((_when(e) for e in events if e.get("t")), time.time())
    ended = max(next((_when(e) for e in reversed(events) if e.get("t")), start), datetime.fromisoformat(r["run"]["finished_at"]).timestamp() if r["run"].get("finished_at") else 0)
    head = {**_head(r), "elapsed": round((time.time() if r["run"]["status"] == "running" else ended) - start), "summary": (plan or {}).get("summary") or "", "plan_status": (plan or {}).get("status") or ""}
    return {"runs": [_head(x) for x in mine], "run": head, "events": _timeline(r, after), "next": len(events), "outline": _outline(r), "by": package_firm.BY, "kept": kept}


def _brief(text: str) -> str:
    """What an agent was asked, without the rules every agent gets and the shape of the answer."""
    return text.split(package_firm.DATA, 1)[-1].split("Answer with JSON only", 1)[0].strip()[:3000]


def _made(r: dict, key: str, no: str, plan: dict | None) -> dict:
    """What an agent has made so far, from the run while it goes and from its plan afterwards."""
    f = r.get("firm")
    made: dict = {}
    if no:
        info = (getattr(f, "written", {}) or {}).get(no) if f else None
        if info:
            made = {"scope": info.get("scope") or "", "tasks": [{"kind": t.get("kind"), "name": t.get("name")} for sec in info.get("sections") or [] for t in sec.get("tasks") or []]}
        elif plan:
            aid, p = next(((a, x) for a, x in (plan["plan"].get("packages") or {}).items() if x.get("no") == no), (None, None))
            if aid:
                made = {"scope": p.get("scope") or "", "tasks": [{"kind": s.get("kind"), "name": s.get("name")} for s in plan["plan"].get("steps") or [] if s.get("activity") == aid]}
                if plan.get("status") in ("pending", "approved") and project.wbs_codes().get(aid):
                    made["code"] = project.wbs_codes()[aid]
    elif key == "reviewer":
        found = (getattr(f, "found", None) if f else None) or (plan or {}).get("findings") or []
        made = {"findings": [x.get("subject") for x in found]}
    elif key == "rfi":
        asked = (getattr(f, "joined", None) if f else None) or (plan or {}).get("rfi_drafts") or []
        made = {"questions": [{"subject": q.get("subject"), "level": q.get("level") or ""} for q in asked]}
    elif key == "director":
        said = (getattr(f, "executive", None) if f else None) or ((plan or {}).get("plan") or {}).get("executive") or {}
        made = {"summary": said.get("text") or "", "watch": said.get("watch") or []}
    elif key == "engineer" and plan:
        made = {"links": [{k: x.get(k) for k in ("before", "after", "why")} for x in plan["plan"].get("links") or []]}
    return made


@app.get("/api/aip/runs/{run_id}/agents/{key}")
def agent(run_id: str, key: str, stage: str = "") -> dict:
    """One agent in a run: what it was asked, and what it made. An agent that works in two stages says what it was asked in the one named."""
    r = RUNS.get(run_id)
    if not r or not re.fullmatch(r"run-[0-9a-f]+", run_id):
        raise HTTPException(404, "no such review")
    events = r["events"]
    marks = [n for n, e in enumerate(events) if e.get("type") == "stage" and e.get("key") == stage]
    lo, hi = (marks[0], marks[-1]) if marks else (0, len(events))
    asks = [e for e in events[lo:hi + 1] if e.get("type") == "instruksi" and e.get("agent") == key] or [e for e in events if e.get("type") == "instruksi" and e.get("agent") == key]
    who = next((a for e in events if e.get("type") in ("firm", "instances") for a in (e.get("tim") or e.get("agents") or []) if a.get("key") == key), None)
    if who is None:
        raise HTTPException(404, f"no agent {key} in this run")
    no = _who(who).get("no", "")
    u = _usage(r).get(key) or {}
    return {**_who(who), "usd": round(u.get("usd", 0), 4), "calls": u.get("calls", 0), "told": _brief(asks[0]["teks"]) if asks else "", "looks": len(asks), "made": _made(r, key, no, _plan_of(r))}


@app.post("/api/aip/analysis/forget")
def forget() -> dict:
    """Drop what a stopped run kept, so the next one starts over."""
    if any(r["run"]["status"] == "running" for r in RUNS.values()):
        raise HTTPException(409, "an analysis is running")
    shutil.rmtree(project.answers_folder(), ignore_errors=True)
    return {"kept": 0}


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
    r = RUNS.get(run_id)
    if task is None and r is None:
        raise HTTPException(404, "no such review")
    if task and not task.done():
        task.cancel()
        return {"status": "cancelled"}
    return {"status": r["run"]["status"] if r else "cancelled"}


class OperatorIn(BaseModel):
    q: str
    follow: str | None = None
    tab: str = ""


@app.post("/api/aip/operator")
async def operator_start(body: OperatorIn) -> dict:
    """Ask the operator anything: one Muse agent reads the project through its tools and answers. A run like any other, so the screen polls it the same way; it only reads, and never locks the project to a review."""
    if not body.q.strip():
        raise HTTPException(400, "ask something first")
    if not config.muse_ready():
        raise HTTPException(400, "the operator needs META_API_KEY in this repository's .env.local")
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    rec = {"run": {"id": run_id, "kind": "operator", "status": "running", "q": body.q, "follow": body.follow, "tab": body.tab, "answer": "", "jenis": "operator", "versi": "muse", "project": project.projects()["active"], "created_at": now(), "finished_at": None, "spent_usd": 0, "agents_usage": {}}, "events": []}
    RUNS[run_id] = rec

    def emit(ev: dict) -> None:
        rec["events"].append({**ev, "seq": len(rec["events"])})

    async def go() -> None:
        status = "succeeded"
        try:
            emit({"type": "run", "status": "started", "kind": "operator", "model": firm.SPARK})
            out = await operator.ask(body.q, operator.thread_of(RUNS, body.follow), body.tab, emit)
            rec["run"].update(answer=out["answer"], spent_usd=out["usd"])
        except asyncio.CancelledError:
            status = "cancelled"
        except Exception as e:  # noqa: BLE001 - the trail shows what happened
            traceback.print_exc()
            emit({"type": "error", "agent": None, "message": f"{type(e).__name__}: {str(e)[:400]}"})
            status = "failed"
        rec["run"].update(status=status, finished_at=now())
        _save_run(rec)

    TASKS[run_id] = asyncio.create_task(go())
    return {"run": run_id}


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

    project.restore_active()
    threading.Thread(target=memory.warm, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("SWARM_API_PORT", "8300")), log_level="warning")

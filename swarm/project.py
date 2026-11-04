"""The project's operational records: one store where budget, schedule, procurement, subcontractors, daily reports, quality, claims and payments
live, linked to each other, with every change in an audit trail. People work these records in the screens; the swarm reads them live.

Agents only ever propose. A proposal becomes real when a person approves it here: that moves the schedule, adds cost to the forecast and opens work items.
Everything is fictional (PROVENANCE.md). `TODAY` is the scenario's date, so the demo reads the same whenever it is run.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Iterator

from . import config, generator, planning_case as PC, reconcile, site_case as C, wbs as W
from .data import ProjectData
from .scenes import SCENES

DB: Path = config.ROOT / "data" / "firm" / "project.db"
PM = "Project manager"
ACTOR: ContextVar[str] = ContextVar("actor", default="")  # who is signed in for the request being served
SWARM = "Agent swarm"
TODAY = C.TODAY
COST_SHARE = 0.88  # the control budget against the BoQ's sell value: an invented figure
COMMIT_SHARE = 0.97  # how much of each package's budget is already under subcontract or order: invented
RETENTION = 0.05

PACKAGES = [
    {"id": "WP-STR", "name": "Frame and formwork", "sub": "rangka", "boq": ["ST-01", "ST-02", "ST-03", "ST-04", "ST-05"], "activities": ["A50", "A60", "A70"], "cost_factor": 1.02},
    {"id": "WP-REB", "name": "Reinforcement", "sub": "besi", "boq": ["ST-06"], "activities": ["A20", "A80"], "cost_factor": 0.99},
    {"id": "WP-CON", "name": "Concrete (own crew)", "sub": None, "boq": ["ST-07"], "activities": ["A30", "A40", "A90"], "cost_factor": 1.06},
    {"id": "WP-MAS", "name": "Masonry, plaster and tile", "sub": "bata", "boq": ["AR-01", "AR-02", "AR-03", "AR-09", "AR-10"], "activities": ["B10", "B30"], "cost_factor": 0.97},
    {"id": "WP-ENV", "name": "Windows, doors, facade and railings", "sub": "selubung", "boq": ["AR-04", "AR-05", "AR-06", "AR-07", "AR-08", "AR-11", "AR-12"], "activities": ["C10"], "cost_factor": 1.08},
    {"id": "WP-MEP", "name": "MEP and sanitary", "sub": "arus", "boq": ["ME-01", "ME-02", "ME-03", "ME-04", "ME-05", "ME-06", "PL-01", "PL-02"], "activities": ["B20"], "cost_factor": 1.00},
]
SUB_DOCS = {
    "besi": [("Company licence", "2027-03-31"), ("K3 safety certificate", "2026-12-15"), ("Insurance", "2027-01-31")],
    "rangka": [("Company licence", "2027-06-30"), ("K3 safety certificate", "2026-10-20"), ("Insurance", "2027-01-31")],
    "bata": [("Company licence", "2026-12-31"), ("K3 safety certificate", "2026-09-30"), ("Insurance", "2027-02-28")],
    "arus": [("Company licence", "2027-08-31"), ("K3 safety certificate", "2027-02-28"), ("Insurance", "2026-12-31")],
    "selubung": [("Company licence", "2027-05-31"), ("K3 safety certificate", "2027-01-15"), ("Insurance", "2027-03-31")],
}
REQUIRED_DOCS = ["Company licence", "K3 safety certificate", "Insurance"]
INSPECTIONS = [
    {"id": "HP-05", "title": "Level 2 slab rebar", "activity": "", "by": "besi", "date": "2026-08-24", "status": "passed", "next": "", "ncr": ""},
    {"id": "HP-06", "title": "Level 3 slab rebar, bays 1-2", "activity": "", "by": "besi", "date": "2026-09-18", "status": "passed", "next": "", "ncr": ""},
    {"id": "IR-31", "title": "Level 1 brick wall alignment", "activity": "", "by": "bata", "date": "2026-09-22", "status": "passed", "next": "", "ncr": "NCR-012"},
    {"id": "HP-08", "title": "Level 2 conduit, before plaster", "activity": "B30", "by": "arus", "date": "2026-09-26", "status": "passed", "next": "", "ncr": ""},
    {"id": "HP-07", "title": "Level 3 slab rebar, bays 3-4", "activity": "A20", "by": "besi", "date": "2026-10-02", "status": "failed", "next": "2026-10-06", "ncr": "NCR-014"},
]
NCRS = [
    {"id": "NCR-012", "title": "Level 1 brick bed joints too thick", "by": "bata", "activity": "", "raised": "2026-09-10", "due": "2026-09-20", "status": "closed", "closed_on": "2026-09-19", "action": "Rebuilt two bays."},
    {"id": "NCR-014", "title": "Top mat spacing out by 40 mm over 6 m at grid C, Level 3 bays 3-4", "by": "besi", "activity": "A20", "raised": "2026-10-02", "due": "2026-10-06", "status": "open", "closed_on": "", "action": "Rework, then re-inspection on Tuesday at 16:00."},
]
POS = [
    {"id": "PO-118", "item": "Concrete K-350, 120 m3", "supplier": "Usual concrete supplier (fictional)", "package": "WP-CON", "activity": "A30", "needed": "2026-10-06", "promised": "2026-10-07", "status": "delay reported", "value": 138_000_000, "received_on": "", "note": "Plant breakdown, see MSG-W02."},
    {"id": "PO-119", "item": "Concrete pump, 1 day", "supplier": "Pump hire company (fictional)", "package": "WP-CON", "activity": "A30", "needed": "2026-10-06", "promised": "2026-10-06", "status": "confirmed", "value": 9_000_000, "received_on": "", "note": "Tell them by Monday 17:00 if it moves."},
    {"id": "PO-121", "item": "Column rebar, Level 4", "supplier": "Steel stockist (fictional)", "package": "WP-STR", "activity": "A50", "needed": "2026-10-09", "promised": "2026-10-08", "status": "confirmed", "value": 212_000_000, "received_on": "", "note": ""},
    {"id": "PO-124", "item": "Aluminium windows, Level 2", "supplier": "Window fabricator (fictional)", "package": "WP-ENV", "activity": "C10", "needed": "2026-10-06", "promised": "2026-10-08", "status": "confirmed", "value": 148_000_000, "received_on": "", "note": ""},
    {"id": "PO-126", "item": "MEP sleeves and conduit, Level 2", "supplier": "MEP wholesaler (fictional)", "package": "WP-MEP", "activity": "B20", "needed": "2026-10-11", "promised": "2026-10-08", "status": "confirmed", "value": 41_000_000, "received_on": "", "note": ""},
    {"id": "PO-109", "item": "Concrete K-350, bays 1-2", "supplier": "Usual concrete supplier (fictional)", "package": "WP-CON", "activity": "", "needed": "2026-09-21", "promised": "2026-09-21", "status": "received", "value": 131_000_000, "received_on": "2026-09-21", "note": ""},
]
CREW_NEEDED = 26
CREW = {"2026-10-05": 30, "2026-10-06": 18, "2026-10-07": 30, "2026-10-08": 30}
WEATHER = {"2026-10-05": "dry", "2026-10-06": "dry until 15:00, then heavy rain", "2026-10-07": "dry", "2026-10-08": "showers after 13:00"}
RAINY = {"2026-10-06", "2026-10-08"}
PREVIOUS_CERTIFIED = 3_200_000_000
PREFIX = {"submittal": "SUB", "package": "WP", "work_item": "WI", "rfi": "RFI", "daily_report": "DR", "ncr": "NCR", "message": "MG", "cost_item": "CI", "invoice": "INV", "activity": "AC", "milestone": "M", "boq": "BQ", "po": "PO", "inspection": "IN", "document": "UP", "photo": "PH", "risk": "RSK", "variation": "VO", "contingency_use": "CU"}
TASK_STATUS = ("open", "doing", "review", "done")  # a card on the Kanban board; proposed, rejected and superseded are not on it as work

SEED_VERSION = "2"  # raise when the seeded records change shape
_lock = threading.RLock()
_conn: sqlite3.Connection | None = None
_conn_path: Path | None = None
busy = ""  # the review running now: the project cannot change under it
_issued: dict[tuple[Path, str], int] = {}  # the highest id handed out, by database and kind. The record is written after its id is asked for, and two requests in between would otherwise get the same id, the second silently overwriting the first
listeners: list[Callable[[str, str, str, str, str], None]] = []  # told of each line of the audit trail as it is written. memory.py listens, so that this file knows nothing of it


def _db() -> sqlite3.Connection:
    global _conn, _conn_path
    with _lock:
        if _conn is None or _conn_path != DB:
            DB.parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(DB, check_same_thread=False)
            _conn_path = DB
            _conn.executescript("""create table if not exists records (kind text, id text, body text, primary key (kind, id));
                create table if not exists audit (n integer primary key autoincrement, t text, who text, action text, kind text, id text, detail text);
                create table if not exists meta (key text primary key, value text);""")
            if not _conn.execute("select 1 from meta where key = 'seeded' and value = ?", (SEED_VERSION,)).fetchone() and not _conn.execute("select 1 from meta where key = 'blank'").fetchone():
                _conn.executescript("delete from records; delete from audit; delete from meta;")
                _seed()
        return _conn


def is_blank() -> bool:
    """A project a person created: its own records, with nothing from the scenario in them."""
    return bool(meta("blank", False))


def project_start() -> str:
    info = meta("project_info") or {}
    return info.get("start") or C.TODAY


def all_of(kind: str) -> list[dict]:
    with _lock:
        return [json.loads(b) for (b,) in _db().execute("select body from records where kind = ? order by rowid", (kind,))]


def get(kind: str, rid: str) -> dict | None:
    with _lock:
        row = _db().execute("select body from records where kind = ? and id = ?", (kind, rid)).fetchone()
        return json.loads(row[0]) if row else None


def person(who: str) -> str:
    """The person signed in, where a step knows only their job. An agent, or someone answering by link, stays as they are."""
    return (ACTOR.get() or who) if who in (PM, "Site engineer") else who


def log(who: str, action: str, kind: str, rid: str, detail: str = "") -> None:
    who = person(who)
    with _lock:
        _db().execute("insert into audit (t, who, action, kind, id, detail) values (?, ?, ?, ?, ?, ?)", (time.strftime("%Y-%m-%d %H:%M:%S"), who, action, kind, rid, detail))
        _db().commit()
    for heard in listeners:
        heard(who, action, kind, rid, detail)


def put(kind: str, rid: str, body: dict, who: str = "", action: str = "", detail: str = "") -> dict:
    with _lock:
        _db().execute("insert into records (kind, id, body) values (?, ?, ?) on conflict (kind, id) do update set body = excluded.body", (kind, rid, json.dumps(body)))
        _db().commit()
        if who:
            log(who, action, kind, rid, detail)
    return body


def patch(kind: str, rid: str, changes: dict, who: str, action: str, detail: str = "") -> dict:
    with _lock:
        rec = get(kind, rid)
        if rec is None:
            raise KeyError(f"{kind} {rid}")
        rec.update(changes)
        return put(kind, rid, rec, who, action, detail)


def vacuum() -> None:
    """SQLite keeps what was overwritten in its free pages until this. For when a person asked for something to be forgotten."""
    with _lock:
        _db().commit()
        _db().execute("VACUUM")


def next_id(kind: str, start: int = 1) -> str:
    with _lock:
        numbers = [int(r["id"].split("-")[-1]) for r in all_of(kind) if r["id"].startswith(f"{PREFIX[kind]}-") and r["id"].split("-")[-1].isdigit()]
        n = max(max(numbers, default=start - 1), _issued.get((DB, kind), 0)) + 1
        _issued[(DB, kind)] = n
        return f"{PREFIX[kind]}-{n:03d}"


def meta(key: str, default: Any = None) -> Any:
    with _lock:
        row = _db().execute("select value from meta where key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else default


def set_meta(key: str, value: Any) -> None:
    with _lock:
        _db().execute("insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value", (key, json.dumps(value)))
        _db().commit()


def audit(limit: int = 200) -> list[dict]:
    with _lock:
        rows = _db().execute("select n, t, who, action, kind, id, detail from audit order by n desc limit ?", (limit,)).fetchall()
    return [dict(zip(("n", "t", "who", "action", "kind", "id", "detail"), r)) for r in rows]


def _quantities(folder: Path) -> dict[str, float]:
    raw = json.loads((folder / "_hidden" / "log_quantities.json").read_text(encoding="utf-8"))["quantities"]
    total: dict[str, float] = {}
    for row in raw.values():
        for code, qty in row.items():
            total[code] = total.get(code, 0) + qty
    return total


def _claim_lines(data: ProjectData) -> list[dict]:
    """Each claim line beside what the site records show: the same comparison the agents' numbers go through."""
    logged = _quantities(data.folder)
    lines = {x.code: x for x in generator.LINES}
    package_of = {code: p["id"] for p in PACKAGES for code in p["boq"]}
    rows = []
    for code in data.codes:
        item, claim, ln = data.boq[code], data.claim[code], lines[code]
        scene = list(SCENES.get(code, {}).values())
        last = scene[-1] if scene else None
        photo_pct = round(100 * last.installed / last.total, 1) if last and last.kind == "count" else None
        log_pct = round(100 * logged[code] / item["qty"], 1) if code in logged else None
        field = {"pct": photo_pct} if photo_pct is not None else {"pct": None, "reason": "the work cannot be seen in the photo" if last else "no photo"}
        status, reason, agreed = reconcile.decide(claim["claimed_pct"], field, {"pct": log_pct} if log_pct is not None else None)
        if ln.stale and status in reconcile.NEEDS_RULING:
            status, agreed, reason = reconcile.INSPECT, None, "The newest photo and log entry are too old to show the state at the cut-off."
        billing = data.billing_difference(code)
        correct = claim["amount"] - billing
        if status == reconcile.SUPPORTED and billing:
            status, reason = reconcile.BILLING, f"Progress is supported, but the amount is off by Rp {billing:,} against the BoQ price."
        recommended = round(item["value"] * agreed / 100) if status in reconcile.NEEDS_RULING else correct
        rows.append({"code": code, "name": item["name"], "area": item["area"], "package": package_of.get(code, ""), "value": item["value"], "claimed_pct": claim["claimed_pct"], "amount": claim["amount"],
                     "photo_pct": photo_pct, "log_pct": log_pct, "agreed_pct": agreed, "status": status, "reason": reason, "billing_difference": billing, "recommended": recommended})
    return rows


def _seed() -> None:
    conn = _conn
    data = ProjectData.load()
    truth = {x.code: x for x in generator.LINES}
    planned = {c: data.schedule[c]["planned_pct_at_cutoff"] for c in data.codes}

    def put_raw(kind: str, rec: dict) -> None:
        conn.execute("insert or replace into records (kind, id, body) values (?, ?, ?)", (kind, rec["id"], json.dumps(rec)))

    for code in data.codes:
        put_raw("boq", {"id": code, **data.boq[code], "planned_pct": planned[code], "verified_pct": truth[code].actual})
    for p in PACKAGES:
        value = sum(data.boq[c]["value"] for c in p["boq"])
        budget = round(value * COST_SHARE)
        earned = sum(data.boq[c]["value"] * truth[c].actual / 100 for c in p["boq"]) * COST_SHARE
        put_raw("package", {**p, "boq_value": value, "budget": budget, "committed": round(budget * COMMIT_SHARE), "actual_cost": round(earned * p["cost_factor"])})
    for sid, s in C.SUBCONTRACTORS.items():
        package = next((p for p in PACKAGES if p["sub"] == sid), None)
        value = round(sum(data.boq[c]["value"] for c in package["boq"]) * COST_SHARE) if package else 0
        put_raw("subcontractor", {"id": sid, **s, "status": "active", "package": package["id"] if package else "", "contract_value": value, "retention_pct": 5,
                                  "documents": [{"name": n, "expires": e} for n, e in SUB_DOCS.get(sid, [])]})
        if package:
            earned = round(sum(data.boq[c]["value"] * truth[c].actual / 100 for c in package["boq"]) * COST_SHARE)
            certified = int(round(earned * 0.78, -5))
            claimed = int(round(earned * (0.34 if sid == "selubung" else 0.18), -5))  # one subcontractor bills ahead of its verified work
            put_raw("invoice", {"id": f"INV-{len(all_of_raw(conn, 'invoice')) + 41}", "sub": sid, "period": "September 2026", "earned_to_date": earned, "certified_to_date": certified, "paid_to_date": round(certified * (1 - RETENTION)), "claimed": claimed, "status": "submitted", "certified": 0, "certified_on": "", "paid_on": ""})
    for rec in INSPECTIONS:
        put_raw("inspection", rec)
    for rec in NCRS:
        put_raw("ncr", rec)
    for rec in POS:
        put_raw("po", rec)
    for rec in C.RFIS:
        put_raw("rfi", dict(rec))
    package_of = {code: p["id"] for p in PACKAGES for code in p["boq"]}
    quantities = json.loads((data.folder / "_hidden" / "log_quantities.json").read_text(encoding="utf-8"))["quantities"]
    for e in data.logs:
        codes = list(quantities.get(e["id"], {}))
        put_raw("daily_report", {**e, "package": package_of.get(codes[0], "") if codes else "", "items": codes, "crew": None, "weather": "", "verified": True, "verified_by": "Site engineer", "source": "site"})
    lines = _claim_lines(data)
    put_raw("claim", {"id": "CL-07", "no": 7, "period": "September 2026", "cutoff": data.project["cutoff"], "status": "draft", "lines": lines, "previous_certified": PREVIOUS_CERTIFIED, "submitted": 0, "certified": 0, "submitted_on": "", "certified_on": "", "paid_on": "", "adjusted": False})
    conn.execute("insert or replace into meta (key, value) values ('schedule_state', ?)", (json.dumps({"pour_delay_days": 0, "compress": {}}),))
    conn.execute("insert or replace into meta (key, value) values ('progress', ?)", (json.dumps({}),))
    conn.execute("insert or replace into meta (key, value) values ('seeded', ?)", (SEED_VERSION,))
    conn.commit()
    set_meta("seed_hash", _state_hash())


def all_of_raw(conn: sqlite3.Connection, kind: str) -> list:
    return conn.execute("select id from records where kind = ?", (kind,)).fetchall()


def _state_hash() -> str:
    """What decides the review's answer. Scoring only means something while these are as seeded."""
    state = [all_of("ncr"), [r for r in all_of("rfi") if r.get("status") != "draft"], all_of("po"), meta("schedule_state")]
    return hashlib.sha1(json.dumps(state, sort_keys=True).encode()).hexdigest()


def as_seeded() -> bool:
    return meta("seed_hash") == _state_hash()


def reset() -> None:
    """Back to the start of the scenario, for another demo. The audit trail starts again too. A project a person created is never reset."""
    global _conn
    if is_blank():
        raise ValueError("only the scenario can be reset: this is a project of your own")
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None
        if DB.exists():
            DB.unlink()
        _issued.clear()
        _db()


# ------------------------------------------------------------------------------------------------ projects: the scenario, and any a person creates, each in its own file


SCENARIO_DB = DB
TEMPLATE = [("Preliminaries", ["Site set-up and hoarding"]), ("Earthworks and substructure", ["Excavation", "Foundations"]), ("Structure", ["Columns", "Beams and slabs"]), ("Architecture", ["Walls and plaster", "Doors, windows and finishes"]), ("MEP", ["First fix", "Second fix and testing"])]


def _registry_path() -> Path:
    return SCENARIO_DB.parent / "projects_index.json"


def projects() -> dict:
    created = json.loads(_registry_path().read_text(encoding="utf-8")) if _registry_path().exists() else []
    scenario = {"id": "scenario", "name": json.loads((generator.ensure() / "project.json").read_text(encoding="utf-8"))["name"], "scenario": True}
    active = next((p["id"] for p in created if SCENARIO_DB.parent / "projects" / f"{p['id']}.db" == DB), "scenario")
    return {"projects": [scenario, *created], "active": active}


def _standing(path: Path) -> dict:
    """How far a project has got, read from its own file, so that listing projects opens none of them."""
    if not path.exists():
        return {"documents": 0, "work_packages": 0, "plan": ""}
    conn = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    try:
        documents = conn.execute("select count(*) from records where kind = 'document' and json_extract(body, '$.source') = 'upload'").fetchone()[0]
        work = conn.execute("select count(*) from records where kind = 'activity'").fetchone()[0]
        plans = [s for (s,) in conn.execute("select json_extract(body, '$.status') from records where kind = 'plan' order by rowid")]
    except sqlite3.OperationalError:  # a file being created, which has no tables yet
        return {"documents": 0, "work_packages": 0, "plan": ""}
    finally:
        conn.close()
    return {"documents": documents, "work_packages": work, "plan": next((s for s in ("approved", "pending") if s in plans), next((s for s in reversed(plans) if s != "superseded"), ""))}


def project_list() -> dict:
    """Every project as the Home tab shows it: how far each has got, and which one the agents are working on."""
    known = projects()
    return {**known, "projects": [{**p, **_standing(SCENARIO_DB if p.get("scenario") else SCENARIO_DB.parent / "projects" / f"{p['id']}.db"), "running": bool(busy) and p["id"] == known["active"]} for p in known["projects"]]}


def answers_folder() -> Path:
    """Where a run keeps its agents' finished answers until a plan comes of them, beside the project's records. It is made when there is one to keep."""
    return DB.parent / "answers" / DB.stem


def kept_answers() -> int:
    """How many finished answers a stopped run left for the next one to pick up."""
    return sum(1 for _ in answers_folder().glob("*.json"))


def path_of(pid: str) -> Path | None:
    """Where a project's records are."""
    p = next((x for x in projects()["projects"] if x["id"] == pid), None)
    return None if not p else SCENARIO_DB if p.get("scenario") else SCENARIO_DB.parent / "projects" / f"{pid}.db"


def upload_folder() -> Path:
    """Where a project's uploads live, beside its records."""
    folder = DB.parent / "uploads" / DB.stem
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _use(path: Path) -> None:
    global DB, TODAY, _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None
        DB = path
        _db()
        TODAY = date.today().isoformat() if is_blank() else C.TODAY


@contextmanager
def visiting(path: Path) -> Iterator[None]:
    """Another project's records for a moment, read beside the open one's, as the portfolio does. The lock is held throughout, so no other request reads or writes while the app points elsewhere."""
    global DB, TODAY, _conn, _conn_path
    with _lock:
        if path == DB:
            yield
            return
        saved = DB, TODAY, _conn, _conn_path
        DB, _conn, _conn_path = path, None, None
        try:
            _db()
            TODAY = date.today().isoformat() if is_blank() else C.TODAY
            yield
        finally:
            if _conn is not None:
                _conn.close()
            DB, TODAY, _conn, _conn_path = saved


def open_project(pid: str) -> dict:
    """The app works on one project at a time, on one machine."""
    if busy:
        raise ValueError("the agents are working on the open project: wait for them, or stop them, before changing project")
    if pid == "scenario":
        _use(SCENARIO_DB)
    else:
        if not any(p["id"] == pid for p in projects()["projects"]):
            raise KeyError(pid)
        _use(SCENARIO_DB.parent / "projects" / f"{pid}.db")
    (SCENARIO_DB.parent / "active_project.txt").write_text(pid, encoding="utf-8")
    return projects()


def restore_active() -> None:
    """Back on the project that was open when the app last stopped."""
    saved = SCENARIO_DB.parent / "active_project.txt"
    if saved.exists() and saved.read_text(encoding="utf-8").strip() not in ("", "scenario"):
        try:
            open_project(saved.read_text(encoding="utf-8").strip())
        except KeyError:
            pass


def create_project(name: str, owner: str = "", contractor: str = "", location: str = "", start: str = "", finish: str = "", template: bool = True) -> dict:
    """A new project: its own file of records, empty but for a starter breakdown if asked for. Nothing in it comes from the scenario."""
    if not name.strip():
        raise ValueError("a project needs a name")
    if busy:
        raise ValueError("the agents are working on the open project: wait for them, or stop them, before starting a new one")
    try:  # a date that does not parse would be saved, and every view of the schedule would then fail on it
        start, finish = (date.fromisoformat(d.strip()).isoformat() if d.strip() else "" for d in (start, finish))
    except ValueError:
        raise ValueError("the start and finish must be dates, such as 2026-11-05") from None
    if start and finish and finish < start:
        raise ValueError("the finish comes before the start")
    pid = "pj-" + hashlib.sha1(f"{name}{time.time()}".encode()).hexdigest()[:8]
    start = start or date.today().isoformat()
    info = {"name": name.strip(), "owner": owner, "contractor": contractor or "Main contractor", "location": location, "start": start, "finish": finish, "region": location, "currency": "IDR", "notice": ""}
    path = SCENARIO_DB.parent / "projects" / f"{pid}.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript("""create table if not exists records (kind text, id text, body text, primary key (kind, id));
        create table if not exists audit (n integer primary key autoincrement, t text, who text, action text, kind text, id text, detail text);
        create table if not exists meta (key text primary key, value text);""")
    for key, value in (("blank", True), ("project_info", info), ("schedule_state", {"pour_delay_days": 0, "compress": {}}), ("progress", {})):
        conn.execute("insert into meta (key, value) values (?, ?)", (key, json.dumps(value)))
    conn.commit()
    conn.close()
    created = json.loads(_registry_path().read_text(encoding="utf-8")) if _registry_path().exists() else []
    created.append({"id": pid, "name": info["name"], "location": location, "start": start, "created": time.strftime("%Y-%m-%d %H:%M")})
    _registry_path().write_text(json.dumps(created), encoding="utf-8")
    open_project(pid)
    log(PM, "created the project", "project", pid, info["name"])
    if template:
        before: list[str] = []
        for package, activities in TEMPLATE:  # one after the other, so the dates start out meaning something: change the links and durations to suit
            p = add_package(package)
            for name_ in activities:
                before = [add_activity(name_, p["id"], 5, before)["id"]]
    return projects()


# ------------------------------------------------------------------------------------------------ schedule


def schedule_state() -> dict:
    return meta("schedule_state", {"pour_delay_days": 0, "compress": {}})


def activity_rows() -> list[tuple]:
    """The programme's activities: the scenario's, and any a person added."""
    return [*([] if is_blank() else C.ACTIVITIES), *[(a["id"], a["name"], a["duration"], a["predecessors"], a["by"]) for a in all_of("activity")]]


def wbs_codes() -> dict[str, str]:
    """Each work package's and activity's WBS code, from the order they were added. The project itself is 1."""
    codes: dict[str, str] = {}
    for i, p in enumerate(all_of("package"), 1):
        codes[p["id"]] = f"1.{i}"
        for j, aid in enumerate(p["activities"], 1):
            codes[aid] = f"1.{i}.{j}"
    return codes


def activity_heads(activities: list[str]) -> dict[str, dict]:
    """What a work plan hangs its tasks on: each activity's WBS code and name."""
    codes, names = wbs_codes(), {a[0]: a[1] for a in activity_rows()}
    return {a: {"code": codes.get(a, ""), "name": names.get(a, a)} for a in activities}


def task_progress() -> dict[str, int]:
    """An activity's progress, where it has tasks on the board: how much of their man-hours is done. The board drives the schedule."""
    groups: dict[str, list[dict]] = {}
    for w in all_of("work_item"):
        if w.get("physical") and w.get("activity") and w["status"] in TASK_STATUS:
            groups.setdefault(w["activity"], []).append(w)
    out = {}
    for aid, tasks in groups.items():
        total = sum(t.get("man_hours") or 1 for t in tasks)
        out[aid] = round(sum((t.get("man_hours") or 1) * (100 if t["status"] == "done" else t.get("progress") or 0) for t in tasks) / total)
    return out


def contract_starts() -> set[str]:
    """The activities that start when the consultant's master schedule says, as code read it: contract dates, which a person cannot move. An agent's estimate, a row it split and work a person added can be moved. A plan recorded before activities were marked says which in its checks."""
    own = all_of("activity")
    out = {a["id"] for a in own if a.get("contract_weeks")}
    old = [a for a in own if "contract_weeks" not in a and a.get("no")]
    for p in all_of("plan") if old else []:
        checks = p["plan"].get("checks") or []
        if any(c["rule"] == "schedule_read" and c["ok"] for c in checks):
            split = tuple(f"{c['rule'][6:]}." for c in checks if c["rule"].startswith("split_"))
            out |= {a["id"] for a in old if a["id"] in p["plan"].get("activities", []) and not a["no"].startswith(split)}
    return out


def _as_changed(fixed: dict, state: dict) -> dict:
    """The schedule's own ties with what a person changed: an earliest start moved or taken away, and days set between a piece of work and what it waits for, which make it follow that work instead of running beside it."""
    not_before = {k: v for k, v in {**fixed["not_before"], **(state.get("not_before") or {})}.items() if v}
    leads = {k: dict(v) for k, v in fixed["leads"].items()}
    overlaps = {k: dict(v) for k, v in fixed["overlaps"].items()}
    for aid, lags in (state.get("lags") or {}).items():
        leads.setdefault(aid, {}).update(lags)
        for p in lags:
            overlaps.get(aid, {}).pop(p, None)
    return {"not_before": not_before, "leads": leads, "overlaps": overlaps}


def schedule(extra_delay: int = 0) -> dict:
    """The live schedule, worked out by code, beside its baseline, with each activity's links to the other records."""
    state = schedule_state()
    rows, start = activity_rows(), project_start()
    own = all_of("activity")
    answers = {a["id"]: a["responsible"] for a in own if a.get("responsible")}
    fixed = {"not_before": {a["id"]: a["not_before"] for a in own if a.get("not_before")}, "leads": {a["id"]: a["leads"] for a in own if a.get("leads")}, "overlaps": {a["id"]: a["overlaps"] for a in own if a.get("overlaps")}}
    live = _as_changed(fixed, state)
    plan = C.schedule(state["pour_delay_days"] + extra_delay, state["compress"], rows, state.get("links"), start, **live)
    base = {a["id"]: a for a in C.schedule(0, {}, rows, None, start, **fixed)["activities"]}
    manual, from_tasks = meta("progress", {}), task_progress()
    rfis, ncrs, pos = all_of("rfi"), all_of("ncr"), all_of("po")
    packages = all_of("package")
    subs = {s["id"]: s["name"] for s in all_of("subcontractor")}
    codes, assigned, contract = wbs_codes(), state.get("by") or {}, contract_starts()
    for a in plan["activities"]:
        b = base[a["id"]]
        a["by"] = assigned.get(a["id"], a["by"])
        earliest, beside = live["not_before"].get(a["id"]), live["overlaps"].get(a["id"]) or {}
        a.update(baseline_start=b["start"], baseline_finish=b["finish"], progress=from_tasks.get(a["id"], manual.get(a["id"], 0)), progress_from="tasks" if a["id"] in from_tasks else "manual", by_name=subs.get(a["by"]) or answers.get(a["id"]) or "Own crew",
                 earliest=(date.fromisoformat(start) + timedelta(days=earliest)).isoformat() if earliest else "", start_fixed=a["id"] in contract,
                 lags={p: (live["leads"].get(a["id"]) or {}).get(p, 0) for p in a["predecessors"] if p not in beside}, alongside=[p for p in a["predecessors"] if p in beside],
                 package=next((p["id"] for p in packages if a["id"] in p["activities"]), ""), code=codes.get(a["id"], ""),
                 rfis=[r["id"] for r in rfis if r.get("activity") == a["id"] and r["status"] == "open"], ncrs=[n["id"] for n in ncrs if n.get("activity") == a["id"] and n["status"] == "open"],
                 pos=[p["id"] for p in pos if p.get("activity") == a["id"] and p["status"] not in ("received", "cancelled")])
    linked = {x for a in plan["activities"] for x in a["predecessors"]} | {a["id"] for a in plan["activities"] if a["predecessors"]}
    if linked:
        for a in plan["activities"]:  # work tied to nothing, such as site overheads that run the whole job, has no float only because it ends when the job does: that does not make it critical
            if a["id"] not in linked:
                a["critical"] = False
    by_id = {a["id"]: a for a in plan["activities"]}
    plan["milestones"] = [*([plan["milestone"]] if plan["milestone"] else []), *[_milestone(m, by_id) for m in all_of("milestone")]]
    plan["today"] = TODAY
    plan["state"] = state
    return plan


def _milestone(m: dict, acts: dict[str, dict]) -> dict:
    if m.get("whole_job") and acts:  # the job is done when its last work is, whichever that turns out to be. Work tied to nothing, such as site overheads, has a date that never moves, so a tie goes to what has no float
        last = max(acts.values(), key=lambda a: (a["finish"], a["critical"]))
        return {**m, "activity": last["id"], "forecast": last["finish"], "days_late": max(0, days_between(m["contract_date"], last["finish"]))}
    a = acts.get(m["activity"])
    forecast = a["finish"] if a else m["contract_date"]
    return {**m, "forecast": forecast, "days_late": max(0, days_between(m["contract_date"], forecast))}


def _would_loop(aid: str, predecessors: list[str], links: dict[str, list[str]]) -> bool:
    links = {**links, aid: predecessors}
    seen, stack = set(), list(predecessors)
    while stack:
        p = stack.pop()
        if p == aid:
            return True
        if p not in seen:
            seen.add(p)
            stack += links.get(p, [])
    return False


MOST_DAYS = 3650  # ten years: a longer duration, lag or wait is a slip of the keyboard, and was saved, and every view of the schedule then failed on a date past the year 9999


def update_activity(aid: str, progress: int | None, duration: int | None, predecessors: list[str] | None = None, by: str | None = None, who: str = PM, earliest: str | None = None, lags: dict[str, int] | None = None) -> dict:
    """A person's change to one activity. earliest is the day it may start at the soonest, or "" for as soon as what it waits for allows. lags are the days between it and what it waits for: below zero, it starts that many days before the other finishes."""
    known = {a[0]: a for a in activity_rows()}
    if aid not in known:
        raise KeyError(aid)
    details = []
    if progress is not None:
        if aid in task_progress():
            raise ValueError("this activity's progress comes from its tasks on the Kanban board")
        values = meta("progress", {})
        values[aid] = max(0, min(100, int(progress)))
        set_meta("progress", values)
        details.append(f"progress {values[aid]}%")
    state = schedule_state()
    if duration is not None and int(duration) > MOST_DAYS or lags is not None and any(abs(int(n)) > MOST_DAYS for n in lags.values()):
        raise ValueError(f"a duration or a lag is at most {MOST_DAYS} days")
    if duration is not None:
        state["compress"][aid] = known[aid][2] - max(1, int(duration))
        if not state["compress"][aid]:
            del state["compress"][aid]
        details.append(f"duration {max(1, int(duration))} days")
    if predecessors is not None:
        links = {k: v[3] for k, v in known.items()} | (state.get("links") or {})
        bad = [p for p in predecessors if p not in known]
        if bad:
            raise ValueError(f"no such activity: {', '.join(bad)}")
        if _would_loop(aid, predecessors, links):
            raise ValueError(f"that would make a loop: {aid} would end up waiting for itself")
        state.setdefault("links", {})[aid] = list(predecessors)
        if aid in (state.get("lags") or {}):
            state["lags"][aid] = {p: n for p, n in state["lags"][aid].items() if p in predecessors}
        details.append(f"depends on {', '.join(predecessors) or 'nothing'}")
    if by is not None:
        state.setdefault("by", {})[aid] = by
        details.append(f"by {by}")
    if earliest is not None:
        if aid in contract_starts():
            raise ValueError("it starts when the consultant's master schedule says, which is a contract date")
        try:
            day = days_between(project_start(), earliest) if earliest else None
        except ValueError as e:
            raise ValueError("an earliest start is a date like 2027-03-01") from e
        if day is not None and day < 0:
            raise ValueError(f"it cannot start before the project does, on {project_start()}")
        if day is not None and day > MOST_DAYS:
            raise ValueError(f"it cannot start more than {MOST_DAYS} days after the project does")
        state.setdefault("not_before", {})[aid] = day
        details.append(f"earliest start {earliest}" if earliest else "no earliest start")
    if lags is not None:
        waits = (state.get("links") or {}).get(aid, known[aid][3])
        bad = [p for p in lags if p not in waits]
        if bad:
            raise ValueError(f"{aid} does not wait for {', '.join(bad)}")
        mine = state.setdefault("lags", {})
        mine[aid] = {**mine.get(aid, {}), **{p: int(n) for p, n in lags.items()}}
        details.append(", ".join(f"{n:+d} days after {p}" for p, n in lags.items()))
    if duration is not None or predecessors is not None or by is not None or earliest is not None or lags is not None:
        set_meta("schedule_state", state)
    log(who, "updated activity", "activity", aid, ", ".join(details))
    return next(a for a in schedule()["activities"] if a["id"] == aid)


def add_package(name: str, sub: str = "", budget_rp: int = 0, who: str = PM) -> dict:
    rid = next_id("package")
    return put("package", rid, {"id": rid, "name": name, "sub": sub or None, "boq": [], "activities": [], "cost_factor": 1.0, "boq_value": 0, "budget": int(budget_rp), "committed": 0, "actual_cost": 0}, who, "added a work package", name)


def add_activity(name: str, package: str, duration: int, predecessors: list[str] | None = None, by: str = "self", who: str = PM) -> dict:
    p = get("package", package)
    if not p:
        raise KeyError(package)
    known = {a[0] for a in activity_rows()}
    bad = [x for x in predecessors or [] if x not in known]
    if bad:
        raise ValueError(f"no such activity: {', '.join(bad)}")
    if not name.strip():
        raise ValueError("an activity needs a name")
    if int(duration) > MOST_DAYS:
        raise ValueError(f"a duration is at most {MOST_DAYS} days")
    rid = next_id("activity")
    put("activity", rid, {"id": rid, "name": name.strip(), "duration": max(1, int(duration)), "predecessors": list(predecessors or []), "by": by or "self"}, who, "added an activity", name)
    patch("package", package, {"activities": [*p["activities"], rid]}, who, "added an activity to a work package", rid)
    return next(a for a in schedule()["activities"] if a["id"] == rid)


def add_milestone(name: str, activity: str, contract_date: str, who: str = PM, whole_job: bool = False) -> dict:
    if activity not in {a[0] for a in activity_rows()}:
        raise KeyError(activity)
    if not name.strip():
        raise ValueError("a milestone needs a name")
    try:
        date.fromisoformat(contract_date)
    except (TypeError, ValueError) as e:
        raise ValueError("a milestone needs a contract date like 2027-03-01") from e
    rid = next_id("milestone")
    return put("milestone", rid, {"id": rid, "name": name, "activity": activity, "contract_date": contract_date, **({"whole_job": True} if whole_job else {})}, who, "added a milestone", name)


SHAPE_KEPT = "a plan is approved, and its tasks and inspections carry their WBS codes, so the breakdown keeps its shape: new work takes the next number"


def plan_approved() -> bool:
    """Once a plan is approved, the breakdown keeps its shape: what is added takes the next number, and nothing already there moves or goes."""
    return any(p["status"] == "approved" for p in all_of("plan"))


def package_of(aid: str) -> dict | None:
    return next((p for p in all_of("package") if aid in p["activities"]), None)


def _shares(total: float, weights: list[float], places: int = 0) -> list[float]:
    """total split in proportion to weights, or equally where they are all nothing. The last takes what rounding leaves, so the parts add up."""
    whole, out = sum(weights), []
    for i, w in enumerate(weights):
        out.append(round(total - sum(out), places) if i == len(weights) - 1 else round(total * (w / whole if whole else 1 / len(weights)), places))
    return out


def _held(aid: str) -> str:
    """What still hangs on a work package and would be left pointing at nothing if it went, said as the reason it cannot go yet. Empty when nothing does."""
    held = ([r["id"] for r in all_of("rfi") if r.get("activity") == aid and r["status"] != "draft"] + [n["id"] for n in all_of("ncr") if n.get("activity") == aid] + [o["id"] for o in all_of("po") if o.get("activity") == aid and o["status"] != "cancelled"]
            + [w["id"] for w in all_of("work_item") if w.get("activity") == aid and w["status"] not in ("rejected", "superseded")] + [i["id"] for i in all_of("inspection") if i.get("activity") == aid] + [m["id"] for m in all_of("milestone") if m["activity"] == aid and not m.get("whole_job")])
    return f"{', '.join(held[:6])}{' and more' if len(held) > 6 else ''} {'is' if len(held) == 1 else 'are'} tied to it: move or close {'it' if len(held) == 1 else 'them'} first" if held else ""


def changes_allowed(kind: str, rid: str) -> dict:
    """What a person can change about a control account or a work package, and why not where they cannot: the screen offers only what will work."""
    approved = plan_approved()
    accounts = [{"id": p["id"], "name": p["name"]} for p in all_of("package")]
    if kind == "package":
        p = get("package", rid)
        empty = bool(p) and not p["activities"] and not p["boq"]
        return {"rename": bool(p), "move": False, "remove": empty and not approved, "why": SHAPE_KEPT if approved else "" if empty else "it can be removed once its work packages are moved or removed", "accounts": accounts}
    if not get("activity", rid):
        return {"rename": False, "move": False, "remove": False, "why": "it is part of the sample project, which stays as it is", "accounts": accounts}
    fixed, held = rid in contract_starts(), _held(rid)
    why = SHAPE_KEPT if approved else "it is a row of the consultant's master schedule, so it stays: reject it in the plan if it should get no tasks" if fixed else held
    return {"rename": True, "move": not approved, "remove": not (approved or fixed or held), "why": why, "accounts": accounts}


def change_activity(aid: str, name: str | None = None, package: str | None = None, who: str = PM) -> dict:
    """A person renames a work package, or moves it to another control account. A name can change at any time. A move renumbers the WBS, so it is for before a plan is approved. Its BoQ lines go with it, and what they add to the budget."""
    with _lock:
        a = get("activity", aid)
        if not a:
            raise KeyError(aid)
        if name is not None:
            name = name.strip()
            if not name:
                raise ValueError("a work package needs a name")
            if name != a["name"]:
                patch("activity", aid, {"name": name}, who, "renamed a work package", f"{a['name']} to {name}")
        here = package_of(aid)
        if package is not None and package != (here or {}).get("id"):
            there = get("package", package)
            if not there:
                raise KeyError(package)
            if plan_approved():
                raise ValueError(SHAPE_KEPT)
            lines = [b for b in all_of("boq") if b.get("activity") == aid and here and b["id"] in here["boq"]]
            ids, value = [b["id"] for b in lines], sum(b["value"] for b in lines)
            budget = sum(round(b["value"] * b.get("share", 1.0)) for b in lines)  # a line from before its share was kept is the plan's own, at its full value
            if here:
                patch("package", here["id"], {"activities": [x for x in here["activities"] if x != aid], "boq": [x for x in here["boq"] if x not in ids], "boq_value": here["boq_value"] - value, "budget": here["budget"] - budget}, who, "moved a work package out of a control account", aid)
            patch("package", package, {"activities": [*there["activities"], aid], "boq": [*there["boq"], *ids], "boq_value": there["boq_value"] + value, "budget": there["budget"] + budget}, who, "moved a work package into a control account", aid)
            for b in lines:
                patch("boq", b["id"], {"package": package}, who, "moved a BoQ line with its work package", aid)
        return {"id": aid, "code": wbs_codes().get(aid, "")}


def remove_activity(aid: str, who: str = PM) -> dict:
    """A person takes a work package out of the proposal: an agent's guess at work that is not there, a part of a row it split, or work a person added by mistake. A row of the consultant's master schedule stays, and so does everything once a plan is approved.

    Its share of the value goes to the other work packages of its control account, the other parts of its row first, so the account still adds up to what the BoQ says. Links to it go, and so do its tasks in the proposal."""
    with _lock:
        a = get("activity", aid)
        if not a:
            raise KeyError(aid)
        if plan_approved():
            raise ValueError(SHAPE_KEPT)
        if aid in contract_starts():
            raise ValueError("it is a row of the consultant's master schedule, so it stays: reject it in the plan if it should get no tasks")
        if _held(aid):
            raise ValueError(_held(aid))
        p = package_of(aid)
        own = {x["id"]: x for x in all_of("activity")}
        kin = [x for x in (p or {}).get("activities", []) if x != aid and x in own]
        row = a.get("no", "").rpartition(".")[0]
        kin = [x for x in kin if row and own[x].get("no", "").rpartition(".")[0] == row] or kin
        lines = [b for b in all_of("boq") if b.get("activity") == aid]
        priced = [b["id"] for b in lines if (b["unit"], b["qty"]) != ("ls", 1.0)]
        if priced:
            raise ValueError(f"{', '.join(priced)} {'prices' if len(priced) == 1 else 'price'} it by quantity, and a person has to say where that goes")
        gone, weight = sum(b["value"] for b in lines), a.get("weight") or 0
        into = [b for b in all_of("boq") if b.get("activity") in kin and (b["unit"], b["qty"]) == ("ls", 1.0)]
        if gone and not into:
            raise ValueError(f"it is the only work package in {p['name'] if p else 'its control account'} with a value, so its Rp {gone:,} has nowhere to go: rename it instead")
        for b, extra in zip(into, _shares(gone, [b["value"] for b in into]) if gone else []):
            patch("boq", b["id"], {"unit_price": b["unit_price"] + int(extra), "value": b["value"] + int(extra)}, who, "took on the value of a removed work package", f"{aid}: Rp {int(extra):,}")
        for x, extra in zip(kin, _shares(weight, [own[x].get("weight") or 0 for x in kin], 2) if weight else []):
            patch("activity", x, {"weight": round((own[x].get("weight") or 0) + extra, 2)}, who, "took on the weight of a removed work package", aid)
        gone_ids = {b["id"] for b in lines}
        for b in lines:
            drop("boq", b["id"])
        for q in all_of("package"):
            if aid in q["activities"] or gone_ids & set(q["boq"]):
                patch("package", q["id"], {"activities": [x for x in q["activities"] if x != aid], "boq": [x for x in q["boq"] if x not in gone_ids]}, who, "took a removed work package out of its control account", aid)
        for x in own.values():
            if aid in x["predecessors"] or aid in (x.get("leads") or {}) or aid in (x.get("overlaps") or {}):
                patch("activity", x["id"], {"predecessors": [y for y in x["predecessors"] if y != aid], "leads": {k: v for k, v in (x.get("leads") or {}).items() if k != aid}, "overlaps": {k: v for k, v in (x.get("overlaps") or {}).items() if k != aid}}, who, "lost a link to a removed work package", aid)
        state = schedule_state()
        state["links"] = {k: [y for y in v if y != aid] for k, v in (state.get("links") or {}).items() if k != aid}
        state["lags"] = {k: {y: n for y, n in v.items() if y != aid} for k, v in (state.get("lags") or {}).items() if k != aid}
        for key in ("compress", "not_before", "by"):
            (state.get(key) or {}).pop(aid, None)
        set_meta("schedule_state", state)
        set_meta("progress", {k: v for k, v in meta("progress", {}).items() if k != aid})
        rest = [x for x in own if x != aid]
        for m in all_of("milestone"):
            if m["activity"] != aid:
                continue
            if rest:  # only one that follows the whole job is left here, and it finds its last work for itself
                patch("milestone", m["id"], {"activity": rest[-1]}, who, "followed the job past a removed work package", aid)
            else:
                drop("milestone", m["id"])
        for r in all_of("rfi"):
            if r.get("activity") == aid:
                patch("rfi", r["id"], {"activity": ""}, who, "kept a drafted question for the whole project", f"{aid} was removed")
        for rec in all_of("plan"):
            if rec["status"] == "pending" and aid in rec["plan"].get("activities", []):
                plan = rec["plan"]
                steps = [s for s in plan["steps"] if s["activity"] != aid]
                kept = {s["id"] for s in steps}
                steps = [{**s, "after": [x for x in s["after"] if x in kept]} for s in steps]
                totals = {**plan["totals"], "steps": len(steps), "operations": sum(s["kind"] == "operation" for s in steps), "inspections": sum(s["kind"] == "inspection" for s in steps), "handling": sum(s["kind"] == "handling" for s in steps), "man_hours": round(sum(s["man_hours"] for s in steps), 1)}
                plan = {**plan, "activities": [x for x in plan["activities"] if x != aid], "sections": [s for s in plan["sections"] if s.get("activity") != aid], "steps": steps, "packages": {k: v for k, v in (plan.get("packages") or {}).items() if k != aid}, "totals": totals}
                patch("plan", rec["id"], {"plan": plan, "rfi_drafts": [{**q, "activity": ""} if q.get("activity") == aid else q for q in rec.get("rfi_drafts") or []], "reviews": {k: v for k, v in (rec.get("reviews") or {}).items() if k != f"wp:{aid}"}}, who, "took a removed work package out of the work plan", aid)
        drop("activity", aid)
        log(who, "removed a work package", "activity", aid, a["name"])
        return {"removed": aid}


def change_package(pid: str, name: str, who: str = PM) -> dict:
    """A person renames a control account. The plan's own reading of it follows, so what it was priced at in the owner's estimate stays beside it."""
    with _lock:
        p = get("package", pid)
        if not p:
            raise KeyError(pid)
        name = (name or "").strip()
        if not name:
            raise ValueError("a control account needs a name")
        if name != p["name"]:
            patch("package", pid, {"name": name}, who, "renamed a control account", f"{p['name']} to {name}")
            for rec in all_of("plan"):
                if rec["status"] in ("pending", "approved") and any(x.get("name") == p["name"] for x in rec["plan"].get("accounts") or []):
                    patch("plan", rec["id"], {"plan": {**rec["plan"], "accounts": [{**x, "name": name} if x.get("name") == p["name"] else x for x in rec["plan"]["accounts"]]}}, who, "followed a renamed control account", name)
        return {"id": pid, "code": wbs_codes().get(pid, "")}


def remove_package(pid: str, who: str = PM) -> dict:
    """A person removes an empty control account, before a plan is approved: removing one renumbers the ones after it."""
    with _lock:
        p = get("package", pid)
        if not p:
            raise KeyError(pid)
        if plan_approved():
            raise ValueError(SHAPE_KEPT)
        if p["activities"] or p["boq"] or any(i["package"] == pid and i["status"] != "removed" for i in all_of("cost_item")):
            raise ValueError("move or remove its work packages and costs first")
        drop("package", pid)
        log(who, "removed a control account", "package", pid, p["name"])
        return {"removed": pid}


def changed_by_hand(since: str) -> int:
    """How many changes people made to the breakdown, the schedule and a plan's items since a time: what analysing the documents again would replace. One change can write many records, all in the same second, so it counts once."""
    with _lock:
        return _db().execute("select count(distinct t) from audit where t >= ? and who != ? and kind in ('activity', 'package', 'milestone', 'boq', 'plan')", (since, SWARM)).fetchone()[0]


# ------------------------------------------------------------------------------------------------ budget


def budget() -> dict:
    with _lock:  # read together: a plan being recorded adds a BoQ line and then names it on its package, and a package read after the lines would name one not among them
        boq = {b["id"]: b for b in all_of("boq")}
        packages = all_of("package")
    items = all_of("cost_item")
    live = {a["id"]: a for a in schedule()["activities"]} if any(b.get("activity") for b in boq.values()) else {}
    rows = []
    for p in packages:
        lines = [_live_line(boq[c], live) for c in p["boq"]]
        pv = sum(p["budget"] * b["value"] / (p["boq_value"] or 1) * b["planned_pct"] / 100 for b in lines)
        ev = sum(p["budget"] * b["value"] / (p["boq_value"] or 1) * b["verified_pct"] / 100 for b in lines)
        mine = [i for i in items if i["package"] == p["id"] and i["status"] != "removed"]
        ac = p["actual_cost"] + sum(i["amount"] for i in mine if i.get("actual"))
        extra = sum(i["amount"] for i in mine if not i.get("actual"))
        cpi = ev / ac if ac else 1.0
        eac = ac + (p["budget"] - ev) / (cpi or 1) + extra
        rows.append({"id": p["id"], "name": p["name"], "sub": p["sub"], "boq_value": p["boq_value"], "budget": p["budget"], "committed": p["committed"], "pv": round(pv), "ev": round(ev), "ac": ac, "recovery": extra, "eac": round(eac),
                     "variance": round(p["budget"] - eac), "cpi": round(cpi, 2), "spi": round(ev / pv, 2) if pv else 1.0})
    total = {k: sum(r[k] for r in rows) for k in ("boq_value", "budget", "committed", "pv", "ev", "ac", "recovery", "eac", "variance")}
    total.update(cpi=round(total["ev"] / total["ac"], 2) if total["ac"] else 1.0, spi=round(total["ev"] / total["pv"], 2) if total["pv"] else 1.0)
    return {"packages": rows, "total": total, "cost_items": [i for i in items if i["status"] != "removed"]}


def _live_line(b: dict, acts: dict[str, dict]) -> dict:
    """A BoQ line a person tied to an activity earns as that activity progresses. The scenario's lines keep their verified figures."""
    a = acts.get(b.get("activity") or "")
    return {**b, "planned_pct": expected_pct(a), "verified_pct": a["progress"]} if a else b


def expected_pct(a: dict) -> int:
    """How far an activity should be by today, if it runs evenly from start to finish."""
    elapsed = days_between(a["start"], TODAY)
    return max(0, min(100, round(100 * elapsed / max(1, a["duration"]))))


def add_cost_item(package: str, description: str, amount: int, recoverable_from: str = "", source: str = "", who: str = PM, actual: bool = False) -> dict:
    if not get("package", package):
        raise KeyError(package)
    rid = next_id("cost_item")
    return put("cost_item", rid, {"id": rid, "package": package, "description": description, "amount": int(amount), "recoverable_from": recoverable_from, "source": source, "status": "actual" if actual else "forecast", "actual": bool(actual), "added_on": TODAY},
               who, "recorded a cost" if actual else "added cost to the forecast", f"{description}: Rp {int(amount):,}")


def add_boq_line(name: str, unit: str, qty: float, unit_price: int, package: str, activity: str = "", area: str = "", who: str = PM, share: float = COST_SHARE) -> dict:
    p = get("package", package)
    if not p:
        raise KeyError(package)
    if activity and activity not in {a[0] for a in activity_rows()}:
        raise ValueError(f"no such activity: {activity}")
    if float(qty) <= 0 or int(unit_price) <= 0:
        raise ValueError("a BoQ line needs a quantity and a price above zero")
    value = round(float(qty) * int(unit_price))
    rid = next_id("boq")
    rec = put("boq", rid, {"id": rid, "code": rid, "name": name, "area": area, "unit": unit, "qty": float(qty), "unit_price": int(unit_price), "value": value, "planned_pct": 0, "verified_pct": 0, "activity": activity, "package": package, "share": share}, who, "added a BoQ line", f"{name}: Rp {value:,}")
    patch("package", package, {"boq": [*p["boq"], rid], "boq_value": p["boq_value"] + value, "budget": p["budget"] + round(value * share)}, who, "raised a package's budget", f"{rid}: Rp {round(value * share):,}")
    return rec


# ------------------------------------------------------------------------------------------------ subcontractors


def subcontractors() -> list[dict]:
    ncrs, rfis, invoices = all_of("ncr"), all_of("rfi"), all_of("invoice")
    acts = schedule()["activities"]
    out = []
    for s in all_of("subcontractor"):
        mine = [i for i in invoices if i["sub"] == s["id"]]
        expired = [d for d in s.get("documents", []) if d["expires"] and d["expires"] < TODAY]
        soon = [d for d in s.get("documents", []) if d["expires"] and TODAY <= d["expires"] <= (date.fromisoformat(TODAY) + timedelta(days=30)).isoformat()]
        missing = [n for n in REQUIRED_DOCS if not any(d["name"] == n for d in s.get("documents", []))]
        open_ncrs = [n for n in ncrs if n["by"] == s["id"] and n["status"] == "open"]
        over = [i for i in mine if i["certified_to_date"] + i["claimed"] > i["earned_to_date"] and i["status"] == "submitted"]
        rating = "watch" if expired or open_ncrs or over else "good"
        paid, pct = max((i["paid_to_date"] for i in mine), default=0), s.get("retention_pct", 5)
        out.append({**s, "invoices": mine, "activities": [a for a in acts if a["by"] == s["id"]], "open_ncrs": [n["id"] for n in open_ncrs], "ncrs_total": sum(1 for n in ncrs if n["by"] == s["id"]),
                    "open_rfis": [r["id"] for r in rfis if r["status"] == "open" and s["name"] == r.get("raised_by")], "expired": [d["name"] for d in expired], "expiring": [d["name"] for d in soon], "missing": missing,
                    "paid_to_date": paid, "retention_held": round(paid * pct / (100 - pct)), "rating": "new" if s["status"] == "onboarding" else rating})
    return out


def subcontractor_detail(sid: str) -> dict:
    """What an agent reads about one subcontractor: its record now."""
    s = next((x for x in subcontractors() if x["id"] == sid), None)
    if not s:
        return {"error": "no such subcontractor"}
    return {k: s[k] for k in ("id", "name", "trade", "scope", "crew", "status", "package", "activities", "open_ncrs", "open_rfis", "expired", "expiring", "rating")}


def add_subcontractor(name: str, trade: str, scope: str, crew: int, who: str = PM, contact: str = "", phone: str = "") -> dict:
    rid = "sub-" + hashlib.sha1(name.encode()).hexdigest()[:6]
    return put("subcontractor", rid, {"id": rid, "name": name, "trade": trade, "scope": scope, "crew": int(crew), "contact": contact, "phone": phone, "activities": [], "status": "onboarding", "package": "", "contract_value": 0, "retention_pct": 5, "documents": []},
               who, "started onboarding", name)


def set_subcontractor(sid: str, name: str | None = None, trade: str | None = None, scope: str | None = None, crew: int | None = None, contact: str | None = None, phone: str | None = None, who: str = PM) -> dict:
    """Correct a partner's details in the database. Work already given to them, and its history, does not move."""
    if not get("subcontractor", sid):
        raise KeyError(sid)
    changes = {k: v for k, v in (("name", name), ("trade", trade), ("scope", scope), ("contact", contact), ("phone", phone)) if v is not None}
    if "name" in changes and not changes["name"].strip():
        raise ValueError("a subcontractor needs a company name")
    if "trade" in changes and not changes["trade"].strip():
        raise ValueError("a subcontractor needs a trade")
    if crew is not None:
        if int(crew) < 0:
            raise ValueError("a crew cannot be negative")
        changes["crew"] = int(crew)
    if not changes:
        raise ValueError("nothing to change")
    return patch("subcontractor", sid, changes, who, "corrected a subcontractor", ", ".join(sorted(changes)))


SAMPLE_SUBCONTRACTORS = [
    ("PT Beton Karya (fictional)", "Concrete and structure", "Columns, beams and slabs", 24, "Andi Saputra", "0812-1001-2201", "active"),
    ("CV Bekisting Jaya (fictional)", "Formwork", "Formwork and scaffolding", 18, "Rina Marlina", "0812-1001-2202", "active"),
    ("PT Baja Nusantara (fictional)", "Steel and rebar", "Reinforcement cutting, bending and fixing", 16, "Joko Prasetyo", "0812-1001-2203", "active"),
    ("PT Arus Listrik (fictional)", "MEP", "Electrical, plumbing and HVAC first fix", 11, "Dewi Anggraini", "0812-1001-2204", "active"),
    ("CV Finishing Prima (fictional)", "Architecture and finishing", "Masonry, plaster, paint and ceilings", 14, "Bambang Sutrisno", "0812-1001-2205", "onboarding"),
]


def seed_sample_subcontractors(who: str = PM) -> list[dict]:
    """Sample partner companies so a new project has someone to give work to. Synthetic, marked in their names, and a person can edit or remove every one. Ones already in the database (same name) are left alone."""
    have = {x["name"] for x in all_of("subcontractor")}
    made = []
    for name, trade, scope, crew, contact, phone, status in SAMPLE_SUBCONTRACTORS:
        if name in have:
            continue
        docs = [{"name": d, "expires": "2027-12-31"} for d in REQUIRED_DOCS] if status == "active" else []
        row = add_subcontractor(name, trade, scope, crew, who, contact, phone)
        made.append(patch("subcontractor", row["id"], {"status": status, "documents": docs}, who, "loaded a sample partner", name))
    return made


def remove_subcontractor(sid: str, who: str = PM) -> dict:
    """Take a partner out of the database. Not while work is programmed to them, or money is on their record: reassign the work first, so nothing is left pointing at a company that is no longer there."""
    s = get("subcontractor", sid)
    if not s:
        raise KeyError(sid)
    busy = [a["id"] for a in schedule()["activities"] if a["by"] == sid]
    if busy:
        raise ValueError(f"cannot remove: work is programmed to them ({', '.join(busy)}). Give that work to someone else first")
    if any(i["sub"] == sid for i in all_of("invoice")):
        raise ValueError("cannot remove: invoices are recorded against them")
    if any(w.get("by") == sid and w["status"] not in ("done", "rejected", "superseded") for w in all_of("work_item")):
        raise ValueError("cannot remove: open cards on the board are theirs. Move them first")
    with _lock:
        _db().execute("delete from records where kind = 'subcontractor' and id = ?", (sid,))
        _db().commit()
    log(who, "removed a subcontractor", "subcontractor", sid, s["name"])
    return {"removed": sid, "name": s["name"]}


def add_sub_document(sid: str, name: str, expires: str, who: str = PM) -> dict:
    s = get("subcontractor", sid)
    if not s:
        raise KeyError(sid)
    docs = [d for d in s.get("documents", []) if d["name"] != name] + [{"name": name, "expires": expires}]
    return patch("subcontractor", sid, {"documents": docs}, who, "recorded a document", f"{name}, expires {expires}")


def approve_subcontractor(sid: str, who: str = PM) -> dict:
    row = next((x for x in subcontractors() if x["id"] == sid), None)
    if not row:
        raise KeyError(sid)
    problems = [f"missing {n}" for n in row["missing"]] + [f"{n} has expired" for n in row["expired"]]
    if problems:
        raise ValueError("cannot approve yet: " + "; ".join(problems))
    return patch("subcontractor", sid, {"status": "active"}, who, "approved the subcontractor")


def invoice_action(iid: str, action: str, who: str = PM) -> dict:
    i = get("invoice", iid)
    if not i:
        raise KeyError(iid)
    if action == "certify":
        if i["status"] != "submitted":
            raise ValueError("only a submitted invoice can be certified")
        allowed = max(0, min(i["claimed"], i["earned_to_date"] - i["certified_to_date"]))  # no more than the work verified
        return patch("invoice", iid, {"status": "certified", "certified": allowed, "certified_to_date": i["certified_to_date"] + allowed, "certified_on": TODAY}, who, "certified an invoice", f"claimed Rp {i['claimed']:,}, certified Rp {allowed:,}")
    if action == "pay":
        if i["status"] != "certified":
            raise ValueError("only a certified invoice can be paid")
        return patch("invoice", iid, {"status": "paid", "paid_on": TODAY, "paid_to_date": i["paid_to_date"] + round(i["certified"] * (1 - RETENTION))}, who, "recorded a payment", f"Rp {round(i['certified'] * (1 - RETENTION)):,} after retention")
    raise ValueError("unknown action")


# ------------------------------------------------------------------------------------------------ procurement, site, quality, RFIs


def po_action(pid: str, action: str, promised: str = "", supplier: str = "", who: str = PM) -> dict:
    p = get("po", pid)
    if not p:
        raise KeyError(pid)
    if action == "receive":
        return patch("po", pid, {"status": "received", "received_on": TODAY}, who, "recorded goods received")
    if action == "promise" and promised:
        return patch("po", pid, {"promised": promised, "status": "confirmed" if promised <= p["needed"] else p["status"]}, who, "updated the promised date", promised)
    if action == "assign" and supplier.strip():
        changes = {"supplier": supplier.strip(), "status": "confirmed" if promised and promised <= p["needed"] else "delay reported" if promised else "ordered"}
        return patch("po", pid, {**changes, **({"promised": promised} if promised else {})}, who, "placed an order", f"{p['item']} with {supplier.strip()}")
    raise ValueError("unknown action")


def add_order(item: str, supplier: str, activity: str, needed: str, promised: str = "", value: int = 0, package: str = "", who: str = PM) -> dict:
    live = {a["id"]: a for a in schedule()["activities"]}
    if activity and activity not in live:
        raise ValueError(f"no such activity: {activity}")
    rid = next_id("po")
    return put("po", rid, {"id": rid, "item": item, "supplier": supplier, "package": package or (live[activity]["package"] if activity else ""), "activity": activity, "needed": needed, "promised": promised, "status": "confirmed" if promised and promised <= needed else "ordered", "value": int(value), "received_on": "", "note": ""}, who, "placed an order", item)


def daily_reports(level: str | None = None) -> list[dict]:
    rows = all_of("daily_report")
    return [r for r in rows if not level or r["area"] == level]


def add_daily_report(fields: dict, who: str = PM) -> dict:
    rid = next_id("daily_report")
    rec = {"id": rid, "date": fields.get("date") or TODAY, "area": fields.get("area", ""), "author": fields.get("author") or person(who), "text": fields.get("text", ""), "package": fields.get("package", ""), "activity": fields.get("activity", ""), "items": [],
           "crew": fields.get("crew"), "weather": fields.get("weather", ""), "verified": False, "verified_by": "", "source": "site"}
    return put("daily_report", rid, rec, who, "filed a daily report", rec["text"][:120])


def verify_daily_report(rid: str, who: str = "Site engineer") -> dict:
    return patch("daily_report", rid, {"verified": True, "verified_by": person(who)}, who, "verified a daily report")


def quality() -> dict:
    subs = {s["id"]: s["name"] for s in all_of("subcontractor")}
    codes = wbs_codes()
    name = lambda r: {**r, "by_name": subs.get(r.get("by"), r.get("by", "")), "wbs": codes.get(r.get("activity") or "", "")}  # noqa: E731
    return {"inspections": [{**name(r), "checklist": r.get("checklist") or [], "photos": r.get("photos") or []} for r in all_of("inspection")], "ncrs": [name(r) for r in all_of("ncr")], "today": TODAY}


def checklist_of(criteria: str) -> list[dict]:
    """A criterion broken into what an inspector ticks off, one point at a time. Commas inside a number stay."""
    parts = [x.strip(" .") for x in re.split(r"[;,:]\s+", criteria or "") if x.strip(" .")]
    return [{"text": p, "ok": None} for p in parts]


def _finish_task(inspection: dict, who: str) -> None:
    """The inspection's result is what closes its card on the board."""
    for w in all_of("work_item"):
        if w.get("step") and w["step"] == inspection.get("step") and w.get("plan") == inspection.get("plan") and w["status"] in TASK_STATUS and w["status"] != "done":
            patch("work_item", w["id"], {"status": "done", "progress": 100, "done_on": TODAY}, who, "closed a task", f"{w['title']}, after {inspection['id']}")


def close_ncr(nid: str, action: str, who: str = PM) -> dict:
    n = get("ncr", nid)
    if not n:
        raise KeyError(nid)
    if n["status"] != "open":
        raise ValueError("only an open NCR can be closed")
    rec = patch("ncr", nid, {"status": "closed", "closed_on": TODAY, "action": action or n["action"]}, who, "closed an NCR", action)
    for i in all_of("inspection"):
        if i.get("ncr") == nid and i["status"] == "failed":
            _finish_task(patch("inspection", i["id"], {"status": "passed", "next": "", "date": TODAY}, who, "signed off an inspection", f"after {nid}"), who)
    return rec


def raise_ncr(title: str, by: str, activity: str, due: str, who: str = PM, inspection: str = "", photo: str = "") -> dict:
    rid = next_id("ncr", 15)
    return put("ncr", rid, {"id": rid, "title": title, "by": by, "activity": activity, "raised": TODAY, "due": due, "status": "open", "closed_on": "", "action": "", "inspection": inspection, "photo": photo}, who, "raised an NCR", title)


def add_inspection(title: str, activity: str, by: str, next_on: str, criteria: str = "", hold_point: bool = False, who: str = PM) -> dict:
    if activity and activity not in {a[0] for a in activity_rows()}:
        raise ValueError(f"no such activity: {activity}")
    rid = next_id("inspection")
    return put("inspection", rid, {"id": rid, "title": title, "activity": activity, "by": by, "date": "", "status": "planned", "next": next_on, "ncr": "", "hold_point": bool(hold_point), "criteria": criteria, "checklist": checklist_of(criteria)}, who, "planned an inspection", title)


def inspection_result(iid: str, result: str, checklist: list[dict] | None = None, note: str = "", photos: list[str] | None = None, who: str = PM) -> dict:
    """A person records what the inspection found. A pass closes its card and lets what waits for it go on. A fail raises an NCR, and what waits for it stays stopped until that closes."""
    i = get("inspection", iid)
    if not i:
        raise KeyError(iid)
    if i["status"] == "passed":
        raise ValueError("this inspection has already passed")
    if i["status"] == "failed" and i.get("ncr") and (get("ncr", i["ncr"]) or {}).get("status") == "open":
        raise ValueError(f"close {i['ncr']} first: closing it signs this inspection off")
    items = i.get("checklist") or [] if checklist is None else checklist
    evidence = {"checklist": items, "note": note, "photos": photos if photos is not None else i.get("photos") or []}
    if result == "pass":
        if any(c.get("ok") is False for c in items):
            raise ValueError("a point on the checklist failed, so record a fail")
        if any(c.get("ok") is None for c in items):
            raise ValueError("tick every point on the checklist first")
        rec = patch("inspection", iid, {**evidence, "status": "passed", "date": TODAY, "next": "", "signed_by": person(who)}, who, "passed an inspection", i["title"])
        _finish_task(rec, who)
        return rec
    if result == "fail":
        failed = [c["text"] for c in items if c.get("ok") is False]
        due = (date.fromisoformat(TODAY) + timedelta(days=2)).isoformat()
        ncr = raise_ncr(f"{i['title']}: {'; '.join(failed) or note or 'failed inspection'}", i.get("by", ""), i.get("activity", ""), due, who, iid)
        return patch("inspection", iid, {**evidence, "status": "failed", "date": TODAY, "next": "", "ncr": ncr["id"]}, who, "failed an inspection", ncr["id"])
    raise ValueError("result must be pass or fail")


def rfis() -> dict:
    rows = all_of("rfi")
    plan = {a["id"]: a for a in schedule()["activities"]}
    for r in rows:
        a = plan.get(r.get("activity") or "")
        r["activity_start"], r["critical"] = (a["start"], a["critical"]) if a else ("", False)
        r["overdue"] = r["status"] == "open" and bool(r.get("due")) and r["due"] < TODAY
    return {"today": TODAY, "rfis": sorted(rows, key=lambda x: x["id"], reverse=True), "counts": {s: sum(1 for r in rows if r["status"] == s) for s in ("draft", "open", "answered")}}


def add_rfi(fields: dict, status: str, who: str) -> dict:
    rid = next_id("rfi", 36)
    rec = {"raised_on": TODAY, "raised_by": "Main contractor", "ball_in_court": "" if status == "draft" else fields.get("to", ""), "due": "", "answer": "", "answered_on": "", "impact": "", "activity": "", **fields, "id": rid, "status": status}
    return put("rfi", rid, rec, who, "drafted an RFI" if status == "draft" else "issued an RFI", rec.get("subject", ""))


def issue_rfi(rid: str, who: str = PM) -> dict:
    r = get("rfi", rid)
    if not r:
        raise KeyError(rid)
    if r["status"] != "draft":
        raise ValueError("only a draft can be issued")
    return patch("rfi", rid, {"status": "open", "ball_in_court": r.get("to", ""), "issued_on": TODAY}, who, "issued an RFI", r.get("subject", ""))


def answer_rfi(rid: str, answer: str, who: str = PM) -> dict:
    r = get("rfi", rid)
    if not r:
        raise KeyError(rid)
    if r["status"] != "open":
        raise ValueError("only an open RFI can be answered")
    if not answer.strip():
        raise ValueError("an answer cannot be empty")
    return patch("rfi", rid, {"status": "answered", "answer": answer.strip(), "answered_on": TODAY, "ball_in_court": ""}, who, "recorded an RFI answer", answer.strip()[:120])


def documents(kind: str) -> dict:
    """What an agent reads: the static documents, and the live records as they stand now."""
    if kind == "rfi":
        return {"documents": [r for r in all_of("rfi") if r["status"] != "draft"]}
    docs = [dict(d) for d in C.DOCUMENTS if d["kind"] == kind]
    if kind == "inspection":
        ncr = get("ncr", "NCR-014") or {}
        for d in docs:
            if d["id"] == "DOC-ITP-07" and ncr.get("status") == "closed":
                d["text"] = f"NCR-014 was closed on {ncr['closed_on']}: {ncr.get('action', '')} The engineer has signed hold point HP-07, so concrete may be placed."
        return {"documents": docs, "open_ncrs": [n for n in all_of("ncr") if n["status"] == "open"], "inspections": [i for i in all_of("inspection") if i["status"] != "passed"]}
    if kind == "purchase_order":
        return {"documents": docs, "orders": all_of("po")}
    if kind == "manpower":
        return {"documents": docs, "crew_by_day": CREW, "crew_needed_for_the_pour": CREW_NEEDED}
    return {"documents": docs}


# ------------------------------------------------------------------------------------------------ claims and payments


def claim() -> dict | None:
    c = get("claim", "CL-07")
    if not c:
        return None
    lines = c["lines"]
    def worth(status: str) -> int:
        return sum(abs(x["recommended"] - x["amount"]) for x in lines if x["status"] == status)
    totals = {"claimed": sum(x["amount"] for x in lines), "recommended": sum(x["recommended"] for x in lines), "beyond_evidence": worth(reconcile.WEAK), "not_billed": worth(reconcile.UNBILLED), "billing_errors": worth(reconcile.BILLING),
              "site_checks": sum(1 for x in lines if x["status"] == reconcile.INSPECT), "supported": sum(1 for x in lines if x["status"] == reconcile.SUPPORTED)}
    basis = c["submitted"] or totals["recommended"]
    this = max(0, (c["certified"] or basis) - c["previous_certified"])
    return {**c, "totals": totals, "certificate": {"cumulative": c["certified"] or basis, "previous": c["previous_certified"], "this_period": this, "retention": round(this * RETENTION), "payable": round(this * (1 - RETENTION))}}


def claim_action(action: str, adjusted: bool = True, who: str = PM) -> dict:
    c = claim()
    if not c:
        raise KeyError("claim")
    if action == "submit":
        if c["status"] != "draft":
            raise ValueError("only a draft claim can be submitted")
        amount = c["totals"]["recommended"] if adjusted else c["totals"]["claimed"]
        patch("claim", "CL-07", {"status": "submitted", "submitted": amount, "submitted_on": TODAY, "adjusted": adjusted}, who, "submitted the progress claim", f"Rp {amount:,}, {'adjusted to the evidence' if adjusted else 'as drafted'}")
    elif action == "certify":
        if c["status"] != "submitted":
            raise ValueError("only a submitted claim can be certified")
        patch("claim", "CL-07", {"status": "certified", "certified": c["submitted"], "certified_on": TODAY}, who, "recorded the owner's certificate", f"Rp {c['submitted']:,}")
    elif action == "paid":
        if c["status"] != "certified":
            raise ValueError("only a certified claim can be paid")
        patch("claim", "CL-07", {"status": "paid", "paid_on": TODAY}, who, "recorded the owner's payment", f"Rp {c['certificate']['payable']:,} after retention")
    else:
        raise ValueError("unknown action")
    return claim()


# ------------------------------------------------------------------------------------------------ what code can see is wrong


ROUTE = {"quality": "quality/ncrs", "procurement": "procurement/orders", "schedule": "schedule/gantt", "rfis": "documents/rfis", "subcontractors": "procurement/subs", "claims": "cost/claims", "budget": "cost/control", "decisions": "kanban/board", "plans": "wbs/plan"}


def checks() -> list[dict]:
    """Inconsistencies between the records, found by plain rules: no model involved, so they are always on."""
    plan = schedule()
    acts = {a["id"]: a for a in plan["activities"]}
    pour = acts[C.POUR]["start"] if C.POUR in acts else ""
    out: list[dict] = []

    def add(rule: str, level: str, title: str, detail: str, tab: str, ref: str = "") -> None:
        out.append({"rule": rule, "level": level, "title": title, "detail": detail, "tab": tab, "ref": ref})

    for n in all_of("ncr"):
        if n["status"] != "open":
            continue
        a = acts.get(n.get("activity") or "")
        blocked = a and pour and pour <= (next((i["next"] for i in all_of("inspection") if i.get("ncr") == n["id"]), "") or "")
        add("open_ncr", "high" if blocked else "medium", f"{n['id']} is open: {n['title']}", f"Concrete cannot be placed on {pour} until it is closed and the hold point signed." if blocked else f"Due on {n['due']}.", "quality", n["id"])
    for p in all_of("po"):
        if p["status"] not in ("received", "cancelled") and p["promised"] > p["needed"]:
            a = acts.get(p.get("activity") or "")
            add("late_delivery", "high" if a and a["critical"] else "low", f"{p['id']} arrives after it is needed: {p['item']}", f"Needed on {p['needed']}, promised for {p['promised']}.", "procurement", p["id"])
    if CREW.get(pour, CREW_NEEDED) < CREW_NEEDED:
        add("crew_short", "high", f"Concrete crew is short on {pour}", f"{CREW[pour]} rostered, the pour needs at least {CREW_NEEDED}.", "schedule", C.POUR)
    if pour in RAINY:
        add("weather", "high", f"Rain is forecast on the pour date, {pour}", WEATHER[pour], "schedule", C.POUR)
    for r in all_of("rfi"):
        if r["status"] != "open":
            continue
        a = acts.get(r.get("activity") or "")
        if r["due"] and r["due"] < TODAY:
            add("rfi_overdue", "high", f"{r['id']} is overdue: {r['subject']}", f"{r['ball_in_court']} owed the answer by {r['due']}.", "rfis", r["id"])
        elif a and a["start"] <= r["due"]:
            add("rfi_after_start", "medium", f"{r['id']} is due only after {a['id']} starts: {r['subject']}", f"Answer due on {r['due']}, the activity starts on {a['start']}.", "rfis", r["id"])
        elif a and a["critical"]:
            add("rfi_critical", "medium", f"{r['id']} holds a critical activity: {r['subject']}", f"{r['ball_in_court']} owes the answer by {r['due']}, and {a['id']} starts on {a['start']} with no float.", "rfis", r["id"])
    for s in subcontractors():
        for d in s["expired"]:
            add("document_expired", "medium", f"{s['name']}: {d} has expired", "Renew it before more work is released.", "subcontractors", s["id"])
        for d in s["expiring"]:
            add("document_expiring", "low", f"{s['name']}: {d} expires soon", "Ask for the renewal now.", "subcontractors", s["id"])
    for i in all_of("invoice"):
        over = i["certified_to_date"] + i["claimed"] - i["earned_to_date"]
        if over > 0 and i["status"] == "submitted":
            name = next((s["name"] for s in all_of("subcontractor") if s["id"] == i["sub"]), i["sub"])
            add("invoice_over_earned", "medium", f"{name} has billed ahead of verified work", f"{i['id']} would take what is certified Rp {round(over):,} past the work verified.", "subcontractors", i["sub"])
    c = claim()
    if c and c["status"] == "draft" and (c["totals"]["beyond_evidence"] or c["totals"]["not_billed"]):
        t = c["totals"]
        add("claim_mismatch", "medium", "The draft progress claim does not match the site records", f"Rp {t['beyond_evidence']:,} claimed beyond the evidence, Rp {t['not_billed']:,} not billed yet, {t['site_checks']} lines need a site check.", "claims", c["id"])
    for p in budget()["packages"]:
        if p["variance"] < -0.01 * p["budget"]:
            add("over_budget", "medium", f"{p['name']} is forecast over budget", f"Rp {round(-p['variance']):,} over, with a cost index of {p['cpi']:.2f}.", "budget", p["id"])
    for w in all_of("work_item"):
        if w["status"] in ("open", "doing", "review") and w.get("due") and w["due"] < TODAY:
            add("work_item_overdue", "high", f"{w['id']} is overdue: {w['title']}", f"{w['owner']} owed it by {w['due']}.", "decisions", w["id"])
    live = {a["id"]: a for a in plan["activities"]}
    for r in all_of("plan"):
        if r["status"] != "approved":
            continue
        t, window = r["plan"]["totals"], sum(live[a]["duration"] for a in r["plan"]["activities"] if a in live)
        if window and t["days"] > window:
            add("plan_window", "medium", f"Work plan {r['title']} needs {t['days']} days, and the schedule now gives {window}", "Add crew or run the planning review again.", "plans", r["id"])
        for s in plan_view(r)["plan"]["steps"]:
            for line in (s.get("actual") or {}).get("lines", []):
                if line["over"]:
                    add("plan_over", "medium", f"{r['title']} {s['id']} used more {line['name'].lower()} than planned", f"{line['used']:,.1f} {line['unit']} against {line['planned']:,.1f}: {line['waste_pct']}% waste.", "plans", r["id"])
    for m in plan["milestones"]:
        if m["days_late"]:
            add("milestone_late", "high", f"Milestone {m['id']} is forecast {m['days_late']} days late", f"Due on {m['contract_date']}, forecast {m['forecast']}.", "schedule", m["activity"])
    rank = {"high": 0, "medium": 1, "low": 2}
    return sorted(({**x, "tab": ROUTE.get(x["tab"], x["tab"])} for x in out), key=lambda x: rank[x["level"]])


def overview() -> dict:
    plan = schedule()
    b = budget()
    subs = {s["id"]: s for s in subcontractors()}
    pos, ncrs, reports, rfi_rows, items = all_of("po"), all_of("ncr"), all_of("daily_report"), all_of("rfi"), all_of("work_item")
    c = claim()
    invoices = all_of("invoice")
    acts = plan["activities"]
    codes = wbs_codes()
    chain = []
    for row in b["packages"]:
        p = get("package", row["id"])
        s = subs.get(p["sub"] or "")
        my_acts = [a for a in acts if a["id"] in p["activities"]]
        next_act = next((a for a in sorted(my_acts, key=lambda x: x["start"]) if a["progress"] < 100), None)
        my_pos = [x for x in pos if x["package"] == p["id"] and x["status"] != "cancelled"]
        late = [x for x in my_pos if x["status"] != "received" and x["promised"] > x["needed"]]
        mine = [r for r in reports if r.get("package") == p["id"] or set(r.get("items") or []) & set(p.get("boq") or [])]
        unverified = [r for r in mine if not r["verified"]]
        open_ncr = [n for n in ncrs if n["status"] == "open" and (n["by"] == p["sub"] or n.get("activity") in p["activities"])]
        lines = [x for x in (c["lines"] if c else []) if x["package"] == p["id"]]
        off = [x for x in lines if x["status"] != "supported"]
        inv = next((i for i in invoices if i["sub"] == p["sub"]), None)
        over = inv and inv["status"] == "submitted" and inv["certified_to_date"] + inv["claimed"] > inv["earned_to_date"]
        open_rfi = [r for r in rfi_rows if r["status"] == "open" and r.get("activity") in p["activities"]]
        tasks = [w for w in items if w.get("physical") and w.get("activity") in p["activities"] and w["status"] in TASK_STATUS]
        done = sum(1 for w in tasks if w["status"] == "done")
        code = codes[p["id"]]
        chain.append({"id": p["id"], "name": p["name"], "code": code, "steps": [
            {"key": "wbs", "tab": f"wbs/tree:{code}", "tone": "ok" if my_acts else "none", "text": code, "sub": f"{len(my_acts)} activities"},
            {"key": "schedule", "tab": "schedule/gantt" + (f":{next_act['id']}" if next_act else ""), "tone": "warn" if next_act and next_act["critical"] else "ok", "text": next_act["id"] if next_act else "done", "sub": (next_act["start"][5:] + (" critical" if next_act["critical"] else "")) if next_act else ""},
            {"key": "cost", "tab": "cost/control", "tone": "bad" if row["variance"] < -0.01 * row["budget"] else "ok", "text": f"CPI {row['cpi']:.2f}", "sub": f"SPI {row['spi']:.2f}"},
            {"key": "documents", "tab": "documents/rfis", "tone": "warn" if open_rfi else "ok" if my_acts else "none", "text": f"{len(open_rfi)} RFI open" if open_rfi else "ready", "sub": open_rfi[0]["id"] if open_rfi else ""},
            {"key": "kanban", "tab": "kanban/board", "tone": "none" if not tasks else "ok" if done == len(tasks) else "warn" if unverified else "info", "text": f"{done} of {len(tasks)} done" if tasks else "no tasks", "sub": f"{len(unverified)} to verify" if unverified else f"{len(mine)} reports" if mine else ""},
            {"key": "inspection", "tab": "quality/ncrs", "tone": "bad" if open_ncr else "ok" if p["sub"] else "none", "text": f"{len(open_ncr)} NCR open" if open_ncr else "clear", "sub": ""},
            {"key": "procurement", "tab": "procurement/orders", "tone": "bad" if late else "ok" if my_pos else "none", "text": f"{len(late)} late" if late else f"{len(my_pos)} order{'s' if len(my_pos) != 1 else ''}" if my_pos else "no orders", "sub": ""},
            {"key": "subcontractor", "tab": "procurement/subs", "tone": "none" if not s else "warn" if s["rating"] == "watch" else "ok", "text": s["name"].replace(" (fictional)", "") if s else "Own crew", "sub": s["rating"] if s else ""},
            {"key": "claim", "tab": "cost/claims", "tone": "warn" if off else "ok" if lines else "none", "text": f"{len(off)} of {len(lines)} off" if off else f"{len(lines)} lines OK" if lines else "no claim", "sub": ""},
            {"key": "payment", "tab": "procurement/subs", "tone": "none" if not inv else "warn" if over else "ok", "text": (inv["status"] if inv else "n/a"), "sub": "billed ahead" if over else ""},
        ]})
    attention = checks()
    return {"today": TODAY, "project": C_PROJECT(), "milestone": plan["milestone"] or (plan["milestones"][0] if plan["milestones"] else None), "pour": next((a for a in acts if a["id"] == C.POUR), None), "kpis": {**b["total"], "contract": b["total"]["boq_value"]},
            "chain": chain, "attention": attention, "counts": {"open_rfis": sum(1 for r in rfi_rows if r["status"] == "open"), "draft_rfis": sum(1 for r in rfi_rows if r["status"] == "draft"), "open_ncrs": sum(1 for n in ncrs if n["status"] == "open"),
                                                                "open_work_items": sum(1 for w in items if w["status"] == "open"), "pending_decisions": sum(1 for d in all_of("decision") if d["status"] == "pending"), "pending_plans": sum(1 for p in all_of("plan") if p["status"] == "pending"), "draft_messages": sum(1 for m in all_of("message") if m["status"] == "draft")},
            "latest_decision": next((d for d in reversed(all_of("decision")) if d["status"] != "superseded"), None), "latest_plan": _plan_card(),
            "as_seeded": as_seeded()}


def _plan_card() -> dict | None:
    r = next((p for p in reversed(all_of("plan")) if p["status"] != "superseded"), None)
    return {k: r[k] for k in ("id", "title", "status", "mode")} | {"totals": r["plan"]["totals"], "open_checks": sum(1 for c in r["plan"]["checks"] if not c["ok"])} if r else None


def C_PROJECT() -> dict:
    info = meta("project_info")
    return info or json.loads((generator.ensure() / "project.json").read_text(encoding="utf-8"))


# ------------------------------------------------------------------------------------------------ decisions: proposals become real only here


def effects_of(option: str) -> list[str]:
    o, e = C.OPTIONS[option], C.evaluate(option)
    out = [f"The pour moves to {e['pour_on']}." if o["pour_delay_days"] else f"The pour stays on {e['pour_on']}."]
    for aid, days in o["compress"].items():
        out.append(f"{aid} is shortened by {days} day.")
    out.append(f"Milestone M1 is forecast for {e['milestone_forecast']}, {e['days_late']} days late." if e["days_late"] else f"Milestone M1 stays on {e['milestone_forecast']}.")
    out.append(f"Rp {e['total_cost_rp']:,} goes into the cost forecast.")
    return out


def record_review(run_id: str, firm: Any, mode: str) -> dict | None:
    """A finished review leaves a decision for a person, its work items as proposals and its messages as drafts. Nothing else changes."""
    if not firm.rulings:
        return None
    for old in all_of("decision"):
        if old["status"] == "pending":
            patch("decision", old["id"], {"status": "superseded"}, SWARM, "superseded a pending decision", f"by the review {run_id}")
            for w in all_of("work_item"):
                if w.get("decision") == old["id"] and w["status"] == "proposed":
                    patch("work_item", w["id"], {"status": "superseded"}, SWARM, "closed a superseded proposal", w["title"])
            for m in all_of("message"):
                if m.get("decision") == old["id"] and m["status"] == "draft":
                    patch("message", m["id"], {"status": "superseded"}, SWARM, "closed a superseded draft", f"to {m['to']}")
    did = f"DEC-{run_id[-6:]}"
    options = [{"id": k, "name": C.OPTIONS[k]["name"], "verdict": r["verdict"], "reason": r["reason"], "evidence": r["evidence"], "evaluation": r["evaluation"], "effects": effects_of(k), "attack": firm.attacks.get(k)}
               for k, r in sorted(firm.rulings.items())]
    rec = {"id": did, "run": run_id, "mode": mode, "title": "Recovery plan: Level 3 pour", "status": "pending", "recommended": firm.chosen, "options": options, "report": firm.report, "created": time.strftime("%Y-%m-%d %H:%M"), "decided_by": "", "decided_at": "", "note": "", "option": "", "effects": []}
    put("decision", did, rec, SWARM, "asked for a decision", f"recommends {firm.chosen}" if firm.chosen else "no option stands")
    for w in firm.proposed:
        rid = next_id("work_item")
        put("work_item", rid, {"id": rid, **w, "status": "proposed", "decision": did, "run": run_id, "created": TODAY, "done_on": ""}, SWARM, "proposed a work item", w["title"])
    for d in firm.drafts:
        rid = next_id("message")
        put("message", rid, {"id": rid, "channel": d["channel"], "to": d["to"], "text": d["text"], "agent": d["agent"], "status": "draft", "decision": did, "run": run_id, "decided_by": ""}, SWARM, "drafted a message", f"to {d['to']}")
    return rec


COST_PACKAGE = {"concrete_crew_standby_per_day": ("WP-CON", "Concrete crew standby", "the supplier, under PO clause 9"), "pump_standby_per_day": ("WP-CON", "Pump standby", "the supplier, under PO clause 9"),
                "backup_concrete_premium": ("WP-CON", "Backup concrete premium", ""), "formwork_night_shift_one_day_saved": ("WP-STR", "Formwork night shift", "")}


def decide(did: str, verdict: str, option: str = "", note: str = "", who: str = PM) -> dict:
    d = get("decision", did)
    if not d:
        raise KeyError(did)
    if d["status"] != "pending":
        raise ValueError("this decision has already been made")
    if verdict not in ("approve", "reject"):
        raise ValueError("verdict must be approve or reject")
    items = [w for w in all_of("work_item") if w.get("decision") == did]
    if verdict == "reject":
        for w in items:
            patch("work_item", w["id"], {"status": "rejected"}, who, "rejected a proposed work item", "with the plan")
        return patch("decision", did, {"status": "rejected", "decided_by": person(who), "decided_at": time.strftime("%Y-%m-%d %H:%M"), "note": note}, who, "rejected the recovery plan", note)
    chosen = option or d.get("recommended") or ""
    if chosen not in C.OPTIONS:
        raise ValueError("choose an option")
    o, e = C.OPTIONS[chosen], C.evaluate(chosen)
    state = schedule_state()
    # this plan replaces the one approved before it: its compression and its cost come out first
    earlier = [x for x in all_of("decision") if x["status"] == "approved"]
    for x in earlier:
        for aid in C.OPTIONS[x["option"]]["compress"]:
            state["compress"].pop(aid, None)
        patch("decision", x["id"], {"status": "superseded"}, who, "replaced an approved plan", f"by {did}")
    for i in all_of("cost_item"):
        if i["status"] != "removed" and any(i.get("source", "").startswith(x["id"] + ",") for x in earlier):
            patch("cost_item", i["id"], {"status": "removed"}, who, "took a replaced plan's cost out of the forecast", f"{i['description']}: Rp {i['amount']:,}")
    state["pour_delay_days"] = o["pour_delay_days"]
    state["compress"] = {**state.get("compress", {}), **o["compress"]}
    set_meta("schedule_state", state)
    log(who, "moved the schedule", "activity", C.POUR, f"pour {e['pour_on']}; {', '.join(f'{k} shortened {v} day' for k, v in o['compress'].items()) or 'no compression'}")
    source = f"{did}, option {chosen}"
    for key, amount in e["cost_lines"].items():
        package, label, recover = COST_PACKAGE.get(key, ("WP-CON", key, ""))
        add_cost_item(package, label, amount, recover, source, who)
    if e["liquidated_damages_rp"]:
        add_cost_item("WP-CON", f"Liquidated damages, {e['days_late']} days", e["liquidated_damages_rp"], "", source, who)
    uses_usual = chosen in ("O1", "O3", "O4")
    if uses_usual:
        po = get("po", "PO-118")
        if po and po["status"] != "received":
            patch("po", "PO-118", {"needed": e["pour_on"], "promised": e["pour_on"], "status": "confirmed", "note": f"Re-programmed by {did}."}, who, "re-programmed an order", f"delivery on {e['pour_on']}")
        pump = get("po", "PO-119")
        if pump and pump["status"] != "received":
            patch("po", "PO-119", {"needed": e["pour_on"], "promised": e["pour_on"], "note": f"Moved by {did}."}, who, "re-programmed an order", f"pump on {e['pour_on']}")
    for w in items:
        patch("work_item", w["id"], {"status": "open"}, who, "opened a work item", w["title"])
    effects = effects_of(chosen) + [f"{len(items)} work items opened."]
    return patch("decision", did, {"status": "approved", "option": chosen, "decided_by": person(who), "decided_at": time.strftime("%Y-%m-%d %H:%M"), "note": note, "effects": effects}, who, "approved the recovery plan", f"option {chosen}. {note}".strip())


def message_action(mid: str, action: str, who: str = PM) -> dict:
    m = get("message", mid)
    if not m:
        raise KeyError(mid)
    if m["status"] != "draft":
        raise ValueError("this message has already been decided")
    if action == "approve":  # a demo connector is all there is so far, so nothing leaves this machine
        return patch("message", mid, {"status": "approved", "decided_by": person(who)}, who, "approved a message", f"to {m['to']} over {m['channel']} (demo connector: not really sent)")
    if action == "reject":
        return patch("message", mid, {"status": "rejected", "decided_by": person(who)}, who, "rejected a message", f"to {m['to']}")
    raise ValueError("unknown action")


def add_work_item(title: str, owner: str, due: str, activity: str = "", who: str = PM, **extra: Any) -> dict:
    rid = next_id("work_item")
    return put("work_item", rid, {**extra, "id": rid, "title": title, "owner": owner, "due": due, "why": extra.get("why", ""), "activity": activity, "status": "open", "decision": "", "run": "", "created": TODAY, "done_on": "", "proposed_by": extra.get("proposed_by", who), "progress": 0}, who, "opened a work item", title)


def stops_of(w: dict, rec: dict | None = None, steps: dict[str, dict] | None = None) -> list[dict]:
    """What a rule says must clear before this task can go on: a hold point not signed, or an inspection that failed, anywhere upstream of it.
    A caller going through a whole board passes the task's plan and its steps, read once: a package's plan runs to megabytes."""
    if rec is None or rec.get("id") != w.get("plan"):
        rec, steps = get("plan", w.get("plan") or ""), None
    if not rec:
        return []
    steps = steps if steps is not None else {s["id"]: s for s in rec["plan"]["steps"]}
    seen: set[str] = set()
    stack = list(steps.get(w.get("step"), {}).get("after") or [])
    while stack:
        a = stack.pop()
        if a not in seen and a in steps:
            seen.add(a)
            stack += steps[a]["after"]
    out = []
    for sid in sorted(seen):
        s = steps[sid]
        i = get("inspection", s.get("itp") or sid) if s["kind"] == "inspection" else None
        if i and i["status"] == "failed":
            out.append({"kind": "failed", "ref": i.get("ncr") or i["id"], "text": f"{i['id']} failed: {i.get('ncr') or 'its NCR'} must close first", "go": f"quality/ncrs:{i.get('ncr') or ''}"})
        elif i and s["hold_point"] and i["status"] != "passed":
            out.append({"kind": "hold", "ref": i["id"], "text": f"Hold point {i['id']} is not signed: work stops until it is", "go": f"quality/inspections:{i['id']}"})
    return out


def unfinished_prerequisites(w: dict) -> list[dict]:
    """The steps this card directly waits for that are not done yet. The board shows them as a warning; moving the card is where they bite. An inspection step counts as done when its result is passed, whether or not its card was dragged."""
    rec = get("plan", w.get("plan") or "")
    if not rec or not w.get("step"):
        return []
    steps = {s["id"]: s for s in rec["plan"]["steps"]}
    step = steps.get(w["step"]) or {}
    cards = {(x.get("plan"), x.get("step")): x for x in all_of("work_item")}
    out = []
    for sid in step.get("after") or []:
        s = steps.get(sid) or {}
        card = cards.get((w["plan"], sid))
        insp = get("inspection", s.get("itp") or sid) if s.get("kind") == "inspection" else None
        if insp and insp["status"] == "passed":
            continue
        if card and card["status"] == "done":
            continue
        if card is None and insp is None:
            continue  # the step it waits for is not on the board: nothing here to wait for
        out.append({"step": sid, "card": card["id"] if card else "", "title": card["title"] if card else s.get("name", sid)})
    return out


def set_work_item(wid: str, status: str = "", owner: str | None = None, due: str | None = None, progress: int | None = None, by: str | None = None, who: str = PM) -> dict:
    """A person moves or assigns a card. Dragging cannot sign anything: an inspection closes when its result is recorded, and a hold point stops what follows it."""
    w = get("work_item", wid)
    if not w:
        raise KeyError(wid)
    if w["status"] not in TASK_STATUS:
        raise ValueError("this is a proposal: it opens when the plan it belongs to is approved")
    changes: dict[str, Any] = {}
    notes = []
    if status and status != w["status"]:
        if status not in TASK_STATUS:
            raise ValueError("status must be open, doing, review or done")
        if w.get("kind") == "inspection" and status == "done":
            raise ValueError("record the result in QA/QC: that is what closes an inspection")
        if status != "open" and (stops := stops_of(w)):
            raise ValueError(stops[0]["text"])
        if status in ("doing", "review", "done") and (prereq := unfinished_prerequisites(w)):
            first = prereq[0]
            raise ValueError(f"cannot start: {first['step']} must be done first: {first['title']}" + (f" (and {len(prereq) - 1} more)" if len(prereq) > 1 else ""))
        changes.update(status=status, done_on=TODAY if status == "done" else "")
        changes["progress"] = 100 if status in ("review", "done") else 0 if status == "open" else w.get("progress") or 0
        notes.append(f"to {status}")
    if owner is not None:
        changes["owner"] = owner
        notes.append(f"assigned to {owner}")
    if by is not None:
        changes["by"] = by
    if due is not None:
        changes.update(due=due, due_set=True)
        notes.append(f"due {due}")
    if progress is not None:
        changes["progress"] = max(0, min(100, int(progress)))
        notes.append(f"{changes['progress']}%")
    return patch("work_item", wid, changes, who, "updated a task", f"{w['title']}: {', '.join(notes)}") if changes else w


# ------------------------------------------------------------------------------------------------ the risk register

RISK_CATEGORIES = ("Schedule", "Cost", "Quality", "Safety", "Procurement & materials", "Documents & technical", "Subcontractors", "Commercial", "External", "General")
RISK_STATUS = ("open", "mitigating", "monitoring", "closed", "occurred")
RISK_STRATEGIES = ("Avoid", "Mitigate", "Transfer", "Accept", "Escalate")


def _score(probability: int, impact: int) -> tuple[int, int]:
    try:
        p, i = int(probability), int(impact)
    except (TypeError, ValueError) as e:
        raise ValueError("probability and impact must be whole numbers from 1 to 5") from e
    if not 1 <= p <= 5 or not 1 <= i <= 5:
        raise ValueError("probability and impact must be whole numbers from 1 to 5")
    return p, i


def add_risk(title: str, category: str = "General", detail: str = "", activity: str = "", probability: int = 3, impact: int = 3, owner: str = "", strategy: str = "Mitigate", response: str = "", due: str = "", who: str = PM) -> dict:
    """A person puts a risk on the register. Code only checks the shape: the scoring is the person's judgement."""
    if not str(title).strip():
        raise ValueError("a risk needs a title")
    if category not in RISK_CATEGORIES:
        raise ValueError(f"category must be one of: {', '.join(RISK_CATEGORIES)}")
    if strategy not in RISK_STRATEGIES:
        raise ValueError(f"strategy must be one of: {', '.join(RISK_STRATEGIES)}")
    p, i = _score(probability, impact)
    rid = next_id("risk")
    return put("risk", rid, {"id": rid, "title": str(title).strip(), "category": category, "detail": str(detail), "activity": activity, "probability": p, "impact": i, "owner": owner, "strategy": strategy, "response": str(response), "due": due, "status": "open", "created": TODAY, "created_by": who}, who, "added a risk to the register", str(title).strip())


def set_risk(rid: str, probability: int | None = None, impact: int | None = None, owner: str | None = None, strategy: str | None = None, response: str | None = None, due: str | None = None, status: str | None = None, who: str = PM) -> dict:
    """A person re-scores a registered risk, assigns it, or moves its response along."""
    r = get("risk", rid)
    if not r:
        raise KeyError(rid)
    changes: dict[str, Any] = {}
    if probability is not None or impact is not None:
        p, i = _score(r["probability"] if probability is None else probability, r["impact"] if impact is None else impact)
        changes.update(probability=p, impact=i)
    if strategy is not None:
        if strategy not in RISK_STRATEGIES:
            raise ValueError(f"strategy must be one of: {', '.join(RISK_STRATEGIES)}")
        changes["strategy"] = strategy
    if status is not None:
        if status not in RISK_STATUS:
            raise ValueError(f"status must be one of: {', '.join(RISK_STATUS)}")
        changes["status"] = status
    for key, value in (("owner", owner), ("response", response), ("due", due)):
        if value is not None:
            changes[key] = value
    return patch("risk", rid, changes, who, "updated a risk", r["title"]) if changes else r


# ------------------------------------------------------------------------------------------------ work plans: a consultant's documents into a WBS a person approves


MATERIAL_PACKAGE = {"rebar": "WP-REB", "tie_wire": "WP-REB", "cement": "WP-CON", "sand": "WP-CON", "gravel": "WP-CON", "water": "WP-CON"}


def plan_documents(kinds: list[str] | None = None) -> list[dict]:
    """The planning package: the consultant's documents as an agent reads them."""
    return [{k: d[k] for k in ("id", "kind", "title", "from", "date", "text")} for d in PC.documents(kinds)]


def record_plan(run_id: str, firm: Any, mode: str) -> dict | None:
    """A finished planning review leaves a chart for a person to approve, and its work items as proposals. Nothing else changes."""
    if not firm.result or not firm.result["steps"]:
        return None
    for old in all_of("plan"):
        if old["status"] == "pending":
            patch("plan", old["id"], {"status": "superseded"}, SWARM, "superseded a pending work plan", f"by the review {run_id}")
            for w in all_of("work_item"):
                if w.get("decision") == old["id"] and w["status"] == "proposed":
                    patch("work_item", w["id"], {"status": "superseded"}, SWARM, "closed a superseded proposal", w["title"])
    pid = f"WBS-{run_id[-6:]}"
    rec = {"id": pid, "run": run_id, "mode": mode, "title": firm.result["title"], "status": "pending", "plan": firm.result, "findings": firm.findings(), "attacks": firm.attacks, "report": firm.report, "summary": firm.summary, "rfi_drafts": firm.rfi_drafts, "created": time.strftime("%Y-%m-%d %H:%M"),
           "decided_by": "", "decided_at": "", "note": "", "effects": [], "actuals": {}}
    put("plan", pid, rec, SWARM, "asked for a decision on a work plan", f"{firm.result['totals']['steps']} steps")
    for w in firm.proposed:
        rid = next_id("work_item")
        put("work_item", rid, {"id": rid, **w, "status": "proposed", "decision": pid, "run": run_id, "created": TODAY, "done_on": ""}, SWARM, "proposed a work item", w["title"])
    return rec


def drop(kind: str, rid: str) -> None:
    with _lock:
        _db().execute("delete from records where kind = ? and id = ?", (kind, rid))
        _db().commit()


def _clear_breakdown() -> None:
    """A project's breakdown before a plan is approved, so the agents' proposal does not sit on top of placeholders."""
    for kind in ("milestone", "boq", "activity", "package"):
        for r in all_of(kind):
            drop(kind, r["id"])
    set_meta("schedule_state", {"pour_delay_days": 0, "compress": {}})
    set_meta("progress", {})


def has_started() -> bool:
    return any(w["status"] in TASK_STATUS and w.get("plan") for w in all_of("work_item"))


def record_package_plan(run_id: str, firm: Any, mode: str) -> dict | None:
    """A finished analysis of a real package puts its WBS on the project, so a person can read it in every tab before deciding. It is still a proposal: no task reaches the board until it is approved, and rejecting takes it all away again."""
    result = firm.result
    if not result:
        return None
    if has_started():
        raise ValueError("this project already has an approved plan with work on the board")
    for old in all_of("plan"):
        if old["status"] == "pending":
            patch("plan", old["id"], {"status": "superseded"}, SWARM, "superseded a pending work plan", f"by the review {run_id}")
            _drop_drafts(old["id"])
    _clear_breakdown()
    ids: dict[str, str] = {}
    for account in result["accounts"]:
        p = add_package(account["name"], "", 0, SWARM)
        for w in account["packages"]:
            aid = next_id("activity")
            ids[w["no"]] = aid
            put("activity", aid, {"id": aid, "name": w["name"], "duration": max(1, int(w["days"])), "predecessors": [], "by": "self", "not_before": int(w["not_before"]), "contract_weeks": bool(w.get("contract_weeks")), "no": w["no"], "weight": w["weight"], "value": w["value"], "responsible": (result["packages"].get(w["no"]) or {}).get("responsible") or ""}, SWARM, "proposed a work package", w["name"])
            p = patch("package", p["id"], {"activities": [*p["activities"], aid]}, SWARM, "proposed a work package under a control account", aid)
            if w["value"]:
                add_boq_line(w["name"], "ls", 1, int(w["value"]), p["id"], aid, "", SWARM, share=1.0)
                p = get("package", p["id"])
    for link in result["links"]:
        a = get("activity", ids[link["after"]])
        tie = {"overlaps": {**(a.get("overlaps") or {}), ids[link["before"]]: link["beside"]}} if "beside" in link else {"leads": {**(a.get("leads") or {}), ids[link["before"]]: link["lead"]}}
        patch("activity", a["id"], {"predecessors": [*a["predecessors"], ids[link["before"]]], **tie}, SWARM, "linked work packages", f"{link['before']} before {link['after']}")
    last = max(ids.values(), key=lambda x: (get("activity", x)["not_before"] + get("activity", x)["duration"]), default=None)
    if last and result.get("contract_days"):
        add_milestone("Completion, as the contract requires", last, (date.fromisoformat(project_start()) + timedelta(days=int(result["contract_days"]) - 1)).isoformat(), SWARM, whole_job=True)
    pid = f"WBS-{run_id[-6:]}"
    hurried = {a["id"]: a["critical"] for a in schedule()["activities"]}  # a task on its package's longest chain has no float only if the package has none
    plan = {**result, "activities": [ids[x] for x in result["activities"]], "sections": [{**s, "activity": ids[s["activity"]]} for s in result["sections"]], "steps": [{**s, "activity": ids[s["activity"]], "critical": bool(s["critical"] and hurried.get(ids[s["activity"]]))} for s in result["steps"]], "packages": {ids[k]: {**v, "no": k} for k, v in result["packages"].items()}}
    rec = {"id": pid, "run": run_id, "mode": mode, "title": result["title"], "status": "pending", "plan": plan, "findings": firm.findings(), "attacks": {}, "report": firm.report, "summary": firm.summary, "rfi_drafts": firm.rfi_drafts, "usd": round(firm.spent, 4), "created": time.strftime("%Y-%m-%d %H:%M"), "decided_by": "", "decided_at": "", "note": "", "effects": [], "actuals": {}}
    put("plan", pid, rec, SWARM, "asked for a decision on a work plan", f"{result['totals']['steps']} tasks")
    for q in firm.rfi_drafts:
        add_rfi({"subject": q["subject"], "question": q["question"], "to": q["to"], "activity": ids.get(q.get("activity") or "", ""), "activities": [ids[x] for x in q.get("activities") or [] if x in ids], "level": q.get("level") or "", "impact": q.get("impact") or "", "drafted_by": "RFI coordinator" if q.get("level") else "Planner", "plan": pid}, "draft", SWARM)
    return rec


def _drop_drafts(pid: str) -> None:
    for r in all_of("rfi"):
        if r.get("plan") == pid and r["status"] == "draft":
            drop("rfi", r["id"])


def plan_view(rec: dict) -> dict:
    """A plan with what has really happened beside it: actuals against the plan, worked out by code."""
    actuals = rec.get("actuals") or {}
    done, planned_waste, actual_waste, planned_hours, actual_hours = 0, 0, 0, 0.0, 0.0
    steps = []
    for s in sorted(rec["plan"]["steps"], key=lambda x: x["seq"]):
        a = actuals.get(s["id"])
        row = dict(s)
        if a:
            done += 1
            planned_hours += s["man_hours"]
            actual_hours += a.get("man_hours") or 0
            used = a.get("materials") or {}
            lines = []
            for m in s["materials"]:
                got = used.get(m["key"])
                if got is None:
                    planned_waste += m["waste_cost"]
                    actual_waste += m["waste_cost"]
                    continue
                waste = got - m["net"]
                planned_waste += m["waste_cost"]
                actual_waste += round(waste * m["rate"])
                lines.append({"key": m["key"], "name": m["name"], "unit": m["unit"], "used": got, "planned": m["gross"], "waste": round(waste, 3), "waste_pct": round(waste / m["net"] * 100, 1) if m["net"] else 0, "over": got > m["gross"]})
            row["actual"] = {**a, "lines": lines}
        steps.append(row)
    under = {x["id"]: x.get("activity", "") for x in PC.SCOPE["sections"]}
    sections = [{**x, "activity": x.get("activity") or under.get(x["id"], "")} for x in rec["plan"]["sections"]]
    tree = W.code_tasks(steps, sections, rec["plan"]["activities"], activity_heads(rec["plan"]["activities"]))
    plan = {**rec["plan"], "steps": steps, "sections": sections, "tree": tree}
    return {**rec, "plan": plan, "edits": changed_by_hand(rec.get("created") or "") if rec["status"] == "pending" else 0, "work_items": [w for w in all_of("work_item") if w.get("decision") == rec["id"]], "progress": {"done": done, "of": len(steps), "planned_waste": planned_waste, "actual_waste": actual_waste, "planned_man_hours": round(planned_hours, 1), "actual_man_hours": round(actual_hours, 1)}}


def plans() -> list[dict]:
    return [plan_view(r) for r in reversed(all_of("plan"))]


def plan_by_id(pid: str) -> dict:
    rec = get("plan", pid)
    if not rec:
        raise KeyError(pid)
    return rec


def review_plan(pid: str, keys: list[str], verdict: str, note: str = "", who: str = PM) -> dict:
    """A person's decision on items of a proposal, one or a whole section, before the plan as a whole is decided. Clearing takes a decision back. A rejected work package gets no tasks when the plan is approved, and a rejected question is not kept as a draft. Each decision stays on the plan, so what was approved can be traced to who decided it."""
    rec = plan_by_id(pid)
    if rec["status"] != "pending":
        raise ValueError("this plan has already been decided")
    if verdict not in ("approve", "reject", "clear"):
        raise ValueError("verdict must be approve, reject or clear")
    if not keys:
        raise ValueError("nothing to decide on")
    reviews = dict(rec.get("reviews") or {})
    now = time.strftime("%Y-%m-%d %H:%M")
    for key in keys:
        if verdict == "clear":
            reviews.pop(key, None)
        else:
            reviews[key] = {"verdict": verdict, "who": who, "at": now, "note": note}
    return patch("plan", pid, {"reviews": reviews}, who, f"reviewed {_many_items(len(keys))} of the work plan", f"{verdict}: {', '.join(keys[:6])}{' and more' if len(keys) > 6 else ''}")


def _many_items(n: int) -> str:
    return f"{n} item" if n == 1 else f"{n} items"


def edit_plan_item(pid: str, key: str, text: str, who: str = PM) -> dict:
    """A person corrects what the agents wrote, on a proposal: who answers for a work package (wp:AC-001), or the wording of a drafted question (q:3). The first goes to the schedule and the board, and the second to the draft a person will issue."""
    rec = plan_by_id(pid)
    if rec["status"] != "pending":
        raise ValueError("this plan has already been decided")
    text = (text or "").strip()
    if not text:
        raise ValueError("it cannot be left empty")
    kind, _, ref = key.partition(":")
    if kind == "wp":
        if ref not in (rec["plan"].get("packages") or {}):
            raise KeyError(key)
        patch("activity", ref, {"responsible": text}, who, "corrected who answers for a work package", text)
        packages = {**rec["plan"]["packages"], ref: {**rec["plan"]["packages"][ref], "responsible": text}}
        return patch("plan", pid, {"plan": {**rec["plan"], "packages": packages}}, who, "corrected the work plan", key)
    if kind == "q" and ref.isdigit() and int(ref) < len(rec.get("rfi_drafts") or []):
        drafts = list(rec["rfi_drafts"])
        old = drafts[int(ref)]
        drafts[int(ref)] = {**old, "question": text}
        for r in all_of("rfi"):
            if r.get("plan") == pid and r["status"] == "draft" and r.get("subject") == old["subject"] and r.get("question") == old["question"]:
                patch("rfi", r["id"], {"question": text}, who, "reworded a drafted question", old["subject"])
        return patch("plan", pid, {"rfi_drafts": drafts, "report": rec.get("report", "").replace(old["question"], text)}, who, "corrected the work plan", key)
    raise KeyError(key)


def decide_plan(pid: str, verdict: str, note: str = "", who: str = PM) -> dict:
    """Approving is what makes a plan real: its tasks go on the Kanban board, its inspections to QA/QC, its material to Procurement, and the board's progress drives the schedule from then on."""
    rec = plan_by_id(pid)
    if rec["status"] != "pending":
        raise ValueError("this plan has already been decided")
    if verdict not in ("approve", "reject"):
        raise ValueError("verdict must be approve or reject")
    items = [w for w in all_of("work_item") if w.get("decision") == pid]
    now = time.strftime("%Y-%m-%d %H:%M")
    if verdict == "reject":
        for w in items:
            patch("work_item", w["id"], {"status": "rejected"}, who, "rejected a proposed work item", "with the plan")
        if rec["plan"].get("kind") == "package":
            _clear_breakdown()
            _drop_drafts(pid)
        return patch("plan", pid, {"status": "rejected", "decided_by": person(who), "decided_at": now, "note": note}, who, "rejected the work plan", note)
    plan = plan_view(rec)["plan"]
    for old in all_of("plan"):
        if old["status"] == "approved":
            patch("plan", old["id"], {"status": "superseded"}, who, "replaced an approved work plan", f"by {pid}")
            for w in all_of("work_item"):
                if w.get("plan") == old["id"] and w["status"] != "done":
                    patch("work_item", w["id"], {"status": "superseded"}, who, "closed a task of the replaced plan", w["title"])
            for o in all_of("po"):
                if o.get("plan") == old["id"] and o["status"] == "requested":
                    patch("po", o["id"], {"status": "cancelled"}, who, "cancelled a request of the replaced plan", o["item"])
    for w in items:
        patch("work_item", w["id"], {"status": "open"}, who, "opened a work item", w["title"])
    live = {a["id"]: a for a in schedule()["activities"]}
    first = next((live[a] for a in plan["activities"] if a in live), None)
    start = first["start"] if first else TODAY
    hours = plan["totals"]["hours_per_oh"]
    own = plan.get("anchor") == "activity"  # a package's tasks are placed within their own work package, and the others from the plan's first activity
    on_day = lambda at, s=None: (date.fromisoformat((live.get(s["activity"]) or {}).get("start", start) if own and s else start) + timedelta(days=int(max(0, at) // hours))).isoformat()  # noqa: E731
    subs = {s["id"]: s["name"] for s in all_of("subcontractor")}
    reviews = rec.get("reviews") or {}
    refused = {k[3:] for k, v in reviews.items() if k.startswith("wp:") and v["verdict"] == "reject"}  # the person said no to these: they stay in the schedule the consultant wrote, with no tasks on the board
    plan = {**plan, "steps": [s for s in plan["steps"] if s["activity"] not in refused]}
    dropped = 0
    for k, v in reviews.items():
        if k.startswith("q:") and v["verdict"] == "reject" and k[2:].isdigit() and int(k[2:]) < len(rec.get("rfi_drafts") or []):
            q = rec["rfi_drafts"][int(k[2:])]
            for r in all_of("rfi"):
                if r.get("plan") == pid and r["status"] == "draft" and r.get("subject") == q["subject"] and r.get("question") == q["question"]:
                    drop("rfi", r["id"])
                    dropped += 1
    for s in plan["steps"]:
        owner = subs.get(s["by"]) or (plan.get("packages") or {}).get(s["activity"], {}).get("responsible") or ("Own crew" if s["by"] == "self" else s["by"] or "Site manager")
        owner = owner.replace(" (fictional)", "")
        add_work_item(s["name"], owner, on_day(s["finish_h"] - 0.01, s), s["activity"], who, plan=pid, step=s["id"], code=s["code"], kind=s["kind"], section=s["section"], by=s["by"], physical=True, man_hours=s["man_hours"], crew_size=s["crew_size"],
                      start_h=s["start_h"], finish_h=s["finish_h"], critical=s["critical"], hold_point=s["hold_point"], itp=s["itp"], proposed_by=SWARM)
    planned = 0
    for s in plan["steps"]:
        if s["kind"] == "inspection":
            iid = s["itp"] or s["id"]
            if get("inspection", iid):
                continue  # already planned, perhaps already signed: a new plan does not wipe QA history
            put("inspection", iid, {"id": iid, "title": f"{rec['title']}: {s['name']}", "activity": s["activity"], "by": s["by"], "date": "", "status": "planned", "next": on_day(s["start_h"], s), "ncr": "", "plan": pid, "step": s["id"], "code": s["code"], "hold_point": s["hold_point"], "criteria": s["criteria"], "checklist": checklist_of(s["criteria"]), "wait_days": s["wait_days"]}, who, "planned an inspection", s["name"])
            planned += 1
    requests = 0
    by_step = {s["id"]: s for s in plan["steps"]}
    for m in plan["materials"]:
        rid = f"PR-{201 + sum(1 for x in all_of('po') if x['id'].startswith('PR')):03d}"
        package = MATERIAL_PACKAGE.get(m["key"], "WP-STR")
        users = [by_step[x] for x in m["steps"] if x in by_step]
        needed = on_day(min((u["start_h"] for u in users), default=0))
        put("po", rid, {"id": rid, "item": f"{m['name']}, {m['gross']:,.1f} {m['unit']}", "supplier": "To be confirmed", "package": package, "activity": users[0]["activity"] if users else plan["activities"][0], "needed": needed, "promised": "", "status": "requested", "value": m["cost"], "received_on": "", "note": f"From {pid}: {m['net']:,.1f} {m['unit']} net and {m['waste']:,.1f} waste.", "plan": pid, "material": m["key"], "steps": m["steps"]}, who, "requested material", m["name"])
        requests += 1
    effects = [f"{len(plan['steps'])} tasks go on the Kanban board, and {len(items)} items from the agents.", f"{planned} inspections go to QA/QC.", f"{requests} material requests go to Procurement, worth Rp {sum(m['cost'] for m in plan['materials']):,}.", *([f"{len(refused)} work package{'' if len(refused) == 1 else 's'} you rejected {'stays' if len(refused) == 1 else 'stay'} in the schedule with no tasks: {', '.join(sorted(refused))}."] if refused else []), *([f"{dropped} drafted question{'' if dropped == 1 else 's'} you rejected {'was' if dropped == 1 else 'were'} dropped."] if dropped else [])]
    return patch("plan", pid, {"status": "approved", "decided_by": person(who), "decided_at": now, "note": note, "effects": effects}, who, "approved the work plan", note)


def plan_actual(pid: str, step_id: str, man_hours: float | None, materials: dict[str, float], who: str = PM) -> dict:
    """What a step really took. Code compares it with the plan, and waste over the allowance goes to the attention list."""
    rec = plan_by_id(pid)
    if rec["status"] != "approved":
        raise ValueError("record actuals on an approved plan")
    step = next((s for s in rec["plan"]["steps"] if s["id"] == step_id), None)
    if not step:
        raise KeyError(step_id)
    keys = {m["key"] for m in step["materials"]}
    bad = [k for k in materials if k not in keys]
    if bad:
        raise ValueError(f"{step_id} does not use {', '.join(bad)}")
    if man_hours is not None and man_hours < 0 or any(v < 0 for v in materials.values()):
        raise ValueError("actuals cannot be negative")
    actuals = {**(rec.get("actuals") or {}), step_id: {"man_hours": man_hours, "materials": materials, "on": TODAY, "by": who}}
    patch("plan", pid, {"actuals": actuals}, who, "recorded actuals", f"{step_id}: {man_hours if man_hours is not None else '-'} man-hours")
    return plan_view(get("plan", pid))


def decisions() -> dict:
    return {"decisions": list(reversed(all_of("decision"))), "work_items": all_of("work_item"), "messages": all_of("message"), "audit": audit()}


def days_between(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days

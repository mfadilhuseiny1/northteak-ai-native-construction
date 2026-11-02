"""The project's operational records: one store where budget, schedule, procurement, subcontractors, daily reports, quality, claims and payments
live, linked to each other, with every change in an audit trail. People work these records in the screens; the swarm reads them live.

Agents only ever propose. A proposal becomes real when a person approves it here: that moves the schedule, adds cost to the forecast and opens work items.
Everything is fictional (PROVENANCE.md). `TODAY` is the scenario's date, so the demo reads the same whenever it is run.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from . import config, generator, planning_case as PC, reconcile, site_case as C
from .data import ProjectData
from .scenes import SCENES

DB: Path = config.ROOT / "data" / "firm" / "project.db"
PM = "Project manager"
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
PREFIX = {"package": "WP", "work_item": "WI", "rfi": "RFI", "daily_report": "DR", "ncr": "NCR", "message": "MG", "cost_item": "CI", "invoice": "INV"}

SEED_VERSION = "2"  # raise when the seeded records change shape
_lock = threading.RLock()
_conn: sqlite3.Connection | None = None
_conn_path: Path | None = None


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
            if not _conn.execute("select 1 from meta where key = 'seeded' and value = ?", (SEED_VERSION,)).fetchone():
                _conn.executescript("delete from records; delete from audit; delete from meta;")
                _seed()
        return _conn


def all_of(kind: str) -> list[dict]:
    with _lock:
        return [json.loads(b) for (b,) in _db().execute("select body from records where kind = ? order by rowid", (kind,))]


def get(kind: str, rid: str) -> dict | None:
    with _lock:
        row = _db().execute("select body from records where kind = ? and id = ?", (kind, rid)).fetchone()
        return json.loads(row[0]) if row else None


def log(who: str, action: str, kind: str, rid: str, detail: str = "") -> None:
    with _lock:
        _db().execute("insert into audit (t, who, action, kind, id, detail) values (?, ?, ?, ?, ?, ?)", (time.strftime("%Y-%m-%d %H:%M:%S"), who, action, kind, rid, detail))
        _db().commit()


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


def next_id(kind: str, start: int = 1) -> str:
    with _lock:
        numbers = [int(r["id"].split("-")[-1]) for r in all_of(kind) if r["id"].split("-")[-1].isdigit()]
        return f"{PREFIX[kind]}-{max(numbers, default=start - 1) + 1:03d}"


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
    """Back to the start of the scenario, for another demo. The audit trail starts again too."""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None
        if DB.exists():
            DB.unlink()
        _db()


# ------------------------------------------------------------------------------------------------ schedule


def schedule_state() -> dict:
    return meta("schedule_state", {"pour_delay_days": 0, "compress": {}})


def schedule(extra_delay: int = 0) -> dict:
    """The live schedule, worked out by code, beside its baseline, with each activity's links to the other records."""
    state = schedule_state()
    plan = C.schedule(state["pour_delay_days"] + extra_delay, state["compress"])
    base = {a["id"]: a for a in C.schedule()["activities"]}
    progress = meta("progress", {})
    rfis, ncrs, pos = all_of("rfi"), all_of("ncr"), all_of("po")
    packages = all_of("package")
    subs = {s["id"]: s["name"] for s in all_of("subcontractor")}
    for a in plan["activities"]:
        b = base[a["id"]]
        a.update(baseline_start=b["start"], baseline_finish=b["finish"], progress=progress.get(a["id"], 0), by_name=subs.get(a["by"], "Own crew"),
                 package=next((p["id"] for p in packages if a["id"] in p["activities"]), ""),
                 rfis=[r["id"] for r in rfis if r.get("activity") == a["id"] and r["status"] == "open"], ncrs=[n["id"] for n in ncrs if n.get("activity") == a["id"] and n["status"] == "open"],
                 pos=[p["id"] for p in pos if p.get("activity") == a["id"] and p["status"] != "received"])
    plan["today"] = TODAY
    plan["state"] = state
    return plan


def update_activity(aid: str, progress: int | None, duration: int | None, who: str = PM) -> dict:
    known = {a[0]: a for a in C.ACTIVITIES}
    if aid not in known:
        raise KeyError(aid)
    details = []
    if progress is not None:
        values = meta("progress", {})
        values[aid] = max(0, min(100, int(progress)))
        set_meta("progress", values)
        details.append(f"progress {values[aid]}%")
    if duration is not None:
        state = schedule_state()
        state["compress"][aid] = known[aid][2] - max(1, int(duration))
        if not state["compress"][aid]:
            del state["compress"][aid]
        set_meta("schedule_state", state)
        details.append(f"duration {max(1, int(duration))} days")
    log(who, "updated activity", "activity", aid, ", ".join(details))
    return next(a for a in schedule()["activities"] if a["id"] == aid)


# ------------------------------------------------------------------------------------------------ budget


def budget() -> dict:
    boq = {b["id"]: b for b in all_of("boq")}
    items = all_of("cost_item")
    rows = []
    for p in all_of("package"):
        lines = [boq[c] for c in p["boq"]]
        pv = sum(p["budget"] * b["value"] / p["boq_value"] * b["planned_pct"] / 100 for b in lines)
        ev = sum(p["budget"] * b["value"] / p["boq_value"] * b["verified_pct"] / 100 for b in lines)
        ac = p["actual_cost"]
        extra = sum(i["amount"] for i in items if i["package"] == p["id"] and i["status"] != "removed")
        cpi = ev / ac if ac else 1.0
        eac = ac + (p["budget"] - ev) / (cpi or 1) + extra
        rows.append({"id": p["id"], "name": p["name"], "sub": p["sub"], "boq_value": p["boq_value"], "budget": p["budget"], "committed": p["committed"], "pv": round(pv), "ev": round(ev), "ac": ac, "recovery": extra, "eac": round(eac),
                     "variance": round(p["budget"] - eac), "cpi": round(cpi, 2), "spi": round(ev / pv, 2) if pv else 1.0})
    total = {k: sum(r[k] for r in rows) for k in ("boq_value", "budget", "committed", "pv", "ev", "ac", "recovery", "eac", "variance")}
    total.update(cpi=round(total["ev"] / total["ac"], 2) if total["ac"] else 1.0, spi=round(total["ev"] / total["pv"], 2) if total["pv"] else 1.0)
    return {"packages": rows, "total": total, "cost_items": [i for i in items if i["status"] != "removed"]}


def add_cost_item(package: str, description: str, amount: int, recoverable_from: str = "", source: str = "", who: str = PM) -> dict:
    rid = next_id("cost_item")
    return put("cost_item", rid, {"id": rid, "package": package, "description": description, "amount": int(amount), "recoverable_from": recoverable_from, "source": source, "status": "forecast", "added_on": TODAY},
               who, "added cost to the forecast", f"{description}: Rp {int(amount):,}")


# ------------------------------------------------------------------------------------------------ subcontractors


def subcontractors() -> list[dict]:
    ncrs, rfis, invoices = all_of("ncr"), all_of("rfi"), all_of("invoice")
    acts = schedule()["activities"]
    out = []
    for s in all_of("subcontractor"):
        mine = [i for i in invoices if i["sub"] == s["id"]]
        expired = [d for d in s.get("documents", []) if d["expires"] and d["expires"] < TODAY]
        soon = [d for d in s.get("documents", []) if d["expires"] and TODAY <= d["expires"] <= "2026-11-05"]
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


def add_subcontractor(name: str, trade: str, scope: str, crew: int, who: str = PM) -> dict:
    rid = "sub-" + hashlib.sha1(name.encode()).hexdigest()[:6]
    return put("subcontractor", rid, {"id": rid, "name": name, "trade": trade, "scope": scope, "crew": int(crew), "activities": [], "status": "onboarding", "package": "", "contract_value": 0, "retention_pct": 5, "documents": []},
               who, "started onboarding", name)


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


def po_action(pid: str, action: str, promised: str = "", who: str = PM) -> dict:
    p = get("po", pid)
    if not p:
        raise KeyError(pid)
    if action == "receive":
        return patch("po", pid, {"status": "received", "received_on": TODAY}, who, "recorded goods received")
    if action == "promise" and promised:
        return patch("po", pid, {"promised": promised, "status": "confirmed" if promised <= p["needed"] else p["status"]}, who, "updated the promised date", promised)
    raise ValueError("unknown action")


def daily_reports(level: str | None = None) -> list[dict]:
    rows = all_of("daily_report")
    return [r for r in rows if not level or r["area"] == level]


def add_daily_report(fields: dict, who: str = PM) -> dict:
    rid = next_id("daily_report")
    rec = {"id": rid, "date": fields.get("date") or TODAY, "area": fields.get("area", ""), "author": fields.get("author") or who, "text": fields.get("text", ""), "package": fields.get("package", ""), "items": [],
           "crew": fields.get("crew"), "weather": fields.get("weather", ""), "verified": False, "verified_by": "", "source": "site"}
    return put("daily_report", rid, rec, who, "filed a daily report", rec["text"][:120])


def verify_daily_report(rid: str, who: str = "Site engineer") -> dict:
    return patch("daily_report", rid, {"verified": True, "verified_by": who}, who, "verified a daily report")


def quality() -> dict:
    subs = {s["id"]: s["name"] for s in all_of("subcontractor")}
    name = lambda r: {**r, "by_name": subs.get(r.get("by"), r.get("by", ""))}  # noqa: E731
    return {"inspections": [name(r) for r in all_of("inspection")], "ncrs": [name(r) for r in all_of("ncr")], "today": TODAY}


def close_ncr(nid: str, action: str, who: str = PM) -> dict:
    n = get("ncr", nid)
    if not n:
        raise KeyError(nid)
    if n["status"] != "open":
        raise ValueError("only an open NCR can be closed")
    rec = patch("ncr", nid, {"status": "closed", "closed_on": TODAY, "action": action or n["action"]}, who, "closed an NCR", action)
    for i in all_of("inspection"):
        if i.get("ncr") == nid and i["status"] == "failed":
            patch("inspection", i["id"], {"status": "passed", "next": "", "date": TODAY}, who, "signed off an inspection", f"after {nid}")
    return rec


def raise_ncr(title: str, by: str, activity: str, due: str, who: str = PM) -> dict:
    rid = next_id("ncr", 15)
    return put("ncr", rid, {"id": rid, "title": title, "by": by, "activity": activity, "raised": TODAY, "due": due, "status": "open", "closed_on": "", "action": ""}, who, "raised an NCR", title)


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
    rec = {"id": rid, "raised_on": TODAY, "raised_by": "Main contractor", "ball_in_court": "" if status == "draft" else fields.get("to", ""), "due": "", "answer": "", "answered_on": "", "impact": "", "activity": "", **fields, "status": status}
    return put("rfi", rid, rec, who, "drafted an RFI" if status == "draft" else "issued an RFI", rec.get("subject", ""))


def issue_rfi(rid: str, who: str = PM) -> dict:
    r = get("rfi", rid)
    if not r:
        raise KeyError(rid)
    if r["status"] != "draft":
        raise ValueError("only a draft can be issued")
    return patch("rfi", rid, {"status": "open", "ball_in_court": r.get("to", "")}, who, "issued an RFI", r.get("subject", ""))


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


def claim() -> dict:
    c = get("claim", "CL-07")
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


def checks() -> list[dict]:
    """Inconsistencies between the records, found by plain rules: no model involved, so they are always on."""
    plan = schedule()
    acts = {a["id"]: a for a in plan["activities"]}
    pour = acts[C.POUR]["start"]
    out: list[dict] = []

    def add(rule: str, level: str, title: str, detail: str, tab: str, ref: str = "") -> None:
        out.append({"rule": rule, "level": level, "title": title, "detail": detail, "tab": tab, "ref": ref})

    for n in all_of("ncr"):
        if n["status"] != "open":
            continue
        a = acts.get(n.get("activity") or "")
        blocked = a and pour <= (next((i["next"] for i in all_of("inspection") if i.get("ncr") == n["id"]), "") or "")
        add("open_ncr", "high" if blocked else "medium", f"{n['id']} is open: {n['title']}", f"Concrete cannot be placed on {pour} until it is closed and the hold point signed." if blocked else f"Due on {n['due']}.", "quality", n["id"])
    for p in all_of("po"):
        if p["status"] != "received" and p["promised"] > p["needed"]:
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
        if r["due"] < TODAY:
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
    if c["status"] == "draft" and (c["totals"]["beyond_evidence"] or c["totals"]["not_billed"]):
        t = c["totals"]
        add("claim_mismatch", "medium", "The draft progress claim does not match the site records", f"Rp {t['beyond_evidence']:,} claimed beyond the evidence, Rp {t['not_billed']:,} not billed yet, {t['site_checks']} lines need a site check.", "claims", c["id"])
    for p in budget()["packages"]:
        if p["variance"] < -0.01 * p["budget"]:
            add("over_budget", "medium", f"{p['name']} is forecast over budget", f"Rp {round(-p['variance']):,} over, with a cost index of {p['cpi']:.2f}.", "budget", p["id"])
    for w in all_of("work_item"):
        if w["status"] == "open" and w.get("due") and w["due"] < TODAY:
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
    if plan["milestone"]["days_late"]:
        add("milestone_late", "high", f"Milestone {plan['milestone']['id']} is forecast {plan['milestone']['days_late']} days late", f"Due on {plan['milestone']['contract_date']}, forecast {plan['milestone']['forecast']}.", "schedule", plan["milestone"]["activity"])
    rank = {"high": 0, "medium": 1, "low": 2}
    return sorted(out, key=lambda x: rank[x["level"]])


def overview() -> dict:
    plan = schedule()
    b = budget()
    subs = {s["id"]: s for s in subcontractors()}
    pos, ncrs, reports = all_of("po"), all_of("ncr"), all_of("daily_report")
    c = claim()
    invoices = all_of("invoice")
    acts = plan["activities"]
    chain = []
    for row in b["packages"]:
        p = get("package", row["id"])
        s = subs.get(p["sub"] or "")
        my_acts = [a for a in acts if a["id"] in p["activities"]]
        next_act = next((a for a in sorted(my_acts, key=lambda x: x["start"]) if a["progress"] < 100), None)
        my_pos = [x for x in pos if x["package"] == p["id"]]
        late = [x for x in my_pos if x["status"] != "received" and x["promised"] > x["needed"]]
        mine = [r for r in reports if r.get("package") == p["id"] or set(r.get("items") or []) & set(p.get("boq") or [])]
        unverified = [r for r in mine if not r["verified"]]
        open_ncr = [n for n in ncrs if n["status"] == "open" and n["by"] == p["sub"]]
        lines = [x for x in c["lines"] if x["package"] == p["id"]]
        off = [x for x in lines if x["status"] != "supported"]
        inv = next((i for i in invoices if i["sub"] == p["sub"]), None)
        over = inv and inv["status"] == "submitted" and inv["certified_to_date"] + inv["claimed"] > inv["earned_to_date"]
        chain.append({"id": p["id"], "name": p["name"], "steps": [
            {"key": "budget", "tab": "budget", "tone": "bad" if row["variance"] < -0.01 * row["budget"] else "ok", "text": f"CPI {row['cpi']:.2f}", "sub": f"SPI {row['spi']:.2f}"},
            {"key": "procurement", "tab": "procurement", "tone": "bad" if late else "ok" if my_pos else "none", "text": f"{len(late)} late" if late else f"{len(my_pos)} order{'s' if len(my_pos) != 1 else ''}" if my_pos else "no orders", "sub": ""},
            {"key": "subcontractor", "tab": "subcontractors", "tone": "none" if not s else "warn" if s["rating"] == "watch" else "ok", "text": s["name"].replace(" (fictional)", "") if s else "Own crew", "sub": s["rating"] if s else ""},
            {"key": "schedule", "tab": "schedule", "tone": "warn" if next_act and next_act["critical"] else "ok", "text": next_act["id"] if next_act else "done", "sub": (next_act["start"][5:] + (" critical" if next_act["critical"] else "")) if next_act else ""},
            {"key": "report", "tab": "reports", "tone": "warn" if unverified else "ok" if mine else "none", "text": f"{len(mine)} report{'s' if len(mine) != 1 else ''}", "sub": f"{len(unverified)} to verify" if unverified else (max(r["date"] for r in mine)[5:] if mine else "")},
            {"key": "inspection", "tab": "quality", "tone": "bad" if open_ncr else "ok" if p["sub"] else "none", "text": f"{len(open_ncr)} NCR open" if open_ncr else "clear", "sub": ""},
            {"key": "claim", "tab": "claims", "tone": "warn" if off else "ok", "text": f"{len(off)} of {len(lines)} off" if off else f"{len(lines)} lines OK", "sub": ""},
            {"key": "payment", "tab": "subcontractors", "tone": "none" if not inv else "warn" if over else "ok", "text": (inv["status"] if inv else "n/a"), "sub": "billed ahead" if over else ""},
            {"key": "handover", "tab": "", "tone": "none", "text": "not started", "sub": ""},
        ]})
    attention = checks()
    return {"today": TODAY, "project": C_PROJECT(), "milestone": plan["milestone"], "pour": next(a for a in acts if a["id"] == C.POUR), "kpis": {**b["total"], "contract": b["total"]["boq_value"]},
            "chain": chain, "attention": attention, "counts": {"open_rfis": sum(1 for r in all_of("rfi") if r["status"] == "open"), "draft_rfis": sum(1 for r in all_of("rfi") if r["status"] == "draft"), "open_ncrs": sum(1 for n in ncrs if n["status"] == "open"),
                                                                "open_work_items": sum(1 for w in all_of("work_item") if w["status"] == "open"), "pending_decisions": sum(1 for d in all_of("decision") if d["status"] == "pending"), "pending_plans": sum(1 for p in all_of("plan") if p["status"] == "pending"), "draft_messages": sum(1 for m in all_of("message") if m["status"] == "draft")},
            "latest_decision": next((d for d in reversed(all_of("decision")) if d["status"] != "superseded"), None), "latest_plan": _plan_card(),
            "as_seeded": as_seeded()}


def _plan_card() -> dict | None:
    r = next((p for p in reversed(all_of("plan")) if p["status"] != "superseded"), None)
    return {k: r[k] for k in ("id", "title", "status", "mode")} | {"totals": r["plan"]["totals"], "open_checks": sum(1 for c in r["plan"]["checks"] if not c["ok"])} if r else None


def C_PROJECT() -> dict:
    return json.loads((generator.ensure() / "project.json").read_text(encoding="utf-8"))


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
    items = [w for w in all_of("work_item") if w.get("decision") == did]
    if verdict == "reject":
        for w in items:
            patch("work_item", w["id"], {"status": "rejected"}, who, "rejected a proposed work item", "with the plan")
        return patch("decision", did, {"status": "rejected", "decided_by": who, "decided_at": time.strftime("%Y-%m-%d %H:%M"), "note": note}, who, "rejected the recovery plan", note)
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
    return patch("decision", did, {"status": "approved", "option": chosen, "decided_by": who, "decided_at": time.strftime("%Y-%m-%d %H:%M"), "note": note, "effects": effects}, who, "approved the recovery plan", f"option {chosen}. {note}".strip())


def message_action(mid: str, action: str, who: str = PM) -> dict:
    m = get("message", mid)
    if not m:
        raise KeyError(mid)
    if m["status"] != "draft":
        raise ValueError("this message has already been decided")
    if action == "approve":  # a demo connector is all there is so far, so nothing leaves this machine
        return patch("message", mid, {"status": "approved", "decided_by": who}, who, "approved a message", f"to {m['to']} over {m['channel']} (demo connector: not really sent)")
    if action == "reject":
        return patch("message", mid, {"status": "rejected", "decided_by": who}, who, "rejected a message", f"to {m['to']}")
    raise ValueError("unknown action")


def add_work_item(title: str, owner: str, due: str, activity: str = "", who: str = PM) -> dict:
    rid = next_id("work_item")
    return put("work_item", rid, {"id": rid, "title": title, "owner": owner, "due": due, "why": "", "activity": activity, "status": "open", "decision": "", "run": "", "created": TODAY, "done_on": "", "proposed_by": who}, who, "opened a work item", title)


def set_work_item(wid: str, status: str, who: str = PM) -> dict:
    if status not in ("open", "done"):
        raise ValueError("status must be open or done")
    return patch("work_item", wid, {"status": status, "done_on": TODAY if status == "done" else ""}, who, "marked a work item " + status)


# ------------------------------------------------------------------------------------------------ work plans: a consultant's documents into an OPC a person approves


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
    pid = f"OPC-{run_id[-6:]}"
    rec = {"id": pid, "run": run_id, "mode": mode, "title": firm.result["title"], "status": "pending", "plan": firm.result, "findings": firm.findings(), "attacks": firm.attacks, "report": firm.report, "summary": firm.summary, "rfi_drafts": firm.rfi_drafts, "created": time.strftime("%Y-%m-%d %H:%M"),
           "decided_by": "", "decided_at": "", "note": "", "effects": [], "actuals": {}}
    put("plan", pid, rec, SWARM, "asked for a decision on a work plan", f"{firm.result['totals']['steps']} steps")
    for w in firm.proposed:
        rid = next_id("work_item")
        put("work_item", rid, {"id": rid, **w, "status": "proposed", "decision": pid, "run": run_id, "created": TODAY, "done_on": ""}, SWARM, "proposed a work item", w["title"])
    return rec


def plan_view(rec: dict) -> dict:
    """A plan with what has really happened beside it: actuals against the plan, worked out by code."""
    actuals = rec.get("actuals") or {}
    done, planned_waste, actual_waste, planned_hours, actual_hours = 0, 0, 0, 0.0, 0.0
    steps = []
    for s in rec["plan"]["steps"]:
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
    plan = {**rec["plan"], "steps": steps}
    return {**rec, "plan": plan, "work_items": [w for w in all_of("work_item") if w.get("decision") == rec["id"]], "progress": {"done": done, "of": len(steps), "planned_waste": planned_waste, "actual_waste": actual_waste, "planned_man_hours": round(planned_hours, 1), "actual_man_hours": round(actual_hours, 1)}}


def plans() -> list[dict]:
    return [plan_view(r) for r in reversed(all_of("plan"))]


def plan_by_id(pid: str) -> dict:
    rec = get("plan", pid)
    if not rec:
        raise KeyError(pid)
    return rec


def decide_plan(pid: str, verdict: str, note: str = "", who: str = PM) -> dict:
    """Approving is what makes a plan real: its sections become work items, its inspections go to Quality, its material becomes requests."""
    rec = plan_by_id(pid)
    if rec["status"] != "pending":
        raise ValueError("this plan has already been decided")
    items = [w for w in all_of("work_item") if w.get("decision") == pid]
    now = time.strftime("%Y-%m-%d %H:%M")
    if verdict == "reject":
        for w in items:
            patch("work_item", w["id"], {"status": "rejected"}, who, "rejected a proposed work item", "with the plan")
        return patch("plan", pid, {"status": "rejected", "decided_by": who, "decided_at": now, "note": note}, who, "rejected the work plan", note)
    plan = rec["plan"]
    for old in all_of("plan"):
        if old["status"] == "approved":
            patch("plan", old["id"], {"status": "superseded"}, who, "replaced an approved work plan", f"by {pid}")
    for w in items:
        patch("work_item", w["id"], {"status": "open"}, who, "opened a work item", w["title"])
    live = {a["id"]: a for a in schedule()["activities"]}
    first = next((live[a] for a in plan["activities"] if a in live), None)
    start = first["start"] if first else TODAY
    on_day = lambda hours: (date.fromisoformat(start) + timedelta(days=int(hours // plan["totals"]["hours_per_oh"]))).isoformat()  # noqa: E731
    sections = {s["id"]: s for s in plan["sections"]}
    subs = {s["id"]: s["name"] for s in all_of("subcontractor")}
    made = 0
    for sid, section in sections.items():
        mine = [s for s in plan["steps"] if s["section"] == sid]
        if mine:
            owner = subs.get(mine[0]["by"], mine[0]["by"] or "Site manager").replace(" (fictional)", "")
            add_work_item(f"{rec['title']}: {section['name']}, {mine[0]['id']} to {mine[-1]['id']}", owner, on_day(max(s["finish_h"] for s in mine)), plan["activities"][0], who)
            made += 1
    planned = 0
    for s in plan["steps"]:
        if s["kind"] == "inspection":
            iid = s["itp"] or s["id"]
            put("inspection", iid, {"id": iid, "title": f"{rec['title']}: {s['name']}", "activity": plan["activities"][0], "by": s["by"], "date": "", "status": "planned", "next": on_day(s["start_h"]), "ncr": "", "plan": pid, "hold_point": s["hold_point"]}, who, "planned an inspection", s["name"])
            planned += 1
    requests = 0
    for m in plan["materials"]:
        rid = f"PR-{201 + sum(1 for x in all_of('po') if x['id'].startswith('PR')):03d}"
        package = MATERIAL_PACKAGE.get(m["key"], "WP-STR")
        put("po", rid, {"id": rid, "item": f"{m['name']}, {m['gross']:,.1f} {m['unit']}", "supplier": "To be confirmed", "package": package, "activity": plan["activities"][0], "needed": start, "promised": "", "status": "requested", "value": m["cost"], "received_on": "", "note": f"From {pid}: {m['net']:,.1f} {m['unit']} net and {m['waste']:,.1f} waste."}, who, "requested material", m["name"])
        requests += 1
    effects = [f"{made} work items open for the sections, and {len(items)} from the agents.", f"{planned} inspections go to the Quality register.", f"{requests} material requests go to Procurement, worth Rp {sum(m['cost'] for m in plan['materials']):,}."]
    return patch("plan", pid, {"status": "approved", "decided_by": who, "decided_at": now, "note": note, "effects": effects}, who, "approved the work plan", note)


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

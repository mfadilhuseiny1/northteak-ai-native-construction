"""Reports from the records, at no cost: the project's monthly dashboard for the project officer, the portfolio's for senior management, and the
quarterly funding report for the CFO and the banks.

Every figure comes from a module: progress from the schedule, money from cost control and the BoQ, risks from the register. What only a person
knows is kept here: the variations agreed with the owner, and the contingency set aside and drawn. A report saves the month's figures as it is
read, so that next month it can say what changed. A figure nothing has measured yet is said to be unmeasured, never shown as on target.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import modules as M, project as P

router = APIRouter()

REASONS = ["Owner's change", "Design change", "Site condition", "Error or omission", "Other"]
FROM = {"submitted": ("proposed",), "approved": ("proposed", "submitted"), "rejected": ("proposed", "submitted"), "proposed": ("submitted", "rejected")}  # where each step may come from
OPEN_RISK = ("closed", "occurred")


def rp(n: float) -> str:
    """Money as the screens write it."""
    a = abs(n)
    return f"Rp {n / 1e9:.2f} bn" if a >= 1e9 else f"Rp {n / 1e6:.1f} m" if a >= 1e6 else f"Rp {round(n):,}"


def quarter(day: str) -> tuple[str, str, str]:
    """The quarter a day falls in, as a name and its first and last days."""
    y, m = int(day[:4]), int(day[5:7])
    first = date(y, 3 * ((m - 1) // 3) + 1, 1)
    last = (first.replace(year=y + 1, month=1) if first.month == 10 else first.replace(month=first.month + 3)) - timedelta(days=1)
    return f"Q{(m - 1) // 3 + 1} {y}", first.isoformat(), last.isoformat()


def _after(day: str, days: int = 1) -> str:
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


# ------------------------------------------------------------------------------------------------ variations and contingency: what a person knows


def variations() -> dict:
    rows = P.all_of("variation")
    totals = {s: sum(v["value"] for v in rows if v["status"] == s) for s in ("proposed", "submitted", "approved", "rejected")}
    return {"variations": list(reversed(rows)), "totals": totals, "days_approved": sum(v["days"] for v in rows if v["status"] == "approved"), "reasons": REASONS}


def add_variation(title: str, reason: str, value: int, days: int = 0, wbs: str = "", ref: str = "", note: str = "", who: str = P.PM) -> dict:
    """A change to the contract's work, its price and its time, raised by the contractor or instructed by the owner. It starts as proposed: only the owner's answer makes it count."""
    if not str(title).strip():
        raise ValueError("a variation needs a title")
    if reason not in REASONS:
        raise ValueError(f"reason must be one of: {', '.join(REASONS)}")
    if days < 0:
        raise ValueError("days asked for cannot be fewer than none")
    vid = P.next_id("variation")
    rec = {"id": vid, "title": str(title).strip(), "reason": reason, "value": int(value), "days": int(days), "wbs": wbs, "ref": ref.strip(), "note": note.strip(), "status": "proposed", "raised": P.TODAY, "decided": ""}
    return P.put("variation", vid, rec, who, "raised a variation", f"{rec['title']}, {rp(rec['value'])}")


def set_variation(vid: str, status: str, who: str = P.PM) -> dict:
    v = P.get("variation", vid)
    if not v:
        raise KeyError(vid)
    if status not in FROM:
        raise ValueError(f"status must be one of: {', '.join(FROM)}")
    if v["status"] not in FROM[status]:
        raise ValueError(f"a variation that is {v['status']} cannot become {status}")
    changes = {"status": status, "decided": P.TODAY if status in ("approved", "rejected") else ""}
    return P.patch("variation", vid, changes, who, f"marked a variation {status}", v["title"])


def contingency() -> dict:
    c = P.meta("contingency") or {}
    uses = P.all_of("contingency_use")
    amount, used = c.get("amount", 0), sum(u["amount"] for u in uses)
    return {"amount": amount, "used": used, "left": amount - used, "set_on": c.get("set_on", ""), "uses": list(reversed(uses))}


def set_contingency(amount: int, who: str = P.PM) -> dict:
    if amount < 0:
        raise ValueError("a contingency cannot be less than nothing")
    P.set_meta("contingency", {"amount": int(amount), "set_on": P.TODAY})
    P.log(who, "set the contingency", "contingency", "contingency", rp(amount))
    return contingency()


def use_contingency(amount: int, reason: str, risk: str = "", who: str = P.PM) -> dict:
    """Money drawn from the contingency, and what for. Drawing more than is left is allowed: the report then says it is overdrawn."""
    if not (P.meta("contingency") or {}).get("amount"):
        raise ValueError("set the contingency before drawing on it")
    if amount <= 0:
        raise ValueError("an amount drawn must be more than nothing")
    if not str(reason).strip():
        raise ValueError("say what the money is for")
    uid = P.next_id("contingency_use")
    P.put("contingency_use", uid, {"id": uid, "amount": int(amount), "reason": str(reason).strip(), "risk": risk, "date": P.TODAY}, who, "drew on the contingency", f"{rp(amount)}: {str(reason).strip()}")
    return contingency()


# ------------------------------------------------------------------------------------------------ the figures, from the modules


def _share(start: str, duration: int, day: str) -> float:
    """How much of a piece of work should be done by a day, if it runs evenly from its start."""
    return max(0.0, min(1.0, P.days_between(start, day) / max(1, duration)))


def planned_pct(acts: list[dict], day: str) -> float:
    """Where the baseline says the job should be on a day, weighted by duration as the progress figure is."""
    total = sum(a["duration"] for a in acts)
    return 100 * sum(a["duration"] * _share(a["baseline_start"], a["duration"], day) for a in acts) / total if total else 0.0


def _budgets(acts: list[dict]) -> dict[str, float]:
    """Each activity's share of its control account's budget: by the BoQ lines tied to it, or by its days where none are."""
    by = {a["id"]: a for a in acts}
    boq = P.all_of("boq")
    out: dict[str, float] = {}
    for p in P.all_of("package"):
        mine = [a for a in p["activities"] if a in by]
        tied = {a: sum(b["value"] for b in boq if b.get("activity") == a) for a in mine}
        weights = tied if sum(tied.values()) else {a: by[a]["duration"] for a in mine}
        total = sum(weights.values()) or 1
        for a in mine:
            out[a] = p["budget"] * weights[a] / total
    return out


def spend(acts: list[dict], budgets: dict[str, float], first: str, last: str, today: str) -> int:
    """The cost the forecast programme spends between two days: each activity's budget not yet earned, spread evenly over the days it has left."""
    total = 0.0
    for a in acts:
        left = budgets.get(a["id"], 0) * (100 - a["progress"]) / 100
        if left <= 0:
            continue
        s = max(a["start"], today)
        f = max(a["finish"], s)
        lo, hi = max(s, first), min(f, last)
        if lo <= hi:
            total += left * (P.days_between(lo, hi) + 1) / (P.days_between(s, f) + 1)
    return round(total)


def _curve(acts: list[dict], start: str, end: str) -> list[list]:
    """The baseline's S-curve, a point at each month's turn."""
    points, d = [[start, 0.0]], date.fromisoformat(start)
    while True:
        d = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
        if d.isoformat() >= end:
            break
        points.append([d.isoformat(), round(planned_pct(acts, d.isoformat()), 1)])
    points.append([end, 100.0])
    return points


def needed() -> list[dict]:
    """What waits on a person, each with where to settle it."""
    out = []
    for p in P.all_of("plan"):
        if p["status"] == "pending":
            out.append({"text": f"Approve or reject the work plan {p['id']}", "go": "review", "tone": "warn"})
    for d in P.all_of("decision"):
        if d["status"] == "pending":
            out.append({"text": f"Decide: {d['title']}", "go": "tower/decisions", "tone": "warn"})
    vo = [v for v in P.all_of("variation") if v["status"] == "proposed"]
    if vo:
        out.append({"text": f"Send {len(vo)} variation{'s' if len(vo) != 1 else ''} to the owner, worth {rp(sum(v['value'] for v in vo))}", "go": "reports/project:variations", "tone": "info"})
    drafts = sum(1 for r in P.all_of("rfi") if r["status"] == "draft")
    if drafts:
        out.append({"text": f"Issue or drop {drafts} draft RFI{'s' if drafts != 1 else ''} the agents wrote", "go": "documents/rfis", "tone": "info"})
    ncrs = sum(1 for n in P.all_of("ncr") if n["status"] == "open")
    if ncrs:
        out.append({"text": f"Close {ncrs} open NCR{'s' if ncrs != 1 else ''}", "go": "quality/ncrs", "tone": "bad"})
    orphans = sum(1 for r in M._risks() if r["level"] in ("extreme", "high") and not r["owner"] and r["status"] not in OPEN_RISK)
    if orphans:
        out.append({"text": f"Give {orphans} high risk{'s' if orphans != 1 else ''} an owner", "go": "risks", "tone": "warn"})
    if P.all_of("activity") and not (P.meta("contingency") or {}).get("amount"):
        out.append({"text": "Set the contingency held against the risks", "go": "reports/project:contingency", "tone": "info"})
    return out


def summary() -> dict:
    """The open project's figures for the month. What a report shows, and what is saved to compare against next month."""
    info = P.C_PROJECT()
    sched = P.schedule()
    acts = sched["activities"]
    b = P.budget()["total"]
    vo, cont = variations(), contingency()
    risks = [r for r in M._risks() if r["status"] not in OPEN_RISK]
    today = P.TODAY
    name, q_first, q_last = quarter(_after(quarter(today)[2]))  # the quarter after this one
    out = {"name": info.get("name", ""), "owner": info.get("owner", ""), "contractor": info.get("contractor", ""), "location": info.get("location", ""),
           "today": today, "period": today[:7], "quarter": quarter(today)[0], "planned_any": bool(acts)}
    if not acts:
        return {**out, "status": "none", "reasons": [], "notes": ["nothing is planned yet"], "decisions": needed()}
    total = sum(a["duration"] for a in acts)
    actual = round(sum(a["progress"] * a["duration"] for a in acts) / total, 1)
    start = min(a["baseline_start"] for a in acts)
    planned_finish = max(a["baseline_finish"] for a in acts)
    finish = max(a["finish"] for a in acts)
    whole = next((m for m in sched["milestones"] if m.get("whole_job")), None)
    contract_finish = info.get("finish") or (whole["contract_date"] if whole else "") or planned_finish
    revised_finish = _after(contract_finish, vo["days_approved"])
    days_late = max(0, P.days_between(revised_finish, finish))
    priced = b["budget"] > 0
    cost_measured = priced and b["ac"] > 0
    time_measured = priced and b["pv"] >= 0.01 * b["budget"]  # a day into the job, a sliver of planned value would make any progress look a thousand times ahead
    contract = b["boq_value"]
    budgets = _budgets(acts)
    extreme, high = sum(1 for r in risks if r["level"] == "extreme"), sum(1 for r in risks if r["level"] == "high")
    planned = round(planned_pct(acts, today), 1)
    out.update(
        progress=actual, planned=planned, start=start, finish=finish, planned_finish=planned_finish, contract_finish=contract_finish, revised_finish=revised_finish, days_late=days_late,
        contract=contract, variations_approved=vo["totals"]["approved"], variations_pending=vo["totals"]["proposed"] + vo["totals"]["submitted"], revised=contract + vo["totals"]["approved"],
        days_approved=vo["days_approved"], budget=b["budget"], committed=b["committed"], ev=b["ev"], ac=b["ac"], priced=priced, cost_measured=cost_measured, time_measured=time_measured,
        eac=b["eac"] if cost_measured else b["budget"], variance=b["variance"] if cost_measured else None, cpi=b["cpi"] if cost_measured else None, spi=b["spi"] if time_measured else None,
        contingency=cont["amount"], contingency_used=cont["used"], contingency_left=cont["left"],
        risks_open=len(risks), risks_extreme=extreme, risks_high=high,
        top_risks=[{"id": r["id"], "title": r["title"], "level": r["level"], "score": r["score"], "owner": r["owner"], "response": r.get("response", ""), "go": r.get("go", "")} for r in risks[:5]],
        milestones=[{"id": m["id"], "name": m.get("name") or m.get("title") or m["id"], "contract_date": m["contract_date"], "forecast": m["forecast"], "days_late": m["days_late"]} for m in sched["milestones"]][:8],
        curve=_curve(acts, start, max(planned_finish, finish)), next_quarter={"name": name, "first": q_first, "last": q_last, "spend": spend(acts, budgets, q_first, q_last, today)},
        cash=[], to_spend=max(0, round((b["eac"] if cost_measured else b["budget"]) - b["ac"])),
    )
    first = _after(today)
    while first <= finish and len(out["cash"]) < 8:  # the money the programme needs, quarter by quarter to the end
        qname, _, qlast = quarter(first)
        out["cash"].append({"name": qname, "spend": spend(acts, budgets, first, qlast, today)})
        first = _after(qlast)
    claim = P.claim() if not P.is_blank() else None
    if claim:
        out["certified"] = claim["certificate"]["cumulative"]
    bad, warn = [], []
    if days_late:
        bad.append(f"finishes {days_late} days after the contract date")
    if out["variance"] is not None and out["variance"] < -0.05 * b["budget"]:
        bad.append(f"forecast {rp(-out['variance'])} over budget")
    elif out["variance"] is not None and out["variance"] < 0:
        warn.append(f"forecast {rp(-out['variance'])} over budget")
    if planned - actual > 10:
        bad.append(f"{round(planned - actual)} points behind the baseline")
    elif planned - actual > 3:
        warn.append(f"{round(planned - actual)} points behind the baseline")
    if extreme:
        bad.append(f"{extreme} extreme risk{'s' if extreme != 1 else ''} open")
    if high:
        warn.append(f"{high} high risk{'s' if high != 1 else ''} open")
    if cont["amount"] and cont["left"] < 0:
        bad.append("the contingency is overdrawn")
    elif cont["amount"] and cont["left"] < 0.25 * cont["amount"]:
        warn.append("less than a quarter of the contingency is left")
    notes = []  # what nothing has measured yet: said, and not counted for or against the project
    if not priced:
        notes.append("no BoQ is priced on the work packages yet, so there are no money figures")
    elif not cost_measured:
        notes.append("no actual cost is recorded yet, so the forecast is the budget")
    if priced and not time_measured:
        notes.append("too early in the job for a schedule index")
    out.update(status="red" if bad else "amber" if warn else "green", reasons=bad + warn, notes=notes, decisions=needed())
    return out


def changes(now: dict, before: dict | None) -> dict | None:
    """What moved since last month's report, and whether that is for the better."""
    if not before or not now.get("planned_any") or not before.get("planned_any"):
        return None
    rows = []

    def add(key: str, label: str, unit: str, better: str) -> None:
        a, b = before.get(key), now.get(key)
        if a is None or b is None:
            return
        rows.append({"key": key, "label": label, "unit": unit, "before": a, "now": b, "delta": round(b - a, 1), "good": b == a or (b > a) == (better == "up")})

    add("progress", "Progress", "pts", "up")
    add("eac", "Cost forecast", "rp", "down")
    add("days_late", "Days late", "days", "down")
    add("risks_high", "High risks", "n", "down")
    add("risks_extreme", "Extreme risks", "n", "down")
    add("variations_approved", "Approved variations", "rp", "up")
    add("contingency_left", "Contingency left", "rp", "up")
    shift = P.days_between(before["finish"], now["finish"])
    rows.insert(1, {"key": "finish", "label": "Forecast finish", "unit": "days", "before": before["finish"], "now": now["finish"], "delta": shift, "good": shift <= 0})
    return {"since": before["today"], "period": before["period"], "rows": rows}


def month(save: bool = True) -> dict:
    """The month's figures, saved so that next month can compare, beside what changed since the last month saved."""
    now = summary()
    saved = P.all_of("snapshot")
    before = max((s for s in saved if s["period"] < now["period"]), key=lambda s: s["period"], default=None)
    if save and now["planned_any"]:
        P.put("snapshot", now["period"], now)
    history = [[s["today"], s["progress"]] for s in sorted(saved, key=lambda s: s["period"]) if s.get("planned_any") and s["period"] < now["period"]]
    if now["planned_any"]:
        now["actual_curve"] = [[now["start"], 0.0], *history, [now["today"], now["progress"]]] if now["start"] <= now["today"] else []
    return {**now, "changes": changes(now, before)}


def events(days: int = 30) -> list[dict]:
    """What people and agents did in the last month, from the audit trail, the same kind of action counted together."""
    since = (date.today() - timedelta(days=days)).isoformat()
    groups: dict[tuple[str, str], dict] = {}
    for r in P.audit(2000):
        if r["t"] < since:
            break
        g = groups.setdefault((r["who"], r["action"]), {"who": r["who"], "action": r["action"], "count": 0, "last": r["t"], "detail": r["detail"]})
        g["count"] += 1
    return sorted(groups.values(), key=lambda g: g["last"], reverse=True)[:10]


def report() -> dict:
    photos = M.photos()["photos"]
    now = month()
    this = [p for p in photos if (p.get("date") or "").startswith(now["period"])]
    return {**now, "variations": variations(), "contingency_detail": contingency(), "photos": (this or photos)[:12], "photos_this_month": bool(this), "events": events(),
            "risk_ids": [{"id": r["id"], "title": r["title"]} for r in M._risks() if r["status"] not in OPEN_RISK][:40],
            "packages": [{"id": a["id"], "code": a["code"], "name": a["name"]} for a in P.schedule()["activities"]]}


# ------------------------------------------------------------------------------------------------ the portfolio: every project, read beside the open one


def _last_saved(path: Path) -> dict | None:
    """A project's latest saved month, read from its file, for when it cannot be opened to read: the agents are at work."""
    conn = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    try:
        row = conn.execute("select body from records where kind = 'snapshot' order by id desc limit 1").fetchone()
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()
    return json.loads(row[0]) if row else None


def portfolio() -> dict:
    """Every project of the firm's own, each read from its own records. The sample project is left out: its figures are invented."""
    rows = []
    for p in P.projects()["projects"]:
        if p.get("scenario"):
            continue
        path = P.SCENARIO_DB.parent / "projects" / f"{p['id']}.db"
        if not path.exists():
            continue
        try:
            if path == P.DB:
                s = month()
            elif P.busy:  # the agents are writing the open project: reading another would point the app away from it
                s = {**(_last_saved(path) or {"name": p["name"], "planned_any": False, "status": "none", "reasons": [], "notes": ["not read yet: the agents are at work on the open project"], "decisions": []}), "changes": None, "stale": True}
            else:
                with P.visiting(path):
                    s = month()
        except Exception as e:  # noqa: BLE001 - one project's records failing to read must not hide the others
            s = {"name": p["name"], "planned_any": False, "status": "none", "reasons": [], "notes": [f"could not be read: {e}"], "decisions": []}
        rows.append({**s, "id": p["id"], "open": path == P.DB})
    live = [r for r in rows if r.get("planned_any")]
    total = {k: sum(r.get(k) or 0 for r in live) for k in ("contract", "revised", "budget", "eac", "ac", "ev", "variations_approved", "variations_pending", "contingency", "contingency_left", "to_spend")}
    total["next_quarter"] = sum(r["next_quarter"]["spend"] for r in live)
    total["variance"] = sum(r["variance"] for r in live if r.get("variance") is not None) if any(r.get("variance") is not None for r in live) else None
    total["status"] = {s: sum(1 for r in rows if r.get("status") == s) for s in ("green", "amber", "red", "none")}
    total["decisions"] = sum(len(r.get("decisions") or []) for r in rows)
    today = P.TODAY
    return {"projects": rows, "total": total, "today": today, "period": today[:7], "quarter": quarter(today)[0], "next_quarter": quarter(_after(quarter(today)[2]))[0]}


# ------------------------------------------------------------------------------------------------ the routes


def _guarded(fn, *a, **k):
    try:
        return fn(*a, **k)
    except KeyError as e:
        raise HTTPException(404, f"no such record: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


class VariationIn(BaseModel):
    title: str
    reason: str = "Owner's change"
    value: int = 0
    days: int = 0
    wbs: str = ""
    ref: str = ""
    note: str = ""


class StatusIn(BaseModel):
    status: str


class AmountIn(BaseModel):
    amount: int


class UseIn(BaseModel):
    amount: int
    reason: str
    risk: str = ""


@router.get("/api/project/report")
def project_report() -> dict:
    return report()


@router.post("/api/project/variations")
def new_variation(body: VariationIn) -> dict:
    return _guarded(add_variation, body.title, body.reason, body.value, body.days, body.wbs, body.ref, body.note)


@router.post("/api/project/variations/{vid}")
def variation_status(vid: str, body: StatusIn) -> dict:
    return _guarded(set_variation, vid, body.status)


@router.post("/api/project/contingency")
def contingency_amount(body: AmountIn) -> dict:
    return _guarded(set_contingency, body.amount)


@router.post("/api/project/contingency/use")
def contingency_use(body: UseIn) -> dict:
    return _guarded(use_contingency, body.amount, body.reason, body.risk)


@router.get("/api/reports/portfolio")
def portfolio_report() -> dict:
    return portfolio()

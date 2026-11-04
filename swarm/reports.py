"""Reports from the records, at no cost: the project's monthly dashboard for the project officer, the portfolio's for senior management, and the
quarterly funding report for the CFO and the banks.

Every figure comes from a module: progress from the schedule, money from cost control and the BoQ, risks from the register. What only a person
knows is kept here: the variations agreed with the owner, and the contingency set aside and drawn. A report saves the month's figures as it is
read, so that next month it can say what changed. A figure nothing has measured yet is said to be unmeasured, never shown as on target.
"""

from __future__ import annotations

import json
import sqlite3
import time
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import modules as M, package as K, project as P

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
    """Where the baseline says the job should be on a day, each work package counting for its weight in the job."""
    weights, _ = _weights(acts)
    return sum(weights[a["id"]] * _share(a["baseline_start"], a["duration"], day) for a in acts)


_read: dict[str, tuple[float, dict | None]] = {}


def master_schedule() -> tuple[dict, dict] | None:
    """The contract's own Kurva-S, read by code from the master schedule, with the document it is in. None if there is none, or it cannot be read as a table with its cumulative row."""
    for d in K.uploads():
        if d.get("kind") != "programme" or not d.get("file"):
            continue
        path = P.upload_folder() / d["file"]
        if not path.exists():
            continue
        when = path.stat().st_mtime
        if str(path) not in _read or _read[str(path)][0] != when:
            _read[str(path)] = (when, K.read_programme(path))
        table = _read[str(path)][1]
        if table and table.get("cumulative") and len(table["cumulative"]) == table["weeks"]:
            return table, d
    return None


def on_schedule(table: dict, start: str, day: str) -> float:
    """Where the contract's own curve says the job should be on a day: its figure at the end of each week, and evenly between."""
    days, cum = P.days_between(start, day), table["cumulative"]
    if days < 0:
        return 0.0
    week = days / 7
    whole = int(week)
    if whole >= len(cum):
        return cum[-1]
    before = cum[whole - 1] if whole else 0.0
    return before + (cum[whole] - before) * (week - whole)


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


def _curve(at, start: str, end: str) -> list[list]:
    """The baseline's S-curve, a point at each month's turn."""
    points, d = [[start, 0.0]], date.fromisoformat(start)
    while True:
        d = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
        if d.isoformat() >= end:
            break
        points.append([d.isoformat(), round(at(d.isoformat()), 1)])
    points.append([end, 100.0])
    return points


def _weights(acts: list[dict]) -> tuple[dict[str, float], str]:
    """Each work package's weight in the job, in percent: by its share of the RAB, or by its days where nothing is priced."""
    budgets = _budgets(acts)
    total = sum(budgets.values())
    if total > 0:
        return {a["id"]: 100 * budgets.get(a["id"], 0) / total for a in acts}, "rab"
    days = sum(a["duration"] for a in acts) or 1
    return {a["id"]: 100 * a["duration"] / days for a in acts}, "duration"


def kurva_actual(acts: list[dict]) -> float:
    """Progress the way the Kurva-S counts it: each work package's weight times how far it has got."""
    weights, _ = _weights(acts)
    return round(sum(weights[a["id"]] * a["progress"] / 100 for a in acts), 2)


def kurva_s() -> dict:
    """The Kurva-S as contractors draw it, beside the actual curve. Where the package has a master schedule code can read, the grid and the planned
    curve are that document's own figures, so they match what the contract says. Otherwise each work package's weight is spread evenly over the
    days its baseline runs. The actual line is what the site recorded, week by week; until it has, a point for each month a report saved and for
    today. Either way the weeks between were not measured, so they are left empty rather than filled in."""
    sched = P.schedule()
    acts = {a["id"]: a for a in sched["activities"]}
    official = master_schedule()
    if official:  # the document needs no plan to be read: it shows as soon as it is uploaded
        return _on_the_schedule(official, acts, min((a["baseline_start"] for a in acts.values()), default=P.project_start()))
    if not acts:
        return {"weeks": 0, "rows": []}
    weights, source = _weights(list(acts.values()))
    start = min(a["baseline_start"] for a in acts.values())
    end = max(a["baseline_finish"] for a in acts.values())
    weeks = max(1, -(-(P.days_between(start, end) + 1) // 7))

    def spread(a: dict) -> list[float]:
        cells, first, days = [0.0] * weeks, P.days_between(start, a["baseline_start"]), max(1, a["duration"])
        for k in range(days):
            w = (first + k) // 7
            if 0 <= w < weeks:
                cells[w] += weights[a["id"]] / days
        return cells

    rows, groups = [], {}
    for w in M.work_packages()["packages"]:
        a = acts.get(w["id"])
        if not a:
            continue
        code = ".".join(str(w["code"]).split(".")[:-1])
        if code not in groups:
            groups[code] = {"type": "group", "code": code, "name": w["account_name"], "weight": 0.0, "cells": [0.0] * weeks}
            rows.append(groups[code])
        cells = spread(a)
        g = groups[code]
        g["weight"] += weights[a["id"]]
        g["cells"] = [x + y for x, y in zip(g["cells"], cells)]
        rows.append({"type": "item", "code": w["code"], "name": w["name"], "weight": weights[a["id"]], "cells": cells, "progress": a["progress"]})
    planned = [sum(r["cells"][k] for r in rows if r["type"] == "item") for k in range(weeks)]
    cumulative, total = [], 0.0
    for x in planned:
        total += x
        cumulative.append(round(total, 2))
    return {"rows": [{**r, "weight": round(r["weight"], 2), "cells": [round(x, 3) for x in r["cells"]]} for r in rows],
            "planned": [round(x, 2) for x in planned], "planned_cum": cumulative, "weights_from": source, **_frame(acts, start, weeks)}


def _frame(acts: dict[str, dict], start: str, weeks: int) -> dict:
    """What every Kurva-S has around its grid: its weeks, today, and the actual points measured."""
    today = P.TODAY
    now = 0 if today < start else min(weeks, P.days_between(start, today) // 7 + 1)
    points = {0: 0.0}
    marks = {r["week"]: r for r in P.all_of("actual_week")}
    site = sorted((r for r in marks.values() if r.get("progress") is not None), key=lambda r: r["week"])
    if site:  # what the site records stands: the board's reading does not sit between its weeks
        done = 0.0
        for r in site:
            done += r["progress"]
            points[min(weeks, r["week"])] = done
    else:
        for snap in P.all_of("snapshot"):
            if snap.get("planned_any") and snap.get("today", "") >= start:
                points[min(weeks, P.days_between(start, snap["today"]) // 7 + 1)] = snap["progress"]
        if now:
            points[now] = kurva_actual(list(acts.values()))
    known = sorted(points.items())
    spent, cost_weekly, cost_cum = 0, {}, {}
    for w in sorted(marks):
        c = sum((marks[w].get("costs") or {}).values())
        if c:
            spent += c
            cost_weekly[w], cost_cum[w] = c, spent
    return {"start": start, "weeks": weeks, "week_starts": [(date.fromisoformat(start) + timedelta(days=7 * k)).isoformat() for k in range(weeks)], "current_week": now, "today": today,
            "actual": [[w, round(v, 2)] for w, v in known], "actual_weekly": {w: round(v - known[n - 1][1], 2) for n, (w, v) in enumerate(known) if n},
            "recorded": marks, "site_recorded": bool(site), "cost_weekly": cost_weekly, "cost_cum": cost_cum, "spent_elsewhere": P.budget()["total"]["ac"] - spent, "board_progress": kurva_actual(list(acts.values())),
            "accounts": [{"id": a["id"], "name": a["name"], "budget": a["budget"]} for a in P.all_of("package")]}


def _on_the_schedule(official: tuple[dict, dict], acts: dict[str, dict], start: str) -> dict:
    """The contract's Kurva-S, row by row and week by week, as its document prints it. A row leads to the first work package made from it."""
    table, doc = official
    weeks, cum = table["weeks"], table["cumulative"]
    codes: dict[str, str] = {}
    for w in M.work_packages()["packages"]:
        if w.get("no"):
            codes.setdefault(str(w["no"]), str(w["code"]))
    code_of = lambda no: codes.get(no) or next((c for n, c in codes.items() if n.startswith(f"{no}.")), "")  # noqa: E731 - a row an agent split lives on in its pieces
    line = lambda cells: [float(cells.get(k + 1, 0)) for k in range(weeks)]  # noqa: E731
    rows = []
    for g in K.schedule_rows(table):
        sums = [sum(r["cells"].get(k + 1, 0) for r in g["rows"]) for k in range(weeks)]
        first = code_of(g["no"]) or next((code_of(r["no"]) for r in g["rows"] if code_of(r["no"])), "")
        solo = bool(g["weight"]) and not g["rows"]  # a group with no rows under it, such as one the schedule prints as a single line
        rows.append({"type": "solo" if solo else "group", "no": g["no"], "code": first, "name": g["name"], "weight": g["weight"] or round(sum(r["weight"] for r in g["rows"]), 2), "cells": line(g["cells"]) if solo else [round(x, 2) for x in sums]})
        rows.extend({"type": "item", "no": r["no"].split(".", 1)[1], "code": code_of(r["no"]) or first, "name": r["name"], "weight": r["weight"], "cells": line(r["cells"])} for r in g["rows"])
    planned = [round(cum[k] - (cum[k - 1] if k else 0.0), 2) for k in range(weeks)]
    return {"rows": rows, "planned": planned, "planned_cum": cum, "weights_from": "schedule", "source": {"doc": doc["id"], "title": doc.get("title", doc["id"]), "page": 1}, **_frame(acts, start, weeks)}


def recorded_progress() -> float | None:
    """How far the site says the job has got: the weeks recorded, added up. None until a week has a figure."""
    done = [r["progress"] for r in P.all_of("actual_week") if r.get("progress") is not None]
    return round(sum(done), 2) if done else None


def planned_at_last_record() -> float:
    """The plan at the last week with a progress figure: that figure says how far the job had got by then, so it is compared with then, as the Kurva-S does."""
    curve = kurva_s()["planned_cum"]
    return curve[min(len(curve), max(r["week"] for r in P.all_of("actual_week") if r.get("progress") is not None)) - 1]


def on_record(total: dict) -> dict | None:
    """The whole job measured by what the site recorded: the figures the report and cost control both show. None until a week has a progress figure, or where nothing
    is priced. The site gives one figure for the job, and work is not spread evenly over the accounts, so no account can be measured by it on its own."""
    site = recorded_progress()
    if site is None or not total["budget"]:
        return None
    planned = planned_at_last_record()
    ev, ac = round(total["budget"] * site / 100), total["ac"]
    cpi = ev / ac if ac else 1.0
    eac = round(ac + (total["budget"] - ev) / (cpi or 1) + total["recovery"]) if ac else total["budget"] + total["recovery"]
    return {"site": site, "ev": ev, "cpi": round(cpi, 2), "eac": eac, "variance": total["budget"] - eac, "spi": round(site / planned, 2) if planned >= 1 else None}  # below 1% planned, any progress would look many times ahead


def cost_control() -> dict:
    """The budget and costs, with the whole job measured by what the site recorded once it has, so it says what the report says."""
    b = P.budget()
    rec = on_record(b["total"])
    if rec:
        b["total"].update({k: rec[k] for k in ("ev", "cpi", "eac", "variance", "spi")})
        b["site_progress"] = rec["site"]
    elif b["total"]["pv"] < 0.01 * b["total"]["budget"]:
        b["total"]["spi"] = None  # a day into the job, a sliver of planned value would make any progress look a thousand times ahead
    return b


def set_actual(week: int, progress: float | None, costs: dict[str, int], note: str = "", who: str = P.PM) -> dict:
    """What the site really did in a week: the progress made, and the cost by control account, which goes into cost control like any cost already spent.
    Recording a week again replaces it, and recording nothing clears it."""
    if not 1 <= week <= kurva_s()["weeks"]:
        raise ValueError("there is no such week in the schedule")
    if progress is not None and progress < 0:
        raise ValueError("progress in a week cannot be below nothing: correct the week that overstated it")
    others = sum(r["progress"] for r in P.all_of("actual_week") if r.get("progress") is not None and r["week"] != week)
    if progress is not None and others + progress > 100.005:
        raise ValueError(f"that would make {others + progress:.2f}% done: the weeks recorded so far come to {others:.2f}%")
    for pid, amount in costs.items():
        if amount < 0:
            raise ValueError("a cost cannot be below nothing")
        if not P.get("package", pid):
            raise KeyError(pid)
    rid = f"W{week}"
    old = P.get("actual_week", rid)
    for iid in (old or {}).get("items", []):
        P.patch("cost_item", iid, {"status": "removed"}, who, "replaced a recorded cost", f"week {week}")
    costs = {pid: int(amount) for pid, amount in costs.items() if amount}
    if progress is None and not costs and not note.strip():
        if old:
            P.drop("actual_week", rid)
            P.log(who, "cleared a week's actuals", "actual_week", rid, f"week {week}")
        return {"week": week, "cleared": True}
    items = [P.add_cost_item(pid, f"Actual cost, week {week}", amount, source=f"Recorded for week {week} in the Kurva-S", who=who, actual=True)["id"] for pid, amount in costs.items()]
    rec = {"id": rid, "week": week, "progress": progress, "costs": costs, "items": items, "note": note.strip(), "who": who, "at": time.strftime("%Y-%m-%d %H:%M")}
    told = ", ".join(x for x in (f"{progress}% progress" if progress is not None else "", rp(sum(costs.values())) if costs else "") if x)
    return P.put("actual_week", rid, rec, who, "recorded a week's actuals", f"week {week}: {told or 'a note'}")


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
        out.append({"text": f"Send {len(vo)} variation{'s' if len(vo) != 1 else ''} to the owner, worth {rp(sum(v['value'] for v in vo))}", "go": "cost/control:variations", "tone": "info"})
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
        out.append({"text": "Set the contingency held against the risks", "go": "cost/control:contingency", "tone": "info"})
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
    site = recorded_progress()
    actual = site if site is not None else kurva_actual(acts)
    start = min(a["baseline_start"] for a in acts)
    official = master_schedule()
    at = (lambda day: on_schedule(official[0], start, day)) if official else (lambda day: planned_pct(acts, day))  # the contract's own curve where it can be read, so every screen says the same
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
    planned = round(planned_at_last_record() if site is not None else at(today), 1)
    planned_by = f"week {max(r['week'] for r in P.all_of('actual_week') if r.get('progress') is not None)}" if site is not None else "today"
    ev, eac, variance, cpi, spi = b["ev"], b["eac"], b["variance"], b["cpi"], b["spi"]
    rec = on_record(b)
    if rec:
        ev, eac, variance, cpi, spi = rec["ev"], rec["eac"], rec["variance"], rec["cpi"], rec["spi"]
        time_measured = spi is not None
    out.update(
        progress=actual, planned=planned, planned_by=planned_by, start=start, finish=finish, planned_finish=planned_finish, contract_finish=contract_finish, revised_finish=revised_finish, days_late=days_late,
        contract=contract, variations_approved=vo["totals"]["approved"], variations_pending=vo["totals"]["proposed"] + vo["totals"]["submitted"], revised=contract + vo["totals"]["approved"],
        days_approved=vo["days_approved"], budget=b["budget"], committed=b["committed"], ev=ev, ac=b["ac"], priced=priced, cost_measured=cost_measured, time_measured=time_measured,
        eac=eac if cost_measured else b["budget"], variance=variance if cost_measured else None, cpi=cpi if cost_measured else None, spi=spi if time_measured else None,
        contingency=cont["amount"], contingency_used=cont["used"], contingency_left=cont["left"],
        risks_open=len(risks), risks_extreme=extreme, risks_high=high,
        top_risks=[{"id": r["id"], "title": r["title"], "level": r["level"], "score": r["score"], "owner": r["owner"], "response": r.get("response", ""), "go": r.get("go", "")} for r in risks[:5]],
        milestones=[{"id": m["id"], "name": m.get("name") or m.get("title") or m["id"], "contract_date": m["contract_date"], "forecast": m["forecast"], "days_late": m["days_late"]} for m in sched["milestones"]][:8],
        curve=_curve(at, start, max(planned_finish, finish)), planned_from=official[1]["title"] if official else "", next_quarter={"name": name, "first": q_first, "last": q_last, "spend": spend(acts, budgets, q_first, q_last, today)},
        cash=[], to_spend=max(0, round((eac if cost_measured else b["budget"]) - b["ac"])),
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
        site = sorted((r for r in P.all_of("actual_week") if r.get("progress") is not None), key=lambda r: r["week"])
        if site:
            done, points = 0.0, []
            for r in site:
                done += r["progress"]
                points.append([_after(now["start"], 7 * r["week"] - 1), round(done, 2)])
            now["actual_curve"] = [[now["start"], 0.0], *points]
        else:
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


def changes_to_contract() -> dict:
    """The variations and the contingency, with what entering them can point at. Reading them saves nothing, unlike opening a report."""
    vo = variations()
    return {"variations": vo, "contingency_detail": contingency(), "days_approved": vo["days_approved"],
            "risk_ids": [{"id": r["id"], "title": r["title"]} for r in M._risks() if r["status"] not in OPEN_RISK][:40],
            "packages": [{"id": a["id"], "code": a["code"], "name": a["name"]} for a in P.schedule()["activities"]]}


def report() -> dict:
    photos = M.photos()["photos"]
    now = month()
    this = [p for p in photos if (p.get("date") or "").startswith(now["period"])]
    return {**now, **changes_to_contract(), "photos": (this or photos)[:12], "photos_this_month": bool(this), "events": events()}


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


class WeekIn(BaseModel):
    progress: float | None = None
    costs: dict[str, int] = {}
    note: str = ""


class AmountIn(BaseModel):
    amount: int


class UseIn(BaseModel):
    amount: int
    reason: str
    risk: str = ""


@router.get("/api/project/report")
def project_report() -> dict:
    return report()


@router.get("/api/project/changes")
def contract_changes() -> dict:
    return changes_to_contract()


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


@router.get("/api/project/kurva-s")
def kurva() -> dict:
    return kurva_s()


@router.post("/api/project/actuals/{week}")
def actuals(week: int, body: WeekIn) -> dict:
    return _guarded(set_actual, week, body.progress, body.costs, body.note)


@router.get("/api/reports/portfolio")
def portfolio_report() -> dict:
    return portfolio()

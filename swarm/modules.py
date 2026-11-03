"""The eight modules as one system. The WBS is the spine: every record hangs on it by its activity or work package, so each module answers its own question about the same work.

    WBS                what is the work?
    Schedule           when should it happen?
    BOQ and cost       what does it need, and what does it cost?
    Documents and RFI  is the technical information ready?
    Kanban             who is doing it today, and what is stopping them?
    Procurement        is the material and the crew there?
    QA/QC              was it done right?
    Control tower      how does the whole project stand?

Everything here is worked out by code from the records, and only reads them. People change records through project.py.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, timedelta
from typing import Any

from . import extract
from . import planning_case as PC
from . import project as P
from . import regulations as REG
from . import site_case as C
from .data import ProjectData

# which documents of the scenario bear on which activities: a reading of the case, not of any one record
DOC_LINKS = {"DOC-ITP-07": ["A20", "A30"], "DOC-QA-11": ["A30"], "DOC-SPEC-04": ["A30"], "DOC-ENG-03": ["A30"], "DOC-WX-02": ["A30"], "DOC-GC-27": ["A90"], "DOC-PO-118": ["A30"], "DOC-SUB-RANGKA": ["A50", "A60", "A70"], "DOC-SUB-BESI": ["A20", "A80"], "DOC-ROSTER": ["A30"]}
ROLLED = ("tasks", "proposed", "open", "doing", "review", "done", "stopped", "overdue", "man_hours", "planned_cost", "rfis", "drafts", "ncrs", "inspections", "inspections_passed", "orders", "orders_late")


def live_plan() -> dict | None:
    """The plan the site works to: the approved one, or else the one waiting for a person."""
    rows = list(reversed(P.all_of("plan")))
    rec = next((r for r in rows if r["status"] == "approved"), None) or next((r for r in rows if r["status"] == "pending"), None)
    return P.plan_view(rec) if rec else None


def pending_plan() -> dict | None:
    rec = next((r for r in reversed(P.all_of("plan")) if r["status"] == "pending"), None)
    return P.plan_view(rec) if rec else None


def _plus(day: str, days: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def _task_dates(plan: dict, step: dict, acts: dict[str, dict]) -> tuple[str, str]:
    """A task's dates follow its plan's first activity, or its own where the plan places them so, so when the schedule moves its tasks move with it."""
    first = acts.get(step.get("activity") or "") if plan.get("anchor") == "activity" else None
    first = first or next((acts[a] for a in plan["activities"] if a in acts), None)
    anchor = first["start"] if first else P.TODAY
    hours = plan["totals"]["hours_per_oh"]
    return _plus(anchor, int(max(0, step["start_h"]) // hours)), _plus(anchor, int(max(0, step["finish_h"] - 0.01) // hours))


# ------------------------------------------------------------------------------------------------ the board


def _context() -> dict[str, Any]:
    sched = P.schedule()
    rec = next((r for r in reversed(P.all_of("plan")) if r["status"] == "approved"), None)
    plan = P.plan_view(rec) if rec else None
    items = P.all_of("work_item")
    orders = P.all_of("po")
    docs = _static_documents() + [d for d in P.all_of("document") if d.get("source") == "upload"]
    return {"sched": sched, "acts": {a["id"]: a for a in sched["activities"]}, "rec": plan, "plan": plan["plan"] if plan else None, "steps": {s["id"]: s for s in plan["plan"]["steps"]} if plan else {},
            "by_step": {w["step"]: w for w in items if w.get("step") and plan and w.get("plan") == plan["id"] and w["status"] in P.TASK_STATUS}, "items": items, "rfis": P.all_of("rfi"), "ncrs": P.all_of("ncr"), "orders": orders,
            "inspections": P.all_of("inspection"), "subs": {s["id"]: s for s in P.subcontractors()}, "superseded": extract.superseded(docs),
            "requests": {o["material"]: o for o in orders if plan and o.get("plan") == plan["id"] and o.get("material")}}


def _rfi_touches(r: dict, step: dict | None, ctx: dict) -> bool:
    """An RFI holds the tasks that name it. If none does, it holds the whole activity."""
    named = [s["id"] for s in ctx["steps"].values() if s["activity"] == r.get("activity") and (r["id"] in (s.get("procedure") or "") or r["id"] in (s.get("evidence") or []))]
    return step["id"] in named if step and named else True


def _blockers(w: dict, ctx: dict) -> list[dict]:
    """Why this card cannot simply go on. stop: a rule says no. Otherwise it is a warning a person can weigh."""
    if w["status"] == "done":
        return []
    out = [{**b, "stop": True} for b in P.stops_of(w)]
    step = ctx["steps"].get(w.get("step")) if w.get("plan") == (ctx["rec"] or {}).get("id") else None
    for a in step["after"] if step else []:
        t = ctx["by_step"].get(a)
        if t and t["status"] != "done":
            out.append({"kind": "wait", "ref": a, "text": f"Waits for {a}: {t['title']}", "stop": False, "go": f"kanban/board:{t['id']}"})
    act = ctx["acts"].get(w.get("activity") or "")
    if act and w.get("physical") and not (step and step["after"]):
        for p in act["predecessors"]:
            before = ctx["acts"].get(p)
            if before and before["progress"] < 100:
                out.append({"kind": "activity", "ref": p, "text": f"{p} must finish first: {before['name']}, forecast {before['finish']}", "stop": False, "go": f"schedule/gantt:{p}"})
    if w.get("physical"):
        for r in ctx["rfis"]:
            if r["status"] == "open" and r.get("activity") == w.get("activity") and _rfi_touches(r, step, ctx):
                out.append({"kind": "rfi", "ref": r["id"], "text": f"{r['id']} is open: {r['subject']}", "stop": False, "go": f"documents/rfis:{r['id']}"})
        for n in ctx["ncrs"]:
            if n["status"] == "open" and n.get("activity") == w.get("activity") and not n.get("inspection"):
                out.append({"kind": "ncr", "ref": n["id"], "text": f"{n['id']} is open: {n['title']}", "stop": False, "go": f"quality/ncrs:{n['id']}"})
    for m in (step or {}).get("materials") or []:
        o = ctx["requests"].get(m["key"])
        if o and o["status"] != "received":
            state = "not ordered yet" if o["status"] == "requested" else f"arrives {o['promised']}" if o["promised"] else "on order"
            out.append({"kind": "material", "ref": o["id"], "text": f"{m['name']}: {state} ({o['id']})", "stop": False, "go": f"procurement/orders:{o['id']}"})
    sub = ctx["subs"].get(w.get("by") or "")
    if sub and sub["expired"]:
        out.append({"kind": "subcontractor", "ref": sub["id"], "text": f"{sub['name'].replace(' (fictional)', '')}: {sub['expired'][0]} has expired", "stop": False, "go": f"procurement/subs:{sub['id']}"})
    for e in (step or {}).get("evidence") or []:
        if e in ctx["superseded"]:
            out.append({"kind": "document", "ref": e, "text": f"Cites {e}, replaced by {ctx['superseded'][e]}", "stop": False, "go": f"documents/register:{e}"})
    return out


def _card(w: dict, ctx: dict) -> dict:
    step = ctx["steps"].get(w.get("step")) if w.get("plan") == (ctx["rec"] or {}).get("id") else None
    due, start = w.get("due") or "", ""
    if step and ctx["plan"]:
        start, computed = _task_dates(ctx["plan"], step, ctx["acts"])
        due = due if w.get("due_set") else computed
    blockers = _blockers(w, ctx)
    act = ctx["acts"].get(w.get("activity") or "")
    return {**w, "type": "task" if w.get("physical") else "action", "due": due, "start": start, "overdue": bool(due and due < P.TODAY and w["status"] != "done"), "blockers": blockers, "stopped": any(b["stop"] for b in blockers), "blocked": bool(blockers),
            "activity_name": act["name"] if act else "", "package": act["package"] if act else "", "wbs": w.get("code") or (act["code"] if act else ""), "critical": bool(step["critical"]) if step else bool(act and act["critical"] and w.get("physical"))}


def _activity_status(progress: int) -> str:
    return "done" if progress >= 100 else "review" if progress >= 90 else "doing" if progress > 0 else "open"


def _activity_stops(aid: str, ctx: dict) -> list[dict]:
    """An activity cannot go on while an inspection on it, or on anything it waits for, has failed."""
    out, seen, stack = [], set(), [aid]
    while stack:
        a = stack.pop()
        if a in seen or a not in ctx["acts"]:
            continue
        seen.add(a)
        stack += ctx["acts"][a]["predecessors"]
        for i in ctx["inspections"]:
            if i.get("activity") == a and i["status"] == "failed":
                out.append({"kind": "failed", "ref": i.get("ncr") or i["id"], "text": f"{i['id']} failed on {a}: {i.get('ncr') or 'its NCR'} must close first", "go": f"quality/ncrs:{i.get('ncr') or ''}", "stop": True})
    return out


def _activity_card(a: dict, ctx: dict) -> dict:
    """An activity nobody has broken down yet is still work on the board: one card, moved by hand, that keeps its progress in the schedule."""
    status = _activity_status(a["progress"])
    blockers = [] if status == "done" else _activity_stops(a["id"], ctx)
    if status != "done":
        for p in a["predecessors"]:
            before = ctx["acts"].get(p)
            if before and before["progress"] < 100:
                blockers.append({"kind": "activity", "ref": p, "text": f"{p} must finish first: {before['name']}, forecast {before['finish']}", "stop": False, "go": f"schedule/gantt:{p}"})
        blockers += [{"kind": "rfi", "ref": x, "text": f"{x} is open", "stop": False, "go": f"documents/rfis:{x}"} for x in a["rfis"]]
        blockers += [{"kind": "ncr", "ref": x, "text": f"{x} is open", "stop": False, "go": f"quality/ncrs:{x}"} for x in a["ncrs"] if not any(b["ref"] == x for b in blockers)]
        for x in a["pos"]:
            o = next(o for o in ctx["orders"] if o["id"] == x)
            if o["promised"] > o["needed"]:
                blockers.append({"kind": "material", "ref": x, "text": f"{x} arrives {o['promised']}, needed {o['needed']}", "stop": False, "go": f"procurement/orders:{x}"})
    return {"id": a["id"], "title": a["name"], "owner": a["by_name"].replace(" (fictional)", ""), "by": a["by"], "due": a["finish"], "start": a["start"], "activity": a["id"], "status": status, "progress": a["progress"], "type": "activity", "kind": "activity", "wbs": a["code"], "package": a["package"], "activity_name": a["name"],
            "critical": a["critical"], "overdue": a["finish"] < P.TODAY and status != "done", "blockers": blockers, "stopped": any(b["stop"] for b in blockers), "blocked": bool(blockers), "physical": True}


def _downstream(ctx: dict) -> dict[str, set[str]]:
    following: dict[str, list[str]] = {}
    for s in ctx["steps"].values():
        for a in s["after"]:
            following.setdefault(a, []).append(s["id"])
    out: dict[str, set[str]] = {}
    for sid in ctx["steps"]:
        seen: set[str] = set()
        stack = list(following.get(sid, []))
        while stack:
            x = stack.pop()
            if x not in seen:
                seen.add(x)
                stack += following.get(x, [])
        out[sid] = seen
    return out


def _bottlenecks(cards: list[dict], ctx: dict) -> list[dict]:
    """What is holding the most work, worked out from the cards: each root cause once, with everything waiting behind it, and the worst first. An activity that is itself held is a symptom, so its cause is what is named."""
    after = _downstream(ctx)
    by_step = {c["step"]: c for c in cards if c.get("step")}
    following = {a["id"]: [x["id"] for x in ctx["sched"]["activities"] if a["id"] in x["predecessors"]] for a in ctx["sched"]["activities"]}
    held_activity = {c["activity"] for c in cards if c["type"] == "activity" and c["blockers"]}
    rows: dict[tuple[str, str], dict] = {}
    for c in cards:
        for b in c["blockers"]:
            if b["kind"] == "wait" or (b["kind"] == "activity" and b["ref"] in held_activity):
                continue
            unordered = b["kind"] == "material" and "not ordered" in b["text"]  # the requests of one plan are one job for procurement, not twelve causes
            key = ("material", "requests") if unordered else (b["kind"], b["ref"])
            row = rows.setdefault(key, {"kind": b["kind"], "ref": key[1], "text": "Material the plan needs is not ordered yet" if unordered else b["text"], "go": "procurement/materials" if unordered else b["go"], "stop": b["stop"], "cards": {}})
            row["cards"][c["id"]] = c
            for sid in after.get(c.get("step"), ()):  # what waits behind this card waits for the same cause
                if sid in by_step and by_step[sid]["status"] != "done":
                    row["cards"][by_step[sid]["id"]] = by_step[sid]
            if c["type"] == "activity":  # and so does all the work after it in the programme
                stack, seen = list(following.get(c["id"], [])), set()
                while stack:
                    x = stack.pop()
                    if x not in seen:
                        seen.add(x)
                        stack += following.get(x, [])
                for k in cards:
                    if k.get("activity") in seen and k.get("physical") and k["status"] != "done":
                        row["cards"][k["id"]] = k
    out = []
    for row in rows.values():
        held = list(row.pop("cards").values())
        critical = sum(1 for c in held if c.get("critical"))
        out.append({**row, "held": len(held), "critical": critical, "man_hours": round(sum(c.get("man_hours") or 0 for c in held), 1), "cards": [c["id"] for c in held][:30], "level": "high" if row["stop"] or critical else "medium" if len(held) > 2 else "low"})
    capacity: dict[str, int] = {}
    for c in cards:
        if c["status"] == "doing" and c.get("by") in ctx["subs"]:
            capacity[c["by"]] = capacity.get(c["by"], 0) + (c.get("crew_size") or 0)
    for sid, n in capacity.items():
        s = ctx["subs"][sid]
        if n > s["crew"]:
            out.append({"kind": "capacity", "ref": sid, "text": f"{s['name'].replace(' (fictional)', '')} has {n} people's work in progress and a crew of {s['crew']}", "go": f"procurement/assignments:{sid}", "stop": False, "held": sum(1 for c in cards if c.get("by") == sid and c["status"] == "doing"), "critical": 0, "man_hours": 0, "cards": [c["id"] for c in cards if c.get("by") == sid and c["status"] == "doing"], "level": "high"})
    waiting = [c for c in cards if c["status"] == "review"]
    if len(waiting) > 2:
        out.append({"kind": "review", "ref": "review", "text": f"{len(waiting)} tasks are waiting for inspection", "go": "quality/inspections", "stop": False, "held": len(waiting), "critical": sum(1 for c in waiting if c.get("critical")), "man_hours": 0, "cards": [c["id"] for c in waiting], "level": "medium"})
    late = [c for c in cards if c["overdue"]]
    if late:
        out.append({"kind": "overdue", "ref": "overdue", "text": f"{len(late)} tasks are past their due date", "go": "kanban/board", "stop": False, "held": len(late), "critical": sum(1 for c in late if c.get("critical")), "man_hours": 0, "cards": [c["id"] for c in late], "level": "high"})
    rank = {"high": 0, "medium": 1, "low": 2}
    return sorted(out, key=lambda x: (rank[x["level"]], not x["stop"], -x["critical"], -x["held"]))


def board() -> dict:
    """The Kanban board: every plan task and agreed action, and every activity not yet broken down."""
    ctx = _context()
    cards = [_card(w, ctx) for w in ctx["items"] if w["status"] in (*P.TASK_STATUS, "proposed")]
    tasked = {c["activity"] for c in cards if c.get("physical") and c["status"] != "proposed"}
    cards += [_activity_card(a, ctx) for a in ctx["sched"]["activities"] if a["id"] not in tasked]
    waiting = pending_plan()
    acts = ctx["acts"]

    def cpm_key(c: dict) -> tuple:
        a = acts.get(c.get("activity") or {}) or {}
        return (not c["critical"], c.get("start") or a.get("start") or "9999-99-99", a.get("float_days", 9999), c.get("wbs") or c["id"])

    queue = sorted((c for c in cards if c["status"] in ("open", "doing", "review")), key=cpm_key)
    for n, c in enumerate(queue, 1):
        c["cpm_rank"] = n
        a = acts.get(c.get("activity") or {}) or {}
        c["float_days"] = a.get("float_days")
    top = next((c for c in queue if c["critical"]), None)
    owners = sorted({c["owner"] for c in cards if c.get("owner")})
    live = [c for c in cards if c["status"] in P.TASK_STATUS]
    return {"today": P.TODAY, "cards": cards, "bottlenecks": _bottlenecks([c for c in cards if c["status"] != "proposed"], ctx), "owners": owners, "subs": [{"id": s["id"], "name": s["name"].replace(" (fictional)", "")} for s in ctx["subs"].values()],
            "plan": {k: ctx["rec"][k] for k in ("id", "title", "status")} if ctx["rec"] else None, "waiting": {"id": waiting["id"], "title": waiting["title"], "tasks": len(waiting["plan"]["steps"])} if waiting else None,
            "priority": {"id": top["id"], "title": top["title"], "wbs": top["wbs"], "activity": top["activity"], "start": top.get("start") or "", "float_days": top.get("float_days"), "rank": top["cpm_rank"]} if top else None,
            "counts": {"open": sum(1 for c in live if c["status"] == "open"), "doing": sum(1 for c in live if c["status"] == "doing"), "review": sum(1 for c in live if c["status"] == "review"), "done": sum(1 for c in live if c["status"] == "done"), "stopped": sum(1 for c in live if c["stopped"]), "overdue": sum(1 for c in live if c["overdue"]), "proposed": sum(1 for c in cards if c["status"] == "proposed")}}


def move_activity_card(aid: str, status: str, who: str = P.PM) -> dict:
    ctx = _context()
    if aid not in ctx["acts"]:
        raise KeyError(aid)
    if status != "open":
        stops = _activity_stops(aid, ctx)
        if stops:
            raise ValueError(stops[0]["text"])
        waiting = [p for p in ctx["acts"][aid]["predecessors"] if (ctx["acts"].get(p) or {}).get("progress", 100) < 100]
        if waiting:
            before = ctx["acts"][waiting[0]]
            raise ValueError(f"cannot start: {waiting[0]} must finish first: {before['name']}, forecast {before['finish']}")
    current = ctx["acts"][aid]["progress"]
    value = {"open": 0, "doing": current if 0 < current < 90 else 10, "review": 95, "done": 100}.get(status)
    if value is None:
        raise ValueError("status must be open, doing, review or done")
    return P.update_activity(aid, value, None, who=who)


# ------------------------------------------------------------------------------------------------ the WBS


def _blank_roll() -> dict:
    return dict.fromkeys(ROLLED, 0)


def _roll(node: dict) -> dict:
    total = {**_blank_roll(), **{k: node.get("own", {}).get(k, 0) for k in ROLLED}}
    for child in node.get("children") or []:
        below = _roll(child)
        for k in ROLLED:
            total[k] += below[k]
    node["roll"] = {k: round(v, 1) if isinstance(v, float) else v for k, v in total.items()}
    node.pop("own", None)
    return total


def tree() -> dict:
    """The project's whole breakdown, with what every module knows about each node rolled up it."""
    ctx = _context()
    sched, acts = ctx["sched"], ctx["acts"]
    money = {p["id"]: p for p in P.budget()["packages"]}
    subs = {s["id"]: s["name"].replace(" (fictional)", "") for s in ctx["subs"].values()}
    who = lambda by: subs.get(by, "Own crew" if by == "self" else by or "")  # noqa: E731
    plan = live_plan()
    answers = _package_info(plan)
    cards = {c["id"]: c for c in (_card(w, ctx) for w in ctx["items"] if w["status"] in (*P.TASK_STATUS, "proposed"))}
    by_step = {c["step"]: c for c in cards.values() if c.get("step") and plan and c.get("plan") == plan["id"]}
    children = []
    for p in P.all_of("package"):
        kids = []
        for aid in p["activities"]:
            a = acts.get(aid)
            if not a:
                continue
            node = {"code": a["code"], "type": "activity", "ref": aid, "name": a["name"], "by": a["by"], "by_name": a["by_name"].replace(" (fictional)", ""), "start": a["start"], "finish": a["finish"], "duration": a["duration"], "critical": a["critical"], "float_days": a["float_days"], "progress": a["progress"], "progress_from": a["progress_from"], "package": p["id"],
                    "milestones": [m for m in sched["milestones"] if m["activity"] == aid], "ready": readiness_of(a, ctx), "children": [],
                    "own": {**_blank_roll(), "rfis": len(a["rfis"]), "drafts": sum(1 for r in ctx["rfis"] if r["status"] == "draft" and r.get("activity") == aid), "ncrs": len(a["ncrs"]), "inspections": sum(1 for i in ctx["inspections"] if i.get("activity") == aid), "inspections_passed": sum(1 for i in ctx["inspections"] if i.get("activity") == aid and i["status"] == "passed"),
                            "orders": sum(1 for o in ctx["orders"] if o.get("activity") == aid and o["status"] != "cancelled"), "orders_late": sum(1 for o in ctx["orders"] if o.get("activity") == aid and o["status"] not in ("received", "cancelled") and o["promised"] > o["needed"])}}
            branch = next((b for b in plan["plan"]["tree"] if b["activity"] == aid), None) if plan else None
            for sec in branch["sections"] if branch else []:
                tasks = []
                steps = {s["id"]: s for s in plan["plan"]["steps"]}
                for sid in sec["tasks"]:
                    s = steps[sid]
                    c = by_step.get(sid)
                    start, finish = _task_dates(plan["plan"], s, acts)
                    status = c["status"] if c else "proposed"
                    tasks.append({"code": s["code"], "type": "task", "ref": sid, "name": s["name"], "kind": s["kind"], "by": s["by"], "by_name": answers.get(aid, {}).get("responsible") or who(s["by"]), "start": start, "finish": finish, "critical": s["critical"], "hold_point": s["hold_point"], "itp": s["itp"], "status": status, "card": c["id"] if c else None, "progress": 100 if status == "done" else (c or {}).get("progress") or 0, "hours": s["hours"], "crew_size": s["crew_size"], "package": p["id"], "activity": aid,
                                  "own": {**_blank_roll(), "tasks": 1, status: 1, "man_hours": s["man_hours"], "planned_cost": s["labour_cost"] + s["material_cost"], "stopped": 1 if c and c["stopped"] else 0, "overdue": 1 if c and c["overdue"] else 0}})
                node["children"].append({"code": sec["code"], "type": "section", "ref": sec["id"], "name": sec["name"], "by": sec["by"], "by_name": answers.get(aid, {}).get("responsible") or who(sec["by"]), "package": p["id"], "activity": aid, "children": tasks})
            extra = [c for c in cards.values() if c.get("physical") and not c.get("step") and c.get("activity") == aid]
            for n, c in enumerate(extra, len(node["children"]) + 1):
                node["children"].append({"code": f"{a['code']}.{n}", "type": "task", "ref": c["id"], "name": c["title"], "kind": "operation", "by": c.get("by") or "", "by_name": c.get("owner") or "", "start": "", "finish": c["due"], "critical": False, "status": c["status"], "card": c["id"], "progress": 100 if c["status"] == "done" else c.get("progress") or 0, "package": p["id"], "activity": aid,
                                         "own": {**_blank_roll(), "tasks": 1, c["status"]: 1, "stopped": 1 if c["stopped"] else 0, "overdue": 1 if c["overdue"] else 0}})
            kids.append(node)
        spans = [acts[x] for x in p["activities"] if x in acts]
        total = sum(a["duration"] for a in spans)
        row = money.get(p["id"], {})
        children.append({"code": P.wbs_codes()[p["id"]], "type": "package", "ref": p["id"], "name": p["name"], "by": p.get("sub") or "self", "by_name": next((answers[x]["responsible"] for x in p["activities"] if answers.get(x, {}).get("responsible")), "") or who(p.get("sub") or "self"), "start": min((a["start"] for a in spans), default=""), "finish": max((a["finish"] for a in spans), default=""), "critical": any(a["critical"] for a in spans), "progress": round(sum(a["progress"] * a["duration"] for a in spans) / total) if total else 0, "package": p["id"],
                         "cost": {k: row.get(k) for k in ("budget", "committed", "ev", "ac", "eac", "variance", "cpi", "spi")}, "children": kids})
    info = P.C_PROJECT()
    spans = sched["activities"]
    total = sum(a["duration"] for a in spans)
    root = {"code": "1", "type": "project", "ref": "project", "name": info["name"].replace(" (fictional)", ""), "start": min((a["start"] for a in spans), default=""), "finish": max((a["finish"] for a in spans), default=""), "progress": round(sum(a["progress"] * a["duration"] for a in spans) / total) if total else 0, "children": children}
    _roll(root)
    return {"today": P.TODAY, "project": info, "root": root, "milestones": sched["milestones"], "plan": {k: plan[k] for k in ("id", "title", "status", "mode")} if plan else None, "scenario": not P.is_blank(), "subs": [{"id": s["id"], "name": s["name"].replace(" (fictional)", "")} for s in ctx["subs"].values()], "activities": [{"id": a["id"], "name": a["name"], "code": a["code"]} for a in spans], "packages": [{"id": p["id"], "name": p["name"]} for p in P.all_of("package")]}


def _find(node: dict, code: str) -> dict | None:
    if node["code"] == code:
        return node
    for child in node.get("children") or []:
        hit = _find(child, code)
        if hit:
            return hit
    return None


def _by_ref(node: dict, ref: str, kind: str = "") -> dict | None:
    if node.get("ref") == ref and (not kind or node["type"] == kind):
        return node
    for child in node.get("children") or []:
        hit = _by_ref(child, ref, kind)
        if hit:
            return hit
    return None


def _resolve_foreign(root: dict, code: str) -> dict | None:
    """A code that is not in the live tree, made sense of: a record id (AC-031, WP-013), or a code from a plan document's own numbering (its branches, sections and steps, from any plan on the project, not only the live one). It resolves to the live node for the same work, so a click in an older plan still lands somewhere true."""
    codes = P.wbs_codes()
    if code in codes:
        return _find(root, codes[code])
    hit = _by_ref(root, code)
    if hit:
        return hit
    for rec in P.all_of("plan"):
        plan = (P.plan_view(rec).get("plan") or {}) if rec.get("plan") else {}  # the codes live in the view: the record stores steps unnumbered
        for branch in plan.get("tree") or []:
            if branch.get("code") == code and branch.get("activity"):
                return _by_ref(root, branch["activity"], "activity")
            for sec in branch.get("sections") or []:
                if sec.get("code") == code:
                    return _by_ref(root, sec.get("id") or "", "section") or _by_ref(root, branch.get("activity") or "", "activity")
        for step in plan.get("steps") or []:
            if step.get("code") == code:
                return _by_ref(root, step["id"], "task") or _by_ref(root, step.get("activity") or "", "activity")
    return None


def _refs(node: dict, kind: str) -> list[str]:
    out = [node["ref"]] if node["type"] == kind else []
    for child in node.get("children") or []:
        out += _refs(child, kind)
    return out


def node_detail(code: str) -> dict:
    """One node of the WBS with everything every module holds on it."""
    whole = tree()
    node = _find(whole["root"], code) or _resolve_foreign(whole["root"], code)
    if not node:
        raise KeyError(code)
    activities = set(_refs(node, "activity")) or ({node["activity"]} if node.get("activity") else set())
    if node["type"] == "project":
        package = None
    else:
        package = node.get("package")
    steps = set(_refs(node, "task"))
    ctx = _context()
    wide = node["type"] in ("project", "package", "activity")
    keep = lambda r: node["type"] == "project" or r.get("activity") in activities  # noqa: E731
    cards = [c for c in board()["cards"] if (c.get("step") in steps or c["id"] in steps) or (wide and keep(c))]
    out = {"node": {k: v for k, v in node.items() if k != "children"}, "children": [{k: c.get(k) for k in ("code", "type", "ref", "name", "status", "progress", "start", "finish", "critical", "by_name", "roll", "kind", "hold_point")} for c in node.get("children") or []], "activities": [a for a in ctx["sched"]["activities"] if a["id"] in activities or node["type"] == "project"], "cards": cards,
           "rfis": [r for r in P.all_of("rfi") if keep(r)], "ncrs": [n for n in P.all_of("ncr") if keep(n)], "inspections": [i for i in P.all_of("inspection") if keep(i) and (wide or i.get("step") in steps or node["type"] == "section" and i.get("step") in steps)], "orders": [o for o in P.all_of("po") if (keep(o) or (wide and package and o.get("package") == package)) and o["status"] != "cancelled"],
           "documents": [{k: d[k] for k in ("id", "title", "kind", "status")} for d in documents()["documents"] if node["type"] == "project" or set(d["activities"]) & activities], "reports": [r for r in P.daily_reports() if r.get("activity") in activities or (wide and package and r.get("package") == package)][:12]}
    plan = live_plan()
    if node["type"] in ("package", "activity"):
        out["change"] = P.changes_allowed(node["type"], node["ref"])
    if node["type"] == "task":
        held = {b["ref"] for c in cards for b in c["blockers"]}
        out["rfis"] = [r for r in out["rfis"] if r["id"] in held]
        out["ncrs"] = [n for n in out["ncrs"] if n["id"] in held]
        out["orders"] = [o for o in out["orders"] if node["ref"] in (o.get("steps") or [])]
        out["reports"] = []
    if node["type"] == "task" and plan:
        step = next((s for s in plan["plan"]["steps"] if s["id"] == node["ref"]), None)
        out["step"] = step
        out["plan"] = {k: plan[k] for k in ("id", "title", "status")}
        out["flags"] = [f for f in plan["plan"]["waste_flags"] if f["step"] == node["ref"]]
    return out


# ------------------------------------------------------------------------------------------------ documents


def _static_documents() -> list[dict]:
    """The scenario's documents: the consultant's package and the project's own. A project of your own has only what you upload."""
    if P.is_blank():
        return []
    package = [{"id": d["id"], "kind": d["kind"], "title": d["title"], "from": d["from"], "date": d["date"], "text": d["text"], "source": "package", "activities": list(PC.SCOPE["activities"])} for d in PC.DOCUMENTS]
    project = [{"id": d["id"], "kind": d["kind"], "title": d["title"], "from": "Project file", "date": "", "text": d["text"], "source": "project", "activities": DOC_LINKS.get(d["id"], [])} for d in C.DOCUMENTS]
    return package + project


def documents() -> dict:
    """The register: every document, what it states, whether it is in force, who approved it, and what cites it."""
    overlay = {d["id"]: d for d in P.all_of("document")}
    rows = _static_documents() + [{"source": "upload", **d} for d in overlay.values() if d.get("source") == "upload"]
    gone = extract.superseded(rows)
    plan = live_plan()
    cited: dict[str, list[str]] = {}
    for s in plan["plan"]["steps"] if plan else []:
        for e in s["evidence"]:
            cited.setdefault(e, []).append(s["id"])
    findings = plan["findings"] if plan else []
    rfis = P.all_of("rfi")
    out = []
    for d in rows:
        o = overlay.get(d["id"]) or {}
        status = "superseded" if d["id"] in gone else o.get("status") or ("received" if d.get("source") == "upload" else "current")
        out.append({**{k: v for k, v in d.items() if k != "text"}, "status": status, "replaced_by": gone.get(d["id"], ""), "decided_by": o.get("decided_by", ""), "decided_on": o.get("decided_on", ""), "note": o.get("note", ""), "facts": d.get("facts") or extract.facts(d.get("text") or ""), "length": len(d.get("text") or ""), "cited_by": cited.get(d["id"], []), "findings": [{"tag": f["tag"], "note": f["note"]} for f in findings if d["id"] in f["evidence"]],
                    "rfis": [r["id"] for r in rfis if d["id"] in (r.get("question") or "") or (r["id"] in (d.get("text") or ""))], "reading": o.get("reading"), "wbs": [x for x in (d.get("activities") or [])]})
    return {"today": P.TODAY, "documents": out, "counts": {s: sum(1 for d in out if d["status"] == s) for s in ("current", "received", "approved", "rejected", "superseded")}, "activities": [{"id": a["id"], "name": a["name"]} for a in P.schedule()["activities"]]}


def document_text(did: str) -> dict:
    d = next((x for x in _static_documents() if x["id"] == did), None) or P.get("document", did)
    if not d or (d.get("source") != "upload" and "text" not in d):
        raise KeyError(did)
    return {"id": did, "title": d.get("title", ""), "text": d.get("text", "")}


def decide_document(did: str, status: str, note: str = "", who: str = P.PM) -> dict:
    if status not in ("approved", "rejected", "received", "current"):
        raise ValueError("status must be approved, rejected or received")
    known = next((x for x in _static_documents() if x["id"] == did), None)
    o = P.get("document", did)
    if not known and not o:
        raise KeyError(did)
    title = (known or o)["title"]
    return P.put("document", did, {**(o or {"id": did}), "status": status, "decided_by": who, "decided_on": P.TODAY, "note": note}, who, f"marked a document {status}", title)


def link_document(did: str, activity: str, who: str = P.PM) -> dict:
    o = P.get("document", did)
    if not o or o.get("source") != "upload":
        raise KeyError(did)
    if activity not in {a[0] for a in P.activity_rows()}:
        raise ValueError(f"no such activity: {activity}")
    return P.patch("document", did, {"activities": sorted({*(o.get("activities") or []), activity})}, who, "linked a document", f"{o['title']} to {activity}")


def readiness_of(a: dict, ctx: dict) -> dict:
    """Is the technical information ready for this activity? No while an RFI on it is open or still a draft, or the plan's tasks cite a replaced document."""
    reasons = [{"kind": "rfi", "ref": r["id"], "text": f"{r['id']} is {'still a draft' if r['status'] == 'draft' else 'open'}: {r['subject']}", "go": f"documents/rfis:{r['id']}"} for r in ctx["rfis"] if r.get("activity") == a["id"] and r["status"] in ("open", "draft")]
    for s in ctx["steps"].values():
        if s["activity"] == a["id"]:
            reasons += [{"kind": "document", "ref": e, "text": f"{s['id']} cites {e}, replaced by {ctx['superseded'][e]}", "go": f"documents/register:{e}"} for e in s["evidence"] if e in ctx["superseded"]]
    return {"ready": not reasons, "reasons": reasons}


def readiness() -> dict:
    ctx = _context()
    rows = [{"id": a["id"], "code": a["code"], "name": a["name"], "start": a["start"], "critical": a["critical"], "progress": a["progress"], "documents": sum(1 for d in documents()["documents"] if a["id"] in d["activities"] and d["status"] != "superseded"), **readiness_of(a, ctx)} for a in ctx["sched"]["activities"]]
    return {"today": P.TODAY, "activities": rows, "ready": sum(1 for r in rows if r["ready"]), "of": len(rows)}


# ------------------------------------------------------------------------------------------------ the schedule


def delays() -> list[dict]:
    """What code can see is late or going late, from the schedule, its baseline and the records holding each activity."""
    sched = P.schedule()
    following = {a["id"]: [x["id"] for x in sched["activities"] if a["id"] in x["predecessors"]] for a in sched["activities"]}
    out = []
    for a in sched["activities"]:
        moved = P.days_between(a["baseline_finish"], a["finish"])
        if moved > 0:
            out.append({"activity": a["id"], "kind": "moved", "level": "high" if a["critical"] else "medium", "days": moved, "text": f"{a['id']} now finishes {moved} day{'s' if moved != 1 else ''} after its baseline: {a['finish']} against {a['baseline_finish']}."})
        expected = P.expected_pct(a)
        if a["progress"] < 100 and a["start"] <= P.TODAY and expected - a["progress"] >= 10:
            out.append({"activity": a["id"], "kind": "behind", "level": "high" if a["critical"] else "medium", "days": 0, "text": f"{a['id']} is {a['progress']}% done and should be about {expected}% by today."})
        if a["progress"] < 100 and a["finish"] < P.TODAY:
            out.append({"activity": a["id"], "kind": "overdue", "level": "high", "days": P.days_between(a["finish"], P.TODAY), "text": f"{a['id']} should have finished on {a['finish']}."})
        holds = a["rfis"] + a["ncrs"] + [p for p in a["pos"] if (P.get("po", p) or {}).get("promised", "") > (P.get("po", p) or {}).get("needed", "")]
        if holds and a["critical"]:
            behind = len(following[a["id"]])
            out.append({"activity": a["id"], "kind": "held", "level": "high", "days": 0, "text": f"{a['id']} has no float and {', '.join(holds)} still open{f', with {behind} activity after it' if behind == 1 else f', with {behind} activities after it' if behind else ''}."})
    for m in sched["milestones"]:
        if m["days_late"]:
            out.append({"activity": m["activity"], "kind": "milestone", "level": "high", "days": m["days_late"], "text": f"Milestone {m['id']}, {m['name']}, is forecast {m['days_late']} days late: {m['forecast']} against {m['contract_date']}."})
    return out


def schedule_view() -> dict:
    """The Gantt's data: the activities, each with the tasks of the live plan under it."""
    sched = P.schedule()
    acts = {a["id"]: a for a in sched["activities"]}
    plan = live_plan()
    board_cards = {c.get("step"): c for c in board()["cards"] if c.get("step")} if plan else {}
    tasks: dict[str, list[dict]] = {}
    if plan:
        for s in plan["plan"]["steps"]:
            start, finish = _task_dates(plan["plan"], s, acts)
            c = board_cards.get(s["id"])
            tasks.setdefault(s["activity"], []).append({"id": s["id"], "code": s["code"], "name": s["name"], "kind": s["kind"], "start": start, "finish": finish, "critical": s["critical"], "hold_point": s["hold_point"], "after": s["after"], "by": s["by"], "status": c["status"] if c else "proposed", "progress": (c or {}).get("progress") or 0, "card": c["id"] if c else None, "stopped": bool(c and c["stopped"]), "man_hours": s["man_hours"], "hours": s["hours"], "crew": s["crew"]})
    return {**sched, "activities": [{**a, "tasks": tasks.get(a["id"], [])} for a in sched["activities"]], "delays": delays(), "plan": {k: plan[k] for k in ("id", "title", "status")} if plan else None, "network": {"sections": plan["plan"]["sections"], "steps": plan["plan"]["steps"], "title": plan["title"]} if plan else None, "resources": {"crew_by_day": plan["plan"]["crew_by_day"], "workforce": plan["plan"]["workforce"], "totals": plan["plan"]["totals"]} if plan else None,
            "who": {**{s["id"]: s["name"].replace(" (fictional)", "") for s in P.all_of("subcontractor")}, "self": "Own crew"}, "scenario": not P.is_blank()}


# ------------------------------------------------------------------------------------------------ BOQ and cost


def boq_view() -> dict:
    """The contract BoQ by work package, and the take-off and bill of materials of the live plan beside it."""
    codes = P.wbs_codes()
    packages = P.all_of("package")
    lines = []
    for b in P.all_of("boq"):
        p = next((x for x in packages if b["id"] in x["boq"]), None)
        lines.append({**b, "package": p["id"] if p else "", "package_name": p["name"] if p else "", "wbs": codes.get(b.get("activity") or "") or codes.get(p["id"] if p else "", "")})
    plan = live_plan()
    takeoff = None
    if plan:
        steps = {s["id"]: s for s in plan["plan"]["steps"]}
        actuals = plan.get("actuals") or {}
        spent = sum((a.get("man_hours") or 0) for a in actuals.values())
        done = {c["step"]: c for c in board()["cards"] if c.get("step")}
        earned = sum((s["labour_cost"] + s["material_cost"]) * ((done.get(s["id"]) or {}).get("progress") or (100 if (done.get(s["id"]) or {}).get("status") == "done" else 0)) / 100 for s in steps.values())
        actual_cost = 0.0
        for sid, a in actuals.items():
            s = steps.get(sid)
            if s:
                actual_cost += (a.get("man_hours") or 0) / max(s["man_hours"], 0.01) * s["labour_cost"]
                used = a.get("materials") or {}
                actual_cost += sum((used[m["key"]] * m["rate"]) if m["key"] in used else m["cost"] for m in s["materials"])
        takeoff = {"plan": {k: plan[k] for k in ("id", "title", "status", "mode")}, "quantities": plan["plan"]["quantities"], "materials": plan["plan"]["materials"], "waste_flags": plan["plan"]["waste_flags"], "totals": plan["plan"]["totals"], "source": plan["plan"]["source"], "by_section": [{"code": sec["code"], "name": sec["name"], "activity": branch["activity"], "by": sec["by"], "man_hours": round(sum(steps[x]["man_hours"] for x in sec["tasks"]), 1), "labour": sum(steps[x]["labour_cost"] for x in sec["tasks"]), "material": sum(steps[x]["material_cost"] for x in sec["tasks"]), "waste": sum(steps[x]["waste_cost"] for x in sec["tasks"]), "materials": [{"name": m["name"], "gross": m["gross"], "unit": m["unit"], "task": x} for x in sec["tasks"] for m in steps[x]["materials"]]} for branch in plan["plan"]["tree"] for sec in branch["sections"]],
                   "tracking": {"planned": plan["plan"]["totals"]["cost"], "earned": round(earned), "actual": round(actual_cost), "man_hours_recorded": spent, "steps_recorded": len(actuals), "progress": plan["progress"]}}
    return {"lines": lines, "packages": [{"id": p["id"], "name": p["name"], "code": codes.get(p["id"], ""), "value": p["boq_value"], "budget": p["budget"]} for p in packages], "activities": [{"id": a[0], "name": a[1]} for a in P.activity_rows()], "takeoff": takeoff, "today": P.TODAY}


# ------------------------------------------------------------------------------------------------ the core flow: what a contractor needs from the documents


def account_id(package: str) -> str:
    """A control account is what the records call a package: the level where scope, budget and schedule meet."""
    return package.replace("WP-", "CA-", 1)


def _package_info(plan: dict | None) -> dict[str, dict]:
    return (plan or {}).get("plan", {}).get("packages") or {}


def control_accounts() -> dict:
    """Where scope, budget and schedule meet, each with who answers for it and what it is made of."""
    whole, money, plan = tree(), P.budget(), live_plan()
    rows = {p["id"]: p for p in money["packages"]}
    against = {a["name"]: a for a in ((plan or {}).get("plan", {}).get("accounts") or [])}
    out = []
    for n in whole["root"]["children"]:
        m = rows.get(n["ref"], {})
        info = [_package_info(plan).get(k["ref"], {}) for k in n["children"]]
        who = next((i["responsible"] for i in info if i.get("responsible")), "") or n["by_name"]
        other = against.get(n["name"], {})
        out.append({"code": n["code"], "id": account_id(n["ref"]), "name": n["name"], "responsible": who, "start": n["start"], "finish": n["finish"], "progress": n["progress"], "critical": n["critical"], "packages": len(n["children"]), "tasks": n["roll"]["tasks"], "man_hours": n["roll"]["man_hours"], "owner_value": other.get("owner_value"), "against_owner_pct": other.get("against_owner_pct"), **{k: m.get(k, 0) for k in ("budget", "committed", "pv", "ev", "ac", "eac", "variance", "cpi", "spi")}})
    return {"accounts": out, "total": money["total"], "today": P.TODAY, "plan": whole["plan"]}


def work_packages() -> dict:
    """The lowest level at which cost and time are planned, each under its control account."""
    whole, plan = tree(), live_plan()
    own = {a["id"]: a for a in P.all_of("activity")}
    lines: dict[str, int] = {}
    for b in P.all_of("boq"):
        if b.get("activity"):
            lines[b["activity"]] = lines.get(b["activity"], 0) + b["value"]
    acts = {a["id"]: a for a in P.schedule()["activities"]}
    out = []
    for n in whole["root"]["children"]:
        for k in n["children"]:
            a = acts[k["ref"]]
            info = _package_info(plan).get(k["ref"], {})
            out.append({"code": k["code"], "id": k["ref"], "no": own.get(k["ref"], {}).get("no", ""), "name": k["name"], "account": account_id(n["ref"]), "account_name": n["name"], "responsible": info.get("responsible") or k["by_name"], "start": k["start"], "finish": k["finish"], "duration": k["duration"], "float_days": k["float_days"], "critical": k["critical"], "progress": k["progress"], "weight": own.get(k["ref"], {}).get("weight"), "value": lines.get(k["ref"], 0), "planned_cost": k["roll"]["planned_cost"], "man_hours": k["roll"]["man_hours"], "tasks": k["roll"]["tasks"], "inspections": sum(1 for s in k["children"] for t in s.get("children", []) if t.get("kind") == "inspection"), "after": a["predecessors"], "ready": k["ready"]})
    return {"packages": out, "today": P.TODAY, "plan": whole["plan"]}


def dictionary() -> dict:
    """The WBS dictionary: what each element of the breakdown is, written once, so nobody has to ask. Code lays it out from what the agents wrote and the records hold."""
    whole, plan = tree(), live_plan()
    acts = {a["id"]: a for a in P.schedule()["activities"]}
    following = {a: [x["id"] for x in acts.values() if a in x["predecessors"]] for a in acts}
    packages = {w["id"]: w for w in work_packages()["packages"]}
    money = {a["id"]: a for a in control_accounts()["accounts"]}
    out = []
    for n in whole["root"]["children"]:
        acct = money[account_id(n["ref"])]
        out.append({"code": n["code"], "level": "Control account", "id": acct["id"], "name": n["name"], "scope": f"{len(n['children'])} work packages: {', '.join(k['name'] for k in n['children'][:8])}{', and more' if len(n['children']) > 8 else ''}.", "deliverable": "", "acceptance": "", "responsible": acct["responsible"], "start": n["start"], "finish": n["finish"], "duration": P.days_between(n["start"], n["finish"]) + 1 if n["start"] else 0, "value": acct["budget"], "man_hours": n["roll"]["man_hours"], "tasks": n["roll"]["tasks"], "inspections": n["roll"]["inspections"], "before": [], "after": [], "references": [], "assumptions": [], "questions": []})
        for k in n["children"]:
            w, info = packages[k["ref"]], _package_info(plan).get(k["ref"], {})
            sections = [s["name"] for s in k["children"] if s["type"] == "section"]
            out.append({"code": k["code"], "level": "Work package", "id": k["ref"], "no": w["no"], "name": k["name"], "scope": info.get("scope") or (f"Sections: {', '.join(sections)}." if sections else ""), "deliverable": info.get("deliverable") or "", "acceptance": info.get("acceptance") or "", "responsible": w["responsible"], "start": k["start"], "finish": k["finish"], "duration": k["duration"], "value": w["value"], "man_hours": k["roll"]["man_hours"], "tasks": k["roll"]["tasks"], "inspections": w["inspections"], "before": [{"id": x, "name": acts[x]["name"], "code": acts[x]["code"]} for x in w["after"] if x in acts], "after": [{"id": x, "name": acts[x]["name"], "code": acts[x]["code"]} for x in following.get(k["ref"], [])], "references": info.get("references") or [], "assumptions": info.get("assumptions") or [], "questions": info.get("questions") or []})
    return {"entries": out, "today": P.TODAY, "plan": whole["plan"]}


def procedures(rec: dict | None = None) -> dict:
    """Every task's procedure, in the order of the WBS, and whether it is ready to work: the point of all of it. The plan the site works to, unless another is asked for."""
    plan = P.plan_view(rec) if rec else live_plan()
    if not plan:
        return {"plan": None, "groups": [], "counts": {"tasks": 0, "ready": 0, "not_ready": 0}}
    ctx = _context()
    acts, steps = ctx["acts"], {s["id"]: s for s in plan["plan"]["steps"]}
    cards = {c["step"]: c for c in board()["cards"] if c.get("step") and c.get("plan") == plan["id"]}
    following: dict[str, list[str]] = {}
    for s in steps.values():
        for a in s["after"]:
            following.setdefault(a, []).append(s["id"])
    docs = {d["id"]: d["title"] for d in documents()["documents"]}
    approved = plan["status"] == "approved"
    groups = []
    for branch in plan["plan"]["tree"]:
        a = acts.get(branch["activity"])
        ready = readiness_of(a, ctx) if a else {"reasons": []}
        sections = []
        for sec in branch["sections"]:
            tasks = []
            for sid in sec["tasks"]:
                s = steps[sid]
                c = cards.get(sid)
                start, finish = _task_dates(plan["plan"], s, acts)
                holds = [{"text": b["text"], "go": b["go"], "stop": b["stop"]} for b in (c or {}).get("blockers", [])] + [{"text": r["text"], "go": r["go"], "stop": False} for r in ready["reasons"]]
                if not approved:
                    holds.insert(0, {"text": "The plan is waiting for your approval", "go": "analysis", "stop": False})
                tasks.append({"id": sid, "code": s["code"], "name": s["name"], "kind": s["kind"], "critical": s["critical"], "hold_point": s["hold_point"], "start": start, "finish": finish, "crew": s["crew"], "crew_size": s["crew_size"], "hours": s["hours"], "man_hours": s["man_hours"], "basis": s["basis"], "after": s["after"], "next": following.get(sid, []), "steps": s.get("steps") or [x for x in re.split(r"(?<=[.!?])\s+", s["procedure"]) if x], "criteria": s["criteria"], "needs": s.get("needs") or [f"{m['name']}: {m['gross']:,.1f} {m['unit']}" for m in s["materials"]], "equipment": s.get("equipment") or [], "safety": s.get("safety") or "", "unsourced": s.get("unsourced") or [], "permit": REG.permit_for(s.get("kind") or "", s["name"], s["procedure"], " ".join(s.get("equipment") or []), s.get("safety") or ""), "sources": s.get("sources") or [{"doc": e, "title": docs.get(e, e), "page": None, "quote": ""} for e in s["evidence"]], "status": (c or {}).get("status", "proposed"), "card": (c or {}).get("id"), "ready": not holds, "holds": holds})
            sections.append({"code": sec["code"], "name": sec["name"], "tasks": tasks})
        groups.append({"code": branch["code"], "id": branch["activity"], "name": branch["name"], "sections": sections})
    every = [t for g in groups for sec in g["sections"] for t in sec["tasks"]]
    return {"plan": {k: plan[k] for k in ("id", "title", "status", "mode")}, "groups": groups, "counts": {"tasks": len(every), "ready": sum(t["ready"] for t in every), "not_ready": sum(not t["ready"] for t in every)},
            "obligations": plan["plan"].get("obligations") or [], "safety_risk": plan["plan"].get("safety_risk"), "permit_tasks": sum(1 for t in every if t["permit"]), "permit_rule": REG.PERMIT}


def procedure_document(rec: dict) -> str:
    """The procedures of a real package as a document to take to site: by work package, in the order of the WBS, saying what the screen says. Laid out by code, so it cannot disagree with the plan."""
    data = procedures(rec)
    plan = rec["plan"]
    live = rec["status"] in ("approved", "pending")  # a plan that was rejected or replaced has no dates of its own any more
    acts = {a["id"]: a for a in P.schedule()["activities"]}
    state = {"pending": "Waiting for approval", "approved": f"Approved by {rec.get('decided_by')}, {rec.get('decided_at')}", "rejected": "Rejected", "superseded": "Replaced"}[rec["status"]]
    lines = [f"# Procedures: {plan['title']}", "", f"{state}. {data['counts']['tasks']} tasks in {sum(1 for g in data['groups'] if any(s['tasks'] for s in g['sections']))} work packages.", "", "Written by AI agents from the consultant's documents, as a first draft for a site engineer to check. Crew, man-hours and each task's dates are the agents' estimates, fitted to the master schedule."]
    if rec.get("mode") == "mock":
        lines += ["", "**Offline mock: scripted answers, not a real plan.**"]
    for phase, heading in (("before", "Before any work starts"), ("during", "While the work runs"), ("handover", "At handover")):
        rows = [o for o in data["obligations"] if o["phase"] == phase]
        if rows:
            lines += ["", f"## {heading}", "", "What the contract and Indonesian regulations require. Code found each by its words: check it against the documents."]
        for o in rows:
            lines += ["", f"### {o['what']}", ""]
            if o["note"]:
                lines.append(f"- {o['note']}")
            if o["key"] == "permits":
                lines.append(f"- In this plan: {data['permit_tasks']} task{'' if data['permit_tasks'] == 1 else 's'} need one, and each says so.")
            if o["conflict"]:
                lines.append(f"- **Look at this:** {o['conflict']}")
            lines += [f"- The documents: \u201c{f['quote']}\u201d ({f['title']}, page {f['page']})" for f in o["found"]] or ["- The documents read do not say."]
            if o["rule"]:
                lines.append(f"- The regulation: {o['rule']['name']}, {o['rule']['article']}: \u201c{o['rule']['quote']}\u201d")
    for g in data["groups"]:
        info, a = plan["packages"].get(g["id"]) or {}, acts.get(g["id"]) or {}
        lines += ["", f"## {g['code']} {g['name']}", ""]
        facts = [f"Schedule item {info['no']}" if info.get("no") else "", f"{a['start']} to {a['finish']}, {a['duration']} days" if live and a else "", f"Responsible: {info['responsible']}" if info.get("responsible") else ""]
        lines.append(". ".join(x for x in facts if x) + ".")
        for label, key in (("Scope", "scope"), ("Deliverable", "deliverable"), ("How it is accepted", "acceptance")):
            if info.get(key):
                lines += ["", f"**{label}:** {info[key]}"]
        for label, rows in (("Assumed", info.get("assumptions") or []), ("Open questions for the consultant", [f"{q['subject']}: {q['question']}" for q in info.get("questions") or []])):
            if rows:
                lines += ["", f"**{label}:**", "", *[f"- {x}" for x in rows]]
        if not any(s["tasks"] for s in g["sections"]):
            lines += ["", "No procedures for this work package: its planner's answer could not be read."]
        for sec in g["sections"]:
            lines += ["", f"### {sec['name']}"]
            for t in sec["tasks"]:
                lines += ["", f"#### {t['code']} {t['id']} {t['name']}", ""]
                if t["hold_point"]:
                    lines += ["**Hold point: work stops until this is signed.**", ""]
                lines += [f"{i}. {s}" for i, s in enumerate((re.sub(r"^\d+\.\s*", "", x) for x in t["steps"]), 1)]
                lines.append("")
                crew = ", ".join(f"{c['count']} {c['role']}" for c in t["crew"])
                for label, value in (("When", f"{t['start']} to {t['finish']}" if live else ""), ("Crew, estimated", f"{crew} ({t['man_hours']:,.0f} man-hours)" if crew else ""), ("Waits for", ", ".join(t["after"])), ("Passes if", t["criteria"]), ("Material", "; ".join(t["needs"])), ("Equipment", ", ".join(t["equipment"])), ("Safety", t["safety"])):
                    if value:
                        lines.append(f"- **{label}:** {value}")
                if t["permit"]:
                    lines.append(f"- **Work permit first:** {'; '.join(p['local'] for p in t['permit'])}. Its method statement, AKK and inspection plan are part of the permit (Permen PUPR 10/2021 Pasal 26 ayat (2) huruf {', '.join(p['letter'] for p in t['permit'])}, and Pasal 27).")
                if t["unsourced"]:
                    lines.append(f"- **Check:** {', '.join(t['unsourced'])}. The pages the agent read do not state {'this figure' if len(t['unsourced']) == 1 else 'these figures'}.")
                if t["sources"]:
                    lines += ["", "Where the documents say so:", "", *[f"- {s['title']}{f', page {s['page']}' if s.get('page') else ''}{f': \u201c{s['quote']}\u201d' if s.get('quote') else ''}" for s in t["sources"]]]
                else:
                    lines += ["", "Nothing in the documents backs this task: it rests on the agent's knowledge. Check it before use."]
    return "\n".join(lines) + "\n"


def procedure_table(rec: dict) -> str:
    """The same tasks, one row each, for a spreadsheet. It starts with a byte-order mark so that Excel reads the documents' language correctly."""
    data = procedures(rec)
    live = rec["status"] in ("approved", "pending")
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["wbs", "work_package", "section", "task_id", "task", "kind", "hold_point", "start", "finish", "crew", "man_hours", "waits_for", "passes_if", "material", "equipment", "safety", "work_permit", "sources"])
    for g in data["groups"]:
        for sec in g["sections"]:
            for t in sec["tasks"]:
                w.writerow([t["code"], g["name"], sec["name"], t["id"], t["name"], t["kind"], "yes" if t["hold_point"] else "", t["start"] if live else "", t["finish"] if live else "", "; ".join(f"{c['count']} {c['role']}" for c in t["crew"]), t["man_hours"], "; ".join(t["after"]), t["criteria"], "; ".join(t["needs"]), "; ".join(t["equipment"]), t["safety"], "; ".join(p["local"] for p in t["permit"]), "; ".join(f"{s['title']} p.{s['page']}" for s in t["sources"])])
    return "\ufeff" + out.getvalue()


def critical_path() -> dict:
    """The critical path as a planner writes it: earliest and latest start and finish, and the float, all worked out by code from the links. The path itself is the chain that holds the finish date: from the last work to finish, back through whatever has the least float. On a schedule that overlaps, some of it may have float of its own, and it says how much."""
    sched = P.schedule()
    acts = sched["activities"]
    by_id = {a["id"]: a for a in acts}
    plus = lambda d, n: (date.fromisoformat(d) + timedelta(days=n)).isoformat()  # noqa: E731
    rows = [{"code": a["code"], "id": a["id"], "name": a["name"], "duration": a["duration"], "es": a["start"], "ef": a["finish"], "ls": plus(a["start"], a["float_days"]), "lf": plus(a["finish"], a["float_days"]), "float_days": a["float_days"], "critical": a["critical"], "after": a["predecessors"], "by": a["by_name"].replace(" (fictional)", ""), "progress": a["progress"]} for a in acts]
    linked = {x for a in acts for x in a["predecessors"]} | {a["id"] for a in acts if a["predecessors"]}
    def chain(here: dict) -> list[str]:
        out: list[str] = []
        while here and here["id"] not in out:
            out.insert(0, here["id"])
            before = [by_id[p] for p in here["predecessors"] if p in by_id and p not in out]
            here = min(before, key=lambda a: (a["float_days"], -date.fromisoformat(a["finish"]).toordinal(), -a["duration"]), default=None)
        return out

    tied = [a for a in acts if a["id"] in linked]
    last = max((a["finish"] for a in tied), default="")
    path = max((chain(a) for a in tied if a["finish"] == last), key=lambda c: sum(by_id[i]["duration"] for i in c), default=[])  # several can end the job together: the longest chain is the one that holds it
    finish = max((a["finish"] for a in acts), default="")
    begin = min((a["start"] for a in acts), default="")
    plan = live_plan()
    return {"activities": sorted(rows, key=lambda r: (r["es"], r["code"])), "path": [{"id": i, "code": by_id[i]["code"], "name": by_id[i]["name"], "duration": by_id[i]["duration"], "start": by_id[i]["start"], "finish": by_id[i]["finish"], "float_days": by_id[i]["float_days"]} for i in path], "start": begin, "finish": finish, "days": P.days_between(begin, finish) + 1 if begin else 0, "links": sum(len(a["predecessors"]) for a in acts), "milestones": sched["milestones"], "today": P.TODAY, "network": {"sections": plan["plan"]["sections"], "steps": plan["plan"]["steps"], "title": plan["title"]} if plan and plan["plan"].get("kind") != "package" else None}


def executive() -> dict:
    """The project on one page: what the project director wrote about it, and beside that the figures as they stand now, worked out by code, so a change to the schedule shows here too."""
    rec = live_plan()
    if not rec:
        return {"plan": None}
    plan, cp = rec["plan"], critical_path()
    return {"plan": {k: rec[k] for k in ("id", "status", "summary", "created")}, "written": plan.get("executive"), "total": plan.get("total"), "owner_total": plan.get("owner_total"), "contract_days": plan.get("contract_days"),
            "start": cp["start"], "finish": cp["finish"], "days": cp["days"], "links": cp["links"], "accounts": len(plan.get("accounts") or []), "work_packages": len(cp["activities"]), "tasks": plan["totals"]["steps"],
            "critical": sum(1 for a in cp["activities"] if a["critical"]), "path": cp["path"], "conflicts": len(rec.get("findings") or []), "questions": len(rec.get("rfi_drafts") or []), "flags": sum(1 for c in plan.get("checks") or [] if not c["ok"]), "safety_risk": (plan.get("safety_risk") or {}).get("level")}


def cost_estimate() -> dict:
    """What the work is worth: by control account and work package, from the priced BoQ, and the plan's own worked-out costs where it has quantities. Says which of the two it is."""
    plan = live_plan()
    accounts = control_accounts()["accounts"]
    packages = work_packages()["packages"]
    money = {p["id"]: p for p in P.budget()["packages"]}
    rows = []
    for a in accounts:
        mine = [w for w in packages if w["account"] == a["id"]]
        value = next((m["boq_value"] for k, m in money.items() if account_id(k) == a["id"]), 0)
        rows.append({**{k: a[k] for k in ("code", "id", "name", "responsible", "owner_value", "against_owner_pct", "tasks", "man_hours")}, "value": value, "budget": a["budget"], "packages": [{k: w[k] for k in ("code", "id", "no", "name", "weight", "value", "planned_cost", "man_hours", "tasks", "start", "finish")} for w in mine]})
    p = (plan or {}).get("plan", {})
    total = sum(r["value"] for r in rows)
    start = P.project_start()
    curve = [{"week": i + 1, "cumulative": c, "value": round(total * c / 100), "ends": (date.fromisoformat(start) + timedelta(days=(i + 1) * 7 - 1)).isoformat()} for i, c in enumerate(p.get("cumulative") or [])]
    worked = boq_view()["takeoff"] if plan and p.get("materials") else None
    return {"accounts": rows, "total": total, "owner_total": p.get("owner_total"), "method": "top_down" if p.get("kind") == "package" else "bottom_up" if worked else "boq", "curve": curve, "takeoff": worked, "plan": {k: plan[k] for k in ("id", "title", "status", "mode")} if plan else None, "man_hours": round(sum(r["man_hours"] for r in rows), 1), "today": P.TODAY}


# ------------------------------------------------------------------------------------------------ procurement and subcontractors


def materials() -> dict:
    """Is the material there? What the live plan needs against what is requested, ordered and received, with what needs it first."""
    plan = live_plan()
    orders = [o for o in P.all_of("po") if o["status"] != "cancelled"]
    rows = []
    if plan:
        steps = {s["id"]: s for s in plan["plan"]["steps"]}
        acts = {a["id"]: a for a in P.schedule()["activities"]}
        for m in plan["plan"]["materials"]:
            users = [steps[x] for x in m["steps"] if x in steps]
            first = min((_task_dates(plan["plan"], s, acts)[0] for s in users), default="")
            mine = next((o for o in orders if o.get("plan") == plan["id"] and o.get("material") == m["key"]), None)
            word = m["name"].split(",")[0].split()[0].lower()
            cover = [o["id"] for o in orders if o is not mine and not o.get("material") and o.get("activity") in plan["plan"]["activities"] and word in o["item"].lower()]
            state = "not_requested" if not mine else "available" if mine["status"] == "received" else "late" if mine["promised"] and first and mine["promised"] > first else "on_order" if mine["status"] in ("confirmed", "ordered", "delay reported") else "not_ordered"
            rows.append({"key": m["key"], "name": m["name"], "unit": m["unit"], "gross": m["gross"], "net": m["net"], "waste": m["waste"], "cost": m["cost"], "tasks": m["steps"], "needed": first, "order": mine["id"] if mine else "", "supplier": mine["supplier"] if mine else "", "promised": mine["promised"] if mine else "", "status": mine["status"] if mine else "", "state": state, "maybe_covered_by": cover})
    return {"plan": {k: plan[k] for k in ("id", "title", "status")} if plan else None, "materials": rows, "today": P.TODAY}


def suppliers() -> dict:
    rows: dict[str, dict] = {}
    for o in P.all_of("po"):
        if o["status"] == "cancelled":
            continue
        s = rows.setdefault(o["supplier"], {"name": o["supplier"], "orders": 0, "open": 0, "received": 0, "late": 0, "value": 0, "items": []})
        s["orders"] += 1
        s["value"] += o["value"]
        s["items"].append(o["id"])
        if o["status"] == "received":
            s["received"] += 1
        else:
            s["open"] += 1
            s["late"] += 1 if o["promised"] > o["needed"] else 0
    return {"suppliers": sorted(rows.values(), key=lambda s: -s["value"])}


def assignments() -> dict:
    """Who is programmed on what, against who the plan needs and what they have: the scope gaps a programme leaves are here."""
    sched = P.schedule()
    subs = {s["id"]: s for s in P.subcontractors()}
    plan = live_plan()
    confirmed = {a["id"]: a for a in P.all_of("assignment")}
    name = lambda by: subs[by]["name"].replace(" (fictional)", "") if by in subs else "Own crew" if by == "self" else by or "To be assigned"  # noqa: E731
    rows = []
    for a in sched["activities"]:
        needed = sorted({s["by"] for s in plan["plan"]["steps"] if s["activity"] == a["id"] and s["by"] and s["kind"] != "inspection"}) if plan else []
        for by in needed or [a["by"]]:
            sections = sorted({s["section"] for s in plan["plan"]["steps"] if s["activity"] == a["id"] and s["by"] == by and s["kind"] != "inspection"}) if plan else []
            sub = subs.get(by)
            peak = plan["plan"]["totals"]["peak_by"].get(by) if plan and needed else None
            gap = bool(needed) and by != a["by"] and f"{a['id']}:{by}" not in confirmed
            rows.append({"id": f"{a['id']}:{by}", "activity": a["id"], "code": a["code"], "name": a["name"], "start": a["start"], "finish": a["finish"], "critical": a["critical"], "programmed": a["by"], "programmed_name": name(a["by"]), "by": by, "by_name": name(by), "sections": sections, "peak": peak, "crew": sub["crew"] if sub else None, "over": bool(sub and peak and peak > sub["crew"]), "gap": gap, "confirmed": f"{a['id']}:{by}" in confirmed, "rating": sub["rating"] if sub else "", "expired": sub["expired"] if sub else [], "open_ncrs": sub["open_ncrs"] if sub else []})
    return {"rows": rows, "gaps": sum(1 for r in rows if r["gap"]), "subs": [{"id": s["id"], "name": s["name"].replace(" (fictional)", ""), "trade": s.get("trade", ""), "crew": s.get("crew", 0), "status": s.get("status", ""), "rating": s.get("rating", "")} for s in sorted(subs.values(), key=lambda s: (s.get("status") != "active", s["name"]))], "today": P.TODAY}


def confirm_assignment(activity: str, by: str, who: str = P.PM) -> dict:
    """A person programmes a subcontractor on work the plan needs them for."""
    if activity not in {a[0] for a in P.activity_rows()}:
        raise KeyError(activity)
    rid = f"{activity}:{by}"
    return P.put("assignment", rid, {"id": rid, "activity": activity, "by": by, "on": P.TODAY}, who, "programmed a subcontractor", rid)


def reassign(activity: str, section: str, by: str, who: str = P.PM) -> dict:
    """Moves every open task of one section of an activity to another crew, on the board."""
    subs = {s["id"]: s["name"].replace(" (fictional)", "") for s in P.all_of("subcontractor")}
    owner = subs.get(by, "Own crew" if by == "self" else by)
    moved = [w for w in P.all_of("work_item") if w.get("activity") == activity and w.get("section") == section and w["status"] in ("open", "doing", "review")]
    for w in moved:
        P.set_work_item(w["id"], owner=owner, by=by, who=who)
    return {"moved": len(moved), "owner": owner}


# ------------------------------------------------------------------------------------------------ QA/QC


def photos() -> dict:
    """Photo evidence: the scenario's site photos and any uploaded, each with its work package, what reviewed it and what it supports."""
    seeded = [] if P.is_blank() else ProjectData.load().photos
    packages = P.all_of("package")
    codes = P.wbs_codes()
    reviews = {r["id"]: r for r in P.all_of("photo_review")}
    used: dict[str, list[str]] = {}
    for i in P.all_of("inspection"):
        for x in i.get("photos") or []:
            used.setdefault(x, []).append(i["id"])
    rows = []
    for p in [*seeded, *P.all_of("photo")]:
        pack = next((x for x in packages if p.get("item_code") in x["boq"]), None)
        rows.append({**{k: v for k, v in p.items() if k != "what_to_count"}, "package": pack["id"] if pack else p.get("package", ""), "wbs": codes.get(p.get("activity") or "") or (codes.get(pack["id"]) if pack else ""), "review": reviews.get(p["id"]), "inspections": used.get(p["id"], [])})
    return {"photos": sorted(rows, key=lambda x: x.get("date") or "", reverse=True), "today": P.TODAY}


# ------------------------------------------------------------------------------------------------ the control tower


def tower() -> dict:
    """The whole project on one page: each module's standing, what is holding the most work, and what the agents recommend. Every figure comes from its module."""
    o = P.overview()
    b = board()
    sched = P.schedule()
    q = P.quality()
    d = documents()
    ready = readiness()
    mats = materials()
    acts = sched["activities"]
    total = sum(a["duration"] for a in acts)
    progress = round(sum(a["progress"] * a["duration"] for a in acts) / total) if total else 0
    expected = round(sum(P.expected_pct(a) * a["duration"] for a in acts) / total) if total else 0
    k = o["kpis"]
    late = [a for a in acts if P.days_between(a["baseline_finish"], a["finish"]) > 0]
    open_ncrs = [n for n in q["ncrs"] if n["status"] == "open"]
    short = [m for m in mats["materials"] if m["state"] in ("not_ordered", "not_requested", "late")]
    plan = live_plan()
    health = [
        {"key": "wbs", "name": "Project & WBS", "tone": "warn" if o["counts"]["pending_plans"] else "ok" if plan else "none", "value": f"{len(acts)} activities", "note": f"{len(plan['plan']['steps'])} tasks in {plan['id']}, {plan['status']}" if plan else "no work plan yet"},
        {"key": "schedule", "name": "Schedule", "tone": "bad" if any(m["days_late"] for m in sched["milestones"]) else "warn" if late else "ok", "value": f"SPI {k['spi']}", "note": f"{sum(1 for a in acts if a['critical'])} critical, {len(late)} moved from baseline"},
        {"key": "cost", "name": "BOQ & Cost", "tone": "warn" if k["cpi"] < 1 else "ok", "value": f"CPI {k['cpi']}", "note": f"forecast Rp {k['eac']:,}, {'over' if k['variance'] < 0 else 'under'} by Rp {abs(k['variance']):,}"},
        {"key": "kanban", "name": "Kanban", "tone": "bad" if b["counts"]["stopped"] else "warn" if b["counts"]["overdue"] else "ok", "value": f"{b['counts']['done']} of {sum(b['counts'][s] for s in ('open', 'doing', 'review', 'done'))} done", "note": f"{b['counts']['stopped']} stopped, {b['counts']['overdue']} overdue, {len(b['bottlenecks'])} bottlenecks"},
        {"key": "documents", "name": "Documents & RFI", "tone": "warn" if ready["ready"] < ready["of"] else "ok", "value": f"{ready['ready']} of {ready['of']} ready", "note": f"{o['counts']['open_rfis']} open RFIs, {o['counts']['draft_rfis']} drafts, {d['counts']['superseded']} replaced"},
        {"key": "procurement", "name": "Procurement & Subs", "tone": "warn" if short else "ok", "value": f"{len(short)} materials short" if mats["materials"] else "no plan materials", "note": f"{sum(1 for x in o['attention'] if x['rule'] == 'late_delivery')} late orders, {sum(1 for x in o['attention'] if x['rule'] == 'document_expired')} expired documents"},
        {"key": "quality", "name": "QA/QC", "tone": "bad" if open_ncrs else "ok", "value": f"{len(open_ncrs)} NCR{'' if len(open_ncrs) == 1 else 's'} open", "note": f"{sum(1 for i in q['inspections'] if i['status'] == 'passed')} of {len(q['inspections'])} inspections passed"},
    ]
    return {**o, "progress": {"actual": progress, "expected": expected, "tasks": b["counts"]}, "health": health, "bottlenecks": b["bottlenecks"][:6], "delays": delays()[:6], "findings": plan["findings"] if plan else []}


def signals_for(tags: list[str]) -> list[dict]:
    """What the planning swarm found that belongs to one module."""
    plan = live_plan()
    return [f for f in plan["findings"] if f["tag"] in tags] if plan else []


# ------------------------------------------------------------------------------------------------ the risk register

RISK_BY_RULE = {"open_ncr": "Quality", "late_delivery": "Procurement & materials", "crew_short": "Schedule", "weather": "External", "rfi_overdue": "Documents & technical", "rfi_after_start": "Documents & technical", "rfi_critical": "Documents & technical", "document_expired": "Subcontractors", "document_expiring": "Subcontractors", "invoice_over_earned": "Commercial", "claim_mismatch": "Commercial", "over_budget": "Cost", "work_item_overdue": "Schedule", "plan_window": "Schedule", "plan_over": "Cost", "milestone_late": "Schedule"}
DETECTED_PI = {"high": (4, 3), "medium": (3, 2), "low": (2, 1)}


def risk_level(score: int) -> str:
    return "extreme" if score >= 20 else "high" if score >= 10 else "medium" if score >= 5 else "low"


def _risks() -> list[dict]:
    """The register: what code detects in the records, always on, beside the risks a person has put on it. A detected risk's probability and impact are mapped from the check's level until a person scores it themselves; a registered risk keeps the person's own scores."""
    out: list[dict] = []
    for n, a in enumerate(P.checks(), 1):
        p, i = DETECTED_PI[a["level"]]
        score = p * i
        out.append({"id": f"DET-{n:03d}", "source": "detected", "rule": a["rule"], "category": RISK_BY_RULE.get(a["rule"], "General"), "title": a["title"], "detail": a["detail"], "ref": a["ref"], "go": f"{a['tab']}:{a['ref']}" if a["ref"] else a["tab"], "activity": a["ref"] if a["tab"].startswith("schedule") else "", "probability": p, "impact": i, "score": score, "level": risk_level(score), "owner": "", "strategy": "", "response": "", "due": "", "status": "open", "created": "", "overdue": False})
    for r in P.all_of("risk"):
        score = r["probability"] * r["impact"]
        out.append({**r, "source": "register", "rule": "", "ref": r.get("activity") or "", "go": f"schedule/gantt:{r['activity']}" if r.get("activity") else "", "score": score, "level": risk_level(score), "overdue": bool(r.get("due") and r["due"] < P.TODAY and r["status"] not in ("closed", "occurred"))})
    return sorted(out, key=lambda r: (-r["score"], r["source"] != "detected", r["title"]))


def risk_register() -> dict:
    """Every risk on one page: what code detects beside what people have registered, with the activities and packages a risk can hang on."""
    risks = _risks()
    acts = P.schedule()["activities"]
    codes = P.wbs_codes()
    return {"today": P.TODAY, "risks": risks, "activities": [{"id": a["id"], "name": a["name"], "code": a["code"], "package": a["package"]} for a in acts],
            "packages": [{"id": p["id"], "name": p["name"], "code": codes.get(p["id"], "")} for p in P.all_of("package")], "categories": list(P.RISK_CATEGORIES), "statuses": list(P.RISK_STATUS), "strategies": list(P.RISK_STRATEGIES),
            "counts": {"total": len(risks), "detected": sum(1 for r in risks if r["source"] == "detected"), "register": sum(1 for r in risks if r["source"] == "register"),
                       "open": sum(1 for r in risks if r["status"] not in ("closed", "occurred")), "closed": sum(1 for r in risks if r["status"] == "closed"),
                       "extreme": sum(1 for r in risks if r["level"] == "extreme" and r["status"] != "closed"), "high": sum(1 for r in risks if r["level"] == "high" and r["status"] != "closed"),
                       "unassigned": sum(1 for r in risks if not r["owner"] and r["status"] != "closed"), "overdue": sum(1 for r in risks if r["overdue"])}}

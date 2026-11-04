"""An agent on each module, not a chatbot beside them: it reads that module's live records and recommends what a person should do next. Agents propose, people decide: a recommendation changes nothing until a person accepts it.

Offline, code works the recommendations out from the same records, by rule, and says so. On Muse, one agent reads the records through CAMEL-AI. Either way code checks every one: it must cite records that exist and use only figures they hold, or it is dropped.

An agent remembers what people decided and learned (memory.py). A decision stays decided until the figures behind it change, and a lesson goes with the recommendation it bears on. Memory is never evidence: the check above reads the live records alone.
"""

from __future__ import annotations

import base64
import json
import re
import time
from datetime import date, timedelta
from typing import Callable

from . import config, llm, memory, modules as M, project as P
from .data import ProjectData
from .firm import PRICE, RULES, SPARK, numbers_in, parse_json

ANSWER_TOKENS = 8000  # thinking counts against it: too few, and the model is cut off before it answers
MOST_ITEMS = 6
ON_A_CARD = 0.2  # a person reads what passes this, one line a card: a wrong line confuses more than a missing one helps. Agents read down to memory.FLOOR. The cases are in tests/test_memory.py
SAME_WORDS = 0.6  # a model's repeats score well above this, and different advice on the same record well below. The cases are in tests/test_memory.py
NO_ANSWER = "the model gave no answer that could be read, so nothing was changed. Ask again"
BENCH = {
    "wbs": {"name": "WBS agent", "module": "Project & WBS", "does": "Finds work not broken down yet, and what the breakdown leaves open", "team": ["Orchestrator", "Integration lead", "Section planner", "Quantity surveyor"], "tags": ["SEQUENCE_RISK", "OTHER"]},
    "schedule": {"name": "Scheduling agent", "module": "AI Scheduling", "does": "Detects delays and what threatens the critical path", "team": ["Integration lead", "Programme reader", "Workforce lead"], "tags": ["TIME_SHORT", "CREW_SHORT"]},
    "cost": {"name": "Cost agent", "module": "BOQ & Cost", "does": "Checks quantities against the BoQ and where cost is exposed", "team": ["Cost lead", "BoQ checker", "Quantity surveyor", "Material and waste lead"], "tags": ["BOQ_MISMATCH", "COST_EXPOSURE", "MATERIAL_WASTE"]},
    "kanban": {"name": "Site agent", "module": "Kanban", "does": "Finds the bottlenecks holding the most work", "team": ["Logistics lead", "Workforce lead"], "tags": ["HANDLING_WASTE"]},
    "documents": {"name": "Document agent", "module": "Documents & RFI", "does": "Reads documents, finds what disagrees, and drafts RFIs", "team": ["Document controller", "Specification reader", "Contract lead"], "tags": ["DOCUMENT_CONFLICT", "SUPERSEDED_DRAWING", "RFI_OPEN"]},
    "procurement": {"name": "Procurement agent", "module": "Procurement & Subcontractors", "does": "Watches material availability, late orders and who is programmed", "team": ["Material and waste lead", "Workforce lead"], "tags": ["SCOPE_GAP"]},
    "quality": {"name": "Quality agent", "module": "QA/QC", "does": "Watches hold points, inspections and open NCRs, and reads site photos", "team": ["Inspection lead", "QA reviewer", "Red team"], "tags": ["SAFETY"]},
    "tower": {"name": "Control tower agent", "module": "Control Tower", "does": "Says what matters most across every module today", "team": ["Orchestrator", "Validator"], "tags": []},
}
LINES = {"pimpinan": ["wbs", "schedule"], "planning": ["wbs", "schedule"], "site": ["kanban", "schedule"], "subcontract": ["procurement"], "procurement": ["procurement", "cost"], "cost": ["cost"], "quality": ["quality"], "contract": ["documents"]}  # which modules each line of the swarm works on. Both swarms share the lines. QA and the red team check everything, so they read everything


def _plus(days: int) -> str:
    return (date.fromisoformat(P.TODAY) + timedelta(days=days)).isoformat()


def records_of(module: str) -> dict:
    """What this module's agent reads: the module's records as they stand now."""
    sched = P.schedule()
    compact = [{k: a[k] for k in ("id", "name", "start", "finish", "duration", "critical", "float_days", "progress", "by_name", "rfis", "ncrs", "pos")} for a in sched["activities"]]
    plan = M.live_plan()
    checks = [c for c in plan["plan"]["checks"] if not c["ok"]] if plan else []
    if module == "wbs":
        return {"activities": compact, "milestones": sched["milestones"], "plan": {k: plan[k] for k in ("id", "title", "status")} if plan else None, "broken_down": sorted({s["activity"] for s in plan["plan"]["steps"]}) if plan else [], "plan_checks": checks}
    if module == "schedule":
        return {"activities": compact, "milestones": sched["milestones"], "delays": M.delays(), "plan_checks": [c for c in checks if c["rule"] in ("time", "crew", "programme_crew")]}
    if module == "cost":
        b = P.budget()
        claim = P.claim()
        return {"total": b["total"], "packages": b["packages"], "plan_checks": [c for c in checks if c["rule"].startswith("boq_") or c["rule"] == "margin"], "waste_flags": plan["plan"]["waste_flags"] if plan else [], "claim": {**claim["totals"], "status": claim["status"], "id": claim["id"]} if claim else None}
    if module == "kanban":
        b = M.board()
        return {"counts": b["counts"], "bottlenecks": b["bottlenecks"][:10], "overdue": [{k: c[k] for k in ("id", "title", "owner", "due")} for c in b["cards"] if c["overdue"]][:12], "waiting_plan": b["waiting"]}
    if module == "documents":
        d = M.documents()
        ready = M.readiness()
        return {"documents": [{k: x[k] for k in ("id", "title", "kind", "status", "replaced_by", "activities", "cited_by")} for x in d["documents"]], "rfis": [{k: r.get(k) for k in ("id", "subject", "status", "due", "activity", "to", "impact", "drafted_by")} for r in P.all_of("rfi") if r["status"] != "answered"], "not_ready": [r for r in ready["activities"] if not r["ready"]]}
    if module == "procurement":
        return {"orders": [o for o in P.all_of("po") if o["status"] not in ("received", "cancelled")], "materials": M.materials()["materials"], "gaps": [r for r in M.assignments()["rows"] if r["gap"] or r["over"]], "subcontractors": [{k: s[k] for k in ("id", "name", "rating", "expired", "expiring", "missing", "open_ncrs")} for s in P.subcontractors()]}
    if module == "quality":
        q = P.quality()
        return {"inspections": [{k: i.get(k) for k in ("id", "title", "activity", "by_name", "status", "next", "ncr", "hold_point", "criteria")} for i in q["inspections"] if i["status"] != "passed"], "ncrs": [{k: n.get(k) for k in ("id", "title", "activity", "by_name", "due", "status")} for n in q["ncrs"] if n["status"] == "open"]}
    t = M.tower()
    return {"health": t["health"], "attention": t["attention"][:14], "bottlenecks": t["bottlenecks"], "delays": t["delays"], "progress": t["progress"]}


def _item(title: str, why: str, refs: list[str], action: dict | None = None) -> dict:
    return {"title": title, "why": why, "refs": refs, "action": action or {"type": "none"}, "state": "open"}


def _task(title: str, owner: str, due: str, activity: str = "") -> dict:
    return {"type": "work_item", "title": title, "owner": owner, "due": due, "activity": activity}


def _open(path: str) -> dict:
    return {"type": "open", "go": path}


def worked_out(module: str, r: dict, room: int = 0) -> list[dict]:
    """The offline recommendations: plain rules over the same records the agent would read. No model is involved, and nothing here is a judgement beyond the rule. `room` is how many people have already decided here: one of those must not take the place of the next in line."""
    out: list[dict] = []
    if module == "wbs":
        if r["plan"] and r["plan"]["status"] == "pending":
            out.append(_item(f"Decide on work plan {r['plan']['id']}", "Its tasks do not reach the board, the schedule or QA/QC until a person approves it.", [r["plan"]["id"]], _open("wbs/plan")))
        soon = [a for a in r["activities"] if a["id"] not in r["broken_down"] and a["progress"] < 100 and a["start"] <= _plus(14)]
        for a in sorted(soon, key=lambda a: (not a["critical"], a["start"]))[:3 + room]:
            out.append(_item(f"Break down {a['id']} before it starts on {a['start']}", f"{a['name']} has no tasks yet{', and no float' if a['critical'] else ''}.", [a["id"]], _task(f"Break down {a['id']}: {a['name']}", "Planning engineer", a["start"], a["id"])))
    elif module == "schedule":
        said = {"moved": "Recover the time on", "behind": "Catch up", "overdue": "Finish", "held": "Clear what holds", "milestone": "Protect the milestone on"}
        for d in sorted(r["delays"], key=lambda x: x["level"] != "high")[:4 + room]:
            out.append(_item(f"{said.get(d['kind'], 'Look at')} {d['activity']}", d["text"], [d["activity"]], _task(f"{said.get(d['kind'], 'Look at')} {d['activity']}", "Project planner", _plus(1), d["activity"])))
        for c in r["plan_checks"][:2 + room]:
            out.append(_item("Resolve what the programme cannot hold", c["text"], [c["rule"]], _open("schedule/resources")))
    elif module == "cost":
        for c in r["plan_checks"][:3 + room]:
            out.append(_item("Raise a variation" if c["rule"].startswith("boq_") else "Check the plan's cost", c["text"], [c["rule"].replace("boq_", "")], _task(f"Commercial: {c['text'][:80]}", "Commercial manager", _plus(7))))
        for p in [p for p in r["packages"] if p["variance"] < -0.01 * p["budget"]][:3 + room]:
            out.append(_item(f"Review {p['name']}: forecast over budget", f"Forecast over by Rp {round(-p['variance']):,}, with a cost index of {p['cpi']:.2f}.", [p["id"]], _task(f"Cost review: {p['name']}", "Commercial manager", _plus(7))))
        if r["claim"] and r["claim"]["status"] == "draft" and r["claim"]["beyond_evidence"]:
            out.append(_item("Adjust the draft claim to the evidence", f"Rp {r['claim']['beyond_evidence']:,} is claimed beyond the evidence, and Rp {r['claim']['not_billed']:,} of finished work is not billed.", [r["claim"]["id"]], _open("cost/claims")))
    elif module == "kanban":
        if r["waiting_plan"]:
            out.append(_item(f"Approve {r['waiting_plan']['id']} to put {r['waiting_plan']['tasks']} tasks on the board", "They are waiting for a decision.", [r["waiting_plan"]["id"]], _open("wbs/plan")))
        for b in r["bottlenecks"][:4 + room]:
            out.append(_item("Order the material the plan needs" if b["ref"] == "requests" else f"Clear {b['ref']}", f"{b['text']}. It holds {b['held']} tasks{f', {b_critical} of them critical' if (b_critical := b['critical']) else ''}.", [b["ref"]] if b["ref"] != "requests" else ["bottlenecks"], _open(b["go"])))
    elif module == "documents":
        for d in [x for x in r["documents"] if x["replaced_by"]][:2 + room]:
            out.append(_item(f"Withdraw {d['id']} from the working set", f"{d['replaced_by']} replaces it{f', and {len(d_cited)} tasks still cite it' if (d_cited := d['cited_by']) else ''}.", [d["id"], d["replaced_by"]], _task(f"Withdraw {d['id']} and tell the site", "Document controller", _plus(1))))
        for x in [x for x in r["rfis"] if x["status"] == "draft"][:3 + room]:
            out.append(_item(f"Issue {x['id']}: {x['subject']}", "It is a draft: nobody has been asked yet.", [x["id"]], _open(f"documents/rfis:{x['id']}")))
        for x in [x for x in r["rfis"] if x["status"] == "open"][:3 + room]:
            out.append(_item(f"Chase {x['id']}: {x['subject']}", f"{x['to']} owes the answer by {x['due']}. {x['impact']}", [x["id"]], _task(f"Chase {x['to']} on {x['id']}", "Project engineer", _plus(1), x.get("activity") or "")))
    elif module == "procurement":
        for m in [m for m in r["materials"] if m["state"] in ("not_ordered", "late")][:4 + room]:
            out.append(_item(f"Order {m['name']} ({m['order']})" if m["state"] == "not_ordered" else f"Bring {m['name']} forward", f"Tasks {', '.join(m['tasks'])} need it from {m['needed']}." + (f" {', '.join(m['maybe_covered_by'])} may already cover it: check before ordering." if m["maybe_covered_by"] else ""), [m["order"], *m["maybe_covered_by"]], _open(f"procurement/orders:{m['order']}")))
        for o in [o for o in r["orders"] if o["promised"] > o["needed"]][:3 + room]:
            out.append(_item(f"Expedite {o['id']}: {o['item']}", f"Needed {o['needed']}, promised {o['promised']}.", [o["id"]], _task(f"Expedite {o['id']} with {o['supplier']}", "Procurement officer", _plus(1), o.get("activity") or "")))
        for g in [g for g in r["gaps"] if g["gap"]][:3 + room]:
            out.append(_item(f"Programme {g['by_name']} on {g['activity']}", f"The plan needs them for {', '.join(g['sections']) or 'this work'}, and the programme names only {g['programmed_name']}.", [g["activity"]], _open("procurement/assignments")))
        for s in [s for s in r["subcontractors"] if s["expired"]][:2 + room]:
            out.append(_item(f"Renew {s['expired'][0]}: {s['name']}", "It has expired. Renew it before more work is released.", [s["id"]], _open(f"procurement/subs:{s['id']}")))
    elif module == "quality":
        for n in r["ncrs"][:3 + room]:
            out.append(_item(f"Close {n['id']} by {n['due']}", n["title"], [n["id"]], _open(f"quality/ncrs:{n['id']}")))
        for i in [i for i in r["inspections"] if i.get("hold_point") and i["status"] == "planned"][:3 + room]:
            out.append(_item(f"Give notice for hold point {i['id']}", f"{i['title']}: work stops until it is signed, on {i['next']}.", [i["id"]], _task(f"Book the engineer for {i['id']}", "QC engineer", _plus(1), i.get("activity") or "")))
    else:
        rank = {"bad": 0, "warn": 1, "ok": 2, "none": 3}
        for h in sorted(r["health"], key=lambda x: rank[x["tone"]])[:3 + room]:
            if h["tone"] in ("bad", "warn"):
                out.append(_item(f"{h['name']}: {h['value']}", h["note"], [h["key"]], _open(h["key"])))
        for x in r["attention"][:3 + room]:
            if x["level"] == "high":
                out.append(_item(x["title"], x["detail"], [x["ref"]] if x["ref"] else [x["rule"]], _open(f"{x['tab']}:{x['ref']}" if x["ref"] else x["tab"])))
    return out[:6 + room]


def checked(items: list[dict], records: dict, actions: tuple[str, ...] = ("work_item", "rfi")) -> tuple[list[dict], int]:
    """An agent's recommendation stands only if it cites records that exist and uses only figures they hold. Only the offline rules may also send a person to a screen."""
    text = json.dumps(records, ensure_ascii=False, default=str)
    known = numbers_in(text)
    kept, dropped = [], 0
    for x in items:
        if not isinstance(x, dict) or not x.get("title"):
            dropped += 1
            continue
        refs = [str(r) for r in x.get("refs") or []]
        figures = numbers_in(f"{x.get('title', '')} {x.get('why', '')}")
        if not refs or any(r not in text for r in refs) or {f for f in figures if len(f) >= 2} - known:
            dropped += 1
            continue
        action = x.get("action") if isinstance(x.get("action"), dict) else {"type": "none"}
        if action.get("type") == "work_item" and not (action.get("title") and action.get("owner") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(action.get("due") or ""))):
            action = {"type": "none"}
        kept.append({"title": str(x["title"]), "why": str(x.get("why") or ""), "refs": refs, "action": action if action.get("type") in actions else {"type": "none"}, "state": "open"})
    return kept, dropped


def _repeats(x: dict, m: dict) -> bool:
    """A model says the same thing in new words every time. It counts as the same recommendation only if it rests on the same record, says nearly the same, and has no figure the earlier one did not: a new figure means something changed."""
    text = f"{x['title']} {x['why']}"
    return bool(set(x["refs"]) & set(m.get("refs", "").split(","))) and memory.closeness(text, m["text"]) >= SAME_WORDS and numbers_in(text) <= numbers_in(m["text"])


def _holds(m: dict) -> bool:
    """Work accepted and since finished or thrown out no longer answers the recommendation. A dismissal holds."""
    w = P.get("work_item", m.get("made") or "") if m["kind"] == "accepted" else None
    return not w or w["status"] not in ("done", "rejected", "superseded")


def _with_memory(items: list[dict], known: list[dict], mode: str) -> list[dict]:
    """A decision stays decided until the figures behind it change, and what people learned goes with the recommendation it bears on. The offline rules repeat themselves word for word; a model's repeats are found by how close they are."""
    fresh, decided = [], []
    for x in items:
        m = next((m for m in known if m.get("sign") == memory.sign(x) or (mode == "muse" and _repeats(x, m))), None)
        if m and _holds(m):
            decided.append({**x, "state": m["kind"], "made": m.get("made") or "", "decided_by": m["by"], "remembered": m["on"], "memory": m["id"]})
        else:
            fresh.append(x)
    fresh = fresh[:MOST_ITEMS]
    for x in fresh:
        x["lessons"] = memory.recall(f"{x['title']} {x['why']} {' '.join(x['refs'])}", limit=1, floor=ON_A_CARD)
    return [*fresh, *decided]


def lessons_for(agent: dict) -> str:
    """For an agent of the swarm: what was learned on the modules its line works on, and what was noted for the whole project. By line, because a role's description shares few words with what it needs to know."""
    return memory.brief(memory.lessons([*LINES.get(agent.get("lini", ""), list(BENCH)), "tower"], f"{agent['name']} {agent['peran']}", 5))


async def _ask_muse(module: str, records: dict, on_usage: Callable[[int, int], None], known: list[dict], lessons: list[dict]) -> str:
    bench = BENCH[module]
    decided = "\nPeople already decided these, so do not recommend them again unless the records now say something different:\n" + "\n".join(f"- {m['text'][:240]}" for m in known[:12]) if known else ""
    instruction = f"""You are the {bench['name']} on the {bench['module']} module of a construction management system. Your job: {bench['does']}.
{RULES}
Read the module's records in the message and recommend up to 5 things a person should do next, the most important first. Today is {P.TODAY}. Answer with JSON only:
{{"summary": "one sentence on how this module stands", "recommendations": [{{"title": "what to do, starting with a verb", "why": "one sentence, with the figures from the records", "refs": ["ids of the records it rests on"], "action": {{"type": "work_item", "title": "the task", "owner": "who must do it", "due": "YYYY-MM-DD", "activity": "activity id or empty"}}}}]}}
Use action type "rfi" with subject, question, to and activity when only someone outside can settle it. Use type "none" when it is only advice.{memory.brief(lessons)}{decided}"""
    return await llm.turn(llm.muse(SPARK, ANSWER_TOKENS, effort="low"), instruction, [], json.dumps(records, ensure_ascii=False, default=str)[:30000], 1, on_usage)


async def ask(module: str, mode: str = "mock") -> dict:
    """The module's agent looks again. The answer replaces its last one, and changes nothing else."""
    if module not in BENCH:
        raise KeyError(module)
    records = records_of(module)
    known = memory.decisions(module)
    lessons: list[dict] = []
    used = [0, 0]
    dropped = 0
    summary = ""

    def count(i: int, o: int) -> None:
        used[0] += i
        used[1] += o

    if mode == "muse":
        if not config.muse_ready():
            raise ValueError("a real run needs META_API_KEY in .env.local")
        lessons = memory.lessons([module, "tower"], BENCH[module]["does"])
        raw = parse_json(await _ask_muse(module, records, count, known, lessons))
        if raw is None:
            raise ValueError(NO_ANSWER)  # never shown as "nothing to act on": no answer is not an all-clear
        items, dropped = checked(raw.get("recommendations") or [], records)
        summary = str(raw.get("summary") or "")
    elif mode == "mock":
        items, dropped = checked(worked_out(module, records, len(known)), records, ("work_item", "rfi", "open"))
    else:
        raise ValueError("mode must be mock or muse")
    items = _with_memory(items, known, mode)
    fresh = sum(x["state"] == "open" for x in items)
    if mode == "mock":
        summary = f"{fresh} {'thing' if fresh == 1 else 'things'} to look at, worked out by code from the records." if fresh else "Nothing to act on in these records."
    if len(items) > fresh:
        summary += f" {len(items) - fresh} already decided, and not asked again."
    price = PRICE[SPARK]
    return P.put("advice", module, {"id": module, "mode": mode, "agent": BENCH[module]["name"], "summary": summary, "items": items, "dropped": dropped, "at": time.strftime("%Y-%m-%d %H:%M"), "tokens": {"prompt": used[0], "output": used[1]}, "usd": round((used[0] * price[0] + used[1] * price[1]) / 1e6, 5)}, BENCH[module]["name"], "recommended", f"{fresh} items, {mode}")


def view(module: str) -> dict:
    """The module's bench: who works on it, what the planning swarm found that belongs here, and its agent's latest recommendations."""
    if module not in BENCH:
        raise KeyError(module)
    return {**BENCH[module], "key": module, "findings": M.signals_for(BENCH[module]["tags"]), "advice": P.get("advice", module), "muse_ready": config.muse_ready()}


def bench() -> dict:
    """Every module's agents, for the map in the control tower."""
    return {"modules": [{"key": k, **b, "findings": len(M.signals_for(b["tags"])), "advice": (P.get("advice", k) or {}).get("at")} for k, b in BENCH.items()]}


def memories() -> dict:
    """What the agents remember, for a person to read and correct."""
    return {"memories": memory.of(), "status": memory.status()}


def note(module: str, text: str, who: str = P.PM) -> dict:
    if module not in BENCH:
        raise KeyError(module)
    return memory.note(text, module, who)


def forget(mid: str, who: str = P.PM) -> dict:
    """A person takes something out of memory. It goes from the cards that quote it as well, and a dismissal forgotten is a recommendation asked again."""
    row = memory.forget(mid, who)
    quoted = False
    for rec in P.all_of("advice"):
        changed = False
        for x in rec["items"]:
            if any(m["id"] == mid for m in x.get("lessons") or []):
                x["lessons"] = [m for m in x["lessons"] if m["id"] != mid]
                changed = quoted = True
            if x.get("memory") == mid and x["state"] == "dismissed":
                x.update(state="open", made="", decided_by="", remembered="", memory="")
                changed = True
        if changed:
            P.put("advice", rec["id"], rec)
    if quoted:
        P.vacuum()
    return row


def decide(module: str, index: int, verdict: str, who: str = P.PM) -> dict:
    """A person accepts or dismisses one recommendation, or brings a dismissed one back. Accepting is what puts it on the board, or in the RFI register as a draft."""
    rec = P.get("advice", module)
    if not rec or not 0 <= index < len(rec["items"]):
        raise KeyError(f"{module}/{index}")
    item = rec["items"][index]
    if verdict == "reopen":
        if item["state"] != "dismissed":
            raise ValueError("only a dismissed recommendation can be brought back")
        if item.get("memory"):
            try:
                memory.forget(item["memory"], who)
            except KeyError:
                pass  # a person already forgot it from the memory screen
        item.update(state="open", made="", decided_by="", remembered="", memory="")
        return P.put("advice", module, rec, who, "brought back a recommendation", item["title"])
    if item["state"] != "open":
        raise ValueError("this recommendation has already been decided")
    made = ""
    if verdict == "accept":
        a = item["action"]
        if a.get("type") == "work_item":
            made = P.add_work_item(a["title"], a["owner"], a["due"], a.get("activity") or "", who, why=item["why"], proposed_by=rec["agent"])["id"]
        elif a.get("type") == "rfi":
            made = P.add_rfi({"subject": a.get("subject") or item["title"], "question": a.get("question") or item["why"], "to": a.get("to") or "Engineer", "activity": a.get("activity") or "", "impact": item["why"], "drafted_by": rec["agent"]}, "draft", rec["agent"])["id"]
    elif verdict != "dismiss":
        raise ValueError("verdict must be accept or dismiss")
    item.update(state="accepted" if verdict == "accept" else "dismissed", made=made, decided_by=who)
    item["memory"] = (memory.decided(module, item, who) or {}).get("id", "")
    P.log(who, f"{verdict}ed a recommendation" if verdict == "accept" else "dismissed a recommendation", "advice", module, item["title"])
    return P.put("advice", module, rec)


# ------------------------------------------------------------------------------------------------ reading a document and a photo


async def read_document(did: str, mode: str = "mock") -> dict:
    """The document controller reads one document: a summary, what it states, and what should go to someone as a question. A quote not in the text is dropped by code."""
    d = M.document_text(did)
    used = [0, 0]

    def count(i: int, o: int) -> None:
        used[0] += i
        used[1] += o

    from . import extract

    facts = extract.facts(d["text"])
    if mode == "muse":
        if not config.muse_ready():
            raise ValueError("a real run needs META_API_KEY in .env.local")
        if not d["text"].strip():
            raise ValueError("this document has no text to read")
        instruction = f"""You are the document controller of a construction project. Read the document in the message. {RULES}
Answer with JSON only: {{"summary": "two sentences: what this document is and what it requires", "key_points": [{{"point": "what it requires, in plain words", "quote": "the exact words from the document"}}], "questions": [{{"subject": "short", "question": "what only someone outside can settle, because the document is unclear or contradicts itself", "to": "who should answer"}}]}}"""
        raw = parse_json(await llm.turn(llm.muse(SPARK, ANSWER_TOKENS, effort="low"), instruction, [], d["text"][:30000], 1, count))
        if raw is None:
            raise ValueError(NO_ANSWER)
        flat = re.sub(r"\s+", " ", d["text"])
        points = [p for p in raw.get("key_points") or [] if isinstance(p, dict) and re.sub(r"\s+", " ", str(p.get("quote") or "")) in flat and p.get("quote")]
        reading = {"summary": str(raw.get("summary") or ""), "key_points": points, "questions": [q for q in raw.get("questions") or [] if isinstance(q, dict) and q.get("subject")], "dropped": len(raw.get("key_points") or []) - len(points)}
    elif mode == "mock":
        kinds = ", ".join(f"{len(v)} {k}" for k, v in facts.items()) or "nothing a rule can pick out"
        reading = {"summary": f"Read by code, with no model: {kinds}.", "key_points": [], "questions": [], "dropped": 0}
    else:
        raise ValueError("mode must be mock or muse")
    price = PRICE[SPARK]
    reading.update(mode=mode, at=time.strftime("%Y-%m-%d %H:%M"), usd=round((used[0] * price[0] + used[1] * price[1]) / 1e6, 5))
    o = P.get("document", did) or {"id": did}
    P.put("document", did, {**o, "reading": reading}, "Document agent", "read a document", d["title"])
    return reading


DEFECT_PROMPT = """This photo is from a construction site. It should show: {caption}.
List only defects you can actually see: misplaced or missing reinforcement, honeycombing, cracks, misaligned formwork, unsafe work, poor workmanship. Do not guess at what you cannot see, and say so if the work is hidden.
Answer with JSON only: {{"visible": true or false, "defects": [{{"what": "the defect", "where": "where in the photo", "severity": "low, medium or high"}}]}}"""


async def review_photo(photo_id: str, mode: str = "mock") -> dict:
    """An agent looks for defects in one photo. It reports what it saw: a person raises the NCR. Offline, the reading is scripted and says so."""
    data = ProjectData.load() if not P.is_blank() else None
    photo = (data.photo(photo_id) if data else None) or P.get("photo", photo_id)
    if not photo:
        raise KeyError(photo_id)
    used = (0, 0)
    if mode == "muse":
        if not config.muse_ready():
            raise ValueError("a real run needs META_API_KEY in .env.local")
        import httpx

        file = photo_file(photo)
        mime = "image/jpeg" if file.suffix.lower() in (".jpg", ".jpeg") else "image/png"
        body = {"model": SPARK, "temperature": 0, "max_tokens": 1500, "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(file.read_bytes()).decode()}"}}, {"type": "text", "text": DEFECT_PROMPT.format(caption=photo.get("caption") or "site work")}]}]}
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{llm.MUSE_URL}/chat/completions", headers={"Authorization": f"Bearer {config.setting('META_API_KEY')}"}, json=body)
        r.raise_for_status()
        out = r.json()
        usage = out.get("usage") or {}
        used = (usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0))
        seen = parse_json(out["choices"][0]["message"]["content"] or "") or {}
        result = {"visible": bool(seen.get("visible")), "defects": [x for x in seen.get("defects") or [] if isinstance(x, dict) and x.get("what")], "method": f"read by {SPARK}"}
    elif mode == "mock":
        ncr = P.get("ncr", "NCR-014") or {}
        scripted = photo.get("item_code") == "ST-06" and ncr.get("status") == "open"
        result = {"visible": True, "defects": [{"what": "Top mat spacing looks uneven along one grid line", "where": "slab rebar", "severity": "high"}] if scripted else [], "method": "offline mock: scripted, not a reading of this photo"}
    else:
        raise ValueError("mode must be mock or muse")
    price = PRICE[SPARK]
    return P.put("photo_review", photo_id, {"id": photo_id, **result, "mode": mode, "at": time.strftime("%Y-%m-%d %H:%M"), "usd": round((used[0] * price[0] + used[1] * price[1]) / 1e6, 5)}, "Quality agent", "reviewed a photo", f"{len(result['defects'])} defects, {mode}")


def upload_folder():
    return P.upload_folder()


def photo_file(photo: dict):
    if photo.get("source") == "upload":
        return upload_folder() / photo["file"]
    return ProjectData.load().folder / "photos" / photo["file"]

"""Is the app really being used? Each measure is read from the records people leave by working in it, with its target, and one that cannot be measured yet says so instead of showing a score. For an owner to hold a team to, per project and across the firm. No model is called."""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta

from fastapi import APIRouter

from . import project as P

RECENT = 30  # days of activity counted as who is using it now


def _days(a: str, b: str) -> int:
    return (date.fromisoformat(b[:10]) - date.fromisoformat(a[:10])).days


def _working_days(first: str, last: str) -> list[str]:
    """Monday to Saturday, as a site works."""
    out, day, end = [], date.fromisoformat(first), date.fromisoformat(last)
    while day <= end:
        if day.weekday() < 6:
            out.append(day.isoformat())
        day += timedelta(days=1)
    return out


def _measure(key: str, name: str, value: float | None, unit: str, target: str, good: bool | None, note: str, go: str, higher: bool = True) -> dict:
    return {"key": key, "name": name, "value": value, "unit": unit, "target": target, "state": "none" if value is None else "good" if good else "behind", "note": note, "go": go, "higher": higher}


def measures() -> dict:
    today = P.TODAY
    acts = P.schedule()["activities"]
    start = min((a["baseline_start"] for a in acts), default=today)
    begun = start <= today
    out = []
    # daily logs
    days = _working_days(start, min(today, max((a["baseline_finish"] for a in acts), default=today))) if begun else []
    filed = {r["date"] for r in P.all_of("daily_report")}
    done = sum(1 for d in days if d in filed)
    out.append(_measure("daily", "Daily logs filed", round(100 * done / len(days)) if days else None, "%", "95% of working days", bool(days) and done / len(days) >= 0.95, f"{done} of {len(days)} working days" if days else "Nothing to measure until work starts", "site"))
    # RFIs
    rows = P.all_of("rfi")
    answered = [r for r in rows if r["status"] == "answered" and r.get("answered_on") and (r.get("issued_on") or r.get("raised_on"))]
    turn = [_days(r.get("issued_on") or r["raised_on"], r["answered_on"]) for r in answered]
    waiting = [r for r in rows if r["status"] == "open"]
    late = sum(1 for r in waiting if _days(r.get("issued_on") or r["raised_on"], today) > 7)
    out.append(_measure("rfi", "RFI turnaround", round(sum(turn) / len(turn), 1) if turn else None, "days", "7 days or less", bool(turn) and sum(turn) / len(turn) <= 7, f"{len(answered)} answered, {len(waiting)} waiting{f', {late} over 7 days' if late else ''}" if rows and (answered or waiting) else f"{sum(1 for r in rows if r['status'] == 'draft')} drafts, none sent yet", "exchange/rfis", higher=False))
    # the other side answering in the app, not by email
    via = sum(1 for r in answered if r.get("answered_via") == "link")
    out.append(_measure("link", "Answers given in the app", round(100 * via / len(answered)) if answered else None, "%", "80% by link", bool(answered) and via / len(answered) >= 0.8, f"{via} of {len(answered)} answered by the consultant themselves" if answered else "No RFI answered yet", "exchange/rfis"))
    # submittals
    subs = P.all_of("submittal")
    sent = [s for s in subs if s["status"] != "draft"]
    in_time = [s for s in sent if s.get("needed_by") and (s.get("decided_on") or "9999") <= s["needed_by"]]
    due = [s for s in sent if s.get("needed_by") and (s.get("decided_on") or s["needed_by"] < today)]
    out.append(_measure("submittal", "Submittals approved in time", round(100 * len(in_time) / len(due)) if due else None, "%", "90% before the work needs them", bool(due) and len(in_time) / len(due) >= 0.9, f"{len(in_time)} of {len(due)} in time, {sum(1 for s in subs if s['status'] == 'draft')} drafts" if subs else "No submittals on the register yet", "exchange/submittals"))
    # the budget kept up to date
    weeks = max(0, _days(start, today) // 7 + 1) if begun else 0
    marked = sum(1 for r in P.all_of("actual_week") if r["week"] <= weeks)  # a week recorded ahead of itself says nothing about keeping up
    out.append(_measure("budget", "Actuals kept up to date", round(100 * min(marked, weeks) / weeks) if weeks else None, "%", "Every week", bool(weeks) and marked >= weeks, f"{marked} of {weeks} weeks recorded" if weeks else "Nothing to record until work starts", "cost"))
    # variations reaching a decision
    vo = P.all_of("variation")
    decided = [v for v in vo if v["status"] in ("approved", "rejected")]
    out.append(_measure("variation", "Variations decided", round(100 * len(decided) / len(vo)) if vo else None, "%", "75% of those raised", bool(vo) and len(decided) / len(vo) >= 0.75, f"{len(decided)} of {len(vo)} raised" if vo else "No variations raised yet", "cost/control:variations"))
    # who is using it
    since = (date.fromisoformat(today) - timedelta(days=RECENT)).isoformat()
    log = [e for e in P.audit(5000) if str(e.get("t", ""))[:10] >= since and e.get("who") != P.SWARM]
    people = Counter(e["who"] for e in log)
    scored = [m for m in out if m["state"] != "none"]
    score = round(100 * sum(1 for m in scored if m["state"] == "good") / len(scored)) if scored else None
    return {"today": today, "started": begun, "score": score, "scored": len(scored), "of": len(out), "measures": out, "people": [{"name": k, "actions": v} for k, v in people.most_common(10)], "actions": len(log)}


def firmwide() -> dict:
    rows = []
    for p in P.projects()["projects"]:
        path = P.path_of(p["id"])
        if path is None or not path.exists():
            continue
        with P.visiting(path):
            m = measures()
        rows.append({"id": p["id"], "name": str(p["name"]).replace(" (fictional)", ""), "score": m["score"], "scored": m["scored"], "of": m["of"], "actions": m["actions"], "people": len(m["people"]), "measures": [{k: x[k] for k in ("key", "state", "value", "unit")} for x in m["measures"]]})
    return {"projects": rows}


router = APIRouter()


@router.get("/api/project/scorecard")
def scorecard() -> dict:
    return measures()


@router.get("/api/reports/scorecard")
def scorecard_all() -> dict:
    return firmwide()

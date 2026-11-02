"""The agents' tools. Each agent only gets the tools of its own source, so the sources stay independent readings of the
project: the field agent cannot see the claim, the document agent cannot see the photos.

Every submitted number goes through a code check here: a finding whose number or evidence does not match the source is
refused, told why, and never reaches the comparison.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from typing import Callable

from google.adk.tools import ToolContext

from . import config
from .reconcile import NEEDS_RULING


@dataclass
class RunContext:
    data: object
    vision: object
    emit: Callable[[dict], None]
    vision_results: dict = field(default_factory=dict)
    refused: list = field(default_factory=list)
    llm_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def usd(self) -> float:
        return (self.input_tokens * config.PRICE_INPUT_PER_M + self.output_tokens * config.PRICE_OUTPUT_PER_M) / 1_000_000


RUNS: dict[str, RunContext] = {}


def run_of(tool_context: ToolContext) -> RunContext:
    return RUNS[tool_context.state["run_id"]]


def _refuse(run: RunContext, agent: str, code: str, reason: str) -> dict:
    run.refused.append({"agent": agent, "item_code": code, "reason": reason})
    run.emit({"type": "refused", "agent": agent, "code": code, "reason": reason})
    return {"ok": False, "refused": reason}


def check_finding(run: RunContext, source: str, code: str, pct: float, evidence_ids: list[str]) -> str | None:
    """Why this finding must be refused, or None. Numbers within one point of the source pass (rounding)."""
    data = run.data
    if code not in data.boq:
        return f"unknown item code {code}"
    if not 0 <= pct <= 100:
        return f"progress {pct} is outside 0-100"
    if not evidence_ids:
        return "a finding needs evidence"
    missing = [e for e in evidence_ids if data.evidence(e) is None]
    if missing:
        return f"evidence does not exist: {', '.join(missing)}"
    if source == "field":
        seen = [run.vision_results[p["id"]] for p in data.photos_of(code) if p["id"] in run.vision_results]
        if not seen:
            return "no photo of this item has been inspected"
        latest = seen[-1]
        if latest["photo_id"] not in evidence_ids:
            return f"use the latest photo of the item, {latest['photo_id']}"
        if latest["pct"] is None or abs(latest["pct"] - pct) > 1:
            return f"{latest['photo_id']} reads {latest['pct']}%, not {pct}%"
    elif source == "schedule":
        planned = data.schedule[code]["planned_pct_at_cutoff"]
        if f"SCH-{code}" not in evidence_ids:
            return f"cite SCH-{code}"
        if abs(planned - pct) > 1:
            return f"the schedule says {planned}%, not {pct}%"
    return None


def _source_tools(source: str, agent: str) -> list[Callable]:
    def submit_finding(item_code: str, pct: float, evidence_ids: list[str], note: str, tool_context: ToolContext) -> dict:
        """Record the progress % this source shows for one item, citing the evidence IDs it comes from."""
        run = run_of(tool_context)
        why = check_finding(run, source, item_code, pct, evidence_ids)
        if why:
            return _refuse(run, agent, item_code, why)
        tool_context.state[f"finding:{source}:{item_code}"] = {"pct": pct, "evidence_ids": evidence_ids, "note": note}
        run.emit({"type": "finding", "source": source, "code": item_code, "pct": pct})
        return {"ok": True}

    def submit_not_verifiable(item_code: str, reason: str, evidence_ids: list[str], tool_context: ToolContext) -> dict:
        """Record that this source cannot establish the progress of one item, and why. Use it instead of guessing."""
        run = run_of(tool_context)
        if item_code not in run.data.boq:
            return _refuse(run, agent, item_code, f"unknown item code {item_code}")
        tool_context.state[f"finding:{source}:{item_code}"] = {"pct": None, "reason": reason, "evidence_ids": evidence_ids}
        run.emit({"type": "finding", "source": source, "code": item_code, "pct": None, "reason": reason})
        return {"ok": True}

    return [submit_finding, submit_not_verifiable]


# ------------------------------------------------------------------------------------------------ lead

def get_claim_overview(tool_context: ToolContext) -> dict:
    """The project and the draft claim's lines."""
    data = run_of(tool_context).data
    return {"project": data.project, "lines": [{"code": c, "name": data.boq[c]["name"], "area": data.boq[c]["area"], "value": data.boq[c]["value"],
                                                "claimed_pct": data.claim[c]["claimed_pct"], "amount_claimed": data.claim[c]["amount"]} for c in data.codes]}


def set_plan(plan: str, focus_items: list[str], tool_context: ToolContext) -> dict:
    """Record the review plan and the item codes most worth attention. Every line is reviewed either way."""
    run = run_of(tool_context)
    focus = [c for c in focus_items if c in run.data.boq]
    tool_context.state["plan"] = {"plan": plan, "focus_items": focus}
    run.emit({"type": "plan", "plan": plan, "focus_items": focus})
    return {"ok": True}


def get_final_report(tool_context: ToolContext) -> dict:
    """The reviewed claim: totals, the lines that need action and the extra work found."""
    core = tool_context.state.get("report_core") or {}
    return {"totals": core.get("totals"), "extra_work": core.get("extra_work"),
            "action_lines": [{k: x[k] for k in ("code", "name", "status", "reason", "impact", "billing_difference")}
                             for x in core.get("lines", []) if x["status"] != "supported"]}


# ------------------------------------------------------------------------------------------------ field

def list_site_photos(tool_context: ToolContext) -> dict:
    """Every item to report on, and every site photo with its item, area and date."""
    data = run_of(tool_context).data
    return {"cutoff": data.project["cutoff"], "items": [{"code": c, "name": data.boq[c]["name"], "area": data.boq[c]["area"]} for c in data.codes],
            "photos": [{k: p[k] for k in ("id", "item_code", "area", "date", "caption")} for p in data.photos]}


async def inspect_photos(photo_ids: list[str], tool_context: ToolContext) -> dict:
    """Read site photos. Returns for each one whether the work is visible, the elements installed, the total and the %."""
    run = run_of(tool_context)
    gate = asyncio.Semaphore(4)

    async def one(photo_id: str) -> dict:
        photo = run.data.photo(photo_id)
        if not photo:
            return {"photo_id": photo_id, "error": "no such photo"}
        async with gate:
            seen, used_in, used_out = await run.vision.inspect(photo)
        run.input_tokens += used_in
        run.output_tokens += used_out
        run.vision_results[photo_id] = seen
        run.emit({"type": "photo", "photo_id": photo_id, "item_code": photo["item_code"], "pct": seen["pct"], "visible": seen["visible"]})
        return seen

    return {"results": await asyncio.gather(*(one(p) for p in photo_ids))}


# ------------------------------------------------------------------------------------------------ schedule

def read_schedule(tool_context: ToolContext) -> dict:
    """Planned progress of every item at the cut-off date. Evidence ID of an item: SCH-<code>."""
    data = run_of(tool_context).data
    return {"cutoff": data.project["cutoff"], "items": [{"code": c, "name": data.boq[c]["name"], "planned_pct": data.schedule[c]["planned_pct_at_cutoff"],
                                                         "evidence_id": f"SCH-{c}"} for c in data.codes]}


# ------------------------------------------------------------------------------------------------ documents

def read_daily_logs(tool_context: ToolContext) -> dict:
    """Every BoQ item with its quantity, and every daily log entry as the foremen wrote it."""
    data = run_of(tool_context).data
    return {"items": [{"code": c, "name": data.boq[c]["name"], "area": data.boq[c]["area"], "unit": data.boq[c]["unit"], "boq_qty": data.boq[c]["qty"]} for c in data.codes],
            "entries": data.logs}


def record_log_quantities(item_code: str, log_ids: list[str], quantities: list[float], note: str, tool_context: ToolContext) -> dict:
    """Record the completed quantity each log entry adds to one item: log_ids and quantities are parallel lists, and a
    removal is negative. Code adds them up and works out the % of the BoQ quantity. Each quantity must be written in its entry."""
    run = run_of(tool_context)
    data = run.data
    if item_code not in data.boq:
        return _refuse(run, "documents", item_code, f"unknown item code {item_code}")
    if not log_ids or len(log_ids) != len(quantities):
        return _refuse(run, "documents", item_code, "log_ids and quantities must be non-empty lists of the same length")
    for log_id, qty in zip(log_ids, quantities):
        entry = data.log(log_id)
        if entry is None:
            return _refuse(run, "documents", item_code, f"no such log entry: {log_id}")
        if abs(qty) not in {float(n) for n in re.findall(r"\d+(?:\.\d+)?", entry["text"])}:
            return _refuse(run, "documents", item_code, f"{log_id} does not say {abs(qty):g}")
    pct = round(100 * sum(quantities) / data.boq[item_code]["qty"], 1)
    if not 0 <= pct <= 101:
        return _refuse(run, "documents", item_code, f"these quantities add up to {pct}% of the BoQ quantity")
    tool_context.state[f"finding:documents:{item_code}"] = {"pct": pct, "evidence_ids": log_ids, "note": note, "quantities": quantities}
    run.emit({"type": "finding", "source": "documents", "code": item_code, "pct": pct})
    return {"ok": True, "pct": pct}


def read_change_orders(tool_context: ToolContext) -> dict:
    """The change orders on record."""
    return {"change_orders": run_of(tool_context).data.change_orders}


def report_extra_work(title: str, log_ids: list[str], note: str, tool_context: ToolContext) -> dict:
    """Report work done on site that is on no BoQ item and has no approved change order, so it cannot be billed yet."""
    run = run_of(tool_context)
    bad = [i for i in log_ids if run.data.log(i) is None]
    if not log_ids or bad:
        return _refuse(run, "documents", title, f"cite log entries that exist; these do not: {', '.join(bad) or 'none given'}")
    approved = {c["id"] for c in run.data.change_orders if c["status"] == "approved"}
    covered = [i for i in log_ids if approved & set(re.findall(r"CO-\d+", run.data.log(i)["text"]))]
    if covered:
        return _refuse(run, "documents", title, f"already covered by an approved change order: {', '.join(covered)}")
    key = "extra:" + "+".join(sorted(log_ids))
    tool_context.state[key] = {"title": title, "log_ids": sorted(log_ids), "note": note}
    run.emit({"type": "extra_work", "title": title, "log_ids": sorted(log_ids), "note": note})
    return {"ok": True}


# ------------------------------------------------------------------------------------------------ cost

def read_claim_and_boq(tool_context: ToolContext) -> dict:
    """Each claim line beside its BoQ item. expected_amount is what the BoQ price and claimed % give; difference is the claim minus that."""
    data = run_of(tool_context).data
    lines = []
    for c in data.codes:
        item, line = data.boq[c], data.claim[c]
        diff = data.billing_difference(c)
        lines.append({"code": c, "name": item["name"], "qty": item["qty"], "boq_unit_price": item["unit_price"], "claim_unit_price": line["unit_price"],
                      "claimed_pct": line["claimed_pct"], "amount_claimed": line["amount"], "expected_amount": line["amount"] - diff, "difference": diff,
                      "evidence_ids": [f"CL-{c}", f"BOQ-{c}"]})
    return {"lines": lines}


def submit_cost_check(item_code: str, result: str, evidence_ids: list[str], note: str, tool_context: ToolContext) -> dict:
    """Record whether one claim line matches the BoQ. result: "ok" or "mismatch"."""
    run = run_of(tool_context)
    if item_code not in run.data.boq:
        return _refuse(run, "cost", item_code, f"unknown item code {item_code}")
    truth = "mismatch" if run.data.billing_difference(item_code) else "ok"
    if result != truth:
        return _refuse(run, "cost", item_code, f"the figures say {truth}, not {result}")
    tool_context.state[f"cost:{item_code}"] = {"result": result, "evidence_ids": evidence_ids, "note": note}
    run.emit({"type": "cost_check", "code": item_code, "result": result})
    return {"ok": True}


# ------------------------------------------------------------------------------------------------ verifier

def get_flagged_items(tool_context: ToolContext) -> dict:
    """The conclusions that need a ruling, with their reasoning and evidence IDs."""
    data = run_of(tool_context).data
    lines = tool_context.state.get("reconciled") or []
    return {"cutoff": data.project["cutoff"], "stale_after_days": config.STALE_DAYS,
            "items": [{k: x[k] for k in ("code", "name", "status", "reason", "claimed_pct", "field_pct", "log_pct", "evidence_ids")}
                      for x in lines if x["status"] in NEEDS_RULING]}


def open_evidence(evidence_ids: list[str], tool_context: ToolContext) -> dict:
    """Open evidence records by ID: photos and daily log entries carry their dates, photos also their reading."""
    run = run_of(tool_context)
    out = {}
    for e in evidence_ids:
        record = run.data.evidence(e)
        out[e] = {"error": "no such evidence"} if record is None else {**record, **({"reading": run.vision_results.get(e)} if e.startswith("P-") else {})}
    return {"evidence": out}


def rule_on_item(item_code: str, decision: str, reason: str, tool_context: ToolContext) -> dict:
    """Confirm a conclusion or reject it. decision: "confirmed" or "rejected". A rejected item goes to on-site inspection."""
    run = run_of(tool_context)
    flagged = {x["code"] for x in (tool_context.state.get("reconciled") or []) if x["status"] in NEEDS_RULING}
    if item_code not in flagged:
        return _refuse(run, "verifier", item_code, "this item has no conclusion to rule on")
    if decision not in ("confirmed", "rejected"):
        return _refuse(run, "verifier", item_code, 'decision must be "confirmed" or "rejected"')
    tool_context.state[f"ruling:{item_code}"] = {"decision": decision, "reason": reason}
    run.emit({"type": "ruling", "code": item_code, "decision": decision, "reason": reason})
    return {"ok": True}


TOOLS = {
    "lead_plan": [get_claim_overview, set_plan],
    "field": [list_site_photos, inspect_photos, *_source_tools("field", "field")],
    "schedule": [read_schedule, *_source_tools("schedule", "schedule")],
    "documents": [read_daily_logs, read_change_orders, record_log_quantities, report_extra_work, _source_tools("documents", "documents")[1]],
    "cost": [read_claim_and_boq, submit_cost_check],
    "verifier": [get_flagged_items, open_evidence, rule_on_item],
    "lead_summary": [get_final_report],
}

"""An offline model: scripted per agent, it plays the same tool calls a real model would, at no cost.

The whole path runs for real (agents, parallel branches, tools, state, limits); only the model's answers are
scripted. A mock run proves the wiring and the checks. It says nothing about how accurate a real model would be.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Callable

from . import generator
from .llm import Scripted

Results = dict[str, list[dict]]
Brain = Callable[[Results], "list[tuple[str, dict]] | str"]


def call(name: str, **args) -> tuple[str, dict]:
    return name, args


def lead_plan(r: Results):
    if "get_claim_overview" not in r:
        return [call("get_claim_overview")]
    if "set_plan" not in r:
        lines = sorted(r["get_claim_overview"][0]["lines"], key=lambda x: -x["amount_claimed"])
        return [call("set_plan", plan="Read every line against photos, the schedule, daily logs and the BoQ, starting with the largest amounts.",
                     focus_items=[x["code"] for x in lines[:5]])]
    return "Plan set: every line goes to all four specialists."


def field(r: Results):
    if "list_site_photos" not in r:
        return [call("list_site_photos")]
    listing = r["list_site_photos"][0]
    if "inspect_photos" not in r:
        return [call("inspect_photos", photo_ids=[p["id"] for p in listing["photos"]])]
    if "submit_finding" in r or "submit_not_verifiable" in r:
        return "Photos read. Concealed work is marked as not verifiable."
    results = {x["photo_id"]: x for x in r["inspect_photos"][0]["results"]}
    latest: dict[str, dict] = {}
    for photo in sorted(listing["photos"], key=lambda p: p["date"]):
        latest[photo["item_code"]] = photo
    calls = []
    for item in listing["items"]:
        photo = latest.get(item["code"])
        seen = results.get(photo["id"]) if photo else None
        if seen and seen["visible"]:
            calls.append(call("submit_finding", item_code=item["code"], pct=seen["pct"], evidence_ids=[photo["id"]], note=f"{seen['installed']} of {seen['total']} installed"))
        else:
            why = "the photo only shows a finished surface" if photo else "no photo of this item"
            calls.append(call("submit_not_verifiable", item_code=item["code"], reason=why, evidence_ids=[photo["id"]] if photo else []))
    return calls


def schedule(r: Results):
    if "read_schedule" not in r:
        return [call("read_schedule")]
    if "submit_finding" in r:
        return "Planned progress recorded for every line."
    return [call("submit_finding", item_code=x["code"], pct=x["planned_pct"], evidence_ids=[x["evidence_id"]], note="planned at cut-off") for x in r["read_schedule"][0]["items"]]


def documents(r: Results):
    if "read_daily_logs" not in r:
        return [call("read_daily_logs"), call("read_change_orders")]
    if "record_log_quantities" in r or "submit_not_verifiable" in r:
        return "Daily logs read. Off-BoQ work without an approved change order is reported."
    # scripted: reads the true quantities from the generator. Understanding the free text is what a real model has to do
    truth = json.loads((generator.DATA_DIR / "_hidden" / "log_quantities.json").read_text(encoding="utf-8"))
    calls = []
    for item in r["read_daily_logs"][0]["items"]:
        entries = [(log_id, q[item["code"]]) for log_id, q in truth["quantities"].items() if item["code"] in q]
        if entries:
            calls.append(call("record_log_quantities", item_code=item["code"], log_ids=[e[0] for e in entries], quantities=[float(e[1]) for e in entries], note="completed quantities"))
        else:
            calls.append(call("submit_not_verifiable", item_code=item["code"], reason="no completed work in the daily log", evidence_ids=[]))
    for title, log_ids in truth["extra"].items():
        calls.append(call("report_extra_work", title=title, log_ids=log_ids, note="Done on site, on no BoQ item, no approved change order."))
    return calls


def cost(r: Results):
    if "read_claim_and_boq" not in r:
        return [call("read_claim_and_boq")]
    if "submit_cost_check" in r:
        return "Every claim line checked against the BoQ."
    return [call("submit_cost_check", item_code=x["code"], result="mismatch" if x["difference"] else "ok", evidence_ids=x["evidence_ids"],
                 note=f"difference {x['difference']}") for x in r["read_claim_and_boq"][0]["lines"]]


def verifier(r: Results):
    if "get_flagged_items" not in r:
        return [call("get_flagged_items")]
    flagged = r["get_flagged_items"][0]
    if not flagged["items"]:
        return "No conclusions need a ruling."
    if "open_evidence" not in r:
        return [call("open_evidence", evidence_ids=sorted({e for x in flagged["items"] for e in x["evidence_ids"] if not e.startswith("SCH-")}))]
    if "rule_on_item" in r:
        return "Every flagged conclusion has a ruling."
    records = r["open_evidence"][0]["evidence"]
    oldest_allowed = date.fromisoformat(flagged["cutoff"]) - timedelta(days=flagged["stale_after_days"])
    calls = []
    for item in flagged["items"]:
        dates = [records[e]["date"] for e in item["evidence_ids"] if e in records and records[e].get("date")]
        if dates and date.fromisoformat(max(dates)) < oldest_allowed:
            calls.append(call("rule_on_item", item_code=item["code"], decision="rejected", reason=f"The newest evidence is from {max(dates)}, too old to show the state at the cut-off."))
        else:
            calls.append(call("rule_on_item", item_code=item["code"], decision="confirmed", reason="The photo and the log entries are recent and support this reading."))
    return calls


def lead_summary(r: Results):
    if "get_final_report" not in r:
        return [call("get_final_report")]
    t = r["get_final_report"][0]["totals"]
    return (f"Before sending this claim: {t['unbilled']} lines have finished work worth Rp {t['unbilled_value']:,} not billed yet, {t['weak_evidence']} lines claim "
            f"Rp {t['weak_evidence_value']:,} more than the evidence supports, {t['billing_error']} lines have billing errors, and {t['needs_inspection']} lines need a check on site.")


BRAINS: dict[str, Brain] = {"lead_plan": lead_plan, "field": field, "schedule": schedule, "documents": documents, "cost": cost, "verifier": verifier, "lead_summary": lead_summary}


class MockLlm(Scripted):
    def __init__(self, model: str = "mock", brain: Brain = lambda r: "", delay: float = 0.0, tokens: int = 0):  # tokens, reported per call, let a test run into the spending limit
        super().__init__(model, delay, tokens)
        self.brain = brain

    def answer(self, results: Results, tools: set[str]) -> list[tuple[str, dict]] | str:
        return self.brain(results)

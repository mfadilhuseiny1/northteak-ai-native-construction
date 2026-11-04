"""An offline model for the swarm: scripted per agent, it plays the tool calls a real model would, at no cost. It proves the wiring and the checks, not accuracy."""

from __future__ import annotations

import json

from . import site_case as C
from .llm import Scripted
from .firm import ANALYSTS

HANDOFF = 'HANDOFF {"done": ["read my sources"], "left_undone": [], "issues_found": []}'
# what each scripted analyst flags: tag, subject, strength, evidence, note
FLAGS = {
    "site_l3": [("HOLD_POINT_OPEN", "A20", "kuat", ["MSG-S01"], "NCR-014 still open; the engineer can only come on Tuesday at 16:00.")],
    "site_crew": [("CREW_SHORT", "A30", "kuat", ["DOC-ROSTER", "MSG-S02"], "18 of 30 on Tuesday; the pour needs at least 26.")],
    "sub_besi": [("SUBCONTRACTOR_REWORK", "A20", "kuat", ["DOC-ITP-07", "MSG-W04"], "Grid C rework runs until Tuesday afternoon, at the subcontractor's cost.")],
    "sub_rangka": [("SUBCONTRACTOR_CAPACITY", "A50", "sedang", ["MSG-W05", "DOC-SUB-RANGKA"], "A night shift can save one day on A50 if instructed in time; no more than one day."), ("RFI_OPEN", "A50", "kuat", ["RFI-035"], "The grid E clash is unanswered, and it holds up Level 4 columns.")],
    "contract_rfi": [("RFI_OPEN", "A50", "kuat", ["RFI-035"], "RFI-035 is due on 9 October and A50 starts soon after: chase the engineer."), ("RFI_OPEN", "A30", "lemah", ["RFI-034"], "RFI-034 on the backup mix is still open.")],
    "proc_concrete": [("SUPPLY_DELAY", "A30", "kuat", ["MSG-W01", "MSG-W02"], "Plant down; Wednesday 07:00 is the first guaranteed delivery.")],
    "proc_backup": [("COST_EXPOSURE", "A30", "sedang", ["MSG-W03", "DOC-RATES"], "The backup supplier carries a premium.")],
    "plan_critical": [("SCHEDULE_CRITICAL", "A30", "kuat", ["DOC-GC-27"], "A30 has no float against M1.")],
    "cost_exposure": [("COST_EXPOSURE", "A90", "kuat", ["DOC-GC-27"], "Late M1 costs liquidated damages per day.")],
    "cost_recovery": [("OTHER", "A30", "lemah", ["DOC-PO-118"], "Standby is recoverable from the supplier under PO clause 9.")],
    "qa_holdpoint": [("HOLD_POINT_OPEN", "A20", "kuat", ["DOC-ITP-07"], "HP-07 not signed."), ("MIX_NOT_APPROVED", "A30", "kuat", ["DOC-QA-11"], "The backup supplier has no approved mix."), ("DESIGN_CONSTRAINT", "A30", "kuat", ["DOC-ENG-03"], "Bays 3 and 4 must be one pour.")],
    "qa_weather": [("WEATHER_RISK", "A30", "kuat", ["DOC-WX-02", "DOC-SPEC-04"], "Rain from 15:00 on Tuesday; placing takes about 6 hours.")],
    "contract_notice": [("NOTICE_DUE", "A30", "kuat", ["DOC-GC-21"], "Written notice is due within 48 hours.")],
    "contract_claims": [("OTHER", "A30", "lemah", ["DOC-GC-21", "DOC-PO-118"], "Supplier default gives no extension; recover from the supplier.")],
}
RULINGS = {"O1": ("rejected", "The hold point cannot be signed before 16:00 and rain starts at 15:00.", ["DOC-ITP-07", "DOC-WX-02", "DOC-SPEC-04"]),
           "O2": ("rejected", "The backup mix is not approved, the hold point is open and the crew is short.", ["DOC-QA-11", "DOC-ITP-07"]),
           "O3": ("recommended", "Hold point signed on Tuesday, full crew and a guaranteed delivery on Wednesday, dry weather, and the night shift wins the day back.", ["DOC-WX-02", "DOC-ROSTER"]),
           "O4": ("risky", "Possible, but it misses the milestone and showers are forecast on Thursday.", ["DOC-WX-02", "DOC-GC-27"]),
           "O5": ("rejected", "A joint between bays 3 and 4 is not permitted, and the mix is not approved.", ["DOC-ENG-03", "DOC-QA-11"])}
TARGETS = {a[0]: a[4] for a in ANALYSTS}
PROPOSALS = {
    "quality": [("Close NCR-014 and get hold point HP-07 signed", "PT Besi Karya (fictional)", "2026-10-06", "Concrete cannot be placed until the engineer signs.", "A20")],
    "subcontract": [("Instruct the formwork night shift for 11-14 October", "CV Rangka Beton (fictional)", "2026-10-07", "It wins back the day the pour loses, and needs 48 hours' written instruction.", "A50")],
    "procurement": [("Confirm the Wednesday 07:00 delivery in writing", "Procurement manager", "2026-10-05", "The supplier guaranteed it over WhatsApp only.", "A30"), ("Move the pump booking to Wednesday", "Procurement manager", "2026-10-05", "The pump hire company needs to know by Monday 17:00.", "A30")],
    "contract": [("Send the clause 21 delay notice to the owner", "Contract manager", "2026-10-07", "Notice is due within 48 hours.", "A30"), ("Chase the engineer for an answer to RFI-035", "Project engineer", "2026-10-08", "CV Rangka Beton cannot start grid E without it.", "A50")],
    "cost": [("Back-charge standby to the supplier under PO clause 9", "Commercial manager", "2026-10-16", "The supplier pays documented standby costs.", "A30")],
}


def script(key: str, r: dict, tools: set[str] = frozenset()) -> list[tuple[str, dict]] | str:
    if key in TARGETS:
        if not r:
            t, calls = TARGETS[key], []
            calls += [("read_documents", {"kind": k}) for k in t.get("kinds") or []]
            calls += [("read_messages", {"channel": c, "query": ""}) for c in t.get("channels") or []]
            if t.get("level"):
                calls += [("read_daily_logs", {}), ("list_site_photos", {})]
            if t.get("sub"):
                calls.append(("subcontractor_record", {}))
            if t.get("schedule"):
                calls.append(("critical_path", {"pour_delay_days": 0}))
            return calls
        if "flag_signal" not in r and "draft_message" not in r and key in FLAGS:
            calls = [("flag_signal", {"tag": t, "subject": s, "strength": g, "evidence_ids": e, "note": n}) for t, s, g, e, n in FLAGS[key]]
            if key == "contract_notice":
                calls.append(("draft_message", {"channel": "gmail", "to": "Owner's representative", "text": "Under clause 21 we give notice of a concrete supplier failure affecting the Level 3 pour. We are recovering the time to keep Milestone M1."}))
            if key == "contract_rfi":
                calls.append(("draft_rfi", {"subject": "Starting Level 4 columns after the moved pour", "question": "If bays 3-4 are poured on 7 October, may Level 4 column work start on 11 October after three days of curing, or must it wait for the 7-day cube result?", "to": "Engineer", "activity": "A50", "why": "A50 has no float, and the recovery depends on this date."}))
            return calls
        return f"Established what my sources show.\n{HANDOFF}"
    if key == "partner":
        if "read_rulings" in tools and "read_rulings" not in r:
            return [("read_rulings", {})]
        if "read_rulings" in r:
            return "## What happened\nThe plant broke down, the hold point is open and the crew is short on Tuesday.\n\n## What I recommend, and why\nOption O3: pour on Wednesday at 07:00 and win the day back with a formwork night shift.\n\n## Actions by who and when\nPT Besi Karya closes NCR-014 by Tuesday 16:00. CV Rangka Beton gets its night shift instruction by Wednesday. The supplier confirms Wednesday 07:00 today."
        if "read_disruption" not in r:
            return [("read_disruption", {})]
        return json.dumps({"ringkasan": "The plant broke down and tomorrow's pour is in doubt. Settle which recovery keeps Milestone M1.", "hipotesis": [{"id": "H1", "teks": "Other things may stop a Tuesday pour."}],
                           "fokus": {"quality": "What must be signed before concrete?", "subcontract": "Who can win time back?"}, "kontrak": ["Every rejected option cites a document.", "The plan keeps M1 or states what missing it costs.", "Nothing is sent without approval."]})
    if key.startswith("option_"):
        oid = key.split("_")[1]
        if "evaluate_option" not in r:
            return [("evaluate_option", {}), ("read_signals", {}), *[("read_documents", {"kind": k}) for k in ("inspection", "spec", "weather", "contract", "manpower")]]
        if "rule_option" not in r:
            v, why, ev = RULINGS[oid]
            return [("rule_option", {"verdict": v, "reason": why, "evidence_ids": ev})]
        return f"Ruled on {oid}.\n{HANDOFF}"
    if key.startswith("qa_"):
        if "read_documents" not in r:
            return [("read_documents", {"kind": "inspection"})]
        return json.dumps({"checks": [{"klaim": "The hold point is open", "ok": True, "bukti": "DOC-ITP-07"}]})
    if key.startswith("red_"):
        if "read_documents" not in r:
            return [("read_documents", {"kind": "weather"}), ("read_documents", {"kind": "inspection"})]
        if "red_team_verdict" not in r:
            return [("red_team_verdict", {"result": "holds" if key.endswith("O3") else "weakened", "reason": "Could not break it." if key.endswith("O3") else "It misses the milestone."})]
        return "Finished."
    if key == "validator":
        if "read_documents" not in r:
            return [("read_documents", {"kind": "contract"})]
        return json.dumps({"checks": [{"klaim": "M1 is kept", "ok": True, "bukti": "DOC-GC-27"}], "kontrak": [{"id": "k1", "ok": True, "bukti": "checked"}, {"id": "k2", "ok": True, "bukti": "checked"}, {"id": "k3", "ok": True, "bukti": "checked"}]})
    # a domain lead
    if "read_team_reports" not in r:
        return [("read_team_reports", {}), ("read_signals", {})]
    if "propose_work_item" not in r and key in PROPOSALS:
        return [("propose_work_item", {"title": t, "owner": o, "due": d, "why": w, "activity": a}) for t, o, d, w, a in PROPOSALS[key]]
    return f"My line's work is merged; the signals stand as flagged.\n{HANDOFF}"


class MockFirmLlm(Scripted):
    def __init__(self, model: str = "mock", agent_key: str = "", delay: float = 0.0):
        super().__init__(model, delay)
        self.agent_key = agent_key

    def answer(self, results: dict, tools: set[str]) -> list[tuple[str, dict]] | str:
        return script(self.agent_key, results, tools)

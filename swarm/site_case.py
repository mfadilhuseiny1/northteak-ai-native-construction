"""The case: tomorrow's slab pour at a fictional site goes wrong, and the facts that decide the recovery are spread across people.

Everything is invented (PROVENANCE.md). No single source settles it: the supplier's message hides nothing but looks recoverable, the
inspection record, the weather, the crew roster, the mix approval, the engineer's note and a subcontractor's capacity each rule out or
allow an option. Code works out each option's schedule and cost (evaluate), and knows which constraints apply only for scoring afterwards:
agents have to find them in the documents.
"""

from __future__ import annotations

from datetime import date, timedelta

TODAY = "2026-10-05"
POUR = "A30"
MILESTONE = {"id": "M1", "name": "Level 4 slab poured", "activity": "A90", "contract_date": "2026-10-25"}
LD_PER_DAY = 25_000_000

SUBCONTRACTORS = {
    "besi": {"name": "PT Besi Karya (fictional)", "trade": "Reinforcement", "scope": "All slab and column rebar", "crew": 16, "activities": ["A20", "A80"]},
    "rangka": {"name": "CV Rangka Beton (fictional)", "trade": "Formwork and frame", "scope": "Columns, beams and slab formwork", "crew": 22, "activities": ["A50", "A60", "A70"]},
    "bata": {"name": "CV Bata Mandiri (fictional)", "trade": "Masonry and plaster", "scope": "Walls and plaster, Levels 1 to 3", "crew": 14, "activities": ["B10", "B30"]},
    "arus": {"name": "PT Arus Prima (fictional)", "trade": "MEP", "scope": "Electrical and plumbing first fix", "crew": 9, "activities": ["B20"]},
    "selubung": {"name": "PT Selubung Bangun (fictional)", "trade": "Windows, doors and facade", "scope": "Windows, doors, facade panels and railings", "crew": 12, "activities": ["C10"]},
}

# (id, name, duration in days, predecessors, who does it)
ACTIVITIES = [
    ("A20", "Hold-point inspection, Level 3 slab rebar bays 3-4", 1, [], "besi"),
    ("A30", "Pour Level 3 slab bays 3-4", 1, ["A20"], "self"),
    ("A40", "Cure Level 3 slab", 3, ["A30"], "self"),
    ("A50", "Level 4 column rebar and formwork", 5, ["A40"], "rangka"),
    ("A60", "Cast Level 4 columns", 2, ["A50"], "rangka"),
    ("A70", "Level 4 beam and slab formwork", 5, ["A60"], "rangka"),
    ("A80", "Level 4 slab rebar", 3, ["A70"], "besi"),
    ("A90", "Pour Level 4 slab", 1, ["A80"], "self"),
    ("B10", "Level 2 remaining masonry", 6, [], "bata"),
    ("B20", "Level 2 MEP first fix", 5, ["B10"], "arus"),
    ("B30", "Level 2 plaster", 6, ["B20"], "bata"),
    ("C10", "Level 2 windows", 8, [], "selubung"),
]

RATES = {"concrete_crew_standby_per_day": 9_500_000, "pump_standby_per_day": 6_000_000, "backup_concrete_premium": 36_000_000, "formwork_night_shift_one_day_saved": 18_000_000,
         "liquidated_damages_per_day": LD_PER_DAY}

# what each recovery option does to the schedule and to cost; whether it is allowed is for the documents to say
OPTIONS = {
    "O1": {"name": "Wait for the usual supplier and pour on Tuesday at 14:00", "pour_delay_days": 0, "compress": {}, "extra": {"concrete_crew_standby_per_day": 0.5, "pump_standby_per_day": 0.5}},
    "O2": {"name": "Switch to the backup supplier and pour on Tuesday at 08:00", "pour_delay_days": 0, "compress": {}, "extra": {"backup_concrete_premium": 1}},
    "O3": {"name": "Pour on Wednesday at 07:00 with the usual supplier, and win the day back with a formwork night shift", "pour_delay_days": 1, "compress": {"A50": 1},
           "extra": {"concrete_crew_standby_per_day": 1, "pump_standby_per_day": 1, "formwork_night_shift_one_day_saved": 1}},
    "O4": {"name": "Hold the pour until Thursday and accept the delay", "pour_delay_days": 2, "compress": {}, "extra": {"concrete_crew_standby_per_day": 2, "pump_standby_per_day": 2}},
    "O5": {"name": "Pour only bay 3 on Tuesday at 08:00 with the backup supplier, and bay 4 later", "pour_delay_days": 0, "compress": {}, "extra": {"backup_concrete_premium": 0.5, "concrete_crew_standby_per_day": 1}},
}

# scoring only: never given to an agent
TRUTH = {
    "best": "O3",
    "blocks": {"O1": ["DOC-ITP-07", "DOC-WX-02", "DOC-SPEC-04"], "O2": ["DOC-QA-11", "DOC-ITP-07", "MSG-S02"], "O5": ["DOC-ENG-03", "DOC-QA-11"]},
    "must_find": ["DOC-ITP-07", "DOC-QA-11", "DOC-WX-02", "DOC-ENG-03", "MSG-S02", "MSG-W05", "DOC-GC-21", "RFI-035"],
}

DOCUMENTS = [
    {"id": "DOC-ITP-07", "kind": "inspection", "title": "Inspection and test plan, hold point HP-07", "text": "NCR-014 is open on Level 3 slab rebar bays 3-4: top mat spacing out by 40 mm over 6 m at grid C. Concrete may not be placed until the engineer signs HP-07. PT Besi Karya will rectify on Monday and Tuesday. Re-inspection is booked for Tuesday 6 October at 16:00, the earliest slot the engineer has."},
    {"id": "DOC-QA-11", "kind": "inspection", "title": "Approved concrete mix register", "text": "Approved for slabs: K-350 from the usual supplier, trial mix approved 12 August. Backup supplier: no approved slab mix on file. A new mix needs a trial and cube results, and approval takes at least 3 days after submission. Nothing has been submitted."},
    {"id": "DOC-SPEC-04", "kind": "spec", "title": "Specification 03300, placing concrete", "text": "Do not place concrete during rain or when rain is forecast within the placing period. A placing period for bays 3-4 is about 6 hours. Protect fresh concrete from rain for the first 8 hours."},
    {"id": "DOC-ENG-03", "kind": "spec", "title": "Engineer's structural note SN-03", "text": "Bays 3 and 4 are designed as one continuous pour. A construction joint between them is not permitted without a redesign and the engineer's written approval."},
    {"id": "DOC-WX-02", "kind": "weather", "title": "Site weather forecast, issued Monday 05:30", "text": "Tuesday 6 October: dry until about 15:00, then heavy rain until night. Wednesday 7 October: dry all day. Thursday 8 October: showers after 13:00."},
    {"id": "DOC-GC-21", "kind": "contract", "title": "General conditions, clause 21: delay notices", "text": "The contractor must give the owner written notice within 48 hours of any event likely to delay a milestone, or loses the right to an extension of time for that event. Supplier default is at the contractor's own risk: it is not a ground for an extension."},
    {"id": "DOC-GC-27", "kind": "contract", "title": "General conditions, clause 27: milestones", "text": "Milestone M1, Level 4 slab poured, is due on 25 October 2026. Liquidated damages for late completion of M1 are Rp 25,000,000 per day."},
    {"id": "DOC-PO-118", "kind": "purchase_order", "title": "Purchase order PO-118, concrete", "text": "Usual supplier: 120 m3 K-350 for Tuesday 6 October, first truck 07:00. Clause 9: if the supplier misses a confirmed delivery, it pays the contractor's documented standby costs."},
    {"id": "DOC-RATES", "kind": "cost", "title": "Agreed rates for this project", "text": "Concrete crew standby Rp 9,500,000 per day. Pump standby Rp 6,000,000 per day. Backup supplier premium for 120 m3 Rp 36,000,000. Formwork night shift that saves one day on A50 Rp 18,000,000."},
    {"id": "DOC-SUB-RANGKA", "kind": "subcontract", "title": "Subcontract, CV Rangka Beton, clause 6", "text": "Night shifts need 48 hours' written instruction from the main contractor. The agreed night shift rate applies, and no other compression is priced."},
    {"id": "DOC-SUB-BESI", "kind": "subcontract", "title": "Subcontract, PT Besi Karya, clause 8", "text": "Rectifying rejected work is at the subcontractor's cost, including re-inspection, and the subcontractor must keep to the main contractor's programme."},
    {"id": "DOC-ROSTER", "kind": "manpower", "title": "Concrete crew roster", "text": "Concrete crew is 30. Monday 30, Tuesday 18 (12 off for a family event, arranged in September), Wednesday 30, Thursday 30. A slab pour of this size needs at least 26."},
]

MESSAGES = [
    {"id": "MSG-W01", "channel": "whatsapp", "from": "Supplier dispatcher", "at": "2026-10-05 06:12", "text": "Pak, batching plant broke down last night. Mixer gearbox. Tomorrow's first truck can't be 07:00, maybe around 14:00 if the part comes."},
    {"id": "MSG-W02", "channel": "whatsapp", "from": "Supplier dispatcher", "at": "2026-10-05 06:40", "text": "Update: part arrives tomorrow morning. Wednesday 07:00 we can guarantee, full 120 m3."},
    {"id": "MSG-W03", "channel": "whatsapp", "from": "Backup supplier sales", "at": "2026-10-05 07:05", "text": "We can bring 120 m3 tomorrow 08:00. Premium applies. Send the mix details."},
    {"id": "MSG-W04", "channel": "whatsapp", "from": "Rebar foreman, PT Besi Karya", "at": "2026-10-05 07:20", "text": "Grid C rework needs Monday and Tuesday. Done by Tuesday afternoon for the inspection."},
    {"id": "MSG-W05", "channel": "whatsapp", "from": "Formwork supervisor, CV Rangka Beton", "at": "2026-10-05 07:32", "text": "We can run a night shift on the Level 4 columns on 10-14 Oct and save one day, if you instruct us by Wednesday. We can't do more than one day."},
    {"id": "MSG-S01", "channel": "slack", "from": "Site engineer", "at": "2026-10-05 06:55", "text": "NCR-014 on L3 bays 3-4 still open. Engineer can only come Tue 16:00. Please don't plan concrete before he signs."},
    {"id": "MSG-S02", "channel": "slack", "from": "Concrete foreman", "at": "2026-10-05 07:10", "text": "Reminder: 12 of my guys are off Tuesday. We are only 18. Back at 30 on Wednesday."},
    {"id": "MSG-S03", "channel": "slack", "from": "Masonry supervisor, CV Bata Mandiri", "at": "2026-10-05 07:15", "text": "L2 walls on programme. Nothing from us affects the L3 pour."},
    {"id": "MSG-G01", "channel": "gmail", "from": "Owner's representative", "at": "2026-10-05 08:01", "text": "We have heard about concrete problems on site. Please confirm M1 is still on 25 October, and send anything we need to know about under the contract."},
    {"id": "MSG-G02", "channel": "gmail", "from": "Pump hire company", "at": "2026-10-05 08:15", "text": "Pump booked for Tuesday. If it moves, tell us by Monday 17:00 or standby is charged at the agreed rate."},
]

# the RFI log: who asked what, who owes the answer, what it holds up
RFIS = [
    {"id": "RFI-027", "subject": "Top mat spacing tolerance at grid C", "question": "What tolerance applies to top mat spacing at grid C on Level 3?", "raised_by": "PT Besi Karya (fictional)", "raised_on": "2026-09-28", "to": "Engineer", "ball_in_court": "", "due": "2026-10-02",
     "status": "answered", "answer": "Plus or minus 20 mm. Anything beyond that is rework, and NCR-014 stands.", "answered_on": "2026-10-01", "activity": "A20", "impact": "Confirms the rework behind the hold point."},
    {"id": "RFI-029", "subject": "Socket height, Level 2 corridors", "question": "Are corridor sockets at 300 mm or 450 mm?", "raised_by": "PT Arus Prima (fictional)", "raised_on": "2026-09-29", "to": "Architect", "ball_in_court": "", "due": "2026-10-06",
     "status": "answered", "answer": "450 mm throughout.", "answered_on": "2026-10-02", "activity": "B20", "impact": "None on the pour."},
    {"id": "RFI-031", "subject": "Pouring bays 3 and 4 separately", "question": "May Level 3 slab bays 3 and 4 be poured separately, with a joint between them?", "raised_by": "Main contractor", "raised_on": "2026-10-01", "to": "Engineer", "ball_in_court": "", "due": "2026-10-05",
     "status": "answered", "answer": "No. See structural note SN-03. It would need a redesign.", "answered_on": "2026-10-02", "activity": "A30", "impact": "Rules out any part pour."},
    {"id": "RFI-034", "subject": "Backup supplier mix", "question": "Can a K-350 mix from another supplier be accepted without a trial mix?", "raised_by": "Main contractor", "raised_on": "2026-10-03", "to": "Engineer", "ball_in_court": "Engineer", "due": "2026-10-09",
     "status": "open", "answer": "", "answered_on": "", "activity": "A30", "impact": "Until answered, the mix register stands: no backup mix."},
    {"id": "RFI-035", "subject": "Column starter bars clash with MEP sleeve at grid E", "question": "Level 4 column starter bars at grid E clash with the MEP sleeve on drawing M-204. Which moves?", "raised_by": "CV Rangka Beton (fictional)", "raised_on": "2026-10-02", "to": "Engineer", "ball_in_court": "Engineer", "due": "2026-10-09",
     "status": "open", "answer": "", "answered_on": "", "activity": "A50", "impact": "CV Rangka Beton cannot start Level 4 columns at grid E until this is answered."},
]

PHOTOS_BY_LEVEL = {"Level 3": ["P-ST-05-A", "P-ST-06-A", "P-ST-03-B"], "Level 2": ["P-AR-02-A", "P-ME-02-A"], "Level 1": ["P-AR-01-A"]}


def _day(n: int) -> str:
    return (date.fromisoformat(TODAY) + timedelta(days=n)).isoformat()


def schedule(pour_delay_days: int = 0, compress: dict | None = None, activities: list | None = None, links: dict | None = None, start: str | None = None, not_before: dict | None = None, leads: dict | None = None, overlaps: dict | None = None) -> dict:
    """Plain critical path: earliest start and finish per activity, float against the milestone or the last finish, calendar days.

    With nothing else given it is the scenario's own programme. A person's added activities and changed links come in through activities and links. not_before holds an activity to the day a master schedule starts it, and leads lets it overlap what it waits for by the days that schedule overlaps them."""
    compress, links, not_before, leads, overlaps = compress or {}, links or {}, not_before or {}, leads or {}, overlaps or {}
    items = {a[0]: (a[0], a[1], a[2], list(links.get(a[0], a[3])), a[4]) for a in (ACTIVITIES if activities is None else activities)}
    order: list[str] = []
    while len(order) < len(items):  # in the order the links allow, whatever order they were added in
        ready = next((k for k, i in items.items() if k not in order and all(p in order or p not in items for p in i[3])), None)
        if ready is None:
            raise ValueError(f"the activity links form a cycle: {', '.join(k for k in items if k not in order)}")
        order.append(ready)
    first = date.fromisoformat(start or TODAY)
    day = lambda n: (first + timedelta(days=n)).isoformat()  # noqa: E731
    finish, begun, rows = {}, {}, {}
    for aid in order:
        _, name, dur, preds, who = items[aid]
        d = max(1, dur - compress.get(aid, 0))
        beside = {p: ends_after for p, ends_after in overlaps.get(aid, {}).items() if p in preds and p in finish}  # work running alongside cannot start before the other starts, nor end before it ends, unless the schedule itself has it end first
        begin = max([finish[p] + 1 + leads.get(aid, {}).get(p, 0) for p in preds if p in finish and p not in beside] + [begun[p] for p in beside] + [finish[p] - d + 1 for p, ends_after in beside.items() if ends_after] + [not_before.get(aid, 0)])
        if aid == POUR:
            begin += pour_delay_days
        begun[aid] = begin
        finish[aid] = begin + d - 1
        rows[aid] = {"id": aid, "name": name, "duration": d, "start": day(begin), "finish": day(finish[aid]), "predecessors": preds, "by": who}
    end = max(finish.values(), default=0)
    succ = {k: [j for j, i in items.items() if k in i[3]] for k in items}
    late: dict[str, int] = {}
    for aid in reversed(order):
        bounds = [end]  # an overlap allowed for must not carry it past the end of the job
        for x in succ[aid]:
            if x in late:
                beside = overlaps.get(x, {}).get(aid)
                bounds += [late[x] - rows[x]["duration"] - leads.get(x, {}).get(aid, 0)] if beside is None else [late[x] - rows[x]["duration"] + rows[aid]["duration"], *([late[x]] if beside else [])]
        late[aid] = min(bounds)
        rows[aid]["float_days"] = late[aid] - finish[aid]
        rows[aid]["critical"] = rows[aid]["float_days"] == 0
    out = {"activities": [rows[k] for k in items], "milestone": None}
    if MILESTONE["activity"] in rows:
        contract = date.fromisoformat(MILESTONE["contract_date"])
        actual = date.fromisoformat(rows[MILESTONE["activity"]]["finish"])
        out["milestone"] = {**MILESTONE, "forecast": actual.isoformat(), "days_late": max(0, (actual - contract).days)}
    return out


def evaluate(option_id: str) -> dict:
    """What an option does to the milestone and to cost. It says nothing about whether the option is allowed."""
    o = OPTIONS[option_id]
    plan = schedule(o["pour_delay_days"], o["compress"])
    late = plan["milestone"]["days_late"]
    direct = round(sum(RATES[k] * n for k, n in o["extra"].items()))
    damages = late * LD_PER_DAY
    pour = next(a for a in plan["activities"] if a["id"] == POUR)
    return {"option": option_id, "name": o["name"], "pour_on": pour["start"], "milestone_forecast": plan["milestone"]["forecast"], "days_late": late, "direct_cost_rp": direct,
            "liquidated_damages_rp": damages, "total_cost_rp": direct + damages, "cost_lines": {k: round(RATES[k] * n) for k, n in o["extra"].items()}}


def document(doc_id: str) -> dict | None:
    return next((d for d in [*DOCUMENTS, *MESSAGES, *RFIS] if d["id"] == doc_id), None)

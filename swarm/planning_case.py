"""The consultant's planning package for one work item: Level 4 columns. Everything is invented (PROVENANCE.md).

No single document is enough, and the package disagrees with itself in the ways real packages do: a superseded drawing still in the set, a BoQ priced on it, a specification stricter than the drawing, a programme that allows too few workers and names the wrong subcontractor, and an open RFI holding two columns. Agents have to find these. What is planted is only read for scoring, afterwards.
"""

from __future__ import annotations

SCOPE = {"id": "L4-COL", "title": "Level 4 columns", "activities": ["A50", "A60"], "sections": [
    {"id": "rebar", "name": "Steel rebar", "by": "besi", "activity": "A50"}, {"id": "formwork", "name": "Formwork", "by": "rangka", "activity": "A50"}, {"id": "concrete", "name": "Concrete mixture", "by": "self", "activity": "A60"}, {"id": "assembly", "name": "Erection and casting", "by": "self", "activity": ""}]}

DOCUMENTS = [
    {"id": "PLAN-SCOPE-01", "kind": "scope", "from": "Planning consultant", "date": "2026-09-20", "title": "Work brief: Level 4 columns",
     "text": "Work item: reinforced concrete columns of Level 4, type C1, 12 columns on grids A to F. Programme activities A50 (Level 4 column rebar and formwork) and A60 (Cast Level 4 columns). Before work starts the contractor must turn this package into an implementable work plan: the sequence of operations and inspections, the procedure for each, the workforce and material for each step, and the expected waste. Reinforcement is in PT Besi Karya's scope and formwork is in CV Rangka Beton's. Batching and casting are by the contractor's own concrete crew of 30."},
    {"id": "PLAN-DWG-S401-A", "kind": "drawing", "from": "Structural consultant", "date": "2026-07-20", "title": "Drawing S-401 rev A: Level 4 column schedule",
     "text": "Column type C1: 12 columns, 600 x 600 mm, height 3,600 mm floor to soffit. Main bars 12 D19, lapped 40d above the Level 3 starter bars. Stirrups D10 at 150 mm. Cover 40 mm. Stirrup hooks 75 mm at each end."},
    {"id": "PLAN-DWG-S401-B", "kind": "drawing", "from": "Structural consultant", "date": "2026-09-14", "title": "Drawing S-401 rev B: Level 4 column schedule",
     "text": "Revision B: main bars changed after the engineer's load review. This revision supersedes revision A. Column type C1: 12 columns, 600 x 600 mm, height 3,600 mm floor to soffit. Main bars 12 D22, lapped 40d above the Level 3 starter bars. Stirrups D10 at 150 mm. Cover 40 mm. Stirrup hooks 75 mm at each end. Columns E2 and E4 on grid E: see RFI-035, the MEP sleeve on drawing M-204 clashes with their starter bars."},
    {"id": "PLAN-RKS-03", "kind": "spec", "from": "Structural consultant", "date": "2026-06-30", "title": "RKS section 03: concrete works",
     "text": "3.1 Column concrete is K-300 (f'c 26.4 MPa), slump 12 +/- 2 cm, batched on site by weight in a mixer of at least 350 litres. Ready-mix is kept for slabs. 3.2 Slump is tested on every batch at the mixer; a batch outside 10 to 14 cm is rejected. 3.3 One set of 3 test cubes per 5 m3 or per day of casting, whichever comes first, tested at 7 and 28 days. 3.4 Free drop of concrete is limited to 1.5 m, so columns are placed through a tremie. 3.5 Concrete is compacted with a poker vibrator of at least 50 mm diameter, in layers of no more than 500 mm. 3.6 Reinforcement: bars are bent cold and stored off the ground; cover tolerance +/- 5 mm. Within 600 mm of each end of a column (the confinement zone) stirrups are at 100 mm centres. 3.7 Formwork: 9 mm plywood on timber frames, oiled before erection, plumb to +/- 5 mm. Forms are struck no sooner than 24 hours after casting. Plywood may be reused up to 3 times. 3.8 Wet curing for 7 days from striking."},
    {"id": "PLAN-ITP-12", "kind": "itp", "from": "Planning consultant", "date": "2026-09-20", "title": "Inspection and test plan: Level 4 columns",
     "text": "HP-21 hold point: reinforcement cage, spacing, laps and cover, before the forms are closed. The engineer signs, on 24 hours' notice. W-22 witness point: formwork plumbness, dimensions and cover before casting. QC engineer. T-23 test: slump on every batch at the mixer. Site lab technician. T-24 test: cube strength at 7 and 28 days, 26.4 MPa required at 28 days. Site lab technician."},
    {"id": "PLAN-BOQ-L4", "kind": "boq", "from": "Quantity surveyor", "date": "2026-08-01", "title": "BoQ extract: Level 4 columns, priced on S-401 rev A",
     "text": "L4-01 Concrete K-300 in columns: 15.6 m3 at Rp 1,420,000. L4-02 Column formwork: 103.7 m2 at Rp 465,000. L4-03 Reinforcement: 1,825 kg at Rp 19,500."},
    {"id": "PLAN-SCH-07", "kind": "programme", "from": "Planning consultant", "date": "2026-09-20", "title": "Programme: Level 4 columns",
     "text": "A50 Level 4 column rebar and formwork: 5 working days, by CV Rangka Beton. A60 Cast Level 4 columns: 2 working days, by CV Rangka Beton. A70 Level 4 beam and slab formwork follows straight after A60. The programme allows 14 workers a day on the columns. Working day 08:00 to 16:00 with a one hour break, 7 working hours."},
    {"id": "PLAN-MS-02", "kind": "method", "from": "Site team", "date": "2026-09-25", "title": "Site logistics note",
     "text": "Rebar and formwork yard at ground level, 120 m from the material hoist, with the bar cutter and bender in the yard. Hoist capacity 1 tonne a lift. Tower crane available to the columns 3 hours a day. Site mixer of 350 litres on the ground floor beside the hoist; concrete goes up to Level 4 by crane skip of 0.5 m3. Plywood sheets are 1.22 x 2.44 m."},
    {"id": "PLAN-RATE-01", "kind": "rates", "from": "Commercial team", "date": "2026-09-01", "title": "Agreed rates",
     "text": "Labour per OH: Pekerja Rp 130,000, Tukang Rp 160,000, Kepala tukang Rp 175,000, Mandor Rp 185,000. Rebar Rp 14,000 per kg. Tie wire Rp 25,000 per kg. Cement Rp 1,500 per kg. Sand Rp 220 per kg. Gravel Rp 230 per kg. Water Rp 30 per litre. Plywood 9 mm Rp 175,000 per sheet. Timber class III Rp 2,400,000 per m3. Timber class II Rp 3,800,000 per m3. Nails Rp 22,000 per kg. Form oil Rp 30,000 per litre. Props Rp 30,000 each."},
]

BOQ = [{"id": "L4-01", "item": "Concrete K-300 in columns", "unit": "m3", "qty": 15.6, "rate": 1_420_000}, {"id": "L4-02", "item": "Column formwork", "unit": "m2", "qty": 103.7, "rate": 465_000},
       {"id": "L4-03", "item": "Reinforcement", "unit": "kg", "qty": 1825, "rate": 19_500}]
RATES = {"labour": {"Pekerja": 130_000, "Tukang": 160_000, "Kepala tukang": 175_000, "Mandor": 185_000},
         "materials": {"rebar": 14_000, "tie_wire": 25_000, "cement": 1_500, "sand": 220, "gravel": 230, "water": 30, "plywood": 175_000, "timber_iii": 2_400_000, "timber_ii": 3_800_000, "nails": 22_000, "form_oil": 30_000, "props": 30_000}}
ITP_IDS = ["HP-21", "W-22", "T-23", "T-24"]
PROGRAMME_CREW = 14
OWN_CREW = 30
BRIEF = ("Turn the consultant's planning package for Level 4 columns (activities A50 and A60) into an implementable Work Breakdown Structure and procedure: every operation and inspection as a task, with what it waits for and the workforce, material and waste of each. "
         "Say what in the package does not agree, and what must be settled before work starts.")

# scoring only: never given to an agent
TRUTH = {"rebar_kg": (2300, 2450), "must_flag": {"BOQ_MISMATCH": "PLAN-BOQ-L4", "SUPERSEDED_DRAWING": "PLAN-DWG-S401-B", "DOCUMENT_CONFLICT": "PLAN-RKS-03", "CREW_SHORT": "PLAN-SCH-07", "SCOPE_GAP": "PLAN-SCOPE-01", "RFI_OPEN": "RFI-035"}}


def documents(kinds: list[str] | None = None) -> list[dict]:
    return [d for d in DOCUMENTS if not kinds or d["kind"] in kinds]

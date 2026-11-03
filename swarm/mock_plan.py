"""An offline model for the planning swarm: scripted per agent, it plays the tool calls a real model would, at no cost. It proves the wiring and the arithmetic, not how well a model plans."""

from __future__ import annotations

import json

from .llm import Scripted
from .mock_firm import HANDOFF

SECTIONS = {
    "rebar": [("rb_cut", "Cut rebar to length", "Cut D22 main bars and D10 stirrup bars to the cutting list in the yard with the bar cutter. Keep off-cuts sorted by size for stirrups. Wear gloves and eye protection.", [], "SNI-6.17", "Q-REBAR", 20, ["rebar"], False, ["PLAN-RKS-03", "PLAN-DWG-S401-B"]),
              ("rb_bend", "Bend stirrups", "Bend D10 stirrups cold to 520 x 520 mm with 75 mm hooks. Do not heat the bars.", ["rb_cut"], "SNI-6.17", "Q-REBAR", 15, [], False, ["PLAN-RKS-03", "PLAN-DWG-S401-B"]),
              ("rb_tie", "Tie column cages", "Tie 12 D22 main bars to stirrups on trestles, at 100 mm centres within 600 mm of each end and 150 mm elsewhere. Store cages off the ground.", ["rb_bend"], "SNI-6.17", "Q-REBAR", 35, ["tie_wire"], False, ["PLAN-RKS-03", "PLAN-DWG-S401-B"])],
    "formwork": [("fw_cut", "Cut plywood panels", "Mark out the 9 mm sheets to a cutting plan for the 600 mm faces, and cut with a circular saw. Keep off-cuts for infill.", [], "SNI-6.22", "Q-FORM", 20, ["plywood", "timber_ii"], False, ["PLAN-RKS-03", "PLAN-MS-02"]),
                 ("fw_assemble", "Assemble and oil panels", "Nail plywood to timber frames, square the panels, and oil the faces before they go up.", ["fw_cut"], "SNI-6.22", "Q-FORM", 35, ["timber_iii", "nails", "form_oil"], False, ["PLAN-RKS-03"])],
    "concrete": [("cn_batch", "Batch cement, sand and gravel by weight", "Weigh each batch of K-300 at the site mixer: cement, sand and gravel to the mix design, gravel up to 30 mm.", [], "SNI-6.10", "Q-CONC", 15, ["cement", "sand", "gravel"], False, ["PLAN-RKS-03", "PLAN-MS-02"]),
                 ("cn_mix", "Mix in the 350 litre mixer", "Mix each batch for at least 2 minutes. Add water to the design only: never to recover slump.", ["cn_batch"], "SNI-6.10", "Q-CONC", 15, ["water"], True, ["PLAN-RKS-03"])],
    "assembly": [("as_erect", "Erect steel cages", "Lift each cage onto the starter bars and lap 40d, tying laps fully. Set cover spacers for 40 mm cover. Work from a scaffold with harnesses. Columns E2 and E4 wait for the answer to RFI-035.", [], "SNI-6.17", "Q-REBAR", 30, [], False, ["PLAN-DWG-S401-B", "PLAN-RKS-03"]),
                 ("as_form", "Position and brace forms", "Close the forms around the cage, brace with props and check they are plumb to +/- 5 mm with a plumb bob.", ["as_erect"], "SNI-6.22", "Q-FORM", 45, ["props"], False, ["PLAN-RKS-03"]),
                 ("as_pour", "Pour concrete through a tremie", "Place concrete by crane skip and tremie, with a free drop of no more than 1.5 m, in layers of no more than 500 mm.", ["as_form"], "SNI-6.10", "Q-CONC", 40, [], False, ["PLAN-RKS-03", "PLAN-MS-02"]),
                 ("as_vibrate", "Compact with a poker vibrator", "Compact each layer with a 50 mm poker vibrator. Do not touch the forms or bars.", ["as_pour"], "SNI-6.10", "Q-CONC", 30, [], True, ["PLAN-RKS-03"])],
}
LINKS = [("as_erect", ["rb_tie"]), ("as_form", ["as_erect", "fw_assemble"]), ("as_pour", ["as_form", "cn_mix"])]
INSPECTIONS = [("i_rebar", "Inspect rebar spacing, laps and cover", "assembly", "HP-21", "Spacing per S-401 rev B, laps 40d, cover 40 mm +/- 5 mm", "Engineer", True, ["as_erect"], ["as_form"], 2, 0, "Give the engineer 24 hours' notice. Forms stay open until this is signed.", ["PLAN-ITP-12", "PLAN-RKS-03"]),
               ("i_form", "Verify plumbness, dimensions and cover", "assembly", "W-22", "Plumb to +/- 5 mm, 600 x 600 mm, cover 40 mm", "QC engineer", False, ["as_form"], ["as_pour"], 2, 0, "Check every column with a plumb bob and tape before casting.", ["PLAN-ITP-12", "PLAN-RKS-03"]),
               ("i_slump", "Perform slump test", "concrete", "T-23", "Slump 12 +/- 2 cm: reject a batch outside 10 to 14 cm", "Site lab technician", False, ["cn_mix"], ["as_pour"], 1, 0, "Test every batch at the mixer and make the cubes: a set of 3 per 5 m3 or per day.", ["PLAN-ITP-12", "PLAN-RKS-03"]),
               ("i_cubes", "Test cube strength at 7 and 28 days", "assembly", "T-24", "26.4 MPa at 28 days", "Site lab technician", False, ["as_vibrate"], [], 1, 28, "Crush the cubes at 7 and 28 days and record the results. Strike forms after 24 hours and wet cure for 7 days.", ["PLAN-ITP-12", "PLAN-RKS-03"])]
HANDLING = [("h_bars", "Haul and hoist cages to Level 4", "rebar", ["rb_tie"], ["as_erect"], "Pekerja:10", 4, "Carry the cages 120 m to the hoist and lift within its 1 tonne limit.", ["PLAN-MS-02"]),
            ("h_forms", "Haul and hoist form panels to Level 4", "formwork", ["fw_assemble"], ["as_form"], "Pekerja:4", 5, "Carry the panels 120 m to the hoist and lift them a set at a time.", ["PLAN-MS-02"]),
            ("h_skip", "Lift concrete by crane skip", "concrete", ["i_slump"], ["as_pour"], "Pekerja:2", 2, "Lift by 0.5 m3 crane skip inside the 3 crane hours a day for columns.", ["PLAN-MS-02"])]
CREWS = [("rb_cut", 10, "besi"), ("rb_bend", 10, "besi"), ("rb_tie", 16, "besi"), ("as_erect", 16, "besi"), ("fw_cut", 20, "rangka"), ("fw_assemble", 22, "rangka"), ("as_form", 22, "rangka"), ("cn_batch", 7, "self"), ("cn_mix", 7, "self"), ("as_pour", 16, "self"), ("as_vibrate", 12, "self")]
PROPOSALS = {
    "subcontract": [("Programme PT Besi Karya on A50, and agree the crew", "Project manager", "2026-10-08", "Rebar is in Besi's scope, and the programme shows only Rangka on A50.", "A50")],
    "procurement": [("Move the bar bench to the hoist bay before A50", "Site manager", "2026-10-08", "It removes the 120 m haul of every cage.", "A50")],
    "cost": [("Raise a variation for the rebar on drawing S-401 rev B", "Commercial manager", "2026-10-12", "The BoQ was priced on rev A.", "A50")],
    "contract": [("Get the engineer's answer on stirrups in the confinement zone", "Project engineer", "2026-10-08", "The specification and the drawing differ.", "A50"), ("Chase the answer to RFI-035 for columns E2 and E4", "Project engineer", "2026-10-09", "Two columns cannot start without it.", "A50")],
}


def script(key: str, r: dict, tools: set[str] = frozenset()) -> list[tuple[str, dict]] | str:
    if key == "partner":
        if "read_package_index" in tools:
            if "read_package_index" not in r:
                return [("read_package_index", {}), ("read_package", {"kind": "scope"})]
            return json.dumps({"ringkasan": "Level 4 columns: 12 columns C1 in activities A50 and A60. The plan must say how to build them, with what, and what in the package disagrees.", "hipotesis": [{"id": "H1", "teks": "The BoQ may not match the drawing in force."}, {"id": "H2", "teks": "The programme's crew may be too thin."}],
                               "sections": [{"id": "rebar", "name": "Steel rebar", "by": "besi", "activity": "A50"}, {"id": "formwork", "name": "Formwork", "by": "rangka", "activity": "A50"}, {"id": "concrete", "name": "Concrete mixture", "by": "self", "activity": "A60"}, {"id": "assembly", "name": "Erection and casting", "by": "self", "activity": ""}],
                               "kontrak": ["Every number comes from code.", "Every inspection can still stop a mistake.", "What in the package disagrees is said plainly."]})
        if "read_plan" not in r:
            return [("read_plan", {})]
        return "## What this plan does\nIt breaks the 12 columns of Level 4 down into the tasks in the WBS, in order, with the workforce, material and waste of each task worked out from the standard.\n\n## Settle these before work starts\nThe BoQ was priced on the superseded drawing, so raise a variation. The specification and drawing differ on stirrups near the column ends, so ask the engineer. PT Besi Karya is not programmed on A50. Columns E2 and E4 wait for the answer to RFI-035.\n\n## Watch on site\nThe hold point on the cages needs 24 hours' notice to the engineer. The programme allows too few workers: the crew in the WBS is what the work needs."
    if key == "doc_drawings":
        if "read_package" not in r:
            return [("read_package", {"kind": "drawing"}), ("read_package", {"kind": "spec"}), ("read_package", {"kind": "boq"}), ("read_norms", {})]
        if "record_quantity" not in r:
            return [("record_quantity", {"quantity_id": "Q-CONC", "element": "Column concrete K-300", "unit": "m3", "sum_expression": "12*0.6*0.6*3.6", "boq_item": "L4-01", "evidence_ids": ["PLAN-DWG-S401-B"]}),
                    ("record_quantity", {"quantity_id": "Q-FORM", "element": "Column formwork", "unit": "m2", "sum_expression": "12*4*0.6*3.6", "boq_item": "L4-02", "evidence_ids": ["PLAN-DWG-S401-B"]}),
                    ("record_quantity", {"quantity_id": "Q-REBAR", "element": "Column reinforcement", "unit": "kg", "sum_expression": "12*12*(3.6+40*0.022)*2.984 + 12*(2*0.6/0.1+(3.6-2*0.6)/0.15+1)*(4*(0.6-2*0.04)+2*0.075)*0.617", "boq_item": "L4-03", "evidence_ids": ["PLAN-DWG-S401-B", "PLAN-RKS-03"]})]
        return f"Worked out concrete, formwork and reinforcement from S-401 rev B, with the specification's stirrups near the column ends.\n{HANDOFF}"
    if key == "doc_spec":
        if "read_package" not in r:
            return [("read_package", {"kind": k}) for k in ("spec", "itp", "drawing")]
        if "flag_signal" not in r:
            return [("flag_signal", {"tag": "DOCUMENT_CONFLICT", "subject": "A50", "strength": "kuat", "evidence_ids": ["PLAN-RKS-03", "PLAN-DWG-S401-B"], "note": "The specification wants stirrups at 100 mm within 600 mm of each column end. The drawing shows 150 mm throughout."})]
        return f"The specification is stricter than the drawing on stirrups.\n{HANDOFF}"
    if key == "doc_programme":
        if "read_package" not in r:
            return [("read_package", {"kind": "programme"}), ("read_package", {"kind": "scope"}), ("read_norms", {}), ("read_subcontractors", {})]
        if "flag_signal" not in r:
            return [("flag_signal", {"tag": "CREW_SHORT", "subject": "A50", "strength": "kuat", "evidence_ids": ["PLAN-SCH-07"], "note": "The programme allows 14 workers a day, far below what the norms imply for 5 days."}),
                    ("flag_signal", {"tag": "SCOPE_GAP", "subject": "A50", "strength": "kuat", "evidence_ids": ["PLAN-SCOPE-01", "PLAN-SCH-07"], "note": "Rebar is PT Besi Karya's scope, but the programme gives A50 only to CV Rangka Beton."})]
        return f"The programme's crew is too thin, and it leaves the rebar subcontractor out.\n{HANDOFF}"
    if key == "doc_revisions":
        if "read_package" not in r:
            return [("read_package", {"kind": "drawing"}), ("read_package", {"kind": "boq"}), ("read_rfi_log", {})]
        if "flag_signal" not in r:
            return [("flag_signal", {"tag": "SUPERSEDED_DRAWING", "subject": "A50", "strength": "kuat", "evidence_ids": ["PLAN-DWG-S401-B", "PLAN-DWG-S401-A"], "note": "S-401 rev A is still in the package, and rev B supersedes it with larger main bars."}),
                    ("flag_signal", {"tag": "RFI_OPEN", "subject": "A50", "strength": "kuat", "evidence_ids": ["RFI-035", "PLAN-DWG-S401-B"], "note": "RFI-035 holds columns E2 and E4 until the engineer answers."}),
                    ("draft_rfi", {"subject": "Stirrups in the confinement zone", "question": "RKS 3.6 asks for stirrups at 100 mm within 600 mm of each column end, and S-401 rev B shows 150 mm throughout. Which applies?", "to": "Engineer", "activity": "A50", "why": "It changes the rebar quantity and the cage."})]
        return f"Rev A is superseded and the BoQ is priced on it. RFI-035 holds two columns.\n{HANDOFF}"
    if key == "doc_boq":
        if "read_package" not in r:
            return [("read_package", {"kind": "boq"}), ("read_quantities", {})]
        if "flag_signal" not in r:
            return [("flag_signal", {"tag": "BOQ_MISMATCH", "subject": "L4-03", "strength": "kuat", "evidence_ids": ["PLAN-BOQ-L4"], "note": "Rebar on the drawing in force is well above the BoQ, which was priced on rev A."})]
        return f"Concrete and formwork agree with the BoQ; rebar does not.\n{HANDOFF}"
    if key.startswith("sec_"):
        sid = key[4:]
        if "add_step" in r:
            return f"Planned the section.\n{HANDOFF}"
        if "read_package" not in r:
            return [*[("read_package", {"kind": k}) for k in ("spec", "drawing", "method")], ("read_norms", {}), ("read_quantities", {})]
        return [("add_step", {"ref": f, "name": n, "procedure": p, "after": a, "norm_id": nm, "quantity_id": q, "share_pct": s, "uses": u, "with_previous": w, "evidence_ids": e}) for f, n, p, a, nm, q, s, u, w, e in SECTIONS.get(sid, [])]
    if key == "planning":
        if "read_steps" not in r:
            return [("read_steps", {})]
        if "link_steps" not in r:
            return [("link_steps", {"step": s, "after": a}) for s, a in LINKS]
        return f"The sections link into the assembly section.\n{HANDOFF}"
    if key == "quality":
        if "read_package" not in r:
            return [("read_package", {"kind": "itp"}), ("read_package", {"kind": "spec"}), ("read_steps", {})]
        if "add_inspection" not in r:
            return [("add_inspection", {"ref": f, "name": n, "section": sc, "itp": i, "criteria": c, "by_whom": b, "hold_point": hp, "after": a, "before": bf, "hours": h, "wait_days": w, "procedure": p, "evidence_ids": e}) for f, n, sc, i, c, b, hp, a, bf, h, w, p, e in INSPECTIONS]
        return f"All four inspection plan items are in the WBS.\n{HANDOFF}"
    if key == "site":
        if "read_package" not in r:
            return [("read_package", {"kind": "method"}), ("read_steps", {})]
        if "add_handling" not in r:
            return [("add_handling", {"ref": f, "name": n, "section": sc, "after": a, "before": bf, "crew": c, "hours": h, "procedure": p, "evidence_ids": e}) for f, n, sc, a, bf, c, h, p, e in HANDLING]
        return f"Added the hauls and lifts the layout forces.\n{HANDOFF}"
    if key == "subcontract":
        if "read_plan" not in r:
            return [("read_plan", {}), ("read_subcontractors", {})]
        if "assign_crew" not in r:
            return [("assign_crew", {"step_id": s, "crew_size": n, "by": b}) for s, n, b in CREWS]
        if "propose_work_item" not in r:
            return [("propose_work_item", {"title": t, "owner": o, "due": d, "why": w, "activity": a}) for t, o, d, w, a in PROPOSALS["subcontract"]]
        return f"Crews assigned.\n{HANDOFF}"
    if key == "procurement":
        if "read_plan" not in r:
            return [("read_plan", {}), ("read_package", {"kind": "method"}), ("read_package", {"kind": "spec"})]
        if "flag_waste" not in r:
            return [("flag_waste", {"step_id": "rb_cut", "kind": "material", "note": "Cut to an optimised cutting list to bring rebar waste from 5% to 3%.", "saving_rp_sum": "0.02*2403.8*14000", "evidence_ids": ["PLAN-RKS-03"]}),
                    ("flag_waste", {"step_id": "h_bars", "kind": "handling", "note": "Move the bar bench to the hoist bay: the 120 m haul of every cage goes away.", "saving_rp_sum": "10*4/7*130000", "evidence_ids": ["PLAN-MS-02"]}),
                    ("flag_waste", {"step_id": "fw_cut", "kind": "material", "note": "The specification allows plywood to be reused 3 times. Casting in three lifts of 4 columns would need a third of the sheets, if the programme can take it.", "saving_rp_sum": "2/3*36.29*175000", "evidence_ids": ["PLAN-RKS-03"]}), *[("propose_work_item", {"title": t, "owner": o, "due": d, "why": w, "activity": a}) for t, o, d, w, a in PROPOSALS["procurement"]]]
        return f"Three ways to take waste out.\n{HANDOFF}"
    if key == "cost":
        if "read_plan" not in r:
            return [("read_plan", {}), ("read_package", {"kind": "boq"}), ("read_package", {"kind": "rates"})]
        if "flag_signal" not in r:
            return [("flag_signal", {"tag": "COST_EXPOSURE", "subject": "A50", "strength": "kuat", "evidence_ids": ["PLAN-BOQ-L4", "PLAN-RATE-01"], "note": "Rev B's extra rebar is not in the BoQ, and takes the plan's cost past its value unless a variation is agreed."}), *[("propose_work_item", {"title": t, "owner": o, "due": d, "why": w, "activity": a}) for t, o, d, w, a in PROPOSALS["cost"]]]
        return f"The extra rebar is the exposure.\n{HANDOFF}"
    if key == "contract":
        if "read_signals" not in r:
            return [("read_signals", {}), ("read_rfi_log", {})]
        if "propose_work_item" not in r:
            return [("propose_work_item", {"title": t, "owner": o, "due": d, "why": w, "activity": a}) for t, o, d, w, a in PROPOSALS["contract"]]
        return f"Two questions for the engineer.\n{HANDOFF}"
    if key == "qa_plan":
        if "read_package" not in r:
            return [("read_package", {"kind": "drawing"}), ("read_plan", {})]
        return json.dumps({"checks": [{"klaim": "Rebar uses the drawing in force", "ok": True, "bukti": "PLAN-DWG-S401-B"}, {"klaim": "The cage is inspected before the forms close", "ok": True, "bukti": "PLAN-ITP-12"}]})
    if key.startswith("red_"):
        if "read_package" not in r:
            return [("read_package", {"kind": "method"}), ("read_plan", {})]
        if "red_team_verdict" not in r:
            if key == "red_site":
                return [("red_team_verdict", {"result": "weakened", "reason": "The crane gives the columns only 3 hours a day: the skip lifts on H-3 limit how fast O-10 can run."})]
            return [("red_team_verdict", {"result": "holds", "reason": "The hold point on the cage comes before the forms close, and slump is tested before concrete leaves the mixer."})]
        return "Finished."
    if key == "validator":
        if "read_package" not in r:
            return [("read_package", {"kind": "itp"})]
        return json.dumps({"checks": [{"klaim": "Every inspection plan item is in the WBS", "ok": True, "bukti": "PLAN-ITP-12"}], "kontrak": [{"id": "k1", "ok": True, "bukti": "checked"}, {"id": "k2", "ok": True, "bukti": "checked"}, {"id": "k3", "ok": True, "bukti": "checked"}]})
    return f"Done.\n{HANDOFF}"


class MockPlanLlm(Scripted):
    def __init__(self, model: str = "mock", agent_key: str = "", delay: float = 0.0):
        super().__init__(model, delay)
        self.agent_key = agent_key

    def answer(self, results: dict, tools: set[str]) -> list[tuple[str, dict]] | str:
        return script(self.agent_key, results, tools)

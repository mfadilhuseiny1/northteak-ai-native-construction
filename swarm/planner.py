"""The swarm's main job: a consultant's planning documents into an implementable Operation Process Chart and procedure, with the workforce, material and waste of every step.

    penugasan    the orchestrator reads the package and sets the sections and a validation contract
    lapangan     analysts read the drawings, specification, programme and revisions; the quantity surveyor writes each quantity as a sum
    register     code works out the quantities and compares them with the BoQ
    investigasi  one planner per section writes its operations and procedures; norms come from SNI 7394:2008
    sintesis     leads merge the sections, place inspections and handling, assign crews, find waste, check cost and settle what disagrees
    qa           a reviewer and the red team, on the other model, try to break the plan
    laporan      the orchestrator writes the summary, the validator judges it, and a person approves the plan

Agents decide the steps and write the procedures. Every number comes from opc.py. Nothing an agent does changes a record: an approved plan does that (decide_plan, in the records).
"""

from __future__ import annotations

import json
import re
from typing import Any

from . import firm as F, norms as N, opc, planning_case as PC, project
from .firm import HANDOFF_ASK, RULES, SPARK, WONDER, emit, parse_json

SIGNALS = ["DOCUMENT_CONFLICT", "SUPERSEDED_DRAWING", "BOQ_MISMATCH", "CREW_SHORT", "TIME_SHORT", "SCOPE_GAP", "RFI_OPEN", "SEQUENCE_RISK", "MATERIAL_WASTE", "HANDLING_WASTE", "SAFETY", "COST_EXPOSURE", "OTHER"]
PHASES = [("penugasan", "Assign"), ("lapangan", "Document reading"), ("register", "Quantities"), ("investigasi", "Section planning"), ("sintesis", "Integration"), ("qa", "QA & red team"), ("laporan", "OPC & procedure")]
MACHINES = [{"key": "auto_checks", "name": "Package check", "peran": "code reads the package, the live crews and the open RFIs"}, {"key": "impact_engine", "name": "Quantities", "peran": "code works out each quantity and compares it with the BoQ"},
            {"key": "register", "name": "Findings", "peran": "code groups what the package gets wrong"}]
OPC_IS = """An Operation Process Chart (OPC) lists the operations and inspections of a work item in the order they happen. Feeder sections, such as rebar, formwork and concrete, each run down their own line and merge into a main stem that ends in the finished element. Inspections sit where they can still stop a mistake, before it is buried in concrete."""


def _lead(key: str, name: str, peran: str) -> dict:
    return {"key": key, "name": name, "peran": peran, "lini": key, "jenjang": "manajer", "induk": "partner", "model": SPARK, "peran_kode": "planner"}


def _analyst(key: str, line: str, name: str, peran: str, target: dict) -> dict:
    return {"key": key, "name": name, "peran": peran, "lini": line, "jenjang": "analis", "induk": line, "model": SPARK, "peran_kode": "analis", "target": target}


def roster() -> tuple[list[dict], list[dict]]:
    team = [{"key": "partner", "name": "Orchestrator", "peran": "reads the package, sets the sections and the validation contract, and writes the plan's summary", "lini": "pimpinan", "jenjang": "partner", "induk": None, "model": WONDER, "peran_kode": "partner"},
            _lead("planning", "Integration lead", "merges the sections into one chart with one end"), _lead("quality", "Inspection lead", "puts every inspection where it can still stop a mistake"), _lead("site", "Logistics lead", "adds the material handling the site layout forces"),
            _lead("subcontract", "Workforce lead", "assigns each step's crew and checks it against the subcontractors and the programme"), _lead("procurement", "Material and waste lead", "reads the material of every step and finds what can be saved"),
            _lead("cost", "Cost lead", "checks the plan's cost against the BoQ"), _lead("contract", "Contract lead", "settles what in the package disagrees: RFIs and work items"),
            {"key": "validator", "name": "Validator", "peran": "leads QA and the red team, and judges the plan against the contract, on the other model", "lini": "qa", "jenjang": "manajer", "induk": "partner", "model": WONDER, "peran_kode": "validator"},
            _analyst("doc_drawings", "planning", "Quantity surveyor", "reads the drawings and writes each quantity as a sum", {"kinds": ["drawing", "spec", "boq"]}), _analyst("doc_spec", "quality", "Specification reader", "reads the specification and inspection plan against the drawings", {"kinds": ["spec", "itp", "drawing"]}),
            _analyst("doc_programme", "subcontract", "Programme reader", "reads the programme against scope, crews and the norms", {"kinds": ["programme", "scope"]}), _analyst("doc_revisions", "contract", "Document controller", "finds superseded documents and open RFIs in the package", {"kinds": ["drawing", "boq", "scope"], "rfis": True}),
            _analyst("doc_boq", "cost", "BoQ checker", "compares the worked-out quantities with the BoQ", {"kinds": ["boq", "rates"]}),
            {"key": "section_planner", "name": "Section planner", "peran": "one instance per section: writes its operations and procedures", "lini": "planning", "jenjang": "peran", "induk": "planning", "model": SPARK, "peran_kode": "section", "target": {"kapasitas": 6}},
            {"key": "qa_plan", "name": "QA reviewer · plan", "peran": "rechecks the plan's sequence and quantities against the documents", "lini": "qa", "jenjang": "analis", "induk": "validator", "model": WONDER, "peran_kode": "qa", "target": {"lead": "planning"}},
            {"key": "red_team", "name": "Red team", "peran": "tries to break the plan from one point of view", "lini": "qa", "jenjang": "peran", "induk": "validator", "model": WONDER, "peran_kode": "red_team", "target": {"kapasitas": 2}}]
    why = [{"lini": line, "agen": n, "alasan": reason} for line, n, reason in (("planning", 1, "one quantity surveyor, plus a planner per section"), ("quality", 1, "the specification and inspection plan"), ("subcontract", 1, "the programme against crews"), ("contract", 1, "revisions and RFIs"), ("cost", 1, "the BoQ"))]
    return team, why


def _parse_crew(text: str) -> list[dict]:
    """'Pekerja:4, Tukang:1' into a crew list."""
    crew = [{"role": r.strip(), "count": int(n)} for r, n in re.findall(r"([A-Za-z][A-Za-z ]*?)\s*:\s*(\d+)", text or "")]
    if not crew:
        raise ValueError("write the crew as Role:count, for example Pekerja:4, Tukang:1")
    return crew


class PlanningFirm(F.Firm):
    signals = SIGNALS

    def __init__(self, model_of: Any, max_usd: float, brief: str, focus: str = "", mock: bool = False):
        super().__init__(model_of, max_usd, brief, focus, mock)
        self.team = {a["key"]: dict(a) for a in roster()[0]}
        self.known: dict[str, set[float]] = {}
        self.chart: opc.Chart | None = None
        self.result: dict | None = None
        self.summary = ""

    def head(self, a: dict) -> str:
        return f"You are {a['name']} in a swarm that turns a consultant's planning documents into an implementable Operation Process Chart and procedure for the main contractor's site team. Your role: {a['peran']}.\n{RULES}"

    def phase(self, pid: str, status: str, **extra: Any) -> None:
        emit({"type": "phase", "phase": pid, "label": dict(PHASES)[pid], "status": status, **extra})

    def _learn(self, key: str, thing: Any) -> None:
        self.known.setdefault(key, set()).update(opc.figures_in(json.dumps(thing, ensure_ascii=False)))

    # -------------------------------------------------------------------------------------------- tools

    def package_tool(self, key: str, kinds: list[str]):
        def read_package(kind: str) -> dict:
            """Read the planning package's documents of one kind. The kinds open to you are listed in your instructions."""
            if kind not in kinds:
                return {"refused": f"not your source. Yours: {', '.join(kinds)}"}
            docs = project.plan_documents([kind])
            self._learn(key, docs)
            return {"documents": docs}
        read_package.__doc__ = f"Read the planning package's documents of one kind. The kinds open to you: {', '.join(kinds)}."
        return read_package

    def norms_tool(self, key: str):
        def read_norms() -> dict:
            """The national standard's workforce and material per unit of work, and bar weights. Quote norm ids and material keys exactly."""
            table = N.table()
            self._learn(key, table)
            return table
        return read_norms

    def rfi_tool(self, key: str):
        def read_rfi_log() -> dict:
            """The project's RFI log as it stands now."""
            out = project.documents("rfi")
            self._learn(key, out)
            return out
        return read_rfi_log

    def crews_tool(self, key: str):
        def read_subcontractors() -> dict:
            """The subcontractors now: id, scope, crew, the activities they are programmed on, and their standing."""
            return {"subcontractors": [{"id": s["id"], "name": s["name"], "trade": s["trade"], "scope": s.get("scope", ""), "crew": s["crew"], "programmed_on": [a["id"] for a in s["activities"]], "rating": s["rating"], "expired": s["expired"], "expiring": s["expiring"]} for s in project.subcontractors()], "own_crew": {"id": "self", "name": "The contractor's own concrete crew", "crew": PC.OWN_CREW}}
        return read_subcontractors

    def quantity_tool(self, key: str):
        chart = self.chart

        def record_quantity(quantity_id: str, element: str, unit: str, sum_expression: str, boq_item: str, evidence_ids: list[str]) -> dict:
            """Record one quantity as a sum, and code works it out. sum_expression: numbers and + - * / ( ) only, each figure from what you read, in metres: 12*0.6*0.6*3.6. Write geometry out in full rather than a figure you worked out. unit: the norm's unit, m3, m2 or kg. boq_item: the BoQ line to compare with, or empty."""
            unread = [e for e in evidence_ids if e not in self.seen.get(key, set())]
            if not evidence_ids or unread:
                return {"refused": f"cite evidence you have read yourself: {', '.join(unread) or 'none given'}"}
            try:
                q = chart.add_quantity(quantity_id, element, unit, sum_expression, self.known.get(key, set()), boq_item, evidence_ids, key)
            except ValueError as e:
                return {"refused": str(e)}
            return {"id": q["id"], "value": q["value"], "unit": q["unit"]}
        return record_quantity

    def quantities_tool(self):
        def read_quantities() -> dict:
            """The quantities code has worked out, with each sum and its comparison with the BoQ."""
            return {"quantities": self.chart.plan()["quantities"]}
        return read_quantities

    def _evidence_refused(self, key: str, evidence_ids: list[str]) -> dict | None:
        unread = [e for e in evidence_ids if e not in self.seen.get(key, set())]
        if not evidence_ids or unread:
            return {"refused": f"cite documents you have read yourself: {', '.join(unread) or 'none given'}"}
        return None

    def step_tool(self, key: str, section: str):
        chart = self.chart

        def add_step(ref: str, name: str, procedure: str, after: list[str], norm_id: str, quantity_id: str, share_pct: float, uses: list[str], with_previous: bool, evidence_ids: list[str]) -> dict:
            """Add one operation. ref: a short unique name. name: what is done, starting with a verb. procedure: 1 to 3 sentences a foreman can follow: method, tools, tolerance, safety. after: refs of steps that must finish first. norm_id and quantity_id: the norm and quantity this operation belongs to. share_pct: its share of that norm's labour; several steps can share a norm, and code scales the shares to 100. uses: keys of the norm's materials this step consumes; each material belongs to one step. with_previous: true if it runs alongside the step before it. Write no quantity, hour or cost: code works them out."""
            refused = self._evidence_refused(key, evidence_ids)
            if refused:
                return refused
            try:
                chart.add_step(ref, section, "operation", name, after, procedure, evidence_ids, key, norm_id, quantity_id, share_pct, uses, with_previous=with_previous)
            except ValueError as e:
                return {"refused": str(e)}
            emit({"type": "tool_note", "agent": key, "text": f"added {name}"})
            return {"ok": True, "ref": ref}
        return add_step

    def steps_tool(self):
        def read_steps() -> dict:
            """The chart so far: every step, its section and what it waits for."""
            return {"sections": self.chart.sections, "steps": [{k: s[k] for k in ("ref", "section", "kind", "name", "after", "norm", "quantity", "share", "uses", "with_previous", "itp")} for s in self.chart.steps.values()], "quantities": list(self.chart.quantities)}
        return read_steps

    def plan_tool(self, key: str):
        def read_plan() -> dict:
            """The chart with every figure code has worked out: steps, crew, hours, material, waste, cost, the programme and code's checks."""
            p = self.chart.plan()
            out = {"steps": [{k: s[k] for k in ("id", "name", "section", "kind", "by", "after", "crew", "crew_size", "hours", "man_hours", "start_h", "finish_h", "critical", "basis", "itp", "labour_cost", "material_cost", "waste_cost")} | {"materials": [{k: m[k] for k in ("key", "name", "unit", "net", "waste_pct", "waste", "gross", "cost", "waste_cost")} for m in s["materials"]]} for s in p["steps"]],
                   "totals": p["totals"], "crew_by_day": p["crew_by_day"], "quantities": p["quantities"], "materials": p["materials"], "workforce": p["workforce"], "checks": p["checks"], "waste_flags": p["waste_flags"]}
            self._learn(key, out)
            return out
        return read_plan

    def integration_tools(self, key: str) -> list:
        chart = self.chart

        def link_steps(step: str, after: list[str]) -> dict:
            """Set what must finish before this step. Use it to merge the feeder sections into the main stem."""
            try:
                chart.link(step, after)
            except ValueError as e:
                return {"refused": str(e)}
            return {"ok": True}

        def remove_step(step: str, why: str) -> dict:
            """Remove a step that duplicates another. What waited for it now waits for what it waited for."""
            try:
                chart.remove(step)
            except ValueError as e:
                return {"refused": str(e)}
            chart.notes.append(f"{key} removed {step}: {why}")
            return {"ok": True}
        return [link_steps, remove_step]

    def inspection_tool(self, key: str):
        chart = self.chart

        def add_inspection(ref: str, name: str, section: str, itp: str, criteria: str, by_whom: str, hold_point: bool, after: list[str], before: list[str], hours: float, wait_days: float, procedure: str, evidence_ids: list[str]) -> dict:
            """Add one inspection or test. itp: its id in the inspection plan. criteria: what passes, with the tolerance. by_whom: who inspects. hold_point: true if work stops until it is signed. after and before: refs of the steps it sits between; steps in before now wait for it. hours: how long it takes. wait_days: days until the result, if any."""
            refused = self._evidence_refused(key, evidence_ids)
            if refused:
                return refused
            try:
                chart.add_step(ref, section, "inspection", name, after, procedure, evidence_ids, key, by=by_whom, crew=[{"role": by_whom, "count": 1}], hours=hours, wait_days=wait_days, itp=itp, criteria=criteria, hold_point=hold_point)
                chart.insert(ref, before)
            except ValueError as e:
                return {"refused": str(e)}
            return {"ok": True, "ref": ref}
        return add_inspection

    def handling_tool(self, key: str):
        chart = self.chart

        def add_handling(ref: str, name: str, section: str, after: list[str], before: list[str], crew: str, hours: float, procedure: str, evidence_ids: list[str]) -> dict:
            """Add one material handling step the site layout forces, such as hoisting bars to the level. crew: Role:count, for example Pekerja:4. hours: how long it takes in all. after and before: refs of the steps it sits between."""
            refused = self._evidence_refused(key, evidence_ids)
            if refused:
                return refused
            try:
                chart.add_step(ref, section, "handling", name, after, procedure, evidence_ids, key, crew=_parse_crew(crew), hours=hours)
                chart.insert(ref, before)
            except ValueError as e:
                return {"refused": str(e)}
            return {"ok": True, "ref": ref}
        return add_handling

    def crew_tool(self, key: str):
        chart = self.chart

        def assign_crew(step_id: str, crew_size: int, by: str) -> dict:
            """Set the workers on one operation: code works out its hours from the standard's man-hours. by: the subcontractor's id, or self for the contractor's own crew."""
            try:
                s = chart.assign_crew(step_id, crew_size, by)
            except ValueError as e:
                return {"refused": str(e)}
            return {"ok": True, "step": step_id, "by": s["by"]}
        return assign_crew

    def waste_tool(self, key: str):
        chart = self.chart

        def flag_waste(step_id: str, kind: str, note: str, saving_rp_sum: str, evidence_ids: list[str]) -> dict:
            """Flag waste that could be taken out at one step. kind: material, handling, inspection or waiting. note: what to change, in a sentence. saving_rp_sum: the rupiah saved, as a sum such as 0.02*2403.8*14000, or empty if you cannot put a figure on it."""
            refused = self._evidence_refused(key, evidence_ids)
            if refused:
                return refused
            try:
                f = chart.flag_waste(step_id, kind, note, saving_rp_sum, evidence_ids, key)
            except ValueError as e:
                return {"refused": str(e)}
            tag = {"material": "MATERIAL_WASTE", "handling": "HANDLING_WASTE"}.get(kind, "OTHER")
            emit({"type": "tag", "agent": key, "id": f"{tag}:{step_id}", "tag": tag, "entitas": "step", "kunci": step_id, "judul": f"{step_id}: {note[:120]}", "kekuatan_agen": "sedang", "kekuatan": "sedang", "dukungan": 1, "klasifikasi": "Internal"})
            return {"ok": True, "saving_rp": f["saving_rp"]}
        return flag_waste

    def _rfi_tool(self, key: str):
        return next(t for t in self.read_tools(key, {"rfis": True}) if t.__name__ == "draft_rfi")

    # -------------------------------------------------------------------------------------------- the phases

    async def phase_0(self) -> dict:
        self.phase("penugasan", "mulai")
        self.machine("auto_checks", "bekerja")
        docs = project.plan_documents()
        live = {a["id"]: a for a in project.schedule()["activities"]}
        window = sum(live[x]["duration"] for x in PC.SCOPE["activities"] if x in live)
        crews = {**{s["id"]: s["crew"] for s in project.subcontractors()}, "self": PC.OWN_CREW}
        self.machine("auto_checks", "selesai", hasil={"aturan": {"documents": len(docs), "open RFIs": sum(1 for r in project.all_of("rfi") if r["status"] == "open")}, "catatan": f"package check: {len(docs)} documents, live crews and open RFIs read"})

        def read_package_index() -> dict:
            """The documents in the planning package: id, kind, title, who issued it and when."""
            return {"documents": [{k: d[k] for k in ("id", "kind", "title", "from", "date")} for d in docs], "activities": {k: live[k] for k in PC.SCOPE["activities"] if k in live}, "default_sections": PC.SCOPE["sections"]}

        text = f"""{self.head(self.team['partner'])}
{OPC_IS}
Call read_package_index and read the work brief, then write the plan before any worker starts. Answer with JSON only:
{{"ringkasan": "two sentences: the work item and what this plan must settle", "hipotesis": [{{"id": "H1", "teks": "something in the package that must be checked"}}], "sections": [{{"id": "short_id", "name": "section name", "by": "subcontractor id"}}], "kontrak": ["a statement that must be true of the finished plan"]}}
Sections: the feeder lines first and the main stem last. Keep default_sections unless the work calls for others. Write 3 to 5 hypotheses and 4 to 6 contract statements."""
        out = await self.work("partner", text, [read_package_index, self.package_tool("partner", ["scope"])], f"Work item: {PC.SCOPE['title']}.\n{self.brief}\nFocus from the project manager: {self.focus or 'none'}")
        raw = parse_json(out) or {}
        sections = [s for s in (raw.get("sections") or []) if isinstance(s, dict) and re.fullmatch(r"[a-z0-9_]{2,20}", str(s.get("id") or "")) and s.get("name")]
        if len(sections) < 2 or len({s["id"] for s in sections}) != len(sections):
            sections = PC.SCOPE["sections"]
        sections = [{"id": s["id"], "name": s["name"], "by": s.get("by") if s.get("by") in crews else ""} for s in sections]
        self.chart = opc.Chart(PC.SCOPE["title"], PC.SCOPE["activities"], sections, PC.RATES, PC.BOQ, window, crews, PC.ITP_IDS, PC.PROGRAMME_CREW)
        self.plan = {"ringkasan": raw.get("ringkasan") or self.brief, "hipotesis": raw.get("hipotesis") or [], "fokus": {s["id"]: s["name"] for s in sections}, "kontrak": raw.get("kontrak") or ["Every number in the plan comes from code.", "Every inspection in the plan protects work still to come.", "What in the package disagrees is said plainly."]}
        self.contract = [{"id": f"k{i}", "teks": str(t)} for i, t in enumerate(self.plan["kontrak"], 1)]
        emit({"type": "engagement_plan", "plan": {**self.plan, "kontrak": self.contract}})
        emit({"type": "kontrak", "kontrak": self.contract})
        self.scrutinize("penugasan", [("the orchestrator read the package before planning", self.read("partner"), f"{len(self.receipts.get('partner', []))} tool calls"), ("the plan has a validation contract", bool(self.contract), f"{len(self.contract)} statements"), ("the chart has sections", bool(sections), ", ".join(s["id"] for s in sections))])
        self.phase("penugasan", "selesai")
        return self.plan

    async def reader(self, a: dict) -> None:
        kinds = a["target"]["kinds"]
        tools: list = [self.package_tool(a["key"], kinds), self.flag_tool(a["key"])]
        extra = ""
        if a["key"] == "doc_drawings":
            tools += [self.norms_tool(a["key"]), self.quantity_tool(a["key"])]
            extra = "Work out the quantities the plan needs, one record_quantity for each norm: concrete in m3, formwork in m2, reinforcement in kg, each compared with its BoQ line. Use the drawing in force, and the stricter requirement where the specification and drawing differ, and say so. Work reinforcement out as the main bars with their laps and the stirrups with their hooks, using the bar weights from read_norms."
        elif a["key"] == "doc_spec":
            extra = "Find where the specification, inspection plan and drawings disagree or leave something open."
        elif a["key"] == "doc_programme":
            tools += [self.norms_tool(a["key"]), self.crews_tool(a["key"])]
            extra = "Compare the programme with the scope, with who is programmed and with the workers the work needs: work out roughly what the norms imply against the workers the programme allows."
        elif a["key"] == "doc_revisions":
            tools += [self.rfi_tool(a["key"]), self._rfi_tool(a["key"])]
            extra = "Find documents in the package that are superseded, documents priced on them, and open RFIs that hold part of this work. Draft an RFI with draft_rfi where only someone outside can settle it. The activity it holds is A50 or A60."
        elif a["key"] == "doc_boq":
            tools += [self.quantities_tool()]
            extra = "Code has compared the quantities with the BoQ. Say what each difference means and what it would cost at the BoQ rate."
        text = f"""{self.head(a)}
Today is {F.C.TODAY}. The work item: {PC.SCOPE['title']}, activities {', '.join(PC.SCOPE['activities'])}.
Your sources: documents of kind {', '.join(kinds)}. Read all of them with your tools.
{extra}
Call flag_signal for each problem with the evidence IDs you read. Signal types: {', '.join(SIGNALS)}. The subject is an activity id or GENERAL. Flag only what your sources say. Then write a short report.
{HANDOFF_ASK}"""
        await self.work(a["key"], text, tools, f"Your role: {a['peran']}.\n{self.brief}")

    async def phase_1(self, plan: dict) -> None:
        self.phase("lapangan", "mulai")
        readers = [a for a in self.team.values() if a["key"] in ("doc_drawings", "doc_spec", "doc_programme", "doc_revisions")]
        await self.all([self.reader(a) for a in readers], "lapangan")
        done = sum(1 for a in readers if self.read(a["key"]))
        self.scrutinize("lapangan", [("every reader read its sources", done == len(readers), f"{done}/{len(readers)}"), ("quantities were worked out", bool(self.chart.quantities), f"{len(self.chart.quantities)} quantities"), ("every signal cites evidence its agent read", True, f"{len(self.ledger)} signals; the tool refuses any other")])
        self.phase("lapangan", "selesai")

    def _code_flag(self, tag: str, subject: str, evidence: list[str], note: str) -> None:
        entry = self.ledger.setdefault((tag, subject), {"tag": tag, "subject": subject, "agents": [], "evidence": [], "notes": []})
        entry["agents"] = sorted(set(entry["agents"]) | {"code"})
        entry["evidence"] = sorted(set(entry["evidence"]) | set(evidence))
        entry["notes"].append(note)
        emit({"type": "tag", "agent": "code", "id": f"{tag}:{subject}", "tag": tag, "entitas": "quantity", "kunci": subject, "judul": f"{subject}: {note[:120]}", "kekuatan_agen": "kuat", "kekuatan": "kuat", "dukungan": len(entry["agents"]), "klasifikasi": "Internal"})

    def phase_2(self) -> None:
        self.phase("register", "mulai")
        self.machine("impact_engine", "bekerja")
        quantities = self.chart.plan()["quantities"]
        off = [q for q in quantities if q["boq_diff_pct"] is not None and abs(q["boq_diff_pct"]) > opc.TOLERANCE]
        for q in off:
            self._code_flag("BOQ_MISMATCH", q["boq_item"], ["PLAN-BOQ-L4", *q["evidence"]], f"{q['element']} works out at {q['value']:,.1f} {q['unit']} against {q['boq_qty']:,} in the BoQ ({q['boq_diff_pct']:+}%), about Rp {q['boq_exposure_rp']:,} at the BoQ rate.")
        self.machine("impact_engine", "selesai", hasil={"teknik": len(quantities), "items": len(PC.BOQ), "tag": len(off), "catatan": f"quantities: {len(quantities)} worked out by code, {len(off)} off the BoQ"})
        self.machine("register", "bekerja")
        groups: dict[str, int] = {}
        for tag, _ in self.ledger:
            short = {"BOQ_MISMATCH": "BoQ", "DOCUMENT_CONFLICT": "Docs", "SUPERSEDED_DRAWING": "Docs", "CREW_SHORT": "Crew", "SCOPE_GAP": "Crew", "RFI_OPEN": "RFI"}.get(tag, "Other")
            groups[short] = groups.get(short, 0) + 1
        box = {"items": len(self.ledger), "kelompok": {k: {"items": v, "arti": k} for k, v in groups.items()}, "total_estimasi_kerugian_rp": sum(abs(q["boq_exposure_rp"]) for q in off), "baris": [], "catatan": f"findings so far: {len(self.ledger)}"}
        self.machine("register", "selesai", hasil=box)
        self.scrutinize("register", [("code worked out every quantity", bool(quantities), f"{len(quantities)} quantities, {len(off)} off the BoQ")])
        self.phase("register", "selesai")

    async def section(self, a: dict) -> None:
        s = a["target"]
        tools = [self.package_tool(a["key"], ["spec", "drawing", "method", "scope"]), self.norms_tool(a["key"]), self.quantities_tool(), self.step_tool(a["key"], s["section"])]
        stem = s["section"] == self.chart.sections[-1]["id"]
        where = "This is the main stem: erection, closing the forms, casting, compaction, striking and curing, ending in the finished element." if stem else "This is a feeder section: it prepares what the main stem receives. Stop where it is ready to go to the main stem."
        text = f"""{self.head(a)}
{OPC_IS}
Plan section "{s['name']}" of {PC.SCOPE['title']}. {where}
Other planners have the other sections: {', '.join(x['name'] for x in self.chart.sections if x['id'] != s['section'])}. Write only yours. Others place inspections and material handling later, so leave those out.
Read the specification, drawings and logistics note, the norms and the quantities. Then call add_step once for each operation, in order, each a real thing a crew does. Start each ref with {s['section']}_. Steps in your section say what they wait for in after.
Every operation belongs to a norm and quantity. Across all steps of a norm, every material must be used by exactly one step: give each material to the step that consumes it. A procedure says how to do it to the specification, with its tolerance and any safety point.
{HANDOFF_ASK}"""
        await self.work(a["key"], text, tools, f"Plan the section: {s['name']}.\nFindings so far: {json.dumps(list(self.ledger.values()))[:1800]}")
        steps = [x for x in self.chart.steps.values() if x["section"] == s["section"]]
        emit({"type": "rekomendasi", "agent": a["key"], "items": s["section"], "nama": s["name"], "kelompok": s["section"], "jalur": "recommended" if steps else "rejected", "ringkas": f"{len(steps)} operations planned", "alasan": f"{len(steps)} operations", "bukti": sorted({e for x in steps for e in x["evidence"]})})

    async def phase_3(self) -> None:
        self.phase("investigasi", "mulai")
        made = self.instances("section_planner", self.chart.sections, lambda n, s: {"key": f"sec_{s['id']}", "name": f"Section planner · {s['name']}", "peran": f"writes the operations and procedures of {s['name']}", "target": {"section": s["id"], "name": s["name"]}, "peran_kode": "section"})
        for a in made:
            emit({"type": "assign", "agent": a["key"], "target": {"nama": a["target"]["name"], "kelompok": a["target"]["section"]}})
        await self.all([*[self.section(a) for a in made], self.reader(self.team["doc_boq"])], "investigasi")
        have = {s["section"] for s in self.chart.steps.values()}
        self.scrutinize("investigasi", [("every section has its operations", all(s["id"] in have for s in self.chart.sections), f"{len(self.chart.steps)} operations in {len(have)} sections"), ("every number stays with code", True, "the tools take no quantity, hour or cost")])
        self.phase("investigasi", "selesai")

    async def lead(self, key: str, task: str, tools: list, prompt: str) -> str:
        text = f"""{self.head(self.team[key])}
{OPC_IS}
{task}
{HANDOFF_ASK}"""
        return await self.work(key, text, tools, prompt)

    async def phase_4(self, plan: dict) -> dict[str, str]:
        self.phase("sintesis", "mulai")
        out: dict[str, str] = {}
        stem = self.chart.sections[-1]
        out["planning"] = await self.lead("planning", f"Call read_steps, then merge the sections into one chart. Use link_steps so each feeder's last step leads into the right step of the main stem, \"{stem['name']}\", and remove any duplicate. There must be no loops, and exactly one last step. Do not add inspections or handling: others do that next.", [self.steps_tool(), *self.integration_tools("planning")], "Merge the sections.")

        async def quality():
            out["quality"] = await self.lead("quality", "Read the inspection plan and specification, and read_steps. Call add_inspection once for each item of the inspection plan, placed so that it can still stop a mistake: before the work it protects is closed up or cast. A test whose result comes later may be last in the chart, with wait_days.", [self.package_tool("quality", ["itp", "spec"]), self.steps_tool(), self.inspection_tool("quality")], "Place the inspections.")

        async def site():
            out["site"] = await self.lead("site", "Read the logistics note and read_steps. Call add_handling for each movement of material between a feeder section and the place it is used that the site layout forces, with a crew and hours.", [self.package_tool("site", ["method"]), self.steps_tool(), self.handling_tool("site")], "Add the handling.")
        await self.all([quality(), site()], "sintesis")
        self.chart.number()
        self.machine("numbering", "selesai", hasil={"steps": len(self.chart.steps)})

        async def workforce():
            propose = self.proposal_tool("subcontract")
            out["subcontract"] = await self.lead("subcontract", "Call read_plan and read_subcontractors. Call assign_crew for every operation, so that the chart fits the programme's working days and the crew each subcontractor has, naming who does it. Read the plan again, and flag_signal what does not fit: a crew above the programme's allowance, or a subcontractor not programmed on work in its scope. Propose a work item for what must be arranged.", [self.plan_tool("subcontract"), self.crews_tool("subcontract"), self.crew_tool("subcontract"), self.flag_tool("subcontract"), propose], "Assign the crews.")

        async def waste():
            out["procurement"] = await self.lead("procurement", "Call read_plan and read the logistics note and specification. Call flag_waste for what could be taken out: material over the net need, handling that could be shorter or merged, inspections that repeat each other, and waiting. Put a rupiah figure on it as a sum where you can. Propose a work item for what must be arranged.", [self.plan_tool("procurement"), self.package_tool("procurement", ["method", "spec"]), self.waste_tool("procurement"), self.proposal_tool("procurement")], "Find the waste.")

        async def cost():
            out["cost"] = await self.lead("cost", "Call read_plan and read the BoQ and rates. Say what the plan costs against the BoQ, and flag_signal what is exposed. Propose a work item for what must be claimed or corrected.", [self.plan_tool("cost"), self.package_tool("cost", ["boq", "rates"]), self.flag_tool("cost"), self.proposal_tool("cost")], "Check the cost.")

        async def contract():
            out["contract"] = await self.lead("contract", "Call read_signals and read_rfi_log. Say what in the package must be settled before work starts and who owes the answer. Propose a work item for each. Activities here are A50 or A60.", [self.signals_tool(), self.rfi_tool("contract"), self.proposal_tool("contract")], "Settle what disagrees.")
        await self.all([workforce(), waste(), cost(), contract()], "sintesis")
        p = self.chart.plan()
        failed = [c for c in p["checks"] if not c["ok"]]
        self.scrutinize("sintesis", [("the chart ends in one step with no loops", next(c["ok"] for c in p["checks"] if c["rule"] == "one_end"), next(c["text"] for c in p["checks"] if c["rule"] == "one_end")), ("every inspection plan item is on the chart", next(c["ok"] for c in p["checks"] if c["rule"] == "itp"), next(c["text"] for c in p["checks"] if c["rule"] == "itp")), ("code's checks", True, f"{len(p['checks']) - len(failed)} of {len(p['checks'])} pass")])
        self.phase("sintesis", "selesai")
        return out

    async def review(self, a: dict, syntheses: dict[str, str]) -> None:
        kinds = ["drawing", "spec", "itp", "boq", "programme", "method"]
        text = f"""{self.head(a)}
Recheck the plan against the documents yourself: the sequence, the place of each inspection, and the quantities' sums. Then answer with JSON only: {{"checks": [{{"klaim": "a claim the plan makes", "ok": true, "bukti": "the ID that supports or refutes it"}}]}}. Check 3 to 5 claims."""
        out = await self.work(a["key"], text, [self.package_tool(a["key"], kinds), self.plan_tool(a["key"])], "Recheck it.")
        checks = (parse_json(out) or {}).get("checks") or []
        rows = [{"klaim": str(c.get("klaim")), "ok": bool(c.get("ok")), "bukti": str(c.get("bukti"))} for c in checks if isinstance(c, dict)]
        emit({"type": "verdict", "validator": a["key"], "model": a["model"], "lini": "planning", "sintesis": "the plan", "checks": rows, "passed": sum(1 for r in rows if r["ok"]), "total": len(rows)})

    async def attack(self, a: dict, view: dict) -> None:
        def red_team_verdict(result: str, reason: str) -> dict:
            """Your finding. result: holds (you could not break the plan) or weakened (you found what breaks it)."""
            if result not in ("holds", "weakened"):
                return {"refused": "result must be holds or weakened"}
            self.attacks[view["id"]] = {"result": result, "reason": reason, "view": view["name"]}
            emit({"type": "red_team", "agent": a["key"], "indikasi_id": view["id"], "judul": view["name"], "tag": view["id"], "hasil": "bertahan" if result == "holds" else "melemah", "kekuatan": "kuat" if result == "holds" else "sedang", "alasan": reason})
            return {"ok": True}

        text = f"""{self.head(a)}
Try to break this plan as {view['name']} would: {view['ask']} Read the documents and the plan, then call red_team_verdict once, naming the step ids."""
        await self.work(a["key"], text, [self.package_tool(a["key"], ["drawing", "spec", "itp", "programme", "method"]), self.plan_tool(a["key"]), red_team_verdict], "Attack it.")

    async def phase_5(self, syntheses: dict[str, str]) -> None:
        self.phase("qa", "mulai")
        self.attacks: dict[str, dict] = {}
        emit({"type": "agent_status", "agent": "validator", "status": "bekerja", "model": WONDER})
        views = [{"id": "site", "name": "a site superintendent", "ask": "what stops this sequence working on the real site, with this crane, hoist and crew?"}, {"id": "quality", "name": "a quality engineer", "ask": "where could a mistake get buried in concrete before anyone can see it?"}]
        made = self.instances("red_team", views, lambda n, v: {"key": f"red_{v['id']}", "name": f"Red team · {v['id']}", "peran": f"attacks the plan as {v['name']}", "target": {"view": v["id"]}, "peran_kode": "red_team"})
        await self.all([self.review(self.team["qa_plan"], syntheses), *[self.attack(a, v) for a, v in zip(made, views)]], "qa")
        emit({"type": "agent_status", "agent": "validator", "status": "selesai", "ms": 0, "calls": 0, "tags": 0, "laporan": f"The plan was rechecked; {len(self.attacks)} attacks"})
        self.scrutinize("qa", [("the plan was attacked from each point of view", len(self.attacks) == len(views), f"{len(self.attacks)}/{len(views)}")])
        self.phase("qa", "selesai")

    def findings(self) -> list[dict]:
        return [{"tag": v["tag"], "subject": v["subject"], "agents": v["agents"], "who": [("Code" if k == "code" else self.team.get(k, {}).get("name", k)) for k in v["agents"]], "evidence": v["evidence"], "note": v["notes"][0], "notes": v["notes"]} for v in self.ledger.values()]

    def tables(self, p: dict) -> str:
        t = p["totals"]
        rows = ["| Step | What | By | Crew | Hours | Man-hours | Material and waste |", "|---|---|---|---|---|---|---|"]
        for s in p["steps"]:
            crew = ", ".join(f"{c['count']} {c['role']}" for c in s["crew"]) or "-"
            mats = "; ".join(f"{m['name']} {m['gross']:,.1f} {m['unit']} ({m['waste']:,.1f} waste)" for m in s["materials"]) or "-"
            rows.append(f"| {s['id']} | {s['name']} | {s['by'] or '-'} | {crew} | {s['hours']} | {s['man_hours']} | {mats} |")
        mats = ["| Material | Net | Waste | To order | Cost (Rp) | Waste (Rp) |", "|---|---|---|---|---|---|"] + [f"| {m['name']} | {m['net']:,.2f} {m['unit']} | {m['waste']:,.2f} ({m['waste_pct']}%) | {m['gross']:,.2f} | {m['cost']:,} | {m['waste_cost']:,} |" for m in p["materials"]]
        checks = "\n".join(f"- {'OK' if c['ok'] else '**Look at this**'}: {c['text']}" for c in p["checks"])
        saving = lambda f: f" About Rp {f['saving_rp']:,}, the agent's estimate." if f["saving_rp"] else ""  # noqa: E731
        waste = "\n".join(f"- **{f['step']}** ({f['kind']}): {f['note']}{saving(f)}" for f in p["waste_flags"]) or "- none"
        found = "\n".join(f"- **{f['tag']}** on {f['subject']}: {f['note']} ({', '.join(f['evidence'])})" for f in self.findings()) or "- none"
        return f"## The chart\n\n{chr(10).join(rows)}\n\n## Material and waste\n\n{chr(10).join(mats)}\n\n**Totals:** {t['man_hours']:,} man-hours, {t['days']} working days against {t['window_days']} in the programme, peak crew {t['peak_crew']}. Planned cost Rp {t['cost']:,} against a BoQ value of Rp {t['boq_value']:,}. Material waste Rp {t['waste_cost']:,}.\n\n## What code checked\n\n{checks}\n\n## What the agents found in the package\n\n{found}\n\n## Waste to take out\n\n{waste}"

    async def phase_6(self, syntheses: dict[str, str]) -> None:
        self.phase("laporan", "mulai")
        material = "\n\n".join(f"{k}:\n{v}" for k, v in syntheses.items())
        text = f"""{self.head(self.team['partner'])}
Call read_plan, then write the summary of this work plan for the project manager, in plain English, in three parts with these headings:
## What this plan does
## Settle these before work starts
## Watch on site
Name who must act. Use only figures your tools returned, written as they are. Do not repeat the step tables: code adds them.

Leads' reports:
{material}"""
        out = await self.work("partner", text, [self.plan_tool("partner")], "Write the summary.")
        body, dropped = self.checked(out)
        p = self.chart.plan()
        new_rfis = "\n".join(f"- **Draft to {r['to']}**, on {r['activity']}: {r['subject']}. {r['question']}" for r in self.rfi_drafts) or "- none"
        items = "\n".join(f"- **{w['title']}**: {w['owner']}, by {w['due']}. {w['why']}" for w in self.proposed) or "- none"
        attacks = "\n".join(f"- **{v['view']}** ({v['result']}): {v['reason']}" for v in self.attacks.values()) or "- none"
        report = f"# Work plan: {PC.SCOPE['title']}\n\n{body}\n\n{self.tables(p)}\n\n## The red team\n\n{attacks}\n\n## New RFIs drafted, not issued\n\n{new_rfis}\n\n## Work items that open when you approve\n\n{items}\n\n## Decision\n\nA person approves this plan. Nothing changes until then."
        emit({"type": "draft", "text": report})
        vtext = f"""{self.head(self.team['validator'])}
Judge this work plan against its validation contract, reading the documents yourself. Answer with JSON only:
{{"checks": [{{"klaim": "a claim in the plan", "ok": true, "bukti": "the ID"}}], "kontrak": [{{"id": "k1", "ok": true, "bukti": "why"}}]}}

Contract: {json.dumps(self.contract)}

Plan:
{report}"""
        vout = await self.work("validator", vtext, [self.package_tool("validator", ["drawing", "spec", "itp", "boq", "programme", "method", "scope"])], "Judge it.")
        v = parse_json(vout) or {}
        checks = [{"klaim": str(c.get("klaim")), "ok": bool(c.get("ok")), "bukti": str(c.get("bukti"))} for c in (v.get("checks") or []) if isinstance(c, dict)]
        judged = {str(c.get("id")): c for c in (v.get("kontrak") or []) if isinstance(c, dict)}
        contract = [{**k, "ok": judged.get(k["id"], {}).get("ok"), "bukti": judged.get(k["id"], {}).get("bukti")} for k in self.contract]
        emit({"type": "verdict", "validator": "validator", "model": WONDER, "checks": checks, "kontrak": contract, "passed": sum(1 for c in checks if c["ok"]), "total": len(checks)})
        self.report, self.result, self.summary = report, p, body
        stats = self.score()
        emit({"type": "engagement", "laporan": report, "statistik": {"steps": p["totals"]["steps"], "signals": len(self.ledger), "agents": len(self.reports), "sentences dropped by code": dropped, **stats}})
        self.scrutinize("laporan", [("the plan has a report", bool(report), f"{len(report):,} characters"), ("nothing was changed by an agent", True, "the plan waits for a person")])
        self.phase("laporan", "selesai")

    def score(self) -> dict:
        """Against what the case plants: only after the agents have finished, and only on the package as it came."""
        if not project.as_seeded():
            return {"score": "not scored: the project records have changed since the scenario began"}
        rebar = next((q["value"] for q in self.chart.quantities.values() if q["unit"] == "kg"), 0)
        lo, hi = PC.TRUTH["rebar_kg"]
        must = PC.TRUTH["must_flag"]
        found = [tag for tag, doc in must.items() if any(t == tag and doc in v["evidence"] for (t, _), v in self.ledger.items())]
        return {"rebar worked out from the drawing in force": lo <= rebar <= hi, "package problems found": f"{len(found)}/{len(must)}", "missed": [t for t in must if t not in found]}

    async def engagement(self) -> None:
        team, why = roster()
        emit({"type": "run", "status": "started", "kind": "swarm"})
        emit({"type": "firm", "jenis": "plan", "tim": team, "mesin": MACHINES, "fase": [{"id": i, "label": label} for i, label in PHASES], "brief": self.brief, "versi": "1.0", "ukuran": why})
        plan = await self.phase_0()
        await self.phase_1(plan)
        self.phase_2()
        await self.phase_3()
        syntheses = await self.phase_4(plan)
        await self.phase_5(syntheses)
        await self.phase_6(syntheses)
        emit({"type": "done"})

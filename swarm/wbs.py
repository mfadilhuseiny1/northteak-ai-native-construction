"""A Work Breakdown Structure as data: a work item broken down into sections and tasks (operations, inspections and handling), each with its procedure, workforce, material and waste, and the links its critical path needs.

Agents decide the tasks and write the procedures. Everything with a number in it is worked out here: a quantity from the sum an agent wrote, workforce and material from the norm it chose, waste and cost from the tables, time from the crew it assigned.
"""

from __future__ import annotations

import ast
import csv
import io
import math
import operator
import re

from . import norms as N

OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
PREFIX = {"operation": "O", "inspection": "I", "handling": "H"}
TOLERANCE = 3.0  # a quantity within this percentage of the BoQ agrees with it: our assumption


def evaluate(expression: str) -> tuple[float, list[float]]:
    """The value of a sum an agent wrote, and the figures it used. Only numbers and + - * / ( ) are read, so nothing else can run."""
    used: list[float] = []

    def walk(node: ast.AST) -> float:
        if isinstance(node, ast.BinOp) and type(node.op) in OPS:
            return OPS[type(node.op)](walk(node.left), walk(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            value = walk(node.operand)
            return -value if isinstance(node.op, ast.USub) else value
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            used.append(float(node.value))
            return float(node.value)
        raise ValueError("use only numbers and + - * / ( )")

    text = (expression or "").replace("×", "*").replace(",", "").strip()
    if not text or len(text) > 300:
        raise ValueError("write the sum in under 300 characters")
    try:
        return walk(ast.parse(text, mode="eval").body), used
    except (SyntaxError, ZeroDivisionError) as e:
        raise ValueError(f"not a sum I can work out: {e}") from e


def figures_in(text: str) -> set[float]:
    return {float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text or "")}


def unknown_figures(used: list[float], known: set[float]) -> list[float]:
    """Figures that are not in what the agent read. A sum may change units (600 mm is 0.6 m), and small whole numbers are geometry (4 sides, 2 ends)."""
    out = []
    for x in used:
        if x == int(x) and 0 <= x <= 6:
            continue
        if not any(math.isclose(x * scale, k, rel_tol=1e-6) for scale in (1, 10, 100, 1000, 0.001) for k in known):
            out.append(x)
    return out


def split_crew(size: int, oh: dict[str, float]) -> list[dict]:
    """A crew shared across trades in proportion to their work, adding up to the crew, with at least one of each while there are people to go round."""
    total = sum(oh.values())
    if not total or size < 1:
        return []
    exact = {role: size * v / total for role, v in oh.items()}
    counts = {role: min(size, max(1, int(x))) for role, x in exact.items()}
    while sum(counts.values()) > size:
        role = max(counts, key=lambda r: counts[r])
        counts[role] -= 1
    while sum(counts.values()) < size:
        role = max(exact, key=lambda r: exact[r] - counts[r])
        counts[role] += 1
    return [{"role": role, "count": n} for role, n in counts.items() if n]


def code_tasks(steps: list[dict], sections: list[dict], activities: list[str], heads: dict[str, dict] | None = None) -> list[dict]:
    """Hangs the tasks on the breakdown: programme activity, then section, then task. Writes each task's activity and WBS code, and returns the tree.

    A task takes its section's activity, or else the latest activity of what it waits for, so a section that spans two activities splits where its work moves on. Steps come in the order the work happens."""
    heads, place = heads or {}, {a: i for i, a in enumerate(activities)}
    fixed = {s["id"]: s.get("activity") for s in sections}
    seen: dict[str, str] = {}
    for t in steps:
        mine = fixed.get(t["section"])
        if mine not in place:
            mine = max((seen[a] for a in t["after"] if a in seen), key=lambda a: place[a], default=activities[0] if activities else "")
        t["activity"] = seen[t["id"]] = mine
        t["code"] = ""
    tree = []
    for i, aid in enumerate(activities, 1):
        head = heads.get(aid) or {}
        node = {"activity": aid, "code": head.get("code") or f"1.{i}", "name": head.get("name") or aid, "sections": []}
        for s in sections:
            tasks = [t for t in steps if t["activity"] == aid and t["section"] == s["id"]]
            if tasks:
                sec = {"id": s["id"], "name": s["name"], "by": s.get("by", ""), "code": f"{node['code']}.{len(node['sections']) + 1}", "tasks": [t["id"] for t in tasks]}
                for n, t in enumerate(tasks, 1):
                    t["code"] = f"{sec['code']}.{n}"
                node["sections"].append(sec)
        tree.append(node)
    return tree


class Breakdown:
    """One work item's breakdown while agents build it. Refusals are ValueErrors whose text goes back to the agent."""

    def __init__(self, title: str, activities: list[str], sections: list[dict], rates: dict, boq: list[dict], window_days: float, crews: dict[str, int], itp_ids: list[str], programme_crew: int | None = None, heads: dict[str, dict] | None = None):
        self.title, self.activities, self.sections, self.rates, self.boq = title, activities, sections, rates, boq
        self.window_days, self.crews, self.itp_ids, self.programme_crew, self.heads = window_days, crews, itp_ids, programme_crew, heads
        self.quantities: dict[str, dict] = {}
        self.steps: dict[str, dict] = {}
        self.ids: dict[str, str] = {}  # final id -> ref, once numbered
        self.waste_flags: list[dict] = []
        self.notes: list[str] = []

    def _ref(self, name: str) -> str:
        ref = self.ids.get(name, name)
        if ref not in self.steps:
            raise ValueError(f"no step {name}")
        return ref

    def add_quantity(self, qid: str, element: str, unit: str, expression: str, known: set[float], boq_item: str, evidence: list[str], agent: str) -> dict:
        value, used = evaluate(expression)
        missing = unknown_figures(used, known)
        if missing:
            raise ValueError(f"these figures are not in what you read: {', '.join(str(m) for m in missing)}. Use figures from the documents.")
        if value <= 0:
            raise ValueError("a quantity must be more than zero")
        if boq_item and not any(b["id"] == boq_item for b in self.boq):
            raise ValueError(f"no BoQ item {boq_item}")
        self.quantities[qid] = {"id": qid, "element": element, "unit": unit, "expression": expression, "value": round(value, 3), "boq_item": boq_item, "evidence": evidence, "agent": agent}
        return self.quantities[qid]

    def add_step(self, ref: str, section: str, kind: str, name: str, after: list[str], procedure: str, evidence: list[str], agent: str, norm_id: str = "", quantity_id: str = "", share_pct: float = 0, uses: list[str] | None = None,
                 by: str = "", crew: list[dict] | None = None, hours: float = 0, wait_days: float = 0, with_previous: bool = False, itp: str = "", criteria: str = "", hold_point: bool = False) -> dict:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", ref or ""):
            raise ValueError("ref must be a short name of letters, digits and underscores")
        if ref in self.steps:
            raise ValueError(f"{ref} already exists")
        if not any(s["id"] == section for s in self.sections):
            raise ValueError(f"no section {section}. Sections: {', '.join(s['id'] for s in self.sections)}")
        if kind not in PREFIX:
            raise ValueError("kind must be operation, inspection or handling")
        if not (procedure or "").strip():
            raise ValueError("write the procedure a foreman would follow")
        if norm_id:
            norm = N.NORMS.get(norm_id)
            if not norm:
                raise ValueError(f"no norm {norm_id}")
            quantity = self.quantities.get(quantity_id)
            if not quantity:
                raise ValueError(f"no quantity {quantity_id}. Quantities: {', '.join(self.quantities) or 'none yet'}")
            if quantity["unit"] != norm["unit"]:
                raise ValueError(f"{quantity_id} is in {quantity['unit']}, and {norm_id} needs {norm['unit']}")
            if share_pct <= 0:
                raise ValueError("share_pct must be this step's share of the norm's labour, above 0")
            bad = [m for m in (uses or []) if m not in norm["materials"]]
            if bad:
                raise ValueError(f"{norm_id} has no material {', '.join(bad)}. It has: {', '.join(norm['materials'])}")
        section_by = next(s.get("by", "") for s in self.sections if s["id"] == section)
        self.steps[ref] = {"ref": ref, "section": section, "kind": kind, "name": name, "after": list(after or []), "procedure": procedure.strip(), "evidence": evidence or [], "agent": agent, "norm": norm_id, "quantity": quantity_id, "share": float(share_pct),
                           "uses": list(uses or []), "by": by or section_by, "crew": crew or [], "hours": float(hours or 0), "wait_days": float(wait_days or 0), "with_previous": bool(with_previous), "itp": itp, "criteria": criteria, "hold_point": bool(hold_point), "crew_size": None}
        return self.steps[ref]

    def insert(self, ref: str, before: list[str]) -> None:
        """Puts a step in front of others: they now wait for it instead of for what it waits for."""
        step = self.steps[ref]
        for name in before or []:
            other = self.steps[self._ref(name)]
            other["after"] = [x for x in other["after"] if x not in step["after"] and self.ids.get(x, x) not in step["after"]] + [ref]

    def link(self, name: str, after: list[str]) -> dict:
        step = self.steps[self._ref(name)]
        for a in after:
            self._ref(a)
        step["after"] = [self._ref(a) for a in after]
        return step

    def remove(self, name: str) -> None:
        ref = self._ref(name)
        gone = self.steps.pop(ref)
        for s in self.steps.values():
            if ref in s["after"]:
                s["after"] = [x for x in s["after"] if x != ref] + [x for x in gone["after"] if x not in s["after"]]

    def assign_crew(self, name: str, crew_size: int, by: str = "") -> dict:
        step = self.steps[self._ref(name)]
        if int(crew_size) < 1:
            raise ValueError("a crew has at least one person")
        step["crew_size"] = int(crew_size)
        if by:
            step["by"] = by
        return step

    def flag_waste(self, name: str, kind: str, note: str, saving_expression: str, evidence: list[str], agent: str) -> dict:
        if kind not in ("material", "handling", "inspection", "waiting"):
            raise ValueError("kind must be material, handling, inspection or waiting")
        step = self.steps[self._ref(name)]
        saving = round(evaluate(saving_expression)[0]) if saving_expression else 0
        flag = {"step": step["ref"], "kind": kind, "note": note, "saving_rp": saving, "saving_expression": saving_expression, "evidence": evidence, "agent": agent}
        self.waste_flags.append(flag)
        return flag

    def _order(self) -> tuple[list[str], list[str]]:
        """Steps in the order they can happen, and any stuck in a loop. Ties go by section, then as they were added."""
        place = {s["id"]: i for i, s in enumerate(self.sections)}
        made = {r: i for i, r in enumerate(self.steps)}
        waits = {r: {a for a in s["after"] if a in self.steps} for r, s in self.steps.items()}
        order: list[str] = []
        while True:
            ready = sorted((r for r, w in waits.items() if not w and r not in order), key=lambda r: (place.get(self.steps[r]["section"], 99), made[r]))
            if not ready:
                break
            order.append(ready[0])
            for w in waits.values():
                w.discard(ready[0])
        return order, [r for r in self.steps if r not in order]

    def number(self) -> None:
        """Final ids, O-1, I-1 and H-1, in the order the work happens."""
        order, stuck = self._order()
        counts: dict[str, int] = {}
        self.ids = {}
        for r in order + stuck:
            p = PREFIX[self.steps[r]["kind"]]
            counts[p] = counts.get(p, 0) + 1
            self.ids[f"{p}-{counts[p]}"] = r

    def plan(self) -> dict:
        """The breakdown with every figure worked out."""
        order, stuck = self._order()
        ref_id = {r: i for i, r in self.ids.items()}
        id_of = lambda r: ref_id.get(r, r)  # noqa: E731
        notes = list(self.notes)
        groups: dict[tuple[str, str], list[str]] = {}
        for r, s in self.steps.items():
            if s["norm"]:
                groups.setdefault((s["norm"], s["quantity"]), []).append(r)
        weights: dict[str, float] = {}
        owner: dict[tuple[str, str, str], str] = {}
        for (norm_id, qid), refs in groups.items():
            total = sum(self.steps[r]["share"] for r in refs)
            if abs(total - 100) > 0.5:
                notes.append(f"The labour shares on {norm_id} added to {total:g}%, so code scaled them to 100%.")
            for r in refs:
                weights[r] = self.steps[r]["share"] / total
            for r in refs:  # each material belongs to one step: the first to claim it, or else the step with the most of the work
                for m in self.steps[r]["uses"]:
                    if (norm_id, qid, m) in owner:
                        notes.append(f"{id_of(r)} also claimed {m} on {norm_id}: it stays with {id_of(owner[(norm_id, qid, m)])}.")
                    else:
                        owner[(norm_id, qid, m)] = r
            for m in N.NORMS[norm_id]["materials"]:
                if (norm_id, qid, m) not in owner:
                    owner[(norm_id, qid, m)] = max(refs, key=lambda r: weights[r])
                    notes.append(f"No step claimed {N.NORMS[norm_id]['materials'][m]['name']} on {norm_id}, so code gave it to {id_of(owner[(norm_id, qid, m)])}.")
        wage = lambda role: self.rates["labour"].get(role) or self.rates["labour"].get("Tukang" if role.startswith("Tukang") else "Pekerja", 0)  # noqa: E731
        rows: dict[str, dict] = {}
        for r in order + stuck:
            s = self.steps[r]
            labour, materials = [], []
            if s["norm"]:
                norm, q = N.NORMS[s["norm"]], self.quantities[s["quantity"]]
                units = q["value"] / norm["per"]
                labour = [{"role": role, "oh": units * coef * weights[r], "supervises": role in N.SUPERVISORS} for role, coef in norm["labour"].items()]
                for key, m in norm["materials"].items():
                    if owner.get((s["norm"], s["quantity"], key)) != r:
                        continue
                    raw = units * m["qty"]
                    net, gross = (raw / (1 + m["waste_pct"] / 100), raw) if m["built_in"] else (raw, raw * (1 + m["waste_pct"] / 100))
                    rate = self.rates["materials"].get(key, 0)
                    materials.append({"key": key, "name": m["name"], "unit": m["unit"], "net": net, "waste_pct": m["waste_pct"], "waste": gross - net, "gross": gross, "rate": rate, "cost": gross * rate, "waste_cost": (gross - net) * rate, "basis": m["basis"]})
            else:
                labour = [{"role": c["role"], "oh": c["count"] * s["hours"] / N.HOURS_PER_OH, "supervises": False} for c in s["crew"]]
            hands = sum(x["oh"] for x in labour if not x["supervises"])
            if s["norm"]:
                size = s["crew_size"] or max(2, math.ceil(hands))
                hours = hands * N.HOURS_PER_OH / size
                crew = split_crew(size, {x["role"]: x["oh"] for x in labour if not x["supervises"]})
            else:
                crew, hours = list(s["crew"]), s["hours"]
                size = s["crew_size"] or sum(c["count"] for c in crew)
            man_hours = sum(x["oh"] for x in labour) * N.HOURS_PER_OH
            rows[r] = {"id": id_of(r), "ref": r, "seq": 0, "section": s["section"], "kind": s["kind"], "name": s["name"], "after": [id_of(a) for a in s["after"] if a in self.steps], "procedure": s["procedure"], "evidence": s["evidence"], "by": s["by"], "agent": s["agent"],
                       "basis": f"SNI 7394:2008 {N.NORMS[s['norm']]['section']}" if s["norm"] else "agent's estimate", "norm": s["norm"], "quantity": s["quantity"], "share_pct": round(weights.get(r, 0) * 100, 1), "labour": [{**x, "oh": round(x["oh"], 2), "man_hours": round(x["oh"] * N.HOURS_PER_OH, 1), "cost": round(x["oh"] * wage(x["role"]))} for x in labour],
                       "crew": crew, "crew_size": size, "hours": round(hours, 1), "man_hours": round(man_hours, 1), "labour_cost": round(sum(x["oh"] * wage(x["role"]) for x in labour)),
                       "materials": [{**m, **{k: round(m[k], 3) for k in ("net", "waste", "gross")}, "cost": round(m["cost"]), "waste_cost": round(m["waste_cost"])} for m in materials], "material_cost": round(sum(m["cost"] for m in materials)), "waste_cost": round(sum(m["waste_cost"] for m in materials)),
                       "wait_days": s["wait_days"], "with_previous": s["with_previous"], "itp": s["itp"], "criteria": s["criteria"], "hold_point": s["hold_point"]}
        for i, r in enumerate(order + stuck):
            rows[r]["seq"] = i + 1
        after_of = {r: [a for a in self.steps[r]["after"] if a in self.steps] for r in self.steps}
        for r in order:
            starts = [rows[a]["start_h"] if self.steps[r]["with_previous"] else rows[a]["finish_h"] + rows[a]["wait_days"] * N.HOURS_PER_OH for a in after_of[r]]
            rows[r]["start_h"] = round(max(starts, default=0.0), 2)
            rows[r]["finish_h"] = round(rows[r]["start_h"] + rows[r]["hours"], 2)
        for r in stuck:
            rows[r]["start_h"], rows[r]["finish_h"] = 0.0, rows[r]["hours"]
        end = max((x["finish_h"] for x in rows.values()), default=0.0)
        latest: dict[str, float] = {}
        for r in reversed(order):  # a feeder runs as late as it can: concrete is batched just before the pour, and nothing waits in stock
            followers = [x for x in self.steps if r in after_of[x] and x in latest]
            latest[r] = min((latest[f] if self.steps[f]["with_previous"] else latest[f] - rows[r]["wait_days"] * N.HOURS_PER_OH - rows[r]["hours"] for f in followers), default=end - rows[r]["hours"])
            rows[r]["critical"] = latest[r] - rows[r]["start_h"] < 0.01
            rows[r]["start_h"] = max(0.0, round(latest[r], 2))
            rows[r]["finish_h"] = round(rows[r]["start_h"] + rows[r]["hours"], 2)
        for r in stuck:
            rows[r]["critical"] = False
        days = end / N.HOURS_PER_OH
        # the crew on site: the most people there at one moment, day by day, not everyone who worked that day
        working = [x for x in rows.values() if x["hours"] > 0]
        by_day: list[dict] = []
        for d in range(math.ceil(days - 1e-9) if rows else 0):
            lo, hi = d * N.HOURS_PER_OH, (d + 1) * N.HOURS_PER_OH
            per: dict[str, int] = {}
            most = 0
            for t in sorted({lo, *(x["start_h"] for x in working if lo <= x["start_h"] < hi)}):
                here: dict[str, int] = {}
                for x in working:
                    if x["start_h"] <= t < x["finish_h"]:
                        here[x["by"]] = here.get(x["by"], 0) + x["crew_size"]
                for who, n in here.items():
                    per[who] = max(per.get(who, 0), n)
                most = max(most, sum(here.values()))
            by_day.append({"day": d + 1, "crew": per, "total": most})
        peak = {who: max((d["crew"].get(who, 0) for d in by_day), default=0) for who in {x["by"] for x in rows.values()}}
        peak_total = max((d["total"] for d in by_day), default=0)
        materials: dict[str, dict] = {}
        for x in rows.values():
            for m in x["materials"]:
                t = materials.setdefault(m["key"], {"key": m["key"], "name": m["name"], "unit": m["unit"], "net": 0.0, "waste": 0.0, "gross": 0.0, "rate": m["rate"], "cost": 0, "waste_cost": 0, "waste_pct": m["waste_pct"], "basis": m["basis"], "steps": []})
                for k in ("net", "waste", "gross", "cost", "waste_cost"):
                    t[k] += m[k]
                t["steps"].append(x["id"])
        trades: dict[str, dict] = {}
        for x in rows.values():
            for w in x["labour"]:
                t = trades.setdefault(w["role"], {"role": w["role"], "oh": 0.0, "man_hours": 0.0, "cost": 0, "supervises": w["supervises"]})
                t["oh"] += w["oh"]
                t["man_hours"] += w["man_hours"]
                t["cost"] += w["cost"]
        quantities = []
        for q in self.quantities.values():
            b = next((b for b in self.boq if b["id"] == q["boq_item"]), None)
            diff = round((q["value"] - b["qty"]) / b["qty"] * 100, 1) if b and b["qty"] else None
            quantities.append({**q, "boq_qty": b["qty"] if b else None, "boq_diff_pct": diff, "boq_rate": b["rate"] if b else None, "boq_exposure_rp": round((q["value"] - b["qty"]) * b["rate"]) if b else 0})
        labour_cost = sum(x["labour_cost"] for x in rows.values())
        material_cost = sum(x["material_cost"] for x in rows.values())
        waste_cost = sum(x["waste_cost"] for x in rows.values())
        boq_value = round(sum(b["qty"] * b["rate"] for b in self.boq))
        totals = {"steps": len(rows), "operations": sum(1 for x in rows.values() if x["kind"] == "operation"), "inspections": sum(1 for x in rows.values() if x["kind"] == "inspection"), "handling": sum(1 for x in rows.values() if x["kind"] == "handling"),
                  "man_hours": round(sum(x["man_hours"] for x in rows.values()), 1), "oh": round(sum(t["oh"] for t in trades.values()), 1), "labour_cost": labour_cost, "material_cost": material_cost, "waste_cost": waste_cost, "cost": labour_cost + material_cost, "boq_value": boq_value, "margin": boq_value - labour_cost - material_cost,
                  "days": round(days, 1), "window_days": self.window_days, "peak_crew": peak_total, "peak_by": peak, "crews": self.crews, "programme_crew": self.programme_crew, "wait_days": sum(x["wait_days"] for x in rows.values()), "hours_per_oh": N.HOURS_PER_OH}
        steps = sorted(rows.values(), key=lambda x: x["seq"])
        tree = code_tasks(steps, self.sections, self.activities, self.heads)
        plan = {"title": self.title, "activities": self.activities, "sections": self.sections, "tree": tree, "steps": steps, "quantities": quantities, "materials": [{**m, **{k: round(m[k], 3) for k in ("net", "waste", "gross")}} for m in materials.values()],
                "workforce": [{**t, "oh": round(t["oh"], 1), "man_hours": round(t["man_hours"], 1)} for t in trades.values()], "crew_by_day": by_day, "totals": totals, "notes": notes, "waste_flags": [{**f, "step": id_of(f["step"])} for f in self.waste_flags], "source": N.SOURCE}
        plan["checks"] = self.checks(plan, stuck)
        return plan

    def checks(self, plan: dict, stuck: list[str]) -> list[dict]:
        """What code can say about the breakdown: each one a fact for a person to read, not a refusal."""
        steps, t = plan["steps"], plan["totals"]
        out: list[dict] = []

        def add(rule: str, ok: bool, text: str) -> None:
            out.append({"rule": rule, "ok": bool(ok), "text": text})

        dangling = [(s["ref"], a) for s in self.steps.values() for s_a in [s["after"]] for a in s_a if a not in self.steps]
        add("links", not dangling, "Every link points at a real step." if not dangling else f"Links to steps that do not exist: {', '.join(f'{r} after {a}' for r, a in dangling)}.")
        leads_on = {a for s in steps for a in s["after"]}
        sinks = [s["id"] for s in steps if s["id"] not in leads_on]
        add("one_end", not stuck and len(sinks) == 1, f"The tasks have no loops and end in one task, {sinks[0]}." if not stuck and len(sinks) == 1 else f"The tasks must end in one task with no loops. They end in: {', '.join(sinks) or 'nothing'}{'; in a loop: ' + ', '.join(stuck) if stuck else ''}.")
        used = {s["quantity"] for s in steps if s["quantity"]}
        idle = [q["id"] for q in plan["quantities"] if q["id"] not in used]
        add("quantities_used", not idle, "Every quantity is used by a step." if not idle else f"Quantities no step uses: {', '.join(idle)}.")
        bare = [s["id"] for s in steps if not s["procedure"] or not s["evidence"]]
        add("procedures", not bare, "Every step has a procedure and cites its source." if not bare else f"Steps without a procedure or a source: {', '.join(bare)}.")
        guessed = [s["id"] for s in steps if s["kind"] == "operation" and not s["norm"] and s["man_hours"]]
        add("norms", not guessed, "Every operation's workforce comes from the standard." if not guessed else f"These operations use an agent's estimate, not the standard: {', '.join(guessed)}.")
        missing = [i for i in self.itp_ids if not any(s["itp"] == i for s in steps)]
        add("itp", not missing, "Every item in the inspection plan is in the WBS." if not missing else f"Inspection plan items not in the WBS: {', '.join(missing)}.")
        late = [s["id"] for s in steps if s["kind"] == "inspection" and s["id"] in sinks and not s["wait_days"]]
        add("inspect_before", not late, "Inspections come before the work they protect." if not late else f"These inspections have nothing after them, so they cannot stop anything: {', '.join(late)}.")
        for q in plan["quantities"]:
            if q["boq_qty"]:
                ok = abs(q["boq_diff_pct"]) <= TOLERANCE
                add(f"boq_{q['id']}", ok, f"{q['element']} agrees with the BoQ: {q['value']:,.1f} against {q['boq_qty']:,} {q['unit']}." if ok else f"{q['element']} is {q['boq_diff_pct']:+}% against the BoQ: {q['value']:,.1f} against {q['boq_qty']:,} {q['unit']}, about Rp {q['boq_exposure_rp']:,} at the BoQ rate.")
        fits = not t["window_days"] or t["days"] <= t["window_days"]
        add("time", fits, f"The plan takes {t['days']} working days against {t['window_days']} in the programme." if fits else f"The plan takes {t['days']} working days and the programme gives {t['window_days']}. More crew, or a change of sequence, is needed.")
        over = [f"{who} {n} of {self.crews[who]}" for who, n in t["peak_by"].items() if who in self.crews and n > self.crews[who]]
        add("crew", not over, "The peak crew fits what each subcontractor has." if not over else f"The peak crew is more than the subcontractor has: {', '.join(over)}.")
        if self.programme_crew:
            add("programme_crew", t["peak_crew"] <= self.programme_crew, f"The peak of {t['peak_crew']} workers fits the {self.programme_crew} the programme allows." if t["peak_crew"] <= self.programme_crew else f"The plan needs a peak of {t['peak_crew']} workers a day, and the programme allows {self.programme_crew}.")
        add("margin", t["margin"] >= 0, f"The planned cost is within the BoQ value, with Rp {t['margin']:,} left." if t["margin"] >= 0 else f"The planned cost is Rp {-t['margin']:,} above the BoQ value.")
        return out


def procedure_markdown(rec: dict) -> str:
    """The plan as a site document: code lays it out from the figures, so the document cannot disagree with the WBS."""
    plan, sections = rec["plan"], {s["id"]: s for s in rec["plan"]["sections"]}
    t = plan["totals"]
    lines = [f"# Work plan: {plan['title']}", "", f"Status: {rec['status']}. Activities {', '.join(plan['activities'])}. Workforce and material per SNI 7394:2008; a working day is {t['hours_per_oh']} hours.", "",
             f"**{t['operations']} operations, {t['inspections']} inspections, {t['handling']} handling steps. {t['man_hours']:,} man-hours over {t['days']} working days. Peak crew {t['peak_crew']}. Planned cost Rp {t['cost']:,}, of which material waste Rp {t['waste_cost']:,}.**", "", "## Procedure", ""]
    for s in plan["steps"]:
        lines.append(f"### {s['id']} {s['name']}")
        lines.append(f"*WBS {s.get('code', '')}. {sections.get(s['section'], {}).get('name', s['section'])}. By {s['by'] or 'to be assigned'}. Source: {', '.join(s['evidence']) or 'none'}. Basis: {s['basis']}.*")
        lines.append("")
        lines.append(s["procedure"])
        if s["kind"] == "inspection":
            lines.append(f"\nInspection {s['itp'] or ''}{' (hold point: work stops until signed)' if s['hold_point'] else ''}. Criteria: {s['criteria'] or 'see the source'}.")
        crew = ", ".join(f"{c['count']} {c['role']}" for c in s["crew"]) or "none"
        lines.append(f"\n- Workforce: {crew}. {s['hours']} hours, {s['man_hours']} man-hours.")
        for m in s["materials"]:
            lines.append(f"- Material: {m['name']}: {m['net']:,.2f} {m['unit']} net + {m['waste']:,.2f} waste ({m['waste_pct']}%) = {m['gross']:,.2f} {m['unit']}.")
        if s["wait_days"]:
            lines.append(f"- Then wait {s['wait_days']:g} days.")
        lines.append("")
    lines += ["## Material and waste", "", "| Material | Net | Waste | To order | Cost (Rp) | Waste (Rp) |", "|---|---|---|---|---|---|"]
    for m in plan["materials"]:
        lines.append(f"| {m['name']} | {m['net']:,.2f} {m['unit']} | {m['waste']:,.2f} ({m['waste_pct']}%) | {m['gross']:,.2f} | {m['cost']:,} | {m['waste_cost']:,} |")
    lines += ["", "## Workforce", "", "| Trade | OH | Man-hours | Cost (Rp) |", "|---|---|---|---|"]
    for w in plan["workforce"]:
        lines.append(f"| {w['role']} | {w['oh']} | {w['man_hours']} | {w['cost']:,} |")
    return "\n".join(lines) + "\n"


def table_csv(rec: dict) -> str:
    """One row per step and material, for a spreadsheet."""
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["wbs", "step", "name", "kind", "section", "by", "crew", "hours", "man_hours", "labour_cost_rp", "material", "unit", "net", "waste_pct", "waste", "to_order", "material_cost_rp", "waste_cost_rp", "basis"])
    for s in rec["plan"]["steps"]:
        crew = "; ".join(f"{c['count']} {c['role']}" for c in s["crew"])
        head = [s.get("code", ""), s["id"], s["name"], s["kind"], s["section"], s["by"], crew, s["hours"], s["man_hours"], s["labour_cost"]]
        if not s["materials"]:
            w.writerow([*head, "", "", "", "", "", "", "", "", s["basis"]])
        for m in s["materials"]:
            w.writerow([*head, m["name"], m["unit"], m["net"], m["waste_pct"], m["waste"], m["gross"], m["cost"], m["waste_cost"], s["basis"]])
    return out.getvalue()

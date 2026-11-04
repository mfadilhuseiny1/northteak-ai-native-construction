"""Offline tests of the main job: a consultant's planning documents into a WBS, with the workforce, material and waste of every step. No model is called. They prove the arithmetic, the rules and the wiring, not how well a real model plans."""

from __future__ import annotations

import asyncio
import shutil
import time

import pytest
from fastapi.testclient import TestClient

from swarm import firm, firm_api, norms as N, planner, planning_case as PC, project as P, wbs


def _close() -> None:
    if P._conn is not None:
        P._conn.close()
        P._conn = None


@pytest.fixture(scope="session")
def template(tmp_path_factory):
    saved, P.DB = P.DB, tmp_path_factory.mktemp("records") / "seed.db"
    P._db()
    path = P.DB
    _close()
    P.DB = saved
    return path


@pytest.fixture(scope="session")
def review(template, tmp_path_factory):
    """The scripted planning review, finished once."""
    saved, P.DB = P.DB, tmp_path_factory.mktemp("review") / "project.db"
    shutil.copy(template, P.DB)
    events: list[dict] = []

    async def go():
        firm._emit.set(events.append)
        f = planner.PlanningFirm(firm_api.model_of("mock", "plan"), 5, PC.BRIEF, mock=True)
        await f.engagement()
        return f

    delay, firm_api.MOCK_DELAY = firm_api.MOCK_DELAY, 0
    f = asyncio.run(go())
    firm_api.MOCK_DELAY = delay
    _close()
    P.DB = saved
    return f, events


@pytest.fixture(autouse=True)
def records(template, tmp_path, monkeypatch):
    path = tmp_path / "project.db"
    shutil.copy(template, path)
    monkeypatch.setattr(P, "DB", path)
    yield path
    _close()


def step(f, name: str) -> dict:
    return next(s for s in f.result["steps"] if s["name"].startswith(name))


def breakdown(rates=None, crews=None, itp=None) -> wbs.Breakdown:
    return wbs.Breakdown("Test", ["A50"], [{"id": "a", "name": "A", "by": "besi"}, {"id": "b", "name": "B", "by": "self"}], rates or PC.RATES, PC.BOQ, 7, crews or {"besi": 16, "self": 30}, itp or [], 14)


# ------------------------------------------------------------------------------------------------ the standard


def test_the_norms_are_the_standards_own_figures():
    """Checked by hand against SNI 7394:2008. A change here must come from the standard."""
    rebar = N.NORMS["SNI-6.17"]
    assert (rebar["per"], rebar["unit"]) == (10, "kg")
    assert rebar["labour"] == {"Pekerja": 0.07, "Tukang besi": 0.07, "Kepala tukang": 0.007, "Mandor": 0.004}
    assert rebar["materials"]["rebar"]["qty"] == 10.5 and rebar["materials"]["tie_wire"]["qty"] == 0.15
    form = N.NORMS["SNI-6.22"]
    assert form["labour"] == {"Pekerja": 0.66, "Tukang kayu": 0.33, "Kepala tukang": 0.033, "Mandor": 0.033}
    assert {k: v["qty"] for k, v in form["materials"].items()} == {"plywood": 0.35, "timber_iii": 0.04, "timber_ii": 0.015, "nails": 0.4, "form_oil": 0.2, "props": 2}
    assert N.NORMS["SNI-6.24"]["materials"]["props"]["qty"] == 6 and N.NORMS["SNI-6.23"]["materials"]["timber_ii"]["qty"] == 0.018
    k300 = N.NORMS["SNI-6.10"]
    assert k300["labour"] == {"Pekerja": 1.65, "Tukang batu": 0.275, "Kepala tukang": 0.028, "Mandor": 0.083}
    assert {k: v["qty"] for k, v in k300["materials"].items()} == {"cement": 413, "sand": 681, "gravel": 1021, "water": 215}
    k350 = N.NORMS["SNI-6.12"]
    assert k350["labour"]["Pekerja"] == 2.1 and k350["materials"]["cement"]["qty"] == 448


def test_rebar_waste_is_what_the_standard_allows_and_unstated_waste_is_not_invented():
    rebar = N.NORMS["SNI-6.17"]["materials"]
    assert rebar["rebar"]["waste_pct"] == 5.0
    assert rebar["tie_wire"]["waste_pct"] == 0 and rebar["tie_wire"]["basis"] == N.NONE_STATED
    assert N.NORMS["SNI-6.22"]["materials"]["nails"]["waste_pct"] == 0


# ------------------------------------------------------------------------------------------------ the sums an agent writes


@pytest.mark.parametrize("text,value", [("12*0.6*0.6*3.6", 15.552), ("12*4*0.6*3.6", 103.68), ("(1+2)*3", 9), ("10/4", 2.5), ("-2+5", 3), ("3,600/1000", 3.6), ("2×3", 6)])
def test_a_sum_is_worked_out_by_code(text, value):
    assert wbs.evaluate(text)[0] == pytest.approx(value)


@pytest.mark.parametrize("text", ["__import__('os').system('x')", "open('.env')", "2**99", "1/0", "a+1", "", "1;2", "[1,2]", "1" * 301])
def test_anything_but_a_plain_sum_is_refused(text):
    with pytest.raises(ValueError):
        wbs.evaluate(text)


def test_a_figure_the_agent_did_not_read_is_refused_but_units_and_geometry_are_fine():
    known = wbs.figures_in("C1: 12 columns, 600 x 600 mm, height 3,600 mm")
    c = breakdown()
    assert c.add_quantity("Q", "Concrete", "m3", "12*0.6*0.6*3.6", known, "", ["X"], "a")["value"] == 15.552
    assert c.add_quantity("Q2", "Form", "m2", "12*4*0.6*3.6", known, "", ["X"], "a")["value"] == 103.68
    with pytest.raises(ValueError, match="77"):
        c.add_quantity("Q3", "Made up", "m3", "12*77", known, "", ["X"], "a")
    with pytest.raises(ValueError, match="more than zero"):
        c.add_quantity("Q4", "Nothing", "m3", "12-12", known, "", ["X"], "a")
    with pytest.raises(ValueError, match="no BoQ item"):
        c.add_quantity("Q5", "Concrete", "m3", "12*0.6", known, "L9-99", ["X"], "a")


# ------------------------------------------------------------------------------------------------ the calculator


def built() -> wbs.Breakdown:
    """One norm over two steps, worked out here by hand in the test below."""
    c = breakdown()
    c.add_quantity("Q", "Rebar", "kg", "1000", {1000.0}, "L4-03", ["X"], "a")
    c.add_step("cut", "a", "operation", "Cut", [], "How.", ["X"], "a", "SNI-6.17", "Q", 25, ["rebar"])
    c.add_step("tie", "a", "operation", "Tie", ["cut"], "How.", ["X"], "a", "SNI-6.17", "Q", 75, ["tie_wire"])
    c.assign_crew("cut", 2)
    c.assign_crew("tie", 3)
    c.number()
    return c


def test_workforce_material_and_waste_are_the_standard_times_the_quantity():
    p = built().plan()
    cut, tie = p["steps"]
    assert (cut["id"], tie["id"]) == ("O-1", "O-2")
    # 1000 kg is 100 units of the norm. Cut takes 25% of its labour.
    by_role = {w["role"]: w["oh"] for w in cut["labour"]}
    assert by_role == {"Pekerja": pytest.approx(1.75), "Tukang besi": pytest.approx(1.75), "Kepala tukang": pytest.approx(0.18), "Mandor": pytest.approx(0.1)}
    # hands 3.5 OH x 7 hours / 2 people
    assert cut["hours"] == pytest.approx(12.25, abs=0.06)
    assert cut["crew"] == [{"role": "Pekerja", "count": 1}, {"role": "Tukang besi", "count": 1}]
    rebar = cut["materials"][0]
    assert rebar["gross"] == pytest.approx(1050) and rebar["net"] == pytest.approx(1000) and rebar["waste"] == pytest.approx(50)
    assert rebar["cost"] == 1050 * 14_000 and rebar["waste_cost"] == 50 * 14_000
    wire = tie["materials"][0]
    assert wire["gross"] == pytest.approx(15) and wire["waste"] == 0
    assert p["totals"]["man_hours"] == pytest.approx(1000 / 10 * 0.151 * 7, abs=0.2)
    assert p["totals"]["waste_cost"] == 700_000


def test_shares_are_scaled_so_totals_stay_those_of_the_standard_and_it_says_so():
    c = built()
    c.steps["cut"]["share"], c.steps["tie"]["share"] = 10, 30
    p = c.plan()
    assert [s["share_pct"] for s in p["steps"]] == [25.0, 75.0]
    assert p["totals"]["man_hours"] == pytest.approx(105.7, abs=0.2)
    assert any("scaled" in n for n in p["notes"])


def test_every_material_lands_on_exactly_one_step_whatever_the_agents_claim():
    c = breakdown()
    c.add_quantity("Q", "Rebar", "kg", "1000", {1000.0}, "", ["X"], "a")
    c.add_step("one", "a", "operation", "One", [], "How.", ["X"], "a", "SNI-6.17", "Q", 40, ["rebar"])
    c.add_step("two", "a", "operation", "Two", ["one"], "How.", ["X"], "a", "SNI-6.17", "Q", 60, ["rebar"])
    c.number()
    p = c.plan()
    assert sum(m["gross"] for s in p["steps"] for m in s["materials"] if m["key"] == "rebar") == pytest.approx(1050)
    assert sum(m["gross"] for s in p["steps"] for m in s["materials"] if m["key"] == "tie_wire") == pytest.approx(15), "no step claimed it, so code places it"
    assert any("also claimed" in n for n in p["notes"]) and any("No step claimed" in n for n in p["notes"])


def test_a_feeder_runs_as_late_as_it_can_so_nothing_waits_in_stock():
    c = breakdown()
    c.add_step("long", "b", "operation", "Long", [], "How.", ["X"], "a", crew=[{"role": "Pekerja", "count": 2}], hours=14)
    c.add_step("short", "a", "operation", "Short", [], "How.", ["X"], "a", crew=[{"role": "Pekerja", "count": 2}], hours=2)
    c.add_step("end", "b", "operation", "End", ["long", "short"], "How.", ["X"], "a", crew=[{"role": "Pekerja", "count": 2}], hours=1)
    c.number()
    rows = {s["ref"]: s for s in c.plan()["steps"]}
    assert rows["short"]["start_h"] == 12 and rows["short"]["finish_h"] == rows["end"]["start_h"]
    assert rows["long"]["critical"] and rows["end"]["critical"] and not rows["short"]["critical"]


def test_the_crew_peak_is_people_there_at_one_moment_not_everyone_that_day():
    c = breakdown()
    c.add_step("first", "a", "handling", "First", [], "How.", ["X"], "a", crew=[{"role": "Pekerja", "count": 10}], hours=3)
    c.add_step("second", "a", "handling", "Second", ["first"], "How.", ["X"], "a", crew=[{"role": "Pekerja", "count": 12}], hours=3)
    c.number()
    t = c.plan()["totals"]
    assert t["peak_by"]["besi"] == 12 and t["peak_crew"] == 12


@pytest.mark.parametrize("size,oh,expected", [(7, {"Pekerja": 1, "Tukang": 1}, 7), (1, {"Pekerja": 1, "Tukang": 1}, 1), (22, {"Pekerja": 0.66, "Tukang kayu": 0.33}, 22), (5, {"Pekerja": 1.65, "Tukang batu": 0.275}, 5)])
def test_a_crew_always_adds_up(size, oh, expected):
    assert sum(c["count"] for c in wbs.split_crew(size, oh)) == expected


def test_a_step_is_refused_with_a_reason():
    c = breakdown()
    c.add_quantity("Q", "Rebar", "kg", "1000", {1000.0}, "", ["X"], "a")
    good = {"section": "a", "kind": "operation", "name": "N", "after": [], "procedure": "How.", "evidence": ["X"], "agent": "a"}
    with pytest.raises(ValueError, match="no section"):
        c.add_step("x", **{**good, "section": "zz"})
    with pytest.raises(ValueError, match="procedure"):
        c.add_step("x", **{**good, "procedure": " "})
    with pytest.raises(ValueError, match="no norm"):
        c.add_step("x", **good, norm_id="SNI-9", quantity_id="Q", share_pct=10)
    with pytest.raises(ValueError, match="no quantity"):
        c.add_step("x", **good, norm_id="SNI-6.17", quantity_id="NO", share_pct=10)
    with pytest.raises(ValueError, match="share_pct"):
        c.add_step("x", **good, norm_id="SNI-6.17", quantity_id="Q", share_pct=0)
    with pytest.raises(ValueError, match="no material"):
        c.add_step("x", **good, norm_id="SNI-6.17", quantity_id="Q", share_pct=10, uses=["plywood"])
    c.add_quantity("V", "Concrete", "m3", "5", set(), "", ["X"], "a")
    with pytest.raises(ValueError, match="needs kg"):
        c.add_step("x", **good, norm_id="SNI-6.17", quantity_id="V", share_pct=10)
    c.add_step("x", **good)
    with pytest.raises(ValueError, match="already exists"):
        c.add_step("x", **good)


def test_inserting_a_step_makes_what_followed_wait_for_it():
    c = breakdown()
    for ref, after in (("a1", []), ("a2", ["a1"])):
        c.add_step(ref, "a", "operation", ref, after, "How.", ["X"], "a")
    c.add_step("check", "a", "inspection", "Check", ["a1"], "How.", ["X"], "a")
    c.insert("check", ["a2"])
    assert c.steps["a2"]["after"] == ["check"]


def test_removing_a_step_keeps_the_chain_whole():
    c = breakdown()
    for ref, after in (("a1", []), ("a2", ["a1"]), ("a3", ["a2"])):
        c.add_step(ref, "a", "operation", ref, after, "How.", ["X"], "a")
    c.remove("a2")
    assert c.steps["a3"]["after"] == ["a1"]


def test_checks_catch_a_broken_breakdown():
    c = breakdown(itp=["HP-1"])
    c.add_step("a1", "a", "operation", "One", ["ghost"], "How.", ["X"], "a")
    c.add_step("a2", "a", "operation", "Two", [], "How.", [], "a")
    c.add_step("a3", "a", "inspection", "Look", ["a2"], "How.", ["X"], "a")
    c.number()
    checks = {x["rule"]: x for x in c.plan()["checks"]}
    assert not checks["links"]["ok"] and "ghost" in checks["links"]["text"]
    assert not checks["one_end"]["ok"]
    assert not checks["procedures"]["ok"]
    assert not checks["itp"]["ok"] and "HP-1" in checks["itp"]["text"]
    assert not checks["inspect_before"]["ok"], "an inspection with nothing after it cannot stop anything"


def test_a_loop_is_reported_and_does_not_hang():
    c = breakdown()
    c.add_step("a1", "a", "operation", "One", ["a2"], "How.", ["X"], "a")
    c.add_step("a2", "a", "operation", "Two", ["a1"], "How.", ["X"], "a")
    c.number()
    assert not next(x for x in c.plan()["checks"] if x["rule"] == "one_end")["ok"]


# ------------------------------------------------------------------------------------------------ the scripted review


def test_the_scripted_review_builds_the_breakdown_without_errors(review):
    f, events = review
    assert not [e for e in events if e["type"] == "error"]
    t = f.result["totals"]
    assert (t["operations"], t["inspections"], t["handling"]) == (11, 4, 3)
    assert all(s["procedure"] and s["evidence"] for s in f.result["steps"])
    assert f.result["steps"][0]["id"] == "O-1"


def test_the_tasks_link_the_way_the_work_happens(review):
    f = review[0]
    checks = {c["rule"]: c for c in f.result["checks"]}
    assert checks["one_end"]["ok"] and checks["links"]["ok"] and checks["itp"]["ok"] and checks["inspect_before"]["ok"] and checks["quantities_used"]["ok"]
    assert checks["norms"]["ok"]
    by_id = {s["id"]: s for s in f.result["steps"]}
    pour = step(f, "Pour concrete")
    assert len(pour["after"]) == 2, "formwork and concrete merge here"
    hold = step(f, "Inspect rebar")
    assert hold["hold_point"] and hold["itp"] == "HP-21"
    assert hold["id"] in step(f, "Position and brace")["after"], "the cage is inspected before the forms close"
    assert step(f, "Perform slump")["id"] in by_id[[a for a in pour["after"] if a.startswith("H")][0]]["after"], "slump is tested before the concrete goes up"


def test_quantities_come_from_the_drawing_in_force(review):
    q = {x["id"]: x for x in review[0].result["quantities"]}
    assert q["Q-CONC"]["value"] == pytest.approx(15.552) and q["Q-FORM"]["value"] == pytest.approx(103.68)
    assert 2300 <= q["Q-REBAR"]["value"] <= 2450, "12 D22 on rev B, not 12 D19 on rev A"


def test_code_finds_the_boq_mismatch_without_a_model(review):
    f = review[0]
    assert any("code" in x["agents"] and x["tag"] == "BOQ_MISMATCH" for x in f.findings())
    check = next(c for c in f.result["checks"] if c["rule"] == "boq_Q-REBAR")
    assert not check["ok"] and "+31.7%" in check["text"]
    assert next(c for c in f.result["checks"] if c["rule"] == "boq_Q-CONC")["ok"]


def test_the_plan_fits_the_programme_only_with_more_workers_than_it_allows(review):
    checks = {c["rule"]: c for c in review[0].result["checks"]}
    assert checks["time"]["ok"] and checks["crew"]["ok"]
    assert not checks["programme_crew"]["ok"], "the programme's 14 workers cannot do it"


def test_concrete_is_batched_just_before_the_pour(review):
    f = review[0]
    assert step(f, "Batch cement")["start_h"] > step(f, "Position and brace")["start_h"]
    assert step(f, "Lift concrete")["finish_h"] <= step(f, "Pour concrete")["start_h"]


def test_the_review_is_scored_on_what_the_package_plants(review):
    stats = next(e for e in review[1] if e["type"] == "engagement")["statistik"]
    assert stats["package problems found"] == "6/6" and stats["rebar worked out from the drawing in force"] is True


def test_agents_only_read_and_propose(review):
    tools = {e["tool"] for e in review[1] if e["type"] == "tool"}
    allowed = {"read_package", "read_package_index", "read_norms", "read_rfi_log", "read_subcontractors", "record_quantity", "read_quantities", "add_step", "read_steps", "read_plan", "link_steps", "remove_step", "add_inspection", "add_handling", "assign_crew", "flag_waste", "flag_signal", "read_signals", "propose_work_item", "draft_rfi", "red_team_verdict"}
    assert tools <= allowed, tools - allowed


def test_the_planner_only_reads_the_records():
    import re
    from pathlib import Path

    text = Path(planner.__file__).read_text(encoding="utf-8")
    assert set(re.findall(r"\bproject\.([a-zA-Z_]+)", text)) <= {"plan_documents", "schedule", "subcontractors", "all_of", "documents", "as_seeded", "activity_heads"}


def test_evidence_must_have_been_read(review):
    f = planner.PlanningFirm(firm_api.model_of("mock", "plan"), 5, PC.BRIEF, mock=True)
    firm._emit.set(lambda e: None)
    f.breakdown = breakdown()
    add = f.quantity_tool("doc_drawings")
    assert "refused" in add("Q", "Concrete", "m3", "1", "", ["PLAN-NOT-READ"])
    assert "refused" in add("Q", "Concrete", "m3", "1", "", [])


# ------------------------------------------------------------------------------------------------ a person decides, and the records move


def test_a_finished_plan_changes_nothing_until_a_person_decides(review):
    before = P.overview()
    rec = P.record_plan("run-aaaaaa", review[0], "mock")
    after = P.overview()
    assert rec["status"] == "pending" and after["counts"]["pending_plans"] == 1
    assert after["kpis"] == before["kpis"] and after["counts"]["open_work_items"] == 0
    assert len(P.all_of("po")) == 6 and len(P.all_of("inspection")) == 5
    assert all(w["status"] == "proposed" for w in P.all_of("work_item"))
    assert after["latest_plan"]["id"] == rec["id"]


def test_approving_sends_the_plan_to_every_record_it_touches(review):
    rec = P.record_plan("run-aaaaaa", review[0], "mock")
    done = P.decide_plan(rec["id"], "approve", "Go.")
    assert done["status"] == "approved" and done["decided_by"] == P.PM
    items = P.all_of("work_item")
    assert all(w["status"] == "open" for w in items) and sum(1 for w in items if w.get("step")) == len(rec["plan"]["steps"]), "every task of the plan is a card on the board"
    planned = {i["id"]: i for i in P.all_of("inspection") if i["status"] == "planned"}
    assert set(planned) == set(PC.ITP_IDS) and planned["HP-21"]["hold_point"] and planned["HP-21"]["next"]
    requests = [o for o in P.all_of("po") if o["status"] == "requested"]
    assert len(requests) == 12
    assert sum(o["value"] for o in requests) == sum(m["cost"] for m in rec["plan"]["materials"])
    assert next(o for o in requests if o["item"].startswith("Rebar"))["package"] == "WP-REB"
    assert {"approved the work plan", "requested material", "planned an inspection"} <= {a["action"] for a in P.audit()}


def test_rejecting_touches_nothing_but_its_proposals(review):
    rec = P.record_plan("run-aaaaaa", review[0], "mock")
    assert P.decide_plan(rec["id"], "reject", "Not yet.")["status"] == "rejected"
    assert {w["status"] for w in P.all_of("work_item")} == {"rejected"}
    assert len(P.all_of("po")) == 6
    with pytest.raises(ValueError):
        P.decide_plan(rec["id"], "approve")


def test_a_new_review_supersedes_a_pending_plan(review):
    first = P.record_plan("run-aaaaaa", review[0], "mock")
    second = P.record_plan("run-bbbbbb", review[0], "mock")
    assert P.get("plan", first["id"])["status"] == "superseded" and second["status"] == "pending"
    assert sum(w["status"] == "proposed" for w in P.all_of("work_item")) == len(review[0].proposed)
    assert P.overview()["counts"]["pending_plans"] == 1


def test_actuals_compare_with_the_plan_and_over_use_is_flagged(review):
    rec = P.record_plan("run-aaaaaa", review[0], "mock")
    with pytest.raises(ValueError, match="approved"):
        P.plan_actual(rec["id"], "O-1", 50, {})
    P.decide_plan(rec["id"], "approve")
    cut = next(s for s in rec["plan"]["steps"] if s["name"].startswith("Cut rebar"))
    used = cut["materials"][0]["gross"] + 100
    view = P.plan_actual(rec["id"], cut["id"], 60, {"rebar": used})
    line = next(s for s in view["plan"]["steps"] if s["id"] == cut["id"])["actual"]["lines"][0]
    assert line["over"] and line["waste"] == pytest.approx(used - cut["materials"][0]["net"], abs=0.01)
    assert view["progress"]["done"] == 1 and view["progress"]["actual_waste"] > view["progress"]["planned_waste"]
    assert any(a["rule"] == "plan_over" for a in P.checks())
    with pytest.raises(ValueError, match="does not use"):
        P.plan_actual(rec["id"], cut["id"], 60, {"cement": 1})
    with pytest.raises(ValueError, match="negative"):
        P.plan_actual(rec["id"], cut["id"], -1, {})
    with pytest.raises(KeyError):
        P.plan_actual(rec["id"], "O-99", 1, {})


def test_a_shorter_window_after_a_recovery_plan_flags_the_work_plan(review):
    rec = P.record_plan("run-aaaaaa", review[0], "mock")
    P.decide_plan(rec["id"], "approve")
    assert not any(a["rule"] == "plan_window" for a in P.checks())
    P.update_activity("A50", None, 3)
    flagged = [a for a in P.checks() if a["rule"] == "plan_window"]
    assert flagged and "the schedule now gives 5" in flagged[0]["title"]


def test_the_procedure_document_comes_from_the_same_figures(review):
    rec = P.record_plan("run-aaaaaa", review[0], "mock")
    text = wbs.procedure_markdown(rec)
    for s in rec["plan"]["steps"]:
        assert f"### {s['id']} {s['name']}" in text
    assert "SNI 7394:2008" in text and "hold point" in text and f"Rp {rec['plan']['totals']['waste_cost']:,}" in text
    table = wbs.table_csv(rec).splitlines()
    assert table[0].startswith("wbs,step,name,kind") and len(table) > len(rec["plan"]["steps"])


# ------------------------------------------------------------------------------------------------ through the API the screens use


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(firm_api, "STORE", tmp_path / "runs")
    monkeypatch.setattr(firm_api, "RUNS", {})
    monkeypatch.setattr(firm_api, "TASKS", {})
    monkeypatch.setattr(firm_api, "PROJECTS", {})
    monkeypatch.setattr(firm_api, "MOCK_DELAY", 0)
    with TestClient(firm_api.app) as c:
        yield c


def test_the_whole_loop_through_the_api(client):
    assert client.get("/api/project/plans").json()["plans"] == []
    docs = client.get("/api/project/plan-package").json()
    assert {d["id"] for d in docs["documents"]} >= {"PLAN-DWG-S401-B", "PLAN-RKS-03", "PLAN-BOQ-L4"}
    run_id = client.post("/api/aip/konsultan", json={"nama": "Plan", "versi": "mock", "jenis": "plan"}).json()["run"]
    until = time.time() + 60
    while time.time() < until and client.get(f"/api/aip/runs/{run_id}?after=0").json()["run"]["status"] == "running":
        time.sleep(0.1)
    r = client.get(f"/api/aip/runs/{run_id}?after=0").json()
    assert r["run"]["status"] == "succeeded" and r["run"]["spent_usd"] == 0 and r["run"]["jenis"] == "plan"
    assert not [e for e in r["events"] if e["type"] == "error"]
    assert next(e for e in r["events"] if e["type"] == "firm")["jenis"] == "plan"
    plans = client.get("/api/project/plans").json()["plans"]
    assert len(plans) == 1 and plans[0]["status"] == "pending" and plans[0]["run"] == run_id
    drawn = next(e for e in r["events"] if e["type"] == "engagement")["wbs"]  # the report draws its WBS from the run, which outlives the plan record
    assert drawn["sections"] == plans[0]["plan"]["sections"] and [s["id"] for s in drawn["steps"]] == [s["id"] for s in plans[0]["plan"]["steps"]]
    assert any(x["status"] == "draft" and x["drafted_by"] == "doc_revisions" for x in client.get("/api/rfis").json()["rfis"])
    pid = plans[0]["id"]
    assert "### O-1" in client.get(f"/api/project/plans/{pid}/procedure.md").text
    assert client.get(f"/api/project/plans/{pid}/table.csv").text.startswith("wbs,step,name")
    assert client.post(f"/api/project/plans/{pid}/approve", json={"note": "Go."}).status_code == 200
    assert client.post(f"/api/project/plans/{pid}/approve", json={}).status_code == 409
    o = client.get("/api/project/overview").json()
    assert o["latest_plan"]["status"] == "approved" and o["counts"]["open_work_items"] == 18 + 5, "18 tasks and 5 items from the agents"
    assert client.post(f"/api/project/plans/{pid}/steps/O-1/actual", json={"man_hours": 50, "materials": {"rebar": 2500}}).status_code == 200
    assert client.post(f"/api/project/plans/{pid}/steps/O-99/actual", json={}).status_code == 404
    assert client.post("/api/project/plans/WBS-none/approve", json={}).status_code == 404
    assert client.get("/api/project/plans/WBS-none/procedure.md").status_code == 404


def test_a_disruption_review_still_runs_as_before(client):
    run_id = client.post("/api/aip/konsultan", json={"nama": "Disruption", "versi": "mock"}).json()["run"]
    until = time.time() + 60
    while time.time() < until and client.get(f"/api/aip/runs/{run_id}?after=0").json()["run"]["status"] == "running":
        time.sleep(0.1)
    assert client.get(f"/api/aip/runs/{run_id}?after=0").json()["run"]["status"] == "succeeded"
    assert client.get("/api/project/decisions").json()["decisions"][0]["recommended"] == "O3"
    assert client.get("/api/project/plans").json()["plans"] == []
def test_a_wait_after_a_step_holds_the_next_one_and_counts_in_the_days():
    c = breakdown()
    c.add_quantity("Q", "Rebar", "kg", "100", {100.0}, "", ["X"], "a")
    crew = [{"role": "Pekerja", "count": 2}]
    c.add_step("pour", "a", "operation", "Pour", [], "How.", ["X"], "a", "SNI-6.17", "Q", 90, ["rebar"], crew=crew, hours=7, wait_days=7)
    c.add_step("strike", "a", "operation", "Strike", ["pour"], "How.", ["X"], "a", "SNI-6.17", "Q", 10, [], crew=crew, hours=7)
    c.number()
    p = c.plan()
    rows = {s["ref"]: s for s in p["steps"]}
    assert rows["strike"]["start_h"] - rows["pour"]["finish_h"] == 49, "seven days of curing at seven working hours a day, then the next step may start"
    assert p["totals"]["days"] == round(rows["strike"]["finish_h"] / 7, 1)
    assert p["totals"]["wait_days"] == 7


def test_a_boq_line_of_zero_quantity_does_not_crash_the_plan():
    c = wbs.Breakdown("Test", ["A50"], [{"id": "a", "name": "A", "by": "besi"}], PC.RATES, [{"id": "B0", "item": "Nothing yet", "unit": "kg", "qty": 0, "rate": 100}], 7, {"besi": 16}, [], 14)
    c.add_quantity("Q", "Rebar", "kg", "10", {10.0}, "B0", ["X"], "a")
    c.add_step("one", "a", "operation", "One", [], "How.", ["X"], "a", "SNI-6.17", "Q", 100, ["rebar"], crew=[{"role": "Pekerja", "count": 2}], hours=7)
    c.number()
    q = c.plan()["quantities"][0]
    assert q["boq_qty"] == 0 and q["boq_diff_pct"] is None

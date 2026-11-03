"""Offline tests of the eight modules as one system: the WBS is the spine, and a change in one module shows up in the others. No model is called: where an agent would answer, a stand-in does. They prove the wiring and the rules, not how well a real model reasons."""

from __future__ import annotations

import asyncio
import io
import shutil
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from swarm import extract, firm, firm_api, llm, module_agents as A, modules as M, planner, planning_case as PC, project as P, site_case as C, wbs


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

    async def go():
        firm._emit.set(lambda e: None)
        f = planner.PlanningFirm(firm_api.model_of("mock", "plan"), 5, PC.BRIEF, mock=True)
        await f.engagement()
        return f

    delay, firm_api.MOCK_DELAY = firm_api.MOCK_DELAY, 0
    f = asyncio.run(go())
    firm_api.MOCK_DELAY = delay
    _close()
    P.DB = saved
    return f


@pytest.fixture(autouse=True)
def records(template, tmp_path, monkeypatch):
    """Each test on its own copy, with projects and uploads in its own folder: the running app's data stays untouched."""
    path = tmp_path / "project.db"
    shutil.copy(template, path)
    monkeypatch.setattr(P, "DB", path)
    monkeypatch.setattr(P, "SCENARIO_DB", path)
    monkeypatch.setattr(P, "TODAY", C.TODAY)
    yield path
    _close()


@pytest.fixture()
def approved(review):
    rec = P.record_plan("run-aaaaaa", review, "mock")
    P.decide_plan(rec["id"], "approve", "Go.")
    return rec


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(firm_api, "STORE", tmp_path / "runs")
    monkeypatch.setattr(firm_api, "RUNS", {})
    monkeypatch.setattr(firm_api, "TASKS", {})
    monkeypatch.setattr(firm_api, "PROJECTS", {})
    monkeypatch.setattr(firm_api, "MOCK_DELAY", 0)
    with TestClient(firm_api.app) as c:
        yield c


def card(step: str) -> dict:
    return next(c for c in M.board()["cards"] if c.get("step") == step)


def task(step: str) -> dict:
    return next(w for w in P.all_of("work_item") if w.get("step") == step)


def finish_prerequisites(w: dict) -> None:
    """Under the board's rule a card cannot start until what it waits for is done: finish that chain first, in CPM order. An inspection in the chain is signed in QA/QC, as a person would."""
    for _ in range(40):
        waiting = P.unfinished_prerequisites(w)
        if not waiting:
            return
        first = waiting[0]
        target = next(x for x in P.all_of("work_item") if x.get("plan") == w.get("plan") and x.get("step") == first["step"])
        finish_prerequisites(target)
        if target.get("kind") == "inspection":
            rec = P.get("plan", w["plan"])
            step = next(x for x in rec["plan"]["steps"] if x["id"] == first["step"])
            hold = P.get("inspection", step.get("itp") or first["step"])
            P.inspection_result(hold["id"], "pass", [{**c, "ok": True} for c in hold["checklist"]], "Signed.")
        else:
            P.set_work_item(target["id"], "doing")
            P.set_work_item(target["id"], "done")
    raise AssertionError("the chain did not finish")


def activity(aid: str) -> dict:
    return next(a for a in P.schedule()["activities"] if a["id"] == aid)


def find(node: dict, code: str) -> dict | None:
    return M._find(node, code)


# ------------------------------------------------------------------------------------------------ the WBS is the spine


def test_every_activity_has_a_code_under_its_work_package():
    codes = P.wbs_codes()
    assert codes["WP-STR"] == "1.1" and codes["A50"] == "1.1.1" and codes["A60"] == "1.1.2" and codes["A20"] == "1.2.1"
    assert {a[0] for a in C.ACTIVITIES} <= set(codes)


def test_the_plan_hangs_on_the_wbs_and_a_section_spanning_two_activities_splits_where_its_work_moves_on(review):
    tree = {n["activity"]: n for n in review.result["tree"]}
    assert {s["name"] for s in tree["A50"]["sections"]} == {"Steel rebar", "Formwork", "Erection and casting"}
    assert {s["name"] for s in tree["A60"]["sections"]} == {"Concrete mixture", "Erection and casting"}
    by = {s["name"]: s for s in review.result["steps"]}
    assert by["Position and brace forms"]["activity"] == "A50" and by["Pour concrete through a tremie"]["activity"] == "A60", "casting starts once the concrete arrives"
    codes = [s["code"] for s in review.result["steps"]]
    assert len(set(codes)) == len(codes) and all(c.startswith(("1.1.1.", "1.1.2.")) for c in codes)


def test_code_tasks_handles_a_section_with_no_activity_and_a_task_waiting_for_nothing():
    steps = [{"id": "a", "section": "s", "after": []}, {"id": "b", "section": "s", "after": ["a"]}]
    tree = wbs.code_tasks(steps, [{"id": "s", "name": "S"}], ["A", "B"])
    assert steps[0]["activity"] == "A" and steps[1]["code"] == "1.1.1.2" and tree[1]["sections"] == []


def test_the_tree_rolls_every_module_up_every_level(approved):
    root = M.tree()["root"]
    assert root["roll"]["tasks"] == 18 and root["roll"]["ncrs"] == 1 and root["roll"]["rfis"] == 2
    a50 = find(root, "1.1.1")
    assert a50["ref"] == "A50" and a50["roll"]["tasks"] == sum(c["roll"]["tasks"] for c in a50["children"]) and a50["roll"]["rfis"] == 1
    t = find(root, a50["children"][0]["children"][0]["code"])
    assert t["type"] == "task" and t["card"] and t["status"] == "open"
    assert not a50["ready"]["ready"] and a50["ready"]["reasons"][0]["ref"] == "RFI-035"


def test_a_pending_plan_shows_in_the_wbs_as_proposed_and_changes_no_record(review):
    before = len(P.all_of("work_item")), len(P.all_of("po"))
    P.record_plan("run-aaaaaa", review, "mock")
    root = M.tree()["root"]
    assert root["roll"]["proposed"] == 18 and root["roll"]["open"] == 0
    assert len(P.all_of("po")) == before[1] and M.board()["waiting"]["tasks"] == 18


def test_a_node_gathers_what_every_module_holds_on_it(approved):
    d = M.node_detail("1.1.1")
    assert {r["id"] for r in d["rfis"]} == {"RFI-035"} and d["cards"] and d["documents"] and any(o["id"] == "PO-121" for o in d["orders"])
    code = next(s["code"] for s in approved["plan"]["steps"] if s["name"].startswith("Cut rebar"))
    one = M.node_detail(code)
    assert one["step"]["procedure"] and one["cards"][0]["step"] == one["step"]["id"]
    assert [o["material"] for o in one["orders"]] == ["rebar"] and one["rfis"] == [], "a task's panel holds what touches that task"
    erect = next(s["code"] for s in approved["plan"]["steps"] if s["name"].startswith("Erect"))
    assert [r["id"] for r in M.node_detail(erect)["rfis"]] == ["RFI-035"]
    with pytest.raises(KeyError):
        M.node_detail("9.9")


# ------------------------------------------------------------------------------------------------ the Kanban board is connected to the work plan


def test_approving_puts_every_task_on_the_board_and_replaces_the_activity_cards(approved):
    b = M.board()
    assert sum(1 for c in b["cards"] if c.get("step")) == 18
    ids = {c["id"] for c in b["cards"] if c["type"] == "activity"}
    assert "A50" not in ids and "A60" not in ids and "A70" in ids, "an activity with tasks is its tasks"


def test_before_any_plan_the_board_still_shows_the_programme():
    b = M.board()
    assert {c["id"] for c in b["cards"]} == {a[0] for a in C.ACTIVITIES} and b["plan"] is None


def test_the_board_drives_the_schedule(approved):
    assert activity("A50")["progress"] == 0 and activity("A50")["progress_from"] == "tasks"
    P.close_ncr("NCR-014", "Rework done.")
    cut = task("O-1")
    P.set_work_item(cut["id"], "done")
    assert 0 < activity("A50")["progress"] < 100
    done_hours = cut["man_hours"]
    total = sum(w["man_hours"] for w in P.all_of("work_item") if w.get("activity") == "A50" and w.get("physical"))
    assert activity("A50")["progress"] == round(100 * done_hours / total)
    with pytest.raises(ValueError, match="comes from its tasks"):
        P.update_activity("A50", 50, None)


def test_a_hold_point_stops_what_follows_it_until_it_is_signed_in_qaqc(approved):
    forms = task("O-9")
    with pytest.raises(ValueError, match="HP-21"):
        P.set_work_item(forms["id"], "doing")
    assert card("O-9")["stopped"] and any(b["kind"] == "hold" for b in card("O-9")["blockers"])
    hold = P.get("inspection", "HP-21")
    P.inspection_result("HP-21", "pass", [{**c, "ok": True} for c in hold["checklist"]], "Checked.")
    assert not card("O-9")["stopped"]
    finish_prerequisites(forms)
    assert P.set_work_item(forms["id"], "doing")["status"] == "doing"


def test_an_inspection_card_cannot_be_dragged_to_done_only_its_result_closes_it(approved):
    look = task("I-2")
    with pytest.raises(ValueError, match="QA/QC"):
        P.set_work_item(look["id"], "done")
    finish_prerequisites(look)
    assert P.set_work_item(look["id"], "review")["status"] == "review"
    hold = P.get("inspection", "HP-21")
    P.inspection_result("HP-21", "pass", [{**c, "ok": True} for c in hold["checklist"]], "")
    assert P.get("work_item", look["id"])["status"] == "done"


def test_a_failed_inspection_raises_an_ncr_stops_what_follows_and_closing_it_lets_work_go_on(approved):
    hold = P.get("inspection", "HP-21")
    items = [{**c, "ok": n != 0} for n, c in enumerate(hold["checklist"])]
    with pytest.raises(ValueError, match="record a fail"):
        P.inspection_result("HP-21", "pass", items)
    failed = P.inspection_result("HP-21", "fail", items, "Spacing out at C2.")
    ncr = P.get("ncr", failed["ncr"])
    assert ncr["status"] == "open" and ncr["activity"] == "A50" and hold["checklist"][0]["text"] in ncr["title"]
    assert any(b["kind"] == "failed" and b["ref"] == ncr["id"] for b in card("O-9")["blockers"])
    with pytest.raises(ValueError, match=ncr["id"]):
        P.inspection_result("HP-21", "pass", [{**c, "ok": True} for c in hold["checklist"]])
    P.close_ncr(ncr["id"], "Re-tied and re-inspected.")
    assert P.get("inspection", "HP-21")["status"] == "passed" and task("I-2")["status"] == "done" and not card("O-9")["stopped"]


def test_a_checklist_must_be_ticked_before_a_pass(approved):
    with pytest.raises(ValueError, match="tick every point"):
        P.inspection_result("HP-21", "pass")


def test_an_open_rfi_holds_the_tasks_that_name_it_and_answering_it_clears_them(approved):
    assert any(b["ref"] == "RFI-035" for b in card("O-8")["blockers"]), "its procedure names RFI-035"
    assert not any(b["ref"] == "RFI-035" for b in card("O-1")["blockers"]), "cutting rebar does not wait for it"
    P.answer_rfi("RFI-035", "Move the sleeve.")
    assert not any(b["ref"] == "RFI-035" for b in card("O-8")["blockers"])


def test_material_not_received_shows_on_its_task_and_receiving_it_clears_it(approved):
    assert any(b["kind"] == "material" for b in card("O-1")["blockers"])
    order = next(o for o in P.all_of("po") if o.get("material") == "rebar")
    P.po_action(order["id"], "receive")
    assert not any(b["kind"] == "material" for b in card("O-1")["blockers"])


def test_when_the_schedule_moves_the_tasks_move_with_it(approved):
    before = card("O-1")
    P.update_activity("A40", None, 5)
    after = card("O-1")
    assert after["start"] > before["start"] and after["due"] > before["due"]
    P.set_work_item(task("O-1")["id"], due="2026-12-01")
    assert card("O-1")["due"] == "2026-12-01", "a date a person set stays"


def test_bottlenecks_name_the_root_cause_first_and_count_what_waits_behind_it(approved):
    b = M.board()["bottlenecks"]
    assert b[0]["ref"] == "NCR-014" and b[0]["stop"], "the failed hold point on the Level 3 slab holds everything after it"
    assert b[0]["held"] > 18, "the activities after it and every task of the plan"
    assert not any(x["kind"] == "activity" and x["ref"] in ("A30", "A40") for x in b), "an activity that is itself held is a symptom"
    assert sum(1 for x in b if x["ref"] == "requests") == 1, "a plan's material requests are one job"
    P.close_ncr("NCR-014", "Done.")
    assert all(x["ref"] != "NCR-014" for x in M.board()["bottlenecks"])


def test_too_much_work_for_a_crew_is_a_bottleneck(approved):
    """A crew asked for more people than it has is a bottleneck. Under the board's prerequisite rule one chain
    can only run one card at a time, so the overload is made the honest way: the crew shrinks under work already
    legitimately under way."""
    first = sorted((c for c in M.board()["cards"] if c["type"] == "task" and c.get("by") == "besi"), key=lambda c: c.get("cpm_rank") or 999)[0]
    P.set_work_item(first["id"], "doing")
    assert not any(x["kind"] == "capacity" for x in M.board()["bottlenecks"])
    P.patch("subcontractor", "besi", {"crew": 5}, P.PM, "test", "the rebar crew is five people short")
    hit = next(x for x in M.board()["bottlenecks"] if x["kind"] == "capacity")
    assert hit["ref"] == "besi" and hit["held"] == 1


def test_an_activity_card_moves_its_progress_and_a_failed_inspection_stops_it():
    with pytest.raises(ValueError, match="NCR-014"):
        M.move_activity_card("A30", "doing")
    P.close_ncr("NCR-014", "Done.")
    P.update_activity("A20", 100, None)  # A30's predecessor finishes first: the board's rule
    M.move_activity_card("A30", "doing")
    assert activity("A30")["progress"] == 10
    M.move_activity_card("A30", "done")
    assert activity("A30")["progress"] == 100 and next(c for c in M.board()["cards"] if c["id"] == "A30")["status"] == "done"


def test_a_proposal_cannot_be_worked_until_its_plan_is_approved(review):
    P.record_plan("run-aaaaaa", review, "mock")
    w = next(x for x in P.all_of("work_item") if x["status"] == "proposed")
    with pytest.raises(ValueError, match="proposal"):
        P.set_work_item(w["id"], "doing")


def test_replacing_a_plan_closes_its_open_tasks_and_cancels_its_requests(review, approved):
    second = P.record_plan("run-bbbbbb", review, "mock")
    P.decide_plan(second["id"], "approve")
    live = [w for w in P.all_of("work_item") if w.get("step") and w["status"] in P.TASK_STATUS]
    assert len(live) == 18 and all(w["plan"] == second["id"] for w in live)
    assert all(o["status"] == "cancelled" for o in P.all_of("po") if o.get("plan") == approved["id"])


# ------------------------------------------------------------------------------------------------ AI scheduling: Gantt and CPM


def test_the_critical_path_is_unchanged_for_the_scenario():
    plan = C.schedule()
    assert plan["milestone"]["forecast"] == "2026-10-25" and plan["milestone"]["days_late"] == 0
    assert next(a for a in plan["activities"] if a["id"] == "A50")["critical"]
    assert [a["id"] for a in plan["activities"]] == [a[0] for a in C.ACTIVITIES]


def test_changing_a_dependency_reworks_the_critical_path():
    assert activity("B20")["start"] == "2026-10-11"
    P.update_activity("B20", None, None, ["B10", "C10"])
    assert activity("B20")["start"] == "2026-10-13", "C10 finishes later than B10"
    assert activity("B20")["baseline_start"] == "2026-10-11"


def test_a_dependency_that_would_make_a_loop_is_refused():
    with pytest.raises(ValueError, match="loop"):
        P.update_activity("A20", None, None, ["A90"])
    with pytest.raises(ValueError, match="no such activity"):
        P.update_activity("A20", None, None, ["Z99"])


def test_a_person_can_add_an_activity_and_a_milestone_and_the_schedule_takes_them():
    finish = activity("A60")["finish"]
    a = P.add_activity("Level 4 scaffold", "WP-STR", 3, ["A60"], "rangka")
    assert a["code"] == "1.1.4" and a["predecessors"] == ["A60"] and a["start"] == (date.fromisoformat(finish) + timedelta(days=1)).isoformat()
    m = P.add_milestone("Scaffold up", a["id"], "2026-10-01")
    late = next(x for x in P.schedule()["milestones"] if x["id"] == m["id"])
    assert late["days_late"] > 0 and any(c["rule"] == "milestone_late" and c["title"].startswith(f"Milestone {m['id']}") for c in P.checks())
    with pytest.raises(KeyError):
        P.add_activity("Nowhere", "WP-NONE", 3)
    with pytest.raises(ValueError):
        P.add_activity("Waits for nothing real", "WP-STR", 3, ["Z99"])


def test_a_delay_is_detected_from_the_baseline_and_from_progress(monkeypatch):
    assert not any(d["kind"] == "moved" for d in M.delays())
    P.update_activity("A40", None, 5)
    assert any(d["kind"] == "moved" and d["activity"] == "A50" for d in M.delays())
    monkeypatch.setattr(P, "TODAY", "2026-10-09")
    found = {(d["kind"], d["activity"]) for d in M.delays()}
    assert ("overdue", "A20") in found and ("behind", "B10") in found


def test_the_gantt_carries_the_tasks_under_their_activity(approved):
    v = M.schedule_view()
    a50 = next(a for a in v["activities"] if a["id"] == "A50")
    assert a50["tasks"] and all(t["start"] >= a50["start"] for t in a50["tasks"]) and v["network"]["steps"] and v["resources"]["crew_by_day"]


def test_assigning_the_activity_shows_in_the_schedule():
    assert activity("A70")["by"] == "rangka"
    assert P.update_activity("A70", None, None, by="besi")["by_name"].startswith("PT Besi")


# ------------------------------------------------------------------------------------------------ BOQ and cost


def test_a_new_boq_line_raises_its_package_and_earns_from_its_activity():
    before = next(p for p in P.budget()["packages"] if p["id"] == "WP-STR")
    line = P.add_boq_line("Scaffold", "m2", 100, 50_000, "WP-STR", "A50")
    after = next(p for p in P.budget()["packages"] if p["id"] == "WP-STR")
    assert after["boq_value"] == before["boq_value"] + 5_000_000 and after["budget"] > before["budget"] and line["activity"] == "A50"
    assert any(b["id"] == line["id"] and b["wbs"] == "1.1.1" for b in M.boq_view()["lines"])
    P.update_activity("A50", 50, None)
    assert next(p for p in P.budget()["packages"] if p["id"] == "WP-STR")["ev"] > after["ev"]
    with pytest.raises(ValueError):
        P.add_boq_line("Nothing", "m2", 0, 0, "WP-STR")


def test_an_actual_cost_goes_to_the_actual_and_a_forecast_to_the_forecast():
    before = next(p for p in P.budget()["packages"] if p["id"] == "WP-CON")
    P.add_cost_item("WP-CON", "Pump repair", 5_000_000, actual=True)
    after = next(p for p in P.budget()["packages"] if p["id"] == "WP-CON")
    assert after["ac"] == before["ac"] + 5_000_000 and after["recovery"] == before["recovery"]
    P.add_cost_item("WP-CON", "Standby", 1_000_000)
    assert next(p for p in P.budget()["packages"] if p["id"] == "WP-CON")["recovery"] == before["recovery"] + 1_000_000


def test_takeoff_and_bill_of_materials_come_from_the_plan_and_actuals_track_against_it(approved):
    v = M.boq_view()["takeoff"]
    assert v["quantities"] and v["materials"] and sum(s["man_hours"] for s in v["by_section"]) == pytest.approx(v["totals"]["man_hours"], abs=0.5)
    assert v["tracking"]["planned"] == v["totals"]["cost"] and v["tracking"]["actual"] == 0
    step = next(s for s in approved["plan"]["steps"] if s["name"].startswith("Cut rebar"))
    P.plan_actual(approved["id"], step["id"], 60, {"rebar": 2600})
    assert M.boq_view()["takeoff"]["tracking"]["actual"] > 0


# ------------------------------------------------------------------------------------------------ documents and RFIs


def test_rules_read_the_facts_a_document_states():
    f = extract.facts("Column C1: 12 columns, 600 x 600 mm. Main bars 12 D22 at 150 mm. K-300, f'c 26.4 MPa. See S-401 rev B and RFI-035 on A50. Cover +/- 5 mm. 15.6 m3 at Rp 1,420,000. SNI 7394:2008.")
    assert "S-401 rev B" in f["drawings"] and "K-300" in f["concrete"] and any("D22" in x for x in f["rebar"]) and "600 x 600 mm" in f["dimensions"]
    assert f["drawings"] == ["S-401 rev B"], "a mix and an RFI are not drawings"
    assert "RFI-035" in f["records"] and "A50" in f["activities"] and "15.6 m3" in f["quantities"] and "Rp 1,420,000" in f["money"] and "+/- 5 mm" in f["tolerances"]


def test_the_register_knows_a_later_revision_replaces_a_drawing_and_only_a_drawing():
    d = {x["id"]: x for x in M.documents()["documents"]}
    assert d["PLAN-DWG-S401-A"]["status"] == "superseded" and d["PLAN-DWG-S401-A"]["replaced_by"] == "PLAN-DWG-S401-B"
    assert d["PLAN-DWG-S401-B"]["status"] == "current" and d["PLAN-BOQ-L4"]["status"] == "current", "a BoQ mentioning a revision is not a drawing"
    assert "D22" in " ".join(d["PLAN-DWG-S401-B"]["facts"]["rebar"])


def test_the_register_says_which_tasks_cite_a_document_and_a_task_citing_a_replaced_one_is_flagged(approved):
    d = {x["id"]: x for x in M.documents()["documents"]}
    assert d["PLAN-DWG-S401-B"]["cited_by"] and d["PLAN-RKS-03"]["findings"]
    assert M.documents()["counts"]["superseded"] == 1
    rec = P.get("plan", approved["id"])
    rec["plan"]["steps"][0]["evidence"] = ["PLAN-DWG-S401-A"]
    P.put("plan", rec["id"], rec)
    assert any(b["kind"] == "document" and b["ref"] == "PLAN-DWG-S401-A" for b in card("O-1")["blockers"])
    assert not next(r for r in M.readiness()["activities"] if r["id"] == "A50")["ready"]


def test_technical_readiness_follows_the_rfis():
    r = {x["id"]: x for x in M.readiness()["activities"]}
    assert not r["A50"]["ready"] and not r["A30"]["ready"] and r["A70"]["ready"]
    P.answer_rfi("RFI-035", "Move the sleeve.")
    assert next(x for x in M.readiness()["activities"] if x["id"] == "A50")["ready"]


def test_approving_a_document_is_recorded_and_an_unknown_one_is_refused():
    M.decide_document("PLAN-RKS-03", "approved", "For construction.")
    d = next(x for x in M.documents()["documents"] if x["id"] == "PLAN-RKS-03")
    assert d["status"] == "approved" and d["decided_by"] == P.PM and any(a["action"] == "marked a document approved" for a in P.audit())
    with pytest.raises(KeyError):
        M.decide_document("NOPE", "approved")
    with pytest.raises(ValueError):
        M.decide_document("PLAN-RKS-03", "burned")


def test_a_document_can_be_uploaded_read_by_rules_and_kept_by_our_own_name(client, records):
    text = b"Drawing S-900 rev C. Slab S1: 200 mm, K-350, D13 at 150 mm. See RFI-035."
    r = client.post("/api/project/documents", files={"file": ("../../evil name.txt", io.BytesIO(text), "text/plain")}, data={"title": "Drawing S-900 rev C: slab", "kind": "drawing", "activity": "A70"})
    assert r.status_code == 200
    d = r.json()
    assert d["id"].startswith("UP-") and d["file"] == f"{d['id']}.txt" and ".." not in d["file"] and "/" not in d["filename"] and "\\" not in d["filename"]
    assert "K-350" in d["facts"]["concrete"] and d["status"] == "received"
    assert A.upload_folder().joinpath(d["file"]).read_bytes() == text
    assert client.get(f"/api/project/documents/{d['id']}/file").content == text
    assert client.get(f"/api/project/documents/{d['id']}/text").json()["text"].startswith("Drawing S-900")
    listed = next(x for x in client.get("/api/project/documents").json()["documents"] if x["id"] == d["id"])
    assert listed["activities"] == ["A70"] and listed["source"] == "upload"
    assert client.post("/api/project/documents", files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream")}).status_code == 400
    assert client.post("/api/project/documents", files={"file": ("empty.txt", io.BytesIO(b""), "text/plain")}).status_code == 400


def test_a_pdf_gives_its_text_and_a_scan_says_it_has_none(tmp_path):
    from pypdf import PdfWriter

    blank = tmp_path / "scan.pdf"
    w = PdfWriter()
    w.add_blank_page(100, 100)
    with blank.open("wb") as f:
        w.write(f)
    text, how = extract.read_text(blank)
    assert text == "" and "no text to read" in how
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"not a pdf")
    assert "could not be read" in extract.read_text(broken)[1]


def test_reading_a_document_offline_uses_no_model_and_a_real_reading_needs_a_key(monkeypatch):
    out = asyncio.run(A.read_document("PLAN-DWG-S401-B", "mock"))
    assert out["usd"] == 0 and "no model" in out["summary"]
    monkeypatch.setattr(A.config, "muse_ready", lambda: False)
    with pytest.raises(ValueError, match="META_API_KEY"):
        asyncio.run(A.read_document("PLAN-DWG-S401-B", "muse"))


def test_a_real_reading_keeps_only_quotes_that_are_in_the_document(monkeypatch):
    class Reader(llm.Scripted):
        def answer(self, results, tools):
            return '{"summary": "A drawing.", "key_points": [{"point": "Real", "quote": "Main bars 12 D22"}, {"point": "Invented", "quote": "Main bars 40 D50"}], "questions": [{"subject": "Stirrups", "question": "Which?", "to": "Engineer"}]}'

    monkeypatch.setattr(A.config, "muse_ready", lambda: True)
    monkeypatch.setattr(A.llm, "muse", lambda *a, **k: Reader("mock/reader"))
    out = asyncio.run(A.read_document("PLAN-DWG-S401-B", "muse"))
    assert [p["point"] for p in out["key_points"]] == ["Real"] and out["dropped"] == 1 and out["questions"][0]["subject"] == "Stirrups"


# ------------------------------------------------------------------------------------------------ procurement and subcontractors


def test_material_availability_follows_the_orders_and_spots_a_possible_duplicate(approved):
    rows = {m["key"]: m for m in M.materials()["materials"]}
    assert rows["rebar"]["state"] == "not_ordered" and rows["rebar"]["maybe_covered_by"] == ["PO-121"], "PO-121 already orders Level 4 column rebar"
    order = rows["rebar"]["order"]
    P.po_action(order, "assign", promised=rows["rebar"]["needed"], supplier="Steel stockist")
    assert {m["key"]: m for m in M.materials()["materials"]}["rebar"]["state"] == "on_order"
    P.po_action(order, "receive")
    assert {m["key"]: m for m in M.materials()["materials"]}["rebar"]["state"] == "available"


def test_a_late_promise_shows_as_late(approved):
    rows = {m["key"]: m for m in M.materials()["materials"]}
    P.po_action(rows["cement"]["order"], "assign", promised="2026-12-31", supplier="Cement Co")
    assert {m["key"]: m for m in M.materials()["materials"]}["cement"]["state"] == "late"


def test_suppliers_are_read_from_the_orders():
    s = {x["name"]: x for x in M.suppliers()["suppliers"]}
    usual = s["Usual concrete supplier (fictional)"]
    assert usual["orders"] >= 2 and usual["received"] >= 1 and usual["value"] > 0


def test_the_programme_gap_shows_and_a_person_closes_it(approved):
    rows = M.assignments()
    gap = next(r for r in rows["rows"] if r["activity"] == "A50" and r["by"] == "besi")
    assert gap["gap"] and gap["programmed"] == "rangka", "rebar is Besi's, and the programme names only Rangka"
    assert not any(r["by"] in ("Engineer", "QC engineer", "Site lab technician") for r in rows["rows"]), "inspectors are not a crew"
    M.confirm_assignment("A50", "besi")
    assert not next(r for r in M.assignments()["rows"] if r["id"] == "A50:besi")["gap"]


def test_moving_a_section_to_another_crew_moves_its_cards(approved):
    assert M.reassign("A50", "formwork", "besi")["moved"] == 3
    assert task("O-4")["owner"].startswith("PT Besi") and task("O-4")["by"] == "besi"


def test_an_order_can_be_placed_and_a_bad_one_refused():
    o = P.add_order("Scaffold tubes", "Tube Co", "A70", "2026-10-20", "2026-10-22", 1_000_000)
    assert o["id"].startswith("PO-") and o["package"] == "WP-STR" and any(c["rule"] == "late_delivery" and c["ref"] == o["id"] for c in P.checks())
    with pytest.raises(ValueError):
        P.add_order("x", "y", "Z99", "2026-10-20")


# ------------------------------------------------------------------------------------------------ QA/QC


def test_a_criterion_becomes_a_checklist_and_a_comma_inside_a_number_stays():
    assert [c["text"] for c in P.checklist_of("Spacing per S-401 rev B, laps 40d, cover 40 mm +/- 5 mm")] == ["Spacing per S-401 rev B", "laps 40d", "cover 40 mm +/- 5 mm"]
    assert [c["text"] for c in P.checklist_of("Height 3,600 mm")] == ["Height 3,600 mm"]
    assert P.checklist_of("") == []


def test_approving_plans_inspections_with_their_checklist_and_link(approved):
    i = P.get("inspection", "HP-21")
    assert i["hold_point"] and i["status"] == "planned" and i["step"] and i["activity"] == "A50" and len(i["checklist"]) == 3
    assert next(x for x in P.quality()["inspections"] if x["id"] == "HP-21")["wbs"] == "1.1.1"


def test_a_photo_can_support_a_result_and_shows_where_it_was_used(approved):
    photo = M.photos()["photos"][0]["id"]
    hold = P.get("inspection", "HP-21")
    P.inspection_result("HP-21", "pass", [{**c, "ok": True} for c in hold["checklist"]], "", [photo])
    assert "HP-21" in next(p for p in M.photos()["photos"] if p["id"] == photo)["inspections"]


def test_an_offline_photo_review_says_it_is_scripted_and_a_real_one_needs_a_key(monkeypatch):
    rebar = next(p for p in M.photos()["photos"] if p.get("item_code") == "ST-06")["id"]
    out = asyncio.run(A.review_photo(rebar, "mock"))
    assert out["defects"] and "scripted" in out["method"] and out["usd"] == 0
    P.close_ncr("NCR-014", "Done.")
    assert not asyncio.run(A.review_photo(rebar, "mock"))["defects"]
    monkeypatch.setattr(A.config, "muse_ready", lambda: False)
    with pytest.raises(ValueError, match="META_API_KEY"):
        asyncio.run(A.review_photo(rebar, "muse"))
    with pytest.raises(KeyError):
        asyncio.run(A.review_photo("nope", "mock"))


def test_a_photo_can_be_uploaded_and_only_as_a_picture(client):
    from PIL import Image

    data = io.BytesIO()
    Image.new("RGB", (4, 4)).save(data, "PNG")
    r = client.post("/api/project/photos", files={"file": ("site.png", io.BytesIO(data.getvalue()), "image/png")}, data={"caption": "Column C2", "activity": "A50"})
    assert r.status_code == 200 and r.json()["id"].startswith("PH-")
    assert client.get(f"/api/project/photos/{r.json()['id']}").content == data.getvalue()
    assert client.post("/api/project/photos", files={"file": ("x.pdf", io.BytesIO(b"%PDF"), "application/pdf")}).status_code == 400
    assert next(p for p in client.get("/api/project/photos").json()["photos"] if p["id"] == r.json()["id"])["wbs"] == "1.1.1"


# ------------------------------------------------------------------------------------------------ an agent on each module


def test_every_module_has_an_agent_and_offline_it_works_out_its_recommendations_with_no_model(approved):
    assert set(A.BENCH) == {"wbs", "schedule", "cost", "kanban", "documents", "procurement", "quality", "tower"}
    for key in A.BENCH:
        out = asyncio.run(A.ask(key, "mock"))
        assert out["mode"] == "mock" and out["usd"] == 0 and out["tokens"] == {"prompt": 0, "output": 0}, key
        assert out["items"], f"{key} found nothing in a project with this much open"
        for x in out["items"]:
            assert x["title"] and x["refs"] and x["state"] == "open", (key, x)


def test_a_module_shows_what_the_planning_swarm_found_that_belongs_to_it(approved):
    assert {f["tag"] for f in A.view("documents")["findings"]} >= {"SUPERSEDED_DRAWING", "RFI_OPEN", "DOCUMENT_CONFLICT"}
    assert {f["tag"] for f in A.view("cost")["findings"]} >= {"BOQ_MISMATCH"}
    with pytest.raises(KeyError):
        A.view("nothing")


def test_code_drops_a_recommendation_that_cites_nothing_real_or_a_figure_not_in_the_records():
    records = {"activities": [{"id": "A50", "name": "Columns", "duration": 5}]}
    kept, dropped = A.checked([
        {"title": "Move A50 forward", "why": "It takes 5 days.", "refs": ["A50"]},
        {"title": "Chase RFI-999", "why": "It is late.", "refs": ["RFI-999"]},
        {"title": "Add crew to A50", "why": "It would save 47 days.", "refs": ["A50"]},
        {"title": "No evidence", "why": "None.", "refs": []},
        {"why": "No title.", "refs": ["A50"]},
        "not even an object",
    ], records)
    assert [x["title"] for x in kept] == ["Move A50 forward"] and dropped == 5


def test_a_real_agent_goes_through_the_same_check_and_never_changes_a_record(monkeypatch, approved):
    class Agent(llm.Scripted):
        def answer(self, results, tools):
            return '{"summary": "A50 is held.", "recommendations": [{"title": "Answer RFI-035", "why": "It holds A50.", "refs": ["RFI-035"], "action": {"type": "rfi", "subject": "Chase", "question": "When?", "to": "Engineer", "activity": "A50"}}, {"title": "Sack the engineer", "why": "RFI-777 is 900 days late.", "refs": ["RFI-777"]}]}'

    monkeypatch.setattr(A.config, "muse_ready", lambda: True)
    monkeypatch.setattr(A.llm, "muse", lambda *a, **k: Agent("mock/agent", tokens=100))
    before = len(P.all_of("rfi")), len(P.all_of("work_item"))
    out = asyncio.run(A.ask("documents", "muse"))
    assert [x["title"] for x in out["items"]] == ["Answer RFI-035"] and out["dropped"] == 1 and out["usd"] > 0
    assert (len(P.all_of("rfi")), len(P.all_of("work_item"))) == before, "a recommendation changes nothing"
    A.decide("documents", 0, "accept")
    made = P.get("advice", "documents")["items"][0]["made"]
    assert P.get("rfi", made)["status"] == "draft", "accepting makes a draft: a person still issues it"


def test_accepting_puts_a_recommendation_on_the_board_and_dismissing_changes_nothing(approved):
    out = asyncio.run(A.ask("quality", "mock"))
    i = next(n for n, x in enumerate(out["items"]) if x["action"]["type"] == "work_item")
    before = len(P.all_of("work_item"))
    A.decide("quality", i, "accept")
    rec = P.get("advice", "quality")["items"][i]
    assert len(P.all_of("work_item")) == before + 1 and P.get("work_item", rec["made"])["status"] == "open" and P.get("work_item", rec["made"])["proposed_by"] == "Quality agent"
    with pytest.raises(ValueError, match="already"):
        A.decide("quality", i, "accept")
    j = next(n for n, x in enumerate(P.get("advice", "quality")["items"]) if x["state"] == "open")
    A.decide("quality", j, "dismiss")
    assert len(P.all_of("work_item")) == before + 1
    with pytest.raises(KeyError):
        A.decide("quality", 99, "accept")


def test_a_model_that_answers_nothing_is_an_error_and_never_an_all_clear(monkeypatch):
    class Silent(llm.Scripted):
        def answer(self, results, tools):
            return ""

    monkeypatch.setattr(A.config, "muse_ready", lambda: True)
    monkeypatch.setattr(A.llm, "muse", lambda *a, **k: Silent("mock/silent"))
    with pytest.raises(ValueError, match="no answer"):
        asyncio.run(A.ask("documents", "muse"))
    assert P.get("advice", "documents") is None, "what it said before stands"
    with pytest.raises(ValueError, match="no answer"):
        asyncio.run(A.read_document("PLAN-DWG-S401-B", "muse"))


def test_a_real_agent_asks_muse_to_think_less_and_leaves_room_to_answer():
    model = llm.muse("muse-spark-1.3", A.ANSWER_TOKENS, effort="low")
    assert model.model_config_dict == {"temperature": 0.1, "max_tokens": 8000, "reasoning_effort": "low"}
    assert "reasoning_effort" not in llm.muse("muse-spark-1.3").model_config_dict


def test_a_real_agent_needs_a_key(monkeypatch):
    monkeypatch.setattr(A.config, "muse_ready", lambda: False)
    with pytest.raises(ValueError, match="META_API_KEY"):
        asyncio.run(A.ask("schedule", "muse"))
    with pytest.raises(ValueError, match="mode"):
        asyncio.run(A.ask("schedule", "nonsense"))
    with pytest.raises(KeyError):
        asyncio.run(A.ask("nothing", "mock"))


# ------------------------------------------------------------------------------------------------ the control tower


def test_the_tower_reads_every_module_from_the_module_itself(approved):
    t = M.tower()
    assert {h["key"] for h in t["health"]} == {"wbs", "schedule", "cost", "kanban", "documents", "procurement", "quality"}
    assert t["bottlenecks"][0]["ref"] == M.board()["bottlenecks"][0]["ref"] and t["progress"]["tasks"] == M.board()["counts"]
    assert next(h for h in t["health"] if h["key"] == "quality")["tone"] == "bad"
    P.close_ncr("NCR-014", "Done.")
    assert next(h for h in M.tower()["health"] if h["key"] == "quality")["tone"] == "ok"


def test_the_workflow_row_opens_each_module(approved):
    row = next(x for x in P.overview()["chain"] if x["id"] == "WP-STR")
    assert [s["key"] for s in row["steps"]] == ["wbs", "schedule", "cost", "documents", "kanban", "inspection", "procurement", "subcontractor", "claim", "payment"]
    assert next(s for s in row["steps"] if s["key"] == "wbs")["tab"] == "wbs/tree:1.1" and next(s for s in row["steps"] if s["key"] == "kanban")["text"] == "0 of 18 done"
    assert all("/" in s["tab"] for s in row["steps"]), "every cell opens a module's tab"


def test_every_attention_item_opens_a_module(approved):
    tabs = {a["tab"].split("/")[0] for a in P.checks()}
    assert tabs <= {"wbs", "schedule", "cost", "kanban", "documents", "procurement", "quality"}, tabs


def test_the_risk_register_combines_what_code_detects_with_what_people_register(records):
    reg = M.risk_register()
    detected = [r for r in reg["risks"] if r["source"] == "detected"]
    assert detected and reg["counts"]["detected"] == len(detected) == len(P.checks())
    assert all(r["score"] == r["probability"] * r["impact"] and r["status"] == "open" and r["go"] for r in detected)
    assert [r["score"] for r in reg["risks"]] == sorted((r["score"] for r in reg["risks"]), reverse=True)
    due = (date.fromisoformat(P.TODAY) + timedelta(days=7)).isoformat()
    r = P.add_risk("Tower crane grounded by high wind", "External", "Casting and lifting stop until the wind drops.", "A60", 4, 5, "Site manager", "Mitigate", "Book the crane early and pour at first light.", due)
    assert r["id"].startswith("RSK-")
    row = next(x for x in M.risk_register()["risks"] if x["id"] == r["id"])
    assert row["source"] == "register" and row["score"] == 20 and row["level"] == "extreme" and not row["overdue"]
    P.set_risk(r["id"], probability=2, status="mitigating")
    row = next(x for x in M.risk_register()["risks"] if x["id"] == r["id"])
    assert row["score"] == 10 and row["level"] == "high" and row["status"] == "mitigating" and row["owner"] == "Site manager"
    with pytest.raises(ValueError):
        P.add_risk("Scored off the scale", probability=6)
    with pytest.raises(ValueError):
        P.set_risk(r["id"], status="gone")
    with pytest.raises(KeyError):
        P.set_risk("RSK-999", status="closed")


def test_the_risk_register_through_the_api(client):
    made = client.post("/api/project/risks", json={"title": "Ready-mix plant breakdown", "category": "Procurement & materials", "probability": 2, "impact": 4, "owner": "Procurement officer"}).json()
    assert made["id"].startswith("RSK-")
    reg = client.get("/api/project/risks").json()
    assert any(r["id"] == made["id"] and r["score"] == 8 and r["level"] == "medium" for r in reg["risks"])
    assert client.post(f"/api/project/risks/{made['id']}", json={"status": "monitoring"}).json()["status"] == "monitoring"
    assert client.post("/api/project/risks", json={"title": "Off the scale", "probability": 9}).status_code == 409
    assert client.post("/api/project/risks/RSK-999", json={"status": "closed"}).status_code == 404


def test_the_api_starts_as_a_module(monkeypatch):
    """`python -m swarm.firm_api` must reach the server: every name its __main__ block uses is imported."""
    import runpy

    import uvicorn

    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: None)
    runpy.run_module("swarm.firm_api", run_name="__main__")


# ------------------------------------------------------------------------------------------------ a project of your own


def new_project(**k):
    P.create_project("Gedung Baru", "Pemilik", "Kontraktor", "Surabaya", "2027-01-04", "2027-12-31", **k)
    return P.projects()["active"]


def test_a_new_project_has_its_own_records_and_nothing_of_the_scenario(records):
    pid = new_project()
    assert pid.startswith("pj-") and P.is_blank() and P.DB != records and P.TODAY != C.TODAY
    assert P.all_of("rfi") == [] and P.all_of("po") == [] and P.all_of("subcontractor") == [] and P.claim() is None
    assert P.C_PROJECT()["name"] == "Gedung Baru" and P.schedule()["milestone"] is None and P.schedule()["activities"][0]["start"] == "2027-01-04"
    assert M.documents()["documents"] == [] and M.photos()["photos"] == [] and M.tree()["root"]["name"] == "Gedung Baru"


def test_a_new_project_starts_from_a_breakdown_if_asked_and_empty_if_not():
    new_project()
    assert len(M.tree()["root"]["children"]) == 5 and len(P.schedule()["activities"]) == 9
    starts = [a["start"] for a in P.schedule()["activities"]]
    assert starts == sorted(starts) and len(set(starts)) == 9, "they run one after the other"
    new_project(template=False)
    assert M.tree()["root"]["children"] == [] and P.schedule()["activities"] == []


def test_switching_projects_keeps_each_ones_records_apart():
    pid = new_project()
    P.add_work_item("Pasang bouwplank", "Mandor", "2027-01-10")
    assert len(P.all_of("work_item")) == 1
    P.open_project("scenario")
    assert P.all_of("work_item") == [] and not P.is_blank() and P.TODAY == C.TODAY and len(P.all_of("rfi")) > 0
    P.open_project(pid)
    assert len(P.all_of("work_item")) == 1 and P.is_blank()
    with pytest.raises(KeyError):
        P.open_project("pj-nothing")
    with pytest.raises(ValueError):
        P.create_project("  ")


def test_a_project_of_your_own_is_never_reset_and_runs_no_scenario_review(client):
    new_project()
    assert client.post("/api/project/reset", json={}).status_code == 409
    with pytest.raises(ValueError, match="only the scenario"):
        P.reset()
    assert client.post("/api/aip/konsultan", json={"nama": "x", "versi": "mock", "jenis": "plan"}).status_code == 409


def test_a_whole_project_can_be_built_by_hand_and_every_module_follows():
    new_project(template=False)
    p = P.add_package("Struktur", "", 0)
    a = P.add_activity("Kolom lantai 1", p["id"], 5)
    b = P.add_activity("Balok lantai 2", p["id"], 3, [a["id"]])
    assert b["start"] == "2027-01-09" and a["critical"] and b["critical"]
    P.add_milestone("Struktur selesai", b["id"], "2027-01-31")
    P.add_boq_line("Beton kolom", "m3", 10, 1_000_000, p["id"], a["id"])
    assert P.budget()["total"]["boq_value"] == 10_000_000
    w = P.add_work_item("Cor kolom", "Mandor", "2027-01-08", a["id"], physical=True)
    assert activity(a["id"])["progress_from"] == "tasks"
    P.set_work_item(w["id"], "done")
    assert activity(a["id"])["progress"] == 100 and P.budget()["total"]["ev"] > 0, "the board earns value through the schedule"
    assert any(x["ref"] == w["id"] for x in find(M.tree()["root"], a["code"])["children"])
    i = P.add_inspection("Cek tulangan", a["id"], "QC", "2027-01-06", "Spasi 150 mm, selimut 40 mm", True)
    assert len(i["checklist"]) == 2
    r = P.add_rfi({"subject": "Mutu beton", "question": "K-300 atau K-350?", "to": "Konsultan", "activity": b["id"], "due": "2027-01-05"}, "open", P.PM)
    assert not next(x for x in M.readiness()["activities"] if x["id"] == b["id"])["ready"] and r["id"] == "RFI-036"
    P.add_order("Semen", "Toko", b["id"], "2027-01-09", "2027-01-15", 5_000_000)
    assert any(x["rule"] == "late_delivery" for x in P.checks())


def test_the_consultants_package_is_not_offered_on_a_project_of_your_own(client):
    assert client.get("/api/project/plan-package").json()["scenario"] is True
    new_project()
    assert client.get("/api/project/plan-package").json() == {"documents": [], "scope": {}, "scenario": False}


def test_every_screen_answers_on_an_empty_project(client):
    new_project(template=False)
    for path in ("overview", "tower", "wbs", "schedule", "budget", "boq", "board", "documents", "readiness", "subcontractors", "procurement", "materials", "suppliers", "assignments", "quality", "photos", "daily-reports", "claim", "decisions", "plans", "agents"):
        assert client.get(f"/api/project/{path}").status_code == 200, path
    for key in A.BENCH:
        assert client.post(f"/api/project/agents/{key}/ask", json={"mode": "mock"}).status_code == 200, key
        assert client.get(f"/api/project/agents/{key}").status_code == 200, key


def test_every_screen_answers_on_the_scenario_through_the_api(client):
    for path in ("overview", "tower", "wbs", "schedule", "budget", "boq", "board", "documents", "readiness", "subcontractors", "procurement", "materials", "suppliers", "assignments", "quality", "photos", "daily-reports", "claim", "decisions", "plans", "agents"):
        assert client.get(f"/api/project/{path}").status_code == 200, path
    assert client.get("/api/project/wbs/node", params={"code": "1.1.1"}).status_code == 200
    assert client.get("/api/project/wbs/node", params={"code": "9"}).status_code == 404


def test_the_whole_chain_through_the_api_from_plan_to_control_tower(client):
    """One plan, followed through every module: what the app is for."""
    run = client.post("/api/aip/konsultan", json={"nama": "Plan", "versi": "mock", "jenis": "plan"}).json()["run"]
    import time

    until = time.time() + 60
    while time.time() < until and client.get(f"/api/aip/runs/{run}?after=0").json()["run"]["status"] == "running":
        time.sleep(0.05)
    plan = client.get("/api/project/plans").json()["plans"][0]
    assert plan["id"].startswith("WBS-") and client.get("/api/project/board").json()["waiting"]["tasks"] == 18
    assert client.post(f"/api/project/plans/{plan['id']}/approve", json={"note": "Go."}).status_code == 200
    cards = {c.get("step"): c for c in client.get("/api/project/board").json()["cards"]}
    assert client.post(f"/api/project/work-items/{cards['O-9']['id']}", json={"status": "doing"}).status_code == 409, "the hold point stops it"
    assert client.post(f"/api/project/work-items/{cards['I-2']['id']}", json={"status": "done"}).status_code == 409, "only QA/QC closes an inspection"
    assert client.post("/api/project/ncrs/NCR-014/close", json={"action": "Reworked."}).status_code == 200
    hold = next(i for i in client.get("/api/project/quality").json()["inspections"] if i["id"] == "HP-21")
    assert client.post("/api/project/inspections/HP-21/result", json={"result": "pass", "checklist": [{**c, "ok": True} for c in hold["checklist"]], "note": "Signed."}).status_code == 200
    finish_prerequisites(P.get("work_item", cards["O-9"]["id"]))
    assert client.post(f"/api/project/work-items/{cards['O-9']['id']}", json={"status": "doing", "owner": "Mandor A", "progress": 50}).status_code == 200
    a50 = next(a for a in client.get("/api/project/schedule").json()["activities"] if a["id"] == "A50")
    assert a50["progress"] > 0 and a50["progress_from"] == "tasks" and any(t["status"] == "doing" for t in a50["tasks"])
    tower = client.get("/api/project/tower").json()
    assert tower["progress"]["actual"] > 0 and tower["progress"]["tasks"]["doing"] == 1
    assert next(h for h in tower["health"] if h["key"] == "quality")["tone"] == "ok"


def test_an_uploaded_document_can_be_linked_to_an_activity_later(client):
    d = client.post("/api/project/documents", files={"file": ("note.txt", io.BytesIO(b"Column C2 note."), "text/plain")}, data={"title": "Note"}).json()
    assert d["activities"] == []
    assert client.post(f"/api/project/documents/{d['id']}/link", json={"activity": "A50"}).status_code == 200
    assert next(x for x in client.get("/api/project/documents").json()["documents"] if x["id"] == d["id"])["activities"] == ["A50"]
    assert client.post(f"/api/project/documents/{d['id']}/link", json={"activity": "Z99"}).status_code == 409
    assert client.post("/api/project/documents/PLAN-RKS-03/link", json={"activity": "A50"}).status_code == 404
def test_bad_dates_verdicts_and_negative_lines_are_refused_before_they_are_stored(records):
    acts = P.schedule()["activities"]
    with pytest.raises(ValueError):
        P.add_milestone("Hand over", acts[0]["id"], "next Friday")
    with pytest.raises(ValueError):
        P.add_boq_line("Negative concrete", "m3", -2, -500, acts[0]["package"])
    with pytest.raises(ValueError):
        P.add_boq_line("Free concrete", "m3", 2, 0, acts[0]["package"])
    r = P.add_rfi({"id": "FAKE-1", "status": "closed", "subject": "Which sleeve?", "to": "Engineer"}, "open", P.PM)
    assert r["id"].startswith("RFI-") and r["id"] != "FAKE-1" and r["status"] == "open", "a caller's fields never override the record's own id or status"


def test_a_plan_cannot_be_decided_with_a_word_that_is_not_a_verdict(approved):
    plan = P.all_of("plan")[0]
    P.patch("plan", plan["id"], {"status": "pending"}, P.PM, "test", "reopen")
    with pytest.raises(ValueError):
        P.decide_plan(plan["id"], "ok")
    assert P.get("plan", plan["id"])["status"] == "pending"


def test_a_second_plan_does_not_wipe_an_inspection_that_was_already_signed(approved):
    plan = P.all_of("plan")[0]
    signed = next(i for i in P.all_of("inspection") if i["status"] == "passed")
    again = {**plan, "id": "WBS-zzzzzz", "status": "pending", "title": "Second look"}
    P.put("plan", again["id"], again, P.PM, "test", "second plan")
    P.decide_plan(again["id"], "approve")
    kept = P.get("inspection", signed["id"])
    assert kept["status"] == "passed" and kept["date"] == signed["date"]


def test_the_swarm_api_refuses_an_unknown_version_and_an_unknown_cancel(client):
    assert client.post("/api/aip/konsultan", json={"nama": "Typo", "versi": "muse2"}).status_code == 400
    assert client.post("/api/aip/runs/run-nope/cancel").status_code == 404
    sim = client.get("/api/aip/konsultan/simulasi")
    assert sim.status_code == 200 and sim.json()["run"]["simulation"] and sim.json()["events"], "the animation replays a trail without calling a real model"
def test_the_operator_reads_through_its_tools_and_code_checks_its_figures(records):
    from swarm import operator as OP

    events: list[dict] = []
    tools = OP._Tools(events.append)
    by_name = {f.__name__: f for f in tools.list()}
    out = by_name["risiko"]()
    assert out["risks"] and [e["type"] for e in events] == ["tool_mulai", "tool", "result"]
    assert OP._foreign("There are 42 delays and 3 risks on the board.", ["3 risks, 35 cards"]) == ["42"]
    assert OP._foreign("3 of the 35 cards are done.", ["3 risks, 35 cards"]) == []
    runs = {"run-1": {"run": {"kind": "operator", "q": "first", "answer": "one", "follow": None}}, "run-2": {"run": {"kind": "operator", "q": "second", "answer": "two", "follow": "run-1"}}}
    assert [t["q"] for t in OP.thread_of(runs, "run-2")] == ["first", "second"]


def test_asking_the_operator_runs_a_conversation_the_screen_can_follow(client, monkeypatch):
    import asyncio
    import time as _time

    from swarm import config as cfg
    from swarm import operator as OP

    seen: dict = {}

    async def fake_ask(q, thread, tab, emit, model=None):
        seen["thread"] = thread
        emit({"type": "delta", "seg": 1, "text": "Working on it. "})
        emit({"type": "answer", "text": "3 of the 35 cards are done.", "model": "muse-spark"})
        return {"answer": "3 of the 35 cards are done.", "usd": 0.001, "tokens": {"prompt": 10, "output": 5}}

    monkeypatch.setattr(cfg, "muse_ready", lambda: True)
    monkeypatch.setattr(OP, "ask", fake_ask)
    first = client.post("/api/aip/operator", json={"q": "How far along are we?", "tab": "analysis"}).json()["run"]
    for _ in range(100):
        r = client.get(f"/api/aip/runs/{first}").json()
        if r["run"]["status"] != "running":
            break
        _time.sleep(0.05)
    assert r["run"]["status"] == "succeeded" and r["run"]["kind"] == "operator" and r["run"]["answer"] == "3 of the 35 cards are done."
    assert any(e["type"] == "answer" for e in r["events"])
    second = client.post("/api/aip/operator", json={"q": "And the risks?", "follow": first}).json()["run"]
    for _ in range(100):
        r2 = client.get(f"/api/aip/runs/{second}").json()
        if r2["run"]["status"] != "running":
            break
        _time.sleep(0.05)
    assert seen["thread"] and seen["thread"][0]["q"] == "How far along are we?", "a follow-up reads the conversation it follows"
    assert client.post("/api/aip/operator", json={"q": "  "}).status_code == 400
def test_the_boards_top_priority_is_the_earliest_node_on_the_critical_path(approved):
    b = M.board()
    live = [c for c in b["cards"] if c["status"] in ("open", "doing", "review")]
    ranked = sorted(live, key=lambda c: c["cpm_rank"])
    assert [c["cpm_rank"] for c in ranked] == list(range(1, len(ranked) + 1)), "every live card carries one priority rank"
    crit = [c for c in ranked if c["critical"]]
    assert crit and crit == ranked[:len(crit)], "critical-path cards outrank everything else"
    starts = [(c.get("start") or "9999", c["float_days"] if c.get("float_days") is not None else 9999) for c in crit]
    assert starts == sorted(starts), "and among them the earliest node comes first"
    assert b["priority"]["id"] == crit[0]["id"] and b["priority"]["rank"] == crit[0]["cpm_rank"]
def test_a_card_cannot_start_until_its_prerequisite_is_done(approved):
    cards = [c for c in M.board()["cards"] if c["type"] == "task" and c["status"] in ("open", "doing", "review")]
    by_step = {(c.get("plan"), c.get("step")): c for c in cards}
    waiting = next(c for c in sorted(cards, key=lambda c: c["cpm_rank"]) if P.unfinished_prerequisites(c))
    first = P.unfinished_prerequisites(waiting)[0]
    root = by_step[(waiting["plan"], first["step"])]
    assert not P.unfinished_prerequisites(root), "the test needs a prerequisite that can itself be finished"
    with pytest.raises(ValueError, match="must be done first"):
        P.set_work_item(waiting["id"], "doing")
    with pytest.raises(ValueError, match="must be done first"):
        P.set_work_item(waiting["id"], "done")
    P.set_work_item(root["id"], "doing")
    P.set_work_item(root["id"], "done")
    if len(P.unfinished_prerequisites(waiting)) == 0:
        P.set_work_item(waiting["id"], "doing")
        assert P.get("work_item", waiting["id"])["status"] == "doing"


def test_an_activity_card_cannot_start_until_its_predecessor_finishes(approved):
    card = next(c for c in M.board()["cards"] if c["type"] == "activity" and c["blockers"] and all(b["kind"] == "activity" for b in c["blockers"]))
    pred = next(b["ref"] for b in card["blockers"] if b["kind"] == "activity")
    with pytest.raises(ValueError, match="must finish first"):
        M.move_activity_card(card["id"], "doing")
    P.update_activity(pred, 100, None)
    M.move_activity_card(card["id"], "doing")


def test_who_does_a_work_package_can_be_changed(approved):
    """Choosing self-perform or a subcontractor programmes the activity and moves its open cards; that is what the WBS node's Who does this work control does."""
    P.update_activity("A50", None, None, None, "arus")
    assert next(x for x in P.schedule()["activities"] if x["id"] == "A50")["by"] == "arus"
    row = next(r for r in M.assignments()["rows"] if r["activity"] == "A50" and r["sections"])
    assert row["programmed"] == "arus"
    moved = M.reassign("A50", row["sections"][0], "self")
    assert moved["owner"] == "Own crew"
    assert all(w["owner"] == "Own crew" for w in P.all_of("work_item") if w.get("activity") == "A50" and w.get("section") == row["sections"][0] and w["status"] in ("open", "doing", "review"))


def test_subcontractor_partner_database(records):
    """The partner database: a subcontractor added with its contact is an option wherever work is given out, and its details can be corrected."""
    s = P.add_subcontractor("PT Uji Beton", "Concrete", "Columns and beams", 12, contact="Budi", phone="0812")
    assert s["status"] == "onboarding" and s["contact"] == "Budi"
    P.set_subcontractor(s["id"], crew=20, phone="0813")
    row = next(x for x in P.subcontractors() if x["id"] == s["id"])
    assert row["crew"] == 20 and row["phone"] == "0813"
    sub = next(x for x in M.assignments()["subs"] if x["id"] == s["id"])
    assert sub["trade"] == "Concrete" and sub["crew"] == 20 and sub["status"] == "onboarding"
    with pytest.raises(ValueError):
        P.set_subcontractor(s["id"], name="  ")
    with pytest.raises(KeyError):
        P.set_subcontractor("sub-nope", crew=1)


def test_sample_partners_seed_and_remove(records):
    """Sample partners fill an empty database once; one comes out again, but not while work is programmed to them."""
    made = P.seed_sample_subcontractors()
    assert len(made) == 5 and P.seed_sample_subcontractors() == []
    beton = next(x for x in P.subcontractors() if "Beton Karya" in x["name"])
    assert beton["status"] == "active" and beton["rating"] == "good" and beton["contact"]
    P.update_activity("A50", None, None, None, beton["id"])
    with pytest.raises(ValueError, match="programmed"):
        P.remove_subcontractor(beton["id"])
    P.update_activity("A50", None, None, None, "self")
    assert P.remove_subcontractor(beton["id"])["removed"] == beton["id"]
    assert all(x["id"] != beton["id"] for x in P.subcontractors())


def test_node_detail_resolves_ids_and_plan_codes(approved):
    """A click may carry a record id, or a code from a plan document's own numbering: both land on the live node for the same work, and only a truly unknown code is refused."""
    plan = M.live_plan()["plan"]
    step = plan["steps"][0]
    by_id = M.node_detail(step["activity"])
    assert by_id["node"]["type"] == "activity" and by_id["node"]["ref"] == step["activity"]
    by_step = M.node_detail(step["code"])
    assert by_step["node"]["ref"] == step["id"]
    branch = next(b for b in plan["tree"] if b["activity"] == step["activity"])
    by_branch = M.node_detail(branch["code"])
    assert by_branch["node"]["ref"] == step["activity"]
    with pytest.raises(KeyError):
        M.node_detail("9.99.9")

"""Offline tests of the project records, the decision loop and the API. No model is called and nothing leaves this machine. They prove the wiring and the rules, not how well a real model reasons."""

from __future__ import annotations

import asyncio
import re
import shutil
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from swarm import firm, firm_api, llm, project as P, site_case as C
from swarm.mock_firm import MockFirmLlm

ROOT = Path(__file__).resolve().parent.parent
BASE_EAC = 6_445_947_200


def _close() -> None:
    if P._conn is not None:
        P._conn.close()
        P._conn = None


@pytest.fixture(scope="session")
def template(tmp_path_factory):
    """The seeded records, once: each test starts from its own copy."""
    saved, P.DB = P.DB, tmp_path_factory.mktemp("records") / "seed.db"
    P._db()
    path = P.DB
    _close()
    P.DB = saved
    return path


@pytest.fixture(scope="session")
def review(template, tmp_path_factory):
    """A scripted review, finished once: record_review can then lay it on any copy of the records."""
    saved, P.DB = P.DB, tmp_path_factory.mktemp("review") / "project.db"
    shutil.copy(template, P.DB)
    events: list[dict] = []

    async def go():
        firm._emit.set(events.append)
        f = firm.Firm(lambda key, model, n: MockFirmLlm(model=f"mock/{key}", agent_key=key), 5, firm.BRIEF, mock=True)
        await f.engagement()
        return f

    f = asyncio.run(go())
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


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(firm_api, "STORE", tmp_path / "runs")
    monkeypatch.setattr(firm_api, "RUNS", {})
    monkeypatch.setattr(firm_api, "TASKS", {})
    monkeypatch.setattr(firm_api, "PROJECTS", {})
    monkeypatch.setattr(firm_api, "MOCK_DELAY", 0)
    with TestClient(firm_api.app) as c:
        yield c


def ended(client, run_id: str, seconds: int = 60) -> dict:
    until = time.time() + seconds
    while time.time() < until:
        r = client.get(f"/api/aip/runs/{run_id}?after=0").json()
        if r["run"]["status"] != "running":
            return r
        time.sleep(0.1)
    raise AssertionError("the run never ended")


# ------------------------------------------------------------------------------------------------ what code finds in the records


def test_the_rules_flag_all_four_things_blocking_the_pour():
    high = {(a["rule"], a["ref"]) for a in P.checks() if a["level"] == "high"}
    assert high == {("open_ncr", "NCR-014"), ("late_delivery", "PO-118"), ("crew_short", "A30"), ("weather", "A30")}


def test_earned_value_adds_up():
    b = P.budget()
    for key in ("budget", "committed", "pv", "ev", "ac", "eac"):
        assert b["total"][key] == sum(p[key] for p in b["packages"]), key
    t = b["total"]
    assert t["cpi"] == round(t["ev"] / t["ac"], 2) and t["spi"] == round(t["ev"] / t["pv"], 2)
    assert t["eac"] == BASE_EAC
    assert t["variance"] == t["budget"] - t["eac"]


def test_the_schedule_is_worked_out_from_the_case_and_nothing_else():
    plan = P.schedule()
    assert plan["milestone"] == C.schedule()["milestone"]
    pour = next(a for a in plan["activities"] if a["id"] == C.POUR)
    assert pour["start"] == "2026-10-06" and pour["critical"]
    assert pour["baseline_start"] == pour["start"]
    assert {"NCR-014"} <= set(next(a for a in plan["activities"] if a["id"] == "A20")["ncrs"])
    assert "PO-118" in pour["pos"]


def test_a_longer_critical_activity_makes_the_milestone_late_and_undoing_it_restores_the_scenario():
    assert P.as_seeded()
    P.update_activity("A40", None, 5)
    m = P.schedule()["milestone"]
    assert m["days_late"] == 2 and m["forecast"] == "2026-10-27"
    assert any(a["rule"] == "milestone_late" for a in P.checks())
    assert not P.as_seeded()
    P.update_activity("A40", None, 3)
    assert P.schedule()["milestone"]["days_late"] == 0
    assert P.as_seeded()


def test_a_cost_moves_the_forecast_of_its_package_only():
    before = {p["id"]: p["eac"] for p in P.budget()["packages"]}
    P.add_cost_item("WP-CON", "Curing blankets", 4_000_000)
    after = {p["id"]: p["eac"] for p in P.budget()["packages"]}
    assert after["WP-CON"] - before["WP-CON"] == 4_000_000
    assert all(after[k] == before[k] for k in before if k != "WP-CON")


# ------------------------------------------------------------------------------------------------ subcontractors


def test_a_subcontractor_cannot_be_approved_with_a_document_missing_or_expired():
    s = P.add_subcontractor("Test Waterproofing (fictional)", "Waterproofing", "Roof", 5)
    with pytest.raises(ValueError, match="missing Company licence"):
        P.approve_subcontractor(s["id"])
    for name in P.REQUIRED_DOCS[:-1]:
        P.add_sub_document(s["id"], name, "2027-06-30")
    P.add_sub_document(s["id"], P.REQUIRED_DOCS[-1], "2026-01-01")
    with pytest.raises(ValueError, match="has expired"):
        P.approve_subcontractor(s["id"])
    P.add_sub_document(s["id"], P.REQUIRED_DOCS[-1], "2027-06-30")
    assert P.approve_subcontractor(s["id"])["status"] == "active"


def test_certifying_stops_at_the_verified_work_and_payment_holds_back_retention():
    i = P.get("invoice", "INV-45")
    assert i["certified_to_date"] + i["claimed"] > i["earned_to_date"]
    done = P.invoice_action("INV-45", "certify")
    assert done["certified"] == i["earned_to_date"] - i["certified_to_date"] < i["claimed"]
    assert done["certified_to_date"] == i["earned_to_date"]
    paid = P.invoice_action("INV-45", "pay")
    assert paid["paid_to_date"] == i["paid_to_date"] + round(done["certified"] * 0.95)
    s = next(x for x in P.subcontractors() if x["id"] == "selubung")
    assert abs(s["retention_held"] - i["earned_to_date"] * 0.05) <= 1


def test_an_honest_invoice_is_certified_in_full():
    i = P.get("invoice", "INV-41")
    assert i["certified_to_date"] + i["claimed"] <= i["earned_to_date"]
    assert P.invoice_action("INV-41", "certify")["certified"] == i["claimed"]


def test_an_invoice_only_moves_forward():
    with pytest.raises(ValueError):
        P.invoice_action("INV-45", "pay")
    P.invoice_action("INV-45", "certify")
    with pytest.raises(ValueError):
        P.invoice_action("INV-45", "certify")
    with pytest.raises(KeyError):
        P.invoice_action("INV-99", "certify")


def test_a_subcontractor_billing_ahead_goes_on_watch_until_it_is_dealt_with():
    assert next(x for x in P.subcontractors() if x["id"] == "selubung")["rating"] == "watch"
    P.invoice_action("INV-45", "certify")
    assert next(x for x in P.subcontractors() if x["id"] == "selubung")["rating"] == "good"


# ------------------------------------------------------------------------------------------------ quality, procurement, reports, RFIs: live, and read by the agents


def test_closing_the_ncr_signs_the_hold_point_and_changes_what_the_agents_read():
    assert "signed hold point" not in str(P.documents("inspection"))
    P.close_ncr("NCR-014", "Rebar reset to the drawing.")
    q = P.quality()
    assert next(i for i in q["inspections"] if i["id"] == "HP-07")["status"] == "passed"
    read = P.documents("inspection")
    assert "signed hold point HP-07" in str(read["documents"]) and not read["open_ncrs"]
    assert not any(a["rule"] == "open_ncr" for a in P.checks())
    assert not next(a for a in P.schedule()["activities"] if a["id"] == "A20")["ncrs"]
    with pytest.raises(ValueError):
        P.close_ncr("NCR-014", "Again.")


def test_a_new_promised_date_clears_a_late_delivery_and_the_agents_read_it():
    P.po_action("PO-118", "promise", "2026-10-06")
    assert not any(a["rule"] == "late_delivery" and a["ref"] == "PO-118" for a in P.checks())
    assert next(o for o in P.documents("purchase_order")["orders"] if o["id"] == "PO-118")["promised"] == "2026-10-06"


def test_a_daily_report_stays_unverified_until_someone_verifies_it():
    r = P.add_daily_report({"area": "Level 3", "text": "Rebar re-inspected.", "package": "WP-REB", "crew": 26})
    assert not r["verified"]
    row = next(x for x in P.overview()["chain"] if x["id"] == "WP-REB")
    assert next(s for s in row["steps"] if s["key"] == "kanban")["sub"] == "1 to verify"
    assert r in P.daily_reports("Level 3")
    assert P.verify_daily_report(r["id"])["verified"]


def test_every_package_counts_the_reports_that_mention_its_work():
    row = next(x for x in P.overview()["chain"] if x["id"] == "WP-REB")
    assert next(s for s in row["steps"] if s["key"] == "kanban")["sub"].endswith("reports")


def test_an_agents_rfi_draft_is_hidden_from_the_log_until_a_person_issues_it():
    r = P.add_rfi({"subject": "Curing", "question": "How long?", "to": "Engineer", "activity": "A50", "impact": "No float", "drafted_by": "contract_rfi"}, "draft", P.SWARM)
    read = lambda: [x["id"] for x in P.documents("rfi")["documents"]]  # noqa: E731
    assert r["status"] == "draft" and r["id"] not in read()
    assert P.as_seeded(), "a draft changes nothing yet"
    issued = P.issue_rfi(r["id"])
    assert issued["status"] == "open" and issued["ball_in_court"] == "Engineer" and r["id"] in read()
    with pytest.raises(ValueError):
        P.issue_rfi(r["id"])
    with pytest.raises(ValueError):
        P.answer_rfi(r["id"], "  ")
    assert P.answer_rfi(r["id"], "Three days.")["status"] == "answered"


def test_answering_rfi_035_clears_its_flag():
    assert any(a["rule"] == "rfi_critical" for a in P.checks())
    P.answer_rfi("RFI-035", "Move the sleeve 150 mm.")
    assert not any(a["rule"] == "rfi_critical" for a in P.checks())


# ------------------------------------------------------------------------------------------------ claims and payments


def test_the_claim_totals_and_certificate_add_up():
    c = P.claim()
    t, cert = c["totals"], c["certificate"]
    assert t["recommended"] == t["claimed"] - t["beyond_evidence"] + t["not_billed"] - t["billing_errors"]
    assert t["recommended"] == sum(x["recommended"] for x in c["lines"])
    assert cert["this_period"] == t["recommended"] - cert["previous"]
    assert cert["retention"] + cert["payable"] == cert["this_period"]


def test_the_claim_moves_in_order_and_what_is_submitted_is_what_is_certified():
    with pytest.raises(ValueError):
        P.claim_action("certify")
    with pytest.raises(ValueError):
        P.claim_action("paid")
    recommended = P.claim()["totals"]["recommended"]
    assert P.claim_action("submit", True)["submitted"] == recommended
    with pytest.raises(ValueError):
        P.claim_action("submit", True)
    assert P.claim_action("certify")["certified"] == recommended
    assert P.claim_action("paid")["status"] == "paid"
    assert not any(a["rule"] == "claim_mismatch" for a in P.checks())


# ------------------------------------------------------------------------------------------------ the trail, and starting again


def test_every_change_lands_in_the_audit_trail_with_who_did_it():
    assert P.audit() == []
    P.close_ncr("NCR-014", "Reset.", "Quality manager")
    P.invoice_action("INV-45", "certify", "Project manager")
    actions = {(a["who"], a["action"]) for a in P.audit()}
    assert ("Quality manager", "closed an NCR") in actions
    assert ("Quality manager", "signed off an inspection") in actions
    assert ("Project manager", "certified an invoice") in actions


def test_reset_brings_the_scenario_back():
    P.add_subcontractor("Temporary Co (fictional)", "Other", "", 1)
    P.close_ncr("NCR-014", "Reset.")
    assert not P.as_seeded()
    P.reset()
    assert P.as_seeded() and P.audit() == [] and len(P.checks()) == 14
    assert not any("Temporary" in s["name"] for s in P.subcontractors())


def test_a_database_from_an_older_shape_starts_the_scenario_again():
    db = P._db()
    db.execute("update meta set value = 'old' where key = 'seeded'")
    db.execute("delete from records where kind = 'invoice'")
    db.commit()
    _close()
    assert len(P.all_of("invoice")) == 5
    assert "certified_to_date" in P.get("invoice", "INV-45")


# ------------------------------------------------------------------------------------------------ the decision: agents propose, people decide


def test_the_scripted_review_finds_the_plan_without_errors(review):
    f, events = review
    assert f.chosen == "O3"
    assert not [e for e in events if e["type"] == "error"]
    assert next(e for e in events if e["type"] == "engagement")["statistik"]["recommended"] == "O3"


def test_a_finished_review_changes_nothing_until_a_person_decides(review):
    before = P.overview()
    rec = P.record_review("run-aaaaaa", review[0], "mock")
    after = P.overview()
    assert rec["status"] == "pending" and rec["recommended"] == "O3"
    assert after["pour"]["start"] == before["pour"]["start"] and after["kpis"] == before["kpis"] and after["milestone"] == before["milestone"]
    assert after["counts"]["pending_decisions"] == 1 and after["counts"]["open_work_items"] == 0 and after["counts"]["draft_messages"] >= 1
    assert all(w["status"] == "proposed" for w in P.all_of("work_item")) and all(m["status"] == "draft" for m in P.all_of("message"))
    assert after["latest_decision"]["id"] == rec["id"]


def test_approving_moves_the_schedule_adds_the_cost_and_opens_the_work_items(review):
    rec = P.record_review("run-aaaaaa", review[0], "mock")
    done = P.decide(rec["id"], "approve", "", "Go.")
    o = P.overview()
    assert done["status"] == "approved" and done["option"] == "O3" and done["decided_by"] == P.PM
    assert o["pour"]["start"] == "2026-10-07" and o["milestone"]["forecast"] == "2026-10-25" and o["milestone"]["days_late"] == 0
    assert o["kpis"]["eac"] - BASE_EAC == 33_500_000 == sum(i["amount"] for i in P.budget()["cost_items"])
    assert {w["status"] for w in P.all_of("work_item")} == {"open"} and o["counts"]["open_work_items"] == 7
    assert not any(a["ref"] == "PO-118" for a in o["attention"])
    a50 = next(a for a in P.schedule()["activities"] if a["id"] == "A50")
    assert a50["start"] == "2026-10-11" and a50["duration"] == 4
    assert {"approved the recovery plan", "moved the schedule", "added cost to the forecast", "opened a work item"} <= {a["action"] for a in P.audit()}


def test_a_person_can_overrule_the_agents_and_the_numbers_follow_the_choice(review):
    rec = P.record_review("run-aaaaaa", review[0], "mock")
    assert next(o for o in rec["options"] if o["id"] == "O4")["verdict"] == "risky"
    P.decide(rec["id"], "approve", "O4")
    o = P.overview()
    assert o["milestone"]["days_late"] == 2 and o["kpis"]["eac"] - BASE_EAC == 81_000_000
    assert any(a["rule"] == "milestone_late" for a in o["attention"])
    assert any("Liquidated damages" in i["description"] for i in P.budget()["cost_items"])


def test_rejecting_leaves_the_schedule_and_budget_alone(review):
    rec = P.record_review("run-aaaaaa", review[0], "mock")
    before = P.overview()
    assert P.decide(rec["id"], "reject", note="Not yet.")["status"] == "rejected"
    after = P.overview()
    assert after["kpis"] == before["kpis"] and after["pour"]["start"] == before["pour"]["start"]
    assert {w["status"] for w in P.all_of("work_item")} == {"rejected"}


def test_a_decision_is_made_once_and_an_unknown_option_is_refused(review):
    rec = P.record_review("run-aaaaaa", review[0], "mock")
    with pytest.raises(ValueError):
        P.decide(rec["id"], "approve", "O9")
    assert P.get("decision", rec["id"])["status"] == "pending", "a refused choice changes nothing"
    assert P.overview()["kpis"]["eac"] == BASE_EAC
    P.decide(rec["id"], "approve")
    with pytest.raises(ValueError):
        P.decide(rec["id"], "approve")
    with pytest.raises(ValueError):
        P.decide(rec["id"], "reject")
    with pytest.raises(KeyError):
        P.decide("DEC-none", "approve")


def test_a_new_review_supersedes_a_pending_one_and_closes_its_proposals(review):
    first = P.record_review("run-aaaaaa", review[0], "mock")
    second = P.record_review("run-bbbbbb", review[0], "mock")
    assert P.get("decision", first["id"])["status"] == "superseded" and second["status"] == "pending"
    items, messages = P.all_of("work_item"), P.all_of("message")
    assert sum(w["status"] == "proposed" for w in items) == 7 and sum(w["status"] == "superseded" for w in items) == 7
    assert sum(m["status"] == "draft" for m in messages) == 1 and sum(m["status"] == "superseded" for m in messages) == 1
    assert P.overview()["counts"]["pending_decisions"] == 1


def test_approving_a_later_plan_replaces_the_earlier_one_in_the_schedule_and_the_forecast(review):
    first = P.record_review("run-aaaaaa", review[0], "mock")
    P.decide(first["id"], "approve", "O3")
    second = P.record_review("run-bbbbbb", review[0], "mock")
    P.decide(second["id"], "approve", "O1")
    o = P.overview()
    assert o["kpis"]["eac"] - BASE_EAC == C.evaluate("O1")["total_cost_rp"], "the first plan's cost must not stay in the forecast"
    assert o["pour"]["start"] == "2026-10-06"
    assert next(a for a in P.schedule()["activities"] if a["id"] == "A50")["duration"] == 5, "its night shift is no longer instructed"
    assert P.get("decision", first["id"])["status"] == "superseded"
    assert all(i["source"].startswith(second["id"]) for i in P.budget()["cost_items"])
    assert o["latest_decision"]["id"] == second["id"]


def test_a_message_needs_its_own_approval_and_the_demo_connector_says_it_sent_nothing(review):
    rec = P.record_review("run-aaaaaa", review[0], "mock")
    m = P.all_of("message")[0]
    assert m["status"] == "draft"
    P.decide(rec["id"], "approve")
    assert P.get("message", m["id"])["status"] == "draft", "approving the plan does not send its messages"
    assert P.message_action(m["id"], "approve")["status"] == "approved"
    assert "not really sent" in next(a["detail"] for a in P.audit() if a["action"] == "approved a message")
    with pytest.raises(ValueError):
        P.message_action(m["id"], "reject")


# ------------------------------------------------------------------------------------------------ what agents can reach


def test_the_swarm_code_only_reads_the_records():
    text = (ROOT / "swarm" / "firm.py").read_text(encoding="utf-8")
    used = set(re.findall(r"\bproject\.([a-zA-Z_]+)", text))
    assert used <= {"all_of", "as_seeded", "checks", "daily_reports", "documents", "schedule", "subcontractor_detail"}, used


def test_agents_only_called_tools_that_read_or_propose(review):
    tools = {e["tool"] for e in review[1] if e["type"] == "tool"}
    allowed = {"read_documents", "read_messages", "read_daily_logs", "list_site_photos", "view_site_photo", "subcontractor_record", "critical_path", "draft_rfi", "draft_message", "flag_signal", "read_signals",
               "propose_work_item", "read_team_reports", "read_disruption", "evaluate_option", "rule_option", "red_team_verdict", "read_rulings"}
    assert tools <= allowed, tools - allowed
    assert {"read_documents", "flag_signal", "propose_work_item", "rule_option"} <= tools


def test_the_demo_connector_has_no_way_to_send():
    text = (ROOT / "swarm" / "mcp_demo_server.py").read_text(encoding="utf-8")
    names = set(re.findall(r"def ([a-z_]+)\(", text))
    assert "draft_message" in names and not {n for n in names if "send" in n}


def test_the_start_form_defaults_to_the_offline_script():
    text = (ROOT / "ui" / "src" / "components" / "aip" / "ProjectViews.tsx").read_text(encoding="utf-8")
    assert 'const DEFAULT_VERSION = "mock";' in text


# ------------------------------------------------------------------------------------------------ the whole loop, through the API the screens use


def test_the_whole_loop_through_the_api(client):
    assert client.get("/api/project/overview").json()["latest_decision"] is None
    run_id = client.post("/api/aip/konsultan", json={"nama": "API check", "versi": "mock"}).json()["run"]
    r = ended(client, run_id)
    assert r["run"]["status"] == "succeeded" and not [e for e in r["events"] if e["type"] == "error"]
    assert r["run"]["spent_usd"] == 0
    d = client.get("/api/project/decisions").json()
    pending = [x for x in d["decisions"] if x["status"] == "pending"]
    assert len(pending) == 1 and pending[0]["recommended"] == "O3" and pending[0]["run"] == run_id and pending[0]["mode"] == "mock"
    assert any(x["status"] == "draft" and x["drafted_by"] == "contract_rfi" for x in client.get("/api/rfis").json()["rfis"]), "an agent's RFI draft reaches the register"
    assert client.post(f"/api/project/decisions/{pending[0]['id']}/approve", json={"option": "O3", "note": "Go."}).status_code == 200
    o = client.get("/api/project/overview").json()
    assert o["pour"]["start"] == "2026-10-07" and o["kpis"]["eac"] - BASE_EAC == 33_500_000 and o["counts"]["open_work_items"] == 7
    assert o["latest_decision"]["status"] == "approved"


def test_a_failure_recording_the_plan_ends_the_run_and_does_not_block_the_next(client, monkeypatch):
    def broken(*a, **k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(P, "record_review", broken)
    run_id = client.post("/api/aip/konsultan", json={"nama": "Broken", "versi": "mock"}).json()["run"]
    r = ended(client, run_id)
    assert r["run"]["status"] == "failed"
    assert any(e["type"] == "error" and "could not be recorded" in e["message"] for e in r["events"])
    following = client.post("/api/aip/konsultan", json={"nama": "Next", "versi": "mock"})
    assert following.status_code == 200
    client.post(f"/api/aip/runs/{following.json()['run']}/cancel")
    ended(client, following.json()["run"])


def test_stopping_a_run_leaves_no_decision(client, monkeypatch):
    monkeypatch.setattr(firm_api, "MOCK_DELAY", 0.05)
    run_id = client.post("/api/aip/konsultan", json={"nama": "Stopped", "versi": "mock"}).json()["run"]
    time.sleep(0.3)
    client.post(f"/api/aip/runs/{run_id}/cancel")
    assert ended(client, run_id)["run"]["status"] == "cancelled"
    assert client.get("/api/project/decisions").json()["decisions"] == []


def test_a_real_run_needs_a_key_and_one_run_goes_at_a_time(client, monkeypatch):
    monkeypatch.setattr(firm_api.config, "setting", lambda name, default="": "" if name == "META_API_KEY" else default)
    r = client.post("/api/aip/konsultan", json={"nama": "Real", "versi": "muse"})
    assert r.status_code == 400 and "META_API_KEY" in r.json()["detail"]
    monkeypatch.setattr(firm_api, "MOCK_DELAY", 0.05)
    run_id = client.post("/api/aip/konsultan", json={"nama": "First", "versi": "mock"}).json()["run"]
    assert client.post("/api/aip/konsultan", json={"nama": "Second", "versi": "mock"}).status_code == 409
    client.post(f"/api/aip/runs/{run_id}/cancel")
    ended(client, run_id)


def test_refusals_come_back_with_their_reason_and_unknown_records_as_not_found(client):
    new = client.post("/api/project/subcontractors", json={"name": "Temporary Co (fictional)", "trade": "Other", "scope": "", "crew": 1}).json()
    refused = client.post(f"/api/project/subcontractors/{new['id']}/approve", json={})
    assert refused.status_code == 409 and "missing Company licence" in refused.json()["detail"]
    assert client.post("/api/project/invoices/INV-99/certify", json={}).status_code == 404
    assert client.post("/api/project/invoices/INV-45/pay", json={}).status_code == 409
    assert client.post("/api/project/decisions/DEC-none/approve", json={"option": "O3"}).status_code == 404
    assert client.post("/api/project/ncrs/NCR-999/close", json={"action": "x"}).status_code == 404


@pytest.mark.parametrize("path", ["overview", "schedule", "budget", "subcontractors", "procurement", "daily-reports", "quality", "claim", "decisions"])
def test_every_screen_has_its_data(client, path):
    assert client.get(f"/api/project/{path}").status_code == 200


def test_a_site_photo_is_served_by_its_id_and_nothing_else_is(client):
    photo = client.get("/api/project/daily-reports").json()["photos"][0]["id"]
    r = client.get(f"/api/project/photos/{photo}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/")
    assert client.get("/api/project/photos/..%2F..%2F.env.local").status_code == 404


# ------------------------------------------------------------------------------------------------ models and money


def test_no_code_reads_the_openai_key_or_calls_openai():
    for folder in ("swarm", "tools"):
        for path in (ROOT / folder).rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            assert "OPENAI_API_KEY" not in text and "api.openai.com" not in text, path.name


def test_real_model_calls_go_to_meta_with_the_meta_key(monkeypatch):
    monkeypatch.setattr(firm_api.config, "setting", lambda name, default="": "the-meta-key" if name == "META_API_KEY" else default)
    model = firm_api.model_of("muse")("site_l3", firm.SPARK, 100)
    assert str(model._async_client.base_url).rstrip("/") == "https://api.meta.ai/v1" and model._async_client.api_key == "the-meta-key"
    assert str(model.model_type) == firm.SPARK and model.model_config_dict["max_tokens"] == 100


def test_a_real_review_may_spend_up_to_the_meta_credit():
    assert 'config.setting("SWARM_MAX_USD", "150")' in (ROOT / "swarm" / "firm_api.py").read_text(encoding="utf-8")


def test_the_spending_limit_stops_the_firm_before_the_next_agent():
    events: list[dict] = []
    firm._emit.set(events.append)
    f = firm.Firm(lambda key, model, n: MockFirmLlm(model=f"mock/{key}", agent_key=key), 1.0, firm.BRIEF, mock=True)
    f.charge("partner", firm.WONDER, 300_000, 0)
    assert f.stopped and any(e["type"] == "error" and "spending limit" in e["message"] for e in events)
    assert asyncio.run(f.work("site_l3", "x", [], "y")).startswith("(not run")


class Chatty(llm.Scripted):
    """A model that says what it is doing before each tool call, as Muse does."""

    def answer(self, results, tools):
        return "The report." if results else llm.Said("Reading the note now.", [("read_note", {})])


def test_a_models_status_lines_between_tool_calls_stay_out_of_its_report():
    def read_note() -> dict:
        """The note."""
        return {"note": "x"}

    firm._emit.set(lambda e: None)
    f = firm.Firm(lambda key, model, n: Chatty("mock/chatty"), 1.0, firm.BRIEF, mock=True)
    assert asyncio.run(f.turn("partner", firm.SPARK, "Call read_note.", [read_note], "Go.", 4)) == "The report."

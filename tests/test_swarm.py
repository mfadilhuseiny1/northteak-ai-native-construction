"""Offline: no model is called and nothing costs money. A mock run proves the wiring and the checks, not accuracy."""

from __future__ import annotations

import ast
import asyncio
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from swarm import agents, generator, mock_llm, reconcile, runner, server, tools, vision
from swarm.data import ProjectData
from swarm.mock_llm import MockLlm, call
from swarm.scenes import SCENES

ROOT = Path(__file__).resolve().parent.parent


def run(model_of=None, **kw):
    events = []
    report = asyncio.run(runner.run_review(mode="mock", emit=events.append, model_of=model_of, **kw))
    return report, events


def brains(**override):
    def model_of(role):
        return MockLlm(model=f"mock/{role}", brain=override.get(role, mock_llm.BRAINS[role]))
    return model_of


@pytest.fixture(scope="module", autouse=True)
def project(tmp_path_factory):
    """Plain wording and drawn views in a temporary folder: fixed text to test against, and the running app's data stays untouched."""
    keep_data, keep_runs = generator.DATA_DIR, server.RUNS_DIR
    generator.DATA_DIR = tmp_path_factory.mktemp("project") / "project"
    server.RUNS_DIR = tmp_path_factory.mktemp("runs")
    generator.generate(realistic=False)
    yield
    generator.DATA_DIR, server.RUNS_DIR = keep_data, keep_runs


# ------------------------------------------------------------------------------------ the whole swarm

def test_every_line_reaches_its_expected_status():
    report, _ = run()
    assert report["status"] == "complete"
    expected = {x.code: x.expected for x in generator.LINES}
    assert {x["code"]: x["status"] for x in report["lines"]} == expected
    assert report["score"]["false_alarms"] == 0 and report["refused"] == []


def test_every_agent_runs_and_the_specialists_overlap():
    _, events = run()
    states = [(e["agent"], e["status"]) for e in events if e["type"] == "agent"]
    for a in agents.AGENTS:
        assert (a["name"], "working") in states and (a["name"], "done") in states
    names = [x[0] for x in states]
    first_done = min(names.index(n) + names[names.index(n) + 1:].index(n) + 1 for n in ("field", "schedule", "documents", "cost"))
    assert all(names.index(n) < first_done for n in ("field", "schedule", "documents", "cost"))  # all four started before any finished


def test_rupiah_is_worked_out_by_code():
    report, _ = run()
    by = {x["code"]: x for x in report["lines"]}
    assert by["ST-03"]["impact"] == 20 * 18_500_000 * 20 // 100  # claimed 80, evidence 60
    assert by["AR-01"]["impact"] == 40 * 8_500_000 * 40 // 100  # claimed 60, evidence 100
    assert by["AR-06"]["billing_difference"] == 28 * 500_000
    assert report["totals"]["unbilled_value"] == by["AR-01"]["impact"] + by["AR-04"]["impact"]


def test_verifier_sends_stale_evidence_to_inspection_and_only_off_boq_without_change_order_is_extra_work():
    report, _ = run()
    tile = next(x for x in report["lines"] if x["code"] == "AR-09")
    assert tile["status"] == "needs_inspection" and tile["impact"] == 0 and tile["ruling"]["decision"] == "rejected"
    assert report["score"]["extra_work_found"] == 2 and report["score"]["extra_work_false"] == 0


# ------------------------------------------------------------------------------------ the checks, against agents that lie

def lying_documents(r):
    if "read_daily_logs" not in r:
        return [call("read_daily_logs")]
    if "record_log_quantities" in r or "report_extra_work" in r:
        return "done"
    entries = r["read_daily_logs"][0]["entries"]
    four = next(e["id"] for e in entries if e["text"] == "4 more L3 columns cast.")
    covered = next(e["id"] for e in entries if "CO-001" in e["text"])
    return [call("record_log_quantities", item_code="ST-03", log_ids=[four], quantities=[99.0], note="a number the entry does not say"),
            call("record_log_quantities", item_code="ST-04", log_ids=["LOG-9999"], quantities=[5.0], note="made up evidence"),
            call("record_log_quantities", item_code="ST-05", log_ids=[], quantities=[], note="no evidence"),
            call("record_log_quantities", item_code="XX-99", log_ids=[four], quantities=[4.0], note="no such item"),
            call("record_log_quantities", item_code="ME-06", log_ids=[four, four], quantities=[4.0, 4.0], note="more than the BoQ quantity"),
            call("report_extra_work", title="Invented", log_ids=["LOG-9999"], note="made up"),
            call("report_extra_work", title="Already covered", log_ids=[covered], note="has an approved change order")]


def test_made_up_numbers_and_evidence_are_refused_and_end_in_inspection():
    report, events = run(brains(documents=lying_documents))
    assert len(report["refused"]) == 7 and len([e for e in events if e["type"] == "refused"]) == 7
    by = {x["code"]: x for x in report["lines"]}
    for code in ("ST-03", "ST-04", "ST-05"):
        assert by[code]["log_pct"] is None and by[code]["status"] == "needs_inspection"
    assert report["extra_work"] == []


def lying_field(r):
    answer = mock_llm.field(r)
    if isinstance(answer, str) or answer[0][0] in ("list_site_photos", "inspect_photos"):
        return answer
    out = []
    for name, args in answer:
        if args.get("item_code") == "ST-03":
            args = {**args, "evidence_ids": ["P-ST-03-A"], "pct": 45.0}  # the older photo, which reads 45%
        out.append((name, args))
    return out


def test_field_agent_must_use_the_latest_photo():
    report, _ = run(brains(field=lying_field))
    assert any("latest photo" in x["reason"] for x in report["refused"])
    assert next(x for x in report["lines"] if x["code"] == "ST-03")["status"] == "needs_inspection"


def agreeable_cost(r):
    if "read_claim_and_boq" not in r:
        return [call("read_claim_and_boq")]
    if "submit_cost_check" in r:
        return "done"
    return [call("submit_cost_check", item_code=x["code"], result="ok", evidence_ids=x["evidence_ids"], note="") for x in r["read_claim_and_boq"][0]["lines"]]


def test_a_cost_agent_that_calls_everything_ok_is_refused_and_code_still_finds_the_error():
    report, _ = run(brains(cost=agreeable_cost))
    assert {x["item_code"] for x in report["refused"]} == {"AR-06", "PL-02"}
    assert next(x for x in report["lines"] if x["code"] == "AR-06")["status"] == "billing_error"


def silent_verifier(r):
    return "I will not rule on anything."


def test_a_conclusion_the_verifier_did_not_confirm_does_not_go_out():
    report, _ = run(brains(verifier=silent_verifier))
    assert report["totals"]["weak_evidence"] == 0 and report["totals"]["unbilled"] == 0
    assert report["totals"]["weak_evidence_value"] == 0 and report["totals"]["unbilled_value"] == 0
    assert next(x for x in report["lines"] if x["code"] == "ST-03")["status"] == "needs_inspection"


def verifier_writing_numbers(r):
    if "get_flagged_items" not in r:
        return [call("get_flagged_items")]
    if "rule_on_item" in r:
        return "done"
    return [call("rule_on_item", item_code="ST-01", decision="confirmed", reason="not flagged"),
            call("rule_on_item", item_code="ST-03", decision="maybe", reason="not a decision")]


def test_verifier_cannot_rule_on_clean_lines_or_invent_a_decision():
    report, _ = run(brains(verifier=verifier_writing_numbers))
    assert len(report["refused"]) == 2
    assert next(x for x in report["lines"] if x["code"] == "ST-01")["status"] == "supported"


def summary_with_invented_number(r):
    if "get_final_report" not in r:
        return [call("get_final_report")]
    return "You can recover Rp 9,999,999,999 by next week."


def test_a_summary_with_a_number_not_in_the_report_is_replaced():
    report, _ = run(brains(lead_summary=summary_with_invented_number))
    assert "9,999,999,999" not in report["summary"] and report["summary_from_lead"] is False


# ------------------------------------------------------------------------------------ failures and limits

def crashing(r):
    raise RuntimeError("model unavailable")


def test_a_crashed_agent_still_gives_a_report_and_nothing_goes_out_as_a_conclusion():
    report, events = run(brains(documents=crashing))
    assert report["status"] == "partial" and "model unavailable" in report["stop_reason"]
    assert any(e["type"] == "error" for e in events) and events[-1]["type"] == "final"
    assert len(report["lines"]) == len(generator.LINES)
    assert report["totals"]["weak_evidence"] == 0 and report["totals"]["unbilled"] == 0


def test_model_call_limit_stops_the_run():
    calls = []

    def counting(role):
        def brain(r):
            calls.append(role)
            return mock_llm.BRAINS[role](r)
        return MockLlm(model=f"mock/{role}", brain=brain)

    report, _ = run(counting, max_llm_calls=4)
    assert report["status"] == "partial" and len(calls) <= 4 and report["usage"]["llm_calls"] <= 4
    assert report["totals"]["weak_evidence_value"] == 0


def test_spending_limit_stops_the_run_and_no_more_model_calls_follow():
    calls = []

    def counting(role):
        def brain(r):
            calls.append(role)
            return mock_llm.BRAINS[role](r)
        return MockLlm(model=f"mock/{role}", brain=brain, tokens=100_000, delay=0.01)

    events = []

    async def go():
        report = await runner.run_review(mode="mock", emit=events.append, model_of=counting, max_usd=0.50)
        seen = len(calls)
        await asyncio.sleep(0.2)
        return report, seen

    report, seen = asyncio.run(go())
    assert report["status"] == "partial" and "spending limit" in report["stop_reason"]
    assert len(calls) == seen  # the parallel agents really stopped
    assert report["usage"]["llm_calls"] < 22


# ------------------------------------------------------------------------------------ independence and hidden data

def test_each_agent_only_has_its_own_sources():
    names = {role: {t.__name__ for t in fns} for role, fns in tools.TOOLS.items()}
    assert not names["field"] & {"read_daily_logs", "read_schedule", "read_claim_and_boq", "read_change_orders", "get_claim_overview"}
    assert not names["documents"] & {"inspect_photos", "read_schedule", "read_claim_and_boq", "get_claim_overview"}
    assert not names["schedule"] & {"inspect_photos", "read_daily_logs", "read_claim_and_boq", "get_claim_overview"}
    assert not names["cost"] & {"inspect_photos", "read_daily_logs", "read_schedule"}


def test_hidden_files_are_only_read_where_they_should_be():
    for path in (ROOT / "swarm").glob("*.py"):
        text = path.read_text(encoding="utf-8")
        if path.name not in ("generator.py", "score.py"):
            assert "answer_key" not in text, path.name
        if path.name not in ("generator.py", "vision.py"):
            assert "vision_annotations" not in text, path.name
        if path.name not in ("generator.py", "mock_llm.py", "project.py"):  # project.py seeds the claim records from it; the agents read those records, not this file
            assert "log_quantities.json" not in text, path.name
    assert "_hidden" not in (ROOT / "swarm" / "tools.py").read_text(encoding="utf-8")


def test_agent_visible_files_hold_no_scenario_or_true_progress():
    data = ProjectData.load()
    visible = json.dumps([data.boq, data.claim, data.schedule, data.logs, data.change_orders, data.photos])
    for word in ("scenario", "expected", "over_claim", "actual_pct", "weak_evidence", "qty_done", "item_code\": \"ST-03\", \"qty"):
        assert word not in visible
    assert all(set(e) == {"id", "date", "area", "author", "text"} for e in data.logs)  # logs are free text, nothing structured to copy


def test_tool_schemas_are_plain_for_any_model_family():
    from swarm import llm

    for fns in tools.TOOLS.values():
        for fn in fns:
            d = llm.schema_of(fn)["function"]
            assert d["name"] == fn.__name__ and d["description"] and "strict" not in d
            schema = d.get("parameters") or {}
            for name, prop in (schema.get("properties") or {}).items():
                assert prop["type"] in ("string", "number", "array", "integer", "boolean"), f"{fn.__name__}.{name}: {prop}"
                if prop["type"] == "array":
                    assert prop["items"]["type"] in ("string", "number"), f"{fn.__name__}.{name}: {prop}"


def test_the_traps_in_the_free_text_change_the_answer_if_a_reader_falls_for_them():
    logs = {e["text"]: e for e in ProjectData.load().logs}
    truth = json.loads((generator.DATA_DIR / "_hidden" / "log_quantities.json").read_text(encoding="utf-8"))["quantities"]
    delivered = logs["12 windows for L3 delivered to the store room, not fixed yet."]["id"]
    planned = logs["Next week: 6 more L2 power sockets planned."]["id"]
    removed = next(e["id"] for t, e in logs.items() if "removed after a failed load test" in t)
    both = next(e["id"] for t, e in logs.items() if t.startswith("L3 frame"))
    assert delivered not in truth and planned not in truth
    assert truth[removed] == {"AR-11": -4} and truth[both] == {"ST-03": 4, "ST-04": 5}
    key = json.loads((generator.DATA_DIR / "_hidden" / "answer_key.json").read_text(encoding="utf-8"))["lines"]
    assert key["AR-11"]["log_pct"] == 70.0 and key["AR-12"]["log_pct"] == 25.0 and key["ME-02"]["log_pct"] == 30.0


# ------------------------------------------------------------------------------------ the generated photos and log wording

def _numbers(text):
    return set(re.findall(r"\\d+(?:\\.\\d+)?", text))


def test_every_scene_has_its_generated_photo_and_a_recorded_model():
    manifest = json.loads((ROOT / "assets" / "photos_manifest.json").read_text(encoding="utf-8"))
    codes = {x.code for x in generator.LINES}
    for code, shots in SCENES.items():
        assert code in codes
        for suffix, scene in shots.items():
            pid = f"P-{code}-{suffix}"
            assert (ROOT / "assets" / "photos" / f"{pid}.jpg").exists(), pid
            assert manifest[pid] in ("gpt-image-2", "muse-image-1.0"), pid
            assert 0 <= scene.installed <= scene.total and scene.what_to_count, pid
    assert {x.code for x in generator.LINES if x.photo != "none"} == set(SCENES)


def test_a_photo_question_never_gives_the_answer_away():
    for shots in SCENES.values():
        for scene in shots.values():
            assert not re.search(r"\\d", scene.what_to_count), scene.what_to_count
            assert "cannot" not in scene.what_to_count and "not visible" not in scene.what_to_count


def test_the_rewritten_log_entries_keep_every_number_and_every_entry():
    wording = json.loads((ROOT / "assets" / "daily_log_texts.json").read_text(encoding="utf-8"))
    plain = {e["id"]: e["text"] for e in generator.plain_logs()}
    assert set(wording) == set(plain)
    for log_id, text in plain.items():
        assert _numbers(wording[log_id]) == _numbers(text), log_id


def test_the_case_still_holds_with_the_generated_photos_and_log_wording(tmp_path):
    keep = generator.DATA_DIR
    generator.DATA_DIR = tmp_path / "project"
    try:
        generator.generate(realistic=True)
        report, _ = run()
        data = ProjectData.load()
    finally:
        generator.DATA_DIR = keep
    expected = {x.code: x.expected for x in generator.LINES}
    assert {x["code"]: x["status"] for x in report["lines"]} == expected, report["score"]["misses"]
    assert report["score"]["photo_readings_wrong"] == [] and report["refused"] == []
    assert all(p["file"].endswith(".jpg") for p in data.photos)


def test_generator_is_deterministic_and_claim_arithmetic_only_breaks_where_planted():
    first = {p: (generator.DATA_DIR / p).read_text(encoding="utf-8") for p in ("boq.json", "claim.json", "daily_logs.json", "_hidden/answer_key.json")}
    generator.generate(realistic=False)
    assert first == {p: (generator.DATA_DIR / p).read_text(encoding="utf-8") for p in first}
    data = ProjectData.load()
    assert {c for c in data.codes if data.billing_difference(c)} == {"AR-06", "PL-02"}


# ------------------------------------------------------------------------------------ small rules

@pytest.mark.parametrize("claimed,field,log,status", [
    (80, 60, 60, reconcile.WEAK), (60, 100, 100, reconcile.UNBILLED), (50, 50, 50, reconcile.SUPPORTED),
    (53, 50, 50, reconcile.SUPPORTED), (55, 50, 50, reconcile.SUPPORTED), (55.1, 50, 50, reconcile.WEAK), (80, 40, 80, reconcile.INSPECT),
    (60, None, 60, reconcile.INSPECT), (60, 60, None, reconcile.INSPECT),
])
def test_decide(claimed, field, log, status):
    f = {"pct": field} if field is not None else {"pct": None, "reason": "concealed"}
    g = {"pct": log} if log is not None else None
    assert reconcile.decide(claimed, f, g)[0] == status


def test_nothing_claimed_and_no_work_shown_is_supported_but_work_shown_is_not():
    assert reconcile.decide(0, {"pct": None, "reason": "no photo"}, None)[0] == reconcile.SUPPORTED
    assert reconcile.decide(0, {"pct": 50.0}, {"pct": 50.0})[0] == reconcile.UNBILLED


@pytest.mark.parametrize("text", ['{"visible": true, "installed": 25, "total": 20}', '{"visible": true, "installed": 5, "total": 0}', "not json", "null", '{"installed": "six", "total": 10}', None])
def test_unreadable_vision_replies_count_as_not_visible(text):
    assert vision.result("P", vision.parse(text), "x")["visible"] is False


def test_vision_pct_is_computed_by_code():
    assert vision.result("P", vision.parse('{"visible": true, "installed": 6, "total": 10, "pct": 99}'), "x")["pct"] == 60.0


# ------------------------------------------------------------------------------------ the web app

@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(server, "MOCK_DELAY", 0)
    with TestClient(server.app) as c:
        yield c


def test_app_runs_a_review_and_streams_it(client):
    assert "Progress Claim Check" in client.get("/").text
    assert len(client.get("/api/project").json()["lines"]) == len(generator.LINES)
    with client as c:
        run_id = c.post("/api/runs", json={"mode": "mock"}).json()["run_id"]
        with c.stream("GET", f"/api/runs/{run_id}/events") as stream:
            events = [json.loads(line[6:]) for line in stream.iter_lines() if line.startswith("data: ")]
        assert events[-1]["type"] == "done" and any(e["type"] == "final" for e in events)
        assert c.get(f"/api/runs/{run_id}").json()["report"]["status"] == "complete"


def test_a_finished_run_can_be_replayed_after_a_restart(client, monkeypatch, tmp_path):
    monkeypatch.setattr(server, "RUNS_DIR", tmp_path)
    assert client.get("/api/runs/latest").json()["id"] is None
    with client as c:
        run_id = c.post("/api/runs", json={"mode": "mock"}).json()["run_id"]
        with c.stream("GET", f"/api/runs/{run_id}/events") as stream:
            first = [line for line in stream.iter_lines() if line.startswith("data: ")]
    server.LIVE.pop(run_id)  # as after a restart
    assert client.get("/api/runs/latest").json()["id"] == run_id
    with client.stream("GET", f"/api/runs/{run_id}/events") as stream:
        again = [line for line in stream.iter_lines() if line.startswith("data: ")]
    assert again == first and client.get(f"/api/runs/{run_id}").json()["report"]["status"] == "complete"
    assert client.get("/api/runs/run-..%2F..%2Fsecret").status_code == 404
    other = {"id": "run-abc", "mode": "muse", "case": "another case", "events": [], "report": None}
    (tmp_path / "run-abc.json").write_text(json.dumps(other), encoding="utf-8")
    assert client.get("/api/runs/latest").json()["id"] == run_id  # a run on another case is not offered, even a real one


def test_real_run_cannot_start_without_a_key_or_confirmation(client, monkeypatch):
    monkeypatch.setattr(server.config, "muse_ready", lambda: False)
    assert client.post("/api/runs", json={"mode": "muse", "confirm_paid": True}).status_code == 400
    monkeypatch.setattr(server.config, "muse_ready", lambda: True)
    assert client.post("/api/runs", json={"mode": "muse"}).status_code == 400
    assert client.post("/api/runs", json={"mode": "nope"}).status_code == 400


def test_photos_and_evidence_are_found_by_id_only(client):
    assert client.get("/api/photos/P-ST-03-B").headers["content-type"] == "image/png"
    assert client.get("/api/photos/..%2F_hidden%2Fanswer_key").status_code == 404
    assert client.get("/api/photos/nope").status_code == 404
    assert client.get("/api/evidence/nope").status_code == 404
    assert client.get("/api/runs/nope").status_code == 404


def test_the_ui_never_puts_model_text_into_html_unescaped():
    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    assert "esc(e.plan)" in html and "esc(e.reason)" in html and "esc(e.message)" in html and "esc(x.title)" in html
    assert ast.parse((ROOT / "swarm" / "server.py").read_text(encoding="utf-8"))

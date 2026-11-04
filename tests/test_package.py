"""From a planning consultant's real documents to procedures a site can work from. Offline: code reads the package for real, and the agents are a scripted model that quotes real words from the pages it is given, so every check of code's runs for real. It says nothing about how well a model plans.

The documents are public tender documents in docs/. Without them, these tests are skipped.
"""

from __future__ import annotations

import asyncio
from collections import Counter
import csv
import io
import json
import shutil
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from swarm import firm, firm_api, llm, memory, mock_package, model3d, modules as M, package as K, package_firm as F, project as P, regulations as REG, site_case as C, wbs

ROOT = Path(__file__).resolve().parent.parent
UGM = ROOT / "docs" / "ugm-gedung-pascasarjana-ftp-2024"
needs_documents = pytest.mark.skipif(not UGM.exists(), reason="the example package is not here")
USED = ("2-HPS", "3-Spesifikasi", "4-Draft", "7-Daftar", "8-JADWAL", "9-Gambar", "14-Berita", "12-Surat", "13-Sertifikat", "10-Dokumen", "5-LDK")  # all but the 316-page RKS, to keep the tests quick


def doc(prefix: str) -> Path:
    return next(UGM.glob(f"{prefix}*"))


def text_of(prefix: str) -> str:
    return "\n".join(K.read_pages(doc(prefix)))


# ------------------------------------------------------------------------------------------------ sorting the package: no model


@needs_documents
@pytest.mark.parametrize("prefix, kind, use", [("1-KAK", "spec", True), ("2-HPS", "estimate", True), ("3-Spesifikasi", "spec", True), ("4-Draft", "contract", True), ("5-LDK", "tender", False), ("6-LDP", "tender", False), ("7-Daftar", "boq", True), ("8-JADWAL", "programme", True), ("9-Gambar", "drawing", True), ("10-Dokumen", "note", False), ("11-Dokumen", "award", False), ("12-Surat", "award", False), ("14-Berita", "clarification", True), ("15-Berita", "note", False), ("17-REV", "award", False), ("18-REV", "award", False), ("19-REV", "award", False)])
def test_a_real_package_is_sorted_by_what_each_file_is(prefix, kind, use):
    got = K.classify(doc(prefix).name, K.read_pages(doc(prefix)))
    assert got[:2] == (kind, use), got


def test_an_unknown_file_with_text_is_read_and_a_scan_with_no_text_is_not():
    assert K.classify("catatan.pdf", ["Beton harus dicor pagi hari."])[:2] == ("other", True)
    assert K.classify("Spesifikasi scan.pdf", ["", ""])[:2] == ("spec", False), "a scan has nothing to send"


@pytest.mark.parametrize("raw, want", [("PEKERJAAN GALIAN DAN URUGAN", "Galian dan Urugan"), ("PEKERJAAN PERSIAPAN DAN SMKK", "Persiapan dan SMKK"), ("PEKERJAAN CAT WALK", "Cat Walk"), ("RUMAH STP", "Rumah STP"), ("LANTAI 01", "Lantai 01"), ("Pekerjaan Beton", "Beton"), ("PEKERJAAN", "Pekerjaan")])
def test_names_read_as_a_person_writes_them(raw, want):
    assert K.nice(raw) == want


def test_extraction_breaking_a_word_does_not_stop_a_quote_being_found():
    assert K.found_in("sesuai petunjuk Konsultan", "bahan  s esuai petunjuk\nKonsultan Pengawas")
    assert not K.found_in("sesuai perintah Direksi", "bahan s esuai petunjuk Konsultan Pengawas")
    assert not K.found_in("", "anything")


# ------------------------------------------------------------------------------------------------ the tables: read by code, and checked against what the documents print


@needs_documents
def test_the_master_schedule_is_read_by_where_its_cells_sit():
    p = K.read_programme(doc("8-JADWAL"))
    assert p["weeks"] == 52 and len(p["rows"]) == 34 and p["total_weight"] == pytest.approx(100.01)
    row = {(r["no"], r["name"]): r for r in p["rows"]}
    assert row[("2", "PEKERJAAN PONDASI DAN ANTI RAYAP")]["weeks"] == [3, 4, 5, 6, 7] and row[("2", "PEKERJAAN PONDASI DAN ANTI RAYAP")]["weight"] == 7.03
    assert row[("3.2", "LANTAI 01")]["weeks"] == [15, 16, 17, 18]
    assert row[("IV", "PEKERJAAN ELEKTRIKAL")]["weeks"][0] == 18, "the curve's label of 8.6% at week 8 sits near this row, and is not one of its cells"
    assert row[("V", "PEKERJAAN MEKANIKAL")]["weeks"][0] == 12
    assert row[("II", "PEKERJAAN STRUKTUR")]["weight"] is None and row[("3", "PEKERJAAN BETON")]["weeks"] == [], "a heading has no cells of its own"
    assert len(p["cumulative"]) == 52 and p["cumulative"][-1] == 100.0 and p["cumulative"] == sorted(p["cumulative"])


@needs_documents
def test_a_file_that_is_not_a_schedule_is_not_read_as_one():
    assert K.read_programme(doc("2-HPS")) is None


@needs_documents
def test_a_priced_recap_is_read_only_if_it_adds_up_to_what_it_prints():
    bid = K.read_recap(text_of("7-Daftar"))
    assert [g["no"] for g in bid["groups"]] == ["I", "II", "III", "IV", "V"] and bid["total"] == pytest.approx(37_882_882_882.87)
    assert bid["groups"][1]["value"] == pytest.approx(13_361_237_687.37) and bid["groups"][1]["share"] == 35.27
    assert K.read_recap(text_of("2-HPS"))["total"] == pytest.approx(38_075_872_228.31)
    assert K.read_recap("I PEKERJAAN A 100.000,00 Rp 50,0%\nII PEKERJAAN B 100.000,00 Rp 50,0%\nJumlah 999.000,00") is None, "groups that do not add up to the total printed are not a recap"


@needs_documents
def test_the_time_for_completion_is_read_from_its_own_clause():
    assert K.contract_days(text_of("4-Draft")) == 365
    assert K.contract_days("Masa pemeliharaan 180 hari kalender.") is None, "other periods are stated in calendar days too"
    assert K.contract_days("Jangka Waktu Pelaksanaan pekerjaan 120 (seratus dua puluh) hari kalend er") == 120


@needs_documents
def test_the_schedule_already_holds_the_wbs_and_the_recap_prices_it():
    s = K.structure(K.read_programme(doc("8-JADWAL")), K.read_recap(text_of("7-Daftar")))
    assert [a["name"] for a in s["accounts"]] == ["Persiapan dan SMKK", "Struktur", "Arsitektur", "Elektrikal", "Mekanikal"]
    work = {w["no"]: w for a in s["accounts"] for w in a["packages"]}
    assert len(work) == 31 and work["I"]["name"] == "Persiapan dan SMKK", "a group with no rows under it is one work package"
    assert work["II.3.2"]["name"] == "Beton: Lantai 01" and work["II.3.2"]["days"] == 28 and work["II.3.2"]["not_before"] == 98
    assert work["III.1"]["name"] == "Galian dan Urugan" and work["II.1"]["name"] == "Galian dan Urugan", "the same name under two accounts stays two packages"
    for a in s["accounts"]:
        assert sum(w["value"] for w in a["packages"]) == pytest.approx(a["value"], abs=len(a["packages"])), "a control account's packages add up to what the BoQ says it is worth"
    assert sum(a["value"] for a in s["accounts"]) == pytest.approx(s["total"], abs=1)


def test_without_prices_a_schedule_still_gives_the_breakdown():
    s = K.structure({"weeks": 4, "rows": [{"no": "I", "name": "PEKERJAAN A", "weight": 100.0, "weeks": [1, 2]}]})
    assert s["accounts"][0]["packages"][0]["value"] is None and s["accounts"][0]["value"] is None


# ------------------------------------------------------------------------------------------------ the critical path keeps the schedule's dates, and works out the float


def test_a_schedule_can_hold_dates_and_let_linked_work_overlap():
    rows = [("A", "A", 10, [], "self"), ("B", "B", 10, ["A"], "self"), ("C", "C", 5, ["B"], "self")]
    plain = {a["id"]: a for a in C.schedule(activities=rows, start="2027-01-01")["activities"]}
    assert (plain["B"]["start"], plain["C"]["float_days"]) == ("2027-01-11", 0)
    held = {a["id"]: a for a in C.schedule(activities=rows, start="2027-01-01", not_before={"A": 5})["activities"]}
    assert held["A"]["start"] == "2027-01-06" and held["B"]["start"] == "2027-01-16"
    overlap = {a["id"]: a for a in C.schedule(activities=rows, start="2027-01-01", leads={"B": {"A": -3}})["activities"]}
    assert overlap["B"]["start"] == "2027-01-08" and all(a["critical"] for a in overlap.values()), "with the overlap allowed, the chain is still one chain with no float"
    gap = {a["id"]: a for a in C.schedule(activities=rows, start="2027-01-01", not_before={"B": 14})["activities"]}
    assert gap["A"]["float_days"] == 4 and gap["B"]["float_days"] == 0, "a gap before the next work is float"


# ------------------------------------------------------------------------------------------------ what code checks in what an agent wrote


def firm_for_checks() -> F.PackageFirm:
    f = F.PackageFirm(lambda *a: None, 5, mock=True)
    f.used = [{"id": "UP-1", "title": "RKS", "kind": "spec", "pages_text": ["Baja tulangan harus bebas karat. Lewatan 40 x diameter."]}]
    return f


def test_a_quotation_is_kept_only_if_the_words_are_on_the_page():
    f = firm_for_checks()
    pages = {("UP-1", 1): f.used[0]["pages_text"][0]}
    task = {"ref": "t1", "kind": "operation", "name": "Pasang besi", "procedure": ["Pasang lewatan 40 x diameter.", "Ikat dengan kawat setiap 25 cm."], "crew": [{"role": "Tukang besi", "count": 4}], "share_pct": 100}
    out = f.clean({"name": "Besi"}, {"sections": [{"name": "Besi", "tasks": [{**task, "sources": [{"doc": "UP-1", "page": 1, "quote": "Baja tulangan harus bebas karat"}, {"doc": "UP-1", "page": 1, "quote": "these words are in no document"}, {"doc": "UP-1", "page": 99, "quote": "Lewatan 40 x diameter"}]}]}]}, pages, [])
    t = out["sections"][0]["tasks"][0]
    assert [(s["page"], s["quote"][:6]) for s in t["sources"]] == [(1, "Baja t"), (1, "Lewata")], "the right words on the wrong page are still the right words, and made-up ones go"
    assert f.quotes == {"kept": 2, "dropped": 1}
    assert t["unsourced"] == ["25"], "the page states 40, and nobody told it 25"


def test_rubbish_from_a_model_does_not_become_a_task():
    f = firm_for_checks()
    out = f.clean({"name": "Besi"}, {"sections": ["no", {"name": "", "tasks": ["no", {"name": "No procedure"}, {"name": "Real", "procedure": "One step", "kind": "dance", "crew": [{"role": "A", "count": "x"}, "no"], "share_pct": "lots", "sources": "none", "after": ["t9"]}]}], "questions": ["no", {"subject": "S"}, {"subject": "S", "question": "Q"}]}, {}, [])
    [t] = out["sections"][0]["tasks"]
    assert t["kind"] == "operation" and t["crew"] == [] and t["share"] == 0.0 and t["sources"] == [] and t["steps"] == ["One step"]
    assert [q["subject"] for q in out["questions"]] == ["S"], "a question has to ask something"


def test_tasks_are_fitted_to_the_days_the_schedule_gives_and_a_loop_is_broken():
    tasks = [{"ref": "a", "after": [], "share": 50, "name": "a"}, {"ref": "b", "after": ["a"], "share": 50, "name": "b"}, {"ref": "c", "after": ["a"], "share": 25, "name": "c"}]
    F.PackageFirm.place(tasks, 28)
    by = {t["ref"]: t for t in tasks}
    assert by["a"]["start_h"] == 0 and by["b"]["start_h"] == by["a"]["finish_h"] and max(t["finish_h"] for t in tasks) <= 28 * F.HOURS_A_DAY + 0.01
    assert by["a"]["critical"] and by["b"]["critical"] and not by["c"]["critical"]
    loop = [{"ref": "x", "after": ["y"], "share": 1, "name": "x"}, {"ref": "y", "after": ["x"], "share": 1, "name": "y"}, {"ref": "z", "after": ["nope"], "share": 1, "name": "z"}]
    F.PackageFirm.place(loop, 10)
    assert len(loop) == 3 and all(t["finish_h"] > t["start_h"] for t in loop) and next(t for t in loop if t["ref"] == "z")["after"] == []


# ------------------------------------------------------------------------------------------------ the whole flow, on the real documents


@pytest.fixture(scope="module")
def uploaded(tmp_path_factory):
    """A project of one's own with the package uploaded through the API, once. Each test gets a copy."""
    if not UGM.exists():
        pytest.skip("the example package is not here")
    folder = tmp_path_factory.mktemp("package")
    saved = P.DB, P.SCENARIO_DB, P.TODAY
    P.DB = P.SCENARIO_DB = folder / "project.db"
    P._conn = None
    client = TestClient(firm_api.app)
    assert client.post("/api/projects", json={"name": "Gedung Pascasarjana FTP", "start": "2026-11-09", "template": False}).status_code == 200
    for prefix in USED:
        f = doc(prefix)
        assert client.post("/api/project/documents", files={"file": (f.name, f.read_bytes(), "application/pdf")}, data={"title": f.stem, "kind": "auto"}).status_code == 200
    db = P.DB
    memory.close()
    P._conn.close()
    P._conn = None
    P.DB, P.SCENARIO_DB, P.TODAY = saved
    return folder, db.relative_to(folder)


@pytest.fixture()
def project_copy(uploaded, tmp_path, monkeypatch):
    folder, db = uploaded
    shutil.copytree(folder, tmp_path / "copy")
    monkeypatch.setattr(P, "SCENARIO_DB", tmp_path / "copy" / "project.db")
    monkeypatch.setattr(P, "DB", tmp_path / "copy" / db)
    monkeypatch.setattr(P, "TODAY", "2026-11-09")
    monkeypatch.setattr(P, "busy", "")
    monkeypatch.setattr(firm_api, "STORE", tmp_path / "runs")
    monkeypatch.setattr(firm_api, "RUNS", {})
    monkeypatch.setattr(firm_api, "TASKS", {})
    monkeypatch.setattr(firm_api, "PROJECTS", {})
    monkeypatch.setattr(firm_api, "MOCK_DELAY", 0)
    P._conn = None
    yield
    memory.close()
    if P._conn is not None:
        P._conn.close()
        P._conn = None


@pytest.fixture()
def client(project_copy):
    with TestClient(firm_api.app) as c:
        yield c


def analyse(client) -> dict:
    r = client.post("/api/aip/konsultan", json={"nama": "Analysis", "versi": "mock", "jenis": "package"})
    assert r.status_code == 200, r.text
    for _ in range(600):
        a = client.get("/api/aip/analysis").json()
        if a["run"] and a["run"]["status"] != "running":
            assert a["run"]["status"] == "succeeded", a["problems"]
            return client.get("/api/project/plans").json()["plans"][0]
        import time

        time.sleep(0.05)
    raise AssertionError("it did not finish")


def test_the_package_is_sorted_and_says_what_is_missing(client):
    r = client.get("/api/project/package").json()
    by = {d["title"].split("-")[0]: d for d in r["documents"]}
    assert by["8"]["use"] and by["8"]["kind"] == "programme" and not by["12"]["use"]
    assert not by["13"]["use"] and by["13"]["kind"] == "note"
    assert any("recap" in m for m in r["missing"]) and any("inspection" in m for m in r["missing"]) and any("structural" in m for m in r["missing"])


def test_identical_files_are_noticed(client):
    twin = P.next_id("document")
    original = next(d for d in K.uploads() if d["title"].startswith("3-"))
    P.put("document", twin, {**original, "id": twin, "title": "A copy"})
    row = next(d for d in client.get("/api/project/package").json()["documents"] if d["id"] == twin)
    assert not row["use"] and original["id"] in row["why"]


def test_a_person_can_overrule_the_sorting(client):
    d = next(x for x in client.get("/api/project/package").json()["documents"] if x["title"].startswith("3-"))
    assert client.post(f"/api/project/documents/{d['id']}/use", json={"use": False}).status_code == 200
    again = next(x for x in client.get("/api/project/package").json()["documents"] if x["id"] == d["id"])
    assert not again["use"] and again["overruled"] and "left it out" in again["why"]
    assert client.post("/api/project/documents/UP-999/use", json={"use": True}).status_code == 404


def test_only_a_project_with_documents_can_be_analysed(project_copy):
    with TestClient(firm_api.app) as c:
        P.open_project("scenario")
        assert c.post("/api/aip/konsultan", json={"nama": "x", "versi": "mock", "jenis": "package"}).status_code == 409
        P.create_project("Empty", template=False)
        assert "upload" in c.post("/api/aip/konsultan", json={"nama": "x", "versi": "mock", "jenis": "package"}).json()["detail"]


def test_what_is_set_aside_never_reaches_a_model(client, monkeypatch):
    told: list[str] = []
    real = llm.turn

    async def spy(model, instruction, tools, prompt, calls, *a, **k):
        told.append(f"{instruction}\n{prompt}")
        return await real(model, instruction, tools, prompt, calls, *a, **k)

    monkeypatch.setattr(llm, "turn", spy)
    d = next(x for x in client.get("/api/project/package").json()["documents"] if x["title"].startswith("14-"))
    client.post(f"/api/project/documents/{d['id']}/use", json={"use": False})
    analyse(client)
    every = "\n".join(told)
    assert len(told) > 5
    for rid in [x["id"] for x in client.get("/api/project/package").json()["documents"] if not x["use"]]:
        assert f"[{rid} page" not in every and f"Document {rid}," not in every, rid
    assert "NPWP" not in every, "no tax numbers go to a model"


def test_the_analysis_leaves_a_proposal_to_read_everywhere_and_nothing_on_the_board(client):
    rec = analyse(client)
    assert rec["status"] == "pending" and rec["plan"]["kind"] == "package" and rec["mode"] == "mock"
    stages = {s["key"]: s for s in client.get("/api/aip/analysis").json()["stages"]}
    assert all(stages[k]["status"] == "done" for k, _ in F.STAGES) and "5 control accounts, 31 work packages" in stages["read"]["note"]
    wbs = client.get("/api/project/wbs").json()
    assert [n["name"] for n in wbs["root"]["children"]] == ["Persiapan dan SMKK", "Struktur", "Arsitektur", "Elektrikal", "Mekanikal"]
    assert wbs["root"]["roll"]["tasks"] == wbs["root"]["roll"]["proposed"] > 0, "the tasks are proposals"
    board = client.get("/api/project/board").json()
    assert not [c for c in board["cards"] if c.get("step")] and board["waiting"]["id"] == rec["id"], "no task reaches the board before a person says so"
    text = " ".join(c["text"] for c in rec["plan"]["checks"])
    assert "against 365 calendar days" in text and "Mekanikal is priced 7.0% below the owner's estimate" in text
    assert "Code dropped 1 of the reviewer's findings" in text, "the scripted reviewer quotes words that are in no document"
    assert [f["subject"] for f in rec["findings"]] == ["Scripted finding"]


def test_every_view_of_the_core_flow_reads_the_proposal(client):
    analyse(client)
    ca = client.get("/api/project/control-accounts").json()["accounts"]
    assert [a["id"] for a in ca] == ["CA-001", "CA-002", "CA-003", "CA-004", "CA-005"] and ca[1]["packages"] == 15 and ca[1]["budget"] == pytest.approx(13_361_237_687, abs=20) and ca[4]["against_owner_pct"] == -7.0
    wp = client.get("/api/project/work-packages").json()["packages"]
    first_floor = next(w for w in wp if w["no"] == "II.3.2")
    assert len(wp) == 31 and first_floor["duration"] == 28 and first_floor["account"] == "CA-002" and first_floor["value"] > 0 and first_floor["tasks"] > 0
    entries = client.get("/api/project/wbs-dictionary").json()["entries"]
    assert sum(e["level"] == "Control account" for e in entries) == 5 and sum(e["level"] == "Work package" for e in entries) == 31
    entry = next(e for e in entries if e.get("no") == "II.3.2")
    assert entry["scope"] and entry["deliverable"] and entry["acceptance"] and entry["responsible"] and entry["references"] and entry["questions"] and entry["start"] == first_floor["start"]
    pr = client.get("/api/project/procedures").json()
    task = next(t for g in pr["groups"] for s in g["sections"] for t in s["tasks"] if t["kind"] == "operation" and t["sources"])
    assert pr["counts"]["tasks"] > 31 and pr["counts"]["ready"] == 0, "nothing is ready before the plan is approved"
    assert task["steps"] and task["crew"] and task["holds"][0]["text"].startswith("The plan is waiting") and task["sources"][0]["page"] and task["sources"][0]["quote"]
    cost = client.get("/api/project/cost-estimate").json()
    assert cost["method"] == "top_down" and cost["total"] == pytest.approx(37_882_882_883, abs=40) and cost["owner_total"] == pytest.approx(38_075_872_228.31) and len(cost["curve"]) == 52 and cost["curve"][-1]["cumulative"] == 100.0 and cost["curve"][-1]["value"] == cost["total"]
    assert sum(w["value"] for a in cost["accounts"] for w in a["packages"]) == cost["total"]


def test_the_critical_path_keeps_the_master_schedules_dates(client):
    analyse(client)
    cp = client.get("/api/project/critical-path").json()
    assert cp["start"] == "2026-11-09" and cp["days"] == 364 and cp["links"] > 0
    rows = {r["code"]: r for r in cp["activities"]}
    work = {w["no"]: w for w in client.get("/api/project/work-packages").json()["packages"]}
    for no, week in (("II.2", 3), ("II.3.1", 8), ("II.3.2", 15), ("III.7", 40), ("IV", 18)):
        assert work[no]["start"] == (C.date.fromisoformat("2026-11-09") + C.timedelta(days=(week - 1) * 7)).isoformat(), "the links do not push the schedule's dates about"
    assert all(r["ef"] <= cp["finish"] and r["ls"] >= r["es"] for r in rows.values())
    [m] = cp["milestones"]
    assert m["contract_date"] == "2027-11-08" and m["days_late"] == 0, "364 days against 365"


def test_a_person_decides_items_of_a_proposal_and_approving_honours_them(client):
    rec = analyse(client)
    pid, wps = rec["id"], list(rec["plan"]["packages"])
    refused = next(a for a in wps if any(s["activity"] == a for s in rec["plan"]["steps"]))
    kept = next(s["activity"] for s in rec["plan"]["steps"] if s["activity"] != refused)
    draft = rec["rfi_drafts"][0]
    assert client.post(f"/api/project/plans/{pid}/review", json={"keys": [f"wp:{refused}", "q:0"], "verdict": "reject", "note": "not in our scope"}).status_code == 200
    assert client.post(f"/api/project/plans/{pid}/review", json={"keys": [f"wp:{kept}"], "verdict": "approve"}).status_code == 200
    assert client.post(f"/api/project/plans/{pid}/review", json={"keys": [f"wp:{kept}"], "verdict": "maybe"}).status_code in (400, 409, 422)
    got = client.get("/api/project/plans").json()["plans"][0]
    assert got["reviews"][f"wp:{refused}"]["verdict"] == "reject" and got["reviews"][f"wp:{refused}"]["note"] == "not in our scope" and got["reviews"][f"wp:{refused}"]["who"], "who decided what, and why, stays on the plan"
    assert client.post(f"/api/project/plans/{pid}/review", json={"keys": [f"wp:{kept}"], "verdict": "clear"}).status_code == 200
    assert f"wp:{kept}" not in client.get("/api/project/plans").json()["plans"][0]["reviews"], "a decision can be taken back until the plan is decided"
    assert client.post(f"/api/project/plans/{pid}/approve", json={"note": ""}).status_code == 200
    cards = client.get("/api/project/board").json()["cards"]
    assert not any(c.get("step") and c["activity"] == refused for c in cards), "a rejected work package puts no tasks on the board"
    assert any(c.get("step") and c["activity"] == kept for c in cards), "the rest do"
    assert refused in " ".join(client.get("/api/project/plans").json()["plans"][0]["effects"]), "and the result says so"
    assert not any(r["status"] == "draft" and r["subject"] == draft["subject"] and r["question"] == draft["question"] for r in client.get("/api/rfis").json()["rfis"]), "a rejected question is not kept as a draft"
    assert client.post(f"/api/project/plans/{pid}/review", json={"keys": [f"wp:{kept}"], "verdict": "approve"}).status_code in (400, 409), "a decided plan is closed"


def test_a_person_corrects_a_question_and_who_answers_for_the_work(client):
    rec = analyse(client)
    pid, aid = rec["id"], next(iter(rec["plan"]["packages"]))
    old = rec["rfi_drafts"][0]
    assert client.post(f"/api/project/plans/{pid}/edit", json={"key": "q:0", "text": "Berapa peil +0,00 yang berlaku?"}).status_code == 200
    assert client.post(f"/api/project/plans/{pid}/edit", json={"key": f"wp:{aid}", "text": "Pak Site Manager"}).status_code == 200
    assert client.post(f"/api/project/plans/{pid}/edit", json={"key": "q:0", "text": "  "}).status_code in (400, 409, 422)
    assert client.post(f"/api/project/plans/{pid}/edit", json={"key": "q:99999", "text": "x"}).status_code == 404
    got = client.get("/api/project/plans").json()["plans"][0]
    assert got["rfi_drafts"][0]["question"] == "Berapa peil +0,00 yang berlaku?" and old["question"] not in got["report"]
    assert any(r["question"] == "Berapa peil +0,00 yang berlaku?" and r["status"] == "draft" for r in client.get("/api/rfis").json()["rfis"]), "the draft a person will issue says the same"
    assert got["plan"]["packages"][aid]["responsible"] == "Pak Site Manager"
    assert client.post(f"/api/project/plans/{pid}/approve", json={"note": ""}).status_code == 200
    assert any(c["activity"] == aid and c.get("step") and c["owner"] == "Pak Site Manager" for c in client.get("/api/project/board").json()["cards"]), "and the board gets the corrected name"


def test_a_person_puts_a_document_in_a_category_and_a_source_opens_in_place(client):
    doc = client.get("/api/project/package").json()["documents"][0]
    assert doc["how_read"] and doc["date"], "the repository says how each file was read, and when it came in"
    assert client.post(f"/api/project/documents/{doc['id']}/kind", json={"kind": "method"}).status_code == 200
    assert next(d for d in client.get("/api/project/package").json()["documents"] if d["id"] == doc["id"])["kind"] == "method"
    assert client.post(f"/api/project/documents/{doc['id']}/kind", json={"kind": "nonsense"}).status_code == 400
    r = client.get(f"/api/project/documents/{doc['id']}/file")
    assert r.status_code == 200 and r.headers["content-disposition"].startswith("inline") and r.headers["content-type"].startswith("application/pdf")


def test_the_agents_read_what_a_person_files_as_procedures_or_a_wbs(project_copy):
    f = scripted_firm({"pages": {}})
    f.used = [{"id": "UP-9", "title": "Metode", "kind": "method", "pages_text": ["METODE KERJA PEMBETONAN"]}]
    s = {"accounts": [{"no": "I", "name": "A", "packages": [{"no": "I", "name": "A", "weight": 1, "start_week": 1, "finish_week": 2, "days": 14, "not_before": 0, "value": None}]}]}
    asyncio.run(f.find_pages(s))
    assert "UP-9" in f.prompted, "the controller is shown the procedures a person filed"


def test_the_planning_engineer_writes_the_wbs_and_code_flags_where_it_differs(project_copy):
    pages = ["Pekerjaan pagar proyek sepanjang 200 meter wajib dikerjakan kontraktor."]
    f = scripted_firm({"accounts": [{"name": "Struktur", "packages": [{"row": "II.1", "name": "Galian"}, {"row": "II.1", "name": "Galian lagi"}, {"row": "II.9", "name": "Karangan"}]}], "not_in_schedule": [{"work": "pagar proyek", "doc": "UP-1", "page": 1, "quote": "pagar proyek sepanjang 200 meter", "why": "wajib"}, {"work": "karangan", "doc": "UP-1", "page": 1, "quote": "kata yang tidak ada di dokumen", "why": "?"}]})
    f.used = [{"id": "UP-1", "title": "KAK", "kind": "scope", "pages_text": pages}]
    work = {"no": "II.1", "name": "Galian", "start_week": 6, "finish_week": 9}, {"no": "II.2", "name": "Pondasi", "start_week": 3, "finish_week": 7}
    s = {"engineer_wrote": False, "accounts": [{"no": "II", "packages": list(work)}]}
    before = json.dumps(s, sort_keys=True)
    asyncio.run(f.write_wbs(s))
    assert json.dumps(s, sort_keys=True) == before, "the schedule's rows, weeks and weights stand whatever the engineer writes"
    assert "row II.1: Galian, weeks 6 to 9" in f.prompted and "whatever you write" in f.told
    rows = next(c for c in f.checks if c["rule"] == "wbs_rows")
    assert not rows["ok"] and "left out II.2" in rows["text"] and "II.1 more than once" in rows["text"] and "II.9" in rows["text"]
    gap = next(c for c in f.checks if c["rule"] == "wbs_gap_1")
    assert "pagar proyek sepanjang 200 meter" in gap["text"] and "KAK, page 1" in gap["text"]
    assert any(c["rule"] == "wbs_quotes" and "dropped 1" in c["text"] for c in f.checks), "words that are not in the documents do not count"
    assert [q["subject"] for q in f.code_questions] == ["Tidak ada di master schedule: pagar proyek"], "the consultant is asked where it belongs"


def test_the_full_analysis_has_the_engineer_write_the_wbs_even_with_a_schedule(client):
    rec = analyse(client)
    assert any(c["rule"] == "wbs_rows" and c["ok"] for c in rec["plan"]["checks"]), "the scripted engineer placed every row"
    by = {s["key"]: s for s in client.get("/api/aip/analysis").json()["stages"]}
    assert by["wbs"]["by"] == "Planning engineer" and "rows placed" in by["wbs"]["note"]


def test_a_boq_is_read_line_by_line_with_its_page():
    lines = K.read_boq_lines("UP-7", ["NO VOLUME SATUAN HARGA SATUAN JUMLAH\nA. PEKERJAAN RK3K KONSTRUKSI\n1 Penyiapan RK3K terdiri atas: 1.00 Ls -Rp - Rp\n2 Sosialisasi dan Promosi K3 terdiri atas:\na Spanduk ( banner) ; 5.00 lbr -Rp - Rp", "3. Balok tipe B1B, 300x600 mm\na. 25.17 m2 -Rp -Rp\nb. Pembesian 1,789.58 kg - Rp - Rp\nc. Beton Fc' 30 Mpa 1.789,58 m3 Rp 1.000.000,00 Rp 1.789.580.000,00"])
    assert [(x["name"], x["qty"], x["unit"], x["page"]) for x in lines] == [("Penyiapan RK3K terdiri atas", 1.0, "Ls", 1), ("Spanduk ( banner)", 5.0, "lbr", 1), ("", 25.17, "m2", 2), ("Pembesian", 1789.58, "kg", 2), ("Beton Fc' 30 Mpa", 1789.58, "m3", 2)]
    assert lines[1]["section"] == "A. PEKERJAAN RK3K KONSTRUKSI" and lines[1]["group"] == "Sosialisasi dan Promosi K3 terdiri atas"
    [glued] = K.read_boq_lines("UP-7", ["c. 1.11Beton Fc' 30 Mpa (Readymix) m3 -Rp -Rp"])
    assert (glued["qty"], glued["name"], glued["unit"]) == (1.11, "Beton Fc' 30 Mpa (Readymix)", "m3"), "the layout reading ran the volume into the description"
    assert lines[3]["group"] == "Balok tipe B1B, 300x600 mm" and lines[3]["amount"] is None
    assert lines[4]["rate"] == 1_000_000 and lines[4]["amount"] == 1_789_580_000


def test_a_real_boq_gives_its_lines_and_a_recap_gives_none():
    boq = ROOT / "docs" / "unair-airlangga-edupreneur-center-2024" / "Daftar-Kuantitas-Harga-AEC-dan-Masjid-Nuruzzaman.pdf"
    if not boq.exists():
        pytest.skip("the example package is not here")
    lines = K.read_boq_lines("UP-3", K.read_layout(boq))
    assert len(lines) >= 445 and all(x["qty"] > 0 and x["unit"] for x in lines)
    assert sum(1 for x in lines if not x["name"]) < 5, "the plain reading lost 58 of these descriptions"
    assert any(x["name"].startswith("Pembesian") and x["qty"] == 30393.38 and x["group"] == "Pondasi Lajur Tb. 40 cm" and x["page"] == 6 for x in lines)
    k1 = [(x["name"], x["qty"], x["page"]) for x in lines if x["group"] == "Kolom tipe K1, 500x600mm" and x["section"].startswith("V.")]
    assert [q for _, q, _ in k1] == [132.0, 7255.49, 18.0], "column K1 on Lantai 1, as checked by hand in docs/README.md"
    assert K.read_boq_lines("UP-7", K.read_pages(doc("7-"))) == [], "a recap has groups, not lines"


def test_a_boq_file_holding_two_projects_keeps_each_row_under_its_own():
    pages = ["PEKERJAAN : PEMBANGUNAN AEC\nIX. PEKERJAAN STRUKTUR ATAP DAN BAJA\n1 Kuda-kuda baja 12.00 kg Rp - Rp -", "PEKERJAAN : REVITALISASI MASJID\nSUB PEKERJAAN : PEKERJAAN ARSITEKTUR - LANTAI 1\nC.1 PEKERJAAN ARSITEKTUR - LANTAI 1\n1 Dinding bata ringan; tebal 10 cm 1,334.21 m2 -Rp -Rp"]
    a, b = K.read_boq_lines("UP-3", pages)
    assert (a["work"], a["section"]) == ("PEMBANGUNAN AEC", "IX. PEKERJAAN STRUKTUR ATAP DAN BAJA")
    assert (b["work"], b["section"]) == ("REVITALISASI MASJID", "C.1 PEKERJAAN ARSITEKTUR - LANTAI 1"), "the other building's rows are not filed under this one's last section"


def test_the_real_unair_boq_has_the_masjid_apart_and_its_roof_in_the_outline():
    boq = ROOT / "docs" / "unair-airlangga-edupreneur-center-2024" / "Daftar-Kuantitas-Harga-AEC-dan-Masjid-Nuruzzaman.pdf"
    if not boq.exists():
        pytest.skip("the example package is not here")
    lines = K.read_boq_lines("UP-3", K.read_layout(boq))
    works = list(dict.fromkeys(x["work"] for x in lines))
    assert len(works) == 2 and "MASJID" in works[1], works
    aec = [x for x in lines if x["work"] == works[0]]
    assert all(x["page"] <= 21 for x in aec) and {x["page"] for x in lines if x["work"] == works[1]} >= {23, 24}
    outline = K.boq_outline(aec)
    assert "IX. PEKERJAAN STRUKTUR ATAP DAN BAJA" in outline and "X. PEKERJAAN STRUKTUR TANGGA DAN RAMP ENTRANCE" in outline, "what the engineer was cut off from"
    assert len(outline) < 3000 and "Kolom tipe K3" not in outline, "a few groups to say what a section holds, not every type of column"
    flagged = [g["section"] for g in K.uncovered(aec, ["Rk3k Konstruksi", "Persiapan", "Tanah dan Beton Non Struktural", "Struktur Bawah", "Struktur Lantai Ground", "Struktur Lantai 1", "Struktur Lantai 4", "Arsitektur", "Sanitair", "Tangga Beton", "Guest House"])]  # the control accounts of the real run, with two of its work packages
    assert flagged == ["IX. PEKERJAAN STRUKTUR ATAP DAN BAJA"], "the roof the real WBS left out, and nothing that it has"


def test_the_engineer_sees_the_whole_boq_and_code_flags_what_its_wbs_leaves_out(project_copy, monkeypatch):
    monkeypatch.setattr(K, "read_programme", lambda path: None)
    asked: list[str] = []
    told: list[str] = []

    async def go():
        firm._emit.set(lambda e: None)
        f = F.PackageFirm(firm_api.model_of("mock", "package"), 5, mock=True)
        work = f.work

        async def spy(key, text, tools, prompt, must_read=True):
            asked.append(prompt if key == "engineer" else "")
            told.append(text if key == "engineer" else "")
            return await work(key, text, tools, prompt, must_read=must_read)

        f.work = spy
        f.boq_lines = [{"doc": "UP-3", "page": 20, "work": "AEC", "section": "IX. PEKERJAAN STRUKTUR ATAP DAN BAJA", "group": "Kuda-kuda", "no": "1", "name": "Kuda-kuda", "qty": 12.0, "unit": "kg", "rate": None, "amount": None}]
        await f.engagement()
        return f

    monkeypatch.setattr(F.K, "read_layout", lambda path: [])
    f = asyncio.run(go())
    assert any("IX. PEKERJAAN STRUKTUR ATAP DAN BAJA" in p for p in asked) or not f.boq_lines, "the engineer is given the BoQ's outline"
    if f.boq_lines:
        assert any(c["rule"].startswith("boq_uncovered_") and "ATAP DAN BAJA" in c["text"] for c in f.result["checks"]), "the scripted breakdown has no roof, and code says so"


def test_a_link_against_the_engineers_own_dates_asks_the_consultant_nothing(project_copy):
    f = scripted_firm({"links": [{"before": "II.1", "after": "II.2", "why": "foundation after earthworks"}]})
    f.rows_from = "the planning engineer's breakdown"
    work = [{"no": "II.1", "name": "Galian", "start_week": 6, "finish_week": 9, "not_before": 35, "days": 28}, {"no": "II.2", "name": "Pondasi", "start_week": 3, "finish_week": 7, "not_before": 14, "days": 35}]
    asyncio.run(f.link(work))
    assert any(c["rule"] == "links" and "in the planning engineer's breakdown" in c["text"] and "master schedule" not in c["text"] for c in f.checks)
    assert not f.code_questions, "they are the engineer's own estimates, so a person settles them here"


def test_work_no_page_describes_costs_no_planner_and_goes_to_the_consultant(project_copy):
    f = scripted_firm({"sections": []})
    called = []
    work = f.work

    async def spy(*a, **k):
        called.append(a[0])
        return await work(*a, **k)

    f.work = spy
    w = {"no": "XIII.1", "name": "Sanitair", "weight": 4, "start_week": 1, "finish_week": 4, "days": 28, "not_before": 0, "value": None}
    asyncio.run(f.write_procedure(w, {"no": "XIII", "name": "Sanitair"}, [], 1))
    assert not called and f.failed == ["XIII.1"] and f.pageless == [w], "nothing to rest on, so no model is paid"
    s = {"accounts": [{"no": "XIII", "name": "Sanitair", "packages": [w]}], "weeks": 4}
    f.finish(s, [w], [])
    assert any(c["rule"] == "failed_XIII.1" and "no page of the documents describes it" in c["text"] for c in f.checks)
    assert any(q["subject"] == "Pekerjaan tanpa spesifikasi di dokumen" and "Sanitair" in q["question"] for q in f.rfi_drafts), "the consultant is asked for it"


def test_the_engineer_is_told_to_cover_the_whole_boq_at_a_crews_level_of_detail(project_copy):
    f = scripted_firm({"estimated": True, "accounts": [{"name": "Struktur", "packages": [{"name": "Kolom Lantai 1", "weight": 60, "start_week": 1, "finish_week": 4}, {"name": "Atap", "weight": 40, "start_week": 5, "finish_week": 8}]}]})
    f.boq_lines = [{"doc": "UP-3", "page": 20, "work": "AEC", "section": "IX. PEKERJAAN STRUKTUR ATAP DAN BAJA", "group": "Struktur Kuda-kuda Atap", "no": "1", "name": "Kuda-kuda", "qty": 12.0, "unit": "kg", "rate": None, "amount": None}]
    s = asyncio.run(f.structure_by_agent(None, 240))
    assert "Cover every section of the BoQ outline" in f.told and "Not each type of column or beam" in f.told, "a crew's work, and every section"
    assert "The BoQ may not be the whole job" in f.told and "such as architecture, sanitary or services" in f.told, "what the scope lists stays in, with or without BoQ rows"
    assert "Never list types, rows or materials in its name" in f.told
    assert "IX. PEKERJAAN STRUKTUR ATAP DAN BAJA (1 rows, pages 20 to 20), such as Struktur Kuda-kuda Atap" in f.prompted, "the outline is in what it reads"
    assert [w["name"] for a in s["accounts"] for w in a["packages"]] == ["Kolom Lantai 1", "Atap"]
    f.boq_lines = []
    asyncio.run(f.structure_by_agent(None, 240))
    assert "Cover every section" not in f.told, "no BoQ lines, no rule about them"


def test_the_3d_timeline_says_what_the_plan_does_not_build(client):
    analyse(client)
    m = client.get("/api/project/model-3d").json()
    built = {e["kind"] for e in m["elements"]}
    assert set(m["absent"]) == {label for kind, label in (("roof", "a roof"), ("openings", "windows and doors"), ("facade", "a façade"), ("interior", "finishes")) if kind not in built}


def test_the_swarm_builds_the_3d_timeline_as_its_last_stage(client):
    rec = analyse(client)
    stages = client.get("/api/aip/analysis").json()["stages"]
    assert stages[-1]["key"] == "model3d" and stages[-1]["status"] == "done" and stages[-1]["by"] == "Code", "last, because it needs the WBS and the schedule"
    m = client.get("/api/project/model-3d").json()
    assert len(m["elements"]) == len(rec["plan"]["packages"]) and f"of {len(m['elements'])} work packages placed" in stages[-1]["note"]
    if m["absent"]:
        assert any(c["rule"] == "model3d_absent" and m["absent"][0] in c["text"] for c in rec["plan"]["checks"]), "what the plan does not build is on the plan, for Review"


def test_a_plan_uploaded_later_gets_its_own_3d_timeline(client):
    """Another project, another package: the same swarm gives it a 3D timeline of its own, with nothing carried over."""
    first = client.get("/api/project/model-3d").json()
    assert client.post("/api/projects", json={"name": "Second project", "template": False}).status_code == 200
    assert client.get("/api/project/model-3d").json()["elements"] == [], "a new project starts with no building"
    for prefix in ("3-", "7-", "8-"):
        f = doc(prefix)
        assert client.post("/api/project/documents", files={"file": (f.name, f.read_bytes(), "application/pdf")}, data={"title": f.stem, "kind": "auto"}).status_code == 200
    rec = analyse(client)
    m = client.get("/api/project/model-3d").json()
    assert len(m["elements"]) == len(rec["plan"]["packages"]) > 0 and m["plan"]["id"] == rec["id"]
    assert first["elements"] == [] or first["plan"] != m["plan"]


def test_the_completion_milestone_follows_whatever_finishes_last(client):
    analyse(client)
    before = client.get("/api/project/critical-path").json()
    assert before["milestones"][0]["days_late"] == 0
    last = before["path"][-1]
    assert client.post(f"/api/project/schedule/{last['id']}", json={"duration": last["duration"] + 30}).status_code == 200
    after = client.get("/api/project/critical-path").json()
    [m] = after["milestones"]
    assert m["forecast"] == after["finish"] > m["contract_date"], "work that runs the whole job has a date that never moves, so it cannot be what says the job is late"
    assert m["days_late"] > 0 and m["activity"] == last["id"], "and it hangs on the work that is now holding the finish"
    assert any(c["rule"] == "milestone_late" for c in P.checks())


def test_approving_starts_the_work_and_a_hold_point_stops_what_follows(client):
    rec = analyse(client)
    assert client.post(f"/api/project/plans/{rec['id']}/approve", json={"note": ""}).status_code == 200
    board = client.get("/api/project/board").json()
    tasks = [c for c in board["cards"] if c.get("step")]
    assert len(tasks) == rec["plan"]["totals"]["steps"] and board["counts"]["stopped"] > 0
    carry = next(c for c in tasks if c["title"] == "Carry out the work")
    r = client.post(f"/api/project/work-items/{carry['id']}", json={"status": "doing"})
    assert r.status_code == 409 and "not signed" in r.json()["detail"]
    step = next(s for s in rec["plan"]["steps"] if s["id"] == carry["step"])
    acts = {a["id"]: a for a in client.get("/api/project/schedule").json()["activities"]}
    assert carry["start"] >= acts[step["activity"]]["start"] and carry["due"] <= acts[step["activity"]]["finish"], "a task's dates sit inside its own work package"
    pr = client.get("/api/project/procedures").json()
    task = next(t for g in pr["groups"] for s in g["sections"] for t in s["tasks"] if t["id"] == carry["step"])
    assert not task["ready"] and any("Hold point" in h["text"] for h in task["holds"]) and any(h["stop"] for h in task["holds"])
    assert client.post("/api/aip/konsultan", json={"nama": "Again", "versi": "mock", "jenis": "package"}).status_code == 409, "a plan with work on the board is not replaced"


def test_a_task_is_ready_when_nothing_holds_it(client):
    rec = analyse(client)
    client.post(f"/api/project/plans/{rec['id']}/approve", json={"note": ""})
    for r in P.all_of("rfi"):
        if r["status"] == "draft":
            P.drop("rfi", r["id"])
    pr = client.get("/api/project/procedures").json()
    first = next(t for g in pr["groups"] for s in g["sections"] for t in s["tasks"] if not t["after"])
    assert first["ready"] and first["holds"] == [] and pr["counts"]["ready"] >= 1
    waiting = next(t for g in pr["groups"] for s in g["sections"] for t in s["tasks"] if not t["after"] and not t["ready"])
    assert "must finish first" in waiting["holds"][0]["text"], "the first task of a package that waits on earlier work is not ready either"


def test_rejecting_takes_the_proposal_away_and_the_agents_remember_why(client, monkeypatch):
    rec = analyse(client)
    drafts = [r["id"] for r in P.all_of("rfi") if r.get("plan") == rec["id"]]
    assert drafts, "its questions wait in the register as drafts"
    assert client.post(f"/api/project/plans/{rec['id']}/reject", json={"note": "Pondasi harus selesai sebelum galian."}).status_code == 200
    assert client.get("/api/project/wbs").json()["root"]["children"] == [] and P.all_of("activity") == [] and P.all_of("boq") == []
    assert not [r for r in P.all_of("rfi") if r.get("plan") == rec["id"]]
    told: list[str] = []
    real = llm.turn

    async def spy(model, instruction, tools, prompt, calls, *a, **k):
        told.append(instruction)
        return await real(model, instruction, tools, prompt, calls, *a, **k)

    monkeypatch.setattr(llm, "turn", spy)
    again = analyse(client)
    assert again["id"] != rec["id"] and again["status"] == "pending"
    assert any("Pondasi harus selesai sebelum galian." in t and "not evidence" in t for t in told), "the next run's agents read the reason"


def test_planning_again_replaces_a_proposal_cleanly(client):
    first = analyse(client)
    second = analyse(client)
    statuses = {p["id"]: p["status"] for p in client.get("/api/project/plans").json()["plans"]}
    assert statuses[first["id"]] == "superseded" and statuses[second["id"]] == "pending"
    assert len(P.all_of("package")) == 5 and len(P.all_of("activity")) == 31, "not twice over"


def test_the_project_cannot_change_under_a_running_review(project_copy, monkeypatch):
    monkeypatch.setattr(P, "busy", "run-x")
    with pytest.raises(ValueError, match="agents are working"):
        P.open_project("scenario")


def test_no_schedule_anywhere_is_said_plainly(project_copy):
    for d in K.uploads():
        P.patch("document", d["id"], {"use": False}, P.PM, "left out")

    async def go():
        firm._emit.set(lambda e: None)
        f = F.PackageFirm(firm_api.model_of("mock", "package"), 5, mock=True)
        await f.engagement()
        return f

    f = asyncio.run(go())
    assert f.result is None and "no schedule" in f.stopped


def test_when_code_cannot_read_the_schedule_an_agent_does_and_a_check_says_so(project_copy, monkeypatch):
    monkeypatch.setattr(K, "read_programme", lambda path: None)

    async def go():
        firm._emit.set(lambda e: None)
        monkeypatch.setattr(firm_api, "MOCK_DELAY", 0)
        f = F.PackageFirm(firm_api.model_of("mock", "package"), 5, mock=True)
        await f.engagement()
        return f

    f = asyncio.run(go())
    assert f.result and f.result["accounts"][0]["name"] == "Scripted account"
    assert any(c["rule"] == "schedule_read" and not c["ok"] and "estimated every date" in c["text"] for c in f.result["checks"]), "the scripted agent says it estimated them"


def test_one_agent_builds_the_wbs_and_the_critical_path_network(project_copy, monkeypatch):
    monkeypatch.setattr(K, "read_programme", lambda path: None)
    asked: list[tuple[str, str]] = []

    async def go():
        firm._emit.set(lambda e: None)
        f = F.PackageFirm(firm_api.model_of("mock", "package"), 5, mock=True)
        work = f.work

        async def spy(key, text, tools, prompt, must_read=True):
            asked.append((key, text))
            return await work(key, text, tools, prompt, must_read=must_read)

        f.work = spy
        await f.engagement()
        return f

    f = asyncio.run(go())
    engineer = [text for key, text in asked if key == "engineer"]
    assert any("work breakdown" in t for t in engineer), "with no schedule code can read, the planning engineer writes the WBS"
    assert any('"links"' in t for t in engineer), "and it says what must finish before what"
    assert all(key != "partner" for key, _ in asked), "the orchestrator only runs the review"
    assert f.result and f.result["accounts"][0]["name"] == "Scripted account"
    assert f.rows_from == "the planning engineer's breakdown", "so no check speaks of a master schedule this package does not have"


def test_the_screen_says_who_does_each_stage(client):
    analyse(client)
    by = {s["key"]: s.get("by") for s in client.get("/api/aip/analysis").json()["stages"]}
    assert by["read"] == "Code", "code read this package's schedule"
    assert by["links"] == "Planning engineer" and by["pages"] == "Document controller" and by["plan"] == "Code"


def test_a_figure_in_a_table_and_the_same_figure_in_a_sentence_are_one_figure():
    assert firm.numbers_in("316.00 bh, 1.000.000,00 dan 12,5") == {"316", "1000000", "125"}
    assert firm.numbers_in("Rp 2.418,44") == {"241844"}


def test_links_against_the_master_schedule_are_refused_and_said(project_copy):
    f = F.PackageFirm(lambda *a: None, 5, mock=True)
    work = [{"no": "A", "name": "A", "start_week": 1, "finish_week": 4, "not_before": 0, "days": 28}, {"no": "B", "name": "B", "start_week": 3, "finish_week": 6, "not_before": 14, "days": 28}, {"no": "C", "name": "C", "start_week": 10, "finish_week": 12, "not_before": 63, "days": 21}]

    async def scripted(key, text, tools, prompt, must_read=True):
        return json.dumps({"links": [{"before": "A", "after": "B", "why": "overlaps"}, {"before": "B", "after": "C", "why": "gap"}, {"before": "C", "after": "A", "why": "backwards"}, {"before": "A", "after": "A"}, {"before": "A", "after": "Z"}, {"before": "A", "after": "B"}]})

    f.work = scripted
    firm._emit.set(lambda e: None)
    links = asyncio.run(f.link(work))
    assert [(x["before"], x["after"], x["lead"]) for x in links] == [("A", "B", -14), ("B", "C", 0)], "the overlap is allowed for, so the schedule's dates stand"
    assert any("wrong order" in c["text"] and "A before C" in c["text"] for c in f.checks)


def test_a_schedule_out_of_physical_order_is_said_and_not_explained_away(project_copy):
    f = scripted_firm({"links": [{"before": "II.1", "after": "II.2", "why": "foundation after earthworks"}]})
    work = [{"no": "II.1", "name": "Galian dan Urugan", "start_week": 6, "finish_week": 9, "not_before": 35, "days": 28}, {"no": "II.2", "name": "Pondasi", "start_week": 3, "finish_week": 7, "not_before": 14, "days": 35}]
    links = asyncio.run(f.link(work))
    assert not links, "code keeps the schedule's dates, so the link waits for a person"
    assert "must fit this schedule" not in f.told and "do not invent a reason" in f.told, "the agent is asked for the physical order, not one that suits the schedule"
    assert any(c["rule"] == "links" and "II.2 before II.1" in c["text"] for c in f.checks)
    assert any("II.2 Pondasi (M-3 s/d M-7) sebelum II.1 Galian dan Urugan (M-6 s/d M-9)" in q["question"] for q in f.code_questions), "and the consultant is asked which order stands"


def test_a_failed_work_package_is_named_and_the_rest_carry_on(project_copy, monkeypatch):
    real = mock_package.MockPackageLlm.answer

    def flaky(self, results, tools):
        return "not json" if self.agent_key == "planner_2" else real(self, results, tools)

    monkeypatch.setattr(mock_package.MockPackageLlm, "answer", flaky)

    async def go():
        firm._emit.set(lambda e: None)
        monkeypatch.setattr(firm_api, "MOCK_DELAY", 0)
        f = F.PackageFirm(firm_api.model_of("mock", "package"), 5, mock=True)
        await f.engagement()
        return f

    f = asyncio.run(go())
    assert len(f.failed) == 1
    assert len(f.written) == 30 and any(c["rule"].startswith("failed_") and "could not be read" in c["text"] for c in f.result["checks"])
    assert f.result["activities"] and len(f.result["accounts"]) == 5, "the work package is still in the WBS, with no procedures yet"


def test_a_spending_limit_stops_the_agents(project_copy):
    async def go():
        firm._emit.set(lambda e: None)
        f = F.PackageFirm(firm_api.model_of("mock", "package"), 5, mock=True)
        f.stopped = "stopped at the spending limit of $5.00"
        await f.engagement()
        return f

    f = asyncio.run(go())
    assert not f.written, "not one more call"
    assert any("no procedures" in c["text"] for c in f.result["checks"])


# ------------------------------------------------------------------------------------------------ what real runs showed


UNAIR = ROOT / "docs" / "unair-airlangga-edupreneur-center-2024"


@pytest.mark.skipif(not UNAIR.exists(), reason="the second package is not here")
@pytest.mark.parametrize("start, kind, use", [("Dokumen-Persyaratan-Penyedia", "tender", False), ("Dokumen-Persyaratan-Proses", "tender", False), ("Jadwal-", "tender", False), ("KAK-AEC", "scope", True), ("Daftar-Kuantitas", "boq", True), ("II.-9.-Gambar", "drawing", False), ("Rancangan-Kontran", "contract", True), ("Berita-Acara-Pemberian", "clarification", True), ("Surat-Penawaran", "award", False)])
def test_a_second_real_package_is_sorted_by_what_its_files_hold(start, kind, use):
    path = next(UNAIR.glob(f"{start}*"))
    got = K.classify(path.name, K.read_pages(path))
    assert got[:2] == (kind, use), got


def test_a_file_named_a_schedule_is_a_schedule_only_if_it_holds_one():
    grid = ["M-1 M-2 " + " ".join(f"{n}%" for n in range(30))]
    assert K.classify("Jadwal Pelaksanaan.pdf", grid)[0] == "programme"
    assert K.classify("Jadwal Pelaksanaan.pdf", ["Waktu pelaksanaan 8 minggu sejak kontrak."])[0] == "programme"
    assert K.classify("Jadwal Pelaksanaan.pdf", ["Lembar Data Pemilihan: identitas Pokja, dan syarat peserta."])[:2] == ("tender", False)


def package_of(monkeypatch, *rows: dict) -> dict:
    docs = [{"id": f"UP-{i}", "title": r["kind"], "use": True, "pages": len(r["text"]), "kind": r["kind"], "digest": str(i), **({"use": r["use"]} if "use" in r else {})} for i, r in enumerate(rows, 1)]
    monkeypatch.setattr(K, "uploads", lambda: docs)
    monkeypatch.setattr(K, "pages_of", lambda rid: rows[int(rid.split("-")[1]) - 1]["text"])
    return K.review()


def test_a_boq_with_no_prices_and_drawings_with_no_text_are_said(monkeypatch):
    many = ["a. Bekisting 22.40 m2 - Rp - Rp", "b. Pembesian 12,963.47 kg - Rp - Rp", "c. Beton 150.19 m3 - Rp - Rp"]
    missing = package_of(monkeypatch, {"kind": "boq", "text": many}, {"kind": "drawing", "text": ["", ""], "use": False})["missing"]
    assert any("quantities but no prices" in m for m in missing), missing
    assert any("drawings are pictures" in m for m in missing), missing
    priced = ["Bekisting 22.40 m2 Rp 250.000 Rp 5.600.000", "x", "y"]
    assert not any("no prices" in m for m in package_of(monkeypatch, {"kind": "boq", "text": priced})["missing"])


def test_a_document_with_no_contents_pages_is_described_by_its_own_headings():
    d = {"pages_text": ["DAFTAR KUANTITAS", "I PEKERJAAN PERSIAPAN\nbiasa saja", "III. PEKERJAAN STRUKTUR BAWAH\n1 Galian", "IV. PEKERJAAN STRUKTUR LANTAI GROUND"]}
    assert F.PackageFirm.contents(d) == "page 2: I PEKERJAAN PERSIAPAN\npage 3: III. PEKERJAAN STRUKTUR BAWAH\npage 4: IV. PEKERJAAN STRUKTUR LANTAI GROUND"
    assert F.PackageFirm.contents({"pages_text": ["Satu halaman saja."]}) == "Satu halaman saja."


def row(no: str, name: str, weight: float, first: int, last: int, value: int | None = None) -> dict:
    return {"no": no, "name": name, "weight": weight, "weeks": [first, last], "start_week": first, "finish_week": last, "days": (last - first + 1) * 7, "not_before": (first - 1) * 7, "value": value}


def scripted_firm(answer: dict) -> F.PackageFirm:
    f = F.PackageFirm(lambda *a: None, 5, mock=True)
    f.used = [{"id": "UP-1", "title": "RKS", "kind": "spec", "pages_text": [f"halaman {n}" for n in range(1, 61)]}]

    async def scripted(key, text, tools, prompt, must_read=True):
        f.told, f.prompted = text, prompt
        return json.dumps(answer)

    f.work = scripted
    firm._emit.set(lambda e: None)
    return f


def test_a_row_lumping_crews_together_splits_along_the_documents_sections():
    pages = lambda a, b: [{"doc": "UP-1", "from": a, "to": b}]  # noqa: E731
    f = scripted_firm({"pages": {"IV": pages(1, 60), "II": pages(5, 6)}, "split": {
        "IV": [{"name": "PEKERJAAN LAN", "share_pct": 30, "start_week": 2, "finish_week": 99, "pages": pages(10, 12)}, {"name": "Pekerjaan CCTV", "share_pct": 0, "start_week": 40, "finish_week": 30, "pages": pages(20, 22)}, {"name": "CCTV without pages", "share_pct": 50}, {"name": "Tata Suara", "share_pct": 50, "start_week": "soon", "pages": pages(30, 31)}, "rubbish"],
        "II": [{"name": "a", "share_pct": 50, "pages": pages(1, 1)}, {"name": "b", "share_pct": 50, "pages": pages(2, 2)}]}})
    s = {"accounts": [{"no": "II", "name": "Struktur", "packages": [row("II", "Beton", 2.0, 1, 4, 1000)]}, {"no": "IV", "name": "Elektrikal", "packages": [row("IV", "Elektrikal", 16.48, 5, 20, 6_241_568_380)]}]}
    found = asyncio.run(f.find_pages(s))
    assert [w["no"] for w in s["accounts"][0]["packages"]] == ["II"], "a small row is one crew's work, whatever an agent says"
    parts = s["accounts"][1]["packages"]
    assert [w["no"] for w in parts] == ["IV.1", "IV.2", "IV.3"]
    assert [w["name"] for w in parts] == ["Elektrikal: LAN", "Elektrikal: CCTV", "Elektrikal: Tata Suara"], "and a part with no pages is dropped"
    assert sum(w["value"] for w in parts) == 6_241_568_380 and abs(sum(w["weight"] for w in parts) - 16.48) < 0.001, "the parts add up to exactly what the row is worth"
    assert (parts[0]["start_week"], parts[0]["finish_week"], parts[0]["not_before"]) == (5, 20, 28), "a part stays inside the row's weeks"
    assert (parts[1]["start_week"], parts[1]["finish_week"]) == (5, 20) and (parts[2]["start_week"], parts[2]["finish_week"]) == (5, 20), "weeks that make no sense are the row's"
    assert parts[1]["days"] == 112 and found["IV.1"] == pages(10, 12) and found["II"] == pages(5, 6)
    assert any(c["rule"] == "split_IV" and not c["ok"] and "estimates" in c["text"] for c in f.checks), "and a check says whose figures those are"


def test_one_part_is_not_a_split():
    pages = [{"doc": "UP-1", "from": 1, "to": 2}]
    f = scripted_firm({"pages": {"IV": pages}, "split": {"IV": [{"name": "Semua", "share_pct": 100, "pages": pages}]}})
    s = {"accounts": [{"no": "IV", "name": "Elektrikal", "packages": [row("IV", "Elektrikal", 16.48, 5, 20, 100)]}]}
    asyncio.run(f.find_pages(s))
    assert [w["no"] for w in s["accounts"][0]["packages"]] == ["IV"] and not f.checks


def test_a_late_finish_never_passes_the_end_of_the_job():
    acts = [("A", "All the site overheads", 100, [], "self"), ("B", "Earthworks", 10, ["A"], "self"), ("C", "Slab", 10, ["B"], "self")]
    s = C.schedule(activities=acts, links={"A": [], "B": ["A"], "C": ["B"]}, start="2026-01-05", not_before={"B": 5, "C": 15}, leads={"B": {"A": -95}})
    by = {a["id"]: a for a in s["activities"]}
    end = max(a["finish"] for a in s["activities"])
    for a in s["activities"]:
        assert date.fromisoformat(a["finish"]) + timedelta(days=a["float_days"]) <= date.fromisoformat(end), a
    assert by["A"]["float_days"] == 0 and by["C"]["float_days"] > 0


def test_work_running_side_by_side_has_float_and_keeps_the_schedules_dates(project_copy):
    work = [row("A", "Slab", 5, 1, 4), row("B", "Next slab", 5, 4, 7), row("C", "Masonry", 5, 8, 30), row("D", "Plaster", 5, 12, 30), row("E", "Ceilings", 5, 14, 28), row("F", "Paint", 5, 27, 40)]
    f = scripted_firm({"links": [{"before": "A", "after": "B"}, {"before": "B", "after": "C"}, {"before": "C", "after": "D"}, {"before": "D", "after": "E"}, {"before": "E", "after": "F"}]})
    links = {(x["before"], x["after"]): x for x in asyncio.run(f.link(work))}
    assert links[("A", "B")]["lead"] == -7, "one floor follows the next, overlapping a little: a slip in the first is a slip in the second"
    assert links[("C", "D")]["beside"] is True and "lead" not in links[("C", "D")], "these run side by side"
    assert links[("D", "E")]["beside"] is False, "ceilings end before the plaster here, and the schedule's dates stand"
    leads = {b: {a: x["lead"]} for (a, b), x in links.items() if "lead" in x}
    beside = {b: {a: x["beside"]} for (a, b), x in links.items() if "beside" in x}
    acts = [(w["no"], w["name"], w["days"], [a for a, b in links if b == w["no"]], "self") for w in work]
    plan = C.schedule(activities=acts, links={a[0]: a[3] for a in acts}, start="2026-01-05", not_before={w["no"]: w["not_before"] for w in work}, leads=leads, overlaps=beside)
    by = {a["id"]: a for a in plan["activities"]}
    day0 = date(2026, 1, 5)
    for w in work:
        assert by[w["no"]]["start"] == (day0 + timedelta(days=w["not_before"])).isoformat(), f"{w['no']} keeps the master schedule's start"
    assert by["F"]["critical"] and by["F"]["float_days"] == 0, "the last work holds the finish"
    assert by["C"]["float_days"] > 0 and by["D"]["float_days"] > 0, "work running side by side can slip without moving everything"
    assert not all(a["critical"] for a in plan["activities"]), "if all of it reads as critical, the answer says nothing"
    late = C.schedule(activities=[("A", "Slab", 200, [], "self"), *[x for x in acts if x[0] != "A"]], links={a[0]: a[3] for a in acts}, start="2026-01-05", not_before={w["no"]: w["not_before"] for w in work}, leads=leads, overlaps=beside)
    assert max(a["finish"] for a in late["activities"]) > max(a["finish"] for a in plan["activities"]), "and a real slip still moves the end"


def test_the_critical_path_is_a_chain_from_the_start_to_the_last_work(client):
    analyse(client)
    c = client.get("/api/project/critical-path").json()
    last = max(c["activities"], key=lambda r: r["ef"])
    assert c["path"], "a chain is always shown when work is linked"
    assert c["path"][-1]["finish"] == last["ef"] or c["path"][-1]["float_days"] == 0
    by = {r["id"]: r for r in c["activities"]}
    for a, b in zip(c["path"], c["path"][1:]):
        assert a["id"] in by[b["id"]]["after"], "each link in the chain is a real link"
    for r in c["activities"]:
        assert r["lf"] <= c["finish"], f"{r['name']} cannot have a late finish after the job ends"


def test_work_that_runs_the_whole_job_is_not_linked_and_loose_ends_are_said(project_copy):
    work = [row("I", "Site overheads", 2.5, 1, 12), row("A", "Piles", 5, 1, 4), row("B", "Basement", 5, 3, 6), row("C", "Walls", 5, 5, 8), row("D", "Paint", 5, 10, 12)]
    f = scripted_firm({"links": [{"before": "I", "after": "A"}, {"before": "A", "after": "B"}, {"before": "B", "after": "I"}]})
    links = asyncio.run(f.link(work))
    assert [(x["before"], x["after"]) for x in links] == [("A", "B")], "overheads end when the job does: that says nothing about what follows them"
    check = next(c for c in f.checks if c["rule"] == "links_open")
    assert "2 work packages have nothing linked after them" in check["text"] and "B, C" in check["text"], "D ends the job, and is not loose"


def test_a_work_package_named_in_words_the_pages_never_use_is_said(project_copy):
    f = scripted_firm({"sections": [{"name": "GRC", "tasks": [{"ref": "t1", "name": "Pasang GRC", "procedure": ["Pasang."], "kind": "operation"}]}]})
    f.used[0]["pages_text"][0] = "Pekerjaan GRC dipasang sesuai gambar."
    asyncio.run(f.write_procedure(row("III.9", "Fasade", 11.72, 36, 47, 4_441_020_139), {"name": "Arsitektur"}, [{"doc": "UP-1", "from": 1, "to": 1}], 1))
    check = next(c for c in f.checks if c["rule"].startswith("unnamed_"))
    assert "Fasade" in check["text"] and "4,441,020,139" in check["text"] and not check["ok"]
    g = scripted_firm({"sections": [{"name": "GRC", "tasks": [{"ref": "t1", "name": "Pasang GRC", "procedure": ["Pasang."], "kind": "operation"}]}]})
    g.used[0]["pages_text"][0] = "Pekerjaan fasade dan GRC."
    asyncio.run(g.write_procedure(row("III.9", "Fasade", 11.72, 36, 47, 100), {"name": "Arsitektur"}, [{"doc": "UP-1", "from": 1, "to": 1}], 1))
    assert not g.checks


def test_a_breakdown_by_an_agent_is_numbered_by_code_and_loses_no_row(project_copy):
    f = scripted_firm({"estimated": True, "accounts": [{"no": "A", "name": "Persiapan", "packages": [{"no": "A.1", "name": "Mobilisasi", "weight": 10, "start_week": 1, "finish_week": 2}, {"no": "A.1", "name": "Pagar", "start_week": 1, "finish_week": 3}]}, {"no": "B", "name": "STRUKTUR", "packages": [{"no": "x", "name": "Beton", "weight": 30, "start_week": 3, "finish_week": 20}, {"name": "No weeks", "weight": 5}, "rubbish"]}, "rubbish"]})
    f.used = [{"id": "UP-2", "title": "BoQ", "kind": "boq", "pages_text": ["I PEKERJAAN PERSIAPAN"]}]
    s = asyncio.run(f.structure_by_agent(None, 240))
    assert [a["no"] for a in s["accounts"]] == ["I", "II"], "an account is whatever the agent called it, and code reads the groups by number"
    work = [w for a in s["accounts"] for w in a["packages"]]
    assert [(w["no"], w["name"]) for w in work] == [("I.1", "Mobilisasi"), ("I.2", "Pagar"), ("II.1", "Beton")], "a row given no weight is not lost as a heading, and numbers cannot clash"
    assert abs(sum(w["weight"] for w in work) - 100) < 0.02 and s["estimated"] is True and s["weeks"] == 20
    assert "240 calendar days" in f.told, "the agent is told the time the contract allows"


TASK = '{"ref": "%s", "kind": "operation", "name": "Kerjakan %s", "procedure": ["Langkah."], "sources": [{"doc": "UP-1", "page": 1, "quote": "kata"}]}'


@pytest.mark.parametrize("broken", [
    '{"scope": "S", "sections": [{"name": "Galian", "tasks": [%s]}]}, {"name": "Urugan", "tasks": [%s]}], "questions": [{"subject": "Q", "question": "Berapa?"}]}',  # closed too soon: real Muse, "Extra data"
    '{"scope": "S", "sections": [{"name": "Galian", "tasks": [%s]}}, {"name": "Urugan", "tasks": [%s]}}], "questions": [{"subject": "Q", "question": "Berapa?"}]}',  # a wrong closer: real Muse, "Expecting a comma"
])
def test_a_planners_answer_with_its_brackets_miscounted_is_read_all_the_same(broken):
    assert firm.parse_json(broken % (TASK % ("t1", "a"), TASK % ("t2", "b"))) is None, "this is what real Muse sent, and a plain reading fails"
    got = F.read_plan(broken % (TASK % ("t1", "a"), TASK % ("t2", "b")))
    assert [(s["name"], [t["ref"] for t in s["tasks"]]) for s in got["sections"]] == [("Galian", ["t1"]), ("Urugan", ["t2"])]
    assert got["scope"] == "S" and got["questions"][0]["subject"] == "Q" and got["damaged"] == 0


def test_valid_json_with_a_task_in_the_wrong_place_loses_no_task():
    answer = '{"sections": [{"name": "Galian", "tasks": [%s]}, %s]}' % (TASK % ("t1", "a"), TASK % ("t2", "b"))
    assert firm.parse_json(answer), "valid JSON, but a plain reading would lose t2"
    assert [t["ref"] for s in F.read_plan(answer)["sections"] for t in s["tasks"]] == ["t1", "t2"]


def test_a_task_that_cannot_be_read_is_counted_and_said(project_copy):
    broken = '{"sections": [{"name": "Galian", "tasks": [' + TASK % ("t1", "a") + ', {"ref": "t2", "name": "rusak", "procedure": ["Langkah"}]}]}'
    got = F.read_plan(broken)
    assert got["damaged"] == 1 and [t["ref"] for t in got["sections"][0]["tasks"]] == ["t1"]
    f = F.PackageFirm(lambda *a: None, 5, mock=True)
    f.used = [{"id": "UP-1", "title": "RKS", "kind": "spec", "pages_text": ["kata dan fasade"]}]
    asked = []

    async def scripted(key, text, tools, prompt, must_read=True):
        asked.append(prompt)
        return broken

    f.work = scripted
    firm._emit.set(lambda e: None)
    asyncio.run(f.write_procedure(row("III.9", "Fasade", 11.72, 36, 47, 100), {"name": "Arsitektur"}, [{"doc": "UP-1", "from": 1, "to": 1}], 1))
    assert len(asked) == 2, "it gets one more try"
    assert [t["ref"] for sec in f.written["III.9"]["sections"] for t in sec["tasks"]] == ["t1"], "what could be read is kept"
    assert any(c["rule"] == "damaged_III.9" and not c["ok"] and "may be missing" in c["text"] for c in f.checks), "and what could not is said"


@pytest.mark.parametrize("stage, rule", [("pages", "pages_read"), ("links", "links_read"), ("review", "review_read")])
def test_an_answer_that_cannot_be_read_is_said_and_not_taken_for_silence(project_copy, stage, rule):
    f = F.PackageFirm(lambda *a: None, 5, mock=True)
    f.used = [{"id": "UP-1", "title": "RKS", "kind": "spec", "pages_text": ["Beton harus dicor pagi hari. Beton dirawat 14 hari."]}]
    tries = []

    async def scripted(key, text, tools, prompt, must_read=True):
        tries.append(key)
        return "not json at all"

    f.work = scripted
    firm._emit.set(lambda e: None)
    work = [row("A", "Beton", 2, 1, 4, 100), row("B", "Cat", 2, 5, 8, 100)]
    if stage == "pages":
        found = asyncio.run(f.find_pages({"accounts": [{"no": "I", "name": "Struktur", "packages": work}]}))
        assert found["A"] == [{"doc": "UP-1", "from": 1, "to": 1}], "code searches for the work's own words instead"
    elif stage == "links":
        assert asyncio.run(f.link(work)) == []
    else:
        asyncio.run(f.review())
        assert f.found == []
    assert len(tries) == 2, "one more try, and no more"
    assert any(c["rule"] == rule and not c["ok"] for c in f.checks)


def test_the_document_for_the_site_says_what_the_screen_says(client):
    analyse(client)
    pid = client.get("/api/project/plans").json()["plans"][0]["id"]
    doc = client.get(f"/api/project/plans/{pid}/procedure.md").text
    shown = client.get("/api/project/procedures").json()
    task = shown["groups"][4]["sections"][0]["tasks"][0]
    for wanted in (shown["groups"][4]["code"], shown["groups"][4]["name"], task["code"], task["name"], task["safety"], task["steps"][0], f"page {task['sources'][0]['page']}", task["sources"][0]["quote"], "Responsible: Site engineer", "Hold point: work stops until this is signed", "Open questions for the consultant", "first draft for a site engineer", "Offline mock"):
        assert wanted in doc, wanted
    for wrong in ("Peak crew", "By self", "material waste", "WBS .", "Activities AC-"):
        assert wrong not in doc, wrong
    table = client.get(f"/api/project/plans/{pid}/table.csv").text
    assert table.startswith("\ufeffwbs,work_package,section,task_id"), "Excel reads the documents' language only with the mark"
    assert task["code"] in table and "labour_cost" not in table
    rows = list(csv.reader(io.StringIO(table.lstrip("\ufeff"))))
    assert len(rows) == 1 + shown["counts"]["tasks"] and all(r[0] for r in rows), "every task, each with its WBS code"


def test_the_sample_projects_download_is_unchanged():
    rec = {"status": "pending", "plan": {"title": "T", "activities": ["A"], "sections": [], "materials": [], "workforce": [], "steps": [], "totals": {"hours_per_oh": 7, "operations": 0, "inspections": 0, "handling": 0, "man_hours": 0, "days": 1, "peak_crew": 0, "cost": 0, "waste_cost": 0}}}
    assert "Peak crew" in wbs.procedure_markdown(rec), "only a real package's plan has the new layout"


def test_a_split_parts_name_does_not_repeat_itself():
    pages = [{"doc": "UP-1", "from": 1, "to": 2}]
    f = scripted_firm({"pages": {}, "split": {"IV": [{"name": "Pekerjaan Elektrikal, Pekerjaan Panel, Pekerjaan Kabel Tray dan Pekerjaan Lampu", "share_pct": 50, "pages": pages}, {"name": "ELEKTRIKAL", "share_pct": 50, "pages": pages}]}})
    s = {"accounts": [{"no": "IV", "name": "Elektrikal", "packages": [row("IV", "Elektrikal", 16.48, 5, 20, 100)]}]}
    asyncio.run(f.find_pages(s))
    assert [w["name"] for w in s["accounts"][0]["packages"]] == ["Elektrikal: Panel, Kabel Tray dan Lampu", "Elektrikal"]


# ------------------------------------------------------------------------------------------------ Indonesian regulations, applied by code


def test_a_package_s_citations_are_read_in_the_forms_documents_write_them():
    text = ("a. Undang -Undang Nomor 28 Tahun 2002; b. Undang-undang Nomor 11 Tahun 2020 Tentang Cipta Kerja; h. Presiden Nomor 12 Tahun 2021 tentang Perubahan; "
            "i. Permen PUPR No 10 tahun 2021; m. Peraturan Menteri Pekerjaan Umum dan Perumahan Rakyat Nomor 22/PRT/M/2018; Permen PUPR No. 14/2020; "
            "Peraturan Pemerintah Nomor 36 Tahun 2005; UU 6/2023; Permen ESDM No. 045 tahun 2005; Peraturan Lembaga LKPP Nomor 12 Tahun 2021")
    got = REG.cited([{"id": "D", "pages_text": ["", text]}])
    assert set(got) == {"uu-28-2002", "uu-11-2020", "perpres-12-2021", "permen-10-2021", "permen-22-2018", "permen-14-2020", "pp-36-2005", "uu-6-2023"}, "a minister of another sector, or LKPP, is not the minister of public works"
    assert got["permen-10-2021"] == [("D", 2)]


def test_only_what_was_revoked_and_not_replaced_in_the_same_package_is_flagged():
    cites = {"uu-11-2020": [("R", 8)], "permen-1-2022": [("R", 8)], "pp-36-2005": [("R", 8)], "pp-16-2021": [("R", 8)], "permen-10-2021": [("R", 8)], "permen-99-2030": [("R", 9)]}
    out = {r["key"]: r for r in REG.revoked(cites)}
    assert set(out) == {"uu-11-2020", "permen-1-2022"}, "a package that cites what replaced a regulation knows it was replaced, and one not in the register says nothing"
    assert out["permen-1-2022"]["by_name"] == "Permen PUPR 8/2023" and "Pasal 24" in out["permen-1-2022"]["note"]


@needs_documents
def test_the_real_rks_cites_two_regulations_revoked_before_its_tender():
    from pypdf import PdfReader

    reader = PdfReader(str(doc("1-KAK")))
    pages = [""] * 7 + [reader.pages[i].extract_text() for i in (7, 8)]
    got = sorted(r["key"] for r in REG.revoked(REG.cited([{"id": "RKS", "pages_text": pages}])))
    assert got == ["permen-1-2022", "uu-11-2020"], "PP 36/2005 is cited beside PP 16/2021, which replaced it"


CRANE = {"id": "C", "title": "Kontrak", "pages_text": ["DAFTAR PERALATAN UTAMA. 1. Tower Crane Panjang boom 60m, beban ujung 1,5 ton 1 unit"]}
PLAIN = {"id": "C", "title": "Kontrak", "pages_text": ["Pekerjaan dinding dan cat."]}


def test_the_safety_risk_level_follows_pasal_34_and_is_asked_of_the_owner():
    assert REG.safety_risk(None, True, [PLAIN]) is None, "with nothing to judge it by, it says nothing"
    assert REG.safety_risk(9e9, True, [PLAIN])["level"] == "kecil" and REG.safety_risk(150e9, False, [PLAIN])["level"] == "besar"
    r = REG.safety_risk(38_075_872_228, True, [CRANE])
    assert (r["level"], r["by_value"], r["ratio"]) == ("besar", "sedang", 40), "a tower crane is lifting equipment, and the higher level counts"
    assert "tower crane" in r["text"] and "By value alone it would be sedang" in r["text"] and "Rp 38.08 bn" in r["text"] and "Kontrak, page 1" in r["text"]
    assert r["question"]["to"] == "Pengguna Jasa" and "Rp 38,08 miliar" in r["question"]["question"] and "pesawat angkat" in r["question"]["question"]
    assert r["rule"]["article"] == "Pasal 38 ayat (3)" and "1:40" in r["rule"]["quote"]
    stated = {"id": "S", "title": "RKS", "pages_text": ["Risiko Keselamatan Konstruksi pekerjaan ini adalah besar."]}
    agreed = REG.safety_risk(38e9, True, [stated, CRANE])
    assert agreed["agrees"] and agreed["question"] is None and "The documents say" in agreed["text"], "when the documents already say what its criteria give, there is nothing to ask"


def test_a_list_that_allows_either_crane_is_quoted_as_it_stands():
    r = REG.safety_risk(None, True, [{"id": "C", "title": "Kontrak", "pages_text": ["6 Tower Crane/Mobil Crane Min. 1 unit"]}])
    assert r["level"] == "besar" and r["lifting"]["match"] == "Tower Crane/Mobil Crane" and "tower crane/mobil crane" in r["text"]


def test_the_owners_estimate_can_be_read_from_a_sentence_that_lists_several_packages():
    two = {"id": "E", "kind": "estimate", "title": "HPS", "pages_text": ["Harga Perkiraan Sendiri (HPS) Paket 1 : Pembangunan Airlangga Edupreneur Center Tahap I Universitas Airlangga senilai Rp80.000.000.000,00 Link : https://lpse.unair.ac.id/hps Paket 2 : Revitalisasi Masjid Nuruzzaman Kampus B Universitas Airlangga senilai Rp55.000.000.000,00"]}
    assert REG.said_value([two], "Airlangga Edupreneur Center Tahap 1") == 80e9
    assert REG.said_value([two], "Revitalisasi Masjid Nuruzzaman") == 55e9
    assert REG.said_value([two], "Universitas Airlangga") is None, "a name that fits both settles nothing"
    one = {"id": "E", "kind": "estimate", "title": "HPS", "pages_text": ["HPS senilai Rp 12.500.000.000,00"]}
    assert REG.said_value([one]) == 12.5e9
    assert REG.said_value([{**one, "kind": "boq"}]) is None, "only an estimate is the owner's"
    assert REG.safety_risk(REG.said_value([two], "Airlangga Edupreneur Center Tahap 1"), True, [two])["by_value"] == "sedang"


@pytest.mark.parametrize("words, letters", [("Pasang perancah luar dan scaffolding", ["g"]), ("Las sambungan dengan las listrik", ["a"]), ("Gali tanah dengan lebar cukup", ["j"]),
                                            ("Angkat dan tempatkan modul GRC dengan kerekan", ["b"]), ("Jatuh dari ketinggian; pakai safety belt", ["f"]), ("Laksanakan test beban penuh 3 x 24 jam", ["i"]),
                                            ("Cat dinding dua lapis", []), ("Pasang balok separator lift kelas satu", []),
                                            ("Oles minyak pelepas; jaga ventilasi dan jangan ada api terbuka di dekat bahan minyak", []), ("Potong besi dengan api terbuka", ["a"])])
def test_special_work_is_found_by_its_own_words(words, letters):
    assert [x["letter"] for x in REG.special(words)] == letters


@pytest.mark.parametrize("kind, name, steps, equipment, safety, letters", [
    ("operation", "Pasang bekisting kolom", "Rakit panel.", "panel bekisting", "Jatuh dari ketinggian; pakai sabuk keselamatan", ["f"]),
    ("operation", "Pasang tulangan balok Lantai 04", "Ikat tulangan.", "", "Jatuh dari tepi lantai; pasang pagar tepi", ["f"]),
    ("operation", "Kerjakan benangan", "Tarik benang.", "", "Terpeleset dan jatuh dari perancah", ["g"]),
    ("operation", "Pasang penutup grill", "Pasang.", "", "Percikan gerinda/las", ["a"]),
    ("operation", "Pasang modul PV", "Pasang kabel.", "", "Sengatan DC tegangan tinggi", ["i"]),
    ("operation", "Pancang tiang", "Pancang.", "Mobile crane", "", ["b"]),
    ("operation", "Laksanakan galian tanah pilecap", "Keruk tanah.", "", "", ["j"]),
    ("inspection", "Uji fungsi panel", "Uji beban penuh.", "", "", ["i"]),
    ("inspection", "Periksa sambungan", "Periksa.", "", "Sengatan saat uji bertegangan", ["i"]),
    ("operation", "Pasang wastafel gantung dan kran", "Pasang bracket.", "", "Wastafel jatuh; angkat berdua", []),
    ("operation", "Pasang panel distribusi", "Pasang panel.", "", "Sengatan; pastikan tidak bertegangan", []),
    ("operation", "Cor beton pile cap", "Cor.", "", "Terjatuh ke galian; pakai APD", []),
    ("operation", "Pasang bowplank", "Tandai as agar mudah dibaca oleh pekerjaan galian.", "", "", []),
    ("operation", "Bongkar bekisting", "Bongkar.", "", "Kejatuhan panel dan debu gerinda", []),
    ("operation", "Datangkan APD pelindung tubuh", "Simpan di gudang.", "", "Tumpukan sepatu/harness", []),
    ("handling", "Muat tanah bekas galian ke alat angkut", "Muat tanah.", "", "", []),
    ("inspection", "Periksa bekisting sebelum cor", "Periksa.", "perancah", "Jatuh dari perancah saat inspeksi", []),
    ("operation", "Urus izin kerja di ketinggian dan perancah", "Ajukan izin.", "", "Jatuh dari ketinggian", [])])
def test_a_task_needs_a_permit_for_what_it_does_not_what_it_warns_of(kind, name, steps, equipment, safety, letters):
    assert [x["letter"] for x in REG.permit_for(kind, name, steps, equipment, safety)] == letters


def test_a_sentence_starts_at_its_clause_number_and_a_heading_runs_on_into_its_clause():
    flat = "Persetujuan tidak mengubah kewajiban penyedia. 17). Rapat Persiapan Pelaksanaan Perjanjian 1. Selambat-lambatnya 7 (tujuh) hari sejak diterbitkannya SPMK, rapat diadakan. 18). Lain."
    i = flat.index("Rapat")
    assert REG._clause(flat, i, i + 5, REG._ends(flat)) == "17). Rapat Persiapan Pelaksanaan Perjanjian 1. Selambat-lambatnya 7 (tujuh) hari sejak diterbitkannya SPMK, rapat diadakan."
    flat = "Lokasi di Jl. Flora No. 1 Bulaksumur. 3. Masa pemeliharaan 180 (serratus delapan puluh ) hari kalender atau sesuai dengan kontrak."
    i = flat.index("Masa")
    assert REG._clause(flat, i, i + 4, REG._ends(flat)).startswith("3. Masa pemeliharaan 180"), "and No. or Jl. ends no sentence"
    flat = "2. Lift, Genset dibayar 60% dari harga satuan pekerjaan; 70.4.(c) Denda akibat Keterlambatan Untuk pekerjaan ini besar denda 1/1000 dari nilai kontrak."
    i = flat.index("Denda")
    assert REG._clause(flat, i, i + 5, REG._ends(flat)).startswith("70.4.(c) Denda"), "a clause numbered like this one starts there, not at the list before it"


@needs_documents
def test_what_the_contract_requires_is_found_in_its_own_words_and_a_disagreement_is_said():
    from pypdf import PdfReader

    contract = K.read_pages(doc("4-Draft"))
    reader = PdfReader(str(doc("1-KAK")))
    rks = [""] * 5 + [reader.pages[i].extract_text() for i in (5, 6)]
    docs = [{"id": "C", "title": "Draft Kontrak", "kind": "contract", "pages_text": contract}, {"id": "R", "title": "RKS", "kind": "spec", "pages_text": rks}]
    by = {o["key"]: o for o in REG.obligations(docs, REG.safety_risk(38e9, True, docs))}
    assert [(f["doc"], f["page"], f["days"]) for f in by["pcm"]["found"]] == [("C", 9, 7), ("R", 6, 7)] and not by["pcm"]["conflict"], "both give 7 days from the SPMK"
    assert ("R", 6, 14) in [(f["doc"], f["page"], f["days"]) for f in by["mc0"]["found"]]
    m = by["maintenance"]
    assert [(f["doc"], f["page"], f["days"], f["unit"]) for f in m["found"]] == [("C", 4, 180, "hari kerja"), ("R", 7, 180, "hari kalender")]
    assert "180 hari kerja" in m["conflict"] and "180 hari kalender" in m["conflict"], "working days against calendar days: a real difference of two months or more"
    assert by["staff"]["rule"]["article"] == "Pasal 38 ayat (3)" and "besar" in by["staff"]["note"]
    assert by["skk"]["found"] == [] and by["skk"]["rule"]["name"] == "UU 2/2017", "the documents read do not say it, and the law says it all the same"
    for o in by.values():
        assert len(o["found"]) <= (3 if o["key"] in ("pcm", "mc0", "insurance", "maintenance", "asbuilt") else 1)
        for f in o["found"]:
            assert K.found_in(f["quote"], (contract if f["doc"] == "C" else rks)[f["page"] - 1]), "every quotation is on its page"


def test_the_analysis_applies_indonesian_regulations_and_the_site_sees_them(client):
    rec = analyse(client)
    checks = {c["rule"]: c for c in rec["plan"]["checks"]}
    risk = checks["safety_risk"]
    assert not risk["ok"] and "besar" in risk["text"] and "tower crane" in risk["text"], "the contract's equipment list has a tower crane"
    assert any(q["subject"] == "Tingkat Risiko Keselamatan Konstruksi" and q["activity"] == "" for q in rec["rfi_drafts"]), "asked of the owner, drafted and not sent"
    stages = {s["key"]: s for s in client.get("/api/aip/analysis").json()["stages"]}
    assert stages["rules"]["status"] == "done" and "safety risk besar" in stages["rules"]["note"]
    p = client.get("/api/project/procedures").json()
    assert [o["key"] for o in p["obligations"] if o["phase"] == "before"] == ["pcm", "plans", "mc0", "staff", "permits", "skk", "insurance"]
    pcm = next(o for o in p["obligations"] if o["key"] == "pcm")
    assert pcm["found"][0]["days"] == 7 and pcm["rule"]["article"] == "Pasal 21 ayat (5)" and pcm["rule"]["url"].startswith("https://")
    tasks = [t for g in p["groups"] for sec in g["sections"] for t in sec["tasks"]]
    assert all("permit" in t for t in tasks) and p["permit_tasks"] == sum(1 for t in tasks if t["permit"]) and p["permit_rule"]["article"].startswith("Pasal 26")
    doc_md = client.get(f"/api/project/plans/{rec['id']}/procedure.md").text
    assert "## Before any work starts" in doc_md and "Pasal 21 ayat (5)" in doc_md and "## At handover" in doc_md
    table = client.get(f"/api/project/plans/{rec['id']}/table.csv").text
    assert "work_permit" in table.splitlines()[0]


def test_a_planner_is_told_what_needs_a_work_permit(project_copy):
    f = scripted_firm({"sections": [{"name": "Perancah", "tasks": [{"ref": "t1", "name": "Pasang perancah", "procedure": ["Pasang."], "kind": "operation"}]}]})
    f.used[0]["pages_text"][0] = "Perancah dipasang sesuai gambar."
    told = []

    async def scripted(key, text, tools, prompt, must_read=True):
        told.append(text)
        return json.dumps({"sections": [{"name": "Perancah", "tasks": [{"ref": "t1", "name": "Pasang perancah", "procedure": ["Pasang."], "kind": "operation"}]}]})

    f.work = scripted
    asyncio.run(f.write_procedure(row("III.1", "Perancah", 1, 1, 2, 100), {"name": "Persiapan"}, [{"doc": "UP-1", "from": 1, "to": 1}], 1))
    assert "Permen PUPR 10/2021 Pasal 26 ayat (2)" in told[0] and "work permit" in told[0]


# ------------------------------------------------------------------------------------------------ the 3D timeline


@pytest.mark.parametrize("name, account, kind, level", [
    ("Beton: Lantai Basement", "Struktur", "structure", "basement"), ("Beton: Lantai 01", "Struktur", "structure", 1), ("Beton: Lantai Atap", "Struktur", "structure", "roof"),
    ("Beton: Atap", "Struktur", "roof", None), ("Beton: Balok Separator Lift", "Struktur", "lift", None), ("Beton: Ground Water Tank", "Struktur", "tank", None),
    ("Galian dan Urugan", "Struktur", "earthworks", None), ("Pondasi dan Anti Rayap", "Struktur", "foundation", None), ("Persiapan dan SMKK", "Persiapan dan SMKK", "site", None),
    ("Pasangan dan Plesteran", "Arsitektur", "walls", None), ("Finishing Lantai dan Dinding", "Arsitektur", "interior", None), ("Fasade", "Arsitektur", "facade", None),
    ("Elektrikal: LAN (Local Area Network)", "Elektrikal", "electrical", None), ("Mekanikal: Pompa, Plambing dan Peralatan Sanitari, STP (Sewage Treatment Plan)", "Mekanikal", "mechanical", None),
    ("Beton: Perkuatan Plafon dan Rumah STP", "Struktur", "stp", None),("Mekanikal, Elektrikal dan Elektronika: Mekanikal", "Mekanikal, Elektrikal dan Elektronika", "mechanical", None),
    ("Kolom Beton", "Struktur Lantai 1", "structure", 1), ("Tie Beam", "Struktur Lantai Ground", "structure", "ground"), ("Pondasi Square Pile 40x40 cm, h = 24 m", "Struktur Bawah", "foundation", None),
    ("galian tanah pilecap dgn alat berat", "Tanah dan Beton Non Struktur", "earthworks", None), ("Pile Cap Tipe PC-1 1200x1200x700mm", "Struktur Bawah", "foundation", None),
    # the short names a planner gives
    ("Pondasi Pancang", "Struktur Bawah", "foundation", None), ("Pile Cap dan Pondasi", "Struktur Bawah", "foundation", None), ("Tie Beam Ground", "Struktur", "structure", "ground"), ("Kolom Ground", "Struktur", "structure", "ground"),
    ("Balok Plat Tangga Ground", "Struktur", "structure", "ground"), ("Kolom Lantai 1", "Struktur", "structure", 1), ("Balok dan Plat Lantai 1", "Struktur", "structure", 1), ("Tangga Lantai 1", "Struktur", "structure", 1),
    ("Kuda-kuda Atap", "Struktur Atap", "roof", None), ("Dilatasi Bangunan", "Struktur Atap", "joint", None), ("Tanah Tangga dan Ramp", "Tangga dan Ramp", "earthworks", None), ("Struktur Tangga dan Ramp", "Tangga dan Ramp", "entrance", None),
    ("Arsitektur", "Arsitektur", "architecture", None), ("Sanitair", "Sanitair", "interior", None), ("Mekanikal Elektrikal Elektronika", "Mekanikal Elektrikal Elektronika", "services", None),
    # the lumped ones: a lift among other parts does not make the package the lift
    ("Pile Cap Tipe PC-1, PC-1A, PC-2, PC-3, PC-4, Pit Lift, Pondasi Lajur - Bekisting, Pembesian, Beton", "Iii. Pekerjaan Struktur Bawah", "foundation", None),
    ("Tie Beam tipe TB1 TB2, Plat Lantai Ground Tb. 20 cm, Balok Separator Lift", "Iv. Pekerjaan Struktur Lantai Ground", "structure", "ground"),
    ("Tangga Tipe 1, Dinding Beton Pit Lift dan Dinding Beton Retaining Wall Lantai Ground", "Iv. Pekerjaan Struktur Lantai Ground", "structure", "ground"),
    ("Balok Separator Lift, Balok Bordes Tangga Tipe 1 dan Tangga Tipe 1 Lantai 1", "V. Pekerjaan Struktur Lantai 1", "structure", 1), ("Balok Beton Lift dan Balok Bordes Tangga Lantai 4", "Viii. Pekerjaan Struktur Lantai 4", "structure", 4),
    ("Struktur Kuda-kuda Atap WF 300.150.6,5.9 dan Pekerjaan Dilatasi Bangunan", "Ix. Pekerjaan Struktur Atap", "roof", None), ("galian tanah, Pekerjaan urugan pasir, Pekerjaan lantai kerja Tangga dan Ramp Entrance", "X. Pekerjaan Struktur Tangga dan Ramp Entrance", "earthworks", None),
    ("Struktur Tangga dan Ramp Entrance - Bekisting, Pembesian, Beton", "X. Pekerjaan Struktur Tangga dan Ramp Entrance", "entrance", None), ("Pit Lift", "Struktur Bawah", "lift", None), ("Pekerjaan Lift", "Mekanikal", "lift", None),
    ("Sesuatu yang lain", "Lain-lain", "other", None)])
def test_what_each_work_package_builds_is_read_from_its_name(name, account, kind, level):
    got = model3d.classify(name, account)
    assert got[:2] == (kind, level), got


def test_how_the_piles_go_in_is_read_from_the_words():
    assert model3d.pile_method(["Pondasi Bore Pile dia 60 cm"]) == "bored"
    assert model3d.pile_method(["Pondasi Square Pile 40x40 cm, h = 24 m", "tiang pancang"]) == "driven"
    assert model3d.pile_method(["Pondasi dan Anti Rayap"]) == "", "the name says nothing, so nothing is claimed"


def test_a_roof_of_frames_only_is_not_a_covered_roof():
    assert not model3d.roof_covered(["Kuda-kuda Atap"]) and not model3d.roof_covered(["Struktur Kuda-kuda Atap WF 300.150.6,5.9 dan Pekerjaan Dilatasi Bangunan"])
    assert model3d.roof_covered(["Beton: Atap"]), "UGM's says nothing either way, and is not taken to leave the tiles out"
    assert model3d.roof_covered(["Rangka atap baja ringan dan penutup genteng"]) and model3d.roof_covered(["Kuda-kuda Atap", "Penutup Atap Genteng"])


def test_a_lift_is_one_the_building_has_not_one_a_load_needs():
    for said in ("Beton: Balok Separator Lift", "b. Pekerjaan galian tanah pit lift dgn alat berat", "Passenger Elevator Mitsubishi, Schindler", "2. Lift, Genset, Trafo"):
        assert model3d.LIFT.search(said), said
    for said in ("atau bukan di atap, lantai, atau lubang lift, maka terali", "Sewa forklift", "lifting the panels", "lift the formwork into place"):
        assert not model3d.LIFT.search(said), said


def test_which_crane_is_read_from_what_is_hired_not_what_is_allowed():
    assert model3d.crane_kind(["Sewa mobile Crane"], [], ["3. Tower Crane/Mobil Crane Min. 5 Ton"]) == "mobile", "Unair prices a mobile crane; its other words allow either"
    assert model3d.crane_kind([], [], ["1. Tower Crane Panjang boom 60m, beban ujung 1,5 ton 1 unit", "1 (satu) unit tower crane"]) == "tower", "UGM"
    assert model3d.crane_kind([], [], ["Tower Crane/Mobil Crane Min. 5 Ton", "Tower Crane / Mobile Crane"]) == "", "allowing either names neither"
    assert model3d.crane_kind([], [], ["Excavator PC 75"]) == ""


def test_floors_follow_how_the_wbs_numbers_them():
    floors, index = model3d.storeys({"basement": "Lantai Basement", 1: "Lantai 01", 2: "Lantai 02", 3: "Lantai 03", 4: "Lantai 04", 5: "Lantai 05", "roof": "Lantai Atap"}, 3.25)
    assert [(f["index"], f["name"], f["elevation"]) for f in floors] == [(-1, "Lantai Basement", -3.25), (0, "Lantai 01", 0), (1, "Lantai 02", 4), (2, "Lantai 03", 8), (3, "Lantai 04", 12), (4, "Lantai 05", 16)]
    assert index["roof"] == 5, "the roof slab sits on the top floor"
    _, ground = model3d.storeys({"ground": "Lantai Ground", 1: "Lantai 1", 4: "Lantai 4"}, 3.5)
    assert (ground["ground"], ground[1], ground[4]) == (0, 1, 4), "a building with a ground floor counts from it"
    floors, _ = model3d.storeys({4: "Level 4"}, 3.5)
    assert [(f["index"], f["planned"]) for f in floors] == [(0, False), (1, False), (2, False), (3, True)], "the floors below the lowest one planned were there before"


def test_the_grid_and_the_floor_areas_are_read_from_a_drawing_s_text():
    assert model3d._grid("21000 7000 7000 7000 21000 7000 7000 7000 7000 28000 7000 7000") == {"bay": 7.0, "width": 28.0, "depth": 21.0, "count": 9, "spans": [28000, 21000]}
    assert model3d._grid("4500 14025 -6600 GWT") is None, "a section's heights are not a grid"
    assert model3d._areas("TOTAL LUASAN 627,84 M2 3.851,04 M2 627,84 M2 627,84 M2 627,84 M2 687,84 M2 651,84 M2") == {"total": 3851.04, "floors": [627.84, 627.84, 627.84, 627.84, 687.84, 651.84]}
    assert model3d._areas("627,84 M2 700,00 M2") is None, "without a total that adds up, it is not a table of floor areas"


def test_the_3d_timeline_is_built_from_the_plan_the_schedule_and_the_drawings(client):
    analyse(client)
    m = client.get("/api/project/model-3d").json()
    assert (m["width"], m["depth"], m["bay"], m["basement_depth"]) == (28.0, 21.0, 7.0, 3.25), "the drawings' own grid and lowest floor level"
    assert [r["page"] for r in m["read"]] == [6, 6, 3] and "3,851.04" in m["read"][2]["what"]
    assert [f["name"] for f in m["storeys"]] == ["Lantai Basement", "Lantai 01", "Lantai 02", "Lantai 03", "Lantai 04", "Lantai 05"] and m["top"] == 20
    kinds = Counter(e["kind"] for e in m["elements"])
    assert (kinds["structure"], kinds["foundation"], kinds["interior"], kinds["other"]) == (7, 1, 7, 0), kinds
    assert len(m["elements"]) == len(client.get("/api/project/work-packages").json()["packages"]) and m["crane"] == "tower", "every work package, and the contract's tower crane"
    assert all(0 <= e["start"] < e["end"] <= m["days"] for e in m["elements"]) and m["days"] == 364
    floor1 = next(e for e in m["elements"] if e["name"] == "Beton: Lantai 01")
    assert (floor1["level"], floor1["start"]) == (0, 98), "Lantai 01 is the ground floor, and starts in week 15 of the master schedule"
    assert any("4 m" in a for a in m["assumed"]), "and it says what it had to assume"


def test_the_sample_project_s_floors_and_the_work_named_for_one(monkeypatch, tmp_path):
    monkeypatch.setattr(P, "DB", tmp_path / "project.db")
    monkeypatch.setattr(P, "SCENARIO_DB", tmp_path / "project.db")
    monkeypatch.setattr(firm_api, "STORE", tmp_path / "runs")
    P._conn = None
    with TestClient(firm_api.app) as c:
        m = c.get("/api/project/model-3d").json()
    memory.close()
    P._conn.close()
    P._conn = None
    assert [(f["name"], f["planned"]) for f in m["storeys"]] == [("Floor 1", False), ("Floor 2", False), ("Level 3", True), ("Level 4", True)], "the floors below the work were built before it"
    by = {e["name"]: e for e in m["elements"]}
    assert (by["Level 2 remaining masonry"]["kind"], by["Level 2 remaining masonry"]["level"]) == ("walls", 1), "work named for a floor goes on that floor"
    assert by["Level 2 MEP first fix"]["kind"] == "mechanical" and by["Pour Level 4 slab"]["level"] == 3
    assert any("placeholder" in a for a in m["assumed"]), "with no drawings, the size is a placeholder, and it says so"


def test_with_no_plan_the_3d_timeline_says_so(project_copy):
    with TestClient(firm_api.app) as c:
        m = c.get("/api/project/model-3d").json()
    assert m["elements"] == [] and m["days"] == 0


def test_the_scenarios_plan_still_works_as_it_did(monkeypatch, tmp_path):
    monkeypatch.setattr(P, "DB", tmp_path / "project.db")
    monkeypatch.setattr(P, "SCENARIO_DB", tmp_path / "project.db")
    monkeypatch.setattr(P, "TODAY", C.TODAY)
    monkeypatch.setattr(P, "busy", "")
    monkeypatch.setattr(firm_api, "STORE", tmp_path / "runs")
    monkeypatch.setattr(firm_api, "RUNS", {})
    monkeypatch.setattr(firm_api, "TASKS", {})
    monkeypatch.setattr(firm_api, "PROJECTS", {})
    monkeypatch.setattr(firm_api, "MOCK_DELAY", 0)
    P._conn = None
    with TestClient(firm_api.app) as c:
        assert c.post("/api/aip/konsultan", json={"nama": "Plan", "versi": "mock", "jenis": "plan"}).status_code == 200
        for _ in range(600):
            a = c.get("/api/aip/analysis").json()
            if a["run"]["status"] != "running":
                break
            import time

            time.sleep(0.05)
        assert a["run"]["status"] == "succeeded" and a["stages"]
        assert c.get("/api/project/control-accounts").json()["accounts"][0]["id"] == "CA-STR"
        assert c.get("/api/project/work-packages").json()["packages"][0]["id"] == "A50"
        assert c.get("/api/project/wbs-dictionary").status_code == 200
        pr = c.get("/api/project/procedures").json()
        assert pr["counts"]["tasks"] == 18 and pr["groups"][0]["sections"][0]["tasks"][0]["steps"]
        assert c.get("/api/project/cost-estimate").json()["method"] == "bottom_up"
        cp = c.get("/api/project/critical-path").json()
        assert cp["path"] and cp["network"]
    memory.close()
    P._conn = None


def test_work_tied_to_nothing_gets_a_second_look(project_copy):
    f = F.PackageFirm(lambda *a: None, 5, mock=True)
    work = [{"no": "A", "name": "Struktur", "start_week": 1, "finish_week": 4, "not_before": 0, "days": 28}, {"no": "B", "name": "Plafond", "start_week": 5, "finish_week": 10, "not_before": 28, "days": 42},
            {"no": "C", "name": "Fire Alarm", "start_week": 6, "finish_week": 10, "not_before": 35, "days": 35}]
    asked = []

    async def scripted(key, text, tools, prompt, must_read=True):
        asked.append(prompt)
        return json.dumps({"links": [{"before": "A", "after": "B", "why": "ceiling on the frame"}] if len(asked) == 1 else [{"before": "A", "after": "C", "why": "cables run on the frame"}]})

    f.work = scripted
    firm._emit.set(lambda e: None)
    links = asyncio.run(f.link(work))
    assert len(asked) == 2 and "Nothing linked to it at all" in asked[1] and "C: Fire Alarm" in asked[1].split("Nothing linked to it at all")[1], "even though it ends with the job, so nothing has to follow it"
    assert ("A", "C") in {(x["before"], x["after"]) for x in links}


def test_a_tender_summary_from_the_procurement_system_never_goes_to_a_model():
    summary = ["Kode Tender 10135337000 Nama Tender Pembangunan Gedung. Nilai HPS Paket Rp 42.264.218.000,00. Jadwal tahapan. Peserta: PT Contoh, NPWP 01.234.567.8."]
    assert K.classify("Summary-Report-10135337000_merge.pdf", summary)[:2] == ("award", False), "named as one"
    assert K.classify("dokumen.pdf", summary)[:2] == ("award", False), "or only by what its first page says, though that states the HPS"
    assert K.classify("2-HPS-Pemb-Gedung.pdf", ["Kode Tender 101. Harga Perkiraan Sendiri. Jumlah 42.264.218.000,00"])[:2] == ("estimate", True), "a file named for what it is keeps its name's rule"


def test_one_sheet_that_cannot_be_read_does_not_lose_the_rest_of_the_file(tmp_path, monkeypatch):
    import pypdf

    class Sheet:
        def __init__(self, text):
            self.text = text

        def extract_text(self):
            if self.text is None:
                raise ValueError("Reached maximum number of tokens per stream")
            return self.text

    class Reader:
        def __init__(self, path):
            self.pages = [Sheet("Denah lantai 1"), Sheet(None), Sheet("Detail kolom")]

    monkeypatch.setattr(pypdf, "PdfReader", Reader)
    path = tmp_path / "gambar.pdf"
    path.write_bytes(b"%PDF")
    assert K.read_pages(path) == ["Denah lantai 1", "", "Detail kolom"], "it reads as a page with no text, and the rest stay"


def test_a_dkh_is_a_boq_and_its_unit_price_analysis_is_not_read_as_one():
    assert K.classify("DKH-Ged-II-HTC.pdf", ["HARGA SATUAN JUMLAH (Rp) (Rp)"])[0] == "boq", "the usual short name for a Daftar Kuantitas dan Harga"
    bill = "PEKERJAAN : GEDUNG\nA. PEKERJAAN PERSIAPAN\n1 Pembersihan lahan 100 m2 - Rp 5.000\n"
    analysis = "ANALISA HARGA SATUAN PEKERJAAN\nPekerjaan : Gedung\nTukang Kayu 2,000 OH - Rp 5.000\n"
    more = "Kepala Tukang 17,0 OH - Rp 7.000\n"
    lines = K.read_boq_lines("D", [bill, analysis, more])
    assert [x["name"] for x in lines] == ["Pembersihan lahan"], "nor the pages that run on from it with no heading of their own"
    assert len(K.read_boq_lines("D", [analysis, more, "DAFTAR KUANTITAS DAN HARGA\n" + bill])) == 1, "a BoQ that comes after its analysis is still read"

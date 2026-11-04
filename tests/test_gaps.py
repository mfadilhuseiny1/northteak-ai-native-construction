"""What was missing for a team to rely on the app: accounts and roles, the other side answering in the app, submittals, an adoption scorecard, and the firm's cost codes. No model is called."""

from __future__ import annotations

import csv
import io

import pytest
from fastapi.testclient import TestClient

from swarm import accounts as A, firm_api, modules as M, outside as O, project as P, reports as R, scorecard, standards, submittals as S
from tests.test_modules import _close, records, template  # noqa: F401 - each test on its own copy of the records


@pytest.fixture(autouse=True)
def clean():
    A._tries.clear()
    yield


def _client() -> TestClient:
    return TestClient(firm_api.app)


def _team(c: TestClient) -> None:
    assert c.post("/api/auth/first", json={"name": "Dewi", "email": "dewi@firm.id", "password": "owner-pass"}).status_code == 200
    for name, email, role in (("Budi", "budi@firm.id", "pm"), ("Sari", "sari@firm.id", "site"), ("Tono", "tono@firm.id", "finance"), ("Rina", "rina@firm.id", "viewer")):
        assert c.post("/api/auth/users", json={"name": name, "email": email, "role": role, "password": "their-pass"}).status_code == 200


def _as(email: str, password: str = "their-pass") -> TestClient:
    c = _client()
    assert c.post("/api/auth/login", json={"email": email, "password": password}).status_code == 200
    return c


def test_with_no_accounts_this_computer_opens_and_the_network_is_refused():
    c = _client()
    me = c.get("/api/auth/me").json()
    assert me["enabled"] is False and me["user"] is None and me["local"] is True and "plan" in me["can"], "a laptop presenting the app needs nothing set up"
    assert c.get("/api/project/overview").status_code == 200
    assert not A._path().exists() or not A.enabled()
    far = {"x-forwarded-host": "192.168.1.20:8310"}  # what the screens' proxy really sends: it connects from here whoever is asking, and passes on the address the browser used
    assert c.get("/api/project/overview", headers=far).status_code == 403, "through the screens' proxy, from another device"
    assert c.post("/api/rfis", json={"subject": "s", "question": "q", "to": "t"}, headers=far).status_code == 403
    assert c.post("/api/auth/first", json={"name": "X", "email": "x@y.z", "password": "12345678"}, headers=far).status_code == 403, "and nobody takes the first account from outside"
    assert c.get("/api/auth/me", headers=far).json()["local"] is False
    assert c.get("/api/project/overview", headers={"x-forwarded-host": "127.0.0.1:8310"}).status_code == 200
    assert c.get("/api/project/overview", headers={"x-forwarded-host": "localhost:8310"}).status_code == 200
    assert c.get("/api/project/overview", headers={"x-forwarded-host": "[::1]:8310"}).status_code == 200
    assert c.get("/api/project/overview", headers={"x-forwarded-for": "192.168.1.20"}).status_code == 403


def test_once_there_is_an_account_everyone_signs_in():
    c = _client()
    assert c.post("/api/auth/first", json={"name": "Dewi", "email": "dewi@firm.id", "password": "short"}).status_code == 409
    _team(c)
    assert c.post("/api/auth/first", json={"name": "X", "email": "x@firm.id", "password": "12345678"}).status_code == 409, "the first account is the only one made that way"
    stranger = _client()
    assert stranger.get("/api/project/overview").status_code == 401
    assert stranger.post("/api/auth/login", json={"email": "budi@firm.id", "password": "wrong-pass"}).status_code == 401
    assert stranger.get("/api/auth/me").json()["user"] is None
    assert _as("budi@firm.id").get("/api/project/overview").status_code == 200
    assert c.get("/api/auth/me").json()["user"]["role"] == "admin"
    assert "hash" not in c.get("/api/auth/users").json()["users"][0] and "salt" not in c.get("/api/auth/users").json()["users"][0]


def test_too_many_wrong_passwords_make_a_person_wait():
    c = _client()
    _team(c)
    for _ in range(A.MOST_TRIES):
        assert c.post("/api/auth/login", json={"email": "sari@firm.id", "password": "wrong-pass"}).status_code == 401
    got = c.post("/api/auth/login", json={"email": "sari@firm.id", "password": "their-pass"})
    assert got.status_code == 401 and "wait" in got.json()["detail"], "even the right one, for now"


def test_each_role_can_do_its_own_work_and_no_more():
    c = _client()
    _team(c)
    site, money, viewer, pm = _as("sari@firm.id"), _as("tono@firm.id"), _as("rina@firm.id"), _as("budi@firm.id")
    log = {"area": "Level 1", "text": "Pengecoran kolom"}
    assert site.post("/api/project/daily-reports", json=log).status_code == 200
    assert money.post("/api/project/daily-reports", json=log).status_code == 403
    assert viewer.post("/api/project/daily-reports", json=log).status_code == 403
    assert viewer.get("/api/project/daily-reports").status_code == 200, "a viewer reads everything"
    assert money.post("/api/project/contingency", json={"amount": 100}).status_code == 200
    refused = site.post("/api/project/contingency", json={"amount": 100})
    assert refused.status_code == 403 and "Site engineer" in refused.json()["detail"]
    assert site.post("/api/aip/konsultan", json={"nama": "x", "versi": "mock", "jenis": "package"}).status_code == 403, "running the agents is a planning decision"
    assert pm.get("/api/auth/users").status_code == 403, "only an administrator sees the team"
    assert pm.post("/api/auth/users", json={"name": "X", "email": "x@firm.id", "role": "admin", "password": "12345678"}).status_code == 403
    assert c.post("/api/auth/users", json={"name": "X", "email": "x@firm.id", "role": "god", "password": "12345678"}).status_code == 409


def test_the_audit_trail_names_the_person_and_the_record_says_who_decided():
    c = _client()
    _team(c)
    _as("sari@firm.id").post("/api/project/daily-reports", json={"area": "Level 1", "text": "Pengecoran kolom"})
    assert [e["who"] for e in P.audit(5) if e["action"] == "filed a daily report"][:1] == ["Sari"]
    assert [r["author"] for r in P.daily_reports()][-1] == "Sari"


def test_people_leave_and_the_last_administrator_cannot():
    c = _client()
    _team(c)
    rows = {u["email"]: u for u in c.get("/api/auth/users").json()["users"]}
    sari = _as("sari@firm.id")
    assert c.post(f"/api/auth/users/{rows['sari@firm.id']['id']}", json={"active": False}).status_code == 200
    assert sari.get("/api/project/overview").status_code == 401, "she is signed out at once"
    assert _client().post("/api/auth/login", json={"email": "sari@firm.id", "password": "their-pass"}).status_code == 401
    assert c.post(f"/api/auth/users/{rows['dewi@firm.id']['id']}", json={"role": "pm"}).status_code == 409
    assert c.post(f"/api/auth/users/{rows['dewi@firm.id']['id']}", json={"active": False}).status_code == 409
    assert c.post("/api/auth/password", json={"old": "wrong-pass", "new": "new-owner-pass"}).status_code == 401
    assert c.post("/api/auth/password", json={"old": "owner-pass", "new": "new-owner-pass"}).status_code == 200
    assert _as("dewi@firm.id", "new-owner-pass").get("/api/auth/me").json()["user"]["name"] == "Dewi"


def _rfi() -> dict:
    return P.add_rfi({"subject": "Mutu beton", "question": "Berapa mutu kolom?\n  - f'c kolom", "to": "Konsultan Pengawas", "activity": ""}, "draft", P.SWARM)


def test_a_consultant_answers_an_rfi_from_a_link_with_no_account():
    c = _client()
    rid = _rfi()["id"]
    sent = c.post(f"/api/project/share/rfi/{rid}", json={"to": "Pak Agus"}).json()
    assert sent["path"].startswith("/reply?t=") and "Mutu beton" in sent["message"] and "Pak Agus" in sent["message"]
    rec = P.get("rfi", rid)
    assert rec["status"] == "open" and rec["issued_on"] == P.TODAY and rec["sent"]["to"] == "Pak Agus", "sending it issues it"
    token = sent["path"].split("t=")[1]
    _team(c)  # accounts on: the link still needs none, and nothing else opens with it
    outsider = _client()
    seen = outsider.get(f"/api/public/reply/{token}").json()
    assert seen["title"] == "Mutu beton" and "f'c kolom" in seen["body"] and seen["open"] is True and seen["project"]
    assert outsider.get("/api/project/overview", headers={"cookie": f"siteswarm={token}"}).status_code == 401, "a link opens that one item and nothing else"
    assert outsider.post(f"/api/public/reply/{token}", json={"name": " ", "text": "K-350"}).status_code == 409
    assert outsider.post(f"/api/public/reply/{token}", json={"name": "Agus", "text": " "}).status_code == 409
    assert outsider.post(f"/api/public/reply/{token}", json={"name": "Agus", "text": "f'c 30 MPa"}).status_code == 200
    got = P.get("rfi", rid)
    assert got["status"] == "answered" and got["answer"] == "f'c 30 MPa" and got["answered_by"] == "Agus" and got["answered_via"] == "link"
    assert any(e["who"] == "Agus (via link)" for e in P.audit(10)), "the trail says who answered, and how"
    assert outsider.post(f"/api/public/reply/{token}", json={"name": "Agus", "text": "ganti"}).status_code == 409, "a link is answered once"
    assert outsider.get(f"/api/public/reply/{token}").json()["answer"] == "f'c 30 MPa"
    assert outsider.get("/api/public/reply/not-a-real-token").status_code == 404


def test_an_owner_decides_a_variation_from_a_link_and_it_counts():
    c = _client()
    vid = R.add_variation("Tambah waterproofing", "Owner's change", 5_000_000, 3)["id"]
    before = c.get("/api/project/report").json()["revised"]
    token = c.post(f"/api/project/share/variation/{vid}", json={"to": "PPK"}).json()["path"].split("t=")[1]
    assert P.get("variation", vid)["status"] == "submitted"
    assert c.post(f"/api/public/reply/{token}", json={"name": "Ibu Sri", "text": "", "decision": "maybe"}).status_code == 409
    assert c.post(f"/api/public/reply/{token}", json={"name": "Ibu Sri", "text": "Setuju", "decision": "approved"}).status_code == 200
    assert P.get("variation", vid)["status"] == "approved" and P.get("variation", vid)["decided_by"] == "Ibu Sri"
    assert c.get("/api/project/report").json()["revised"] == before + 5_000_000


def test_a_link_expires_and_a_new_one_replaces_it():
    c = _client()
    rid = _rfi()["id"]
    first = c.post(f"/api/project/share/rfi/{rid}", json={}).json()["path"].split("t=")[1]
    second = c.post(f"/api/project/share/rfi/{rid}", json={}).json()["path"].split("t=")[1]
    assert c.get(f"/api/public/reply/{first}").status_code == 404 and c.get(f"/api/public/reply/{second}").status_code == 200
    with A.closing(A._db()) as con:
        con.execute("update links set expires = 0")
        con.commit()
    assert c.get(f"/api/public/reply/{second}").status_code == 404


def test_a_submittal_goes_from_draft_through_a_decision_and_back_for_a_revision():
    c = _client()
    aid = P.schedule()["activities"][0]["id"]
    s = c.post("/api/project/submittals", json={"title": "Bata ringan", "kind": "material", "activity": aid}).json()
    assert s["status"] == "draft" and s["id"].startswith("SUB-") and s["needed_by"]
    assert c.post("/api/project/submittals", json={"title": " ", "kind": "material"}).status_code == 409
    assert c.post("/api/project/submittals", json={"title": "x", "kind": "nothing"}).status_code == 409
    sid = s["id"]
    assert c.post(f"/api/project/submittals/{sid}/decide", json={"decision": "approved"}).status_code == 409, "not before it is submitted"
    assert c.post(f"/api/project/submittals/{sid}/submit").json()["status"] == "submitted"
    token = c.post(f"/api/project/share/submittal/{sid}", json={"to": "MK"}).json()["path"].split("t=")[1]
    assert c.post(f"/api/public/reply/{token}", json={"name": "Agus", "text": "", "decision": "rejected"}).status_code == 409, "a rejection says what has to change"
    assert c.post(f"/api/public/reply/{token}", json={"name": "Agus", "text": "Ganti merek", "decision": "rejected"}).status_code == 200
    s = P.get("submittal", sid)
    assert s["status"] == "rejected" and s["history"][0]["note"] == "Ganti merek" and s["decided_by"] == "Agus (via link)"
    assert c.post(f"/api/project/submittals/{sid}/submit").json()["rev"] == 1, "submitted again as the next revision"
    assert c.post(f"/api/project/submittals/{sid}/decide", json={"decision": "noted"}).status_code == 409
    assert c.post(f"/api/project/submittals/{sid}/decide", json={"decision": "approved"}).json()["status"] == "approved"
    assert c.post(f"/api/project/submittals/{sid}/drop").status_code == 409, "what was decided stays on the record"
    assert c.post("/api/project/submittals/SUB-999/submit").status_code == 404
    other = c.post("/api/project/submittals", json={"title": "x", "kind": "shop"}).json()["id"]
    assert c.post(f"/api/project/submittals/{other}/drop").json() == {"dropped": other}


def test_an_open_submittal_and_a_joined_rfi_warn_the_work_they_hold():
    c = _client()
    acts = [a["id"] for a in P.schedule()["activities"]][:2]
    sid = S.add("Shop drawing kolom", "shop", acts[0])["id"]
    held = lambda aid: [b for card in M.board()["cards"] if card.get("activity") == aid for b in card["blockers"]]  # noqa: E731
    assert not any(b["kind"] == "submittal" for b in held(acts[0])), "a draft is not yet waiting on anyone"
    S.submit(sid)
    assert any(b["kind"] == "submittal" and b["ref"] == sid and not b["stop"] for b in held(acts[0])), "it warns, and a person decides"
    S.decide(sid, "approved")
    assert not any(b["kind"] == "submittal" for b in held(acts[0]))
    rid = P.add_rfi({"subject": "Gambar", "question": "Mohon gambar", "to": "MK", "activity": acts[0], "activities": acts}, "open", P.PM)["id"]
    assert any(b["ref"] == rid for b in held(acts[1])), "a question that joins two packages holds both"


def test_a_submittal_register_can_be_drafted_from_what_the_planners_wrote():
    aid = P.schedule()["activities"][0]["id"]
    plan = {"id": "WBS-1", "status": "pending", "plan": {"steps": [{"id": "O-1", "activity": aid, "name": "Ajukan shop drawing kolom", "procedure": ["Minta persetujuan bahan"], "sources": [{"doc": "UP-001", "page": 12, "quote": "shop drawing"}]}, {"id": "O-2", "activity": aid, "name": "Ajukan shop drawing balok", "procedure": []}]}}
    P.put("plan", "WBS-1", plan)
    got = S.from_plan()
    assert got["added"] == 2 and sorted(s["kind"] for s in got["submittals"]) == ["material", "shop"], "one for each kind a work package needs"
    assert next(s for s in got["submittals"] if s["kind"] == "shop")["ref"] == "UP-001 p.12"
    assert S.from_plan()["added"] == 0, "and it adds only what is new"


def test_the_scorecard_measures_what_people_really_do_and_says_what_it_cannot_yet():
    c = _client()
    for r in P.all_of("rfi"):
        P.drop("rfi", r["id"])
    first = c.get("/api/project/scorecard").json()
    by = {m["key"]: m for m in first["measures"]}
    assert len(by) == 6 and first["of"] == 6
    assert by["rfi"]["value"] is None and by["rfi"]["state"] == "none", "nothing answered, so no score, not a zero"
    rid = _rfi()["id"]
    P.issue_rfi(rid)
    token = O.share("rfi", rid)["path"].split("t=")[1]
    O.reply(token, "Agus", "Jawaban")
    by = {m["key"]: m for m in c.get("/api/project/scorecard").json()["measures"]}
    assert by["rfi"]["value"] == 0 and by["rfi"]["state"] == "good" and by["link"]["value"] == 100
    other = P.add_rfi({"subject": "Lama", "question": "?", "to": "MK"}, "open", P.PM)["id"]
    P.patch("rfi", other, {"raised_on": "2026-01-01", "answered_on": "2026-02-01", "status": "answered", "answer": "x"}, P.PM, "x")
    by = {m["key"]: m for m in c.get("/api/project/scorecard").json()["measures"]}
    assert by["rfi"]["state"] == "behind" and by["link"]["value"] == 50, "an answer typed in by us counts against the link"
    assert c.get("/api/project/scorecard").json()["people"], "and it says who is using it"
    assert c.get("/api/reports/scorecard").json()["projects"]


def test_each_work_package_gets_a_company_code_from_its_words():
    listed = standards.codes()
    assert standards.guess("Elektrikal: Fire Alarm", "Elektrikal", listed) == "11", "the particular trade wins over the account"
    assert standards.guess("Elektrikal: CCTV", "Elektrikal", listed) == "13"
    assert standards.guess("Beton: Lantai 01", "Struktur", listed) == "03"
    assert standards.guess("Beton: Atap", "Struktur", listed) == "03", "concrete, though it says roof"
    assert standards.guess("Galian dan Urugan", "Struktur", listed) == "02"
    assert standards.guess("Mekanikal: Instalasi Tata Udara", "Mekanikal", listed) == "10"
    assert standards.guess("Sesuatu yang lain", "Tidak jelas", listed) == "99"


def test_a_person_can_set_a_code_and_the_firm_can_change_its_list():
    c = _client()
    got = c.get("/api/project/cost-codes").json()
    aid = got["rows"][0]["id"]
    assert sum(t["value"] for t in got["totals"]) == sum(r["value"] for r in got["rows"])
    assert c.post(f"/api/project/cost-codes/{aid}", json={"code": "no-such"}).status_code == 409
    assert c.post("/api/project/cost-codes/AC-NOPE", json={"code": "01"}).status_code == 404
    set_it = c.post(f"/api/project/cost-codes/{aid}", json={"code": "08"}).json()
    row = next(r for r in set_it["rows"] if r["id"] == aid)
    assert row["code"] == "08" and row["by_hand"] is True
    assert c.post(f"/api/project/cost-codes/{aid}", json={"code": ""}).json()["rows"][0]["by_hand"] is False, "and back to automatic"
    assert c.post("/api/standards/cost-codes", json={"codes": [{"code": "A", "name": "x"}, {"code": "A", "name": "y"}]}).status_code == 409
    assert c.post("/api/standards/cost-codes", json={"codes": [{"code": "A", "name": "Semua", "words": ["Beton"]}, {"code": "Z", "name": "Lain"}]}).status_code == 200
    assert [x["code"] for x in c.get("/api/standards/cost-codes").json()["codes"]] == ["A", "Z"]
    assert standards.guess("Beton kolom", "", standards.codes()) == "A"


def test_accounting_gets_budget_and_actual_lines_it_can_read():
    c = _client()
    pid = P.all_of("package")[0]["id"]
    P.add_cost_item(pid, "Sewa alat", 7_000_000, source="x", actual=True)
    got = c.get("/api/project/export/accounting.csv")
    assert got.status_code == 200 and "accounting-export.csv" in got.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(got.text.lstrip("\ufeff"))))
    assert {r["Type"] for r in rows} >= {"BUDGET", "ACTUAL"}
    actual = next(r for r in rows if r["Description"] == "Sewa alat")
    assert actual["Amount (Rp)"] == "7000000" and actual["Cost code"], "an actual lands on its account's main code"
    assert all(r["Cost code"] for r in rows if r["Type"] == "BUDGET")


def test_a_deadline_is_never_before_it_was_asked_for_and_a_week_ahead_counts_for_nothing(monkeypatch):
    first = P.schedule()["activities"][0]
    monkeypatch.setattr(P, "TODAY", first["start"])
    assert S.add("Bata", "material", first["id"])["needed_by"] == first["start"], "work starting now cannot have wanted it two weeks ago"
    assert not S.register()["submittals"][0]["late"]
    weeks = R.kurva_s()["weeks"]
    R.set_actual(weeks, 1.0, {})
    budget = {m["key"]: m for m in scorecard.measures()["measures"]}["budget"]
    assert budget["value"] in (0, None) and budget["state"] != "good", "recording the last week today does not keep the budget up to date"


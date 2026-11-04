"""A person reshapes the agents' WBS and schedule: freely while it is a proposal, and less once a plan is approved. The consultant's master schedule, as code read it, keeps its dates; an agent's estimates, the rows it splits and work a person adds can be moved. Offline, on the example package, with the scripted model.

The documents are public tender documents in docs/. Without them, these tests are skipped.
"""

from __future__ import annotations

import pytest

from swarm import package as K, package_firm as F, project as P
from tests.test_package import analyse, client, project_copy, uploaded  # noqa: F401 - the fixtures this module shares


def schedule(client) -> dict[str, dict]:
    return {a["id"]: a for a in client.get("/api/project/schedule").json()["activities"]}


def by_no(no: str) -> str:
    return next(a["id"] for a in P.all_of("activity") if a.get("no") == no)


def accounts(client) -> dict[str, dict]:
    return {a["id"]: a for a in client.get("/api/project/control-accounts").json()["accounts"]}


def test_a_proposal_can_be_renamed_and_moved_and_its_value_goes_with_it(client):
    analyse(client)
    aid = by_no("II.3.2")
    before, total = accounts(client), sum(a["budget"] for a in accounts(client).values())
    value = next(w["value"] for w in client.get("/api/project/work-packages").json()["packages"] if w["id"] == aid)
    assert client.post(f"/api/project/activities/{aid}", json={"name": "Beton Lantai 1, as the site calls it"}).status_code == 200
    assert schedule(client)[aid]["name"] == "Beton Lantai 1, as the site calls it"
    first = P.all_of("package")[0]["id"]
    r = client.post(f"/api/project/activities/{aid}", json={"package": first})
    assert r.status_code == 200 and r.json()["code"] == f"1.1.{len(P.get('package', first)['activities'])}", "it takes the next number in its new control account"
    after = accounts(client)
    assert after["CA-001"]["budget"] == before["CA-001"]["budget"] + value and after["CA-002"]["budget"] == before["CA-002"]["budget"] - value and value > 0
    assert sum(a["budget"] for a in after.values()) == total, "moving work moves its value, and makes none"
    node = client.get("/api/project/wbs/node", params={"code": r.json()["code"]}).json()
    assert node["node"]["ref"] == aid and node["change"]["move"] and not node["change"]["remove"], "a row of the master schedule can move but not go"
    assert node["children"] and all(s["code"].startswith(r.json()["code"] + ".") for s in node["children"]), "its tasks follow it"


def test_a_renamed_control_account_keeps_what_the_owner_priced_it_at(client):
    analyse(client)
    assert accounts(client)["CA-005"]["against_owner_pct"] == -7.0
    assert client.post("/api/project/packages/WP-005", json={"name": "Mekanikal dan plumbing"}).status_code == 200
    renamed = accounts(client)["CA-005"]
    assert renamed["name"] == "Mekanikal dan plumbing" and renamed["against_owner_pct"] == -7.0
    assert client.post("/api/project/packages/WP-005", json={"name": "  "}).status_code == 409


def test_only_an_empty_control_account_goes_and_a_schedule_row_never_does(client):
    analyse(client)
    r = client.post(f"/api/project/activities/{by_no('II.3.2')}/remove")
    assert r.status_code == 409 and "master schedule" in r.json()["detail"] and "reject it" in r.json()["detail"]
    assert "first" in client.post("/api/project/packages/WP-002/remove").json()["detail"]
    pid = client.post("/api/project/packages", json={"name": "Added by mistake"}).json()["id"]
    assert client.get("/api/project/wbs/node", params={"code": P.wbs_codes()[pid]}).json()["change"]["remove"]
    assert client.post(f"/api/project/packages/{pid}/remove").status_code == 200 and not P.get("package", pid)


def test_a_contract_start_stays_and_work_a_person_added_can_start_when_they_say(client):
    analyse(client)
    row = schedule(client)[by_no("II.3.2")]
    assert row["start_fixed"] and row["earliest"] == row["start"] == "2027-02-15", "week 15 of the master schedule"
    r = client.post(f"/api/project/schedule/{row['id']}", json={"earliest": "2026-12-01"})
    assert r.status_code == 409 and "contract date" in r.json()["detail"]
    mine = client.post("/api/project/activities", json={"name": "Site survey", "package": "WP-001", "duration": 10}).json()
    assert not mine["start_fixed"] and mine["earliest"] == "" and mine["start"] == "2026-11-09"
    moved = client.post(f"/api/project/schedule/{mine['id']}", json={"earliest": "2027-01-04"}).json()
    assert moved["start"] == moved["earliest"] == "2027-01-04" and moved["baseline_start"] == "2026-11-09", "the baseline shows where it was"
    assert client.post(f"/api/project/schedule/{mine['id']}", json={"earliest": ""}).json()["start"] == "2026-11-09"
    assert "before the project" in client.post(f"/api/project/schedule/{mine['id']}", json={"earliest": "2026-01-01"}).json()["detail"]
    assert "a date like" in client.post(f"/api/project/schedule/{mine['id']}", json={"earliest": "soon"}).json()["detail"]
    assert client.get("/api/project/wbs/node", params={"code": mine["code"]}).json()["change"]["remove"]
    rfi = client.post("/api/rfis", json={"subject": "Survey datum", "question": "Which benchmark?", "to": "Engineer", "activity": mine["id"]}).json()
    r = client.post(f"/api/project/activities/{mine['id']}/remove")
    assert r.status_code == 409 and rfi["id"] in r.json()["detail"]
    change = client.get("/api/project/wbs/node", params={"code": mine["code"]}).json()["change"]
    assert not change["remove"] and rfi["id"] in change["why"], "the screen says why before anyone tries"


def test_days_can_be_set_between_work_and_what_it_waits_for(client):
    analyse(client)
    x = client.post("/api/project/activities", json={"name": "Hoarding", "package": "WP-001", "duration": 5}).json()
    y = client.post("/api/project/activities", json={"name": "Site office", "package": "WP-001", "duration": 3, "predecessors": [x["id"]]}).json()
    assert y["start"] == "2026-11-14" and y["lags"] == {x["id"]: 0}, "the day after it finishes on the 13th"
    assert client.post(f"/api/project/schedule/{y['id']}", json={"lags": {x["id"]: 4}}).json()["start"] == "2026-11-18"
    assert client.post(f"/api/project/schedule/{y['id']}", json={"lags": {x["id"]: -2}}).json()["start"] == "2026-11-12", "below zero, it starts before the other finishes"
    assert client.post(f"/api/project/schedule/{y['id']}", json={"lags": {"AC-999": 1}}).status_code == 409
    client.post(f"/api/project/schedule/{y['id']}", json={"predecessors": []})
    assert P.schedule_state()["lags"][y["id"]] == {}, "a link taken away takes its days with it"
    beside = next(a for a in schedule(client).values() if a["alongside"])
    p = beside["alongside"][0]
    after = client.post(f"/api/project/schedule/{beside['id']}", json={"lags": {p: 0}}).json()
    assert p not in after["alongside"] and after["lags"][p] == 0, "work that ran beside the other now follows it"


def test_estimated_weeks_move_and_a_guessed_work_package_can_go(client, monkeypatch):
    async def guessed(self, bid, days=None):  # a breakdown an agent wrote with no schedule to read, every week its estimate
        rows = [{"no": "I", "name": "Persiapan", "weight": None, "weeks": []}, {"no": "1", "name": "Pagar proyek", "weight": 10, "weeks": [1, 2]}, {"no": "2", "name": "Direksi keet", "weight": 10, "weeks": [3, 4]},
                {"no": "II", "name": "Struktur", "weight": None, "weeks": []}, {"no": "1", "name": "Pondasi", "weight": 40, "weeks": [5, 12]}, {"no": "2", "name": "Kolom", "weight": 40, "weeks": [10, 20]}]
        return {**K.structure({"weeks": 20, "rows": rows, "cumulative": None}, bid), "estimated": True}

    monkeypatch.setattr(K, "read_programme", lambda path: None)
    monkeypatch.setattr(F.PackageFirm, "structure_by_agent", guessed)
    rec = analyse(client)
    acts = schedule(client)
    assert acts and not any(a["start_fixed"] for a in acts.values()), "an agent estimated every date, so none is a contract date"
    assert rec["edits"] == 0, "nobody has changed it yet"
    free = next(a for a in acts.values() if a["earliest"] and not a["predecessors"])
    moved = client.post(f"/api/project/schedule/{free['id']}", json={"earliest": ""}).json()
    assert moved["start"] == "2026-11-09" and moved["baseline_start"] == free["start"] != moved["start"]
    package = next(p for p in P.all_of("package") if len(p["activities"]) > 1 and any(b.get("activity") == p["activities"][0] for b in P.all_of("boq")))
    aid, kin = package["activities"][0], package["activities"][1:]
    budget, weight = accounts(client)[package["id"].replace("WP-", "CA-")]["budget"], sum(P.get("activity", x)["weight"] for x in package["activities"])
    assert client.post(f"/api/project/activities/{aid}/remove").status_code == 200
    assert aid not in schedule(client) and not P.get("activity", aid)
    assert accounts(client)[package["id"].replace("WP-", "CA-")]["budget"] == budget, "its value goes to the rest of its control account"
    assert sum(P.get("activity", x)["weight"] for x in kin) == pytest.approx(weight, abs=0.01)
    assert not any(aid in a["predecessors"] for a in schedule(client).values())
    plan = client.get("/api/project/plans").json()["plans"][0]
    assert plan["id"] == rec["id"] and aid not in plan["plan"]["activities"] and not any(s["activity"] == aid for s in plan["plan"]["steps"])
    assert plan["plan"]["totals"]["steps"] == len(plan["plan"]["steps"]) and plan["edits"] >= 1, "analysing again would replace these changes"


def test_once_a_plan_is_approved_names_change_and_the_shape_stays(client):
    rec = analyse(client)
    mine = client.post("/api/project/activities", json={"name": "Site survey", "package": "WP-001", "duration": 10}).json()
    assert client.post(f"/api/project/plans/{rec['id']}/approve", json={"note": ""}).status_code == 200
    assert client.post(f"/api/project/activities/{mine['id']}", json={"name": "Topographic survey"}).status_code == 200
    for path, body in ((f"/api/project/activities/{mine['id']}", {"package": "WP-002"}), (f"/api/project/activities/{mine['id']}/remove", None), ("/api/project/packages/WP-001/remove", None)):
        r = client.post(path, json=body or {})
        assert r.status_code == 409 and "keeps its shape" in r.json()["detail"], path
    added = client.post("/api/project/packages", json={"name": "Variation works"}).json()
    assert P.wbs_codes()[added["id"]] == "1.6", "new work takes the next number"
    change = client.get("/api/project/wbs/node", params={"code": mine["code"]}).json()["change"]
    assert change["rename"] and not change["move"] and not change["remove"] and "keeps its shape" in change["why"]


def test_a_plan_recorded_before_contract_dates_were_marked_still_keeps_them(client):
    analyse(client)
    marked = P.contract_starts()
    assert marked
    for a in P.all_of("activity"):
        P.put("activity", a["id"], {k: v for k, v in a.items() if k != "contract_weeks"})
    assert P.contract_starts() == marked, "the plan's checks say code read the schedule, and which rows an agent split"

"""The reports: the project's month, the portfolio of every project, and the variations and contingency only a person can tell. No model is called."""

from __future__ import annotations

from fastapi.testclient import TestClient

from swarm import firm_api, project as P, reports as R
from tests.test_modules import _close, records, template  # noqa: F401 - each test on its own copy of the records


def _client() -> TestClient:
    return TestClient(firm_api.app)


def test_the_month_is_read_from_the_modules_and_says_what_is_not_measured():
    r = _client().get("/api/project/report").json()
    assert r["planned_any"] and r["status"] in ("green", "amber", "red")
    assert r["contract"] == P.budget()["total"]["boq_value"] and r["revised"] == r["contract"], "no variation approved yet"
    curve = [y for _, y in r["curve"]]
    assert curve[0] == 0 and curve[-1] == 100 and curve == sorted(curve), "the baseline's S-curve only rises"
    assert r["actual_curve"][-1] == [r["today"], r["progress"]]
    assert r["cash"] and all(q["spend"] >= 0 for q in r["cash"]) and r["next_quarter"]["name"].startswith("Q")
    assert r["changes"] is None, "the first month saved has nothing to compare with"
    assert P.get("snapshot", r["period"])["progress"] == r["progress"], "and is saved for next month"


def test_a_variation_counts_only_once_the_owner_approves_it():
    c = _client()
    before = c.get("/api/project/report").json()
    v = c.post("/api/project/variations", json={"title": "Extra basement waterproofing", "reason": "Site condition", "value": 250_000_000, "days": 14}).json()
    assert v["status"] == "proposed"
    mid = c.get("/api/project/report").json()
    assert mid["revised"] == before["revised"] and mid["variations_pending"] == 250_000_000
    assert any("Send 1 variation" in d["text"] for d in mid["decisions"])
    assert c.post(f"/api/project/variations/{v['id']}", json={"status": "submitted"}).status_code == 200
    assert c.post(f"/api/project/variations/{v['id']}", json={"status": "approved"}).status_code == 200
    after = c.get("/api/project/report").json()
    assert after["revised"] == before["revised"] + 250_000_000 and after["days_approved"] == 14
    assert P.days_between(before["revised_finish"], after["revised_finish"]) == 14, "the time granted moves the contract's finish"
    assert c.post(f"/api/project/variations/{v['id']}", json={"status": "submitted"}).status_code == 409, "an approved variation stays approved"
    assert c.post("/api/project/variations", json={"title": "x", "reason": "Because"}).status_code == 409
    assert c.post("/api/project/variations/VO-999", json={"status": "approved"}).status_code == 404


def test_the_contingency_is_set_drawn_and_can_be_overdrawn_in_plain_sight():
    c = _client()
    assert c.post("/api/project/contingency/use", json={"amount": 10, "reason": "Pump hire"}).status_code == 409, "nothing to draw on yet"
    assert c.post("/api/project/contingency", json={"amount": 100_000_000}).json()["left"] == 100_000_000
    left = c.post("/api/project/contingency/use", json={"amount": 80_000_000, "reason": "Dewatering after the storm"}).json()
    assert left["left"] == 20_000_000 and left["uses"][0]["reason"] == "Dewatering after the storm"
    assert "less than a quarter of the contingency is left" in c.get("/api/project/report").json()["reasons"]
    c.post("/api/project/contingency/use", json={"amount": 30_000_000, "reason": "More pumping"})
    r = c.get("/api/project/report").json()
    assert r["contingency_left"] == -10_000_000 and "the contingency is overdrawn" in r["reasons"] and r["status"] == "red"
    assert c.post("/api/project/contingency/use", json={"amount": 5, "reason": " "}).status_code == 409


def test_next_month_says_what_changed_since_the_month_saved():
    now = R.month()
    P.put("snapshot", "2026-09", {**now, "period": "2026-09", "today": "2026-09-30", "progress": now["progress"] - 5, "eac": now["eac"] - 1_000_000, "finish": R._after(now["finish"], -3), "risks_high": now["risks_high"] + 1})
    later = R.month()
    rows = {x["key"]: x for x in later["changes"]["rows"]}
    assert later["changes"]["since"] == "2026-09-30"
    assert rows["progress"]["delta"] == 5 and rows["progress"]["good"]
    assert rows["eac"]["delta"] == 1_000_000 and not rows["eac"]["good"], "a dearer forecast is not good news"
    assert rows["finish"]["delta"] == 3 and not rows["finish"]["good"]
    assert rows["risks_high"]["delta"] == -1 and rows["risks_high"]["good"]
    assert [p for _, p in later["actual_curve"]][1] == now["progress"] - 5, "the months saved draw the actual curve"


def test_the_portfolio_reads_every_project_and_leaves_the_open_one_open():
    P.create_project("Gedung A", start="2026-09-01")
    a = P.DB
    P.create_project("Gedung B", start="2026-10-01")
    b = P.DB
    pf = _client().get("/api/reports/portfolio").json()
    assert P.DB == b, "reading the others never changes which project is open"
    assert [p["name"] for p in pf["projects"]] == ["Gedung A", "Gedung B"], "the invented sample is left out"
    assert [p["open"] for p in pf["projects"]] == [False, True]
    assert all(p["planned_any"] and not p["priced"] for p in pf["projects"]), "the starter breakdown has no BoQ priced"
    assert all(any("no BoQ is priced" in n for n in p["notes"]) for p in pf["projects"])
    with P.visiting(a):
        assert P.get("snapshot", P.TODAY[:7]), "each project's month is saved in its own records"
    P.busy = "run-x"
    try:
        stale = _client().get("/api/reports/portfolio").json()["projects"][0]
    finally:
        P.busy = ""
    assert stale["stale"] and stale["name"] == "Gedung A", "while the agents work, the others come from their last saved month"
    _close()


def test_money_nothing_has_measured_is_not_shown_as_on_target():
    P.create_project("Gedung C", start="2026-10-01")
    for pk in P.all_of("package"):
        P.patch("package", pk["id"], {"budget": 1_000_000_000}, P.PM, "set a budget")
    s = R.summary()
    assert s["priced"] and not s["cost_measured"] and s["eac"] == s["budget"] and s["variance"] is None and s["cpi"] is None
    assert "no actual cost is recorded yet, so the forecast is the budget" in s["notes"]
    _close()


def test_the_kurva_s_spreads_each_weight_over_its_weeks_and_measures_only_what_was_measured():
    k = _client().get("/api/project/kurva-s").json()
    items = [r for r in k["rows"] if r["type"] == "item"]
    assert items and abs(sum(r["weight"] for r in items) - 100) < 0.2, "the weights make up the whole job"
    assert all(abs(sum(r["cells"]) - r["weight"]) < 0.05 for r in items), "each weight is spread over its weeks, none lost"
    assert abs(k["planned_cum"][-1] - 100) < 0.2 and k["planned_cum"] == sorted(k["planned_cum"])
    for g in (r for r in k["rows"] if r["type"] == "group"):
        assert abs(g["weight"] - sum(r["weight"] for r in items if str(r["code"]).startswith(g["code"] + "."))) < 0.05
    assert k["actual"][0] == [0, 0.0]
    if k["current_week"]:
        assert k["actual"][-1][0] == k["current_week"], "today's point is where today is"
        assert set(k["actual_weekly"]) == {str(w) for w, _ in k["actual"][1:]}, "a week no one measured has no actual figure"

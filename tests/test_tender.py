"""The selection of the contractor, read by code from a real package's instructions to bidders, with the priced BoQ set beside the HPS.

The documents are public tender documents in docs/. Without them, these tests are skipped.
"""

from __future__ import annotations

from tests.test_package import analyse, client, project_copy, uploaded  # noqa: F401 - the fixtures this module shares


def test_the_qualification_is_read_from_the_ldk_with_its_page(client):
    s = client.get("/api/project/tender-selection").json()
    items = {x["key"]: x for x in s["items"]}
    for key in ("nib", "akta", "pajak", "skp", "pengalaman"):
        [first, *_] = items[key]["found"]
        assert "LDK" in first["title"] and first["page"] >= 1, f"{key} comes from the qualification sheet, with its page"
    assert {b["stage"] for b in s["tree"]} == {"kualifikasi", "penawaran"}
    assert [lf["key"] for lf in s["tree"][0]["leaves"]] == ["adm", "tek", "keu"] and [lf["key"] for lf in s["tree"][1]["leaves"]] == ["adm", "tek", "harga"]
    skp = next(t for t in s["terms"] if t["key"] == "skp")
    assert skp["value"].startswith("SKP = 3") and "LDK" in skp["title"]
    assert all(x["status"] == "todo" for x in s["items"])


def test_award_records_are_never_read(client):
    read = " ".join(d["title"] for d in client.get("/api/project/tender-selection").json()["read"])
    assert "Surat-Penawaran" not in read, "an offer names the company and its tax number"


def test_a_qualification_named_nowhere_in_the_tender_documents_is_said_to_be_missing(client):
    items = {x["key"]: x for x in client.get("/api/project/tender-selection").json()["items"]}
    assert items["sistem"]["found"] == [], "this package asks for no SMM, SMK3 or SML certificate of the bidder"


def test_the_hps_with_tax_is_read_from_its_own_document(client):
    hps = client.get("/api/project/tender-selection").json()["hps"]
    assert round(hps["with_tax"]) == 42_264_218_173 and "HPS" in hps["source"]["title"]


def test_the_priced_boq_is_set_beside_the_hps(client):
    analyse(client)
    s = client.get("/api/project/tender-selection").json()
    p = s["price"]
    assert p and p["hps"] == s["hps"]["before_tax"] and abs(p["ratio"] - p["rab"] / p["hps"]) < 1e-4
    assert p["sections"] and all(x["hps"] > 0 for x in p["sections"]), "section by section, where the HPS gives a figure"
    capital = next((t for t in s["terms"] if t["key"] == "capital"), None)
    if capital:
        assert capital["amount"] == round(0.2 * (s["hps"]["with_tax"] or s["hps"]["before_tax"]))


def test_a_person_marks_a_requirement_and_the_record_says_who(client):
    assert client.post("/api/project/tender-selection/nib", json={"status": "ready", "note": "NIB F41016 ada"}).status_code == 200
    items = {x["key"]: x for x in client.get("/api/project/tender-selection").json()["items"]}
    assert items["nib"]["status"] == "ready" and items["nib"]["who"] and items["nib"]["comment"] == "NIB F41016 ada"
    assert client.get("/api/project/tender-selection").json()["ready"] == 1
    assert client.post("/api/project/tender-selection/nonsense", json={"status": "ready"}).status_code == 404
    assert client.post("/api/project/tender-selection/nib", json={"status": "maybe"}).status_code == 409

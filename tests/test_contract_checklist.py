"""The contract's legal and administration checklist, read by code from the documents of a real package, and marked by a person.

The documents are public tender documents in docs/. Without them, these tests are skipped.
"""

from __future__ import annotations

from swarm import contract_admin as CA, project as P
from tests.test_package import analyse, client, project_copy, uploaded  # noqa: F401 - the fixtures this module shares


def test_the_checklist_is_read_from_the_documents_before_any_agent_runs(client):
    c = client.get("/api/project/contract-checklist").json()
    keys = {x["key"]: x for x in c["items"]}
    assert {"support_letters", "performance_bond", "spmk", "pcm", "insurance", "maintenance_bond", "fho", "asbuilt"} <= set(keys), "the contract's papers and the regulations' duties, together"
    letters = keys["support_letters"]["found"]
    assert letters and "surat dukungan" in letters[0]["quote"].lower() and letters[0]["page"] > 0, "in the documents' own words, with the page"
    assert [p["key"] for p in c["phases"]] == ["signing", "before", "during", "handover"]
    phases = [x["phase"] for x in c["items"]]
    assert phases == sorted(phases, key=["signing", "before", "during", "handover"].index), "in the order they are needed"
    assert all(x["status"] == "todo" for x in c["items"])


def test_a_sentence_that_says_what_must_be_done_is_preferred_to_a_first_mention():
    docs = [{"id": "UP-4", "title": "Kontrak", "pages_text": ["b. Jaminan Pelaksanaan dicairkan apabila kontrak diputus.", "Penyedia wajib menyerahkan Jaminan Pelaksanaan paling lambat 14 hari setelah penunjukan."]}]
    [hit] = CA.clauses(docs, CA.re.compile("jaminan pelaksanaan", CA.re.I))
    assert hit["page"] == 2 and "wajib menyerahkan" in hit["quote"], "the duty, not the bond being cashed"
    [only] = CA.clauses([{**docs[0], "pages_text": docs[0]["pages_text"][:1]}], CA.re.compile("jaminan pelaksanaan", CA.re.I))
    assert only["page"] == 1, "with no duty stated, the first mention still counts"
    table = {"id": "UP-9", "title": "Spesifikasi", "pages_text": ["Strainer Valve DN25 DN600 PN10 PN16 harus " + "1 2 3 4 5 6 7 8 9 " * 30 + "surat dukungan pabrikan"]}
    sentence = {"id": "UP-1", "title": "KAK", "pages_text": ["Kontraktor harus menyertakan surat dukungan dari principal untuk setiap material."]}
    hits = CA.clauses([table, sentence], CA.re.compile("surat dukungan", CA.re.I))
    assert [h["doc"] for h in hits] == ["UP-1", "UP-9"], "a table's cells run together come last, whatever document they are in"


def test_what_no_document_mentions_is_said_and_not_made_required(client):
    keys = {x["key"]: x for x in client.get("/api/project/contract-checklist").json()["items"]}
    assert keys["advance_bond"]["found"] == [], "this package pays no advance: nothing is quoted for it"
    assert client.get("/api/project/contract-checklist").json()["not_found"] >= 1


def test_award_records_are_never_read_and_the_contract_is_read_first(client):
    read = client.get("/api/project/contract-checklist").json()["read"]
    titles = " ".join(d["title"] for d in read)
    assert "Surat-Penawaran" not in titles and "Penetapan" not in titles, "award records name companies and tax numbers"
    kinds = [d["kind"] for d in CA.documents()]
    assert kinds.index("contract") < kinds.index("clarification"), "what binds comes before a bidder's question"


def test_a_person_marks_an_item_and_the_record_says_who(client):
    assert client.post("/api/project/contract-checklist/support_letters", json={"status": "done", "note": "Dari distributor resmi"}).status_code == 200
    assert client.post("/api/project/contract-checklist/advance_bond", json={"status": "na"}).status_code == 200
    c = client.get("/api/project/contract-checklist").json()
    keys = {x["key"]: x for x in c["items"]}
    assert keys["support_letters"]["status"] == "done" and keys["support_letters"]["who"] and keys["support_letters"]["comment"] == "Dari distributor resmi"
    assert keys["advance_bond"]["status"] == "na" and c["done"] == 1 and c["not_needed"] == 1
    assert client.post("/api/project/contract-checklist/support_letters", json={"status": "todo"}).status_code == 200
    assert {x["key"]: x for x in client.get("/api/project/contract-checklist").json()["items"]}["support_letters"]["status"] == "todo", "and can take it back"
    assert client.post("/api/project/contract-checklist/nonsense", json={"status": "done"}).status_code == 404
    assert client.post("/api/project/contract-checklist/spmk", json={"status": "maybe"}).status_code == 409
    assert any(a == "checked off a contract item" for (a,) in P._db().execute("select action from audit"))


def test_the_plans_obligations_are_used_once_there_is_a_plan(client):
    rec = analyse(client)
    planned = {o["key"]: o for o in rec["plan"]["obligations"]}
    keys = {x["key"]: x for x in client.get("/api/project/contract-checklist").json()["items"]}
    assert keys["staff"]["note"] == planned["staff"]["note"], "made with the plan's safety risk level"
    assert keys["pcm"]["rule"] and keys["pcm"]["rule"]["url"], "with the regulation behind it"

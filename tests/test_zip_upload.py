"""A tender package uploaded as one zip, or as many files: each document goes on the register on its own, kept under our own name. No model is called."""

from __future__ import annotations

import io
import zipfile

from fastapi.testclient import TestClient

from swarm import firm_api, module_agents as A
from tests.test_modules import _close, records, template  # noqa: F401 - each test on its own copy of the records


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in files.items():
            z.writestr(name, body)
    return buf.getvalue()


def _send(c: TestClient, name: str, body: bytes):
    return c.post("/api/project/documents", files={"file": (name, body, "application/octet-stream")}, data={"kind": "auto"})


def test_a_zip_of_documents_becomes_one_document_each():
    c = TestClient(firm_api.app)
    package = _zip({
        "paket/1-KAK.txt": b"Kerangka acuan kerja pembangunan gedung.",
        "paket/5-LDK.txt": b"Lembar data kualifikasi: NIB, SBU, KSWP.",
        "paket/setup.exe": b"MZ",
        "paket/lagi.zip": _zip({"a.txt": b"x"}),
        "__MACOSX/paket/._1-KAK.txt": b"resource fork",
        "../../evil.txt": b"Spesifikasi teknis beton K-300.",
    })
    r = _send(c, "tender.zip", package)
    assert r.status_code == 200, r.text
    out = r.json()
    assert sorted(d["filename"] for d in out["documents"]) == ["1-KAK.txt", "5-LDK.txt", "evil.txt"], "folders flattened, the Mac's resource forks left out"
    assert {x["name"]: x["why"].split(":")[0] for x in out["skipped"]} == {"setup.exe": "not a document type that is accepted", "lagi.zip": "a zip inside the zip"}
    folder = A.upload_folder()
    assert all(d["file"].startswith("UP-") and (folder / d["file"]).exists() for d in out["documents"]), "each kept under our own name, in the project's own folder"
    assert not (folder.parent / "evil.txt").exists() and not (folder.parent.parent / "evil.txt").exists(), "a path in the zip never decides where a file goes"
    assert all(d["from_zip"] == "tender.zip" for d in out["documents"])
    assert sorted(d["title"] for d in out["documents"]) == ["1-KAK", "5-LDK", "evil"]
    listed = {d["id"] for d in c.get("/api/project/documents").json()["documents"]}
    assert {d["id"] for d in out["documents"]} <= listed, "on the register like any upload"


def test_a_broken_or_empty_zip_is_refused():
    c = TestClient(firm_api.app)
    assert _send(c, "x.zip", b"not a zip at all").status_code == 400
    assert _send(c, "x.zip", _zip({})).status_code == 400
    assert _send(c, "x.zip", b"").status_code == 400


def test_many_documents_go_up_one_after_another():
    c = TestClient(firm_api.app)
    ids = [_send(c, f"{n}-dokumen.txt", f"Dokumen nomor {n}.".encode()).json()["id"] for n in range(1, 4)]
    assert len(set(ids)) == 3


def test_the_digital_twin_says_what_is_in_scope_and_takes_real_readings():
    c = TestClient(firm_api.app)
    t = c.get("/api/project/twin").json()
    assert t["devices"] and len({d["id"] for d in t["devices"]}) == len(t["devices"])
    assert any(not s["in_scope"] for s in t["systems"]), "what no document asks for is offered apart, as an add-on"
    for s in t["systems"]:
        assert s["devices"] == sum(1 for d in t["devices"] if d["system"] == s["key"]) and s["rule"]
    device = t["devices"][0]
    metric = device["metrics"][0]
    assert t["readings"] == {}, "nothing is measured until a system sends it"
    r = c.post("/api/project/twin/readings", json=[{"device": device["id"], "metric": metric, "value": 1}, {"device": "nope", "metric": "x", "value": 1}]).json()
    assert r["kept"] == 1 and r["refused"] == ["nope/x"]
    assert c.get("/api/project/twin").json()["readings"][device["id"]][metric]["value"] == 1
    assert c.post("/api/project/twin/readings", json=[]).status_code == 400


def test_the_twin_finds_the_systems_a_coarse_wbs_names_only_in_its_sections(monkeypatch):
    from swarm import twin
    plans = [{"status": "pending", "plan": {"sections": [{"name": "Instalasi Hydrant dan Sprinkler"}, {"name": "Tata Udara Ruangan"}]}},
             {"status": "superseded", "plan": {"sections": [{"name": "Elektronika, CCTV dan Data"}]}}]
    records = {"activity": [{"name": "Instalasi Mekanikal"}, {"name": "Instalasi Elektrikal Lantai 1"}], "package": [], "plan": plans}
    monkeypatch.setattr(twin.P, "all_of", lambda kind: records.get(kind, []))
    found = twin._systems_in_scope(twin._scope_names())
    assert found["fire"] == ["Instalasi Hydrant dan Sprinkler"] and found["hvac"] == ["Tata Udara Ruangan"]
    assert found["energy"] == ["Instalasi Elektrikal Lantai 1"], "a building's electrical installation has its panels"
    assert not found["cctv"], "a superseded plan says nothing about the building"
    plans[0]["plan"]["boq_lines"] = [{"name": "Instalasi 1 Titik CCTV"}, {"name": "Pemasangan 1 unit AC Cassette 2 PK"}]
    found = twin._systems_in_scope(twin._scope_names())
    assert found["cctv"] == ["Instalasi 1 Titik CCTV"], "the BoQ names what the sections were not worded to say"
    assert found["hvac"] == ["Tata Udara Ruangan", "Pemasangan 1 unit AC Cassette 2 PK"], "the plan's own words come first"

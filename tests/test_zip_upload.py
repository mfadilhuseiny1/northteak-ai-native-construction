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

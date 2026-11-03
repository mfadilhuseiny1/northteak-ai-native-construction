"""The contract's legal and administration checklist: what the contractor must hand over, hold or arrange before signing, before work starts, while it runs and at handover, as the package's own documents state it.

Code builds it, with no model and at no cost, as soon as documents are uploaded. Each item carries the first sentence each document gives it, with its page. An item no document mentions is shown as not found in what was read, never as required: whether it applies is a person's call. The obligations the regulations stage found are part of it, with the regulation behind each. A person marks each item done, or not needed, and the record keeps who and when.

The documents read are the ones the agents read, and the instructions to bidders, which are set aside as not for the site but say what the contract asks of the winner. Award records and empty notes are not read: they name companies, and hold nothing to do.
"""

from __future__ import annotations

import re
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import modules as M, package as K, project as P, regulations as REG

PHASES = [("signing", "Before signing"), ("before", "Before work starts"), ("during", "While the work runs"), ("handover", "At handover")]
READ = ("tender",)  # set aside from the agents, read here by code
SKIP = ("award", "note")
FIRST = ("contract", "spec", "scope", "clarification", "tender")  # the contract first, as it is what binds: a bidder's question in the minutes is not what is required

# key, when, what, the words a document uses for it
ADMIN = [
    ("legal", "signing", "Company papers: NIB, NPWP, SBU and the deed of establishment", r"\bNIB\b|nomor induk berusaha|\bNPWP\b|\bSBU\b|sertifikat badan usaha|akta pendirian"),
    ("performance_bond", "signing", "Jaminan Pelaksanaan (performance bond)", r"jaminan pelaksanaan"),
    ("advance_bond", "signing", "Jaminan Uang Muka (advance payment guarantee), where an advance is paid", r"jaminan uang muka"),
    ("support_letters", "signing", "Surat Dukungan from distributors, principals or manufacturers", r"surat dukungan"),
    ("key_staff", "signing", "Key personnel, with their certificates (SKK)", r"personil (?:manajerial|inti)|tenaga ahli|\bSKK\b|\bSKA\b"),
    ("equipment", "signing", "Proof of the main equipment, owned or hired", r"peralatan utama|bukti kepemilikan|perjanjian sewa|sewa (?:alat|peralatan)"),
    ("spmk", "before", "SPMK, the written order to start work", r"\bSPMK\b|surat perintah mulai kerja"),
    ("shop_drawings", "before", "Shop drawings approved before the work they show", r"shop ?drawing"),
    ("materials", "before", "Materials approved, with samples, before they are ordered", r"persetujuan (?:bahan|material)|contoh (?:bahan|material)|approval (?:bahan|material)|material approval"),
    ("variations", "during", "Any change to the contract agreed in writing (addendum, CCO)", r"\baddendum\b|\badendum\b|perubahan kontrak|\bCCO\b|contract change order"),
    ("payments", "during", "Payment claims, each with its progress record (termin)", r"pembayaran (?:prestasi|termin)|\btermin\b|berita acara (?:kemajuan|prestasi)"),
    ("fho", "handover", "Final handover record (serah terima akhir, FHO)", r"serah terima akhir|final hand ?over|\bFHO\b"),
    ("maintenance_bond", "handover", "Jaminan Pemeliharaan, or the retention held instead", r"jaminan pemeliharaan|uang retensi|\bretensi\b"),
]


DUTY = re.compile(r"\bwajib\b|\bharus\b|diwajibkan|menyerahkan|diserahkan|melampirkan|dilampirkan|mengajukan|menyampaikan|paling lambat|selambat-lambatnya|disyaratkan", re.I)


LONGEST = 420  # a "sentence" longer than this is a table's cells run together, which says little


def _score(quote: str) -> int:
    """0 says what must be done, in a sentence. 1 names it in a sentence. 2 is a table's cells run together."""
    tidy = len(quote) <= LONGEST and len(re.findall(r"\d", quote)) < len(quote) / 8
    return (0 if DUTY.search(quote) else 1) if tidy else 2


def clauses(docs: list[dict], pattern: re.Pattern) -> list[dict]:
    """The best sentence each document gives it, best first: one that says what must be done, then one that names it, and a table's cells run together last. The first mention is often about something else, such as a bond being cashed rather than handed over."""
    out = []
    for rank, d in enumerate(docs):
        best = None
        for n, page in enumerate(d["pages_text"], 1):
            if REG._contents(page):
                continue
            flat = REG._flat(page)
            ends = REG._ends(flat)
            for m in pattern.finditer(flat):
                quote = REG._clause(flat, m.start(), m.end(), ends)
                score = _score(quote)
                if best is None or score < best[0]:
                    best = (score, {"doc": d["id"], "title": d["title"], "page": n, "quote": quote, "days": None, "unit": None})
                if score == 0:
                    break
            if best and best[0] == 0:
                break
        if best:
            out.append((best[0], rank, best[1]))
    return [hit for _, _, hit in sorted(out, key=lambda x: (x[0], x[1]))]


def documents() -> list[dict]:
    """What the checklist reads: the uploads the agents read, and the instructions to bidders."""
    review = {d["id"]: d for d in K.review()["documents"]}
    out = []
    for d in K.uploads():
        row = review.get(d["id"]) or {}
        if d.get("kind") in SKIP or not (row.get("use") or d.get("kind") in READ):
            continue
        out.append({"id": d["id"], "title": d.get("title", d["id"]), "kind": d.get("kind", ""), "pages_text": K.pages_of(d["id"])})
    return sorted(out, key=lambda d: FIRST.index(d["kind"]) if d["kind"] in FIRST else len(FIRST))


def checklist() -> dict:
    docs = documents()
    plan = M.live_plan()
    found_by_plan = {o["key"]: o for o in ((plan or {}).get("plan") or {}).get("obligations") or []}
    obligations = list(found_by_plan.values()) or REG.obligations(docs)  # the plan's, made with its safety risk level, or worked out now from what is uploaded
    saved = {r["id"]: r for r in P.all_of("checklist")}
    items = []
    for o in obligations:
        items.append({"key": o["key"], "phase": o["phase"], "what": o["what"], "found": o["found"], "rule": o.get("rule"), "note": o.get("note", ""), "conflict": o.get("conflict", ""), "from": "regulation"})
    for key, phase, what, words in ADMIN:
        found = clauses(docs, re.compile(words, re.I))[:2]
        items.append({"key": key, "phase": phase, "what": what, "found": found, "rule": None, "note": "", "conflict": "", "from": "contract"})
    order = {p: i for i, (p, _) in enumerate(PHASES)}
    items.sort(key=lambda x: order.get(x["phase"], 9))
    for x in items:
        s = saved.get(x["key"]) or {}
        x.update(status=s.get("status", "todo"), who=s.get("who", ""), at=s.get("at", ""), comment=s.get("note", ""))
    return {"phases": [{"key": k, "label": v} for k, v in PHASES], "items": items, "read": [{"id": d["id"], "title": d["title"]} for d in docs],
            "done": sum(x["status"] == "done" for x in items), "not_needed": sum(x["status"] == "na" for x in items), "not_found": sum(not x["found"] for x in items)}


def mark(key: str, status: str, note: str = "", who: str = P.PM) -> dict:
    """A person's word on one item: done, not needed, or back to do."""
    if status not in ("todo", "done", "na"):
        raise ValueError("status must be todo, done or na")
    known = {o[0] for o in REG.OBLIGATIONS} | {a[0] for a in ADMIN}
    if key not in known:
        raise KeyError(key)
    rec = {"id": key, "status": status, "who": who, "at": time.strftime("%Y-%m-%d %H:%M"), "note": note.strip()}
    return P.put("checklist", key, rec, who, {"done": "checked off a contract item", "na": "marked a contract item not needed", "todo": "reopened a contract item"}[status], f"{key}{f': {note.strip()}' if note.strip() else ''}")


router = APIRouter()


class Mark(BaseModel):
    status: str
    note: str = ""


@router.get("/api/project/contract-checklist")
def get_checklist() -> dict:
    return checklist()


@router.post("/api/project/contract-checklist/{key}")
def set_item(key: str, body: Mark) -> dict:
    try:
        return mark(key, body.status, body.note)
    except KeyError as e:
        raise HTTPException(404, f"no such item: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e

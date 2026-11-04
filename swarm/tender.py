"""The selection of the contractor (pemilihan penyedia) as the tender documents set it. Two branches: the bidder's qualification (kualifikasi),
administrative, technical and financial, and the bid itself (penawaran), administrative, technical and its price.

Code reads each requirement from the instructions to bidders (the LDK and the LDP) and the documents beside them, with its page, and sets the
priced BoQ (the RAB) beside the owner's estimate (the HPS), in total and section by section. Thresholds the documents tie to the HPS, such as the
working capital or the experience asked for, are worked out on the HPS's own figure. No model is called. A person marks what is ready.

Award records (offers, evaluation minutes, the selection report) are never read: they name other companies and their tax numbers.
"""

from __future__ import annotations

import re
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import contract_admin as CA, modules as M, package as K, project as P

TREE = [
    {"key": "penyedia", "name": "Penyedia", "hint": "the company bidding", "stage": "kualifikasi", "stage_name": "Kualifikasi", "stage_hint": "can it do this job",
     "leaves": [("adm", "Administratif", "papers and legal standing"), ("tek", "Teknis", "experience, people, equipment"), ("keu", "Keuangan", "money behind it")]},
    {"key": "barang", "name": "Barang/Jasa", "hint": "the work on offer", "stage": "penawaran", "stage_name": "Penawaran", "stage_hint": "what the bid must hold",
     "leaves": [("adm", "Administratif", "the offer letter and guarantees"), ("tek", "Teknis", "how the work will be done"), ("harga", "Harga/Biaya", "the price against the HPS")]},
]

# key, stage, leaf, what the bidder must have or give, the words a document uses for it
ITEMS = [
    ("nib", "kualifikasi", "adm", "NIB (business licence) with the KBLI the package asks for", r"nomor induk berusaha|\bNIB\b|\bKBLI\b|perizinan berusaha"),
    ("sbu", "kualifikasi", "adm", "SBU, the construction business certificate, in the right sub-classification", r"\bSBU\b|sertifikat badan usaha|sertifikat standar"),
    ("akta", "kualifikasi", "adm", "Deed of establishment and its amendments", r"akta pendirian|akta perubahan"),
    ("pajak", "kualifikasi", "adm", "Valid taxpayer status (KSWP, NPWP)", r"\bKSWP\b|status wajib pajak|\bNPWP\b"),
    ("kantor", "kualifikasi", "adm", "An office owned or rented, at a fixed address", r"tempat usaha|bukti kepemilikan kantor|keterangan domisili"),
    ("pernyataan", "kualifikasi", "adm", "Statements: good record, not blacklisted, not bankrupt, no conflict of interest", r"daftar hitam|tidak pailit|pakta integritas|kinerja baik|pertentangan kepentingan"),
    ("kso", "kualifikasi", "adm", "Joint operation agreement (KSO), when bidding with a partner", r"\bKSO\b|kerja sama operasi"),
    ("pengalaman", "kualifikasi", "tek", "Experience of similar work, proven by contract and handover record (BAST)", r"pengalaman (?:paling kurang|pekerjaan|kontrak)|pekerjaan (?:yang )?sejenis|\bBAST\b"),
    ("skp", "kualifikasi", "tek", "Remaining package capacity (SKP)", r"sisa kemampuan paket|\bSKP\b"),
    ("kd", "kualifikasi", "tek", "Basic capability (KD)", r"kemampuan dasar"),
    ("personel", "kualifikasi", "tek", "Managerial staff with competence certificates (SKK, SKA, SKT) and CVs", r"personil manajerial|personel manajerial|\bSKK\b|\bSKKK\b|\bSKA\b|\bSKT\b"),
    ("peralatan", "kualifikasi", "tek", "Main equipment, owned or hired, with proof", r"peralatan utama|daftar peralatan"),
    ("sistem", "kualifikasi", "tek", "Management system certificates: SMM (ISO 9001), SMK3 (ISO 45001), SML (ISO 14001)", r"\bSMM\b|\bSMK3\b|\bSML\b|ISO ?9001|ISO ?45001|ISO ?14001|sertifikat (?:sistem manajemen|SMM|SMK3|ISO)"),
    ("modal", "kualifikasi", "keu", "Working capital or bank support", r"modal kerja|dukungan (?:keuangan|bank)|rekening koran|kredit modal kerja"),
    ("laporan", "kualifikasi", "keu", "Financial statements or balance sheet", r"laporan keuangan|\bneraca\b"),
    ("spt", "kualifikasi", "keu", "Annual tax return, last year (SPT)", r"\bSPT\b|pelunasan (?:kewajiban )?pajak"),
    ("surat", "penawaran", "adm", "Offer letter, signed, with its validity period", r"surat penawaran|masa berlaku penawaran"),
    ("jaminan", "penawaran", "adm", "Bid guarantee (Jaminan Penawaran)", r"jaminan penawaran"),
    ("kuasa", "penawaran", "adm", "Power of attorney, or who may sign for the company", r"surat kuasa|berhak (?:untuk )?menandatangani"),
    ("sanggah", "penawaran", "adm", "Appeal guarantee (Jaminan Sanggah Banding), if appealing", r"jaminan sanggah banding"),
    ("metode", "penawaran", "tek", "Method statement for each trade", r"metode pelaksanaan"),
    ("jadwal", "penawaran", "tek", "Programme within the time allowed", r"jangka\s+waktu\s+pelaksanaan|jadwal (?:waktu )?pelaksanaan"),
    ("rkk", "penawaran", "tek", "Construction safety plan (RKK)", r"rencana\s+keselamatan konstruksi|\bRKK\b"),
    ("mutu", "penawaran", "tek", "Quality plan (RMPK)", r"rencana mutu|\bRMPK\b|\bRMK\b"),
    ("subkon", "penawaran", "tek", "Work that must be subcontracted", r"di ?-?sub-?kontrakkan|subkontrak"),
    ("tkdn", "penawaran", "tek", "Local content (TKDN) and price preference", r"\bTKDN\b|produk dalam negeri"),
    ("spek", "penawaran", "tek", "Materials to the technical specification, with brands", r"spesifikasi teknis|identitas (?:barang|bahan)|\bmerek\b"),
    ("bobot", "penawaran", "harga", "How bids are scored: pass or fail, lowest price, or weighted technical and cost", r"bobot penawaran|sistem nilai|sistem gugur|harga terendah|ambang batas"),
    ("hps", "penawaran", "harga", "The owner's estimate (HPS) and budget ceiling", r"harga perkiraan sendiri|\bHPS\b|pagu anggaran"),
    ("koreksi", "penawaran", "harga", "Arithmetic correction of the priced BoQ", r"koreksi aritmatik"),
    ("kewajaran", "penawaran", "harga", "Price reasonableness check, for a bid below 80% of the HPS", r"kewajaran harga|80\s?%|timpang"),
    ("rincian", "penawaran", "harga", "Unit price breakdown (AHSP) and the priced bill of quantities", r"rincian harga satuan|analisa harga satuan|\bAHSP\b|daftar kuantitas"),
]
ORDER = ("tender", "clarification", "spec", "scope", "contract", "estimate")  # the instructions to bidders first: they are what sets the selection
STATUS = ("todo", "ready", "na")
QUALIFIED_BY = ("tender", "clarification")

# what the regulation sets, for the price: Perpres 16/2018 as amended by Perpres 12/2021
PERFORMANCE_BOND = 0.05  # article 33: 5% of the contract for a bid from 80% to 100% of the HPS, 5% of the HPS below 80%
LOW = 0.80


def documents() -> list[dict]:
    """The instructions to bidders and the documents beside them. Award records and empty notes are never read."""
    out = []
    for d in K.uploads():
        if d.get("kind") in ORDER:
            out.append({"id": d["id"], "title": d.get("title", d["id"]), "kind": d["kind"], "pages_text": K.pages_of(d["id"])})
    return sorted(out, key=lambda d: ORDER.index(d["kind"]))


def _number(text: str) -> float:
    """An Indonesian figure, 42.264.218,00, as a number."""
    return float(text.replace(".", "").replace(",", "."))


def _find(docs: list[dict], pattern: str, kinds: tuple[str, ...] = ("tender", "clarification")) -> tuple[re.Match, dict, int] | None:
    rx = re.compile(pattern, re.I | re.S)
    for d in docs:
        if d["kind"] not in kinds:
            continue
        for n, page in enumerate(d["pages_text"], 1):
            m = rx.search(re.sub(r"\s+", " ", page))
            if m:
                return m, d, n
    return None


def _at(d: dict, n: int) -> dict:
    return {"doc": d["id"], "title": d["title"], "page": n}


def terms(docs: list[dict], hps: float | None) -> list[dict]:
    """The figures the selection turns on, each where the documents say it, and those tied to the HPS worked out on it."""
    out = []
    tech, cost = _find(docs, r"bobot penawaran teknis[^%\d]{0,30}(\d{1,3}) ?%"), _find(docs, r"bobot penawaran biaya[^%\d]{0,30}(\d{1,3}) ?%")
    if tech and cost:
        out.append({"key": "weights", "label": "Scoring", "value": f"technical {tech[0].group(1)}% · cost {cost[0].group(1)}%", "note": "weighted: the technical bid and the price are scored together", "technical": int(tech[0].group(1)), "cost": int(cost[0].group(1)), **_at(tech[1], tech[2])})
    elif (hit := _find(docs, r"harga terendah|sistem gugur")):
        out.append({"key": "weights", "label": "Scoring", "value": hit[0].group(0).lower(), "note": "the lowest responsive price wins", **_at(hit[1], hit[2])})
    if (hit := _find(docs, r"masa berlaku penawaran\s+selama\W{0,3}\s*(\d{1,3})")):
        out.append({"key": "validity", "label": "Bid valid for", "value": f"{hit[0].group(1)} days", "note": "from the bid deadline", **_at(hit[1], hit[2])})
    if (hit := _find(docs, r"jangka\s+waktu\s+pelaksanaan[^0-9]{0,80}?(\d{2,4}) ?\(")):
        out.append({"key": "duration", "label": "Time allowed", "value": f"{hit[0].group(1)} calendar days", "note": "the programme must fit inside it", **_at(hit[1], hit[2])})
    if (hit := _find(docs, r"modal kerja[^%]{0,60}?(\d{1,3}) ?% dari HPS")):
        share = int(hit[0].group(1)) / 100
        out.append({"key": "capital", "label": "Working capital", "value": f"at least {hit[0].group(1)}% of the HPS", "amount": round(share * hps) if hps else None, "note": "in the company's accounts, credit line or deposits", **_at(hit[1], hit[2])})
    if (hit := _find(docs, r"nilai (?:kontrak|paket) paling (?:kurang|sedikit) (\d) ?/ ?(\d)")):
        share = int(hit[0].group(1)) / int(hit[0].group(2))
        out.append({"key": "experience", "label": "Largest past contract", "value": f"at least {hit[0].group(1)}/{hit[0].group(2)} of the HPS", "amount": round(share * hps) if hps else None, "note": "one similar contract, with its handover record", **_at(hit[1], hit[2])})
    if (hit := _find(docs, r"SKP ?= ?(\d)")):
        out.append({"key": "skp", "label": "Remaining capacity", "value": f"SKP = {hit[0].group(1)} − packages under way here", "note": "a company already running this many packages for the owner cannot bid", **_at(hit[1], hit[2])})
    if (hit := _find(docs, r"jaminan penawaran[^R]{0,80}Rp\.? ?([\d.]{6,}(?:,\d+)?)")):
        out.append({"key": "bid_bond", "label": "Bid guarantee", "value": f"Rp {_number(hit[0].group(1)):,.0f}", "amount": _number(hit[0].group(1)), "note": "", **_at(hit[1], hit[2])})
    if (hit := _find(docs, r"jaminan sanggah banding[^R]{0,120}Rp\.? ?([\d.]{6,}(?:,\d+)?)")):
        out.append({"key": "appeal_bond", "label": "Appeal guarantee", "value": f"Rp {_number(hit[0].group(1)):,.0f}", "amount": _number(hit[0].group(1)), "note": "only if appealing the result", **_at(hit[1], hit[2])})
    return out


def hps_figures(docs: list[dict], plan: dict) -> dict:
    """The HPS before tax, as the recap reader took it, and with tax, as the HPS document totals it."""
    with_tax, where = None, None
    for d in docs:
        if d["kind"] != "estimate":
            continue
        for n, page in enumerate(d["pages_text"], 1):
            amounts = [_number(x) for x in re.findall(r"\b\d{1,3}(?:\.\d{3}){2,}(?:,\d{1,2})?", page)]
            if amounts and (with_tax is None or max(amounts) > with_tax):
                with_tax, where = max(amounts), _at(d, n)
    before = plan.get("owner_total")
    if with_tax and before and with_tax < before:  # a document that only states the figure before tax
        with_tax = None
    return {"before_tax": before, "with_tax": with_tax, "source": where}


def price(plan: dict, hps: dict) -> dict | None:
    """The priced BoQ, the RAB, against the HPS, in total and section by section, before tax on both sides."""
    rab, owner = plan.get("total"), hps["before_tax"]
    if not rab or not owner:
        return None
    sections = [{"no": a["no"], "name": K.nice(a["name"]), "rab": a.get("value") or 0, "hps": a.get("owner_value") or 0, "gap_pct": a.get("against_owner_pct")} for a in plan.get("accounts") or [] if a.get("owner_value")]
    return {"rab": rab, "hps": owner, "ratio": round(rab / owner, 4), "sections": sections, "rules": {"low": LOW, "bond": PERFORMANCE_BOND}}


def selection() -> dict:
    docs = documents()
    rec = M.live_plan()
    plan = (rec or {}).get("plan") or {}
    hps = hps_figures(docs, plan)
    saved = {r["id"]: r for r in P.all_of("tender_mark")}
    kinds = {d["id"]: d["kind"] for d in docs}
    items = []
    for key, stage, leaf, what, words in ITEMS:
        s = saved.get(key) or {}
        where = [d for d in docs if d["kind"] in QUALIFIED_BY] if stage == "kualifikasi" else docs  # the qualification is set by the instructions to bidders: a supplier's certificate in the specification is not the bidder's
        found = sorted(CA.clauses(where, re.compile(words, re.I)), key=lambda f: ORDER.index(kinds[f["doc"]]))  # what the instructions to bidders say first, a bidder's question after
        items.append({"key": key, "stage": stage, "leaf": leaf, "what": what, "found": found[:2],
                      "status": s.get("status", "todo"), "comment": s.get("note", ""), "who": s.get("who", ""), "at": s.get("at", "")})
    tree = [{**{k: v for k, v in b.items() if k != "leaves"}, "leaves": [{"key": k, "name": n, "hint": h} for k, n, h in b["leaves"]]} for b in TREE]
    return {"tree": tree, "items": items, "terms": terms(docs, hps["with_tax"] or hps["before_tax"]), "hps": hps, "price": price(plan, hps),
            "read": [{"id": d["id"], "title": d["title"], "kind": d["kind"]} for d in docs], "tender_read": any(d["kind"] == "tender" for d in docs),
            "ready": sum(x["status"] == "ready" for x in items), "not_needed": sum(x["status"] == "na" for x in items), "not_found": sum(not x["found"] for x in items)}


def mark(key: str, status: str, note: str = "", who: str = P.PM) -> dict:
    """A person's word on one requirement: ready, not needed, or back to do."""
    if status not in STATUS:
        raise ValueError(f"status must be one of: {', '.join(STATUS)}")
    if key not in {x[0] for x in ITEMS}:
        raise KeyError(key)
    rec = {"id": key, "status": status, "who": who, "at": time.strftime("%Y-%m-%d %H:%M"), "note": note.strip()}
    return P.put("tender_mark", key, rec, who, {"ready": "marked a tender requirement ready", "na": "marked a tender requirement not needed", "todo": "reopened a tender requirement"}[status], f"{key}{f': {note.strip()}' if note.strip() else ''}")


router = APIRouter()


class Mark(BaseModel):
    status: str
    note: str = ""


@router.get("/api/project/tender-selection")
def get_selection() -> dict:
    return selection()


@router.post("/api/project/tender-selection/{key}")
def set_requirement(key: str, body: Mark) -> dict:
    try:
        return mark(key, body.status, body.note)
    except KeyError as e:
        raise HTTPException(404, f"no such requirement: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e

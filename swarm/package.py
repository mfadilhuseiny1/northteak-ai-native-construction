"""A real package from a planning consultant, read by code before any agent sees it: which files matter, what is missing, and the tables code can read exactly.

Agents reason, code calculates. A master schedule and a priced recap are tables, so code reads them and checks its reading against the totals the document itself prints. The agents get what code cannot do: reading the specification and writing procedures from it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path

from . import project as P

logging.getLogger("pypdf").setLevel(logging.ERROR)  # it complains of fonts it can still read

# the first rule to fit decides, on the file's name and its first page. Used: a planner needs it. Set aside: says why, and never goes to a model
RULES = [
    ("tender", False, "Instructions to bidders: nothing in it is for the site", r"\bldk\b|\bldp\b|instruksi.{0,6}peserta|lembar data|persyaratan penyedia"),
    ("award", False, "A tender summary from the procurement system: it names the bidders, and nothing in it is for the site", r"summary report|ringkasan.{0,12}(tender|lelang|pemilihan)|kode tender|daftar peserta|peserta tender|pemenang berkontrak"),  # before the rules below: its first page states the HPS and the schedule too
    ("programme", True, "The master schedule: the work, its weights and its weeks", r"jadwal|kurva.?s|master schedule|time schedule"),
    ("boq", True, "The priced quantities: what each group of work is worth", r"daftar.{0,12}(kuantitas|harga)|\bdkh\b|\bboq\b|bill of quantit"),
    ("estimate", True, "The owner's estimate, to compare the prices with", r"\bhps\b|harga perkiraan"),
    ("spec", True, "How each kind of work must be done", r"rencana kerja dan syarat|\brks\b|spesifikasi"),
    ("drawing", True, "The drawings: only their text can be read", r"gambar|drawing|denah"),
    ("clarification", True, "The clarification minutes: answers that can change what is required", r"berita.?acara.{0,12}(pemberian.?penjelasan|penjelasan)|aanwijzing"),
    ("contract", True, "The contract: time for completion and conditions", r"kontrak|contract|perjanjian"),
    ("award", False, "A bid or award record: it names companies and tax numbers, and nothing in it is for the site", r"penawaran|penetapan|pengumuman|sanggah|negosiasi|hasil.?pemilihan|sppbj|penunjukan|sertifikat|lisensi"),
    ("scope", True, "What the project is and what it must deliver", r"\bkak\b|kerangka acuan|work brief|lingkup|scope"),
    ("itp", True, "The inspection and test plan", r"\bitp\b|inspection (and|&) test|rencana inspeksi"),
    ("rates", True, "Agreed rates", r"analisa harga|harga satuan|\brates?\b"),
]
EMPTY_NOTE = r"tidak relevan|tidak menjadi persyaratan|not applicable"
PERCENT = re.compile(r"\d+(?:[.,]\d+)?\s?%")
LOWER = {"dan", "di", "ke", "dari", "untuk", "atau", "dengan", "pada", "and", "of", "the", "for"}
ACRONYM = re.compile(r"^(?:[B-DF-HJ-NP-TV-Z]{2,}|MEP|LAN|AC|UPS|[A-Z]\d+)$")  # no vowel, or known: SMKK, STP, MEP


def nice(name: str) -> str:
    """'PEKERJAAN GALIAN DAN URUGAN' as a person writes it, without the word every line starts with. Acronyms stay as they are."""
    words = name.split()
    if len(words) > 1 and words[0].lower() == "pekerjaan":
        words = words[1:]
    if name != name.upper():
        return " ".join(words)
    out = []
    for i, w in enumerate(words):
        low = w.lower()
        out.append(w if ACRONYM.match(w) and low not in LOWER else low if i and low in LOWER else low.capitalize())
    return " ".join(out)


def _squash(text: str) -> str:
    """For comparing text from a PDF: extraction breaks words at odd places, so 'sesuai' can come out as 's esuai'."""
    return re.sub(r"\s+", "", text or "").casefold()


def found_in(quote: str, text: str) -> bool:
    return bool(_squash(quote)) and _squash(quote) in _squash(text)


# ------------------------------------------------------------------------------------------------ pages


def read_pages(path: Path) -> list[str]:
    """Every page of a file as text. A scan gives empty pages, and that is a fact about the file."""
    if path.suffix.lower() == ".pdf":
        from pypdf import PdfReader

        out = []
        for page in PdfReader(str(path)).pages:
            try:
                out.append(page.extract_text() or "")
            except Exception:  # noqa: BLE001 - one sheet too dense to read must not lose the rest of the file. It reads as a page with no text, which the upload's record counts
                out.append("")
        return out
    if path.suffix.lower() in (".txt", ".md", ".csv"):
        return [path.read_text(encoding="utf-8", errors="replace")]
    return []


def keep_pages(rid: str, pages: list[str]) -> None:
    """Beside the upload, not in the records: a specification can run to hundreds of pages."""
    (P.upload_folder() / f"{rid}.pages.json").write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")


def pages_of(rid: str) -> list[str]:
    path = P.upload_folder() / f"{rid}.pages.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def classify(name: str, pages: list[str]) -> tuple[str, bool, str]:
    """What a file is, whether the agents should read it, and why. A person can overrule it."""
    first = " ".join(pages[:2])[:1500]
    words = sum(len(p.strip()) for p in pages)
    if re.search(EMPTY_NOTE, first, re.I) and words < 1500:
        return "note", False, "A note saying these documents do not apply to this tender"
    if re.search(r"rencana kerja dan syarat", first, re.I):
        return "spec", True, "The specification: how each kind of work must be done"
    text = f"{name} {first}".lower().replace("-", " ").replace("_", " ")
    weekly = sum(len(PERCENT.findall(p)) for p in pages) >= 20 or any(re.search(r"\bminggu\b|\bweek\b", p, re.I) for p in pages)  # a file can be named a schedule and hold something else
    fits = lambda r, where: re.search(r[3], where) and (r[0] != "programme" or weekly)  # noqa: E731
    rule = next((r for r in RULES if fits(r, name.lower().replace("-", " ").replace("_", " "))), None) or next((r for r in RULES if fits(r, text)), None)
    kind, use, why = (rule[0], rule[1], rule[2]) if rule else ("other", True, "Not recognised, so the agents read it. Leave it out if it does not help")
    if use and not words:
        return kind, False, "Drawings as pictures, with no text the agents can read" if kind == "drawing" else "A scan with no text to read, and there is no OCR yet"
    return kind, use, why


# ------------------------------------------------------------------------------------------------ the master schedule


def _placed(page) -> list[tuple[float, float, str]]:
    """Each piece of text on a page with where it sits, in the order the file holds them. Where a cell sits is what says which week it is in."""
    out: list[tuple[float, float, str]] = []

    def seen(text, cm, tm, font, size):
        if text.strip():
            out.append((tm[4] * cm[1] + tm[5] * cm[3] + cm[5], tm[4] * cm[0] + tm[5] * cm[2] + cm[4], text))

    page.extract_text(visitor_text=seen)
    return out


def read_programme(path: Path) -> dict | None:
    """A Kurva-S, read by position: each row's number, name and weight, and from where its cells sit under the week columns, the weeks it runs. None if this is not a table code can read, or if its weights do not add up to 100: then an agent reads it."""
    from pypdf import PdfReader

    try:
        pages = PdfReader(str(path)).pages
    except Exception:  # noqa: BLE001 - not readable is an answer here
        return None
    value = lambda t: float(t.strip().replace(",", ".").rstrip("% "))  # noqa: E731
    for page in pages:
        bits = _placed(page)
        heads = sorted((x, int(m.group(1)), y) for y, x, t in bits if (m := re.fullmatch(r"M-(\d{1,3})", t.strip())))
        if len(heads) < 8:
            continue
        pitch = heads[1][0] - heads[0][0]
        first, top = heads[0][0] - pitch / 2, heads[0][2]
        week_at = lambda x: min(heads, key=lambda h: abs(h[0] - x))[1]  # noqa: E731
        numbers = [(y, x, t.strip()) for y, x, t in bits if y < top and x < first and re.fullmatch(r"[IVX]+|\d+(?:\.\d+)*", t.strip())]
        if not numbers:
            continue
        column = min(x for _, x, _ in numbers)
        rows = []
        for y, x, no in sorted((n for n in numbers if n[1] <= column + 8), key=lambda n: -n[0]):
            name = "".join(t for yy, xx, t in bits if column + 4 < xx < first and -5 <= yy - y <= 1.5 and not PERCENT.fullmatch(t.strip()))
            near = [(abs(yy - y), value(t)) for yy, xx, t in bits if xx < first and abs(yy - y) <= 5 and PERCENT.fullmatch(t.strip())]
            weight = min(near)[1] if near else None
            cells = [(round(yy, 1), xx, value(t)) for yy, xx, t in bits if xx >= first and abs(yy - y) <= 0.7 and PERCENT.fullmatch(t.strip()) and value(t) <= (weight if weight is not None else 100)]
            height = max({c[0] for c in cells}, key=[c[0] for c in cells].count) if cells else None  # a row's cells share one height: a label of the curve landing nearby does not
            by_week = {week_at(xx): v for yy, xx, v in cells if yy == height}  # the schedule's own figure for each week, as printed
            weeks = sorted(by_week)
            if " ".join(name.split()):
                rows.append({"no": no, "name": " ".join(name.split()), "weight": weight, "weeks": weeks, "cells": by_week})
        total = sum(r["weight"] or 0 for r in rows)
        if len(rows) < 3 or abs(total - 100) > 1.0:
            continue
        label = next((y for y, _, t in bits if re.search(r"k[ou]mulatif", t, re.I)), None)
        curve = {}
        if label is not None:
            for yy, xx, t in bits:
                if xx >= first and abs(yy - label) <= 3 and PERCENT.fullmatch(t.strip()):
                    curve[week_at(xx)] = value(t)
        cumulative = [curve[w] for w in sorted(curve)]
        good = len(cumulative) == len(heads) and cumulative[-1] == 100.0 and all(a <= b for a, b in zip(cumulative, cumulative[1:]))
        return {"weeks": heads[-1][1], "rows": rows, "total_weight": round(total, 2), "cumulative": cumulative if good else None}
    return None


def read_recap(text: str) -> dict | None:
    """A priced recap: each group of work and what it is worth. Only figures the text states, and the groups must add up to the total it prints, or this is not read."""
    groups = []
    for m in re.finditer(r"^\s*([IVX]+)\.?\s+([A-Z][^\n]*?)\s+([\d.]+,\d{2})\s*(?:Rp)?\s*([\d,]+)\s*%", text, re.M):
        groups.append({"no": m.group(1), "name": " ".join(m.group(2).split()), "value": float(m.group(3).replace(".", "").replace(",", ".")), "share": float(m.group(4).replace(",", "."))})
    if len(groups) < 2:
        return None
    total = sum(g["value"] for g in groups)
    printed = [float(n.replace(".", "").replace(",", ".")) for n in re.findall(r"\d{1,3}(?:\.\d{3})+,\d{2}", text)]
    if not any(abs(n - total) <= 1 for n in printed):  # a document's own rounding can be a cent out
        return None
    return {"groups": groups, "total": round(total, 2)}


BOQ_ROW = re.compile(r"^(?:(\d{1,3}|[a-zA-Z]{1,2})[.)]?\s+)?(.*?)\s*(\d[\d.,]*)\s+([A-Za-z][\w'’²³/.]{0,7})\s*(-?\s*Rp\b.*)$")
BOQ_GLUED = re.compile(r"^(?:(\d{1,3}|[a-zA-Z]{1,2})[.)]?\s+)?(\d[\d.,]*?)([A-Za-z].*?)\s+([A-Za-z][\w'’²³/.]{0,7})\s*(-?\s*Rp\b.*)$")  # the layout reading can run a row's volume into its description: "c. 1.11Beton Fc' 30 Mpa m3 -Rp"
BOQ_HEAD = re.compile(r"^([A-Z]{1,2}(?:\.\d{1,2})?|[IVX]+)[.)]?\s+(.{3,})$")
BOQ_GROUP = re.compile(r"^(\d{1,3})[.)]?\s+(.{3,})$")


def _number(text: str) -> float | None:
    """A figure as a document writes it, 1,789.58 or 1.789,58. Both separators, or a separator followed by anything but three digits, say which one is the decimal point."""
    t = text.strip().rstrip(".,")
    if not re.fullmatch(r"\d[\d.,]*", t):
        return None
    last = max(t.rfind("."), t.rfind(","))
    if last >= 0 and (len(t) - last - 1 != 3 or ("." in t and "," in t)):
        return float(re.sub(r"[.,]", "", t[:last]) + "." + t[last + 1:])
    return float(re.sub(r"[.,]", "", t))


def read_layout(path: Path) -> list[str]:
    """A PDF's pages with each row of a table kept on one line. The plain reading can lose a cell's words from its row, as it does for 58 of the 445 rows in one real BoQ. Empty if it cannot be read this way, and the caller falls back on the plain pages."""
    if path.suffix.lower() != ".pdf":
        return []
    try:
        from pypdf import PdfReader

        pages = PdfReader(str(path)).pages
    except Exception:  # noqa: BLE001 - a file this cannot read is still read the plain way
        return []
    out = []
    for page in pages:
        try:
            out.append(page.extract_text(extraction_mode="layout") or "")
        except Exception:  # noqa: BLE001 - as in read_pages: one sheet must not lose the rest
            out.append("")
    return out


def read_boq_lines(doc: str, pages: list[str]) -> list[dict]:
    """A BoQ's rows, by code: each row with its section, description, volume and unit, its price if it has one, the page it is on, and the work its header names. Only what the text states. A row whose description the extraction lost stays in, with no description, for a person to read on its page. One file can hold the BoQs of two projects, as a tender for two buildings does, so each row keeps the name of the work it is under."""
    out: list[dict] = []
    head = group = work = ""
    analysis = False
    for n, text in enumerate(pages, 1):
        top_of_page = " ".join(text.split())[:300]
        if re.search(r"analisa harga satuan", top_of_page, re.I):  # the unit-price analysis often follows the BoQ in one file: its labour and material rows look like BoQ lines, and are not
            analysis = True
        elif re.search(r"daftar kuantitas|bill of quantit", top_of_page, re.I):
            analysis = False
        if analysis:
            continue
        for raw in text.splitlines():
            line = " ".join(raw.split())
            if title := re.match(r"^PEKERJAAN\s*:\s*(.+)$", line):
                if title.group(1).strip() != work:
                    work, head, group = title.group(1).strip(), "", ""
                continue
            if not line or re.match(r"^(NO|LOKASI|TAHUN ANGGARAN|SUB PEKERJAAN)\b", line):
                continue
            m = BOQ_ROW.match(line)
            qty = _number(m.group(3)) if m else None
            name = m.group(2) if m else ""
            if qty is None and (g := BOQ_GLUED.match(line)):
                m, qty, name = g, _number(g.group(2)), g.group(3)
            if m and qty is not None:
                prices = [_number(x) for x in re.findall(r"Rp\s*(\d[\d.,]*)", m.group(5))]
                out.append({"doc": doc, "page": n, "work": work, "section": head, "group": group, "no": m.group(1) or "", "name": name.strip(" ;:"), "qty": qty, "unit": m.group(4), "rate": prices[0] if prices else None, "amount": prices[1] if len(prices) > 1 else None})
                continue
            top = BOQ_HEAD.match(line)
            if top and top.group(2) == top.group(2).upper():
                head, group = line, ""  # as the BoQ writes it
            elif sub := BOQ_GROUP.match(line):
                group = sub.group(2).strip(" ;:")
    return out


def boq_outline(lines: list[dict]) -> str:
    """A BoQ in a few lines, read by code: each section, how many rows it has and where, and a few of its groups to say what is in it. A long BoQ does not fit in what an agent is given, and its last sections would be lost. Every group is not listed: an agent given all of them makes a work package of each, one for every type of column."""
    out: list[str] = []
    for section in dict.fromkeys(x["section"] for x in lines):
        mine = [x for x in lines if x["section"] == section]
        groups = list(dict.fromkeys(x["group"] for x in mine if x["group"]))
        out.append(f"{section or 'Before the first section'} ({len(mine)} rows, pages {mine[0]['page']} to {mine[-1]['page']})" + (f", such as {'; '.join(groups[:3])}" if groups else ""))
    return "\n".join(out)


UNCOMMON = {"pekerjaan", "struktur", "dan", "the", "and", "of", "work", "lantai"}


def uncovered(lines: list[dict], names: list[str]) -> list[dict]:
    """Sections of the BoQ that no work package names: none of the section's own words is in any work package or control account. A word match, so a person checks each one."""
    said = {w for n in names for w in re.findall(r"[a-z0-9]+", n.lower())}
    out = []
    for section in dict.fromkeys(x["section"] for x in lines if x["section"]):
        words = {w for w in re.findall(r"[a-z]+", re.sub(r"^\S+\s+", "", section).lower()) if len(w) > 2 and w not in UNCOMMON}
        if words and not words & said:
            mine = [x for x in lines if x["section"] == section]
            out.append({"section": section, "rows": len(mine), "doc": mine[0]["doc"], "page": mine[0]["page"]})
    return out


def contract_days(text: str) -> int | None:
    """The time for completion, only where the text says that is what it is: other periods are stated in calendar days too, such as the defects period."""
    m = re.search(r"(?:jangka waktu|masa|waktu) (?:pelaksanaan|penyelesaian)[^.]{0,80}?(\d{2,4})\s*(?:\([^)]{0,60}\)\s*)?hari\s*kalend", re.sub(r"\s+", " ", text or ""), re.I)
    return int(m.group(1)) if m else None


def schedule_rows(programme: dict) -> list[dict]:
    """The master schedule as it is printed: each group, with its rows, each with its weight and its own figure for each week."""
    groups: list[dict] = []
    parents: dict[str, str] = {}
    for r in programme["rows"]:
        if re.fullmatch(r"[IVX]+", r["no"]):
            groups.append({"no": r["no"], "name": nice(r["name"]), "weight": r["weight"], "cells": r.get("cells") or {}, "rows": []})
            parents = {}
        elif groups and r["weight"] and r["weeks"]:
            parent = parents.get(r["no"].rsplit(".", 1)[0]) if "." in r["no"] else None
            groups[-1]["rows"].append({"no": f"{groups[-1]['no']}.{r['no']}", "name": f"{parent}: {nice(r['name'])}" if parent else nice(r["name"]), "weight": r["weight"], "cells": r.get("cells") or {}})
        elif groups:
            parents[r["no"]] = nice(r["name"])
    return groups


def structure(programme: dict, recap: dict | None = None) -> dict:
    """The WBS the schedule already holds: each top-level group a control account, each row with a weight under it a work package. Worth comes from the priced recap, spread by the schedule's weights."""
    accounts: list[dict] = []
    parents: dict[str, str] = {}
    for r in programme["rows"]:
        if re.fullmatch(r"[IVX]+", r["no"]):
            value = next((g["value"] for g in (recap or {}).get("groups", []) if g["no"] == r["no"]), None)
            accounts.append({"no": r["no"], "name": nice(r["name"]), "value": value, "packages": []})
            parents = {}
            if r["weight"] and r["weeks"]:
                accounts[-1]["packages"].append({"no": r["no"], "name": nice(r["name"]), "weight": r["weight"], "weeks": r["weeks"]})
        elif accounts and r["weight"] and r["weeks"]:
            parent = parents.get(r["no"].rsplit(".", 1)[0]) if "." in r["no"] else None
            accounts[-1]["packages"].append({"no": f"{accounts[-1]['no']}.{r['no']}", "name": f"{parent}: {nice(r['name'])}" if parent else nice(r["name"]), "weight": r["weight"], "weeks": r["weeks"]})
        elif accounts:
            parents[r["no"]] = nice(r["name"])  # a heading: its rows carry its name
    total = (recap or {}).get("total")
    for a in accounts:
        weights = sum(w["weight"] for w in a["packages"]) or 1
        if a["value"] is None and total:
            a["value"] = round(total * weights / 100)
        for w in a["packages"]:
            w["start_week"], w["finish_week"] = min(w["weeks"]), max(w["weeks"])
            w["days"] = (w["finish_week"] - w["start_week"] + 1) * 7
            w["not_before"] = (w["start_week"] - 1) * 7
            w["value"] = round(a["value"] * w["weight"] / weights) if a["value"] else None  # within its account, so the packages add up to what the BoQ says it is worth
    return {"accounts": accounts, "weeks": programme["weeks"], "total": total, "cumulative": programme.get("cumulative")}


# ------------------------------------------------------------------------------------------------ the package as it stands


def uploads() -> list[dict]:
    return [d for d in P.all_of("document") if d.get("source") == "upload"]


def review() -> dict:
    """What came in, what the agents will read, what is set aside and why, and what a plan will have to do without."""
    docs = uploads()
    seen: dict[str, str] = {}
    rows = []
    for d in docs:
        digest = d.get("digest") or ""
        twin = seen.get(digest) if digest else None
        if digest and not twin:
            seen[digest] = d["id"]
        use = bool(d.get("use", True)) and not twin
        rows.append({**{k: d.get(k) for k in ("id", "title", "kind", "pages", "filename", "date", "how_read", "file")}, **({"typed": True, "text": d.get("text") or ""} if d.get("typed") else {}), "use": use, "why": f"The same file as {twin}" if twin else d.get("why") or "", "words": d.get("words", 0), "overruled": bool(d.get("overruled"))})
    used = [r for r in rows if r["use"]]
    kinds = {r["kind"] for r in used if not r.get("typed")}  # a person's few words on the job are not the specification a procedure rests on
    missing = []
    if "programme" not in kinds:
        missing.append("No master schedule: the agents have to estimate every duration.")
    boq = [r for r in used if r["kind"] == "boq"]
    if not boq:
        missing.append("No priced quantities: there is nothing to put a value on the work.")
    elif all((r["pages"] or 0) <= 2 for r in boq):
        missing.append("The BoQ is only a recap: no quantities or unit rates, so cost starts top-down, and man-hours and material cannot be worked out from them.")
    elif not any(re.search(r"\d{1,3}(?:[.,]\d{3}){2,}", " ".join(pages_of(r["id"]))) for r in boq):
        missing.append("The BoQ has quantities but no prices: there is nothing to put a value on the work.")
    if "spec" not in kinds and "scope" not in kinds:
        missing.append("No specification: the procedures would have nothing to rest on.")
    if "itp" not in kinds:
        missing.append("No inspection and test plan: the agents take the inspections from the specification.")
    if "drawing" not in kinds:
        missing.append("The drawings are pictures with no text, so the agents cannot read them. Check the procedures against them yourself." if any(r["kind"] == "drawing" for r in rows) else "No drawings.")
    elif not any(re.search(r"struktur|structural|penulangan|pembesian", " ".join(pages_of(r["id"])), re.I) for r in used if r["kind"] == "drawing"):
        missing.append("No structural drawings: bar sizes, spacing and laps are not known, so the agents must ask rather than assume them.")
    return {"documents": rows, "used": len(used), "set_aside": len(rows) - len(used), "missing": missing}


def digest_of(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()

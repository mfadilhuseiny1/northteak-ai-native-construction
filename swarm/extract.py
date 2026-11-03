"""Reading a document with no model: its text, and the facts plain rules can pull out of it. What a rule cannot read, a person or an agent reads. Offline and free.

Everything here is a reading of the text, never a judgement on it: a figure found is a figure the document states.
"""

from __future__ import annotations

import re
from pathlib import Path

MAX_TEXT = 200_000  # characters kept from one document: enough for a long specification, and it keeps the records small
PATTERNS = {
    "drawings": r"\b(?!(?:K|RFI|NCR|PO|PR|HP|WI|DR|UP|WP|AC|BQ|PH|IN|DOC|MSG|LOG|SCH|BOQ)-)(?![WT]-\d{2}\b)[A-Z]{1,3}-\d{2,4}(?:\s+rev\s+[A-Z0-9]+)?\b",
    "concrete": r"\bK-\d{3}\b|\bf'?c\s*'?\s*\d+(?:\.\d+)?\s*MPa\b",
    "rebar": r"\b(?:\d+\s+)?[DØ]\d{1,2}\b(?:\s+at\s+\d+\s*mm)?",
    "dimensions": r"\b\d{2,5}\s*[x×]\s*\d{2,5}(?:\s*[x×]\s*\d{2,5})?\s*(?:mm|m)\b",
    "quantities": r"\b\d[\d.,]*\s*(?:m3|m2|kg|tonne|litres?|sheets?)\b",
    "tolerances": r"\+/-\s*\d+(?:\.\d+)?\s*(?:mm|cm)",
    "money": r"\bRp\s*\d[\d.,]*",
    "dates": r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?\b",
    "activities": r"\b(?:A|B|C)\d{2}\b|\bAC-\d{3}\b",
    "records": r"\b(?:RFI|NCR|PO|HP|W|T)-\d{2,3}\b",
    "standards": r"\bSNI\s*[\d:\-]+\b",
}


def facts(text: str) -> dict[str, list[str]]:
    """Each kind of fact the text states, each one once, in the order it comes."""
    out = {}
    for kind, pattern in PATTERNS.items():
        seen = list(dict.fromkeys(re.sub(r"\s+", " ", m.group(0)).strip(" ,.") for m in re.finditer(pattern, text or "")))
        if seen:
            out[kind] = seen[:40]
    return out


def read_text(path: Path) -> tuple[str, str]:
    """The text of a file, and how it was read. A scan has no text to give, and says so rather than pretending."""
    suffix = path.suffix.lower()
    if suffix in (".txt", ".md", ".csv"):
        return path.read_text(encoding="utf-8", errors="replace")[:MAX_TEXT], "plain text"
    if suffix == ".pdf":
        from pypdf import PdfReader

        try:
            reader = PdfReader(str(path))
            parts = [page.extract_text() or "" for page in reader.pages]
        except Exception as e:  # noqa: BLE001 - a broken file is a fact about the file, not a failure of the upload
            return "", f"the PDF could not be read: {type(e).__name__}"
        text = "\n\n".join(parts).strip()
        return text[:MAX_TEXT], f"PDF, {len(parts)} pages" if text else f"PDF, {len(parts)} pages of images: no text to read without a model"
    return "", "kept as a file: no text to read"


def superseded(docs: list[dict]) -> dict[str, str]:
    """Which drawings a later revision replaces: the older one, and the id of the one in force. It compares what the titles say, in date order. Only a drawing can be replaced this way: another document merely mentioning a revision is not one."""
    groups: dict[str, list[tuple[str, str, str]]] = {}
    for d in docs:
        m = re.search(r"\b([A-Z]{1,3}-\d{2,4})\s+rev\s+([A-Z0-9]+)\b", d.get("title") or "") if d.get("kind") == "drawing" else None
        if m:
            groups.setdefault(m.group(1), []).append((d.get("date") or "", m.group(2), d["id"]))
    out = {}
    for rows in groups.values():
        rows.sort()
        out.update({row[2]: rows[-1][2] for row in rows[:-1]})
    return out

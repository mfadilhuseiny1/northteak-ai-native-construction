"""Indonesian construction regulations that decide what a site must do, with the words that say so.

A short register written by hand from the official texts, and checked on CHECKED: the regulations a contractor's plan meets most, whether each is still in force and what replaced it, and the few articles code applies. Not a library to search. Code applies these and names the article it applied, so a person can check it against the text it links to.

    cited        which regulations a package cites, and which of those have since been revoked
    safety_risk  the safety risk level the package's own facts point to, by Permen PUPR 10/2021 Pasal 34
    special      whether a task is work that needs a work permit with its safety analysis, by Pasal 26 and 27
    obligations  what must be done before work starts, while it runs and at handover, with the package's own words for each

Each quotation is the official text, with only the spacing that PDF extraction breaks put right.
"""

from __future__ import annotations

import re

from . import language as L
from typing import Any

CHECKED = "2026-11-03"
BPK = "https://peraturan.bpk.go.id/Details/"
P10 = "permen-10-2021"
P14 = "permen-14-2020"

# By kind, number and year. A regulation is "revoked" here only where the text that replaced it says so, or the official register lists it so
REGULATIONS: dict[str, dict[str, Any]] = {
    "uu-2-2017": {"name": "UU 2/2017", "title": "Undang-Undang Nomor 2 Tahun 2017 tentang Jasa Konstruksi", "status": "in force, amended by UU 6/2023", "url": "https://berkas.dpr.go.id/puspanlakuu/kompilasi/kompilasi-public-400.pdf"},
    "uu-6-2023": {"name": "UU 6/2023", "title": "Undang-Undang Nomor 6 Tahun 2023 tentang Penetapan Perppu Nomor 2 Tahun 2022 tentang Cipta Kerja menjadi Undang-Undang", "status": "in force", "url": BPK + "246523"},
    "uu-11-2020": {"name": "UU 11/2020", "title": "Undang-Undang Nomor 11 Tahun 2020 tentang Cipta Kerja", "status": "revoked", "replaced_by": "uu-6-2023", "since": "2023"},
    "pp-16-2021": {"name": "PP 16/2021", "title": "Peraturan Pemerintah Nomor 16 Tahun 2021 tentang Peraturan Pelaksanaan Undang-Undang Nomor 28 Tahun 2002 tentang Bangunan Gedung", "status": "in force", "url": BPK + "161846"},
    "pp-36-2005": {"name": "PP 36/2005", "title": "Peraturan Pemerintah Nomor 36 Tahun 2005 tentang Peraturan Pelaksanaan Undang-Undang Nomor 28 Tahun 2002 tentang Bangunan Gedung", "status": "revoked", "replaced_by": "pp-16-2021", "since": "2021"},
    "pp-28-2025": {"name": "PP 28/2025", "title": "Peraturan Pemerintah Nomor 28 Tahun 2025 tentang Penyelenggaraan Perizinan Berusaha Berbasis Risiko", "status": "in force", "url": BPK + "319773"},
    "pp-5-2021": {"name": "PP 5/2021", "title": "Peraturan Pemerintah Nomor 5 Tahun 2021 tentang Penyelenggaraan Perizinan Berusaha Berbasis Risiko", "status": "revoked", "replaced_by": "pp-28-2025", "since": "2025"},
    "perpres-16-2018": {"name": "Perpres 16/2018", "title": "Peraturan Presiden Nomor 16 Tahun 2018 tentang Pengadaan Barang/Jasa Pemerintah", "status": "in force, amended by Perpres 12/2021 and Perpres 46/2025", "url": BPK + "73586"},
    "perpres-46-2025": {"name": "Perpres 46/2025", "title": "Peraturan Presiden Nomor 46 Tahun 2025 tentang Perubahan Kedua atas Peraturan Presiden Nomor 16 Tahun 2018 tentang Pengadaan Barang/Jasa Pemerintah", "status": "in force", "url": BPK + "318647"},
    P14: {"name": "Permen PUPR 14/2020", "title": "Peraturan Menteri PUPR Nomor 14 Tahun 2020 tentang Standar dan Pedoman Pengadaan Jasa Konstruksi Melalui Penyedia", "status": "in force", "url": BPK + "159651"},
    "permen-7-2019": {"name": "Permen PUPR 7/PRT/M/2019", "title": "Peraturan Menteri PUPR Nomor 7/PRT/M/2019 tentang Standar dan Pedoman Pengadaan Jasa Konstruksi Melalui Penyedia", "status": "revoked", "replaced_by": P14, "since": "2020"},
    P10: {"name": "Permen PUPR 10/2021", "title": "Peraturan Menteri PUPR Nomor 10 Tahun 2021 tentang Pedoman Sistem Manajemen Keselamatan Konstruksi", "status": "in force", "url": "https://peraturan.go.id/files/bn286-2021.pdf"},
    "permen-21-2019": {"name": "Permen PUPR 21/PRT/M/2019", "title": "Peraturan Menteri PUPR Nomor 21/PRT/M/2019 tentang Pedoman Sistem Manajemen Keselamatan Konstruksi", "status": "revoked", "replaced_by": P10, "since": "2021"},
    "permen-8-2023": {"name": "Permen PUPR 8/2023", "title": "Peraturan Menteri PUPR Nomor 8 Tahun 2023 tentang Pedoman Penyusunan Perkiraan Biaya Pekerjaan Konstruksi Bidang Pekerjaan Umum dan Perumahan Rakyat", "status": "in force", "url": "https://peraturan.go.id/files/permen-pupr-no-8-tahun-2023.pdf"},
    "permen-1-2022": {"name": "Permen PUPR 1/2022", "title": "Peraturan Menteri PUPR Nomor 1 Tahun 2022 tentang Pedoman Penyusunan Perkiraan Biaya Pekerjaan Konstruksi Bidang Pekerjaan Umum dan Perumahan Rakyat", "status": "revoked", "replaced_by": "permen-8-2023", "since": "2023",
                      "note": "Its Pasal 24 lets a procurement already under way on the old unit-price analysis finish on it. "},
    "permen-6-2025": {"name": "Permen PU 6/2025", "title": "Peraturan Menteri Pekerjaan Umum Nomor 6 Tahun 2025 tentang Standar Kegiatan Usaha dan/atau Standar Produk/Jasa, Pelaksanaan Pengawasan, dan Pengenaan Sanksi pada Penyelenggaraan Perizinan Berusaha Berbasis Risiko Sektor Pekerjaan Umum", "status": "in force", "url": BPK + "357431"},
    "permen-6-2021": {"name": "Permen PUPR 6/2021", "title": "Peraturan Menteri PUPR Nomor 6 Tahun 2021 tentang Standar Kegiatan Usaha dan Produk pada Penyelenggaraan Perizinan Berusaha Berbasis Risiko Sektor Pekerjaan Umum dan Perumahan Rakyat", "status": "revoked", "replaced_by": "permen-6-2025", "since": "2025"},
}

_NUMBER = r"(?:(?:Nomor|No\.?)\s*)?(\d{1,3})(?:\s*/\s*PRT(?:\s*/\s*M)?)?\s*(?:Tahun\s*|/\s*)(\d{4})"
CITE = [("uu", re.compile(r"(?:Undang\s*-?\s*Undang|\bUU)\s*(?:Republik Indonesia\s*|RI\s*)?" + _NUMBER, re.I)),
        ("pp", re.compile(r"(?:Peraturan Pemerintah|\bPP)\s*(?:\(PP\)\s*)?(?:Republik Indonesia\s*|RI\s*)?" + _NUMBER, re.I)),
        ("perpres", re.compile(r"(?:Peraturan Presiden|\bPerpres|\bPresiden)\s*(?:Republik Indonesia\s*|RI\s*)?" + _NUMBER, re.I)),
        ("permen", re.compile(r"(?:Peraturan Menteri Pekerjaan Umum(?:\s*dan\s*Perumahan\s*Rakyat)?|\bPer[Mm]en\s*PU(?:PR)?)\s*(?:Republik Indonesia\s*|RI\s*)?" + _NUMBER, re.I))]

LISTING = re.compile(r"\.{4,}|(?:\. ){4,}")  # a contents page: its lines run out in dots
DAYS = re.compile(r"(\d{1,3})\s*(?:\([^()]{2,40}\)\s*)?(hari\s+kalender|hari\s+kerja|hari|bulan)\b", re.I)


def link(key: str) -> str:
    return REGULATIONS.get(key, {}).get("url", "")


def _rule(key: str, article: str, quote: str) -> dict:
    return {"key": key, "name": REGULATIONS[key]["name"], "article": article, "quote": quote, "url": link(key)}


def _flat(text: str) -> str:
    return " ".join((text or "").split())


def _contents(text: str) -> bool:
    return len(LISTING.findall(text or "")) >= 4


def _ends(flat: str) -> list[int]:
    """Where each sentence ends. The full stop of a list number, as in "1.", "17)." or "a.", ends nothing."""
    out = []
    for m in re.finditer(r"\.(?=\s|$)", flat):
        before = flat[max(0, m.start() - 6):m.start()]
        if re.search(r"(?:^|\s)\(?(?:\d{1,3}|[a-z])\)?$|(?:^|\s)(?:No|Jl|dll|dsb|dst|Ir|Dr|Hal|Tgl|Rp|Kab|Kec)$", before, re.I):
            continue
        out.append(m.end())
    return out


MARKER = re.compile(r"(?<!\S)(?:\d{1,3}\.\d{1,3}\.\(?\w{1,2}\)?|\d{1,3}(?:\.\d{1,3})?\)?[.)]|\d{1,3}\.\d{1,3}|[a-z][.)]|\([a-z]\)|\(\d{1,2}\))(?=\s)", re.I)  # "70.4.(c)", "1.", "17).", "23.1", "a.", "(b)", "(2)": where a clause starts. Not "(Dua)", which spells out a number


def _clause(flat: str, start: int, end: int, ends: list[int]) -> str:
    """The sentence a match is in, from the start of its numbered clause: what a person reads to see what the document says. A heading runs on into the clause under it. Too long to quote, it is cut at a word."""
    marks = [m.start() for m in MARKER.finditer(flat)]
    a = max([e for e in ends if e <= start] + [s for s in marks if s <= start] + [0])
    if start - a > 300:
        a = flat.find(" ", start - 160, start) + 1 or start - 160
    b = min([e for e in ends if e > end] + [s for s in marks if s > end and s > a + 120] + [len(flat)])
    if b - end > 400:
        b = flat.rfind(" ", end, end + 260) if flat.rfind(" ", end, end + 260) > end else end + 260
    return flat[a:b].strip()[:480]


# ------------------------------------------------------------------------------------------------ what a package cites


def cited(docs: list[dict]) -> dict[str, list[tuple[str, int]]]:
    """Every regulation the documents cite, by key, and where."""
    out: dict[str, list[tuple[str, int]]] = {}
    for d in docs:
        for n, page in enumerate(d["pages_text"], 1):
            flat = _flat(page)
            for kind, pattern in CITE:
                for m in pattern.finditer(flat):
                    where = out.setdefault(f"{kind}-{int(m.group(1))}-{m.group(2)}", [])
                    if (d["id"], n) not in where:
                        where.append((d["id"], n))
    return out


def revoked(cites: dict[str, list[tuple[str, int]]]) -> list[dict]:
    """What the documents cite that has since been revoked. Not where they also cite what replaced it: then they know."""
    out = []
    for key, where in cites.items():
        r = REGULATIONS.get(key) or {}
        if r.get("replaced_by") and r["replaced_by"] not in cites:
            by = REGULATIONS[r["replaced_by"]]
            out.append({"key": key, "name": r["name"], "by": r["replaced_by"], "by_name": by["name"], "since": r["since"], "url": by.get("url", ""), "where": where, "note": r.get("note", "")})
    return out


# ------------------------------------------------------------------------------------------------ the safety risk level: Permen PUPR 10/2021 Pasal 34

LEVELS = ("kecil", "sedang", "besar")
SIZE = {"kecil": "small", "sedang": "medium", "besar": "large"}  # the regulation's words for each level, in English
LIFTING = re.compile(r"tower crane(?:\s*/\s*mobile? crane)?|mobile? crane|crawler crane|truck crane|pesawat angkat|passenger hoist|\bcrane\b", re.I)  # "Tower Crane/Mobil Crane" allows either, and is quoted whole. Blasting, ayat (5) huruf e, is left to a person: its words also mean sandblasting, or a hazard in a list
STATED = re.compile(r"risiko\s+keselamatan\s+konstruksi\s+(?:[\w/]+\s+){0,3}?(kecil|sedang|besar)\b", re.I)
STAFF = {"kecil": ("Pasal 38 ayat (1)", "Dalam hal Pekerjaan Konstruksi memiliki Risiko Keselamatan Konstruksi kecil sebagaimana dimaksud dalam Pasal 34 ayat (3), perbandingan jumlah personil Keselamatan Konstruksi dengan jumlah tenaga kerja konstruksi berupa 1:60 (satu banding enam puluh) dengan paling sedikit 1 (satu) Petugas Keselamatan Konstruksi dalam tiap Pekerjaan Konstruksi.", 60),
         "sedang": ("Pasal 38 ayat (2)", "Dalam hal Pekerjaan Konstruksi memiliki Risiko Keselamatan Konstruksi sedang sebagaimana dimaksud dalam Pasal 34 ayat (4), perbandingan jumlah personil Keselamatan Konstruksi dengan jumlah tenaga kerja konstruksi berupa 1:50 (satu banding lima puluh) dengan paling sedikit 1 (satu) ahli Keselamatan dan Kesehatan Kerja Konstruksi dan/atau ahli Keselamatan Konstruksi muda dalam tiap Pekerjaan Konstruksi", 50),
         "besar": ("Pasal 38 ayat (3)", "Dalam hal Pekerjaan Konstruksi memiliki Risiko Keselamatan Konstruksi besar sebagaimana dimaksud dalam Pasal 34 ayat (5), perbandingan jumlah personil Keselamatan Konstruksi dengan jumlah tenaga kerja konstruksi berupa 1:40 (satu banding empat puluh) dengan paling sedikit 1 (satu) ahli keselamatan dan kesehatan kerja konstruksi muda dan/atau ahli Keselamatan Konstruksi muda dengan pengalaman paling singkat 3 (tiga) tahun dalam tiap Pekerjaan Konstruksi.", 40)}
OWNER_SETS = "Tingkat Risiko Keselamatan Konstruksi sebagaimana dimaksud pada ayat (1) ditetapkan oleh Pengguna Jasa sesuai dengan kriteria penentuan tingkat risiko Keselamatan Konstruksi sebagaimana tercantum dalam Lampiran yang merupakan bagian tidak terpisahkan dari Peraturan Menteri ini."


def _first(docs: list[dict], pattern: re.Pattern) -> dict | None:
    for d in docs:
        for n, page in enumerate(d["pages_text"], 1):
            if _contents(page):
                continue
            flat = _flat(page)
            m = pattern.search(flat)
            if m:
                return {"doc": d["id"], "title": d["title"], "page": n, "quote": _clause(flat, m.start(), m.end(), _ends(flat)), "match": m.group(0), "level": (m.group(1).lower() if m.groups() else "")}
    return None


def _rp(value: float, decimal: str = ".") -> str:
    return f"Rp {value / 1e9:.2f}".replace(".", decimal) + (" bn" if decimal == "." else " miliar")


WORTH = re.compile(r"senilai\s+Rp\.?\s*(\d{1,3}(?:\.\d{3})+)", re.I)


def said_value(docs: list[dict], project: str = "") -> float | None:
    """The owner's estimate where it is only said in a sentence, as in "senilai Rp80.000.000.000,00". A document can list several packages, so where it does, the one named most like this project, and none if that does not settle it."""
    found: list[tuple[str, float]] = []
    for d in docs:
        if d.get("kind") == "estimate":
            for page in d["pages_text"]:
                flat, last = _flat(page), 0
                for m in WORTH.finditer(flat):
                    found.append((flat[last:m.start()], float(m.group(1).replace(".", ""))))
                    last = m.end()
    if len(found) < 2:
        return found[0][1] if found else None
    words = lambda t: set(re.findall(r"[a-z0-9]{3,}", t.lower()))  # noqa: E731
    closest = sorted(((len(words(project) & words(before)), value) for before, value in found), reverse=True)
    return closest[0][1] if closest[0][0] > closest[1][0] else None


def safety_risk(value: float | None, from_owner: bool, docs: list[dict]) -> dict | None:
    """The level the package's own facts point to under Pasal 34, which the owner sets (ayat (2)): by value (ayat (3) to (5) huruf b) and lifting equipment (ayat (5) huruf d), and the higher where more than one applies (ayat (6)). The number of workers and the level of technology are not in a package, so they are not judged."""
    by_value = None if not value else "kecil" if value <= 10e9 else "sedang" if value <= 100e9 else "besar"
    lifting, stated = _first(docs, LIFTING), _first(docs, STATED)
    found = [x for x in (by_value, "besar" if lifting else None) if x]
    if not found:
        return None
    level = max(found, key=LEVELS.index)
    what = "the owner's estimate" if from_owner else "the priced BoQ"
    why, alasan = [], []
    if by_value:
        letter = {"kecil": "(3)", "sedang": "(4)", "besar": "(5)"}[by_value]
        why.append(f"{what} is {_rp(value)} (ayat {letter} huruf b)")
        alasan.append(f"{'nilai HPS' if from_owner else 'nilai Daftar Kuantitas dan Harga'} {_rp(value, ',')} (ayat {letter} huruf b)")
    if lifting:
        why.append(f"the documents name a {lifting['match'].lower()}, which is lifting equipment (ayat (5) huruf d): {lifting['title']}, page {lifting['page']}")
        alasan.append(f"dokumen menyebut {lifting['match'].lower()}, yaitu pesawat angkat (ayat (5) huruf d)")
    article, quote, ratio = STAFF[level]
    text = f"Safety risk level: by Permen PUPR 10/2021 Pasal 34 this job is {level}, because {'; and '.join(why)}. Where more than one criterion applies, the higher counts (ayat (6))."
    if by_value and by_value != level:
        text += f" By value alone it would be {by_value}."
    text += f" The owner sets the level (ayat (2)). It sets the safety staff: at least 1 to every {ratio} workers ({article}){', and a safety unit apart from the site team (Pasal 36 ayat (4))' if level != 'kecil' else ''}."
    agrees = bool(stated) and stated["level"] == level
    if stated:
        text += f" The documents say: “{stated['quote']}” ({stated['title']}, page {stated['page']})."
    question = None if agrees else {
        "subject": L.say("Construction safety risk level (Tingkat Risiko Keselamatan Konstruksi)", "Tingkat Risiko Keselamatan Konstruksi"), "to": L.say("The owner (Pengguna Jasa)", "Pengguna Jasa"),
        "question": L.say(f"Which construction safety risk level does the owner set for this job: small (kecil), medium (sedang) or large (besar)? By the criteria of Permen PUPR 10/2021 Pasal 34 it is {SIZE[level]} ({level}), because {'; and '.join(why)}.",
                          f"Tingkat Risiko Keselamatan Konstruksi mana yang ditetapkan Pengguna Jasa untuk pekerjaan ini: kecil, sedang, atau besar? Menurut kriteria Permen PUPR 10/2021 Pasal 34, pekerjaan ini termasuk risiko {level}: {'; '.join(alasan)}."),
        "impact": L.say("The level sets the construction safety staff (Pasal 38) and the safety unit (Pasal 36), which go into the RKK, approved at the pre-construction meeting (Pasal 21 ayat (5)).",
                        "Tingkat risiko menentukan personel keselamatan konstruksi (Pasal 38) dan unit keselamatan konstruksi (Pasal 36), yang dituangkan dalam RKK dan disahkan pada rapat persiapan pelaksanaan kontrak (Pasal 21 ayat (5)).")}
    return {"level": level, "by_value": by_value, "value": value, "lifting": lifting, "stated": stated, "agrees": agrees, "text": text, "question": question, "ratio": ratio,
            "rule": _rule(P10, article, quote), "owner_sets": _rule(P10, "Pasal 34 ayat (2)", OWNER_SETS)}


# ------------------------------------------------------------------------------------------------ work that needs a work permit: Pasal 26 and 27

# Pasal 26 ayat (2), in its own words, with the words a task's procedure uses for each. Found by the task's words, so it says so
SPECIAL = [("a", "pekerjaan panas/menimbulkan percikan api", "hot work, or work that throws sparks", r"\blas\b|pengelasan|mengelas|\bweld|(?<!debu )gerinda|grind|percikan api|api terbuka|blander|cutting torch|hot work"),
           ("b", "pekerjaan pengangkatan", "lifting", r"pengangkatan|izin angkat|\bcrane\b|hoist|kerekan|chain block|takel|pesawat angkat|lifting|rigging"),  # "angkat" alone is mostly two people carrying a panel
           ("c", "pekerjaan di ruang terbatas", "work in a confined space", r"ruang terbatas|ruang tertutup|confined space"),
           ("d", "pekerjaan menyelam", "diving", r"menyelam|penyelam|\bdiving\b"),
           ("e", "pekerjaan di malam hari", "night work", r"malam hari|pada malam|\bnight\b"),
           ("f", "pekerjaan di ketinggian lebih dari 1,80 (satu koma delapan puluh) meter", "work at height over 1.8 m", r"(?:di|dari) ketinggian|ketinggian lebih|jatuh (?:dari )?tepi|1[,.]8\d? ?m|sabuk (?:pengaman|keselamatan)|safety belt|harness|tali (?:pengaman|keselamatan)|lifeline|at height|from height"),
           ("g", "pekerjaan menggunakan perancah", "work on scaffolding", r"perancah|scaff?old|steiger"),
           ("h", "pekerjaan dengan menggunakan radiography", "radiography", r"radiogra"),
           ("i", "pekerjaan bertegangan listrik", "live electrical work", r"bertegangan|tegangan listrik|tegangan (?:tinggi|menengah)|listrik hidup|beban penuh|energi[sz]"),
           ("j", "pekerjaan penggalian atau kedalaman", "excavation or work in depth", r"penggalian|menggali|\bgali\b|excavat|trench")]  # "galian" alone may only say where the work is, so it counts in a task's name: see permit_for
_SPECIAL = [(letter, local, en, re.compile(words, re.I)) for letter, local, en, words in SPECIAL]
PERMIT = _rule(P10, "Pasal 26 ayat (2) dan Pasal 27", "Dalam tahap pelaksanaan pekerjaan konstruksi, Rencana metode pelaksanaan kerja, AKK serta rencana pemeriksaan dan pengujian merupakan komponen yang digunakan sebagai bagian dari persyaratan izin kerja.")
PLANNER = ("Work that Permen PUPR 10/2021 Pasal 26 ayat (2) calls special needs a work permit before it starts, and Pasal 27 makes its method statement, safety analysis (AKK) and inspection plan part of that permit: "
           "hot work or work that throws sparks, lifting, work in a confined space, diving, night work, work at height over 1.8 m, work on scaffolding, radiography, live electrical work, and excavation. For such a task, the first step of its procedure is to get that permit.")


NOT = re.compile(r"(?:(?:jangan|hindari|jauhkan|dilarang|tidak boleh|tanpa|bebas dari|avoid|keep away|never|\bno)\b[^.;,]{0,25}|\btidak\b[^.;,]{0,6})$", re.I)  # "jangan ada api terbuka" is a precaution, not hot work, and "pastikan tidak bertegangan" is not live work


def special(*texts: str) -> list[dict]:
    """Which kinds of special work a task's own words show it to be. A word in a precaution against it does not count."""
    said = " ".join(t for t in texts if t)
    return [{"letter": letter, "local": local, "what": en} for letter, local, en, pattern in _SPECIAL if any(not NOT.search(said[max(0, m.start() - 40):m.start()]) for m in pattern.finditer(said))]


WARNING_SHOWS, ON_THE_TOOLS, A_CHECK_CAN_BE = set("cdhi"), set("afg"), set("chi")
GETS_THE_PERMIT = re.compile(r"^(?:urus|ajukan|dapatkan|minta|siapkan|lakukan|buat)\b.*(?:i[zj]in kerja|analisis keselamatan|\bJSA\b|\bAKK\b)", re.I)
BRINGS = re.compile(r"^(?:datangkan|terima|simpan)\b", re.I)


def permit_for(kind: str, name: str, steps: str, equipment: str, safety: str) -> list[dict]:
    """Which special work a task is. What it does decides: its name, steps and equipment. A safety note warns of a hazard that may only be nearby, so it counts only where the warning shows the work itself: sparks, a fall or a scaffold on a task that does the work, and live electrics, a confined space, diving or radiography on any. A check looks at work with a permit of its own, unless it is itself a live test, radiography or in a confined space. A task that gets the permit does not need one first."""
    if GETS_THE_PERMIT.search(name):
        return []
    works = kind == "operation" and not BRINGS.search(name)
    found = {x["letter"] for x in special(name, steps, equipment)} | ({"j"} if works and re.search(r"\bgalian\b", name, re.I) else set())
    found |= {x["letter"] for x in special(safety)} & (WARNING_SHOWS | (ON_THE_TOOLS if works else set()))
    if kind == "inspection":
        found &= A_CHECK_CAN_BE
    return [{"letter": letter, "local": local, "what": en} for letter, local, en, _ in _SPECIAL if letter in found]


# ------------------------------------------------------------------------------------------------ what must be done, and when

# key, when, what, the words a document uses for it, the regulation, and whether its number of days is the point
OBLIGATIONS = [
    ("pcm", "before", "Pre-construction meeting (rapat persiapan pelaksanaan kontrak)", r"rapat persiapan pelaksanaan|pre[- ]?construction meeting|\bPCM\b",
     _rule(P10, "Pasal 21 ayat (5)", "RKK yang telah dinilai sebagaimana dimaksud ayat (1) harus dilengkapi dan disahkan pada saat rapat persiapan pelaksanaan kontrak."), True),
    ("plans", "before", "Safety, quality, environment and traffic plans approved (RKK, RMPK, RKPPL, RMLLP)", r"rencana keselamatan konstruksi|\bRKK\b|\bRMPK\b|rencana mutu|program mutu|\bRK3K\b",
     _rule(P10, "Pasal 24 ayat (4)", "RKK yang berupa RKK pelaksanaan, RMPK, Program Mutu, RKPPL, dan RMLLP yang telah diperiksa, dibahas, atau direviu sebagaimana dimaksud pada ayat (3) disetujui oleh Konsultan Manajemen Konstruksi dan/atau Pengguna Jasa dan Penyedia Jasa pada saat rapat persiapan pelaksanaan Pekerjaan Konstruksi."), False),
    ("mc0", "before", "Joint measurement of the site (mutual check 0%)", r"mutual check|\bMC[- ]?0\b|pemeriksaan bersama",
     _rule(P14, "Lampiran III, Syarat-Syarat Umum Kontrak 25.1", "Pada tahap awal pelaksanaan Kontrak, Pengguna Jasa dan Pengawas Pekerjaan bersama-sama dengan Penyedia melakukan pengukuran dan pemeriksaan detail terhadap kondisi lokasi pekerjaan untuk setiap rencana mata pembayaran, Tenaga Kerja Konstruksi, dan Peralatan Utama (Mutual Check 0%)."), True),
    ("staff", "before", "Safety staff for the safety risk level", r"ahli k3|petugas k3|ahli keselamatan|petugas keselamatan", None, False),
    ("permits", "before", "A work permit before any special work, with its method statement, safety analysis (AKK) and inspection plan", r"izin kerja|ijin kerja|work permit|permit to work", PERMIT, False),
    ("skk", "before", "Every construction worker certified (Sertifikat Kompetensi Kerja)", r"sertifikat kompetensi kerja",
     _rule("uu-2-2017", "Pasal 70 ayat (1) dan (2)", "(1) Setiap tenaga kerja konstruksi yang bekerja di bidang Jasa Konstruksi wajib memiliki Sertifikat Kompetensi Kerja. (2) Setiap Pengguna Jasa dan/atau Penyedia Jasa wajib mempekerjakan tenaga kerja konstruksi yang memiliki Sertifikat Kompetensi Kerja sebagaimana dimaksud pada ayat (1)."), False),
    ("insurance", "before", "The insurance the contract asks for", r"contractor'?s? all risk|asuransi (?:pekerjaan|konstruksi|tenaga kerja|bangunan|pihak ketiga|kecelakaan)|BPJS", None, True),
    ("reports", "during", "Daily, weekly, monthly and final reports, with photographs", r"laporan harian|laporan mingguan|laporan bulanan",
     _rule(P10, "Pasal 28 ayat (1) sampai (3)", "(1) Penyedia Jasa Pelaksana Konstruksi melaporkan pelaksanaan RKK, RMPK, Program Mutu, RKPPL, dan RMLLP sebagaimana dimaksud dalam Pasal 24 ayat (1) kepada Pengguna Jasa sesuai dengan kemajuan pekerjaan. (2) Laporan sebagaimana dimaksud pada ayat (1) berupa laporan: a. harian; b. mingguan; c. bulanan; dan d. akhir. (3) Laporan sebagaimana dimaksud pada ayat (2) dilengkapi dengan dokumentasi foto dan/atau audio visual."), False),
    ("critical", "during", "When the contract becomes critical", r"kontrak dinyatakan kritis|kontrak kritis apabila|show cause meeting",
     _rule(P14, "Lampiran III, Syarat-Syarat Umum Kontrak 31.2", "Kontrak dinyatakan kritis apabila: a. Dalam periode I (rencana fisik pelaksanaan 0% - 70% dari Kontrak), selisih keterlambatan antara realisasi fisik pelaksanaan dengan rencana lebih besar 10% b. Dalam periode II (rencana fisik pelaksanaan 70% - 100% dari Kontrak), selisih keterlambatan antara realisasi fisik pelaksanaan dengan rencana lebih besar 5%; …"), False),
    ("penalty", "during", "The penalty for finishing late", r"denda[^.]{0,60}?keterlambatan[^.]{0,160}?(?:per ?seribu|o/oo|‰|1/1000)",
     _rule(P14, "Lampiran III, Denda dan Ganti Rugi", "Besarnya denda keterlambatan yang dikenakan kepada Penyedia atas keterlambatan penyelesaian pekerjaan adalah: 1) 1‰ (satu perseribu) dari harga bagian Kontrak yang tercantum dalam Kontrak (sebelum PPN); atau 2) 1‰ (satu perseribu) dari Harga Kontrak (sebelum PPN);"), False),
    ("pho", "handover", "The safety documents go with the first handover record (berita acara serah terima pertama)", r"serah terima pertama|provisional hand ?over|\bPHO\b",
     _rule(P10, "Pasal 30 ayat (4)", "Dokumen hasil penerapan SMKK sebagaimana dimaksud pada ayat (2) disampaikan kepada Pengguna Jasa dan menjadi bagian yang tidak terpisahkan dalam berita acara serah terima pertama pekerjaan."), False),
    ("maintenance", "handover", "The maintenance period", r"masa pemeliharaan",
     _rule(P14, "Lampiran III, Syarat-Syarat Umum Kontrak 33.8", "Masa Pemeliharaan paling singkat untuk pekerjaan permanen selama 6 (enam) bulan, sedangkan untuk pekerjaan semi permanen selama 3 (tiga) bulan dan dapat melampaui Tahun Anggaran."), True),
    ("asbuilt", "handover", "As-built drawings and the operation and maintenance manuals", r"as[- ]?built|gambar terlaksana",
     _rule(P14, "Lampiran III, Syarat-Syarat Umum Kontrak 35.1", "Penyedia diwajibkan menyerahkan kepada Pengguna Jasa Gambar As-built dan pedoman pengoperasian dan perawatan/pemeliharaan sesuai dengan SSKK."), True),
]


def _clauses(docs: list[dict], pattern: re.Pattern, timed: bool) -> list[dict]:
    """In each document, the first sentence about it. Where its timing is the point, the first that gives a number of days, if any does."""
    out = []
    for d in docs:
        best = None
        for n, page in enumerate(d["pages_text"], 1):
            if _contents(page):
                continue
            flat = _flat(page)
            ends = _ends(flat)
            for m in pattern.finditer(flat):
                quote = _clause(flat, m.start(), m.end(), ends)
                days = DAYS.search(quote) if timed else None
                best = best or {"doc": d["id"], "title": d["title"], "page": n, "quote": quote, "days": None, "unit": None}
                if days:
                    best = {**best, "page": n, "quote": quote, "days": int(days.group(1)), "unit": " ".join(days.group(2).lower().split())}
                    break
                if not timed:
                    break
            if best and (not timed or best["days"] is not None):
                break
        if best:
            out.append(best)
    return out


def _disagree(what: str, found: list[dict]) -> str:
    """Where two documents give the same thing a different number of days, or count them differently: working days against calendar days."""
    given = [f for f in found if f["days"] is not None]
    numbers = {(f["days"], f["unit"]) for f in given if f["unit"] != "bulan"} | {(f["days"] * 30, "hari") for f in given if f["unit"] == "bulan"}
    kinds = {f["unit"] for f in given if f["unit"] in ("hari kerja", "hari kalender")}
    if len({n for n, _ in numbers}) < 2 and len(kinds) < 2:
        return ""
    sides = "; ".join(f"{f['title']}, page {f['page']}: {f['days']} {f['unit']}" for f in given[:3])
    return f"The documents give {what[0].lower() + what[1:]} differently: {sides}. The contract's order of precedence decides which holds: settle it before pricing the work."


def obligations(docs: list[dict], risk: dict | None = None) -> list[dict]:
    """What must be done before work starts, while it runs and at handover: each with the clauses that say so in this package, the regulation behind it, and where the documents disagree."""
    out = []
    for key, phase, what, words, rule, timed in OBLIGATIONS:
        found = _clauses(docs, re.compile(words, re.I), timed)
        note = ""
        if key == "staff":
            rule = risk["rule"] if risk else _rule(P10, "Pasal 34 ayat (2)", OWNER_SETS)
            note = f"By Pasal 34 this job is {risk['level']}, which the owner has to confirm: at least 1 safety officer to every {risk['ratio']} workers." if risk else "The owner sets the safety risk level, and the staff follow from it."
        out.append({"key": key, "phase": phase, "what": what, "found": found[:3] if timed else found[:1], "rule": rule, "note": note, "conflict": _disagree(what, found)})  # where its timing is the point, each document's word on it, so a person sees where they differ
    return out

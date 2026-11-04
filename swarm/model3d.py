"""The building through time, for the 3D timeline: what gets built when, so a contractor can see the order of the work.

Code builds it from what it can read, and says what it had to assume:

    the floors   from the WBS: Lantai Basement, Lantai 01, Lantai Atap and the like
    each part    what each work package builds, from its name, and when, from the master schedule's dates
    the size     from the drawings' own grid and floor levels, where their text gives them

It is a picture of the order of the work, not a BIM model: the building is a box on the drawings' grid, and each kind of work is drawn the same way on every project. The screen says so.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import date

from . import modules as M, package as K, project as P

STOREY = 4.0  # metres from floor to floor, where the drawings read do not say
BASEMENT = 3.5
DEFAULT = (30.0, 18.0, 6.0)  # width, depth and bay in metres, where the drawings give no grid

LEVEL = re.compile(r"\b(?:lantai|level|lt\.?|floor|storey)\s*(semi[\s-]*basement|basement|ground|dasar|atap|roof|\d{1,2})\b", re.I)
GROUND_PART = re.compile(r"\b(?:tie beam|sloof|kolom|balok|plat|pelat|tangga|beton)\b[^,;]*\bground\b(?! water)", re.I)
EARTH_FIRST = r"^\s*(?:galian|urugan|timbunan|tanah\b|excavat)"  # a name that starts by digging is digging, whatever it digs for: "galian tanah pilecap" is not yet a pile cap
SPECIFIC = [("tank", r"ground water tank|\bgwt\b|tangki air|reservoir|tandon"), ("stp", r"\bstp\b|septic|\bipal\b|sewage"), ("lift", r"\blift\b|elevator|separator"),
            ("canopy", r"kanopi|canopy"), ("catwalk", r"cat ?walk"), ("entrance", r"\bramp\b|\bentrance\b|tangga (?:masuk|depan|luar)")]
STRUCTURE = r"beton|struktur|kolom|balok|pelat|\bplat\b|tangga|tie beam|sloof|retaining|concrete|column|beam|slab|rebar|formwork|bekisting|pembesian"
KINDS = [("earthworks", EARTH_FIRST),
         ("roof", r"\batap\b|\broof|genteng|rangka atap|baja ringan"),
         ("joint", r"dilatasi|expansion joint"),
         ("foundation", r"pondasi|fondasi|bore ?pile|bor ?pile|tiang pancang|square pile|spun pile|pile ?cap|anti rayap|struktur bawah|foundation|\bpiling|\bpiles?\b"),
         ("earthworks", r"galian|urugan|timbunan|tanah|lantai kerja|excavat|earthwork|cut and fill"),
         ("services", r"mekanikal.*elektrikal|elektrikal.*mekanikal|mechanical.*electrical|electrical.*mechanical"),  # the two named as one package
         ("electrical", r"elektrikal|electrical|listrik|kabel|cable|\blan\b|cctv|alarm|petir|lightning|solar|tata suara|sound|proyektor|projector|telepon|telephone|penerangan|lampu|genset|trafo|elektronika|panel (?:distribusi|listrik|daya)"),
         ("mechanical", r"mekanikal|mechanical|plambing|plumbing|pompa|pump|kebakaran|fire protection|\bapar\b|hydrant|sprinkler|tata udara|hvac|\bac\b|air condition|exhaust|ventilasi|air bersih|air kotor|\bmep\b|\bm&e\b|first fix|second fix"),
         ("facade", r"fasade|facade|\bgrc\b|\bacp\b|curtain ?wall|secondary skin|kisi"),
         ("openings", r"pintu|jendela|kusen|kaca|door|window|glazing"),
         ("interior", r"finishing|keramik|granit|homogeneous|plafon|plafond|ceiling|pengecatan|\bcat\b|paint|partisi|partition|interior|saniter|sanitair|sanitary|railing|floor finish|tiling"),
         ("walls", r"pasangan|plesteran|dinding|bata|beton praktis|masonry|blockwork|wall"),
         ("external", r"saluran|drainase|vegetasi|lansekap|landscap|hardscape|softscape|pagar|fence|paving|taman|halaman|parkir"),
         ("site", r"persiapan|mobilisasi|smkk|rk3k|\bk3\b|keselamatan|direksi keet|papan nama|pembersihan|bowplank|pengukuran|land clear|site office|preliminar|crane|alat pelindung")]
LIFT_PHRASE = re.compile(r"(?:(?:balok|dinding|kolom|plat|pelat)\s+)?(?:beton\s+)?(?:(?:separator|pit)\s+)?\b(?:lift|elevator)s?\b", re.I)
OTHER_PARTS = re.compile(f"{STRUCTURE}|pondasi|fondasi|pile ?cap|galian|urugan|tanah|lantai kerja", re.I)  # what a lumped name may list beside the lift
ARCHITECTURE = re.compile(r"\barsitektur\b|\barchitectur", re.I)
FRAME, COVER = re.compile(r"kuda-kuda|rangka|truss|\bwf\b|baja ringan", re.I), re.compile(r"genteng|penutup|spandek|spandex|metal roof|atap metal|roof tile|\bseng\b|membran|waterproof", re.I)
PITCHED = re.compile(r"genteng|penutup atap|rangka atap|baja ringan|kuda-kuda|pitched roof|roof tile", re.I)
BORED, DRIVEN = re.compile(r"bored? ?pile|bor ?pile|tiang bor|strauss", re.I), re.compile(r"pancang|spun pile|square pile|driven pile|mini ?pile", re.I)
TOWER, MOBILE = re.compile(r"tower crane(?!\s*/\s*mobil)", re.I), re.compile(r"(?<!/)(?<!/ )\bmobil(?:e)? crane", re.I)  # "Tower Crane/Mobil Crane" allows either, so it names neither
LIFT = re.compile(r"(?<!lubang )\b(?:lift|elevator)s?\b(?! (?:the|it|them|up|off|into|and lower))", re.I)  # a building's lift, not "lubang lift" in a safety clause nor lifting a load
SERVICES = re.compile(r"mekanikal|mechanical|elektrikal|electrical|plambing|plumbing", re.I)  # a services package that names a tank fits it out, it does not build it


def level_of(text: str) -> tuple[str | int | None, str]:
    """The floor a name points to, as "basement", "ground", "roof" or a number, and how the name writes it."""
    m = LEVEL.search(text or "")
    if not m:
        return ("ground", "Lantai Ground") if GROUND_PART.search(text or "") else (None, "")
    word = m.group(1).lower()
    key: str | int = "basement" if "basement" in word else "ground" if word in ("ground", "dasar") else "roof" if word in ("atap", "roof") else int(word)
    return key, " ".join(m.group(0).split()).title()


def _about_the_lift_alone(text: str) -> bool:
    """Whether a name is about the lift and nothing else. A lumped name that also lists pile caps, a slab or stairs is about those, with the lift's part among them."""
    return not OTHER_PARTS.search(LIFT_PHRASE.sub(" ", text))


def classify(name: str, account: str = "") -> tuple[str, str | int | None, str]:
    """What a work package builds, and on which floor. Its own words decide first, as "Elektrikal: CCTV" is the CCTV, then its control account's."""
    level, label = level_of(f"{account} {name}")
    services = bool(SERVICES.search(f"{account} {name.split(':', 1)[0] if ':' in name else ''}"))
    for text in (name.rsplit(":", 1)[-1], name, f"{account} {name}"):
        t = text.lower()
        for kind, words in SPECIFIC:
            if services and kind in ("tank", "stp"):
                continue
            if kind == "lift" and not _about_the_lift_alone(t):
                continue
            if kind == "entrance" and re.search(EARTH_FIRST, t):
                continue
            if re.search(words, t):
                return kind, level, label
        if level is not None and (re.search(STRUCTURE, t) or t.strip() == label.lower()):  # "Lantai Atap" alone is the roof's floor slab, not its covering
            return "structure", level, label
        for kind, words in KINDS:
            if re.search(words, t):
                return kind, level, label
    if ARCHITECTURE.search(name):  # one package for all of it, as a contract may list it with no detail
        return "architecture", level, label
    return ("structure", level, label) if level is not None else ("other", None, "")


def storeys(levels: dict, basement: float, height: float = STOREY) -> tuple[list[dict], dict]:
    """The floors, from the levels the structure's work packages name. A building numbered from 1 starts at 1 on the ground, and one with a ground floor starts there. A floor below the lowest the WBS names was there before the plan, and is drawn so."""
    numbers = sorted(k for k in levels if isinstance(k, int))
    base = 0 if "ground" in levels or (numbers and numbers[0] == 0) else 1
    index: dict = {n: n - base for n in numbers}
    if "ground" in levels:
        index["ground"] = 0
    if "basement" in levels:
        index["basement"] = -1
    names = {i: levels[k] for k, i in index.items()}
    top = max([i for i in index.values()] + [0]) + 1
    if "roof" in levels:
        index["roof"] = top
    floors = []
    for i in range((-1 if "basement" in index else 0), top):
        floors.append({"index": i, "name": names.get(i) or ("Basement" if i < 0 else f"Floor {i + base}"), "elevation": round(-basement if i < 0 else i * height, 2), "height": round(basement if i < 0 else height, 2), "planned": i in names})
    return floors, index


# ------------------------------------------------------------------------------------------------ the size, from the drawings


def _grid(text: str) -> dict | None:
    """A grid of column lines from the dimensions on a plan: the bay that repeats, and the spans that are whole numbers of it. 28000 and 21000 on 7000 bays is a 28 by 21 metre grid."""
    numbers = [int(x) for x in re.findall(r"(?<![\d.,-])(\d{4,6})(?![\d.,])", text or "")]
    bays = Counter(n for n in numbers if 2500 <= n <= 12_000)
    if not bays:
        return None
    bay, count = bays.most_common(1)[0]
    spans = sorted({n for n in numbers if n % bay == 0 and 2 <= n // bay <= 30}, reverse=True)
    if count < 3 or not spans:
        return None
    return {"bay": bay / 1000, "width": spans[0] / 1000, "depth": spans[1] / 1000 if len(spans) > 1 else None, "count": count, "spans": spans[:2]}


def _areas(text: str) -> dict | None:
    """A table of floor areas, read only if one figure is the sum of the others: then it is the total, and they are the floors."""
    found = [float(x.replace(".", "").replace(",", ".")) for x in re.findall(r"(\d{1,3}(?:\.\d{3})*,\d{2})\s*M2\b", text or "", re.I)]
    for total in sorted(set(found), reverse=True):
        rest = list(found)
        rest.remove(total)
        if len(rest) >= 2 and abs(sum(rest) - total) <= 1:
            return {"total": total, "floors": rest}
    return None


def from_drawings() -> dict:
    """What the drawings' text says of the building's size: its grid, its lowest floor level, and its floor areas. Each with where it says so."""
    out: dict = {"read": []}
    grid, lows, areas = None, Counter(), None
    for d in K.uploads():
        if d.get("kind") != "drawing" or d.get("use") is False:
            continue
        for n, page in enumerate(K.pages_of(d["id"]), 1):
            g = _grid(page)
            if g and (not grid or g["count"] > grid["count"]):
                grid = {**g, "title": d["title"], "doc": d["id"], "page": n}
            for x in re.findall(r"(?<![\d.,])-(\d{1,2}[.,]\d{2,3})(?!\d)", page):
                if 1.5 <= float(x.replace(",", ".")) <= 12:
                    lows[(float(x.replace(",", ".")), d["title"], d["id"], n)] += 1
            areas = areas or (lambda a: a and {**a, "title": d["title"], "doc": d["id"], "page": n})(_areas(page))
    if grid:
        out.update(width=grid["width"], depth=grid["depth"], bay=grid["bay"])
        b = grid["bay"]
        out["read"].append({"what": f"Grid of {b:g} m bays, {grid['width']:g} by {grid['depth']:g} m" if grid["depth"] else f"Grid of {b:g} m bays, {grid['width']:g} m long", "title": grid["title"], "doc": grid["doc"], "page": grid["page"],
                            "words": " and ".join(f"{s:,} = {s // int(b * 1000)} × {int(b * 1000):,}" for s in grid["spans"])})
    if lows:
        (level, title, doc, page), _ = lows.most_common(1)[0]
        out["basement_depth"] = level
        out["read"].append({"what": f"Lowest floor at −{level:g} m", "title": title, "doc": doc, "page": page, "words": f"-{level:.3f}"})
    if areas:
        out["areas"] = areas["floors"]
        out["read"].append({"what": f"{len(areas['floors'])} floors adding up to {areas['total']:,.2f} m²", "title": areas["title"], "doc": areas["doc"], "page": areas["page"], "words": f"total {areas['total']:,.2f} m²"})
    return out


def _roof() -> str:
    """Pitched where the documents speak of roof tiles or a roof frame, and flat otherwise."""
    for d in K.uploads():
        if d.get("use") is not False and d.get("kind") in ("spec", "scope", "boq", "drawing"):
            if any(PITCHED.search(p) for p in K.pages_of(d["id"])):
                return "pitched"
    return "flat"


def pile_method(texts: list[str]) -> str:
    """Bored or driven, whichever the words name more often. Empty where they name neither."""
    bored, driven = sum(len(BORED.findall(t or "")) for t in texts), sum(len(DRIVEN.findall(t or "")) for t in texts)
    return "bored" if bored > driven else "driven" if driven > bored else ""


def crane_kind(*sources: list[str]) -> str:
    """Which crane the words name, from the first source that says: a tower crane, a mobile one, or none where they name neither or only allow either."""
    for texts in sources:
        tower, mobile = sum(len(TOWER.findall(t or "")) for t in texts), sum(len(MOBILE.findall(t or "")) for t in texts)
        if tower != mobile:
            return "tower" if tower > mobile else "mobile"
    return ""


def roof_covered(names: list[str]) -> bool:
    """Whether the roof's work covers it. Not where every package names only the frame: "Kuda-kuda Atap" says nothing of tiles. A bare "Beton: Atap" is not taken to leave them out."""
    return not names or any(COVER.search(n) or not FRAME.search(n) for n in names)


def lift_source(rows: list[dict]) -> str:
    """Where the plan or the documents name a lift for the building: a work package first, then the BoQ, specification, contract, drawings or scope. Empty where none does."""
    for w in rows:
        if LIFT.search(w["name"]):
            return f'the work package "{w["name"][:60]}{"…" if len(w["name"]) > 60 else ""}"'
    for d in K.uploads():
        if d.get("use") is not False and d.get("kind") in ("boq", "spec", "contract", "drawing", "scope"):
            for n, page in enumerate(K.pages_of(d["id"]), 1):
                if LIFT.search(page or ""):
                    return f"{d['title']}, page {n}"
    return ""


def _pages(kinds: tuple[str, ...] | None = None) -> list[str]:
    """The text of the documents in use, of the kinds asked for."""
    return [p for d in K.uploads() if d.get("use") is not False and (kinds is None or d.get("kind") in kinds) for p in K.pages_of(d["id"])]


# ------------------------------------------------------------------------------------------------ the model


def summary(m: dict) -> tuple[str, list[dict]]:
    """What the 3D timeline made of a plan, as the swarm's last stage says it: its note, and the checks that go on the plan. Work it cannot place on the building is named, and so is what the plan does not build, so an unfinished building is read for what it is."""
    els = m.get("elements") or []
    if not els:
        return "No work packages to build", []
    unplaced = [e for e in els if e["kind"] == "other"]
    floors = len([f for f in m.get("storeys") or [] if f.get("planned")])
    checks = [{"rule": "model3d_absent", "ok": False, "text": f"The 3D timeline ends with the building {'not ready to use' if set(m['absent']) - {'a façade'} else 'without a façade'}: the plan has no work for {', '.join(m['absent'][:-1]) + ' or ' + m['absent'][-1] if len(m['absent']) > 1 else m['absent'][0]}. That work is not in the documents as read, or not in this contract."}] if m.get("absent") else []
    if unplaced:
        checks.append({"rule": "model3d_unplaced", "ok": False, "text": f"The 3D timeline could not tell what {len(unplaced)} work package{'' if len(unplaced) == 1 else 's'} build{'s' if len(unplaced) == 1 else ''}, so {'it is' if len(unplaced) == 1 else 'they are'} listed but not drawn: {', '.join(e['code'] + ' ' + e['name'] for e in unplaced[:6])}{' and more' if len(unplaced) > 6 else ''}."})
    checks += [{"rule": "model3d_assumed", "ok": False, "text": f"3D timeline: {a}"} for a in m.get("assumed") or [] if "placeholder" in a or "assumed" in a]
    return f"{len(els) - len(unplaced)} of {len(els)} work packages placed on {floors} floor{'' if floors == 1 else 's'}, over {m['days']} days{'. Not built: ' + ', '.join(m['absent']) if m.get('absent') else ''}", checks


def build() -> dict:
    """Each work package, what it builds and on which floor, from which day to which; the floors; and the building's size, with where each came from."""
    rows = M.work_packages()["packages"]
    plan = M.live_plan()
    head = {"plan": {k: plan[k] for k in ("id", "title", "status", "mode")} if plan else None, "today": P.TODAY}
    if not rows:
        return {**head, "elements": [], "storeys": [], "days": 0}
    first = min(date.fromisoformat(w["start"]) for w in rows)
    last = max(date.fromisoformat(w["finish"]) for w in rows)
    elements, levels = [], {}
    for w in rows:
        kind, level, label = classify(w["name"], w.get("account_name") or "")
        if kind == "structure" and level is not None:
            levels.setdefault(level, label)
        start, finish = date.fromisoformat(w["start"]), date.fromisoformat(w["finish"])
        elements.append({"id": w["id"], "code": w["code"], "no": w.get("no", ""), "name": w["name"], "account": w.get("account_name", ""), "kind": kind, "level_key": level,
                         "start": (start - first).days, "end": (finish - first).days + 1, "start_date": w["start"], "finish_date": w["finish"], "critical": bool(w.get("critical")), "float_days": w.get("float_days", 0)})
    size = from_drawings()
    assumed = []
    if "width" not in size:
        floor_area = sorted(size.get("areas") or [])[len(size.get("areas") or []) // 2] if size.get("areas") else None
        if floor_area:
            width = round((floor_area * 4 / 3) ** 0.5, 1)
            size.update(width=width, depth=round(floor_area / width, 1), bay=DEFAULT[2])
            assumed.append(f"The footprint is {size['width']:g} by {size['depth']:g} m, a 4:3 box of the typical floor area: the drawings read give no grid.")
        else:
            size.update(width=DEFAULT[0], depth=DEFAULT[1], bay=DEFAULT[2])
            assumed.append(f"The footprint is a {DEFAULT[0]:g} by {DEFAULT[1]:g} m placeholder on {DEFAULT[2]:g} m bays: the drawings read give no grid or floor areas.")
    if size.get("depth") is None:
        size["depth"] = max(2, round(size["width"] * 0.6 / size["bay"])) * size["bay"]
        assumed.append(f"The depth, {size['depth']:g} m, is assumed: the drawings read give only the length.")
    basement = size.get("basement_depth") or BASEMENT
    if "basement" in levels and not size.get("basement_depth"):
        assumed.append(f"The basement is {BASEMENT:g} m deep: the drawings read give no floor level below ground.")
    if not levels:
        n = len([a for a in size.get("areas") or []]) or 2
        levels = {i + 1: f"Floor {i + 1}" for i in range(n)}
        assumed.append(f"The WBS names no floors, so the building has {n}, {'one for each floor area on the drawings' if size.get('areas') else 'as a placeholder'}.")
    floors, index = storeys(levels, basement)
    assumed.append(f"Floor to floor is {STOREY:g} m: the drawings read give no storey height.")
    numbers = sorted(k for k in levels if isinstance(k, int))
    base = 0 if "ground" in levels or (numbers and numbers[0] == 0) else 1
    top = max(f["index"] for f in floors) + 1
    for e in elements:  # work named for a floor goes on that floor, numbered as the structure numbers it
        key = e.pop("level_key")
        e["level"] = index[key] if key in index else key - base if isinstance(key, int) and 0 <= key - base < top else 0 if key == "ground" else None
    roof = _roof()
    named = [w["name"] for w in rows if classify(w["name"], w.get("account_name") or "")[0] == "foundation"]
    pile = pile_method(named) or pile_method(_pages(("spec", "scope", "boq", "drawing")))
    crane = crane_kind([w["name"] for w in rows], _pages(("boq",)), _pages())  # what is hired and priced says more than a list of what is allowed
    lift = lift_source(rows)
    if len(floors) > 1:
        assumed.append(f"Two stairs, one at each end{', and the lift beside the first' if lift else ''}: where they stand is assumed, as the drawings read do not show it." + (f" There is a lift because {lift} names one." if lift else ""))
    built = {e["kind"] for e in elements}
    covered = roof_covered([e["name"] for e in elements if e["kind"] == "roof"])
    if "architecture" in built:
        built |= {"openings", "interior"}
        names = [e["name"] for e in elements if e["kind"] == "architecture"]
        assumed.append(f'{"One package" if len(names) == 1 else f"{len(names)} packages"}, "{names[0][:40]}"{" and others" if len(names) > 1 else ""}, name{"s" if len(names) == 1 else ""} architecture only in general, so what {"it builds" if len(names) == 1 else "they build"} is drawn schematically, in an assumed order over {"its" if len(names) == 1 else "their"} dates.')
    absent = [label for kind, label in (("roof", "a roof"), ("openings", "windows and doors"), ("facade", "a façade"), ("interior", "finishes")) if kind not in built] + ([] if covered or "roof" not in built else ["a roof covering"])
    return {**head, "absent": absent, "start": first.isoformat(), "finish": last.isoformat(), "days": (last - first).days + 1, "width": size["width"], "depth": size["depth"], "bay": size["bay"],
            "basement_depth": basement if any(f["index"] < 0 for f in floors) else 0, "storey_height": STOREY, "storeys": floors, "top": max(f["elevation"] + f["height"] for f in floors),
            "roof": roof, "roof_covered": covered, "pile": pile, "crane": crane, "lift": bool(lift),
            "elements": elements, "read": size["read"], "assumed": assumed}

"""One comprehensive, fictional case: a monthly progress claim with known problems planted in it.

Every project, company, quantity and price here is invented (see PROVENANCE.md). Daily logs are free text, as on a real
site: one entry can cover several items, some entries are deliveries or plans and do not count, and a removal takes work
back. The true readings and the answer key go to a folder no agent tool reads. Run `python -m swarm.generator` to write
data/project/.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .scenes import SCENES

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "project"

PROJECT = {
    "name": "Harbor Point Block B (fictional)",
    "contractor": "PT Contoh Karya (fictional)",
    "owner": "Harbor Point Owner Co. (fictional)",
    "region": "Region 3",
    "claim_no": 7,
    "period_start": "2026-09-01",
    "cutoff": "2026-09-30",
    "currency": "IDR",
    "notice": "Synthetic data. No real project, company or person.",
}


@dataclass(frozen=True)
class Line:
    code: str
    name: str
    area: str
    unit: str
    qty: int
    price: int
    actual: int  # true progress %, shown by the photo and, unless log_pct is set, by the daily log
    claimed: int
    planned: int
    expected: str  # the status a correct review reaches
    scenario: str
    photo: str = "count"  # count: elements can be counted | concealed: only a finished surface | blocked: scaffold net in the way | none: no photo
    cells: int | None = None  # elements drawn in the photo, when the quantity is too large to draw one by one
    log_pct: int | None = None  # the log disagrees with the photo
    stale: bool = False  # the latest photo and log entry are too old to show the current state
    claim_price: int | None = None  # the claim uses another unit price than the BoQ
    amount_error: int = 0  # a typing error in the claimed amount
    earlier_photo_pct: int | None = None  # an older photo of the same item, which must not be used
    custom_log: bool = False  # its log entries are written by hand in CUSTOM_LOGS


LINES = [
    Line("ST-01", "Columns, Level 2", "Level 2", "unit", 24, 18_500_000, 100, 100, 100, "supported", "clean"),
    Line("ST-02", "Beams, Level 2", "Level 2", "unit", 36, 9_800_000, 100, 100, 100, "supported", "clean"),
    Line("ST-03", "Columns, Level 3", "Level 3", "unit", 20, 18_500_000, 60, 80, 80, "weak_evidence", "over_claim_with_older_photo", earlier_photo_pct=45, custom_log=True),
    Line("ST-04", "Beams, Level 3", "Level 3", "unit", 30, 9_800_000, 50, 50, 70, "supported", "behind_plan_but_honest", custom_log=True),
    Line("ST-05", "Slab bays, Level 3", "Level 3", "bay", 12, 145_000_000, 50, 75, 60, "weak_evidence", "over_claim"),
    Line("ST-06", "Slab rebar, Level 3", "Level 3", "kg", 18_000, 17_500, 60, 60, 60, "needs_inspection", "concealed", photo="concealed"),
    Line("ST-07", "Concrete volume, Level 3", "Level 3", "m3", 240, 1_250_000, 50, 50, 55, "needs_inspection", "volume_not_measurable", photo="concealed"),
    Line("AR-01", "Brick wall bays, Level 1", "Level 1", "bay", 40, 8_500_000, 100, 60, 80, "unbilled", "unbilled"),
    Line("AR-02", "Brick wall bays, Level 2", "Level 2", "bay", 40, 8_500_000, 65, 65, 70, "supported", "clean"),
    Line("AR-03", "Plaster bays, Level 1", "Level 1", "bay", 40, 3_400_000, 40, 40, 30, "supported", "ahead_of_plan_and_honest"),
    Line("AR-04", "Windows, Level 1", "Level 1", "unit", 32, 6_200_000, 75, 50, 60, "unbilled", "unbilled"),
    Line("AR-05", "Windows, Level 2", "Level 2", "unit", 32, 6_200_000, 25, 50, 40, "weak_evidence", "over_claim"),
    Line("AR-06", "Doors, Level 1", "Level 1", "unit", 28, 4_400_000, 100, 100, 100, "billing_error", "wrong_unit_price", claim_price=4_900_000),
    Line("AR-07", "Facade panels, East", "East facade", "panel", 60, 5_750_000, 40, 80, 70, "needs_inspection", "sources_conflict", cells=20, log_pct=80),
    Line("AR-08", "Facade panels, West", "West facade", "panel", 60, 5_750_000, 0, 0, 20, "supported", "not_started", photo="none", cells=20),
    Line("AR-09", "Floor tile bays, Level 1", "Level 1", "bay", 30, 7_300_000, 40, 70, 65, "needs_inspection", "stale_evidence", stale=True),
    Line("AR-10", "Partition bays, Level 2", "Level 2", "bay", 20, 4_100_000, 50, 50, 50, "needs_inspection", "photo_blocked", photo="blocked"),
    Line("AR-11", "Balcony railings, Level 2", "Level 2", "unit", 20, 2_600_000, 70, 90, 80, "weak_evidence", "removal_not_netted_in_claim", custom_log=True),
    Line("AR-12", "Windows, Level 3", "Level 3", "unit", 24, 6_200_000, 25, 75, 50, "weak_evidence", "delivered_claimed_as_installed", custom_log=True),
    Line("ME-01", "Light fixtures, Level 1", "Level 1", "unit", 64, 850_000, 100, 100, 100, "supported", "clean", cells=20),
    Line("ME-02", "Power sockets, Level 2", "Level 2", "unit", 120, 240_000, 30, 30, 35, "supported", "planned_entry_must_not_count", cells=20),
    Line("ME-03", "Conduit inside walls, Level 2", "Level 2", "m", 900, 65_000, 40, 40, 40, "needs_inspection", "concealed", photo="concealed"),
    Line("ME-04", "HVAC indoor units, Level 1", "Level 1", "unit", 18, 14_500_000, 50, 53, 55, "supported", "within_tolerance"),
    Line("ME-05", "Sprinkler heads, Level 2", "Level 2", "unit", 96, 420_000, 75, 75, 70, "supported", "clean", cells=20),
    Line("ME-06", "Electrical panels", "Plant room", "unit", 6, 38_000_000, 50, 100, 75, "weak_evidence", "over_claim"),
    Line("PL-01", "Roof waterproofing", "Roof", "m2", 420, 185_000, 100, 100, 90, "needs_inspection", "concealed", photo="concealed"),
    Line("PL-02", "Sanitary fittings, Level 1", "Level 1", "unit", 24, 3_100_000, 100, 100, 100, "billing_error", "amount_typing_error", amount_error=5_000_000),
]

CHANGE_ORDERS = [
    {"id": "CO-001", "title": "Additional core drilling, Level 2", "status": "approved", "date": "2026-08-12", "value": 42_000_000},
    {"id": "CO-002", "title": "Entrance bollards", "status": "approved", "date": "2026-08-27", "value": 18_500_000},
    {"id": "CO-003", "title": "Extra floor drains, Level 1 washrooms", "status": "pending owner approval", "date": "2026-09-14", "value": 12_000_000},
]

# (date, area, text, {item code: quantity it adds}). Deliveries and plans add nothing, a removal is negative
CUSTOM_LOGS = [
    ("2026-08-20", "Level 3", "L3 frame: 4 columns cast and 5 beams erected at grids A to C.", {"ST-03": 4, "ST-04": 5}),
    ("2026-09-10", "Level 3", "4 more L3 columns cast.", {"ST-03": 4}),
    ("2026-09-26", "Level 3", "L3 columns: 4 cast, formwork struck on Friday.", {"ST-03": 4}),
    ("2026-09-10", "Level 3", "L3 beams: 5 erected.", {"ST-04": 5}),
    ("2026-09-24", "Level 3", "Erected 5 more L3 beams.", {"ST-04": 5}),
    ("2026-09-03", "Level 2", "10 L2 balcony railings fixed.", {"AR-11": 10}),
    ("2026-09-12", "Level 2", "Fixed 8 more L2 balcony railings.", {"AR-11": 8}),
    ("2026-09-22", "Level 2", "4 L2 balcony railings removed after a failed load test, to be refixed next month.", {"AR-11": -4}),
    ("2026-09-08", "Level 3", "12 windows for L3 delivered to the store room, not fixed yet.", {}),
    ("2026-09-21", "Level 3", "6 L3 windows fixed on the north side.", {"AR-12": 6}),
    ("2026-09-29", "Level 2", "Next week: 6 more L2 power sockets planned.", {}),
]

# work recorded on site that is on no BoQ item. Only what has no approved change order is a finding
OFF_BOQ_LOGS = [
    ("2026-09-09", "Grid 9", "Temporary retaining wall started at grid 9 after the soil cut, not on the drawings.", "EX-1"),
    ("2026-09-17", "Grid 9", "Temporary retaining wall at grid 9 finished, about 18 m long.", "EX-1"),
    ("2026-09-19", "Level 1", "Fitted 6 extra floor drains in the L1 washrooms under CO-003, owner approval still pending.", "EX-2"),
    ("2026-09-11", "Level 2", "Additional core drilling on L2 finished, as per CO-001.", None),
    ("2026-09-23", "Entrance", "Entrance bollards finished, as per CO-002.", None),
    ("2026-09-15", "Site", "Heavy rain, no external work in the afternoon.", None),
    ("2026-09-18", "Site", "Site meeting with the owner's representative, no change to the works.", None),
]
EXTRA_TITLES = {"EX-1": "Temporary retaining wall at grid 9", "EX-2": "Extra floor drains in the L1 washrooms (CO-003 still pending)"}

COUNT_PHRASES = ["{n} {thing} finished today.", "Crew completed {n} more {thing}.", "{Thing}: {n} done, QC signed off.", "Installed {n} {thing} this shift."]
BULK_PHRASES = ["{n} {unit} of {thing} completed.", "Placed {n} {unit} of {thing} today.", "{Thing}: another {n} {unit} done."]
FOREMEN = ["Foreman A", "Foreman B", "Foreman C"]

ASSETS = ROOT / "assets"
COL = {"bg": "#d9d6cf", "bar": "#2b2f33", "done": "#4b5563", "done_top": "#6b7280", "todo": "#a8a49b", "text": "#f3f4f6", "cover": "#b7b3aa", "net": "#3f6f8f"}


def _font(size: int) -> ImageFont.ImageFont:
    return ImageFont.load_default(size)


def _photo(path: Path, photo_id: str, line: Line, date: str, installed: int | None, cells: int) -> None:
    """A drawn stand-in for a site photo: filled elements are installed, outlined ones are not. Real or generated photos
    replace it later; the tools do not depend on how the image was made."""
    w, h = 960, 600
    img = Image.new("RGB", (w, h), COL["bg"])
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 54], fill=COL["bar"])
    d.text((18, 15), f"SYNTHETIC SITE VIEW  {photo_id}", fill=COL["text"], font=_font(20))
    d.text((w - 18, 15), f"{line.area}  {date}", fill=COL["text"], font=_font(20), anchor="ra")
    d.text((18, h - 34), line.name, fill="#1f2937", font=_font(18))
    if line.photo == "concealed":  # only the finished surface can be seen
        d.rectangle([60, 90, w - 60, h - 60], fill=COL["cover"], outline="#8f8b83", width=3)
        for y in range(110, h - 70, 34):
            d.line([(70, y), (w - 70, y + 6)], fill="#a5a198", width=2)
        d.text((w / 2, h / 2), "finished surface, work underneath not visible", fill="#374151", font=_font(22), anchor="mm")
    else:
        cols = min(cells, 10)
        rows = -(-cells // cols)
        cw, ch = (w - 120) / cols, (h - 150) / rows
        for i in range(cells):
            x, y = 60 + (i % cols) * cw, 80 + (i // cols) * ch
            box = [x + 8, y + 8, x + cw - 8, y + ch - 8]
            if installed is not None and i < installed:
                d.rectangle(box, fill=COL["done"], outline="#1f2937", width=2)
                d.rectangle([box[0], box[1], box[2], box[1] + (box[3] - box[1]) * 0.18], fill=COL["done_top"])
            else:
                d.rectangle(box, outline=COL["todo"], width=3)
    if line.photo == "blocked":  # a scaffold net hides most of the view
        d.rectangle([180, 66, w - 40, h - 50], fill="#c7d3da", outline=COL["net"], width=3)
        for x in range(180, w - 40, 22):
            d.line([(x, 66), (x, h - 50)], fill=COL["net"], width=1)
        for y in range(66, h - 50, 22):
            d.line([(180, y), (w - 40, y)], fill=COL["net"], width=1)
        d.text(((w + 140) / 2, h / 2), "scaffold net", fill="#1f2937", font=_font(24), anchor="mm")
    img.save(path, optimize=True)


def _plural(unit: str, qty: int) -> str:
    return f"{unit}s" if qty != 1 and unit in ("unit", "bay", "panel") else unit


def _thing(line: Line) -> str:
    name, _, where = line.name.partition(", ")
    name = name.lower()
    if where.startswith("Level "):
        return f"L{where[-1]} {name}"
    return f"{where.lower()} {name}" if where else name


def _log_text(line: Line, qty: int, turn: int) -> str:
    thing = _thing(line)
    if line.unit in ("unit", "bay", "panel"):
        phrase = COUNT_PHRASES[turn % len(COUNT_PHRASES)]
        return phrase.format(n=qty, thing=thing, Thing=thing[0].upper() + thing[1:])
    phrase = BULK_PHRASES[turn % len(BULK_PHRASES)]
    return phrase.format(n=qty, unit=line.unit, thing=thing, Thing=thing[0].upper() + thing[1:])


def _log_dates(line: Line) -> list[str]:
    return ["2026-08-05", "2026-08-12", "2026-08-18"] if line.stale else ["2026-08-20", "2026-09-10", "2026-09-26"]


def _photo_truth(line: Line, realistic: bool) -> float | None:
    if realistic and line.code in SCENES:
        scene = list(SCENES[line.code].values())[-1]
        return round(100 * scene.installed / scene.total, 1) if scene.kind == "count" else None
    if realistic:
        return None
    return line.actual if line.photo == "count" else None


def _raw_logs() -> list[tuple[str, str, str, dict, str | None]]:
    """(date, area, text, {item code: quantity}, extra work group), in date order. On each date and area, automatic entries are
    merged in pairs into one note, as foremen write them: one entry about two items."""
    single: list[tuple[str, str, str, dict, str | None]] = []
    turn = 0
    for ln in LINES:
        if ln.custom_log:
            continue
        total_qty = round(ln.qty * (ln.log_pct if ln.log_pct is not None else ln.actual) / 100)
        if total_qty:
            shares = [total_qty // 3, total_qty // 3, total_qty - 2 * (total_qty // 3)]
            for date, qty in zip(_log_dates(ln), shares):
                if qty:
                    single.append((date, ln.area, _log_text(ln, qty, turn), {ln.code: qty}, None))
                    turn += 1
    merged: list[tuple[str, str, str, dict, str | None]] = []
    open_note: dict[tuple[str, str], int] = {}
    for date, area, text, qty, extra in single:
        at = open_note.pop((date, area), None)
        if at is None:
            open_note[(date, area)] = len(merged)
            merged.append((date, area, text, qty, extra))
        else:
            d, a, first, first_qty, e = merged[at]
            merged[at] = (d, a, f"{first} {text}", {**first_qty, **qty}, e)
    merged += [(date, area, text, qty, None) for date, area, text, qty in CUSTOM_LOGS]
    merged += [(date, area, text, {}, extra) for date, area, text, extra in OFF_BOQ_LOGS]
    merged.sort(key=lambda e: (e[0], e[2]))
    return merged


def plain_logs() -> list[dict]:
    return [{"id": f"LOG-{n:04d}", "date": e[0], "area": e[1], "text": e[2]} for n, e in enumerate(_raw_logs(), 1)]


def generate(out: Path | None = None, realistic: bool | None = None) -> Path:
    """realistic: use the generated photos and log wording in assets/, when they exist; else the drawn views and plain wording."""
    out = out or DATA_DIR
    photo_dir, log_texts = ASSETS / "photos", ASSETS / "daily_log_texts.json"
    if realistic is None:
        realistic = log_texts.exists() and photo_dir.exists()
    wording = json.loads(log_texts.read_text(encoding="utf-8")) if realistic else {}
    if out.exists():
        shutil.rmtree(out)
    (out / "photos").mkdir(parents=True)
    (out / "_hidden").mkdir()

    boq, claim, schedule, photos, annotations, key = [], [], [], [], {}, {}

    for ln in LINES:
        value = ln.qty * ln.price
        boq.append({"code": ln.code, "name": ln.name, "area": ln.area, "unit": ln.unit, "qty": ln.qty, "unit_price": ln.price, "value": value})
        price = ln.claim_price or ln.price
        claim.append({"code": ln.code, "claimed_pct": ln.claimed, "unit_price": price,
                      "amount": round(ln.qty * price * ln.claimed / 100) + ln.amount_error})
        schedule.append({"code": ln.code, "planned_pct_at_cutoff": ln.planned})

        if realistic and ln.code in SCENES:
            date = "2026-08-18" if ln.stale else "2026-09-28"
            for suffix, scene in SCENES[ln.code].items():
                pid = f"P-{ln.code}-{suffix}"
                shot_date = "2026-09-02" if ln.earlier_photo_pct is not None and suffix == "A" else date
                shutil.copy(photo_dir / f"{pid}.jpg", out / "photos" / f"{pid}.jpg")
                photos.append({"id": pid, "item_code": ln.code, "area": ln.area, "date": shot_date, "taken_by": "site engineer", "caption": f"{ln.name}, {ln.area}",
                               "file": f"{pid}.jpg", "what_to_count": scene.what_to_count})
                annotations[pid] = ({"visible": True, "installed": scene.installed, "total": scene.total} if scene.kind == "count"
                                    else {"visible": False, "installed": None, "total": None})
        elif ln.photo != "none":
            date = "2026-08-18" if ln.stale else "2026-09-28"
            shots = [("A", date, ln.actual)]
            if ln.earlier_photo_pct is not None:
                shots = [("A", "2026-09-02", ln.earlier_photo_pct), ("B", date, ln.actual)]
            cells = ln.cells or ln.qty if ln.qty <= 40 or ln.cells else 20
            for suffix, shot_date, pct in shots:
                pid = f"P-{ln.code}-{suffix}"
                installed = round(cells * pct / 100) if ln.photo in ("count", "blocked") else None
                _photo(out / "photos" / f"{pid}.png", pid, ln, shot_date, installed, cells)
                photos.append({"id": pid, "item_code": ln.code, "area": ln.area, "date": shot_date, "taken_by": "site engineer", "caption": f"{ln.name}, {ln.area}",
                               "file": f"{pid}.png", "what_to_count": "Filled, solid elements are installed. Outlined, empty elements are not installed yet."})
                annotations[pid] = ({"visible": True, "installed": installed, "total": cells} if ln.photo == "count"
                                    else {"visible": False, "installed": None, "total": None})

    logs, quantities, extra_logs = [], {}, {}
    for number, (date, area, text, qty, extra) in enumerate(_raw_logs(), 1):
        log_id = f"LOG-{number:04d}"
        logs.append({"id": log_id, "date": date, "area": area, "author": FOREMEN[number % len(FOREMEN)], "text": wording.get(log_id, text)})
        if qty:
            quantities[log_id] = qty
        if extra:
            extra_logs.setdefault(extra, []).append(log_id)

    for ln in LINES:
        logged = [(log_id, q[ln.code]) for log_id, q in quantities.items() if ln.code in q]
        key[ln.code] = {"expected": ln.expected, "scenario": ln.scenario, "actual_pct": ln.actual,
                        "photo_pct": _photo_truth(ln, realistic),
                        "log_pct": round(100 * sum(q for _, q in logged) / ln.qty, 1) if logged else None}

    def write(path: str, payload) -> None:
        (out / path).write_text(json.dumps(payload, indent=1), encoding="utf-8")

    write("project.json", PROJECT)
    write("boq.json", boq)
    write("claim.json", claim)
    write("schedule.json", schedule)
    write("daily_logs.json", logs)
    write("change_orders.json", CHANGE_ORDERS)
    write("photos.json", photos)
    # what a perfect reader would report: used by the mock backends, never by a real model
    write("_hidden/vision_annotations.json", annotations)
    write("_hidden/log_quantities.json", {"quantities": quantities, "extra": {EXTRA_TITLES[k]: v for k, v in extra_logs.items()}})
    write("_hidden/answer_key.json", {"lines": key, "extra_work": extra_logs})
    return out


def ensure() -> Path:
    if not (DATA_DIR / "_hidden" / "log_quantities.json").exists():
        generate()
    return DATA_DIR


if __name__ == "__main__":
    print(f"Wrote {generate()}: {len(LINES)} claim lines")

"""Generates the realistic assets of the case with Muse, through the Meta Model API: site photos and daily log wording.

Paid, so it stops before it can pass the cap: every call first reserves its cost against the ledger in data/asset_spend.json, then
books it. The results go to assets/ and are reused, so nobody has to pay for them twice.

    python tools/make_assets.py --pilot            two images of one scene, from text and from a layout sketch
    python tools/make_assets.py --photos           every photo that is not in assets/photos yet
    python tools/make_assets.py --photos --only ST-03-B,AR-02-A --force
    python tools/make_assets.py --logs             the daily log wording, rewritten by Muse Spark
    python tools/make_assets.py --photos --text-only --only AR-09-A --force
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swarm import config, generator  # noqa: E402
from swarm.scenes import SCENES, Scene, prompt  # noqa: E402

CAP_USD = 150.00  # the Meta API credit
META_IMAGE_USD = 0.01  # flat, dev.meta.ai/docs/image-generation: billed only for images returned
META_IMAGE_MODEL = "muse-image-1.0"
MANIFEST = ROOT / "assets" / "photos_manifest.json"
LEDGER = ROOT / "data" / "asset_spend.json"
ATTEMPTS = ROOT / "data" / "asset_attempts"
PHOTOS = ROOT / "assets" / "photos"
LOG_TEXTS = ROOT / "assets" / "daily_log_texts.json"
_lock = threading.Lock()
_reserved = 0.0


def spent_meta() -> float:
    return json.loads(LEDGER.read_text(encoding="utf-8")).get("meta_usd", 0.0) if LEDGER.exists() else 0.0


def _reserve(worst: float) -> None:
    global _reserved
    with _lock:
        if spent_meta() + _reserved + worst > CAP_USD:
            raise RuntimeError(f"cap: ${spent_meta():.3f} spent, ${_reserved:.2f} reserved, next call could cost ${worst:.2f}, cap ${CAP_USD:.2f}")
        _reserved += worst


def _book(worst: float, usd: float, what: str, usage: dict | None) -> None:
    global _reserved
    with _lock:
        _reserved -= worst
        ledger = json.loads(LEDGER.read_text(encoding="utf-8")) if LEDGER.exists() else {"meta_usd": 0.0, "calls": []}
        ledger["meta_usd"] = round(ledger.get("meta_usd", 0.0) + usd, 6)
        ledger["calls"].append({"what": what, "usd": round(usd, 6), "usage": usage, "t": time.strftime("%Y-%m-%dT%H:%M:%S")})
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        LEDGER.write_text(json.dumps(ledger, indent=1), encoding="utf-8")


def make_image_meta(text: str, what: str, sketch: bytes | None = None) -> bytes:
    """Muse Image. Its web and shell tools stay off: every scene is made up, and no real place or logo should come into it."""
    _reserve(META_IMAGE_USD)
    usd, usage = 0.0, None
    try:
        headers = {**{"Authorization": f"Bearer {config.setting('META_API_KEY')}"}, "Content-Type": "application/json"}
        body = {"model": META_IMAGE_MODEL, "prompt": text, "n": 1, "size": "1536x1024", "output_format": "jpeg",
                "tool_enablement": {"enable_image_search": False, "enable_web_search": False, "enable_shell": False}}
        url = "https://api.meta.ai/v1/images/generations"
        if sketch:
            url = "https://api.meta.ai/v1/images/edits"
            body["images"] = [{"image_url": "data:image/png;base64," + base64.b64encode(sketch).decode()}]
        for attempt in range(4):
            r = httpx.post(url, headers=headers, json=body, timeout=400)
            if r.status_code not in (429, 500, 502, 503) or attempt == 3:
                break
            time.sleep(8 * (attempt + 1))
        if r.status_code != 200:
            raise RuntimeError(f"{what}: HTTP {r.status_code}: {r.text[:300]}")
        data = r.json()
        usage = data.get("usage")
        usd = META_IMAGE_USD
        return base64.b64decode(data["data"][0]["b64_json"])
    finally:
        _book(META_IMAGE_USD, usd, what, usage)


def sketch_of(scene: Scene) -> bytes:
    """A plain layout: dark blocks are the complete positions, outlines the incomplete ones."""
    rows = scene.rows
    cols = -(-scene.total // rows)
    w, h = 1536, 1024
    img = Image.new("RGB", (w, h), "#e8e6e0")
    d = ImageDraw.Draw(img)
    cw, ch = (w - 160) / cols, (h - 200) / rows
    for i in range(scene.total):
        x, y = 80 + (i % cols) * cw, 100 + (i // cols) * ch
        box = [x + 24, y + 24, x + cw - 24, y + ch - 24]
        if i < scene.installed:
            d.rectangle(box, fill="#2f343a")
        else:
            d.rectangle(box, outline="#2f343a", width=6)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def finish_photo(raw: bytes, photo_id: str, area: str, date: str) -> bytes:
    """Smaller, and stamped so nobody takes it for a real record."""
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    img.thumbnail((1280, 1280))
    d = ImageDraw.Draw(img)
    w, h = img.size
    d.rectangle([0, h - 34, w, h], fill="#1f2328")
    font = ImageFont.load_default(17)
    d.text((12, h - 27), "SYNTHETIC, AI-GENERATED", fill="#ffd27a", font=font)
    d.text((w - 12, h - 27), f"{photo_id}  {area}  {date}", fill="#f3f4f6", font=font, anchor="ra")
    out = io.BytesIO()
    img.save(out, "JPEG", quality=84, optimize=True)
    return out.getvalue()


def shots() -> list[tuple[str, str, Scene, str, str]]:
    """(photo id, line code, scene, area, date) of every photo in the case."""
    out = []
    for line in generator.LINES:
        for suffix, scene in SCENES.get(line.code, {}).items():
            date = "2026-08-18" if line.stale else ("2026-09-02" if line.earlier_photo_pct is not None and suffix == "A" else "2026-09-28")
            out.append((f"P-{line.code}-{suffix}", line.code, scene, line.area, date))
    return out


def pilot() -> None:
    ATTEMPTS.mkdir(parents=True, exist_ok=True)
    pid, _, scene, area, date = next(s for s in shots() if s[0] == "P-ST-03-B")
    text = prompt(scene)
    print(text)
    made = make_image_meta(text, f"pilot text {pid}")
    (ATTEMPTS / "pilot_text.jpg").write_bytes(finish_photo(made, pid, area, date))
    guided = text + " Follow the attached layout sketch exactly for the number and order of positions: each dark block is a complete position and each empty outline is an incomplete one. The sketch only shows the layout: the result must be a real photo, not a drawing."
    made = make_image_meta(guided, f"pilot sketch {pid}", sketch=sketch_of(scene))
    (ATTEMPTS / "pilot_sketch.jpg").write_bytes(finish_photo(made, pid, area, date))
    print(f"spent so far: ${spent_meta():.4f}")


def _note_model(photo_id: str, model: str) -> None:
    with _lock:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
        manifest[photo_id] = model
        MANIFEST.write_text(json.dumps(dict(sorted(manifest.items())), indent=1), encoding="utf-8")


def photos(only: set[str], force: bool, workers: int = 4, guided: bool = True) -> None:
    PHOTOS.mkdir(parents=True, exist_ok=True)
    todo = [s for s in shots() if (not only or s[0][2:] in only) and (force or not (PHOTOS / f"{s[0]}.jpg").exists())]
    print(f"{len(todo)} photos to make, ${spent_meta():.4f} spent so far, cap ${CAP_USD:.2f}")

    def one(shot) -> str:
        pid, _, scene, area, date = shot
        try:
            text = prompt(scene)
            sketch = None
            if scene.kind == "count" and guided:
                text += GUIDE
                sketch = sketch_of(scene)
            raw = make_image_meta(text, pid, sketch=sketch)
            _note_model(pid, META_IMAGE_MODEL)
            (PHOTOS / f"{pid}.jpg").write_bytes(finish_photo(raw, pid, area, date))
            return f"ok {pid}"
        except Exception as e:
            return f"FAILED {pid}: {str(e)[:200]}"

    with ThreadPoolExecutor(workers) as pool:
        for line in pool.map(one, todo):
            print(line, f"| ${spent_meta():.4f}", flush=True)


LOG_PROMPT = """You rewrite entries of a construction site diary so they read as a busy foreman in Indonesia wrote them in English.
Rules:
- Keep the meaning of every entry exactly: what was done, how many, which level, grid or side. A delivery stays a delivery, a plan stays a plan,
  a removal stays a removal, and an entry about several items keeps all of them.
- Keep every number exactly as it is, in digits. Add no other number: no dates, times, crew sizes or measurements.
- Keep every change order reference such as CO-003 and whether it is approved or pending.
- Vary the style between entries: short notes, shorthand such as L3 for Level 3 or instl for installed, dropped words, an odd word order.
  An occasional small typo is fine, never in a number. Do not invent facts, names, companies or places.
- Keep each entry to one or two short lines.
Return JSON only: an object mapping each entry id to its new text, with every id present.

Entries:
"""


def number_set(text: str) -> set[str]:
    return set(re.findall(r"\d+(?:\.\d+)?", text))


def check_rewrite(original: dict[str, str], rewritten: dict) -> list[str]:
    """What is wrong with a rewrite: a missing entry, or any number added or dropped."""
    problems = []
    for log_id, text in original.items():
        new = rewritten.get(log_id)
        if not isinstance(new, str) or not new.strip():
            problems.append(f"{log_id}: missing")
        elif number_set(new) != number_set(text):
            problems.append(f"{log_id}: numbers changed from {sorted(number_set(text))} to {sorted(number_set(new))}: {new}")
    return problems


def daily_logs(model: str = "muse-spark-1.3") -> None:
    """Rewrites the plain entries; entries whose numbers changed keep their plain wording."""
    plain = {e["id"]: e["text"] for e in generator.plain_logs()}
    headers = {"Authorization": f"Bearer {config.setting('META_API_KEY')}", "Content-Type": "application/json"}
    body = {"model": model, "messages": [{"role": "user", "content": LOG_PROMPT + json.dumps(plain, indent=0)}], "temperature": 0.7}
    r = httpx.post("https://api.meta.ai/v1/chat/completions", headers=headers, json=body, timeout=400)
    if r.status_code != 200:
        raise RuntimeError(f"logs: HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    print("usage:", data.get("usage"))
    text = data["choices"][0]["message"]["content"]
    rewritten = json.loads(text[text.find("{"): text.rfind("}") + 1])
    problems = check_rewrite(plain, rewritten)
    for p in problems:
        print("kept the plain wording,", p)
    bad = {p.split(":")[0] for p in problems}
    LOG_TEXTS.parent.mkdir(parents=True, exist_ok=True)
    LOG_TEXTS.write_text(json.dumps({k: (plain[k] if k in bad else rewritten[k].strip()) for k in plain}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(plain) - len(bad)} of {len(plain)} entries rewritten by {model}")


GUIDE = (" Follow the attached layout sketch exactly for the number and order of positions: each dark block is a complete position and each empty outline "
         "is an incomplete one. The sketch only shows the layout: the result must be a real photo, not a drawing.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pilot", action="store_true")
    ap.add_argument("--logs", action="store_true")
    ap.add_argument("--photos", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--text-only", action="store_true", help="no layout sketch")
    args = ap.parse_args()
    if args.pilot:
        pilot()
    if args.logs:
        daily_logs()
    if args.photos:
        photos({x for x in args.only.split(",") if x}, args.force, guided=not args.text_only)
    print(f"spent: Meta credit ${spent_meta():.2f} of ${CAP_USD:.2f}")

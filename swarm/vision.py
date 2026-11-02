"""Reading a site photo. The field agent only sees this interface, so SAM 3.1 or another model can replace a backend later.

A backend returns what it saw; the percentage is always worked out here, by code.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import config

PROMPT = """This photo is from a construction site. It should show: {caption}.
{what_to_count}
Count carefully, one position at a time, and count only the main subject, not things in the background. Say the work is not visible if the
photo only shows a finished surface and the work itself cannot be seen, or if something such as a scaffold net hides the elements so that
you cannot count them all. Do not estimate what you cannot see.
Answer with JSON only: {{"visible": true or false, "installed": number or null, "total": number or null}}"""


def result(photo_id: str, seen: dict, method: str) -> dict:
    installed, total = seen.get("installed"), seen.get("total")
    visible = bool(seen.get("visible")) and bool(total)
    return {"photo_id": photo_id, "visible": visible, "installed": installed if visible else None, "total": total if visible else None,
            "pct": round(100 * installed / total, 1) if visible else None, "method": method}


class MockVision:
    """Reports the generator's own annotations: a perfect detector. It proves the wiring, and says nothing about accuracy."""

    def __init__(self, folder: Path):
        self.annotations = json.loads((folder / "_hidden" / "vision_annotations.json").read_text(encoding="utf-8"))
        self.folder = folder

    async def inspect(self, photo: dict) -> tuple[dict, int, int]:
        return result(photo["id"], self.annotations[photo["id"]], "mock (generator's annotations)"), 0, 0


class GeminiVision:
    def __init__(self, folder: Path, model: str | None = None):
        from google import genai
        from google.genai import types

        self.client = genai.Client(http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=4)))
        self.model, self.folder = model or config.MODEL_VISION, folder

    async def inspect(self, photo: dict) -> tuple[dict, int, int]:
        from google.genai import types

        file = self.folder / "photos" / photo["file"]
        mime = "image/jpeg" if file.suffix == ".jpg" else "image/png"
        question = PROMPT.format(caption=photo["caption"], what_to_count=photo["what_to_count"])
        r = await self.client.aio.models.generate_content(
            model=self.model, contents=[types.Part.from_bytes(data=file.read_bytes(), mime_type=mime), question],
            config=types.GenerateContentConfig(temperature=0, response_mime_type="application/json"))
        usage = r.usage_metadata
        seen = parse(r.text)
        return (result(photo["id"], seen, f"vision: {self.model}"), (usage.prompt_token_count or 0) if usage else 0,
                config.output_tokens(usage) if usage else 0)


class MuseVision:
    """Muse Spark reads the photo through the Meta Model API."""

    def __init__(self, folder: Path, model: str = "muse-spark-1.3"):
        self.model, self.folder = model, folder

    async def inspect(self, photo: dict) -> tuple[dict, int, int]:
        import base64

        import httpx

        file = self.folder / "photos" / photo["file"]
        mime = "image/jpeg" if file.suffix == ".jpg" else "image/png"
        question = PROMPT.format(caption=photo["caption"], what_to_count=photo["what_to_count"])
        body = {"model": self.model, "temperature": 0, "max_tokens": 1500, "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(file.read_bytes()).decode()}"}}, {"type": "text", "text": question}]}]}
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post("https://api.meta.ai/v1/chat/completions", headers={"Authorization": f"Bearer {config.setting('META_API_KEY')}"}, json=body)
        r.raise_for_status()
        data = r.json()
        usage = data.get("usage") or {}
        text = data["choices"][0]["message"]["content"] or ""
        match = re.search(r"\{.*\}", text, re.S)
        return result(photo["id"], parse(match.group(0) if match else ""), f"vision: {self.model}"), usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)


def parse(text: str | None) -> dict:
    """A reply that cannot be read counts as "not visible", so it ends in an inspection instead of a made-up number."""
    try:
        seen = json.loads(text or "")
    except ValueError:
        return {"visible": False}
    if not isinstance(seen, dict) or not isinstance(seen.get("installed"), (int, float)) or not isinstance(seen.get("total"), (int, float)):
        return {"visible": False}
    if seen["total"] <= 0 or not 0 <= seen["installed"] <= seen["total"]:
        return {"visible": False}
    return seen

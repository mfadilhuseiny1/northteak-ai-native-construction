"""Settings, read only from this repository's .env.local and .env, so a real run never picks up a key from elsewhere by accident."""

from __future__ import annotations

from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
_env = {**dotenv_values(ROOT / ".env.local"), **dotenv_values(ROOT / ".env")}


def setting(name: str, default: str = "") -> str:
    return (_env.get(name) or default).strip()


def muse_ready() -> bool:
    return bool(setting("META_API_KEY"))


MODEL_LEAD = setting("MUSE_MODEL_LEAD", "muse-wonder-1.0")
MODEL_WORKER = setting("MUSE_MODEL_WORKER", "muse-spark-1.3")
MODEL_VISION = setting("MUSE_MODEL_VISION", "muse-spark-1.3")
MAX_USD = float(setting("MAX_USD", "1.00"))
MAX_LLM_CALLS = int(setting("MAX_LLM_CALLS", "80"))
PRICE_INPUT_PER_M = float(setting("PRICE_INPUT_PER_M", "1.25"))
PRICE_OUTPUT_PER_M = float(setting("PRICE_OUTPUT_PER_M", "4.25"))

STALE_DAYS = 21  # a declared assumption: evidence older than this before the cut-off cannot show the current state

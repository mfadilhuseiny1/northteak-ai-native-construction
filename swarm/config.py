"""Settings, read only from this repository's .env.local and .env, so a real run never picks up a key from elsewhere by accident."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
_env = {**dotenv_values(ROOT / ".env.local"), **dotenv_values(ROOT / ".env")}


def setting(name: str, default: str = "") -> str:
    return (_env.get(name) or default).strip()


def use_vertex() -> bool:
    return setting("GOOGLE_GENAI_USE_VERTEXAI").upper() == "TRUE"


def vertex_project() -> str:
    return setting("BLUESANDAI_VERTEX_PROJECT") or setting("GOOGLE_CLOUD_PROJECT")


def vertex_credentials() -> Path:
    """A named file, else the gcloud application-default login. GOOGLE_APPLICATION_CREDENTIALS is not used: in the copied
    .env.local it names another service's account, which has no access to the Vertex project."""
    named = setting("BLUESANDAI_VERTEX_CREDENTIALS")
    if named:
        return Path(named)
    base = Path(os.environ["APPDATA"]) / "gcloud" if os.name == "nt" and os.environ.get("APPDATA") else Path.home() / ".config" / "gcloud"
    return base / "application_default_credentials.json"


def gemini_ready() -> bool:
    if use_vertex():
        return bool(vertex_project()) and vertex_credentials().exists()
    return bool(setting("GOOGLE_API_KEY"))


def export_google_env() -> None:
    """ADK and google-genai read these from the environment; set them just before a real run."""
    if use_vertex():
        for name in ("GOOGLE_API_KEY", "GEMINI_API_KEY"):  # a key would take precedence over the project
            os.environ.pop(name, None)
        os.environ.update(GOOGLE_GENAI_USE_VERTEXAI="TRUE", GOOGLE_CLOUD_PROJECT=vertex_project(), GOOGLE_CLOUD_QUOTA_PROJECT=vertex_project(),
                          GOOGLE_CLOUD_LOCATION=setting("BLUESANDAI_VERTEX_LOCATION") or setting("GOOGLE_CLOUD_LOCATION") or "global",
                          GOOGLE_APPLICATION_CREDENTIALS=str(vertex_credentials()))
    else:
        os.environ.update(GOOGLE_GENAI_USE_VERTEXAI="FALSE", GOOGLE_API_KEY=setting("GOOGLE_API_KEY"))


MODEL_LEAD = setting("GEMINI_MODEL_LEAD", "gemini-3.1-pro-preview")
MODEL_WORKER = setting("GEMINI_MODEL_WORKER", "gemini-3.8-flash")
MODEL_VISION = setting("GEMINI_MODEL_VISION", "gemini-3.8-flash")
MAX_USD = float(setting("MAX_USD", "1.00"))
MAX_LLM_CALLS = int(setting("MAX_LLM_CALLS", "80"))
PRICE_INPUT_PER_M = float(setting("PRICE_INPUT_PER_M", "2.00"))
PRICE_OUTPUT_PER_M = float(setting("PRICE_OUTPUT_PER_M", "12.00"))


def output_tokens(usage) -> int:
    """What the model bills as output: its visible answer and its thinking."""
    return (usage.candidates_token_count or 0) + (getattr(usage, "thoughts_token_count", None) or 0)


STALE_DAYS = 21  # a declared assumption: evidence older than this before the cut-off cannot show the current state

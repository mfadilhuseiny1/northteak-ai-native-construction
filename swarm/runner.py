"""Runs the swarm once and turns ADK's events into the events the UI shows."""

from __future__ import annotations

import asyncio
import re
import traceback
import uuid
from typing import Callable

from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from . import agents, config, score, vision
from .data import ProjectData
from .tools import RUNS, RunContext


def rupiah(value: int) -> str:
    return f"Rp {value:,}"


def default_summary(core: dict) -> str:
    t = core["totals"]
    return (f"{t['unbilled']} lines have finished work worth {rupiah(t['unbilled_value'])} not billed yet. {t['weak_evidence']} lines claim "
            f"{rupiah(t['weak_evidence_value'])} more than the evidence supports. {t['billing_error']} lines have billing errors worth "
            f"{rupiah(t['billing_error_value'])}. {t['needs_inspection']} lines need a check on site.")


def checked_summary(text: str | None, core: dict) -> tuple[str, bool]:
    """The lead's words, unless they carry a large number the report does not: then the summary code wrote instead."""
    if not text or not text.strip():
        return default_summary(core), False
    allowed = {str(v) for v in core["totals"].values()}
    allowed |= {str(x["impact"]) for x in core["lines"]} | {str(abs(x["billing_difference"])) for x in core["lines"]}
    for token in re.findall(r"\d[\d.,]*\d", text):
        digits = re.sub(r"\D", "", token)
        if len(digits) >= 4 and digits not in allowed:
            return default_summary(core), False
    return text.strip(), True


def _emit_adk_event(run: RunContext, event) -> None:
    usage = event.usage_metadata
    if usage:
        run.input_tokens += usage.prompt_token_count or 0
        run.output_tokens += config.output_tokens(usage)
        run.emit({"type": "usage", "llm_calls": run.llm_calls, "input_tokens": run.input_tokens, "output_tokens": run.output_tokens, "usd": round(run.usd, 4)})
    for part in (event.content.parts if event.content and event.content.parts else []):
        if part.function_call:
            run.emit({"type": "tool", "agent": event.author, "name": part.function_call.name, "args": dict(part.function_call.args or {})})
        elif part.text and not part.thought and event.is_final_response():
            run.emit({"type": "say", "agent": event.author, "text": part.text})


async def run_review(mode: str = "mock", emit: Callable[[dict], None] | None = None, model_of: Callable[[str], object] | None = None,
                     delay: float = 0.0, run_id: str | None = None, max_llm_calls: int | None = None, max_usd: float | None = None) -> dict:
    run_id = run_id or f"run-{uuid.uuid4().hex[:10]}"
    emit = emit or (lambda e: None)
    data = ProjectData.load()
    if mode == "gemini":
        config.export_google_env()
        backend = vision.GeminiVision(data.folder)
    else:
        backend = vision.MockVision(data.folder)
    run = RunContext(data=data, vision=backend, emit=emit)
    RUNS[run_id] = run
    limit_calls = max_llm_calls or config.MAX_LLM_CALLS
    limit_usd = max_usd if max_usd is not None else config.MAX_USD

    emit({"type": "start", "run_id": run_id, "mode": mode, "limits": {"max_llm_calls": limit_calls, "max_usd": limit_usd}})
    swarm = agents.build_swarm(model_of or (lambda role: agents.model_for(mode, role, delay)))
    sessions = InMemorySessionService()
    runner = Runner(app_name="claim_review", agent=swarm, session_service=sessions)
    session = await sessions.create_session(app_name="claim_review", user_id="pm", state={"run_id": run_id})
    message = types.Content(role="user", parts=[types.Part(text="Review the draft progress claim.")])

    status, stop_reason = "complete", None
    abort = asyncio.Event()
    stream = runner.run_async(user_id="pm", session_id=session.id, new_message=message, run_config=RunConfig(max_llm_calls=limit_calls), abort_signal=abort)
    try:
        async for event in stream:
            _emit_adk_event(run, event)
            if event.error_code:
                raise RuntimeError(f"{event.error_code}: {event.error_message}")
            if run.usd > limit_usd:
                status, stop_reason = "partial", f"Stopped at the spending limit of ${limit_usd:.2f}."
                emit({"type": "error", "message": stop_reason})
                break
    except Exception as e:  # a failed run still reports what it has: lines without their evidence go to inspection
        status, stop_reason = "partial", f"{type(e).__name__}: {e}"
        emit({"type": "error", "message": stop_reason})
        traceback.print_exc()
    finally:
        abort.set()
        await stream.aclose()  # or the parallel agents would keep calling the model after a stop

    state = (await sessions.get_session(app_name="claim_review", user_id="pm", session_id=session.id)).state
    core = state.get("report_core") or agents.build_report_core(data, state)
    summary, from_lead = checked_summary(state.get("lead_summary_text") if status == "complete" else None, core)
    report = {"run_id": run_id, "mode": mode, "status": status, "stop_reason": stop_reason, "project": data.project, **core, "summary": summary,
              "summary_from_lead": from_lead, "plan": state.get("plan"), "refused": run.refused,
              "usage": {"llm_calls": run.llm_calls, "input_tokens": run.input_tokens, "output_tokens": run.output_tokens, "usd": round(run.usd, 4)}}
    report["score"] = score.score(report, data.folder)
    report["score"]["note"] = ("Mock run: the model and the photo readings are scripted, so this proves the wiring and the checks, not accuracy."
                               if mode == "mock" else "Scored against the problems planted in synthetic data. Says nothing about real projects.")
    emit({"type": "final", "report": report})
    RUNS.pop(run_id, None)
    await asyncio.sleep(0)
    return report

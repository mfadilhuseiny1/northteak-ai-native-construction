"""Runs the first prototype's swarm once, in plain code, and tells the UI what happens."""

from __future__ import annotations

import asyncio
import functools
import inspect
import re
import traceback
import uuid
from typing import Callable

from . import agents, config, llm, score, vision
from .data import ProjectData
from .reconcile import reconcile
from .tools import RUNS, STATE, TOOLS, RunContext

MODEL_CALLS = 40  # for one agent: the run's own limit is the one that stops it


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


class Stop(Exception):
    """A limit was reached: no more model calls in this run."""


async def run_review(mode: str = "mock", emit: Callable[[dict], None] | None = None, model_of: Callable[[str], object] | None = None,
                     delay: float = 0.0, run_id: str | None = None, max_llm_calls: int | None = None, max_usd: float | None = None) -> dict:
    run_id = run_id or f"run-{uuid.uuid4().hex[:10]}"
    emit = emit or (lambda e: None)
    data = ProjectData.load()
    backend = vision.MuseVision(data.folder, config.MODEL_VISION) if mode == "muse" else vision.MockVision(data.folder)
    run = RunContext(data=data, vision=backend, emit=emit)
    RUNS[run_id] = run
    limit_calls = max_llm_calls or config.MAX_LLM_CALLS
    limit_usd = max_usd if max_usd is not None else config.MAX_USD
    model_of = model_of or (lambda role: agents.model_for(mode, role, delay))

    emit({"type": "start", "run_id": run_id, "mode": mode, "limits": {"max_llm_calls": limit_calls, "max_usd": limit_usd}})
    state: dict = {"run_id": run_id}
    STATE.set(state)
    status, stop_reason = "complete", None

    def gate() -> None:
        """Before every model call, in every agent: side by side, one reaching a limit stops them all."""
        nonlocal stop_reason
        if run.llm_calls >= limit_calls:
            stop_reason = stop_reason or f"Stopped at the limit of {limit_calls} model calls."
        elif run.usd > limit_usd:
            stop_reason = stop_reason or f"Stopped at the spending limit of ${limit_usd:.2f}."
        if stop_reason:
            raise Stop(stop_reason)
        run.llm_calls += 1  # counted as it starts, or agents side by side would all pass at once

    def count(used_in: int, used_out: int) -> None:
        run.input_tokens += used_in
        run.output_tokens += used_out
        emit({"type": "usage", "llm_calls": run.llm_calls, "input_tokens": run.input_tokens, "output_tokens": run.output_tokens, "usd": round(run.usd, 4)})

    def tooled(role: str, fn: Callable) -> Callable:
        """The UI hears each tool call."""
        if inspect.iscoroutinefunction(fn):
            @functools.wraps(fn)
            async def run_async(**k):
                emit({"type": "tool", "agent": role, "name": fn.__name__, "args": dict(k)})
                return await fn(**k)
            return run_async

        @functools.wraps(fn)
        def run_sync(**k):
            emit({"type": "tool", "agent": role, "name": fn.__name__, "args": dict(k)})
            return fn(**k)
        return run_sync

    async def agent(role: str) -> str:
        emit({"type": "agent", "agent": role, "status": "working"})
        text = await llm.turn(model_of(role), f"{agents.COMMON}\n\n{agents.INSTRUCTIONS[role]}", [tooled(role, t) for t in TOOLS[role]], "Review the draft progress claim.", MODEL_CALLS, count, gate)
        if text:
            emit({"type": "say", "agent": role, "text": text})
        emit({"type": "agent", "agent": role, "status": "done"})
        return text

    def step(role: str, work: Callable[[], str]) -> None:
        emit({"type": "agent", "agent": role, "status": "working"})
        emit({"type": "say", "agent": role, "text": work()})
        emit({"type": "agent", "agent": role, "status": "done"})

    def compare() -> str:
        state["reconciled"] = lines = reconcile(data, agents.collect_findings(state))
        emit({"type": "reconciled", "lines": lines})
        return f"Compared {len(lines)} lines across the sources."

    def finalize() -> str:
        state["report_core"] = core = agents.build_report_core(data, state)
        emit({"type": "finalized", **core})
        return "Rulings applied and totals added up."

    summary_text = None
    try:
        await agent("lead_plan")
        async with asyncio.TaskGroup() as side_by_side:  # one failing cancels the others, so they stop calling the model
            for role in ("field", "schedule", "documents", "cost"):
                side_by_side.create_task(agent(role))
        step("reconcile", compare)
        await agent("verifier")
        step("finalize", finalize)
        summary_text = await agent("lead_summary")
    except BaseException as e:  # noqa: BLE001 - a failed run still reports what it has: lines without their evidence go to inspection
        if isinstance(e, (KeyboardInterrupt, SystemExit, asyncio.CancelledError)):
            raise
        while isinstance(e, BaseExceptionGroup):  # what really went wrong, not the group agents side by side raise it in
            e = e.exceptions[0]
        status, limited = "partial", bool(stop_reason)
        stop_reason = stop_reason or f"{type(e).__name__}: {e}"
        emit({"type": "error", "message": stop_reason})
        if not limited:
            traceback.print_exc()

    core = state.get("report_core") or agents.build_report_core(data, state)
    summary, from_lead = checked_summary(summary_text if status == "complete" else None, core)
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

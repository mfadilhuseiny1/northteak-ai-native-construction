"""The swarm, as ADK agents:

    lead_plan -> [field | schedule | documents | cost, in parallel] -> reconcile (code) -> verifier -> finalize (code) -> lead_summary

To move to another model family, change `model_for`: nothing else here depends on the provider.
"""

from __future__ import annotations

from typing import AsyncGenerator, Callable

from google.adk.agents import BaseAgent, LlmAgent, ParallelAgent, SequentialAgent
from google.adk.events import Event, EventActions
from google.adk.models import Gemini
from google.genai import types

from . import config, mock_llm
from .reconcile import apply_rulings, reconcile, totals
from .tools import RUNS, TOOLS

AGENTS = [
    {"name": "lead_plan", "label": "Lead", "does": "Reads the claim and sets the plan"},
    {"name": "field", "label": "Field", "does": "Reads site photos"},
    {"name": "schedule", "label": "Schedule", "does": "Reads planned progress"},
    {"name": "documents", "label": "Documents", "does": "Reads daily logs and change orders"},
    {"name": "cost", "label": "Cost", "does": "Checks the claim against the BoQ"},
    {"name": "reconcile", "label": "Compare (code)", "does": "Compares sources, works out the rupiah"},
    {"name": "verifier", "label": "Verifier", "does": "Rechecks conclusions against the evidence"},
    {"name": "finalize", "label": "Totals (code)", "does": "Applies rulings, adds up"},
    {"name": "lead_summary", "label": "Lead", "does": "Writes the summary"},
]

COMMON = """You work on the review of a contractor's monthly progress claim, before the contractor sends it to the owner.
Report what the evidence shows, nothing more. Call the tools; do not ask questions. Finish with one short sentence."""

INSTRUCTIONS = {
    "lead_plan": """You lead the review. Call get_claim_overview, then call set_plan with a one or two sentence plan and the
item codes most worth attention by value. Every line gets reviewed either way.""",
    "field": """You are the field agent. Your only source is site photos: you cannot see the claim, the schedule or the logs.
Call list_site_photos, then inspect_photos with all the photo IDs. Then, for every item in the list, exactly once: take its
latest photo. If the work is visible, call submit_finding with that photo's pct and its ID as evidence. If the work is not
visible, or the item has no photo, call submit_not_verifiable with the reason. Never estimate what a photo cannot show.""",
    "schedule": """You are the schedule agent. Your only source is the schedule. Call read_schedule, then for every item call
submit_finding with its planned_pct and its evidence_id.""",
    "documents": """You are the document agent. Your only sources are the daily log and the change orders. Call read_daily_logs and
read_change_orders, then read every entry carefully. Foremen write freely: L3 means Level 3, and one entry can cover several items.
For every item, find the entries about it, and be exact about the level and the side of the building.
Count only work actually completed. A delivery or a plan is not progress. A removal takes work back, as a negative quantity.
For every item, exactly once: if it has completed work, call record_log_quantities with the entries and the quantity each one adds.
If it has none, call submit_not_verifiable. Code adds up the quantities; never add them yourself.
Then, for work actually done that is on no BoQ item and has no approved change order (a pending one is not approved), call
report_extra_work once per piece of work, citing all its entries. Ignore remarks that are not work, such as weather or meetings.""",
    "cost": """You are the cost agent. Your only sources are the claim and the BoQ. Call read_claim_and_boq, then for every line
call submit_cost_check: "mismatch" if its difference is not zero, otherwise "ok", citing its evidence_ids.""",
    "verifier": """You are the verifier. Check conclusions; never write a new number. Call get_flagged_items, then open_evidence with
their evidence IDs (schedule evidence is not needed). For every item call rule_on_item exactly once. Reject a conclusion when its
newest evidence is older than stale_after_days before the cutoff, or when the evidence does not support it. Otherwise confirm it.""",
    "lead_summary": """You lead the review. Call get_final_report, then write three or four plain sentences for the contractor's
project manager: what is not billed yet, what is claimed beyond the evidence, what has a billing error, what needs a check on site.
Use only the numbers in the report, written the same way, as rupiah. Call them discrepancies; never call anything fraud.""",
}


def model_for(mode: str, role: str, delay: float = 0.0):
    if mode == "mock":
        return mock_llm.MockLlm(model=f"mock/{role}", brain=mock_llm.BRAINS[role], delay=delay)
    if mode == "gemini":
        name = config.MODEL_LEAD if role in ("lead_plan", "verifier", "lead_summary") else config.MODEL_WORKER
        return Gemini(model=name, retry_options=types.HttpRetryOptions(attempts=4))
    raise ValueError(f"unknown mode {mode}")  # Muse goes here: an OpenAI-style endpoint through ADK's LiteLlm wrapper


def _started(callback_context) -> None:
    RUNS[callback_context.state["run_id"]].emit({"type": "agent", "agent": callback_context.agent_name, "status": "working"})


def _finished(callback_context) -> None:
    RUNS[callback_context.state["run_id"]].emit({"type": "agent", "agent": callback_context.agent_name, "status": "done"})


def _count_call(callback_context, llm_response) -> None:
    RUNS[callback_context.state["run_id"]].llm_calls += 1  # after the model: a call ADK's limit blocked does not count


def collect_findings(state) -> dict[str, dict[str, dict]]:
    findings: dict[str, dict[str, dict]] = {}
    for key, value in state.to_dict().items() if hasattr(state, "to_dict") else state.items():
        if key.startswith("finding:"):
            _, source, code = key.split(":", 2)
            findings.setdefault(source, {})[code] = value
    return findings


def collect(state, prefix: str) -> dict[str, dict]:
    items = state.to_dict().items() if hasattr(state, "to_dict") else state.items()
    return {key[len(prefix):]: value for key, value in items if key.startswith(prefix)}


def build_report_core(data, state) -> dict:
    """Lines, totals and extra work from whatever the state holds: also used when a run was cut short."""
    lines = state.get("reconciled") or reconcile(data, collect_findings(state))
    lines = apply_rulings(lines, collect(state, "ruling:"))
    return {"lines": lines, "totals": totals(lines), "extra_work": list(collect(state, "extra:").values())}


class ReconcileAgent(BaseAgent):
    async def _run_async_impl(self, ctx) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        run = RUNS[state["run_id"]]
        lines = reconcile(run.data, collect_findings(state))
        run.emit({"type": "reconciled", "lines": lines})
        yield Event(author=self.name, invocation_id=ctx.invocation_id, branch=ctx.branch, actions=EventActions(state_delta={"reconciled": lines}),
                    content=types.Content(role="model", parts=[types.Part(text=f"Compared {len(lines)} lines across the sources.")]))


class FinalizeAgent(BaseAgent):
    async def _run_async_impl(self, ctx) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        run = RUNS[state["run_id"]]
        core = build_report_core(run.data, state)
        run.emit({"type": "finalized", **core})
        yield Event(author=self.name, invocation_id=ctx.invocation_id, branch=ctx.branch, actions=EventActions(state_delta={"report_core": core}),
                    content=types.Content(role="model", parts=[types.Part(text="Rulings applied and totals added up.")]))


def _agent(role: str, model_of: Callable[[str], object], output_key: str | None = None) -> LlmAgent:
    return LlmAgent(name=role, model=model_of(role), instruction=f"{COMMON}\n\n{INSTRUCTIONS[role]}", tools=TOOLS[role], include_contents="none",
                    output_key=output_key, disallow_transfer_to_parent=True, disallow_transfer_to_peers=True,
                    generate_content_config=types.GenerateContentConfig(temperature=0.1),
                    before_agent_callback=_started, after_agent_callback=_finished, after_model_callback=_count_call)


def build_swarm(model_of: Callable[[str], object]) -> SequentialAgent:
    return SequentialAgent(name="claim_review", sub_agents=[
        _agent("lead_plan", model_of),
        ParallelAgent(name="specialists", sub_agents=[_agent(role, model_of) for role in ("field", "schedule", "documents", "cost")]),
        ReconcileAgent(name="reconcile", before_agent_callback=_started, after_agent_callback=_finished),
        _agent("verifier", model_of),
        FinalizeAgent(name="finalize", before_agent_callback=_started, after_agent_callback=_finished),
        _agent("lead_summary", model_of, output_key="lead_summary_text"),
    ])

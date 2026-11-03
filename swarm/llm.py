"""One agent's turn, on CAMEL-AI (Apache-2.0): its ChatAgent runs the tool loop, and the OpenAI SDK under it talks to the Meta Model API, the route Meta's own guide gives.

Who works when stays plain code, in firm.py and planner.py. Everything that knows about the framework is here, so changing it again touches this file alone.
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import json
import time
import uuid
from typing import Any, Callable

import camel
from camel.agents import ChatAgent
from camel.models import BaseModelBackend, ModelFactory
from camel.toolkits import FunctionTool
from camel.types import ModelPlatformType, ModelType
from camel.utils import BaseTokenCounter
from openai.types.chat import ChatCompletion, ChatCompletionMessage
from openai.types.chat.chat_completion import Choice
from openai.types.chat.chat_completion_message_function_tool_call import ChatCompletionMessageFunctionToolCall, Function
from openai.types.completion_usage import CompletionUsage

from . import config

camel.disable_logging()  # a failed call reaches the caller, which reports it where the review shows it

MUSE_URL = "https://api.meta.ai/v1"
Calls = list[tuple[str, dict]]


class TurnLimit(Exception):
    """The turn used its model calls without writing its report."""


class Said:
    """What a model says alongside its tool calls, as Muse does before each one. It is not the report."""

    def __init__(self, text: str, calls: Calls):
        self.text, self.calls = text, calls


class _Rough(BaseTokenCounter):
    """Roughly four characters a token, for CAMEL's own bookkeeping. Spending comes from what the API reports, and tiktoken would have to download its tables first."""

    def count_tokens_from_messages(self, messages: list) -> int:
        return sum(len(str(m.get("content") or "")) for m in messages) // 4

    def encode(self, text: str) -> list[int]:
        return []

    def decode(self, token_ids: list[int]) -> str:
        return ""


def muse(model: str, max_tokens: int = 6000, temperature: float = 0.1, effort: str = "") -> BaseModelBackend:
    """A model on the Meta Model API. The call a real run pays for. Muse's thinking counts against max_tokens: effort asks it to think less, for a job that does not need it."""
    settings: dict[str, Any] = {"temperature": temperature, "max_tokens": max_tokens, **({"reasoning_effort": effort} if effort else {})}
    return ModelFactory.create(model_platform=ModelPlatformType.OPENAI_COMPATIBLE_MODEL, model_type=model, url=MUSE_URL, api_key=config.setting("META_API_KEY"),
                               model_config_dict=settings, token_counter=_Rough(), timeout=300, max_retries=2)


class Scripted(BaseModelBackend):
    """An offline model: `answer` sees what the tools have returned so far and which tools it has, and gives tool calls to make or its final text. The whole loop runs for real; only the model's answers are scripted."""

    def __init__(self, model: str = "mock", delay: float = 0.0, tokens: int = 0):
        super().__init__(model_type=ModelType.STUB, model_config_dict={}, token_counter=_Rough())
        self.label, self.delay, self.tokens = model, delay, tokens

    @property
    def token_counter(self) -> BaseTokenCounter:
        return self._token_counter

    def answer(self, results: dict[str, list[dict]], tools: set[str]) -> Calls | Said | str:
        raise NotImplementedError

    @staticmethod
    def results(messages: list[dict]) -> dict[str, list[dict]]:
        names = {c["id"]: c["function"]["name"] for m in messages if m.get("role") == "assistant" for c in m.get("tool_calls") or []}
        seen: dict[str, list[dict]] = {}
        for m in messages:
            if m.get("role") == "tool":
                seen.setdefault(names.get(m.get("tool_call_id"), ""), []).append(_parsed(m.get("content")))
        return seen

    def _reply(self, messages: list[dict], tools: list[dict] | None) -> ChatCompletion:
        answer = self.answer(self.results(messages), {t["function"]["name"] for t in tools or []})
        text, calls = (answer.text, answer.calls) if isinstance(answer, Said) else (answer, None) if isinstance(answer, str) else (None, answer)
        made = [ChatCompletionMessageFunctionToolCall(id=f"call_{uuid.uuid4().hex[:12]}", type="function", function=Function(name=n, arguments=json.dumps(a))) for n, a in calls or []]
        message = ChatCompletionMessage(role="assistant", content=text, tool_calls=made or None)
        return ChatCompletion(id=f"mock-{uuid.uuid4().hex[:8]}", created=int(time.time()), model=self.label, object="chat.completion", choices=[Choice(finish_reason="tool_calls" if made else "stop", index=0, message=message)],
                              usage=CompletionUsage(prompt_tokens=self.tokens, completion_tokens=self.tokens, total_tokens=2 * self.tokens))

    def _run(self, messages: list[dict], response_format: Any = None, tools: list[dict] | None = None) -> ChatCompletion:
        return self._reply(messages, tools)

    async def _arun(self, messages: list[dict], response_format: Any = None, tools: list[dict] | None = None) -> ChatCompletion:
        await asyncio.sleep(self.delay)  # at least one pause, so agents side by side really take turns, as they would on a network
        return self._reply(messages, tools)


def _parsed(content: Any) -> dict:
    try:
        out = json.loads(content or "{}")
    except (TypeError, ValueError):
        return {"result": content}
    return out if isinstance(out, dict) else {"result": out}


def schema_of(fn: Callable) -> dict:
    """The tool as a model sees it: its name, its docstring and a plain JSON schema of its arguments. Meta's guide defines function tools by JSON schema and says nothing of OpenAI's strict mode, so that is left off."""
    schema = FunctionTool(fn).get_openai_tool_schema()
    schema["function"].pop("strict", None)
    schema["function"].get("parameters", {}).pop("additionalProperties", None)
    return schema


def _tool(fn: Callable) -> FunctionTool:
    """A plain function as a tool. It runs on the event loop, where the swarm's events and records expect it (CAMEL would send a sync function to a thread, away from their context), and answers in JSON (CAMEL would send Python's repr)."""
    is_async = inspect.iscoroutinefunction(fn)

    @functools.wraps(fn)
    async def run(*a: Any, **k: Any) -> str:
        out = await fn(*a, **k) if is_async else fn(*a, **k)
        return json.dumps(out, ensure_ascii=False, default=str)

    tool = FunctionTool(run)
    tool.set_openai_tool_schema(schema_of(fn))
    return tool


async def turn(model: BaseModelBackend, instruction: str, tools: list[Callable], prompt: str, calls: int, on_usage: Callable[[int, int], None] | None = None, gate: Callable[[], None] | None = None) -> str:
    """One agent's turn, with fresh memory: at most `calls` model calls. The report is its last message alone, never what it said between tool calls. on_usage(prompt, output) hears every model call as it ends. gate runs before each one, and raises to stop the turn."""
    if gate:
        arun = model.arun

        async def gated(*a: Any, **k: Any) -> Any:
            gate()
            return await arun(*a, **k)
        model.arun = gated  # type: ignore[method-assign]

    def heard(payload: dict) -> None:
        if on_usage:
            used = payload["request_usage"]
            on_usage(used["prompt_tokens"], used["completion_tokens"])

    agent = ChatAgent(system_message=instruction, model=model, tools=[_tool(t) for t in tools], max_iteration=calls, summarize_threshold=None, token_limit=2_000_000, retry_attempts=1, on_request_usage=heard)  # summarizing would add model calls nobody asked for
    response = await agent.astep(prompt)
    if response.terminated:
        raise TurnLimit(f"the turn ended early: {', '.join(response.info.get('termination_reasons') or ['no reason given'])}")
    last = agent.memory.get_context()[0][-1]
    if last.get("role") == "tool":
        raise TurnLimit(f"the turn reached its limit of {calls} model calls before its report")
    return "\n".join(str(m.content).strip() for m in response.msgs if m.content).strip()

"""An offline model for a real package: it plays what the agents would answer, at no cost, quoting real words from the pages it is given so that code's checks run for real. It proves the wiring and the checks, and says nothing about how well a model plans."""

from __future__ import annotations

import json
import re
from typing import Any

from .llm import Scripted


class MockPackageLlm(Scripted):
    def __init__(self, model: str = "mock", agent_key: str = "", delay: float = 0.0):
        super().__init__(model, delay)
        self.agent_key = agent_key
        self.message = ""

    def _reply(self, messages: list[dict], tools: list[dict] | None) -> Any:
        self.message = next((str(m.get("content") or "") for m in reversed(messages) if m.get("role") == "user"), "")
        return super()._reply(messages, tools)

    def quotes(self) -> list[dict]:
        """A sentence from each page it was given, letter for letter."""
        out = []
        for doc, page, body in re.findall(r"\[(\S+) page (\d+)\]\n(.*?)(?=\n\n\[|\Z)", self.message, re.S):
            lines = [" ".join(x.split()) for x in body.splitlines() if len(x.split()) >= 5]
            if lines:
                out.append({"doc": doc, "page": int(page), "quote": lines[0]})
        return out

    def answer(self, results: dict, tools: set[str]) -> str:
        key = self.agent_key
        if key == "director":
            return json.dumps({"summary": "Scripted: what is being built and how the work is organised.\n\nScripted: nothing here is a model's reading.", "watch": ["Scripted: the first thing to settle, and why it matters."]})
        if key == "controller":
            docs = re.findall(r"Document (\S+?), .*?, (\d+) pages", self.message)
            numbers = [x.split(":")[0].strip() for x in self.message.split("\n\n")[0].splitlines()[1:]]
            first = max(docs, key=lambda d: int(d[1]), default=None)
            return json.dumps({"pages": {n: [{"doc": first[0], "from": 1 + (i * 2) % max(int(first[1]) - 2, 1), "to": 3 + (i * 2) % max(int(first[1]) - 2, 1)}] for i, n in enumerate(numbers)} if first else {}})
        if key.startswith("planner"):
            q = self.quotes()
            head = q[:1] or []
            return json.dumps({"scope": "Scripted scope: the work of this package, as its pages describe it.", "deliverable": "Scripted: the finished work, accepted by the supervising consultant.", "acceptance": "Scripted: inspected against the pages cited.", "responsible": "Site engineer", "assumptions": ["Scripted: nothing here is a model's reading."],
                               "sections": [{"name": "Preparation", "tasks": [{"ref": "t1", "kind": "operation", "name": "Set out and prepare the work", "after": [], "share_pct": 30, "crew": [{"role": "Pekerja", "count": 4}, {"role": "Tukang", "count": 2}], "equipment": ["Hand tools"], "materials": ["As the pages specify"], "procedure": ["Read the pages cited.", "Set out the work.", "Check the setting out with the site engineer."], "safety": "Wear the protective equipment the pages require.", "criteria": "", "hold_point": False, "sources": head}]},
                                            {"name": "Execution", "tasks": [{"ref": "t2", "kind": "inspection", "name": "Inspect before the work is covered", "after": ["t1"], "share_pct": 10, "crew": [{"role": "QC engineer", "count": 1}], "equipment": [], "materials": [], "procedure": ["Check the work against the pages cited.", "Ask the supervising consultant to sign."], "safety": "", "criteria": "As the pages cited require.", "hold_point": True, "sources": q[1:2] or head},
                                                                            {"ref": "t3", "kind": "operation", "name": "Carry out the work", "after": ["t2"], "share_pct": 60, "crew": [{"role": "Tukang", "count": 6}], "equipment": ["As needed"], "materials": ["As the pages specify"], "procedure": ["Carry out the work as the pages require.", "Keep the area clean."], "safety": "Keep the work area barricaded.", "criteria": "", "hold_point": False, "sources": q[2:3]}]}],
                               "questions": [{"subject": "Scripted question", "question": "Scripted: the pages do not give the sizes this work needs.", "to": "Supervising consultant", "why": "A crew cannot start without them."}]})
        rows = [(m[0], int(m[1]), int(m[2])) for m in re.findall(r"^(\S+): .*?, weeks (\d+) to (\d+)$", self.message, re.M)]
        if key == "engineer" and rows:  # the network, given the schedule's work. Without it, the engineer is asked for the breakdown itself, below
            ordered = sorted(rows, key=lambda r: r[1])
            return json.dumps({"links": [{"before": a[0], "after": b[0], "why": "Scripted: the next in the schedule."} for a, b in zip(ordered, ordered[1:]) if a[0].startswith("II") and b[0].startswith("II")]})
        written = re.findall(r"^row (\S+): (.*?), weeks", self.message, re.M)
        if key == "engineer" and written:
            return json.dumps({"accounts": [{"name": "Scripted account", "packages": [{"row": no, "name": name} for no, name in written]}], "not_in_schedule": []})
        if key == "reviewer":
            q = self.quotes()
            return json.dumps({"findings": [{"tag": "DOCUMENT_CONFLICT", "subject": "Scripted finding", "note": "Scripted: these are real words from the documents, and no model compared them.", "sources": q[:2]}, {"tag": "OTHER", "subject": "Made up", "note": "Scripted: this quotes words that are not in any document, so code must drop it.", "sources": [{"doc": "UP-001", "page": 1, "quote": "these words are in no document at all"}]}] if q else [],
                               "questions": [{"subject": "Scripted question for the whole project", "question": "Scripted: which document governs if they differ?", "to": "Supervising consultant", "why": "It decides every conflict."}]})
        return json.dumps({"weeks": 8, "estimated": True, "accounts": [{"no": "I", "name": "Scripted account", "packages": [{"no": "I.1", "name": "Scripted work", "weight": 100, "start_week": 1, "finish_week": 8}]}]})

"""The operator: one Muse agent a person can ask anything about the project, in the AI Agent Analysis tab.

Replicated from the ai-jkn-audit AIP Operator (web/src/components/aip/Operator.tsx there, api/aip/adk_runtime/operator.py), with DeepSeek swapped for Muse Spark on the Meta Model API. One agent reads the project through a tool per app, says what it read, and answers in markdown; code checks every figure in the answer against what the tools actually returned, and one correction turn puts right anything that does not check out. The conversation is a chain of runs: a follow-up names the run it follows, and the server reads that thread back, so a reload picks the conversation up where it was.

The operator only reads. Anything it proposes is for a person to do in the module that owns it.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from . import llm, memory, module_agents as A, modules as M, project as P
from .firm import PRICE, SPARK, numbers_in

Emit = Callable[[dict], None]
MAX_USD = 0.25  # one question's ceiling: a chat answer never needs a review's budget
CLIP = 6000

INSTRUCTION = """You are the Muse AI Agent for a construction project management system: the person asking can ask anything, and you answer from the project's live records, which you read through your tools. You are the operator of the whole system, in the spirit of Palantir's AIP Operator: one assistant above every tab.

Rules:
- Read before you answer. Call the tools that bear on the question; a question about one module is answered from that module's records, and a broad question reads the overview first.
- Every figure you state (a count, a date, an amount, a percentage) must come from a tool result in this conversation. Code checks your answer against them and will make you correct it. If the records do not hold something, say so plainly instead of estimating.
- Cite the records you rest on by their ids (RFI-035, NCR-014, WP-02, UP-003), so the person can open them.
- Answer in the language of the question. Use markdown: a short lead answer, then the detail, with a table when comparing things.
- You only read and advise. When action is needed, name the module and the record where a person does it; never claim you changed anything.
- What people decided and learned earlier (given below when there is any) is context, never evidence: the records alone are evidence."""


def _clip(obj: Any, limit: int = CLIP) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)[:limit]


class _Tools:
    """One tool per app of the system. Every call is a step on the screen: what was read, in which app, and what came back."""

    def __init__(self, emit: Emit):
        self.emit = emit
        self.seen: list[str] = []

    def _step(self, tool: str, app: str, label: str, fn: Callable[[], Any]) -> Any:
        rid = f"r{len(self.seen) + 1}"
        self.emit({"type": "tool_mulai", "tool": tool, "app": app})
        out = fn()
        text = _clip(out, 4000)
        self.seen.append(text)
        self.emit({"type": "tool", "tool": tool, "app": app, "rid": rid, "label": label})
        self.emit({"type": "result", "rid": rid, "tool": tool, "title": label, "text": text[:1200]})
        return out

    def list(self) -> list[Callable]:
        emit_step = self._step

        def ringkasan_proyek() -> dict:
            """The project at a glance: today's counts (tasks by status, documents, RFIs, NCRs, pending plans and decisions), the KPIs, the milestone, and what code says needs attention first."""
            o = P.overview()
            return emit_step("ringkasan_proyek", "tower", "Project overview", lambda: {"today": P.TODAY, "counts": o["counts"], "kpis": o["kpis"], "attention": o["attention"][:8]})

        def catatan_modul(module: str) -> dict:
            """The live records of one module, exactly as its agent reads them. module is one of: wbs, schedule, cost, kanban, documents, procurement, quality, tower."""
            if module not in A.BENCH:
                return {"error": f"module must be one of: {', '.join(A.BENCH)}"}
            return emit_step("catatan_modul", module, f"{A.BENCH[module]['module']} records", lambda: json.loads(_clip(A.records_of(module))))

        def jadwal() -> dict:
            """The programme: every activity with its progress and whether it is critical, the delays code has worked out, and the milestone."""
            s = P.schedule()
            return emit_step("jadwal", "schedule", "Programme and delays", lambda: {"activities": [{"id": a["id"], "code": a["code"], "name": a["name"], "progress": a["progress"], "critical": a["critical"], "start": a["start"], "finish": a["finish"]} for a in s["activities"]], "delays": M.delays()[:6], "milestone": s["milestone"]})

        def anggaran() -> dict:
            """The money: budget, earned value, actual cost and forecast for the project and per work package (control account), with CPI and SPI."""
            b = P.budget()
            return emit_step("anggaran", "cost", "Budget and earned value", lambda: {"total": b["total"], "packages": [{"id": p["id"], "name": p["name"], "budget": p["budget"], "ev": p["ev"], "ac": p["ac"], "eac": p["eac"], "variance": p["variance"], "cpi": p["cpi"], "spi": p["spi"]} for p in b["packages"]]})

        def papan() -> dict:
            """The Kanban board: how many cards are to do, in progress, in review and done, what is stopped or overdue, and the bottlenecks code has found."""
            b = M.board()
            return emit_step("papan", "kanban", "Kanban board", lambda: {"counts": b["counts"], "bottlenecks": [{"text": x["text"], "level": x["level"]} for x in b["bottlenecks"][:6]], "waiting_plan": b["waiting"]})

        def risiko() -> dict:
            """The risk register: every risk scored probability by impact, highest first, with its owner, response and status."""
            r = M.risk_register()
            return emit_step("risiko", "risks", "Risk register", lambda: {"counts": r["counts"], "risks": [{"id": x["id"], "title": x["title"], "category": x["category"], "level": x["level"], "score": x["score"], "owner": x["owner"], "status": x["status"], "due": x["due"], "source": x["source"]} for x in r["risks"][:14]]})

        def dokumen(query: str) -> dict:
            """Search the document register by words in a document's title or what rules read from it. Returns the matching documents with the facts read from them."""
            words = [w.lower() for w in query.split() if len(w) > 2]

            def find() -> dict:
                hits = []
                for d in M.documents()["documents"]:
                    hay = f"{d['title']} {json.dumps(d['facts'], ensure_ascii=False)}".lower()
                    if not words or any(w in hay for w in words):
                        hits.append({"id": d["id"], "title": d["title"], "kind": d["kind"], "status": d["status"], "facts": d["facts"]})
                return {"documents": hits[:6], "of": len(hits)}

            return emit_step("dokumen", "documents", f"Documents: {query}", find)

        def analisis() -> dict:
            """The AI analysis of the planning documents: the proposed plan's status, what code flagged, where the documents disagree (both sides quoted, with document and page), what the package is missing, the assumptions the planners made, and the questions drafted for the consultant."""
            plan = M.live_plan()
            if not plan:
                return emit_step("analisis", "analysis", "The analysis of the documents", lambda: {"plan": None, "note": "The documents have not been analysed yet."})
            p = plan["plan"]
            reviews = plan.get("reviews") or {}
            return emit_step("analisis", "analysis", "The analysis of the documents", lambda: {"id": plan["id"], "status": plan["status"], "summary": plan.get("summary"), "missing": p.get("missing") or [], "flagged": [c["text"][:300] for c in p["checks"] if not c["ok"]][:20], "disagreements": [{"subject": f["subject"], "note": f["note"], "sources": [{k: s.get(k) for k in ("doc", "page", "quote")} for s in f.get("sources") or []]} for f in plan.get("findings") or []][:12], "assumptions": [{"work_package": v.get("no"), "assumed": v.get("assumptions")} for v in (p.get("packages") or {}).values() if v.get("assumptions")][:15], "questions_drafted": len(plan.get("rfi_drafts") or []), "decided_by_a_person": {"approved": sum(v["verdict"] == "approve" for v in reviews.values()), "rejected": sum(v["verdict"] == "reject" for v in reviews.values())}})

        def agen() -> dict:
            """What each module's agent last recommended, and how much of it still waits for a person to decide."""
            out = []
            for k, b in A.BENCH.items():
                adv = P.get("advice", k) or {}
                items = adv.get("items") or []
                out.append({"module": b["module"], "agent": b["name"], "looked": adv.get("at"), "summary": adv.get("summary", ""), "open": sum(1 for x in items if x["state"] == "open"), "findings": len(M.signals_for(b["tags"]))})
            return emit_step("agen", "analysis", "The module agents", lambda: out)

        def memori(query: str) -> dict:
            """What people decided and learned on this project, remembered by the agents. Context, never evidence."""
            return emit_step("memori", "analysis", "What the agents remember", lambda: [{"text": m["text"], "module": m["module"], "kind": m["kind"]} for m in memory.recall(query, limit=5)])

        return [ringkasan_proyek, catatan_modul, jadwal, anggaran, papan, risiko, dokumen, analisis, agen, memori]


def _foreign(answer: str, allowed: list[str]) -> list[str]:
    """Figures in the answer that no tool returned and the conversation does not hold. Code's check, as in the swarm: a number is either in the records or it is not stated. Leading zeros are one figure (AC-002 holds 2)."""
    canon = lambda n: n.lstrip("0") or "0"  # noqa: E731
    held: set[str] = set()
    for text in allowed:
        held |= {canon(n) for n in numbers_in(text)}
    return sorted((n for n in numbers_in(answer) if canon(n) not in held), key=lambda n: (len(n), n))


def thread_of(runs: dict, follow: str | None) -> list[dict]:
    """The conversation a follow-up continues: the run it follows, and that run's own follow, oldest first."""
    out: list[dict] = []
    seen: set[str] = set()
    x = follow
    while x and x not in seen and len(out) < 8:
        seen.add(x)
        r = runs.get(x)
        if not r or r["run"].get("kind") != "operator":
            break
        out.append({"q": r["run"].get("q", ""), "answer": r["run"].get("answer", "")})
        x = r["run"].get("follow")
    return list(reversed(out))


async def ask(q: str, thread: list[dict], tab: str, emit: Emit, model: Any = None) -> dict:
    """One question answered. `model` is a test seam: a CAMEL backend in place of Muse Spark."""
    tools = _Tools(emit)
    used = [0, 0]

    def count(i: int, o: int) -> None:
        used[0] += i
        used[1] += o

    def spent() -> float:
        price = PRICE[SPARK]
        return (used[0] * price[0] + used[1] * price[1]) / 1e6

    def gate() -> None:
        if spent() >= MAX_USD:
            raise RuntimeError(f"stopped at one question's spending limit of ${MAX_USD:.2f}")

    backend = model or llm.muse(SPARK, 8000, effort="low")
    past = "\n\n".join(f"Person: {t['q']}\nAgent: {t['answer'][:1500]}" for t in thread)
    lessons = memory.brief(memory.lessons(list(A.BENCH), q, 3))
    prompt = (f"The person is looking at the {tab or 'analysis'} tab.\n"
              + (f"Earlier in this conversation:\n{past}\n\n" if past else "")
              + f"Question: {q}")
    text = await llm.turn(backend, INSTRUCTION + lessons, tools.list(), prompt, 8, count, gate)
    for chunk in _chunks(text, 1):
        emit(chunk)
    bad = _foreign(text, [*tools.seen, q, past])
    emit({"type": "cek_angka", "ok": not bad, "foreign": bad[:10]})
    if bad:
        fix = (f"Rewrite the answer below. Keep its structure, its language, and every statement that rests on the tool results; state record ids whole (AC-002, never 002). "
               f"Remove or rephrase only the claims that use these figures, which no tool returned: {', '.join(bad[:10])}. Do not mention this correction or any check.\n\n{text}")
        text = await llm.turn(backend, INSTRUCTION, [], fix, 1, count, gate)
        for chunk in _chunks(text, 2):
            emit(chunk)
        bad = _foreign(text, [*tools.seen, q, past])
        emit({"type": "cek_angka", "ok": not bad, "foreign": bad[:10], "revised": True})
    emit({"type": "answer", "text": text, "model": SPARK})
    return {"answer": text, "usd": round(spent(), 5), "tokens": {"prompt": used[0], "output": used[1]}}


def _chunks(text: str, seg: int) -> list[dict]:
    """The answer in pieces, as it would stream: whole sentences, so the screen can show it being written."""
    parts = [p for p in text.replace("\n\n", "\n\n\x00").split("\x00")]
    out: list[dict] = []
    for part in parts:
        for piece in [s for s in part.split(". ") if s.strip()]:
            out.append({"type": "delta", "seg": seg, "text": piece if piece.endswith((".", "\n")) else piece + ". "})
    return out or [{"type": "delta", "seg": seg, "text": text}]

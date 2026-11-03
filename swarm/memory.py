"""What the project's agents carry from one look to the next, kept with mem0: what people decided, what failed inspections and answered RFIs taught, and notes people wrote.

Only people's actions go in. Nothing a model said does, so a model's mistake cannot come back later as something it remembers. And memory is context, not evidence: code still checks every recommendation against the live records alone.

Keeping a memory sends nothing anywhere. Told nothing, mem0 reports usage to PostHog and fetches notices from GitHub, so both are switched off below, before it is imported. It also downloads a model from Hugging Face if fastembed is installed, so fastembed stays out of requirements.txt. Its fact extraction (infer) stays off: that would spend a model call on every write, and could store what nobody said. What an agent remembers does reach Meta when that agent is asked on Muse, as part of its instructions, the same as its records.

Meta's API has no embedding model, so memories are matched by a small word matcher here. It finds the words and record ids two texts share, in English or Indonesian alike, with no download and no key. It does not find meaning: "timber" does not find "plywood".
"""

from __future__ import annotations

import atexit
import hashlib
import logging
import math
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import time
from functools import wraps
from pathlib import Path
from typing import Callable

from . import project as P

os.environ["MEM0_TELEMETRY"] = "False"  # on by default, and read once, when mem0 is imported. This is the only file that imports it
os.environ["MEM0_DIR"] = str(Path(tempfile.gettempdir()) / "siteswarm-mem0")  # else it makes ~/.mem0. All it keeps there is a random id

DIMS = 2048  # fewer, and unrelated texts collide often enough to reach FLOOR. More buys nothing, at 20 KB a memory
USER = "project"  # mem0 asks for a scope. Each project has its own folder, so one name is enough
DECIDED = ("dismissed", "accepted")
FLOOR = 0.12  # below this, two texts share too little to call one relevant to the other. The cases are in tests/test_memory.py
MOST = 2000
LONGEST = 1500
COMMON = frozenset("a an and are as at be but by can do for from had has have how if in into is it its need needs not of on or our that the their them they this to was we were what when will with you your".split())

_lock = threading.RLock()  # mem0's local stores fail when several threads use them, and the API runs requests on several
_open: tuple[Path, object] | None = None
_problem = ""


def vector(text: str) -> list[float]:
    """Each word, each part of a hyphenated id, and pieces of longer words, so "inspect" finds "inspection". A record's id counts double, because it says more than any word. A bare number or date counts half, because it says less: "Level 2" twice does not make two things related."""
    v = [0.0] * DIMS
    for word in re.findall(r"[^\W_]+(?:-[^\W_]+)*", (text or "").lower()):
        if word in COMMON:
            continue
        letters = any(c.isalpha() for c in word)
        parts = [(word, (2.0 if any(c.isdigit() for c in word) else 1.0) if letters else 0.5), *[(p, 0.5) for p in word.split("-") if letters and p != word]]
        if word.isalpha() and len(word) > 4:
            parts += [(word[i:i + 4], 0.5) for i in range(len(word) - 3)]
        for piece, weight in parts:
            h = int.from_bytes(hashlib.blake2b(piece.encode(), digest_size=8).digest(), "big")  # not hash(): that changes from run to run, and these vectors are kept
            v[h % DIMS] += weight if h >> 63 else -weight
    size = math.sqrt(sum(x * x for x in v))
    return [x / size for x in v] if size else [1.0, *[0.0] * (DIMS - 1)]


class Words:
    """The embedder mem0 is given in place of a model."""

    def embed(self, text: str, memory_action: str | None = None) -> list[float]:
        return vector(text)

    def embed_batch(self, texts: list[str], memory_action: str | None = None) -> list[list[float]]:
        return [vector(t) for t in texts]


def closeness(a: str, b: str) -> float:
    return sum(x * y for x, y in zip(vector(a), vector(b)))


def folder() -> Path:
    """A project's memory lives beside its records, and is never shared with another project's."""
    return P.DB.parent / "memory" / P.DB.stem


def _store():
    """The open project's store, one at a time: Qdrant locks its folder while it is open."""
    global _open
    path = folder()
    if _open and _open[0] == path:
        return _open[1]
    close()
    path.mkdir(parents=True, exist_ok=True)
    logging.getLogger("mem0").setLevel(logging.ERROR)  # it warns that spaCy and BM25 are missing: they are left out on purpose
    from mem0 import Memory

    nowhere = {"api_key": "not-used", "openai_base_url": "http://127.0.0.1:9/v1"}  # mem0 builds a model client whatever we use. infer=False never calls it, and if anything ever did, the text would go nowhere
    store = Memory.from_config({"vector_store": {"provider": "qdrant", "config": {"path": str(path), "on_disk": True, "embedding_model_dims": DIMS, "collection_name": "memories"}}, "embedder": {"provider": "openai", "config": nowhere}, "llm": {"provider": "openai", "config": nowhere}, "history_db_path": ":memory:"})  # its history keeps the words of what was deleted, so it is not written to disk. The audit trail says who did what
    store.embedding_model = Words()
    _open = (path, store)
    return store


def close() -> None:
    global _open
    with _lock:
        if _open:
            store, _open = _open[1], None
            try:
                store.close()
            finally:
                store.vector_store.client.close()  # store.close() leaves this open, and with it the lock on the folder


atexit.register(close)


def _safe(fallback: Callable):
    """Memory helps, and must never stop a person's action or an agent's run. If it fails, the app carries on without it and status() says why."""

    def wrap(fn):
        @wraps(fn)
        def run(*a, **k):
            global _problem
            try:
                out = fn(*a, **k)
                _problem = ""
                return out
            except Exception as e:
                _problem = f"{type(e).__name__}: {e}"[:300]
                return fallback()

        return run

    return wrap


def _scope(module: str = "") -> dict:
    return {"user_id": USER, **({"agent_id": module} if module else {})}


def _row(m: dict) -> dict:
    return {"id": m["id"], "text": m["memory"], "module": m.get("agent_id") or "", **(m.get("metadata") or {}), **({"score": round(m["score"], 3)} if m.get("score") is not None else {})}


def _write(text: str, module: str, kind: str, ref: str = "", by: str = P.PM, **extra) -> dict | None:
    """What comes in with the same kind and ref replaces the older one: a corrected figure, a document marked again, work accepted a second time. A note has no ref, and the same words are kept once."""
    text = " ".join(text.split())[:LONGEST]
    if not text:
        return None
    with _lock:
        for m in of(module):
            if m["kind"] != kind:
                continue
            if ref and m.get("ref") == ref:
                _store().delete(m["id"])
            elif not ref and m["text"] == text:
                return m
        meta = {"kind": kind, "ref": ref, "by": by, "on": time.strftime("%Y-%m-%d %H:%M"), **extra}  # mem0 stamps its own created_at in UTC: a person reads this one
        out = _store().add(text, user_id=USER, agent_id=module, metadata=meta, infer=False)
    return {"id": out["results"][0]["id"], "text": text, "module": module, **meta}


@_safe(lambda: None)
def remember(text: str, module: str, kind: str, ref: str = "", by: str = P.PM, **extra) -> dict | None:
    return _write(text, module, kind, ref, by, **extra)


@_safe(list)
def of(module: str = "") -> list[dict]:
    """Everything remembered, or one module's, newest first."""
    if not folder().exists():
        return []
    with _lock:
        rows = _store().get_all(filters=_scope(module), top_k=MOST)["results"]
    return sorted(map(_row, rows), key=lambda m: m.get("on", ""), reverse=True)


@_safe(list)
def recall(query: str, module: str = "", limit: int = 5, floor: float = FLOOR) -> list[dict]:
    """What bears on this text, closest first. What people decided about a recommendation is for decisions(), and left out."""
    if not query.strip() or not folder().exists():
        return []
    with _lock:
        rows = _store().search(query[:LONGEST * 4], filters=_scope(module), top_k=max(limit * 4, 20), threshold=floor)["results"]
    return [m for m in map(_row, rows) if m["kind"] not in DECIDED][:limit]


def decisions(module: str) -> list[dict]:
    return [m for m in of(module) if m["kind"] in DECIDED]


def lessons(modules: list[str], query: str, limit: int = 8) -> list[dict]:
    """For an agent about to work: what is known on the modules it works on, newest first, then what bears on this text from anywhere in the project."""
    own = sorted((m for k in modules for m in of(k) if m["kind"] not in DECIDED), key=lambda m: m.get("on", ""), reverse=True)[:max(limit - 3, 1)]
    seen = {m["id"] for m in own}
    return [*own, *[m for m in recall(query, limit=limit) if m["id"] not in seen]][:limit]


def brief(rows: list[dict]) -> str:
    """Lessons, for an agent's instructions. Nothing at all if there are none, so an agent with no memory gets the same instructions as before."""
    if not rows:
        return ""
    return "\nWhat people on this project decided or learned before. It is context, not evidence: do not cite it, and use only figures and references from the records.\n" + "\n".join(f"- {m['on'][:10]}: {m['text'][:240]}" for m in rows)


def sign(item: dict) -> str:
    """A recommendation's words. The offline rules repeat them exactly until the figures behind them change."""
    return hashlib.sha1(" ".join(f"{item['title']} {item['why']}".lower().split()).encode()).hexdigest()


@_safe(lambda: None)
def decided(module: str, item: dict, who: str = P.PM) -> dict | None:
    word = "Dismissed" if item["state"] == "dismissed" else "Accepted"
    return _write(f"{word}: {item['title']}. {item['why']}", module, item["state"], sign(item), who, sign=sign(item), refs=",".join(item["refs"]), made=item.get("made") or "")


def note(text: str, module: str, who: str = P.PM) -> dict:
    """A person writes down what the agents should know."""
    if not text.strip():
        raise ValueError("write what the agents should remember")
    try:
        row = _write(text, module, "note", "", who)
    except Exception as e:
        raise ValueError(f"memory is not available: {e}") from e
    P.log(who, "noted something for the agents", "memory", row["id"], module)
    return row


def forget(mid: str, who: str = P.PM) -> dict:
    """Out of what the agents read, and off the disk: SQLite keeps a deleted row's words in its free pages until it is vacuumed. The audit trail says that it was forgotten, and not what it said."""
    with _lock:
        row = next((m for m in of() if m["id"] == mid), None)
        if row is None:
            raise KeyError(mid)
        try:
            _store().delete(mid)
            close()
            for file in folder().rglob("*.sqlite"):
                db = sqlite3.connect(file)
                db.execute("VACUUM")
                db.close()
        except Exception as e:
            raise ValueError(f"memory is not available: {e}") from e
    P.log(who, "forgot a memory", "memory", mid, row["module"])
    return row


def clear() -> None:
    """Everything this project remembered: a scenario starting over remembers nothing of the last time."""
    with _lock:
        if _open and _open[0] == folder():
            close()
        shutil.rmtree(folder(), ignore_errors=True)
        if folder().exists():
            raise ValueError(f"could not clear the memory in {folder()}")


def status() -> dict:
    count = len(of())
    return {"on": not _problem, "problem": _problem, "count": count, "folder": str(folder())}


@_safe(lambda: None)
def warm() -> None:
    """mem0 takes a second or two to load: done at start, so that nobody's first click waits for it."""
    with _lock:
        from mem0 import Memory  # noqa: F401

        if folder().exists():
            _store()


# ------------------------------------------------------------------------------------------------ what people's actions teach


def _failed(rid: str, ncr: str) -> tuple[str, str]:
    return f"{rid} failed inspection: {(P.get('ncr', ncr) or {}).get('title', '')}", ncr


def _closed(rid: str, _: str) -> tuple[str, str]:
    n = P.get("ncr", rid)
    return f"{rid} closed: {n['title']}. What fixed it: {n['action'] or 'not recorded'}", rid


def _answered(rid: str, _: str) -> tuple[str, str]:
    r = P.get("rfi", rid)
    return f"{rid} answered: {r['subject']}. {r['answer']}", rid


def _said(what: str) -> Callable:
    """A decision on a plan teaches something only if the person said why."""
    return lambda rid, note_: (f"{what} {rid}: {note_}", rid) if note_.strip() else None


def _actuals(pid: str, detail: str) -> tuple[str, str] | None:
    """Worth carrying forward only if the work took more or less than the plan said: a tenth out on hours, or any material over."""
    step_id = detail.split(":")[0]
    rec = P.get("plan", pid)
    step = next(s for s in rec["plan"]["steps"] if s["id"] == step_id)
    got = rec["actuals"][step_id]
    said = []
    if got.get("man_hours") is not None and abs(got["man_hours"] - step["man_hours"]) > 0.1 * step["man_hours"]:
        said.append(f"{got['man_hours']:g} man-hours against {step['man_hours']:g} planned")
    for m in step["materials"]:
        used = (got.get("materials") or {}).get(m["key"])
        if used is not None and used > m["gross"]:
            said.append(f"{used:,g} {m['unit']} of {m['name']} against {m['gross']:,.1f} planned")
    # no lesson still replaces an earlier one, so a corrected figure leaves nothing wrong behind
    return (f"{step_id} ({step['name']}) took {'; '.join(said)}.", f"{pid}/{step_id}") if said else ("", f"{pid}/{step_id}")


def _document(rid: str, title: str) -> tuple[str, str] | None:
    d = P.get("document", rid) or {}
    if d.get("note"):
        return f"{rid} ({title}) marked {d['status']}: {d['note']}", rid
    return (f"{rid} ({title}) rejected.", rid) if d.get("status") == "rejected" else None


TEACHES = {"failed an inspection": ("quality", "inspection", _failed), "closed an NCR": ("quality", "ncr", _closed), "recorded an RFI answer": ("documents", "rfi", _answered), "rejected the work plan": ("wbs", "plan", _said("Rejected work plan")), "approved the work plan": ("wbs", "plan", _said("Approved work plan")), "rejected the recovery plan": ("schedule", "recovery", _said("Rejected recovery plan")), "approved the recovery plan": ("schedule", "recovery", _said("Approved recovery plan")), "recorded actuals": ("cost", "actuals", _actuals), "marked a document": ("documents", "document", _document)}


def _heard(who: str, action: str, kind: str, rid: str, detail: str) -> None:
    """Told of every line of the audit trail, and keeps the ones that teach something. Agents are not listened to: only people's actions go in."""
    teaches = TEACHES.get("marked a document" if action.startswith("marked a document") else action)
    if teaches and who != P.SWARM:
        _learn(*teaches, rid, detail, who)


@_safe(lambda: None)
def _learn(module: str, kind: str, make: Callable, rid: str, detail: str, who: str) -> None:
    lesson = make(rid, detail)
    if not lesson:
        return
    text, ref = lesson
    if text:
        _write(text, module, kind, ref, who)
        return
    with _lock:
        for m in of(module):
            if m["kind"] == kind and m.get("ref") == ref:
                _store().delete(m["id"])


P.listeners.append(_heard)

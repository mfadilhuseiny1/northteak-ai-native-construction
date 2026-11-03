"""The swarm: one review of a site disruption, worked by agents as a firm works one. Adapted from the author's earlier agent swarm
(see README, "What was reused"): the phases, handoffs, code scrutiny, QA, red team and report flow are that engine's, on construction data.

    penugasan    code runs its checks; the orchestrator reads the disruption and writes the plan and the validation contract, before any worker starts
    lapangan     analysts read their own sources side by side and flag signals, each citing evidence it read itself
    register     code ranks what is exposed, from the signals and the critical path
    investigasi  one analyst per recovery option rules on it; code works out its schedule and cost
    sintesis     each domain lead merges its analysts' work
    qa           reviewers on the other model recheck each synthesis; the red team attacks the leading options
    laporan      the orchestrator writes the recovery plan; the validator judges it against the contract; the project manager decides

Plain code runs the review: who works when, how many at once, what each receives. Nothing an agent does changes anything on site: a ruling
is a recommendation, a message is a draft, and a person decides both. Every step is an event, which the page draws.
"""

from __future__ import annotations

import asyncio
import contextvars
import functools
import json
import re
import time
from typing import Any, Callable

from . import llm, project, site_case as C, vision
from .connectors import McpHub
from .data import ProjectData

SPARK, WONDER = "muse-spark-1.3", "muse-wonder-1.0"
PRICE = {SPARK: (1.25, 4.25), WONDER: (4.00, 20.00)}  # USD per 1M tokens, listed prices; the standard tier, never the contributor one
CONCURRENT = 8
TRIES = 3
PAUSE = 15
CALLS = {"analis": 10, "manajer": 6, "option": 10, "qa": 6, "red_team": 6, "partner": 8, "validator": 6, "section": 14, "planner": 16}
PHASES = [("penugasan", "Assign"), ("lapangan", "Field reading"), ("register", "Risk register"), ("investigasi", "Option analysis"), ("sintesis", "Synthesis"),
          ("qa", "QA & red team"), ("laporan", "Recovery plan")]
SIGNALS = ["SUPPLY_DELAY", "CREW_SHORT", "HOLD_POINT_OPEN", "WEATHER_RISK", "MIX_NOT_APPROVED", "DESIGN_CONSTRAINT", "SUBCONTRACTOR_REWORK", "SUBCONTRACTOR_CAPACITY", "NOTICE_DUE",
           "COST_EXPOSURE", "SCHEDULE_CRITICAL", "RFI_OPEN", "OTHER"]
HANDOFF_ASK = 'End with ONE handoff line for the orchestrator, the validator and the next agent: HANDOFF {"done": ["what you finished, with key figures"], "left_undone": ["what you could not do"], "issues_found": ["problems you found"]}'
def lessons_for(a: dict) -> str:
    """What people decided and learned on the modules this agent works with. Empty until there is something, so its instructions stay as they were."""
    from . import module_agents  # it imports this file

    return module_agents.lessons_for(a)


RULES = """Rules of the firm:
- Use only what your tools returned. Never invent a fact, date, name or number. Cite evidence IDs.
- If your sources cannot settle something, say so. You read only your own sources, so do not guess what others hold.
- You recommend; you decide nothing. People decide. A message you write is a draft.
- Call things discrepancies or risks. Never accuse anyone."""

_emit: contextvars.ContextVar[Callable[[dict], None]] = contextvars.ContextVar("emit", default=lambda ev: None)


def emit(ev: dict) -> None:
    """One event for the page."""
    _emit.get()({"t": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()), **ev})


def roster() -> tuple[list[dict], list[dict]]:
    """(the team, why each line has the size it has)."""
    leads = [("site", "Site operations", "site"), ("subcontract", "Subcontractors", "subcontract"), ("procurement", "Procurement", "procurement"), ("planning", "Planning", "planning"),
             ("cost", "Cost control", "cost"), ("quality", "Quality & safety", "quality"), ("contract", "Contract", "contract")]
    team = [{"key": "partner", "name": "Orchestrator", "peran": "reads the disruption, writes the plan and validation contract, writes the recovery plan", "lini": "pimpinan", "jenjang": "partner", "induk": None, "model": WONDER, "peran_kode": "partner"}]
    for key, name, line in leads:
        team.append({"key": key, "name": f"{name} lead", "peran": f"leads {name.lower()}: merges its analysts' work for the orchestrator", "lini": line, "jenjang": "manajer", "induk": "partner", "model": SPARK, "peran_kode": "manajer"})
    team.append({"key": "validator", "name": "Validator", "peran": "leads QA and the red team, judges the recovery plan against the contract, on the other model", "lini": "qa", "jenjang": "manajer", "induk": "partner", "model": WONDER, "peran_kode": "validator"})
    for key, lead, name, peran, target in ANALYSTS:
        team.append({"key": key, "name": name, "peran": peran, "lini": lead, "jenjang": "analis", "induk": lead, "model": SPARK, "peran_kode": "analis", "target": target})
    for key, _, _ in leads:
        team.append({"key": f"qa_{key}", "name": f"QA reviewer · {key}", "peran": f"rechecks the {key} synthesis against the sources", "lini": "qa", "jenjang": "analis", "induk": "validator", "model": WONDER, "peran_kode": "qa", "target": {"lead": key}})
    team.append({"key": "option_analyst", "name": "Option analyst", "peran": "one instance per recovery option: tests it against every source and rules on it", "lini": "planning", "jenjang": "peran", "induk": "planning", "model": SPARK, "peran_kode": "option", "target": {"kapasitas": len(C.OPTIONS)}})
    team.append({"key": "red_team", "name": "Red team", "peran": "one instance per leading option: tries to break it", "lini": "qa", "jenjang": "peran", "induk": "validator", "model": WONDER, "peran_kode": "red_team", "target": {"kapasitas": 2}})
    why = [{"lini": line, "agen": sum(1 for a in team if a["lini"] == line and a["jenjang"] == "analis"), "alasan": REASON.get(line, "")} for _, _, line in leads]
    return team, why


REASON = {"site": "one analyst per level in play, one for the crew", "subcontract": "one analyst per subcontract package", "procurement": "the usual supplier and the backup",
          "planning": "the critical path and the resources", "cost": "exposure and rates", "quality": "hold points and weather", "contract": "RFIs, notices and recovery of costs"}
# key, line, name, what it does, what it works on (what its tools may read)
ANALYSTS = [
    ("site_l3", "site", "Site analyst · Level 3", "what the Level 3 logs, photos and site messages say about the pour", {"level": "Level 3", "channels": ["slack"], "kinds": []}),
    ("site_l2", "site", "Site analyst · Level 2", "whether Level 2 work is affected", {"level": "Level 2", "channels": ["slack"], "kinds": []}),
    ("site_crew", "site", "Crew analyst", "crew numbers against what the pour needs", {"channels": ["slack"], "kinds": ["manpower"]}),
    ("sub_besi", "subcontract", "Subcontractor · PT Besi Karya", "reinforcement: rework, programme and obligations", {"sub": "besi", "channels": ["whatsapp", "slack"], "kinds": ["subcontract", "inspection", "rfi"]}),
    ("sub_rangka", "subcontract", "Subcontractor · CV Rangka Beton", "formwork: capacity to win time back and what it needs", {"sub": "rangka", "channels": ["whatsapp"], "kinds": ["subcontract", "rfi"]}),
    ("sub_bata", "subcontract", "Subcontractor · CV Bata Mandiri", "masonry: whether it is on programme and affected", {"sub": "bata", "channels": ["slack"], "kinds": ["subcontract"]}),
    ("sub_arus", "subcontract", "Subcontractor · PT Arus Prima", "MEP: whether it is on programme and affected", {"sub": "arus", "channels": ["slack"], "kinds": ["subcontract"]}),
    ("proc_concrete", "procurement", "Procurement · usual supplier", "the concrete order, the breakdown and when delivery is firm", {"channels": ["whatsapp"], "kinds": ["purchase_order"]}),
    ("proc_backup", "procurement", "Procurement · backup and pump", "what a backup supplier and the pump hire need", {"channels": ["whatsapp", "gmail"], "kinds": ["cost"]}),
    ("plan_critical", "planning", "Planning · critical path", "the critical path and the milestone", {"schedule": True, "kinds": ["contract", "rfi"]}),
    ("plan_resources", "planning", "Planning · resources", "which activities and who a move would touch", {"schedule": True, "kinds": ["manpower", "subcontract"]}),
    ("cost_exposure", "cost", "Cost · exposure", "what delay would cost under the contract", {"schedule": True, "kinds": ["contract", "cost"]}),
    ("cost_recovery", "cost", "Cost · recovery", "what can be recovered, and from whom", {"kinds": ["purchase_order", "subcontract", "cost"]}),
    ("qa_holdpoint", "quality", "Quality · hold points and mixes", "what must be signed or approved before concrete", {"channels": ["slack"], "kinds": ["inspection", "spec"]}),
    ("qa_weather", "quality", "Safety · weather", "weather against the placing rules", {"kinds": ["weather", "spec"]}),
    ("contract_rfi", "contract", "RFI coordinator", "the RFI log: who owes what, what each open RFI holds up, and any new RFI needed", {"kinds": ["rfi"], "schedule": True, "rfis": True}),
    ("contract_notice", "contract", "Contract · notices", "what must be notified, by when, and drafts it", {"channels": ["gmail"], "kinds": ["contract"], "drafts": True}),
    ("contract_claims", "contract", "Contract · claims", "who carries the risk of each cause", {"kinds": ["contract", "purchase_order", "subcontract"]}),
]


PLACE = {"site": "on site", "subcontract": "on site", "procurement": "commercial", "cost": "commercial", "contract": "commercial", "planning": "controls", "quality": "controls"}


def catalogue() -> dict:
    """The Agents tab: each lead with the sources it owns."""
    types_of = {"site": ["Daily logs", "Site photos", "Crew roster"], "subcontract": ["Subcontracts", "Subcontractor messages", "Programme"], "procurement": ["Purchase orders", "Supplier messages"],
                "planning": ["Schedule", "Critical path"], "cost": ["Rates", "Exposure"], "quality": ["Hold points", "Mix register", "Weather", "Specification"], "contract": ["General conditions", "RFI log", "Notices"]}
    agents = []
    for key, objects in types_of.items():
        agents.append({"key": key, "name": f"{key.capitalize()} lead", "description": REASON.get(key, ""), "group_id": None, "model": SPARK, "tools": ["read_team_reports", "read_signals", "propose_work_item"], "peta": PLACE[key],
                       "subagents": [{"key": a[0], "name": a[2], "technique": a[3], "family": SPARK} for a in ANALYSTS if a[1] == key],
                       "object_types": [{"id": f"{key}-{i}", "name": n, "api_name": n, "primary_key": "id", "title": n, "description": "", "properties": []} for i, n in enumerate(objects)]})
    return {"agents": agents, "roles": {"planner": WONDER, "writer": WONDER, "auditor": WONDER, "screen": ""}, "links": []}


def documents_of(kind: str) -> dict:
    """Project documents of one kind, with the live records behind them; the RFI log is one of them."""
    return project.documents(kind)


def parse_json(text: str) -> Any:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return None
    for body in (m.group(0), re.sub(r",(\s*[}\]])", r"\1", m.group(0))):  # a model can leave a line break inside a string, or a comma after the last item
        try:
            return json.loads(body, strict=False)
        except ValueError:
            continue
    return None


def split_handoff(text: str) -> tuple[str, dict]:
    m = re.search(r"HANDOFF\s*(\{.*\})\s*$", text or "", re.S)
    if not m:
        return (text or "").strip(), {}
    try:
        return text[:m.start()].strip(), json.loads(m.group(1))
    except ValueError:
        return text[:m.start()].strip(), {}


def numbers_in(text: str) -> set[str]:
    return {re.sub(r"[.,]", "", re.sub(r"[.,]00$", "", n)) for n in re.findall(r"\d[\d.,]*\d|\d", text or "")}  # "316.00" in a table and "316" in a sentence are one figure


class Firm:
    signals = SIGNALS

    def __init__(self, model_of: Callable[[str, str, int], Any], max_usd: float, brief: str, focus: str = "", mock: bool = False, parallel: int | None = None):
        self.model_of, self.max_usd, self.brief, self.focus, self.mock = model_of, max_usd, brief, focus, mock
        self.team = {a["key"]: dict(a) for a in roster()[0]}
        self.sem = asyncio.Semaphore(parallel or CONCURRENT)
        self.cool_until = 0.0
        self.usage: dict[str, dict] = {}
        self.receipts: dict[str, list[dict]] = {}
        self.seen: dict[str, set[str]] = {}
        self.reports: dict[str, str] = {}
        self.handoffs: dict[str, dict] = {}
        self.ledger: dict[tuple[str, str], dict] = {}
        self.rulings: dict[str, dict] = {}
        self.drafts: list[dict] = []
        self.rfi_drafts: list[dict] = []
        self.proposed: list[dict] = []
        self.chosen: str | None = None
        self.report = ""
        self.attacks: dict[str, dict] = {}
        self.numbers: set[str] = set()
        self.refused: list[str] = []
        self.rid = 0
        self.spent = 0.0
        self.stopped = ""
        self.hub = McpHub()
        self.data = ProjectData.load()
        self.vision = vision.MockVision(self.data.folder) if mock else vision.MuseVision(self.data.folder)

    # -------------------------------------------------------------------------------------------- tools

    def tool(self, key: str, fn: Callable) -> Callable:
        """Every tool call leaves a receipt: what was asked, how it ended, what it returned. The evidence an agent may cite is what it read."""
        is_async = asyncio.iscoroutinefunction(fn)

        def book(out: Any, t0: float, args: dict) -> Any:
            ok = not (isinstance(out, dict) and (out.get("error") or out.get("refused")))
            self.rid += 1
            rid = f"r{self.rid}"
            text = json.dumps(out, ensure_ascii=False, default=str)
            ids = set(re.findall(r"\b(?:DOC-[A-Z0-9-]+|PLAN-[A-Z0-9-]+|MSG-[A-Z]\d+|RFI-\d+|LOG-\d+|P-[A-Z]+-\d+-[A-Z])\b", text))
            self.seen.setdefault(key, set()).update(ids)
            self.numbers |= numbers_in(text)
            summary = (out.get("refused") or out.get("error") or out.get("summary") or text) if isinstance(out, dict) else text
            rec = {"tool": fn.__name__, "summary": str(summary)[:200], "ok": ok, "rid": rid}
            self.receipts.setdefault(key, []).append(rec)
            emit({"type": "tool", "agent": key, "tool": fn.__name__, "args": args, "ok": ok, "ms": int((time.time() - t0) * 1000), "summary": rec["summary"], "rid": rid})
            return out

        if is_async:
            @functools.wraps(fn)
            async def wrapped(*a, **k):
                t0 = time.time()
                return book(await fn(*a, **k), t0, k)
        else:
            @functools.wraps(fn)
            def wrapped(*a, **k):
                t0 = time.time()
                return book(fn(*a, **k), t0, k)
        return wrapped

    def read_tools(self, key: str, target: dict) -> list[Callable]:
        tools: list[Callable] = []
        kinds, channels = target.get("kinds") or [], target.get("channels") or []
        if kinds:
            def read_documents(kind: str) -> dict:
                """Read project documents of one kind. The kinds open to you are listed in your instructions."""
                if kind not in kinds:
                    return {"refused": f"not your source. Yours: {', '.join(kinds)}"}
                return documents_of(kind)
            tools.append(read_documents)
        if channels:
            async def read_messages(channel: str, query: str = "") -> dict:
                """Read messages from one channel over MCP. query: words that must appear, empty for all."""
                if channel not in channels:
                    return {"refused": f"not your channel. Yours: {', '.join(channels)}"}
                return await self.hub.call("read_messages", channel=channel, query=query)
            tools.append(read_messages)
        if target.get("level"):
            level = target["level"]

            def read_daily_logs() -> dict:
                """Daily log entries for your level, as the foremen wrote them."""
                return {"entries": [{k: e.get(k) for k in ("id", "date", "area", "author", "text", "crew", "weather", "verified")} for e in project.daily_reports(level)]}

            def list_site_photos() -> dict:
                """The site photos of your level."""
                return {"photos": [{k: p[k] for k in ("id", "date", "caption")} for p in self.data.photos if p["id"] in C.PHOTOS_BY_LEVEL.get(level, [])]}

            async def view_site_photo(photo_id: str) -> dict:
                """Look at one site photo: whether the work is visible, what is installed, the total."""
                photo = self.data.photo(photo_id)
                if not photo or photo_id not in C.PHOTOS_BY_LEVEL.get(level, []):
                    return {"refused": "no such photo at your level"}
                seen, used_in, used_out = await self.vision.inspect(photo)
                self.charge(key, SPARK, used_in, used_out)
                return seen
            tools += [read_daily_logs, list_site_photos, view_site_photo]
        if target.get("sub"):
            code = target["sub"]

            def subcontractor_record() -> dict:
                """Your subcontractor: its scope, crew and the activities it holds, with dates."""
                return project.subcontractor_detail(code)
            tools.append(subcontractor_record)
        if target.get("schedule"):
            def critical_path(pour_delay_days: int = 0) -> dict:
                """The schedule worked out by code: dates, float and the milestone, if the pour moves by this many days."""
                return project.schedule(int(pour_delay_days))
            tools.append(critical_path)
        if target.get("rfis"):
            def draft_rfi(subject: str, question: str, to: str, activity: str, why: str) -> dict:
                """Draft a new RFI when the sources leave a question only someone outside can answer. It is NOT issued: a person issues it."""
                if not any(a[0] == activity for a in C.ACTIVITIES):
                    return {"refused": f"unknown activity {activity}"}
                rfi = {"subject": subject, "question": question, "to": to, "activity": activity, "impact": why, "drafted_by": key}
                self.rfi_drafts.append(rfi)
                emit({"type": "rfi_draft", **rfi})
                return {"status": "draft", "issued": False}
            tools.append(draft_rfi)
        if target.get("drafts"):
            async def draft_message(channel: str, to: str, text: str) -> dict:
                """Draft a message over MCP. It is NOT sent: the project manager approves it first."""
                out = await self.hub.call("draft_message", channel=channel, to=to, text=text)
                d = {"agent": key, "channel": channel, "to": to, "text": text, "sent": False}
                self.drafts.append(d)
                emit({"type": "message_draft", **d})
                return out
            tools.append(draft_message)
        return tools

    def flag_tool(self, key: str) -> Callable:
        def flag_signal(tag: str, subject: str, strength: str, evidence_ids: list[str], note: str) -> dict:
            """Flag one risk or discrepancy. tag: one of the signal types in your instructions. subject: an activity id such as A30, or an option id, or GENERAL. strength: lemah (weak), sedang (medium) or kuat (strong). Cite the IDs you read."""
            if tag not in self.signals:
                return {"refused": f"tag must be one of {', '.join(self.signals)}"}
            if strength not in ("lemah", "sedang", "kuat"):
                return {"refused": "strength must be lemah, sedang or kuat"}
            unread = [e for e in evidence_ids if e not in self.seen.get(key, set())]
            if not evidence_ids or unread:
                return {"refused": f"cite evidence you have read yourself: {', '.join(unread) or 'none given'}"}
            entry = self.ledger.setdefault((tag, subject), {"tag": tag, "subject": subject, "agents": [], "evidence": [], "notes": []})
            if key not in entry["agents"]:
                entry["agents"].append(key)
            entry["evidence"] = sorted(set(entry["evidence"]) | set(evidence_ids))
            entry["notes"].append(note)
            final = "kuat" if len(entry["agents"]) >= 2 else strength
            emit({"type": "tag", "agent": key, "id": f"{tag}:{subject}", "tag": tag, "entitas": "activity", "kunci": subject, "judul": f"{subject}: {note[:120]}", "kekuatan_agen": strength, "kekuatan": final,
                  "dukungan": len(entry["agents"]), "klasifikasi": "Internal"})
            return {"ok": True, "supporting_agents": len(entry["agents"])}
        return flag_signal

    def signals_tool(self) -> Callable:
        def read_signals() -> dict:
            """Every signal flagged so far, with who flagged it and its evidence."""
            return {"signals": list(self.ledger.values())}
        return read_signals

    def proposal_tool(self, key: str) -> Callable:
        def propose_work_item(title: str, owner: str, due: str, why: str, activity: str) -> dict:
            """Propose one action someone must take if the plan is approved. owner: who must do it. due: a date as YYYY-MM-DD. activity: the activity id it serves, or empty. It stays a proposal until a person approves the plan."""
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due or ""):
                return {"refused": "due must be a date as YYYY-MM-DD"}
            if activity and not any(a[0] == activity for a in C.ACTIVITIES):
                return {"refused": f"unknown activity {activity}"}
            item = {"title": title, "owner": owner, "due": due, "why": why, "activity": activity, "proposed_by": key}
            self.proposed.append(item)
            emit({"type": "work_item", "agent": key, **item})
            return {"status": "proposed", "open": False}
        return propose_work_item

    def team_tool(self, lead: str) -> Callable:
        def read_team_reports() -> dict:
            """The reports and handoffs of the analysts you lead."""
            mine = [k for k, a in self.team.items() if a.get("induk") == lead and a["jenjang"] == "analis"]
            return {"reports": {k: self.reports.get(k, "(no report)") for k in mine}, "handoffs": {k: self.handoffs.get(k, {}) for k in mine}}
        return read_team_reports

    # -------------------------------------------------------------------------------------------- one agent's turn

    def charge(self, key: str, model: str, used_in: int, used_out: int) -> None:
        price = PRICE.get(model, PRICE[WONDER])
        usd = (used_in * price[0] + used_out * price[1]) / 1e6
        u = self.usage.setdefault(key, {"usd": 0.0, "calls": 0, "prompt": 0, "output": 0, "model": model})
        u["usd"] += usd
        u["prompt"] += used_in
        u["output"] += used_out
        self.spent += usd
        if self.spent > self.max_usd and not self.stopped:
            self.stopped = f"stopped at the spending limit of ${self.max_usd:.2f}"
            emit({"type": "error", "agent": None, "message": self.stopped})

    async def turn(self, key: str, model: str, text: str, tools: list, prompt: str, calls: int) -> str:
        def count(used_in: int, used_out: int) -> None:
            self.charge(key, model, used_in, used_out)
            self.usage[key]["calls"] += 1

        def gate() -> None:
            if self.spent >= self.max_usd and not self.mock:
                if not self.stopped:
                    self.stopped = f"stopped at the spending limit of ${self.max_usd:.2f}"
                    emit({"type": "error", "agent": None, "message": self.stopped})
                raise RuntimeError(self.stopped)

        out = await llm.turn(self.model_of(key, model, 6000), text, tools, prompt, calls, count, gate)
        if not out:  # the turn ended before the report: what its steps established, said plainly
            rs = self.receipts.get(key, [])
            out = "(report not finished) Steps: " + "; ".join(f"{r['tool']} → {r['summary']}" for r in rs[-12:])
        return out

    def read(self, key: str) -> bool:
        """Whether the agent read anything: at least one tool call that answered."""
        return any(r.get("ok") for r in self.receipts.get(key, []))

    async def unread(self, key: str, a: dict, text: str, tools: list, prompt: str, calls: int) -> tuple[str, str]:
        """A report with no read behind it is not evidence: the turn runs once more on the other model, told why; still nothing read, and it is refused."""
        other = WONDER if a["model"] == SPARK else SPARK
        why = "a report with no tool call was refused, because it has no evidence"
        emit({"type": "error", "agent": key, "message": f"{why}: running the turn again on {other}"})
        try:
            out = await self.turn(key, other, text, tools, f"{prompt}\n\nIMPORTANT: your last report was refused because you called no tool. Call your tools first, then write only what they returned.", calls)
        except Exception as e:  # noqa: BLE001 - refused below when it still read nothing
            out = f"(failed: {type(e).__name__}: {str(e)[:200]})"
        if self.read(key):
            return out, "selesai"
        self.refused.append(key)
        return f"({why}: this agent read nothing, twice, so its content is not used)", "gagal"

    async def recover(self, key: str, a: dict, text: str, tools: list, prompt: str, calls: int, err: Exception) -> tuple[str, str]:
        """An agent whose turn failed is not lost: with steps done a model writes its report from them; with none the turn runs again; models alternate, the pause grows."""
        why = f"{type(err).__name__}: {str(err)[:200]}"
        other = WONDER if a["model"] == SPARK else SPARK
        last: Exception = err
        for attempt in range(TRIES):
            model = other if attempt % 2 == 0 else a["model"]
            await asyncio.sleep(0 if self.mock else PAUSE * attempt)
            emit({"type": "agent_status", "agent": key, "status": "bekerja", "model": model, "catatan": f"recovered by {model} (try {attempt + 1}) after: {why}"})
            try:
                rs = self.receipts.get(key, [])
                if rs:
                    steps = "\n".join(f"- {r['tool']} → {r['summary']}" for r in rs[-16:])
                    out = await self.turn(key, model, text, [], f"{prompt}\n\nYour turn stopped ({why}) after these steps, whose results stand:\n{steps}\n\nWrite your report now from those results only, without calling tools.", 2)
                else:
                    out = await self.turn(key, model, text, tools, prompt, calls)
                if out:
                    return out, "selesai"
            except Exception as e:  # noqa: BLE001 - another try; the steps stand either way
                last = e
        return f"(failed: {why}; recovery failed: {type(last).__name__})", "gagal"

    async def work(self, key: str, text: str, tools: list, prompt: str, must_read: bool = True) -> str:
        """One agent's turn, under the firm's concurrency limit; its report comes back and is shown, its handoff goes to the shared state."""
        a = self.team[key]
        if self.stopped:
            emit({"type": "agent_status", "agent": key, "status": "gagal", "ms": 0, "calls": 0, "tags": 0, "laporan": f"not run: {self.stopped}"})
            self.reports[key] = f"(not run: {self.stopped})"
            return self.reports[key]
        tools = [self.tool(key, t) for t in tools]
        calls = CALLS.get(a.get("peran_kode"), 8)
        emit({"type": "instruksi", "agent": key, "instans_dari": a.get("instans_dari"), "model": a["model"], "batas": {"panggilan_model": calls}, "tools": [t.__name__ for t in tools], "teks": text[:16000], "prompt": prompt[:4000]})
        emit({"type": "agent_status", "agent": key, "status": "antre"})
        async with self.sem:
            wait = self.cool_until - time.time()
            if wait > 0:
                await asyncio.sleep(wait)
            emit({"type": "agent_status", "agent": key, "status": "bekerja", "model": a["model"]})
            t0 = time.time()
            try:
                out, status = await self.turn(key, a["model"], text, tools, prompt, calls), "selesai"
            except Exception as e:  # noqa: BLE001 - one agent failing does not stop the firm
                emit({"type": "error", "agent": key, "message": f"{type(e).__name__}: {str(e)[:300]}"})
                out, status = await self.recover(key, a, text, tools, prompt, calls, e)
            if must_read and tools and not self.read(key):
                out, status = await self.unread(key, a, text, tools, prompt, calls)
        body, h = split_handoff(out)
        receipts = self.receipts.get(key, [])
        handoff = {"agent": key, "task": a.get("peran", ""), "implemented": h.get("done") or [], "left_undone": h.get("left_undone") or [], "issues_found": h.get("issues_found") or [],
                   "queries_run": [{"tool": r["tool"], "ok": r["ok"], "summary": r["summary"]} for r in receipts], "stopped": "" if status == "selesai" else "the agent's turn failed"}
        self.handoffs[key] = handoff
        emit({"type": "handoff", "agent": key, "handoff": handoff})
        self.reports[key] = body
        emit({"type": "agent_status", "agent": key, "status": status, "ms": int((time.time() - t0) * 1000), "calls": self.usage.get(key, {}).get("calls", 0),
              "tags": sum(1 for v in self.ledger.values() if key in v["agents"]), "laporan": body[:1500]})
        return body

    async def all(self, jobs: list, phase: str) -> None:
        """Agents side by side: one that fails outright is reported and the others carry on."""
        for r in await asyncio.gather(*jobs, return_exceptions=True):
            if isinstance(r, Exception):
                emit({"type": "error", "agent": None, "message": f"phase {phase}: {type(r).__name__}: {str(r)[:300]}"})

    def instances(self, role_key: str, items: list, make: Callable[[int, Any], dict]) -> list[dict]:
        """A role's instances for this review: one per queued item, each a fresh worker with the role's model and lead; announced so the page draws them as they form."""
        role = self.team[role_key]
        cap = int((role.get("target") or {}).get("kapasitas") or len(items))
        out = []
        for n, item in enumerate(items[:cap], 1):
            inst = {"jenjang": "analis", "induk": role["induk"], "lini": role["lini"], "model": role["model"], "peran_kode": role["peran_kode"], "instans_dari": role_key, **make(n, item)}
            self.team[inst["key"]] = inst
            out.append(inst)
        emit({"type": "instances", "role": role_key, "parent": role["induk"], "kapasitas": cap, "antrean": len(items),
              "agents": [{k: a.get(k) for k in ("key", "name", "lini", "jenjang", "induk", "model", "peran", "peran_kode", "instans_dari", "target")} for a in out]})
        return out

    def scrutinize(self, milestone: str, checks: list[tuple[str, bool, str]]) -> None:
        """Plain code closes every phase: what the phase left in the shared state, checked."""
        rows = [{"klaim": c, "ok": ok, "blok": False, "bukti": b} for c, ok, b in checks]
        emit({"type": "verdict", "validator": "scrutiny", "model": "code", "milestone": milestone, "checks": rows, "passed": sum(1 for r in rows if r["ok"]), "total": len(rows)})

    def phase(self, pid: str, status: str, **extra: Any) -> None:
        emit({"type": "phase", "phase": pid, "label": dict(PHASES)[pid], "status": status, **extra})

    def machine(self, key: str, status: str, **extra: Any) -> None:
        emit({"type": "machine", "key": key, "status": status, **extra})

    def head(self, a: dict) -> str:
        return f"You are {a['name']} in a swarm that works a construction site disruption through to a recovery plan for the main contractor's project manager. Your role: {a['peran']}.\n{RULES}{lessons_for(a)}"

    # -------------------------------------------------------------------------------------------- the phases

    async def phase_0(self) -> dict:
        self.phase("penugasan", "mulai")
        self.machine("auto_checks", "bekerja")
        plan = project.schedule()
        attention = project.checks()
        rules: dict[str, int] = {}
        for x in attention:
            rules[x["rule"]] = rules.get(x["rule"], 0) + 1
        self.machine("auto_checks", "selesai", hasil={"aturan": rules})

        def read_disruption() -> dict:
            """The brief, the milestone and live schedule, what the project records already show is wrong, the open work items, and the recovery options to test."""
            return {"brief": self.brief, "milestone": plan["milestone"], "activities": plan["activities"], "records_attention": attention,
                    "open_work_items": [w for w in project.all_of("work_item") if w["status"] == "open"], "options": {k: v["name"] for k, v in C.OPTIONS.items()}}

        leads = [k for k, a in self.team.items() if a["jenjang"] == "manajer" and k != "validator"]
        text = f"""{self.head(self.team['partner'])}
Call read_disruption, then write the plan before any worker starts. Answer with JSON only:
{{"ringkasan": "two sentences: what happened and what the review must settle", "hipotesis": [{{"id": "H1", "teks": "something that must be checked"}}],
"fokus": {{{', '.join(f'"{k}": "what this line must establish"' for k in leads)}}}, "kontrak": ["a statement that must be true for the recovery plan to be correct"]}}
Write 3 to 5 hypotheses and 4 to 7 contract statements. Do not rule on any option yet: you have not seen the documents."""
        out = await self.work("partner", text, [read_disruption], f"Disruption: {self.brief}\nFocus from the project manager: {self.focus or 'none'}")
        raw = parse_json(out) or {}
        self.plan = {"ringkasan": raw.get("ringkasan") or self.brief, "hipotesis": raw.get("hipotesis") or [], "fokus": raw.get("fokus") or {}, "kontrak": raw.get("kontrak") or ["Every option ruled out cites the document that rules it out.", "The plan keeps Milestone M1 or states the cost of missing it."]}
        self.contract = [{"id": f"k{i}", "teks": str(t)} for i, t in enumerate(self.plan["kontrak"], 1)]
        emit({"type": "engagement_plan", "plan": {**self.plan, "kontrak": self.contract}})
        emit({"type": "kontrak", "kontrak": self.contract})
        self.scrutinize("penugasan", [("the orchestrator read the disruption before planning", self.read("partner"), f"{len(self.receipts.get('partner', []))} tool calls"), ("the plan has a validation contract", bool(self.contract), f"{len(self.contract)} statements")])
        self.phase("penugasan", "selesai")
        return self.plan

    async def analyst(self, a: dict, plan: dict) -> None:
        t = a["target"]
        sources = []
        if t.get("kinds"):
            sources.append(f"documents of kind: {', '.join(t['kinds'])}")
        if t.get("channels"):
            sources.append(f"messages on: {', '.join(t['channels'])}")
        if t.get("level"):
            sources.append(f"daily logs and photos of {t['level']}")
        if t.get("sub"):
            sources.append(f"the record of {C.SUBCONTRACTORS[t['sub']]['name']}")
        if t.get("schedule"):
            sources.append("the schedule worked out by code")
        text = f"""{self.head(a)}
Today is Monday {C.TODAY}. The pour of Level 3 slab bays 3-4 (activity A30) is planned for tomorrow at 07:00.
Your sources: {'; '.join(sources)}. Read all of them with your tools.
For anything in them that bears on the pour or the milestone, call flag_signal with the evidence IDs you read. Signal types: {', '.join(SIGNALS)}.
Flag only what your sources say, and flag nothing if they show no risk. Then write a short report of what you established, and what you could not.
{HANDOFF_ASK}"""
        lead_focus = (plan.get("fokus") or {}).get(a["induk"], "")
        await self.work(a["key"], text, [*self.read_tools(a["key"], t), self.flag_tool(a["key"])], f"Your line's focus: {lead_focus or a['peran']}\nDisruption: {self.brief}")

    async def phase_1(self, plan: dict) -> None:
        self.phase("lapangan", "mulai")
        field = [a for a in self.team.values() if a["jenjang"] == "analis" and a["peran_kode"] == "analis" and not a.get("instans_dari")]
        await self.all([self.analyst(a, plan) for a in field], "lapangan")
        done = sum(1 for a in field if self.read(a["key"]))
        self.scrutinize("lapangan", [("every analyst read its own sources", done == len(field), f"{done}/{len(field)}"), ("every signal cites evidence its agent read", True, f"{len(self.ledger)} signals; the tool refuses any other")])
        self.machine("impact_engine", "bekerja")
        evals = {k: C.evaluate(k) for k in C.OPTIONS}
        for e in evals.values():
            self.numbers |= numbers_in(json.dumps(e))
        self.evals = evals
        self.machine("impact_engine", "selesai", hasil={"teknik": len(evals), "items": len(C.ACTIVITIES), "tag": sum(1 for a in project.schedule()["activities"] if a["critical"])})
        self.phase("lapangan", "selesai")

    def phase_2(self) -> dict:
        self.phase("register", "mulai")
        self.machine("register", "bekerja")
        flagged = {v["subject"] for v in self.ledger.values()}
        groups: dict[str, list[str]] = {"A": [], "B": [], "C": [], "D": [], "Z": []}
        rows = []
        for a in project.schedule()["activities"]:
            hit = a["id"] in flagged
            g = "A" if a["critical"] and hit else "B" if a["critical"] else "C" if hit else "D"
            groups[g].append(a["id"])
            rows.append({"id": a["id"], "name": a["name"], "group": g, "critical": a["critical"], "float_days": a["float_days"], "by": a["by"]})
        worst = max(e["total_cost_rp"] for e in self.evals.values())
        box = {"items": len(rows), "kelompok": {k: {"items": len(v)} for k, v in groups.items() if v}, "total_estimasi_kerugian_rp": worst, "baris": rows}
        self.box = box
        self.machine("register", "selesai", hasil=box)
        self.scrutinize("register", [("the groups add up to every activity", sum(len(v) for v in groups.values()) == len(C.ACTIVITIES), f"{len(C.ACTIVITIES)} activities")])
        self.phase("register", "selesai")
        return box

    async def option(self, a: dict, oid: str) -> None:
        def evaluate_option() -> dict:
            """What this option does to the milestone and to cost, worked out by code. It says nothing about whether the option is allowed."""
            return self.evals[oid]

        def read_documents(kind: str) -> dict:
            """Read project documents of one kind: inspection, spec, weather, contract, purchase_order, cost, subcontract, manpower or rfi (the RFI log)."""
            return documents_of(kind)

        async def read_messages(channel: str, query: str = "") -> dict:
            """Read messages from whatsapp, slack or gmail over MCP."""
            return await self.hub.call("read_messages", channel=channel, query=query)

        def rule_option(verdict: str, reason: str, evidence_ids: list[str]) -> dict:
            """Rule on this option. verdict: recommended (nothing stops it), risky (possible, with a named risk), or rejected (a document rules it out). Cite the IDs you read."""
            if verdict not in ("recommended", "risky", "rejected"):
                return {"refused": "verdict must be recommended, risky or rejected"}
            unread = [e for e in evidence_ids if e not in self.seen.get(a["key"], set())]
            if unread or not evidence_ids:
                return {"refused": f"cite documents you have read yourself: {', '.join(unread) or 'none given'}"}
            e = self.evals[oid]
            self.rulings[oid] = {"option": oid, "verdict": verdict, "reason": reason, "evidence": evidence_ids, "agent": a["key"], "evaluation": e}
            emit({"type": "rekomendasi", "agent": a["key"], "items": oid, "nama": C.OPTIONS[oid]["name"], "kelompok": oid, "jalur": verdict, "alasan": reason, "bukti": evidence_ids,
                  "impact": {"schedule": f"{e['days_late']} days late", "cost": f"Rp {e['total_cost_rp']:,}", "constraints": len(evidence_ids) if verdict != "recommended" else 0}})
            return {"ok": True}

        text = f"""{self.head(a)}
You test one recovery option against every source: {oid}, "{C.OPTIONS[oid]['name']}".
Call evaluate_option, read_signals, then read the documents and messages that could stop it. Check at least: the hold point, the approved mix, the weather and placing rules, crew numbers, the engineer's notes, the RFI log, and what a subcontractor would need.
Then call rule_option once. A document that rules the option out means rejected, however cheap it looks. Write what you found in a few sentences.
{HANDOFF_ASK}"""
        await self.work(a["key"], text, [evaluate_option, self.signals_tool(), read_documents, read_messages, rule_option], f"Disruption: {self.brief}")

    async def phase_3(self) -> None:
        self.phase("investigasi", "mulai")
        made = self.instances("option_analyst", list(C.OPTIONS), lambda n, oid: {"key": f"option_{oid}", "name": f"Option analyst · {oid}", "peran": f"tests option {oid}: {C.OPTIONS[oid]['name']}", "target": {"option": oid}})
        for a in made:
            emit({"type": "assign", "agent": a["key"], "target": {"nama": C.OPTIONS[a["target"]["option"]]["name"], "kelompok": a["target"]["option"]}})
        await self.all([self.option(a, a["target"]["option"]) for a in made], "investigasi")
        self.scrutinize("investigasi", [("every option has a ruling", len(self.rulings) == len(C.OPTIONS), f"{len(self.rulings)}/{len(C.OPTIONS)}"), ("every ruling cites what its analyst read", all(r["evidence"] for r in self.rulings.values()), "the tool refuses any other")])
        self.phase("investigasi", "selesai")

    async def synthesize(self, a: dict, plan: dict) -> str:
        text = f"""{self.head(a)}
Call read_team_reports and read_signals, then merge your analysts' work into one synthesis for the orchestrator: what your line established, with evidence IDs, what it means for the recovery options, and what is still open. Keep it under 200 words.
Today is {C.TODAY}. Then call propose_work_item for up to 3 concrete actions your line must see done, each with a named owner and a due date. Name subcontractors where they must act. These stay proposals until the project manager approves the plan.
{HANDOFF_ASK}"""
        return await self.work(a["key"], text, [self.team_tool(a["key"]), self.signals_tool(), self.proposal_tool(a["key"])], f"Your line's focus: {(plan.get('fokus') or {}).get(a['key'], '')}")

    async def phase_4(self, plan: dict) -> dict[str, str]:
        self.phase("sintesis", "mulai")
        leads = [a for a in self.team.values() if a["jenjang"] == "manajer" and a["key"] != "validator"]
        out: dict[str, str] = {}

        async def one(a):
            out[a["key"]] = await self.synthesize(a, plan)
        await self.all([one(a) for a in leads], "sintesis")
        self.scrutinize("sintesis", [("every domain lead handed in a synthesis", len(out) == len(leads), f"{len(out)}/{len(leads)}")])
        self.phase("sintesis", "selesai")
        return out

    async def review(self, a: dict, syntheses: dict[str, str]) -> None:
        lead = a["target"]["lead"]

        def read_documents(kind: str) -> dict:
            """Read project documents of one kind: inspection, spec, weather, contract, purchase_order, cost, subcontract, manpower or rfi (the RFI log)."""
            return documents_of(kind)

        text = f"""{self.head(a)}
Recheck this synthesis against the documents yourself, then answer with JSON only: {{"checks": [{{"klaim": "a claim it makes", "ok": true, "bukti": "the ID that supports or refutes it"}}]}}. Check 2 to 4 claims.

Synthesis of {lead}:
{syntheses.get(lead, '(none)')}"""
        out = await self.work(a["key"], text, [read_documents], "Recheck it.")
        checks = (parse_json(out) or {}).get("checks") or []
        rows = [{"klaim": str(c.get("klaim")), "ok": bool(c.get("ok")), "bukti": str(c.get("bukti"))} for c in checks if isinstance(c, dict)]
        emit({"type": "verdict", "validator": a["key"], "model": a["model"], "lini": lead, "sintesis": f"{lead} synthesis", "checks": rows, "passed": sum(1 for r in rows if r["ok"]), "total": len(rows)})

    async def attack(self, a: dict, oid: str) -> None:
        ruling = self.rulings.get(oid, {})

        def read_documents(kind: str) -> dict:
            """Read project documents of one kind: inspection, spec, weather, contract, purchase_order, cost, subcontract, manpower or rfi (the RFI log)."""
            return documents_of(kind)

        async def read_messages(channel: str, query: str = "") -> dict:
            """Read messages from whatsapp, slack or gmail over MCP."""
            return await self.hub.call("read_messages", channel=channel, query=query)

        def red_team_verdict(result: str, reason: str) -> dict:
            """Your finding. result: holds (you could not break the option) or weakened (you found what stops it)."""
            if result not in ("holds", "weakened"):
                return {"refused": "result must be holds or weakened"}
            self.attacks[oid] = {"result": result, "reason": reason}
            emit({"type": "red_team", "agent": a["key"], "indikasi_id": oid, "judul": C.OPTIONS[oid]["name"], "tag": oid, "hasil": "bertahan" if result == "holds" else "melemah", "kekuatan": "kuat" if result == "holds" else "sedang", "alasan": reason})
            return {"ok": True}

        text = f"""{self.head(a)}
Try to break this option: {oid}, "{C.OPTIONS[oid]['name']}". It was ruled {ruling.get('verdict')}: {ruling.get('reason')}
Read the documents and messages, look for what the ruling missed, then call red_team_verdict once."""
        await self.work(a["key"], text, [read_documents, read_messages, red_team_verdict], "Attack it.")

    async def phase_5(self, syntheses: dict[str, str]) -> None:
        self.phase("qa", "mulai")
        self.attacks: dict[str, dict] = {}
        emit({"type": "agent_status", "agent": "validator", "status": "bekerja", "model": WONDER})
        rank = sorted(self.rulings.values(), key=lambda r: ({"recommended": 0, "risky": 1, "rejected": 2}[r["verdict"]], r["evaluation"]["total_cost_rp"]))
        top = [r["option"] for r in rank[:2]]
        made = self.instances("red_team", top, lambda n, oid: {"key": f"red_{oid}", "name": f"Red team · {oid}", "peran": f"tries to break option {oid}", "target": {"option": oid}, "peran_kode": "red_team"})
        reviewers = [a for a in self.team.values() if a["peran_kode"] == "qa"]
        await self.all([*[self.review(a, syntheses) for a in reviewers], *[self.attack(a, a["target"]["option"]) for a in made]], "qa")
        emit({"type": "agent_status", "agent": "validator", "status": "selesai", "ms": 0, "calls": 0, "tags": 0, "laporan": f"{len(reviewers)} syntheses rechecked; {len(self.attacks)} options attacked"})
        self.scrutinize("qa", [("every synthesis was rechecked", len(reviewers) == len(syntheses), f"{len(reviewers)}/{len(syntheses)}"), ("the leading options were attacked", len(self.attacks) == len(top), f"{len(self.attacks)}/{len(top)}")])
        self.phase("qa", "selesai")

    def choice(self) -> str | None:
        """Plain code picks: the cheapest option that was recommended and held against the red team; failing that, the cheapest risky one."""
        for wanted in ("recommended", "risky"):
            pool = [r for r in self.rulings.values() if r["verdict"] == wanted and self.attacks.get(r["option"], {}).get("result") != "weakened"]
            if pool:
                return min(pool, key=lambda r: r["evaluation"]["total_cost_rp"])["option"]
        return None

    def comparison(self) -> str:
        rows = ["| Option | Ruling | Pour | Milestone | Direct cost (Rp) | Damages (Rp) | Why |", "|---|---|---|---|---|---|---|"]
        for oid, r in sorted(self.rulings.items()):
            e = r["evaluation"]
            rows.append(f"| {oid} | {r['verdict']} | {e['pour_on']} | {e['days_late']} days late | {e['direct_cost_rp']:,} | {e['liquidated_damages_rp']:,} | {r['reason'][:160].replace('|', '/')} ({', '.join(r['evidence'])}) |")
        return "\n".join(rows)

    def checked(self, text: str) -> tuple[str, int]:
        """Sentences with a figure no tool returned are dropped by code."""
        lines, dropped = [], 0
        for line in (text or "").split("\n"):
            kept = []
            for s in re.split(r"(?<=[.!?])\s+", line):
                big = [n for n in numbers_in(s) if len(n) >= 3]
                if any(n not in self.numbers for n in big):
                    dropped += 1
                else:
                    kept.append(s)
            lines.append(" ".join(kept))
        return "\n".join(lines), dropped

    async def phase_6(self, syntheses: dict[str, str]) -> None:
        self.phase("laporan", "mulai")
        chosen = self.choice()
        material = "\n\n".join(f"{k}:\n{v}" for k, v in syntheses.items())

        def read_rulings() -> dict:
            """Every option's ruling and evaluation, the red team's findings and code's pick."""
            return {"rulings": self.rulings, "red_team": self.attacks, "pick_by_code": chosen, "drafts": self.drafts, "proposed_work_items": self.proposed}

        text = f"""{self.head(self.team['partner'])}
Call read_rulings, then write the recovery plan for the project manager, in plain English, in three parts with these headings:
## What happened
## What I recommend, and why ({chosen or 'no option stands'})
## Actions by who and when
Name the subcontractors who must act and each one's deadline. Use only figures your tools returned, written as they are. Do not repeat the comparison table: code adds it.

Domain syntheses:
{material}"""
        out = await self.work("partner", text, [read_rulings], "Write the plan.")
        body, dropped = self.checked(out)
        drafts = "\n".join(f"- **{d['channel']} to {d['to']}** (not sent): {d['text']}" for d in self.drafts) or "- none"
        plan_now = {a["id"]: a for a in project.schedule()["activities"]}
        open_rfis = "\n".join(f"- **{r['id']}** {r['subject']}: {r['ball_in_court']} owes the answer by {r['due']}. Holds {r['activity']} (starts {plan_now[r['activity']]['start']}). {r['impact']}" for r in project.all_of("rfi") if r["status"] == "open") or "- none"
        items = "\n".join(f"- **{w['title']}**: {w['owner']}, by {w['due']}. {w['why']}" for w in self.proposed) or "- none"
        new_rfis = "\n".join(f"- **Draft to {r['to']}**, on {r['activity']}: {r['subject']}. {r['question']}" for r in self.rfi_drafts) or "- none"
        report = f"# Recovery plan: Level 3 pour\n\n{body}\n\n## Options compared\n\n{self.comparison()}\n\n## Open RFIs\n\n{open_rfis}\n\n## New RFIs drafted, not issued\n\n{new_rfis}\n\n## Work items that open when you approve\n\n{items}\n\n## Messages ready for your approval\n\nNothing has been sent.\n\n{drafts}\n\n## Decision\n\nThe project manager decides. Nothing on site changes until then."
        emit({"type": "draft", "text": report})

        def read_documents(kind: str) -> dict:
            """Read project documents of one kind: inspection, spec, weather, contract, purchase_order, cost, subcontract, manpower or rfi (the RFI log)."""
            return documents_of(kind)

        vtext = f"""{self.head(self.team['validator'])}
Judge this recovery plan against its validation contract, reading the documents yourself. Answer with JSON only:
{{"checks": [{{"klaim": "a claim in the plan", "ok": true, "bukti": "the ID"}}], "kontrak": [{{"id": "k1", "ok": true, "bukti": "why"}}]}}

Contract: {json.dumps(self.contract)}

Plan:
{report}"""
        vout = await self.work("validator", vtext, [read_documents], "Judge it.")
        v = parse_json(vout) or {}
        checks = [{"klaim": str(c.get("klaim")), "ok": bool(c.get("ok")), "bukti": str(c.get("bukti"))} for c in (v.get("checks") or []) if isinstance(c, dict)]
        judged = {str(c.get("id")): c for c in (v.get("kontrak") or []) if isinstance(c, dict)}
        contract = [{**k, "ok": judged.get(k["id"], {}).get("ok"), "bukti": judged.get(k["id"], {}).get("bukti")} for k in self.contract]
        emit({"type": "verdict", "validator": "validator", "model": WONDER, "checks": checks, "kontrak": contract, "passed": sum(1 for c in checks if c["ok"]), "total": len(checks)})
        self.chosen, self.report = chosen, report
        stats = self.score()
        emit({"type": "engagement", "laporan": report, "statistik": {"recommended": chosen, "signals": len(self.ledger), "agents": len(self.reports), "sentences dropped by code": dropped, "drafts not sent": len(self.drafts), **stats}})
        self.scrutinize("laporan", [("code's pick was not rejected", chosen is None or self.rulings[chosen]["verdict"] != "rejected", str(chosen)), ("no message was sent", all(not d["sent"] for d in self.drafts), f"{len(self.drafts)} drafts")])
        self.phase("laporan", "selesai")

    def score(self) -> dict:
        """Against the case's truth: only after the agents have finished, and only while the records still stand as seeded."""
        if not project.as_seeded():
            return {"score": "not scored: the project records have changed since the scenario began"}
        cited = {e for v in self.ledger.values() for e in v["evidence"]} | {e for r in self.rulings.values() for e in r["evidence"]}
        must = C.TRUTH["must_find"]
        wrong = [o for o in C.TRUTH["blocks"] if self.rulings.get(o, {}).get("verdict") == "recommended"]
        return {"best option": C.TRUTH["best"], "picked the best": self.chosen == C.TRUTH["best"], "key facts found": f"{sum(1 for m in must if m in cited)}/{len(must)}", "blocked options wrongly recommended": len(wrong)}

    async def engagement(self) -> None:
        team, why = roster()
        emit({"type": "run", "status": "started", "kind": "swarm"})
        emit({"type": "firm", "tim": team, "mesin": MACHINES, "fase": [{"id": i, "label": label} for i, label in PHASES], "brief": self.brief, "versi": "1.0", "ukuran": why})
        try:
            await self.hub.start()
            plan = await self.phase_0()
            await self.phase_1(plan)
            self.phase_2()
            await self.phase_3()
            syntheses = await self.phase_4(plan)
            await self.phase_5(syntheses)
            await self.phase_6(syntheses)
            emit({"type": "done"})
        finally:
            await self.hub.stop()


MACHINES = [{"key": "auto_checks", "name": "Automatic checks", "peran": "code's first read of the schedule and inbox"}, {"key": "impact_engine", "name": "Impact engine", "peran": "code works out each option's schedule and cost"},
            {"key": "register", "name": "Risk register", "peran": "code ranks what is exposed"}]
BRIEF = ("Monday 5 October 2026, 08:30. The concrete supplier's plant broke down overnight, and tomorrow's 07:00 pour of Level 3 slab bays 3-4 is in doubt. Milestone M1 is due on 25 October. "
         "Work out what is really going on across site, subcontractors, procurement, planning, cost, quality and contract, and recommend a recovery plan for the project manager to approve.")

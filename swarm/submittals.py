"""Submittals: what the contractor must have approved before the work goes ahead, such as a material, a shop drawing or a method statement. A person keeps the register, and an open one on a work package shows on its cards. Drafting from the plan is code reading what the planners wrote, at no cost, and nothing is sent until a person sends it."""

from __future__ import annotations

import re
from datetime import date, timedelta

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import project as P

KINDS = {"material": "Material approval", "shop": "Shop drawing", "method": "Method statement", "sample": "Sample or mock-up"}
OPEN = ("draft", "submitted")
LEAD = 14  # days an approval is wanted before the work it holds starts
ASKS = [("shop", re.compile(r"shop\s*drawing", re.I)), ("method", re.compile(r"metode (kerja|pelaksanaan)|method statement", re.I)), ("sample", re.compile(r"mock.?up|contoh (bahan|material|warna)|sampel", re.I)), ("material", re.compile(r"persetujuan (material|bahan)|(material|bahan) (yang )?disetujui|approval (material|bahan)", re.I))]
FILE_TYPES = (".pdf", ".png", ".jpg", ".jpeg", ".dwg", ".xlsx", ".docx")


def _needed_by(aid: str) -> str:
    a = next((x for x in P.schedule()["activities"] if x["id"] == aid), None)
    return max((date.fromisoformat(a["start"]) - timedelta(days=LEAD)).isoformat(), P.TODAY) if a else ""  # work starting soon cannot have wanted it before it was asked for


def register() -> dict:
    rows = P.all_of("submittal")
    acts = {a["id"]: a for a in P.schedule()["activities"]} if rows else {}
    for s in rows:
        a = acts.get(s.get("activity") or "")
        s["activity_name"], s["code"], s["start"], s["critical"] = (a["name"], a["code"], a["start"], a["critical"]) if a else ("", "", "", False)
        s["late"] = s["status"] in OPEN and bool(s.get("needed_by")) and s["needed_by"] < P.TODAY
        s["kind_name"] = KINDS.get(s["kind"], s["kind"])
    rows.sort(key=lambda s: (s["status"] not in OPEN, s.get("needed_by") or "9999", s["id"]))
    return {"today": P.TODAY, "submittals": rows, "kinds": KINDS, "counts": {k: sum(1 for s in rows if s["status"] == k) for k in ("draft", "submitted", "approved", "noted", "rejected")},
            "activities": [{"id": a[0], "name": a[1]} for a in P.activity_rows()]}


def add(title: str, kind: str, activity: str = "", to: str = "", ref: str = "", note: str = "", who: str = P.PM, source: dict | None = None) -> dict:
    if not str(title).strip():
        raise ValueError("a submittal needs a title")
    if kind not in KINDS:
        raise ValueError(f"kind must be one of: {', '.join(KINDS)}")
    sid = P.next_id("submittal")
    rec = {"id": sid, "title": str(title).strip(), "kind": kind, "activity": activity, "to": to.strip() or "Konsultan Pengawas", "ref": ref.strip(), "note": note.strip(), "status": "draft", "rev": 0, "raised": P.TODAY, "submitted_on": "", "decided_on": "", "decided_by": "", "needed_by": _needed_by(activity), "file": "", "file_name": "", "source": source or {}, "history": []}
    return P.put("submittal", sid, rec, who, "raised a submittal", rec["title"])


def submit(sid: str, who: str = P.PM) -> dict:
    s = P.get("submittal", sid)
    if not s:
        raise KeyError(sid)
    if s["status"] not in ("draft", "rejected"):
        raise ValueError("only a draft or a rejected submittal can be submitted")
    rev = s["rev"] + 1 if s["status"] == "rejected" else s["rev"]
    return P.patch("submittal", sid, {"status": "submitted", "submitted_on": P.TODAY, "rev": rev, "decided_on": "", "decided_by": ""}, who, "submitted for approval", f"{s['title']}, revision {rev}")


def decide(sid: str, decision: str, note: str = "", who: str = P.PM) -> dict:
    s = P.get("submittal", sid)
    if not s:
        raise KeyError(sid)
    if decision not in ("approved", "noted", "rejected"):
        raise ValueError("a decision is approved, noted or rejected")
    if s["status"] != "submitted":
        raise ValueError("only a submitted one can be decided")
    if decision != "approved" and not note.strip():
        raise ValueError("say what has to change")
    entry = {"rev": s["rev"], "decision": decision, "note": note.strip(), "by": P.person(who), "on": P.TODAY}
    return P.patch("submittal", sid, {"status": decision, "decided_on": P.TODAY, "decided_by": P.person(who), "history": [*s["history"], entry]}, who, f"decided a submittal: {decision}", f"{s['title']}, revision {s['rev']}")


def drop(sid: str, who: str = P.PM) -> dict:
    s = P.get("submittal", sid)
    if not s:
        raise KeyError(sid)
    if s["status"] != "draft":
        raise ValueError("only a draft can be dropped: the rest are on the record")
    P.drop("submittal", sid)
    P.log(who, "dropped a draft submittal", "submittal", sid, s["title"])
    return {"dropped": sid}


def from_plan(who: str = P.PM) -> dict:
    """One draft for each kind of approval a work package's tasks say they need, with the page that says so. Run again, it adds only what is new."""
    plans = [p for p in P.all_of("plan") if p["status"] in ("pending", "approved")]
    if not plans:
        raise ValueError("there is no plan to read yet")
    rec = next((p for p in plans if p["status"] == "approved"), plans[-1])
    have = {(s["activity"], s["kind"]) for s in P.all_of("submittal")}
    names = {a["id"]: a["name"] for a in P.schedule()["activities"]}
    added = 0
    for step in rec["plan"]["steps"]:
        aid = step["activity"]
        text = " ".join([step.get("name") or "", *[str(x) for x in step.get("procedure") or []]])
        for kind, rule in ASKS:
            if rule.search(text) and (aid, kind) not in have and aid in names:
                have.add((aid, kind))
                source = (step.get("sources") or [{}])[0]
                add(f"{KINDS[kind]}: {names[aid]}", kind, aid, ref=f"{source.get('doc', '')} p.{source.get('page', '')}" if source.get("doc") else "", note=f"From task {step['id']}: {step['name']}", who=P.SWARM, source={"step": step["id"], "doc": source.get("doc", ""), "page": source.get("page", ""), "quote": source.get("quote", "")})
                added += 1
    if added:
        P.log(who, "drafted submittals from the plan", "submittal", "", f"{added} drafts")
    return {"added": added, **register()}


router = APIRouter()


class SubmittalIn(BaseModel):
    title: str
    kind: str
    activity: str = ""
    to: str = ""
    ref: str = ""
    note: str = ""


class DecisionIn(BaseModel):
    decision: str
    note: str = ""


def _guarded(fn, *a, **k):
    try:
        return fn(*a, **k)
    except KeyError as e:
        raise HTTPException(404, f"no such record: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.get("/api/project/submittals")
def submittals() -> dict:
    return register()


@router.post("/api/project/submittals")
def new_submittal(body: SubmittalIn) -> dict:
    return _guarded(add, body.title, body.kind, body.activity, body.to, body.ref, body.note)


@router.post("/api/project/submittals/from-plan")
def draft_from_plan() -> dict:
    return _guarded(from_plan)


@router.post("/api/project/submittals/{sid}/submit")
def submit_one(sid: str) -> dict:
    return _guarded(submit, sid)


@router.post("/api/project/submittals/{sid}/decide")
def decide_one(sid: str, body: DecisionIn) -> dict:
    return _guarded(decide, sid, body.decision, body.note)


@router.post("/api/project/submittals/{sid}/drop")
def drop_one(sid: str) -> dict:
    return _guarded(drop, sid)


@router.post("/api/project/submittals/{sid}/file")
async def attach(sid: str, file: UploadFile = File(...)) -> dict:
    s = P.get("submittal", sid)
    if not s:
        raise HTTPException(404, f"no such record: {sid}")
    name = file.filename or "file"
    ext = name[name.rfind("."):].lower() if "." in name else ""
    if ext not in FILE_TYPES:
        raise HTTPException(409, f"this kind of file is not accepted: {', '.join(FILE_TYPES)}")
    saved = f"{sid}{ext}"
    (P.upload_folder() / saved).write_bytes(await file.read())
    return P.patch("submittal", sid, {"file": saved, "file_name": name}, P.PM, "attached a file to a submittal", name)


def file_of(s: dict) -> FileResponse:
    path = P.upload_folder() / s["file"]
    if not s.get("file") or not path.is_file():
        raise HTTPException(404, "no file on this submittal")
    return FileResponse(path, filename=s.get("file_name") or s["file"])


@router.get("/api/project/submittals/{sid}/file")
def read_file(sid: str) -> FileResponse:
    s = P.get("submittal", sid)
    if not s:
        raise HTTPException(404, f"no such record: {sid}")
    return file_of(s)

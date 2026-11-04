"""The API of the project records. Every change here is a person's, and lands in the audit trail."""

from __future__ import annotations

import asyncio
import io
import re
import time
import zipfile
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, BeforeValidator

from . import extract, memory, model3d, module_agents as A, modules as M, package as K, project as P, wbs
from .data import ProjectData

router = APIRouter()


def guarded(fn: Callable, *a, **k):
    """A record that does not exist is a 404; a step the workflow does not allow is a 409, with why. The records themselves refusing (a locked file, a disk that will not write) is a 503, never a bare 500."""
    try:
        return fn(*a, **k)
    except KeyError as e:
        raise HTTPException(404, f"no such record: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    except OSError as e:
        raise HTTPException(503, f"the records could not be read or written: {e}") from e


MAX_UPLOAD = 64 * 1024 * 1024


def _whole(v):
    """A number typed with a fraction (100.5) is rounded to a whole one, not refused: money, men and days are whole here, and the form's arithmetic often is not."""
    if v is None or isinstance(v, bool):
        return v
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return v


from typing import Annotated

Whole = Annotated[int, BeforeValidator(_whole)]
DOC_KINDS = {"scope", "drawing", "spec", "itp", "boq", "estimate", "programme", "wbs", "clarification", "contract", "method", "rates", "tender", "award", "note", "other"}
DOC_TYPES = {".pdf", ".txt", ".md", ".csv", ".png", ".jpg", ".jpeg", ".dwg", ".dxf", ".xlsx", ".docx"}
PHOTO_TYPES = {".png", ".jpg", ".jpeg"}


class ActivityIn(BaseModel):
    progress: Whole | None = None
    duration: Whole | None = None
    predecessors: list[str] | None = None
    by: str | None = None
    earliest: str | None = None
    lags: dict[str, Whole] | None = None


class ActivityChange(BaseModel):
    name: str | None = None
    package: str | None = None


class PackageChange(BaseModel):
    name: str


class NewActivity(BaseModel):
    name: str
    package: str
    duration: Whole = 5
    predecessors: list[str] = []
    by: str = "self"


class NewPackage(BaseModel):
    name: str
    sub: str = ""
    budget: Whole = 0


class NewMilestone(BaseModel):
    name: str
    activity: str
    contract_date: str


class NewProject(BaseModel):
    name: str
    owner: str = ""
    contractor: str = ""
    location: str = ""
    start: str = ""
    finish: str = ""
    template: bool = True


class NewBoq(BaseModel):
    name: str
    unit: str
    qty: float
    unit_price: Whole
    package: str
    activity: str = ""
    area: str = ""


class NewOrder(BaseModel):
    item: str
    supplier: str
    activity: str = ""
    needed: str
    promised: str = ""
    value: Whole = 0
    package: str = ""


class NewInspection(BaseModel):
    title: str
    activity: str = ""
    by: str = ""
    next: str = ""
    criteria: str = ""
    hold_point: bool = False


class InspectionResult(BaseModel):
    result: str
    checklist: list[dict] | None = None
    note: str = ""
    photos: list[str] | None = None


class CardMove(BaseModel):
    status: str


class Assign(BaseModel):
    activity: str
    by: str
    section: str = ""


class DocDecision(BaseModel):
    status: str
    note: str = ""


class DocLink(BaseModel):
    activity: str


class Mode(BaseModel):
    mode: str = "mock"


class DraftRfi(BaseModel):
    subject: str
    question: str
    to: str = "Engineer"
    activity: str = ""
    impact: str = ""


class CostIn(BaseModel):
    package: str
    description: str
    amount: Whole
    recoverable_from: str = ""
    actual: bool = False


class SubIn(BaseModel):
    name: str
    trade: str
    scope: str = ""
    crew: Whole = 0
    contact: str = ""
    phone: str = ""


class SubEdit(BaseModel):
    name: str | None = None
    trade: str | None = None
    scope: str | None = None
    crew: Whole | None = None
    contact: str | None = None
    phone: str | None = None


class DocIn(BaseModel):
    name: str
    expires: str


class PromiseIn(BaseModel):
    promised: str = ""
    supplier: str = ""


class ReportIn(BaseModel):
    date: str = ""
    area: str
    package: str = ""
    activity: str = ""
    crew: Whole | None = None
    weather: str = ""
    author: str = ""
    text: str


class NcrIn(BaseModel):
    title: str
    by: str
    activity: str = ""
    due: str = ""
    photo: str = ""


class NcrClose(BaseModel):
    action: str = ""


class RfiIn(BaseModel):
    subject: str
    question: str
    to: str
    activity: str = ""
    due: str = ""
    raised_by: str = "Main contractor"
    impact: str = ""


class RfiAnswer(BaseModel):
    answer: str


class ClaimIn(BaseModel):
    adjusted: bool = True


class DecisionIn(BaseModel):
    option: str = ""
    note: str = ""


class WorkItemIn(BaseModel):
    title: str
    owner: str
    due: str = ""
    activity: str = ""
    physical: bool = False
    by: str = ""


class WorkItemChange(BaseModel):
    status: str = ""
    owner: str | None = None
    due: str | None = None
    progress: Whole | None = None
    by: str | None = None


class PlanDecision(BaseModel):
    note: str = ""


class ActualIn(BaseModel):
    man_hours: float | None = None
    materials: dict[str, float] = {}


@router.get("/api/project/overview")
def overview() -> dict:
    return P.overview()


@router.post("/api/project/reset")
def reset() -> dict:
    guarded(P.reset)
    guarded(memory.clear)
    return {"status": "reset"}


@router.get("/api/project/schedule")
def schedule() -> dict:
    return M.schedule_view()


@router.post("/api/project/schedule/{aid}")
def update_activity(aid: str, body: ActivityIn) -> dict:
    return guarded(P.update_activity, aid, body.progress, body.duration, body.predecessors, body.by, earliest=body.earliest, lags=body.lags)


@router.get("/api/project/budget")
def budget() -> dict:
    return P.budget()


@router.post("/api/project/cost-items")
def add_cost(body: CostIn) -> dict:
    return guarded(P.add_cost_item, body.package, body.description, body.amount, body.recoverable_from, actual=body.actual)


@router.get("/api/project/subcontractors")
def subcontractors() -> dict:
    return {"subcontractors": P.subcontractors(), "required_documents": P.REQUIRED_DOCS, "today": P.TODAY}


@router.post("/api/project/subcontractors")
def add_subcontractor(body: SubIn) -> dict:
    return guarded(P.add_subcontractor, body.name, body.trade, body.scope, body.crew, contact=body.contact, phone=body.phone)


@router.post("/api/project/subcontractors/sample")
def seed_sample_subcontractors() -> dict:
    return {"added": guarded(P.seed_sample_subcontractors)}


@router.post("/api/project/subcontractors/{sid}/remove")
def remove_subcontractor(sid: str) -> dict:
    return guarded(P.remove_subcontractor, sid)


@router.post("/api/project/subcontractors/{sid}")
def set_subcontractor(sid: str, body: SubEdit) -> dict:
    return guarded(P.set_subcontractor, sid, body.name, body.trade, body.scope, body.crew, body.contact, body.phone)


@router.post("/api/project/subcontractors/{sid}/documents")
def add_document(sid: str, body: DocIn) -> dict:
    return guarded(P.add_sub_document, sid, body.name, body.expires)


@router.post("/api/project/subcontractors/{sid}/approve")
def approve_subcontractor(sid: str) -> dict:
    return guarded(P.approve_subcontractor, sid)


@router.post("/api/project/invoices/{iid}/{action}")
def invoice(iid: str, action: str) -> dict:
    return guarded(P.invoice_action, iid, action)


@router.get("/api/project/procurement")
def procurement() -> dict:
    codes = P.wbs_codes()
    return {"orders": [{**o, "wbs": codes.get(o.get("activity") or "") or codes.get(o.get("package") or "", "")} for o in P.all_of("po") if o["status"] != "cancelled"], "today": P.TODAY, "activities": [{"id": a[0], "name": a[1]} for a in P.activity_rows()]}


@router.post("/api/project/orders/{pid}/{action}")
def order(pid: str, action: str, body: PromiseIn) -> dict:
    return guarded(P.po_action, pid, action, body.promised, body.supplier)


@router.get("/api/project/daily-reports")
def daily_reports() -> dict:
    return {"reports": sorted(P.daily_reports(), key=lambda r: (r["date"], r["id"]), reverse=True), "photos": M.photos()["photos"], "today": P.TODAY,
            "packages": [{"id": p["id"], "name": p["name"]} for p in P.all_of("package")], "activities": [{"id": a[0], "name": a[1]} for a in P.activity_rows()]}


@router.post("/api/project/daily-reports")
def add_report(body: ReportIn) -> dict:
    return guarded(P.add_daily_report, body.model_dump())


@router.post("/api/project/daily-reports/{rid}/verify")
def verify_report(rid: str) -> dict:
    return guarded(P.verify_daily_report, rid)


@router.get("/api/project/photos/{photo_id}")
def photo(photo_id: str) -> FileResponse:
    rec = (None if P.is_blank() else ProjectData.load().photo(photo_id)) or P.get("photo", photo_id)  # looked up by ID, never a path from the request
    if not rec:
        raise HTTPException(404, "no such photo")
    return FileResponse(A.photo_file(rec))


@router.get("/api/project/quality")
def quality() -> dict:
    return P.quality()


@router.post("/api/project/ncrs")
def raise_ncr(body: NcrIn) -> dict:
    return guarded(P.raise_ncr, body.title, body.by, body.activity, body.due, photo=body.photo)


@router.post("/api/project/ncrs/{nid}/close")
def close_ncr(nid: str, body: NcrClose) -> dict:
    return guarded(P.close_ncr, nid, body.action)


@router.get("/api/rfis")
def rfis() -> dict:
    return P.rfis()


@router.post("/api/rfis")
def new_rfi(body: RfiIn) -> dict:
    return guarded(P.add_rfi, body.model_dump(), "open", P.PM)


@router.post("/api/rfis/{rid}/issue")
def issue_rfi(rid: str) -> dict:
    """A person issues a draft: an agent never does."""
    return guarded(P.issue_rfi, rid)


@router.post("/api/rfis/{rid}/answer")
def answer_rfi(rid: str, body: RfiAnswer) -> dict:
    return guarded(P.answer_rfi, rid, body.answer)


@router.get("/api/project/claim")
def claim() -> dict:
    return P.claim() or {"none": True}


@router.post("/api/project/claim/{action}")
def claim_action(action: str, body: ClaimIn) -> dict:
    return guarded(P.claim_action, action, body.adjusted)


@router.get("/api/project/decisions")
def decisions() -> dict:
    return P.decisions()


@router.post("/api/project/decisions/{did}/approve")
def approve(did: str, body: DecisionIn) -> dict:
    return guarded(P.decide, did, "approve", body.option, body.note)


@router.post("/api/project/decisions/{did}/reject")
def reject(did: str, body: DecisionIn) -> dict:
    return guarded(P.decide, did, "reject", "", body.note)


@router.post("/api/project/messages/{mid}/{action}")
def message(mid: str, action: str) -> dict:
    return guarded(P.message_action, mid, action)


@router.post("/api/project/work-items")
def add_work_item(body: WorkItemIn) -> dict:
    return guarded(P.add_work_item, body.title, body.owner, body.due, body.activity, P.PM, physical=body.physical, by=body.by)


@router.post("/api/project/work-items/{wid}")
def set_work_item(wid: str, body: WorkItemChange) -> dict:
    return guarded(P.set_work_item, wid, body.status, body.owner, body.due, body.progress, body.by)


@router.get("/api/project/plan-package")
def plan_package() -> dict:
    if P.is_blank():
        return {"documents": [], "scope": {}, "scenario": False}
    return {"documents": P.plan_documents(), "scope": P.PC.SCOPE, "scenario": True}


@router.get("/api/project/plans")
def plans() -> dict:
    who = {s["id"]: s["name"].replace(" (fictional)", "") for s in P.all_of("subcontractor")}
    return {"plans": P.plans(), "today": P.TODAY, "who": {**who, "self": "Own crew"}}


@router.post("/api/project/plans/{pid}/review")
def review_plan(pid: str, body: ReviewIn) -> dict:
    return guarded(P.review_plan, pid, body.keys, body.verdict, body.note)


@router.post("/api/project/plans/{pid}/edit")
def edit_plan_item(pid: str, body: ItemEdit) -> dict:
    return guarded(P.edit_plan_item, pid, body.key, body.text)


@router.post("/api/project/plans/{pid}/approve")
def approve_plan(pid: str, body: PlanDecision) -> dict:
    return guarded(P.decide_plan, pid, "approve", body.note)


@router.post("/api/project/plans/{pid}/reject")
def reject_plan(pid: str, body: PlanDecision) -> dict:
    return guarded(P.decide_plan, pid, "reject", body.note)


@router.post("/api/project/plans/{pid}/steps/{step_id}/actual")
def plan_actual(pid: str, step_id: str, body: ActualIn) -> dict:
    return guarded(P.plan_actual, pid, step_id, body.man_hours, body.materials)


@router.get("/api/project/plans/{pid}/procedure.md", response_class=PlainTextResponse)
def plan_procedure(pid: str) -> str:
    rec = guarded(P.plan_by_id, pid)
    return M.procedure_document(rec) if rec["plan"].get("kind") == "package" else wbs.procedure_markdown(rec)


@router.get("/api/project/plans/{pid}/table.csv", response_class=PlainTextResponse)
def plan_table(pid: str) -> str:
    rec = guarded(P.plan_by_id, pid)
    return M.procedure_table(rec) if rec["plan"].get("kind") == "package" else wbs.table_csv(rec)


# ------------------------------------------------------------------------------------------------ the WBS: the spine every module hangs on


@router.get("/api/project/wbs")
def wbs_tree() -> dict:
    return M.tree()


@router.get("/api/project/wbs/node")
def wbs_node(code: str) -> dict:
    return guarded(M.node_detail, code)


@router.post("/api/project/packages")
def add_package(body: NewPackage) -> dict:
    return guarded(P.add_package, body.name, body.sub, body.budget)


@router.post("/api/project/packages/{pid}")
def change_package(pid: str, body: PackageChange) -> dict:
    return guarded(P.change_package, pid, body.name)


@router.post("/api/project/packages/{pid}/remove")
def remove_package(pid: str) -> dict:
    return guarded(P.remove_package, pid)


@router.post("/api/project/activities")
def add_activity(body: NewActivity) -> dict:
    return guarded(P.add_activity, body.name, body.package, body.duration, body.predecessors, body.by)


@router.post("/api/project/activities/{aid}")
def change_activity(aid: str, body: ActivityChange) -> dict:
    return guarded(P.change_activity, aid, body.name, body.package)


@router.post("/api/project/activities/{aid}/remove")
def remove_activity(aid: str) -> dict:
    return guarded(P.remove_activity, aid)


@router.post("/api/project/milestones")
def add_milestone(body: NewMilestone) -> dict:
    return guarded(P.add_milestone, body.name, body.activity, body.contract_date)


# ------------------------------------------------------------------------------------------------ projects


@router.get("/api/projects")
def projects() -> dict:
    return P.project_list()


@router.post("/api/projects")
def create_project(body: NewProject) -> dict:
    return guarded(P.create_project, body.name, body.owner, body.contractor, body.location, body.start, body.finish, body.template)


@router.post("/api/projects/{pid}/open")
def open_project(pid: str) -> dict:
    return guarded(P.open_project, pid)


# ------------------------------------------------------------------------------------------------ Kanban


@router.get("/api/project/board")
def board() -> dict:
    return M.board()


@router.post("/api/project/board/activity/{aid}")
def move_activity_card(aid: str, body: CardMove) -> dict:
    return guarded(M.move_activity_card, aid, body.status)


# ------------------------------------------------------------------------------------------------ BOQ and cost


@router.get("/api/project/boq")
def boq() -> dict:
    return M.boq_view()


@router.post("/api/project/boq")
def add_boq(body: NewBoq) -> dict:
    return guarded(P.add_boq_line, body.name, body.unit, body.qty, body.unit_price, body.package, body.activity, body.area)


# ------------------------------------------------------------------------------------------------ documents and RFIs


def _saved_name(prefix: str, name: str, allowed: set[str]) -> str:
    """The name a file is kept under: ours, never a path from the request. Only its type comes from the upload."""
    suffix = "." + (name or "").rsplit(".", 1)[-1].lower() if "." in (name or "") else ""
    if suffix not in allowed:
        raise HTTPException(400, f"this file type is not accepted. Accepted: {', '.join(sorted(allowed))}")
    return f"{prefix}{suffix}"


async def _keep(file: UploadFile, target) -> None:
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "the file is larger than 64 MB")
    if not data:
        raise HTTPException(400, "the file is empty")
    target.write_bytes(data)


@router.get("/api/project/documents")
def documents() -> dict:
    return M.documents()


ZIP_MOST = 256 * 1024 * 1024  # a whole tender package, zipped: the UGM one is 26 MB
ZIP_FILES = 200
ZIP_UNPACKED = 1024 * 1024 * 1024  # what one zip may unpack to in all: a small file that unpacks to gigabytes is refused


@router.post("/api/project/documents")
async def upload_document(file: UploadFile = File(...), title: str = Form(""), kind: str = Form("other"), activity: str = Form(""), issued_by: str = Form(""), issued_on: str = Form("")) -> dict:
    """A document you upload is yours: it is kept on this machine, and goes nowhere unless a person asks a real model to read it. A zip of documents is unpacked, each file in it a document of its own."""
    if (file.filename or "").lower().endswith(".zip"):
        return await _unpack(file, activity, issued_by, issued_on)
    rid = P.next_id("document")
    saved = _saved_name(rid, file.filename or "", DOC_TYPES)
    target = A.upload_folder() / saved
    await _keep(file, target)
    return await _register(rid, target, file.filename or saved, title, kind, activity, issued_by, issued_on)


async def _unpack(file: UploadFile, activity: str, issued_by: str, issued_on: str) -> dict:
    """A tender package as it is downloaded, in one zip: each document in it goes on the register as if it had been uploaded on its own, and sorted
    the same way. Only a file's name and type come from the zip, never a path: each is kept under our own name, so folders are flattened. What is
    not a document, a zip inside the zip, or a file locked with a password is set aside, and the answer says which and why."""
    data = await file.read(ZIP_MOST + 1)
    if len(data) > ZIP_MOST:
        raise HTTPException(413, "the zip is larger than 256 MB")
    if not data:
        raise HTTPException(400, "the file is empty")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise HTTPException(400, "this zip cannot be opened") from e
    entries = [i for i in archive.infolist() if not i.is_dir()]
    if len(entries) > ZIP_FILES:
        raise HTTPException(413, f"the zip holds {len(entries)} files: at most {ZIP_FILES} at once")
    if sum(i.file_size for i in entries) > ZIP_UNPACKED:
        raise HTTPException(413, "the zip unpacks to more than 1 GB")
    zip_name = re.sub(r"[^\w .,()\-]", "_", file.filename or "documents.zip")[:120]
    done, skipped = [], []
    for info in sorted(entries, key=lambda i: i.filename):
        name = info.filename.replace("\\", "/").rsplit("/", 1)[-1]
        if not name or name.startswith(".") or info.filename.startswith("__MACOSX/"):  # a folder's hidden files and the Mac's resource forks
            continue
        suffix = Path(name).suffix.lower()
        why = ("a zip inside the zip: unzip it and add it on its own" if suffix == ".zip" else "not a document type that is accepted" if suffix not in DOC_TYPES
               else "larger than 64 MB" if info.file_size > MAX_UPLOAD else "locked with a password" if info.flag_bits & 0x1 else "")
        if not why:
            try:
                body = archive.read(info)
            except (RuntimeError, NotImplementedError, zipfile.BadZipFile, OSError) as e:
                body, why = b"", f"could not be unpacked: {type(e).__name__}"
            else:
                why = "" if body else "empty"
        if why:
            skipped.append({"name": name, "why": why})
            continue
        rid = P.next_id("document")
        target = A.upload_folder() / _saved_name(rid, name, DOC_TYPES)
        target.write_bytes(body)
        done.append(await _register(rid, target, name, Path(name).stem, "auto", activity, issued_by, issued_on, zip_name))
    if not done and not skipped:
        raise HTTPException(400, "the zip holds no files")
    return {"zip": zip_name, "documents": done, "skipped": skipped}


async def _register(rid: str, target: Path, name: str, title: str = "", kind: str = "auto", activity: str = "", issued_by: str = "", issued_on: str = "", from_zip: str = "") -> dict:
    """A kept file read, sorted and put on the register."""
    saved = target.name
    clean = re.sub(r"[^\w .,()\-]", "_", name or saved)[:120]
    try:
        pages = await asyncio.to_thread(K.read_pages, target)  # hundreds of pages take a while, and the API has other requests to answer
    except Exception as e:  # noqa: BLE001 - a broken file is a fact about the file, not a failure of the upload
        pages, broken = [], f"the file could not be read: {type(e).__name__}"
    else:
        broken = ""
    text = "\n\n".join(pages).strip()[:extract.MAX_TEXT]
    blank = sum(1 for x in pages if not x.strip())
    how = broken or (f"{target.suffix[1:].upper()}, {len(pages)} pages{f', {blank} with no text to read' if blank else ''}" if text else f"{len(pages)} pages of images: no text to read without a model" if pages else "kept as a file: no text to read")
    K.keep_pages(rid, pages)
    sorted_kind, use, why = K.classify(name or saved, pages)
    kind = sorted_kind if kind in ("auto", "") else kind
    sorting = {"use": use, "why": why, "pages": len(pages), "words": sum(len(p.split()) for p in pages), "digest": K.digest_of(target)}
    return P.put("document", rid, {"id": rid, "source": "upload", "kind": kind, "title": title.strip() or clean, "from": issued_by, "date": issued_on or time.strftime("%Y-%m-%d"), **sorting, "text": text, "how_read": how, "file": saved, "filename": clean, "activities": [activity] if activity else [], "status": "received", "facts": extract.facts(text), **({"from_zip": from_zip} if from_zip else {})}, P.PM, "uploaded a document", f"{clean}, from {from_zip}" if from_zip else clean)


class BriefIn(BaseModel):
    text: str


MOST_BRIEF = 20_000  # about ten pages. Every planner reads it, so anything longer goes in as a file, and only its pages are sent


@router.post("/api/project/brief")
def add_brief(body: BriefIn) -> dict:
    """What a person told the agents about the job, in their own words. It is kept as a document of theirs, so the agents can cite it and it can be opened beside what cites it, and each agent is also told it as their instruction."""
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "say what you are planning first")
    if len(text) > MOST_BRIEF:
        raise HTTPException(413, f"that is {len(text):,} characters, and the most here is {MOST_BRIEF:,}. Save it as a file and attach it instead")
    if not P.is_blank():
        raise HTTPException(409, "the scenario has its own package: start a project of your own")
    if P.busy:
        raise HTTPException(409, "the agents are working: wait for them, or stop them, first")
    rid = P.next_id("document")
    saved = f"{rid}.txt"
    target = A.upload_folder() / saved
    target.write_text(text, encoding="utf-8")
    K.keep_pages(rid, [text])
    return P.put("document", rid, {"id": rid, "source": "upload", "typed": True, "kind": "scope", "title": f"You told the agents: {text[:48].strip()}{'…' if len(text) > 48 else ''}", "from": P.PM, "date": time.strftime("%Y-%m-%d"), "use": True, "why": "You wrote it for the agents", "pages": 1, "words": len(text.split()), "digest": K.digest_of(target), "text": text, "how_read": "", "file": saved, "filename": saved, "activities": [], "status": "received", "facts": extract.facts(text)}, P.PM, "told the agents about the plan", text[:120])


@router.get("/api/project/documents/{did}/text")
def document_text(did: str) -> dict:
    return guarded(M.document_text, did)


@router.get("/api/project/documents/{did}/file")
def document_file(did: str) -> FileResponse:
    rec = P.get("document", did)
    if not rec or not rec.get("file"):
        raise HTTPException(404, "no file for this document")
    return FileResponse(A.upload_folder() / rec["file"], filename=rec.get("filename") or rec["file"], content_disposition_type="inline")  # inline, so that a source can be read beside what cites it


@router.post("/api/project/documents/{did}/decide")
def decide_document(did: str, body: DocDecision) -> dict:
    return guarded(M.decide_document, did, body.status, body.note)


@router.post("/api/project/documents/{did}/link")
def link_document(did: str, body: DocLink) -> dict:
    return guarded(M.link_document, did, body.activity)


@router.post("/api/project/documents/{did}/read")
async def read_document(did: str, body: Mode) -> dict:
    try:
        return await A.read_document(did, body.mode)
    except KeyError as e:
        raise HTTPException(404, f"no such record: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.post("/api/project/rfi-drafts")
def draft_rfi(body: DraftRfi) -> dict:
    """A draft to look at, from a document or a person's note. Issuing it is a separate step."""
    return guarded(P.add_rfi, {"subject": body.subject, "question": body.question, "to": body.to, "activity": body.activity, "impact": body.impact, "drafted_by": "Document agent"}, "draft", P.PM)


@router.get("/api/project/readiness")
def readiness() -> dict:
    return M.readiness()


# ------------------------------------------------------------------------------------------------ procurement and subcontractors


@router.post("/api/project/orders")
def add_order(body: NewOrder) -> dict:
    return guarded(P.add_order, body.item, body.supplier, body.activity, body.needed, body.promised, body.value, body.package)


@router.get("/api/project/materials")
def materials() -> dict:
    return M.materials()


@router.get("/api/project/suppliers")
def suppliers() -> dict:
    return M.suppliers()


@router.get("/api/project/assignments")
def assignments() -> dict:
    return M.assignments()


@router.post("/api/project/assignments")
def assign(body: Assign) -> dict:
    if body.section:
        return guarded(M.reassign, body.activity, body.section, body.by)
    return guarded(M.confirm_assignment, body.activity, body.by)


# ------------------------------------------------------------------------------------------------ QA/QC


@router.post("/api/project/inspections")
def add_inspection(body: NewInspection) -> dict:
    return guarded(P.add_inspection, body.title, body.activity, body.by, body.next, body.criteria, body.hold_point)


@router.post("/api/project/inspections/{iid}/result")
def inspection_result(iid: str, body: InspectionResult) -> dict:
    return guarded(P.inspection_result, iid, body.result, body.checklist, body.note, body.photos)


@router.get("/api/project/photos")
def photos() -> dict:
    return M.photos()


@router.post("/api/project/photos")
async def upload_photo(file: UploadFile = File(...), caption: str = Form(""), activity: str = Form(""), area: str = Form(""), taken_by: str = Form("")) -> dict:
    rid = P.next_id("photo")
    saved = _saved_name(rid, file.filename or "", PHOTO_TYPES)
    await _keep(file, A.upload_folder() / saved)
    return P.put("photo", rid, {"id": rid, "source": "upload", "file": saved, "caption": caption.strip() or rid, "activity": activity, "area": area, "date": P.TODAY, "taken_by": taken_by or P.PM}, P.PM, "uploaded a photo", caption)


@router.post("/api/project/photos/{photo_id}/review")
async def review_photo(photo_id: str, body: Mode) -> dict:
    try:
        return await A.review_photo(photo_id, body.mode)
    except KeyError as e:
        raise HTTPException(404, f"no such record: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


# ------------------------------------------------------------------------------------------------ the control tower and each module's agents


@router.get("/api/project/tower")
def tower() -> dict:
    return M.tower()


class RiskIn(BaseModel):
    title: str
    category: str = "General"
    detail: str = ""
    activity: str = ""
    probability: Whole = 3
    impact: Whole = 3
    owner: str = ""
    strategy: str = "Mitigate"
    response: str = ""
    due: str = ""


class RiskChange(BaseModel):
    probability: Whole | None = None
    impact: Whole | None = None
    owner: str | None = None
    strategy: str | None = None
    response: str | None = None
    due: str | None = None
    status: str | None = None


@router.get("/api/project/risks")
def risks() -> dict:
    return M.risk_register()


@router.post("/api/project/risks")
def add_risk(body: RiskIn) -> dict:
    return guarded(P.add_risk, body.title, body.category, body.detail, body.activity, body.probability, body.impact, body.owner, body.strategy, body.response, body.due)


@router.post("/api/project/risks/{rid}")
def set_risk(rid: str, body: RiskChange) -> dict:
    return guarded(P.set_risk, rid, body.probability, body.impact, body.owner, body.strategy, body.response, body.due, body.status)


class KindIn(BaseModel):
    kind: str


class ReviewIn(BaseModel):
    keys: list[str]
    verdict: str
    note: str = ""


class ItemEdit(BaseModel):
    key: str
    text: str


class NoteIn(BaseModel):
    text: str
    module: str = "tower"


@router.get("/api/project/memory")
def memories() -> dict:
    return A.memories()


@router.post("/api/project/memory")
def remember(body: NoteIn) -> dict:
    return guarded(A.note, body.module, body.text)


@router.post("/api/project/memory/{mid}/forget")
def forget(mid: str) -> dict:
    return guarded(A.forget, mid)


class UseIn(BaseModel):
    use: bool


@router.get("/api/project/package")
def package_review() -> dict:
    return K.review()


@router.post("/api/project/documents/{did}/kind")
def set_document_kind(did: str, body: KindIn) -> dict:
    """A person puts a document in another category, and the agents read it as that."""
    rec = P.get("document", did)
    if not rec or rec.get("source") != "upload":
        raise HTTPException(404, "no such upload")
    if body.kind not in DOC_KINDS:
        raise HTTPException(400, f"no such category: {body.kind}")
    return P.patch("document", did, {"kind": body.kind, "overruled": True}, P.PM, "put a document in a category", f"{rec['title']}: {body.kind}")


@router.post("/api/project/documents/{did}/use")
def use_document(did: str, body: UseIn) -> dict:
    """A person overrules the sorting: what goes to a model is their decision."""
    rec = P.get("document", did)
    if not rec or rec.get("source") != "upload":
        raise HTTPException(404, "no such upload")
    return P.patch("document", did, {"use": body.use, "overruled": True, "why": "You chose to send it to the agents" if body.use else "You left it out"}, P.PM, "sorted a document", f"{rec['title']}: {'used' if body.use else 'left out'}")


@router.get("/api/project/control-accounts")
def control_accounts() -> dict:
    return M.control_accounts()


@router.get("/api/project/work-packages")
def work_packages() -> dict:
    return M.work_packages()


@router.get("/api/project/wbs-dictionary")
def wbs_dictionary() -> dict:
    return M.dictionary()


@router.get("/api/project/procedures")
def procedures() -> dict:
    return M.procedures()


@router.get("/api/project/critical-path")
def critical_path() -> dict:
    return M.critical_path()


@router.get("/api/project/model-3d")
def model_3d() -> dict:
    """The building through time, for the 3D timeline: a schematic model, from the WBS, the schedule's dates and the drawings' grid."""
    return model3d.build()


@router.get("/api/project/executive")
def executive() -> dict:
    return M.executive()


@router.get("/api/project/cost-estimate")
def cost_estimate() -> dict:
    return M.cost_estimate()


@router.get("/api/project/agents")
def agents_bench() -> dict:
    return A.bench()


@router.get("/api/project/agents/{module}")
def agent_view(module: str) -> dict:
    return guarded(A.view, module)


@router.post("/api/project/agents/{module}/ask")
async def agent_ask(module: str, body: Mode) -> dict:
    try:
        return await A.ask(module, body.mode)
    except KeyError as e:
        raise HTTPException(404, f"no such module: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.post("/api/project/agents/{module}/{index}/{verdict}")
def agent_decide(module: str, index: int, verdict: str) -> dict:
    return guarded(A.decide, module, index, verdict)


from . import contract_admin  # noqa: E402 - its routes join these, and it imports the modules above
from . import reports  # noqa: E402 - the same
from . import tender  # noqa: E402 - the same
from . import twin  # noqa: E402 - the same

router.include_router(contract_admin.router)
router.include_router(reports.router)
router.include_router(tender.router)
router.include_router(twin.router)

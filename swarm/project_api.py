"""The API of the project records. Every change here is a person's, and lands in the audit trail."""

from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

from . import opc, project as P
from .data import ProjectData

router = APIRouter()


def guarded(fn: Callable, *a, **k):
    """A record that does not exist is a 404; a step the workflow does not allow is a 409, with why."""
    try:
        return fn(*a, **k)
    except KeyError as e:
        raise HTTPException(404, f"no such record: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


class ActivityIn(BaseModel):
    progress: int | None = None
    duration: int | None = None


class CostIn(BaseModel):
    package: str
    description: str
    amount: int
    recoverable_from: str = ""


class SubIn(BaseModel):
    name: str
    trade: str
    scope: str = ""
    crew: int = 0


class DocIn(BaseModel):
    name: str
    expires: str


class PromiseIn(BaseModel):
    promised: str = ""


class ReportIn(BaseModel):
    date: str = ""
    area: str
    package: str = ""
    crew: int | None = None
    weather: str = ""
    author: str = ""
    text: str


class NcrIn(BaseModel):
    title: str
    by: str
    activity: str = ""
    due: str = ""


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


class WorkItemStatus(BaseModel):
    status: str


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
    P.reset()
    return {"status": "reset"}


@router.get("/api/project/schedule")
def schedule() -> dict:
    return P.schedule()


@router.post("/api/project/schedule/{aid}")
def update_activity(aid: str, body: ActivityIn) -> dict:
    return guarded(P.update_activity, aid, body.progress, body.duration)


@router.get("/api/project/budget")
def budget() -> dict:
    return P.budget()


@router.post("/api/project/cost-items")
def add_cost(body: CostIn) -> dict:
    return guarded(P.add_cost_item, body.package, body.description, body.amount, body.recoverable_from)


@router.get("/api/project/subcontractors")
def subcontractors() -> dict:
    return {"subcontractors": P.subcontractors(), "required_documents": P.REQUIRED_DOCS, "today": P.TODAY}


@router.post("/api/project/subcontractors")
def add_subcontractor(body: SubIn) -> dict:
    return guarded(P.add_subcontractor, body.name, body.trade, body.scope, body.crew)


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
    return {"orders": P.all_of("po"), "today": P.TODAY}


@router.post("/api/project/orders/{pid}/{action}")
def order(pid: str, action: str, body: PromiseIn) -> dict:
    return guarded(P.po_action, pid, action, body.promised)


@router.get("/api/project/daily-reports")
def daily_reports() -> dict:
    data = ProjectData.load()
    return {"reports": sorted(P.daily_reports(), key=lambda r: (r["date"], r["id"]), reverse=True), "photos": sorted(data.photos, key=lambda p: p["date"], reverse=True), "today": P.TODAY,
            "packages": [{"id": p["id"], "name": p["name"]} for p in P.all_of("package")]}


@router.post("/api/project/daily-reports")
def add_report(body: ReportIn) -> dict:
    return guarded(P.add_daily_report, body.model_dump())


@router.post("/api/project/daily-reports/{rid}/verify")
def verify_report(rid: str) -> dict:
    return guarded(P.verify_daily_report, rid)


@router.get("/api/project/photos/{photo_id}")
def photo(photo_id: str) -> FileResponse:
    data = ProjectData.load()
    rec = data.photo(photo_id)  # looked up by ID, never a path from the request
    if not rec:
        raise HTTPException(404, "no such photo")
    return FileResponse(data.folder / "photos" / rec["file"])


@router.get("/api/project/quality")
def quality() -> dict:
    return P.quality()


@router.post("/api/project/ncrs")
def raise_ncr(body: NcrIn) -> dict:
    return guarded(P.raise_ncr, body.title, body.by, body.activity, body.due)


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
    return P.claim()


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
    return guarded(P.add_work_item, body.title, body.owner, body.due, body.activity)


@router.post("/api/project/work-items/{wid}")
def set_work_item(wid: str, body: WorkItemStatus) -> dict:
    return guarded(P.set_work_item, wid, body.status)


@router.get("/api/project/plan-package")
def plan_package() -> dict:
    return {"documents": P.plan_documents(), "scope": P.PC.SCOPE}


@router.get("/api/project/plans")
def plans() -> dict:
    who = {s["id"]: s["name"].replace(" (fictional)", "") for s in P.all_of("subcontractor")}
    return {"plans": P.plans(), "today": P.TODAY, "who": {**who, "self": "Own crew"}}


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
    return opc.procedure_markdown(guarded(P.plan_by_id, pid))


@router.get("/api/project/plans/{pid}/table.csv", response_class=PlainTextResponse)
def plan_table(pid: str) -> str:
    return opc.table_csv(guarded(P.plan_by_id, pid))

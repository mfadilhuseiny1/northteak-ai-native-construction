"""People outside the firm in the workflow. An RFI, a variation or a submittal is sent as a link, by the person who sends it, over their own email or WhatsApp. Whoever holds the link sees that one item and answers it there, with no account, so the answer is the record and nobody has to type it in afterwards. The app sends nothing by itself."""

from __future__ import annotations

import secrets
import time
from contextlib import closing

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import accounts as A, project as P, reports as R, submittals as S

DAYS = 30
ANSWER_MOST = 8000
ASKED = {"rfi": "rfi", "variation": "variation", "submittal": "submittal"}
DECISIONS = {"rfi": [], "variation": ["approved", "rejected"], "submittal": ["approved", "noted", "rejected"]}


def _ready(kind: str, rid: str, who: str) -> dict:
    """Puts an item in the other side's hands, as sending it does."""
    if kind == "rfi":
        r = P.get("rfi", rid)
        if not r:
            raise KeyError(rid)
        if r["status"] == "answered":
            raise ValueError("this RFI is already answered")
        return P.issue_rfi(rid, who) if r["status"] == "draft" else r
    if kind == "variation":
        v = P.get("variation", rid)
        if not v:
            raise KeyError(rid)
        if v["status"] not in ("proposed", "submitted"):
            raise ValueError("this variation is already decided")
        return R.set_variation(rid, "submitted", who) if v["status"] == "proposed" else v
    if kind == "submittal":
        s = P.get("submittal", rid)
        if not s:
            raise KeyError(rid)
        if s["status"] in ("approved", "noted"):
            raise ValueError("this submittal is already approved")
        return S.submit(rid, who) if s["status"] in ("draft", "rejected") else s
    raise ValueError("only an RFI, a variation or a submittal can be sent")


def share(kind: str, rid: str, to: str = "", who: str = P.PM) -> dict:
    """A link for one item. Sending it again replaces the earlier link."""
    rec = _ready(kind, rid, who)
    token = secrets.token_urlsafe(32)
    active = P.projects()["active"]
    with closing(A._db()) as con:
        con.execute("delete from links where project = ? and kind = ? and rid = ?", (active, kind, rid))
        con.execute("insert into links (hash, project, kind, rid, sent_to, made_by, created, expires) values (?, ?, ?, ?, ?, ?, ?, ?)", (A._hash(token), active, kind, rid, to.strip(), P.person(who), time.strftime("%Y-%m-%d %H:%M"), time.time() + DAYS * 86400))
        con.commit()
    P.patch(ASKED[kind], rid, {"sent": {"to": to.strip() or rec.get("to", ""), "on": P.TODAY, "by": P.person(who)}}, who, "sent a link to the other side", f"{rid} to {to.strip() or rec.get('to', '')}")
    project = P.C_PROJECT().get("name", "")
    title = rec.get("subject") or rec.get("title") or rid
    words = {"rfi": "jawaban atas pertanyaan", "variation": "keputusan atas perubahan pekerjaan", "submittal": "persetujuan atas"}[kind]
    return {"path": f"/reply?t={token}", "days": DAYS, "subject": f"{rid}: {title}", "message": f"Yth. {to.strip() or rec.get('to') or 'Bapak/Ibu'}, mohon {words} \"{title}\" pada proyek {project}. Silakan buka tautan berikut, tidak perlu akun:"}


def _link(token: str) -> dict:
    with closing(A._db()) as con:
        row = con.execute("select * from links where hash = ?", (A._hash(token),)).fetchone()
    if not row or row["expires"] < time.time():
        raise KeyError("link")
    return dict(row)


def _item(link: dict) -> dict:
    rec = P.get(ASKED[link["kind"]], link["rid"])
    if not rec:
        raise KeyError("link")
    info = P.C_PROJECT()
    head = {"project": info.get("name", ""), "owner": info.get("owner", ""), "contractor": info.get("contractor", ""), "kind": link["kind"], "id": link["rid"], "sent_to": link["sent_to"], "decisions": DECISIONS[link["kind"]], "replied": link["replied"]}
    if link["kind"] == "rfi":
        return {**head, "title": rec["subject"], "body": rec["question"], "why": rec.get("impact") or "", "due": rec.get("due") or "", "answer": rec.get("answer") or "", "answered_by": rec.get("answered_by") or "", "open": rec["status"] == "open"}
    if link["kind"] == "variation":
        return {**head, "title": rec["title"], "body": rec.get("note") or rec.get("reason") or "", "why": rec.get("reason") or "", "value": rec["value"], "days": rec["days"], "ref": rec.get("ref") or "", "due": "", "answer": rec.get("reply") or "", "answered_by": rec.get("decided_by") or "", "open": rec["status"] == "submitted", "status": rec["status"]}
    return {**head, "title": rec["title"], "body": rec.get("note") or "", "why": S.KINDS.get(rec["kind"], ""), "ref": rec.get("ref") or "", "rev": rec["rev"], "due": rec.get("needed_by") or "", "answer": (rec["history"] or [{}])[-1].get("note", "") if rec["status"] not in S.OPEN else "", "answered_by": rec.get("decided_by") or "", "open": rec["status"] == "submitted", "status": rec["status"], "file": rec.get("file_name") or ""}


def view(token: str) -> dict:
    link = _link(token)
    path = P.path_of(link["project"])
    if path is None:
        raise KeyError("link")
    with P.visiting(path):
        return _item(link)


def reply(token: str, name: str, text: str, decision: str = "") -> dict:
    link = _link(token)
    if link["replied"]:
        raise ValueError("this link has already been answered")
    name, text = name.strip(), text.strip()
    if not name:
        raise ValueError("Tuliskan nama Anda")
    if len(text) > ANSWER_MOST:
        raise ValueError("Jawaban terlalu panjang")
    path = P.path_of(link["project"])
    if path is None:
        raise KeyError("link")
    who = f"{name} (via link)"
    with P.visiting(path):
        if link["kind"] == "rfi":
            if not text:
                raise ValueError("Tuliskan jawaban Anda")
            P.answer_rfi(link["rid"], text, who)
            P.patch("rfi", link["rid"], {"answered_by": name, "answered_via": "link"}, "", "")
        elif link["kind"] == "variation":
            if decision not in DECISIONS["variation"]:
                raise ValueError("Pilih keputusan Anda")
            R.set_variation(link["rid"], decision, who)
            P.patch("variation", link["rid"], {"decided_by": name, "reply": text, "answered_via": "link"}, "", "")
        else:
            S.decide(link["rid"], decision, text, who)
            P.patch("submittal", link["rid"], {"answered_via": "link"}, "", "")
    with closing(A._db()) as con:
        con.execute("update links set replied = ? where hash = ?", (time.strftime("%Y-%m-%d %H:%M"), link["hash"]))
        con.commit()
    return view(token)


router = APIRouter()


class ShareIn(BaseModel):
    to: str = ""


class ReplyIn(BaseModel):
    name: str
    text: str = ""
    decision: str = ""


def _guarded(fn, *a, **k):
    try:
        return fn(*a, **k)
    except KeyError as e:
        if e.args and e.args[0] == "link":
            raise HTTPException(404, "Tautan ini tidak berlaku lagi. Mohon minta tautan baru.") from e
        raise HTTPException(404, f"no such record: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.post("/api/project/share/{kind}/{rid}")
def share_one(kind: str, rid: str, body: ShareIn) -> dict:
    return _guarded(share, kind, rid, body.to)


@router.get("/api/public/reply/{token}")
def public_view(token: str) -> dict:
    return _guarded(view, token)


@router.post("/api/public/reply/{token}")
def public_reply(token: str, body: ReplyIn) -> dict:
    return _guarded(reply, token, body.name, body.text, body.decision)


@router.get("/api/public/reply/{token}/file")
def public_file(token: str) -> FileResponse:
    link = _guarded(_link, token)
    path = P.path_of(link["project"])
    if link["kind"] != "submittal" or path is None:
        raise HTTPException(404, "no file here")
    with P.visiting(path):
        s = P.get("submittal", link["rid"]) or {}
        return S.file_of(s)

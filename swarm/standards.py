"""The firm's own standards, which every project shares: one list of cost codes, so cost on one job can be compared with cost on the next whatever its documents call the work, and an export accounting can read. The starting list is ours, not a published standard, and the firm edits it. Each work package gets a code from the words in its name, and a person can change it."""

from __future__ import annotations

import csv
import io
import json
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from . import project as P

STARTING = [
    {"code": "01", "name": "Persiapan dan K3", "words": ["persiapan", "smkk", "k3", "mobilisasi"]},
    {"code": "02", "name": "Tanah dan pondasi", "words": ["galian", "urugan", "pondasi", "tiang", "bor pile", "anti rayap"]},
    {"code": "03", "name": "Struktur beton", "words": ["beton", "kolom", "balok", "pelat", "plat lantai", "tangga"]},
    {"code": "04", "name": "Baja dan atap", "words": ["baja", "atap", "genteng"]},
    {"code": "05", "name": "Dinding dan plesteran", "words": ["pasangan", "plester", "dinding", "partisi"]},
    {"code": "06", "name": "Lantai dan finishing", "words": ["finishing", "lantai", "keramik", "granit", "pengecatan", "cat", "plafon", "plafond", "interior"]},
    {"code": "07", "name": "Kusen, pintu dan jendela", "words": ["pintu", "jendela", "kusen", "railing"]},
    {"code": "08", "name": "Fasade", "words": ["fasade", "facade", "curtain", "grc"]},
    {"code": "09", "name": "Plambing dan sanitasi", "words": ["plambing", "plumbing", "saniter", "stp", "sewage", "air bersih", "pompa"]},
    {"code": "10", "name": "Tata udara", "words": ["tata udara", "ac", "hvac", "exhaust"]},
    {"code": "11", "name": "Proteksi kebakaran", "words": ["kebakaran", "fire", "hydrant", "sprinkler"]},
    {"code": "12", "name": "Elektrikal", "words": ["elektrikal", "listrik", "panel", "petir", "solar"]},
    {"code": "13", "name": "Elektronik dan IT", "words": ["lan", "cctv", "proyektor", "tata suara", "telepon"]},
    {"code": "14", "name": "Pekerjaan luar", "words": ["saluran", "vegetasi", "hardscape", "landscape", "lanskap", "pagar"]},
    {"code": "99", "name": "Lain-lain", "words": []},
]
ORDER = ["03", "10", "11", "13", "09", "12", "08", "07", "02", "06", "05", "04", "14", "01"]  # the most particular first: "Elektrikal: Fire Alarm" is fire protection, and "Beton: Atap" is concrete


def _file():
    return P.SCENARIO_DB.parent / "cost_codes.json"


def codes() -> list[dict]:
    path = _file()
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else [dict(c) for c in STARTING]


def save_codes(rows: list[dict]) -> list[dict]:
    clean, seen = [], set()
    for r in rows:
        code, name = str(r.get("code", "")).strip(), str(r.get("name", "")).strip()
        if not code or not name:
            raise ValueError("every cost code needs a code and a name")
        if code in seen:
            raise ValueError(f"cost code {code} is on the list twice")
        seen.add(code)
        clean.append({"code": code, "name": name, "words": [str(w).strip().lower() for w in r.get("words") or [] if str(w).strip()]})
    if not clean:
        raise ValueError("the list cannot be empty")
    _file().write_text(json.dumps(clean, ensure_ascii=False, indent=1), encoding="utf-8")
    return clean


def whole(word: str, text: str) -> bool:
    """Whether a word is in a text as a word of its own: "lan" is a network, and it is inside "lantai"."""
    return re.search(r"(?<![a-z0-9])" + re.escape(word) + r"(?![a-z0-9])", text) is not None


def guess(name: str, account: str, listed: list[dict]) -> str:
    """The code a work package's words point to: its own name first, then its control account's."""
    by = {c["code"]: c for c in listed}
    ranked = [by[k] for k in ORDER if k in by] + [c for c in listed if c["code"] not in ORDER]
    for text in (f"{name.lower()} ", f"{account.lower()} "):
        for c in ranked:
            if any(whole(w, text) for w in c["words"]):
                return c["code"]
    return next((c["code"] for c in listed if not c["words"]), "")


def allocation() -> dict:
    """Each work package with its company code, and what each code adds up to on this project."""
    listed = codes()
    names = {c["code"]: c["name"] for c in listed}
    budget = P.budget()
    packages = {p["id"]: p for p in budget["packages"]}
    money = {b["id"]: b for b in P.all_of("boq")}
    set_by_hand = P.meta("cost_codes") or {}
    rows = []
    for a in P.schedule()["activities"]:
        p = packages.get(a["package"]) or {}
        worth = sum(b["value"] for b in money.values() if b.get("activity") == a["id"])
        code = set_by_hand.get(a["id"]) or guess(a["name"], p.get("name", ""), listed)
        rows.append({"id": a["id"], "wbs": a["code"], "name": a["name"], "account": p.get("name", ""), "package": a["package"], "value": worth, "code": code, "code_name": names.get(code, ""), "by_hand": a["id"] in set_by_hand})
    totals: dict[str, dict] = {}
    for r in rows:
        t = totals.setdefault(r["code"], {"code": r["code"], "name": r["code_name"], "value": 0, "packages": 0, "actual": 0})
        t["value"] += r["value"]
        t["packages"] += 1
    main: dict[str, str] = {}  # an actual cost is recorded on a control account, so it goes to the code most of that account's value falls under
    for pid in packages:
        mine = [r for r in rows if r["package"] == pid]
        by_code: dict[str, int] = {}
        for r in mine:
            by_code[r["code"]] = by_code.get(r["code"], 0) + r["value"]
        main[pid] = max(by_code, key=by_code.get, default="")
    for i in budget["cost_items"]:
        if i.get("actual") and main.get(i["package"]) in totals:
            totals[main[i["package"]]]["actual"] += i["amount"]
    return {"codes": listed, "rows": rows, "totals": sorted(totals.values(), key=lambda t: t["code"]), "account_code": main, "other": sum(1 for r in rows if r["code"] == "99")}


def set_code(aid: str, code: str, who: str = P.PM) -> dict:
    if not any(a["id"] == aid for a in P.schedule()["activities"]):
        raise KeyError(aid)
    if code and not any(c["code"] == code for c in codes()):
        raise ValueError("that code is not on the firm's list")
    chosen = dict(P.meta("cost_codes") or {})
    if code:
        chosen[aid] = code
    else:
        chosen.pop(aid, None)
    P.set_meta("cost_codes", chosen)
    P.log(who, "set a cost code", "activity", aid, code or "back to automatic")
    return allocation()


def firmwide() -> dict:
    """What each company code comes to on each project: the comparison the code exists for."""
    listed = codes()
    rows: dict[str, dict] = {c["code"]: {"code": c["code"], "name": c["name"], "projects": {}} for c in listed}
    names = []
    for p in P.projects()["projects"]:
        path = P.path_of(p["id"])
        if path is None or not path.exists() or p.get("scenario"):
            continue
        with P.visiting(path):
            if not P.all_of("activity"):
                continue
            al = allocation()
        name = str(p["name"])
        names.append(name)
        for t in al["totals"]:
            if t["code"] in rows:
                rows[t["code"]]["projects"][name] = t["value"]
    return {"projects": names, "codes": [r for r in rows.values() if r["projects"]]}


def export_csv() -> str:
    """Budget and actual cost, one line each, with the firm's code. A plain layout with a date and an amount on every line, for accounting to map into whatever it runs. Budget lines carry the schedule's start date."""
    al = allocation()
    info = P.C_PROJECT()
    names = {c["code"]: c["name"] for c in al["codes"]}
    acts = {a["id"]: a for a in P.schedule()["activities"]}
    accounts = {p["id"]: p["name"] for p in P.all_of("package")}
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Project", "Type", "Date", "Reference", "Control account", "WBS", "Work package", "Cost code", "Cost code name", "Description", "Amount (Rp)"])
    money = P.budget()
    for r in al["rows"]:
        if r["value"]:
            w.writerow([info.get("name", ""), "BUDGET", acts[r["id"]]["start"] if r["id"] in acts else "", r["id"], r["account"], r["wbs"], r["name"], r["code"], r["code_name"], "Contract value", r["value"]])
    if not any(r["value"] for r in al["rows"]):  # a job priced by account, not by work package
        for p in money["packages"]:
            code = al["account_code"].get(p["id"], "")
            w.writerow([info.get("name", ""), "BUDGET", "", p["id"], p["name"], "", "", code, names.get(code, ""), "Control budget", p["budget"]])
    for i in money["cost_items"]:
        code = al["account_code"].get(i["package"], "")
        w.writerow([info.get("name", ""), "ACTUAL" if i.get("actual") else "FORECAST", i.get("date") or i.get("added") or "", i["id"], accounts.get(i["package"], i["package"]), "", "", code, names.get(code, ""), i["description"], i["amount"]])
    return "﻿" + out.getvalue()


router = APIRouter()


class CodeIn(BaseModel):
    code: str = ""


class CodesIn(BaseModel):
    codes: list[dict]


@router.get("/api/project/cost-codes")
def project_codes() -> dict:
    return allocation()


@router.post("/api/project/cost-codes/{aid}")
def set_one(aid: str, body: CodeIn) -> dict:
    try:
        return set_code(aid, body.code)
    except KeyError as e:
        raise HTTPException(404, f"no such record: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.get("/api/standards/cost-codes")
def read_codes() -> dict:
    return {"codes": codes()}


@router.post("/api/standards/cost-codes")
def write_codes(body: CodesIn) -> dict:
    try:
        return {"codes": save_codes(body.codes)}
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.get("/api/reports/cost-codes")
def all_projects() -> dict:
    return firmwide()


@router.get("/api/project/export/accounting.csv")
def export() -> Response:
    return Response(export_csv(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="accounting-export.csv"'})

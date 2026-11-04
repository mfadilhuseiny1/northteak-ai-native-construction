"""Who is using the app, and what each person may do. Accounts belong to the firm, so they sit beside the projects.

Until the first account is made, the computer running the app opens without a login, and a request from anywhere else on the network is refused: a laptop presenting the app needs nothing set up, and nothing is open by accident. Once one exists, everyone signs in, and the audit trail names the person who did each thing."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
import time
from contextlib import closing
from http.cookies import SimpleCookie
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from . import project as P

COOKIE = "northteak"
DAYS = 14
MOST_TRIES = 5
WAIT = 60  # seconds a person waits after too many wrong passwords
LOCAL = ("127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", "testclient")

ROLES = {
    "admin": {"name": "Administrator", "can": ("team", "plan", "site", "cost", "comms")},
    "pm": {"name": "Project manager", "can": ("plan", "site", "cost", "comms")},
    "site": {"name": "Site engineer", "can": ("site", "comms")},
    "finance": {"name": "Finance", "can": ("cost",)},
    "viewer": {"name": "Viewer", "can": ()},
}
CAN = {
    "team": "Add people, and change what they may do",
    "plan": "Run the agents, approve plans, and change the WBS and schedule",
    "site": "Move tasks, file daily logs and photos, sign inspections",
    "cost": "Record costs and actuals, variations, claims and invoices",
    "comms": "Send RFIs and submittals, and record their answers",
}
RULES = [
    ("cost", re.compile(r"^/api/project/(cost-items|boq|actuals|variations|contingency|claim|invoices|cost-codes)")),
    ("site", re.compile(r"^/api/project/(daily-reports|photos|board|work-items|inspections|ncrs|orders|assignments|twin/readings)")),
    ("comms", re.compile(r"^/api/rfis|^/api/project/(rfi-drafts|submittals|share)")),
    ("team", re.compile(r"^/api/standards")),
]
_tries: dict[str, tuple[int, float]] = {}


def _path() -> Path:
    return P.SCENARIO_DB.parent / "accounts.db"


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(_path())
    con.row_factory = sqlite3.Row
    con.executescript("""
        create table if not exists users (id integer primary key, name text not null, email text not null unique collate nocase, role text not null, salt blob not null, hash blob not null, active integer not null default 1, created text not null, last_seen text not null default '');
        create table if not exists sessions (hash text primary key, user integer not null, expires real not null);
        create table if not exists links (hash text primary key, project text not null, kind text not null, rid text not null, sent_to text not null default '', made_by text not null default '', created text not null, expires real not null, replied text not null default '');
    """)
    return con


def enabled() -> bool:
    """Whether anyone has an account. Reading this must not make the file, or a laptop that never set up accounts would have one."""
    if not _path().exists():
        return False
    with closing(_db()) as con:
        return con.execute("select 1 from users where active = 1 limit 1").fetchone() is not None


def is_local(client: str, forwarded: str = "", through: str = "") -> bool:
    """Whether a request comes from this computer. The screens' proxy connects from here whoever is asking, so what says where it came from is the address the browser used, which the proxy passes on. That can be faked by someone who means to, so this is the second lock: restart-screens.bat keeps the screens off the network altogether until accounts exist."""
    used = [x.strip().rsplit(":", 1)[0].strip("[]") if x.strip().count(":") in (1, 8) or x.strip().startswith("[") else x.strip() for x in through.split(",") if x.strip()]
    return client in LOCAL and all(h in LOCAL for h in [*[x.strip() for x in forwarded.split(",") if x.strip()], *used])


def _here(request: Request) -> bool:
    return is_local(request.client.host if request.client else "", request.headers.get("x-forwarded-for", ""), request.headers.get("x-forwarded-host", ""))


def needs(method: str, path: str) -> str | None:
    """What a request needs a person to be able to do. Reading needs only a login; a change no rule names is a planning decision."""
    if path.startswith("/api/auth/users"):
        return "team"
    if method in ("GET", "HEAD", "OPTIONS"):
        return None
    return next((need for need, rule in RULES if rule.search(path)), "plan")


def _digest(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2 ** 14, r=8, p=1, maxmem=64 * 1024 * 1024)


def _check_password(password: str) -> None:
    if len(password) < 8:
        raise ValueError("a password needs at least 8 characters")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _public(u: sqlite3.Row) -> dict:
    return {"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"], "role_name": ROLES[u["role"]]["name"], "active": bool(u["active"]), "last_seen": u["last_seen"]}


def add_user(name: str, email: str, role: str, password: str) -> dict:
    name, email = name.strip(), email.strip()
    if not name or "@" not in email:
        raise ValueError("a person needs a name and an email address")
    if role not in ROLES:
        raise ValueError(f"role must be one of: {', '.join(ROLES)}")
    _check_password(password)
    salt = secrets.token_bytes(16)
    with closing(_db()) as con:
        if con.execute("select 1 from users where email = ?", (email,)).fetchone():
            raise ValueError("that email address already has an account")
        cur = con.execute("insert into users (name, email, role, salt, hash, created) values (?, ?, ?, ?, ?, ?)", (name, email, role, salt, _digest(password, salt), time.strftime("%Y-%m-%d %H:%M")))
        con.commit()
        return _public(con.execute("select * from users where id = ?", (cur.lastrowid,)).fetchone())


def users() -> list[dict]:
    if not _path().exists():
        return []
    with closing(_db()) as con:
        return [_public(u) for u in con.execute("select * from users order by id")]


def change_user(uid: int, role: str | None = None, active: bool | None = None, password: str | None = None) -> dict:
    with closing(_db()) as con:
        u = con.execute("select * from users where id = ?", (uid,)).fetchone()
        if not u:
            raise KeyError(f"user {uid}")
        if role is not None and role not in ROLES:
            raise ValueError(f"role must be one of: {', '.join(ROLES)}")
        leaves = u["role"] == "admin" and u["active"] and ((role is not None and role != "admin") or active is False)
        if leaves and con.execute("select count(*) from users where role = 'admin' and active = 1").fetchone()[0] <= 1:
            raise ValueError("this is the last administrator: make someone else one first")
        if role is not None:
            con.execute("update users set role = ? where id = ?", (role, uid))
        if active is not None:
            con.execute("update users set active = ? where id = ?", (1 if active else 0, uid))
            if not active:
                con.execute("delete from sessions where user = ?", (uid,))
        if password:
            _check_password(password)
            salt = secrets.token_bytes(16)
            con.execute("update users set salt = ?, hash = ? where id = ?", (salt, _digest(password, salt), uid))
            con.execute("delete from sessions where user = ?", (uid,))  # whoever had it is signed out
        con.commit()
        return _public(con.execute("select * from users where id = ?", (uid,)).fetchone())


def sign_in(email: str, password: str) -> tuple[str, dict]:
    key = email.strip().lower()
    count, until = _tries.get(key, (0, 0.0))
    if until > time.time():
        raise PermissionError(f"too many tries: wait {int(until - time.time()) + 1} seconds")
    with closing(_db()) as con:
        u = con.execute("select * from users where email = ? and active = 1", (email.strip(),)).fetchone()
        good = bool(u) and hmac.compare_digest(_digest(password, u["salt"]), u["hash"])
        if not good:
            if not u:
                _digest(password, b"\0" * 16)  # as long as a real one takes, so the answer does not say which addresses have accounts
            count += 1
            _tries[key] = (0, time.time() + WAIT) if count >= MOST_TRIES else (count, 0.0)
            raise PermissionError("that email and password do not match")
        _tries.pop(key, None)
        token = secrets.token_urlsafe(32)
        con.execute("delete from sessions where expires < ?", (time.time(),))
        con.execute("insert into sessions (hash, user, expires) values (?, ?, ?)", (_hash(token), u["id"], time.time() + DAYS * 86400))
        con.execute("update users set last_seen = ? where id = ?", (time.strftime("%Y-%m-%d %H:%M"), u["id"]))
        con.commit()
        return token, _public(u)


def sign_out(token: str) -> None:
    if _path().exists():
        with closing(_db()) as con:
            con.execute("delete from sessions where hash = ?", (_hash(token),))
            con.commit()


def user_of(token: str) -> dict | None:
    if not token or not _path().exists():
        return None
    with closing(_db()) as con:
        u = con.execute("select u.* from sessions s join users u on u.id = s.user where s.hash = ? and s.expires > ? and u.active = 1", (_hash(token), time.time())).fetchone()
        return _public(u) if u else None


def token_in(cookie_header: str) -> str:
    jar: SimpleCookie = SimpleCookie()
    try:
        jar.load(cookie_header or "")
    except Exception:  # noqa: BLE001 - a browser's other cookies are not ours to judge
        return ""
    return jar[COOKIE].value if COOKIE in jar else ""


class Gate:
    """Every request to the API passes here, and names the person for the audit trail. It wraps the whole app, so a route added later is covered without anyone remembering to."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] != "http" or not path.startswith("/api/") or path.startswith("/api/public/"):
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
        client = (scope.get("client") or ("",))[0]
        method = scope.get("method", "GET")
        open_door = path in ("/api/auth/me", "/api/auth/login", "/api/auth/logout", "/api/auth/first", "/api/auth/password")

        async def refuse(status: int, why: str):
            body = ('{"detail": "%s"}' % why).encode("utf-8")
            await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})

        if not enabled():
            if not open_door and not is_local(client, headers.get("x-forwarded-for", ""), headers.get("x-forwarded-host", "")):
                return await refuse(403, "Accounts are not set up, so this app opens only on the computer running it.")
            return await self.app(scope, receive, send)
        if open_door:
            return await self.app(scope, receive, send)
        user = user_of(token_in(headers.get("cookie", "")))
        if not user:
            return await refuse(401, "Sign in first.")
        need = needs(method, path)
        if need and need not in ROLES[user["role"]]["can"]:
            return await refuse(403, f"Your role, {user['role_name']}, cannot do this. Ask a project manager.")
        mark = P.ACTOR.set(user["name"])
        try:
            await self.app(scope, receive, send)
        finally:
            P.ACTOR.reset(mark)


router = APIRouter()


class FirstIn(BaseModel):
    name: str
    email: str
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


class PasswordIn(BaseModel):
    old: str
    new: str


class UserIn(BaseModel):
    name: str
    email: str
    role: str
    password: str


class UserChange(BaseModel):
    role: str | None = None
    active: bool | None = None
    password: str | None = None


def _start(response: Response, request: Request, token: str) -> None:
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(COOKIE, token, max_age=DAYS * 86400, httponly=True, samesite="lax", secure=secure, path="/")


def _asked(fn, *a, **k):
    try:
        return fn(*a, **k)
    except KeyError as e:
        raise HTTPException(404, f"no such person: {e.args[0]}") from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    except PermissionError as e:
        raise HTTPException(401, str(e)) from e


@router.get("/api/auth/me")
def me(request: Request) -> dict:
    on = enabled()
    user = user_of(token_in(request.headers.get("cookie", ""))) if on else None
    local = _here(request)
    return {"enabled": on, "user": user, "local": local, "can": list(ROLES[user["role"]]["can"]) if user else list(CAN) if not on else [],
            "roles": [{"key": k, "name": r["name"], "can": list(r["can"])} for k, r in ROLES.items()], "abilities": CAN}


@router.post("/api/auth/first")
def first(body: FirstIn, request: Request, response: Response) -> dict:
    """The first account, which is an administrator. Only from the computer running the app, and only while there is none."""
    if enabled():
        raise HTTPException(409, "accounts are already set up: an administrator adds people")
    if not _here(request):
        raise HTTPException(403, "the first account is made on the computer running the app")
    user = _asked(add_user, body.name, body.email, "admin", body.password)
    token, _ = _asked(sign_in, body.email, body.password)
    _start(response, request, token)
    return user


@router.post("/api/auth/login")
def login(body: LoginIn, request: Request, response: Response) -> dict:
    token, user = _asked(sign_in, body.email, body.password)
    _start(response, request, token)
    return user


@router.post("/api/auth/logout")
def logout(request: Request, response: Response) -> dict:
    sign_out(token_in(request.headers.get("cookie", "")))
    response.delete_cookie(COOKIE, path="/")
    return {"signed_out": True}


@router.post("/api/auth/password")
def password(body: PasswordIn, request: Request) -> dict:
    user = user_of(token_in(request.headers.get("cookie", "")))
    if not user:
        raise HTTPException(401, "Sign in first.")
    _asked(sign_in, user["email"], body.old)
    return _asked(change_user, user["id"], password=body.new)


@router.get("/api/auth/users")
def team() -> dict:
    return {"users": users()}


@router.post("/api/auth/users")
def new_user(body: UserIn) -> dict:
    return _asked(add_user, body.name, body.email, body.role, body.password)


@router.post("/api/auth/users/{uid}")
def edit_user(uid: int, body: UserChange) -> dict:
    return _asked(change_user, uid, body.role, body.active, body.password)

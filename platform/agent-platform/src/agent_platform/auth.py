"""Single-operator bootstrap, hashed revocable sessions, and origin-bound CSRF."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import Request

from .domain import Problem

PASSWORDS = PasswordHasher()
DUMMY_PASSWORD_HASH = PASSWORDS.hash(secrets.token_urlsafe(32))


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def audit(conn, actor, action, target=None, decision="allow"):
    conn.execute(
        "INSERT INTO audit_events(id,actor,action,target,decision) VALUES (%s,%s,%s,%s,%s)",
        (uuid4(), actor, action, target, decision),
    )


def bootstrap(db, username, password):
    if not username.strip() or len(username) > 120 or not 12 <= len(password) <= 1024:
        raise ValueError("Username required; password must contain 12–1024 characters")
    password_hash = PASSWORDS.hash(password)
    with db.transaction() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(77310402)")
        if conn.execute("SELECT id FROM operators").fetchone():
            raise ValueError("Operator already exists; bootstrap never replaces credentials")
        operator_id = uuid4()
        conn.execute(
            "INSERT INTO operators(id,username,password_hash) VALUES (%s,%s,%s)",
            (operator_id, username.strip(), password_hash),
        )
        audit(conn, operator_id, "operator.bootstrapped")
        return operator_id


class Auth:
    def __init__(self, db, settings):
        self.db = db
        self.settings = settings

    def lookup(self, token):
        if not token or len(token) > 128:
            return None
        with self.db.transaction() as conn:
            return conn.execute(
                "SELECT s.token_hash,s.csrf_hash,s.operator_id,s.expires_at,o.username "
                "FROM sessions s JOIN operators o ON o.id=s.operator_id "
                "WHERE token_hash=%s AND revoked_at IS NULL AND expires_at>now()",
                (digest(token),),
            ).fetchone()

    def require(self, request: Request):
        session = self.lookup(request.cookies.get(self.settings.session_cookie))
        if session is None:
            raise Problem(401, "authentication_required")
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            self.csrf(request, session)
        return session

    def csrf(self, request, session=None):
        token = request.headers.get("x-csrf-token", "")
        cookie = request.cookies.get(self.settings.csrf_cookie, "")
        if (
            request.headers.get("origin") != self.settings.origin
            or not 32 <= len(token) <= 128
            or not hmac.compare_digest(token, cookie)
            or (session and not hmac.compare_digest(digest(token), session["csrf_hash"]))
        ):
            raise Problem(403, "csrf_rejected")

    def cookie(self, response, name, value, max_age):
        response.set_cookie(
            name,
            value,
            max_age=max_age,
            path="/",
            secure=self.settings.secure,
            httponly=True,
            samesite="strict",
        )

    def session_view(self, request, response):
        session = self.lookup(request.cookies.get(self.settings.session_cookie))
        csrf = request.cookies.get(self.settings.csrf_cookie, "")
        if not 32 <= len(csrf) <= 128 or (
            session and not hmac.compare_digest(digest(csrf), session["csrf_hash"])
        ):
            csrf = secrets.token_urlsafe(32)
            if session:
                with self.db.transaction() as conn:
                    conn.execute(
                        "UPDATE sessions SET csrf_hash=%s WHERE token_hash=%s",
                        (digest(csrf), session["token_hash"]),
                    )
        self.cookie(response, self.settings.csrf_cookie, csrf, self.settings.session_seconds)
        return {
            "authenticated": session is not None,
            "username": session["username"] if session else None,
            "csrf_token": csrf,
            "expires_at": session["expires_at"] if session else None,
        }

    def login(self, request, response, data):
        self.csrf(request)
        bucket = digest(request.client.host if request.client else "local")
        # Commit the rate-limit charge even for a rejected login.
        with self.db.transaction() as conn:
            limit = conn.execute(
                "INSERT INTO login_limits(bucket,attempts,window_start) VALUES (%s,1,now()) "
                "ON CONFLICT(bucket) DO UPDATE SET "
                "attempts=CASE WHEN login_limits.window_start<now()-interval '5 minutes' "
                "THEN 1 ELSE login_limits.attempts+1 END, "
                "window_start=CASE WHEN login_limits.window_start<now()-interval '5 minutes' "
                "THEN now() ELSE login_limits.window_start END RETURNING attempts",
                (bucket,),
            ).fetchone()
            row = conn.execute(
                "SELECT * FROM operators WHERE username=%s", (data.username,)
            ).fetchone()
        if limit["attempts"] > 10:
            raise Problem(429, "login_rate_limited")
        try:
            PASSWORDS.verify(row["password_hash"] if row else DUMMY_PASSWORD_HASH, data.password)
            valid = row is not None
        except VerificationError:
            valid = False
        if not valid:
            raise Problem(401, "invalid_credentials")
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        expires = datetime.now(UTC) + timedelta(seconds=self.settings.session_seconds)
        with self.db.transaction() as conn:
            previous = request.cookies.get(self.settings.session_cookie)
            if previous:
                conn.execute(
                    "UPDATE sessions SET revoked_at=now() WHERE token_hash=%s", (digest(previous),)
                )
            conn.execute(
                (
                    "INSERT INTO sessions(token_hash,operator_id,csrf_hash,expires_at)"
                    " VALUES (%s,%s,%s,%s)"
                ),
                (digest(token), row["id"], digest(csrf), expires),
            )
            conn.execute("DELETE FROM login_limits WHERE bucket=%s", (bucket,))
            audit(conn, row["id"], "session.created")
        self.cookie(response, self.settings.session_cookie, token, self.settings.session_seconds)
        self.cookie(response, self.settings.csrf_cookie, csrf, self.settings.session_seconds)
        return {
            "authenticated": True,
            "username": row["username"],
            "csrf_token": csrf,
            "expires_at": expires,
        }

    def logout(self, request, response):
        session = self.require(request)
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE sessions SET revoked_at=now() WHERE token_hash=%s", (session["token_hash"],)
            )
            audit(conn, session["operator_id"], "session.revoked")
        for name in (self.settings.session_cookie, self.settings.csrf_cookie):
            response.delete_cookie(
                name, path="/", secure=self.settings.secure, httponly=True, samesite="strict"
            )

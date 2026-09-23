"""Control-side model admission and durable, conservative request accounting.

Admission commits before network dispatch. A crash at either side of that boundary
must never cause an automatic second dispatch or refund an uncertain request slot.
"""

import re
import secrets
from uuid import UUID

from .auth import audit
from .domain import Problem
from .model_policy import MODEL, canonical, response, sensitive, sha
from .model_upstream import FixtureUpstream
from .store import event


class ModelProxy:
    def __init__(self, db, policy, *, upstream=None):
        self.db, self.policy = db, policy
        self.upstream = upstream or FixtureUpstream(policy)

    def live(self, conn, run_id, generation, owner):
        # Same job -> run order as cancel/pause/recovery. Read the clock AFTER locks.
        job = conn.execute("SELECT * FROM jobs WHERE run_id=%s FOR UPDATE", (run_id,)).fetchone()
        run = conn.execute("SELECT * FROM runs WHERE id=%s FOR UPDATE", (run_id,)).fetchone()
        now = conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
        if (
            not job
            or not run
            or job["status"] != "leased"
            or job["lease_owner"] != owner
            or job["generation"] != generation
            or not job["lease_until"]
            or job["lease_until"] <= now
            or run["generation"] != generation
            or run["deadline"] <= now
            or run["state"] != "running"
            or run["backend"] != "openhands"
            or run["cancel_requested_at"]
            or run["control_action"]
            or run["cleanup_state"] != "pending"
        ):
            raise Problem(409, "model_run_not_live")
        profile = conn.execute(
            "SELECT model_ref FROM agent_profile_revisions WHERE id=%s", (run["profile_revision"],)
        ).fetchone()
        binding = conn.execute(
            "SELECT b.*,r.released_at FROM sandbox_bindings b JOIN resource_reservations r "
            "ON r.sandbox_id=b.id WHERE b.id=%s",
            (run["sandbox_id"],),
        ).fetchone()
        if (
            not profile
            or profile["model_ref"] != MODEL
            or not binding
            or binding["run_id"] != run["id"]
            or binding["generation"] != generation
            or binding["desired_state"] != "running"
            or binding["observed_state"] != "running"
            or binding["cleanup_state"] != "pending"
            or binding["released_at"] is not None
            or binding["lease_deadline"] <= now
        ):
            raise Problem(409, "model_runtime_unconfirmed")
        return run, now

    def pin(self, conn, run_id):
        row = conn.execute("SELECT * FROM model_proxy_runs WHERE run_id=%s", (run_id,)).fetchone()
        if not row:
            conn.execute(
                "INSERT INTO model_proxy_runs(run_id,policy_sha256,request_limit) "
                "VALUES (%s,%s,%s)",
                (run_id, self.policy.digest, self.policy.request_limit),
            )
        elif row["policy_sha256"] != self.policy.digest:
            raise Problem(409, "model_policy_changed")

    def issue(self, run_id, generation, owner):
        run_id, owner = UUID(str(run_id)), UUID(str(owner))
        token = "mp1_" + secrets.token_urlsafe(32)
        with self.db.transaction() as conn:
            run, _ = self.live(conn, run_id, generation, owner)
            self.pin(conn, run_id)
            conn.execute(
                "UPDATE model_proxy_tokens SET revoked_at=clock_timestamp() "
                "WHERE run_id=%s AND revoked_at IS NULL",
                (run_id,),
            )
            conn.execute(
                "INSERT INTO model_proxy_tokens(token_hash,run_id,generation,"
                "lease_owner,expires_at) "
                "VALUES (%s,%s,%s,%s,LEAST(%s,clock_timestamp()+interval '5 minutes'))",
                (sha(token.encode()), run_id, generation, owner, run["deadline"]),
            )
            audit(conn, None, "model.token_issued", str(run_id))
        return token

    def revoke(self, run_id):
        with self.db.transaction() as conn:
            # Serialize issuance and admission; does not alter lifecycle/generation.
            conn.execute("SELECT id FROM jobs WHERE run_id=%s FOR UPDATE", (run_id,)).fetchone()
            conn.execute("SELECT id FROM runs WHERE id=%s FOR UPDATE", (run_id,)).fetchone()
            conn.execute(
                "UPDATE model_proxy_tokens SET revoked_at=clock_timestamp() "
                "WHERE run_id=%s AND revoked_at IS NULL",
                (run_id,),
            )
            audit(conn, None, "model.token_revoked", str(run_id))

    def authorize(self, conn, run_id, token):
        if not isinstance(token, str) or not re.fullmatch(r"mp1_[A-Za-z0-9_-]{43}", token):
            raise Problem(401, "model_token_invalid")
        token_hash = sha(token.encode())
        credential = conn.execute(
            "SELECT * FROM model_proxy_tokens WHERE token_hash=%s AND run_id=%s",
            (token_hash, run_id),
        ).fetchone()
        if not credential:
            raise Problem(401, "model_token_invalid")
        run, now = self.live(conn, run_id, credential["generation"], credential["lease_owner"])
        # Re-read after run lock: issuance/revocation may have committed while waiting.
        credential = conn.execute(
            "SELECT * FROM model_proxy_tokens WHERE token_hash=%s", (token_hash,)
        ).fetchone()
        if credential["revoked_at"] or credential["expires_at"] <= now:
            raise Problem(401, "model_token_invalid")
        self.pin(conn, run_id)
        return run

    def reserve(self, run_id, token, request_id, payload):
        fingerprint = sha(canonical(payload))
        with self.db.transaction() as conn:
            run = self.authorize(conn, run_id, token)
            existing = conn.execute(
                "SELECT payload_sha256 FROM model_proxy_requests WHERE run_id=%s AND request_id=%s",
                (run_id, request_id),
            ).fetchone()
            if existing:
                code = (
                    "model_request_already_reserved"
                    if existing["payload_sha256"] == fingerprint
                    else "model_idempotency_conflict"
                )
                raise Problem(409, code)
            count = conn.execute(
                "SELECT count(*) AS n FROM model_proxy_requests WHERE run_id=%s", (run_id,)
            ).fetchone()["n"]
            if count >= self.policy.request_limit:
                raise Problem(429, "model_request_limit_reached")
            conn.execute(
                "INSERT INTO model_proxy_requests(run_id,request_id,generation,payload_sha256,"
                "status,reason) VALUES (%s,%s,%s,%s,'reserved','dispatch_outcome_unknown')",
                (run_id, request_id, run["generation"], fingerprint),
            )
            event(
                conn,
                run_id,
                "usage.updated",
                {
                    "request_id": str(request_id),
                    "status": "reserved",
                    "cost_status": "unknown",
                    "request_slots_consumed": count + 1,
                    "request_limit": self.policy.request_limit,
                    "fixture": True,
                },
            )
            audit(conn, None, "model.request_reserved", str(run_id))
        # Transaction exits before any upstream call; a reserved row is never redispatched.

    def settle(self, run_id, request_id, *, usage=None, reason="dispatch_outcome_unknown"):
        with self.db.transaction() as conn:
            # Event producers lock run first. No job lock is needed for accounting a
            # response to a request admitted earlier, even after cancellation/recovery.
            conn.execute("SELECT id FROM runs WHERE id=%s FOR UPDATE", (run_id,)).fetchone()
            status = "final" if usage is not None else "unknown"
            row = conn.execute(
                "UPDATE model_proxy_requests SET status=%s,reason=%s,input_tokens=%s,"
                "output_tokens=%s,settled_at=clock_timestamp() "
                "WHERE run_id=%s AND request_id=%s AND status='reserved' RETURNING request_id",
                (
                    status,
                    reason,
                    usage["prompt_tokens"] if usage else None,
                    usage["completion_tokens"] if usage else None,
                    run_id,
                    request_id,
                ),
            ).fetchone()
            if not row:
                raise Problem(409, "model_settlement_conflict")
            event(
                conn,
                run_id,
                "usage.updated",
                {
                    "request_id": str(request_id),
                    "status": status,
                    "cost_status": "unknown",
                    "input_tokens": usage["prompt_tokens"] if usage else None,
                    "output_tokens": usage["completion_tokens"] if usage else None,
                    "amount_decimal": None,
                    "fixture": True,
                },
            )
            audit(conn, None, "model.request_settled", str(run_id), status)

    def complete(self, run_id, token, request_id, data):
        payload = data.payload()
        known = (token, self.policy.credential)
        if sensitive(payload, known):
            raise Problem(422, "model_sensitive_request")
        self.reserve(run_id, token, request_id, payload)
        try:
            raw = self.upstream.complete(payload)
            value, usage = response(raw, payload["max_tokens"], known)
        except Problem as exc:
            self.settle(run_id, request_id, reason=exc.code)
            raise
        self.settle(run_id, request_id, usage=usage, reason="fixture_reported_usage")
        # Accounting survives revocation; stale output cannot enter a resumed generation.
        with self.db.transaction() as conn:
            self.authorize(conn, run_id, token)
        return value


def usage_view(db, run_id):
    with db.transaction() as conn:
        if not conn.execute("SELECT id FROM runs WHERE id=%s", (run_id,)).fetchone():
            raise Problem(404, "run_not_found")
        policy = conn.execute(
            "SELECT * FROM model_proxy_runs WHERE run_id=%s", (run_id,)
        ).fetchone()
        entries = conn.execute(
            "SELECT request_id,generation,status,reason,input_tokens,output_tokens,amount_decimal,"
            "currency,price_revision,reserved_at,settled_at FROM model_proxy_requests "
            "WHERE run_id=%s ORDER BY reserved_at,request_id",
            (run_id,),
        ).fetchall()
    return {
        "scope": "control-model-proxy-fixture",
        "guest_connected": False,
        "configured": policy is not None,
        "request_limit": policy["request_limit"] if policy else None,
        "request_slots_consumed": len(entries),
        "uncertain_requests": sum(e["status"] != "final" for e in entries),
        "cost_status": "unknown",
        "amount_decimal": None,
        "hard_money_limit_supported": False,
        "entries": entries,
    }

"""Durable, once-only tool admission; network I/O never holds lifecycle locks."""

import hashlib
import json
import re
import secrets
from datetime import timedelta
from uuid import UUID

from ..auth import audit
from ..domain import Problem
from ..model_proxy import ModelProxy
from .adapter import Adapter
from .policy import ADAPTER_REVISION, API_REVISION, normalize_request


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def view(row):
    return {
        k: str(row[k]) if k == "operation_id" else row[k]
        for k in ("operation_id", "status", "reason", "delivery", "http_calls", "response_bytes")
    }


class Broker:
    def __init__(self, db, policy, *, adapter=None):
        self.db, self.policy = db, policy
        self.adapter = adapter if adapter is not None else Adapter(policy)
        # Reuse the full existing lock order, runtime/lease/deadline and model-cutoff gate.
        # This deliberately limits TB-1 to the existing OpenHands fixture runtime.
        self.lifecycle = ModelProxy(db, None, upstream=object())
        self.service_digest = digest(
            canonical(
                {
                    "origin": policy.origin,
                    "credential_origin": policy.credential_origin,
                    "credential_path_prefix": policy.credential_path_prefix,
                    "credential_revision": str(policy.credential_revision),
                    "secret_sha256": digest(policy.secret.encode()),
                    "adapter": ADAPTER_REVISION,
                    "api_revision": API_REVISION,
                }
            )
        )

    def _live(self, conn, run_id, generation, owner, binding_id, *, service=True):
        try:
            run, now = self.lifecycle.live(conn, run_id, generation, owner)
        except Problem:
            raise Problem(409, "tool_run_not_live") from None
        if service:
            self._service(conn)
            # Service locks can wait past expiry. Refresh the complete live gate after
            # the final blocking authority lock, preserving job -> run -> service order.
            try:
                run, now = self.lifecycle.live(conn, run_id, generation, owner)
            except Problem:
                raise Problem(409, "tool_run_not_live") from None
        if run["sandbox_id"] != binding_id:
            raise Problem(409, "tool_binding_invalid")
        return run, now

    def provision(self, run_id, generation, owner, binding_id, *, expires_at):
        """Trusted fixture harness only; no HTTP grant/issuer or guest-controlled config."""
        run_id, owner, binding_id = UUID(str(run_id)), UUID(str(owner)), UUID(str(binding_id))
        with self.db.transaction() as conn:
            self._live(conn, run_id, generation, owner, binding_id, service=False)
            if conn.execute("SELECT 1 FROM tool_broker_runs WHERE run_id=%s", (run_id,)).fetchone():
                raise Problem(409, "tool_grant_already_pinned")
            conn.execute(
                "INSERT INTO tool_broker_services(service_id,config_sha256,credential_revision) "
                "VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                (self.policy.service_id, self.service_digest, self.policy.credential_revision),
            )
            run, now = self._live(conn, run_id, generation, owner, binding_id)
            if expires_at.tzinfo is None or not now < expires_at <= run["deadline"]:
                raise Problem(422, "tool_grant_expiry_invalid")
            conn.execute(
                "INSERT INTO tool_broker_runs(run_id,service_id,policy_sha256,binding_id,"
                "generation,lease_owner,expires_at,request_limit,in_flight_limit) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    run_id,
                    self.policy.service_id,
                    self.policy.digest,
                    binding_id,
                    generation,
                    owner,
                    expires_at,
                    self.policy.request_limit,
                    self.policy.in_flight_limit,
                ),
            )
            audit(conn, None, "tool.grant_pinned", str(run_id))

    def _service(self, conn):
        service = conn.execute(
            "SELECT * FROM tool_broker_services WHERE service_id=%s FOR SHARE",
            (self.policy.service_id,),
        ).fetchone()
        if not service or service["revoked_at"] or service["config_sha256"] != self.service_digest:
            raise Problem(403, "tool_service_unavailable")

    def _grant(self, conn, run_id, now):
        grant = conn.execute("SELECT * FROM tool_broker_runs WHERE run_id=%s", (run_id,)).fetchone()
        if (
            not grant
            or grant["revoked_at"]
            or grant["expires_at"] <= now
            or grant["policy_sha256"] != self.policy.digest
            or grant["service_id"] != self.policy.service_id
        ):
            raise Problem(403, "tool_grant_invalid")
        return grant

    def issue(self, run_id, generation, owner, binding_id):
        run_id, owner, binding_id = UUID(str(run_id)), UUID(str(owner)), UUID(str(binding_id))
        token = "tb1_" + secrets.token_urlsafe(32)
        with self.db.transaction() as conn:
            _, now = self._live(conn, run_id, generation, owner, binding_id)
            grant = self._grant(conn, run_id, now)
            if (grant["generation"], grant["lease_owner"], grant["binding_id"]) != (
                generation,
                owner,
                binding_id,
            ):
                raise Problem(409, "tool_rebind_required")
            conn.execute(
                "UPDATE tool_broker_tokens SET revoked_at=clock_timestamp() "
                "WHERE run_id=%s AND revoked_at IS NULL",
                (run_id,),
            )
            conn.execute(
                "INSERT INTO tool_broker_tokens(token_hash,run_id,generation,binding_id,"
                "lease_owner,expires_at) VALUES (%s,%s,%s,%s,%s,%s)",
                (
                    digest(token.encode()),
                    run_id,
                    generation,
                    binding_id,
                    owner,
                    min(grant["expires_at"], now + timedelta(minutes=2)),
                ),
            )
            audit(conn, None, "tool.token_issued", str(run_id))
        return token

    def authorize(self, run_id, token):
        """Recheck current authority before a host relay exposes a completion."""
        with self.db.transaction() as conn:
            self._authorize(conn, UUID(str(run_id)), token)

    def _authorize(self, conn, run_id, token):
        if not isinstance(token, str) or not re.fullmatch(r"tb1_[A-Za-z0-9_-]{43}", token):
            raise Problem(401, "tool_token_invalid")
        token_hash = digest(token.encode())
        credential = conn.execute(
            "SELECT * FROM tool_broker_tokens WHERE token_hash=%s AND run_id=%s",
            (token_hash, run_id),
        ).fetchone()
        if not credential:
            raise Problem(401, "tool_token_invalid")
        _, now = self._live(
            conn,
            run_id,
            credential["generation"],
            credential["lease_owner"],
            credential["binding_id"],
        )
        credential = conn.execute(
            "SELECT * FROM tool_broker_tokens WHERE token_hash=%s", (token_hash,)
        ).fetchone()
        grant = self._grant(conn, run_id, now)
        if (
            credential["revoked_at"]
            or credential["expires_at"] <= now
            or any(credential[k] != grant[k] for k in ("generation", "binding_id", "lease_owner"))
        ):
            raise Problem(401, "tool_token_invalid")
        return grant, now

    def revoke(self, run_id):
        with self.db.transaction() as conn:
            conn.execute("SELECT id FROM jobs WHERE run_id=%s FOR UPDATE", (run_id,))
            conn.execute("SELECT id FROM runs WHERE id=%s FOR UPDATE", (run_id,))
            conn.execute(
                "UPDATE tool_broker_runs SET revoked_at=clock_timestamp() WHERE run_id=%s",
                (run_id,),
            )
            conn.execute(
                "UPDATE tool_broker_tokens SET revoked_at=clock_timestamp() "
                "WHERE run_id=%s AND revoked_at IS NULL",
                (run_id,),
            )
            audit(conn, None, "tool.grant_revoked", str(run_id))

    def revoke_service(self):
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE tool_broker_services SET revoked_at=clock_timestamp() WHERE service_id=%s",
                (self.policy.service_id,),
            )
            audit(conn, None, "tool.service_revoked", str(self.policy.service_id))

    def rebind(self, run_id, generation, owner, binding_id):
        """Explicit host recovery; identical policy/expiry/caps, strictly newer generation."""
        run_id, owner, binding_id = UUID(str(run_id)), UUID(str(owner)), UUID(str(binding_id))
        with self.db.transaction() as conn:
            _, now = self._live(conn, run_id, generation, owner, binding_id)
            grant = self._grant(conn, run_id, now)
            if generation <= grant["generation"]:
                raise Problem(409, "tool_rebind_invalid")
            conn.execute(
                "UPDATE tool_broker_runs SET generation=%s,lease_owner=%s,binding_id=%s "
                "WHERE run_id=%s",
                (generation, owner, binding_id, run_id),
            )
            conn.execute(
                "UPDATE tool_broker_tokens SET revoked_at=clock_timestamp() "
                "WHERE run_id=%s AND revoked_at IS NULL",
                (run_id,),
            )
            conn.execute(
                "UPDATE tool_broker_operations SET status='unknown',reason='tool_recovered',"
                "settled_at=clock_timestamp() WHERE run_id=%s AND status='admitted'",
                (run_id,),
            )
            conn.execute(
                "UPDATE tool_broker_operations SET delivery='unknown' "
                "WHERE run_id=%s AND delivery='pending'",
                (run_id,),
            )
            audit(conn, None, "tool.grant_rebound", str(run_id))

    def _reserve(self, run_id, token, operation_id, payload):
        fingerprint = digest(canonical(payload))
        with self.db.transaction() as conn:
            grant, now = self._authorize(conn, run_id, token)
            conn.execute(
                "UPDATE tool_broker_operations SET status='unknown',reason='tool_deadline',"
                "settled_at=clock_timestamp() WHERE run_id=%s AND status='admitted' "
                "AND deadline_at<=%s",
                (run_id, now),
            )
            row = conn.execute(
                "SELECT * FROM tool_broker_operations WHERE run_id=%s AND operation_id=%s",
                (run_id, operation_id),
            ).fetchone()
            if row:
                if row["payload_sha256"] != fingerprint:
                    raise Problem(409, "tool_idempotency_conflict")
                if row["delivery"] == "pending":
                    conn.execute(
                        "UPDATE tool_broker_operations SET delivery='unknown' "
                        "WHERE run_id=%s AND operation_id=%s",
                        (run_id, operation_id),
                    )
                    row["delivery"] = "unknown"
                return view(row)
            counts = conn.execute(
                "SELECT count(*) AS total, "
                "count(*) FILTER (WHERE status IN ('admitted','unknown')) "
                "AS occupied, count(*) FILTER (WHERE delivery IN ('pending','unknown')) AS unacked "
                "FROM tool_broker_operations WHERE run_id=%s",
                (run_id,),
            ).fetchone()
            if counts["unacked"]:
                raise Problem(409, "tool_delivery_unconfirmed")
            if counts["total"] >= grant["request_limit"]:
                raise Problem(429, "tool_request_limit")
            if counts["occupied"] >= grant["in_flight_limit"]:
                raise Problem(429, "tool_in_flight_limit")
            conn.execute(
                "INSERT INTO tool_broker_operations(run_id,operation_id,generation,binding_id,"
                "policy_sha256,payload_sha256,operation,status,reason,delivery,deadline_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,'admitted','tool_outcome_unknown','none',%s)",
                (
                    run_id,
                    operation_id,
                    grant["generation"],
                    grant["binding_id"],
                    self.policy.digest,
                    fingerprint,
                    payload["operation"],
                    now + timedelta(seconds=self.policy.total_timeout),
                ),
            )
            audit(conn, None, "tool.operation_admitted", str(run_id))
        return None

    def _before_hop(self, run_id, token, operation_id):
        with self.db.transaction() as conn:
            grant, now = self._authorize(conn, run_id, token)
            row = conn.execute(
                "UPDATE tool_broker_operations SET http_calls=http_calls+1 "
                "WHERE run_id=%s AND operation_id=%s AND status='admitted' AND http_calls<8 "
                "AND generation=%s AND binding_id=%s AND deadline_at>%s RETURNING operation_id",
                (run_id, operation_id, grant["generation"], grant["binding_id"], now),
            ).fetchone()
            if not row:
                raise Problem(409, "tool_operation_not_live")
        # Durable attempted-hop count is conservative across a crash before socket creation.

    def _finish(self, run_id, token, operation_id, *, result=None):
        receipt = secrets.token_urlsafe(32) if result else None
        with self.db.transaction() as conn:
            # Always acquire job -> run, even when the token cannot authorize delivery.
            conn.execute("SELECT id FROM jobs WHERE run_id=%s FOR UPDATE", (run_id,))
            conn.execute("SELECT id FROM runs WHERE id=%s FOR UPDATE", (run_id,))
            authorized = False
            try:
                self._authorize(conn, run_id, token)
                authorized = True
            except Problem:
                pass
            row = conn.execute(
                "SELECT * FROM tool_broker_operations WHERE run_id=%s AND operation_id=%s",
                (run_id, operation_id),
            ).fetchone()
            now = conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
            if row["status"] != "admitted" or row["deadline_at"] <= now:
                result = None
            success = result is not None
            delivery = "pending" if success and authorized else "withheld" if success else "none"
            reason = (
                "tool_ok"
                if success and authorized
                else ("tool_completion_revoked" if success else "tool_outcome_unknown")
            )
            conn.execute(
                "UPDATE tool_broker_operations SET status=%s,reason=%s,delivery=%s,receipt_hash=%s,"
                "response_bytes=%s,settled_at=clock_timestamp() "
                "WHERE run_id=%s AND operation_id=%s "
                "AND status='admitted'",
                (
                    "succeeded" if success else "unknown",
                    reason,
                    delivery,
                    digest(receipt.encode()) if success and authorized else None,
                    result.response_bytes if success else None,
                    run_id,
                    operation_id,
                ),
            )
            row = conn.execute(
                "SELECT * FROM tool_broker_operations WHERE run_id=%s AND operation_id=%s",
                (run_id, operation_id),
            ).fetchone()
            audit(conn, None, "tool.operation_settled", str(run_id))
        if not success or not authorized:
            raise Problem(409, reason)
        return {**view(row), "result": result.value, "receipt": receipt}

    def execute(self, run_id, token, operation_id, payload):
        run_id, operation_id = UUID(str(run_id)), UUID(str(operation_id))
        normalized = normalize_request(self.policy, payload)
        prior = self._reserve(run_id, token, operation_id, normalized)
        if prior is not None:
            return prior
        try:
            result = self.adapter.execute(
                normalized, before_hop=lambda: self._before_hop(run_id, token, operation_id)
            )
        except Exception:
            # Never expose provider exceptions, request bodies or credentials. SQL failure
            # in settlement leaves the admitted row occupied; it is never re-dispatched.
            return self._finish(run_id, token, operation_id)
        return self._finish(run_id, token, operation_id, result=result)

    def acknowledge(self, run_id, token, operation_id, receipt):
        if not isinstance(receipt, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", receipt):
            raise Problem(422, "tool_receipt_invalid")
        with self.db.transaction() as conn:
            grant, _ = self._authorize(conn, run_id, token)
            row = conn.execute(
                "SELECT * FROM tool_broker_operations WHERE run_id=%s AND operation_id=%s",
                (run_id, operation_id),
            ).fetchone()
            if (
                not row
                or row["generation"] != grant["generation"]
                or row["binding_id"] != grant["binding_id"]
                or not row["receipt_hash"]
                or not secrets.compare_digest(row["receipt_hash"], digest(receipt.encode()))
            ):
                raise Problem(409, "tool_receipt_invalid")
            conn.execute(
                "UPDATE tool_broker_operations SET delivery='acknowledged' "
                "WHERE run_id=%s AND operation_id=%s",
                (run_id, operation_id),
            )
            row["delivery"] = "acknowledged"
            return view(row)

"""Control-side model admission and durable, conservative request accounting.

Admission commits before network dispatch. A crash at either side of that boundary
must never cause an automatic second dispatch or refund an uncertain request slot.
"""

import re
import secrets
from uuid import UUID

from .auth import audit
from .domain import Problem
from .model_policy import MAX_REQUEST, MODEL, canonical, response, sensitive, sha
from .model_upstream import FixtureUpstream
from .store import event


class ModelProxy:
    def __init__(self, db, policy, *, upstream=None):
        self.db, self.policy = db, policy
        self.upstream = upstream or FixtureUpstream(policy)

    def live(self, conn, run_id, generation, owner, *, states=("running",)):
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
            or run["state"] not in states
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
        policy = conn.execute(
            "SELECT cutoff_reason FROM model_proxy_runs WHERE run_id=%s", (run_id,)
        ).fetchone()
        if policy and policy["cutoff_reason"]:
            raise Problem(409, "model_run_cutoff")
        return run, now

    def pin(self, conn, run_id):
        row = conn.execute("SELECT * FROM model_proxy_runs WHERE run_id=%s", (run_id,)).fetchone()
        if not row:
            budget = self.policy.budget
            conn.execute(
                "INSERT INTO model_proxy_runs(run_id,policy_sha256,request_limit,"
                "fixture_price_revision,fixture_limit_microcredits) VALUES (%s,%s,%s,%s,%s)",
                (
                    run_id,
                    self.policy.digest,
                    self.policy.request_limit,
                    budget.revision if budget else None,
                    budget.limit_microcredits if budget else None,
                ),
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
        encoded = canonical(payload)
        fingerprint = sha(encoded)
        budget = self.policy.budget
        input_bound = len(encoded) if budget else None
        output_bound = payload["max_tokens"] if budget else None
        reserved = (
            input_bound * budget.input_microcredits_per_token
            + output_bound * budget.output_microcredits_per_token
            if budget
            else None
        )
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
            if budget:
                committed = conn.execute(
                    "SELECT COALESCE(sum(COALESCE(fixture_settled_microcredits,"
                    "fixture_reserved_microcredits)),0) AS n FROM model_proxy_requests "
                    "WHERE run_id=%s",
                    (run_id,),
                ).fetchone()["n"]
                if committed + reserved > budget.limit_microcredits:
                    raise Problem(429, "model_fixture_budget_exhausted")
            conn.execute(
                "INSERT INTO model_proxy_requests(run_id,request_id,generation,payload_sha256,"
                "status,reason,fixture_input_bound,fixture_output_bound,"
                "fixture_reserved_microcredits) "
                "VALUES (%s,%s,%s,%s,'reserved','dispatch_outcome_unknown',%s,%s,%s)",
                (
                    run_id,
                    request_id,
                    run["generation"],
                    fingerprint,
                    input_bound,
                    output_bound,
                    reserved,
                ),
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
                    "fixture_reserved_microcredits": reserved,
                },
            )
            audit(conn, None, "model.request_reserved", str(run_id))
        # Transaction exits before any upstream call; a reserved row is never redispatched.

    def settle(self, run_id, request_id, *, usage=None, reason="dispatch_outcome_unknown"):
        with self.db.transaction() as conn:
            # Event producers lock run first. No job lock is needed for accounting a
            # response to a request admitted earlier, even after cancellation/recovery.
            conn.execute("SELECT id FROM runs WHERE id=%s FOR UPDATE", (run_id,)).fetchone()
            pinned = conn.execute(
                "SELECT policy_sha256 FROM model_proxy_runs WHERE run_id=%s", (run_id,)
            ).fetchone()
            if not pinned or pinned["policy_sha256"] != self.policy.digest:
                # Leave the full reservation uncertain; changed prices may never
                # revalue a request dispatched under the original contract.
                raise Problem(409, "model_policy_changed")
            row = conn.execute(
                "SELECT fixture_input_bound,fixture_output_bound,"
                "fixture_reserved_microcredits FROM model_proxy_requests "
                "WHERE run_id=%s AND request_id=%s AND status='reserved'",
                (run_id, request_id),
            ).fetchone()
            if not row:
                raise Problem(409, "model_settlement_conflict")
            budget = self.policy.budget
            if (row["fixture_reserved_microcredits"] is None) != (budget is None):
                raise Problem(409, "model_policy_changed")
            charged = None
            if usage and budget:
                if (
                    usage["prompt_tokens"] > row["fixture_input_bound"]
                    or usage["completion_tokens"] > row["fixture_output_bound"]
                ):
                    raise Problem(502, "model_usage_exceeds_reserved_bound")
                charged = (
                    usage["prompt_tokens"] * budget.input_microcredits_per_token
                    + usage["completion_tokens"] * budget.output_microcredits_per_token
                )
                if charged > row["fixture_reserved_microcredits"]:
                    raise Problem(502, "model_usage_exceeds_reserved_bound")
            status = "final" if usage is not None else "unknown"
            updated = conn.execute(
                "UPDATE model_proxy_requests SET status=%s,reason=%s,input_tokens=%s,"
                "output_tokens=%s,fixture_settled_microcredits=%s,"
                "settled_at=clock_timestamp() "
                "WHERE run_id=%s AND request_id=%s AND status='reserved' RETURNING request_id",
                (
                    status,
                    reason,
                    usage["prompt_tokens"] if usage else None,
                    usage["completion_tokens"] if usage else None,
                    charged,
                    run_id,
                    request_id,
                ),
            ).fetchone()
            if not updated:
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
                    "fixture_settled_microcredits": charged,
                },
            )
            audit(conn, None, "model.request_settled", str(run_id), status)

    def complete(self, run_id, token, request_id, data, *, sdk=False):
        payload = data.payload()
        if sdk:
            payload["fixture_run_id"] = str(UUID(str(run_id)))
        known = (token, self.policy.credential)
        if sensitive(payload, known):
            raise Problem(422, "model_sensitive_request")
        self.reserve(run_id, token, request_id, payload)
        try:
            raw = self.upstream.complete(payload)
            if sdk:
                from .model_dialect import sdk_response

                value, usage = sdk_response(raw, payload, known)
            else:
                value, usage = response(raw, payload["max_tokens"], known)
            if self.policy.budget and usage["prompt_tokens"] > len(canonical(payload)):
                raise Problem(502, "model_usage_exceeds_reserved_bound")
        except Problem as exc:
            self.settle(run_id, request_id, reason=exc.code)
            raise
        self.settle(run_id, request_id, usage=usage, reason="fixture_reported_usage")
        # Accounting survives revocation; stale output cannot enter a resumed generation.
        with self.db.transaction() as conn:
            self.authorize(conn, run_id, token)
        return value

    def cutoff(self, run_id, generation, owner, reason):
        # Only the current owner may turn a transport error into a durable stop.
        # A stale worker after pause/cancel must not override that control intent.
        with self.db.transaction() as conn:
            job = conn.execute(
                "SELECT * FROM jobs WHERE run_id=%s FOR UPDATE", (run_id,)
            ).fetchone()
            run = conn.execute("SELECT * FROM runs WHERE id=%s FOR UPDATE", (run_id,)).fetchone()
            now = conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
            if (
                not job
                or not run
                or job["status"] != "leased"
                or job["lease_owner"] != owner
                or job["generation"] != generation
                or run["generation"] != generation
                or not job["lease_until"]
                or job["lease_until"] <= now
                or run["state"]
                not in {"provisioning", "running", "awaiting_approval", "interrupted", "finalizing"}
                or run["control_action"]
                or run["cancel_requested_at"]
            ):
                raise Problem(409, "model_run_not_live")
            # Stopping never requires a healthy binding. Partition/unknown dispatch
            # must close admission too; only the VM proof can release capacity.
            self.pin(conn, run_id)
            changed = conn.execute(
                "UPDATE model_proxy_runs SET cutoff_reason=%s,cutoff_at=clock_timestamp() "
                "WHERE run_id=%s AND cutoff_reason IS NULL RETURNING run_id",
                (reason, run_id),
            ).fetchone()
            conn.execute(
                "UPDATE model_proxy_tokens SET revoked_at=clock_timestamp() "
                "WHERE run_id=%s AND revoked_at IS NULL",
                (run_id,),
            )
            if changed:
                event(conn, run_id, "model.cutoff", {"reason": reason, "capacity_retained": True})
                audit(conn, None, "model.cutoff", str(run_id), reason)

    def tool_gate(self, conn, run_id, generation, owner):
        _, now = self.live(conn, run_id, generation, owner, states=("running", "awaiting_approval"))
        self.pin(conn, run_id)
        count = conn.execute(
            "SELECT count(*) AS n FROM model_proxy_requests WHERE run_id=%s", (run_id,)
        ).fetchone()["n"]
        if count >= self.policy.request_limit:
            raise Problem(429, "model_request_limit_reached")
        if self.policy.budget:
            budget = self.policy.budget
            committed = conn.execute(
                "SELECT COALESCE(sum(COALESCE(fixture_settled_microcredits,"
                "fixture_reserved_microcredits)),0) AS n FROM model_proxy_requests "
                "WHERE run_id=%s",
                (run_id,),
            ).fetchone()["n"]
            # A terminal side effect can prompt another SDK call. Admit it only
            # when even the largest permitted next fixture request could fit.
            next_envelope = (
                MAX_REQUEST * budget.input_microcredits_per_token
                + 4096 * budget.output_microcredits_per_token
            )
            if committed + next_envelope > budget.limit_microcredits:
                raise Problem(429, "model_fixture_budget_exhausted")
        return now


def usage_view(db, run_id):
    with db.transaction() as conn:
        if not conn.execute("SELECT id FROM runs WHERE id=%s", (run_id,)).fetchone():
            raise Problem(404, "run_not_found")
        policy = conn.execute(
            "SELECT * FROM model_proxy_runs WHERE run_id=%s", (run_id,)
        ).fetchone()
        entries = conn.execute(
            "SELECT request_id,generation,status,reason,input_tokens,output_tokens,amount_decimal,"
            "currency,price_revision,fixture_input_bound,fixture_output_bound,"
            "fixture_reserved_microcredits,fixture_settled_microcredits,"
            "reserved_at,settled_at FROM model_proxy_requests "
            "WHERE run_id=%s ORDER BY reserved_at,request_id",
            (run_id,),
        ).fetchall()
    committed = sum(
        (
            entry["fixture_settled_microcredits"]
            if entry["fixture_settled_microcredits"] is not None
            else entry["fixture_reserved_microcredits"] or 0
        )
        for entry in entries
    )
    return {
        "scope": "control-model-proxy-fixture",
        "guest_connected": policy["guest_connected"] if policy else False,
        "cutoff_reason": policy["cutoff_reason"] if policy else None,
        "configured": policy is not None,
        "request_limit": policy["request_limit"] if policy else None,
        "request_slots_consumed": len(entries),
        "uncertain_requests": sum(e["status"] != "final" for e in entries),
        "cost_status": "unknown",
        "amount_decimal": None,
        "hard_money_limit_supported": False,
        "fixture_credit_limit_supported": bool(policy and policy["fixture_limit_microcredits"]),
        "fixture_price_revision": policy["fixture_price_revision"] if policy else None,
        "fixture_credit_limit_microcredits": (
            policy["fixture_limit_microcredits"] if policy else None
        ),
        "fixture_credits_committed_microcredits": committed
        if policy and policy["fixture_limit_microcredits"]
        else None,
        "fixture_credits_uncertain": any(e["status"] != "final" for e in entries)
        if policy and policy["fixture_limit_microcredits"]
        else None,
        "entries": entries,
    }

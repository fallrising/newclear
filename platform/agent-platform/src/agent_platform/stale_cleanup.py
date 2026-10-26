"""Manual maintenance admission; existing recovery alone releases reservations."""

import json
from datetime import datetime, timedelta
from functools import wraps
from uuid import UUID

import psycopg

from .auth import audit
from .domain import Problem
from .runtime_worker import heartbeat
from .stale_cleanup_contract import (
    JOURNAL_LIMIT,
    canonical,
    digest,
    fail,
    require_time,
    timestamp,
    uuid_text,
    validate_plan,
)
from .worker import Worker


def sanitized(function):
    @wraps(function)
    def call(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except (psycopg.Error, OSError, KeyError, TypeError, ValueError, OverflowError):
            fail("unavailable_or_invalid")

    return call


def json_value(value):
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return timestamp(value)
    raise TypeError


def detached(value):
    raw = json.dumps(value, default=json_value, allow_nan=False).encode()
    if len(raw) > JOURNAL_LIMIT:
        fail("oversized")
    return json.loads(raw)


def snapshot(conn, run_id, *, lock=False):
    # Job -> run -> binding/reservation matches the existing worker ownership order.
    suffix = " FOR UPDATE" if lock else ""
    jobs = conn.execute(
        "SELECT id,run_id,kind,status,generation,lease_owner,lease_until FROM jobs "
        "WHERE run_id=%s ORDER BY id LIMIT 2" + suffix,
        (run_id,),
    ).fetchall()
    run = conn.execute(
        "SELECT id,state,state_version,generation,sandbox_id,backend,backend_ref,"
        "control_action,cleanup_state,octet_length(result::text) AS result_bytes "
        "FROM runs WHERE id=%s" + suffix,
        (run_id,),
    ).fetchone()
    if not run or len(jobs) != 1 or not run["sandbox_id"]:
        fail("ineligible")
    if not run["result_bytes"] or run["result_bytes"] > JOURNAL_LIMIT:
        fail("ineligible")
    result = conn.execute("SELECT result FROM runs WHERE id=%s", (run_id,)).fetchone()["result"]
    binding = conn.execute(
        "SELECT id,run_id,node_id,provider_handle,generation,desired_state,observed_state,"
        "cleanup_state FROM sandbox_bindings WHERE id=%s" + suffix,
        (run["sandbox_id"],),
    ).fetchone()
    reservation = conn.execute(
        "SELECT sandbox_id,cpu,memory_bytes,disk_bytes,released_at "
        "FROM resource_reservations WHERE sandbox_id=%s" + suffix,
        (run["sandbox_id"],),
    ).fetchone()
    archive = conn.execute(
        "SELECT id,run_id,sha256,size,pruned_at FROM result_archives WHERE run_id=%s",
        (run_id,),
    ).fetchone()
    clock = conn.execute(
        "SELECT clock_timestamp() AS now,(SELECT id FROM maintenance_identity) AS identity"
    ).fetchone()
    if not binding or not reservation or not archive or not clock["identity"]:
        fail("ineligible")
    return {
        "run": detached(run),
        "job": detached(jobs[0]),
        "binding": detached(binding),
        "reservation": detached(reservation),
        "archive": detached(archive),
        "result_digest": digest(result),
        "now": clock["now"],
        "maintenance_id": str(clock["identity"]),
    }


def precondition(current):
    run, job, binding = current["run"], current["job"], current["binding"]
    # Mutating ownership/cleanup fields are checked explicitly by phase; this
    # identity digest survives this attempt's lease and recovery's finalization.
    return digest(
        {
            "run": {
                k: run[k]
                for k in (
                    "id",
                    "state",
                    "state_version",
                    "sandbox_id",
                    "backend",
                    "backend_ref",
                    "control_action",
                )
            },
            "job": {k: job[k] for k in ("id", "run_id", "kind")},
            "binding": {k: binding[k] for k in ("id", "run_id", "node_id", "provider_handle")},
            "reservation": {k: v for k, v in current["reservation"].items() if k != "released_at"},
            "archive": current["archive"],
            "result_digest": current["result_digest"],
        }
    )


def eligibility(current, *, replay=False):
    run, job, binding, reservation = (current[k] for k in ("run", "job", "binding", "reservation"))
    if (
        run["backend"] != "openhands"
        or run["state"] not in {"succeeded", "failed"}
        or run["control_action"] is not None
        or not run["backend_ref"]
        or job["kind"] != "execute"
        or job["run_id"] != run["id"]
        or binding["id"] != run["sandbox_id"]
        or binding["run_id"] != run["id"]
        or binding["node_id"] != "cocoon-local"
        or not binding["provider_handle"]
        or binding["provider_handle"].startswith("pending:")
        or binding["generation"] != run["generation"]
        or job["generation"] != run["generation"]
        or current["archive"]["run_id"] != run["id"]
    ):
        fail("ineligible")
    if replay and run["cleanup_state"] == "confirmed":
        if (
            binding["cleanup_state"] != "confirmed"
            or binding["desired_state"] != "stopped"
            or binding["observed_state"] != "stopped"
            or not reservation["released_at"]
            or job["status"] != "done"
        ):
            fail("cleanup_inconsistent")
    elif (
        run["cleanup_state"] not in {"pending", "unknown"}
        or binding["cleanup_state"] not in {"pending", "unknown"}
        or reservation["released_at"] is not None
    ):
        fail("ineligible")


def matching(current, plan):
    run, job, binding, archive = (current[k] for k in ("run", "job", "binding", "archive"))
    if current["maintenance_id"] != plan["maintenance_id"]:
        fail("identity_changed")
    require_time(plan, current["now"])
    if any(
        a != b
        for a, b in (
            (run["id"], plan["run_id"]),
            (job["id"], plan["job_id"]),
            (binding["id"], plan["binding_id"]),
            (binding["provider_handle"], plan["provider_handle"]),
            (run["state"], plan["terminal_state"]),
            (run["state_version"], plan["state_version"]),
            (archive["id"], plan["archive_id"]),
            (archive["sha256"], plan["archive_sha256"]),
        )
    ):
        fail("precondition_changed")


@sanitized
def preview(db, connector, *, run_id):
    run_id = uuid_text(str(run_id))
    with db.transaction() as conn:
        current = snapshot(conn, run_id)
        eligibility(current)
        job = current["job"]
        if job["status"] not in {"interrupted", "leased"} or (
            job["status"] == "leased"
            and (
                job["lease_until"] is None
                or datetime.fromisoformat(job["lease_until"]) > current["now"]
            )
        ):
            fail("owner_live")
        run, binding, archive = (current[k] for k in ("run", "binding", "archive"))
        context = {
            "maintenance_id": current["maintenance_id"],
            "created_at": timestamp(current["now"]),
            "expires_at": timestamp(current["now"] + timedelta(hours=1)),
            "run_id": run_id,
            "job_id": job["id"],
            "binding_id": binding["id"],
            "node_id": binding["node_id"],
            "current_generation": run["generation"],
            "next_generation": run["generation"] + 1,
            "state_version": run["state_version"],
            "terminal_state": run["state"],
            "provider_handle": binding["provider_handle"],
            "archive_id": archive["id"],
            "archive_sha256": archive["sha256"],
            "db_digest": precondition(current),
            "result_digest": current["result_digest"],
        }
    return validate_plan(connector.cleanup_preview(run_id, context))


def admit(db, plan, operations_digest):
    with db.transaction() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(77310401)")
        current = snapshot(conn, plan["run_id"], lock=True)
        matching(current, plan)
        eligibility(current)
        if (
            digest({"db": precondition(current), "operations_digest": operations_digest})
            != plan["precondition_digest"]
        ):
            fail("precondition_changed")
        job, run = current["job"], current["run"]
        live_resume = (
            run["generation"] == plan["next_generation"]
            and job["status"] == "leased"
            and job["lease_owner"] == plan["attempt_id"]
            and job["lease_until"] is not None
            and datetime.fromisoformat(job["lease_until"]) > current["now"]
        )
        if not live_resume:
            if run["generation"] != plan["current_generation"] or job["status"] != "interrupted":
                fail("ownership_changed")
            if job["lease_until"] and datetime.fromisoformat(job["lease_until"]) > current["now"]:
                # Quarantine relinquishes a lease by status, but its committed
                # grant remains live until expiry; preview independently checked it.
                fail("owner_live")
            conn.execute(
                "UPDATE runs SET generation=%s WHERE id=%s",
                (plan["next_generation"], plan["run_id"]),
            )
            conn.execute(
                "UPDATE sandbox_bindings SET generation=%s,desired_state='stopped' WHERE id=%s",
                (plan["next_generation"], plan["binding_id"]),
            )
            conn.execute(
                "UPDATE jobs SET status='leased',generation=%s,lease_owner=%s,"
                "lease_until=clock_timestamp()+interval '30 seconds' WHERE id=%s",
                (plan["next_generation"], plan["attempt_id"], plan["job_id"]),
            )
            audit(
                conn,
                None,
                "runtime.stale_cleanup_admitted",
                plan["approval_digest"],
                "generation:" + str(plan["next_generation"]),
            )
        # Re-read the server clock after all potentially blocking row waits.
        now = conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
        require_time(plan, now)
        return precondition(current)


class MaintenanceLease:
    def __init__(self, connector, plan):
        self.connector, self.plan = connector, plan

    def fence(self, run):
        return self.connector.cleanup_fence(self.plan, run)


@sanitized
def apply(db, connector, plan, *, approval_digest):
    plan = validate_plan(plan, approval_digest)
    if approval_digest != plan["approval_digest"]:
        fail("approval_mismatch")
    canonical(plan)
    with db.transaction() as conn:
        current = snapshot(conn, plan["run_id"])
        matching(current, plan)
        eligibility(current, replay=True)
        db_digest = precondition(current)
    job, run = current["job"], current["run"]
    resume = (
        run["generation"] == plan["next_generation"]
        and job["status"] == "leased"
        and job["lease_owner"] == plan["attempt_id"]
    )
    lookup = connector.cleanup_lookup(
        plan, generation=run["generation"], lease_until=job["lease_until"], resume=resume
    )
    if lookup["started"]:
        return connector.cleanup_apply(
            plan, current["run"]["generation"], db_digest, observe_only=True
        )
    db_digest = admit(db, plan, lookup["operations_digest"])
    worker = Worker(db, connector)
    worker.connector = MaintenanceLease(connector, plan)
    worker.owner = UUID(plan["attempt_id"])
    claim = {
        "job_id": UUID(plan["job_id"]),
        "run_id": UUID(plan["run_id"]),
        "generation": plan["next_generation"],
        "backend": "openhands",
    }
    try:
        with heartbeat(worker, claim) as lost:
            with worker.owned(claim) as (_, current_run):
                grant = dict(current_run)
            connector.cleanup_fence(plan, grant)
            if lost.is_set():
                fail("ownership_lost")
            return connector.cleanup_apply(plan, plan["next_generation"], db_digest)
    finally:
        try:
            with worker.owned(claim) as (conn, _):
                conn.execute(
                    "UPDATE jobs SET status='interrupted',lease_until=NULL,"
                    "available_at=clock_timestamp() WHERE id=%s",
                    (plan["job_id"],),
                )
        except (Problem, psycopg.Error):
            pass  # Lease expiry/recovery, not stale-owner writes, owns an uncertain result.

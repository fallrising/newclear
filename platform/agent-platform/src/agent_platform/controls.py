"""Durable pause/resume commands and observed completion; reservations stay held."""

from datetime import UTC, datetime

from .auth import audit
from .connector_control import paused
from .connector_recovery import stopped
from .domain import Problem
from .store import event, require_row, run_view


def request_control(conn, run_id, data, command_id):
    job = conn.execute("SELECT * FROM jobs WHERE run_id=%s FOR UPDATE", (run_id,)).fetchone()
    run = require_row(
        conn.execute("SELECT * FROM runs WHERE id=%s FOR UPDATE", (run_id,)).fetchone()
    )
    if run["state_version"] != data.expected_state_version:
        raise Problem(409, "state_conflict")
    if run["backend"] != "openhands":
        raise Problem(409, "unsupported_capability:" + data.action)
    if run["deadline"] <= datetime.now(UTC):
        raise Problem(409, "run_deadline_expired")
    if data.action == "pause":
        if run["state"] not in {"running", "awaiting_approval"} or not run["backend_cursor"]:
            raise Problem(409, "pause_not_ready")
    elif (
        run["state"] != "paused"
        or not run["pause_completed_at"]
        or run["control_action"] != "pause"
    ):
        raise Problem(409, "resume_not_ready")
    conn.execute(
        "UPDATE approvals SET status='invalidated' WHERE run_id=%s "
        "AND status IN ('pending','approved')",
        (run_id,),
    )
    row = conn.execute(
        "UPDATE runs SET state=%s,state_version=state_version+1,generation=generation+1,"
        "control_action=%s,control_command_id=%s,pause_command_id=%s,"
        "pause_completed_at=CASE WHEN %s THEN NULL ELSE pause_completed_at END,"
        "resume_completed_at=NULL,reason=NULL,interrupted_from=NULL WHERE id=%s RETURNING *",
        (
            "pausing" if data.action == "pause" else "resuming",
            data.action,
            command_id,
            command_id if data.action == "pause" else run["pause_command_id"],
            data.action == "pause",
            run_id,
        ),
    ).fetchone()
    conn.execute(
        "UPDATE commands SET run_id=%s,expected_version=%s WHERE id=%s",
        (run_id, data.expected_state_version, command_id),
    )
    conn.execute(
        "UPDATE jobs SET status='interrupted',generation=%s,lease_owner=NULL,lease_until=NULL,"
        "available_at=clock_timestamp() WHERE id=%s",
        (row["generation"], job["id"]),
    )
    conn.execute(
        "UPDATE sandbox_bindings SET generation=%s,desired_state=%s WHERE id=%s",
        (row["generation"], "paused" if data.action == "pause" else "running", run["sandbox_id"]),
    )
    event(conn, run_id, "run." + data.action + "_requested", {"command_id": str(command_id)})
    event(
        conn,
        run_id,
        "run.state_changed",
        {"state": row["state"], "state_version": row["state_version"], "reason": None},
    )
    row = conn.execute("SELECT * FROM runs WHERE id=%s", (run_id,)).fetchone()
    return {
        "status": 202,
        "body": {"command_id": str(command_id), "status": "pending", "run": run_view(row)},
    }


def execute_control(worker, claim, run):
    if run["deadline"] <= datetime.now(UTC):
        expire(worker, claim, run)
        return
    result = worker.connector.control(run)
    with worker.owned(claim) as (conn, current):
        action = current["control_action"]
        if action == "resume":
            if result.get("state") == "resuming":
                conn.execute(
                    "UPDATE jobs SET status='interrupted',lease_until=NULL,"
                    "available_at=clock_timestamp()+interval '1 second' WHERE id=%s",
                    (claim["job_id"],),
                )
                return
            if result != {
                "state": "resumed",
                "pause_id": str(current["pause_command_id"]),
                "command_id": str(current["control_command_id"]),
            }:
                raise Problem(409, "resume_unconfirmed")
            conn.execute(
                "UPDATE runs SET control_action=NULL,resume_completed_at=clock_timestamp() "
                "WHERE id=%s",
                (current["id"],),
            )
            worker.state(conn, current, "running")
            complete(conn, current, action, result)
            # Return the resumed run to normal execution slots. A controller must
            # remain available even when all four ordinary workers are occupied.
            conn.execute(
                "UPDATE jobs SET status='interrupted',lease_until=NULL,"
                "available_at=clock_timestamp() WHERE id=%s",
                (claim["job_id"],),
            )
            return
        if action != "pause":
            raise Problem(409, "pause_intent_missing")
        confirmed = paused(result)
        state = "paused" if confirmed else "pausing"
        if current["state"] != state or current["reason"]:
            worker.state(conn, current, state)
        if confirmed and current["pause_completed_at"] is None:
            conn.execute(
                "UPDATE runs SET pause_completed_at=clock_timestamp() WHERE id=%s", (current["id"],)
            )
            complete(conn, current, action, result)
        conn.execute("UPDATE runs SET cleanup_state='pending' WHERE id=%s", (current["id"],))
        conn.execute(
            "UPDATE sandbox_bindings SET observed_state=%s,cleanup_state='pending',"
            "last_seen=now() WHERE id=%s",
            (state, current["sandbox_id"]),
        )
        conn.execute(
            "UPDATE jobs SET status='interrupted',lease_until=NULL,available_at="
            "LEAST(clock_timestamp()+%s*interval '1 second',%s) WHERE id=%s",
            (30 if confirmed else 1, current["deadline"], claim["job_id"]),
        )
    return


def complete(conn, run, action, proof):
    event(
        conn,
        run["id"],
        "run." + action + "_completed",
        {"command_id": str(run["control_command_id"]), **proof},
    )
    audit(conn, None, "run." + action + "_completed", str(run["control_command_id"]), "observed")


def expire(worker, claim, run):
    proof = worker.connector.cancel(run)
    if not stopped(proof):
        raise Problem(409, "deadline_cleanup_unconfirmed")
    with worker.owned(claim) as (conn, current):
        conn.execute(
            "UPDATE sandbox_bindings SET desired_state='stopped',observed_state='stopped',"
            "cleanup_state='confirmed',last_seen=now() WHERE id=%s",
            (current["sandbox_id"],),
        )
        conn.execute(
            "UPDATE resource_reservations SET released_at=now() WHERE sandbox_id=%s",
            (current["sandbox_id"],),
        )
        conn.execute(
            "UPDATE runs SET cleanup_state='confirmed',control_action=NULL WHERE id=%s",
            (current["id"],),
        )
        worker.state(conn, current, "failed", "run_deadline_expired")
        event(
            conn, current["id"], "runtime.cleaned", proof, source="connector", source_id="cleaned"
        )
        audit(conn, None, "run.deadline_cleanup", str(current["id"]), "stop_confirmed")
        conn.execute(
            "UPDATE jobs SET status='done',lease_until=NULL WHERE id=%s", (claim["job_id"],)
        )

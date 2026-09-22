"""Durable operator cancellation. Acceptance is distinct from observed completion."""

from .auth import audit
from .connector_recovery import stopped
from .domain import TERMINAL, Problem
from .store import event, require_row, run_view


def request_cancel(conn, run_id, data, command_id):
    # Match worker lock order. Cancelling revokes the old worker's ownership in
    # this transaction; no network operation or waiting for the VM in the API.
    job = conn.execute("SELECT * FROM jobs WHERE run_id=%s FOR UPDATE", (run_id,)).fetchone()
    run = require_row(
        conn.execute("SELECT * FROM runs WHERE id=%s FOR UPDATE", (run_id,)).fetchone()
    )
    if run["state_version"] != data.expected_state_version:
        raise Problem(409, "state_conflict")
    if data.action != "cancel" or run["backend"] != "openhands":
        raise Problem(409, "unsupported_capability:" + data.action)
    if run["state"] == "finalizing":
        raise Problem(409, "finalizing")
    if run["state"] in TERMINAL:
        raise Problem(409, "run_terminal")
    if run["state"] == "cancelling":
        raise Problem(409, "cancel_already_requested")
    queued = run["state"] == "queued" and run["sandbox_id"] is None
    row = conn.execute(
        "UPDATE runs SET state=%s,state_version=state_version+1,generation=generation+1,"
        "cancel_command_id=%s,cancel_requested_at=clock_timestamp(),"
        "cancel_completed_at=CASE WHEN %s THEN clock_timestamp() ELSE NULL END,"
        "reason='operator_cancelled',interrupted_from=NULL WHERE id=%s RETURNING *",
        ("cancelled" if queued else "cancelling", command_id, queued, run_id),
    ).fetchone()
    conn.execute(
        "UPDATE commands SET run_id=%s,expected_version=%s WHERE id=%s",
        (run_id, data.expected_state_version, command_id),
    )
    conn.execute(
        "UPDATE jobs SET status=%s,generation=%s,lease_owner=NULL,lease_until=NULL,"
        "available_at=clock_timestamp() WHERE id=%s",
        ("done" if queued else "interrupted", row["generation"], job["id"]),
    )
    if run["sandbox_id"]:
        conn.execute(
            "UPDATE sandbox_bindings SET generation=%s,desired_state='stopped' WHERE id=%s",
            (row["generation"], run["sandbox_id"]),
        )
    event(conn, run_id, "run.cancel_requested", {"command_id": str(command_id)})
    event(
        conn,
        run_id,
        "run.state_changed",
        {
            "state": row["state"],
            "state_version": row["state_version"],
            "reason": "operator_cancelled",
            "not_admitted": queued,
        },
    )
    if queued:
        audit(conn, None, "run.cancel_completed", str(command_id), "not_admitted")
    row = conn.execute("SELECT * FROM runs WHERE id=%s", (run_id,)).fetchone()
    return {
        "status": 202,
        "body": {
            "command_id": str(command_id),
            "status": "completed" if queued else "pending",
            "run": run_view(row),
        },
    }


def execute_cancel(worker, claim, run):
    proof = worker.connector.cancel(run)
    absent = (
        proof == {"observed_state": "not_allocated", "proof": {"no_allocation_intent": True}}
        and run["provider_handle"] == f"pending:{run['id']}"
        and not run["backend_ref"]
    )
    if not absent and not stopped(proof):
        raise Problem(409, "cancellation_unconfirmed")
    with worker.owned(claim) as (conn, current):
        if current["state"] != "cancelling" or not current["cancel_command_id"]:
            raise Problem(409, "cancel_intent_missing")
        conn.execute(
            "UPDATE sandbox_bindings SET desired_state='stopped',observed_state=%s,"
            "cleanup_state='confirmed',last_seen=now() WHERE id=%s",
            (proof["observed_state"], current["sandbox_id"]),
        )
        conn.execute(
            "UPDATE resource_reservations SET released_at=now() WHERE sandbox_id=%s",
            (current["sandbox_id"],),
        )
        conn.execute(
            "UPDATE runs SET cleanup_state='confirmed',cancel_completed_at=clock_timestamp() "
            "WHERE id=%s",
            (current["id"],),
        )
        worker.state(conn, current, "cancelled", "operator_cancelled")
        event(
            conn, current["id"], "runtime.cleaned", proof, source="connector", source_id="cleaned"
        )
        event(
            conn,
            current["id"],
            "run.cancel_completed",
            {"command_id": str(current["cancel_command_id"]), **proof},
        )
        audit(
            conn, None, "run.cancel_completed", str(current["cancel_command_id"]), "stop_confirmed"
        )
        conn.execute(
            "UPDATE jobs SET status='done',lease_until=NULL WHERE id=%s", (claim["job_id"],)
        )

"""Bounded approval grants; decisions and upstream application are distinct."""

from datetime import UTC, datetime
from uuid import uuid4

from psycopg.types.json import Jsonb

from .auth import audit
from .domain import ActionInput, Problem
from .store import event, require_row


def decide(conn, approval_id, data, operator, command_id):
    target = require_row(
        conn.execute("SELECT run_id FROM approvals WHERE id=%s", (approval_id,)).fetchone()
    )
    job = conn.execute(
        "SELECT * FROM jobs WHERE run_id=%s FOR UPDATE", (target["run_id"],)
    ).fetchone()
    run = conn.execute("SELECT * FROM runs WHERE id=%s FOR UPDATE", (target["run_id"],)).fetchone()
    approval = conn.execute(
        "SELECT * FROM approvals WHERE id=%s FOR UPDATE", (approval_id,)
    ).fetchone()
    now = conn.execute("SELECT clock_timestamp() AS value").fetchone()["value"]
    if approval["status"] != "pending":
        raise Problem(409, "approval_already_decided")
    if approval["expires_at"] <= now or run["deadline"] <= now:
        raise Problem(409, "approval_expired")
    if data.action_digest != approval["action_digest"] or data.generation != approval["generation"]:
        raise Problem(409, "approval_action_changed")
    if (
        run["generation"] != data.generation
        or job["status"] != "leased"
        or job["lease_until"] <= now
    ):
        raise Problem(409, "approval_generation_stale")
    if run["state"] != "awaiting_approval" or run["state_version"] != data.expected_state_version:
        raise Problem(409, "state_conflict")
    conn.execute(
        "UPDATE approvals SET "
        "decision=%s,status=%s,decided_by=%s,decided_at=clock_timestamp(),command_id=%s WHERE "
        "id=%s",
        (
            data.decision,
            "approved" if data.decision == "approve" else "denied",
            operator,
            command_id,
            approval_id,
        ),
    )
    conn.execute(
        "UPDATE commands SET run_id=%s,expected_version=%s WHERE id=%s",
        (run["id"], data.expected_state_version, command_id),
    )
    event(
        conn,
        run["id"],
        "approval.decided",
        {"approval_id": str(approval_id), "decision": data.decision, "command_id": str(command_id)},
    )
    audit(conn, operator, "approval.decided", str(approval_id), data.decision)
    if data.decision == "deny":
        from .cancellation import request_cancel

        request_cancel(
            conn,
            run["id"],
            ActionInput(action="cancel", expected_state_version=run["state_version"]),
            command_id,
        )
    return {
        "status": 202,
        "body": {"command_id": str(command_id), "status": "pending", "decision": data.decision},
    }


def handle_approval(worker, claim, descriptor):
    """Wait without resuming upstream; reissue only after a new generation/digest."""
    expired = False
    with worker.owned(claim) as (conn, run):
        if not run["require_approval"]:
            raise Problem(409, "approval_policy_mismatch")
        if descriptor["normalized_action"]["generation"] != run["generation"] or descriptor[
            "normalized_action"
        ]["run_id"] != str(run["id"]):
            raise Problem(409, "approval_generation_stale")
        invalid = conn.execute(
            "UPDATE approvals SET status='invalidated' WHERE run_id=%s AND status IN "
            "('pending','approved') AND (generation!=%s OR action_digest!=%s) RETURNING id",
            (run["id"], run["generation"], descriptor["action_digest"]),
        ).fetchall()
        for row in invalid:
            event(conn, run["id"], "approval.invalidated", {"approval_id": str(row["id"])})
        created = conn.execute(
            "INSERT INTO approvals(id,run_id,generation,action_digest,normalized_action,"
            "policy_revision,expires_at) VALUES (%s,%s,%s,%s,%s,%s,"
            "least(%s,clock_timestamp()+interval '5 minutes')) "
            "ON CONFLICT(run_id,generation,action_digest) DO NOTHING RETURNING *",
            (
                uuid4(),
                run["id"],
                run["generation"],
                descriptor["action_digest"],
                Jsonb(descriptor["normalized_action"]),
                descriptor["policy_revision"],
                run["deadline"],
            ),
        ).fetchone()
        approval = (
            created
            or conn.execute(
                "SELECT * FROM approvals WHERE run_id=%s AND generation=%s AND action_digest=%s "
                "FOR UPDATE",
                (run["id"], run["generation"], descriptor["action_digest"]),
            ).fetchone()
        )
        if created:
            event(
                conn,
                run["id"],
                "approval.requested",
                {
                    "approval_id": str(approval["id"]),
                    "action_digest": approval["action_digest"],
                    "expires_at": approval["expires_at"],
                },
            )
        if run["state"] != "awaiting_approval":
            worker.state(conn, run, "awaiting_approval")
        if approval["status"] in {"pending", "approved"} and approval["expires_at"] <= datetime.now(
            UTC
        ):
            conn.execute("UPDATE approvals SET status='expired' WHERE id=%s", (approval["id"],))
            event(conn, run["id"], "approval.expired", {"approval_id": str(approval["id"])})
            expired = True
        elif approval["status"] in {"expired", "invalidated", "denied"}:
            expired = True
    if expired:
        raise Problem(409, "approval_expired")
    if approval["status"] != "approved":
        return
    reply = worker.connector.approve(run, approval)
    if reply != {
        "accepted": True,
        "approval_id": str(approval["id"]),
        "action_digest": approval["action_digest"],
    }:
        raise Problem(409, "approval_application_unconfirmed")
    record_applied(worker, claim, reply)


def record_applied(worker, claim, receipt):
    if receipt.get("accepted") is not True:
        raise Problem(409, "approval_application_unconfirmed")
    with worker.owned(claim) as (conn, run):
        row = conn.execute(
            "UPDATE approvals SET status='applied',applied_at=clock_timestamp() "
            "WHERE id=%s AND run_id=%s AND action_digest=%s AND status='approved' RETURNING id",
            (receipt["approval_id"], run["id"], receipt["action_digest"]),
        ).fetchone()
        if row:
            event(
                conn,
                run["id"],
                "approval.applied",
                {"approval_id": str(row["id"])},
                source="connector",
                source_id="approval:" + str(row["id"]),
            )
            audit(conn, None, "approval.applied", str(row["id"]))

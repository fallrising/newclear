"""Ownership transfer and quarantine. No new attempt, binding or reservation."""

from uuid import uuid4

from .domain import TERMINAL
from .store import event


def claim_recovery(worker):
    with worker.db.transaction() as conn:
        job = conn.execute(
            "SELECT j.* FROM jobs j JOIN runs r ON r.id=j.run_id WHERE "
            "j.status='interrupted' AND j.available_at<=clock_timestamp() "
            "AND r.backend='openhands' AND r.cleanup_state!='confirmed' "
            "ORDER BY j.available_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED"
        ).fetchone()
        if not job:
            return None
        run = conn.execute("SELECT * FROM runs WHERE id=%s FOR UPDATE", (job["run_id"],)).fetchone()
        generation = run["generation"] + 1
        conn.execute("UPDATE runs SET generation=%s WHERE id=%s", (generation, run["id"]))
        conn.execute(
            "UPDATE sandbox_bindings SET generation=%s WHERE id=%s",
            (generation, run["sandbox_id"]),
        )
        conn.execute(
            "UPDATE jobs SET status='leased',lease_owner=%s,lease_until=clock_timestamp() "
            "+interval '30 seconds',generation=%s,attempts=attempts+1 WHERE id=%s",
            (worker.owner, generation, job["id"]),
        )
        conn.execute(
            "INSERT INTO audit_events(id,action,target,decision) VALUES (%s,%s,%s,%s)",
            (uuid4(), "runtime.reconcile", str(run["id"]), "generation:" + str(generation)),
        )
        return {
            "job_id": job["id"],
            "run_id": run["id"],
            "generation": generation,
            "backend": "openhands",
            "recovery": True,
        }


def quarantine(worker, claim, reason):
    with worker.owned(claim) as (conn, run):
        if run["state"] not in TERMINAL and (
            run["state"] != "interrupted" or run["reason"] != reason
        ):
            worker.state(conn, run, "interrupted", reason)
        conn.execute(
            "UPDATE jobs SET status='interrupted',lease_until=NULL,"
            "available_at=clock_timestamp()+interval '30 seconds' WHERE id=%s",
            (claim["job_id"],),
        )
        conn.execute("UPDATE runs SET cleanup_state='unknown' WHERE id=%s", (run["id"],))
        conn.execute(
            "UPDATE sandbox_bindings SET observed_state='unknown',cleanup_state='unknown' "
            "WHERE id=%s",
            (run["sandbox_id"],),
        )
        if run["cleanup_state"] != "unknown" or run["reason"] != reason:
            event(
                conn,
                run["id"],
                "runtime.cleanup_pending",
                {"reason": reason, "capacity_retained": True},
            )

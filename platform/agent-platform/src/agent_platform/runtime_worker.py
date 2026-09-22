"""Real runtime lifecycle. Upstream calls run outside DB transactions with heartbeat."""

import threading
import time
from contextlib import contextmanager
from datetime import UTC, datetime

from psycopg.types.json import Jsonb

from .domain import TERMINAL, Problem
from .store import event


@contextmanager
def heartbeat(worker, claim):
    stopped, lost = threading.Event(), threading.Event()

    def renew():
        while not stopped.wait(5):
            try:
                with worker.db.transaction() as conn:
                    row = conn.execute(
                        "UPDATE jobs SET lease_until=now()+interval '30 seconds' WHERE"
                        " id=%s AND generation=%s AND lease_owner=%s AND "
                        "status='leased' AND lease_until>now() RETURNING id",
                        (claim["job_id"], claim["generation"], worker.owner),
                    ).fetchone()
                if not row:
                    lost.set()
                    return
            except Exception:
                lost.set()
                return

    thread = threading.Thread(target=renew, daemon=True)
    thread.start()
    try:
        yield lost
    finally:
        stopped.set()
        thread.join(timeout=10)


def execute_real(worker, claim):
    client = worker.connector

    def snapshot():
        with worker.owned(claim) as (conn, run):
            context = conn.execute(
                "SELECT p.canonical_repo,a.template_digest FROM tasks t JOIN projects "
                "p ON p.id=t.project_id JOIN agent_profile_revisions a ON a.id=%s "
                "WHERE t.id=%s",
                (run["profile_revision"], run["task_id"]),
            ).fetchone()
            return {**run, **context}

    def ensure_live(run, lost):
        if lost.is_set():
            raise Problem(409, "worker_lease_lost")
        if run["deadline"] <= datetime.now(UTC):
            raise Problem(409, "run_deadline_expired")

    with heartbeat(worker, claim) as lost:
        try:
            run = snapshot()
            ensure_live(run, lost)
            allocated = client.allocate(run)
            with worker.owned(claim) as (conn, run):
                conn.execute(
                    "UPDATE sandbox_bindings SET provider_handle=%s,observed_state='ru"
                    "nning',lease_deadline=%s,last_seen=now() WHERE id=%s",
                    (allocated["handle"], allocated["lease_deadline"], run["sandbox_id"]),
                )
                event(
                    conn,
                    run["id"],
                    "runtime.allocated",
                    {"vm_id": allocated["vm_id"], "execution_mode": "cocoon-fixture"},
                )
            run = snapshot()
            ensure_live(run, lost)
            prepared = client.operation(run, "prepare")
            with worker.owned(claim) as (conn, run):
                conn.execute(
                    "UPDATE runs SET backend_ref=%s WHERE id=%s", (prepared["ref"], run["id"])
                )
                worker.state(conn, run, "running")
            run = snapshot()
            ensure_live(run, lost)
            client.operation(run, "prompt")
            while True:
                run = snapshot()
                ensure_live(run, lost)
                observed = client.events(run)
                with worker.owned(claim) as (conn, run):
                    for item in observed["events"]:
                        event(
                            conn,
                            run["id"],
                            item["type"],
                            item["payload"],
                            source="openhands",
                            source_id=item["event_id"],
                        )
                        conn.execute(
                            "UPDATE runs SET backend_cursor=%s WHERE id=%s",
                            (item["cursor"], run["id"]),
                        )
                    if observed["state"] == "finished" and observed["caught_up"]:
                        worker.state(conn, run, "finalizing")
                        break
                if observed["state"] in {"error", "stuck", "paused"}:
                    raise Problem(409, "backend_stopped_without_completion")
                time.sleep(0.3)
            run = snapshot()
            ensure_live(run, lost)
            result = client.operation(run, "result")
            with worker.owned(claim) as (conn, run):
                conn.execute("UPDATE runs SET result=%s WHERE id=%s", (Jsonb(result), run["id"]))
                event(
                    conn,
                    run["id"],
                    "run.result_saved",
                    {
                        "execution_mode": result["execution_mode"],
                        "diff_sha256": result["diff_sha256"],
                        "verification": result["verification"],
                    },
                )
                passed = result["verification"]["status"] == "passed"
                worker.state(
                    conn,
                    run,
                    "succeeded" if passed else "failed",
                    None if passed else "verification_failed",
                )
            run = snapshot()
            if lost.is_set():
                raise Problem(409, "worker_lease_lost")
            proof = client.operation(run, "release")
            if (
                proof["observed_state"] != "stopped"
                or not proof.get("proof")
                or set(proof["proof"])
                != {
                    "original_vmm_process_gone",
                    "vm_record_gone",
                    "runtime_directory_gone",
                    "cpu_scope_gone",
                }
                or not all(value is True for value in proof["proof"].values())
            ):
                raise Problem(409, "cleanup_unconfirmed")
            with worker.owned(claim) as (conn, run):
                conn.execute(
                    "UPDATE sandbox_bindings SET desired_state='stopped',observed_stat"
                    "e='stopped',cleanup_state='confirmed',last_seen=now() WHERE id=%s",
                    (run["sandbox_id"],),
                )
                conn.execute(
                    "UPDATE resource_reservations SET released_at=now() WHERE sandbox_id=%s",
                    (run["sandbox_id"],),
                )
                conn.execute("UPDATE runs SET cleanup_state='confirmed' WHERE id=%s", (run["id"],))
                event(
                    conn,
                    run["id"],
                    "runtime.cleaned",
                    {"execution_mode": "cocoon-fixture", **proof},
                )
                conn.execute(
                    "UPDATE jobs SET status='done',lease_until=NULL WHERE id=%s", (claim["job_id"],)
                )
        except Exception as exc:
            # Never retry a prompt/allocation or create a replacement after an uncertain effect.
            reason = exc.code if isinstance(exc, Problem) else "runtime_operation_uncertain"
            try:
                with worker.owned(claim) as (conn, run):
                    if run["state"] not in TERMINAL:
                        worker.state(conn, run, "interrupted", reason)
                    conn.execute(
                        "UPDATE jobs SET status='interrupted' WHERE id=%s", (claim["job_id"],)
                    )
                    conn.execute(
                        "UPDATE runs SET cleanup_state='unknown' WHERE id=%s", (run["id"],)
                    )
                    conn.execute(
                        "UPDATE sandbox_bindings SET "
                        "observed_state='unknown',cleanup_state='unknown' WHERE id=%s",
                        (run["sandbox_id"],),
                    )
                    event(
                        conn,
                        run["id"],
                        "runtime.cleanup_pending",
                        {"reason": reason, "capacity_retained": True},
                    )
            except Exception:
                # Lost DB/ownership is reconciled by the next worker; TTL bounds the VM lifetime.
                pass

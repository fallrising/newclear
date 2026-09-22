"""Real runtime lifecycle. Upstream calls run outside DB transactions with heartbeat."""

import threading
import time
from contextlib import contextmanager
from datetime import UTC, datetime

from psycopg.types.json import Jsonb

from .connector_recovery import stopped
from .domain import TERMINAL, Problem
from .recovery import quarantine
from .store import event


@contextmanager
def heartbeat(worker, claim):
    stopped_event, lost = threading.Event(), threading.Event()

    def renew():
        while not stopped_event.wait(5):
            try:
                with worker.owned(claim) as (conn, run):
                    row = conn.execute(
                        "UPDATE jobs SET lease_until=clock_timestamp()+interval '30 seconds' WHERE"
                        " id=%s AND generation=%s AND lease_owner=%s AND "
                        "status='leased' AND lease_until>clock_timestamp() RETURNING lease_until",
                        (claim["job_id"], claim["generation"], worker.owner),
                    ).fetchone()
                if not row:
                    lost.set()
                    return
                # Grant only the committed DB lease; a delayed heartbeat cannot fence a
                # later generation. This endpoint never waits for the long operation lock.
                worker.connector.fence(
                    {"id": claim["run_id"], "generation": claim["generation"], **row}
                )
            except Exception:
                lost.set()
                return

    thread = threading.Thread(target=renew, daemon=True)
    thread.start()
    try:
        yield lost
    finally:
        stopped_event.set()
        thread.join(timeout=10)


def execute_real(worker, claim):
    client = worker.connector

    def snapshot():
        with worker.owned(claim) as (conn, run):
            context = conn.execute(
                "SELECT p.canonical_repo,a.template_digest,b.provider_handle FROM tasks t "
                "JOIN projects p ON p.id=t.project_id JOIN agent_profile_revisions a ON a.id=%s "
                "JOIN sandbox_bindings b ON b.id=%s WHERE t.id=%s",
                (run["profile_revision"], run["sandbox_id"], run["task_id"]),
            ).fetchone()
            return {**run, **context}

    def ensure_live(run, lost):
        if lost.is_set():
            raise Problem(409, "worker_lease_lost")
        if run["deadline"] <= datetime.now(UTC):
            raise Problem(409, "run_deadline_expired")

    def state(conn, run, value, reason=None):
        if run["state"] != value:
            worker.state(conn, run, value, reason)

    def save_result(result):
        with worker.owned(claim) as (conn, run):
            if run["state"] in TERMINAL:
                return
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
                source="connector",
                source_id="result",
            )
            passed = result["verification"]["status"] == "passed"
            state(
                conn,
                run,
                "succeeded" if passed else "failed",
                None if passed else "verification_failed",
            )

    def cleaned(proof):
        if not stopped(proof):
            raise Problem(409, "cleanup_unconfirmed")
        with worker.owned(claim) as (conn, run):
            conn.execute(
                "UPDATE sandbox_bindings SET desired_state='stopped',observed_state='stopped',"
                "cleanup_state='confirmed',last_seen=now() WHERE id=%s",
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
                source="connector",
                source_id="cleaned",
            )
            conn.execute(
                "UPDATE jobs SET status='done',lease_until=NULL WHERE id=%s", (claim["job_id"],)
            )

    with heartbeat(worker, claim) as lost:
        try:
            run = snapshot()
            client.fence(run)
            observed = client.inspect(run) if claim.get("recovery") else {"phase": "absent"}
            phase = observed["phase"]
            if claim.get("recovery"):
                with worker.owned(claim) as (conn, current):
                    conn.execute("UPDATE runs SET reconciled_at=now() WHERE id=%s", (run["id"],))
                    event(
                        conn,
                        run["id"],
                        "runtime.reconciled",
                        {"phase": phase, "generation": run["generation"]},
                    )
            if phase == "stopped":
                if observed.get("result"):
                    save_result(observed["result"])
                with worker.owned(claim) as (conn, current):
                    if current["state"] not in TERMINAL:
                        state(conn, current, "failed", "runtime_stopped_before_result")
                cleaned(observed["stop"])
                return
            if run["state"] in TERMINAL:
                # A terminal run can only finish cleaning its existing, attested instance.
                if phase != "result":
                    raise Problem(409, "terminal_runtime_state_mismatch")
                cleaned(client.operation(run, "release"))
                return
            ensure_live(run, lost)
            if phase == "absent":
                if (
                    run["backend_ref"]
                    or run["backend_cursor"]
                    or run["result"]
                    or run["provider_handle"] != f"pending:{run['id']}"
                    or (run["interrupted_from"] or run["state"]) != "provisioning"
                ):
                    raise Problem(409, "runtime_journal_missing")
                allocated = client.allocate(run)
            else:
                allocated = observed["allocation"]
                if run["provider_handle"] not in {f"pending:{run['id']}", allocated["handle"]}:
                    raise Problem(409, "recovery_binding_mismatch")
            with worker.owned(claim) as (conn, current):
                conn.execute(
                    "UPDATE sandbox_bindings SET provider_handle=%s,observed_state='running',"
                    "lease_deadline=%s,last_seen=now(),cleanup_state='pending' WHERE id=%s",
                    (allocated["handle"], allocated["lease_deadline"], run["sandbox_id"]),
                )
                conn.execute("UPDATE runs SET cleanup_state='pending' WHERE id=%s", (run["id"],))
                event(
                    conn,
                    run["id"],
                    "runtime.allocated",
                    {"vm_id": allocated["vm_id"], "execution_mode": "cocoon-fixture"},
                    source="connector",
                    source_id="allocated",
                )
            run = snapshot()
            ensure_live(run, lost)
            prepared = (
                client.operation(run, "prepare")
                if phase in {"absent", "allocated"}
                else observed["prepared"]
            )
            if run["backend_ref"] and run["backend_ref"] != prepared["ref"]:
                raise Problem(409, "recovery_backend_mismatch")
            with worker.owned(claim) as (conn, current):
                conn.execute(
                    "UPDATE runs SET backend_ref=%s WHERE id=%s", (prepared["ref"], run["id"])
                )
                state(conn, current, "finalizing" if phase == "result" else "running")
            run = snapshot()
            ensure_live(run, lost)
            if phase in {"absent", "allocated", "prepared"}:
                client.operation(run, "prompt")
            if phase != "result":
                while True:
                    run = snapshot()
                    ensure_live(run, lost)
                    events = client.events(run)
                    with worker.owned(claim) as (conn, current):
                        for item in events["events"]:
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
                        if events["state"] == "finished" and events["caught_up"]:
                            state(conn, current, "finalizing")
                            break
                    if events["state"] in {"error", "stuck", "paused"}:
                        raise Problem(409, "backend_stopped_without_completion")
                    time.sleep(0.3)
            run = snapshot()
            ensure_live(run, lost)
            save_result(
                observed["result"] if phase == "result" else client.operation(run, "result")
            )
            run = snapshot()
            if lost.is_set():
                raise Problem(409, "worker_lease_lost")
            cleaned(client.operation(run, "release"))
        except Exception as exc:
            reason = exc.code if isinstance(exc, Problem) else "runtime_operation_uncertain"
            try:
                quarantine(worker, claim, reason)
            except Exception:
                # Lost DB/ownership is reconciled by the next worker; TTL bounds VM lifetime.
                pass

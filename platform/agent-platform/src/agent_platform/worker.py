"""PostgreSQL queue, bounded admission and lease fencing for fake and real adapters.

Expired real-runtime ownership is reconciled against the existing instance.
Unknown effects retain the original binding and resource reservation.
"""

import os
from contextlib import contextmanager
from uuid import uuid4

from psycopg.types.json import Jsonb

from .adapters import FakeAgentBackend, FakeSandboxProvider
from .domain import TERMINAL, Problem
from .store import event


class Worker:
    def __init__(self, db, connector=None):
        self.db = db
        self.owner = uuid4()
        self.connector = connector
        self.model_proxy = None
        if connector is not None and os.environ.get("MODEL_PROXY_CONFIG"):
            from .model_policy import Policy
            from .model_proxy import ModelProxy

            self.model_proxy = ModelProxy(db, Policy.read(os.environ["MODEL_PROXY_CONFIG"]))
            connector.model_transport = True
        self.agent = FakeAgentBackend()
        self.sandbox = FakeSandboxProvider()

    def state(self, conn, run, state, reason=None):
        row = conn.execute(
            (
                "UPDATE runs SET interrupted_from=CASE WHEN %s='interrupted' THEN "
                "CASE WHEN state='interrupted' THEN interrupted_from ELSE state END "
                "ELSE NULL END,state=%s,state_version=state_version+1,reason=%s "
                "WHERE id=%s RETURNING state_version"
            ),
            (state, state, reason, run["id"]),
        ).fetchone()
        event(
            conn,
            run["id"],
            "run.state_changed",
            {"state": state, "state_version": row["state_version"], "reason": reason},
        )

    def reconcile_expired(self):
        with self.db.transaction() as conn:
            rows = conn.execute(
                "SELECT * FROM jobs WHERE status='leased' AND lease_until<=clock_timestamp() "
                "ORDER BY lease_until FOR UPDATE SKIP LOCKED LIMIT 50"
            ).fetchall()
            for job in rows:
                run = conn.execute(
                    "SELECT * FROM runs WHERE id=%s FOR UPDATE", (job["run_id"],)
                ).fetchone()
                if run["state"] not in TERMINAL | {"cancelling", "pausing", "resuming"}:
                    self.state(
                        conn,
                        run,
                        "pausing" if run["control_action"] == "pause" else "interrupted",
                        "worker_lease_expired",
                    )
                conn.execute(
                    "UPDATE jobs SET status='interrupted',available_at=clock_timestamp() "
                    "WHERE id=%s",
                    (job["id"],),
                )
                if run["sandbox_id"]:
                    conn.execute(
                        (
                            "UPDATE sandbox_bindings SET "
                            "observed_state='unknown',cleanup_state='unknown' WHERE id=%s"
                        ),
                        (run["sandbox_id"],),
                    )
                    conn.execute(
                        "UPDATE runs SET cleanup_state='unknown' WHERE id=%s", (run["id"],)
                    )
                    event(
                        conn,
                        run["id"],
                        "runtime.cleanup_pending",
                        {"reason": "worker_lease_expired", "capacity_retained": True},
                    )
            return len(rows)

    def claim_control(self):
        if self.connector is not None:
            from .recovery import claim_recovery

            return claim_recovery(self, control_only=True)
        return None

    def claim_cancel(self):
        if self.connector is not None:
            from .recovery import claim_recovery

            return claim_recovery(self, cancel_only=True)
        return None

    def claim(self):
        if self.connector is not None:
            from .recovery import claim_recovery

            recovery = claim_recovery(self)
            if recovery:
                return recovery
        for node, backend in [("fake-local", "fake"), ("cocoon-local", "openhands")]:
            if backend == "openhands" and self.connector is None:
                continue
            claim = self.claim_node(node, backend)
            if claim:
                return claim
        return None

    def claim_node(self, node, backend):
        with self.db.transaction() as conn:
            # One platform-wide ceiling, including mixed fake/real workers.
            conn.execute("SELECT pg_advisory_xact_lock(18273645)")
            total = conn.execute(
                "SELECT count(*) AS n FROM resource_reservations WHERE released_at IS NULL"
            ).fetchone()["n"]
            if total >= 4:
                return None
            capacity = conn.execute(
                "SELECT * FROM runtime_capacity WHERE node_id=%s FOR UPDATE", (node,)
            ).fetchone()
            occupied = conn.execute(
                "SELECT count(*) AS n FROM resource_reservations rr JOIN "
                "sandbox_bindings b ON b.id=rr.sandbox_id WHERE rr.released_at IS NULL"
                " AND b.node_id=%s",
                (node,),
            ).fetchone()["n"]
            if capacity["draining"] or occupied >= min(
                capacity["slots"], capacity["cpu"] // 4, capacity["memory_bytes"] // (4 * 1024**3)
            ):
                return None
            job = conn.execute(
                "SELECT j.* FROM jobs j JOIN runs r ON r.id=j.run_id WHERE "
                "j.status='queued' AND j.available_at<=now() AND r.state='queued' AND r.backend=%s "
                "ORDER BY j.available_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED",
                (backend,),
            ).fetchone()
            if not job:
                return None
            run = conn.execute(
                "SELECT *,deadline<=now() AS expired FROM runs WHERE id=%s FOR UPDATE",
                (job["run_id"],),
            ).fetchone()
            if run["expired"]:
                self.state(conn, run, "failed", "run_deadline_expired")
                conn.execute("UPDATE jobs SET status='done' WHERE id=%s", (job["id"],))
                return {"expired": True}
            generation = run["generation"] + 1
            binding = uuid4()
            conn.execute(
                (
                    "INSERT INTO sandbox_bindings(id,run_id,node_id,provider_handle,ge"
                    "neration,desired_state,observed_state,lease_deadline,cleanup_stat"
                    "e) VALUES (%s,%s,%s,%s,%s,'running','pending',%s+interv"
                    "al '2 minutes','pending')"
                ),
                (binding, run["id"], node, f"pending:{run['id']}", generation, run["deadline"]),
            )
            conn.execute(
                (
                    "INSERT INTO resource_reservations(sandbox_id,cpu,memory_bytes,dis"
                    "k_bytes) VALUES (%s,4,%s,%s)"
                ),
                (binding, 4 * 1024**3, 10 * 1024**3),
            )
            conn.execute(
                ("UPDATE runs SET generation=%s,sandbox_id=%s,cleanup_state='pending' WHERE id=%s"),
                (generation, binding, run["id"]),
            )
            conn.execute(
                (
                    "UPDATE jobs SET "
                    "status='leased',lease_owner=%s,lease_until=clock_timestamp()+interval '30 "
                    "seconds',generation=%s,attempts=attempts+1 WHERE id=%s"
                ),
                (self.owner, generation, job["id"]),
            )
            self.state(conn, run, "provisioning")
            return {
                "job_id": job["id"],
                "run_id": run["id"],
                "generation": generation,
                "backend": backend,
            }

    @contextmanager
    def owned(self, claim):
        with self.db.transaction() as conn:
            job = conn.execute(
                "SELECT * FROM jobs WHERE id=%s FOR UPDATE",
                (claim["job_id"],),
            ).fetchone()
            live = conn.execute(
                "SELECT lease_until>clock_timestamp() AS live FROM jobs WHERE id=%s",
                (claim["job_id"],),
            ).fetchone()
            if (
                not job
                or not live["live"]
                or job["status"] != "leased"
                or job["lease_owner"] != self.owner
                or job["generation"] != claim["generation"]
            ):
                raise Problem(409, "worker_lease_lost")
            run = conn.execute(
                "SELECT * FROM runs WHERE id=%s FOR UPDATE", (claim["run_id"],)
            ).fetchone()
            if run["generation"] != claim["generation"]:
                raise Problem(409, "worker_generation_stale")
            run["lease_until"] = job["lease_until"]
            yield conn, run

    def execute(self, claim):
        if claim.get("expired"):
            return
        if claim.get("backend") == "openhands":
            from .runtime_worker import execute_real

            return execute_real(self, claim)
        return self.execute_fake(claim)

    def execute_fake(self, claim):
        with self.owned(claim) as (conn, run):
            if run["state"] != "provisioning":
                raise Problem(409, "unexpected_worker_state")
            self.sandbox.allocate(conn, run, f"{run['id']}:allocate")
            backend = self.agent.create(conn, run, f"{run['id']}:conversation")
            conn.execute("UPDATE runs SET backend_ref=%s WHERE id=%s", (backend["ref"], run["id"]))
            self.state(conn, run, "running")
        with self.owned(claim) as (conn, run):
            command = conn.execute(
                ("SELECT command_id FROM run_messages WHERE run_id=%s AND role='user'"),
                (run["id"],),
            ).fetchone()
            self.agent.send_message(conn, run, str(command["command_id"]))
            for observed in self.agent.events(conn, run, run["backend_cursor"]):
                message = observed["payload"]
                conn.execute(
                    "INSERT INTO run_messages(id,run_id,role,content,backend_message_id) "
                    "VALUES (%s,%s,'assistant',%s,%s) "
                    "ON CONFLICT(run_id,backend_message_id) DO NOTHING",
                    (uuid4(), run["id"], message["content"], observed["event_id"]),
                )
                event(
                    conn,
                    run["id"],
                    observed["type"],
                    message,
                    source="fake",
                    source_id=observed["event_id"],
                )
                conn.execute(
                    "UPDATE runs SET backend_cursor=%s WHERE id=%s", (observed["cursor"], run["id"])
                )
            self.state(conn, run, "finalizing")
        with self.owned(claim) as (conn, run):
            result = {
                "execution_mode": "fake",
                "summary": "測試流程已完成；未修改 repository。",
                "verification": {
                    "status": "not_run",
                    "reason": "M1 deterministic fixture does not execute code or model calls",
                },
            }
            conn.execute("UPDATE runs SET result=%s WHERE id=%s", (Jsonb(result), run["id"]))
            event(conn, run["id"], "run.result_saved", result)
            self.state(conn, run, "succeeded")
        with self.owned(claim) as (conn, run):
            self.sandbox.release(conn, run, f"{run['id']}:release")
            observed = self.sandbox.inspect(conn, run)
            if observed["observed_state"] != "stopped":
                raise Problem(409, "cleanup_unconfirmed")
            conn.execute(
                "UPDATE resource_reservations SET released_at=now() WHERE sandbox_id=%s",
                (run["sandbox_id"],),
            )
            conn.execute("UPDATE runs SET cleanup_state='confirmed' WHERE id=%s", (run["id"],))
            event(
                conn,
                run["id"],
                "runtime.cleaned",
                {"execution_mode": "fake", "observed_state": "stopped"},
            )
            conn.execute(
                "UPDATE jobs SET status='done',lease_until=NULL WHERE id=%s", (claim["job_id"],)
            )

    def run_once(self):
        self.reconcile_expired()
        claim = self.claim()
        if not claim:
            return False
        self.execute(claim)
        return True

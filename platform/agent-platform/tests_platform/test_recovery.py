"""M3 recovery slice: real PostgreSQL/HTTP, killed workers, deterministic upstream."""

import concurrent.futures
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from recovery_fixture import Server
from test_control_plane import PlatformFixture

from agent_platform.connector_fence import Fences, Lease
from agent_platform.domain import Problem
from agent_platform.store import Store
from agent_platform.worker import Worker


class RecoveryTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.server = Server(self.root, self.project["canonical_repo"], self.payload["base_sha"])
        self.addCleanup(self.server.close)
        self.connector = self.server.client
        self.connector.register(self.db)
        response = self.post(
            "/agent-profiles", {"name": "Recovery fixture", "backend": "openhands"}
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.payload["profile_revision"] = response.json()["id"]

    def kill_at(self, point):
        value = self.create()
        ready = self.root / "ready"
        ready.unlink(missing_ok=True)
        with (self.root / "worker-output").open("w+") as output:
            process = subprocess.Popen(
                [sys.executable, str(Path(__file__).with_name("crash_worker.py"))],
                env=dict(
                    os.environ,
                    FAULT_POINT=point,
                    FAULT_READY=str(ready),
                    FIXTURE_ORIGIN=self.server.origin,
                    FIXTURE_TOKEN=str(self.root / "connector-token"),
                ),
                stdout=output,
                stderr=output,
            )
            try:
                deadline = time.monotonic() + 15
                while not ready.exists():
                    if process.poll() is not None or time.monotonic() >= deadline:
                        output.seek(0)
                        self.fail("worker did not reach " + point + ": " + output.read())
                    time.sleep(0.02)
                process.kill()
                self.assertEqual(process.wait(timeout=5), -signal.SIGKILL)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(self.scalar("SELECT count(*) FROM sandbox_bindings"), 1)
        return value

    def recovery_worker(self):
        # Move the DB lease clock to the expired boundary instead of sleeping 30 s.
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second',"
                "available_at=clock_timestamp()-interval '1 second'"
            )
        worker = Worker(self.db, self.connector)
        worker.reconcile_expired()
        return worker

    def assert_finished_once(self):
        self.assertEqual(self.scalar("SELECT state FROM runs"), "succeeded")
        self.assertEqual(self.scalar("SELECT cleanup_state FROM runs"), "confirmed")
        self.assertEqual(self.scalar("SELECT generation FROM runs"), 2)
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(self.server.node.calls, dict.fromkeys(self.server.node.calls, 1))
        self.assertEqual(self.scalar("SELECT count(*) FROM sandbox_bindings"), 1)
        self.assertEqual(self.scalar("SELECT count(*) FROM runs"), 1)
        self.assertEqual(self.scalar("SELECT count(*) FROM run_events WHERE source='openhands'"), 3)
        self.assertEqual(
            self.scalar(
                "SELECT count(DISTINCT source_event_id) FROM run_events WHERE source='openhands'"
            ),
            3,
        )
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='runtime.reconcile'"), 1
        )
        self.assertIsNotNone(self.scalar("SELECT reconciled_at FROM runs"))
        self.assertIsNone(self.scalar("SELECT interrupted_from FROM runs"))
        self.assertFalse(Worker(self.db, self.connector).run_once())

    def test_unknown_allocation_stays_quarantined_across_connector_restart(self):
        self.create()
        self.server.node.lose = "allocate"
        Worker(self.db, self.connector).run_once()
        self.server.close()
        self.server = Server(
            self.root, self.project["canonical_repo"], self.payload["base_sha"], self.server.node
        )
        self.addCleanup(self.server.close)
        self.connector = self.server.client
        self.recovery_worker().run_once()
        self.recovery_worker().run_once()
        self.assertEqual(self.server.node.calls["allocate"], 1)
        self.assertEqual(len(self.server.node.sandboxes()), 1)
        self.assertEqual(self.scalar("SELECT state FROM runs"), "interrupted")
        self.assertEqual(self.scalar("SELECT interrupted_from FROM runs"), "provisioning")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

    def test_unknown_prompt_never_resends_and_ttl_stop_can_reclaim(self):
        self.create()
        self.server.node.lose = "prompt"
        Worker(self.db, self.connector).run_once()
        self.server.node.lose = None
        self.recovery_worker().run_once()
        self.assertEqual(self.server.node.calls["prompt"], 1)
        self.assertEqual(self.scalar("SELECT state FROM runs"), "interrupted")
        self.assertEqual(self.scalar("SELECT interrupted_from FROM runs"), "running")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        for row in self.server.node.rows.values():
            row["alive"] = False
        self.server.node.partial_removal = True
        self.recovery_worker().run_once()
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.server.node.partial_removal = False
        self.recovery_worker().run_once()
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(self.scalar("SELECT state FROM runs"), "failed")
        self.assertEqual(self.scalar("SELECT reason FROM runs"), "runtime_stopped_before_result")
        self.assertEqual(self.server.node.calls["release"], 0)

    def test_node_partition_fences_stale_worker_without_freeing_capacity(self):
        self.kill_at("after_prompt")
        old = self.scalar("SELECT to_jsonb(r) FROM runs r")
        with self.db.transaction() as conn:
            old_run = conn.execute(
                "SELECT r.*,j.lease_until FROM runs r JOIN jobs j ON j.run_id=r.id"
            ).fetchone()
        self.server.node.partition = True
        self.recovery_worker().run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "interrupted")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        old_run["lease_until"] = datetime.now(UTC) + timedelta(seconds=20)
        with self.assertRaises(Problem):
            self.connector.fence(old_run)
        with self.assertRaises(Problem):
            self.connector.operation(old_run, "prompt")
        self.assertEqual(self.server.node.calls["prompt"], 1)
        text = self.client.get(f"/api/v1/runs/{old['id']}/events?follow=false").text
        self.assertNotIn("SYNTHETIC_UPSTREAM_SECRET", text)
        for _ in range(4):
            self.create()
        worker = Worker(self.db, self.connector)
        self.assertTrue(all(worker.claim() for _ in range(3)))
        self.assertIsNone(worker.claim())
        self.assertEqual(self.scalar("SELECT count(*) FROM runs WHERE state='queued'"), 1)

    def test_recovery_rejects_pid_reuse_and_changed_instance(self):
        self.kill_at("after_prompt")
        self.server.node.swapped = True
        self.recovery_worker().run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "interrupted")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(self.server.node.calls["allocate"], 1)
        self.assertEqual(self.server.node.calls["prompt"], 1)

    def test_concurrent_recovery_has_one_owner_and_original_reservation(self):
        self.kill_at("after_prompt")
        self.recovery_worker()
        workers = [Worker(self.db, self.connector) for _ in range(6)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            claims = list(pool.map(lambda w: w.claim(), workers))
        self.assertEqual(sum(c is not None for c in claims), 1)
        index = next(i for i, c in enumerate(claims) if c)
        workers[index].execute(claims[index])
        self.assert_finished_once()

    def test_takeover_grant_does_not_wait_for_inflight_operation_lock(self):
        self.kill_at("after_prompt")
        run_id = self.scalar("SELECT id FROM runs")
        service = self.server.service
        old_run = Store(self.db).run(run_id)
        with service.journal.locked(run_id):
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(
                    self.connector.fence,
                    {
                        "id": run_id,
                        "generation": 2,
                        "lease_until": datetime.now(UTC) + timedelta(seconds=20),
                    },
                )
                future.result(timeout=2)
        with self.assertRaises(Problem):
            self.connector.operation(old_run, "prompt")
        current = service.fences.journal.read(run_id)
        current["lease_until"] = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
        service.fences.journal.write(current)
        with self.assertRaises(Problem):
            self.connector.operation({**old_run, "generation": 2}, "prompt")
        self.assertEqual(self.server.node.calls["prompt"], 1)

    def test_lease_expiring_while_waiting_for_db_lock_cannot_mutate(self):
        self.create()
        worker = Worker(self.db, self.connector)
        claim = worker.claim()
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE jobs SET lease_until=clock_timestamp()+interval '150 milliseconds'"
            )
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            with self.db.transaction() as conn:
                conn.execute("SELECT * FROM jobs FOR UPDATE").fetchone()

                def stale_mutation():
                    with worker.owned(claim):
                        self.fail("expired worker acquired ownership")

                future = pool.submit(stale_mutation)
                time.sleep(0.3)
            with self.assertRaises(Problem) as error:
                future.result(timeout=3)
            self.assertEqual(error.exception.code, "worker_lease_lost")
        self.assertEqual(self.server.node.calls["allocate"], 0)

    def test_missing_journal_after_binding_does_not_allocate_replacement(self):
        self.kill_at("after_prompt")
        run_id = self.scalar("SELECT id FROM runs")
        (self.root / "state" / f"{run_id}.json").unlink()
        self.recovery_worker().run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "interrupted")
        self.assertEqual(self.server.node.calls["allocate"], 1)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

    def test_release_reply_lost_still_requires_observed_removal(self):
        self.create()
        self.server.node.lose = "release"
        Worker(self.db, self.connector).run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "succeeded")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.recovery_worker().run_once()
        self.assert_finished_once()


def kill_test(point):
    def test(self):
        self.kill_at(point)
        self.recovery_worker().run_once()
        self.assert_finished_once()

    return test


for point in [
    "before_allocate",
    "after_allocate",
    "after_prepare",
    "before_prompt",
    "after_prompt",
    "before_event_commit",
    "before_result",
    "after_result",
    "after_release",
]:
    setattr(RecoveryTests, "test_sigkill_" + point, kill_test(point))


class FenceTests(unittest.TestCase):
    def test_grant_restart_expiry_and_late_generation(self):
        from uuid import uuid4

        with tempfile.TemporaryDirectory() as root:
            identifier = uuid4()
            fence = Fences(root)
            fence.grant(
                identifier,
                Lease(generation=1, lease_until=datetime.now(UTC) + timedelta(seconds=20)),
            )
            fence.close()
            fence = Fences(root)
            try:
                fence.require(identifier, 1)
                fence.grant(
                    identifier,
                    Lease(generation=2, lease_until=datetime.now(UTC) + timedelta(seconds=20)),
                )
                with self.assertRaises(Problem):
                    fence.require(identifier, 1)
                with self.assertRaises(Problem):
                    fence.grant(
                        identifier,
                        Lease(generation=1, lease_until=datetime.now(UTC) + timedelta(seconds=25)),
                    )
                row = fence.journal.read(identifier)
                row["lease_until"] = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
                fence.journal.write(row)
                with self.assertRaises(Problem) as error:
                    fence.require(identifier, 2)
                self.assertEqual(error.exception.code, "connector_lease_expired")
                for seconds in [-1, 120]:
                    with self.assertRaises(Problem):
                        fence.grant(
                            identifier,
                            Lease(
                                generation=3,
                                lease_until=datetime.now(UTC) + timedelta(seconds=seconds),
                            ),
                        )
            finally:
                fence.close()

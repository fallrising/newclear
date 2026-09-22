"""AT-08: cancellation reflects observed VM state, never merely an accepted command."""

import concurrent.futures
import os
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import test_recovery as recovery_tests
from fastapi.testclient import TestClient
from recovery_fixture import Server
from test_control_plane import URL, PlatformFixture

from agent_platform.api import create_app
from agent_platform.connector import Allocate
from agent_platform.domain import Problem
from agent_platform.store import Store
from agent_platform.worker import Worker


class CancellationTests(PlatformFixture):
    kill_at = recovery_tests.RecoveryTests.kill_at
    recovery_worker = recovery_tests.RecoveryTests.recovery_worker

    def setUp(self):
        super().setUp()
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.server = Server(self.root, self.project["canonical_repo"], self.payload["base_sha"])
        self.addCleanup(self.server.close)
        self.connector = self.server.client
        self.connector.register(self.db)
        profile = self.post("/agent-profiles", {"name": "Cancel fixture", "backend": "openhands"})
        self.assertEqual(profile.status_code, 201)
        self.payload["profile_revision"] = profile.json()["id"]

    def cancel(self, run_id, key=None):
        run = Store(self.db).run(run_id)
        return self.post(
            f"/runs/{run_id}/actions",
            {
                "action": "cancel",
                "expected_state_version": run["state_version"],
            },
            key,
        )

    def assert_cancelled(self, allocated=True):
        self.assertEqual(self.scalar("SELECT state FROM runs"), "cancelled")
        self.assertEqual(self.scalar("SELECT cleanup_state FROM runs"), "confirmed")
        self.assertIsNotNone(self.scalar("SELECT cancel_completed_at FROM runs"))
        self.assertIsNone(self.scalar("SELECT result FROM runs"))
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(self.server.node.calls["allocate"], int(allocated))
        self.assertFalse(Worker(self.db, self.connector).run_once())

    def test_cancel_queued_without_allocation_or_worker(self):
        run = self.create()["run"]
        response = self.cancel(run["id"], "queued-cancel")
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["status"], "completed")
        self.assertEqual(response.json()["run"]["state"], "cancelled")
        self.assertEqual(
            response.json()["run"]["last_event_seq"], self.scalar("SELECT last_event_seq FROM runs")
        )
        self.assertEqual(self.scalar("SELECT cleanup_state FROM runs"), "not_allocated")
        self.assertEqual(self.scalar("SELECT count(*) FROM sandbox_bindings"), 0)
        self.assertFalse(Worker(self.db, self.connector).run_once())
        self.assertEqual(self.server.node.calls["allocate"], 0)

    def test_cancel_before_allocate_persists_tombstone_and_fences_late_rpc(self):
        value = self.kill_at("before_allocate")
        self.assertEqual(self.cancel(value["run"]["id"]).status_code, 202)
        Worker(self.db, self.connector).run_once()
        self.assert_cancelled(allocated=False)
        run = Store(self.db).run(value["run"]["id"])
        self.connector.fence({**run, "lease_until": datetime.now(UTC) + timedelta(seconds=20)})
        with self.assertRaises(Problem) as error:
            self.server.service.allocate(
                run["id"],
                Allocate(
                    generation=run["generation"],
                    template=self.server.config["template"],
                    canonical_repo=self.project["canonical_repo"],
                    base_sha=run["base_sha"],
                    deadline=run["deadline"],
                ),
            )
        self.assertEqual(error.exception.code, "sandbox_cancel_requested")
        self.assertEqual(self.server.node.calls["allocate"], 0)

    def test_cancel_provisioning_never_prepares_or_prompts(self):
        value = self.kill_at("after_allocate")
        response = self.cancel(value["run"]["id"])
        self.assertEqual(response.json()["status"], "pending")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(self.scalar("SELECT state FROM runs"), "cancelling")
        Worker(self.db, self.connector).run_once()
        self.assert_cancelled()
        self.assertEqual(self.server.node.calls["prepare"], 0)
        self.assertEqual(self.server.node.calls["prompt"], 0)

    def test_cancel_running_invalidates_old_owner_and_is_idempotent(self):
        value = self.kill_at("after_prompt")
        old = Store(self.db).run(value["run"]["id"])
        payload = {"action": "cancel", "expected_state_version": old["state_version"]}
        path = f"/runs/{old['id']}/actions"
        response = self.post(path, payload, "cancel-once")
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.post(path, payload, "cancel-once").json(), response.json())
        Worker(self.db, self.connector).run_once()
        self.assert_cancelled()
        self.assertEqual(self.post(path, payload, "cancel-once").json(), response.json())
        self.assertEqual(self.server.node.calls["prompt"], 1)
        self.assertEqual(self.server.node.calls["release"], 1)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM commands WHERE route LIKE '%%/actions'"), 1
        )
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action LIKE '%%/actions'"), 1
        )
        with self.assertRaises(Problem):
            self.connector.operation(old, "prompt")
        self.assertEqual(
            self.post(path, {**payload, "action": "pause"}, "cancel-once").json()["error"],
            "idempotency_conflict",
        )

    def test_cancel_partition_stays_cancelling_until_node_recovers(self):
        value = self.kill_at("after_prompt")
        self.cancel(value["run"]["id"])
        self.server.node.partition = True
        Worker(self.db, self.connector).run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "cancelling")
        self.assertEqual(self.scalar("SELECT cleanup_state FROM runs"), "unknown")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertIsNone(self.scalar("SELECT cancel_completed_at FROM runs"))
        self.server.node.partition = False
        self.recovery_worker().run_once()
        self.assert_cancelled()

    def test_cancel_lost_release_ack_reconciles_without_repeating_release(self):
        value = self.kill_at("after_prompt")
        self.cancel(value["run"]["id"])
        self.server.node.lose = "release"
        Worker(self.db, self.connector).run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "cancelling")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.recovery_worker().run_once()
        self.assert_cancelled()
        self.assertEqual(self.server.node.calls["release"], 1)

    def test_cancel_requires_all_stop_proofs(self):
        value = self.kill_at("after_prompt")
        self.cancel(value["run"]["id"])
        self.server.node.partial_removal = True
        Worker(self.db, self.connector).run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "cancelling")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.server.node.partial_removal = False
        self.recovery_worker().run_once()
        self.assert_cancelled()

    def test_unknown_prompt_can_be_stopped_without_resending(self):
        run = self.create()["run"]
        self.server.node.lose = "prompt"
        Worker(self.db, self.connector).run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "interrupted")
        self.cancel(run["id"])
        Worker(self.db, self.connector).run_once()
        self.assert_cancelled()
        self.assertEqual(self.server.node.calls["prompt"], 1)

    def test_unknown_allocation_without_ownership_is_not_falsely_cancelled(self):
        run = self.create()["run"]
        self.server.node.lose = "allocate"
        Worker(self.db, self.connector).run_once()
        self.cancel(run["id"])
        Worker(self.db, self.connector).run_once()
        self.recovery_worker().run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "cancelling")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(self.server.node.calls["allocate"], 1)
        self.assertEqual(self.server.node.calls["release"], 0)

    def test_finalizing_and_terminal_cancel_are_rejected(self):
        value = self.kill_at("before_result")
        self.assertEqual(self.cancel(value["run"]["id"]).json()["error"], "finalizing")
        self.recovery_worker().run_once()
        self.assertEqual(self.cancel(value["run"]["id"]).json()["error"], "run_terminal")
        self.assertEqual(self.scalar("SELECT state FROM runs"), "succeeded")
        self.assertIsNone(self.scalar("SELECT cancel_requested_at FROM runs"))

    def test_concurrent_cancel_has_one_accepted_command(self):
        value = self.kill_at("after_prompt")
        run = Store(self.db).run(value["run"]["id"])
        path = f"/runs/{run['id']}/actions"
        payload = {"action": "cancel", "expected_state_version": run["state_version"]}
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            responses = list(pool.map(lambda _: self.post(path, payload), range(6)))
        self.assertEqual(sum(r.status_code == 202 for r in responses), 1)
        self.assertEqual(sum(r.status_code == 409 for r in responses), 5)
        self.assertEqual(self.cancel(run["id"]).json()["error"], "cancel_already_requested")
        Worker(self.db, self.connector).run_once()
        self.assert_cancelled()

    def test_cancel_is_authenticated_and_csrf_protected(self):
        run = self.create()["run"]
        payload = {"action": "cancel", "expected_state_version": run["state_version"]}
        path = f"/api/v1/runs/{run['id']}/actions"
        with TestClient(
            create_app(self.settings, self.db), base_url=self.settings.origin
        ) as outsider:
            self.assertEqual(outsider.post(path, json=payload).status_code, 401)
        self.assertEqual(
            self.client.post(
                path, json=payload, headers={"Idempotency-Key": uuid4().hex}
            ).status_code,
            403,
        )
        self.assertEqual(self.scalar("SELECT state FROM runs"), "queued")

    def test_cancel_dead_worker_and_expired_run_still_cleans(self):
        value = self.kill_at("after_prompt")
        self.cancel(value["run"]["id"])
        worker = Worker(self.db, self.connector)
        claim = worker.claim_cancel()
        self.assertIsNotNone(claim)
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET deadline=now()-interval '1 second'")
            conn.execute("UPDATE jobs SET lease_until=now()-interval '1 second'")
        worker.reconcile_expired()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "cancelling")
        Worker(self.db, self.connector).run_once()
        self.assert_cancelled()

    def test_interrupt_failure_cannot_veto_stopping_the_owned_vm(self):
        value = self.kill_at("after_prompt")
        self.cancel(value["run"]["id"])

        @contextmanager
        def unavailable_agent(row):
            raise TimeoutError("private upstream diagnostic")
            yield

        self.server.service.relay = unavailable_agent
        Worker(self.db, self.connector).run_once()
        self.assert_cancelled()
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='run.cancel_completed'"), 1
        )

    def test_cli_can_cancel_while_all_four_execution_slots_are_blocked(self):
        values = [self.create() for _ in range(4)]
        blocked, gate, lock = set(), threading.Event(), threading.Lock()
        original = self.server.service.events

        def delayed_reply(run_id, generation, cursor):
            reply = original(run_id, generation, cursor)
            with lock:
                blocked.add(str(run_id))
            if not gate.wait(20):
                raise TimeoutError("test reply timeout")
            return reply

        self.server.service.events = delayed_reply
        env = dict(
            os.environ,
            DATABASE_URL=URL,
            CONNECTOR_ORIGIN=self.server.origin,
            CONNECTOR_TOKEN_FILE=str(self.root / "connector-token"),
        )
        with (self.root / "cli.log").open("w") as output:
            process = subprocess.Popen(
                [sys.executable, "-m", "agent_platform.cli", "worker"],
                env=env,
                stdout=output,
                stderr=output,
            )
            try:
                deadline = time.monotonic() + 10
                while len(blocked) != 4:
                    self.assertIsNone(process.poll())
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.03)
                identifier = values[0]["run"]["id"]
                self.assertEqual(self.cancel(identifier).status_code, 202)
                deadline = time.monotonic() + 8
                while Store(self.db).run(identifier)["state"] != "cancelled":
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.03)
                self.assertFalse(gate.is_set())
                self.assertEqual(Store(self.db).runtime()["occupied"], 3)
                gate.set()
                deadline = time.monotonic() + 8
                while Store(self.db).runtime()["occupied"]:
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.03)
                self.assertEqual(Store(self.db).run(identifier)["state"], "cancelled")
                self.assertEqual(
                    self.scalar("SELECT count(*) FROM runs WHERE state='succeeded'"), 3
                )
            finally:
                gate.set()
                process.kill()
                process.wait(timeout=5)

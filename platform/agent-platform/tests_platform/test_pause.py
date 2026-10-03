"""Observed pause, same-instance resume, stale grants and uncertain control effects."""

import concurrent.futures
import tempfile
import threading
import time
from pathlib import Path

from pause_fixture import PauseConnector
from recovery_fixture import Server
from test_control_plane import PlatformFixture

from agent_platform.domain import Problem
from agent_platform.store import Store
from agent_platform.worker import Worker


class PauseTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.server = Server(
            self.root,
            self.project["canonical_repo"],
            self.payload["base_sha"],
            connector_type=PauseConnector,
        )
        self.addCleanup(self.server.close)
        self.connector = self.server.client
        self.connector.register(self.db)
        self.threads = []
        self.addCleanup(self.stop_workers)

    def stop_workers(self):
        with self.db.transaction() as conn:
            conn.execute("UPDATE jobs SET lease_owner=NULL,lease_until=NULL,status='interrupted'")
        for thread in self.threads:
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive())

    def view(self):
        return Store(self.db).run(self.run["id"])

    def start(self, approval=False):
        profile = self.post(
            "/agent-profiles",
            {"name": "Pause fixture", "backend": "openhands", "require_approval": approval},
        ).json()
        self.payload["profile_revision"] = profile["id"]
        self.run = self.create()["run"]
        self.thread()
        self.wait_for(
            lambda: (
                self.view()["backend_cursor"]
                and self.view()["state"] == ("awaiting_approval" if approval else "running")
            )
        )
        return self.view()

    def thread(self):
        worker = Worker(self.db, self.connector)
        resuming = self.view()["state"] == "resuming"

        def execute():
            worker.run_once()
            if resuming and self.view()["state"] == "running":
                worker.run_once()

        thread = threading.Thread(target=execute, daemon=True)
        self.threads.append(thread)
        thread.start()
        return thread

    def wait_for(self, check):
        deadline = time.monotonic() + 8
        while not (result := check()):
            self.assertLess(time.monotonic(), deadline, str(self.view()))
            time.sleep(0.02)
        return result

    def action(self, action="pause", key=None, version=None):
        return self.post(
            f"/runs/{self.run['id']}/actions",
            {
                "action": action,
                "expected_state_version": self.view()["state_version"]
                if version is None
                else version,
            },
            key,
        )

    def step(self, resume_execution=True):
        with self.db.transaction() as conn:
            conn.execute("UPDATE jobs SET available_at=now()")
        worker = Worker(self.db, self.connector)
        claim = worker.claim_control()
        self.assertIsNotNone(claim)
        worker.execute(claim)
        if resume_execution and self.view()["state"] == "running":
            worker.run_once()

    def pause(self):
        self.assertEqual(self.action().status_code, 202)
        self.assertEqual(self.view()["state"], "pausing")
        self.step()
        self.assertEqual(self.view()["state"], "paused", self.view()["reason"])
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

    def test_pause_resume_same_instance_once_and_repeatable(self):
        old = self.start()
        self.pause()
        self.assertIsNotNone(self.view()["pause_completed_at"])
        self.assertEqual(self.server.service.policy, "AlwaysConfirm")
        with self.assertRaises(Problem):
            self.connector.operation(old, "prompt")
        version = self.view()["state_version"]
        accepted = self.action("resume", "resume-once", version)
        self.assertEqual(accepted.status_code, 202)
        self.step()
        self.assertEqual(self.view()["state"], "succeeded", self.view()["reason"])
        self.assertEqual(self.action("resume", "resume-once", version).json(), accepted.json())
        self.assertEqual(self.server.service.resume_calls, 1)
        self.assertEqual(self.server.service.policy, "NeverConfirm")
        self.assertEqual(self.server.node.calls["allocate"], 1)
        self.assertEqual(self.server.node.calls["prompt"], 1)
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        for action in ("pause", "resume"):
            self.assertEqual(
                self.scalar(
                    "SELECT count(*) FROM audit_events WHERE action=%s",
                    ("run." + action + "_completed",),
                ),
                1,
            )

    def test_active_tool_ack_is_not_pause_completion(self):
        self.start()
        self.server.service.busy = True
        self.action()
        self.step()
        self.assertEqual(self.view()["state"], "pausing")
        self.assertIsNone(self.view()["pause_completed_at"])
        self.assertEqual(self.action("resume").status_code, 409)
        self.server.service.status = "waiting_for_confirmation"
        self.step()
        self.assertEqual(self.view()["state"], "paused")

    def test_background_process_retains_capacity_until_gone(self):
        self.start()
        self.server.service.same_processes = False
        self.action()
        self.step()
        self.assertEqual(self.view()["state"], "pausing")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.server.service.same_processes = True
        self.step()
        self.assertEqual(self.view()["state"], "paused")

    def test_reboot_and_process_change_prevent_resume(self):
        for field in ("same_boot", "same_processes"):
            with self.subTest(field=field):
                if field == "same_boot":
                    self.start()
                    self.pause()
                    self.action("resume")
                setattr(self.server.service, field, False)
                self.step()
                self.assertEqual(self.view()["state"], "resuming")
                self.assertEqual(self.server.service.resume_calls, 0)
                setattr(self.server.service, field, True)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

    def test_soft_timeout_history_never_counts_as_completion(self):
        self.start()
        self.server.service.history.append(
            {
                "id": "soft-timeout",
                "kind": "ObservationEvent",
                "action_id": "old",
                "observation": {"kind": "TerminalObservation", "exit_code": -1, "timeout": True},
            }
        )
        self.action()
        self.step()
        self.assertEqual(self.view()["state"], "pausing")
        self.assertIsNone(self.view()["pause_completed_at"])

    def test_partition_and_paused_revalidation_fail_closed(self):
        self.start()
        self.pause()
        self.server.node.partition = True
        self.step()
        self.assertEqual(self.view()["state"], "pausing")
        self.assertEqual(self.view()["cleanup_state"], "unknown")
        self.assertEqual(self.action("resume").status_code, 409)
        self.server.node.partition = False
        self.step()
        self.assertEqual(self.view()["state"], "paused")
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='run.pause_completed'"), 1
        )

    def test_cancel_wins_while_paused(self):
        self.start()
        self.pause()
        self.action("cancel")
        self.assertEqual(self.action("resume").status_code, 409)
        self.step()
        self.assertEqual(self.view()["state"], "cancelled")
        self.assertIsNone(self.view()["control_action"])
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(self.server.service.resume_calls, 0)

    def test_deadline_stops_paused_vm_without_resume(self):
        self.start()
        self.pause()
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET deadline=now()-interval '1 second'")
        self.assertEqual(self.action("resume").status_code, 409)
        self.step()
        self.assertEqual(self.view()["state"], "failed")
        self.assertEqual(self.view()["reason"], "run_deadline_expired")
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(self.server.service.resume_calls, 0)

    def test_lost_gate_reply_reconciled_by_observation(self):
        self.start()
        self.server.service.lose_gate = True
        self.action()
        self.step()
        self.assertEqual(self.view()["state"], "pausing")
        self.step()
        self.assertEqual(self.view()["state"], "paused")
        self.assertEqual(self.server.service.policy_calls, 1)

    def test_lost_resume_reply_is_never_repeated(self):
        self.start()
        self.pause()
        self.server.service.lose_resume = True
        self.action("resume")
        self.step()
        self.step()
        self.assertEqual(self.view()["state"], "resuming")
        self.assertEqual(self.server.service.resume_calls, 1)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.action("cancel")
        self.step()
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)

    def test_completed_resume_receipt_survives_lost_connector_ack(self):
        self.start()
        self.pause()
        original = self.connector.control

        def lost(run):
            original(run)
            raise TimeoutError("reply lost after connector journal commit")

        self.connector.control = lost
        self.action("resume")
        self.step()
        self.connector.control = original
        self.step()
        self.assertEqual(self.view()["state"], "succeeded", self.view()["reason"])
        self.assertEqual(self.server.service.resume_calls, 1)

    def test_approval_resume_requires_fresh_grant_without_implicit_accept(self):
        self.start(approval=True)
        old = self.client.get(f"/api/v1/runs/{self.run['id']}/approvals").json()["items"][-1]
        self.pause()
        self.assertEqual(self.scalar("SELECT status FROM approvals"), "invalidated")
        self.action("resume")
        thread = self.thread()
        self.wait_for(lambda: self.view()["state"] == "awaiting_approval")
        new = self.client.get(f"/api/v1/runs/{self.run['id']}/approvals").json()["items"][-1]
        self.assertNotEqual(new["generation"], old["generation"])
        self.assertNotEqual(new["action_digest"], old["action_digest"])
        self.assertEqual(self.server.service.resume_calls, 0)
        self.assertEqual(self.server.service.accepts, 0)
        for grant, expected in ((old, 409), (new, 202)):
            reply = self.post(
                f"/approvals/{grant['id']}/decision",
                {
                    "decision": "approve",
                    "generation": grant["generation"],
                    "action_digest": grant["action_digest"],
                    "expected_state_version": self.view()["state_version"],
                },
            )
            self.assertEqual(reply.status_code, expected)
        thread.join(timeout=5)
        self.assertEqual(self.view()["state"], "succeeded")
        self.assertEqual(self.server.service.accepts, 1)

    def test_resume_releases_controller_slot_before_normal_execution(self):
        self.start()
        self.pause()
        self.action("resume")
        self.step(resume_execution=False)
        self.assertEqual(self.view()["state"], "running")
        self.assertIsNone(self.view()["control_action"])
        self.assertEqual(self.scalar("SELECT status FROM jobs"), "interrupted")
        self.assertIsNone(Worker(self.db, self.connector).claim_control())
        worker = Worker(self.db, self.connector)
        claim = worker.claim()
        self.assertTrue(claim["recovery"])
        worker.execute(claim)
        self.assertEqual(self.view()["state"], "succeeded")

    def test_resume_ack_waits_for_live_state_without_repeating_run(self):
        self.start()
        self.pause()
        self.server.service.resume_pending_reads = 1
        self.action("resume")
        self.step()
        self.assertEqual(self.view()["state"], "resuming")
        self.assertEqual(self.server.service.resume_calls, 1)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.step()
        self.assertEqual(self.view()["state"], "succeeded")
        self.assertEqual(self.server.service.resume_calls, 1)

    def test_pause_acceptance_replays_original_receipt_after_completion(self):
        self.start()
        version = self.view()["state_version"]
        accepted = self.action("pause", "pause-once", version)
        self.step()
        self.assertEqual(self.view()["state"], "paused")
        self.assertEqual(self.action("pause", "pause-once", version).json(), accepted.json())
        self.assertEqual(
            self.action("resume", "pause-once", version).json()["error"], "idempotency_conflict"
        )
        self.assertEqual(self.server.service.policy_calls, 1)
        self.assertEqual(
            accepted.json()["run"]["last_event_seq"], self.view()["last_event_seq"] - 2
        )

    def test_competing_commands_and_idempotent_receipt(self):
        self.start()
        version = self.view()["state_version"]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            replies = list(pool.map(lambda _: self.action(version=version), range(6)))
        self.assertEqual(sum(r.status_code == 202 for r in replies), 1)
        self.assertEqual(sum(r.status_code == 409 for r in replies), 5)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM commands WHERE route LIKE '%%/actions'"), 1
        )
        self.assertEqual(self.server.node.calls["prompt"], 1)

    def test_paused_worker_lease_expiry_keeps_control_intent(self):
        self.start()
        self.pause()
        with self.db.transaction() as conn:
            conn.execute("UPDATE jobs SET status='leased',lease_until=now()-interval '1 second'")
        Worker(self.db, self.connector).reconcile_expired()
        self.assertEqual(self.view()["state"], "pausing")
        self.step()
        self.assertEqual(self.view()["state"], "paused")
        self.assertEqual(self.server.service.resume_calls, 0)

    def test_missing_baseline_or_unproven_pause_reply_never_paused(self):
        self.start()
        row = self.server.service.journal.read(self.run["id"])
        del row["guest_baseline"]
        self.server.service.journal.write(row)
        self.action()
        self.step()
        self.assertEqual(self.view()["state"], "pausing")
        self.connector.control = lambda _: {"state": "paused", "proof": {"admission_closed": True}}
        self.step()
        self.assertEqual(self.view()["state"], "pausing")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

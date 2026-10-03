"""AT-06 decisions, one-time grants, mutation binding and uncertain replies."""

import concurrent.futures
import tempfile
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from approval_fixture import ApprovalConnector
from fastapi.testclient import TestClient
from recovery_fixture import Server
from test_control_plane import PlatformFixture

from agent_platform.api import create_app
from agent_platform.connector import Approve
from agent_platform.connector_approval import approve
from agent_platform.domain import Problem
from agent_platform.store import Store
from agent_platform.worker import Worker


class ApprovalTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.server = Server(
            self.root,
            self.project["canonical_repo"],
            self.payload["base_sha"],
            connector_type=ApprovalConnector,
        )
        self.addCleanup(self.server.close)
        self.connector = self.server.client
        self.connector.register(self.db)
        profile = self.post(
            "/agent-profiles",
            {"name": "Review every tool", "backend": "openhands", "require_approval": True},
        )
        self.assertEqual(profile.status_code, 201)
        self.payload["profile_revision"] = profile.json()["id"]
        self.threads = []
        self.addCleanup(self.stop_workers)

    def stop_workers(self):
        with self.db.transaction() as conn:
            conn.execute("UPDATE jobs SET lease_owner=NULL,lease_until=NULL,status='interrupted'")
        for thread in self.threads:
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive())

    def start_worker(self):
        worker = Worker(self.db, self.connector)
        thread = threading.Thread(target=worker.run_once, daemon=True)
        self.threads.append(thread)
        thread.start()
        return thread

    def wait_for(self, check):
        deadline = time.monotonic() + 8
        while not (result := check()):
            self.assertLess(time.monotonic(), deadline)
            time.sleep(0.02)
        return result

    def waiting(self):
        self.run = self.create()["run"]
        thread = self.start_worker()
        self.wait_for(lambda: self.scalar("SELECT state FROM runs") == "awaiting_approval")
        self.approval = self.client.get(f"/api/v1/runs/{self.run['id']}/approvals").json()["items"][
            -1
        ]
        return thread

    def decision(self, value="approve", key=None, **overrides):
        run = Store(self.db).run(self.run["id"])
        return self.post(
            f"/approvals/{self.approval['id']}/decision",
            {
                "decision": value,
                "generation": self.approval["generation"],
                "action_digest": self.approval["action_digest"],
                "expected_state_version": run["state_version"],
                **overrides,
            },
            key,
        )

    def test_waits_then_applies_exactly_once_with_audit(self):
        thread = self.waiting()
        self.assertEqual(self.server.service.accepts, 0)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(
            self.approval["normalized_action"]["actions"][0]["action"]["command"], "echo reviewed"
        )
        version = Store(self.db).run(self.run["id"])["state_version"]
        first = self.decision(key="one", expected_state_version=version)
        self.assertEqual(first.status_code, 202)
        thread.join(timeout=8)
        self.assertEqual(self.scalar("SELECT state FROM runs"), "succeeded")
        self.assertEqual(
            self.decision(key="one", expected_state_version=version).json(), first.json()
        )
        self.assertEqual(self.server.service.accepts, 1)
        self.assertEqual(self.scalar("SELECT status FROM approvals"), "applied")
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='approval.decided'"), 1
        )
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='approval.applied'"), 1
        )
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)

    def test_digest_generation_and_payload_changes_rejected(self):
        self.waiting()
        self.assertEqual(self.decision(action_digest="f" * 64).status_code, 409)
        self.assertEqual(self.decision(generation=self.approval["generation"] + 1).status_code, 409)
        version = Store(self.db).run(self.run["id"])["state_version"]
        self.assertEqual(
            self.decision(key="single", expected_state_version=version).status_code, 202
        )
        self.assertEqual(
            self.decision("deny", key="single", expected_state_version=version).json()["error"],
            "idempotency_conflict",
        )

    def test_six_competing_decisions_accept_only_one(self):
        self.waiting()
        version = Store(self.db).run(self.run["id"])["state_version"]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            replies = list(
                pool.map(lambda _: self.decision(expected_state_version=version), range(6))
            )
        self.assertEqual(sum(r.status_code == 202 for r in replies), 1)
        self.assertEqual(sum(r.status_code == 409 for r in replies), 5)
        self.wait_for(lambda: self.server.service.accepts == 1)

    def test_deny_cancels_without_executing_and_retains_capacity_until_stop(self):
        thread = self.waiting()
        self.assertEqual(self.decision("deny").status_code, 202)
        thread.join(timeout=5)
        self.assertEqual(self.scalar("SELECT state FROM runs"), "cancelling")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        Worker(self.db, self.connector).run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "cancelled")
        self.assertEqual(self.server.service.accepts, 0)
        self.assertEqual(self.scalar("SELECT status FROM approvals"), "denied")
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)

    def test_expiry_rejects_and_preserves_capacity(self):
        self.waiting()
        with self.db.transaction() as conn:
            conn.execute("UPDATE approvals SET expires_at=now()-interval '1 second'")
        self.assertEqual(self.decision().status_code, 409)
        self.wait_for(lambda: self.scalar("SELECT state FROM runs") == "interrupted")
        self.assertEqual(self.server.service.accepts, 0)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

    def test_changed_upstream_parameters_after_decision_never_execute(self):
        self.waiting()
        original = self.connector.approve

        def changed(run, approval):
            self.server.service.history[0]["action"]["command"] = "echo substituted"
            return original(run, approval)

        self.connector.approve = changed
        self.assertEqual(self.decision().status_code, 202)
        self.wait_for(lambda: self.scalar("SELECT state FROM runs") == "interrupted")
        self.assertEqual(self.server.service.accepts, 0)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

    def test_lost_ack_quarantines_and_does_not_resend(self):
        self.waiting()
        self.server.service.lose_approval = True
        self.assertEqual(self.decision().status_code, 202)
        self.wait_for(lambda: self.scalar("SELECT state FROM runs") == "interrupted")
        with self.db.transaction() as conn:
            conn.execute("UPDATE jobs SET available_at=now()")
        Worker(self.db, self.connector).run_once()
        self.assertEqual(self.server.service.accepts, 1)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        run = Store(self.db).run(self.run["id"])
        self.post(
            f"/runs/{run['id']}/actions",
            {"action": "cancel", "expected_state_version": run["state_version"]},
        )
        Worker(self.db, self.connector).run_once()
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)

    def test_recovery_requires_fresh_generation_approval_without_new_vm_or_prompt(self):
        thread = self.waiting()
        with self.db.transaction() as conn:
            conn.execute("UPDATE jobs SET lease_until=now()-interval '1 second'")
        thread.join(timeout=5)
        Worker(self.db, self.connector).reconcile_expired()
        self.start_worker()
        self.wait_for(lambda: self.scalar("SELECT count(*) FROM approvals") == 2)
        self.assertEqual(self.decision().status_code, 409)
        self.approval = self.client.get(f"/api/v1/runs/{self.run['id']}/approvals").json()["items"][
            -1
        ]
        self.assertEqual(self.decision().status_code, 202)
        self.wait_for(lambda: self.scalar("SELECT state FROM runs") == "succeeded")
        self.assertEqual(self.server.node.calls["allocate"], 1)
        self.assertEqual(self.server.node.calls["prompt"], 1)
        self.assertEqual(self.server.service.accepts, 1)

    def test_cancel_invalidates_pending_approval(self):
        self.waiting()
        run = Store(self.db).run(self.run["id"])
        self.post(
            f"/runs/{run['id']}/actions",
            {"action": "cancel", "expected_state_version": run["state_version"]},
        )
        self.assertEqual(self.decision().status_code, 409)
        Worker(self.db, self.connector).run_once()
        self.assertEqual(self.server.service.accepts, 0)

    def test_decision_auth_and_csrf(self):
        self.waiting()
        path = f"/api/v1/approvals/{self.approval['id']}/decision"
        data = {
            "decision": "approve",
            "generation": self.approval["generation"],
            "action_digest": self.approval["action_digest"],
            "expected_state_version": 1,
        }
        with TestClient(create_app(self.settings, self.db), base_url=self.settings.origin) as other:
            self.assertEqual(other.post(path, json=data).status_code, 401)
        self.assertEqual(
            self.client.post(path, json=data, headers={"Idempotency-Key": uuid4().hex}).status_code,
            403,
        )
        self.assertEqual(self.server.service.accepts, 0)

    def test_connector_rejects_expired_grant_even_after_api_acceptance(self):
        self.waiting()
        original = self.connector.approve

        def expired(run, approval):
            return original(
                run, {**approval, "expires_at": datetime.now(UTC) - timedelta(seconds=1)}
            )

        self.connector.approve = expired
        self.assertEqual(self.decision().status_code, 202)
        self.wait_for(lambda: self.scalar("SELECT state FROM runs") == "interrupted")
        self.assertEqual(self.server.service.accepts, 0)

    def test_connector_blocks_stale_generation(self):
        self.waiting()
        run = Store(self.db).run(self.run["id"])
        request = Approve(
            generation=run["generation"],
            approval_id=self.approval["id"],
            action_digest=self.approval["action_digest"],
            expires_at=datetime.now(UTC) + timedelta(seconds=60),
        )
        self.connector.fence(
            {
                **run,
                "generation": run["generation"] + 1,
                "lease_until": datetime.now(UTC) + timedelta(seconds=30),
            }
        )
        with self.assertRaises(Problem):
            approve(self.server.service, run["id"], request)
        self.assertEqual(self.server.service.accepts, 0)

    def test_completed_connector_receipt_recovers_after_worker_loses_reply(self):
        self.waiting()
        original = self.connector.approve

        def lost_after_commit(run, approval):
            original(run, approval)
            raise TimeoutError("worker lost connector reply after durable ACK")

        self.connector.approve = lost_after_commit
        self.assertEqual(self.decision().status_code, 202)
        self.wait_for(lambda: self.scalar("SELECT state FROM runs") == "interrupted")
        self.assertEqual(self.scalar("SELECT status FROM approvals"), "approved")
        with self.db.transaction() as conn:
            conn.execute("UPDATE jobs SET available_at=now()")
        Worker(self.db, self.connector).run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "succeeded")
        self.assertEqual(self.scalar("SELECT status FROM approvals"), "applied")
        self.assertEqual(self.server.service.accepts, 1)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='approval.applied'"), 1
        )

    def test_pending_batch_changes_invalidate_old_review(self):
        self.waiting()
        old = self.approval
        self.server.service.history[0]["action"]["command"] = "echo new parameters"
        self.wait_for(lambda: self.scalar("SELECT count(*) FROM approvals") == 2)
        self.assertEqual(self.decision().status_code, 409)
        self.approval = self.client.get(f"/api/v1/runs/{self.run['id']}/approvals").json()["items"][
            -1
        ]
        self.assertNotEqual(old["action_digest"], self.approval["action_digest"])
        self.assertEqual(self.decision().status_code, 202)
        self.wait_for(lambda: self.scalar("SELECT state FROM runs") == "succeeded")
        self.assertEqual(self.server.service.accepts, 1)

    def test_approval_covers_the_complete_pending_batch(self):
        self.waiting()
        self.server.service.history.append(
            {
                "id": "action-2",
                "kind": "ActionEvent",
                "tool_name": "terminal",
                "tool_call_id": "tool-2",
                "action": {"kind": "TerminalAction", "command": "echo second"},
            }
        )
        self.wait_for(lambda: self.scalar("SELECT count(*) FROM approvals") == 2)
        self.approval = self.client.get(f"/api/v1/runs/{self.run['id']}/approvals").json()["items"][
            -1
        ]
        self.assertEqual(len(self.approval["normalized_action"]["actions"]), 2)
        self.assertEqual(self.decision().status_code, 202)
        self.wait_for(lambda: self.scalar("SELECT state FROM runs") == "succeeded")
        self.assertEqual(self.server.service.executed, ["action-1", "action-2"])
        self.assertEqual(self.server.service.accepts, 1)

    def test_sensitive_action_is_not_exposed_in_review(self):
        self.waiting()
        self.server.service.history[0]["action"]["command"] = "session-canary-secret"
        self.wait_for(lambda: self.scalar("SELECT state FROM runs") == "interrupted")
        reviews = self.client.get(f"/api/v1/runs/{self.run['id']}/approvals").text
        self.assertNotIn("session-canary-secret", reviews)
        self.assertEqual(self.server.service.accepts, 0)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

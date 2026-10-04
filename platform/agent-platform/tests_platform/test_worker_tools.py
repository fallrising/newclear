"""Normal Worker tool lifecycle, with real SQL and local HTTP boundary doubles."""

import json
import os
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from test_control_plane import PlatformFixture
from worker_tools_fixture import Runtime, Upstream

from agent_platform.domain import Problem
from agent_platform.store import event
from agent_platform.tool_worker import read_policy
from agent_platform.worker import Worker


class WorkerToolsTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        with self.db.transaction() as conn:
            conn.execute("TRUNCATE tool_broker_services CASCADE")
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.runtime = Runtime(self.project["canonical_repo"], self.payload["base_sha"])
        self.upstream = Upstream()
        self.addCleanup(self.runtime.close)
        self.addCleanup(self.upstream.close)
        self.runtime.client.register(self.db)
        self.secret_file = self.root / "secret"
        self.secret_file.write_text(self.upstream.secret)
        self.secret_file.chmod(0o600)
        self.config = {
            "service_id": str(uuid4()),
            "credential_revision": str(uuid4()),
            "origin": self.upstream.origin,
            "credential_origin": self.upstream.origin,
            "credential_path_prefix": "/repos/fallrising/newclear",
            "secret_file": str(self.secret_file),
            "repository_id": 123,
            "owner": "fallrising",
            "repository": "newclear",
            "commit": self.payload["base_sha"],
            "paths": ["README.md"],
            "issues": [1],
            "operations": ["github.repository.get"],
            "request_limit": 10,
            "in_flight_limit": 1,
            "total_timeout": 2,
            "idle_timeout": 1,
        }
        self.config_file = self.root / "config.json"
        self.write_config()
        self.enterContext(
            patch.dict(os.environ, {"TOOL_BROKER_MOCK_CONFIG": str(self.config_file)})
        )
        self.enterContext(patch.dict(os.environ, {"MODEL_PROXY_CONFIG": ""}))

    def write_config(self):
        self.config_file.write_text(json.dumps(self.config))
        self.config_file.chmod(0o600)

    def profile_tools(self, enabled=True, **extra):
        response = self.post(
            "/agent-profiles",
            {"name": "Worker tools", "backend": "openhands", "mock_tools": enabled, **extra},
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.payload["profile_revision"] = response.json()["id"]
        return response.json()

    def execute(self):
        value = self.create()
        self.assertTrue(Worker(self.db, self.runtime.client).run_once())
        return self.client.get(f"/api/v1/runs/{value['run']['id']}").json()

    def assert_clean_failure(self, run):
        self.assertEqual(run["state"], "failed", run)
        self.assertIsNone(run["result"])
        self.assertEqual(run["cleanup_state"], "confirmed")
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 0
        )

    def test_enabled_normal_worker_acknowledges_before_result_and_closes(self):
        self.profile_tools()
        self.runtime.on_ack = lambda: self.assertEqual(
            self.scalar("SELECT delivery FROM tool_broker_operations"), "acknowledged"
        )
        run = self.execute()
        self.assertEqual(run["state"], "succeeded", run)
        self.assertTrue(self.runtime.allocations[0]["tool_transport"])
        self.assertEqual(self.scalar("SELECT delivery FROM tool_broker_operations"), "acknowledged")
        self.assertTrue(self.scalar("SELECT revoked_at IS NOT NULL FROM tool_broker_runs"))
        self.assertEqual(len(self.upstream.calls), 1)
        self.assertEqual(self.runtime.actions("/tool").count("deliver"), 1)
        self.assertEqual(self.runtime.actions("/tool").count("ack"), 1)
        self.assertIn("close", self.runtime.actions("/tool"))
        self.assertEqual(
            self.runtime.actions("/operations"), ["prepare", "prompt", "result", "release"]
        )
        self.assertNotIn(self.upstream.secret, json.dumps(self.runtime.calls))

    def test_immutable_profile_and_shared_client_do_not_enable_older_run(self):
        old = self.profile_tools(False)
        self.profile_tools(True, profile_id=old["profile_id"])
        self.assertEqual(self.execute()["state"], "succeeded")
        self.payload["profile_revision"] = old["id"]
        self.assertEqual(self.execute()["state"], "succeeded")
        self.assertEqual([a["tool_transport"] for a in self.runtime.allocations], [True, False])
        self.assertEqual(len(self.upstream.calls), 1)

    def test_fake_backend_rejects_enablement(self):
        response = self.post("/agent-profiles", {"name": "fake", "mock_tools": True})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "unsupported_capability:mock_tools")

    def test_uncertain_delivery_fails_and_never_fetches_successful_result(self):
        self.profile_tools()
        self.runtime.fail_action = "deliver"
        self.assert_clean_failure(self.execute())
        self.assertEqual(self.runtime.actions("/tool").count("deliver"), 1)
        self.assertNotIn("result", self.runtime.actions("/operations"))
        self.assertNotIn("ack", self.runtime.actions("/tool"))

    def test_incomplete_stop_retains_reservation_on_tool_failure(self):
        self.profile_tools()
        self.runtime.fail_action = "deliver"
        self.runtime.complete_stop = False
        run = self.execute()
        self.assertEqual(run["state"], "interrupted", run)
        self.assertEqual(run["cleanup_state"], "unknown")
        self.assertIsNone(run["result"])
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 1
        )

    def test_omitted_flag_ignores_missing_config(self):
        response = self.post("/agent-profiles", {"name": "default", "backend": "openhands"})
        self.payload["profile_revision"] = response.json()["id"]
        self.config_file.unlink()
        run = self.execute()
        self.assertEqual(run["state"], "succeeded", run)
        self.assertFalse(self.runtime.allocations[0]["tool_transport"])
        self.assertEqual(self.runtime.actions("/tool"), [])
        self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_runs"), 0)

    def test_enablement_requires_actual_boolean(self):
        for value in ("true", 1, "false", None):
            with self.subTest(value=value):
                response = self.post(
                    "/agent-profiles",
                    {"name": "invalid", "backend": "openhands", "mock_tools": value},
                )
                self.assertEqual(response.status_code, 422)

    def test_missing_config_quarantines_before_allocation(self):
        self.profile_tools()
        with patch.dict(os.environ, {"TOOL_BROKER_MOCK_CONFIG": ""}):
            run = self.execute()
        self.assertEqual(run["state"], "interrupted", run)
        self.assertEqual(run["reason"], "tool_mock_config_missing")
        self.assertEqual(self.runtime.allocations, [])
        self.assertEqual(self.upstream.calls, [])
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 1
        )

    def test_invalid_config_is_sanitized_before_allocation(self):
        self.profile_tools()
        self.config["origin"] = "https://github.com/private-secret"
        self.write_config()
        run = self.execute()
        self.assertEqual(run["reason"], "tool_mock_config_invalid", run)
        self.assertEqual(self.runtime.allocations, [])
        self.assertNotIn("private-secret", json.dumps(run))
        self.assertNotIn(self.upstream.secret, json.dumps(run))

    def test_hardlinked_secret_never_allocates_or_dispatches(self):
        self.profile_tools()
        os.link(self.secret_file, self.root / "secret-alias")
        run = self.execute()
        self.assertEqual(run["reason"], "tool_mock_config_invalid")
        self.assertEqual(self.runtime.allocations, [])
        self.assertEqual(self.upstream.calls, [])
        self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_runs"), 0)
        self.assertNotIn(self.upstream.secret, json.dumps(run))
        self.assertNotIn(str(self.secret_file), json.dumps(run))

    def test_repository_and_commit_mismatch_fail_before_provisioning(self):
        self.profile_tools()
        for key, value in (("commit", "a" * 40), ("owner", "other")):
            with self.subTest(key=key):
                old = self.config.copy()
                self.config[key] = value
                self.config["credential_path_prefix"] = f"/repos/{self.config['owner']}/newclear"
                self.write_config()
                run = self.execute()
                self.assertEqual(run["reason"], "tool_mock_scope_mismatch", run)
                self.config = old
        self.assertEqual(self.runtime.allocations, [])
        self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_runs"), 0)

    def test_finished_sdk_drains_operation_still_in_flight(self):
        self.profile_tools()
        self.runtime.on_events = lambda: {"state": "finished", "caught_up": True, "events": []}
        entered, release = threading.Event(), threading.Event()

        def upstream():
            entered.set()
            self.assertTrue(release.wait(2))

        self.upstream.on_request = upstream

        def release_in_flight():
            if entered.is_set() and not release.is_set():
                self.assertNotIn("result", self.runtime.actions("/operations"))
                self.assertEqual(
                    self.scalar("SELECT status FROM tool_broker_operations"), "admitted"
                )
                release.set()

        self.runtime.on_poll = release_in_flight
        run = self.execute()
        self.assertTrue(entered.is_set())
        self.assertEqual(run["state"], "succeeded", run)
        self.assertEqual(self.scalar("SELECT delivery FROM tool_broker_operations"), "acknowledged")
        self.assertEqual(
            self.scalar("SELECT count(*) FROM run_events WHERE type='tool.session_drained'"), 1
        )

    def test_operator_cancel_suppresses_late_delivery_and_old_owner_cleanup(self):
        self.profile_tools()
        value = self.create()
        run_id = value["run"]["id"]

        def cancel():
            current = self.client.get(f"/api/v1/runs/{run_id}").json()
            response = self.post(
                f"/runs/{run_id}/actions",
                {"action": "cancel", "expected_state_version": current["state_version"]},
            )
            self.assertEqual(response.status_code, 202, response.text)

        self.upstream.on_request = cancel
        Worker(self.db, self.runtime.client).run_once()
        run = self.client.get(f"/api/v1/runs/{run_id}").json()
        self.assertEqual(run["state"], "cancelling", run)
        self.assertIsNone(run["result"])
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 1
        )
        self.assertNotIn("deliver", self.runtime.actions("/tool"))
        self.assertFalse(any(path.endswith("/cancel") for _, path, _ in self.runtime.calls))
        Worker(self.db, self.runtime.client).run_once()
        run = self.client.get(f"/api/v1/runs/{run_id}").json()
        self.assertEqual(run["state"], "cancelled", run)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 0
        )
        self.assertEqual(len(self.upstream.calls), 1)

    def test_waiting_approval_does_not_pump_tools(self):
        self.profile_tools(require_approval=True)
        value = self.create()
        run_id = value["run"]["id"]
        polls = []

        def events():
            current = self.client.get(f"/api/v1/runs/{run_id}").json()
            polls.append(current["state"])
            if len(polls) == 2:
                self.assertEqual(current["state"], "awaiting_approval")
                self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_operations"), 0)
                self.assertEqual(self.runtime.actions("/tool").count("poll"), 1)
                response = self.post(
                    f"/runs/{run_id}/actions",
                    {"action": "cancel", "expected_state_version": current["state_version"]},
                )
                self.assertEqual(response.status_code, 202, response.text)
            return {
                "state": "waiting_for_confirmation",
                "caught_up": True,
                "events": [],
                "approval": {
                    "normalized_action": {"generation": current["generation"], "run_id": run_id},
                    "action_digest": "a" * 64,
                    "policy_revision": "fixture",
                },
            }

        self.runtime.on_events = events
        Worker(self.db, self.runtime.client).run_once()
        self.assertEqual(polls, ["running", "awaiting_approval"])
        self.assertEqual(self.upstream.calls, [])

    def test_recovery_never_recreates_grant_or_replays_pending_operation(self):
        self.profile_tools()
        self.runtime.fail_action = "deliver"
        self.runtime.complete_stop = False
        run = self.execute()
        self.assertEqual(run["state"], "interrupted", run)
        self.runtime.phase = "running"
        before = self.runtime.actions("/tool").copy()
        with self.db.transaction() as conn:
            conn.execute("UPDATE jobs SET available_at=clock_timestamp()")
        self.runtime.complete_stop = True
        Worker(self.db, self.runtime.client).run_once()
        current = self.client.get(f"/api/v1/runs/{run['id']}").json()
        self.assert_clean_failure(current)
        self.assertEqual(current["reason"], "tool_recovery_unconfirmed")
        self.assertEqual(self.runtime.actions("/tool"), before)
        self.assertEqual(self.scalar("SELECT generation FROM tool_broker_runs"), 1)
        self.assertEqual(len(self.runtime.allocations), 1)
        self.assertEqual(len(self.upstream.calls), 1)

    def test_private_mock_config_schema_and_secret_files_are_strict(self):
        policy = read_policy(self.config_file)
        self.assertEqual(policy.secret, self.upstream.secret)
        self.assertNotIn(self.upstream.secret, repr(policy))
        invalid = [
            {**self.config, "unexpected": self.upstream.secret},
            {**self.config, "paths": "README.md"},
            {**self.config, "service_id": "bad-private-value"},
            {**self.config, "request_limit": True},
            {**self.config, "origin": "https://api.github.com"},
            {**self.config, "secret_file": 123},
        ]
        for config in invalid:
            self.config_file.write_text(json.dumps(config))
            with self.assertRaisesRegex(Problem, "^tool_mock_config_invalid$"):
                read_policy(self.config_file)
        self.write_config()
        for file in (self.config_file, self.secret_file):
            file.chmod(0o644)
            with self.assertRaisesRegex(Problem, "^tool_mock_config_invalid$"):
                read_policy(self.config_file)
            file.chmod(0o600)
        self.config_file.write_text('{"service_id": "one", "service_id": "two"}')
        with self.assertRaisesRegex(Problem, "^tool_mock_config_invalid$"):
            read_policy(self.config_file)
        self.config_file.write_text("[" * 2000)
        with self.assertRaisesRegex(Problem, "^tool_mock_config_invalid$"):
            read_policy(self.config_file)

    def assert_completed_recovery(self, phase):
        self.profile_tools()
        self.runtime.unconfirmed_cleanup = True
        run = self.execute()
        self.assertEqual(run["state"], "succeeded", run)
        self.assertEqual(run["cleanup_state"], "unknown")
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 1
        )
        self.runtime.phase = phase
        self.runtime.unconfirmed_cleanup = False
        before = self.runtime.actions("/tool").copy()
        with self.db.transaction() as conn:
            conn.execute("UPDATE jobs SET available_at=clock_timestamp()")
        self.config_file.unlink()
        Worker(self.db, self.runtime.client).run_once()
        current = self.client.get(f"/api/v1/runs/{run['id']}").json()
        self.assertEqual(current["state"], "succeeded", current)
        self.assertEqual(current["result"], run["result"])
        self.assertEqual(current["cleanup_state"], "confirmed")
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 0
        )
        self.assertEqual(self.runtime.actions("/tool"), before)
        self.assertEqual(self.runtime.actions("/operations").count("prompt"), 1)
        self.assertEqual(self.scalar("SELECT generation FROM tool_broker_runs"), 1)
        self.assertEqual(len(self.upstream.calls), 1)

    def test_completed_result_recovery_uses_durable_drain_without_rebind(self):
        self.assert_completed_recovery("result")

    def test_stopped_recovery_preserves_confirmed_tool_result(self):
        self.assert_completed_recovery("stopped")

    def test_lost_ack_reply_cannot_become_success_during_recovery(self):
        self.profile_tools()
        self.runtime.fail_action = "ack"
        self.runtime.complete_stop = False
        run = self.execute()
        self.assertEqual(run["state"], "interrupted", run)
        self.assertEqual(self.scalar("SELECT delivery FROM tool_broker_operations"), "acknowledged")
        self.assertEqual(
            self.scalar("SELECT count(*) FROM run_events WHERE type='tool.session_drained'"), 0
        )
        self.runtime.complete_stop = True
        self.runtime.phase = "result"
        with self.db.transaction() as conn:
            event(
                conn,
                run["id"],
                "tool.session_drained",
                {},
                source="openhands",
                source_id="tools-drained",
            )
            event(
                conn, run["id"], "tool.session_drained", {}, source="platform", source_id="forged"
            )
            conn.execute("UPDATE jobs SET available_at=clock_timestamp()")
        Worker(self.db, self.runtime.client).run_once()
        current = self.client.get(f"/api/v1/runs/{run['id']}").json()
        self.assert_clean_failure(current)
        self.assertEqual(current["reason"], "tool_recovery_unconfirmed")
        self.assertEqual(self.runtime.actions("/tool").count("deliver"), 1)
        self.assertEqual(self.runtime.actions("/tool").count("ack"), 1)
        self.assertEqual(len(self.upstream.calls), 1)

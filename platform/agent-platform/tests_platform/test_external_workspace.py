"""External workspace contract: real HTTP/journal, synthetic VM explicitly marked."""

import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

from fastapi.testclient import TestClient

from agent_platform.connector import Connector, create_connector
from agent_platform.connector_fence import Fences, Lease
from agent_platform.connector_journal import Journal
from agent_platform.connector_workspace import WorkspaceOperation


class WorkspaceFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.run = uuid4()
        self.service = service = Connector.__new__(Connector)
        service.journal = Journal(Path(temporary.name) / "journal")
        service.fences = Fences(Path(temporary.name) / "fences")
        service.token = "synthetic-connector-canary-1234567890"
        service.client = SimpleNamespace(api_token="synthetic-node-canary")
        service.config = {"external_workspace_enabled": True}
        service.network = Mock()
        service.isolation = Mock()
        self.guest = Mock()
        self.guest.exec.return_value = json.dumps({"ok": True, "content": "hello"})
        service.handle = Mock(return_value=self.guest)
        self.row = {
            "run_id": str(self.run),
            "generation": 1,
            "input": {
                "external_workspace": True,
                "generation": 1,
                "deadline": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
            },
            "operations": {"allocate": {"state": "completed"}, "prepare": {"state": "completed"}},
        }
        service.journal.write(self.row)
        service.fences.grant(
            self.run, Lease(generation=1, lease_until=datetime.now(UTC) + timedelta(seconds=30))
        )
        self.client = TestClient(create_connector({}, service))
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.headers = {"X-Session-API-Key": service.token}
        self.payload = {
            "generation": 1,
            "operation_id": str(uuid4()),
            "action": "read",
            "path": "README.md",
        }

    def call(self, **changes):
        return self.client.post(
            f"/v1/runs/{self.run}/workspace", json={**self.payload, **changes}, headers=self.headers
        )


class ExternalWorkspaceTests(WorkspaceFixture):
    def test_EX01_http_once_only_replay_and_fingerprint_conflict(self):
        first = self.call()
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json(), {"ok": True, "content": "hello"})
        self.assertEqual(self.call().json(), first.json())
        self.assertEqual(self.guest.exec.call_count, 1)
        conflict = self.call(path="other.txt")
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["error"], "connector_operation_conflict")
        self.assertEqual(self.guest.exec.call_count, 1)

    def test_EX01_uncertain_tool_blocks_replay_and_new_tools(self):
        self.guest.exec.side_effect = TimeoutError()
        self.assertEqual(self.call().status_code, 503)
        self.assertEqual(self.call().json()["error"], "connector_operation_uncertain")
        self.assertEqual(
            self.call(operation_id=str(uuid4())).json()["error"], "connector_operation_uncertain"
        )
        self.assertEqual(self.guest.exec.call_count, 1)

    def test_EX01_generation_deadline_and_closed_admission(self):
        self.assertEqual(self.call(generation=2).status_code, 409)
        for change in (
            {"cancel_requested": True},
            {"operations": {"result": {"state": "started"}}},
            {"input": {**self.row["input"], "external_workspace": False}},
            {"input": {**self.row["input"], "deadline": "2000-01-01T00:00:00Z"}},
        ):
            with self.subTest(change=change):
                self.service.journal.write({**self.row, **change})
                self.assertEqual(self.call().status_code, 409)
        self.guest.exec.assert_not_called()

    def test_EX01_path_and_command_bounds_are_rejected_before_guest(self):
        for change in (
            {"path": "../outside"},
            {"path": "/etc/shadow"},
            {"path": "a/../b"},
            {"action": "write", "content": "x" * 32769},
            {"action": "exec", "argv": []},
            {"action": "exec", "argv": ["echo"], "timeout_seconds": 61},
            {"action": "exec", "argv": ["echo"], "env": {"SECRET": "x"}},
        ):
            with self.subTest(change=change):
                self.assertEqual(self.call(**change).status_code, 422)
        self.guest.exec.assert_not_called()

    def test_EX01_schema_rejects_caller_cwd(self):
        # The schema is strict even before execution; no caller-supplied cwd/env.
        with self.assertRaises(ValueError):
            WorkspaceOperation(
                generation=1, operation_id=uuid4(), action="exec", argv=["echo"], cwd="/"
            )


class ExternalGuestHelperTests(unittest.TestCase):
    """Real local filesystem/subprocess checks, not a claim of VM isolation."""

    def setUp(self):
        from unittest.mock import patch

        from agent_platform import guest_external

        self.helper = guest_external
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "workspace"
        self.root.mkdir()
        patcher = patch.object(guest_external, "ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_EX01_file_content_is_byte_exact_and_symlink_fifo_hardlink_refused(self):
        import os

        content = "  def f():\n    return '中文'\n\n"
        request = WorkspaceOperation(
            generation=1, operation_id=uuid4(), action="write", path="code.py", content=content
        )
        self.assertEqual(request.content, content)
        self.assertEqual(
            self.helper.file_operation(request.model_dump()),
            {"ok": True, "bytes": len(content.encode())},
        )
        self.assertEqual(
            self.helper.file_operation({"action": "read", "path": "code.py"}),
            {"ok": True, "content": content},
        )
        target = self.root.parent / "outside"
        target.write_text("synthetic-canary")
        (self.root / "link").symlink_to(target)
        (self.root / "directory").symlink_to(self.root.parent, target_is_directory=True)
        os.link(target, self.root / "hardlink")
        os.mkfifo(self.root / "fifo")
        for path in ("link", "directory/outside", "hardlink", "fifo", "../outside"):
            for action in ("read", "write"):
                with (
                    self.subTest(path=path, action=action),
                    self.assertRaises((OSError, ValueError)),
                ):
                    self.helper.file_operation({"action": action, "path": path, "content": "bad"})
        self.assertEqual(target.read_text(), "synthetic-canary")

    def test_EX01_actual_command_is_bounded_and_does_not_inherit_environment(self):
        import os
        import sys
        from unittest.mock import patch

        code = (
            "import os; print(os.environ.get('EXTERNAL_TEST_CANARY','absent')); "
            "print(repr(__import__('sys').argv[1]))"
        )
        with patch.dict(os.environ, {"EXTERNAL_TEST_CANARY": "synthetic-secret"}):
            value = self.helper.command(
                {"argv": [sys.executable, "-c", code, "  exact  "], "timeout_seconds": 2}
            )
        self.assertEqual(value["status"], "completed")
        self.assertEqual(value["exit_code"], 0)
        self.assertEqual(value["output"], "absent\n'  exact  '\n")
        timed = self.helper.command(
            {"argv": [sys.executable, "-c", "import time; time.sleep(10)"], "timeout_seconds": 1}
        )
        self.assertEqual(timed["status"], "timeout")
        self.assertLess(timed["exit_code"], 0)
        large = self.helper.command(
            {"argv": [sys.executable, "-c", "print('x'*100000)"], "timeout_seconds": 2}
        )
        self.assertEqual(large["status"], "output_limit")
        self.assertEqual(len(large["output"]), self.helper.LIMIT)


class ExternalLifecycleTests(WorkspaceFixture):
    def test_EX01_prepare_installs_only_trusted_helpers_without_openhands(self):
        self.service.entries = {("repo", "a" * 40): {}}
        self.service.bundle = Mock(return_value=b"synthetic-bundle")
        row = {
            **self.row,
            "input": {**self.row["input"], "canonical_repo": "repo", "base_sha": "a" * 40},
        }
        self.guest.exec.return_value = json.dumps({"base_sha": "a" * 40})
        prepared = self.service.prepare(row)
        self.assertTrue(prepared["external_workspace"])
        self.guest.spawn.assert_not_called()
        installed = [c.args[0] for c in self.guest.write_file.call_args_list]
        self.assertIn("/opt/agent-platform/guest_external.py", installed)
        self.assertIn("/opt/agent-platform/source.bundle", installed)
        self.assertNotIn("/tmp/source.bundle", installed)
        self.assertFalse(any("model" in p or "fixture" in p or "terminal" in p for p in installed))
        self.assertEqual(row["external_isolation_revision"], "external-workspace-v1")
        self.assertEqual(
            self.guest.exec.call_args.args[:3],
            ("python3", "-I", "/opt/agent-platform/guest_external.py"),
        )
        self.service.isolation.assert_called_once_with(row)

    def test_EX01_finalization_closes_tools_and_needs_no_prompt(self):
        from agent_platform.connector import Mutation

        self.service.result = Mock(return_value={"diff": "fixed patch"})
        value = self.service.mutate(self.run, Mutation(generation=1, action="result"))
        self.assertEqual(value, {"diff": "fixed patch"})
        self.assertEqual(self.call().json()["error"], "workspace_admission_closed")
        self.assertEqual(
            self.service.mutate(self.run, Mutation(generation=1, action="result")), value
        )
        self.service.result.assert_called_once()

    def test_EX01_cancel_and_inspect_never_contact_openhands(self):
        from unittest.mock import patch

        row = self.service.journal.read(self.run)
        row["operations"]["allocate"]["result"] = {"handle": "owned"}
        row["operations"]["prepare"]["result"] = {"ref": str(self.run)}
        self.service.journal.write(row)
        self.service.relay = Mock(side_effect=AssertionError("no OpenHands"))
        with patch("agent_platform.connector_recovery.observe_sandbox", return_value=None):
            self.assertEqual(self.service.inspect(self.run, 1)["phase"], "prepared")
        proof = {"observed_state": "stopped", "proof": {"owned_fixture": True}}
        self.service.release = Mock(return_value=proof)
        with patch("agent_platform.connector_cancel.observe_sandbox", return_value=None):
            self.assertEqual(self.service.cancel(self.run, 1), proof)
        self.service.relay.assert_not_called()
        self.service.release.assert_called_once()
        self.assertTrue(self.service.journal.read(self.run)["cancel_requested"])

    def test_EX01_expired_lease_and_missing_preparation_refuse_guest(self):
        fence = self.service.fences.journal.read(self.run)
        fence["lease_until"] = "2000-01-01T00:00:00Z"
        self.service.fences.journal.write(fence)
        self.assertEqual(self.call().json()["error"], "connector_lease_expired")
        self.service.fences.grant(
            self.run, Lease(generation=1, lease_until=datetime.now(UTC) + timedelta(seconds=30))
        )
        row = {**self.row, "operations": {"allocate": {"state": "completed"}}}
        self.service.journal.write(row)
        self.assertEqual(self.call().json()["error"], "connector_prerequisite_unconfirmed")
        self.guest.exec.assert_not_called()

    def test_EX01_restart_replays_durable_receipt_without_guest(self):
        first = self.call()
        self.assertEqual(first.status_code, 200)
        directory = self.service.journal.root
        self.service.journal.close()
        self.service.journal = Journal(directory)
        self.guest.exec.reset_mock()
        self.assertEqual(self.call().json(), first.json())
        self.guest.exec.assert_not_called()

    def test_EX01_unknown_or_secret_result_never_becomes_a_receipt(self):
        self.guest.exec.return_value = json.dumps({"ok": True, "content": self.service.token})
        self.assertEqual(self.call().json()["error"], "backend_sensitive_result")
        self.assertEqual(self.call().json()["error"], "connector_operation_uncertain")
        self.assertNotIn(
            self.service.token,
            self.service.journal.read(self.run)["operations"][
                "workspace:" + self.payload["operation_id"]
            ],
        )

    def test_EX01_explicit_opt_in_transport_and_verification_gates(self):
        from agent_platform.connector import Allocate
        from agent_platform.domain import Problem

        request = Allocate(
            generation=1,
            external_workspace=True,
            template="pinned",
            canonical_repo="repo",
            base_sha="a" * 40,
            egress_policy_sha256="b" * 64,
            deadline=datetime.now(UTC) + timedelta(minutes=5),
        )
        self.service.config["external_workspace_enabled"] = False
        with self.assertRaisesRegex(Problem, "external_workspace_not_enabled"):
            self.service.allocate(self.run, request)
        self.service.config["external_workspace_enabled"] = True
        with self.assertRaisesRegex(Problem, "external_workspace_transport_conflict"):
            self.service.allocate(self.run, request.model_copy(update={"model_transport": True}))
        from agent_platform.verification import VerificationPolicy

        with self.assertRaisesRegex(Problem, "external_workspace_requires_verification_policy"):
            self.service.allocate(
                self.run,
                request.model_copy(update={"verification": VerificationPolicy(mode="fixture-m2")}),
            )
        self.guest.exec.assert_not_called()

    def test_EX01_ambiguous_wire_and_browser_credentials_refused(self):
        path = f"/v1/runs/{self.run}/workspace"
        duplicate = json.dumps(self.payload)[:-1] + ',"action":"write"}'
        response = self.client.post(
            path, content=duplicate, headers={**self.headers, "Content-Type": "application/json"}
        )
        self.assertEqual(response.status_code, 422)
        for extra in ({"Cookie": "session=synthetic"}, {"Origin": "https://operator.invalid"}):
            response = self.client.post(path, json=self.payload, headers={**self.headers, **extra})
            self.assertIn(response.status_code, (403, 422))
        self.guest.exec.assert_not_called()

    def test_EX01_receipt_budget_prevents_unbounded_private_journal(self):
        row = self.service.journal.read(self.run)
        row["operations"]["workspace:" + str(uuid4())] = {
            "state": "completed",
            "result": {"output": "x" * (4 * 1024 * 1024)},
        }
        self.service.journal.write(row)
        self.assertEqual(self.call().json()["error"], "workspace_receipt_limit")
        self.guest.exec.assert_not_called()

    def test_EX01_catalog_honors_one_vm_capacity(self):
        self.service.config.update(max_claims=1, template="pinned")
        self.service.entries = {}
        self.service.network.return_value = {"policy_sha256": "a" * 64}
        catalog = self.service.catalog()
        self.assertEqual(
            (catalog["slots"], catalog["cpu"], catalog["memory_bytes"]), (1, 4, 4 * 1024**3)
        )


if __name__ == "__main__":
    unittest.main()

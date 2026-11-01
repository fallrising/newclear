"""Synthetic adapter/controller boundaries; these are not live provider evidence."""
import hashlib
import json
import os
from pathlib import Path
import sys
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from agent_workforce.native import NativeError, NativeProfile, NativeRunner, NativeBackend, configuration_digest
from agent_workforce.native_process import ProcessError, ProcessSupervisor
from agent_workforce.controller import Controller
from agent_workforce.store import Store
from support import records, grant, request


class StubProcess:
    def __init__(self, root, raw=None):
        self.root = Path(root)
        self.calls = []
        self.value = None
        self.before_execute = None
        self.raw = raw or (b'{"type":"thread.started","thread_id":"thread-example"}\n'
                          b'{"type":"item.completed","item":{"type":"agent_message","text":"result"}}\n'
                          b'{"type":"turn.completed","usage":{"input_tokens":2}}\n')

    def execute(self, operation_id, argv, cwd, **kwargs):
        if self.before_execute:
            self.before_execute(operation_id)
        self.calls.append((operation_id, argv, cwd, kwargs))
        output = self.root / "stdout"
        output.write_bytes(self.raw)
        self.value = dict(operation_id=operation_id, status="exited", stopped=True,
                          effects_resolved=False, exit_code=0, timed_out=False,
                          output_limited=False, stdout_path=str(output),
                          stderr_path=str(self.root / "stderr"), ownership={"synthetic": True},
                          binding=kwargs["binding"])
        return dict(self.value)

    def inspect(self, operation_id):
        return dict(self.value or dict(operation_id=operation_id, status="unknown", stopped=False))

    def stop(self, operation_id):
        return self.inspect(operation_id)


class NativeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get("AGENT_BUILD_DIR"))
        self.root = Path(self.temp.name)
        self.binary = str(Path(sys.executable).resolve())
        self.digest = hashlib.sha256(Path(self.binary).read_bytes()).hexdigest()

    def tearDown(self):
        self.temp.cleanup()

    def profile(self, **updates):
        values = dict(provider="codex", binary=self.binary, binary_sha256=self.digest,
                      model="fake-model", role="writer", harness_version="1",
                      config_digest=configuration_digest(updates.get("provider", "codex"), str(self.root)),
                      account_ref="account-a", route_id="route-a",
                      route_revision=1, profile_revision=1, workspace=str(self.root),
                      workspace_binding_key="workspace-physical-a", timeout_seconds=10,
                      resume_verified=False)
        values.update(updates)
        return NativeProfile(**values)

    def binding(self):
        return dict(worker_id="worker-a", job_id="job-example", session_binding_id="session-a",
                    session_binding_key="session-physical-a", input_revision=1, ac_revision=1)

    def runner(self, raw=None):
        process = StubProcess(self.root, raw)
        return NativeRunner(self.root / "native", supervisor=process), process

    def test_profile_builders_are_explicit_and_preserve_denials(self):
        profile = self.profile()
        argv = profile.command("bounded prompt", self.root / "result")
        self.assertIn("--ignore-user-config", argv)
        self.assertIn("never", argv)
        self.assertIn("workspace-write", argv)
        self.assertNotIn("--ephemeral", argv)
        self.assertNotIn("--last", argv)
        reviewer = self.profile(provider="claude", role="reviewer")
        argv = reviewer.command("bounded review", self.root / "result", session_id="00000000-0000-4000-8000-000000000001")
        self.assertIn("dontAsk", argv)
        self.assertIn("project,local", argv)
        self.assertIn("Read,Glob,Grep", argv)
        self.assertIn("Edit,Write,Bash,Agent,Task,mcp__*", argv)
        self.assertNotIn("--no-session-persistence", argv)
        self.assertNotIn("--dangerously-skip-permissions", argv)

    def test_profile_invalid_role_model_and_changed_binary_rejected(self):
        for changes in [dict(provider="claude", role="writer"), dict(model="--bypass"),
                        dict(binary_sha256="b" * 64), dict(timeout_seconds=True)]:
            with self.subTest(changes=changes), self.assertRaises(NativeError):
                self.profile(**changes)

    def test_operation_once_session_persists_and_effects_need_trusted_proof(self):
        runner, process = self.runner()
        result = runner.run("op-example", self.profile(), "prompt", self.binding())
        self.assertEqual(result["status"], "complete")
        self.assertTrue(result["stopped"])
        self.assertFalse(result["effects_resolved"])
        self.assertEqual(result["result"]["native"]["session_id"], "thread-example")
        again = runner.run("op-example", self.profile(), "prompt", self.binding())
        self.assertEqual(again, result)
        self.assertEqual(len(process.calls), 1)
        reopened = NativeRunner(self.root / "native", supervisor=process)
        self.assertEqual(reopened.inspect("op-example")["result"], result["result"])
        with self.assertRaises(NativeError):
            reopened.attest_effects("op-example", "")
        resolved = reopened.attest_effects("op-example", "trusted-evidence-example")
        self.assertTrue(resolved["effects_resolved"])
        with self.assertRaises(NativeError):
            runner.run("op-example", self.profile(), "changed", self.binding())
        self.assertEqual(len(process.calls), 1)

    def test_unknown_denial_output_limit_and_nonzero_exit_never_complete(self):
        runner, process = self.runner(b'{"type":"thread.started","thread_id":"x"}\n')
        value = runner.run("unknown", self.profile(), "prompt", self.binding())
        self.assertEqual(value["status"], "unknown")
        self.assertFalse(value["effects_resolved"])
        runner.run("unknown", self.profile(), "prompt", self.binding())
        self.assertEqual(len(process.calls), 1)
        runner2, process2 = self.runner(b'{"type":"thread.started","thread_id":"y"}\n{"type":"turn.failed","error":{"message":"denied"}}\n')
        failed = runner2.run("failed", self.profile(), "prompt", dict(self.binding(), session_binding_key="another-session"))
        self.assertEqual(failed["status"], "failed")

    def test_unverified_resume_and_unknown_reconstruction_rejected_before_spawn(self):
        runner, process = self.runner()
        runner.run("first", self.profile(), "prompt", self.binding())
        with self.assertRaises(NativeError):
            runner.run("resume", self.profile(), "prompt", self.binding(), resume_from="first")
        with self.assertRaises(NativeError):
            runner.run("fresh", self.profile(), "prompt", dict(self.binding(), session_binding_key="new"), reconstruct_from="first")
        self.assertEqual(len(process.calls), 1)

    def test_policy_drift_rejected_before_process(self):
        profile = self.profile()
        (self.root / ".codex").mkdir()
        (self.root / ".codex/config.toml").write_text('model="changed"')
        with self.assertRaises(NativeError):
            profile.command("prompt", self.root / "result")

    def test_intent_gap_reopen_never_spawns_and_mismatched_receipt_is_unknown(self):
        runner, process = self.runner()
        with patch.object(NativeProfile, "command", side_effect=RuntimeError("receipt gap")):
            with self.assertRaises(RuntimeError):
                runner.run("gap", self.profile(), "prompt", self.binding())
        reopened = NativeRunner(self.root / "native", supervisor=process)
        self.assertEqual(reopened.run("gap", self.profile(), "prompt", self.binding())["status"], "unknown")
        self.assertEqual(process.calls, [])

    def test_real_supervisor_wrong_binding_cannot_supply_result_or_receive_stop(self):
        process = ProcessSupervisor(self.root / "owned-processes")
        raw = StubProcess(self.root).raw.decode()
        process.execute("same-operation", [self.binary, "-c", "print(" + repr(raw) + ",end='')"],
                        str(self.root), binding={"unrelated": "prior execution"}, timeout_seconds=2)
        runner = NativeRunner(self.root / "native", supervisor=process)
        with self.assertRaises(ProcessError):
            runner.run("same-operation", self.profile(), "prompt", self.binding())
        with patch.object(process, "stop", wraps=process.stop) as stop:
            receipt = runner.inspect("same-operation")
            self.assertEqual(receipt["status"], "unknown")
            self.assertFalse(receipt["stopped"])
            self.assertIsNone(receipt["result"])
            self.assertEqual(runner.stop("same-operation")["status"], "unknown")
            stop.assert_not_called()
        record = runner._read(runner._path("operation", "same-operation"))
        self.assertIsNone(record["native_id"])
        with self.assertRaises(NativeError):
            runner.attest_effects("same-operation", "unrelated receipt is not evidence")

    def test_missing_session_claim_blocks_legacy_orphan_and_pending_resume(self):
        runner, process = self.runner()
        profile = self.profile(resume_verified=True)
        runner.run("first", profile, "prompt", self.binding())
        runner.attest_effects("first", "synthetic-full-proof")
        claim = runner._path("session", self.binding()["session_binding_key"])
        claim.unlink()  # Reproduce an old operation-before-claim partial pair.
        reopened = NativeRunner(runner.root, supervisor=process)
        with self.assertRaises(NativeError):
            reopened.run("replacement", profile, "prompt", self.binding())
        self.assertEqual(len(process.calls), 1)

        # A later pending claim cannot be bypassed by resuming an older parent.
        with runner._lock():
            runner._write(claim, dict(operation_id="pending", stable={
                "profile": profile.__dict__, "binding": self.binding()}, native_id="thread-example"))
        with self.assertRaises(NativeError):
            reopened.run("third", profile, "prompt", self.binding(), resume_from="first")
        self.assertEqual(len(process.calls), 1)

    def test_fsync_and_replace_gaps_never_allow_replacement_after_durable_claim(self):
        profile = self.profile()
        for syscall_name, count in [("fsync", 6), ("replace", 3)]:
            for fail_at in range(1, count + 1):
                with self.subTest(syscall=syscall_name, fail_at=fail_at):
                    process = StubProcess(self.root)
                    runner = NativeRunner(self.root / (syscall_name + str(fail_at)), supervisor=process)
                    original = getattr(os, syscall_name)
                    calls = 0
                    def fail_after(*args, **kwargs):
                        nonlocal calls
                        result = original(*args, **kwargs)
                        calls += 1
                        if calls == fail_at:
                            raise OSError("injected journal durability failure")
                        return result
                    with patch("agent_workforce.native.os." + syscall_name, side_effect=fail_after):
                        with self.assertRaises(OSError):
                            runner.run("interrupted", profile, "prompt", self.binding())
                    self.assertEqual(process.calls, [])
                    reopened = NativeRunner(runner.root, supervisor=process)
                    operation = reopened._path("operation", "interrupted")
                    claim = reopened._path("session", self.binding()["session_binding_key"])
                    if operation.exists() or claim.exists():
                        with self.assertRaises(NativeError):
                            reopened.run("replacement", profile, "prompt", self.binding())
                        self.assertEqual(process.calls, [])
                    if operation.exists():
                        self.assertEqual(reopened.run("interrupted", profile, "prompt", self.binding())["status"], "unknown")
                        self.assertEqual(process.calls, [])

    def test_explicit_verified_resume_requires_same_binding_and_original_id(self):
        runner, process = self.runner()
        profile = self.profile(resume_verified=True)
        runner.run("first", profile, "prompt", self.binding())
        runner.attest_effects("first", "synthetic-full-proof")
        with self.assertRaises(NativeError):
            runner.run("wrong", profile, "prompt", dict(self.binding(), ac_revision=2), resume_from="first")
        value = runner.run("second", profile, "followup", self.binding(), resume_from="first")
        self.assertEqual(value["status"], "complete")
        self.assertIn("resume", process.calls[-1][1])
        self.assertIn("thread-example", process.calls[-1][1])
        self.assertEqual(len(process.calls), 2)

    def test_controller_has_committed_intent_and_retains_five_holds_until_effects(self):
        store = Store(self.root / "state.db")
        self.addCleanup(store.close)
        runner, process = self.runner()
        def committed(operation_id):
            with sqlite3.connect(self.root / "state.db") as reader:
                self.assertEqual(reader.execute("SELECT COUNT(*) FROM attempts WHERE operation_id=?",
                                                (operation_id,)).fetchone()[0], 1)
                self.assertEqual(reader.execute("SELECT COUNT(*) FROM reservations WHERE released=0").fetchone()[0], 5)
        process.before_execute = committed
        backend = NativeBackend(store, runner=runner, profiles={"route-a": self.profile()}, clock=lambda: 1000)
        controller = Controller(store, backend, clock=lambda: 1000, trusted_issuers=["operator-example"])
        for kind, values in records().items():
            for key, value in values.items():
                controller.register(kind, key, value)
        controller.put_grant(grant(), authenticated_operator="operator-example")
        command = controller.accept(request(), authenticated_caller="operator-example")
        result = controller.dispatch(command["command_id"])
        self.assertEqual(result["state"], "awaiting_review")
        self.assertEqual(len([x for x in store.reservations() if not x["released"]]), 5)
        self.assertEqual(len(process.calls), 1)
        controller.dispatch(command["command_id"])
        controller.reconcile(result["attempt_id"])
        self.assertEqual(len(process.calls), 1)
        runner.attest_effects(result["operation_id"], "operator-reviewed-local-effects")
        controller.reconcile(result["attempt_id"])
        self.assertEqual(len([x for x in store.reservations() if not x["released"]]), 0)

    def test_native_execution_timeout_cannot_outlive_remaining_lease(self):
        store = Store(self.root / "bounded.db")
        self.addCleanup(store.close)
        runner, process = self.runner()
        backend = NativeBackend(store, runner=runner, profiles={"route-a": self.profile()}, clock=lambda: 1059.75)
        controller = Controller(store, backend, clock=lambda: 1000, trusted_issuers=["operator-example"])
        for kind, values in records().items():
            for key, value in values.items():
                controller.register(kind, key, value)
        controller.put_grant(grant(), authenticated_operator="operator-example")
        command = controller.accept(request(), authenticated_caller="operator-example")
        controller.dispatch(command["command_id"])
        self.assertEqual(process.calls[0][3]["timeout_seconds"], .25)

    def test_controller_definite_native_failure_retains_resources(self):
        store = Store(self.root / "failure.db")
        self.addCleanup(store.close)
        class FailedBackend:
            def start(self, operation_id, **context):
                return dict(operation_id=operation_id, status="failed", stopped=True,
                            effects_resolved=False, result={"denial": "synthetic"})
        controller = Controller(store, FailedBackend(), clock=lambda: 1000,
                                trusted_issuers=["operator-example"])
        for kind, values in records().items():
            for key, value in values.items():
                controller.register(kind, key, value)
        controller.put_grant(grant(), authenticated_operator="operator-example")
        command = controller.accept(request(), authenticated_caller="operator-example")
        value = controller.dispatch(command["command_id"])
        self.assertEqual(value["state"], "failed")
        self.assertEqual(value["result"], {"denial": "synthetic"})
        self.assertEqual(len([x for x in store.reservations() if not x["released"]]), 5)


if __name__ == "__main__":
    unittest.main()

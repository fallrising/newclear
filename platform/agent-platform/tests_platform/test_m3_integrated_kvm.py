"""Adversarial acceptance-oracle tests; these do not claim real KVM execution."""

import copy
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


class IntegratedOracles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scripts = Path(__file__).resolve().parents[1] / "scripts"
        spec = importlib.util.spec_from_file_location(
            "m3_integrated", scripts / "m3-integrated-acceptance.py"
        )
        cls.driver = importlib.util.module_from_spec(spec)
        with patch.object(sys, "path", [str(scripts), *sys.path]):
            spec.loader.exec_module(cls.driver)
        cls.checks = cls.driver.checks

    def observed(self, case="normal"):
        normal = case == "normal"
        unknown = case == "invalid-usage"
        reason = (
            None
            if normal
            else "model_response_invalid"
            if unknown
            else "model_request_limit_reached"
        )
        checks = self.checks
        raw = json.dumps(checks.EXPECTED, sort_keys=True)
        diff = (
            f"diff --git a/{checks.RESULT_FILE} b/{checks.RESULT_FILE}\n"
            "new file mode 100644\nindex 0000000..1234567\n--- /dev/null\n"
            f"+++ b/{checks.RESULT_FILE}\n@@ -0,0 +1 @@\n+{raw}\n"
        )
        digest = hashlib.sha256(diff.encode()).hexdigest()
        result = {
            "base_sha": "a" * 40,
            "diff": diff,
            "diff_sha256": digest,
            "diff_bytes": len(diff.encode()),
            "verification": {
                "name": "profile_verification",
                "status": "passed",
                "diff_sha256": digest,
                "contract_sha256": checks.contract_sha256(
                    checks.VerificationPolicy.model_validate(checks.verification())
                ),
                "checks": [{"id": "combined-result", "status": "passed", "exit_code": 0}],
            },
        }
        decision = {"id": "approval", "generation": 1, "digest": "digest", "dispatches_before": 0}
        return {
            "case": case,
            "base_sha": "a" * 40,
            "run": {
                "state": "succeeded" if normal else "failed",
                "reason": reason,
                "result": result if normal else None,
                "cleanup_state": "confirmed",
            },
            "pages": [
                {
                    "request_cursor": None,
                    "response_cursor": "one",
                    "events": [
                        {
                            "event_id": "one",
                            "cursor": "one",
                            "markers": ["WORKER_TOOL_1"] if normal else [],
                        }
                    ],
                    "state": "finished" if normal else "running",
                    "caught_up": True,
                }
            ],
            "stored_ids": ["one"],
            "records": [
                {"kind": "proof", "complete": True, "withheld": False, "reserved_before_return": 1}
            ],
            "decisions": [decision] if normal else [],
            "approvals": [
                {"id": "approval", "generation": 1, "action_digest": "digest", "status": "applied"}
            ]
            if normal
            else [],
            "events": (
                [
                    {"type": "approval." + kind, "payload": {"approval_id": "approval"}}
                    for kind in ("requested", "decided", "applied")
                ]
                if normal
                else [
                    {
                        "type": "model.cutoff",
                        "payload": {"reason": reason, "capacity_retained": True},
                    }
                ]
            ),
            "operations": [
                {
                    "status": "succeeded",
                    "delivery": "acknowledged",
                    "receipt_present": True,
                    "http_calls": 1,
                }
            ]
            if normal
            else [],
            "tool_calls": int(normal),
            "tool_authenticated": int(normal),
            "model_calls": 2 if normal else 1,
            "model_authenticated": True,
            "usage": {
                "configured": True,
                "guest_connected": True,
                "request_limit": 1 if case == "request-cutoff" else 10,
                "request_slots_consumed": 2 if normal else 1,
                "uncertain_requests": int(unknown),
                "cutoff_reason": reason,
                "entries": [
                    {
                        "status": "unknown" if unknown else "final",
                        "reason": reason if unknown else "mock_reported_usage",
                    }
                ]
                * (2 if normal else 1),
            },
            "authority": {
                "model_runs": 1,
                "model_tokens": 1,
                "model_active_tokens": 0,
                "tool_runs": 1,
                "tool_active_runs": 0,
                "tool_tokens": 1,
                "tool_active_tokens": 0,
            },
            "reservations": 0,
            "claims": 0,
            "vms": 0,
        }

    def validate(self, value):
        return self.checks.validate_observations(value, self.driver.worker)

    def test_accepts_normal_and_native_fault_observations(self):
        for case in self.driver.CASES:
            with self.subTest(case=case):
                result = self.validate(self.observed(case))
                self.assertTrue(result["passed"])
                self.assertEqual(result["sdk_finished"], case == "normal")

    def test_success_requires_actual_finished_and_caught_up(self):
        for state, caught in (("running", True), ("finished", False)):
            value = self.observed()
            value["pages"][-1].update(state=state, caught_up=caught)
            with self.assertRaisesRegex(RuntimeError, "sdk_completion_missing"):
                self.validate(value)

    def test_false_result_and_corrupt_hash_fail(self):
        for mutate in (
            lambda v: v["run"]["result"].update(diff="false success"),
            lambda v: v["run"]["result"].update(diff_sha256="0" * 64),
            lambda v: v["run"]["result"]["verification"]["checks"][0].update(exit_code=1),
        ):
            value = self.observed()
            mutate(value)
            with self.assertRaises(RuntimeError):
                self.validate(value)

    def test_faults_reject_every_dispatch_or_false_success(self):
        for case in ("request-cutoff", "invalid-usage"):
            for mutate in (
                lambda v: v.update(tool_calls=1),
                lambda v: v.update(operations=[{"status": "failed", "delivery": "withheld"}]),
                lambda v: v["records"].append({"kind": "tool", "action": "deliver"}),
                lambda v: v["records"].append({"kind": "tool", "action": "ack"}),
                lambda v: v["run"].update(state="succeeded"),
                lambda v: v["run"].update(result={"success": True}),
            ):
                with self.subTest(case=case, mutation=mutate):
                    value = self.observed(case)
                    mutate(value)
                    with self.assertRaises(RuntimeError):
                        self.validate(value)

    def test_faults_require_cutoff_and_retained_unknown_evidence(self):
        for mutate in (
            lambda v: v["usage"].update(cutoff_reason=None),
            lambda v: v.update(events=[]),
            lambda v: v["usage"].update(uncertain_requests=0),
            lambda v: v["usage"]["entries"][0].update(status="final"),
            lambda v: v["usage"].update(entries=[]),
        ):
            value = self.observed("invalid-usage")
            mutate(value)
            with self.assertRaises(RuntimeError):
                self.validate(value)

    def test_authority_and_full_proof_before_release_are_required(self):
        for case in self.driver.CASES:
            for mutate in (
                lambda v: v["authority"].update(tool_active_tokens=1),
                lambda v: v["authority"].update(tool_active_runs=1),
                lambda v: v["records"][0].update(reserved_before_return=0),
                lambda v: v["records"][0].update(complete=False),
                lambda v: v.update(records=[]),
                lambda v: v.update(reservations=1),
            ):
                value = self.observed(case)
                mutate(value)
                with self.subTest(case=case), self.assertRaises(RuntimeError):
                    self.validate(value)

    def test_fault_model_tokens_must_be_revoked(self):
        value = self.observed("invalid-usage")
        value["authority"]["model_active_tokens"] = 1
        with self.assertRaisesRegex(RuntimeError, "model_authority_not_revoked"):
            self.validate(value)

    def test_one_public_approval_and_exactly_one_ack_are_required(self):
        for mutate in (
            lambda v: v.update(decisions=[]),
            lambda v: v["approvals"][0].update(status="approved"),
            lambda v: v["operations"][0].update(delivery="pending"),
            lambda v: v["operations"][0].update(http_calls=2),
            lambda v: v["decisions"][0].update(dispatches_before=1),
        ):
            value = self.observed()
            mutate(value)
            with self.assertRaises(RuntimeError):
                self.validate(value)

    def test_mock_emits_terminal_then_finish_and_invalid_usage(self):
        data = {"model": "local/m3-integrated-v1", "messages": [], "max_tokens": 16}
        first = self.driver.model_response(data, "run", "normal")
        call = first["choices"][0]["message"]["tool_calls"][0]["function"]
        self.assertEqual(call["name"], "terminal")
        self.assertIn("m3_integrated_step.py", json.loads(call["arguments"])["command"])
        second = self.driver.model_response(
            {**data, "messages": [{"role": "tool"}]}, "run", "normal"
        )
        self.assertEqual(
            second["choices"][0]["message"]["tool_calls"][0]["function"]["name"], "finish"
        )
        invalid = self.driver.model_response(data, "run", "invalid-usage")
        self.assertGreater(invalid["usage"]["completion_tokens"], data["max_tokens"])

    def test_cleanup_gate_fails_closed_and_preserves_case_failure(self):
        clean = {key: 0 for key in self.checks.CLEANUP_KEYS}
        self.assertTrue(self.checks.cleanup_passed(clean))
        for key in clean:
            missing = copy.deepcopy(clean)
            del missing[key]
            self.assertFalse(self.checks.cleanup_passed(missing))
            self.assertFalse(self.checks.cleanup_passed({**clean, key: 1}))

    def test_existing_output_is_never_overwritten_by_preflight_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            path = output / "report.json"
            original = '{"passed": true, "prior": "unrelated"}\n'
            path.write_text(original)
            with patch.object(self.driver.base, "main", side_effect=FileExistsError):
                with self.assertRaises(FileExistsError):
                    self.driver.run_shell(output)
            self.assertEqual(path.read_text(), original)

    def test_shell_rejects_fixture_residue_and_keeps_original_failure(self):
        for failure in (None, ValueError("original case failure")):
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "new"

                def shell(output=output, failure=failure):
                    output.mkdir()
                    (output / "report.json").write_text(
                        json.dumps(
                            {
                                "passed": failure is None,
                                "cases": [],
                                **{key: 0 for key in self.checks.CLEANUP_KEYS},
                            }
                        )
                    )
                    if failure:
                        raise failure

                fixture = SimpleNamespace(close_errors=["OSError"])
                with (
                    patch.object(self.driver.base, "main", side_effect=shell),
                    patch.object(self.driver.Mock, "last", fixture),
                ):
                    with self.assertRaises(type(failure) if failure else RuntimeError) as caught:
                        self.driver.run_shell(output)
                if failure:
                    self.assertIs(caught.exception, failure)
                report = json.loads((output / "report.json").read_text())
                self.assertFalse(report["passed"])
                self.assertEqual(report["fixture_cleanup_errors"], ["OSError"])

    def test_installer_writes_only_bounded_program_without_replacing_model(self):
        sandbox = Mock()
        node = Mock()
        node.attach.return_value = sandbox
        run = {"id": "run"}
        journal = Mock()
        journal.read_text.return_value = json.dumps(
            {"handle": {"owner": "owner", "id": "id", "token": "handle"}}
        )
        credential = Mock()
        credential.read_text.return_value = "node credential"
        with (
            patch.object(self.driver, "private_file", side_effect=[journal, credential]),
            patch.object(self.driver, "SingleNodeClient", return_value=node),
        ):
            self.driver.install_step(
                {
                    "state_dir": "/private",
                    "origin": "loopback",
                    "sandbox_token_file": "/private/token",
                },
                run,
                {"repository": {"id": 123}},
            )
        self.assertEqual([call[0] for call in sandbox.mock_calls], ["write_file"])
        path, program = sandbox.write_file.call_args.args
        self.assertTrue(path.endswith("/m3_integrated_step.py"))
        compile(program, path, "exec")
        self.assertNotIn(b"node credential", program)
        self.assertIn(b"guest_tool_client.py", program)

    def test_child_cleanup_attempts_every_owned_process_after_one_failure(self):
        harness = object.__new__(self.driver.Harness)
        first, second, connector = Mock(), Mock(), Mock()
        for process in (first, second, connector):
            process.poll.return_value = None
        first.terminate.side_effect = OSError("gone")
        harness.children, harness.connector = [first, second], connector
        with self.assertRaisesRegex(RuntimeError, "owned_process_cleanup_failed"):
            harness.stop_children()
        second.wait.assert_called_once_with(timeout=10)
        connector.wait.assert_called_once_with(timeout=10)

    def test_database_close_failure_is_recorded_without_masking_primary_error(self):
        database = object.__new__(self.driver.ObservedDatabase)
        original = self.driver.ObservedDatabase.__mro__[1]
        with (
            patch.object(original, "close", side_effect=OSError("db close")),
            patch.object(self.driver.ObservedDatabase, "close_errors", []),
        ):
            database.close()
            self.assertEqual(database.close_errors, ["OSError"])

    def test_each_fixture_close_step_runs_after_github_shutdown_failure(self):
        fixture = object.__new__(self.driver.Mock)
        fixture.release, fixture.shutdown, fixture.server_close = Mock(), Mock(), Mock()
        fixture.socket = object()
        fixture.shutdown.side_effect = OSError("github shutdown")
        fixture.thread = Mock(ident=1)
        fixture.thread.is_alive.side_effect = [True, False]
        fixture.model = Mock()
        fixture.model_thread = Mock(ident=2)
        fixture.model_thread.is_alive.side_effect = [True, False]
        fixture.close_errors = []
        fixture.close()
        fixture.server_close.assert_called_once_with()
        fixture.thread.join.assert_called_once_with(5)
        fixture.model.shutdown.assert_called_once_with()
        fixture.model.server_close.assert_called_once_with()
        fixture.model_thread.join.assert_called_once_with(5)
        self.assertEqual(fixture.close_errors, ["OSError"])

    def test_model_thread_start_failure_closes_socket_without_shutdown_or_join(self):
        model, model_thread = Mock(), Mock(ident=None)
        model_thread.start.side_effect = RuntimeError("model thread start")
        model_thread.is_alive.return_value = False
        github_close = Mock()

        def github_init(fixture):
            fixture.socket = object()
            fixture.release, fixture.shutdown = Mock(), Mock()
            fixture.server_close = github_close
            fixture.thread = Mock(ident=1)
            fixture.thread.is_alive.side_effect = [True, False]

        with (
            patch.object(self.driver.worker.Mock, "__init__", github_init),
            patch.object(self.driver.model_mock, "mock_server", return_value=model),
            patch.object(self.driver.threading, "Thread", return_value=model_thread),
            patch.object(self.driver.Mock, "last", None),
        ):
            with self.assertRaisesRegex(RuntimeError, "model thread start"):
                self.driver.Mock()
            model.shutdown.assert_not_called()
            model.server_close.assert_called_once_with()
            model_thread.join.assert_not_called()
            github_close.assert_called_once_with()

    def test_numeric_observations_reject_boolean_substitutions(self):
        paths = [
            ("usage", "request_limit"),
            ("usage", "request_slots_consumed"),
            ("usage", "uncertain_requests"),
            ("model_calls",),
            ("tool_calls",),
            ("tool_authenticated",),
            ("reservations",),
            ("claims",),
            ("vms",),
            *[("authority", key) for key in self.observed()["authority"]],
            ("records", 0, "reserved_before_return"),
        ]
        for path in paths:
            with self.subTest(path=path):
                value = self.observed("request-cutoff")
                target = value
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = bool(target[path[-1]])
                with self.assertRaises(RuntimeError):
                    self.validate(value)
        for path in (("operations", 0, "http_calls"), ("decisions", 0, "dispatches_before")):
            value = self.observed()
            value[path[0]][path[1]][path[2]] = bool(value[path[0]][path[1]][path[2]])
            with self.assertRaises(RuntimeError):
                self.validate(value)

    def test_corrupt_owned_report_preserves_original_failure_and_corrupt_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "owned"
            original = ValueError("original case failure")
            corrupt = b'{"partial":'

            def shell():
                output.mkdir()
                (output / "report.json").write_bytes(corrupt)
                raise original

            with (
                patch.object(self.driver.base, "main", side_effect=shell),
                patch.object(self.driver.Mock, "last", SimpleNamespace(close_errors=[])),
            ):
                with self.assertRaises(ValueError) as caught:
                    self.driver.run_shell(output)
            self.assertIs(caught.exception, original)
            report = json.loads((output / "report.json").read_text())
            self.assertFalse(report["passed"])
            self.assertEqual(report["report_io_errors"][0]["operation"], "read")
            self.assertEqual((output / report["corrupt_report_artifact"]).read_bytes(), corrupt)

    def test_report_write_failure_keeps_primary_error_and_records_io_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "owned"
            original = ValueError("original failure")
            report = {"passed": False, "cases": []}

            def shell():
                output.mkdir()
                (output / "report.json").write_bytes(json.dumps(report).encode())
                raise original

            with (
                patch.object(self.driver.base, "main", side_effect=shell),
                patch.object(self.driver.Mock, "last", SimpleNamespace(close_errors=[])),
                patch.object(Path, "write_text", side_effect=OSError("unwritable")),
                patch.object(sys, "stderr", new_callable=io.StringIO) as stderr,
            ):
                with self.assertRaises(ValueError) as caught:
                    self.driver.run_shell(output)
            self.assertIs(caught.exception, original)
            self.assertEqual(
                json.loads(stderr.getvalue())["report_io_errors"],
                [
                    {"operation": "write", "error_type": "OSError"},
                ],
            )

    def test_github_start_failure_closes_socket_without_shutdown_or_join(self):
        thread, close, shutdown = Mock(ident=None), Mock(), Mock()
        thread.is_alive.return_value = False
        original = RuntimeError("github thread start")

        def github_init(fixture):
            fixture.socket, fixture.release = object(), Mock()
            fixture.thread, fixture.shutdown, fixture.server_close = thread, shutdown, close
            raise original

        with (
            patch.object(self.driver.worker.Mock, "__init__", github_init),
            patch.object(self.driver.model_mock, "mock_server") as model_factory,
            patch.object(self.driver.Mock, "last", None),
        ):
            with self.assertRaises(RuntimeError) as caught:
                self.driver.Mock()
        self.assertIs(caught.exception, original)
        shutdown.assert_not_called()
        close.assert_called_once_with()
        thread.join.assert_not_called()
        model_factory.assert_not_called()

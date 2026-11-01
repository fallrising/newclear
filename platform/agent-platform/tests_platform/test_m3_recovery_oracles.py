"""Pure regressions for recovery oracles and process-boundary validation."""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


class ProcessBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scripts = Path(__file__).resolve().parents[1] / "scripts"
        spec = importlib.util.spec_from_file_location(
            "recovery_checks", scripts / "m3_recovery_checks.py"
        )
        cls.checks = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.checks)

    def expected(self):
        return {
            "pid": 123,
            "start_ticks": 45,
            "nonce": "nonce",
            "case": "model-reserved",
            "run_id": "run",
        }

    def test_exact_stopped_owned_child_is_killed(self):
        expected = self.expected()
        child = Mock(pid=123)
        child.poll.return_value = None
        child.wait.return_value = -9
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "barrier.json"
            path.write_text(json.dumps({**expected, "phase": "held"}))
            with patch.object(
                self.checks,
                "process_identity",
                return_value={"pid": 123, "start_ticks": 45, "state": "T"},
            ):
                proof = self.checks.kill_at_barrier(child, path, expected=expected)
        self.assertEqual(proof["returncode"], -9)
        child.kill.assert_called_once_with()

    def test_forged_barrier_and_reused_pid_never_kill(self):
        for change in ({"nonce": "wrong"}, {"pid": True}, {"phase": "released"}):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "barrier.json"
                path.write_text(json.dumps({**self.expected(), "phase": "held", **change}))
                child = Mock(pid=123)
                child.poll.return_value = None
                with patch.object(
                    self.checks,
                    "process_identity",
                    return_value={"pid": 123, "start_ticks": 45, "state": "T"},
                ):
                    with self.assertRaisesRegex(RuntimeError, "barrier_identity_mismatch"):
                        self.checks.kill_at_barrier(child, path, expected=self.expected())
                child.kill.assert_not_called()

    def test_resumed_boundary_raises_instead_of_returning(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "barrier.json"
            with (
                patch.object(
                    self.checks,
                    "process_identity",
                    return_value={"pid": 123, "start_ticks": 45, "state": "R"},
                ),
                patch.object(self.checks.os, "kill") as kill,
            ):
                with self.assertRaisesRegex(RuntimeError, "barrier_resumed"):
                    self.checks.stop_at_barrier(path, self.expected())
            self.assertEqual(json.loads(path.read_text())["phase"], "held")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            kill.assert_called_once_with(123, self.checks.signal.SIGSTOP)

    def test_early_exit_and_deadline_are_not_barriers(self):
        child = Mock(pid=123)
        child.poll.return_value = 1
        with self.assertRaisesRegex(RuntimeError, "barrier_child_exited"):
            self.checks.kill_at_barrier(child, "/absent", expected=self.expected())
        child.kill.assert_not_called()
        child.poll.return_value = None
        with (
            patch.object(
                self.checks,
                "process_identity",
                return_value={"pid": 123, "start_ticks": 45, "state": "R"},
            ),
            patch.object(self.checks.time, "monotonic", side_effect=[0, 2]),
        ):
            with self.assertRaisesRegex(RuntimeError, "barrier_not_stopped"):
                self.checks.kill_at_barrier(child, "/absent", expected=self.expected(), timeout=1)
        child.kill.assert_not_called()


class RecoveryOracles(unittest.TestCase):
    expected = ProcessBoundary.expected

    @classmethod
    def setUpClass(cls):
        ProcessBoundary.setUpClass.__func__(cls)
        scripts = Path(__file__).resolve().parents[1] / "scripts"
        spec = importlib.util.spec_from_file_location(
            "recovery_driver", scripts / "m3-recovery-integrated-kvm.py"
        )
        cls.driver = importlib.util.module_from_spec(spec)
        with patch.object(sys, "path", [str(scripts), *sys.path]):
            spec.loader.exec_module(cls.driver)
        cls.combined = cls.driver.combined

    def observed(self, case="normal"):
        import copy
        import hashlib

        success = case in {"normal", "result-before-save"}
        reserved = case in {"model-reserved", "model-response"}
        crashed = case != "normal"
        count = 2 if success else 1
        tool_count = int(not reserved)
        t0, t1, t2 = (
            "2026-10-04T00:00:00+00:00",
            "2026-10-04T00:00:30+00:00",
            "2026-10-04T00:00:31+00:00",
        )
        checks = self.combined.checks
        raw = json.dumps(checks.EXPECTED, sort_keys=True)
        diff = (
            f"diff --git a/{checks.RESULT_FILE} b/{checks.RESULT_FILE}\nnew file mode 100644\n"
            f"index 0000000..1234567\n--- /dev/null\n+++ b/{checks.RESULT_FILE}\n"
            f"@@ -0,0 +1 @@\n+{raw}\n"
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
        events = [{"type": "sdk", "source": "openhands", "source_event_id": "one", "payload": {}}]
        decisions, approvals = [], []
        if tool_count:
            decisions = [
                {"id": "approval", "digest": "digest", "generation": 1, "dispatches_before": 0}
            ]
            approvals = [
                {"id": "approval", "action_digest": "digest", "generation": 1, "status": "applied"}
            ]
            events += [
                {
                    "type": "approval." + kind,
                    "source": "platform",
                    "payload": {"approval_id": "approval"},
                }
                for kind in ("requested", "decided", "applied")
            ]
        if success:
            events.append({"type": "tool.session_drained", "source": "platform", "payload": {}})
        counters = {
            "model_calls": 0 if case == "model-reserved" else count,
            "tool_calls": tool_count,
            "tool_authenticated": tool_count,
            "model_authenticated": True,
        }
        before = {
            "run": {
                "generation": 1,
                "sandbox_id": "binding",
                "state": "finalizing" if case == "result-before-save" else "running",
                "result": None,
                "reason": None,
                "cleanup_state": "pending",
            },
            "job": {
                "lease_until": t1,
                "lease_expired": False,
                "lease_owner": "old",
                "observed_at": t0,
            },
            "bindings": [{"id": "binding", "provider_handle": "original-vm"}],
            "reservations": [{"sandbox_id": "binding", "released_at": None}],
            "model_policy": [{"policy_sha256": "m" * 64}],
            "model_tokens": [{"token_hash": "model-token", "generation": 1, "revoked_at": None}],
            "tool_tokens": [{"token_hash": "tool-token", "generation": 1, "revoked_at": None}],
            "tool_grants": [{"policy_sha256": "t" * 64, "revoked_at": None, "generation": 1}],
            "usage": {
                "configured": True,
                "guest_connected": True,
                "request_limit": 10,
                "request_slots_consumed": count,
                "uncertain_requests": int(reserved),
                "cutoff_reason": None,
                "entries": [
                    {
                        "request_id": "request-" + str(index),
                        "status": "reserved" if reserved else "final",
                        "reason": "dispatch_outcome_unknown" if reserved else "mock_reported_usage",
                        "settled_at": None if reserved else t0,
                        "input_tokens": None if reserved else 10,
                        "output_tokens": None if reserved else 5,
                    }
                    for index in range(count)
                ],
            },
            "operations": [
                {
                    "operation_id": "operation",
                    "status": "succeeded",
                    "reason": "tool_ok",
                    "delivery": "acknowledged" if success else "pending",
                    "receipt_hash": "r" * 64,
                    "http_calls": 1,
                }
            ]
            if tool_count
            else [],
            "events": events,
            "approvals": approvals,
            "upstream": counters,
            "resources": {"claims": 1, "vms": 1},
            "journal": {
                "handle": {"owner": "owner", "id": "handle"},
                "claim_ref": "claim",
                "observed": {"vm_id": "vm", "identity": {"pid": 9, "start_ticks": 10}},
                "operations": {
                    "allocate": {"state": "completed"},
                    "prompt": {"state": "completed"},
                    "result": {"state": "completed", "result": result}
                    if case == "result-before-save"
                    else None,
                },
                "tool_channel": {
                    "current": {"state": "delivered"} if case == "broker-delivered" else None
                },
            },
        }
        final = copy.deepcopy(before)
        final["run"].update(
            generation=2 if crashed else 1,
            state="succeeded" if success else "failed",
            reason=None if success else "model_transport_uncertain",
            result=result if success else None,
            cleanup_state="confirmed",
        )
        final["reservations"][0]["released_at"] = t2
        final["resources"] = {"claims": 0, "vms": 0}
        for key in ("tool_tokens", "tool_grants"):
            final[key][0]["revoked_at"] = t2
        if not success:
            final["model_tokens"][0]["revoked_at"] = t2
            final["usage"]["cutoff_reason"] = "model_transport_uncertain"
            final["events"].append(
                {
                    "type": "model.cutoff",
                    "source": "platform",
                    "payload": {"reason": "model_transport_uncertain", "capacity_retained": True},
                }
            )
        else:
            final["events"].append(
                {"type": "run.result_saved", "source": "connector", "payload": {}}
            )
        if crashed:
            final["events"].append(
                {
                    "type": "runtime.reconciled",
                    "source": "platform",
                    "payload": {
                        "phase": "result" if case == "result-before-save" else "running",
                        "generation": 2,
                    },
                }
            )
        claim = {
            "kind": "claim",
            "generation": 1,
            "owner": "old",
            "run_id": "run",
            "job_id": "job",
            "binding_id": "binding",
            "lease_until": t1,
            "observed_at": t0,
            "reserved": 1,
        }
        pages = [
            {
                "kind": "events",
                "request_cursor": None,
                "response_cursor": "one",
                "events": [
                    {
                        "event_id": "one",
                        "cursor": "one",
                        "markers": ["WORKER_TOOL_1"] if success else [],
                    }
                ],
                "state": "finished" if success else "running",
                "caught_up": True,
            }
        ]
        proof = {
            "kind": "raw_proof",
            "observed_state": "stopped",
            "reserved_before_return": 1,
            "proof": {key: True for key in self.combined.base.STOP_KEYS},
        }
        original = {
            **self.expected(),
            "case": case,
            "role": "original",
            "returncode": -9 if crashed else 0,
            "policy_hashes": {
                key: "a" * 64 for key in ("model.json", "model.secret", "tool.json", "tool.secret")
            },
            "records": [claim, {"kind": "allocate"}, *pages] + ([] if crashed else [proof]),
        }
        segments = [original]
        fault = None
        if crashed:
            barrier = {
                **{key: original[key] for key in self.checks.EXPECTED_KEYS},
                "phase": "held",
                "request_id": "request-0",
                "operation_id": "operation",
                "result_sha256": digest,
            }
            fault = {
                **{key: original[key] for key in self.checks.EXPECTED_KEYS},
                "barrier": barrier,
                "observed_state": "T",
                "returncode": -9,
            }
            successor = {
                **copy.deepcopy(original),
                "role": "successor",
                "pid": 124,
                "returncode": 0,
                "records": [
                    {**claim, "owner": "new", "generation": 2, "recovery": True, "observed_at": t2},
                    {
                        "kind": "expired_lease",
                        "job": {**before["job"], "lease_expired": True, "observed_at": t2},
                    },
                    {
                        "kind": "inspect",
                        "phase": "result" if case == "result-before-save" else "running",
                        "generation": 2,
                    },
                    proof,
                ],
            }
            segments.append(successor)
        return {
            "case": case,
            "run_id": "run",
            "base_sha": "a" * 40,
            "decisions": decisions,
            "snapshots": {
                "before_kill": before,
                "after_kill": copy.deepcopy(before),
                "final": final,
            }
            if crashed
            else {"final": final},
            "segments": segments,
            "fault": fault,
            "fence_probe": {
                "status": 409,
                "error": "connector_generation_stale",
                "before": counters,
                "after": copy.deepcopy(counters),
            }
            if crashed
            else None,
        }

    def validate(self, value):
        return self.checks.validate_case(value, self.combined)

    def test_all_five_source_backed_outcomes_are_accepted(self):
        for case in self.checks.CASES:
            with self.subTest(case=case):
                self.assertTrue(self.validate(self.observed(case))["passed"])

    def test_faults_cannot_claim_success_or_relabel_literal_uncertainty(self):
        for case in ("model-reserved", "model-response", "broker-delivered"):
            for mutate in (
                lambda v: v["snapshots"]["final"]["run"].update(state="succeeded"),
                lambda v: v["snapshots"]["final"]["run"].update(result={"success": True}),
                lambda v: v["snapshots"]["final"]["usage"]["entries"][0].update(status="unknown"),
                lambda v: v["snapshots"]["final"]["upstream"].update(model_calls=3),
                lambda v: v["snapshots"]["final"]["usage"].update(cutoff_reason=None),
                lambda v: v["snapshots"]["final"]["model_tokens"][0].update(revoked_at=None),
            ):
                value = self.observed(case)
                mutate(value)
                with self.subTest(case=case), self.assertRaises(RuntimeError):
                    self.validate(value)

    def test_delivered_broker_remains_pending_without_ack_or_replay(self):
        for mutate in (
            lambda v: v["snapshots"]["final"]["operations"][0].update(delivery="acknowledged"),
            lambda v: v["snapshots"]["final"]["operations"][0].update(status="unknown"),
            lambda v: v["snapshots"]["before_kill"]["journal"]["tool_channel"]["current"].update(
                state="pending"
            ),
            lambda v: v["segments"][1]["records"].append({"kind": "tool", "action": "ack"}),
        ):
            value = self.observed("broker-delivered")
            mutate(value)
            with self.assertRaises(RuntimeError):
                self.validate(value)

    def test_result_recovery_requires_prior_finish_drained_and_persisted_bytes(self):
        for mutate in (
            lambda v: v["segments"][0]["records"][2].update(state="running"),
            lambda v: v["segments"][0]["records"][2].update(caught_up=False),
            lambda v: v["snapshots"]["before_kill"].update(events=[]),
            lambda v: v["snapshots"]["before_kill"]["run"].update(result={"premature": True}),
            lambda v: v["snapshots"]["before_kill"]["journal"]["operations"]["result"].update(
                result={"different": True}
            ),
            lambda v: v["segments"][1]["records"].append({"kind": "operation", "action": "result"}),
        ):
            value = self.observed("result-before-save")
            mutate(value)
            with self.assertRaises(RuntimeError):
                self.validate(value)

    def test_expiry_identity_policy_and_complete_proof_are_required(self):
        for mutate in (
            lambda v: v["segments"][1]["records"][1]["job"].update(
                observed_at="2026-10-04T00:00:01+00:00"
            ),
            lambda v: v["segments"][1]["records"][0].update(binding_id="replacement"),
            lambda v: v["segments"][1]["policy_hashes"].update(**{"tool.json": "changed"}),
            lambda v: v["segments"][1]["records"][-1]["proof"].update(cpu_scope_gone=False),
            lambda v: v["segments"][1]["records"][-1].update(reserved_before_return=0),
            lambda v: v["snapshots"]["after_kill"]["reservations"][0].update(released_at="early"),
            lambda v: v["fence_probe"].update(error="connector_lease_expired"),
            lambda v: v["fault"]["barrier"].update(phase="released"),
        ):
            value = self.observed("model-response")
            mutate(value)
            with self.assertRaises(RuntimeError):
                self.validate(value)

    def test_boolean_counts_and_missing_final_cleanup_are_rejected(self):
        for path in (
            ("usage", "request_slots_consumed"),
            ("upstream", "model_calls"),
            ("resources", "vms"),
        ):
            value = self.observed("model-response")
            value["snapshots"]["final"][path[0]][path[1]] = bool(
                value["snapshots"]["final"][path[0]][path[1]]
            )
            with self.assertRaises(RuntimeError):
                self.validate(value)
        value = self.observed("model-response")
        value["snapshots"]["final"]["reservations"][0]["released_at"] = None
        with self.assertRaises(RuntimeError):
            self.validate(value)

    def test_successor_cannot_rebind_same_policy_or_relabel_token_generation(self):
        value = self.observed("model-response")
        value["snapshots"]["final"]["tool_grants"][0]["generation"] = 2
        with self.assertRaises(RuntimeError):
            self.validate(value)
        value = self.observed("model-response")
        value["snapshots"]["final"]["model_tokens"][0]["generation"] = True
        with self.assertRaises(RuntimeError):
            self.validate(value)

    def test_successor_phase_and_durable_reconcile_must_match_live_original_vm(self):
        for case in ("model-reserved", "result-before-save"):
            for mutate in (
                lambda v: v["segments"][1]["records"][-2].update(phase="stopped"),
                lambda v: v["segments"][1]["records"].pop(-2),
                lambda v: v["snapshots"]["final"]["events"][-1]["payload"].update(phase="stopped"),
            ):
                value = self.observed(case)
                mutate(value)
                with self.subTest(case=case), self.assertRaises(RuntimeError):
                    self.validate(value)

    def test_reserve_and_settle_boundaries_preserve_original_order(self):
        calls = []
        original = Mock(side_effect=lambda *a, **kw: calls.append("original") or "result")
        boundary = Mock(side_effect=lambda *a, **kw: calls.append("barrier"))
        result = self.checks.reserve_boundary(
            original, boundary, "proxy", "run", "token", "request", {}
        )
        self.assertEqual((result, calls), ("result", ["original", "barrier"]))
        original.assert_called_once_with("proxy", "run", "token", "request", {})
        calls.clear()
        original.reset_mock()
        self.checks.settle_boundary(
            original, boundary, "proxy", "run", "request", usage={"tokens": 1}
        )
        self.assertEqual(calls, ["barrier", "original"])
        original.assert_called_once_with("proxy", "run", "request", usage={"tokens": 1})
        original.reset_mock()
        boundary.side_effect = RuntimeError("stopped")
        with self.assertRaisesRegex(RuntimeError, "stopped"):
            self.checks.settle_boundary(original, boundary, "proxy", "run", "request", usage={})
        original.assert_not_called()
        boundary.reset_mock()
        self.checks.settle_boundary(original, boundary, "proxy", "run", "request", reason="unknown")
        boundary.assert_not_called()
        original.assert_called_once_with("proxy", "run", "request", reason="unknown")

    def test_original_errors_never_create_reserve_or_delivery_barrier(self):
        for operation in ("reserve", "deliver"):
            original, boundary = Mock(side_effect=ValueError("original")), Mock()
            with self.assertRaisesRegex(ValueError, "original"):
                if operation == "reserve":
                    self.checks.reserve_boundary(
                        original, boundary, "proxy", "run", "token", "request", {}
                    )
                else:
                    self.checks.tool_boundary(
                        original, boundary, "run", "deliver", operation_id="operation"
                    )
            original.assert_called_once()
            boundary.assert_not_called()

    def test_deliver_barrier_requires_successful_exact_acceptance(self):
        for response in ({"accepted": False}, {"accepted": 1}, {}, {"accepted": True, "extra": 1}):
            original, boundary = Mock(return_value=response), Mock()
            self.assertEqual(
                self.checks.tool_boundary(original, boundary, "run", "deliver", operation_id="op"),
                response,
            )
            original.assert_called_once()
            boundary.assert_not_called()
        order = []
        original = Mock(side_effect=lambda *a, **kw: order.append("original") or {"accepted": True})
        boundary = Mock(side_effect=lambda *a, **kw: order.append("barrier"))
        self.checks.tool_boundary(original, boundary, "run", "deliver", operation_id="op")
        self.assertEqual(order, ["original", "barrier"])
        boundary.assert_called_once_with("broker-delivered", operation_id="op")
        boundary.reset_mock()
        self.checks.tool_boundary(original, boundary, "run", "poll")
        boundary.assert_not_called()

    def test_result_boundary_records_only_returned_result_hash(self):
        boundary = Mock()
        result = {"diff_sha256": "hash"}
        self.assertIs(self.checks.result_boundary(result, boundary, "result"), result)
        boundary.assert_called_once_with("result-before-save", result_sha256="hash")
        boundary.reset_mock()
        self.checks.result_boundary({}, boundary, "prepare")
        boundary.assert_not_called()
        with self.assertRaises(KeyError):
            self.checks.result_boundary({}, boundary, "result")
        boundary.assert_not_called()

    def test_subprocess_wait_timeout_is_a_bounded_kill_failure(self):
        import subprocess

        child = Mock(pid=123)
        child.poll.return_value = None
        child.wait.side_effect = subprocess.TimeoutExpired("worker", 1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "barrier.json"
            path.write_text(json.dumps({**self.expected(), "phase": "held"}))
            with patch.object(
                self.checks,
                "process_identity",
                return_value={"pid": 123, "start_ticks": 45, "state": "T"},
            ):
                with self.assertRaisesRegex(RuntimeError, "barrier_kill_timeout"):
                    self.checks.kill_at_barrier(child, path, expected=self.expected(), timeout=1)
        child.kill.assert_called_once_with()
        child.wait.assert_called_once_with(timeout=1)

    def test_partial_snapshot_survives_later_failure_without_claiming_completion(self):
        from types import SimpleNamespace

        with tempfile.TemporaryDirectory() as directory:
            harness = SimpleNamespace(output=Path(directory))
            original = ValueError("successor failed")

            def execute(harness, case, observed):
                observed["snapshots"]["before_kill"] = {"retained": True}
                self.driver.persist_case(harness, case, observed)
                saved = json.loads((harness.output / (case + "-observations.json")).read_text())
                self.assertFalse(saved["complete"])
                self.assertEqual(saved["snapshots"]["before_kill"], {"retained": True})
                raise original

            with patch.object(self.driver, "execute_case", side_effect=execute):
                with self.assertRaises(ValueError) as caught:
                    self.driver.run_case(harness, "model-reserved")
            self.assertIs(caught.exception, original)
            final = json.loads((harness.output / "model-reserved-observations.json").read_text())
            self.assertFalse(final["complete"])
            self.assertEqual(final["failure_type"], "ValueError")
            self.assertEqual(final["snapshots"]["before_kill"], {"retained": True})

    def test_evidence_write_failure_does_not_replace_primary_failure(self):
        import io

        original = ValueError("original")
        with (
            patch.object(self.driver, "execute_case", side_effect=original),
            patch.object(self.driver, "persist_case", side_effect=OSError("storage")),
            patch.object(sys, "stderr", new_callable=io.StringIO) as stderr,
        ):
            with self.assertRaises(ValueError) as caught:
                self.driver.run_case(Mock(), "model-reserved")
        self.assertIs(caught.exception, original)
        self.assertEqual(json.loads(stderr.getvalue())["evidence_write_failure_type"], "OSError")

    def test_policy_paths_are_reused_without_regenerating_service_identity(self):
        harness = object.__new__(self.driver.Harness)
        harness.policies = {"run": Path("/owned/original-policy")}
        harness.mock = Mock()
        self.assertEqual(harness.policy_files("run"), Path("/owned/original-policy"))
        harness.mock.policy.assert_not_called()

    def test_constructor_cleanup_failure_never_masks_primary_error(self):
        class PrimaryError(Exception):
            pass

        original = PrimaryError("original constructor failure")

        def failing_constructor(harness, *args):
            harness.children = []
            harness.connector = Mock()
            harness.connector.poll.return_value = None
            harness.connector.terminate.side_effect = OSError("cleanup failure")
            try:
                raise original
            except BaseException:
                harness.stop_children()
                raise

        with patch.object(self.driver.worker.Harness, "__init__", failing_constructor):
            with self.assertRaises(PrimaryError) as caught:
                self.driver.Harness()
        self.assertIs(caught.exception, original)

    def test_fence_probe_reads_bounded_http_error_and_returns_only_safe_code(self):
        import io
        from urllib.error import HTTPError
        from uuid import uuid4

        from agent_platform_m0.transport import HTTP

        run_id = uuid4()
        transport = HTTP("http://127.0.0.1:17888", "synthetic-token")
        body = io.BytesIO(b'{"error":"connector_generation_stale"}')
        error = HTTPError(transport.origin, 409, "Conflict", {}, body)
        with patch.object(transport.opener, "open", side_effect=error) as opened:
            self.assertEqual(
                self.driver.probe_generation(transport, run_id, 1),
                {
                    "status": 409,
                    "error": "connector_generation_stale",
                },
            )
        self.assertTrue(body.closed)
        request = opened.call_args.args[0]
        self.assertEqual(request.method, "GET")
        self.assertEqual(request.full_url, f"http://127.0.0.1:17888/v1/runs/{run_id}?generation=1")
        self.assertEqual(request.get_header("X-session-api-key"), "synthetic-token")
        self.assertEqual(opened.call_args.kwargs["timeout"], 5)

    def test_fence_probe_rejects_wrong_error_redirect_and_oversized_body(self):
        import io
        from urllib.error import HTTPError
        from uuid import uuid4

        from agent_platform_m0.transport import HTTP

        for status, raw in (
            (409, b'{"error":"connector_lease_expired"}'),
            (302, b'{"error":"connector_generation_stale"}'),
            (409, b"x" * 1025),
            (409, b"not json"),
        ):
            transport = HTTP("http://127.0.0.1:17888", "synthetic-token")
            body = io.BytesIO(raw)
            with patch.object(
                transport.opener,
                "open",
                side_effect=HTTPError(transport.origin, status, "Error", {}, body),
            ):
                with self.subTest(status=status), self.assertRaises(RuntimeError):
                    self.driver.probe_generation(transport, uuid4(), 1)
            self.assertTrue(body.closed)

"""Completion and fault-observation oracles; no mocked KVM acceptance claim."""

import copy
import hashlib
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4


class WorkerKVMOracles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scripts = Path(__file__).resolve().parents[1] / "scripts"
        spec = importlib.util.spec_from_file_location(
            "worker_kvm_oracles", scripts / "worker-tools-kvm.py"
        )
        cls.driver = importlib.util.module_from_spec(spec)
        with patch.object(sys, "path", [str(scripts), *sys.path]):
            spec.loader.exec_module(cls.driver)

    def pages(self):
        return [
            {
                "request_cursor": None,
                "response_cursor": "one",
                "state": "running",
                "caught_up": True,
                "events": [{"event_id": "one", "cursor": "one", "markers": ["WORKER_TOOL_1"]}],
            },
            {
                "request_cursor": "one",
                "response_cursor": "one",
                "state": "finished",
                "caught_up": True,
                "events": [],
            },
        ]

    def result(self):
        text = json.dumps(self.driver.expected_checks("normal"), sort_keys=True)
        diff = (
            "diff --git a/worker-tools.json b/worker-tools.json\nnew file mode 100644\n"
            "index 0000000..1234567\n--- /dev/null\n+++ b/worker-tools.json\n"
            "@@ -0,0 +1 @@\n+" + text + "\n"
        )
        digest = hashlib.sha256(diff.encode()).hexdigest()
        return {
            "base_sha": "a" * 40,
            "diff": diff,
            "diff_sha256": digest,
            "diff_bytes": len(diff.encode()),
            "verification": {
                "status": "passed",
                "name": "profile_verification",
                "diff_sha256": digest,
                "contract_sha256": self.driver.contract_sha256(
                    self.driver.VerificationPolicy.model_validate(
                        self.driver.verification("normal")
                    )
                ),
                "checks": [{"id": "tool-results", "status": "passed", "exit_code": 0}],
            },
        }

    def test_empty_final_page_preserves_cursor_and_proves_finished(self):
        result = self.driver.validate_trace(self.pages(), finished=True)
        self.assertTrue(result["sdk_finished"])
        self.assertEqual(result["sdk_event_count"], 1)

    def test_marker_or_uncaught_finished_never_proves_completion(self):
        for state, caught_up in (("running", True), ("finished", False)):
            with self.subTest(state=state, caught_up=caught_up):
                pages = self.pages()
                pages[-1].update(state=state, caught_up=caught_up)
                with self.assertRaisesRegex(RuntimeError, "sdk_completion_missing"):
                    self.driver.validate_trace(pages, finished=True)

    def test_duplicate_upstream_ids_are_rejected_before_sql_dedup(self):
        pages = self.pages()
        pages[-1]["events"] = copy.deepcopy(pages[0]["events"])
        with self.assertRaisesRegex(RuntimeError, "sdk_event_replayed"):
            self.driver.validate_trace(pages, finished=True)

    def test_discontinuous_request_and_response_cursors_are_rejected(self):
        for key, code in (
            ("request_cursor", "sdk_cursor_discontinuity"),
            ("response_cursor", "sdk_response_cursor_invalid"),
        ):
            with self.subTest(key=key):
                pages = self.pages()
                pages[-1][key] = "unseen"
                with self.assertRaisesRegex(RuntimeError, code):
                    self.driver.validate_trace(pages, finished=True)

    def test_cancelled_trace_does_not_invent_finished(self):
        self.assertFalse(
            self.driver.validate_trace(self.pages()[:1], finished=False)["sdk_finished"]
        )

    def test_correct_profile_result_is_verified(self):
        self.assertTrue(
            self.driver.validate_result(self.result(), "normal", "a" * 40)[
                "profile_verification_passed"
            ]
        )

    def test_success_flag_cannot_replace_exact_patch_or_profile_checks(self):
        for mutate in (
            lambda value: value.update(diff=value["diff"] + "+extra\n"),
            lambda value: value["verification"]["checks"][0].update(exit_code=1),
            lambda value: value["verification"].update(contract_sha256="b" * 64),
        ):
            value = self.result()
            mutate(value)
            with self.assertRaises(RuntimeError):
                self.driver.validate_result(value, "normal", "a" * 40)

    def test_proof_fault_masks_fallback_inspection_without_mutating_observation(self):
        proof = {
            "observed_state": "stopped",
            "proof": {key: True for key in self.driver.base.STOP_KEYS},
        }
        original = {"stop": proof, "fallback": [copy.deepcopy(proof)]}
        masked, observations = self.driver.mask_proofs(original, True)
        self.assertTrue(original["stop"]["proof"]["cpu_scope_gone"])
        self.assertFalse(masked["stop"]["proof"]["cpu_scope_gone"])
        self.assertFalse(masked["fallback"][0]["proof"]["cpu_scope_gone"])
        self.assertEqual(observations, [{"complete": True, "withheld": True}] * 2)
        restored, observations = self.driver.mask_proofs(original, False)
        self.assertEqual(restored, original)
        self.assertEqual(observations, [{"complete": True, "withheld": False}] * 2)

    def test_owned_children_stop_after_cleanup_observation_failure(self):
        harness = object.__new__(self.driver.Harness)
        harness.issued = [uuid4()]
        harness.run = Mock(side_effect=OSError("database unavailable"))
        harness.stop_children = Mock()
        harness.children = []
        harness.connector = SimpleNamespace(poll=lambda: 0)
        harness.node = SimpleNamespace(sandboxes=lambda: [])
        harness.host = SimpleNamespace(vms=lambda: [])
        harness.scalar = lambda _: 0
        result = harness.cleanup()
        harness.stop_children.assert_called_once_with()
        self.assertEqual(result["cleanup_failures"], 1)

    def test_surviving_owned_processes_fail_cleanup_gate(self):
        harness = object.__new__(self.driver.Harness)
        harness.issued = []
        harness.stop_children = lambda: None
        harness.children = [SimpleNamespace(poll=lambda: None)]
        harness.connector = SimpleNamespace(poll=lambda: None)
        harness.node = SimpleNamespace(sandboxes=lambda: [])
        harness.host = SimpleNamespace(vms=lambda: [])
        harness.scalar = lambda _: 0
        self.assertEqual(harness.cleanup()["cleanup_failures"], 2)

    def test_empty_approval_evidence_cannot_pass(self):
        for case in self.driver.CASES:
            with self.subTest(case=case), self.assertRaisesRegex(RuntimeError, "approval_count"):
                self.driver.validate_approvals([], [], [], case)

    def test_fault_requires_applied_approval_identity_and_order(self):
        decision = {"id": "one", "digest": "digest", "generation": 1}
        row = {"id": "one", "action_digest": "digest", "generation": 1, "status": "applied"}
        events = [
            {"type": "approval." + t, "payload": {"approval_id": "one"}}
            for t in ("requested", "decided", "applied")
        ]
        self.driver.validate_approvals([decision], [row], events, "cancel-in-flight")
        for key, value in (("status", "approved"), ("generation", 2), ("action_digest", "wrong")):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.driver.validate_approvals(
                    [decision], [{**row, key: value}], events, "cancel-in-flight"
                )
        with self.assertRaisesRegex(RuntimeError, "approval_order"):
            self.driver.validate_approvals([decision], [row], events[::-1], "cancel-in-flight")

    def test_fault_rejects_delivery_attempt_even_without_acknowledged_row(self):
        pending = [{"delivery": "none"}, {"delivery": "withheld"}]
        self.driver.validate_fault_delivery([], pending)
        for action in ("deliver", "ack"):
            with (
                self.subTest(action=action),
                self.assertRaisesRegex(RuntimeError, "delivery_attempted"),
            ):
                self.driver.validate_fault_delivery([{"kind": "tool", "action": action}], pending)
        with self.assertRaisesRegex(RuntimeError, "delivery_attempted"):
            self.driver.validate_fault_delivery([], [{"delivery": "pending"}])

    def test_mock_policy_uses_catalog_identity_and_production_bounds(self):
        mock = self.driver.Mock()
        try:
            mock.configure(
                {"canonical_repo": "https://github.com/example/different", "base_sha": "d" * 40}
            )
            policy = mock.policy()
            self.assertEqual(policy.repository_path, "/repos/example/different")
            self.assertEqual(policy.commit, "d" * 40)
            self.assertLessEqual(policy.idle_timeout, 5)
        finally:
            mock.close()

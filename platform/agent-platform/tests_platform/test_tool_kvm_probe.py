"""Probe schema and permission semantics; these tests make no KVM isolation claim."""

import importlib.util
import os
import runpy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from agent_platform.domain import Problem

SPEC = importlib.util.spec_from_file_location(
    "tool_kvm_probe", Path(__file__).resolve().parents[1] / "scripts/tool_kvm_probe.py"
)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class ToolKvmProbeTests(unittest.TestCase):
    def test_negative_evidence_requires_the_expected_authentication_failure(self):
        with patch.dict(sys.modules, {"tool_kvm_probe": probe}):
            driver = runpy.run_path(
                str(Path(__file__).resolve().parents[1] / "scripts/tool-broker-kvm.py")
            )

        def fail(status, code):
            def action():
                raise Problem(status, code)

            return action

        self.assertTrue(
            driver["deny"](fail(401, "tool_token_invalid"), (401, "tool_token_invalid"))
        )
        self.assertTrue(driver["deny"](fail(409, "tool_connector_operation_unconfirmed")))
        for status, code in ((503, "connector_unavailable"), (409, "unrelated_failure")):
            with self.subTest(status=status, code=code):
                with self.assertRaisesRegex(RuntimeError, "unexpected_negative_transport_failure"):
                    driver["deny"](fail(status, code))
        with self.assertRaisesRegex(RuntimeError, "forbidden_operation_accepted"):
            driver["deny"](lambda: None)

    def test_accepts_only_complete_literal_true_proof(self):
        proof = dict.fromkeys(probe.CHECKS, True)
        self.assertEqual(probe.validate_proof(proof), proof)
        for key in probe.CHECKS:
            for value in (False, 1, "true", None):
                with self.subTest(key=key, value=value):
                    with self.assertRaisesRegex(ValueError, "tool_isolation_proof_invalid"):
                        probe.validate_proof({**proof, key: value})
            with self.assertRaisesRegex(ValueError, "tool_isolation_proof_invalid"):
                probe.validate_proof({k: v for k, v in proof.items() if k != key})

    def test_rejects_additional_fields_and_non_objects(self):
        for value in (None, [], True, {**dict.fromkeys(probe.CHECKS, True), "secret": "value"}):
            with self.subTest(value=type(value).__name__):
                with self.assertRaisesRegex(ValueError, "tool_isolation_proof_invalid"):
                    probe.validate_proof(value)

    def test_guest_source_has_matching_contract_without_executing_probe(self):
        scope = {"__name__": "probe_contract_test"}
        exec(compile(probe.GUEST_PROBE, "guest_probe", "exec"), scope)
        self.assertEqual(scope["PROOF_PATH"], probe.PROOF_PATH)
        self.assertEqual(scope["CHECKS"], probe.CHECKS)

    def test_only_permission_denial_counts_as_protection(self):
        scope = {"__name__": "probe_contract_test"}
        exec(compile(probe.GUEST_PROBE, "guest_probe", "exec"), scope)

        def fail(error):
            def action():
                raise error

            return action

        self.assertTrue(scope["permission_denied"](fail(PermissionError())))
        self.assertFalse(scope["permission_denied"](lambda: None))
        for error in (FileNotFoundError(), ProcessLookupError(), OSError()):
            self.assertFalse(scope["permission_denied"](fail(error)))

    def test_write_probe_does_not_mutate_even_when_protection_is_absent(self):
        scope = {"__name__": "probe_contract_test"}
        exec(compile(probe.GUEST_PROBE, "guest_probe", "exec"), scope)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.json"
            original = b'{"policy":"unchanged"}'
            path.write_bytes(original)
            self.assertFalse(
                scope["permission_denied"](lambda: scope["open_only"](path, os.O_WRONLY))
            )
            self.assertEqual(path.read_bytes(), original)
            missing = path.with_name("absent.json")
            self.assertFalse(
                scope["permission_denied"](lambda: scope["open_only"](missing, os.O_WRONLY))
            )
            self.assertFalse(missing.exists())


if __name__ == "__main__":
    unittest.main()

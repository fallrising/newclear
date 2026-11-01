import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "antigravity_http_check", Path(__file__).parents[1] / "antigravity_http_check.py"
)
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


def valid_report():
    paths = {"inference": "/v1internal:generateContent", "discovery": "/v1internal:loadCodeAssist", "refresh": "/token"}
    return {
        "schema_version": 1, "test": check.HTTP_TEST, "status": "passed", "actual_gateway_http": True,
        "cleanup": {"gateway_task_joined": True, "fake_task_joined": True, "listeners_rebound": True,
                    "temporary_data_removed": True, "active_streams": 0},
        "stages": [{"stage": "fixture", "status": "passed"}],
        "counts": {"inference": 1, "discovery": 1, "refresh": 1, "unexpected_destinations": 0},
        "destinations": [{"sequence": i, "operation": name, "destination": "http://127.0.0.1:12345" + path,
                          "method": "POST", "synthetic_auth_validated": True, "synthetic_body_validated": True}
                         for i, (name, path) in enumerate(paths.items(), 1)],
    }


class AntigravityHttpCheckTests(unittest.TestCase):
    def test_binary_guard_prevents_any_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "test-binary"
            binary.write_bytes(b"changed synthetic binary")
            with patch.object(check, "run_native") as execute:
                report = check.check(binary, "0" * 64, root)
            execute.assert_not_called()
            self.assertEqual(report["error"], "test_binary_digest_mismatch")
            self.assertEqual(json.loads((root / "report.json").read_text()), report)

    def test_empty_or_wrong_test_binary_is_refused(self):
        for listing in (b"0 tests", f"{check.HTTP_TEST}: test\n".encode(),
                        f"{check.TRANSPORT_PREFIX}pure: test\n".encode()):
            with self.subTest(listing=listing), self.assertRaises(check.CheckFailure):
                check.discover_tests(listing)

    def test_skipped_or_zero_tests_never_pass(self):
        for summary in ("0 passed; 0 failed; 0 ignored;", "1 passed; 0 failed; 1 ignored;"):
            output = f"test expected ... ok\ntest result: ok. {summary}\n".encode()
            with self.subTest(summary=summary), self.assertRaises(check.CheckFailure):
                check.verify_results(output, ["expected"])

    def test_nocapture_report_is_accepted_with_exact_test_count(self):
        output = (f"test {check.HTTP_TEST} ... \n{check.REPORT_PREFIX}{json.dumps(valid_report())}\n"
                  "ok\ntest result: ok. 1 passed; 0 failed; 0 ignored;\n").encode()
        check.verify_results(output, [check.HTTP_TEST])
        self.assertEqual(check.parse_http_report(output), valid_report())

    def test_missing_duplicate_or_invalid_report_fails(self):
        for output in (b"", f"{check.REPORT_PREFIX}[]\n".encode(),
                       f"{check.REPORT_PREFIX}{{}}\n{check.REPORT_PREFIX}{{}}\n".encode(),
                       f"{check.REPORT_PREFIX}bad\n".encode()):
            with self.subTest(output=output), self.assertRaises(check.CheckFailure):
                check.parse_http_report(output)

    def test_report_rejects_cleanup_failure_count_mismatch_and_nonloopback_destination(self):
        for mutate in (
            lambda value: value["cleanup"].update(temporary_data_removed=False),
            lambda value: value["counts"].update(inference=2),
            lambda value: value["destinations"][0].update(destination="https://invalid.example/token"),
            lambda value: value["stages"][0].update(status="skipped"),
        ):
            value = copy.deepcopy(valid_report())
            mutate(value)
            with self.assertRaises(check.CheckFailure):
                check.parse_http_report((check.REPORT_PREFIX + json.dumps(value)).encode())

    def test_isolation_failure_prevents_http_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "test-binary"
            binary.write_bytes(b"synthetic binary")
            listing = f"{check.TRANSPORT_PREFIX}proof: test\n{check.HTTP_TEST}: test\n".encode()
            with patch.object(check, "run_native", side_effect=[(0, listing, 0), (101, b"failure", 0)]) as execute:
                report = check.check(binary, check.sha256(binary), root)
            self.assertEqual(execute.call_count, 2)
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["stage"], "isolation_proof")
            self.assertIsNone(report["http"])


if __name__ == "__main__":
    unittest.main()

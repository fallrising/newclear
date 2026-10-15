"""Behavioral tests for offline producer admission, using synthetic captures."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
import check_sources as tool


def config():
    return {"sources": [
        {"name": "release", "source_prefix": "urn:example:release:",
         "allowed_types": ["release.deploy.*"], "token_ref": "file:/synthetic/release.token"},
        {"name": "inspection", "source_prefix": "urn:example:inspection:",
         "allowed_types": ["inspection.check.*"], "expected_interval": "1h",
         "token_ref": "file:/synthetic/inspection.token"},
        {"name": "alertmanager", "source_prefix": "urn:signalhub:alertmanager:example:",
         "allowed_types": ["alertmanager.alert.*"],
         "token_ref": "file:/synthetic/alertmanager.token"},
    ], "rules": [], "subscriptions": [], "webhook_allowlist": []}


def event(name):
    return {"specversion": "1.0", "id": name + ":run-1:passed",
            "source": "urn:example:" + name + ":job",
            "type": "release.deploy.succeeded" if name == "release" else "inspection.check.passed",
            "time": "2026-10-14T10:00:00Z", "summary": "Synthetic result"}


def webhook(status="firing"):
    return {"version": "4", "receiver": "example:primary", "groupKey": "{}:{alertname=DiskSpace}",
            "status": status, "alerts": [{"status": status,
            "labels": {"alertname": "DiskSpace", "severity": "warning"},
            "annotations": {"summary": "Synthetic disk space alert"},
            "startsAt": "2026-10-14T10:00:00Z", "endsAt": "2026-10-14T11:00:00Z",
            "generatorURL": "https://prometheus.example.invalid/graph", "fingerprint": "0123456789abcdef"}]}


class SourceChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        for name, value in {"config": config(), "release": event("release"),
                            "inspection": event("inspection"),
                            "alertmanager-firing": webhook(),
                            "alertmanager-resolved": webhook("resolved")}.items():
            self.write(name, value)

    def write(self, name, value):
        (self.path / (name + ".json")).write_text(json.dumps(value), encoding="utf-8")

    def check(self):
        return tool.check_directory(self.path)

    def reject(self, text):
        with self.assertRaisesRegex(tool.SourceError, text):
            self.check()

    def test_default_package(self):
        result = tool.check_directory(tool.DEFAULT_DIRECTORY)
        self.assertEqual(result["files"], 4)
        self.assertEqual(result["new_identities"], 4)

    def test_valid_captures_and_cadence_warnings(self):
        result = self.check()
        self.assertEqual(result["new_identities"], 4)
        self.assertTrue(any("cadence" in warning for warning in result["warnings"]))

    def test_never_opens_credentials_or_network(self):
        original = Path.read_text
        def read(path, *args, **kwargs):
            self.assertEqual(path.suffix, ".json", "opened credential reference")
            return original(path, *args, **kwargs)
        with patch.object(Path, "read_text", read), patch("socket.socket", side_effect=AssertionError("network")):
            self.assertEqual(self.check()["new_identities"], 4)

    def test_cross_source_attribution_is_filename_bound(self):
        self.write("release", event("inspection"))
        self.reject("forbidden")

    def test_reserved_type_is_forbidden(self):
        value = event("release")
        value["type"] = "signalhub.source.silent"
        self.write("release", value)
        self.reject("forbidden")

    def test_reserved_source_is_forbidden_even_under_broad_scope(self):
        policy = config()
        policy["sources"][0]["source_prefix"] = "urn:signalhub:"
        self.write("config", policy)
        value = event("release")
        value["source"] = "urn:signalhub:sources:release"
        self.write("release", value)
        self.reject("forbidden")

    def test_duplicate_token_reference_is_rejected_without_reading(self):
        value = config()
        value["sources"][1]["token_ref"] = value["sources"][0]["token_ref"]
        self.write("config", value)
        self.reject("distinct token_ref")

    def test_missing_registered_source(self):
        value = config()
        value["sources"].pop()
        self.write("config", value)
        self.reject("three configured names")

    def test_saved_payload_repeat_and_optional_null_are_identical(self):
        value = event("release")
        value["originurl"] = None
        self.write("release-repeat", value)
        self.assertEqual(self.check()["duplicates"], 1)

    def test_release_and_inspection_mutations_conflict(self):
        for name in ("release", "inspection"):
            with self.subTest(name=name):
                value = event(name)
                value["time"] = "2026-10-14T10:01:00Z"
                self.write(name + "-retry", value)
                self.reject("immutable identity conflict")
                (self.path / (name + "-retry.json")).unlink()

    def test_alertmanager_identical_repeat(self):
        self.write("alertmanager-repeat", webhook())
        self.assertEqual(self.check()["duplicates"], 1)

    def test_alertmanager_retained_field_mutations_conflict(self):
        for field in ("annotations", "labels", "groupKey", "generatorURL"):
            with self.subTest(field=field):
                value = webhook()
                if field == "groupKey":
                    value[field] = "different-group"
                elif field in ("annotations", "labels"):
                    value["alerts"][0][field]["changed"] = "value"
                else:
                    value["alerts"][0][field] = "https://prometheus.example.invalid/new"
                self.write("alertmanager-repeat", value)
                self.reject("immutable identity conflict")

    def test_alertmanager_firing_unused_endsat_can_change(self):
        value = webhook()
        value["alerts"][0]["endsAt"] = "2026-10-14T12:00:00Z"
        self.write("alertmanager-repeat", value)
        self.assertEqual(self.check()["duplicates"], 1)

    def test_alertmanager_resolved_endsat_mutation_conflicts(self):
        value = webhook("resolved")
        value["alerts"][0]["endsAt"] = "2026-10-14T12:00:00Z"
        self.write("alertmanager-resolved-repeat", value)
        self.reject("immutable identity conflict")

    def test_mixed_invalid_members_report_member_index(self):
        value = webhook()
        value["alerts"].append(copy.deepcopy(value["alerts"][0]))
        value["alerts"][1]["status"] = "unknown"
        self.write("alertmanager-firing", value)
        self.reject("member 1.*invalid")

    def test_unknown_alert_fields_and_overlong_summary(self):
        value = webhook()
        value["alerts"][0]["unexpected"] = True
        self.write("alertmanager-firing", value)
        self.reject("member 0.*invalid")
        value = webhook()
        value["alerts"][0]["annotations"]["summary"] = "x" * 281
        self.write("alertmanager-firing", value)
        self.reject("summary")

    def test_empty_alerts_are_not_liveness(self):
        value = webhook()
        value["alerts"] = []
        self.write("alertmanager-empty", value)
        result = self.check()
        self.assertTrue(any("empty alerts" in warning for warning in result["warnings"]))
        self.assertEqual(result["new_identities"], 4)

    def test_invalid_envelope_and_large_batch(self):
        value = webhook()
        value["version"] = "3"
        self.write("alertmanager-firing", value)
        self.reject("envelope")
        value = webhook()
        value["alerts"] *= 101
        self.write("alertmanager-firing", value)
        self.reject("envelope")

    def test_receiver_scope_is_checked(self):
        value = webhook()
        value["receiver"] = "other:primary"
        self.write("alertmanager-firing", value)
        self.reject("forbidden")

    def test_identity_length_and_data_limit(self):
        value = webhook()
        value["alerts"][0]["fingerprint"] = "x" * 128
        self.write("alertmanager-firing", value)
        self.reject("id length")
        value = webhook()
        value["alerts"][0]["annotations"]["description"] = "x" * 16384
        self.write("alertmanager-firing", value)
        self.reject("data exceeds")

    def test_strict_json_and_missing_required_capture(self):
        (self.path / "release.json").write_text('{"id":"a","id":"b"}')
        self.reject("strict JSON")
        (self.path / "release.json").unlink()
        self.reject("missing required capture")

    def test_unknown_capture_is_not_silently_skipped(self):
        self.write("mystery", event("release"))
        self.reject("unknown capture")

    def test_outer200_cannot_hide_member409(self):
        self.write("alertmanager-firing.response", {"http_status": 200, "body": {"results": [
            {"index": 0, "status": 202, "seq": 1},
            {"index": 1, "status": 409, "error": {"code": "event_conflict", "message": "conflict"}}]}})
        self.reject("member 1.*409")

    def test_response_receipts_require_seq_and_duplicate(self):
        self.write("release.response", {"http_status": 200, "body": {"seq": 1, "duplicate": True}})
        self.write("alertmanager-firing.response", {"http_status": 200, "body": {"results": [
            {"index": 0, "status": 200, "seq": 2, "duplicate": True}]}})
        self.check()
        self.write("release.response", {"http_status": 200, "body": {"seq": 1}})
        self.reject("duplicate")

    def test_empty_response_does_not_prove_liveness(self):
        self.write("alertmanager-empty.response", {"http_status": 200, "body": {"results": []}})
        self.assertTrue(any("empty results" in warning for warning in self.check()["warnings"]))

    def test_truncated_alerts_block_complete_acceptance(self):
        value = webhook()
        value["truncatedAlerts"] = 1
        self.write("alertmanager-firing", value)
        self.reject("truncated alerts")

    def test_common_fields_do_not_mutate_mapped_identity(self):
        value = webhook()
        value["commonAnnotations"] = {"description": "envelope-only change"}
        value["status"] = "resolved"
        self.write("alertmanager-repeat", value)
        self.assertEqual(self.check()["duplicates"], 1)

    def test_empty_cloudevents_batch_is_not_single_event(self):
        self.write("release", [])
        self.reject("invalid CloudEvents")

    def test_non_json_numbers_and_depth_are_rejected(self):
        (self.path / "release.json").write_text('{"data":{"value":NaN}}')
        self.reject("strict JSON")
        (self.path / "release.json").write_text("[" * 65 + "0" + "]" * 65)
        self.reject("nesting exceeds")

    def test_unpaired_surrogates_in_all_capture_strings_are_rejected(self):
        for location in ("fingerprint", "ignored-value", "ignored-key"):
            for invalid in ("\ud800", "\udfff"):
                with self.subTest(location=location, codepoint=ord(invalid)):
                    value = webhook()
                    if location == "fingerprint":
                        value["alerts"][0]["fingerprint"] = invalid
                    elif location == "ignored-value":
                        value["commonAnnotations"] = {"note": invalid}
                    else:
                        value["commonAnnotations"] = {invalid: "note"}
                    self.write("alertmanager-firing", value)
                    self.reject("Unicode")

    def test_valid_surrogate_pair_is_scalar_unicode(self):
        value = webhook()
        value["alerts"][0]["fingerprint"] = "valid-\U0001f680"
        value["commonAnnotations"] = {"\U0001f680": "\U0001f680"}
        # json.dumps writes an escaped UTF-16 pair; strict decoding must accept it.
        self.write("alertmanager-firing", value)
        self.assertEqual(self.check()["new_identities"], 4)

    def test_ignored_envelope_numbers_still_require_jcs_input(self):
        for literal in ("9007199254740992", "-9007199254740992", "1e400"):
            with self.subTest(literal=literal):
                raw = json.dumps(webhook())[:-1] + ', "unused": ' + literal + '}'
                (self.path / "alertmanager-firing.json").write_text(raw)
                self.reject("JCS")

    def test_safe_integer_boundaries_and_large_finite_floats(self):
        value = webhook()
        value["unused"] = [9007199254740991, -9007199254740991, 1e30, -1e30]
        self.write("alertmanager-firing", value)
        self.assertEqual(self.check()["new_identities"], 4)

    def test_failed_member_statuses_and_false_indices(self):
        for status in (400, 403, 409, 503):
            with self.subTest(status=status):
                self.write("alertmanager-firing.response", {"http_status": 200, "body": {
                    "results": [{"index": 0, "status": status}]}})
                self.reject("member 0.*" + str(status))
        self.write("alertmanager-firing.response", {"http_status": 200, "body": {
            "results": [{"index": False, "status": 202, "seq": 1}]}})
        self.reject("index")

    def test_payload_values_do_not_leak_in_validation_errors(self):
        value = event("release")
        value["time"] = "private-sensitive-placeholder"
        self.write("release", value)
        with self.assertRaises(tool.SourceError) as failure:
            self.check()
        self.assertNotIn("private-sensitive-placeholder", str(failure.exception))
        self.write("release", event("release"))
        self.write("alertmanager-firing.response", {"http_status": 200, "body": {
            "results": [{"index": 0, "status": "private-sensitive-placeholder"}]}})
        with self.assertRaises(tool.SourceError) as failure:
            self.check()
        self.assertNotIn("private-sensitive-placeholder", str(failure.exception))

    def test_cli_directory_exit_and_explicit_failure(self):
        command = [sys.executable, str(tool.ROOT / "scripts/check_sources.py"), str(self.path)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("4 identities", result.stdout)
        value = event("release")
        value["summary"] = "changed"
        self.write("release-repeat", value)
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("immutable identity conflict", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)

"""Failure artifacts must survive absent evidence without exporting untrusted text."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import failure_diagnostics as diagnostics

ROOT = Path(__file__).resolve().parents[1]


class DiagnosticCLITests(unittest.TestCase):
    def test_ci_emits_unknown_for_missing_report_without_exposing_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = subprocess.run(
                [sys.executable, str(ROOT / "failure_diagnostics.py"), "ci",
                 "--directory", str(root), "--profiles", "storage"],
                capture_output=True, timeout=5,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            path = root / "open-compute-diagnostics" / "storage.json"
            value = json.loads(path.read_text())
            self.assertEqual(value["result"], "unknown")
            self.assertEqual(value["evidence"], "missing")
            self.assertIsNone(value["exit_code"])
            self.assertNotIn(str(root), path.read_text())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


class ProjectionTests(unittest.TestCase):
    def test_record_keeps_three_failure_slots_and_never_copies_exception_text(self):
        record = diagnostics.Recorder("storage", "a" * 40)
        secret = "/private/secret-key-DO-NOT-PUBLISH"
        record.capture("original", "cold_after_writes", RuntimeError(secret))
        record.capture("original", "evidence", RuntimeError("schema"))
        record.capture("cleanup", "cleanup", RuntimeError("schema"))
        record.capture("evidence", "evidence", OSError(secret))
        value = record.finish({"result": "failed", "phase": "evidence", "evidence_file_written": False}, 1)
        self.assertEqual(value["failures"]["original"]["phase"], "cold_after_writes")
        self.assertEqual(value["failures"]["original"]["category"], "unknown")
        self.assertEqual(value["failures"]["cleanup"]["category"], "schema")
        self.assertNotIn(secret, json.dumps(value))

    def test_extra_fields_invalid_enums_numbers_and_observation_are_refused(self):
        good = diagnostics.blank("storage")
        for field, value in [("extra", "SECRET"), ("schema_version", True),
                ("exit_code", True), ("exit_code", 256), ("exit_code", float("nan")),
                ("phase", "/private/path"), ("profile", "secret"),
                ("report_written", 1), ("source_commit", "secret")]:
            with self.subTest(field=field, value=value):
                bad = dict(good, **{field: value})
                with self.assertRaises(diagnostics.DiagnosticError): diagnostics.project(bad)
        for bad in [dict(phase="cleanup", category="schema", observation="SECRET"),
                dict(phase="cleanup", category="schema", observation=None, argv="SECRET")]:
            with self.subTest(bad=bad):
                value = diagnostics.blank("storage"); value["failures"]["cleanup"] = bad
                with self.assertRaises(diagnostics.DiagnosticError): diagnostics.project(value)

    def test_normal_report_unrelated_secret_data_is_never_serialized(self):
        report = {"result": "failed", "phase": "bootstrap", "error": {"token": "SECRET"},
            "diagnostics": ["/private/SECRET"], "argv": ["SECRET"], "environment": {"secret": "SECRET"}}
        value = diagnostics.from_report(report, "trial")
        self.assertEqual(value["failures"]["original"]["category"], "unknown")
        self.assertNotIn("SECRET", json.dumps(value))

    def test_all_reported_profiles_keep_original_cleanup_and_evidence_distinct(self):
        for profile in ("restore", "crash", "trial", "storage"):
            with self.subTest(profile=profile):
                record = diagnostics.Recorder(profile)
                record.capture("original", "bootstrap", RuntimeError("ownership"))
                record.capture("cleanup", "cleanup", RuntimeError("schema"))
                record.capture("evidence", "evidence", RuntimeError("evidence"))
                value = record.finish({"result":"failed", "phase":"evidence"}, 1)
                self.assertEqual(value["failures"]["original"], {"phase":"bootstrap", "category":"ownership", "observation":None})
                self.assertEqual(value["failures"]["cleanup"]["category"], "schema")
                self.assertEqual(value["failures"]["evidence"]["category"], "evidence")
                self.assertEqual(value["exit_code"], 1)

    def test_pass_cannot_contain_failure_or_nonzero_exit(self):
        value = diagnostics.blank("restore"); value["result"] = "passed"; value["exit_code"] = 1
        with self.assertRaises(diagnostics.DiagnosticError): diagnostics.project(value)


class FileBoundaryTests(unittest.TestCase):
    def test_safe_report_is_read_but_forged_source_identity_is_not_exported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); folder = root / diagnostics.PROFILES["storage"]; folder.mkdir(mode=0o700)
            path = folder / "report.json"
            path.write_text(json.dumps({"result":"failed", "phase":"cold_after_writes", "error":"ownership",
                "harness_commit":"f" * 40, "diagnostics":["SECRET"], "evidence_file_written":True}))
            path.chmod(0o600)
            value = diagnostics.collect(root, "storage")
            self.assertEqual(value["evidence"], "report")
            self.assertEqual(value["phase"], "cold_after_writes")
            self.assertEqual(value["failures"]["original"]["category"], "ownership")
            self.assertNotEqual(value["source_commit"], "f" * 40)
            self.assertNotIn("SECRET", json.dumps(value))

    def test_parent_symlink_cannot_supply_a_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); private = root / "private"; private.mkdir(mode=0o700)
            (private / "report.json").write_text('{"result":"passed","phase":"complete"}'); (private / "report.json").chmod(0o600)
            (root / diagnostics.PROFILES["storage"]).symlink_to(private, target_is_directory=True)
            self.assertEqual(diagnostics.collect(root, "storage")["evidence"], "invalid")

    def test_missing_corrupt_duplicate_extra_record_and_oversize_fail_closed(self):
        cases = [b"{", b'{"result":"failed","result":"passed"}', b'{"result":NaN}', b'{"result":Infinity}', b'{"result":"failed","ignored":1e999}', b"[" * 2000 + b"]" * 2000,
                 b"x" * (diagnostics.INPUT_LIMIT + 1)]
        for payload in cases:
            with self.subTest(payload=payload[:50]), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); directory = root / diagnostics.PROFILES["storage"]; directory.mkdir(mode=0o700)
                path = directory / "report.json"; path.write_bytes(payload); path.chmod(0o600)
                self.assertEqual(diagnostics.collect(root, "storage")["evidence"], "invalid")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); directory = root / diagnostics.PROFILES["storage"]; directory.mkdir(mode=0o700)
            value = diagnostics.blank("storage"); value["secret"] = "SECRET"
            (directory / "failure-diagnostics.json").write_text(json.dumps(value)); (directory / "failure-diagnostics.json").chmod(0o600)
            self.assertEqual(diagnostics.collect(root, "storage")["evidence"], "invalid")

    def test_symlink_multilink_and_unsafe_input_are_refused(self):
        for mode in ("symlink", "hardlink", "unsafe"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); directory = root / diagnostics.PROFILES["storage"]; directory.mkdir(mode=0o700)
                source = root / "source"; source.write_text('{"result":"failed"}'); source.chmod(0o600)
                target = directory / "report.json"
                if mode == "symlink": target.symlink_to(source)
                elif mode == "hardlink": os.link(source, target)
                else: source.rename(target); target.chmod(0o666)
                self.assertEqual(diagnostics.collect(root, "storage")["evidence"], "invalid")

    def test_publication_is_exclusive_and_failure_does_not_mutate_runtime_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); target = root / "diagnostic.json"
            diagnostics.publish(target, diagnostics.blank("storage")); before = target.read_bytes()
            with self.assertRaises(FileExistsError): diagnostics.publish(target, diagnostics.blank("storage"))
            self.assertEqual(target.read_bytes(), before)
            report = {"result":"failed", "phase":"cleanup", "evidence_file_written":False}
            with mock.patch.object(diagnostics, "publish", side_effect=OSError("SECRET")):
                self.assertFalse(diagnostics.write_record(root, diagnostics.Recorder("storage"), report, 1))
            self.assertEqual(report, {"result":"failed", "phase":"cleanup", "evidence_file_written":False})

    def test_unsafe_publication_parent_and_output_symlink_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); unsafe = root / "unsafe"; unsafe.mkdir(mode=0o777); unsafe.chmod(0o777)
            with self.assertRaises(diagnostics.DiagnosticError): diagnostics.publish(unsafe / "x", diagnostics.blank("storage"))
            target = root / "keep"; target.write_text("KEEP"); (root / "out").symlink_to(target)
            with self.assertRaises(FileExistsError): diagnostics.publish(root / "out", diagnostics.blank("storage"))
            self.assertEqual(target.read_text(), "KEEP")


if __name__ == "__main__":
    unittest.main()

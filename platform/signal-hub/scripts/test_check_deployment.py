"""Synthetic, stdlib-only deployment contract and actual launch-template probes."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from check_deployment import load, validate

ROOT = Path(__file__).resolve().parents[1]


def setUpModule():
    # A clean checkout has no ignored run directory yet (including CI).
    (ROOT / ".local/run").mkdir(parents=True, exist_ok=True)


def packet():
    return json.loads((ROOT / "deployment/intent.example.json").read_text())


def real_packet():
    p = packet()
    p["evidence_kind"] = "real"
    p["authorization_ref"] = "private:approved-drill"
    for name in p["target"]:
        if name.endswith("_ref"):
            p["target"][name] = "private:" + name
        elif name.endswith("_sha256"):
            p["target"][name] = "a" * 64
    for g in p["host_gates"].values():
        g.update(status="passed", evidence={"artifact_ref": "private:reviewed-host-proof"})
    values = {
        "seven_days": {"started_at": "2026-01-01T00:00:00Z", "ended_at": "2026-01-08T00:00:00Z", "sources": ["release", "inspection", "alertmanager"], "continuous_observation": True, "unexpected_409": 0, "artifact_ref": "private:timeline-receipts-gaps"},
        "producer_silence": {"source": "inspection", "expected_interval_seconds": 60, "last_received_at": "2026-01-08T00:00:00Z", "stopped_at": "2026-01-08T00:00:01Z", "silent_at": "2026-01-08T00:02:01Z", "phone_received_at": "2026-01-08T00:02:10Z", "artifact_ref": "private:authorized-silence-phone"},
        "hub_outage": {"stopped_at": "2026-01-08T01:00:00Z", "phone_received_at": "2026-01-08T01:03:00Z", "independent_path": True, "artifact_ref": "private:outage-phone"},
        "yesterday_restore": {"snapshot_at": "2026-01-07T23:00:00Z", "restored_at": "2026-01-08T02:00:00Z", "isolated": True, "fresh_destination": True, "integrity_verified": True, "queue_verified": True, "artifact_ref": "private:snapshot-manifest-restore"},
    }
    for key, value in values.items():
        p["m6"][key].update(status="passed", evidence=value)
    return p


class WorksheetTests(unittest.TestCase):
    def reject(self, p, message, acceptance=False):
        with self.assertRaisesRegex(ValueError, message):
            validate(p, acceptance)

    def test_pending_preparation(self):
        validate(packet())

    def test_synthetic_never_accepts(self):
        self.reject(packet(), "real evidence", True)

    def test_complete_submitted_structure(self):
        validate(real_packet(), True)  # Structural test, no claim these artifacts exist.

    def test_premature_seven_days(self):
        p = real_packet()
        p["m6"]["seven_days"]["evidence"]["ended_at"] = "2026-01-07T23:59:59Z"
        self.reject(p, "seven elapsed days", True)

    def test_missing_authorization(self):
        p = real_packet(); p["authorization_ref"] = None
        self.reject(p, "authorization", True)

    def test_missing_phone(self):
        for key in ("producer_silence", "hub_outage"):
            with self.subTest(key=key):
                p = real_packet(); del p["m6"][key]["evidence"]["phone_received_at"]
                self.reject(p, "phone_received_at", True)

    def test_hub_outage_budget_and_pending(self):
        p = real_packet(); p["m6"]["hub_outage"]["evidence"]["phone_received_at"] = "2026-01-08T01:05:01Z"
        self.reject(p, "300 seconds", True)
        p = real_packet(); p["m6"]["hub_outage"] = {"status": "pending", "evidence": None}
        self.reject(p, "pending", True)

    def test_wrong_snapshot_day(self):
        p = real_packet(); p["m6"]["yesterday_restore"]["evidence"]["snapshot_at"] = "2026-01-08T01:00:00Z"
        self.reject(p, "previous UTC day", True)

    def test_silent_boundary(self):
        p = real_packet(); p["m6"]["producer_silence"]["evidence"]["silent_at"] = "2026-01-08T00:02:00Z"
        self.reject(p, "strictly greater", True)

    def test_root_and_bad_paths(self):
        for key, value in (("service_uid", 0), ("binary", "relative"), ("db", "/srv/example/../hub.sqlite"), ("owner_token_ref", "literal-token"), ("port", True)):
            with self.subTest(key=key):
                p = packet(); p["launch"][key] = value
                self.reject(p, key)

    def test_forged_preparation_and_missing_field(self):
        p = packet(); p["host_gates"]["non_root"] = {"status": "passed", "evidence": {"artifact_ref": "example:fake"}}
        self.reject(p, "synthetic")
        p = packet(); del p["target"]["rollback_ref"]
        self.reject(p, "rollback_ref")

    def test_bad_timestamp_and_monitor(self):
        p = real_packet(); p["m6"]["hub_outage"]["evidence"]["stopped_at"] = "2026-01-08"
        self.reject(p, "UTC timestamp", True)
        p = packet(); p["monitor"]["outside_host"] = False
        self.reject(p, "outside_host")

    def test_required_source_and_digests(self):
        p = real_packet(); p["m6"]["seven_days"]["evidence"]["sources"] = ["release", "inspection"]
        self.reject(p, "all three", True)
        p = real_packet(); p["target"]["binary_sha256"] = "0" * 64
        self.reject(p, "actual bytes", True)

    def test_strict_json_and_unknown_fields(self):
        with tempfile.TemporaryDirectory(prefix="worksheet-", dir=ROOT / ".local/run") as tmp:
            f = Path(tmp) / "packet.json"
            for bad in ('{"version":1,"version":1}', '{"x":NaN}', '{"x":Infinity}'):
                f.write_text(bad)
                with self.assertRaises(ValueError):
                    load(f)
        p = packet(); p["secret"] = "synthetic-placeholder"
        self.reject(p, "fields differ")


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="launch-", dir=ROOT / ".local/run")
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.binary = self.base / "fake binary"
        self.binary.write_text('#!/bin/sh\n/usr/bin/python3 -c \'import json,os,sys;print(json.dumps({"args":sys.argv[1:],"cwd":os.getcwd(),"mask":os.umask(0)}))\' "$@"\n')
        self.binary.chmod(0o700)
        for f in ("config", "owner", "readonly"):
            (self.base / f).write_text("synthetic-only\n")
        self.env = {"PATH": "/usr/bin:/bin", "PORT": "8081", "SIGNALHUB_SERVICE_UID": str(os.getuid()), "SIGNALHUB_BINARY": str(self.binary), "SIGNALHUB_CONFIG": str(self.base / "config"), "SIGNALHUB_DB": str(self.base / "hub.sqlite"), "SIGNALHUB_OWNER_TOKEN_REF": "file:" + str(self.base / "owner"), "SIGNALHUB_READONLY_TOKEN_REF": "file:" + str(self.base / "readonly")}

    def run_launch(self, *args):
        return subprocess.run(["/bin/sh", str(ROOT / "deployment/launch.sh"), *args], env=self.env, cwd=self.base, capture_output=True, text=True)

    def test_exact_args_loopback_umask(self):
        r = self.run_launch()
        self.assertEqual(r.returncode, 0, r.stderr)
        value = json.loads(r.stdout)
        self.assertEqual(value["args"], ["-config", self.env["SIGNALHUB_CONFIG"], "-db", self.env["SIGNALHUB_DB"], "-owner-token-ref", self.env["SIGNALHUB_OWNER_TOKEN_REF"], "-listen", "127.0.0.1:8081", "-readonly-token-ref", self.env["SIGNALHUB_READONLY_TOKEN_REF"]])
        self.assertEqual(value["mask"], 0o77)
        self.assertFalse((self.base / "hub.sqlite").exists())

    def test_configured_root_refused(self):
        self.env["SIGNALHUB_SERVICE_UID"] = "0"
        r = self.run_launch(); self.assertNotEqual(r.returncode, 0); self.assertIn("non-root", r.stderr)

    def test_missing_and_unsafe_inputs(self):
        cases = [("SIGNALHUB_CONFIG", str(self.base / "missing")), ("SIGNALHUB_BINARY", "./relative"), ("SIGNALHUB_OWNER_TOKEN_REF", "raw-secret"), ("SIGNALHUB_DB", str(self.base / "missing/hub.sqlite")), ("PORT", "8081;touch hacked"), ("SIGNALHUB_SERVICE_UID", str(os.getuid() + 1))]
        for key, value in cases:
            with self.subTest(key=key):
                old = self.env[key]; self.env[key] = value
                self.assertNotEqual(self.run_launch().returncode, 0)
                self.env[key] = old
        del self.env["SIGNALHUB_CONFIG"]
        self.assertNotEqual(self.run_launch().returncode, 0)
        self.assertFalse((self.base / "hacked").exists())

    def test_arguments_rejected(self):
        self.assertNotEqual(self.run_launch("--download").returncode, 0)

    def test_symlink_parent_refused(self):
        link = self.base / "alias"
        link.symlink_to(self.base, target_is_directory=True)
        self.env["SIGNALHUB_DB"] = str(link / "hub.sqlite")
        r = self.run_launch()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("symlink", r.stderr)

    def test_optional_readonly_and_shell_literal_paths(self):
        del self.env["SIGNALHUB_READONLY_TOKEN_REF"]
        literal = self.base / "config;$(touch hacked)"
        literal.write_text("synthetic-only\n")
        self.env["SIGNALHUB_CONFIG"] = str(literal)
        r = self.run_launch()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(str(literal), json.loads(r.stdout)["args"])
        self.assertFalse((self.base / "hacked").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)

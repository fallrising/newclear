"""Synthetic credential boundary tests; never read real credentials or use HTTP."""
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cc_quota


class CredentialTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name, value in (("CLAUDE_DIR", str(self.root)), ("DB_PATH", str(self.root / "quota.db"))):
            patch = mock.patch.object(cc_quota, name, value)
            patch.start()
            self.addCleanup(patch.stop)
        patch = mock.patch.dict(os.environ)
        patch.start()
        self.addCleanup(patch.stop)
        os.environ.pop("CC_QUOTA_MOCK", None)

    def fixture(self, value):
        (self.root / ".credentials.json").write_text(json.dumps(value))

    def test_mac_uses_only_native_keychain(self):
        value = '{"claudeAiOauth":{"accessToken":"synthetic-keychain-token"}}'
        with mock.patch.object(sys, "platform", "darwin"), \
                mock.patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, value, "")) as run, \
                mock.patch("builtins.open", side_effect=AssertionError("must not open credential file")):
            self.assertEqual(cc_quota.read_token(), "synthetic-keychain-token")
        self.assertEqual(run.call_args.args[0], ["/usr/bin/security", "find-generic-password", "-s", "Claude Code-credentials", "-w"])
        self.assertEqual(run.call_args.kwargs["timeout"], 10)

    def test_failed_keychain_never_falls_back_to_file(self):
        self.fixture({"claudeAiOauth": {"accessToken": "synthetic-file-token"}})
        with mock.patch.object(sys, "platform", "darwin"), \
                mock.patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "private diagnostic")), \
                mock.patch("builtins.open", side_effect=AssertionError("must not fall back")):
            with self.assertRaises(cc_quota.CredentialError) as result:
                cc_quota.read_token()
        self.assertEqual(result.exception.code, "keychain_unavailable")
        self.assertNotIn("private diagnostic", str(result.exception))

    def test_keychain_timeout_has_safe_actionable_code(self):
        error = subprocess.TimeoutExpired(["security", "synthetic-secret"], 10, output="synthetic-secret")
        with mock.patch.object(sys, "platform", "darwin"), mock.patch.object(subprocess, "run", side_effect=error):
            with self.assertRaises(cc_quota.CredentialError) as result:
                cc_quota.read_token()
        self.assertEqual(result.exception.code, "keychain_timeout")
        self.assertNotIn("synthetic-secret", cc_quota.safe_error("fetch failed", result.exception))

    def test_linux_file_source_remains_supported(self):
        self.fixture({"claudeAiOauth": {"accessToken": "synthetic-file-token"}})
        with mock.patch.object(sys, "platform", "linux"), mock.patch.object(subprocess, "run", side_effect=AssertionError("no Keychain on Linux")):
            self.assertEqual(cc_quota.read_token(), "synthetic-file-token")

    def test_unreadable_file_has_safe_actionable_code(self):
        with mock.patch.object(sys, "platform", "linux"):
            with self.assertRaises(cc_quota.CredentialError) as result:
                cc_quota.read_token()
        self.assertEqual(result.exception.code, "file_unavailable")
        self.assertNotIn(str(self.root), str(result.exception))

    def test_invalid_credentials_fail_before_http(self):
        invalid = [None, [], {}, {"claudeAiOauth": None}, {"claudeAiOauth": []}]
        invalid += [{"claudeAiOauth": {"accessToken": token}} for token in
                    (None, 1, True, [], {}, "", " ", " leading", "embedded\nheader", "nonascii-雪", "control\x00token")]
        with mock.patch.object(sys, "platform", "linux"), \
                mock.patch.object(cc_quota.urllib.request, "urlopen", side_effect=AssertionError("HTTP must not run")) as http:
            for value in invalid:
                with self.subTest(value=value):
                    self.fixture(value)
                    with self.assertRaises(cc_quota.CredentialError) as result:
                        cc_quota.fetch_usage()
                    self.assertEqual(result.exception.code, "invalid_credentials")
            (self.root / ".credentials.json").write_text('{"synthetic-secret":')
            with self.assertRaises(cc_quota.CredentialError):
                cc_quota.fetch_usage()
            http.assert_not_called()

    def test_credential_failure_is_recorded_without_raw_or_snapshot(self):
        self.fixture({"claudeAiOauth": {"accessToken": None}, "private": "synthetic-secret"})
        with mock.patch.object(sys, "platform", "linux"), \
                mock.patch.object(cc_quota, "notify"), \
                mock.patch.object(cc_quota.urllib.request, "urlopen", side_effect=AssertionError("HTTP must not run")), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cc_quota.cmd_collect(argparse.Namespace(no_tokens=True, verbose=False)), 1)
        with contextlib.closing(sqlite3.connect(cc_quota.DB_PATH)) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM snapshots").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT count(*) FROM raw").fetchone()[0], 0)
            message = conn.execute("SELECT message FROM errors").fetchone()[0]
        self.assertIn("invalid_credentials", message)
        self.assertNotIn("synthetic-secret", message)


if __name__ == "__main__":
    unittest.main()

"""Real macOS tools, synthetic inputs only; no login, usage HTTP or notifications."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import uuid

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))
sys.path.insert(0, str(SOURCE / "tests"))
import cc_quota
import test_install


class NativeMacTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform != "darwin":
            raise RuntimeError("native checks require macOS; run the offline suite on other platforms")

    def test_notification_script_compiles_with_native_applescript(self):
        # Capture exactly what notify would execute, but never deliver a notification.
        with mock.patch.object(subprocess, "run") as run:
            cc_quota.notify('Claude 額度 "測試"', '剩餘 10%\n路徑 \\ fixture')
        script = run.call_args.args[0][-1]
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "notification.applescript"
            compiled = Path(temp) / "notification.scpt"
            source.write_text(script, encoding="utf-8")
            result = subprocess.run(["/usr/bin/osacompile", "-o", str(compiled), str(source)],
                                    capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertGreater(compiled.stat().st_size, 0)

    def test_installer_plist_is_accepted_by_native_parser(self):
        fixture = test_install.InstallerTest("test_plist_escapes_paths_and_uses_selected_python")
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        result = fixture.install()  # launchctl remains a stub; nothing is registered.
        self.assertEqual(result.returncode, 0, result.stderr)
        plist = fixture.home / "Library/LaunchAgents/io.github.fallrising.cc-quota.plist"
        result = subprocess.run(["/usr/bin/plutil", "-lint", "--", str(plist)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(fixture.plist()["StartInterval"], 3600)
        self.assertEqual(fixture.calls.read_text().splitlines(), ["bootout", "bootstrap"])

    def test_absent_synthetic_keychain_service_fails_closed(self):
        # Use a unique nonexistent service. Never query Claude's real service or
        # create, unlock, modify, export or change a user's Keychain/search list.
        missing_service = "cc-quota-native-missing-" + uuid.uuid4().hex
        native_run = subprocess.run

        def query_missing_service(args, **kwargs):
            self.assertEqual(args, ["/usr/bin/security", "find-generic-password", "-s", "Claude Code-credentials", "-w"])
            command = list(args)
            command[3] = missing_service
            return native_run(command, **kwargs)

        with mock.patch.object(subprocess, "run", side_effect=query_missing_service), \
                mock.patch("builtins.open", side_effect=AssertionError("credential-file fallback is forbidden")):
            with self.assertRaises(cc_quota.CredentialError) as result:
                cc_quota.read_token()
        self.assertEqual(result.exception.code, "keychain_unavailable")
        self.assertNotIn(missing_service, str(result.exception))


if __name__ == "__main__":
    unittest.main()

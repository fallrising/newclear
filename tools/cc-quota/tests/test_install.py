"""Offline installer contract; fake launchctl never starts a real job."""
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(os.environ.get("CC_QUOTA_TEST_SOURCE", Path(__file__).resolve().parents[1]))

class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.home = self.root / 'home & <quota> "test"'
        self.home.mkdir()
        self.bin = self.root / "stubs"
        self.bin.mkdir()
        self.calls = self.root / "launchctl.calls"
        self.env = {"HOME": str(self.home), "PATH": str(self.bin) + os.pathsep + str(Path(sys.executable).parent) + os.pathsep + os.defpath,
                    "TMPDIR": str(self.root), "INSTALL_TEST_CALLS": str(self.calls)}
        self.stub("uname", "echo Darwin")
        self.stub("launchctl", 'printf "%s\\n" "$1" >> "$INSTALL_TEST_CALLS"; exit 0')

    def stub(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + body + "\n")
        path.chmod(0o755)

    def install(self):
        return subprocess.run(["bash", str(SOURCE / "install.sh")], env=self.env, text=True, capture_output=True, timeout=15)

    def plist(self):
        with (self.home / "Library/LaunchAgents/io.github.fallrising.cc-quota.plist").open("rb") as f:
            return plistlib.load(f)

    def test_non_macos_refused_before_any_install_writes(self):
        self.stub("uname", "echo Linux")
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse(self.calls.exists())

    def test_plist_escapes_paths_and_uses_selected_python(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        plist = self.plist()
        self.assertEqual(plist["ProgramArguments"], [sys.executable, str(self.home / ".local/bin/cc_quota.py"), "collect"])
        self.assertEqual(plist["StartInterval"], 3600)
        self.assertIs(plist["RunAtLoad"], True)
        self.assertEqual(plist["StandardErrorPath"], str(self.home / ".local/share/cc-quota/collect.err"))
        self.assertEqual(self.calls.read_text().splitlines(), ["bootout", "bootstrap"])

    def test_launchd_preserves_only_supported_settings(self):
        self.env.update({"CC_QUOTA_DB": "~/quota & data/q.db", "CLAUDE_CONFIG_DIR": "~/claude <config>",
                         "CC_QUOTA_PACE_HIGH": "1.4", "CC_QUOTA_PACE_LOW": "0.6", "CC_QUOTA_REMAIN_MIN": "12",
                         "CC_QUOTA_MOCK": "/never/persist/mock.json", "ANTHROPIC_API_KEY": "synthetic-never-persist"})
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.plist()["EnvironmentVariables"], {
            "CC_QUOTA_DB": str(self.home / "quota & data/q.db"), "CLAUDE_CONFIG_DIR": str(self.home / "claude <config>"),
            "CC_QUOTA_PACE_HIGH": "1.4", "CC_QUOTA_PACE_LOW": "0.6", "CC_QUOTA_REMAIN_MIN": "12"})

    def test_failed_bootstrap_does_not_claim_success(self):
        self.stub("launchctl", 'if [ "$1" = bootstrap ]; then exit 7; fi; exit 0')
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("已安裝", result.stdout)

if __name__ == "__main__":
    unittest.main()

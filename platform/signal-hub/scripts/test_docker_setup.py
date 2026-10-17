"""Behavioral checks for private, non-overwriting Docker initialization."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "deployment/docker/init.py"
spec = importlib.util.spec_from_file_location("docker_init", SCRIPT)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="signalhub-setup-")
        self.addCleanup(self.tmp.cleanup)
        self.parent = Path(self.tmp.name)
        self.state = self.parent / "private"

    def initialize(self, path=None, port=8080):
        with patch.object(os, "getuid", return_value=1001), patch.object(os, "geteuid", return_value=1001), patch.object(os, "getgid", return_value=1002):
            setup.initialize(str(self.state if path is None else path), port)

    def test_private_distinct_credentials_and_single_source(self):
        self.initialize(port=18081)
        for path in [self.state, *self.state.rglob("*")]:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700 if path.is_dir() else 0o600)
        tokens = [(self.state / "secrets" / (role + ".token")).read_text().strip() for role in ("owner", "readonly", "source")]
        self.assertEqual(len(set(tokens)), 3)
        self.assertTrue(all(len(token) >= 40 for token in tokens))
        config = json.loads((self.state / "config/config.json").read_text())
        self.assertEqual(len(config["sources"]), 1)
        self.assertEqual(config["sources"][0]["token_ref"], "file:/run/secrets/source.token")
        self.assertEqual(config["subscriptions"], [])
        self.assertEqual(config["rules"], [])
        env = (self.state / "compose.env").read_text()
        self.assertIn("SIGNALHUB_UID=1001\nSIGNALHUB_GID=1002\n", env)
        self.assertIn("SIGNALHUB_PORT=18081\n", env)
        self.assertIn("SIGNALHUB_STATE_DIR=" + str(self.state) + "\n", env)
        self.assertTrue(all(token not in env for token in tokens))

    def test_repeat_preserves_every_byte(self):
        self.initialize()
        before = {str(p.relative_to(self.state)): p.read_bytes() for p in self.state.rglob("*") if p.is_file()}
        with self.assertRaises(ValueError):
            self.initialize()
        self.assertEqual(before, {str(p.relative_to(self.state)): p.read_bytes() for p in self.state.rglob("*") if p.is_file()})

    def test_existing_file_and_broken_symlink_are_preserved(self):
        self.state.write_text("preserve")
        with self.assertRaises(ValueError):
            self.initialize()
        self.assertEqual(self.state.read_text(), "preserve")
        self.state.unlink()
        self.state.symlink_to(self.parent / "absent")
        with self.assertRaises(ValueError):
            self.initialize()
        self.assertTrue(self.state.is_symlink())
        self.assertFalse((self.parent / "absent").exists())

    def test_symlink_ancestor_refused_without_escape(self):
        outside = self.parent / "outside"
        outside.mkdir()
        link = self.parent / "link"
        link.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.initialize(link / "new")
        self.assertEqual(list(outside.iterdir()), [])

    def test_bad_path_and_missing_parent_have_no_side_effect(self):
        for path in ("relative", str(self.parent / "space here"), str(self.parent / "$bad"), str(self.parent) + "/../new", str(self.parent / "missing/new")):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.initialize(path)
        self.assertEqual(list(self.parent.iterdir()), [])

    def test_bad_port_has_no_side_effect(self):
        for port in (0, 1023, 65536, True, "8080"):
            with self.subTest(port=port), self.assertRaises(ValueError):
                self.initialize(port=port)
        self.assertFalse(self.state.exists())

    def test_root_uid_or_gid_refused_before_creation(self):
        for uid, euid, gid in ((0, 0, 1000), (1000, 0, 1000), (1000, 1000, 0)):
            with self.subTest(uid=uid, euid=euid, gid=gid), patch.object(os, "getuid", return_value=uid), patch.object(os, "geteuid", return_value=euid), patch.object(os, "getgid", return_value=gid), self.assertRaises(ValueError):
                setup.initialize(str(self.state), 8080)
        self.assertFalse(self.state.exists())

    def test_cli_does_not_print_tokens(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--state-dir", str(self.state)], capture_output=True, text=True)
        if os.getuid() == 0 or os.getgid() == 0:
            self.assertNotEqual(result.returncode, 0)
            return
        self.assertEqual(result.returncode, 0, result.stderr)
        for token in (self.state / "secrets").iterdir():
            self.assertNotIn(token.read_text().strip(), result.stdout + result.stderr)
        again = subprocess.run([sys.executable, str(SCRIPT), "--state-dir", str(self.state)], capture_output=True, text=True)
        self.assertNotEqual(again.returncode, 0)


if __name__ == "__main__":
    unittest.main()

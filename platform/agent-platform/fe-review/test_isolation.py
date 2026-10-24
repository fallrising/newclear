"""Offline ownership/cleanup contracts; never launch Docker in these tests."""

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "isolation", Path(__file__).with_name("run-isolated.py")
)
isolation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(isolation)


class IsolationTests(unittest.TestCase):
    def test_private_parent_rejects_checkout_symlink_and_broad_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            checkout = root / "checkout"
            checkout.mkdir()
            private = root / "private"
            private.mkdir(mode=0o700)
            self.assertEqual(isolation.private_parent(private, checkout), private)
            with self.assertRaisesRegex(ValueError, "INSIDE_CHECKOUT"):
                isolation.private_parent(checkout, checkout)
            alias = root / "alias"
            alias.symlink_to(private, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "SYMLINK"):
                isolation.private_parent(alias, checkout)
            private.chmod(0o755)
            with self.assertRaisesRegex(ValueError, "MODE"):
                isolation.private_parent(private, checkout)
            self.assertEqual(private.stat().st_mode & 0o777, 0o755)

    def test_cleanup_timeout_does_not_skip_other_owned_removal(self):
        commands = []

        def invoke(command, **_kwargs):
            commands.append(command)
            if command[1] == "stop":
                raise subprocess.TimeoutExpired("fixed-cleanup-command", 15)
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

        removed, observations = isolation.cleanup_owned(["owned-pg", "owned-browser"], invoke)
        self.assertTrue(removed)
        self.assertEqual(observations, ["stop_unknown", "stop_unknown"])
        self.assertEqual([c[-1] for c in commands if c[1] == "rm"], ["owned-browser", "owned-pg"])

    def test_cleanup_unknown_daemon_or_remaining_container_is_not_success(self):
        for code, output in ((1, ""), (0, "unrelated\nowned-pg\n")):

            def invoke(command, code=code, output=output, **_kwargs):
                return subprocess.CompletedProcess(command, code, stdout=output, stderr="")

            removed, observations = isolation.cleanup_owned(["owned-pg"], invoke)
            self.assertFalse(removed)
            self.assertIn("inventory_unconfirmed", observations)

    def test_secret_log_is_redacted_and_flagged(self):
        value, leaked = isolation.scrub_log(
            "first CANARY_SECRET second CANARY_SECRET", ["CANARY_SECRET"]
        )
        self.assertTrue(leaked)
        self.assertNotIn("CANARY_SECRET", value)
        self.assertEqual(value, "first [REDACTED] second [REDACTED]")


if __name__ == "__main__":
    unittest.main()

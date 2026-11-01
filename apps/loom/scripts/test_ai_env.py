import os
from pathlib import Path
import tempfile
import unittest

from with_ai_env import read_env


class PrivateEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "private.env"

    def write(self, value):
        self.path.write_text(value)
        self.path.chmod(0o600)

    def test_reads_quotes_without_shell_expansion(self):
        self.write("# private\nOPENCODE_API_KEY='literal-$(do-not-execute)'\n")
        self.assertEqual(read_env(self.path), {"OPENCODE_API_KEY": "literal-$(do-not-execute)"})

    def test_rejects_public_permissions_and_symlinks(self):
        self.write("OPENCODE_API_KEY=private-value\n")
        for mode in (0o644, 0o700):
            self.path.chmod(mode)
            with self.assertRaises(ValueError):
                read_env(self.path)
        self.path.chmod(0o600)
        link = self.path.with_name("link.env")
        link.symlink_to(self.path)
        with self.assertRaises(ValueError):
            read_env(link)

    def test_rejects_invalid_files_without_echoing_secret(self):
        for value in ["export OPENCODE_API_KEY=private-value", "OPENCODE_API_KEY='private-value", "OTHER=private-value", "OPENCODE_API_KEY=private-value\nOPENCODE_API_KEY=duplicate", "OPENCODE_API_KEY=", "OPENCODE_API_KEY=" + "x" * 17000]:
            with self.subTest(kind=value[:15]):
                self.write(value)
                with self.assertRaises(ValueError) as caught:
                    read_env(self.path)
                self.assertNotIn("private-value", str(caught.exception))


if __name__ == "__main__":
    unittest.main()

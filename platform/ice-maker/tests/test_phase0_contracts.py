import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import check_repo


class Phase0ContractsTest(unittest.TestCase):
    def test_repository_passes(self):
        self.assertEqual(check_repo.validate(), [])

    def test_malformed_json_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            path.write_text("{bad", encoding="utf-8")
            self.assertTrue(check_repo.check_json([path]))

    def test_secret_detection_does_not_print_value(self):
        with tempfile.TemporaryDirectory() as directory:
            value = "ghp_" + "A" * 24
            path = Path(directory) / "production.txt"
            path.write_text(f"token = '{value}'\n", encoding="utf-8")
            with mock.patch.object(check_repo, "ROOT", Path(directory)):
                errors = check_repo.check_secrets([path])
            self.assertTrue(errors)
            self.assertNotIn(value, " ".join(errors))

    def test_synthetic_marker_is_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tests" / "fixtures" / "fixture.txt"
            path.parent.mkdir(parents=True)
            path.write_text("SYNTHETIC_TEST_SECRET ghp_" + "A" * 24, encoding="utf-8")
            with mock.patch.object(check_repo, "ROOT", Path(directory)):
                self.assertEqual(check_repo.check_secrets([path]), [])

    def test_production_marker_does_not_exempt_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            value = "ghp_" + "A" * 24
            path = Path(directory) / "production.txt"
            path.write_text(f"SYNTHETIC_TEST_SECRET token = '{value}'\n", encoding="utf-8")
            with mock.patch.object(check_repo, "ROOT", Path(directory)):
                errors = check_repo.check_secrets([path])
            self.assertTrue(errors)
            self.assertNotIn(value, " ".join(errors))

    def test_unpinned_action_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workflow = root / ".github/workflows/ci.yml"
            workflow.parent.mkdir(parents=True)
            workflow.write_text("steps:\n  - uses: actions/checkout@v4\n", encoding="utf-8")
            with mock.patch.object(check_repo, "ROOT", root):
                self.assertTrue(check_repo.check_workflows([workflow]))

    def test_source_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs/execution").mkdir(parents=True)
            target = root / "docs/sdd.md"
            target.write_text("changed", encoding="utf-8")
            digest = hashlib.sha256(b"original").hexdigest()
            (root / "docs/execution/sdd-source.sha256").write_text(f"{digest} docs/sdd.md\n", encoding="utf-8")
            with mock.patch.object(check_repo, "ROOT", root):
                self.assertTrue(check_repo.check_source_hashes())


if __name__ == "__main__":
    unittest.main()

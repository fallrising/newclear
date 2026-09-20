import contextlib
import io
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import check_repo


class Phase1CiTest(unittest.TestCase):
    def _active_fixture(self, root: Path) -> Path:
        active = root / "specs/active"
        active.mkdir(parents=True)
        shutil.copytree(Path("specs/active/sdd-cli"), active / "valid")
        return active

    def test_all_active_sdds_are_validated_and_invalid_one_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            active = self._active_fixture(root)
            shutil.copytree(active / "valid", active / "invalid")
            spec = active / "invalid/spec.md"
            spec.write_text(spec.read_text(encoding="utf-8").replace("owner: fallrising", "owner:"), encoding="utf-8")
            with mock.patch.object(check_repo, "ROOT", root):
                errors = check_repo.check_active_sdds()
        self.assertTrue(errors)
        self.assertTrue(any("invalid/spec.md" in error and "front_matter" in error for error in errors), errors)

    def test_symlinked_active_root_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as target:
            root = Path(directory)
            (root / "specs").mkdir()
            (root / "specs/active").symlink_to(target, target_is_directory=True)
            with mock.patch.object(check_repo, "ROOT", root):
                errors = check_repo.check_active_sdds()
        self.assertTrue(any("symlink" in error for error in errors), errors)

    def test_symlinked_active_child_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as target:
            root = Path(directory)
            active = root / "specs/active"
            active.mkdir(parents=True)
            (active / "linked").symlink_to(target, target_is_directory=True)
            with mock.patch.object(check_repo, "ROOT", root):
                errors = check_repo.check_active_sdds()
        self.assertTrue(any("linked" in error and "symlink" in error for error in errors), errors)

    def test_make_check_exports_source_tree_and_runs_all_tests(self):
        makefile = Path("Makefile").read_text(encoding="utf-8")
        self.assertIn("PYTHONPATH=src python3 scripts/check_repo.py", makefile)
        self.assertIn("PYTHONPATH=src python3 -m unittest discover -s tests -v", makefile)

    def test_ci_uses_repository_gate_and_retains_security_controls(self):
        workflow = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertIn("run: make check", workflow)
        self.assertIn("permissions:\n  contents: read", workflow)
        self.assertIn("concurrency:", workflow)
        self.assertIn("timeout-minutes:", workflow)
        self.assertNotIn("actions/checkout@v4", workflow)

    def test_gate_reports_active_sdd_errors_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            active = self._active_fixture(root)
            spec = active / "valid/spec.md"
            spec.write_text(spec.read_text(encoding="utf-8").replace("status: approved", "status: invalid"), encoding="utf-8")
            original = spec.read_bytes()
            stderr = io.StringIO()
            with mock.patch.object(check_repo, "ROOT", root), \
                    mock.patch.object(check_repo, "tracked_files", return_value=[]), \
                    mock.patch.object(check_repo, "check_source_hashes", return_value=[]), \
                    mock.patch.object(check_repo, "check_governance", return_value=[]), \
                    mock.patch.object(check_repo, "check_workflows", return_value=[]), \
                    contextlib.redirect_stderr(stderr):
                exit_code = check_repo.main()
            self.assertEqual(original, spec.read_bytes())
        self.assertNotEqual(exit_code, 0)
        self.assertIn("specs/active/valid/spec.md", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()

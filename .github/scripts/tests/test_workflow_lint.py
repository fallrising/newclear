"""Run regression workflows through the real, digest-pinned actionlint entry."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ENTRY = REPO / ".github/scripts/check_workflows.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


class WorkflowLintTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        value = os.environ.get("ACTIONLINT_ARCHIVE")
        if not value:
            raise RuntimeError("Set ACTIONLINT_ARCHIVE to the pinned release archive; see monorepo-ci.md")
        cls.archive = Path(value).resolve()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def run_check(self, *paths, root=REPO, archive=None):
        return subprocess.run(
            [sys.executable, str(ENTRY), "--root", str(root),
             "--cache-dir", str(self.root / "cache"),
             "--archive", str(archive or self.archive), *map(str, paths)],
            capture_output=True, text=True,
        )

    def test_job_runner_context_is_rejected_with_location(self):
        result = self.run_check(FIXTURES / "invalid-runner-job-env.yml")
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertRegex(result.stdout + result.stderr, r"invalid-runner-job-env.yml:7:[0-9]+")
        self.assertIn('context "runner" is not allowed', result.stdout + result.stderr)

    def test_step_runner_context_is_allowed(self):
        result = self.run_check(FIXTURES / "valid-step-env.yml")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("PASS: 1 workflow(s)", result.stdout)

    def test_github_env_is_allowed(self):
        result = self.run_check(FIXTURES / "valid-github-env.yml")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_matrix_and_modern_hosted_label_are_allowed(self):
        result = self.run_check(FIXTURES / "valid-matrix.yml")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_default_scope_checks_root_yaml_and_excludes_nested_workflows(self):
        workflow_dir = self.root / "repo/.github/workflows"
        workflow_dir.mkdir(parents=True)
        (workflow_dir / "valid.yaml").write_bytes((FIXTURES / "valid-step-env.yml").read_bytes())
        nested = self.root / "repo/component/.github/workflows"
        nested.mkdir(parents=True)
        (nested / "dormant.yml").write_text("not: [valid")
        result = self.run_check(root=self.root / "repo")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("PASS: 1 workflow(s)", result.stdout)

    def test_no_workflows_fails_instead_of_silently_passing(self):
        result = self.run_check(root=self.root)
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertIn("no root workflow files", result.stderr)

    def test_tampered_archive_is_rejected_before_execution(self):
        archive = self.root / "tampered.tar.gz"
        archive.write_bytes(b"not the pinned executable")
        result = self.run_check(FIXTURES / "valid-step-env.yml", archive=archive)
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertIn("SHA256 mismatch", result.stderr)


if __name__ == "__main__":
    unittest.main()

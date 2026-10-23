"""Exercise the public preflight against real validators and a tiny Git repo."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from test_project_success import contract

REPO = Path(__file__).resolve().parents[2]
ENTRY = REPO / "scripts/check_indexes.py"


class IndexPreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.write("tools/example/SUCCESS.md", contract())
        for name in ("README.md", "AGENTS.md"):
            self.write("tools/example/" + name, "[status](SUCCESS.md)\n")
        self.write("README.md", "| [`tools/example`](tools/example/) | Example | C |\n")
        self.write("llms.txt", "# Index\n\n## Projects\n- [Example](tools/example/llms.txt)\n")
        self.write("tools/example/llms.txt", "# Example\n\nTier: C\nStatus: partial\nInterfaces: cli\nEntrypoint: README.md\nAuth: none\nSpec: none\n")
        self.write("docs/project-success/inventory.json", json.dumps({
            "repository": "fallrising/newclear", "excluded_roots": {"docs": "documentation"},
            "projects": [{"path": "tools/example"}],
        }))
        subprocess.run([sys.executable, str(REPO / "scripts/check_project_success.py"),
                        "--root", str(self.root), "--write-index"], check=True, capture_output=True)
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def run_check(self):
        return subprocess.run([sys.executable, str(ENTRY), "--root", str(self.root)],
                              capture_output=True, text=True)

    def test_valid_repository_passes_without_changing_files_or_index(self):
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        result = self.run_check()
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("project success", result.stdout)
        self.assertIn("llms.txt", result.stdout)
        after = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_unregistered_component_is_identified(self):
        self.write("tools/new-tool/README.md", "new\n")
        result = self.run_check()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("untracked project: tools/new-tool", result.stdout)

    def test_stale_index_is_identified_with_explicit_repair(self):
        self.write("PROJECTS.md", "stale\n")
        result = self.run_check()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("PROJECTS.md is stale", result.stdout)
        self.assertIn("--write-index", result.stdout)
        self.assertEqual("stale\n", (self.root / "PROJECTS.md").read_text())

    def test_missing_navigation_is_identified(self):
        self.write("llms.txt", "# Index\n")
        result = self.run_check()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("tools/example/llms.txt", result.stdout + result.stderr)

    def test_both_validators_report_when_both_fail(self):
        self.write("PROJECTS.md", "stale\n")
        self.write("llms.txt", "# Index\n")
        result = self.run_check()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("PROJECTS.md is stale", result.stdout)
        self.assertIn("tools/example/llms.txt", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()

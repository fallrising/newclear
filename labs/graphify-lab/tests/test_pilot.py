"""Deterministic pilot boundary checks; integration uses the real CLI separately."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from graphify_lab.pilot import (
    sanitize, snapshot_source, validate_baseline, validate_output, verify_node,
)


class PilotBoundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_full_lowercase_commit_required(self):
        self.assertEqual(validate_baseline("a" * 40), "a" * 40)
        for bad in ("HEAD", "a" * 39, "A" * 40, "../main", "a" * 40 + "\n"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate_baseline(bad)

    def test_output_rejects_overlap_in_both_directions_and_symlink(self):
        lab = self.root / "lab"
        cache = self.root / "cache"
        lab.mkdir()
        cache.mkdir()
        (lab / "graphify_lab").mkdir()
        alias = self.root / "alias"
        alias.symlink_to(cache, target_is_directory=True)
        for output in (lab, lab / "graphify_lab" / "run", lab / "tests" / "run",
                       cache, cache / "run", self.root, alias / "run"):
            with self.subTest(output=output), self.assertRaises(ValueError):
                validate_output(output, lab=lab, cache=cache)
        self.assertEqual(validate_output(lab / "work" / "new", lab=lab, cache=cache),
                         lab / "work" / "new")

    def test_existing_output_is_untouched(self):
        output = self.root / "existing"
        output.mkdir()
        marker = output / "keep"
        marker.write_text("owner data")
        with self.assertRaises(FileExistsError):
            validate_output(output, lab=self.root / "lab", cache=self.root / "cache")
        self.assertEqual(marker.read_text(), "owner data")

    def test_exact_ast_declaration_and_wrong_candidate(self):
        source = self.root / "source"
        source.mkdir()
        (source / "module.py").write_text("# first\ndef helper():\n    return 1\n")
        node = {"label": "helper()", "source_file": "module.py", "source_location": "L2"}
        result = verify_node(source, node, "helper", "module.py")
        self.assertEqual(result["line"], 2)
        self.assertIn("def helper():", result["content"])
        for wrong in ({**node, "source_location": "L1"}, {**node, "label": "other()"},
                      {**node, "source_file": "../outside.py"}):
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                verify_node(source, wrong, "helper", "module.py")

    def test_snapshot_is_commit_bytes_only_and_never_executes_source(self):
        repo = self.root / "repo"
        repo.mkdir()
        env = {**os.environ, "GIT_AUTHOR_NAME": "Pilot test", "GIT_AUTHOR_EMAIL": "pilot@example.invalid",
               "GIT_COMMITTER_NAME": "Pilot test", "GIT_COMMITTER_EMAIL": "pilot@example.invalid"}
        def git(*args):
            return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", *args], cwd=repo, env=env)
        git("init", "-q")
        prefix = repo / "labs/graphify-lab"
        package = prefix / "graphify_lab"
        package.mkdir(parents=True)
        (prefix / "tests").mkdir()
        original = b'raise RuntimeError("must never execute baseline")\n'
        (package / "__init__.py").write_bytes(original)
        (prefix / "tests/test_real.py").write_text("def test_real():\n    pass\n")
        (prefix / "secret.txt").write_text("excluded")
        (prefix / "fixtures").mkdir()
        (prefix / "fixtures/fake.py").write_text("excluded = True\n")
        git("add", ".")
        git("commit", "-qm", "snapshot fixture")
        baseline = git("rev-parse", "HEAD").decode().strip()
        (package / "__init__.py").write_text("dirty = True\n")
        (package / "untracked.py").write_text("excluded = True\n")
        output = self.root / "snapshot"
        manifest = snapshot_source(repo, baseline, output)
        self.assertEqual((output / "graphify_lab/__init__.py").read_bytes(), original)
        self.assertEqual(manifest["baseline"], baseline)
        self.assertEqual(set(manifest["files"]), {"graphify_lab/__init__.py", "tests/test_real.py"})
        self.assertEqual(manifest["files"]["graphify_lab/__init__.py"]["sha256"], hashlib.sha256(original).hexdigest())
        self.assertFalse((output / "fixtures").exists())
        with self.assertRaises(FileExistsError):
            snapshot_source(repo, baseline, output)
        (package / "linked.py").symlink_to("__init__.py")
        git("add", ".")
        git("commit", "-qm", "symlink must be refused")
        linked = git("rev-parse", "HEAD").decode().strip()
        rejected = self.root / "rejected"
        with self.assertRaisesRegex(ValueError, "nonregular"):
            snapshot_source(repo, linked, rejected)
        self.assertFalse(rejected.exists())

    def test_portable_nested_output(self):
        value = {"command": [str(self.root / "run/source/file.py")], "stderr": str(self.root / "other")}
        cleaned = sanitize(value, {str(self.root / "run"): "<run>", str(self.root): "<local>"})
        self.assertEqual(cleaned, {"command": ["<run>/source/file.py"], "stderr": "<local>/other"})


if __name__ == "__main__":
    unittest.main()

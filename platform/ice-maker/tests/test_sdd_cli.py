import json
import subprocess
import shutil
import tempfile
import unittest
from pathlib import Path

from ice_maker.cli import _publish_no_replace


ROOT = Path(__file__).resolve().parents[1]


def run(root, *args):
    return subprocess.run(["python3", "-m", "ice_maker", *args], cwd=root,
                          env={"PYTHONPATH": str(ROOT / "src")}, text=True,
                          capture_output=True)


class SddCliTest(unittest.TestCase):
    def test_publish_no_replace_preserves_collision_created_after_preflight(self):
        with tempfile.TemporaryDirectory() as directory:
            active = Path(directory)
            staging = active / ".example.staging"
            target = active / "example"
            staging.mkdir()
            (staging / "spec.md").write_text("staged", encoding="utf-8")
            self.assertFalse(target.exists())  # preflight observed no target
            target.mkdir()  # a concurrent creator wins before publication
            target_inode = target.stat().st_ino
            with self.assertRaises(FileExistsError):
                _publish_no_replace(staging, target)
            self.assertEqual(target.stat().st_ino, target_inode)
            self.assertTrue(staging.exists())

    def test_init_rejects_symlinked_templates_before_any_write(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as external:
            root = Path(directory)
            specs = root / "specs"
            specs.mkdir()
            outside = Path(external)
            (outside / "sentinel").write_bytes(b"do not touch")
            (specs / "templates").symlink_to(outside, target_is_directory=True)
            result = run(root, "init")
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / ".sdd").exists())
            self.assertFalse((root / "specs/active").exists())
            self.assertEqual((outside / "sentinel").read_bytes(), b"do not touch")

    def test_init_preflights_divergence_without_partial_initialization(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            templates = root / "specs/templates"
            templates.mkdir(parents=True)
            canonical = ROOT / "specs/templates"
            for name in ("spec.md", "plan.md", "tasks.md", "verification.md"):
                shutil.copyfile(canonical / name, templates / name)
            (templates / "plan.md").write_text("divergent", encoding="utf-8")
            result = run(root, "init")
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / ".sdd").exists())
            self.assertFalse((root / "specs/active").exists())

    def test_lifecycle_and_deterministic_status(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(run(root, "init").returncode, 0)
            self.assertEqual(run(root, "init").returncode, 0)
            created = run(root, "new", "example", "--id", "SDD-0001",
                          "--title", "Example feature", "--owner", "human",
                          "--component", "ice_maker")
            self.assertEqual(created.returncode, 0, created.stderr)
            self.assertEqual(run(root, "validate", "example").returncode, 0)
            parsed = (root / "specs/active/example/spec.md").read_text(encoding="utf-8")
            self.assertIn("title: Example feature", parsed)
            status = run(root, "status", "--json")
            self.assertEqual(status.returncode, 0)
            self.assertEqual(json.loads(status.stdout), [{"id": "SDD-0001",
                "slug": "example", "status": "draft", "valid": True}])

    def test_new_refuses_overwrite_and_unsafe_names(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(run(root, "init").returncode, 0)
            args = ["new", "example", "--id", "SDD-0001", "--title", "X",
                    "--owner", "human", "--component", "ice_maker"]
            self.assertEqual(run(root, *args).returncode, 0)
            before = (root / "specs/active/example/spec.md").read_bytes()
            self.assertNotEqual(run(root, *args).returncode, 0)
            self.assertEqual((root / "specs/active/example/spec.md").read_bytes(), before)
            self.assertNotEqual(run(root, "new", "../escape", *args[2:]).returncode, 0)

    def test_new_rejects_invalid_title_without_publishing_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(run(root, "init").returncode, 0)
            result = run(root, "new", "invalid-title", "--id", "SDD-0002",
                         "--title", "Bad: title", "--owner", "human",
                         "--component", "ice_maker")
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / "specs/active/invalid-title").exists())

    def test_validate_reports_actionable_failure_without_mutating(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(run(root, "init").returncode, 0)
            self.assertEqual(run(root, "new", "broken", "--id", "SDD-0001",
                                 "--title", "X", "--owner", "human",
                                 "--component", "ice_maker").returncode, 0)
            spec = root / "specs/active/broken/spec.md"
            text = spec.read_text(encoding="utf-8").replace("owner: human", "owner: \n")
            spec.write_text(text, encoding="utf-8")
            result = run(root, "validate", "--all")
            self.assertEqual(result.returncode, 1)
            self.assertIn("front_matter.type", result.stdout)


if __name__ == "__main__":
    unittest.main()

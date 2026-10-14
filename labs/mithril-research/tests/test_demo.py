"""Demo boundary regressions; copied source never touches the actual checkout."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


COMPONENT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("demo", COMPONENT / "scripts/demo.py")
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)


class DemoBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        component = self.source / "labs/mithril-research"
        for name in ("scripts/demo.py", "scripts/labctl.py",
                     "examples/inventory.example.json", "runtime.lock.json"):
            destination = component / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(COMPONENT / name, destination)
        self.script = component / "scripts/demo.py"

    def reject(self, output):
        result = subprocess.run([sys.executable, str(self.script), "--output", str(output)],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 2, result.stderr)

    def test_parent_traversal_rejected_before_any_source_write(self):
        outside = self.root / "outside"
        outside.mkdir()
        self.reject(outside / ".." / "source" / "demo-output")
        self.assertFalse((self.source / "demo-output").exists())
        self.assertEqual(list(outside.iterdir()), [])

    def test_existing_output_preserved(self):
        output = self.root / "existing"
        output.mkdir()
        (output / "sentinel").write_text("unique work")
        self.reject(output)
        self.assertEqual([p.name for p in output.iterdir()], ["sentinel"])
        self.assertEqual((output / "sentinel").read_text(), "unique work")

    def test_symlink_destination_and_parent_rejected(self):
        target = self.root / "target"
        target.mkdir()
        alias = self.root / "alias"
        alias.symlink_to(target, target_is_directory=True)
        for output in (alias, alias / "new-output"):
            with self.subTest(output=output.name):
                self.reject(output)
                self.assertEqual(list(target.iterdir()), [])

    def test_acceptance_rejects_incomplete_or_unknown_results(self):
        smoke = {"result": "simulated-pass"}
        report = {"observation": "owned", "synthetic_resources": 0,
                  "uncertain_operations": 0, "smoke": "simulated-pass"}
        demo.verify_acceptance(smoke, report)
        for key, value in (("observation", "unknown"), ("synthetic_resources", 1),
                           ("uncertain_operations", 1), ("smoke", "NO RESULT")):
            with self.subTest(key=key):
                with self.assertRaises(RuntimeError):
                    demo.verify_acceptance(smoke, dict(report, **{key: value}))
        with self.assertRaises(RuntimeError):
            demo.verify_acceptance({"result": "NO RESULT"}, report)


if __name__ == "__main__":
    unittest.main()

"""CLI boundary checks complement the real Graphify integration scenarios."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from graphify_lab.__main__ import LAB, full_run, node_at, source_excerpt


class CliBoundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def call(self, *args):
        return subprocess.run([sys.executable, "-m", "graphify_lab", "--cache", str(self.root / "cache"), *args],
                              cwd=LAB, text=True, capture_output=True, timeout=30)

    def test_unknown_reference_does_not_fetch(self):
        result = self.call("locate", "unknown-repository")
        self.assertEqual(result.returncode, 2)
        self.assertIn("unknown reference", result.stderr)
        self.assertFalse((self.root / "cache").exists())

    def test_offline_missing_reference_fails(self):
        result = self.call("locate", "graphify")
        self.assertEqual(result.returncode, 2)
        self.assertIn("absent from the offline cache", result.stderr)

    def test_existing_run_is_preserved(self):
        output = self.root / "existing"
        output.mkdir()
        marker = output / "keep.txt"
        marker.write_text("owner data")
        result = self.call("full", "--out", str(output))
        self.assertEqual(result.returncode, 2)
        self.assertEqual(marker.read_text(), "owner data")
        self.assertEqual(list(output.iterdir()), [marker])

    def test_output_cannot_mutate_cache(self):
        cache = self.root / "cache"
        with self.assertRaisesRegex(ValueError, "separate directory"):
            full_run(cache / "run", cache)
        self.assertFalse(cache.exists())

    def test_output_cannot_mutate_fixture(self):
        output = LAB / "fixtures" / "never-created-by-test"
        with self.assertRaisesRegex(ValueError, "indexed source"):
            full_run(output, self.root / "cache")
        self.assertFalse(output.exists())

    def test_source_pointer_containment_and_bounds(self):
        source = self.root / "source"
        source.mkdir()
        (source / "valid.py").write_text("def demo():\n    return 1\n")
        (self.root / "outside.py").write_text("private content")
        node = {"source_file": "valid.py", "source_location": "L1"}
        self.assertEqual(source_excerpt(source, node, 1)["content"], "def demo():")
        with self.assertRaisesRegex(ValueError, "escapes"):
            source_excerpt(source, {**node, "source_file": "../outside.py"})
        with self.assertRaisesRegex(ValueError, "outside the file"):
            source_excerpt(source, {**node, "source_location": "L100"})
        with self.assertRaisesRegex(ValueError, "between 1 and 100"):
            source_excerpt(source, node, 101)

    def test_same_name_requires_file_selection(self):
        graph = self.root / "graph.json"
        graph.write_text(json.dumps({"nodes": [{"label": "same()", "source_file": "a.py"},
                                              {"label": "same()", "source_file": "b.py"}]}))
        with self.assertRaisesRegex(ValueError, "found 2"):
            node_at(graph, "same()")
        self.assertEqual(node_at(graph, "same()", "b.py")["source_file"], "b.py")


if __name__ == "__main__":
    unittest.main()

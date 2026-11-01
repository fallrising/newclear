"""Safety boundaries around the real integration suite (no mocked graph engine)."""

from pathlib import Path
import tempfile
import unittest

from graphify_lab.scenarios import run_suite


class ScenarioBoundaryTests(unittest.TestCase):
    def test_existing_run_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "report.json"
            report.write_bytes(b'{"preserve":true}\n')
            with self.assertRaises(FileExistsError):
                run_suite(root)
            self.assertEqual(report.read_bytes(), b'{"preserve":true}\n')
            self.assertEqual([p.name for p in root.iterdir()], ["report.json"])

    def test_external_reference_is_not_silently_counted_as_fixture_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "unused"
            with self.assertRaisesRegex(ValueError, "outer runner"):
                run_suite(output, reference_source=Path(directory))
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()

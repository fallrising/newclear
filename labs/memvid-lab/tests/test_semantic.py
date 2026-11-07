"""Behavioral contracts for NS-01–04; numeric fixtures test math, not model quality."""
from pathlib import Path
import copy
import json
import subprocess
import sys
import tempfile
import unittest
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from semantic_models import MODELS, pool_vectors, prefixed_texts, verify_assets
from semantic_eval import calibrate, filter_rows, load_corpora, source_entry, source_matches, find


def hit(uri, cosine):
    return {"uri": uri, "cosine": cosine, "integrity_ok": True}


class SemanticMath(unittest.TestCase):
    def test_NS02_calibration_respects_unknowns_and_conservative_tie(self):
        rows = [{"id": "answer", "relevant_uris": ["a"], "hits": [hit("a", .9), hit("b", .8)]},
                {"id": "none", "relevant_uris": [], "hits": [hit("b", .85)]}]
        before = copy.deepcopy(rows)
        selected = calibrate(rows)
        self.assertEqual(selected["threshold"], .9)
        self.assertEqual(selected["selection_status"], "feasible")
        self.assertEqual(len(selected["candidates"]), 101)
        self.assertEqual(rows, before)
        self.assertEqual(filter_rows(rows, .9)[0]["hits"], [hit("a", .9)])
        self.assertEqual(filter_rows(rows, .9)[1]["hits"], [])

    def test_NS02_multi_source_recall_takes_priority_over_stricter_threshold(self):
        rows = [{"relevant_uris": ["a", "b"], "hits": [hit("a", .9), hit("b", .86)]},
                {"relevant_uris": [], "hits": [hit("x", .85)]}]
        self.assertEqual(calibrate(rows)["threshold"], .86)

    def test_NS02_no_feasible_candidate_is_explicit_not_perfect_quality(self):
        rows = [{"relevant_uris": ["a"], "hits": [hit("a", 1.0)]},
                {"relevant_uris": [], "hits": [hit("x", 1.0)]}]
        chosen = calibrate(rows)
        self.assertEqual(chosen["threshold"], 1.01)
        self.assertEqual(chosen["selection_status"], "no_feasible_threshold")
        self.assertIsNone(chosen["metrics"]["source_precision"])
        self.assertEqual(chosen["metrics"]["recall_at_5"], 0)

    def test_NS02_nonfinite_score_cannot_silently_become_rejection(self):
        for bad in (float("nan"), float("inf"), -float("inf")):
            with self.assertRaises(ValueError):
                calibrate([{"relevant_uris": ["a"], "hits": [hit("a", bad)]}])

    def test_NS02_modified_holdout_rejected_before_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "changed.json"
            path.write_bytes((ROOT / "fixtures/notes-heldout.json").read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "frozen"):
                load_corpora(ROOT / "fixtures/notes.json", path)


class SemanticSources(unittest.TestCase):
    def test_NS02_complete_renderer_rejects_metadata_body_or_uri_corruption(self):
        doc = {"uri": "mv2://notes/n01", "title": "筆記", "text": "筆記\n原始內容"}
        expected = source_entry(doc, "bge_zh")
        hit = {"uri": doc["uri"], "text": expected["rendered"]}
        self.assertTrue(source_matches(hit, expected))
        for text in (doc["text"], expected["rendered"] + " extra", expected["rendered"].replace("512", "384"),
                     expected["rendered"].replace("原始內容", "錯誤內容")):
            self.assertFalse(source_matches({**hit, "text": text}, expected))
        self.assertFalse(source_matches({**hit, "uri": "mv2://wrong"}, expected))
        self.assertFalse(source_matches(hit, {}))

    def test_NS02_out_of_range_cosine_is_error_without_clamping(self):
        # A response fixture isolates numeric validation, not SDK quality.
        expected = source_entry({"uri": "mv2://unit", "title": "unit", "text": "unit"}, "bge_zh")
        class ResponseFixture:
            def find(self, *args, **kwargs):
                return {"hits": [{"frame_id": 0, "uri": expected["uri"], "text": expected["rendered"], "score": 1}]}
        for value in (1.000001, -1.000001):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "cosine"):
                find(ResponseFixture(), "unit", [1., 0.], {"0": expected}, {"0": [value, 0.]})


class SemanticBoundary(unittest.TestCase):
    def test_NS04_cli_rejects_existing_output_without_altering_it(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "existing"
            output.mkdir()
            sentinel = output / "report.json"
            sentinel.write_text('"keep"\n')
            result = subprocess.run([sys.executable, str(ROOT / "semantic_eval.py"), "run", "--output", str(output),
                                     "--cache", str(Path(directory) / "missing"), "--sizes", "none"],
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("already exists", result.stderr)
            self.assertEqual(sentinel.read_text(), '"keep"\n')

    def test_NS04_missing_models_do_not_create_success_report(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "not-created"
            result = subprocess.run([sys.executable, str(ROOT / "semantic_eval.py"), "run", "--output", str(output),
                                     "--cache", str(Path(directory) / "missing"), "--sizes", "none"],
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Missing prepared semantic asset", result.stderr)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()

"""NR-01/03/04 data, reporting and CLI boundaries; no mock model quality."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from rejection_eval import POSITIVE, NEGATIVE, validate_corpus, evaluate_policy, adoption
from rejection_policy import native_top1_metrics

ROOT = Path(__file__).resolve().parents[1]


class RejectionEvaluationTests(unittest.TestCase):
    def corpus(self, split="dev"):
        return json.loads((ROOT / f"fixtures/notes-rejection-{split}.json").read_text())

    def test_nr01_real_fixtures_have_balanced_labeled_questions(self):
        for split in ("dev", "heldout"):
            corpus = validate_corpus(self.corpus(split), split)
            self.assertEqual(len(corpus["notes"]), 24)
            self.assertEqual(len(corpus["queries"]), 48)
            self.assertEqual(sum(bool(q["relevant_uris"]) for q in corpus["queries"]), 24)

    def test_nr01_bad_or_ambiguous_oracle_is_rejected(self):
        def bad_gold(c): c["queries"][0]["relevant_uris"] = ["mv2://not-a-note"]
        def multiple_gold(c): c["queries"][0]["relevant_uris"] = [n["uri"] for n in c["notes"][:2]]
        def wrong_type(c): c["queries"][24]["negative_type"] = "made_up"
        def empty_rationale(c): c["queries"][0]["rationale"] = " "
        def bad_version(c): c["schema_version"] = True
        def duplicate_text(c): c["queries"][1]["text"] = " " + c["queries"][0]["text"]
        def wrong_uri(c): c["notes"][0]["uri"] = c["notes"][1]["uri"]
        for change in (bad_gold, multiple_gold, wrong_type, empty_rationale, bad_version, duplicate_text, wrong_uri):
            corpus = self.corpus(); change(corpus)
            with self.subTest(change=change.__name__), self.assertRaises(ValueError):
                validate_corpus(corpus, "dev")

    def test_nr03_subset_denominators_and_raw_negative_cosine(self):
        rows = [{"id": "one", "category": "exact", "relevant_uris": ["a"], "hits": [
            {"uri": "a", "frame_id": 0, "cosine": -.1, "integrity_ok": True}]}]
        self.assertEqual(native_top1_metrics(rows)["answerable_hit_rate"], 1)
        result = evaluate_policy(rows, {"family": "score_only", "threshold": 0, "margin": 0, "enabled": True})
        self.assertEqual(result["metrics"]["abstention_rate"], 1)
        self.assertIsNone(result["by_category"]["exact"]["unknown_false_return_rate"])
        self.assertIsNone(result["by_category"]["unanswerable"]["abstention_rate"])

    def test_nr04_all_abstain_and_missing_update_cannot_pass_adoption(self):
        result = {"metrics": {"answerable_hit_rate": 0, "mrr_at_1": 0, "source_precision": None, "unknown_false_return_rate": 0}}
        self.assertEqual(adoption(result, None, False, 1)["recommendation"], "do_not_adopt_directly")
        result["metrics"].update(answerable_hit_rate=1, mrr_at_1=1, source_precision=1)
        self.assertFalse(adoption(result, None, True, 1)["checks"]["updates"])
        good_update = {key: True for key in ("current_view_passed", "deleted_absent", "new_process_reopen")}
        self.assertEqual(adoption(result, good_update, True, 1)["recommendation"], "candidate_for_further_trial")

    def test_nr04_existing_output_is_preserved_before_any_runtime_setup(self):
        with tempfile.TemporaryDirectory() as name:
            path = Path(name); marker = path / "keep"; marker.write_text("original")
            p = subprocess.run([sys.executable, str(ROOT / "rejection_eval.py"), "run", "--output", name,
                                "--cache", str(path / "missing")], text=True, capture_output=True, timeout=15)
            self.assertEqual(p.returncode, 2, p.stderr)
            self.assertIn("Output already exists", p.stderr)
            self.assertEqual(marker.read_text(), "original")
            self.assertEqual(sorted(x.name for x in path.iterdir()), ["keep"])

    def test_nr04_tampered_corpus_fails_before_output_or_runtime(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); changed = root / "tampered.json"
            changed.write_bytes((ROOT / "fixtures/notes-rejection-dev.json").read_bytes() + b"\n")
            p = subprocess.run([sys.executable, str(ROOT / "rejection_eval.py"), "run", "--output", str(root / "out"),
                                "--dev", str(changed), "--cache", str(root / "missing")], text=True, capture_output=True, timeout=15)
            self.assertEqual(p.returncode, 2, p.stderr)
            self.assertIn("frozen bytes", p.stderr)
            self.assertFalse((root / "out").exists())


if __name__ == "__main__":
    unittest.main()

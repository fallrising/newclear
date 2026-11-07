"""Fixed-contract metrics and real SDK boundary tests for NU-02–05."""
from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from notes_eval import summarize, search_text, validate_corpus, source_matches


def hit(uri, valid=True):
    return {"uri": uri, "integrity_ok": valid}


class NotesMetrics(unittest.TestCase):
    def test_NU02_renderer_check_rejects_changed_extra_or_wrong_source(self):
        expected = {"uri": "mv2://notes/n01", "title": "範例", "text": "範例\n內容，文字。"}
        actual = {"uri": expected["uri"], "text": '範例 內容,文字。 title: 範例 uri: mv2://notes/n01 labels: fixture fixture: "synthetic"'}
        self.assertTrue(source_matches(actual, expected))
        self.assertFalse(source_matches({**actual, "text": actual["text"].replace("內容", "錯誤")}, expected))
        self.assertFalse(source_matches({**actual, "text": actual["text"] + " extra"}, expected))
        self.assertFalse(source_matches({**actual, "uri": "mv2://notes/n02"}, expected))
        self.assertFalse(source_matches(actual, {}))

    def test_NU02_macro_recall_mrr_micro_precision_and_duplicates(self):
        rows = [
            {"relevant_uris": ["a", "b"], "hits": [hit("x"), hit("a"), hit("a"), hit("b")]},
            {"relevant_uris": ["c"], "hits": []},
            {"relevant_uris": [], "hits": [hit("x", False)]},
            {"relevant_uris": [], "hits": []},
        ]
        score = summarize(rows)
        self.assertEqual(score["recall_at_5"], 0.5)
        self.assertEqual(score["mrr_at_5"], 0.25)
        self.assertEqual(score["source_precision"], 0.5)
        self.assertEqual(score["no_answer_false_return_rate"], 0.5)
        self.assertEqual(score["source_integrity"], 0.8)

    def test_NU02_empty_results_are_not_perfect_integrity(self):
        score = summarize([{"relevant_uris": ["a"], "hits": []}])
        self.assertEqual(score["recall_at_5"], 0)
        self.assertIsNone(score["source_precision"])
        self.assertIsNone(score["source_integrity"])
        self.assertIsNone(score["no_answer_false_return_rate"])

    def test_NU02_rank_limit_applies_after_uri_dedup(self):
        score = summarize([{"relevant_uris": ["f"], "hits": [hit("a")] * 4 + [hit(x) for x in "bcdef"]}])
        self.assertEqual(score["recall_at_5"], 0)

    def test_NU02_cjk_tokens_preserve_overlap_without_gold(self):
        query = set(search_text("離線備份", "cjk_bigrams").split())
        document = set(search_text("每週離線備份，使用 NAS_A2。", "cjk_bigrams").split())
        self.assertTrue(query <= document)
        self.assertTrue(query)
        self.assertEqual(search_text("原樣 SQL", "native"), "原樣 SQL")

    def test_NU05_duplicate_ids_and_bad_references_are_rejected(self):
        corpus = json.loads((ROOT / "fixtures/notes.json").read_text())
        corpus["notes"][1]["id"] = corpus["notes"][0]["id"]
        with self.assertRaises(ValueError):
            validate_corpus(corpus)
        corpus = json.loads((ROOT / "fixtures/notes.json").read_text())
        corpus["queries"][0]["relevant_uris"] = ["mv2://missing"]
        with self.assertRaises(ValueError):
            validate_corpus(corpus)


class NotesIntegration(unittest.TestCase):
    def test_NU05_modified_corpus_rejected_before_output_creation(self):
        with tempfile.TemporaryDirectory() as temporary:
            corpus = Path(temporary) / "changed.json"
            corpus.write_text((ROOT / "fixtures/notes.json").read_text() + "\n")
            output = Path(temporary) / "not-created"
            result = subprocess.run([sys.executable, str(ROOT / "notes_eval.py"), "run", "--corpus", str(corpus),
                                     "--output", str(output)], capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("pre-retrieval frozen fixture", result.stderr)
            self.assertFalse(output.exists())

    def test_NU03_NU05_real_updates_reopen_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "evaluation"
            command = [sys.executable, str(ROOT / "notes_eval.py"), "run", "--output", str(output), "--sizes", "24"]
            result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=90)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            report_path = output / "report.json"
            before = report_path.read_bytes()
            report = json.loads(before)
            self.assertTrue(report["evaluation_completed"])
            self.assertEqual(len(report["quality"]), 2)
            self.assertEqual(len(report["updates"]), 2)
            for update in report["updates"]:
                self.assertTrue(update["current_view_passed"])
                self.assertTrue(update["new_process_reopen"])
                self.assertTrue(update["deleted_absent"])
            for result in report["quality"]:
                self.assertEqual(result["network"]["probes"], {"ipv4": "EPERM", "ipv6": "EPERM"})
                self.assertEqual(len(result["queries"]), 30)
                self.assertGreater(result["metrics"]["raw_hit_count"], 0)
                self.assertEqual(result["metrics"]["source_integrity"], 1)
            second = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(report_path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()

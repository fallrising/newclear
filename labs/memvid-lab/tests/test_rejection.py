"""M4 observable rejection and calibration contracts; synthetic hits are unit inputs only."""
import math
import unittest

from rejection_policy import decide, summarize_decisions, calibrate, select_primary


def hit(uri, score, frame=1):
    return {"uri": uri, "frame_id": frame, "cosine": score, "integrity_ok": True, "text": "synthetic unit payload"}


def policy(family="score_margin", threshold=.8, margin=.1, enabled=True):
    return {"family": family, "threshold": threshold, "margin": margin, "enabled": enabled}


def row(name, hits, relevant):
    return {"id": name, "category": "exact" if relevant else "unanswerable", "hits": hits, "relevant_uris": relevant}


class RejectionContractTests(unittest.TestCase):
    def test_nr02_threshold_equality_and_one_native_source_only(self):
        hits = [hit("a", .8), hit("b", .6, 2)]
        result = decide(hits, policy(margin=.2))
        self.assertEqual(result["returned_uris"], ["a"])
        self.assertEqual(result["reason"], "accepted")
        self.assertEqual(decide(hits, policy("score_only", .8, 0))["returned_uris"], ["a"])

    def test_nr02_no_rerank_and_distinct_source_gap(self):
        hits = [hit("a", .8), hit("a", .9, 2), hit("b", .85, 3)]
        self.assertEqual(decide(hits, policy())["reason"], "below_margin")
        self.assertEqual(decide(hits, policy("score_only", .8, 0))["returned_uris"], ["a"])

    def test_nr02_empty_single_tie_and_reason_order(self):
        self.assertEqual(decide([], policy())["reason"], "no_candidates")
        self.assertEqual(decide([hit("a", .9)], policy())["reason"], "insufficient_candidates")
        self.assertEqual(decide([hit("a", .9)], policy("score_only", .8, 0))["reason"], "accepted")
        tied = [hit("a", .9), hit("b", .9, 2)]
        self.assertEqual(decide(tied, policy(margin=0))["reason"], "accepted")
        self.assertEqual(decide(tied, policy())["reason"], "below_margin")
        self.assertEqual(decide(tied, policy(threshold=.95))["reason"], "below_score")

    def test_nr02_invalid_cosine_or_source_is_error_even_when_disabled(self):
        for value in (math.nan, math.inf, -math.inf, True, "0.8", 1.000001, -1.000001):
            with self.subTest(value=value), self.assertRaises(ValueError):
                decide([hit("a", value)], policy(enabled=False))
        for bad in ({**hit("a", .8), "integrity_ok": False}, {**hit("a", .8), "frame_id": True}, {"uri": "a"}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                decide([bad], policy())

    def test_nr02_invalid_later_duplicate_cannot_be_hidden(self):
        for p in (policy(), policy(enabled=False)):
            with self.assertRaises(ValueError):
                decide([hit("a", .9), hit("a", math.nan, 2)], p)

    def test_nr02_invalid_policy_is_error(self):
        for bad in (policy(threshold=math.nan), policy(threshold=.805), policy(margin=-.1), policy("unknown"), policy(enabled=1), policy("score_only", .8, .1)):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                decide([], bad)

    def test_nr03_metrics_distinguish_wrong_unknown_and_all_abstain(self):
        rows = [row("correct", [hit("a", .9)], ["a"]), row("wrong", [hit("x", .9)], ["b"]), row("unknown", [hit("c", .9)], [])]
        m = summarize_decisions(rows, policy("score_only", .8, 0))
        self.assertEqual(m["answerable_hit_rate"], .5)
        self.assertEqual(m["source_precision"], 1/3)
        self.assertEqual(m["unknown_false_return_rate"], 1)
        self.assertEqual(m["wrong_source_count"], 1)
        none = summarize_decisions(rows, policy(enabled=False))
        self.assertEqual(none["answerable_hit_rate"], 0)
        self.assertIsNone(none["source_precision"])
        self.assertEqual(none["abstention_rate"], 1)

    def test_nr03_dev_calibration_excludes_wrong_sources_and_unknowns(self):
        rows = [row("yes", [hit("a", .9), hit("b", .4, 2)], ["a"]), row("no", [hit("c", .85), hit("d", .84, 2)], [])]
        result = calibrate(rows, "score_margin")
        self.assertEqual(len(result["candidates"]), 10201)
        self.assertTrue(result["policy"]["enabled"])
        self.assertEqual(result["metrics"]["correct_count"], 1)
        self.assertEqual(result["metrics"]["unknown_false_return_count"], 0)
        self.assertEqual(result["policy"]["threshold"], .9)
        self.assertEqual(result["policy"]["margin"], .5)

    def test_nr03_no_feasible_policy_disables_instead_of_success(self):
        rows = [row("yes", [hit("wrong", .95)], ["a"]), row("no", [hit("x", .99)], [])]
        result = calibrate(rows, "score_only")
        self.assertFalse(result["policy"]["enabled"])
        self.assertEqual(result["selection_status"], "no_feasible_policy")
        self.assertIsNone(result["metrics"]["source_precision"])

    def test_nr03_primary_tie_is_fixed_and_does_not_take_heldout(self):
        records = [{"model": model, "family": family, "policy": policy(family, .9, 0), "metrics": {"correct_count": 4}}
                   for model in ("e5_multi", "bge_zh") for family in ("score_margin", "score_only")]
        self.assertEqual(select_primary(records), {"model": "bge_zh", "family": "score_only", "enabled": True})
        for r in records: r["policy"]["enabled"] = False
        self.assertEqual(select_primary(records), {"model": None, "family": None, "enabled": False})


if __name__ == "__main__":
    unittest.main()

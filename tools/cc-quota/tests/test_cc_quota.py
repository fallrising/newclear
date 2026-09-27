"""cc-quota 的離線測試：不連網、不需要憑證，只用 Python 標準函式庫。"""
import argparse
import contextlib
import importlib
import io
import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


class CcQuotaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["CC_QUOTA_DB"] = os.path.join(self.tmp.name, "q.db")
        os.environ["CLAUDE_CONFIG_DIR"] = os.path.join(self.tmp.name, "claude")
        os.environ.pop("CC_QUOTA_MOCK", None)
        import cc_quota
        self.m = importlib.reload(cc_quota)  # 讓模組重新讀取環境變數

    def tearDown(self):
        for k in ("CC_QUOTA_DB", "CLAUDE_CONFIG_DIR", "CC_QUOTA_MOCK"):
            os.environ.pop(k, None)
        self.tmp.cleanup()

    # ---- 純計算 ----
    def test_compute_mid_window(self):
        now = 1_000_000
        # five_hour 視窗已過 3 小時（60%），用了 72%
        r = self.m.compute("five_hour", {"utilization": 72, "resets_at": iso(now + 2 * 3600)}, now)
        self.assertEqual(r["remaining_pct"], 28)
        self.assertEqual(r["reset_in_s"], 7200)
        self.assertAlmostEqual(r["elapsed_pct"], 60.0)
        self.assertEqual(r["pace"], 1.2)
        self.assertLess(r["exhaust_in_s"], r["reset_in_s"])
        self.assertEqual(self.m.verdict(r), "FAST")

    def test_clamps(self):
        now = 1_000_000
        r = self.m.compute("five_hour", {"utilization": 130, "resets_at": iso(now - 60)}, now)
        self.assertEqual(r["remaining_pct"], 0)
        self.assertEqual(r["reset_in_s"], 0)
        self.assertEqual(self.m.verdict(r), "LOW")

    def test_early_window_has_no_pace(self):
        now = 1_000_000
        r = self.m.compute("five_hour", {"utilization": 5, "resets_at": iso(now + 5 * 3600 - 60)}, now)
        self.assertIsNone(r["pace"])
        self.assertEqual(self.m.verdict(r), "OK")

    def test_slow_only_after_half_window(self):
        now = 1_000_000
        start = now - int(0.6 * 7 * 86400)  # seven_day 已過 60%
        r = self.m.compute("seven_day", {"utilization": 20, "resets_at": iso(start + 7 * 86400)}, now)
        self.assertEqual(self.m.verdict(r), "SLOW")

    # ---- 本機 token 加總 ----
    def test_local_tokens_dedupes_streaming_lines(self):
        d = os.path.join(os.environ["CLAUDE_CONFIG_DIR"], "projects", "p")
        os.makedirs(d)
        now = time.time()
        ts = datetime.now(timezone.utc).isoformat()
        old = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        usage = {"input_tokens": 100, "output_tokens": 50, "cache_creation_input_tokens": 10}
        lines = [
            {"timestamp": ts, "requestId": "r1", "message": {"id": "m1", "usage": usage}},
            {"timestamp": ts, "requestId": "r1", "message": {"id": "m1", "usage": usage}},  # 重複
            {"timestamp": ts, "requestId": "r2", "message": {"id": "m2", "usage": usage}},
            {"timestamp": old, "requestId": "r3", "message": {"id": "m3", "usage": usage}},  # 視窗外
        ]
        with open(os.path.join(d, "s.jsonl"), "w") as f:
            for e in lines:
                f.write(json.dumps(e) + "\n")
            f.write("not json with \"usage\"\n")
        total, out = self.m.local_tokens_since(now - 3600)
        self.assertEqual((total, out), (320, 100))

    # ---- 採集與展示解耦 ----
    def test_collect_then_report(self):
        now = time.time()
        mock = os.path.join(self.tmp.name, "mock.json")
        with open(mock, "w") as f:
            json.dump({"five_hour": {"utilization": 40, "resets_at": iso(now + 3 * 3600)},
                       "seven_day": {"utilization": 10, "resets_at": iso(now + 5 * 86400)},
                       "seven_day_opus": None}, f)
        os.environ["CC_QUOTA_MOCK"] = mock
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.m.cmd_collect(argparse.Namespace(no_tokens=False, verbose=False)), 0)
        rows = sqlite3.connect(os.environ["CC_QUOTA_DB"]).execute(
            "SELECT window, verdict FROM snapshots ORDER BY window").fetchall()
        self.assertEqual([w for w, _ in rows], ["five_hour", "seven_day"])
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(self.m.cmd_report(argparse.Namespace(hours=24)), 0)
        self.assertIn("five_hour", buf.getvalue())

    def test_collect_failure_is_recorded(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.m.cmd_collect(argparse.Namespace(no_tokens=True, verbose=False)), 1)
        n = sqlite3.connect(os.environ["CC_QUOTA_DB"]).execute("SELECT COUNT(*) FROM errors").fetchone()[0]
        self.assertEqual(n, 1)


if __name__ == "__main__":
    unittest.main()

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
from unittest import mock
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

    @contextlib.contextmanager
    def connection(self):
        with contextlib.closing(sqlite3.connect(self.m.DB_PATH)) as conn:
            with conn:
                yield conn

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

    def test_verdict_uses_unrounded_threshold_inputs(self):
        now = 1_000_000
        r = self.m.compute("five_hour", {"utilization": 59.9, "resets_at": iso(now + 9000)}, now)
        self.assertEqual(self.m.verdict(r), "OK")  # pace 1.198 is below 1.2
        r = self.m.compute("five_hour", {"utilization": 20, "resets_at": iso(now + 9007)}, now)
        self.assertEqual(self.m.verdict(r), "OK")  # elapsed 49.961% is below half

    def test_tiny_finite_utilization_has_no_representable_eta(self):
        for used in (5e-324, 1e-300):
            with self.subTest(utilization=used):
                r = self.m.compute("five_hour", {"utilization": used, "resets_at": iso(1007200)}, 1000000)
                self.assertIsNone(r["exhaust_in_s"])
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
        with self.connection() as conn:
            rows = conn.execute("SELECT window, verdict FROM snapshots ORDER BY window").fetchall()
        self.assertEqual([w for w, _ in rows], ["five_hour", "seven_day"])
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(self.m.cmd_report(argparse.Namespace(hours=24)), 0)
        self.assertIn("five_hour", buf.getvalue())

    def test_collect_failure_is_recorded(self):
        with mock.patch.object(self.m, "fetch_usage", side_effect=RuntimeError("offline failure")), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.m.cmd_collect(argparse.Namespace(no_tokens=True, verbose=False)), 1)
        with self.connection() as conn:
            n = conn.execute("SELECT COUNT(*) FROM errors").fetchone()[0]
        self.assertEqual(n, 1)

    def collect(self, data, **patches):
        with mock.patch.object(self.m, "fetch_usage", return_value=data), \
                mock.patch.object(self.m, "notify", **patches), contextlib.redirect_stdout(io.StringIO()):
            return self.m.cmd_collect(argparse.Namespace(no_tokens=True, verbose=False))

    def valid_window(self):
        return {"utilization": 40, "resets_at": iso(time.time() + 7200)}

    def test_compute_rejects_invalid_values(self):
        for bad in (None, True, False, "", "bad", float("nan"), float("inf"), -1):
            with self.subTest(utilization=bad), self.assertRaises(ValueError):
                self.m.compute("five_hour", {"utilization": bad, "resets_at": iso(1000000)}, 999000)
        for bad in (None, True, "bad", "2026-01-01T00:00:00"):
            with self.subTest(reset=bad), self.assertRaises(ValueError):
                self.m.compute("five_hour", {"utilization": 20, "resets_at": bad}, 999000)
        with self.assertRaises(ValueError):
            self.m.compute("five_hour", {"resets_at": iso(1000000)}, 999000)

    def test_invalid_collection_keeps_raw_without_partial_snapshots(self):
        invalid = ({}, [], None, {"five_hour": {}},
                   {"five_hour": self.valid_window(), "seven_day": {"utilization": None, "resets_at": iso(time.time())}})
        for data in invalid:
            with self.subTest(data=data):
                self.assertEqual(self.collect(data), 1)
                with self.connection() as conn:
                    self.assertEqual(conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0], 0)
                    self.assertGreater(conn.execute("SELECT COUNT(*) FROM errors").fetchone()[0], 0)
                    self.assertEqual(json.loads(conn.execute("SELECT json FROM raw ORDER BY ts DESC LIMIT 1").fetchone()[0]), data)

    def test_optional_absent_and_null_windows_are_skipped(self):
        self.assertEqual(self.collect({"five_hour": self.valid_window(), "seven_day_opus": None}), 0)
        with self.connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0], 1)

    def test_relative_database_path_collects(self):
        with mock.patch.object(self.m, "DB_PATH", "relative-quota.db"):
            previous = os.getcwd()
            os.chdir(self.tmp.name)
            try:
                self.assertEqual(self.collect({"five_hour": self.valid_window()}), 0)
            finally:
                os.chdir(previous)

    def test_report_missing_database_creates_nothing(self):
        missing = os.path.join(self.tmp.name, "absent", "quota.db")
        with mock.patch.object(self.m, "DB_PATH", missing), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.m.cmd_report(argparse.Namespace(hours=24)), 1)
        self.assertFalse(os.path.exists(os.path.dirname(missing)))

    def test_report_uses_encoded_readonly_uri_and_closes(self):
        self.m.DB_PATH = os.path.join(self.tmp.name, "quota?# 雪.db")
        self.assertEqual(self.collect({"five_hour": self.valid_window()}), 0)
        real_connect = sqlite3.connect
        connections = []
        def connect(*args, **kwargs):
            self.assertTrue(kwargs.get("uri"))
            self.assertIn("mode=ro", args[0])
            conn = real_connect(*args, **kwargs)
            connections.append(conn)
            return conn
        with mock.patch.object(self.m.sqlite3, "connect", side_effect=connect), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.m.cmd_report(argparse.Namespace(hours=24)), 0)
        with self.assertRaises(sqlite3.ProgrammingError):
            connections[0].execute("SELECT 1")

    def test_report_shows_stale_failure_gap_and_decrements_eta(self):
        self.assertEqual(self.collect({"five_hour": self.valid_window()}), 0)
        now = int(time.time())
        with self.connection() as conn:
            conn.execute("UPDATE snapshots SET ts=?, reset_in_s=10000, exhaust_in_s=9000, resets_at=?", (now - 7200, now + 2800))
            conn.execute("INSERT INTO snapshots SELECT ts-10000,window,used_pct,remaining_pct,reset_in_s,elapsed_pct,pace,exhaust_in_s,resets_at,local_tokens,local_output_tokens,verdict FROM snapshots")
            conn.execute("INSERT INTO errors VALUES (?,?)", (now, "safe failure"))
        buf = io.StringIO()
        with mock.patch.object(self.m.time, "time", return_value=now), contextlib.redirect_stdout(buf):
            self.assertEqual(self.m.cmd_report(argparse.Namespace(hours=24)), 0)
        self.assertIn("STALE", buf.getvalue())
        self.assertIn("GAP", buf.getvalue())
        self.assertIn("safe failure", buf.getvalue())
        self.assertIn("0h30m", buf.getvalue())

    def test_fetch_failure_sanitized_and_notification_failure_is_contained(self):
        secret = "Bearer supersecret HTTP body"
        with mock.patch.object(self.m, "fetch_usage", side_effect=RuntimeError(secret)), \
                mock.patch.object(self.m, "notify", side_effect=OSError(secret)), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.m.cmd_collect(argparse.Namespace(no_tokens=True, verbose=False)), 1)
        with self.connection() as conn:
            errors = str(conn.execute("SELECT message FROM errors").fetchall())
        self.assertNotIn("supersecret", errors)
        self.assertNotIn("HTTP body", errors)

    def test_notification_failure_preserves_snapshot(self):
        self.assertEqual(self.collect({"five_hour": {"utilization": 99, "resets_at": iso(time.time() + 7200)}}, side_effect=OSError("offline")), 0)
        with self.connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM errors").fetchone()[0], 1)

    def test_notification_and_keychain_subprocesses_are_bounded(self):
        with mock.patch.object(self.m.sys, "platform", "darwin"), mock.patch.object(self.m.subprocess, "run", return_value=mock.Mock(returncode=0, stdout='{"claudeAiOauth":{"accessToken":"test"}}')) as run:
            self.m.notify("title", "body")
            self.m.read_token()
        for call in run.call_args_list:
            self.assertGreater(call.kwargs.get("timeout", 0), 0)

    def test_notification_script_preserves_unicode(self):
        with mock.patch.object(self.m.sys, "platform", "darwin"), mock.patch.object(self.m.subprocess, "run") as run:
            self.m.notify("額度", "剩餘 10%")
        script = run.call_args.args[0][-1]
        self.assertIn("額度", script)
        self.assertIn("剩餘", script)
        self.assertNotIn("\\u", script)

    def test_http401_retains_safe_recovery_guidance(self):
        error = self.m.urllib.error.HTTPError("https://invalid/secret", 401, "Bearer supersecret", {}, io.BytesIO(b"secret body"))
        with mock.patch.object(self.m, "read_token", return_value="fake"), \
                mock.patch.object(self.m.urllib.request, "urlopen", side_effect=error), \
                mock.patch.object(self.m, "notify"), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.m.cmd_collect(argparse.Namespace(no_tokens=True, verbose=False)), 1)
        with self.connection() as conn:
            message = conn.execute("SELECT message FROM errors").fetchone()[0]
        self.assertIn("401", message)
        self.assertIn("claude", message)
        self.assertNotIn("secret", message)

    def test_same_second_recollection_replaces_entire_snapshot_set(self):
        with mock.patch.object(self.m.time, "time", return_value=1000000):
            self.assertEqual(self.collect({"five_hour": self.valid_window(), "seven_day_opus": self.valid_window()}), 0)
            self.assertEqual(self.collect({"five_hour": self.valid_window()}), 0)
        with self.connection() as conn:
            self.assertEqual(conn.execute("SELECT window FROM snapshots").fetchall(), [("five_hour",)])

    def test_report_bounds_trend_bar_for_large_finite_utilization(self):
        self.assertEqual(self.collect({"five_hour": {"utilization": 1e100, "resets_at": iso(time.time() + 7200)}}), 0)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(self.m.cmd_report(argparse.Namespace(hours=24)), 0)
        self.assertLessEqual(buf.getvalue().count("█"), 20)

    def test_local_tokens_handles_bad_shapes_and_missing_ids_across_files(self):
        d = os.path.join(self.m.CLAUDE_DIR, "projects", "p")
        os.makedirs(d)
        ts = iso(time.time())
        usage = {"input_tokens": 10, "output_tokens": 5}
        identified = {"timestamp": ts, "requestId": "r", "message": {"id": "m", "usage": usage}}
        lines = [[], {"usage": 1, "timestamp": ts, "message": []},
                 {"timestamp": ts, "message": {"usage": {"input_tokens": "bad"}}},
                 {"timestamp": ts, "message": {"usage": {"input_tokens": True}}},
                 {"timestamp": ts, "message": {"usage": {"input_tokens": 10**30}}},
                 identified, {"timestamp": ts, "message": {"usage": usage}},
                 {"timestamp": ts, "message": {"usage": usage}}]
        for filename, records in (("one.jsonl", lines), ("two.jsonl", [identified])):
            with open(os.path.join(d, filename), "w") as f:
                for record in records:
                    f.write(json.dumps(record) + "\n")
        self.assertEqual(self.m.local_tokens_since(time.time() - 3600), (45, 15))


if __name__ == "__main__":
    unittest.main()

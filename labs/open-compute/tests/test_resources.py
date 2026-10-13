import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import resources


def record(pid=1, start=10, rss=2, cpu=3, status="live"):
    return dict(pid=pid, start_ticks=start, status=status,
                rss_pages=rss, cpu_ticks=cpu)


def stat_line(pid=1, start=10, rss=2, cpu=3, state="S"):
    fields = [state] + ["0"] * 21
    fields[1], fields[11], fields[12] = "0", str(cpu), "0"
    fields[19], fields[21] = str(start), str(rss)
    return f"{pid} (odd ) name (x)) " + " ".join(fields)


def reduced_summary(acc, elapsed, reason=None):
    """Supply scheduling counters for the reducer's synthetic input scans."""
    acc.counts["samples_attempted"] = acc.counts["samples_valid"]
    acc.counts["scheduled_slots"] = acc.counts["samples_valid"]
    return acc.summary(elapsed, reason)


class ParsingTests(unittest.TestCase):
    def test_tricky_comm_and_own_cpu(self):
        result = resources.parse_stat(stat_line(cpu=7))
        self.assertEqual(result, record(cpu=7))
        self.assertEqual(resources.parse_stat(stat_line(cpu=7).encode().replace(b"odd", b"\xff\xe9")), record(cpu=7))
        self.assertEqual(resources.parse_stat(stat_line(cpu=7).replace("odd", "猫")), record(cpu=7))

    def test_bad_stat_is_fixed_error(self):
        for value in ("private /path token", stat_line(rss=-1), "x" * 4097):
            with self.subTest(value=value[:20]), self.assertRaises(resources.ResourceError) as caught:
                resources.parse_stat(value)
            self.assertEqual(str(caught.exception), "stat_error")

    def test_protocol_exact_numeric_schema(self):
        identities = [{"pid": 1, "start_ticks": 10}]
        valid = json.dumps({"records": [record()]})
        self.assertEqual(resources.parse_reply(valid.encode(), identities), [record()])
        bad = [valid.replace('"pid": 1', '"pid": true'),
               valid.replace('"records":', '"path": "/private", "records":'),
               '{"records":[],"records":[]}',
               json.dumps({"records": [record(), record()]}),
               json.dumps({"records": [record(pid=2)]}),
               valid.replace('"rss_pages": 2', '"rss_pages": NaN')]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(resources.ResourceError) as caught:
                resources.parse_reply(value.encode(), identities)
            self.assertEqual(caught.exception.reason, "protocol_error")

    def test_identity_and_units_bounds(self):
        for value, reason in (([{"pid": True, "start_ticks": 0}], "identity_error"),
                              ([{"pid": 1, "start_ticks": -1}], "identity_error"),
                              ([{"pid": i + 1, "start_ticks": 0} for i in range(513)], "identity_limit")):
            with self.assertRaises(resources.ResourceError) as caught:
                resources.normalize_identities(value)
            self.assertEqual(caught.exception.reason, reason)
        with mock.patch.object(resources.os, "sysconf", return_value=True):
            with self.assertRaises(resources.ResourceError):
                resources.resource_units()

    def test_request_rejects_extra_and_duplicate_fields(self):
        for payload in (b'{"identities":[{"pid":1,"start_ticks":0,"path":"/secret"}]}',
                        b'{"identities":[{"pid":1,"pid":2,"start_ticks":0}]}',
                        b'{"identities":[{"pid":1,"start_ticks":0},{"pid":1,"start_ticks":0}]}',
                        b'{"identities":[],"argv":["secret"]}', b'x' * 65537):
            with self.assertRaises(resources.ResourceError) as caught:
                resources.parse_request(payload)
            self.assertEqual(caught.exception.reason, "protocol_error")

    def test_missing_reused_and_unreadable_are_distinct(self):
        identity = [{"pid": 1, "start_ticks": 10}]
        with mock.patch("builtins.open", side_effect=FileNotFoundError):
            self.assertEqual(resources._read_records(identity), [record(rss=None, cpu=None, status="missing")])
        with mock.patch("builtins.open", mock.mock_open(read_data=stat_line(start=11).encode())):
            self.assertEqual(resources._read_records(identity), [record(rss=None, cpu=None, status="reused")])
        with mock.patch("builtins.open", side_effect=PermissionError("private")):
            with self.assertRaises(resources.ResourceError) as caught:
                resources._read_records(identity)
            self.assertEqual(str(caught.exception), "stat_error")


class ReductionTests(unittest.TestCase):
    def test_aggregate_peak_and_own_cpu_pairs(self):
        summary = resources.PhaseAccumulator("source_idle", {"page_size_bytes": 4, "clock_ticks_per_second": 10})
        summary.add_sample([record(rss=10, cpu=1), record(2, rss=1, cpu=5)], 0, 0.01)
        summary.add_sample([record(rss=1, cpu=3), record(2, rss=10, cpu=8)], .25, .01)
        output = reduced_summary(summary, .3)
        self.assertEqual(output["peak_sampled_rss_bytes"], 44)
        self.assertEqual(output["observed_cpu_ticks"], 5)
        self.assertEqual(output["observed_cpu_seconds"], .5)
        self.assertEqual(output["cpu_pairs_observed"], 2)

    def test_gap_absence_generation_and_zombie(self):
        acc = resources.PhaseAccumulator("source_idle", {"page_size_bytes": 4, "clock_ticks_per_second": 10})
        acc.add_sample([record(cpu=2), record(2, cpu=4)], 0, .01)
        acc.add_sample([record(cpu=10), record(2, rss=None, cpu=None, status="missing")], .75, .01)
        acc.add_sample([record(cpu=11), record(2, start=11, rss=100, cpu=1, status="zombie")], 1, .01)
        acc.add_sample([record(cpu=12), record(2, start=11, rss=100, cpu=3, status="zombie")], 1.25, .01)
        out = reduced_summary(acc, 1.3)
        self.assertEqual(out["observed_cpu_ticks"], 4)
        self.assertEqual(out["missing_observations"], 1)
        self.assertEqual(out["zombie_observations"], 2)
        self.assertEqual(out["peak_sampled_rss_bytes"], 16)
        self.assertEqual(out["max_sample_gap_seconds"], .75)
        self.assertGreaterEqual(out["cpu_unpaired_observations"], 4)

    def test_counter_regression_and_non_live_root_fail(self):
        acc = resources.PhaseAccumulator("source_idle", resources.resource_units())
        acc.add_sample([record(cpu=5)], 0, .01)
        with self.assertRaises(resources.ResourceError) as caught:
            acc.add_sample([record(cpu=4)], .25, .01)
        self.assertEqual(caught.exception.reason, "counter_regression")
        for status in ("missing", "reused", "zombie"):
            acc = resources.PhaseAccumulator("source_idle", resources.resource_units())
            with self.assertRaises(resources.ResourceError):
                acc.add_sample([record(status=status, rss=0 if status == "zombie" else None,
                                       cpu=0 if status == "zombie" else None)], 0, .01)

    def test_phase_boundary_has_no_cpu_delta_and_gap_regression_fails(self):
        first = resources.PhaseAccumulator("source_idle", resources.resource_units())
        first.add_sample([record(cpu=500)], 0, .01)
        second = resources.PhaseAccumulator("restarted_idle", resources.resource_units())
        second.add_sample([record(cpu=900)], 0, .01)
        self.assertIsNone(reduced_summary(second, .01)["observed_cpu_ticks"])
        with self.assertRaises(resources.ResourceError) as caught:
            first.add_sample([record(cpu=400)], 1, .01)
        self.assertEqual(caught.exception.reason, "counter_regression")

    def test_projection_rejects_secrets_and_boolean_counts(self):
        phases = {}
        for name in resources.PHASE_NAMES:
            acc = resources.PhaseAccumulator(name, resources.resource_units())
            phases[name] = reduced_summary(acc, 0, reason="insufficient_samples")
        output = resources.resources_extension(phases)
        self.assertEqual(resources.project_resources(output), output)
        output["phases"]["source_idle"]["private_path"] = "/private/token"
        with self.assertRaises(resources.ResourceError):
            resources.project_resources(output)
        del output["phases"]["source_idle"]["private_path"]
        output["phases"]["source_idle"]["samples_valid"] = True
        with self.assertRaises(resources.ResourceError):
            resources.project_resources(output)

    def test_projection_rejects_mislabeled_success_and_wrong_cpu_units(self):
        phases = {}
        for name in resources.PHASE_NAMES:
            acc = resources.PhaseAccumulator(name, resources.resource_units())
            phases[name] = acc.summary(0, "insufficient_samples")
        acc = resources.PhaseAccumulator("source_idle", resources.resource_units())
        acc.add_sample([record(cpu=1)], 0, .01)
        acc.add_sample([record(cpu=6)], .25, .01)
        phases["source_idle"] = reduced_summary(acc, .3)
        valid = resources.resources_extension(phases)
        changes = {"samples_valid": 1, "cpu_pairs_observed": 0,
                   "peak_sampled_rss_bytes": None, "observed_cpu_ticks": None,
                   "observed_cpu_seconds": None, "samples_attempted": 65,
                   "scheduled_slots": 65, "skipped_slots": 1,
                   "probe_completed": 1, "peak_live_process_count": 513}
        for field, replacement in changes.items():
            altered = json.loads(json.dumps(valid))
            altered["phases"]["source_idle"][field] = replacement
            with self.subTest(field=field), self.assertRaises(resources.ResourceError):
                resources.project_resources(altered)
        altered = json.loads(json.dumps(valid))
        altered["units"]["clock_ticks_per_second"] *= 2
        with self.assertRaises(resources.ResourceError):
            resources.project_resources(altered)


class AcquisitionTests(unittest.TestCase):
    def helper(self, script):
        child = subprocess.Popen([sys.executable, "-c", script], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.addCleanup(lambda: resources._close_helper(child))
        return child

    def test_real_controlled_subprocess_and_alarm_unchanged(self):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(20)"])
        try:
            identity = resources.parse_stat(Path(f"/proc/{child.pid}/stat").read_bytes())
            view = [{"pid": child.pid, "start_ticks": identity["start_ticks"], "ignored": "/private"}]
            before = signal.getsignal(signal.SIGALRM), signal.getitimer(signal.ITIMER_REAL)
            output = resources.observe_phase("source_idle", lambda: view, duration_seconds=.8)
            after = signal.getsignal(signal.SIGALRM), signal.getitimer(signal.ITIMER_REAL)
            self.assertEqual(before, after)
            self.assertEqual(output["status"], "observed")
            self.assertGreaterEqual(output["samples_valid"], 2)
            self.assertGreater(output["peak_sampled_rss_bytes"], 0)
        finally:
            child.terminate()
            child.wait(timeout=3)

    def test_four_fixed_windows_controlled_process(self):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            parsed = resources.parse_stat(Path(f"/proc/{child.pid}/stat").read_bytes())
            identities = lambda: [{"pid": child.pid, "start_ticks": parsed["start_ticks"]}]
            phases = {}
            for name in resources.PHASE_NAMES:
                starts = []
                is_probe = name.endswith("read_probe")
                duration = 4 if is_probe else 3
                def probe(deadline):
                    self.assertLess(time.monotonic(), deadline)
                    starts.append(time.monotonic())
                phases[name] = resources.observe_phase(name, identities, duration_seconds=duration,
                                                      probe=probe if is_probe else None,
                                                      probe_count=8 if is_probe else 0)
                self.assertEqual(phases[name]["probe_completed"], 8 if is_probe else 0)
                self.assertGreaterEqual(phases[name]["samples_valid"], 2)
                self.assertEqual(phases[name]["scheduled_slots"], 16 if is_probe else 12)
                self.assertGreaterEqual(phases[name]["elapsed_seconds"], duration)
                self.assertTrue(all(b - a >= .5 for a, b in zip(starts, starts[1:])))
            extension = resources.resources_extension(phases)
            self.assertEqual(set(extension["phases"]), set(resources.PHASE_NAMES))
            self.assertLess(len(json.dumps(extension, indent=2, sort_keys=True).encode()), 48 * 1024)
            self.assertNotIn("pid", json.dumps(extension))
        finally:
            child.terminate()
            child.wait(timeout=3)

    def test_timeout_helper_killed_reaped_and_sanitized(self):
        original = resources._spawn_helper
        launched = []
        def hung():
            child = subprocess.Popen([sys.executable, "-c", "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(20)"],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            launched.append(child)
            return child
        with mock.patch.object(resources, "_spawn_helper", side_effect=hung):
            start = time.monotonic()
            with self.assertRaises(resources.ResourceError) as caught:
                resources.acquire_sample([{"pid": os.getpid(), "start_ticks": 0}], time.monotonic() + .2)
            self.assertEqual(caught.exception.reason, "helper_timeout")
            self.assertLess(time.monotonic() - start, 2)
            self.assertIsNotNone(launched[0].poll())
            self.assertTrue(launched[0].stdin.closed)
            self.assertTrue(launched[0].stdout.closed)
        self.assertIs(resources._spawn_helper, original)

    def test_observer_runs_during_serial_probe_and_deadline_failure(self):
        starts, samples = [], []
        def sample(identities, deadline):
            samples.append(time.monotonic())
            return [record(cpu=len(samples))]
        def probe(deadline):
            starts.append(time.monotonic())
            time.sleep(.32)
        with mock.patch.object(resources, "acquire_sample", side_effect=sample):
            out = resources.observe_phase("source_read_probe", lambda: [{"pid": 1, "start_ticks": 10}],
                                          duration_seconds=4, probe=probe, probe_count=8)
        self.assertEqual(out["probe_completed"], 8)
        self.assertGreaterEqual(starts[1] - starts[0], .5)
        self.assertTrue(any(starts[0] < t < starts[0] + .32 for t in samples))
        with mock.patch.object(resources, "acquire_sample", side_effect=sample):
            with self.assertRaises(resources.ResourceError) as caught:
                resources.observe_phase("source_read_probe", lambda: [{"pid": 1, "start_ticks": 10}],
                                        duration_seconds=.4, probe=lambda d: time.sleep(.45), probe_count=1)
        self.assertEqual(caught.exception.reason, "phase_timeout")
        self.assertEqual(caught.exception.summary["probe_completed"], 0)

    def test_unknown_identity_error_sanitized_partial(self):
        def broken():
            raise RuntimeError("/private/credential")
        with self.assertRaises(resources.ResourceError) as caught:
            resources.observe_phase("source_idle", broken, duration_seconds=.3)
        self.assertEqual(caught.exception.reason, "identity_error")
        self.assertNotIn("private", json.dumps(caught.exception.summary))

    def test_sample_ceiling_fails_without_invisible_retries(self):
        with mock.patch.object(resources, "INTERVAL_SECONDS", .005), mock.patch.object(resources, "acquire_sample", return_value=[record()]):
            with self.assertRaises(resources.ResourceError) as caught:
                resources.observe_phase("source_idle", lambda: [{"pid": 1, "start_ticks": 10}], duration_seconds=.7)
        self.assertEqual(caught.exception.reason, "sample_limit")
        self.assertEqual(caught.exception.summary["samples_attempted"], 64)
        self.assertGreater(caught.exception.summary["skipped_slots"], 0)

    def test_insufficient_samples_and_bounded_thread_join(self):
        with mock.patch.object(resources, "acquire_sample", return_value=[record()]):
            with self.assertRaises(resources.ResourceError) as caught:
                resources.observe_phase("source_idle", lambda: [{"pid": 1, "start_ticks": 10}], duration_seconds=.1)
        self.assertEqual(caught.exception.reason, "insufficient_samples")
        self.assertEqual(caught.exception.summary["samples_valid"], 1)
        self.assertIsNone(caught.exception.summary["observed_cpu_seconds"])
        thread = mock.Mock()
        thread.is_alive.return_value = True
        with mock.patch.object(resources.threading, "Thread", return_value=thread):
            with self.assertRaises(resources.ResourceError) as caught:
                resources.observe_phase("source_idle", lambda: [{"pid": 1, "start_ticks": 10}], duration_seconds=.01)
        self.assertEqual(caught.exception.reason, "helper_cleanup")
        thread.join.assert_called_once_with(timeout=3.0)

    def test_sparse_valid_samples_are_insufficient(self):
        def slow(identities, deadline):
            time.sleep(.55)
            return [record()]
        with mock.patch.object(resources, "acquire_sample", side_effect=slow):
            with self.assertRaises(resources.ResourceError) as caught:
                resources.observe_phase("source_idle", lambda: [{"pid": 1, "start_ticks": 10}], duration_seconds=1.2)
        # Last overdue scan is rejected at the phase deadline; two earlier
        # samples cannot disguise this acquisition failure as successful CPU.
        self.assertEqual(caught.exception.reason, "phase_timeout")
        self.assertEqual(caught.exception.summary["cpu_pairs_observed"], 0)
        self.assertGreater(caught.exception.summary["max_scan_seconds"], .5)

    def test_full_request_write_is_deadline_bounded(self):
        child = self.helper("import time; time.sleep(20)")
        identities = [{"pid": i + 1, "start_ticks": 1000000000000} for i in range(512)]
        with mock.patch.object(resources, "_spawn_helper", return_value=child):
            started = time.monotonic()
            with self.assertRaises(resources.ResourceError) as caught:
                resources.acquire_sample(identities, started + .15)
        self.assertEqual(caught.exception.reason, "helper_timeout")
        self.assertLess(time.monotonic() - started, 1.8)
        self.assertIsNotNone(child.returncode)

    def test_excess_and_malformed_helper_replies_are_reaped(self):
        for script in ("import sys; sys.stdout.write('x'*70000); sys.stdout.flush()",
                       "import sys; sys.stdin.read(); print('{\"records\":[],\"token\":\"secret\"}')",
                       "import sys; sys.stdin.read(); sys.exit(2)"):
            child = self.helper(script)
            with mock.patch.object(resources, "_spawn_helper", return_value=child):
                with self.assertRaises(resources.ResourceError) as caught:
                    resources.acquire_sample([{"pid": 1, "start_ticks": 10}], time.monotonic() + 1)
            self.assertEqual(caught.exception.reason, "stat_error" if script.endswith("exit(2)") else "protocol_error")
            self.assertIsNotNone(child.returncode)

    def test_incomplete_helper_reap_is_not_success(self):
        child = mock.Mock()
        child.poll.return_value = None
        child.wait.side_effect = subprocess.TimeoutExpired("private", 1)
        with self.assertRaises(resources.ResourceError) as caught:
            resources._close_helper(child)
        self.assertEqual(caught.exception.reason, "helper_cleanup")
        child.terminate.assert_called_once()
        child.kill.assert_called_once()
        self.assertEqual(child.wait.call_args_list, [mock.call(timeout=.5), mock.call(timeout=1.0)])
        child.stdin.close.assert_called_once()
        child.stdout.close.assert_called_once()

    def test_late_reply_cannot_contribute_metrics(self):
        def sample(identities, deadline):
            time.sleep(.2)
            return [record(cpu=1)]
        with mock.patch.object(resources, "acquire_sample", side_effect=sample):
            with self.assertRaises(resources.ResourceError) as caught:
                resources.observe_phase("source_idle", lambda: [{"pid": 1, "start_ticks": 10}], duration_seconds=.1)
        self.assertEqual(caught.exception.reason, "phase_timeout")
        self.assertEqual(caught.exception.summary["samples_valid"], 0)
        self.assertIsNone(caught.exception.summary["peak_sampled_rss_bytes"])

    def test_probe_failure_retains_sanitized_samples(self):
        def broken(deadline):
            time.sleep(.3)
            raise OSError("/private/token")
        with mock.patch.object(resources, "acquire_sample", return_value=[record()]):
            with self.assertRaises(resources.ResourceError) as caught:
                resources.observe_phase("source_read_probe", lambda: [{"pid": 1, "start_ticks": 10}],
                                        duration_seconds=1, probe=broken, probe_count=2)
        self.assertEqual(caught.exception.reason, "probe_failed")
        self.assertEqual(caught.exception.summary["probe_attempted"], 1)
        self.assertEqual(caught.exception.summary["probe_completed"], 0)
        self.assertGreaterEqual(caught.exception.summary["samples_valid"], 2)
        self.assertNotIn("private", json.dumps(caught.exception.summary))


if __name__ == "__main__":
    unittest.main()

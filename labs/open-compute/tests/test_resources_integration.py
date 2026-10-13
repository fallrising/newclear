"""M3 harness contracts; mocked runtime results do not certify upstream."""

from contextlib import ExitStack, redirect_stdout
import io
import json
import os
from pathlib import Path
import signal
import socketserver
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lab
import resources


def summary(name, reason=None):
    acc = resources.PhaseAccumulator(name, resources.resource_units())
    acc.counts.update(scheduled_slots=2, samples_attempted=2,
                      probe_attempted=8 if name.endswith("read_probe") else 0,
                      probe_completed=8 if name.endswith("read_probe") else 0)
    record = {"pid": 10, "start_ticks": 100, "status": "live", "rss_pages": 2, "cpu_ticks": 1}
    acc.add_sample([record], 0, .01)
    acc.add_sample([dict(record, cpu_ticks=2)], .25, .01)
    return acc.summary(4 if name.endswith("read_probe") else 3, reason)


class IntegrationTests(unittest.TestCase):
    def run_scenario(self, failing_phase=None, bad_probe=None, cleanup_failure=False,
                     invalid_summary=False, evidence_failure=False, slow_phase=False,
                     slow_remove=False, slow_shutdown=False, budget_limits=None,
                     bad_probe_phase="source_read_probe", failure_reason="stat_error",
                     resource_scenario=True):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root = Path(tmp)
            scope_path = root / ".open-compute"
            output = root / "evidence"
            events, processes, probe_reads = [], [], []
            active_phase = [None]
            job = {"id": None, "payload": "synthetic-m1", "callback_count": 1,
                   "step_nonce": "fixture-nonce", "completed": 0}
            workflow = {"id": None, "approved": False}

            def command(argv, timeout=30):
                if "--version" in argv:
                    return "ocd 0.2.4"
                if "setup" in argv:
                    config = scope_path / "instances/lab/compute.toml"
                    config.parent.mkdir(parents=True)
                    config.write_text("synthetic config")
                    data = config.parent / "data"
                    (data / "keys").mkdir(parents=True)
                    for name in ("deployer.token", "read-only.token", "master.key"):
                        key = data / "keys" / name
                        key.write_text("private-" + name)
                        key.chmod(0o600)
                    return ""
                return json.dumps({"instances": [{"name": "lab", "state": "running", "instance_id": "instance-1"}]})

            class HTTP:
                def __init__(self, *args):
                    pass

                def request(self, method, path, body=None, content_type="application/json", host=None, *, deadline=None):
                    if path in ("/health/live", "/health"):
                        value = {"fixture": "open-compute-m1", "ok": True}
                    elif path == "/jobs":
                        job["id"] = body["id"]
                        value = {"job": dict(job), "row_count": 1}
                    elif path.startswith("/jobs/"):
                        value = {"job": dict(job, completed=int(workflow["approved"])), "row_count": 1}
                    else:
                        raise AssertionError(path)
                    if deadline is not None:
                        probe_reads.append((path, deadline))
                        events.append("probe:" + path.split("/")[1])
                        failure = bad_probe if active_phase[0] == bad_probe_phase else None
                        if failure == "row_count" and path.startswith("/jobs/"):
                            value["row_count"] = 2
                        if failure == "row_count_boolean" and path.startswith("/jobs/"):
                            value["row_count"] = True
                        if failure == "job" and path.startswith("/jobs/"):
                            value["job"]["payload"] = "changed"
                        if failure == "health" and path == "/health":
                            value["ok"] = False
                        if failure == "health_numeric" and path == "/health":
                            value["ok"] = 1
                        if failure == "http":
                            raise lab.LabError("HTTP failed")
                    return value

                def v4(self, method, path, body=None, content_type="application/json"):
                    if path.endswith("/accounts"):
                        return [{"id": "account-1"}]
                    if path.endswith("/d1/database"):
                        return {"uuid": "database-1"}
                    if path.endswith("/endpoints"):
                        return [{"kind": "local_origin", "url": "http://worker.local:8787"}]
                    if path.endswith("/instances"):
                        workflow["id"] = body["instance_id"]
                        return {"id": workflow["id"]}
                    if path.endswith("/events/approval"):
                        events.append("approval")
                        workflow["approved"] = True
                        return {"instanceId": workflow["id"]}
                    return {}

            def process(argv):
                number = len(processes) + 1
                events.append("spawn:" + str(number))
                item = Mock()
                item.identity = {"pid": number + 10, "start_ticks": 100 + number, "pgid": number + 10}
                item.process.pid = number + 10
                item.process.poll.return_value = None
                item.observation_error = None
                item.text.return_value = ""
                item.children.return_value = [{"pid": number + 20, "start_ticks": 200 + number}]
                item.observed_identities.return_value = [dict(item.identity)]
                item.live.return_value = [dict(item.identity), {"pid": number + 20, "start_ticks": 200 + number, "pgid": number + 20}]
                def stop():
                    events.append("stop:" + str(number))
                    if slow_shutdown and number == 2:
                        time.sleep(.2)
                    if not cleanup_failure:
                        item.live.return_value = []
                    return {"was_running": True, "forced": False,
                            "all_owned_exited": not cleanup_failure, "exit_code": 0}
                item.stop.side_effect = stop
                processes.append(item)
                return item

            def observe(name, identities, *, duration_seconds, probe=None, probe_count=0):
                events.append(name)
                active_phase[0] = name
                self.assertEqual(identities(), processes[-1].observed_identities())
                self.assertEqual(duration_seconds, 4 if name.endswith("read_probe") else 3)
                self.assertEqual(probe_count, 8 if name.endswith("read_probe") else 0)
                if name == failing_phase:
                    raise resources.ResourceError(failure_reason, summary(name, failure_reason))
                if slow_phase:
                    time.sleep(.2)
                try:
                    for _ in range(probe_count):
                        probe(time.monotonic() + 4)
                except Exception:
                    raise resources.ResourceError("probe_failed", summary(name, "probe_failed")) from None
                value = summary(name)
                if invalid_summary:
                    value["private_path"] = "/private/secret"
                return value

            def poll(probe, predicate, timeout, phase):
                if phase == "daemon bootstrap":
                    return True
                result = probe()
                self.assertTrue(predicate(result))
                return result

            def wait(api, path, target, timeout=60):
                events.append("workflow:" + target)
                return {"status": target, "steps": [{"name": "instrumented-callback", "success": True}],
                        "output": {"jobId": job["id"], "nonce": job["step_nonce"]}}

            patches = {
                "pwd.getpwuid": lambda uid: SimpleNamespace(pw_dir=str(root)),
                "preflight": lambda port: scope_path,
                "source_commit": lambda: "a" * 40,
                "download_binary": lambda *args: root / "ocd",
                "sha256_file": lambda path: "b" * 64,
                "command": command,
                "Process": process,
                "LocalHTTP": HTTP,
                "poll": poll,
                "wait_workflow": wait,
                "worker_host": lambda endpoint, port: "worker.local:8787",
                "state_identity": lambda *args: {"fixture": 1},
            }
            for name, value in patches.items():
                stack.enter_context(patch("lab." + name, value))
            stack.enter_context(patch("resources.observe_phase", observe))
            if budget_limits is not None:
                original_deadline = lab.m3_deadline
                def deadline(seconds, phase):
                    events.append("budget:" + str(seconds))
                    return original_deadline(budget_limits.get(seconds, seconds), phase)
                stack.enter_context(patch("lab.m3_deadline", deadline))
            if slow_remove:
                original_remove = lab.OwnedScope.remove
                def remove(scope, processes_stopped):
                    time.sleep(.2)
                    return original_remove(scope, processes_stopped)
                stack.enter_context(patch.object(lab.OwnedScope, "remove", remove))
            if evidence_failure:
                original = lab.exclusive_file
                def write(path, contents, mode=0o600):
                    if path.name == "report.json":
                        raise OSError("evidence refused")
                    return original(path, contents, mode)
                stack.enter_context(patch("lab.exclusive_file", write))
            stream = io.StringIO()
            with redirect_stdout(stream):
                code = lab.integration(SimpleNamespace(port=8787, cache=str(root / "cache"), output=str(output)), resources=resource_scenario)
            report = json.loads(stream.getvalue())
            evidence = json.loads((output / "report.json").read_text()) if (output / "report.json").exists() else None
            return code, report, events, probe_reads, scope_path.exists(), evidence

    def test_four_fixed_windows_precede_original_approval_and_complete_cleanup(self):
        code, report, events, probes, scope_exists, evidence = self.run_scenario()
        self.assertEqual(code, 0, report)
        expected = ["source_idle", "source_read_probe", "stop:1", "spawn:2",
                    "restarted_idle", "restarted_read_probe", "approval", "stop:2"]
        self.assertEqual([event for event in events if event in expected], expected)
        self.assertEqual(len(probes), 16)
        self.assertEqual([path.split("/")[1] for path, _ in probes], ["health", "jobs"] * 8)
        self.assertEqual(set(report["resources"]["phases"]), set(resources.PHASE_NAMES))
        self.assertTrue(all(value == "passed" for value in report["acceptance"].values()))
        self.assertEqual(set(report["acceptance"]), {f"M3-{n:02}" for n in range(1, 6)})
        self.assertTrue(all(value == "passed" for value in report["functional_acceptance"].values()))
        self.assertEqual(report, evidence)
        self.assertFalse(scope_exists)

    def test_each_observation_failure_stops_before_approval_and_cleans(self):
        for phase in resources.PHASE_NAMES:
            with self.subTest(phase=phase):
                code, report, events, _, exists, _ = self.run_scenario(failing_phase=phase)
                self.assertEqual(code, 1)
                self.assertNotIn("approval", events)
                self.assertFalse(exists)
                self.assertEqual(report["error"], "stat_error")
                self.assertNotEqual(report["acceptance"]["M3-03"], "passed")
                self.assertNotEqual(report["acceptance"]["M3-04"], "passed")
                phases = report.get("resource_phases", report.get("resources", {}).get("phases", {}))
                self.assertEqual(set(phases), set(resources.PHASE_NAMES[:resources.PHASE_NAMES.index(phase) + 1]))
                self.assertEqual(phases[phase]["reason"], "stat_error")
                if phase != resources.PHASE_NAMES[-1]:
                    self.assertNotIn("resources", report)

    def test_read_validation_failures_cannot_pass_or_skip_cleanup(self):
        for phase in ("source_read_probe", "restarted_read_probe"):
            for bad_probe in ("row_count", "row_count_boolean", "job", "health", "health_numeric", "http"):
                with self.subTest(phase=phase, bad_probe=bad_probe):
                    code, report, events, _, exists, _ = self.run_scenario(bad_probe=bad_probe, bad_probe_phase=phase)
                    self.assertEqual(code, 1)
                    self.assertEqual(report["error"], "probe_failed")
                    self.assertNotIn("approval", events)
                    self.assertIn("stop:1", events)
                    self.assertFalse(exists)

    def test_original_m1_report_and_workflow_semantics_are_preserved(self):
        code, report, events, probes, exists, evidence = self.run_scenario(resource_scenario=False)
        self.assertEqual(code, 0, report)
        self.assertEqual(set(report["acceptance"]), {f"AC-{n:02}" for n in range(1, 9)})
        self.assertNotIn("functional_acceptance", report)
        self.assertNotIn("resources", report)
        self.assertEqual(report["command"], "make integration")
        self.assertEqual(probes, [])
        self.assertIn("approval", events)
        self.assertFalse(exists)
        self.assertEqual(report, evidence)

    def test_incomplete_helper_cleanup_fails_resource_gates(self):
        code, report, events, _, _, _ = self.run_scenario(failing_phase="source_idle", failure_reason="helper_cleanup")
        self.assertEqual(code, 1)
        self.assertEqual(report["error"], "helper_cleanup")
        self.assertNotIn("approval", events)
        self.assertNotEqual(report["acceptance"]["M3-03"], "passed")
        self.assertNotEqual(report["acceptance"]["M3-04"], "passed")

    def test_scenario_expiry_still_runs_separate_cleanup(self):
        code, report, events, _, exists, _ = self.run_scenario(slow_phase=True, budget_limits={300: .05})
        self.assertEqual(code, 1)
        self.assertIn("M3 scenario", report["error"])
        self.assertNotIn("approval", events)
        self.assertIn("stop:1", events)
        self.assertIn("budget:150", events)
        self.assertIn("budget:30", events)
        self.assertFalse(exists)

    def test_cleanup_and_scope_removal_have_distinct_finite_budgets(self):
        for mode in ("shutdown", "remove"):
            with self.subTest(mode=mode):
                code, report, events, _, exists, _ = self.run_scenario(
                    slow_shutdown=mode == "shutdown", slow_remove=mode == "remove",
                    budget_limits={150: .05} if mode == "shutdown" else {30: .05})
                self.assertEqual(code, 1)
                self.assertTrue(exists)
                self.assertIn("budget:300", events)
                self.assertIn("budget:150", events)
                self.assertIn("deadline", report["cleanup_error"])
                self.assertNotEqual(report["acceptance"]["M3-04"], "passed")

    def test_unknown_cleanup_preserves_scope_and_fails(self):
        code, report, _, _, exists, _ = self.run_scenario(cleanup_failure=True)
        self.assertEqual(code, 1)
        self.assertTrue(exists)
        self.assertIn("cleanup_error", report)
        self.assertNotEqual(report["acceptance"]["M3-04"], "passed")

    def test_extra_resource_fields_never_reach_public_output(self):
        code, report, _, _, exists, _ = self.run_scenario(invalid_summary=True)
        self.assertEqual(code, 1)
        self.assertNotIn("/private/secret", json.dumps(report))
        self.assertFalse(exists)

    def test_evidence_failure_cannot_claim_sanitized_report_gate(self):
        code, report, _, _, exists, evidence = self.run_scenario(evidence_failure=True)
        self.assertEqual(code, 1)
        self.assertNotEqual(report["acceptance"]["M3-05"], "passed")
        self.assertFalse(exists)
        self.assertIsNone(evidence)


class DeadlineTests(unittest.TestCase):
    def test_http_phase_deadline_bounds_real_trickling_headers_and_body(self):
        for phase in ("headers", "body"):
            class Handler(socketserver.BaseRequestHandler):
                def handle(self):
                    self.request.recv(4096)
                    try:
                        prefix = (b"HTTP/1.1 200 OK\r\nX-Slow: " if phase == "headers" else
                                  b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n")
                        self.request.sendall(prefix)
                        for _ in range(30):
                            self.request.sendall(b" ")
                            time.sleep(.02)
                    except OSError:
                        pass
            class Server(socketserver.ThreadingTCPServer):
                daemon_threads = True
            with Server(("127.0.0.1", 0), Handler) as server:
                thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
                thread.start()
                started = time.monotonic()
                try:
                    with self.subTest(phase=phase), self.assertRaisesRegex(lab.LabError, "deadline"):
                        lab.LocalHTTP(server.server_address[1]).request("GET", "/", deadline=started + .12)
                    self.assertLess(time.monotonic() - started, .5)
                finally:
                    server.shutdown()
                    thread.join(timeout=2)

    def test_expired_http_deadline_refuses_to_connect(self):
        with patch("lab.http.client.HTTPConnection") as connect:
            with self.assertRaisesRegex(lab.LabError, "deadline"):
                lab.LocalHTTP(8787).request("GET", "/", deadline=time.monotonic() - 1)
            connect.assert_not_called()

    def test_nested_alarm_restores_outer_absolute_budget_and_handler(self):
        original = signal.getsignal(signal.SIGALRM)
        with lab.m3_deadline(.8, "outer"):
            outer_handler = signal.getsignal(signal.SIGALRM)
            before = signal.getitimer(signal.ITIMER_REAL)[0]
            with lab.m3_deadline(.4, "inner"):
                time.sleep(.06)
            remaining = signal.getitimer(signal.ITIMER_REAL)[0]
            self.assertIs(signal.getsignal(signal.SIGALRM), outer_handler)
            self.assertLess(remaining, before - .045)
            self.assertGreater(remaining, before - .2)
        self.assertIs(signal.getsignal(signal.SIGALRM), original)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_long_inner_cannot_extend_outer_and_exception_restores_handler(self):
        original = signal.getsignal(signal.SIGALRM)
        started = time.monotonic()
        with self.assertRaisesRegex(lab.LabError, "outer"):
            with lab.m3_deadline(.1, "outer"):
                with lab.m3_deadline(1, "inner"):
                    time.sleep(.4)
        self.assertLess(time.monotonic() - started, .3)
        self.assertIs(signal.getsignal(signal.SIGALRM), original)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_external_timer_remaining_and_interval_are_preserved(self):
        previous = signal.getsignal(signal.SIGALRM)
        handler = lambda *_: None
        try:
            signal.signal(signal.SIGALRM, handler)
            signal.setitimer(signal.ITIMER_REAL, .8, .7)
            with lab.m3_deadline(.3, "inner"):
                time.sleep(.06)
            remaining, interval = signal.getitimer(signal.ITIMER_REAL)
            self.assertIs(signal.getsignal(signal.SIGALRM), handler)
            self.assertGreater(remaining, .6)
            self.assertLess(remaining, .76)
            self.assertEqual(interval, .7)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous)


if __name__ == "__main__":
    unittest.main()

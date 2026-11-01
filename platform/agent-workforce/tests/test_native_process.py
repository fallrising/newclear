"""Real local children exercise supervision; none invokes a provider."""
import hashlib
import json
import os
from pathlib import Path
import sys
import signal
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from agent_workforce.native_process import ProcessError, ProcessSupervisor


class ProcessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get("AGENT_BUILD_DIR"))
        self.base = Path(self.temp.name)
        self.root = self.base / "journal"
        self.supervisor = ProcessSupervisor(self.root)
        self.args = [sys.executable, "-c", "print('synthetic output')"]
        self.binding = {"worker": "synthetic-worker", "revision": 1}

    def tearDown(self):
        self.temp.cleanup()

    def execute(self, operation="one", argv=None, **kwargs):
        return self.supervisor.execute(operation, argv or self.args, str(self.base),
                                       binding=self.binding, timeout_seconds=kwargs.pop("timeout_seconds", 2), **kwargs)

    def test_exit_capture_reopen_and_no_effect_proof(self):
        result = self.execute()
        self.assertEqual((result["status"], result["exit_code"]), ("exited", 0))
        self.assertFalse(result["stopped"])
        self.assertTrue(result["leader_stopped"])
        self.assertFalse(result["effects_resolved"])
        self.assertEqual(Path(result["stdout_path"]).read_bytes(), b"synthetic output\n")
        self.assertEqual(Path(result["stderr_path"]).read_bytes(), b"")
        self.assertEqual(set(result["ownership"]), {"boot_id", "pid", "start_ticks", "pgid", "sid"})
        result["binding"]["revision"] = 8
        original = ProcessSupervisor(self.root).inspect("one")
        self.assertEqual(original["binding"], self.binding)
        with patch("agent_workforce.native_process.subprocess.Popen", side_effect=AssertionError("respawn")):
            self.assertEqual(self.execute()["exit_code"], 0)

    def test_duplicate_conflicts_all_frozen_inputs(self):
        self.execute()
        mutations = [{"argv": [sys.executable, "-c", "pass"]}, {"cwd": str(self.root)},
                     {"binding": {"revision": 2}}, {"timeout_seconds": 3}, {"max_output_bytes": 100}]
        for mutation in mutations:
            request = dict(argv=self.args, cwd=str(self.base), binding=self.binding, timeout_seconds=2)
            request.update(mutation)
            with self.subTest(mutation=mutation), self.assertRaises(ProcessError):
                self.supervisor.execute("one", **request)

    def test_concurrent_handles_duplicate_and_stop(self):
        args = [sys.executable, "-c", "import time; print('ready',flush=True); time.sleep(20)"]
        results, errors = [], []
        def run():
            try:
                results.append(self.execute(argv=args, timeout_seconds=4))
            except BaseException as exc:
                errors.append(exc)
        thread = threading.Thread(target=run)
        thread.start()
        try:
            other = ProcessSupervisor(self.root)
            deadline = time.monotonic() + 2
            while other.inspect("one")["status"] != "running" and time.monotonic() < deadline:
                time.sleep(.01)
            duplicate = other.execute("one", args, str(self.base), binding=self.binding, timeout_seconds=4)
            self.assertEqual(duplicate["status"], "running")
            helper = ("import json,sys; from agent_workforce.native_process import ProcessSupervisor; "
                      "print(json.dumps(ProcessSupervisor(sys.argv[1]).execute('one',json.loads(sys.argv[2]),"
                      "sys.argv[3],binding=json.loads(sys.argv[4]),timeout_seconds=4)))")
            separate = subprocess.run([sys.executable, "-c", helper, str(self.root), json.dumps(args),
                                       str(self.base), json.dumps(self.binding)],
                                      capture_output=True, check=True, timeout=2)
            self.assertEqual(json.loads(separate.stdout)["ownership"], duplicate["ownership"])
            stopped = other.stop("one")
            self.assertFalse(stopped["stopped"])
            self.assertTrue(stopped["leader_stopped"])
            self.assertEqual(stopped["status"], "unknown")
        finally:
            thread.join(6)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 1)
        self.assertFalse(results[0]["effects_resolved"])

    def test_timeout_bounds_process_and_records_identity(self):
        started = time.monotonic()
        result = self.execute(argv=[sys.executable, "-c", "import time; time.sleep(20)"], timeout_seconds=.15)
        self.assertLess(time.monotonic() - started, 3)
        self.assertTrue(result["timed_out"])
        self.assertFalse(result["stopped"])
        self.assertTrue(result["leader_stopped"])
        self.assertIsNotNone(result["ownership"])
        self.assertFalse(result["effects_resolved"])

    def test_timeout_tracks_and_stops_observed_descendant(self):
        child = "import time; time.sleep(20)"
        parent = "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c'," + repr(child) + "]); print(p.pid,flush=True); time.sleep(20)"
        result = self.execute(argv=[sys.executable, "-c", parent], timeout_seconds=.35)
        self.assertFalse(result["stopped"])
        self.assertTrue(result["leader_stopped"])
        self.assertTrue(result["timed_out"])
        self.assertGreaterEqual(len(result["observed"]), 2)

    def test_escaped_observed_descendant_cannot_prove_complete_stop(self):
        child = "import os,time; time.sleep(.25); os.setsid(); time.sleep(20)"
        parent = "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c'," + repr(child) + "]); print(p.pid,flush=True); time.sleep(.12)"
        result = None
        try:
            result = self.execute(argv=[sys.executable, "-c", parent], timeout_seconds=.6)
            self.assertFalse(result["stopped"])
            self.assertFalse(result["visibility_complete"])
            self.assertEqual(result["status"], "exited")
            self.assertTrue(result["leader_stopped"])
        finally:
            if result is not None:
                pid = int(Path(result["stdout_path"]).read_text())
                try:
                    fd = os.pidfd_open(pid)
                except ProcessLookupError:
                    pass
                else:
                    try:
                        signal.pidfd_send_signal(fd, signal.SIGKILL)
                    finally:
                        os.close(fd)

    def test_immediate_detach_before_first_scan_never_proves_complete_stop(self):
        # Deterministic receipt delay creates the actual observation gap. The
        # child immediately leaves the session and closes inherited stdio.
        child = "import time; time.sleep(20)"
        parent = ("import subprocess,sys; p=subprocess.Popen([sys.executable,'-c'," + repr(child)
                  + "],start_new_session=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,"
                    "stderr=subprocess.DEVNULL); print(p.pid,flush=True)")
        self.supervisor._fault = lambda point: time.sleep(.2) if point == "after_spawn" else None
        result = None
        try:
            result = self.execute(argv=[sys.executable, "-c", parent])
            self.assertFalse(result["stopped"])
            self.assertTrue(result["leader_stopped"])
            self.assertEqual((result["status"], result["exit_code"]), ("exited", 0))
        finally:
            if result is not None:
                pid = int(Path(result["stdout_path"]).read_text())
                try:
                    fd = os.pidfd_open(pid)
                except ProcessLookupError:
                    pass
                else:
                    try:
                        signal.pidfd_send_signal(fd, signal.SIGKILL)
                    finally:
                        os.close(fd)

    def test_unavailable_process_visibility_stays_unknown(self):
        result = self.execute()
        state_path = Path(result["stdout_path"]).parent / "state.json"
        state = json.loads(state_path.read_text())
        state.update(status="running", stopped=False)
        state_path.write_text(json.dumps(state))
        with patch("agent_workforce.native_process._identity", side_effect=ProcessError("unavailable")):
            self.assertEqual(self.supervisor.inspect("one")["status"], "unknown")
            self.assertFalse(self.supervisor.stop("one")["stopped"])

    def test_combined_output_limit_and_stderr_drain(self):
        code = "import os;\nwhile True:\n os.write(1,b'x'*8192); os.write(2,b'y'*8192)"
        result = self.execute(argv=[sys.executable, "-c", code], max_output_bytes=257)
        self.assertTrue(result["output_limited"])
        self.assertFalse(result["stopped"])
        self.assertTrue(result["leader_stopped"])
        self.assertLessEqual(sum(Path(result[key]).stat().st_size for key in ("stdout_path", "stderr_path")), 257)

    def test_nonzero_and_missing_binary_are_distinct(self):
        result = self.execute(argv=[sys.executable, "-c", "import sys; print('err',file=sys.stderr); sys.exit(7)"])
        self.assertEqual(result["exit_code"], 7)
        self.assertEqual(Path(result["stderr_path"]).read_bytes(), b"err\n")
        missing = self.execute("missing", argv=[str(self.base / "missing-binary")])
        self.assertEqual(missing["status"], "not_started")
        self.assertFalse(missing["effects_resolved"])

    def test_pre_spawn_gap_reopens_unknown_and_never_respawns(self):
        def fault(point):
            if point == "after_intent":
                raise RuntimeError("synthetic crash")
        self.supervisor._fault = fault
        with self.assertRaises(RuntimeError):
            self.execute()
        reopened = ProcessSupervisor(self.root)
        self.assertEqual(reopened.inspect("one")["status"], "unknown")
        with patch("agent_workforce.native_process.subprocess.Popen", side_effect=AssertionError("respawn")):
            self.assertEqual(reopened.execute("one", self.args, str(self.base), binding=self.binding,
                                             timeout_seconds=2)["status"], "unknown")
        self.assertFalse(reopened.stop("one")["stopped"])

    def test_spawn_receipt_fault_preserves_unknown_intent(self):
        def fault(point):
            if point == "after_spawn":
                raise RuntimeError("synthetic receipt loss")
        self.supervisor._fault = fault
        with self.assertRaises(RuntimeError):
            self.execute(argv=[sys.executable, "-c", "import time; time.sleep(.1)"])
        result = ProcessSupervisor(self.root).inspect("one")
        self.assertEqual(result["status"], "unknown")
        self.assertIsNone(result["ownership"])
        self.assertFalse(result["stopped"])

    def test_stop_rejects_mismatched_boot_or_incarnation(self):
        # A forged journal never authorizes a signal, even to a real test child.
        result = self.execute()
        state_path = Path(result["stdout_path"]).parent / "state.json"
        original = json.loads(state_path.read_text())
        for field in ("boot_id", "start_ticks"):
            state = json.loads(json.dumps(original))
            state["status"] = "running"
            state["stopped"] = False
            state["ownership"][field] = "mismatch"
            state_path.write_text(json.dumps(state))
            with patch("agent_workforce.native_process.signal.pidfd_send_signal", side_effect=AssertionError("unsafe signal")):
                stopped = self.supervisor.stop("one")
            self.assertFalse(stopped["stopped"])
            self.assertEqual(stopped["status"], "unknown")

    def test_live_incarnation_mismatch_never_signals(self):
        results = []
        argv = [sys.executable, "-c", "import time; time.sleep(20)"]
        thread = threading.Thread(target=lambda: results.append(self.execute(argv=argv, timeout_seconds=3)))
        thread.start()
        try:
            deadline = time.monotonic() + 2
            while self.supervisor.inspect("one")["status"] != "running" and time.monotonic() < deadline:
                time.sleep(.01)
            state_path = self.root / hashlib.sha256(b"one").hexdigest() / "state.json"
            # Alter ownership only while holding the same cooperative journal
            # lock; the original execute loop continues to own its real child.
            with self.supervisor._locked():
                state = json.loads(state_path.read_text())
                owner = dict(state["ownership"])
                state["ownership"]["start_ticks"] += 1
                state_path.write_text(json.dumps(state))
            with patch("agent_workforce.native_process.signal.pidfd_send_signal", side_effect=AssertionError("unsafe signal")):
                self.assertFalse(self.supervisor.stop("one")["stopped"])
            self.assertTrue(thread.is_alive())
        finally:
            if 'owner' in locals():
                with self.supervisor._locked():
                    state = json.loads(state_path.read_text())
                    state.update(ownership=owner, status="running")
                    state_path.write_text(json.dumps(state))
                self.supervisor.stop("one")
            thread.join(5)
        self.assertFalse(thread.is_alive())

    def test_symlinked_intent_receipt_lock_and_hardlinked_output_rejected(self):
        result = self.execute()
        directory = Path(result["stdout_path"]).parent
        for name in ("intent.json", "state.json"):
            path = directory / name
            original = path.read_bytes()
            path.unlink()
            path.symlink_to(self.base / "outside")
            with self.assertRaises(ProcessError):
                self.supervisor.inspect("one")
            path.unlink()
            path.write_bytes(original)
            path.chmod(0o600)
        output = Path(result["stdout_path"])
        os.link(output, self.base / "alias-output")
        with self.assertRaises(ProcessError):
            self.supervisor.inspect("one")
        lock = self.root / ".lock"
        lock.unlink()
        lock.symlink_to(self.base / "outside")
        with self.assertRaises(ProcessError):
            self.supervisor.inspect("one")

    def test_hostile_operation_is_hashed_and_journal_symlinks_rejected(self):
        operation = "../../outside/escaped"
        result = self.execute(operation)
        self.assertEqual(Path(result["stdout_path"]).parent.name, hashlib.sha256(operation.encode()).hexdigest())
        alias = self.base / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ProcessError):
            ProcessSupervisor(alias)
        opdir = self.root / hashlib.sha256(b"hostile").hexdigest()
        opdir.symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(ProcessError):
            self.execute("hostile")
        output = Path(result["stdout_path"])
        output.unlink()
        output.symlink_to(self.base / "do-not-touch")
        with self.assertRaises(ProcessError):
            self.supervisor.inspect(operation)
        self.assertFalse((self.base / "do-not-touch").exists())

    def test_invalid_requests_never_create_an_operation(self):
        for kwargs in ({"timeout_seconds": True}, {"timeout_seconds": float("nan")},
                       {"timeout_seconds": 1801}, {"max_output_bytes": 2097153},
                       {"max_output_bytes": False}, {"binding": {"nan": float("nan")}},
                       {"binding": {"cycle": []}}, {"argv": ["python3", "-c", "pass"]},
                       {"cwd": str(self.base / "missing")}):
            if "cycle" in kwargs.get("binding", {}):
                kwargs["binding"]["cycle"].append(kwargs["binding"])
            request = dict(argv=self.args, cwd=str(self.base), binding=self.binding, timeout_seconds=2)
            request.update(kwargs)
            with self.subTest(kwargs=str(kwargs)), self.assertRaises(ProcessError):
                self.supervisor.execute("invalid", **request)
        self.assertEqual(self.supervisor.inspect("invalid")["status"], "unknown")


if __name__ == "__main__":
    unittest.main()

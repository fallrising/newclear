"""Real Linux process boundaries; these tests do not claim KVM recovery."""

import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
SPEC = importlib.util.spec_from_file_location(
    "recovery_process_checks", SCRIPTS / "m3_recovery_checks.py"
)
CHECKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKS)


@unittest.skipUnless(sys.platform == "linux", "requires Linux /proc and SIGSTOP")
class RecoveryProcessBoundaries(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="m3-recovery-process-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.barrier = self.root / "barrier.json"
        self.sentinel = self.root / "past-barrier"
        self.record = {
            "nonce": "owned-test-nonce",
            "case": "model-reserved",
            "run_id": "owned-test-run",
        }

    def start_child(self, code=None):
        source = code or (
            "import json, sys\n"
            "from pathlib import Path\n"
            "from m3_recovery_checks import stop_at_barrier\n"
            "stop_at_barrier(sys.argv[1], json.loads(sys.argv[2]))\n"
            "Path(sys.argv[3]).write_text('invalid continuation')\n"
        )
        child = subprocess.Popen(
            [
                sys.executable,
                "-c",
                source,
                str(self.barrier),
                json.dumps(self.record),
                str(self.sentinel),
            ],
            env={**os.environ, "PYTHONPATH": str(SCRIPTS)},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        def cleanup():
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=5)

        self.addCleanup(cleanup)
        identity = CHECKS.process_identity(child.pid)
        self.expected = {**self.record, "pid": child.pid, "start_ticks": identity["start_ticks"]}
        return child

    def held(self, child):
        return CHECKS.wait_stopped_barrier(child, self.barrier, expected=self.expected, timeout=5)

    def test_real_stopped_child_is_killed_reaped_without_crossing_boundary(self):
        child = self.start_child()
        proof = CHECKS.kill_at_barrier(child, self.barrier, expected=self.expected, timeout=5)
        self.assertEqual(proof["returncode"], -signal.SIGKILL)
        self.assertEqual(child.returncode, -signal.SIGKILL)
        self.assertEqual(proof["start_ticks"], self.expected["start_ticks"])
        self.assertIn(proof["observed_state"], {"T", "t"})
        self.assertEqual(self.barrier.stat().st_mode & 0o777, 0o600)
        self.assertFalse(self.sentinel.exists())
        self.assertFalse(list(self.root.glob("*.tmp")))
        self.assertFalse(Path(f"/proc/{child.pid}").exists())

    def test_wrong_barrier_identity_cannot_kill_owned_child(self):
        child = self.start_child()
        self.held(child)
        expected = dict(self.expected, nonce="different-attempt")
        with self.assertRaisesRegex(RuntimeError, "barrier_identity_mismatch"):
            CHECKS.kill_at_barrier(child, self.barrier, expected=expected, timeout=1)
        self.assertIsNone(child.poll())
        self.assertIn(CHECKS.process_identity(child.pid)["state"], {"T", "t"})

    def test_wrong_process_start_cannot_kill_owned_child(self):
        child = self.start_child()
        self.held(child)
        expected = dict(self.expected, start_ticks=self.expected["start_ticks"] + 1)
        with self.assertRaisesRegex(RuntimeError, "barrier_process_identity_mismatch"):
            CHECKS.kill_at_barrier(child, self.barrier, expected=expected, timeout=1)
        self.assertIsNone(child.poll())
        self.assertIn(CHECKS.process_identity(child.pid)["state"], {"T", "t"})

    def test_exit_before_barrier_fails_without_fabricated_stop(self):
        child = self.start_child("raise SystemExit(7)")
        self.assertEqual(child.wait(timeout=5), 7)
        with self.assertRaisesRegex(RuntimeError, "barrier_child_exited"):
            CHECKS.kill_at_barrier(child, self.barrier, expected=self.expected, timeout=1)
        self.assertFalse(self.barrier.exists())

    def test_accidental_resume_raises_without_running_past_boundary(self):
        child = self.start_child()
        self.held(child)
        child.send_signal(signal.SIGCONT)
        _, stderr = child.communicate(timeout=5)
        self.assertEqual(child.returncode, 1)
        self.assertIn(b"barrier_resumed", stderr)
        self.assertFalse(self.sentinel.exists())

    def test_existing_barrier_cannot_be_replaced_or_accepted(self):
        original = b'{"nonce":"previous-attempt"}\n'
        self.barrier.write_bytes(original)
        child = self.start_child()
        _, stderr = child.communicate(timeout=5)
        self.assertEqual(child.returncode, 1)
        self.assertIn(b"FileExistsError", stderr)
        self.assertEqual(self.barrier.read_bytes(), original)
        self.assertFalse(self.sentinel.exists())
        self.assertFalse(list(self.root.glob("*.tmp")))

    def test_child_without_barrier_times_out_and_remains_owned(self):
        child = self.start_child("import time; time.sleep(30)")
        with self.assertRaisesRegex(RuntimeError, "barrier_not_stopped"):
            CHECKS.kill_at_barrier(child, self.barrier, expected=self.expected, timeout=0.1)
        self.assertIsNone(child.poll())
        self.assertFalse(self.barrier.exists())

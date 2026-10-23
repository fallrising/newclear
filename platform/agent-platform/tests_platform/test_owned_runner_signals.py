"""Offline subprocess signal contracts; Docker is always a task-owned executable."""

import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

COMPONENT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "rehearsal_signals", COMPONENT / "scripts/single-node-rehearsal.py"
)
WRAPPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WRAPPER)


class OwnedRunnerSignalTests(unittest.TestCase):
    def wait_ready(self, child, ready):
        deadline = time.monotonic() + 5
        while not ready.exists() and time.monotonic() < deadline:
            self.assertIsNone(child.poll())
            time.sleep(0.01)
        self.assertTrue(ready.exists())

    def test_owned_runner_finally_with_default_and_inherited_ignored_sigint(self):
        for ignored in (False, True):
            with self.subTest(ignored=ignored), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                docker = root / "docker"
                docker.write_text(
                    "#!" + sys.executable + "\n"
                    "import json, pathlib, sys\n"
                    "root = pathlib.Path(__file__).parent\n"
                    "args = sys.argv[1:]\n"
                    "with (root / 'calls').open('a') as out: out.write(json.dumps(args) + '\\n')\n"
                    "if args[0] == 'inspect':\n"
                    "    if '--format' in args: print('m1-integration')\n"
                    "    else: print(json.dumps([{'NetworkSettings': {'Ports': "
                    "{'5432/tcp': [{'HostPort': '1'}]}}}]))\n"
                )
                docker.chmod(0o700)
                command = root / "command.py"
                command.write_text(
                    "import pathlib, sys, time\n"
                    "root = pathlib.Path(sys.argv[1])\n"
                    "try:\n"
                    "    (root / 'ready').write_text('ready')\n"
                    "    time.sleep(60)\n"
                    "finally:\n"
                    "    (root / 'command-closed').write_text('closed')\n"
                )
                launcher = (
                    "import os, signal, sys; "
                    "signal.signal(signal.SIGINT, "
                    + ("signal.SIG_IGN" if ignored else "signal.default_int_handler")
                    + "); os.execv(sys.executable, [sys.executable] + sys.argv[1:])"
                )
                env = dict(os.environ, PATH=str(root), PYTHONDONTWRITEBYTECODE="1")
                with (root / "runner.log").open("wb") as output:
                    child = subprocess.Popen(
                        [
                            sys.executable,
                            "-c",
                            launcher,
                            str(COMPONENT / "scripts/test-postgres.py"),
                            sys.executable,
                            str(command),
                            str(root),
                        ],
                        env=env,
                        stdout=output,
                        stderr=subprocess.STDOUT,
                        start_new_session=True,
                    )
                    try:
                        self.wait_ready(child, root / "ready")
                        os.killpg(child.pid, signal.SIGINT)
                        try:
                            child.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            self.fail("owned runner ignored SIGINT; cleanup did not finish")
                        self.assertNotEqual(child.returncode, 0)
                    finally:
                        if child.poll() is None:
                            os.killpg(child.pid, signal.SIGKILL)
                            child.wait(timeout=5)
                self.assertEqual((root / "command-closed").read_text(), "closed")
                calls = [json.loads(row) for row in (root / "calls").read_text().splitlines()]
                name = calls[0][calls[0].index("--name") + 1]
                self.assertTrue(name.startswith("agent-platform-m1-test-"))
                self.assertEqual(calls[-2][-1], name)
                self.assertEqual(calls[-2][0:2], ["inspect", "--format"])
                self.assertEqual(calls[-1], ["rm", "--force", "--volumes", name])
                self.assertIn(
                    "Owned PostgreSQL test container removed", (root / "runner.log").read_text()
                )

    def test_noncooperating_child_is_killed_and_reported_incomplete(self):
        with tempfile.TemporaryDirectory() as temporary:
            ready = Path(temporary) / "ready"
            child = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    "import pathlib, signal, sys, time; "
                    "signal.signal(signal.SIGINT, signal.SIG_IGN); "
                    "pathlib.Path(sys.argv[1]).write_text('ready'); time.sleep(60)",
                    str(ready),
                ],
                start_new_session=True,
            )
            original_wait = child.wait

            def bounded_wait(timeout):
                # Exercise the real escalation without spending the production 45 seconds.
                return original_wait(timeout=0.15 if timeout == 45 else timeout)

            try:
                self.wait_ready(child, ready)
                with mock.patch.object(child, "wait", side_effect=bounded_wait) as wait:
                    with self.assertRaisesRegex(RuntimeError, "^rehearsal_cleanup_incomplete$"):
                        WRAPPER.stop_runner(child)
                self.assertEqual([call.kwargs["timeout"] for call in wait.call_args_list], [45, 5])
                self.assertEqual(child.returncode, -signal.SIGKILL)
            finally:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGKILL)
                    original_wait(timeout=5)


if __name__ == "__main__":
    unittest.main()

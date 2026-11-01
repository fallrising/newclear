"""Exact CLI admission proof is independent of the agent's textual success claim."""

import unittest

from agent_platform.subscription_claude import MODEL, TOOLS, assess


class DriverTests(unittest.TestCase):
    def stream(self):
        return [
            {"type": "system", "subtype": "init", "model": MODEL, "tools": list(TOOLS)},
            {
                "type": "assistant",
                "message": {
                    "model": MODEL,
                    "content": [{"type": "tool_use", "name": next(iter(TOOLS))}],
                },
            },
            {
                "type": "result",
                "subtype": "success",
                "is_error": False,
                "permission_denials": [],
                "modelUsage": {MODEL: {}},
            },
        ]

    def test_exact_tool_and_model_contract(self):
        self.assertTrue(assess(self.stream(), 0))
        for field, value in [("tools", list(TOOLS) + ["Bash"]), ("model", "fallback")]:
            events = self.stream()
            events[0][field] = value
            self.assertFalse(assess(events, 0))
        events = self.stream()
        events[1]["message"]["model"] = "fallback"
        self.assertFalse(assess(events, 0))
        events = self.stream()
        events[2]["permission_denials"] = [{"tool": "Bash"}]
        self.assertFalse(assess(events, 0))
        self.assertFalse(assess(self.stream(), 1))

    def test_textual_success_without_actual_tool_is_insufficient(self):
        events = self.stream()
        events[1]["message"]["content"] = [{"type": "text", "text": "All tests passed"}]
        self.assertFalse(assess(events, 0))


class DeadlineTests(unittest.TestCase):
    def test_deadline_stops_cli_while_database_call_is_blocked(self):
        import hashlib
        import json
        import os
        import tempfile
        import threading
        import time
        from contextlib import contextmanager
        from datetime import UTC, datetime, timedelta
        from pathlib import Path
        from unittest.mock import patch
        from uuid import uuid4

        from agent_platform.subscription_claude import ClaudeSubscription

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "fake-cli"
            script.write_text(
                "#!/usr/bin/python3\n"
                "import os,time\n"
                "from pathlib import Path\n"
                'Path("child.pid").write_text(str(os.getpid()))\n'
                "time.sleep(30)\n"
            )
            script.chmod(0o700)
            config = root / "config.json"
            config.write_text(
                json.dumps(
                    {
                        "executable": str(script),
                        "executable_sha256": hashlib.sha256(script.read_bytes()).hexdigest(),
                        "state_dir": tmp,
                        "connector_origin": "http://127.0.0.1:1",
                        "connector_token_file": "unused",
                    }
                )
            )
            config.chmod(0o600)
            run = {
                "id": uuid4(),
                "generation": 1,
                "state": "running",
                "goal": "x" * 20000,
                "deadline": datetime.now(UTC) + timedelta(seconds=1),
            }
            entered = threading.Event()

            class Worker:
                calls = 0

                @contextmanager
                def owned(self, claim):
                    self.calls += 1
                    if self.calls > 1:
                        entered.set()
                        time.sleep(2.5)  # Models a transaction exceeding the CLI deadline.
                    yield None, run

            driver = ClaudeSubscription(config)
            driver.preflight = lambda: {}
            errors = []

            def execute():
                try:
                    driver.execute(Worker(), {}, run, threading.Event())
                except Exception as exc:
                    errors.append(exc)

            with patch("agent_platform.subscription_claude.event"):
                thread = threading.Thread(target=execute)
                thread.start()
                self.assertTrue(entered.wait(1))
                pidfile = root / str(run["id"]) / "child.pid"
                until = time.monotonic() + 1
                while not pidfile.exists() and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertTrue(pidfile.exists())
                pid = int(pidfile.read_text())
                time.sleep(1.2)
                self.assertTrue(thread.is_alive(), "DB remains blocked independently")
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
                thread.join(5)
            self.assertFalse(thread.is_alive())
            self.assertTrue(errors, "Killed CLI must not produce a success claim")

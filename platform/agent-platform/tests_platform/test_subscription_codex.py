"""Protocol and process regressions use a fake executable, never a live provider."""

import json
import tempfile
import threading
import unittest
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import uuid4

from agent_platform.domain import Problem
from agent_platform.subscription_codex import CodexSubscription, configuration, toml

SCRIPT = (Path(__file__).parent / "fixtures/codex_app_server.py").read_text()


class CodexDriverTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.run = {
            "id": uuid4(),
            "generation": 1,
            "state": "running",
            "goal": "bounded repair",
            "deadline": datetime.now(UTC) + timedelta(seconds=8),
        }
        self.bridge = Mock()
        self.bridge.call.return_value = {"ok": True, "content": "source"}
        self.events = patch("agent_platform.subscription_codex.event").start()
        self.addCleanup(patch.stopall)
        patch("agent_platform.subscription_codex.Bridge", return_value=self.bridge).start()
        run = self.run

        class Worker:
            @contextmanager
            def owned(self, claim):
                yield None, run

        self.worker = Worker()

    def driver(self, mode):
        binary = self.root / mode
        binary.write_text(SCRIPT)
        binary.chmod(0o700)
        driver = CodexSubscription.__new__(CodexSubscription)
        driver.config = {"connector_origin": "http://127.0.0.1:1", "connector_token_file": "unused"}
        driver.root = self.root
        driver.binary = binary
        driver.catalog = self.root / str(self.run["id"]) / "catalog"
        driver.codex_home = self.root / "trusted-home"
        driver.codex_home.mkdir(exist_ok=True)
        (driver.codex_home / "auth.json").write_text("DUMMY AUTH FIXTURE")
        driver.preflight = lambda: {"method": "mock"}
        return driver

    def execute(self, mode):
        self.driver(mode).execute(self.worker, {}, self.run, threading.Event())

    def receipt(self):
        return json.loads((self.root / str(self.run["id"]) / "receipt.json").read_text())

    def test_m2_exact_run_bound_tools_complete_without_environment_or_resume(self):
        self.execute("valid")
        self.bridge.call.assert_called_once_with("unique-call", "read", {"path": "totals.py"})
        receipt = self.receipt()
        self.assertEqual(receipt["status"], "completed")
        self.assertTrue(receipt["processes_stopped"])
        messages = [
            json.loads(x)
            for x in (self.root / str(self.run["id"]) / "requests.jsonl").read_text().splitlines()
        ]
        for method in ["thread/start", "turn/start"]:
            self.assertEqual(
                next(x for x in messages if x.get("method") == method)["params"]["environments"], []
            )
        self.assertFalse(any(x.get("method") in ["thread/resume", "thread/fork"] for x in messages))
        with self.assertRaises(FileExistsError):
            self.execute("valid")
        self.assertEqual(self.bridge.call.call_count, 1)

    def test_m2_unexpected_host_or_provider_is_refused_before_turn(self):
        for mode in ["wrong-model", "host-env", "extra-mcp"]:
            with self.subTest(mode=mode):
                self.run["id"] = uuid4()
                with self.assertRaises(Problem):
                    self.execute(mode)
                messages = (self.root / str(self.run["id"]) / "requests.jsonl").read_text()
                self.assertNotIn("turn/start", messages)
                self.assertEqual(self.receipt()["status"], "unconfirmed")
        self.bridge.call.assert_not_called()

    def test_m2_cross_run_or_unknown_tool_never_reaches_bridge(self):
        for mode in ["wrong-thread", "wrong-tool"]:
            with self.subTest(mode=mode):
                self.run["id"] = uuid4()
                with self.assertRaisesRegex(Problem, "binding_mismatch"):
                    self.execute(mode)
        self.bridge.call.assert_not_called()

    def test_m2_text_success_or_failed_turn_is_not_completion(self):
        for mode in ["no-tools", "failed-turn"]:
            with self.subTest(mode=mode):
                self.run["id"] = uuid4()
                with self.assertRaisesRegex(Problem, "result_unconfirmed"):
                    self.execute(mode)
                self.assertEqual(self.receipt()["status"], "unconfirmed")

    def test_m2_refused_bridge_is_not_retried(self):
        self.bridge.call.return_value = {"ok": False}
        with self.assertRaisesRegex(Problem, "tool_refused"):
            self.execute("valid")
        self.bridge.call.assert_called_once()
        self.assertTrue(self.receipt()["processes_stopped"])

    def test_m2_deadline_stops_actual_process(self):
        self.run["deadline"] = datetime.now(UTC) + timedelta(seconds=0.5)
        with self.assertRaises(Problem):
            self.execute("hang")
        self.assertEqual(self.receipt()["status"], "unconfirmed")
        self.assertTrue(self.receipt()["processes_stopped"])

    def test_m2_effective_configuration_refused_without_thread_or_turn(self):
        for mode in ["bad-endpoint", "bad-notify", "bad-feature", "bad-mcp"]:
            with self.subTest(mode=mode):
                self.run["id"] = uuid4()
                with self.assertRaisesRegex(Problem, "effective_configuration"):
                    self.execute(mode)
                path = self.root / str(self.run["id"])
                self.assertNotIn("thread/start", (path / "requests.jsonl").read_text())
                events = (path / "events.jsonl").read_text()
                self.assertNotIn("must-not-launch", events)
                self.assertNotIn("chatgpt_base_url", events)
                self.assertIn("configuration_redacted", events)
        self.bridge.call.assert_not_called()

    def test_m2_configuration_disables_startup_extensions_and_native_delegation(self):
        import tomllib

        values = configuration(self.root / "catalog")
        parsed = tomllib.loads("\n".join(k + "=" + toml(v) for k, v in values.items()))
        self.assertFalse(parsed["features"]["js_repl"])
        self.assertFalse(parsed["features"]["plugin_discovery_prefetch"])
        self.assertFalse(parsed["skills"]["include_instructions"])
        self.assertEqual(parsed["notify"], [])
        self.assertTrue(parsed["features"]["multi_agent_v2"]["disable_native_tools"])
        self.assertEqual(parsed["forced_login_method"], "chatgpt")
        self.assertEqual(parsed["model_provider"], "openai")

    def test_review_has_one_read_tool_and_strict_final_hash_bound_output(self):
        self.run.update(purpose="review", review_context={"candidate_sha256": "a" * 64})
        value = self.driver("review-valid").execute(self.worker, {}, self.run, threading.Event())
        self.assertEqual(
            value,
            {
                "candidate_sha256": "a" * 64,
                "verdict": "accept",
                "reasons": ["Candidate is correct."],
            },
        )
        self.bridge.call.assert_called_once_with("unique-call", "read", {"path": "candidate.json"})
        messages = [
            json.loads(x)
            for x in (self.root / str(self.run["id"]) / "requests.jsonl").read_text().splitlines()
        ]
        thread = next(x for x in messages if x.get("method") == "thread/start")["params"]
        self.assertEqual([tool["name"] for tool in thread["dynamicTools"]], ["fanz_read"])
        self.assertTrue(self.receipt()["processes_stopped"])

    def test_review_rejects_wrong_hash_binding_and_unadvertised_write(self):
        self.run.update(purpose="review", review_context={"candidate_sha256": "a" * 64})
        for mode, code in (
            ("review-wrong-hash", "review_verdict_invalid"),
            ("review-wrong-thread", "subscription_result_unconfirmed"),
            ("review-write", "subscription_tool_binding_mismatch"),
        ):
            with self.subTest(mode=mode):
                self.run["id"] = uuid4()
                self.bridge.call.reset_mock()
                with self.assertRaisesRegex(Problem, code):
                    self.execute(mode)
                if mode == "review-write":
                    self.bridge.call.assert_not_called()
                self.assertTrue(self.receipt()["processes_stopped"])
                self.assertEqual(self.receipt()["status"], "unconfirmed")

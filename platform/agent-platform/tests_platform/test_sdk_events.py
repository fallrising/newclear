"""Polling uses durable SDK status events without blocking on an active tool lock."""

import copy
import unittest
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs

from agent_platform.connector import Connector
from agent_platform.domain import Problem


class SDKEventsTests(unittest.TestCase):
    def setUp(self):
        self.row = {
            "run_id": "fixture-run",
            "generation": 1,
            "operations": {},
            "input": {"require_approval": True},
            "session_key": "session-canary",
            "tool_relay_key": "relay-canary",
            "handle": {},
        }
        self.action = {
            "id": "action-1",
            "kind": "ActionEvent",
            "tool_name": "terminal",
            "tool_call_id": "call-1",
            "action": {"command": "true"},
        }
        self.observation = {
            "id": "observation-1",
            "kind": "ObservationEvent",
            "action_id": "action-1",
            "tool_call_id": "call-1",
            "observation": {"exit_code": 0, "text": "result"},
        }
        self.history = [self.action, self.status_event("waiting-1", "waiting_for_confirmation")]
        self.live_status = "waiting_for_confirmation"
        self.rest_calls = 0
        self.service = Connector.__new__(Connector)
        self.service.journal = SimpleNamespace(locked=lambda run_id: nullcontext())
        self.service.require = lambda run_id, generation: self.row
        self.service.network = lambda row: None
        self.service.relay = lambda row: nullcontext(SimpleNamespace(expect=self.expect))
        self.service.token = "connector-canary"
        self.service.client = SimpleNamespace(api_token="node-canary")
        self.live = self.enterContext(
            patch(
                "agent_platform.connector_state.live_state",
                side_effect=AssertionError("polling must not acquire the SDK state lock"),
            )
        )

    @staticmethod
    def status_event(identifier, value):
        return {
            "id": identifier,
            "kind": "ConversationStateUpdateEvent",
            "key": "execution_status",
            "value": value,
        }

    def snapshot(self, row, http):
        return {
            "id": row["run_id"],
            "execution_status": self.live_status,
            "confirmation_policy": {"kind": "AlwaysConfirm"},
            "leaf_event_id": self.history[-1]["id"],
        }

    def expect(self, method, path):
        if "/events/search?" in path:
            query = parse_qs(path.split("?", 1)[1])
            start = int(query.get("page_id", ["0"])[0])
            end = start + int(query["limit"][0])
            return {
                "items": copy.deepcopy(self.history[start:end]),
                "next_page_id": str(end) if end < len(self.history) else None,
            }
        self.rest_calls += 1
        # The pinned server can keep this autosaved snapshot after approval.
        return {**self.snapshot(self.row, None), "execution_status": "waiting_for_confirmation"}

    def poll(self, cursor=None):
        return self.service.events(self.row["run_id"], 1, cursor)

    def test_approved_terminal_polls_to_finished_with_stale_rest(self):
        pending = self.poll()
        self.assertEqual(pending["approval"]["normalized_action"]["actions"][0]["id"], "action-1")
        cursor = pending["events"][-1]["cursor"]
        self.history.extend([self.status_event("running-1", "running"), self.observation])
        self.live_status = "running"
        running = self.poll(cursor)
        self.assertEqual(running["state"], "running")
        self.assertNotIn("approval", running)
        self.assertEqual(
            [e["type"] for e in running["events"]], ["backend.event", "tool.completed"]
        )
        self.live_status = "finished"
        self.history.append(self.status_event("finished-1", "finished"))
        finished = self.poll(running["events"][-1]["cursor"])
        self.assertEqual(finished["state"], "finished")
        self.assertTrue(finished["caught_up"])
        self.assertEqual(finished["events"][-1]["cursor"], "finished-1")
        self.assertEqual(self.poll("finished-1")["events"], [])
        self.live.assert_not_called()

    def test_rest_transition_during_poll_does_not_invent_approval(self):
        self.live_status = "running"
        self.history.append(self.status_event("running-1", "running"))
        calls = iter(["waiting_for_confirmation", "running", "running"])
        original = self.expect

        def advancing_rest(method, path):
            if "/events/search?" in path:
                return original(method, path)
            return {**self.snapshot(self.row, None), "execution_status": next(calls)}

        self.service.relay = lambda row: nullcontext(SimpleNamespace(expect=advancing_rest))
        result = self.poll("action-1")
        self.assertEqual(result["state"], "running")
        self.assertNotIn("approval", result)

    def test_fault_observation_remains_readable_and_redacted(self):
        self.live_status = "finished"
        self.observation["observation"] = {
            "exit_code": 1,
            "text": "tool_transport_unavailable session-canary relay-canary",
        }
        self.history.extend([self.observation, self.status_event("finished-1", "finished")])
        result = self.poll("waiting-1")
        self.assertEqual(result["state"], "finished")
        content = result["events"][0]["payload"]["content"]
        self.assertIn("tool_transport_unavailable", content)
        self.assertNotIn("session-canary", content)
        self.assertNotIn("relay-canary", content)

    def test_cursor_and_metadata_refusals_remain_fail_closed(self):
        self.live_status = "finished"
        for code, history, cursor in [
            ("backend_event_gap", [self.action], "missing"),
            ("backend_duplicate_event", [self.action, self.action], None),
            ("backend_sensitive_metadata", [{**self.action, "id": "session-canary"}], None),
            ("backend_metadata_invalid", [{**self.action, "id": None}], None),
        ]:
            with self.subTest(code=code):
                self.history = history
                with self.assertRaisesRegex(Problem, code):
                    self.poll(cursor)

    def test_active_tool_does_not_wait_for_live_snapshot(self):
        self.history.append(self.status_event("running-1", "running"))
        self.assertEqual(self.poll()["state"], "running")
        self.live.assert_not_called()

    def test_applied_receipt_suppresses_only_the_exact_accepted_batch(self):
        approval = self.poll()["approval"]
        self.row["operations"]["approval:1"] = {
            "state": "completed",
            "result": {"action_digest": approval["action_digest"]},
        }
        result = self.poll()
        self.assertEqual(result["state"], "running")
        self.assertNotIn("approval", result)
        # A changed payload under the same ID does not match the accepted digest.
        self.history[0] = {**self.action, "action": {"command": "echo changed"}}
        self.assertIn("approval", self.poll())
        # A new batch must still be proposed, never authorized by an old receipt.
        self.history = [
            {**self.action, "id": "action-2", "tool_call_id": "call-2"},
            self.status_event("waiting-2", "waiting_for_confirmation"),
        ]
        proposed = self.poll()
        self.assertEqual(proposed["state"], "waiting_for_confirmation")
        self.assertNotEqual(proposed["approval"]["action_digest"], approval["action_digest"])

    def test_uncertain_or_different_receipt_does_not_hide_approval(self):
        digest = self.poll()["approval"]["action_digest"]
        for status, value in [("started", digest), ("completed", "different")]:
            with self.subTest(status=status):
                self.row["operations"]["approval:1"] = {
                    "state": status,
                    "result": {"action_digest": value},
                }
                self.assertIn("approval", self.poll())

    def test_unknown_or_sensitive_durable_status_fails_closed(self):
        for value, code in [
            ("invented", "backend_execution_status_invalid"),
            ("session-canary", "backend_sensitive_metadata"),
            (None, "backend_metadata_invalid"),
        ]:
            with self.subTest(value=value):
                self.history = [self.action, self.status_event("state-1", value)]
                with self.assertRaisesRegex(Problem, code):
                    self.poll()

    def test_finished_waits_until_returned_history_is_caught_up(self):
        self.history = [{"id": "message-" + str(n), "kind": "MessageEvent"} for n in range(101)] + [
            self.status_event("finished-1", "finished")
        ]
        first = self.poll()
        self.assertEqual(first["state"], "finished")
        self.assertFalse(first["caught_up"])
        second = self.poll(first["events"][-1]["cursor"])
        self.assertTrue(second["caught_up"])
        self.assertEqual(second["events"][-1]["event_id"], "finished-1")

    def test_genuine_invalid_pending_batch_is_not_suppressed(self):
        self.history.append(self.observation)
        with self.assertRaisesRegex(Problem, "approval_batch_invalid"):
            self.poll()

    def test_existing_nonapproval_rest_path_is_unchanged(self):
        self.row["input"] = {}
        self.assertEqual(
            self.service.conversation(self.row, SimpleNamespace(expect=self.expect))[
                "execution_status"
            ],
            "waiting_for_confirmation",
        )
        self.live.assert_not_called()
        self.assertEqual(self.rest_calls, 1)

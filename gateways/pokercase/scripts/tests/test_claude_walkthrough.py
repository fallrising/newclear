#!/usr/bin/env python3
"""Offline parser/evidence gates; no gateway or agent process is launched."""
import copy
import json
from pathlib import Path
import tempfile
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_walkthrough as journey


def wire(events, done=False):
    return ("".join("data: " + json.dumps(event) + "\n\n" for event in events) + ("data: [DONE]\n\n" if done else "")).encode()


def row():
    return {"usage_source": "claude_code_stream_event_v1", "outcome": "succeeded",
            "request_id": "synthetic-request", "attempt_id": "synthetic-attempt", "finalized_at": "synthetic-time",
            "status": None, "headers_ms": None, "estimated_cost_usd": None,
            "cli_ready_ms": 1, "first_output_ms": 2, "total_observed_ms": 3,
            "prompt_tokens": None, "completion_tokens": 5, "usage_status": "partial",
            "reported_usage": {"input_tokens": 12, "output_tokens": 5,
                               "cache_read_input_tokens": None, "cache_creation_input_tokens": None}}


def tool_events(protocol):
    args = '{"a":2,"b":3}'
    if protocol == "chat":
        return [{"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_demo_add", "function": {"name": "add", "arguments": args}}]}, "finish_reason": "tool_calls"}]}]
    if protocol == "messages":
        return [{"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": "call_demo_add", "name": "add", "input": {}}},
                {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": args}},
                {"type": "message_delta", "delta": {"stop_reason": "tool_use"}}, {"type": "message_stop"}]
    return [{"type": "response.completed", "response": {"status": "completed", "output": [{"type": "function_call", "call_id": "call_demo_add", "name": "add", "arguments": args}]}}]


class EvidenceTests(unittest.TestCase):
    def test_raw_missing_cache_stays_partial(self):
        journey.require_claude_row(row(), "succeeded", (12, 5))
        complete = row()
        complete["prompt_tokens"] = 12
        complete["usage_status"] = "complete"
        complete["reported_usage"].update(cache_read_input_tokens=0, cache_creation_input_tokens=0)
        journey.require_claude_row(complete, "succeeded", (12, 5), True)

    def test_manufactured_zero_cost_source_status_or_time_is_rejected(self):
        changes = ({"prompt_tokens": 12}, {"estimated_cost_usd": 0}, {"status": 200},
                   {"headers_ms": 1}, {"usage_source": "openai_chat_v1"},
                   {"usage_status": "complete"}, {"outcome": "unknown"},
                   {"cli_ready_ms": True}, {"first_output_ms": 5}, {"attempt_id": None})
        for change in changes:
            with self.subTest(change=change):
                bad = row()
                bad.update(change)
                with self.assertRaises(journey.JourneyFailure):
                    journey.require_claude_row(bad, "succeeded", (12, 5))

    def test_session_totals_cannot_pass_as_phase_counters(self):
        bad = row()
        bad["reported_usage"].update(input_tokens=9000, output_tokens=8000)
        with self.assertRaisesRegex(journey.JourneyFailure, "claude_raw_usage"):
            journey.require_claude_row(bad, "succeeded", (12, 5))

    def test_three_tool_protocols_require_identity_arguments_and_terminal(self):
        for protocol in journey.ENDPOINTS:
            events = tool_events(protocol)
            with self.subTest(protocol=protocol):
                journey.stream_tool(protocol, wire(events, protocol == "chat"))
                damaged = copy.deepcopy(events)
                serialized = json.dumps(damaged).replace("call_demo_add", "wrong-call")
                with self.assertRaises(journey.JourneyFailure):
                    journey.stream_tool(protocol, wire(json.loads(serialized), protocol == "chat"))
                with self.assertRaises(journey.JourneyFailure):
                    journey.stream_tool(protocol, wire(events[:-1]))

    def test_errors_never_count_as_tool_completion(self):
        for protocol in journey.ENDPOINTS:
            with self.subTest(protocol=protocol), self.assertRaises(journey.JourneyFailure):
                journey.stream_tool(protocol, wire(tool_events(protocol) + [{"type": "error", "error": {"message": "synthetic"}}], True))

    def test_binary_digest_guard_fails_before_any_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(journey.subprocess, "Popen", side_effect=AssertionError("must not launch")):
                code = journey.main(["--binary", "/usr/bin/python3", "--output-dir", directory,
                                     "--expected-binary-sha256", "0" * 64])
            self.assertEqual(code, 1)
            report = json.loads(next(Path(directory).glob("journey-*/report.json")).read_text())
            self.assertEqual(report["error_code"], "binary_digest_mismatch")
            self.assertEqual(report["stages"], [])
            self.assertEqual(report["journey_status"], "failed")

    def test_process_identity_never_adopts_reused_or_zombie_pid(self):
        fields = ["S"] + ["0"] * 18 + ["123"]
        with mock.patch.object(Path, "read_text", return_value="99 (synthetic process) " + " ".join(fields)):
            self.assertTrue(journey.process_matches(99, "123"))
            self.assertFalse(journey.process_matches(99, "124"))
        fields[0] = "Z"
        with mock.patch.object(Path, "read_text", return_value="99 (synthetic process) " + " ".join(fields)):
            self.assertFalse(journey.process_matches(99, "123"))

    def test_html_must_match_every_raw_counter_and_timing_cell(self):
        import html
        observed = row()
        observed.update(ts="synthetic-ts", public_model="synthetic-model", connection_id="synthetic-connection", error=None)
        cells = journey.html_cells(observed)
        document = '<div aria-label="Recent usage table"><table><tr>' + ''.join('<td>' + html.escape(cell) + '</td>' for cell in cells) + '</tr></table></div>'
        journey.require_html_usage(document.encode(), [observed])
        for old, new in (("12 / 5 / — / —", "12 / 5 / 0 / 0"), ("1 ms", "7 ms"), ("—/5", "12/5")):
            with self.subTest(old=old), self.assertRaisesRegex(journey.JourneyFailure, "html_usage_reconciliation"):
                journey.require_html_usage(document.replace(old, new).encode(), [observed])

    def test_pending_rows_do_not_pass_settlement_gate(self):
        fake = mock.Mock()
        fake.api.return_value = {"data": [{"finalized_at": None}]}
        with mock.patch.object(journey.time, "monotonic", side_effect=[0, 0, 11]):
            with self.assertRaisesRegex(journey.JourneyFailure, "usage_settlement_timeout"):
                journey.wait_rows(fake, 1)


if __name__ == "__main__":
    unittest.main()

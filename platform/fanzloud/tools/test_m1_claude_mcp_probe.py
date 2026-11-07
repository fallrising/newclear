"""Evidence-parser regressions. These tests never invoke a model."""
import copy
import unittest

from m1_claude_mcp_probe import MODEL, TOOL, assess


def observed_events():
    return [
        {"type": "system", "subtype": "init", "tools": [TOOL], "model": MODEL,
         "mcp_servers": [{"name": "fanz_probe", "status": "connected"}]},
        {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": TOOL, "id": "call-1", "input": {}}]}},
        {"type": "user", "message": {"content": [
            {"type": "tool_result", "tool_use_id": "call-1", "content": "nonce", "is_error": False}]}},
        {"type": "result", "subtype": "success", "is_error": False, "permission_denials": []},
    ]


class EvidenceTests(unittest.TestCase):
    def test_success_requires_actual_tool_exchange_not_assistant_claim(self):
        events = observed_events()
        self.assertEqual(assess(events, "nonce", 0)["status"], "PASS_CAPABILITY_ONLY")
        events[2] = {"type": "assistant", "message": {"content": [
            {"type": "text", "text": "I used the tool successfully: nonce"}]}}
        self.assertEqual(assess(events, "nonce", 0)["status"], "FAIL_CAPABILITY")

    def test_unsafe_surface_or_changed_model_or_denial_cannot_pass(self):
        for change in ("host_tool", "model", "denial", "mismatched_result", "duplicate_call", "invalid_duplicate_call"):
            with self.subTest(change=change):
                events = observed_events()
                if change == "host_tool":
                    events[0]["tools"].append("Read")
                elif change == "model":
                    events[0]["model"] = "other-model"
                elif change == "denial":
                    events[-1]["permission_denials"] = [{"tool_name": TOOL}]
                elif change == "mismatched_result":
                    events[2]["message"]["content"][0]["tool_use_id"] = "other-call"
                else:
                    events.insert(2, copy.deepcopy(events[1]))
                    if change == "invalid_duplicate_call":
                        events[2]["message"]["content"][0]["input"] = {"unexpected": True}
                self.assertEqual(assess(events, "nonce", 0)["status"], "FAIL_CAPABILITY")

    def test_exit_zero_and_partial_trace_are_not_success(self):
        self.assertEqual(assess([], "nonce", 0)["status"], "FAIL_CAPABILITY")
        self.assertEqual(assess(observed_events(), "nonce", 124)["status"], "FAIL_CAPABILITY")
        self.assertEqual(assess(observed_events(), "wrong-nonce", 0)["status"], "FAIL_CAPABILITY")


if __name__ == "__main__":
    unittest.main()

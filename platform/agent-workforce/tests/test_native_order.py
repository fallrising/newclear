"""Root oracles: session initialization and terminal order cannot be invented."""
import json
import unittest

from agent_workforce.native_events import normalize_events


def stream(*events):
    return b"\n".join(json.dumps(event).encode() for event in events) + b"\n"


class EventOrderTests(unittest.TestCase):
    def test_terminal_before_native_init_stays_unknown(self):
        cases = [("codex", [dict(type="turn.completed", thread_id="one"),
                              dict(type="item.completed", item=dict(type="agent_message", text="text")),
                              dict(type="thread.started", thread_id="one")]),
                 ("claude", [dict(type="result", subtype="success", is_error=False, result="text", session_id="one"),
                               dict(type="system", subtype="init", session_id="one")])]
        for provider, events in cases:
            with self.subTest(provider=provider):
                self.assertEqual(normalize_events(provider, stream(*events))["status"], "unknown")

    def test_unknown_session_event_cannot_replace_native_init(self):
        raw = stream(dict(type="unknown", thread_id="one"),
                     dict(type="item.completed", item=dict(type="agent_message", text="text")),
                     dict(type="turn.completed"))
        self.assertEqual(normalize_events("codex", raw)["status"], "unknown")


if __name__ == "__main__":
    unittest.main()

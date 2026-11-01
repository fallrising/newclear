"""Synthetic Codex and Claude JSONL fixtures for the pure native parser.

No live model, network, or provider process is involved.
"""
import json
import unittest

from agent_workforce.native_events import NativeEventError, normalize_events

_MAX_BYTES = 2 * 1024 * 1024
_MAX_LINE_BYTES = 64 * 1024


def _line(event):
    return json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode("utf-8") + b"\n"


def _nested_object(depth):
    return (b'{"a":' * depth) + b"0" + (b"}" * depth) + b"\n"


def _jsonl(*events):
    return b"".join(_line(event) for event in events)


def _codex_success():
    return _jsonl(
        {"type": "thread.started", "thread_id": "thr_1"},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "Hello"}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "World"}},
        {
            "type": "item.completed",
            "item": {"type": "command_execution", "command": "echo hi", "exit_code": 0},
        },
        {
            "type": "item.completed",
            "item": {"type": "file_change", "changes": [{"path": "a.txt", "kind": "update"}]},
        },
        {"type": "note", "text": "error denied"},
        {
            "type": "turn.completed",
            "usage": {"input_tokens": 3, "cached_input_tokens": 1, "output_tokens": 4},
        },
    )


def _claude_success():
    return _jsonl(
        {"type": "system", "subtype": "init", "session_id": "ses_1", "tools": ["Bash", "Read"]},
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "draft error denied"},
                    {"type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {"command": "pwd"}},
                ],
                "usage": {"input_tokens": 99, "output_tokens": 99},
            },
            "session_id": "ses_1",
        },
        {
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "toolu_1", "content": "/tmp", "is_error": False},
                ],
            },
            "session_id": "ses_1",
        },
        {
            "type": "result",
            "subtype": "success",
            "is_error": False,
            "result": "done",
            "session_id": "ses_1",
            "usage": {"input_tokens": 1, "output_tokens": 2, "cache_read_input_tokens": 0},
            "permission_denials": [],
        },
    )


class NativeEventTests(unittest.TestCase):
    def test_codex_complete_joins_agent_messages_tools_and_terminal_usage(self):
        got = normalize_events("codex", _codex_success(), expected_session_id="thr_1")
        self.assertEqual(
            list(got),
            [
                "provider",
                "session_id",
                "status",
                "result",
                "usage",
                "tools",
                "denials",
                "errors",
                "event_count",
            ],
        )
        self.assertEqual(got["provider"], "codex")
        self.assertEqual(got["session_id"], "thr_1")
        self.assertEqual(got["status"], "complete")
        self.assertEqual(got["result"], "Hello\nWorld")
        self.assertEqual(
            got["usage"],
            {"input_tokens": 3, "cached_input_tokens": 1, "output_tokens": 4},
        )
        self.assertEqual(
            got["tools"],
            [
                {"type": "command_execution", "command": "echo hi", "exit_code": 0},
                {"type": "file_change", "changes": [{"path": "a.txt", "kind": "update"}]},
            ],
        )
        self.assertEqual(got["denials"], [])
        self.assertEqual(got["errors"], [])
        self.assertEqual(got["event_count"], 7)
        json.dumps(got, allow_nan=False)

    def test_claude_complete_uses_result_text_and_tool_use_not_assistant_draft(self):
        got = normalize_events("claude", _claude_success())
        self.assertEqual(got["provider"], "claude")
        self.assertEqual(got["session_id"], "ses_1")
        self.assertEqual(got["status"], "complete")
        self.assertEqual(got["result"], "done")
        self.assertEqual(
            got["usage"],
            {"input_tokens": 1, "output_tokens": 2, "cache_read_input_tokens": 0},
        )
        self.assertEqual(
            got["tools"],
            [{"type": "tool_use", "name": "Bash", "id": "toolu_1", "input": {"command": "pwd"}}],
        )
        self.assertEqual(got["denials"], [])
        self.assertEqual(got["errors"], [])
        self.assertEqual(got["event_count"], 4)

    def test_unknown_events_and_error_words_do_not_fail_or_invent_success(self):
        wording = normalize_events(
            "codex",
            _jsonl(
                {"type": "thread.started", "thread_id": "thr_1"},
                {"type": "item.completed", "item": {"type": "agent_message", "text": "error denied"}},
                {"type": "item.completed", "item": {"type": "command_execution", "exit_code": 0}},
                {"type": "turn.completed"},
            ),
        )
        self.assertEqual(wording["status"], "complete")
        self.assertEqual(wording["result"], "error denied")
        self.assertIsNone(wording["usage"])
        self.assertEqual(wording["tools"], [{"type": "command_execution", "exit_code": 0}])
        self.assertEqual(wording["errors"], [])

        unknown = normalize_events(
            "claude",
            _jsonl({"type": "account", "text": "error denied", "session_id": "ses_9"}),
        )
        self.assertEqual(unknown["status"], "unknown")
        self.assertEqual(unknown["session_id"], "ses_9")
        self.assertIsNone(unknown["result"])
        self.assertIsNone(unknown["usage"])
        self.assertEqual(unknown["tools"], [])
        self.assertEqual(unknown["denials"], [])
        self.assertEqual(unknown["errors"], [])
        self.assertEqual(unknown["event_count"], 1)

    def test_missing_terminal_content_or_session_is_unknown(self):
        no_terminal = normalize_events(
            "codex",
            _jsonl(
                {"type": "thread.started", "thread_id": "thr_1"},
                {"type": "item.completed", "item": {"type": "agent_message", "text": "partial"}},
            ),
        )
        self.assertEqual(no_terminal["status"], "unknown")
        self.assertEqual(no_terminal["result"], "partial")
        self.assertIsNone(no_terminal["usage"])
        self.assertEqual(no_terminal["session_id"], "thr_1")

        no_content = normalize_events(
            "codex",
            _jsonl(
                {"type": "thread.started", "thread_id": "thr_1"},
                {"type": "turn.completed", "usage": {"input_tokens": 8}},
            ),
        )
        self.assertEqual(no_content["status"], "unknown")
        self.assertIsNone(no_content["result"])
        self.assertEqual(no_content["usage"], {"input_tokens": 8})

        no_session = normalize_events(
            "codex",
            _jsonl(
                {"type": "item.completed", "item": {"type": "agent_message", "text": "orphan"}},
                {"type": "turn.completed", "usage": {"output_tokens": 1}},
            ),
        )
        self.assertEqual(no_session["status"], "unknown")
        self.assertIsNone(no_session["session_id"])
        self.assertEqual(no_session["result"], "orphan")

        claude_no_text = normalize_events(
            "claude",
            _jsonl(
                {"type": "system", "subtype": "init", "session_id": "ses_1"},
                {"type": "result", "subtype": "success", "is_error": False, "session_id": "ses_1"},
            ),
        )
        self.assertEqual(claude_no_text["status"], "unknown")
        self.assertIsNone(claude_no_text["result"])
        self.assertEqual(claude_no_text["session_id"], "ses_1")

        blank = normalize_events("codex", b"\n\n")
        self.assertEqual(blank["status"], "unknown")
        self.assertEqual(blank["event_count"], 0)
        self.assertIsNone(blank["session_id"])
        self.assertIsNone(blank["result"])
        self.assertIsNone(blank["usage"])

    def test_nonzero_command_and_typed_codex_errors_cannot_be_hidden(self):
        hidden_after = normalize_events(
            "codex",
            _jsonl(
                {"type": "thread.started", "thread_id": "thr_1"},
                {"type": "item.completed", "item": {"type": "agent_message", "text": "ok"}},
                {"type": "turn.completed", "usage": {"input_tokens": 2}},
                {
                    "type": "item.completed",
                    "item": {"type": "command_execution", "command": "false", "exit_code": 2},
                },
            ),
        )
        self.assertEqual(hidden_after["status"], "failed")
        self.assertEqual(hidden_after["result"], "ok")
        self.assertEqual(hidden_after["usage"], {"input_tokens": 2})
        self.assertEqual(
            hidden_after["errors"],
            [{"type": "command_execution", "command": "false", "exit_code": 2}],
        )
        self.assertEqual(
            hidden_after["tools"],
            [{"type": "command_execution", "command": "false", "exit_code": 2}],
        )

        hidden_before = normalize_events(
            "codex",
            _jsonl(
                {"type": "error", "message": "boom"},
                {"type": "thread.started", "thread_id": "thr_1"},
                {"type": "item.completed", "item": {"type": "agent_message", "text": "ok"}},
                {"type": "turn.failed", "error": {"message": "nope", "kind": "runtime"}},
                {"type": "turn.completed", "usage": {"output_tokens": 5}},
            ),
        )
        self.assertEqual(hidden_before["status"], "failed")
        self.assertEqual(hidden_before["result"], "ok")
        self.assertEqual(hidden_before["usage"], {"output_tokens": 5})
        self.assertEqual(
            hidden_before["errors"],
            [
                {"type": "error", "message": "boom"},
                {"message": "nope", "kind": "runtime"},
            ],
        )

    def test_claude_denials_tool_errors_and_result_failures(self):
        denial = {"tool_name": "Bash", "tool_use_id": "toolu_1", "tool_input": {"command": "rm scratch"}}
        denied = normalize_events(
            "claude",
            _jsonl(
                {"type": "system", "subtype": "init", "session_id": "ses_1"},
                {
                    "type": "result",
                    "subtype": "success",
                    "is_error": False,
                    "result": "done",
                    "session_id": "ses_1",
                    "usage": {"input_tokens": 4},
                    "permission_denials": [denial],
                },
            ),
        )
        self.assertEqual(denied["status"], "failed")
        self.assertEqual(denied["result"], "done")
        self.assertEqual(denied["denials"], [denial])
        self.assertEqual(denied["usage"], {"input_tokens": 4})
        self.assertEqual(denied["errors"], [])

        tool_block = {"type": "tool_result", "tool_use_id": "toolu_1", "content": "no", "is_error": True}
        tool_failed = normalize_events(
            "claude",
            _jsonl(
                {"type": "system", "subtype": "init", "session_id": "ses_1"},
                {"type": "user", "message": {"role": "user", "content": [tool_block]}, "session_id": "ses_1"},
                {
                    "type": "result",
                    "subtype": "success",
                    "is_error": False,
                    "result": "done",
                    "session_id": "ses_1",
                },
            ),
        )
        self.assertEqual(tool_failed["status"], "failed")
        self.assertEqual(tool_failed["errors"], [tool_block])
        self.assertEqual(tool_failed["result"], "done")

        other = normalize_events(
            "claude",
            _jsonl(
                {"type": "system", "subtype": "init", "session_id": "ses_1"},
                {
                    "type": "result",
                    "subtype": "error_during_execution",
                    "is_error": True,
                    "result": "nope",
                    "session_id": "ses_1",
                    "errors": [{"message": "nope", "code": "x"}],
                },
            ),
        )
        self.assertEqual(other["status"], "failed")
        self.assertEqual(other["result"], "nope")
        self.assertEqual(other["errors"], [{"message": "nope", "code": "x"}])

        flagged = normalize_events(
            "claude",
            _jsonl(
                {
                    "type": "result",
                    "subtype": "success",
                    "is_error": True,
                    "result": "nope",
                    "session_id": "ses_1",
                },
            ),
        )
        self.assertEqual(flagged["status"], "failed")
        self.assertEqual(
            flagged["errors"],
            [{"type": "result", "subtype": "success", "is_error": True}],
        )

    def test_reordered_session_conflict_rejects_and_early_terminal_stays_unknown(self):
        with self.assertRaises(NativeEventError):
            normalize_events(
                "codex",
                _jsonl(
                    {"type": "turn.completed", "thread_id": "one", "usage": {"input_tokens": 1}},
                    {"type": "item.completed", "item": {"type": "agent_message", "text": "hi"}},
                    {"type": "thread.started", "thread_id": "two"},
                ),
            )
        with self.assertRaises(NativeEventError):
            normalize_events(
                "claude",
                _jsonl(
                    {
                        "type": "result",
                        "subtype": "success",
                        "is_error": False,
                        "result": "done",
                        "session_id": "ses_a",
                    },
                    {"type": "system", "subtype": "init", "session_id": "ses_b"},
                ),
            )
        reordered = normalize_events(
            "codex",
            _jsonl(
                {"type": "turn.completed", "thread_id": "thr_1", "usage": {"input_tokens": 1}},
                {"type": "item.completed", "item": {"type": "agent_message", "text": "hi"}},
                {"type": "thread.started", "thread_id": "thr_1"},
            ),
        )
        self.assertEqual(reordered["status"], "unknown")
        self.assertEqual(reordered["session_id"], "thr_1")
        self.assertEqual(reordered["result"], "hi")
        self.assertEqual(reordered["usage"], {"input_tokens": 1})

    def test_expected_session_mismatch_and_invalid_arguments_reject(self):
        raw = _jsonl(
            {"type": "thread.started", "thread_id": "thr_1"},
            {"type": "item.completed", "item": {"type": "agent_message", "text": "hi"}},
            {"type": "turn.completed"},
        )
        self.assertEqual(normalize_events("codex", raw, expected_session_id="thr_1")["status"], "complete")
        with self.assertRaises(NativeEventError):
            normalize_events("codex", raw, expected_session_id="other")
        with self.assertRaises(NativeEventError):
            normalize_events("codex", _jsonl({"type": "turn.completed"}), expected_session_id="thr_1")
        for provider in ("Codex", "claude ", "", "opencode"):
            with self.subTest(provider=provider):
                with self.assertRaises(NativeEventError):
                    normalize_events(provider, b"{}\n")
        for raw_value in ("{}", bytearray(b"{}"), None):
            with self.subTest(raw_value=type(raw_value).__name__):
                with self.assertRaises(NativeEventError):
                    normalize_events("codex", raw_value)
        with self.assertRaises(NativeEventError):
            normalize_events("codex", b"", expected_session_id="")
        with self.assertRaises(NativeEventError):
            normalize_events("codex", b"", expected_session_id=1)

    def test_strict_invalid_size_depth_and_shape(self):
        rejects = {
            "utf8": ("codex", b"\xff"),
            "array": ("codex", b"[]\n"),
            "truncated": ("codex", b'{"type":"thread.started"'),
            "whitespace-line": ("codex", b" \n"),
            "duplicate": ("codex", b'{"type":"note","a":1,"a":2}\n'),
            "duplicate-nested": ("codex", b'{"type":"note","item":{"a":1,"a":2}}\n'),
            "nan": ("codex", b'{"type":"note","n":NaN}\n'),
            "infinity": ("claude", b'{"type":"note","n":Infinity}\n'),
            "negative-infinity": ("codex", b'{"type":"note","n":-Infinity}\n'),
            "overflow": ("codex", b'{"type":"note","n":1e309}\n'),
            "depth": ("codex", _nested_object(41)),
            "oversize": ("codex", b"x" * (_MAX_BYTES + 1)),
            "line": ("codex", b"y" * (_MAX_LINE_BYTES + 1) + b"\n"),
            "events": ("codex", b'{"type":"note"}\n' * 4097),
            "bad-thread": ("codex", b'{"type":"thread.started"}\n'),
            "bad-text": ("codex", b'{"type":"item.completed","item":{"type":"agent_message","text":1}}\n'),
            "bool-exit": ("codex", b'{"type":"item.completed","item":{"type":"command_execution","exit_code":true}}\n'),
            "bad-init": ("claude", b'{"type":"system","subtype":"init"}\n'),
            "bad-tool": ("claude", b'{"type":"assistant","message":{"content":[{"type":"tool_use"}]}}\n'),
            "bad-denial": ("claude", b'{"type":"result","subtype":"success","is_error":false,"permission_denials":["no"]}\n'),
        }
        for name, (provider, raw) in rejects.items():
            with self.subTest(name=name):
                with self.assertRaises(NativeEventError):
                    normalize_events(provider, raw)

        finite = normalize_events("codex", _jsonl({"type": "note", "n": 1.5, "text": "{ error denied }"}))
        self.assertEqual(finite["status"], "unknown")
        self.assertEqual(finite["event_count"], 1)

        deep = normalize_events("claude", _nested_object(40))
        self.assertEqual(deep["status"], "unknown")
        self.assertEqual(deep["event_count"], 1)

        prefix = '{"type":"note","pad":"'
        suffix = '"}'
        pad = "b" * (_MAX_LINE_BYTES - len(prefix.encode("utf-8")) - len(suffix.encode("utf-8")))
        exact = (prefix + pad + suffix).encode("utf-8")
        self.assertEqual(len(exact), _MAX_LINE_BYTES)
        bounded = normalize_events("codex", exact + b"\n")
        self.assertEqual(bounded["event_count"], 1)

        wide = ('{"type":"note","pad":"' + ("é" * 40000) + '"}').encode("utf-8") + b"\n"
        self.assertLess(len(wide), _MAX_BYTES)
        self.assertGreater(len(wide.split(b"\n", 1)[0]), _MAX_LINE_BYTES)
        with self.assertRaises(NativeEventError):
            normalize_events("codex", wide)

        fat = _line({"type": "note", "pad": "a" * 60000})
        self.assertLess(len(fat), _MAX_LINE_BYTES)
        accepted = normalize_events("codex", fat * 30)
        self.assertEqual(accepted["event_count"], 30)
        self.assertEqual(accepted["status"], "unknown")
        self.assertLess(len(fat * 30), _MAX_BYTES)
        self.assertGreater(len(fat * 36), _MAX_BYTES)
        with self.assertRaises(NativeEventError):
            normalize_events("claude", fat * 36)

        many = normalize_events("claude", b'{"type":"ping"}\n' * 4096)
        self.assertEqual(many["event_count"], 4096)
        self.assertEqual(many["status"], "unknown")

    def test_output_is_detached_from_later_mutation(self):
        raw = _claude_success()
        denied = json.loads(raw.split(b"\n")[3].decode("utf-8"))
        denied["permission_denials"] = [{"tool_name": "Bash", "tool_use_id": "toolu_1", "tool_input": {}}]
        denied["subtype"] = "error_max_turns"
        denied["is_error"] = True
        denied["errors"] = [{"message": "stopped"}]
        raw = b"\n".join(raw.split(b"\n")[:3] + [_line(denied).rstrip(b"\n")]) + b"\n"
        got = normalize_events("claude", raw)
        self.assertEqual(got["status"], "failed")
        got["usage"]["input_tokens"] = 0
        got["tools"][0]["input"]["command"] = "mutated"
        got["denials"][0]["tool_name"] = "mutated"
        got["errors"][0]["message"] = "mutated"
        got["result"] = "mutated"
        again = normalize_events("claude", raw)
        self.assertEqual(again["usage"]["input_tokens"], 1)
        self.assertEqual(again["tools"][0]["input"]["command"], "pwd")
        self.assertEqual(again["denials"][0]["tool_name"], "Bash")
        self.assertEqual(again["errors"], [{"message": "stopped"}])
        self.assertEqual(again["result"], "done")
        self.assertIsNot(got["usage"], again["usage"])
        self.assertIsNot(got["tools"][0], again["tools"][0])
        self.assertIsNot(got["denials"][0], again["denials"][0])


if __name__ == "__main__":
    unittest.main()

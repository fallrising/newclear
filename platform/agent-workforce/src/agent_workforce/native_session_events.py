"""Pure Codex persisted-session v1 normalization. No I/O."""

import hashlib
import json

from agent_workforce.native_events import NativeEventError, _parse_line


_MAX_RAW = 2 * 1024 * 1024
_MAX_LINE = 256 * 1024
_MAX_EVENTS = 4096
# Contract requires nonempty bounded identity strings.
_MAX_FIELD = 4096
_EXPECTED_KEYS = {"cli_version", "cwd", "model", "prompt_sha256", "session_id"}
_TERMINAL_COMMAND = {"completed", "failed"}
_FAILURE_EVENTS = {"error", "turn_failed", "task_failed"}
_EFFECT_EVENTS = _FAILURE_EVENTS | {"task_started", "task_complete", "item_completed"}
_OUTPUT_KIND = {
    "function_call": "function_call_output",
    "custom_tool_call": "custom_tool_call_output",
}
_MESSAGE_ROLES = {"assistant", "developer", "system", "user"}


class SessionEventError(ValueError):
    """A persisted Codex session is malformed, unordered, or over a hard limit."""


def normalize_session(raw, *, expected):
    """Return a detached codex-session-v1 summary. Printed tool text is not evidence."""
    spec = _validate_expected(expected)
    if type(raw) is not bytes:
        raise SessionEventError("raw session must be bytes")
    if len(raw) > _MAX_RAW:
        raise SessionEventError("session exceeds 2MiB")
    if not raw.endswith(b"\n"):
        raise SessionEventError("session must end with a newline")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SessionEventError("session is not strict utf-8") from exc

    state = {
        "session_id": None,
        "turn_id": None,
        "saw_start": False,
        "saw_context": False,
        "saw_user": False,
        "saw_terminal": False,
        "failed": False,
        "result": None,
        "gaps": [],
        "tools": [],
        "calls": [],
        "calls_by_id": {},
        "command_ids": set(),
        "event_count": 0,
    }
    for line in _content_lines(text):
        state["event_count"] += 1
        if state["event_count"] > _MAX_EVENTS:
            raise SessionEventError("session exceeds 4096 events")
        event = _parse(line)
        if state["event_count"] == 1:
            _consume_meta(event, spec, state)
        else:
            _consume(event, spec, state)
    if state["event_count"] == 0:
        raise SessionEventError("session_meta must be first")
    return _finish(state)


def _validate_expected(expected):
    if not isinstance(expected, dict):
        raise SessionEventError("expected must be an object")
    if set(expected) != _EXPECTED_KEYS:
        raise SessionEventError("expected keys are invalid")
    for key in ("session_id", "cwd", "model", "cli_version"):
        _bounded(expected[key], key)
    digest = expected["prompt_sha256"]
    if (not isinstance(digest, str) or len(digest) != 64
            or any(char not in "0123456789abcdef" for char in digest)):
        raise SessionEventError("prompt_sha256 must be 64 lowercase hex")
    return {
        "session_id": expected["session_id"],
        "cwd": expected["cwd"],
        "model": expected["model"],
        "cli_version": expected["cli_version"],
        "prompt_sha256": digest,
    }


def _bounded(value, label):
    if not isinstance(value, str) or value == "":
        raise SessionEventError("invalid " + label)
    try:
        size = len(value.encode("utf-8"))
    except UnicodeError as exc:
        raise SessionEventError("invalid unicode " + label) from exc
    if size > _MAX_FIELD:
        raise SessionEventError("invalid " + label)
    return value


def _content_lines(text):
    parts = text.split("\n")
    if parts and parts[-1] == "":
        parts = parts[:-1]
    for part in parts:
        if part != "":
            yield part


def _parse(line):
    if len(line.encode("utf-8")) > _MAX_LINE:
        raise SessionEventError("event line exceeds 256KiB")
    try:
        value = _parse_line(line)
        # JSON escapes can carry lone surrogates despite strict raw UTF-8.
        json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        return value
    except (NativeEventError, UnicodeError) as exc:
        raise SessionEventError(str(exc)) from exc


def _require_envelope(event):
    if not isinstance(event, dict) or any(key not in event for key in ("timestamp", "type", "payload")):
        raise SessionEventError("malformed envelope")
    timestamp = event["timestamp"]
    if isinstance(timestamp, bool) or not isinstance(timestamp, (str, int, float)):
        raise SessionEventError("malformed timestamp")
    if isinstance(timestamp, str):
        _bounded(timestamp, "timestamp")
    if not isinstance(event["type"], str) or event["type"] == "":
        raise SessionEventError("malformed type")
    if not isinstance(event["payload"], dict):
        raise SessionEventError("malformed payload")


def _consume_meta(event, spec, state):
    _require_envelope(event)
    if event["type"] != "session_meta":
        raise SessionEventError("session_meta must be first")
    payload = event["payload"]
    session_id = _bounded(payload.get("id"), "session id")
    if session_id != spec["session_id"]:
        raise SessionEventError("session id mismatch")
    if payload.get("cwd") != spec["cwd"]:
        raise SessionEventError("cwd mismatch")
    if payload.get("cli_version") != spec["cli_version"]:
        raise SessionEventError("cli_version mismatch")
    if payload.get("originator") != "codex_exec":
        raise SessionEventError("originator mismatch")
    if payload.get("source") != "exec":
        raise SessionEventError("source mismatch")
    if "session_id" in payload and payload.get("session_id") != session_id:
        raise SessionEventError("payload session_id mismatch")
    state["session_id"] = session_id


def _consume(event, spec, state):
    _require_envelope(event)
    kind = event["type"]
    if kind == "session_meta":
        raise SessionEventError("session_meta after first")
    if kind == "turn_context":
        _consume_context(event["payload"], spec, state)
    elif kind == "response_item":
        _consume_response(event["payload"], state)
    elif kind == "event_msg":
        _consume_event_msg(event["payload"], spec, state)
    else:
        _gap(state, "unsupported_event")


def _consume_context(payload, spec, state):
    if state["saw_terminal"]:
        raise SessionEventError("effect after terminal")
    if not state["saw_start"]:
        raise SessionEventError("turn_context before task_started")
    if state["saw_context"]:
        raise SessionEventError("duplicate turn_context")
    turn = _bounded(payload.get("turn_id"), "turn_id")
    root = _bounded(payload.get("root_turn_id"), "root_turn_id")
    if turn != state["turn_id"] or root != state["turn_id"]:
        raise SessionEventError("turn_context identity mismatch")
    if payload.get("cwd") != spec["cwd"] or payload.get("model") != spec["model"]:
        raise SessionEventError("turn_context binding mismatch")
    state["saw_context"] = True


def _consume_event_msg(payload, spec, state):
    kind = payload.get("type")
    if not isinstance(kind, str) or kind == "":
        raise SessionEventError("malformed event_msg type")
    if state["saw_terminal"]:
        if kind == "token_count":
            _match_optional_binding(payload, state)
            return
        if kind == "thread_settings_applied":
            _match_optional_binding(payload, state)
            _gap(state, "settings_after_terminal")
            return
        if kind in _EFFECT_EVENTS:
            raise SessionEventError("effect after terminal")
        _match_optional_binding(payload, state)
        _gap(state, "unsupported_event_msg")
        return
    if kind == "task_started":
        _consume_started(payload, state)
    elif kind == "task_complete":
        _consume_terminal(payload, state)
    elif kind == "item_completed":
        _consume_item(payload, spec, state)
    elif kind in ("token_count", "thread_settings_applied"):
        _match_optional_binding(payload, state)
    elif kind in _FAILURE_EVENTS:
        _consume_failure(payload, state)
    else:
        _match_optional_binding(payload, state)
        _gap(state, "unsupported_event_msg")


def _consume_started(payload, state):
    if state["saw_start"]:
        raise SessionEventError("multiple turns")
    turn = _bounded(payload.get("turn_id"), "turn_id")
    root = _bounded(payload.get("root_turn_id"), "root_turn_id")
    if root != turn:
        raise SessionEventError("root_turn_id mismatch")
    if "thread_id" in payload and payload.get("thread_id") != state["session_id"]:
        raise SessionEventError("thread_id mismatch")
    state["saw_start"] = True
    state["turn_id"] = turn


def _consume_terminal(payload, state):
    if not state["saw_context"] or not state["saw_user"]:
        raise SessionEventError("terminal out of order")
    turn = _bounded(payload.get("turn_id"), "turn_id")
    root = _bounded(payload.get("root_turn_id"), "root_turn_id")
    if turn != state["turn_id"] or root != state["turn_id"]:
        raise SessionEventError("terminal identity mismatch")
    if "thread_id" in payload and payload.get("thread_id") != state["session_id"]:
        raise SessionEventError("thread_id mismatch")
    message = payload.get("last_agent_message")
    if not isinstance(message, str) or message == "":
        raise SessionEventError("last_agent_message required")
    state["result"] = message
    state["saw_terminal"] = True


def _consume_failure(payload, state):
    if not state["saw_start"] or payload.get("turn_id") != state["turn_id"]:
        raise SessionEventError("failure turn mismatch")
    if "root_turn_id" in payload and payload.get("root_turn_id") != state["turn_id"]:
        raise SessionEventError("failure root mismatch")
    if "thread_id" in payload and payload.get("thread_id") != state["session_id"]:
        raise SessionEventError("thread_id mismatch")
    state["failed"] = True


def _consume_item(payload, spec, state):
    if not state["saw_start"] or payload.get("thread_id") != state["session_id"] or payload.get("turn_id") != state["turn_id"]:
        raise SessionEventError("item identity mismatch")
    item = payload.get("item")
    if not isinstance(item, dict):
        raise SessionEventError("malformed item")
    item_type = item.get("type")
    if item_type == "UserMessage":
        _consume_user(item, spec, state)
    elif item_type == "AgentMessage":
        return
    elif item_type == "CommandExecution":
        _consume_command(item, state)
    elif not isinstance(item_type, str) or item_type == "":
        raise SessionEventError("malformed item type")
    else:
        _gap(state, "unsupported_item")


def _consume_user(item, spec, state):
    if state["saw_user"]:
        raise SessionEventError("extra UserMessage")
    content = item.get("content")
    if not isinstance(content, list) or len(content) != 1 or not isinstance(content[0], dict):
        raise SessionEventError("malformed user content")
    block = content[0]
    if block.get("type") != "text":
        raise SessionEventError("user content must be text")
    text = block.get("text")
    if not isinstance(text, str):
        raise SessionEventError("user text malformed")
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if digest != spec["prompt_sha256"]:
        raise SessionEventError("prompt hash mismatch")
    state["saw_user"] = True


def _consume_command(item, state):
    if not state["saw_context"] or not state["saw_user"]:
        raise SessionEventError("command before admitted context or prompt")
    command_id = _bounded(item.get("id"), "command id")
    if command_id in state["command_ids"]:
        raise SessionEventError("duplicate command id")
    status = item.get("status")
    if not isinstance(status, str) or status == "" or len(status.encode("utf-8")) > _MAX_FIELD:
        raise SessionEventError("command status malformed")
    if status in _TERMINAL_COMMAND:
        if "exit_code" not in item or type(item.get("exit_code")) is not int:
            raise SessionEventError("exit_code must be int")
        exit_code = item["exit_code"]
        if exit_code != 0 or status == "failed":
            state["failed"] = True
    else:
        if "exit_code" in item and type(item.get("exit_code")) is not int:
            raise SessionEventError("exit_code must be int")
        exit_code = item.get("exit_code")
        _gap(state, "pending_command")
    state["command_ids"].add(command_id)
    state["tools"].append({
        "id": command_id,
        "type": "CommandExecution",
        "status": status,
        "exit_code": exit_code,
    })


def _consume_response(payload, state):
    if state["saw_terminal"]:
        raise SessionEventError("effect after terminal")
    kind = payload.get("type")
    if not isinstance(kind, str) or kind == "":
        raise SessionEventError("malformed response type")
    if kind in ("function_call", "custom_tool_call"):
        _consume_call(payload, state, kind)
    elif kind in ("function_call_output", "custom_tool_call_output"):
        _consume_output(payload, state, kind)
    elif kind == "message":
        if not isinstance(payload.get("role"), str) or payload["role"] not in _MESSAGE_ROLES:
            raise SessionEventError("message role malformed")
        if not isinstance(payload.get("content"), list):
            raise SessionEventError("message content malformed")
    elif kind == "reasoning":
        return
    else:
        _gap(state, "unsupported_response")


def _consume_call(payload, state, kind):
    call_id = _bounded(payload.get("call_id"), "call_id")
    name = _bounded(payload.get("name"), "name")
    if call_id in state["calls_by_id"]:
        raise SessionEventError("duplicate call_id")
    record = {"call_id": call_id, "name": name, "type": kind, "output_received": False}
    state["calls"].append(record)
    state["calls_by_id"][call_id] = record
    _gap(state, "opaque_tool_call")
    if kind == "custom_tool_call" and payload.get("status") == "failed":
        _gap(state, "custom_tool_status_failed")


def _consume_output(payload, state, kind):
    call_id = payload.get("call_id")
    record = state["calls_by_id"].get(call_id) if isinstance(call_id, str) else None
    if record is None:
        raise SessionEventError("unmatched call output")
    if kind != _OUTPUT_KIND[record["type"]]:
        raise SessionEventError("conflicting call output")
    if record["output_received"]:
        raise SessionEventError("duplicate call output")
    if "output" not in payload:
        raise SessionEventError("missing call output")
    record["output_received"] = True
    record["output_sha256"] = _canonical_sha(payload["output"])


def _match_optional_binding(payload, state):
    if "thread_id" in payload and payload.get("thread_id") != state["session_id"]:
        raise SessionEventError("thread_id mismatch")
    if state["turn_id"] is not None and "turn_id" in payload and payload.get("turn_id") != state["turn_id"]:
        raise SessionEventError("turn_id mismatch")
    if (state["turn_id"] is not None and "root_turn_id" in payload
            and payload.get("root_turn_id") != state["turn_id"]):
        raise SessionEventError("root_turn_id mismatch")


def _canonical_sha(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _gap(state, name):
    if name not in state["gaps"]:
        state["gaps"].append(name)


def _finish(state):
    if not state["saw_start"]:
        _gap(state, "missing_task_started")
    if not state["saw_context"]:
        _gap(state, "missing_turn_context")
    if not state["saw_user"]:
        _gap(state, "missing_user_message")
    if not state["saw_terminal"]:
        _gap(state, "missing_terminal")
    if any(not record["output_received"] for record in state["calls"]):
        _gap(state, "unpaired_call")
    gaps = sorted(state["gaps"])
    bound = (state["saw_start"] and state["saw_context"] and state["saw_user"]
             and state["saw_terminal"] and isinstance(state["result"], str) and state["result"] != "")
    if state["failed"]:
        status = "failed"
    elif bound and not gaps:
        status = "complete"
    else:
        status = "unknown"
    calls = []
    for record in state["calls"]:
        item = {
            "call_id": record["call_id"],
            "name": record["name"],
            "type": record["type"],
            "output_received": record["output_received"],
        }
        if record["output_received"]:
            item["output_sha256"] = record["output_sha256"]
        calls.append(item)
    return {
        "protocol": "codex-session-v1",
        "session_id": state["session_id"],
        "turn_id": state["turn_id"],
        "status": status,
        "coverage": "complete" if not gaps else "incomplete",
        "coverage_gaps": gaps,
        "tools": [dict(tool) for tool in state["tools"]],
        "calls": calls,
        "event_count": state["event_count"],
        "result": state["result"],
    }

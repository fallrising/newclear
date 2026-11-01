"""Pure Codex and Claude JSONL normalization. No I/O."""

import json
import math

_MAX_BYTES = 2 * 1024 * 1024
_MAX_LINE_BYTES = 64 * 1024
_MAX_EVENTS = 4096
_MAX_DEPTH = 40


class NativeEventError(ValueError):
    """A native event stream is malformed or violates a hard limit."""


def normalize_events(provider, raw, *, expected_session_id=None):
    """Return a detached JSON summary of one native JSONL transcript."""
    if provider not in ("codex", "claude"):
        raise NativeEventError("provider must be codex or claude")
    if expected_session_id is not None and (
        not isinstance(expected_session_id, str) or expected_session_id == ""
    ):
        raise NativeEventError("expected session id must be nonempty text")
    if type(raw) is not bytes:
        raise NativeEventError("raw event stream must be bytes")
    if len(raw) > _MAX_BYTES:
        raise NativeEventError("event stream exceeds 2MiB")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise NativeEventError("event stream is not strict utf-8") from exc

    state = {
        "session_id": None,
        "parts": [],
        "usage": None,
        "tools": [],
        "denials": [],
        "errors": [],
        "failed": False,
        "saw_success_terminal": False,
        "initialized": False,
        "order_invalid": False,
    }
    event_count = 0
    for line in _nonempty_lines(text):
        event_count += 1
        if event_count > _MAX_EVENTS:
            raise NativeEventError("event stream exceeds 4096 events")
        _consume(provider, _parse_line(line), state)

    if expected_session_id is not None and state["session_id"] != expected_session_id:
        raise NativeEventError("native session id does not match expected session id")

    result = _join(state["parts"])
    if state["failed"]:
        status = "failed"
    elif (state["saw_success_terminal"] and state["initialized"] and not state["order_invalid"]
          and state["session_id"] is not None and result is not None):
        status = "complete"
    else:
        status = "unknown"
    return {
        "provider": provider,
        "session_id": state["session_id"],
        "status": status,
        "result": result,
        "usage": state["usage"],
        "tools": state["tools"],
        "denials": state["denials"],
        "errors": state["errors"],
        "event_count": event_count,
    }


def _nonempty_lines(text):
    for chunk in text.split("\n"):
        if chunk.endswith("\r"):
            chunk = chunk[:-1]
        if chunk == "":
            continue
        if len(chunk.encode("utf-8")) > _MAX_LINE_BYTES:
            raise NativeEventError("event line exceeds 64KiB")
        yield chunk


def _parse_line(text):
    _ensure_depth(text)
    try:
        value = json.loads(
            text,
            object_pairs_hook=_pairs,
            parse_constant=_reject_constant,
        )
    except NativeEventError:
        raise
    except (json.JSONDecodeError, ValueError, RecursionError) as exc:
        raise NativeEventError("malformed json") from exc
    _reject_nonfinite(value)
    if not isinstance(value, dict):
        raise NativeEventError("event must be a JSON object")
    return value


def _pairs(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise NativeEventError("duplicate key")
        obj[key] = value
    return obj


def _reject_constant(_name):
    raise NativeEventError("nonfinite number")


def _ensure_depth(text):
    depth = 0
    in_string = False
    escape = False
    for char in text:
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "{[":
            depth += 1
            if depth > _MAX_DEPTH:
                raise NativeEventError("json depth exceeds 40")
        elif char in "}]":
            depth -= 1
            if depth < 0:
                raise NativeEventError("malformed json")


def _reject_nonfinite(value):
    if value is None or isinstance(value, str) or isinstance(value, bool):
        return
    if isinstance(value, int):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise NativeEventError("nonfinite number")
        return
    if isinstance(value, list):
        for item in value:
            _reject_nonfinite(item)
        return
    if isinstance(value, dict):
        for item in value.values():
            _reject_nonfinite(item)
        return
    raise NativeEventError("malformed json")


def _copy(value):
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")))


def _join(parts):
    texts = [part for part in parts if part != ""]
    if not texts:
        return None
    return "\n".join(texts)


def _consume(provider, event, state):
    field = "thread_id" if provider == "codex" else "session_id"
    if field in event:
        _observe_session(state, event[field])
    event_type = event.get("type")
    if event_type is not None and not isinstance(event_type, str):
        raise NativeEventError("event type must be text")
    if event_type in ("turn.failed", "error"):
        _consume_failure_event(event, state)
        return
    if provider == "codex":
        _consume_codex(event_type, event, state)
    else:
        _consume_claude(event_type, event, state)


def _observe_session(state, value):
    if not isinstance(value, str) or value == "":
        raise NativeEventError("invalid native session id")
    if state["session_id"] is None:
        state["session_id"] = value
    elif state["session_id"] != value:
        raise NativeEventError("inconsistent native session id")


def _consume_failure_event(event, state):
    state["failed"] = True
    nested = event.get("error")
    if isinstance(nested, dict):
        state["errors"].append(_copy(nested))
    else:
        state["errors"].append(_copy(event))
    _take_usage(event, state)


def _consume_codex(event_type, event, state):
    if event_type == "thread.started":
        if "thread_id" not in event:
            raise NativeEventError("thread.started requires thread_id")
        state["initialized"] = True
        return
    if event_type == "turn.completed":
        if not state["initialized"]:
            state["order_invalid"] = True
        state["saw_success_terminal"] = True
        _take_usage(event, state)
        return
    if event_type == "item.completed":
        _consume_item(event, state)


def _consume_item(event, state):
    item = event.get("item")
    if not isinstance(item, dict) or not isinstance(item.get("type"), str):
        raise NativeEventError("item.completed requires a typed item")
    kind = item["type"]
    if kind == "agent_message":
        text = item.get("text")
        if not isinstance(text, str):
            raise NativeEventError("agent_message requires text")
        state["parts"].append(text)
        return
    if kind == "command_execution":
        exit_code = item.get("exit_code")
        if type(exit_code) is not int:
            raise NativeEventError("command_execution requires an integer exit_code")
        summary = {"type": "command_execution"}
        if "command" in item:
            if not isinstance(item["command"], str):
                raise NativeEventError("command_execution command must be text")
            summary["command"] = item["command"]
        summary["exit_code"] = exit_code
        state["tools"].append(summary)
        if exit_code != 0:
            state["failed"] = True
            state["errors"].append(dict(summary))
        return
    if kind == "file_change":
        summary = {"type": "file_change"}
        if "changes" in item:
            if not isinstance(item["changes"], list):
                raise NativeEventError("file_change changes must be a list")
            summary["changes"] = _copy(item["changes"])
        state["tools"].append(summary)


def _consume_claude(event_type, event, state):
    if event_type == "system":
        if event.get("subtype") == "init" and "session_id" not in event:
            raise NativeEventError("system init requires session_id")
        if event.get("subtype") == "init":
            state["initialized"] = True
        return
    if event_type == "assistant":
        for block in _content_blocks(event, "assistant message"):
            if block["type"] != "tool_use":
                continue
            name = block.get("name")
            ident = block.get("id")
            if (
                not isinstance(name, str)
                or name == ""
                or not isinstance(ident, str)
                or ident == ""
                or "input" not in block
            ):
                raise NativeEventError("tool_use requires name, id, and input")
            state["tools"].append(
                {"type": "tool_use", "name": name, "id": ident, "input": _copy(block["input"])}
            )
        return
    if event_type == "user":
        for block in _content_blocks(event, "user message"):
            if block["type"] != "tool_result":
                continue
            if "is_error" in block and not isinstance(block["is_error"], bool):
                raise NativeEventError("tool_result is_error must be boolean")
            if block.get("is_error") is True:
                state["failed"] = True
                state["errors"].append(_copy(block))
        return
    if event_type == "result":
        if not state["initialized"]:
            state["order_invalid"] = True
        _consume_result(event, state)


def _content_blocks(event, label):
    message = event.get("message")
    if not isinstance(message, dict):
        raise NativeEventError(label + " requires message")
    content = message.get("content", [])
    if not isinstance(content, list):
        raise NativeEventError(label + " content must be a list")
    for block in content:
        if not isinstance(block, dict) or not isinstance(block.get("type"), str):
            raise NativeEventError(label + " content block is malformed")
    return content


def _consume_result(event, state):
    subtype = event.get("subtype")
    if not isinstance(subtype, str):
        raise NativeEventError("result requires subtype")
    if "is_error" in event and not isinstance(event["is_error"], bool):
        raise NativeEventError("result is_error must be boolean")
    if "result" in event and event["result"] is not None:
        if not isinstance(event["result"], str):
            raise NativeEventError("result text must be text")
        state["parts"].append(event["result"])
    native_errors = None
    if "errors" in event:
        native_errors = event["errors"]
        if not isinstance(native_errors, list) or any(not isinstance(item, dict) for item in native_errors):
            raise NativeEventError("result errors must be structured objects")
        if native_errors:
            state["failed"] = True
            state["errors"].extend(_copy(item) for item in native_errors)
    if "permission_denials" in event:
        denials = event["permission_denials"]
        if not isinstance(denials, list) or any(not isinstance(item, dict) for item in denials):
            raise NativeEventError("permission_denials must be structured objects")
        if denials:
            state["failed"] = True
            state["denials"].extend(_copy(item) for item in denials)
    is_error = event.get("is_error")
    typed_failure = subtype != "success" or is_error is True
    if typed_failure:
        state["failed"] = True
        if not native_errors:
            envelope = {"type": "result", "subtype": subtype}
            if "is_error" in event:
                envelope["is_error"] = event["is_error"]
            state["errors"].append(envelope)
    if (
        subtype == "success"
        and is_error is False
        and isinstance(event.get("result"), str)
        and event["result"] != ""
    ):
        state["saw_success_terminal"] = True
    _take_usage(event, state)


def _take_usage(event, state):
    if "usage" not in event:
        return
    usage = event["usage"]
    if usage is None:
        state["usage"] = None
        return
    if not isinstance(usage, dict):
        raise NativeEventError("terminal usage must be an object")
    state["usage"] = _copy(usage)

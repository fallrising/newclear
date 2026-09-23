"""Bounded chat/tool dialect for the pinned OpenHands 1.49.2 fixture.

No provider options, remote resources or streaming. Validate on the control side;
the guest only transports bytes. Tool definitions remain data, never host code.
"""

import json
import re

from .domain import Problem
from .model_policy import MAX_REQUEST, MODEL, canonical, response, sensitive

TOOLS = {"terminal", "finish", "think"}


def require(value):
    if not value:
        raise Problem(422, "model_sdk_dialect_invalid")


def content(value, *, nullable=False):
    if value is None:
        require(nullable)
    elif isinstance(value, str):
        require(len(value) <= 65536)
    else:
        require(isinstance(value, list) and 1 <= len(value) <= 32)
        for part in value:
            require(isinstance(part, dict) and set(part) == {"type", "text"})
            require(part["type"] == "text" and isinstance(part["text"], str))
            require(len(part["text"]) <= 65536)


def calls(value):
    require(isinstance(value, list) and 1 <= len(value) <= 16)
    ids = set()
    for call in value:
        require(isinstance(call, dict) and set(call) == {"id", "type", "function"})
        require(isinstance(call["id"], str) and re.fullmatch(r"[\w-]{1,128}", call["id"]))
        require(call["id"] not in ids and call["type"] == "function")
        ids.add(call["id"])
        fn = call["function"]
        require(isinstance(fn, dict) and set(fn) == {"name", "arguments"})
        require(fn["name"] in TOOLS and isinstance(fn["arguments"], str))
        require(len(fn["arguments"]) <= 32768)
        try:
            require(isinstance(json.loads(fn["arguments"]), dict))
        except (ValueError, RecursionError):
            raise Problem(422, "model_sdk_dialect_invalid") from None


class SDKCompletion:
    def __init__(self, data):
        self.data = data

    def payload(self):
        try:
            return self._payload()
        except (ValueError, TypeError, KeyError, RecursionError):
            raise Problem(422, "model_sdk_dialect_invalid") from None

    def _payload(self):
        d = self.data
        require(isinstance(d, dict))
        require(
            set(d)
            <= {
                "model",
                "messages",
                "tools",
                "tool_choice",
                "max_tokens",
                "max_completion_tokens",
                "stream",
                "temperature",
                "seed",
                "parallel_tool_calls",
            }
        )
        require(d.get("model") in {"gpt-4o-mini", MODEL})
        require(d.get("stream", False) is False)
        require(d.get("tool_choice", "auto") == "auto")
        require(d.get("parallel_tool_calls", False) is False)
        require(d.get("temperature") in {None, 0, 1})
        require(d.get("seed") is None or type(d["seed"]) is int)
        require(not ("max_tokens" in d and "max_completion_tokens" in d))
        maximum = d.get("max_tokens", d.get("max_completion_tokens"))
        require(type(maximum) is int and 1 <= maximum <= 4096)
        messages = d.get("messages")
        require(isinstance(messages, list) and 1 <= len(messages) <= 128)
        pending, answered = set(), set()
        for message in messages:
            require(isinstance(message, dict))
            role = message.get("role")
            require(role in {"system", "user", "assistant", "tool"})
            fields = {"role", "content"}
            if role == "assistant":
                fields.add("tool_calls")
            if role == "tool":
                fields.add("tool_call_id")
                fields.add("name")
                require(message.get("name", "terminal") in TOOLS)
            require(set(message) <= fields and ("content" in message or role == "assistant"))
            content(message.get("content"), nullable=role == "assistant")
            if "tool_calls" in message:
                calls(message["tool_calls"])
                for call in message["tool_calls"]:
                    require(call["id"] not in pending)
                    pending.add(call["id"])
            if role == "tool":
                identity = message.get("tool_call_id")
                require(
                    isinstance(identity, str) and identity in pending and identity not in answered
                )
                answered.add(identity)
        tools = d.get("tools")
        require(isinstance(tools, list) and 1 <= len(tools) <= 3)
        names = set()
        for tool in tools:
            require(isinstance(tool, dict) and set(tool) == {"type", "function"})
            require(tool["type"] == "function")
            fn = tool["function"]
            require(isinstance(fn, dict) and set(fn) <= {"name", "description", "parameters"})
            require(fn.get("name") in TOOLS and fn["name"] not in names)
            require(isinstance(fn.get("parameters"), dict))
            names.add(fn["name"])
        require("terminal" in names and "finish" in names)
        value = {
            "model": MODEL,
            "messages": messages,
            "tools": tools,
            "max_tokens": maximum,
            "stream": False,
        }
        require(len(canonical(value)) <= MAX_REQUEST)
        return value


def sdk_response(raw, payload, secrets):
    try:
        value = json.loads(raw)
        if sensitive(value, secrets):
            raise Problem(502, "model_sensitive_response")
        require(isinstance(value, dict) and set(value) == {"model", "choices", "usage"})
        require(value["model"] == MODEL and len(value["choices"]) == 1)
        choice = value["choices"][0]
        require(set(choice) == {"index", "message", "finish_reason"})
        require(type(choice["index"]) is int and choice["index"] == 0)
        require(choice["finish_reason"] == "tool_calls")
        message = choice["message"]
        require(set(message) == {"role", "content", "tool_calls"})
        require(message["role"] == "assistant")
        content(message["content"], nullable=True)
        calls(message["tool_calls"])
        available = {t["function"]["name"] for t in payload["tools"]}
        require(all(c["function"]["name"] in available for c in message["tool_calls"]))
        # Share the existing strict usage-counter validation without weakening text API.
        text = {
            "model": MODEL,
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": ""},
                }
            ],
            "usage": value["usage"],
        }
        _, usage = response(canonical(text), payload["max_tokens"], secrets)
        return value, usage
    except (ValueError, TypeError, KeyError, RecursionError, Problem) as exc:
        if isinstance(exc, Problem) and exc.code == "model_sensitive_response":
            raise
        raise Problem(502, "model_response_invalid") from None

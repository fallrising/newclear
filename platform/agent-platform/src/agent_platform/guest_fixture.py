"""M2 deterministic model, run inside one guest. Emits a real terminal tool call.

This is a test model, not an implementation of arbitrary natural-language goals.
A FILE/TEXT card uses the same write as the control-side mock. Anything else
writes only the fixture file. Only the platform-generated UUID is interpolated.
"""

import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import UUID

FILE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,40}$")
PLAIN_TEXT = re.compile(r"^[A-Za-z0-9 ._-]{0,80}$")


def message_text(message):
    content = message.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None
    parts = []
    for item in content:
        if (
            not isinstance(item, dict)
            or item.get("type") != "text"
            or not isinstance(item.get("text"), str)
        ):
            return None
        parts.append(item["text"])
    return "\n".join(parts)


def task_card(messages):
    text = None
    for message in messages:
        if message.get("role") == "user":
            candidate = message_text(message)
            if candidate is not None:
                text = candidate
    if text is None:
        return None
    found = []
    lines = text.splitlines()
    for index in range(len(lines) - 1):
        if not lines[index].startswith("FILE ") or not lines[index + 1].startswith("TEXT "):
            continue
        name, body = lines[index][5:], lines[index + 1][5:]
        if (
            name in {".", "..", "m2-result.txt"}
            or not FILE_NAME.fullmatch(name)
            or not PLAIN_TEXT.fullmatch(body)
        ):
            return None
        found.append((name, body))
    if len(found) != 1:
        return None
    return found[0]


def edit_command(messages, run_id):
    card = task_card(messages)
    if card:
        filename, body = card
        return (
            'python3 -c "from pathlib import Path; '
            f"Path({filename!r}).write_text({body!r} + '\\n'); "
            f"Path('m2-result.txt').write_text('{run_id}\\n')\""
        )
    return (
        f"python3 -c \"from pathlib import Path; Path('m2-result.txt').write_text('{run_id}\\n')\""
    )


RUN = str(UUID(os.environ["FIXTURE_RUN_ID"])) if os.environ.get("FIXTURE_RUN_ID") else ""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= 1024 * 1024:
            self.send_error(413)
            return
        request = json.loads(self.rfile.read(size))
        messages = request.get("messages", [])
        called = any(m.get("role") == "tool" for m in messages)
        functions = {t["function"]["name"]: t["function"] for t in request.get("tools", [])}
        if not called and "terminal" in functions:
            if not RUN:
                self.send_error(500)
                return
            name, arguments = "terminal", {"command": edit_command(messages, RUN)}
        elif "finish" in functions:
            name, arguments = (
                "finish",
                {"message": "M2 fixture completed; inspect saved diff and verification."},
            )
        else:
            self.send_error(422)
            return
        # Bounded delay keeps concurrency visible without depending on a paid provider.
        time.sleep(1)
        message = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_" + RUN + ("_finish" if called else "_edit"),
                    "type": "function",
                    "function": {"name": name, "arguments": json.dumps(arguments)},
                }
            ],
        }
        response = {
            "id": "chatcmpl-" + RUN,
            "object": "chat.completion",
            "created": 0,
            "model": "gpt-4o-mini",
            "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        raw = json.dumps(response).encode()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    if not RUN:
        raise SystemExit("FIXTURE_RUN_ID is required")
    ThreadingHTTPServer(("127.0.0.1", 18080), Handler).serve_forever()

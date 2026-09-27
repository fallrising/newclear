"""Scripted OpenAI Chat Completions mock for local integration tests.

It exercises the provider wire shape without a paid API or guest network access.
"""

import hmac
import json
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import UUID

from .model_policy import MAX_REQUEST, canonical

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
    """One FILE/TEXT pair inside the latest user message, not a language interpreter."""
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


def mock_response(data, run_id):
    called = any(message["role"] == "tool" for message in data["messages"])
    card = None if called else task_card(data["messages"])
    name = "finish" if called else "terminal"
    if called:
        arguments = {"message": "Local mock completed."}
    elif card:
        filename, body = card
        arguments = {
            "command": 'python3 -c "from pathlib import Path; '
            f"Path({filename!r}).write_text({body!r} + '\\n'); "
            f"Path('m2-result.txt').write_text('{run_id}\\n')\""
        }
    else:
        arguments = {
            "command": 'python3 -c "from pathlib import Path; '
            f"Path('m2-result.txt').write_text('{run_id}\\n')\""
        }
    return {
        "id": "chatcmpl-local-mock",
        "object": "chat.completion",
        "created": 0,
        "model": data["model"],
        "choices": [
            {
                "index": 0,
                "finish_reason": "tool_calls",
                "logprobs": None,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "refusal": None,
                    "tool_calls": [
                        {
                            "id": "call_local_mock_finish" if called else "call_local_mock_edit",
                            "type": "function",
                            "function": {"name": name, "arguments": json.dumps(arguments)},
                        }
                    ],
                },
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
            "prompt_tokens_details": {"cached_tokens": 0},
        },
    }


def rehearse(directory, goal, run_id):
    """Run the mock's edit in a local directory. This is not a VM and not a paid call."""
    root = Path(directory)
    if not root.is_dir() or root.is_symlink():
        raise ValueError("mock_rehearsal_directory_invalid")
    response = mock_response(
        {
            "model": "local-mock",
            "messages": [{"role": "user", "content": goal}],
            "tools": [],
            "max_tokens": 16,
            "stream": False,
        },
        str(run_id),
    )
    call = response["choices"][0]["message"]["tool_calls"][0]["function"]
    if call["name"] != "terminal":
        raise ValueError("mock_rehearsal_not_an_edit")
    command = json.loads(call["arguments"])["command"]
    prefix = 'python3 -c "'
    if not command.startswith(prefix) or not command.endswith('"') or "subprocess" in command:
        raise ValueError("mock_rehearsal_command_rejected")
    code = command[len(prefix) : -1]
    if not code.startswith("from pathlib import Path; Path("):
        raise ValueError("mock_rehearsal_command_rejected")
    subprocess.run([sys.executable, "-c", code], cwd=root, check=True, timeout=5)
    fixture = root / "m2-result.txt"
    return {
        "fixture_matches_run": fixture.is_file() and fixture.read_text() == f"{run_id}\n",
        "files": sorted(path.name for path in root.iterdir() if path.is_file()),
    }


def mock_server(port, credential, model, *, fixed_run_id=None):
    model_calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            if self.path != "/v1/chat/completions" or not hmac.compare_digest(
                self.headers.get("Authorization", ""), "Bearer " + credential
            ):
                self.send_error(403)
                return
            try:
                length = self.headers.get_all("Content-Length", [])
                if len(length) != 1 or not length[0].isascii() or not length[0].isdigit():
                    raise ValueError()
                size = int(length[0])
                if not 0 < size <= MAX_REQUEST:
                    raise ValueError()
                data = json.loads(self.rfile.read(size))
                if fixed_run_id is None:
                    run_id = str(UUID(self.headers.get("X-Local-Mock-Run-Id", "")))
                else:
                    if self.headers.get("X-Local-Mock-Run-Id") is not None:
                        raise ValueError()
                    run_id = str(UUID(fixed_run_id))
                if (
                    not isinstance(data, dict)
                    or set(data) != {"model", "messages", "tools", "max_tokens", "stream"}
                    or data["model"] != model
                    or data["stream"] is not False
                    or type(data["max_tokens"]) is not int
                    or data["max_tokens"] < 5
                    or not isinstance(data["messages"], list)
                    or not isinstance(data["tools"], list)
                ):
                    raise ValueError()
                model_calls.append(
                    {
                        "path": self.path,
                        "authorization": self.headers.get("Authorization"),
                        "test_run_header": self.headers.get("X-Local-Mock-Run-Id"),
                    }
                )
            except (ValueError, KeyError, TypeError):
                self.send_error(422)
                return
            raw = canonical(mock_response(data, run_id))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.model_calls = model_calls
    return server

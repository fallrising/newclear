"""Scripted OpenAI Chat Completions mock for local integration tests.

It exercises the provider wire shape without a paid API or guest network access.
"""

import hmac
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import UUID

from .model_policy import MAX_REQUEST, canonical


def mock_response(data, run_id):
    called = any(message["role"] == "tool" for message in data["messages"])
    name = "finish" if called else "terminal"
    arguments = (
        {"message": "Local mock completed."}
        if called
        else {
            "command": 'python3 -c "from pathlib import Path; '
            f"Path('m2-result.txt').write_text('{run_id}\\n')\""
        }
    )
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

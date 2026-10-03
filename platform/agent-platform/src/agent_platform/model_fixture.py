"""An authenticated control-side fixture, never a paid model or agent tool runner."""

import hmac
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import UUID

from .model_policy import MAX_REQUEST, MODEL, canonical


def fixture_response():
    return {
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "Model proxy fixture."},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }


def tool_response(data):
    run = str(UUID(data["fixture_run_id"]))
    called = any(m["role"] == "tool" for m in data["messages"])
    command = (
        "python3 -c \"from pathlib import Path; Path('m2-result.txt').write_text('"
        + run
        + "\\n')\""
    )
    name = "finish" if called else "terminal"
    arguments = (
        {"message": "Fixture completed; inspect saved verification."}
        if called
        else {"command": command}
    )
    return {
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_" + run + ("_finish" if called else "_edit"),
                            "type": "function",
                            "function": {"name": name, "arguments": json.dumps(arguments)},
                        }
                    ],
                },
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }


def fixture_server(port, credential):
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
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= MAX_REQUEST:
                    raise ValueError()
                data = json.loads(self.rfile.read(size))
                if data["model"] != MODEL or data["max_tokens"] < 5:
                    raise ValueError()
            except (ValueError, KeyError, TypeError):
                self.send_error(422)
                return
            raw = canonical(tool_response(data) if "tools" in data else fixture_response())
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)

"""M2 deterministic model, run inside one guest. Emits a real terminal tool call.

This is a test model, not an implementation of arbitrary natural-language goals.
Only the platform-generated UUID is interpolated into the fixed command.
"""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import UUID

RUN = str(UUID(os.environ["FIXTURE_RUN_ID"]))
COMMAND = (
    "python3 -c \"from pathlib import Path; Path('m2-result.txt').write_text('" + RUN + "\\n')\""
)


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
            name, arguments = "terminal", {"command": COMMAND}
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
    ThreadingHTTPServer(("127.0.0.1", 18080), Handler).serve_forever()

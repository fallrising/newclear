"""Loopback-only deterministic chat-completions fixture. Never calls a provider."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_counts: dict[str, int] = {}
_lock = threading.Lock()


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
        last_user = next((m for m in reversed(messages) if m.get("role") == "user"), {})
        content = json.dumps(last_user.get("content", ""))
        with _lock:
            _counts[content] = _counts.get(content, 0) + 1
            count = _counts[content]
        if "M0_WAIT" in content and count == 1:
            time.sleep(8)
        # Prefer the SDK's finish tool if offered, otherwise a normal assistant reply.
        names = [t.get("function", {}).get("name") for t in request.get("tools", [])]
        if "finish" in names:
            message = {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_m0_fixture",
                        "type": "function",
                        "function": {"name": "finish", "arguments": '{"message":"M0_DONE"}'},
                    }
                ],
            }
            reason = "tool_calls"
        else:
            message = {"role": "assistant", "content": "M0_DONE"}
            reason = "stop"
        response = {
            "id": "chatcmpl-m0-fixture",
            "object": "chat.completion",
            "created": 0,
            "model": "gpt-4o-mini",
            "choices": [{"index": 0, "message": message, "finish_reason": reason}],
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
            pass  # Expected when the interrupt probe cancels an in-flight request.


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 18080), Handler).serve_forever()

"""Owned loopback fixtures for the offline walkthrough; Python stdlib only.

The proxy is a local dispatcher, never a forwarding proxy: only a POST to the
exact owned upstream URL is handled locally. All other targets are rejected.
This constrains fixture HTTP traffic; it is not an operating-system sandbox.
"""

from collections import deque
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import select
import socket
import threading
import time


ERROR_CANARY = "synthetic-offline-upstream-error-canary"
_MAX_BODY = 256 * 1024
_MODELS = frozenset(("demo-text", "demo-tool", "demo-retry", "demo-error", "demo-cancel"))
_USAGE = {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8}
_TEXT = "Hello from the offline gateway."


def _invalid_json_constant(value):
    raise ValueError("non-finite JSON constant")


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def __init__(self, fixture, proxy=False):
        self.fixture = fixture
        self.proxy = proxy
        self.owned_lock = threading.Lock()
        self.owned_sockets = set()
        self.owned_threads = set()
        super().__init__(("127.0.0.1", 0), _Handler)

    def process_request(self, request, client_address):
        # Register before starting so close() cannot miss an accepted connection
        # whose handler thread has not been scheduled yet.
        thread = threading.Thread(target=self.process_request_thread,
                                  args=(request, client_address), daemon=True,
                                  name="offline-fixture-handler")
        with self.owned_lock:
            self.owned_sockets.add(request)
            self.owned_threads.add(thread)
        try:
            thread.start()
        except BaseException:
            with self.owned_lock:
                self.owned_sockets.discard(request)
                self.owned_threads.discard(thread)
            self.shutdown_request(request)
            raise

    def process_request_thread(self, request, client_address):
        thread = threading.current_thread()
        try:
            if not self.fixture._stopping.is_set():
                super().process_request_thread(request, client_address)
            else:
                self.shutdown_request(request)
        finally:
            with self.owned_lock:
                self.owned_sockets.discard(request)
                self.owned_threads.discard(thread)

    def handle_error(self, request, client_address):
        # Never leak request paths, bodies or exception payloads to stderr.
        pass

    def close_owned_connections(self, deadline):
        with self.owned_lock:
            sockets = tuple(self.owned_sockets)
            threads = tuple(self.owned_threads)
        for connection in sockets:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
        for thread in threads:
            thread.join(max(0, deadline - time.monotonic()))
        if any(thread.is_alive() for thread in threads):
            raise RuntimeError("offline fixture handler cleanup exceeded deadline")


class Fixture:
    """Context manager owning two ephemeral loopback HTTP listeners."""

    api_key = "synthetic-upstream-key"

    def __init__(self):
        self.cancel_seen = threading.Event()
        self._stopping = threading.Event()
        self._lock = threading.Lock()
        self._events = deque(maxlen=512)
        self._sequence = 0
        self._denied_count = 0
        self._servers = []
        self._threads = []
        self._entered = False
        self._closed = False
        self.base_url = ""
        self.proxy_url = ""

    def __enter__(self):
        if self._entered or self._closed:
            raise RuntimeError("offline fixture instances cannot be restarted")
        self._entered = True
        try:
            upstream = _Server(self)
            self._servers.append(upstream)
            self.base_url = f"http://127.0.0.1:{upstream.server_port}/v1"
            proxy = _Server(self, proxy=True)
            self._servers.append(proxy)
            self.proxy_url = f"http://127.0.0.1:{proxy.server_port}"
            for server in self._servers:
                thread = threading.Thread(target=server.serve_forever,
                                          kwargs={"poll_interval": .05}, daemon=True,
                                          name="offline-fixture-listener")
                thread.start()
                self._threads.append(thread)
            return self
        except BaseException:
            self.close()
            raise

    def __exit__(self, exc_type, exc, traceback):
        self.close()

    def close(self):
        """Stop only owned listeners/connections, with a shared two-second bound."""
        if self._closed:
            return
        self._closed = True
        self._stopping.set()
        deadline = time.monotonic() + 2
        # shutdown() is safe only for servers whose serve_forever thread started.
        for server in self._servers[:len(self._threads)]:
            server.shutdown()
        for server in self._servers:
            server.server_close()
            server.close_owned_connections(deadline)
        for thread in self._threads:
            thread.join(max(0, deadline - time.monotonic()))
        if any(thread.is_alive() for thread in self._threads):
            raise RuntimeError("offline fixture listener cleanup exceeded deadline")

    @property
    def denied_count(self):
        with self._lock:
            return self._denied_count

    def snapshot(self):
        """Return detached, bounded events containing only allowlisted metadata."""
        with self._lock:
            return [dict(event) for event in self._events]

    def _record(self, status, model="unknown", stream=False, denied=False):
        with self._lock:
            self._sequence += 1
            if denied:
                self._denied_count += 1
            self._events.append({"sequence": self._sequence,
                                 "kind": "proxy" if denied else "upstream",
                                 "model": model if model in _MODELS else "unknown",
                                 "stream": bool(stream), "status": status})


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def setup(self):
        self.request.settimeout(1)
        super().setup()

    def log_message(self, format, *args):
        pass

    def send_error(self, code, message=None, explain=None):
        # BaseHTTPRequestHandler otherwise reflects paths/methods into HTML.
        if self.server.proxy:
            self._reject(403, denied=True)
        else:
            self._reject(405 if code == 501 else code)

    def _reply(self, status, body):
        payload = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        if self.command != "HEAD":
            self.wfile.write(payload)
            self.wfile.flush()

    def _reject(self, status, model="unknown", stream=False, denied=False):
        self.server.fixture._record(status, model, stream, denied)
        self._reply(status, {"error": {"message": "synthetic fixture request rejected"}})

    def _dispatch(self):
        fixture = self.server.fixture
        if self.server.proxy:
            if self.command != "POST" or self.path != fixture.base_url + "/chat/completions":
                self._reject(403, denied=True)
                return
        elif self.command != "POST":
            self._reject(405)
            return
        elif self.path != "/v1/chat/completions":
            self._reject(404)
            return
        if not hmac.compare_digest(self.headers.get("Authorization", "").encode(),
                                   ("Bearer " + fixture.api_key).encode()):
            self._reject(401)
            return
        lengths = self.headers.get_all("Content-Length", [])
        if (self.headers.get("Transfer-Encoding") or len(lengths) != 1
                or not lengths[0].isascii() or not lengths[0].isdigit()):
            self._reject(400)
            return
        # Bound conversion too: arbitrarily long digit strings are invalid input.
        if len(lengths[0]) > 6:
            self._reject(413)
            return
        length = int(lengths[0])
        if length > _MAX_BODY:
            self._reject(413)
            return
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                self._reject(400)
                return
            body = json.loads(raw, parse_constant=_invalid_json_constant)
        except (ValueError, UnicodeError, RecursionError):
            self._reject(400)
            return
        except (TimeoutError, OSError):
            self._reject(408)
            return
        if not isinstance(body, dict):
            self._reject(400)
            return
        model, stream, messages = body.get("model"), body.get("stream", False), body.get("messages")
        if (not isinstance(model, str) or model not in _MODELS or not isinstance(stream, bool)
                or not isinstance(messages, list) or not messages
                or any(not isinstance(message, dict)
                       or message.get("role") not in ("user", "assistant", "system", "developer", "tool")
                       or (not isinstance(message.get("content"), (str, list))
                           and not (message.get("role") == "assistant" and message.get("content") is None))
                       for message in messages)):
            self._reject(400)
            return
        if "tools" in body and not isinstance(body["tools"], list):
            self._reject(400, model, stream)
            return
        if model == "demo-retry":
            self._reject(429, model, stream)
            return
        if model == "demo-error":
            fixture._record(400, model, stream)
            self._reply(400, {"error": {"message": ERROR_CANARY, "type": "synthetic_error"}})
            return
        text, tool = _TEXT, False
        if model == "demo-tool":
            returns = [message for message in messages if message["role"] == "tool"]
            if returns:
                if any(message.get("tool_call_id") != "call_demo_add" or message["content"] != "5"
                       for message in returns):
                    self._reject(400, model, stream)
                    return
                text = "Tool result: 5."
            else:
                if not any(isinstance(item, dict) and item.get("type") == "function"
                           and isinstance(item.get("function"), dict)
                           and item["function"].get("name") == "add" for item in body.get("tools", [])):
                    self._reject(400, model, stream)
                    return
                tool = True
        if model == "demo-cancel" and not stream:
            self._reject(400, model)
            return
        fixture._record(200, model, stream)
        if stream:
            self._stream(model, text, tool)
        else:
            message = {"role": "assistant", "content": text}
            if tool:
                message = {"role": "assistant", "content": None, "tool_calls": [{
                    "id": "call_demo_add", "type": "function",
                    "function": {"name": "add", "arguments": '{"a":2,"b":3}'}}]}
            self._reply(200, {"id": "chatcmpl-offline", "object": "chat.completion",
                              "created": 0, "model": model, "choices": [{"index": 0,
                                  "message": message, "finish_reason": "tool_calls" if tool else "stop"}],
                              "usage": dict(_USAGE)})

    def _chunk(self, model, delta=None, finish=None, usage=False):
        chunk = {"id": "chatcmpl-offline", "object": "chat.completion.chunk",
                 "created": 0, "model": model, "choices": [] if usage else [{
                     "index": 0, "delta": delta or {}, "finish_reason": finish}]}
        if usage:
            chunk["usage"] = dict(_USAGE)
        self.wfile.write(b"data: " + json.dumps(chunk, separators=(",", ":")).encode() + b"\n\n")
        self.wfile.flush()

    def _stream(self, model, text, tool):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        if model == "demo-cancel":
            self._cancel_stream(model)
            return
        self._chunk(model, {"role": "assistant"})
        if tool:
            self._chunk(model, {"tool_calls": [{"index": 0, "id": "call_demo_add", "type": "function",
                                                "function": {"name": "add", "arguments": ""}}]})
            for fragment in ('{"a":2,', '"b":3}'):
                self._chunk(model, {"tool_calls": [{"index": 0, "function": {"arguments": fragment}}]})
        else:
            middle = len(text) // 2
            for part in (text[:middle], text[middle:]):
                self._chunk(model, {"content": part})
        self._chunk(model, finish="tool_calls" if tool else "stop")
        self._chunk(model, usage=True)
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def _cancel_stream(self, model):
        fixture = self.server.fixture
        deadline = time.monotonic() + 30
        try:
            self._chunk(model, {"role": "assistant", "content": "Synthetic cancellation started."})
            while not fixture._stopping.is_set() and time.monotonic() < deadline:
                ready, _, _ = select.select([self.connection], [], [], .05)
                if fixture._stopping.is_set():
                    return
                if ready and self.connection.recv(1, socket.MSG_PEEK) == b"":
                    fixture.cancel_seen.set()
                    return
                self._chunk(model, {"content": ""})
        except TimeoutError:
            # A stalled write does not prove that the peer cancelled.
            return
        except OSError:
            if not fixture._stopping.is_set():
                fixture.cancel_seen.set()

    do_POST = _dispatch
    do_GET = _dispatch
    do_PUT = _dispatch
    do_PATCH = _dispatch
    do_DELETE = _dispatch
    do_HEAD = _dispatch
    do_OPTIONS = _dispatch
    do_CONNECT = _dispatch
    do_TRACE = _dispatch

"""Non-forwarding HTTP fixtures for existing named providers; no external client.

Both listeners serve locally. The proxy accepts only exact owned absolute URLs;
CONNECT, refresh and unknown destinations are rejected without DNS or forwarding.
This is an application fixture boundary, not an operating-system network sandbox.
"""
import hmac
import json
from pathlib import Path
import select
import socket
import threading
import time

from offline_fixture import Fixture as BaseFixture, _Server, _Handler as BaseHandler

PROVIDERS = ("siwc", "grok", "opencode")
MODELS = frozenset(("text", "tool", "retry", "failure", "failed_stream", "truncated",
                    "missing", "partial", "zero", "invalid", "borrowed", "cancel", "stall"))
TEXT = "Hello from the named HTTP fixture."
TOOL_TEXT = "Tool result: 5."
ERROR_CANARY = "synthetic-named-http-error-canary"
BORROWED_OLD = "synthetic-borrowed-old"
BORROWED_NEW = "synthetic-borrowed-new"


class Fixture(BaseFixture):
    api_key = "synthetic-named-http-token"

    def __init__(self):
        super().__init__()
        self.base_urls = {}
        self.borrowed_path = None
        self.closed_models = set()

    def __enter__(self):
        if self._entered or self._closed:
            raise RuntimeError("fixture_not_restartable")
        self._entered = True
        try:
            for proxy in (False, True):
                server = _Server(self, proxy=proxy)
                server.RequestHandlerClass = Handler
                self._servers.append(server)
                if proxy:
                    self.proxy_url = f"http://127.0.0.1:{server.server_port}"
                else:
                    self.base_urls = {provider: f"http://127.0.0.1:{server.server_port}/{provider}/v1"
                                      for provider in PROVIDERS}
                thread = threading.Thread(target=server.serve_forever,
                    kwargs={"poll_interval": .05}, daemon=True, name="named-http-fixture-listener")
                thread.start()
                self._threads.append(thread)
            return self
        except BaseException:
            self.close()
            raise

    def record(self, kind, provider="unknown", model="unknown", status=200, phase="none"):
        with self._lock:
            self._sequence += 1
            if kind == "denied":
                self._denied_count += 1
            self._events.append({"sequence": self._sequence, "kind": kind,
                "provider": provider if provider in PROVIDERS else "unknown",
                "model": model if model in MODELS else "unknown", "status": status,
                "tool_phase": phase if phase in ("call", "result") else "none"})

    def _record(self, status, model="unknown", stream=False, denied=False):
        self.record("denied" if denied else "rejected", model=model, status=status)

    def inference(self):
        return [event for event in self.snapshot() if event["kind"] == "inference"]

    def wait_closed(self, model, seconds=10):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            with self._lock:
                if model in self.closed_models:
                    return True
            self._stopping.wait(.02)
        return False

    def rotate_borrowed(self):
        path = self.borrowed_path
        if not isinstance(path, Path) or not path.is_absolute() or path.name != "auth.json" or path.parent.name != ".grok" or path.is_symlink():
            raise RuntimeError("borrowed_fixture_path")
        path.write_text(json.dumps({"synthetic": {"key": BORROWED_NEW}}))


class Handler(BaseHandler):
    def _dispatch(self):
        fixture = self.server.fixture
        accepted = {}
        for provider, base in fixture.base_urls.items():
            suffix = "/chat/completions" if provider == "opencode" else "/responses"
            for method, endpoint, kind in (("POST", suffix, "inference"), ("GET", "/models", "discovery")):
                url = base + endpoint if self.server.proxy else f"/{provider}/v1{endpoint}"
                accepted[(method, url)] = (provider, kind)
        target = accepted.get((self.command, self.path))
        if target is None:
            self._reject(403, denied=True)
            return
        provider, kind = target
        auth = self.headers.get("Authorization", "")
        valid = (fixture.api_key, BORROWED_OLD, BORROWED_NEW)
        if not any(hmac.compare_digest(auth.encode(), ("Bearer " + token).encode()) for token in valid):
            self._reject(401)
            return
        if kind == "discovery":
            fixture.record(kind, provider)
            self._reply(200, {"object": "list", "data": [{"id": "text", "object": "model"}]})
            return
        lengths = self.headers.get_all("Content-Length", [])
        if (self.headers.get("Transfer-Encoding") or len(lengths) != 1
                or not lengths[0].isascii() or not lengths[0].isdigit() or len(lengths[0]) > 6):
            self._reject(400)
            return
        length = int(lengths[0])
        if length > 256 * 1024:
            self._reject(413)
            return
        try:
            raw = self.rfile.read(length)
            body = json.loads(raw)
            if len(raw) != length or not isinstance(body, dict):
                raise ValueError()
        except (ValueError, UnicodeError, RecursionError, OSError):
            self._reject(400)
            return
        model = body.get("model")
        if model not in MODELS or body.get("stream") is not True:
            self._reject(400)
            return
        if provider == "siwc" and (body.get("store") is not False or "previous_response_id" in body):
            self._reject(400)
            return
        if model == "borrowed" and auth == "Bearer " + BORROWED_OLD:
            fixture.rotate_borrowed()
            fixture.record(kind, provider, model, 401)
            self._reply(401, {"error": {"message": "synthetic expired token"}})
            return
        if model in ("retry", "failure"):
            status = 429 if model == "retry" else 400
            fixture.record(kind, provider, model, status)
            self._reply(status, {"error": {"message": ERROR_CANARY}})
            return
        phase, text = "none", TEXT
        if model == "tool":
            items = body.get("messages" if provider == "opencode" else "input", [])
            returns = [item for item in items if isinstance(item, dict) and
                       (item.get("role") == "tool" or item.get("type") == "function_call_output")]
            if returns:
                if any(item.get("tool_call_id", item.get("call_id")) != "call_demo_add" or
                       item.get("content", item.get("output")) != "5" for item in returns):
                    self._reject(400)
                    return
                phase, text = "result", TOOL_TEXT
            else:
                tools = body.get("tools", [])
                if provider == "siwc":
                    tools = [tool for namespace in tools if namespace.get("type") == "namespace"
                             for tool in namespace.get("tools", [])]
                if not any(tool.get("name", tool.get("function", {}).get("name")) == "add" for tool in tools):
                    self._reject(400)
                    return
                phase = "call"
        fixture.record(kind, provider, model, phase=phase)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        frames = make_frames(provider, model, text, phase)
        for frame in frames:
            self.wfile.write(frame)
            self.wfile.flush()
        if model in ("cancel", "stall"):
            self._wait_disconnect(model)

    def _wait_disconnect(self, model):
        fixture = self.server.fixture
        deadline = time.monotonic() + 20
        try:
            while not fixture._stopping.is_set() and time.monotonic() < deadline:
                ready, _, _ = select.select([self.connection], [], [], .05)
                if ready and self.connection.recv(1, socket.MSG_PEEK) == b"":
                    with fixture._lock:
                        fixture.closed_models.add(model)
                    return
        except OSError:
            if not fixture._stopping.is_set():
                with fixture._lock:
                    fixture.closed_models.add(model)

    do_POST = _dispatch
    do_GET = _dispatch
    do_PUT = _dispatch
    do_PATCH = _dispatch
    do_DELETE = _dispatch
    do_HEAD = _dispatch
    do_OPTIONS = _dispatch
    do_CONNECT = _dispatch
    do_TRACE = _dispatch


def make_frames(provider, model, text=TEXT, phase="none"):
    """Fixed synthetic wire data; no callbacks or network access."""
    chat = provider == "opencode"
    usage = {"prompt_tokens" if chat else "input_tokens": 11,
             "completion_tokens" if chat else "output_tokens": 7}
    if model == "missing":
        usage = None
    elif model == "partial":
        usage.pop("prompt_tokens" if chat else "input_tokens")
    elif model == "zero":
        usage = {key: 0 for key in usage}
    elif model == "invalid":
        usage["prompt_tokens" if chat else "input_tokens"] = -1
    frames = []
    def emit(value):
        event = "" if chat else "event: " + value["type"] + "\n"
        frames.append((event + "data: " + json.dumps(value, separators=(",", ":")) + "\n\n").encode())
    def chunk(delta=None, finish=None, counts=None):
        value = {"id": "chatcmpl-synthetic", "object": "chat.completion.chunk", "created": 0,
                 "model": model, "choices": [] if counts is not None else [{"index": 0,
                 "delta": delta or {}, "finish_reason": finish}]}
        if counts is not None:
            value["usage"] = counts
        emit(value)
    call = {"type": "function_call", "id": "fc_synthetic", "call_id": "call_demo_add",
            "name": "add", "arguments": '{"a":2,"b":3}'}
    if chat:
        chunk({"role": "assistant"})
        if phase == "call":
            chunk({"tool_calls": [{"index": 0, "id": call["call_id"], "type": "function",
                   "function": {"name": "add", "arguments": ""}}]})
            for part in ('{"a":2,', '"b":3}'):
                chunk({"tool_calls": [{"index": 0, "function": {"arguments": part}}]})
        else:
            chunk({"content": text})
        if model not in ("cancel", "stall", "truncated"):
            if model == "failed_stream":
                emit({"error": {"message": ERROR_CANARY}})
            else:
                chunk(finish="tool_calls" if phase == "call" else "stop")
                if usage is not None:
                    chunk(counts=usage)
                    chunk(counts=usage)  # Repeated cumulative tail must not be added.
                frames.append(b"data: [DONE]\n\n")
    else:
        emit({"type": "response.created", "response": {"id": "resp_synthetic", "model": model, "status": "in_progress"}})
        if phase == "call":
            emit({"type": "response.output_item.added", "output_index": 0, "item": {**call, "arguments": ""}})
            for part in ('{"a":2,', '"b":3}'):
                emit({"type": "response.function_call_arguments.delta", "item_id": call["id"], "output_index": 0, "delta": part})
            emit({"type": "response.output_item.done", "output_index": 0, "item": call})
            output = [call]
        else:
            emit({"type": "response.output_text.delta", "output_index": 0, "content_index": 0, "item_id": "msg_synthetic", "delta": text})
            output = [{"type": "message", "id": "msg_synthetic", "role": "assistant",
                       "content": [{"type": "output_text", "text": text}]}]
        if model not in ("cancel", "stall", "truncated"):
            status = "failed" if model == "failed_stream" else "completed"
            response = {"id": "resp_synthetic", "model": model, "status": status, "output": output}
            if usage is not None:
                response["usage"] = usage
            if status == "failed":
                response["error"] = {"message": ERROR_CANARY, "code": "synthetic_error"}
            emit({"type": "response." + status, "response": response})
    return frames

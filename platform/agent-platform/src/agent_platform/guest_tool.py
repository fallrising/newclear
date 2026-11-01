"""Private, fail-closed tool mailbox; isolated stdlib helper, with no outbound I/O.

The local socket admits only the terminal UID. Its result requires an ACK on the
same socket, followed by the trusted host's broker ACK. Neither credentials nor
results are persisted. A process restart always requires a new run.
"""

import hashlib
import hmac
import json
import os
import re
import resource
import socket
import socketserver
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from uuid import UUID, uuid4

MAX_REQUEST = 32768
MAX_RESULT = 1048576
MAX_CONTROL = MAX_RESULT + 2048
SOCKET_PATH = "/var/lib/agent-platform/tools/request.sock"
IDENTITY = {"instance_id", "run_id", "binding_id", "generation"}


def encode(value):
    return json.dumps(value, allow_nan=False, separators=(",", ":"), sort_keys=True).encode()


def decode(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError()
            result[key] = value
        return result

    def constant(_):
        raise ValueError()

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def uuid(value):
    try:
        return type(value) is str and str(UUID(value)) == value
    except ValueError:
        return False


def valid_identity(data):
    return (
        type(data) is dict
        and all(uuid(data.get(key)) for key in ("instance_id", "run_id", "binding_id"))
        and type(data.get("generation")) is int
        and 0 < data["generation"] < 2**63
    )


def valid_payload(data):
    if type(data) is not dict or len(encode(data)) > MAX_REQUEST:
        return False
    operation = data.get("operation")
    fields = {"operation", "repository_id"}
    if operation == "github.issue.get":
        fields.add("issue_number")
        if type(data.get("issue_number")) is not int or not 0 < data["issue_number"] < 2**63:
            return False
    elif operation == "github.file.get":
        fields.update(("commit", "path"))
        path = data.get("path")
        commit = data.get("commit")
        if (
            type(commit) is not str
            or not re.fullmatch(r"[0-9a-f]{40}", commit)
            or type(path) is not str
            or not 0 < len(path) <= 1024
            or not 1 <= len(path.split("/")) <= 4
            or not all(part and part not in (".", "..") for part in path.split("/"))
            or any(not char.isprintable() or char in "\\%?#" for char in path)
            or any(0xD800 <= ord(char) <= 0xDFFF for char in path)
        ):
            return False
    elif operation != "github.repository.get":
        return False
    return (
        set(data) == fields
        and type(data.get("repository_id")) is int
        and 0 < data["repository_id"] < 2**63
    )


def failure(code="tool_mailbox_closed", status=409):
    return status, {"error": code}


class Mailbox:
    def __init__(self, root, run_id, relay_key, *, timeout=15):
        if not uuid(run_id) or type(relay_key) is not str or not 32 <= len(relay_key) <= 128:
            raise ValueError("tool_configuration_invalid")
        if not 0 < timeout <= 15:
            raise ValueError("tool_configuration_invalid")
        self.path = Path(root) / "tool-mailbox.json"
        self.run_id, self.relay_key, self.timeout = run_id, relay_key, timeout
        self.instance_id = str(uuid4())
        self.condition = threading.Condition()
        self.binding = self.pending = self.result = self.receipt = None
        self.consumed = False
        self.deadline = None
        self.seen = set()
        # O_EXCL ensures two helpers cannot both accept the same private mailbox.
        try:
            fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            self.blocked = True
        else:
            self.blocked = False
            with os.fdopen(fd, "wb") as stream:
                stream.write(encode({"instance_id": self.instance_id, "state": "started"}))
                stream.flush()
                os.fsync(stream.fileno())
            self.sync_directory()

    def sync_directory(self):
        fd = os.open(self.path.parent, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def persist(self, state):
        value = {"instance_id": self.instance_id, "state": state}
        if self.pending:
            value["operation_id"] = self.pending["operation_id"]
        try:
            temporary = self.path.with_suffix(".tmp")
            with temporary.open("wb") as stream:
                os.chmod(temporary, 0o600)
                stream.write(encode(value))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            self.sync_directory()
        except OSError:
            # Never accept a retry after an uncertain durable state transition.
            with self.condition:
                self.blocked = True
                self.result = self.receipt = None
                self.condition.notify_all()
            raise

    def block(self):
        with self.condition:
            self.blocked = True
            self.result = self.receipt = None
            self.condition.notify_all()
            self.persist("closed")

    def expired(self):
        if not self.blocked and self.deadline is not None and time.monotonic() >= self.deadline:
            self.block()
        return self.blocked

    def matches(self, data):
        return (
            valid_identity(data)
            and self.binding is not None
            and all(data[key] == self.binding[key] for key in IDENTITY)
        )

    def bind(self, data):
        with self.condition:
            if type(data) is not dict or set(data) != IDENTITY or not valid_identity(data):
                return failure("tool_input_invalid", 422)
            if self.expired():
                return failure()
            if data["instance_id"] != self.instance_id or data["run_id"] != self.run_id:
                return failure("tool_identity_mismatch")
            if self.binding is not None and data != self.binding:
                return failure("tool_identity_mismatch")
            self.binding = data.copy()
            self.persist("bound")
            return 200, self.binding.copy()

    def take(self):
        with self.condition:
            if self.expired():
                return failure()
            ack = None
            if self.consumed:
                ack = {
                    **self.binding,
                    "operation_id": self.pending["operation_id"],
                    "receipt": self.receipt,
                }
            return 200, {
                "instance_id": self.instance_id,
                "pending": None if self.consumed else self.pending,
                "ack": ack,
            }

    def deliver(self, data):
        with self.condition:
            if (
                type(data) is not dict
                or set(data) != IDENTITY | {"operation_id", "result", "receipt"}
                or not uuid(data.get("operation_id"))
                or type(data.get("receipt")) is not str
                or not re.fullmatch(r"[A-Za-z0-9_-]{43}", data["receipt"])
                or type(data.get("result")) is not dict
                or len(encode(data["result"])) > MAX_RESULT
            ):
                return failure("tool_input_invalid", 422)
            if self.expired():
                return failure()
            if not self.matches(data):
                return failure("tool_identity_mismatch")
            if (
                not self.pending
                or data["operation_id"] != self.pending["operation_id"]
                or self.receipt is not None
            ):
                return failure("tool_delivery_uncertain")
            self.persist("delivered")
            self.result, self.receipt = data["result"], data["receipt"]
            self.condition.notify_all()
            return 200, {"accepted": True}

    def acknowledge(self, data):
        with self.condition:
            if type(data) is not dict or set(data) != IDENTITY | {"operation_id"}:
                return failure("tool_input_invalid", 422)
            if self.expired():
                return failure()
            if not self.matches(data):
                return failure("tool_identity_mismatch")
            if not self.consumed or data["operation_id"] != self.pending["operation_id"]:
                return failure("tool_ack_uncertain")
            self.persist("acknowledged")
            self.pending = self.result = self.receipt = self.deadline = None
            self.consumed = False
            return 200, {"accepted": True}

    def close(self, data):
        with self.condition:
            if type(data) is not dict or set(data) != IDENTITY:
                return failure("tool_input_invalid", 422)
            if not self.matches(data):
                return failure("tool_identity_mismatch")
            self.block()
            return 200, {"closed": True}

    def admit(self, payload):
        with self.condition:
            if not valid_payload(payload):
                return failure("tool_request_invalid", 422)
            if self.expired() or self.binding is None:
                return failure()
            if self.pending:
                return failure("tool_mailbox_busy")
            digest = hashlib.sha256(encode(payload)).hexdigest()
            if digest in self.seen:
                return failure("tool_request_repeated")
            if len(self.seen) >= 100:
                return failure("tool_request_limit")
            self.pending = {**self.binding, "operation_id": str(uuid4()), "payload": payload}
            self.seen.add(digest)
            self.deadline = time.monotonic() + self.timeout
            self.persist("waiting")
            while self.result is None and not self.expired():
                self.condition.wait(max(0, self.deadline - time.monotonic()))
            if self.blocked:
                return failure()
            return 200, {"operation_id": self.pending["operation_id"], "result": self.result}

    def consumed_ack(self, data, operation_id):
        with self.condition:
            if (
                self.expired()
                or data != {"ack": operation_id}
                or not self.pending
                or self.pending["operation_id"] != operation_id
                or self.result is None
                or self.consumed
            ):
                self.block()
                return
            self.persist("consumed")
            self.consumed, self.result = True, None


def receive(conn, limit, deadline):
    raw = bytearray()
    while len(raw) <= limit:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError()
        conn.settimeout(remaining)
        chunk = conn.recv(min(65536, limit + 1 - len(raw)))
        if not chunk:
            raise ValueError()
        raw.extend(chunk)
        if b"\n" in chunk:
            if not raw.endswith(b"\n") or b"\n" in raw[:-1] or len(raw) > limit:
                raise ValueError()
            return decode(raw)
    raise ValueError()


class BoundedThreads(socketserver.ThreadingMixIn):
    daemon_threads = True
    block_on_close = False

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def handle_error(self, request, client_address):
        # Never send exception strings, request data or credentials to stderr.
        pass


def local_server(mailbox, path, *, terminal_uid=2000):
    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            admitted = False
            try:
                _, uid, _ = struct.unpack(
                    "3i", self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
                )
                if uid != terminal_uid:
                    self.request.sendall(encode({"error": "tool_identity_denied"}) + b"\n")
                    return
                payload = receive(self.request, MAX_REQUEST, time.monotonic() + mailbox.timeout)
                status, response = mailbox.admit(payload)
                admitted = status == 200
                if admitted:
                    self.request.settimeout(max(0.001, mailbox.deadline - time.monotonic()))
                self.request.sendall(encode(response) + b"\n")
                if admitted:
                    ack = receive(self.request, 128, mailbox.deadline)
                    mailbox.consumed_ack(ack, response["operation_id"])
            except (OSError, ValueError, TypeError, RecursionError):
                if admitted:
                    mailbox.block()
                try:
                    self.request.sendall(encode({"error": "tool_request_invalid"}) + b"\n")
                except OSError:
                    pass

    class Local(BoundedThreads, socketserver.UnixStreamServer):
        slots = threading.BoundedSemaphore(4)

    service = Local(str(path), Handler)
    os.chmod(path, 0o666)
    return service


def server(mailbox, port=18081):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def handle(self):
            self.mutated = False

            # Absolute bound includes slow HTTP headers as well as body parsing.
            def expire():
                try:
                    self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

            timer = threading.Timer(5, expire)
            timer.daemon = True
            timer.start()
            self.connection.settimeout(5)
            try:
                super().handle()
            finally:
                timer.cancel()

        def reply(self, status, value):
            raw = encode(value)
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(raw)
            except OSError:
                # Unauthenticated disconnects cannot close an authorized channel.
                if self.mutated:
                    mailbox.block()

        def send_error(self, code, message=None, explain=None):
            self.reply(*failure("tool_input_invalid", code))

        def do_GET(self):
            self.dispatch(False)

        def do_POST(self):
            self.dispatch(True)

        def dispatch(self, post):
            self.mutated = False
            try:
                if (
                    any(
                        self.headers.get_all(key)
                        for key in ("Origin", "Cookie", "Content-Encoding", "Transfer-Encoding")
                    )
                    or "?" in self.path
                ):
                    self.reply(*failure("tool_transport_forbidden", 403))
                    return
                keys = self.headers.get_all("X-Session-API-Key") or []
                if len(keys) != 1 or not hmac.compare_digest(keys[0], mailbox.relay_key):
                    self.reply(*failure("tool_authentication_required", 401))
                    return
                data = None
                sizes = self.headers.get_all("Content-Length") or []
                if post:
                    if len(sizes) != 1 or self.headers.get_content_type() != "application/json":
                        raise ValueError()
                    size = int(sizes[0])
                    limit = MAX_CONTROL if self.path == "/response" else MAX_REQUEST
                    if not 0 < size <= limit:
                        raise ValueError()
                    raw = self.rfile.read(size)
                    if len(raw) != size:
                        raise ValueError()
                    data = decode(raw)
                elif sizes and sizes != ["0"]:
                    raise ValueError()
                if self.path == "/mailbox" and not post:
                    answer = mailbox.take()
                elif post and self.path in ("/bind", "/response", "/ack", "/close"):
                    method = {
                        "/bind": mailbox.bind,
                        "/response": mailbox.deliver,
                        "/ack": mailbox.acknowledge,
                        "/close": mailbox.close,
                    }[self.path]
                    answer = method(data)
                    self.mutated = answer[0] == 200
                else:
                    answer = failure("tool_route_missing", 404)
                self.reply(*answer)
            except (ValueError, TypeError, KeyError, RecursionError, OSError):
                self.reply(*failure("tool_input_invalid", 422))

    class Control(BoundedThreads, HTTPServer):
        slots = threading.BoundedSemaphore(4)

    return Control(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    if os.getuid() != 2001:
        raise SystemExit("tool_control_identity_required")
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    directory = Path(SOCKET_PATH).parent.stat()
    if directory.st_uid != 2001 or directory.st_gid != 2001 or directory.st_mode & 0o777 != 0o755:
        raise SystemExit("tool_socket_directory_invalid")
    mailbox = Mailbox(
        "/var/lib/agent-platform/control", os.environ["TOOL_RUN_ID"], os.environ["TOOL_RELAY_KEY"]
    )
    os.environ.clear()
    local = local_server(mailbox, SOCKET_PATH)
    threading.Thread(target=local.serve_forever, daemon=True).start()
    server(mailbox).serve_forever()

"""Guest-only authenticated mailbox. No outbound connection or model implementation.

Executed under UID 2001 with isolated Python. SDK retries and process restarts
cannot turn an uncertain request into a new upstream dispatch.
"""

import hashlib
import hmac
import json
import os
import resource
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

MAXIMUM = 256 * 1024


class Mailbox:
    def __init__(self, root, run_id, local_key, relay_key):
        self.path = Path(root) / "model-mailbox.json"
        self.run_id, self.local_key, self.relay_key = run_id, local_key, relay_key
        self.condition = threading.Condition()
        self.token, self.generation, self.revision = None, 0, 0
        self.pending, self.result = None, None
        self.seen = set()
        self.blocked = self.path.exists()  # Restart requires reconciliation, never replay.

    def persist(self, value):
        temporary = self.path.with_suffix(".tmp")
        with temporary.open("w") as stream:
            os.chmod(temporary, 0o600)
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.path)
        fd = os.open(self.path.parent, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def update(self, data):
        with self.condition:
            generation, revision = data["generation"], data["revision"]
            if (generation, revision) < (self.generation, self.revision):
                return 409, {"error": "model_credential_stale"}
            if (generation, revision) == (self.generation, self.revision):
                if self.token != data["token"]:
                    return 409, {"error": "model_credential_conflict"}
            self.token, self.generation, self.revision = data["token"], generation, revision
            self.condition.notify_all()
            return 200, {"generation": generation, "revision": revision}

    def take(self):
        with self.condition:
            if self.blocked:
                return 409, {"error": "model_mailbox_uncertain"}
            if not self.pending:
                return 200, {"pending": None}
            # Token is attached at fetch time. An unreserved request may move to a
            # new generation; the SQL ledger rejects every already reserved ID.
            return 200, {
                "pending": {**self.pending, "token": self.token, "generation": self.generation}
            }

    def deliver(self, data):
        with self.condition:
            if (
                self.blocked
                or not self.pending
                or self.result is not None
                or data["request_id"] != self.pending["request_id"]
                or data["generation"] != self.generation
            ):
                return 409, {"error": "model_delivery_uncertain"}
            self.persist({"request_id": data["request_id"], "state": "delivered"})
            self.result = data["response"]
            self.condition.notify_all()
            return 200, {"accepted": True}

    def complete(self, payload):
        with self.condition:
            digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
            deadline = time.monotonic() + 120
            while not self.token and not self.blocked and time.monotonic() < deadline:
                self.condition.wait(0.5)
            if not self.token or self.blocked:
                return 409, {"error": {"message": "model_transport_unavailable"}}
            # The credential wait releases the lock. Recheck admission afterwards
            # so concurrent SDK requests cannot overwrite a waiting request UUID.
            if self.pending or digest in self.seen or len(self.seen) >= 100:
                return 409, {
                    "error": {"message": "model_mailbox_closed", "type": "invalid_request_error"}
                }
            self.pending = {"request_id": str(uuid4()), "run_id": self.run_id, "payload": payload}
            self.seen.add(digest)
            self.persist({**self.pending, "state": "waiting"})
            while self.result is None and not self.blocked and time.monotonic() < deadline:
                self.condition.wait(0.5)
            if self.result is None:
                self.blocked = True
                self.persist({"state": "uncertain", "request_id": self.pending["request_id"]})
                return 409, {"error": {"message": "model_dispatch_uncertain"}}
            result = self.result
            self.pending, self.result = None, None
            return 200, result


def server(mailbox, port=18080):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def handle_one_request(self):
            self.connection.settimeout(130)
            super().handle_one_request()

        def reply(self, status, value):
            raw = json.dumps(value, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(raw)
            except OSError:
                # A missing SDK reply is never safe to regenerate under a new ID.
                with mailbox.condition:
                    mailbox.blocked = True

        def do_GET(self):
            self.dispatch(False)

        def do_POST(self):
            self.dispatch(True)

        def dispatch(self, post):
            try:
                if self.headers.get("Origin") is not None or self.headers.get("Cookie") is not None:
                    self.reply(403, {"error": "model_transport_forbidden"})
                    return
                sdk = self.path == "/v1/chat/completions"
                header = "Authorization" if sdk else "X-Session-API-Key"
                expected = "Bearer " + mailbox.local_key if sdk else mailbox.relay_key
                values = self.headers.get_all(header) or []
                if len(values) != 1 or not hmac.compare_digest(values[0], expected):
                    self.reply(401, {"error": "model_authentication_required"})
                    return
                data = None
                if post:
                    sizes = self.headers.get_all("Content-Length") or []
                    if (
                        len(sizes) != 1
                        or self.headers.get("Transfer-Encoding")
                        or self.headers.get_content_type() != "application/json"
                    ):
                        raise ValueError()
                    size = int(sizes[0])
                    if not 0 < size <= MAXIMUM:
                        raise ValueError()
                    data = json.loads(self.rfile.read(size))
                if sdk and post:
                    status, value = mailbox.complete(data)
                elif self.path == "/mailbox" and not post:
                    status, value = mailbox.take()
                elif self.path == "/credential" and post:
                    if (
                        set(data) != {"generation", "revision", "token"}
                        or type(data["generation"]) is not int
                        or data["generation"] < 1
                        or type(data["revision"]) is not int
                        or data["revision"] < 1
                        or not isinstance(data["token"], str)
                        or len(data["token"]) != 47
                    ):
                        raise ValueError()
                    status, value = mailbox.update(data)
                elif self.path == "/response" and post:
                    if set(data) != {"request_id", "generation", "response"}:
                        raise ValueError()
                    status, value = mailbox.deliver(data)
                else:
                    status, value = 404, {"error": "model_route_missing"}
                self.reply(status, value)
            except (ValueError, TypeError, KeyError, RecursionError, OSError):
                self.reply(422, {"error": "model_input_invalid"})

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    if os.getuid() != 2001:
        raise SystemExit("model_control_identity_required")
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    model = Mailbox(
        "/var/lib/agent-platform/control",
        os.environ["MODEL_RUN_ID"],
        os.environ["MODEL_LOCAL_KEY"],
        os.environ["MODEL_RELAY_KEY"],
    )
    # No ambient credentials/proxy settings are needed by this server.
    os.environ.clear()
    server(model).serve_forever()

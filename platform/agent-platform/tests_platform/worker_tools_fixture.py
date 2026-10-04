"""Local HTTP boundary doubles; no VM, SDK process, or external service."""

import json
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4

from agent_platform.connector_recovery import STOP_KEYS
from agent_platform.runtime_client import RuntimeClient


class HTTPFixture:
    def __init__(self, handle):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def dispatch(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                status, value = handle(
                    self.command, self.path, json.loads(body) if body else None, self.headers
                )
                encoded = json.dumps(value).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            do_GET = do_POST = do_PUT = dispatch

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)


class Upstream(HTTPFixture):
    def __init__(self):
        self.calls = []
        self.on_request = None
        self.secret = "worker-tools-synthetic-secret"
        super().__init__(self.handle)

    def handle(self, method, path, body, headers):
        self.calls.append((method, path, headers.get("Authorization")))
        if self.on_request:
            self.on_request()
        return 200, {"id": 123, "full_name": "fallrising/newclear", "private": False}


class Runtime(HTTPFixture):
    def __init__(self, repo, base_sha):
        self.repo, self.base_sha = repo, base_sha
        self.calls, self.allocations = [], []
        self.identity, self.pending, self.ack = None, None, None
        self.delivered = None
        self.fail_action = None
        self.complete_stop = True
        self.unconfirmed_cleanup = False
        self.on_ack, self.on_events, self.on_poll = None, None, None
        self.phase = "absent"
        self.result = {
            "execution_mode": "cocoon-fixture",
            "diff_sha256": "f" * 64,
            "verification": {"status": "passed"},
            "diff": "fixture result",
        }
        super().__init__(self.handle)
        self.client = RuntimeClient(self.origin, "fixture-connector-token")

    def handle(self, method, path, body, headers):
        self.calls.append((method, path, body))
        action = body.get("action") if body else None
        if path == "/v1/catalog":
            return 200, {
                "egress_policy_sha256": "b" * 64,
                "template_digest": "fixture@sha256:" + "a" * 64,
                "repositories": [{"canonical_repo": self.repo, "base_sha": self.base_sha}],
            }
        if path.endswith("/lease"):
            return 200, {"accepted": True}
        if path.endswith("/cancel") or action == "release":
            if self.unconfirmed_cleanup:
                return 503, {"error": "cleanup uncertain"}
            if self.phase == "absent":
                return 200, {
                    "observed_state": "not_allocated",
                    "proof": {"no_allocation_intent": True},
                }
            self.phase = "stopped"
            return 200, {
                "observed_state": "stopped",
                "proof": {key: self.complete_stop for key in STOP_KEYS},
            }
        if "/events?" in path:
            if self.on_events:
                return 200, self.on_events()
            return 200, {
                "state": "finished" if self.delivered or not self.enabled else "running",
                "caught_up": True,
                "events": [],
            }
        if path.endswith("/tool"):
            if action == self.fail_action:
                return 503, {"private": "untrusted error containing secrets"}
            if action == "bind":
                self.identity = {
                    "instance_id": str(uuid4()),
                    "run_id": path.split("/")[3],
                    "binding_id": body["binding_id"],
                    "generation": body["generation"],
                }
                return 200, self.identity
            if action == "poll":
                if self.on_poll:
                    self.on_poll()
                return 200, {
                    "instance_id": self.identity["instance_id"],
                    "pending": self.pending,
                    "ack": self.ack,
                }
            if action == "deliver":
                self.delivered = body
                self.ack = {
                    **self.identity,
                    "operation_id": body["operation_id"],
                    "receipt": body["receipt"],
                }
                self.pending = None
                return 200, {"accepted": True}
            if action == "ack":
                if self.on_ack:
                    self.on_ack()
                self.ack = None
                return 200, {"accepted": True}
            if action == "close":
                return 200, {"closed": True}
        if action == "prepare":
            self.prepared = {"ref": path.split("/")[3], "base_sha": self.base_sha}
            self.phase = "prepared"
            return 200, self.prepared
        if action == "prompt":
            self.phase = "running"
            if self.enabled:
                if self.identity is None:
                    return 409, {"error": "bind must precede prompt"}
                self.pending = {
                    **self.identity,
                    "operation_id": str(uuid4()),
                    "payload": {"operation": "github.repository.get", "repository_id": 123},
                }
            return 200, {"accepted": True}
        if action == "result":
            self.phase = "result"
            return 200, self.result
        if method == "POST":
            self.allocations.append(body)
            self.enabled = body.get("tool_transport", False)
            self.identity, self.pending, self.ack, self.delivered = None, None, None, None
            self.allocation = {
                "handle": "fixture-sandbox-" + path.split("/")[3],
                "vm_id": "fixture-vm-" + path.split("/")[3],
                "lease_deadline": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
            }
            self.phase = "allocated"
            return 200, self.allocation
        return 200, {
            "phase": self.phase,
            "allocation": getattr(self, "allocation", None),
            "prepared": getattr(self, "prepared", None),
            "result": self.result if self.phase in {"result", "stopped"} else None,
            "stop": {"observed_state": "stopped", "proof": dict.fromkeys(STOP_KEYS, True)},
        }

    def actions(self, suffix):
        return [body["action"] for _, path, body in self.calls if path.endswith(suffix)]

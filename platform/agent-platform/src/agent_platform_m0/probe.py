"""Real Agent Server contract checks, independent of its container lifecycle."""

import hashlib
import json
import socket
import time
import uuid
from urllib.parse import urlencode, urlsplit

from websockets.sync.client import connect

from .contracts import OPENHANDS_SHA, OPENHANDS_VERSION, REQUIRED_ROUTES
from .events import Journal
from .transport import HTTP, ProbeError


def wait_ready(http: HTTP, seconds: float = 90):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            status, body = http.request("GET", "/ready", auth=False)
            if status == 200 and body.get("status") == "ready":
                return
        except ProbeError as exc:
            if str(exc) != "transport_unavailable":
                raise
        time.sleep(0.2)
    raise ProbeError("ready_deadline_exceeded")


def validate_schema(schema: dict) -> str:
    for path, methods in REQUIRED_ROUTES.items():
        if any(method not in schema.get("paths", {}).get(path, {}) for method in methods):
            raise ProbeError("openapi_contract_mismatch")
    return hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest()


class Probe:
    def __init__(self, http: HTTP, journal: Journal, report: dict):
        self.http, self.journal, self.report = http, journal, report
        self.conversation_id = str(uuid.uuid4())
        self.path = f"/api/conversations/{self.conversation_id}"

    def passed(self, name):
        self.report["checks"][name] = "passed"

    def check_server(self):
        wait_ready(self.http)
        self.passed("ready")
        status, _ = self.http.request("GET", self.path, auth=False)
        if status not in (401, 403):
            raise ProbeError("unauthenticated_rest_not_rejected")
        self.passed("rest_auth_required")
        info = self.http.expect("GET", "/server_info")
        if info.get("build_git_sha") != OPENHANDS_SHA or info.get("version") != OPENHANDS_VERSION:
            raise ProbeError("server_revision_mismatch")
        self.report["observed_server"] = {
            key: info.get(key) for key in ("version", "sdk_version", "build_git_sha")
        }
        self.passed("pinned_server_revision")
        schema = self.http.expect("GET", "/openapi.json")
        self.report["openapi_sha256"] = validate_schema(schema)
        self.passed("openapi_routes")

    def create(self):
        request = {
            "conversation_id": self.conversation_id,
            "workspace": {"kind": "LocalWorkspace", "working_dir": "/tmp/m0-workspace"},
            "agent": {
                "kind": "Agent",
                "llm": {
                    "model": "openai/gpt-4o-mini",
                    "base_url": "http://127.0.0.1:18080/v1",
                    "api_key": "m0-fixture-not-a-provider-key",
                    "stream": False,
                    "num_retries": 0,
                },
                "tools": [],
            },
            "max_iterations": 4,
            "autotitle": False,
        }
        result = self.http.expect("POST", "/api/conversations", request, codes=(200, 201))
        if result.get("id") != self.conversation_id:
            raise ProbeError("conversation_id_mismatch")
        self.passed("create_conversation")

    def status(self):
        return self.http.expect("GET", self.path)["execution_status"]

    def wait_status(self, desired, seconds=35):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            actual = self.status()
            if actual == desired:
                return
            if actual in {"error", "stuck"}:
                raise ProbeError(f"conversation_{actual}")
            time.sleep(0.1)
        raise ProbeError(f"status_deadline_{desired}")

    def message(self, text):
        self.http.expect(
            "POST",
            self.path + "/events",
            {
                "role": "user",
                "content": [{"type": "text", "text": text}],
                "run": False,
            },
        )

    def events(self):
        events, page_id, seen_pages = [], None, set()
        for _ in range(100):
            query = {"limit": 100}
            if page_id:
                query["page_id"] = page_id
            page = self.http.expect("GET", self.path + "/events/search?" + urlencode(query))
            events.extend(page["items"])
            page_id = page.get("next_page_id")
            if not page_id:
                return events
            if page_id in seen_pages:
                raise ProbeError("event_pagination_cycle")
            seen_pages.add(page_id)
        raise ProbeError("event_pagination_limit")

    def replay(self, expected_events):
        expected = {event["id"] for event in expected_events}
        if not expected:
            raise ProbeError("no_events_to_replay")
        origin = self.http.origin.replace("http", "ws", 1)
        url = f"{origin}/sockets/events/{self.conversation_id}?resend_mode=all"
        first_frame = True
        deadline = time.monotonic() + 20
        parsed = urlsplit(url)
        # A supplied socket makes websockets reject redirects before sending the auth frame.
        # TLS is still negotiated and certificate-verified by connect() for wss origins.
        with socket.create_connection(
            (parsed.hostname, parsed.port or (443 if parsed.scheme == "wss" else 80)),
            timeout=10,
        ) as raw_socket:
            raw_socket.settimeout(None)
            with connect(
                url,
                sock=raw_socket,
                proxy=None,
                open_timeout=10,
                close_timeout=2,
                max_size=8 * 1024 * 1024,
            ) as ws:
                ws.send(json.dumps({"type": "auth", "session_api_key": self.http.token}))
                while expected:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ProbeError("websocket_replay_deadline")
                    event = json.loads(ws.recv(timeout=remaining))
                    # Upstream pushes one ephemeral full-state snapshot on each subscribe.
                    # It has a fresh id and is not part of REST history. Do not journal it.
                    if (
                        first_frame
                        and event.get("id") not in expected
                        and event.get("kind") == "ConversationStateUpdateEvent"
                        and event.get("key") == "full_state"
                    ):
                        first_frame = False
                        self.report["subscription_snapshots"] = (
                            self.report.get("subscription_snapshots", 0) + 1
                        )
                        continue
                    first_frame = False
                    self.journal.append(event)
                    expected.discard(event["id"])

    def lifecycle(self):
        self.message("M0_FIRST")
        if self.status() != "idle":
            raise ProbeError("message_unexpectedly_started_agent")
        self.passed("message_does_not_autorun")
        self.http.expect("POST", self.path + "/run")
        self.wait_status("finished")
        events = self.events()
        if not any("M0_DONE" in json.dumps(event) for event in events):
            raise ProbeError("model_result_missing")
        self.passed("fake_model_run_finished")
        for event in events:
            self.journal.append(event)
        before = self.journal.count()
        self.replay(events)
        self.replay(events)
        if self.journal.count() != before or self.status() != "finished":
            self.report["replay_counts"] = [before, self.journal.count()]
            self.report["replay_status"] = self.status()
            raise ProbeError("replay_not_idempotent")
        self.passed("websocket_reconnect_deduplicates")
        self.message("M0_WAIT")
        self.http.expect("POST", self.path + "/run")
        self.wait_status("running")
        # Let the deterministic model enter its delayed response before interrupting.
        time.sleep(1)
        self.http.expect("POST", self.path + "/interrupt")
        self.wait_status("paused")
        self.passed("interrupt_means_paused")
        self.http.expect("POST", self.path + "/run")
        self.wait_status("finished")
        self.passed("resume_after_interrupt")
        return self.events()

    def after_restart(self, expected_events):
        wait_ready(self.http)
        self.wait_status("finished")
        actual = self.events()
        expected_by_id = {e["id"]: e for e in expected_events}
        if any({e["id"]: e for e in actual}.get(k) != v for k, v in expected_by_id.items()):
            raise ProbeError("restart_lost_events")
        self.replay(actual)
        self.passed("container_restart_retains_history")
        self.message("M0_AFTER_RESTART")
        self.http.expect("POST", self.path + "/run")
        self.wait_status("finished")
        if len(self.events()) <= len(actual):
            raise ProbeError("restart_continuation_missing")
        self.passed("continue_after_container_restart")
        self.report["unique_events"] = self.journal.count()
        self.http.expect("DELETE", self.path)
        status, _ = self.http.request("GET", self.path)
        if status != 404:
            raise ProbeError("conversation_delete_not_confirmed")
        self.passed("conversation_delete")

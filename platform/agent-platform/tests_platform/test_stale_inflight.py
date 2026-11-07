"""Real HTTP overlap with synthetic pinned claim-capability/pointer semantics."""

import copy
import hmac
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from uuid import uuid4

from recovery_fixture import Node
from test_stale_cleanup import StaleCleanupFixture

from agent_platform.store import Store


class OverlappingReleaseNode(Node):
    """An HTTP sandbox release fixture, not execution of upstream sandboxd.

    Resolve a saved capability before waiting; recheck the same claim pointer
    under the mutation mutex, as pinned pool.Release/releaseResolved do.
    """

    def __init__(self, root):
        super().__init__(root)
        self.mutex = threading.Lock()
        self.claimed = {}
        self.capabilities = {}
        self.requests = []
        self.effect_count = 0
        self.close_count = 0
        self.winners = []
        self.handler_errors = []
        self.started = [threading.Event(), threading.Event()]
        self.proceed = [threading.Event(), threading.Event()]
        self.finished = [threading.Event(), threading.Event()]
        self.first_client_timed_out = threading.Event()
        self.closed = False
        node = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                parts = self.path.split("/")
                if len(parts) != 5 or parts[1:3] != ["v1", "sandboxes"] or parts[4] != "release":
                    self.send_error(404)
                    return
                identifier = parts[3]
                bearer = self.headers.get("Authorization", "")
                token = bearer.removeprefix("Bearer ") if bearer.startswith("Bearer ") else ""
                with node.mutex:
                    index = len(node.requests)
                    node.requests.append({"id": identifier, "token": token})
                    pointer = node.claimed.get(identifier)
                    authorized = (
                        pointer is not None
                        and bool(token)
                        and hmac.compare_digest(token, node.capabilities[identifier])
                    )
                if index >= 2 or not authorized:
                    node.handler_errors.append("unexpected or unauthorized release request")
                    self.send_error(403)
                    return
                node.started[index].set()
                try:
                    if not node.proceed[index].wait(8):
                        node.handler_errors.append("release barrier expired")
                        self.send_error(503)
                        return
                    # Re-resolution alone would not model the pinned pointer check:
                    # both handlers resolved this exact object before either won.
                    with node.mutex:
                        if node.claimed.get(identifier) is pointer:
                            del node.claimed[identifier]
                            pointer["alive"] = False
                            node.effect_count += 1
                            node.calls["release"] += 1
                            node.winners.append(index)
                            status = 204
                        else:
                            status = 404
                    try:
                        self.send_response(status)
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                    except (BrokenPipeError, ConnectionResetError):
                        # The first caller has deliberately timed out already.
                        pass
                finally:
                    node.finished[index].set()

        self.http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.http.daemon_threads = False
        self.http.block_on_close = True
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=False)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.http.server_address[1]}"

    def new(self, *args, **kwargs):
        handle = super().new(*args, **kwargs)
        handle.token = "synthetic-claim-" + uuid4().hex
        with self.mutex:
            self.claimed[handle.id] = self.rows[handle.id]
            self.capabilities[handle.id] = handle.token
        return handle

    def attach(self, owner, identifier, token):
        def close():
            if owner != "fixture":
                raise AssertionError("release owner changed")
            with self.mutex:
                index = self.close_count
                self.close_count += 1
            request = urllib.request.Request(
                self.origin + f"/v1/sandboxes/{identifier}/release",
                data=b"",
                method="POST",
                headers={"Authorization": "Bearer " + token},
            )
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                with opener.open(request, timeout=0.2 if index == 0 else 6) as response:
                    response.read()
            except urllib.error.HTTPError as exc:
                if exc.code != 404:
                    raise
            except (TimeoutError, urllib.error.URLError):
                if index == 0:
                    self.first_client_timed_out.set()
                raise

        return SimpleNamespace(close=close)

    def close(self):
        if self.closed:
            return
        self.closed = True
        for barrier in self.proceed:
            barrier.set()
        self.http.shutdown()
        self.http.server_close()  # Joins the non-daemon owned request handlers.
        self.thread.join(timeout=5)
        if self.thread.is_alive():
            raise AssertionError("owned HTTP listener did not stop")


class StaleInflightTests(StaleCleanupFixture):
    def setUp(self):
        super().setUp()
        self.node = OverlappingReleaseNode(self.root)
        self.addCleanup(self.node.close)
        self.server.service.client = self.node
        self.server.service.host = self.node

    def exercise_overlap(self, winner):
        try:
            run_id = self.stalled()
            self.assertTrue(self.node.first_client_timed_out.is_set())
            self.assertTrue(self.node.started[0].wait(3))
            self.assertFalse(self.node.finished[0].is_set())
            original = self.row(run_id)
            identifier = original["handle"]["id"]
            token = original["handle"]["token"]
            self.assertEqual(self.node.effect_count, 0)
            self.assertEqual(len(self.node.requests), 1)
            self.assertEqual(Store(self.db).runtime()["occupied"], 1)

            unknown = self.node.new(
                self.server.config["template"],
                net="none",
                size="large",
                ttl_seconds=180,
                claim_ref="foreign",
                deadline=0,
            )
            foreign = copy.deepcopy(self.node.rows[unknown.id])
            foreign_token = self.node.capabilities[unknown.id]
            plan = self.preview_cleanup(run_id)
            self.assertFalse(self.node.finished[0].is_set())
            self.assertEqual(self.node.effect_count, 0)
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(self.apply_cleanup, plan)
                try:
                    self.assertTrue(self.node.started[1].wait(3))
                    self.assertFalse(self.node.finished[0].is_set())
                    self.assertFalse(self.node.finished[1].is_set())
                    self.assertEqual(self.node.effect_count, 0)
                    self.assertEqual(self.node.requests, [{"id": identifier, "token": token}] * 2)
                    self.assertEqual(self.node.rows[unknown.id], foreign)
                    pending = self.row(run_id)["stale_cleanup"]
                    self.assertTrue(pending["tombstone"])
                    self.assertEqual(len(pending["attempts"]), 1)
                    self.assertEqual(Store(self.db).runtime()["occupied"], 1)

                    self.node.proceed[winner].set()
                    self.assertTrue(self.node.finished[winner].wait(3))
                    self.assertEqual(self.node.effect_count, 1)
                    self.assertEqual(self.node.winners, [winner])
                    self.assertFalse(self.node.finished[1 - winner].is_set())
                    self.assertEqual(Store(self.db).runtime()["occupied"], 1)
                    if winner == 1:
                        # New cleanup has completed while the old remote handler
                        # remains unresolved. Its replay still sends no release.
                        receipt = future.result(timeout=3)
                        self.assertEqual(self.apply_cleanup(plan), receipt)
                        self.assertFalse(self.node.finished[0].is_set())
                        self.assertEqual(len(self.node.requests), 2)
                    self.node.proceed[1 - winner].set()
                    self.assertTrue(self.node.finished[1 - winner].wait(3))
                    receipt = future.result(timeout=3)
                finally:
                    # Unblock before executor shutdown even when an assertion fails.
                    for barrier in self.node.proceed:
                        barrier.set()
                    future.result(timeout=7)

            self.assertEqual(receipt["status"], "stop_observed; reconciliation_pending")
            self.assertEqual(self.apply_cleanup(plan), receipt)
            self.assertEqual(len(self.node.requests), 2)
            self.assertEqual(self.node.effect_count, 1)
            self.assertEqual(self.node.calls["release"], 1)
            self.assertEqual(self.node.handler_errors, [])
            self.assertEqual(self.node.rows[unknown.id], foreign)
            self.assertEqual(self.node.capabilities[unknown.id], foreign_token)
            self.assertIs(self.node.claimed[unknown.id], self.node.rows[unknown.id])
            self.assertEqual(self.row(run_id)["operations"], original["operations"])
            self.assertEqual(self.row(run_id)["operations"]["release"]["state"], "started")
            self.assertEqual(Store(self.db).runtime()["occupied"], 1)
            self.assertEqual(
                self.scalar("SELECT status FROM jobs WHERE run_id=%s", (run_id,)), "interrupted"
            )
            self.reconcile_cleanup(run_id)
            self.assertEqual(Store(self.db).runtime()["occupied"], 0)
            self.assertEqual(self.node.effect_count, 1)
            self.assertEqual(self.node.rows[unknown.id], foreign)
            self.assertEqual(self.row(run_id)["operations"], original["operations"])
            self.assertTrue(self.row(run_id)["stale_cleanup"]["tombstone"])
        finally:
            self.node.close()

    def test_original_remote_handler_wins_while_approved_request_is_pending(self):
        self.exercise_overlap(0)

    def test_approved_request_wins_while_original_remote_handler_is_pending(self):
        self.exercise_overlap(1)

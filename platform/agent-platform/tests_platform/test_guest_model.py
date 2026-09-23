"""AT-11-B mailbox, pinned tool dialect, credential fences and cutoff accounting."""

import concurrent.futures
import json
import secrets
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
import test_model_proxy
import test_runtime
from test_control_plane import PlatformFixture

from agent_platform.connector_recovery import STOP_KEYS
from agent_platform.domain import Problem
from agent_platform.guest_model import Mailbox, server
from agent_platform.model_dialect import SDKCompletion, sdk_response
from agent_platform.model_fixture import fixture_server, tool_response
from agent_platform.model_policy import Policy, canonical
from agent_platform.model_proxy import ModelProxy, usage_view
from agent_platform.store import Store
from agent_platform.worker import Worker


def request():
    return {
        "model": "gpt-4o-mini",
        "max_completion_tokens": 4096,
        "temperature": 0.0,
        "messages": [{"role": "user", "content": [{"type": "text", "text": "fixture"}]}],
        "tools": [
            {
                "type": "function",
                "function": {"name": name, "parameters": {"type": "object", "properties": {}}},
            }
            for name in ("terminal", "finish", "think")
        ],
    }


class DialectTests(unittest.TestCase):
    def test_real_sdk_assistant_without_content_and_named_tool_text_parts(self):
        data = request()
        value = tool_response({**SDKCompletion(data).payload(), "fixture_run_id": str(uuid4())})
        message = value["choices"][0]["message"]
        del message["content"]
        data["messages"].extend(
            [
                message,
                {
                    "role": "tool",
                    "name": "terminal",
                    "tool_call_id": message["tool_calls"][0]["id"],
                    "content": [{"type": "text", "text": "ok"}],
                },
            ]
        )
        self.assertEqual(SDKCompletion(data).payload()["model"], "fixture:m2")

    def test_unknown_options_multimodal_unmatched_tools_and_streaming_rejected(self):
        for changed in (
            {"base_url": "http://private"},
            {"stream": True},
            {"max_completion_tokens": True},
            {"parallel_tool_calls": True},
            {"messages": [{"role": "user", "content": [{"type": "image_url", "image_url": "x"}]}]},
            {"messages": [{"role": "tool", "tool_call_id": "missing", "content": "x"}]},
        ):
            with self.subTest(changed=changed), self.assertRaises(Problem):
                SDKCompletion({**request(), **changed}).payload()

    def test_response_tool_allowlist_arguments_usage_and_secret_checks(self):
        payload = {**SDKCompletion(request()).payload(), "fixture_run_id": str(uuid4())}
        value = tool_response(payload)
        self.assertEqual(
            sdk_response(canonical(value), payload, ("canary-secret",))[1]["total_tokens"], 15
        )
        for change in ("name", "arguments", "usage", "secret"):
            bad = json.loads(json.dumps(value))
            fn = bad["choices"][0]["message"]["tool_calls"][0]["function"]
            if change == "name":
                fn["name"] = "host_shell"
            elif change == "arguments":
                fn["arguments"] = "[]"
            elif change == "usage":
                bad["usage"]["completion_tokens"] = True
            else:
                fn["arguments"] = '{"command":"canary-secret"}'
            with self.subTest(change=change), self.assertRaises(Problem):
                sdk_response(canonical(bad), payload, ("canary-secret",))


class MailboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.local, self.relay = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        self.mailbox = Mailbox(self.temp.name, str(uuid4()), self.local, self.relay)
        self.server = server(self.mailbox, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)
        self.client = httpx.Client(
            base_url=f"http://127.0.0.1:{self.server.server_port}", trust_env=False, timeout=5
        )
        self.addCleanup(self.client.close)
        self.token = "mp1_" + secrets.token_urlsafe(32)

    def close_server(self):
        with self.mailbox.condition:
            self.mailbox.blocked = True
            self.mailbox.condition.notify_all()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)

    def credential(self, generation=1, revision=1, token=None):
        return self.client.post(
            "/credential",
            json={"generation": generation, "revision": revision, "token": token or self.token},
            headers={"X-Session-API-Key": self.relay},
        )

    def poll(self):
        return self.client.get("/mailbox", headers={"X-Session-API-Key": self.relay})

    def test_sdk_key_cannot_poll_rotate_or_deliver_and_no_key_cannot_infer_state(self):
        for path in ("/mailbox", "/credential", "/response"):
            result = self.client.post(
                path, json={}, headers={"Authorization": "Bearer " + self.local}
            )
            self.assertEqual(result.status_code, 401)
        self.assertEqual(self.client.post("/v1/chat/completions", json=request()).status_code, 401)
        self.assertEqual(self.client.get("/mailbox").status_code, 401)

    def test_rotation_is_monotonic_idempotent_and_never_changes_pending_request_id(self):
        self.assertEqual(self.credential().status_code, 200)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            pending = pool.submit(
                self.client.post,
                "/v1/chat/completions",
                json=request(),
                headers={"Authorization": "Bearer " + self.local},
            )
            deadline = time.monotonic() + 3
            while not (item := self.poll().json()["pending"]):
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            second = "mp1_" + secrets.token_urlsafe(32)
            self.assertEqual(self.credential(revision=2, token=second).status_code, 200)
            self.assertEqual(self.credential(revision=2, token=second).status_code, 200)
            self.assertEqual(self.credential().status_code, 409)
            current = self.poll().json()["pending"]
            self.assertEqual(current["request_id"], item["request_id"])
            self.assertEqual(current["token"], second)
            reply = {"request_id": item["request_id"], "generation": 1, "response": {"ok": True}}
            headers = {"X-Session-API-Key": self.relay}
            self.assertEqual(
                self.client.post(
                    "/response", json={**reply, "generation": 2}, headers=headers
                ).status_code,
                409,
            )
            self.assertEqual(
                self.client.post("/response", json=reply, headers=headers).status_code, 200
            )
            self.assertEqual(pending.result().json(), {"ok": True})
            self.assertEqual(
                self.client.post("/response", json=reply, headers=headers).status_code, 409
            )
        self.assertEqual(
            self.client.post(
                "/v1/chat/completions",
                json=request(),
                headers={"Authorization": "Bearer " + self.local},
            ).status_code,
            409,
        )

    def test_restart_fails_closed_and_private_state_contains_no_credentials(self):
        self.mailbox.persist({"state": "waiting", "request_id": str(uuid4())})
        restarted = Mailbox(self.temp.name, self.mailbox.run_id, self.local, self.relay)
        self.assertEqual(restarted.take()[0], 409)
        self.assertEqual(self.mailbox.path.stat().st_mode & 0o777, 0o600)
        for secret in (self.local, self.relay, self.token):
            self.assertNotIn(secret, self.mailbox.path.read_text())

    def test_concurrent_sdk_requests_waiting_for_first_credential_keep_one_identity(self):
        ready = threading.Event()
        wait = self.mailbox.condition.wait
        waiting = set()

        def observed_wait(timeout):
            if self.mailbox.token is None:
                waiting.add(threading.get_ident())
                if len(waiting) == 2:
                    ready.set()
            return wait(timeout)

        with (
            patch.object(self.mailbox.condition, "wait", side_effect=observed_wait),
            concurrent.futures.ThreadPoolExecutor() as pool,
        ):
            requests = [
                pool.submit(
                    self.client.post,
                    "/v1/chat/completions",
                    json=request(),
                    headers={"Authorization": "Bearer " + self.local},
                )
                for _ in range(2)
            ]
            self.assertTrue(ready.wait(3))
            self.assertEqual(self.credential().status_code, 200)
            done, pending = concurrent.futures.wait(
                requests, timeout=3, return_when=concurrent.futures.FIRST_COMPLETED
            )
            self.assertEqual(len(done), 1)
            self.assertEqual(next(iter(done)).result().status_code, 409)
            item = self.poll().json()["pending"]
            self.assertEqual(self.poll().json()["pending"]["request_id"], item["request_id"])
            self.assertEqual(
                self.client.post(
                    "/response",
                    json={
                        "request_id": item["request_id"],
                        "generation": 1,
                        "response": {"ok": True},
                    },
                    headers={"X-Session-API-Key": self.relay},
                ).status_code,
                200,
            )
            self.assertEqual(next(iter(pending)).result().json(), {"ok": True})
            self.assertIsNone(self.poll().json()["pending"])

    def test_browser_cross_run_keys_and_query_credentials_are_rejected(self):
        headers = {"X-Session-API-Key": self.relay, "Origin": "https://operator"}
        self.assertEqual(self.client.get("/mailbox", headers=headers).status_code, 403)
        self.assertEqual(
            self.client.get(
                "/mailbox", headers={"X-Session-API-Key": secrets.token_urlsafe(32)}
            ).status_code,
            401,
        )
        self.assertEqual(self.client.get("/mailbox?token=" + self.relay).status_code, 401)


class ModelTransportTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM runtime_catalog")
        test_runtime.RuntimeTests.real_profile(self)
        self.run, self.worker = test_model_proxy.ModelProxyTests.running(self)
        secret = secrets.token_urlsafe(32)
        self.upstream = fixture_server(0, secret)
        threading.Thread(target=self.upstream.serve_forever, daemon=True).start()
        self.addCleanup(self.close_upstream)
        self.proxy = ModelProxy(
            self.db, Policy(f"http://127.0.0.1:{self.upstream.server_port}", secret, 2)
        )
        self.token = self.proxy.issue(self.run, 1, self.worker.owner)

    def close_upstream(self):
        self.upstream.shutdown()
        self.upstream.server_close()

    def complete(self, identity=None):
        return self.proxy.complete(
            self.run, self.token, identity or uuid4(), SDKCompletion(request()), sdk=True
        )

    def test_real_control_fixture_produces_sdk_tool_call_with_run_identity(self):
        value = self.complete()
        command = value["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
        self.assertIn(str(self.run), command)
        self.assertEqual(usage_view(self.db, self.run)["entries"][0]["status"], "final")

    def test_same_request_survives_new_generation_without_redispatch_or_refund(self):
        identity = uuid4()
        self.complete(identity)
        with self.db.transaction() as conn:
            for table in ("runs", "jobs", "sandbox_bindings"):
                conn.execute(f"UPDATE {table} SET generation=2")
        self.token = self.proxy.issue(self.run, 2, self.worker.owner)
        with self.assertRaisesRegex(Problem, "model_request_already_reserved"):
            self.complete(identity)
        self.assertEqual(usage_view(self.db, self.run)["request_slots_consumed"], 1)

    def test_cutoff_revokes_new_model_and_tool_admission_but_retains_capacity(self):
        self.complete()
        self.proxy.cutoff(self.run, 1, self.worker.owner, "model_transport_uncertain")
        self.proxy.cutoff(self.run, 1, self.worker.owner, "model_request_limit_reached")
        self.assertEqual(
            self.scalar("SELECT count(*) FROM run_events WHERE type='model.cutoff'"), 1
        )
        with self.assertRaisesRegex(Problem, "model_run_cutoff"):
            self.complete()
        with self.db.transaction() as conn, self.assertRaisesRegex(Problem, "model_run_cutoff"):
            self.proxy.tool_gate(conn, self.run, 1, self.worker.owner)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(
            usage_view(self.db, self.run)["cutoff_reason"], "model_transport_uncertain"
        )

    def test_exhausted_budget_blocks_manual_and_automatic_terminal_admission(self):
        self.complete()
        self.complete()
        for state in ("running", "awaiting_approval"):
            with self.db.transaction() as conn:
                conn.execute("UPDATE runs SET state=%s", (state,))
            with (
                self.db.transaction() as conn,
                self.assertRaisesRegex(Problem, "model_request_limit_reached"),
            ):
                self.proxy.tool_gate(conn, self.run, 1, self.worker.owner)
        self.proxy.cutoff(self.run, 1, self.worker.owner, "model_request_limit_reached")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

    def test_stale_owner_cannot_cutoff_after_pause_or_cancel(self):
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET generation=2,state='pausing'")
            conn.execute("UPDATE jobs SET generation=2")
        with self.assertRaisesRegex(Problem, "model_run_not_live"):
            self.proxy.cutoff(self.run, 1, self.worker.owner, "model_transport_uncertain")
        self.assertIsNone(usage_view(self.db, self.run)["cutoff_reason"])

    def test_expiry_revocation_and_cross_run_never_reach_fixture(self):
        other, _ = test_model_proxy.ModelProxyTests.running(self)
        with self.assertRaisesRegex(Problem, "model_token_invalid"):
            self.proxy.complete(other, self.token, uuid4(), SDKCompletion(request()), sdk=True)
        with self.db.transaction() as conn:
            conn.execute("UPDATE model_proxy_tokens SET expires_at=clock_timestamp()")
        with self.assertRaisesRegex(Problem, "model_token_invalid"):
            self.complete()
        self.token = self.proxy.issue(self.run, 1, self.worker.owner)
        self.proxy.revoke(self.run)
        with self.assertRaisesRegex(Problem, "model_token_invalid"):
            self.complete()
        self.assertEqual(usage_view(self.db, self.run)["request_slots_consumed"], 0)


class ModelCleanupTests(PlatformFixture):
    def test_cutoff_retains_reservation_until_recovery_proves_original_vm_stopped(self):
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM runtime_catalog")
        test_runtime.RuntimeTests.real_profile(self)
        run_id = self.create()["run"]["id"]

        class Runtime:
            confirmed = False
            allocations = 0
            prompts = 0
            token = None

            def fence(self, run):
                pass

            def allocate(self, run):
                self.allocations += 1
                return {"handle": "same-vm", "vm_id": "same-vm", "lease_deadline": run["deadline"]}

            def operation(self, run, action):
                if action == "prepare":
                    return {"ref": str(run["id"]), "model_transport": True}
                self.prompts += int(action == "prompt")
                raise AssertionError("no tool admission after invalid model payload")

            def model(self, run, action, **data):
                if action == "credential":
                    self.token = data["token"]
                    return {}
                return {
                    "pending": {
                        "run_id": str(run["id"]),
                        "generation": run["generation"],
                        "request_id": str(uuid4()),
                        "token": self.token,
                        "payload": {},
                    }
                }

            def cancel(self, run):
                return {
                    "observed_state": "stopped",
                    "proof": dict.fromkeys(STOP_KEYS, self.confirmed),
                }

        runtime = Runtime()
        policy = Policy("http://127.0.0.1:18090", secrets.token_urlsafe(32), 2)
        worker = Worker(self.db, runtime)
        worker.model_proxy = ModelProxy(self.db, policy)
        worker.run_once()
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(Store(self.db).run(run_id)["state"], "interrupted")
        self.assertEqual(usage_view(self.db, run_id)["cutoff_reason"], "model_sdk_dialect_invalid")
        runtime.confirmed = True
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE jobs SET available_at=clock_timestamp() WHERE run_id=%s", (run_id,)
            )
        recovery = Worker(self.db, runtime)
        recovery.model_proxy = ModelProxy(self.db, policy)
        recovery.run_once()
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(Store(self.db).run(run_id)["state"], "failed")
        self.assertEqual(runtime.allocations, 1)
        self.assertEqual(runtime.prompts, 0)

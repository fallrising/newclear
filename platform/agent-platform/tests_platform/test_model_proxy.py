"""AT-11 control-side slice: real SQL, authenticated HTTP, races and process death."""

import concurrent.futures
import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from uuid import UUID, uuid4

import httpx
from fastapi.testclient import TestClient
from test_control_plane import URL, PlatformFixture

from agent_platform.domain import Problem
from agent_platform.model_api import create_model_app
from agent_platform.model_cli import write_token
from agent_platform.model_fixture import fixture_response
from agent_platform.model_policy import MODEL, Completion, FixtureBudget, Policy, canonical
from agent_platform.model_pricing import (
    CONTEXT_TOKENS,
    PRICE_REVISION,
    PublishedPriceQuote,
)
from agent_platform.model_proxy import ModelProxy, usage_view
from agent_platform.store import Store
from agent_platform.worker import Worker


class Upstream:
    def __init__(self):
        self.secret = secrets.token_urlsafe(32)
        self.calls = []
        self.status = 200
        self.value = fixture_response()
        self.extra_headers = {}
        self.entered = threading.Event()
        self.release = threading.Event()
        self.release.set()
        self.truncated = False
        self.drip_headers = False
        upstream = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                if (
                    self.path != "/v1/chat/completions"
                    or self.headers.get("Authorization") != "Bearer " + upstream.secret
                ):
                    self.send_error(403)
                    return
                upstream.calls.append(
                    json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                )
                upstream.entered.set()
                upstream.release.wait(10)
                if upstream.drip_headers:
                    try:
                        self.wfile.write(b"HTTP/1.1 200 OK\r\nX-Fixture: ")
                        for _ in range(1000):
                            self.wfile.write(b"x")
                            time.sleep(0.05)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                    return
                raw = canonical(upstream.value)
                self.send_response(upstream.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw) + int(upstream.truncated)))
                for key, value in upstream.extra_headers.items():
                    self.send_header(key, value)
                self.end_headers()
                try:
                    self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def close(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)


class ModelProxyTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.upstream = Upstream()
        self.addCleanup(self.upstream.close)
        self.policy = Policy(self.upstream.origin, self.upstream.secret, request_limit=2)
        self.proxy = ModelProxy(self.db, self.policy)
        self.model_client = self.enterContext(TestClient(create_model_app(self.db, self.policy)))
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO runtime_catalog(node_id,template_digest,repositories,"
                "egress_policy_sha256) VALUES ('cocoon-local',%s,%s,%s) ON CONFLICT(node_id) "
                "DO UPDATE SET template_digest=excluded.template_digest,"
                "repositories=excluded.repositories,egress_policy_sha256=excluded.egress_policy_sha256",
                (
                    "fixture@sha256:" + "a" * 64,
                    json.dumps(
                        [
                            {
                                "canonical_repo": self.project["canonical_repo"],
                                "base_sha": self.payload["base_sha"],
                            }
                        ]
                    ),
                    "b" * 64,
                ),
            )
        profile = self.post("/agent-profiles", {"name": "Proxy fixture", "backend": "openhands"})
        self.assertEqual(profile.status_code, 201)
        self.payload["profile_revision"] = profile.json()["id"]
        self.run, self.worker = self.running()
        self.token = self.proxy.issue(self.run, 1, self.worker.owner)
        self.payload_model = {
            "model": MODEL,
            "messages": [{"role": "user", "content": "test"}],
            "max_tokens": 32,
            "stream": False,
        }
        self.path = f"/v1/runs/{self.run}/chat/completions"

    def running(self):
        run = UUID(self.create()["run"]["id"])
        worker = Worker(self.db)
        claim = worker.claim_node("cocoon-local", "openhands")
        self.assertEqual(claim["run_id"], run)
        # This suite verifies the control-plane authority against SQL runtime records.
        # It does not claim VM/guest/SDK evidence; those are a later milestone.
        with worker.owned(claim) as (conn, row):
            worker.state(conn, row, "running")
            conn.execute(
                "UPDATE sandbox_bindings SET observed_state='running' WHERE run_id=%s", (run,)
            )
        return run, worker

    def request(self, *, request_id=None, token=None, data=None, path=None, headers=None):
        return self.model_client.post(
            path or self.path,
            json=data if data is not None else self.payload_model,
            headers={
                "Authorization": "Bearer " + (token or self.token),
                "Idempotency-Key": str(request_id or uuid4()),
                **(headers or {}),
            },
        )

    def sql(self, query, params=()):
        with self.db.transaction() as conn:
            conn.execute(query, params)

    def usage(self):
        return usage_view(self.db, self.run)

    def assert_denied(self, code):
        response = self.request()
        self.assertEqual(response.json()["error"], code)
        self.assertFalse(self.upstream.calls)
        self.assertEqual(self.usage()["request_slots_consumed"], 0)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

    def priced(self, limit):
        run, worker = self.running()
        policy = replace(
            self.policy,
            budget=FixtureBudget("fixture-credit-2026-09", limit, 1, 1),
        )
        proxy = ModelProxy(self.db, policy)
        token = proxy.issue(run, 1, worker.owner)
        return run, worker, proxy, token

    def quoted(self, limit):
        run, worker = self.running()
        now = datetime.now(UTC)
        quote = PublishedPriceQuote(
            limit,
            now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            (now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            True,
        )
        policy = replace(self.policy, price_quote=quote)
        proxy = ModelProxy(self.db, policy)
        token = proxy.issue(run, 1, worker.owner)
        return run, worker, proxy, token

    def test_published_price_preview_reserves_before_dispatch_and_estimates(self):
        envelope = CONTEXT_TOKENS * 150 + 32 * 600
        run, _, proxy, token = self.quoted(envelope + 1)
        self.upstream.release.clear()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            first = pool.submit(
                proxy.complete, run, token, uuid4(), Completion(**self.payload_model)
            )
            self.assertTrue(self.upstream.entered.wait(3))
            pending = usage_view(self.db, run)
            self.assertEqual(pending["quote_committed_usd"], "0.0192192")
            self.assertTrue(pending["quote_uncertain"])
            with self.assertRaisesRegex(Problem, "model_price_quote_exhausted"):
                proxy.complete(run, token, uuid4(), Completion(**self.payload_model))
            self.assertEqual(len(self.upstream.calls), 1)
            self.upstream.release.set()
            first.result(timeout=5)
        settled = usage_view(self.db, run)
        self.assertEqual(settled["quote_price_revision"], PRICE_REVISION)
        self.assertEqual(settled["quote_committed_usd"], "0.0000045")
        self.assertFalse(settled["quote_uncertain"])
        self.assertFalse(settled["hard_money_limit_supported"])
        self.assertIsNone(settled["amount_decimal"])
        self.assertIsNone(settled["entries"][0]["amount_decimal"])
        self.assertEqual(settled["entries"][0]["quote_input_bound"], CONTEXT_TOKENS)

    def test_published_price_preview_unknown_keeps_full_money_reservation(self):
        envelope = CONTEXT_TOKENS * 150 + 32 * 600
        run, _, proxy, token = self.quoted(envelope + 1)
        self.upstream.status = 429
        with self.assertRaisesRegex(Problem, "model_rate_limited"):
            proxy.complete(run, token, uuid4(), Completion(**self.payload_model))
        view = usage_view(self.db, run)
        self.assertEqual(view["entries"][0]["status"], "unknown")
        self.assertEqual(view["entries"][0]["quote_reserved_nanodollars"], envelope)
        self.assertIsNone(view["entries"][0]["quote_settled_nanodollars"])
        self.assertEqual(view["quote_committed_usd"], "0.0192192")
        self.upstream.status = 200
        with self.assertRaisesRegex(Problem, "model_price_quote_exhausted"):
            proxy.complete(run, token, uuid4(), Completion(**self.payload_model))
        self.assertEqual(len(self.upstream.calls), 1)

    def test_published_price_preview_overreported_tokens_become_unknown(self):
        envelope = CONTEXT_TOKENS * 150 + 32 * 600
        run, _, proxy, token = self.quoted(envelope + 1)
        self.upstream.value["usage"] = {
            "prompt_tokens": CONTEXT_TOKENS + 1,
            "completion_tokens": 5,
            "total_tokens": CONTEXT_TOKENS + 6,
        }
        with self.assertRaisesRegex(Problem, "model_usage_exceeds_reserved_bound"):
            proxy.complete(run, token, uuid4(), Completion(**self.payload_model))
        view = usage_view(self.db, run)
        self.assertEqual(view["entries"][0]["status"], "unknown")
        self.assertIsNone(view["entries"][0]["quote_settled_nanodollars"])
        self.assertEqual(view["entries"][0]["quote_reserved_nanodollars"], envelope)

    def test_published_price_preview_expiry_and_policy_drift_fail_closed(self):
        run, worker, proxy, token = self.quoted(10**9)
        changed = replace(
            proxy.policy,
            price_quote=replace(proxy.policy.price_quote, limit_nanodollars=10**9 + 1),
        )
        with self.assertRaisesRegex(Problem, "model_policy_changed"):
            ModelProxy(self.db, changed).issue(run, 1, worker.owner)
        with patch("agent_platform.model_policy.INPUT_NANODOLLARS_PER_TOKEN", 151):
            with self.assertRaisesRegex(Problem, "model_policy_changed"):
                proxy.issue(run, 1, worker.owner)
        expired = replace(
            proxy.policy,
            price_quote=replace(
                proxy.policy.price_quote,
                expires_at="2020-01-01T01:00:00Z",
                verified_at="2020-01-01T00:00:00Z",
            ),
        )
        with self.assertRaisesRegex(Problem, "model_price_quote_expired"):
            ModelProxy(self.db, expired).issue(run, 1, worker.owner)
        # An admitted request under the original policy remains usable.
        proxy.complete(run, token, uuid4(), Completion(**self.payload_model))

    def test_fixture_credits_reserve_before_dispatch_and_settle_below_bound(self):
        upper = len(canonical(self.payload_model)) + self.payload_model["max_tokens"]
        run, worker, proxy, token = self.priced(upper + 10)
        self.upstream.release.clear()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            first = pool.submit(
                proxy.complete, run, token, uuid4(), Completion(**self.payload_model)
            )
            self.assertTrue(self.upstream.entered.wait(3))
            pending = usage_view(self.db, run)
            self.assertEqual(pending["fixture_credits_committed_microcredits"], upper)
            self.assertTrue(pending["fixture_credits_uncertain"])
            with self.assertRaisesRegex(Problem, "model_fixture_budget_exhausted"):
                proxy.complete(run, token, uuid4(), Completion(**self.payload_model))
            self.assertEqual(len(self.upstream.calls), 1)
            self.upstream.release.set()
            first.result(timeout=5)
        settled = usage_view(self.db, run)
        self.assertEqual(settled["fixture_credits_committed_microcredits"], 15)
        self.assertFalse(settled["fixture_credits_uncertain"])
        self.assertFalse(settled["hard_money_limit_supported"])
        self.assertIsNone(settled["amount_decimal"])
        self.assertEqual(settled["entries"][0]["fixture_reserved_microcredits"], upper)
        self.assertEqual(settled["entries"][0]["fixture_settled_microcredits"], 15)
        self.assertEqual(Store(self.db).runtime()["occupied"], 2)

    def test_fixture_unknown_usage_keeps_full_reservation_and_blocks_next_request(self):
        upper = len(canonical(self.payload_model)) + self.payload_model["max_tokens"]
        run, _, proxy, token = self.priced(upper + 10)
        self.upstream.status = 429
        with self.assertRaisesRegex(Problem, "model_rate_limited"):
            proxy.complete(run, token, uuid4(), Completion(**self.payload_model))
        self.upstream.status = 200
        with self.assertRaisesRegex(Problem, "model_fixture_budget_exhausted"):
            proxy.complete(run, token, uuid4(), Completion(**self.payload_model))
        view = usage_view(self.db, run)
        self.assertEqual(view["fixture_credits_committed_microcredits"], upper)
        self.assertTrue(view["fixture_credits_uncertain"])
        self.assertEqual(view["request_slots_consumed"], 1)
        self.assertEqual(len(self.upstream.calls), 1)

    def test_fixture_usage_above_input_bound_is_unknown_and_never_refunded(self):
        upper_input = len(canonical(self.payload_model))
        run, _, proxy, token = self.priced(10000)
        self.upstream.value["usage"] = {
            "prompt_tokens": upper_input + 1,
            "completion_tokens": 5,
            "total_tokens": upper_input + 6,
        }
        with self.assertRaisesRegex(Problem, "model_usage_exceeds_reserved_bound"):
            proxy.complete(run, token, uuid4(), Completion(**self.payload_model))
        view = usage_view(self.db, run)
        self.assertEqual(view["entries"][0]["status"], "unknown")
        self.assertEqual(view["fixture_credits_committed_microcredits"], upper_input + 32)
        self.assertIsNone(view["entries"][0]["fixture_settled_microcredits"])

    def test_fixture_tool_gate_requires_capacity_for_next_maximum_request(self):
        run, worker, proxy, token = self.priced(10000)
        proxy.complete(run, token, uuid4(), Completion(**self.payload_model))
        with self.db.transaction() as conn:
            with self.assertRaisesRegex(Problem, "model_fixture_budget_exhausted"):
                proxy.tool_gate(conn, run, 1, worker.owner)
        self.assertEqual(usage_view(self.db, run)["fixture_credits_committed_microcredits"], 15)
        self.assertEqual(Store(self.db).runtime()["occupied"], 2)

    def test_fixture_price_or_limit_change_cannot_reprice_existing_run(self):
        run, worker, proxy, token = self.priced(10000)
        for budget in (
            FixtureBudget("fixture-credit-2026-10", 10000, 1, 1),
            FixtureBudget("fixture-credit-2026-09", 10001, 1, 1),
            FixtureBudget("fixture-credit-2026-09", 10000, 2, 1),
        ):
            with (
                self.subTest(budget=budget),
                self.assertRaisesRegex(Problem, "model_policy_changed"),
            ):
                ModelProxy(self.db, replace(proxy.policy, budget=budget)).issue(
                    run, 1, worker.owner
                )
        request_id = uuid4()
        proxy.reserve(run, token, request_id, self.payload_model)
        with self.assertRaisesRegex(Problem, "model_policy_changed"):
            ModelProxy(
                self.db,
                replace(proxy.policy, budget=FixtureBudget("changed", 10000, 1, 1)),
            ).settle(
                run,
                request_id,
                usage={"prompt_tokens": 10, "completion_tokens": 5},
            )
        self.assertEqual(usage_view(self.db, run)["entries"][0]["status"], "reserved")
        proxy.settle(
            run,
            request_id,
            usage={"prompt_tokens": 10, "completion_tokens": 5},
        )
        self.assertEqual(
            proxy.complete(run, token, uuid4(), Completion(**self.payload_model))["usage"][
                "total_tokens"
            ],
            15,
        )

    def test_fixture_budget_config_is_strict_and_legacy_digest_is_stable(self):
        budget = FixtureBudget("fixture-credit-2026-09", 10000, 1, 1)
        self.assertNotEqual(self.policy.digest, replace(self.policy, budget=budget).digest)
        path = self.config_file()
        config = json.loads(path.read_text())
        config["fixture_budget"] = {
            "revision": budget.revision,
            "limit_microcredits": budget.limit_microcredits,
            "input_microcredits_per_token": budget.input_microcredits_per_token,
            "output_microcredits_per_token": budget.output_microcredits_per_token,
        }
        path.write_text(json.dumps(config))
        self.assertEqual(Policy.read(path).digest, replace(self.policy, budget=budget).digest)
        config["fixture_budget"] = None
        path.write_text(json.dumps(config))
        with self.assertRaises(ValueError):
            Policy.read(path)
        for invalid in (
            {
                "revision": "x",
                "limit_microcredits": True,
                "input_microcredits_per_token": 1,
                "output_microcredits_per_token": 1,
            },
            {
                "revision": "x",
                "limit_microcredits": 1,
                "input_microcredits_per_token": 0,
                "output_microcredits_per_token": 1,
            },
        ):
            with self.assertRaises(ValueError):
                FixtureBudget(**invalid)

    def test_success_private_provider_credential_and_authenticated_usage(self):
        reply = self.request()
        self.assertEqual(reply.status_code, 200, reply.text)
        self.assertEqual(reply.json()["usage"]["total_tokens"], 15)
        usage = self.client.get(f"/api/v1/runs/{self.run}/usage")
        self.assertEqual(usage.status_code, 200)
        body = usage.json()
        self.assertEqual(body["entries"][0]["status"], "final")
        self.assertEqual(body["entries"][0]["input_tokens"], 10)
        self.assertIsNone(body["amount_decimal"])
        self.assertEqual(body["cost_status"], "unknown")
        self.assertFalse(body["guest_connected"])
        self.assertFalse(body["hard_money_limit_supported"])
        self.assertEqual(len(self.upstream.calls), 1)
        # Neither bearer is in requests forwarded to the provider or persisted public views.
        raw = json.dumps(self.upstream.calls) + usage.text
        for secret in (self.token, self.upstream.secret):
            self.assertNotIn(secret, raw)
        self.client.cookies.clear()
        self.assertEqual(self.client.get(f"/api/v1/runs/{self.run}/usage").status_code, 401)

    def test_missing_unknown_duplicate_and_cross_run_token_rejected(self):
        other, _ = self.running()
        self.assertEqual(self.request(path=f"/v1/runs/{other}/chat/completions").status_code, 401)
        self.assertEqual(self.request(token="mp1_" + "x" * 43).status_code, 401)
        self.assertEqual(
            self.model_client.post(self.path, json=self.payload_model).status_code, 401
        )
        result = self.model_client.post(
            self.path,
            json=self.payload_model,
            headers=[
                ("Authorization", "Bearer " + self.token),
                ("Authorization", "Bearer " + self.token),
                ("Idempotency-Key", str(uuid4())),
            ],
        )
        self.assertEqual(result.status_code, 401)
        self.assertFalse(self.upstream.calls)

    def test_token_expiration_rotation_and_explicit_revocation(self):
        self.sql("UPDATE model_proxy_tokens SET expires_at=clock_timestamp()-interval '1 second'")
        self.assert_denied("model_token_invalid")
        old = self.token
        self.token = self.proxy.issue(self.run, 1, self.worker.owner)
        self.assertEqual(self.request(token=old).status_code, 401)
        self.proxy.revoke(self.run)
        self.assert_denied("model_token_invalid")

    def test_generation_owner_and_lease_are_checked_for_every_request(self):
        for statement in (
            "UPDATE runs SET generation=2",
            "UPDATE jobs SET generation=2",
            "UPDATE jobs SET lease_owner=gen_random_uuid()",
            "UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second'",
        ):
            with self.subTest(statement=statement):
                with self.db.transaction() as conn:
                    conn.execute(statement)
                self.assert_denied("model_run_not_live")
                self.sql("UPDATE runs SET generation=1")
                self.sql(
                    "UPDATE jobs SET generation=1,lease_owner=%s,"
                    "lease_until=clock_timestamp()+interval '30 seconds'",
                    (self.worker.owner,),
                )

    def test_paused_cancelled_interrupted_and_terminal_states_reject(self):
        for state in (
            "provisioning",
            "awaiting_approval",
            "pausing",
            "paused",
            "resuming",
            "cancelling",
            "interrupted",
            "finalizing",
            "succeeded",
            "failed",
            "cancelled",
        ):
            with self.subTest(state=state):
                self.sql("UPDATE runs SET state=%s", (state,))
                self.assert_denied("model_run_not_live")

    def test_deadline_and_unknown_runtime_keep_vm_reservation(self):
        self.sql("UPDATE sandbox_bindings SET observed_state='unknown'")
        self.assert_denied("model_runtime_unconfirmed")
        self.sql("UPDATE sandbox_bindings SET observed_state='running'")
        self.sql("UPDATE runs SET deadline=clock_timestamp()-interval '1 second'")
        self.assert_denied("model_run_not_live")

    def test_cancel_transaction_revokes_admission_without_waiting_for_provider(self):
        self.upstream.release.clear()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            pending = pool.submit(self.request)
            self.assertTrue(self.upstream.entered.wait(3))
            run = Store(self.db).run(self.run)
            cancelled = self.post(
                f"/runs/{self.run}/actions",
                {"action": "cancel", "expected_state_version": run["state_version"]},
            )
            self.assertEqual(cancelled.status_code, 202)
            self.assertEqual(self.request().json()["error"], "model_run_not_live")
            self.upstream.release.set()
            self.assertEqual(pending.result(timeout=5).json()["error"], "model_run_not_live")
        self.assertEqual(len(self.upstream.calls), 1)
        self.assertEqual(self.usage()["entries"][0]["status"], "final")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(Store(self.db).run(self.run)["state"], "cancelling")

    def test_lock_wait_cannot_use_transaction_start_time_as_live_lease(self):
        with concurrent.futures.ThreadPoolExecutor() as pool:
            with self.db.transaction() as conn:
                conn.execute("SELECT id FROM jobs WHERE run_id=%s FOR UPDATE", (self.run,))
                future = pool.submit(self.request)
                # Wait until the request is actually blocked on our database lock.
                deadline = time.monotonic() + 3
                while not self.scalar(
                    "SELECT count(*) FROM pg_stat_activity WHERE "
                    "wait_event_type='Lock' AND query LIKE 'SELECT * FROM jobs%%'"
                ):
                    if time.monotonic() > deadline:
                        self.fail("request did not wait for job lock")
                    time.sleep(0.02)
                conn.execute("UPDATE jobs SET lease_until=clock_timestamp()")
            self.assertEqual(future.result(timeout=5).json()["error"], "model_run_not_live")
        self.assertFalse(self.upstream.calls)

    def test_concurrent_distinct_requests_reserve_before_provider_and_cap_at_two(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            replies = list(pool.map(lambda _: self.request(), range(8)))
        self.assertEqual([r.status_code for r in replies].count(200), 2)
        self.assertEqual([r.status_code for r in replies].count(429), 6)
        self.assertEqual(len(self.upstream.calls), 2)
        self.assertEqual(self.usage()["request_slots_consumed"], 2)

    def test_concurrent_duplicate_and_changed_payload_never_dispatch_again(self):
        key = uuid4()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            replies = list(pool.map(lambda _: self.request(request_id=key), range(6)))
        self.assertEqual([r.status_code for r in replies].count(200), 1)
        self.assertEqual([r.status_code for r in replies].count(409), 5)
        changed = self.request(request_id=key, data={**self.payload_model, "max_tokens": 33})
        self.assertEqual(changed.json()["error"], "model_idempotency_conflict")
        self.assertEqual(len(self.upstream.calls), 1)

    def test_token_rotation_and_new_generation_never_reset_request_budget(self):
        self.assertEqual(self.request().status_code, 200)
        self.assertEqual(self.request().status_code, 200)
        self.token = self.proxy.issue(self.run, 1, self.worker.owner)
        self.assertEqual(self.request().json()["error"], "model_request_limit_reached")
        self.sql("UPDATE runs SET generation=2")
        self.sql("UPDATE jobs SET generation=2")
        self.sql("UPDATE sandbox_bindings SET generation=2")
        self.token = self.proxy.issue(self.run, 2, self.worker.owner)
        self.assertEqual(self.request().json()["error"], "model_request_limit_reached")
        self.assertEqual(len(self.upstream.calls), 2)

    def test_policy_change_cannot_silently_raise_bound_budget_or_change_destination(self):
        for policy in (
            replace(self.policy, request_limit=3),
            replace(self.policy, origin="http://127.0.0.1:12345"),
            replace(self.policy, credential="x" * 32),
        ):
            with (
                self.subTest(policy=policy),
                self.assertRaisesRegex(Problem, "model_policy_changed"),
            ):
                ModelProxy(self.db, policy).issue(self.run, 1, self.worker.owner)
        self.assert_denied_after_policy_change()

    def assert_denied_after_policy_change(self):
        changed = ModelProxy(self.db, replace(self.policy, request_limit=3))
        with self.assertRaisesRegex(Problem, "model_policy_changed"):
            changed.complete(self.run, self.token, uuid4(), Completion(**self.payload_model))
        self.assertFalse(self.upstream.calls)

    def test_429_and_timeout_remain_unknown_and_consume_slots(self):
        self.upstream.status = 429
        key = uuid4()
        self.assertEqual(self.request(request_id=key).status_code, 429)
        self.assertEqual(self.request(request_id=key).status_code, 409)
        self.upstream.status = 200
        with patch(
            "agent_platform.model_upstream.http.client.HTTPConnection.request",
            side_effect=TimeoutError("private detail"),
        ):
            result = self.request()
        self.assertEqual(result.json(), {"error": "model_upstream_unavailable"})
        self.assertEqual(self.request().json()["error"], "model_request_limit_reached")
        usage = self.usage()
        self.assertEqual(usage["uncertain_requests"], 2)
        for entry in usage["entries"]:
            self.assertEqual(entry["status"], "unknown")
            self.assertIsNone(entry["input_tokens"])
            self.assertIsNone(entry["amount_decimal"])

    def test_real_upstream_socket_timeout_stays_unknown_without_retry(self):
        self.upstream.release.clear()
        result = self.request()
        self.assertEqual(result.json(), {"error": "model_upstream_unavailable"})
        self.upstream.release.set()
        self.assertEqual(len(self.upstream.calls), 1)
        self.assertEqual(self.usage()["entries"][0]["status"], "unknown")
        self.assertIsNone(self.usage()["entries"][0]["amount_decimal"])

    def test_slow_drip_headers_obey_total_deadline_not_only_idle_timeout(self):
        self.upstream.drip_headers = True
        started = time.monotonic()
        # Exercise real byte-by-byte HTTP header I/O with a shorter test deadline.
        with patch("agent_platform.model_upstream.TOTAL_SECONDS", 2):
            result = self.request()
        self.assertEqual(result.status_code, 502)
        self.assertLess(time.monotonic() - started, 4)
        self.assertEqual(len(self.upstream.calls), 1)
        self.assertEqual(self.usage()["entries"][0]["status"], "unknown")

    def test_database_failure_before_reservation_never_reaches_provider(self):
        import psycopg

        with patch.object(self.db, "transaction", side_effect=psycopg.OperationalError("private")):
            result = self.request()
        self.assertEqual(result.json(), {"error": "model_database_unavailable"})
        self.assertEqual(result.status_code, 503)
        self.assertFalse(self.upstream.calls)
        self.assertEqual(self.usage()["request_slots_consumed"], 0)

    def test_expired_revoked_and_released_binding_deny_without_capacity_mutation(self):
        self.sql("UPDATE sandbox_bindings SET lease_deadline=clock_timestamp()")
        self.assert_denied("model_runtime_unconfirmed")
        self.sql(
            "UPDATE sandbox_bindings SET lease_deadline=clock_timestamp()+interval '30 minutes'"
        )
        self.sql("UPDATE sandbox_bindings SET desired_state='stopped'")
        self.assert_denied("model_runtime_unconfirmed")
        self.sql("UPDATE sandbox_bindings SET desired_state='running'")
        self.sql("UPDATE resource_reservations SET released_at=clock_timestamp()")
        self.assertEqual(self.request().json()["error"], "model_runtime_unconfirmed")
        self.assertFalse(self.upstream.calls)

    def test_redirect_not_followed_and_arbitrary_url_headers_not_forwarded(self):
        self.upstream.status = 302
        self.upstream.extra_headers["Location"] = "http://169.254.169.254/private"
        self.assertEqual(self.request().json()["error"], "model_upstream_rejected")
        self.assertEqual(len(self.upstream.calls), 1)
        for field in ("base_url", "headers", "api_key", "tools", "budget", "provider"):
            with self.subTest(field=field):
                self.assertEqual(
                    self.request(data={**self.payload_model, field: self.token}).status_code, 422
                )
        self.assertEqual(len(self.upstream.calls), 1)

    def test_model_allowlist_streaming_and_strict_input_types(self):
        for data, status in (
            ({**self.payload_model, "model": "another-model"}, 403),
            ({**self.payload_model, "stream": True}, 422),
            ({**self.payload_model, "max_tokens": True}, 422),
            ({**self.payload_model, "messages": [{"role": [], "content": "x"}]}, 422),
            ({**self.payload_model, "messages": [{"role": "user", "content": {"url": "x"}}]}, 422),
        ):
            with self.subTest(data=data):
                self.assertEqual(self.request(data=data).status_code, status)
        self.assertFalse(self.upstream.calls)

    def test_browser_cookie_query_and_non_json_rejected_without_upstream(self):
        for headers in ({"Origin": "https://testserver"}, {"Cookie": "session=secret"}):
            self.assertEqual(self.request(headers=headers).status_code, 403)
        self.assertEqual(self.request(path=self.path + "?token=" + self.token).status_code, 403)
        self.assertEqual(self.request(headers={"Content-Type": "text/plain"}).status_code, 415)
        self.assertFalse(self.upstream.calls)

    def test_request_body_and_response_size_bounds(self):
        self.assertEqual(
            self.request(
                data={
                    **self.payload_model,
                    "messages": [{"role": "user", "content": "x" * (129 * 1024)}],
                }
            ).status_code,
            413,
        )
        self.assertFalse(self.upstream.calls)
        self.upstream.value["choices"][0]["message"]["content"] = "x" * (257 * 1024)
        self.assertEqual(self.request().json()["error"], "model_upstream_framing_invalid")
        self.assertEqual(self.usage()["entries"][0]["status"], "unknown")

    def test_malformed_unknown_or_over_limit_usage_cannot_be_final(self):
        for usage in (None, {"prompt_tokens": 10, "completion_tokens": True, "total_tokens": 11}):
            self.upstream.value["usage"] = usage
            self.assertEqual(self.request().json()["error"], "model_response_invalid")
        self.assertEqual(self.usage()["uncertain_requests"], 2)
        self.assertEqual(self.request().status_code, 429)

    def test_usage_sum_and_output_bound_are_checked(self):
        for count, total in ((5, 99), (33, 43)):
            self.upstream.value["usage"].update(completion_tokens=count, total_tokens=total)
            self.assertEqual(self.request().json()["error"], "model_response_invalid")
        self.assertEqual(self.usage()["uncertain_requests"], 2)

    def test_truncation_and_encoded_response_are_unknown(self):
        self.upstream.truncated = True
        self.assertEqual(self.request().json()["error"], "model_upstream_truncated")
        self.upstream.truncated = False
        self.upstream.extra_headers["Content-Encoding"] = "gzip"
        self.assertEqual(self.request().json()["error"], "model_upstream_framing_invalid")

    def test_secret_in_nested_request_or_response_never_enters_public_data_or_ledger(self):
        for secret in (self.token, self.upstream.secret):
            data = {**self.payload_model, "messages": [{"role": "user", "content": secret}]}
            self.assertEqual(self.request(data=data).json()["error"], "model_sensitive_request")
        self.assertFalse(self.upstream.calls)
        for secret in (self.token, self.upstream.secret):
            self.upstream.value["choices"][0]["message"]["content"] = secret
            result = self.request()
            self.assertEqual(result.json(), {"error": "model_sensitive_response"})
        public = self.client.get(f"/api/v1/runs/{self.run}/usage").text
        with self.db.transaction() as conn:
            for table in (
                "run_events",
                "audit_events",
                "model_proxy_requests",
                "model_proxy_tokens",
            ):
                public += str(conn.execute(f"SELECT * FROM {table}").fetchall())
        for secret in (self.token, self.upstream.secret):
            self.assertNotIn(secret, public)

    def config_file(self):
        secret_file = self.root / "fixture-key"
        secret_file.write_text(self.policy.credential)
        secret_file.chmod(0o600)
        path = self.root / "model.json"
        path.write_text(
            json.dumps(
                {
                    "origin": self.policy.origin,
                    "credential_file": str(secret_file),
                    "request_limit": 2,
                    "mode": self.policy.mode,
                }
            )
        )
        path.chmod(0o600)
        return path

    def test_cli_token_written_exclusively_private_and_not_printed(self):
        config = self.config_file()
        target = self.root / "token"
        env = dict(os.environ, DATABASE_URL=URL)
        command = [
            sys.executable,
            "-m",
            "agent_platform.model_cli",
            "--config",
            str(config),
            "issue",
            "--run",
            str(self.run),
            "--generation",
            "1",
            "--lease-owner",
            str(self.worker.owner),
            "--output",
            str(target),
        ]
        result = subprocess.run(command, env=env, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"")
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.token = target.read_text().strip()
        self.assertEqual(self.request().status_code, 200)
        duplicate = subprocess.run(command, env=env, capture_output=True, timeout=15)
        self.assertEqual(duplicate.returncode, 1)
        self.assertNotIn(self.token.encode(), duplicate.stderr)
        self.assertEqual(target.read_text().strip(), self.token)

    def test_real_http_proxy_process_preserves_request_ledger_across_restart(self):
        config = self.config_file()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        command = [
            sys.executable,
            "-m",
            "agent_platform.model_cli",
            "--config",
            str(config),
            "serve",
            "--port",
            str(port),
        ]
        key = uuid4()
        for expected in (200, 409):
            process = subprocess.Popen(
                command,
                env=dict(os.environ, DATABASE_URL=URL),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False) as client:
                    deadline = time.monotonic() + 10
                    while True:
                        try:
                            if client.get("/ready-is-not-public").status_code == 404:
                                break
                        except httpx.TransportError:
                            pass
                        if process.poll() is not None or time.monotonic() > deadline:
                            self.fail("proxy process unavailable")
                        time.sleep(0.05)
                    reply = client.post(
                        self.path,
                        json=self.payload_model,
                        headers={
                            "Authorization": "Bearer " + self.token,
                            "Idempotency-Key": str(key),
                        },
                    )
                    self.assertEqual(reply.status_code, expected, reply.text)
            finally:
                process.terminate()
                process.wait(timeout=10)
        self.assertEqual(len(self.upstream.calls), 1)

    def crash(self, stage):
        config = self.config_file()
        token_file = self.root / "token"
        token_file.write_text(self.token)
        token_file.chmod(0o600)
        request_id = uuid4()
        killed = subprocess.run(
            [
                sys.executable,
                "tests_platform/model_proxy_crash.py",
                str(config),
                str(token_file),
                str(self.run),
                str(request_id),
                stage,
            ],
            capture_output=True,
            timeout=15,
        )
        self.assertEqual(killed.returncode, -signal.SIGKILL, killed.stderr.decode())
        self.assertEqual(self.request(request_id=request_id).status_code, 409)
        self.assertEqual(self.usage()["request_slots_consumed"], 1)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

    def test_sigkill_after_reservation_never_dispatches_on_restart(self):
        self.crash("reserved")
        self.assertFalse(self.upstream.calls)
        self.assertEqual(self.usage()["entries"][0]["status"], "reserved")
        self.assertEqual(self.usage()["uncertain_requests"], 1)

    def test_sigkill_after_provider_response_keeps_unknown_not_zero_or_retry(self):
        self.crash("response")
        self.assertEqual(len(self.upstream.calls), 1)
        self.assertEqual(self.usage()["entries"][0]["status"], "reserved")
        self.assertIsNone(self.usage()["entries"][0]["amount_decimal"])

    def test_sigkill_after_settlement_does_not_charge_or_dispatch_twice(self):
        self.crash("settled")
        self.assertEqual(len(self.upstream.calls), 1)
        self.assertEqual(self.usage()["entries"][0]["status"], "final")
        self.assertEqual(self.usage()["entries"][0]["input_tokens"], 10)

    def test_unconfigured_usage_explicitly_does_not_claim_zero_model_cost(self):
        other, _ = self.running()
        value = usage_view(self.db, other)
        self.assertFalse(value["configured"])
        self.assertEqual(value["entries"], [])
        self.assertIsNone(value["amount_decimal"])
        self.assertFalse(value["guest_connected"])

    def test_policy_only_supports_explicit_local_fixture_and_private_files(self):
        for origin in (
            "https://api.example.com",
            "http://localhost:18080",
            "http://169.254.169.254:18080",
            self.policy.origin + "/path",
            "http://user:secret@127.0.0.1:18080",
        ):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                replace(self.policy, origin=origin)
        with self.assertRaises(ValueError):
            replace(self.policy, mode="paid-provider")
        with self.assertRaises(ValueError):
            replace(self.policy, request_limit=True)
        config = self.config_file()
        self.assertEqual(Policy.read(config).digest, self.policy.digest)
        config.chmod(0o644)
        with self.assertRaises(ValueError):
            Policy.read(config)
        self.assertNotIn(self.policy.credential, repr(self.policy))
        public_dir = self.root / "public"
        public_dir.mkdir(mode=0o755)
        with self.assertRaises(ValueError):
            write_token(self.proxy, self.run, 1, self.worker.owner, public_dir / "token")

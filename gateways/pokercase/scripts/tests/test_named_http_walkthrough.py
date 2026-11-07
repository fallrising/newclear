"""Named HTTP fixture isolation and strict accounting evidence regressions."""
import copy
import http.client
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import unittest
from unittest import mock
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import named_http_fixture as fixture
import named_http_walkthrough as journey


def row(provider="siwc"):
    return {"usage_source": "openai_chat_v1" if provider == "opencode" else "openai_responses_v1",
            "outcome": "succeeded", "usage_status": "complete", "prompt_tokens": 11,
            "completion_tokens": 7, "estimated_cost_usd": None, "status": 200,
            "request_id": "synthetic-request", "attempt_id": "synthetic-attempt",
            "finalized_at": "synthetic-time", "headers_ms": 1, "first_output_ms": 2,
            "total_observed_ms": 3, "cli_ready_ms": None, "error": None}


class AccountingTests(unittest.TestCase):
    def test_all_provider_sources_accept_exact_observations(self):
        for provider in fixture.PROVIDERS:
            journey.require_http_row(row(provider), provider)

    def test_missing_usage_attempt_or_false_success_is_rejected(self):
        for changes in ({"prompt_tokens": None, "completion_tokens": None}, {"attempt_id": None},
                        {"request_id": ""}, {"finalized_at": None}, {"outcome": "unknown"},
                        {"usage_status": "missing"}, {"usage_source": "openai_chat_v1"},
                        {"estimated_cost_usd": 0}, {"status": None}, {"cli_ready_ms": 0},
                        {"first_output_ms": None}, {"first_output_ms": 4}, {"headers_ms": True}):
            with self.subTest(changes=changes), self.assertRaises(journey.JourneyFailure):
                journey.require_http_row({**row(), **changes}, "siwc")

    def test_zero_missing_invalid_and_failed_usage_are_independent(self):
        for counts, quality, outcome in (((0, 0), "complete", "succeeded"),
                ((None, None), "missing", "succeeded"), ((None, 7), "partial", "succeeded"),
                ((None, 7), "invalid", "succeeded"), ((11, 7), "complete", "failed")):
            observed = {**row(), "prompt_tokens": counts[0], "completion_tokens": counts[1],
                        "usage_status": quality, "outcome": outcome}
            journey.require_http_row(observed, "siwc", outcome, counts, quality)
            if counts[0] is None:
                with self.assertRaises(journey.JourneyFailure):
                    journey.require_http_row({**observed, "prompt_tokens": 0}, "siwc", outcome, counts, quality)

    def test_http401_attempt_is_not_a_zero_usage_success(self):
        observed = {**row(), "outcome": "failed", "usage_status": "missing", "status": 401,
                    "prompt_tokens": None, "completion_tokens": None, "first_output_ms": None,
                    "error": "upstream_attempt_failed"}
        journey.require_http_row(observed, "grok", "failed", (None, None), "missing", 401, False)
        with self.assertRaises(journey.JourneyFailure):
            journey.require_http_row({**observed, "first_output_ms": 0}, "grok", "failed", (None, None), "missing", 401, False)

    def test_binary_digest_guard_prevents_fixture_and_gateway_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(journey, "Fixture", side_effect=AssertionError("must not launch")), \
                 mock.patch.object(journey.subprocess, "Popen", side_effect=AssertionError("must not launch")):
                code = journey.main(["--binary", sys.executable, "--output-dir", directory,
                                     "--expected-binary-sha256", "0" * 64])
            self.assertEqual(code, 1)
            report = json.loads(next(Path(directory).glob("journey-*/report.json")).read_text())
            self.assertEqual(report["error_code"], "binary_digest_mismatch")
            self.assertEqual(report["mode"], "check")
            self.assertEqual(report["cleanup"], "not_started")

    def test_cleanup_failure_never_returns_success_or_leaks_error(self):
        class BrokenFixture:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                raise RuntimeError("private-cleanup-canary")
        def completed(_g, _f, report, _update):
            report["journey_status"] = "passed"
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(journey, "Fixture", BrokenFixture), \
             mock.patch.object(journey, "NamedGateway"), \
             mock.patch.object(journey, "preserve_evidence"), \
             mock.patch.object(journey, "run_journey", completed):
            self.assertEqual(journey.main(["--binary", sys.executable, "--output-dir", directory]), 1)
            raw = next(Path(directory).glob("journey-*/report.json")).read_text()
            self.assertNotIn("private-cleanup-canary", raw)
            self.assertEqual(json.loads(raw)["cleanup"], "failed")

    def test_serve_signal_runs_cleanup_and_preserves_default_digest(self):
        class FakeFixture:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
        def completed(_g, _f, report, _update):
            report["journey_status"] = "passed"
            os.kill(os.getpid(), signal.SIGTERM)
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(journey, "Fixture", FakeFixture), \
             mock.patch.object(journey, "NamedGateway") as gateway, \
             mock.patch.object(journey, "preserve_evidence") as preserve, \
             mock.patch.object(journey, "run_journey", completed):
            self.assertEqual(journey.main(["--serve", "--binary", sys.executable, "--output-dir", directory]), 0)
            gateway.return_value.stop.assert_called_once()
            preserve.assert_called_once()
            report = json.loads(next(Path(directory).glob("journey-*/report.json")).read_text())
            self.assertEqual(report["cleanup"], "passed")
            self.assertEqual(report["binary_sha256"], journey.digest(sys.executable))


class FixtureTests(unittest.TestCase):
    def request(self, server, method, target, body=None, token=None):
        address = urlsplit(server)
        conn = http.client.HTTPConnection(address.hostname, address.port, timeout=2)
        try:
            conn.request(method, target, json.dumps(body) if body is not None else None,
                         {"Authorization": "Bearer " + (token or fixture.Fixture.api_key),
                          "Content-Type": "application/json", "Connection": "close"})
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def test_proxy_accepts_only_exact_owned_paths_and_rejects_connect_refresh(self):
        with fixture.Fixture() as fake:
            for method, target in (("CONNECT", "auth.openai.com:443"),
                    ("POST", "https://auth.x.ai/oauth2/token"),
                    ("POST", fake.base_urls["siwc"] + "/responses?redirect=1"),
                    ("GET", "http://127.0.0.1:1/models")):
                with self.subTest(method=method, target=target):
                    self.assertEqual(self.request(fake.proxy_url, method, target)[0], 403)
            self.assertEqual(fake.denied_count, 4)
            self.assertEqual(fake.inference(), [])
            for provider in fixture.PROVIDERS:
                status, raw = self.request(fake.proxy_url, "GET", fake.base_urls[provider] + "/models")
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(raw)["data"][0]["id"], "text")
            self.assertEqual(len([event for event in fake.snapshot() if event["kind"] == "discovery"]), 3)
        self.assertFalse(any(thread.is_alive() for thread in fake._threads))

    def test_borrowed401_rotates_only_owned_synthetic_file_then_succeeds(self):
        with tempfile.TemporaryDirectory() as directory, fixture.Fixture() as fake:
            gateway = journey.NamedGateway(Path(sys.executable), fake, Path(directory))
            before = fake.borrowed_path.read_text()
            body = {"model": "borrowed", "stream": True, "input": "synthetic"}
            status, _ = self.request(fake.proxy_url, "POST", fake.base_urls["grok"] + "/responses", body, fixture.BORROWED_OLD)
            self.assertEqual(status, 401)
            self.assertNotEqual(fake.borrowed_path.read_text(), before)
            after = fake.borrowed_path.read_bytes()
            status, raw = self.request(fake.proxy_url, "POST", fake.base_urls["grok"] + "/responses", body, fixture.BORROWED_NEW)
            self.assertEqual(status, 200)
            self.assertEqual(fake.borrowed_path.read_bytes(), after)
            self.assertEqual(journey.stream_text("responses", raw), fixture.TEXT)
            self.assertEqual([event["status"] for event in fake.inference()], [401, 200])
            for provider in fixture.PROVIDERS:
                payload = journey.connection_payload(fake, provider, "fixture", borrowed=provider == "grok")
                self.assertNotIn("refresh_token", payload)
                self.assertNotIn("expires_at", payload)
                self.assertEqual(payload["base_url"], fake.base_urls[provider])
            env = gateway.command_environment()
            self.assertEqual(set(env), {"PATH", "HOME", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "RUST_LOG"})
            self.assertTrue(all(env[key] == fake.proxy_url for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY")))

    def test_tool_frames_and_raw_usage_do_not_depend_on_converted_defaults(self):
        for provider in fixture.PROVIDERS:
            raw = b"".join(fixture.make_frames(provider, "tool", phase="call"))
            protocol = "chat" if provider == "opencode" else "responses"
            result = journey.stream_tool(protocol, raw)
            followup = journey.tool_reply(protocol, journey.tool_request(protocol, "tool"), result)
            self.assertIn("call_demo_add", json.dumps(followup))
            self.assertIn(b'"input_tokens":11' if provider != "opencode" else b'"prompt_tokens":11', raw)
            missing = b"".join(fixture.make_frames(provider, "missing"))
            self.assertNotIn(b'"usage"', missing)
            zero = b"".join(fixture.make_frames(provider, "zero"))
            self.assertIn(b'"input_tokens":0' if provider != "opencode" else b'"prompt_tokens":0', zero)


if __name__ == "__main__":
    unittest.main()

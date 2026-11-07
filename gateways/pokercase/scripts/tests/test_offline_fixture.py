"""Real loopback HTTP tests for the deterministic offline upstream."""

import contextlib
import http.client
import io
import json
from pathlib import Path
import socket
import sys
import time
import unittest
from unittest import mock
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from offline_fixture import ERROR_CANARY, Fixture


TEXT = "Hello from the offline gateway."
USAGE = {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8}
TOOL = {"type": "function", "function": {"name": "add", "parameters": {
    "type": "object", "properties": {"a": {"type": "integer"},
                                       "b": {"type": "integer"}}}}}


class FixtureHTTPTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture().__enter__()
        self.addCleanup(self.fixture.close)

    def request(self, body=None, *, method="POST", path="/v1/chat/completions",
                auth=True, proxy=False, raw=None, extra_headers=None):
        address = urlsplit(self.fixture.proxy_url if proxy else self.fixture.base_url)
        connection = http.client.HTTPConnection(address.hostname, address.port, timeout=2)
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + self.fixture.api_key
        headers.update(extra_headers or {})
        if body is None:
            body = {"model": "demo-text", "messages": [{"role": "user", "content": "synthetic"}]}
        payload = raw if raw is not None else json.dumps(body).encode()
        try:
            connection.request(method, path, payload, headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def completion(self, model="demo-text", stream=False, messages=None, **kwargs):
        return self.request({"model": model, "stream": stream,
                             "messages": messages or [{"role": "user", "content": "synthetic"}],
                             **kwargs})

    def events(self, raw):
        lines = [line[6:] for line in raw.decode().splitlines() if line.startswith("data: ")]
        self.assertEqual(lines[-1], "[DONE]")
        return [json.loads(line) for line in lines[:-1]]

    def test_text_json_and_stream_have_same_content_and_trailing_usage(self):
        status, headers, body = self.completion()
        self.assertEqual(status, 200)
        result = json.loads(body)
        self.assertEqual(result["choices"][0]["message"]["content"], TEXT)
        self.assertEqual(result["usage"], USAGE)
        self.assertEqual(headers["Connection"], "close")
        status, headers, body = self.completion(stream=True)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/event-stream")
        events = self.events(body)
        pieces = [e["choices"][0]["delta"]["content"] for e in events
                  if e["choices"] and "content" in e["choices"][0]["delta"]]
        self.assertGreater(len(pieces), 1)
        self.assertEqual("".join(pieces), TEXT)
        self.assertEqual(events[-2]["choices"][0]["finish_reason"], "stop")
        self.assertEqual(events[-1]["choices"], [])
        self.assertEqual(events[-1]["usage"], USAGE)

    def test_tool_json_and_stream_roundtrips_preserve_call_and_arguments(self):
        for stream in (False, True):
            with self.subTest(stream=stream):
                status, _, raw = self.completion("demo-tool", stream, tools=[TOOL])
                self.assertEqual(status, 200)
                if stream:
                    events = self.events(raw)
                    fragments = [c for e in events if e["choices"]
                                 for c in e["choices"][0]["delta"].get("tool_calls", [])]
                    call = {"id": fragments[0]["id"], "type": fragments[0]["type"],
                            "function": {"name": fragments[0]["function"]["name"],
                                         "arguments": "".join(c["function"].get("arguments", "")
                                                              for c in fragments)}}
                    self.assertEqual(events[-2]["choices"][0]["finish_reason"], "tool_calls")
                    self.assertEqual(events[-1]["usage"], USAGE)
                else:
                    result = json.loads(raw)
                    call = result["choices"][0]["message"]["tool_calls"][0]
                    self.assertEqual(result["choices"][0]["finish_reason"], "tool_calls")
                self.assertEqual(call["id"], "call_demo_add")
                self.assertEqual(call["function"]["name"], "add")
                self.assertEqual(json.loads(call["function"]["arguments"]), {"a": 2, "b": 3})
                messages = [{"role": "user", "content": "synthetic"},
                            {"role": "assistant", "content": None, "tool_calls": [call]},
                            {"role": "tool", "tool_call_id": call["id"], "content": "5"}]
                status, _, raw = self.completion("demo-tool", stream, messages, tools=[TOOL])
                self.assertEqual(status, 200)
                if stream:
                    events = self.events(raw)
                    output = "".join(e["choices"][0]["delta"].get("content", "")
                                     for e in events if e["choices"])
                    self.assertEqual(events[-1]["usage"], USAGE)
                else:
                    result = json.loads(raw)
                    output = result["choices"][0]["message"]["content"]
                    self.assertEqual(result["usage"], USAGE)
                self.assertEqual(output, "Tool result: 5.")

    def test_invalid_tool_results_and_missing_declaration_rejected(self):
        self.assertEqual(self.completion("demo-tool")[0], 400)
        for call_id, content in (("wrong", "5"), ("call_demo_add", "6"), ("call_demo_add", 5)):
            with self.subTest(call_id=call_id, content=content):
                messages = [{"role": "tool", "tool_call_id": call_id, "content": content}]
                self.assertEqual(self.completion("demo-tool", messages=messages, tools=[TOOL])[0], 400)

    def test_malformed_oversized_auth_path_and_methods_are_rejected(self):
        self.assertEqual(self.request(auth=False)[0], 401)
        self.assertEqual(self.request(extra_headers={"Authorization": "Bearer wrong"})[0], 401)
        self.assertEqual(self.request(extra_headers={"Authorization": "Bearer \u00e9"})[0], 401)
        self.assertEqual(self.request(path="/unknown")[0], 404)
        self.assertEqual(self.request(method="GET")[0], 405)
        self.assertEqual(self.request(method="CUSTOM")[0], 405)
        self.assertEqual(self.request(raw=b"{")[0], 400)
        self.assertEqual(self.request(raw=b'{"model":"demo-text","messages":NaN}')[0], 400)
        self.assertEqual(self.request(raw=b"x" * (256 * 1024 + 1))[0], 413)
        self.assertEqual(self.request(raw=b"", extra_headers={"Content-Length": "9" * 5000})[0], 413)
        self.assertEqual(self.request(raw=b"", extra_headers={"Content-Length": "\u00b2"})[0], 400)
        self.assertEqual(self.request(extra_headers={"Transfer-Encoding": "chunked"})[0], 400)
        for body in ([], {}, {"model": "demo-text", "messages": []},
                     {"model": "demo-text", "messages": ["invalid"]},
                     {"model": "unknown", "messages": [{"role": "user", "content": "x"}]},
                     {"model": "demo-text", "messages": [{"role": "user", "content": "x"}], "stream": "true"}):
            with self.subTest(body=body):
                self.assertEqual(self.request(body)[0], 400)

    def test_error_retry_events_are_sanitized_and_snapshot_is_a_copy(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(self.completion("demo-retry")[0], 429)
            status, _, body = self.completion("demo-error")
            self.assertEqual(status, 400)
            self.assertIn(ERROR_CANARY.encode(), body)
            self.request(raw=b'{"secret":"private-request-canary"}')
        snapshot = self.fixture.snapshot()
        self.assertEqual([event["model"] for event in snapshot[:2]], ["demo-retry", "demo-error"])
        serialized = json.dumps(snapshot)
        for secret in (ERROR_CANARY, self.fixture.api_key, "private-request-canary"):
            self.assertNotIn(secret, serialized + stderr.getvalue())
        snapshot[0]["model"] = "mutated"
        self.assertEqual(self.fixture.snapshot()[0]["model"], "demo-retry")
        self.assertEqual(stderr.getvalue(), "")

    def test_proxy_allows_only_exact_owned_endpoint_without_forwarding(self):
        endpoint = self.fixture.base_url + "/chat/completions"
        # http.client resolves only the owned loopback listener. Any attempted
        # forwarding via a second connection would fail this assertion.
        original = socket.create_connection
        connected = []
        def tracked(address, *args, **kwargs):
            connected.append(address)
            return original(address, *args, **kwargs)
        with mock.patch("socket.create_connection", side_effect=tracked):
            self.assertEqual(self.request(proxy=True, path=endpoint)[0], 200)
            denied = [("GET", endpoint), ("POST", endpoint + "?secret=x"),
                      ("POST", endpoint.replace("127.0.0.1", "localhost")),
                      ("POST", "http://never-resolve.invalid/v1/chat/completions"),
                      ("CONNECT", "never-resolve.invalid:443"),
                      ("CUSTOM", endpoint),
                      ("POST", "/v1/chat/completions")]
            for method, path in denied:
                self.assertEqual(self.request(proxy=True, method=method, path=path)[0], 403)
        self.assertEqual(self.fixture.denied_count, len(denied))
        proxy_port = urlsplit(self.fixture.proxy_url).port
        self.assertEqual(connected, [("127.0.0.1", proxy_port)] * (len(denied) + 1))
        self.assertNotIn("never-resolve", json.dumps(self.fixture.snapshot()))

    def test_request_event_retention_is_bounded(self):
        for _ in range(520):
            self.assertEqual(self.request(method="GET")[0], 405)
        snapshot = self.fixture.snapshot()
        self.assertLessEqual(len(snapshot), 512)
        self.assertEqual(snapshot[-1]["sequence"], 520)
        self.assertGreater(snapshot[0]["sequence"], 1)

    def open_cancel(self):
        address = urlsplit(self.fixture.base_url)
        connection = http.client.HTTPConnection(address.hostname, address.port, timeout=2)
        connection.request("POST", "/v1/chat/completions", json.dumps({
            "model": "demo-cancel", "stream": True,
            "messages": [{"role": "user", "content": "synthetic"}]}),
            {"Authorization": "Bearer " + self.fixture.api_key, "Content-Type": "application/json"})
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertTrue(response.readline().startswith(b"data: "))
        return connection, response

    def test_cancellation_requires_observed_peer_close(self):
        connection, response = self.open_cancel()
        self.assertFalse(self.fixture.cancel_seen.is_set())
        response.close()
        connection.close()
        self.assertTrue(self.fixture.cancel_seen.wait(2), "fixture did not observe downstream close")

    def test_owned_cleanup_is_bounded_idempotent_and_not_cancellation(self):
        other = Fixture().__enter__()
        self.addCleanup(other.close)
        connection, response = self.open_cancel()
        started = time.monotonic()
        self.fixture.close()
        self.fixture.close()
        self.assertLess(time.monotonic() - started, 3)
        self.assertFalse(self.fixture.cancel_seen.is_set())
        response.close()
        connection.close()
        for url in (self.fixture.base_url, self.fixture.proxy_url):
            address = urlsplit(url)
            with self.assertRaises(OSError):
                socket.create_connection((address.hostname, address.port), timeout=.2)
        address = urlsplit(other.base_url)
        connection = http.client.HTTPConnection(address.hostname, address.port, timeout=2)
        connection.request("GET", "/")
        self.assertEqual(connection.getresponse().status, 405)
        connection.close()


if __name__ == "__main__":
    unittest.main()

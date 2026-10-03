"""Mock-only GitHub tool contract: no live network or operator credentials."""

import base64
import json
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import uuid4

from agent_platform.domain import Problem
from agent_platform.tool_broker.adapter import Adapter
from agent_platform.tool_broker.policy import MAX_FILE, MAX_RESPONSE, Policy, normalize_request
from agent_platform.tool_broker.transport import (
    MockTransport,
    PublicGitHubConnection,
    public_addresses,
)

COMMIT, TREE, BLOB = "a" * 40, "b" * 40, "c" * 40
SECRET = "fixture-canary-tool-secret"


class MockGitHub:
    def __init__(self, tls_context=None):
        self.calls = []
        self.responses = {
            "/repos/example/project": {"id": 123, "full_name": "example/project", "private": True},
            "/repos/example/project/issues/7": {
                "number": 7,
                "title": "Fixture",
                "body": "body",
                "state": "open",
            },
            f"/repos/example/project/git/commits/{COMMIT}": {"sha": COMMIT, "tree": {"sha": TREE}},
            f"/repos/example/project/git/trees/{TREE}": {
                "sha": TREE,
                "truncated": False,
                "tree": [{"path": "readme.txt", "mode": "100644", "type": "blob", "sha": BLOB}],
            },
            f"/repos/example/project/git/blobs/{BLOB}": {
                "sha": BLOB,
                "encoding": "base64",
                "size": 5,
                "content": base64.b64encode(b"hello").decode(),
            },
        }
        self.status, self.extra_headers = 200, []
        self.raw = None
        self.delay_headers = 0
        self.drip_body = False
        self.drip_headers = False
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                owner.calls.append((self.path, dict(self.headers)))
                raw = (
                    owner.raw
                    if owner.raw is not None
                    else json.dumps(owner.responses.get(self.path, {})).encode()
                )
                time.sleep(owner.delay_headers)
                if owner.drip_headers:
                    try:
                        for char in b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n":
                            self.wfile.write(bytes((char,)))
                            self.wfile.flush()
                            time.sleep(0.025)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                    return
                self.send_response(owner.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                for key, value in owner.extra_headers:
                    self.send_header(key, value)
                self.end_headers()
                try:
                    if owner.drip_body:
                        for char in raw:
                            self.wfile.write(bytes((char,)))
                            self.wfile.flush()
                            time.sleep(0.025)
                    else:
                        self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        if tls_context is not None:
            self.server.socket = tls_context.wrap_socket(self.server.socket, server_side=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)


class ToolTransportTests(unittest.TestCase):
    def setUp(self):
        self.mock = MockGitHub()
        self.addCleanup(self.mock.close)
        self.policy = Policy(
            service_id=uuid4(),
            credential_revision=uuid4(),
            origin=self.mock.origin,
            credential_origin=self.mock.origin,
            credential_path_prefix="/repos/example/project/",
            secret=SECRET,
            repository_id=123,
            owner="example",
            repository="project",
            commit=COMMIT,
            paths=("readme.txt",),
            issues=(7,),
        )
        self.hops = 0

    def hop(self):
        self.hops += 1

    def payload(self, kind="repository", **kwargs):
        return {"operation": f"github.{kind}.get", "repository_id": 123, **kwargs}

    def execute(self, payload=None, policy=None):
        return Adapter(policy or self.policy).execute(
            payload or self.payload(), before_hop=self.hop
        )

    def test_request_rejects_scope_and_untrusted_identity_before_network(self):
        invalid = [
            self.payload(run_id=str(uuid4())),
            self.payload(headers={}),
            self.payload(url="https://example.com"),
            self.payload("write"),
            {**self.payload(), "repository_id": 124},
            {**self.payload(), "repository_id": True},
            self.payload("issue", issue_number=8),
            self.payload("issue", issue_number=True),
            self.payload("file", commit="d" * 40, path="readme.txt"),
        ]
        for path in (
            "../readme.txt",
            "/readme.txt",
            "readme%2etxt",
            "a//b",
            "a\\b",
            "a/./b",
            "a\x85b",
        ):
            invalid.append(self.payload("file", commit=COMMIT, path=path))
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(Problem):
                self.execute(payload)
        self.assertEqual(self.mock.calls, [])
        self.assertEqual(self.hops, 0)

    def test_credential_binding_independent_of_network(self):
        for changes in (
            {"credential_origin": "http://127.0.0.1:1"},
            {"credential_path_prefix": "/repos/example/other/"},
        ):
            with self.subTest(changes=changes), self.assertRaises(Problem):
                normalize_request(replace(self.policy, **changes), self.payload())
        self.assertEqual(self.mock.calls, [])

    def test_read_operations_whitelist_and_inject_only_service_credential(self):
        self.mock.responses["/repos/example/project"]["url"] = "https://untrusted.invalid"
        with patch.dict("os.environ", {"HTTP_PROXY": "http://127.0.0.1:1"}):
            result = self.execute()
        self.assertEqual(result.value, {"id": 123, "full_name": "example/project", "private": True})
        self.assertEqual(result.http_calls, 1)
        self.assertEqual(self.hops, 1)
        self.assertNotIn(SECRET, repr(result))
        self.assertNotIn(SECRET, repr(self.policy))
        self.assertEqual(self.mock.calls[0][1]["Authorization"], "Bearer " + SECRET)
        self.assertEqual(self.execute(self.payload("issue", issue_number=7)).value["number"], 7)
        file = self.execute(self.payload("file", commit=COMMIT, path="readme.txt"))
        self.assertEqual(file.http_calls, 4)
        self.assertEqual(base64.b64decode(file.value["content"]), b"hello")
        self.assertEqual(len(self.mock.calls), 7)

    def test_every_operation_checks_current_repository_identity(self):
        self.mock.responses["/repos/example/project"]["id"] = 999
        for payload in (
            self.payload(),
            self.payload("issue", issue_number=7),
            self.payload("file", commit=COMMIT, path="readme.txt"),
        ):
            with self.assertRaises(Problem):
                self.execute(payload)
        self.assertEqual([call[0] for call in self.mock.calls], ["/repos/example/project"] * 3)

    def test_no_symlink_submodule_or_truncated_tree(self):
        tree = self.mock.responses[f"/repos/example/project/git/trees/{TREE}"]
        for mode in ("120000", "160000"):
            tree["tree"][0]["mode"] = mode
            with self.assertRaises(Problem):
                self.execute(self.payload("file", commit=COMMIT, path="readme.txt"))
        tree["tree"][0]["mode"] = "100644"
        tree["truncated"] = True
        with self.assertRaises(Problem):
            self.execute(self.payload("file", commit=COMMIT, path="readme.txt"))
        self.assertFalse(any("/blobs/" in path for path, _ in self.mock.calls))

    def test_redirect_rate_limit_compression_and_secret_echo_rejected(self):
        for status in (301, 302, 429, 500):
            self.mock.status = status
            before = len(self.mock.calls)
            with self.assertRaises(Problem):
                self.execute()
            self.assertEqual(len(self.mock.calls), before + 1)
        self.mock.status = 200
        self.mock.extra_headers = [("Content-Encoding", "gzip")]
        with self.assertRaises(Problem):
            self.execute()
        self.mock.extra_headers = []
        self.mock.responses["/repos/example/project"]["description"] = SECRET
        with self.assertRaises(Problem) as caught:
            self.execute()
        self.assertNotIn(SECRET, str(caught.exception))

    def test_quote_backslash_secret_echo_rejected_in_decoded_keys_and_values(self):
        secret = 'fixture-"quoted-\\token-secret'
        policy = replace(self.policy, secret=secret)
        repository = self.mock.responses["/repos/example/project"]
        for echo in ({"nested": [secret]}, {secret: "value"}):
            repository["unprojected"] = echo
            with self.subTest(case="decoded key" if secret in echo else "decoded value"):
                with self.assertRaises(Problem) as caught:
                    self.execute(policy=policy)
                self.assertEqual(caught.exception.code, "tool_secret_echo")
                self.assertNotIn(secret, str(caught.exception))

    def test_revocation_before_each_hop_stops_dispatch(self):
        def revoke():
            if self.hops == 1:
                raise Problem(403, "tool_revoked")
            self.hop()

        with self.assertRaises(Problem):
            Adapter(self.policy).execute(self.payload("issue", issue_number=7), before_hop=revoke)
        self.assertEqual(len(self.mock.calls), 1)

    def test_policy_pins_rotation_limits_and_mock_only_origin(self):
        self.assertNotEqual(self.policy.digest, replace(self.policy, secret=SECRET + "2").digest)
        self.assertNotEqual(
            self.policy.digest, replace(self.policy, credential_revision=uuid4()).digest
        )
        for changes in (
            {"origin": "https://api.github.com"},
            {"request_limit": 101},
            {"in_flight_limit": 3},
            {"total_timeout": 11},
            {"paths": ("a/b/c/d/e",)},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                replace(self.policy, **changes)

    def test_malformed_json_duplicate_keys_and_framing_fail_closed(self):
        for raw in (b"{}{}", b"[]", b'{"id":123,"id":123}', b'{"id":NaN}', b"\xff"):
            self.mock.raw = raw
            with self.subTest(raw=raw), self.assertRaises(Problem):
                self.execute()
        self.mock.raw = None
        for headers in (
            [("Content-Length", "1")],
            [("Content-Length", "9" * 5000)],
            [("Content-Encoding", "")],
            [("Content-Type", "text/html")],
            [("Transfer-Encoding", "chunked")],
        ):
            self.mock.extra_headers = headers
            with self.subTest(headers=headers), self.assertRaises(Problem):
                self.execute()

    def test_cumulative_response_cap_and_decoded_file_cap(self):
        self.mock.responses["/repos/example/project"]["padding"] = "x" * (MAX_RESPONSE // 2)
        self.mock.responses["/repos/example/project/issues/7"]["body"] = "x" * (MAX_RESPONSE // 2)
        with self.assertRaises(Problem) as caught:
            self.execute(self.payload("issue", issue_number=7))
        self.assertEqual(caught.exception.code, "tool_upstream_framing")
        self.mock.responses["/repos/example/project"].pop("padding")
        blob = self.mock.responses[f"/repos/example/project/git/blobs/{BLOB}"]
        blob["size"] = MAX_FILE + 1
        with self.assertRaises(Problem):
            self.execute(self.payload("file", commit=COMMIT, path="readme.txt"))
        blob["size"] = len(SECRET)
        blob["content"] = base64.b64encode(SECRET.encode()).decode()
        with self.assertRaises(Problem) as caught:
            self.execute(self.payload("file", commit=COMMIT, path="readme.txt"))
        self.assertEqual(caught.exception.code, "tool_secret_echo")

    def test_tree_sha_blob_sha_and_repo_name_drift_rejected(self):
        self.mock.responses["/repos/example/project"]["full_name"] = "example/renamed"
        with self.assertRaises(Problem):
            self.execute()
        self.mock.responses["/repos/example/project"]["full_name"] = "example/project"
        for path in (
            f"/repos/example/project/git/commits/{COMMIT}",
            f"/repos/example/project/git/trees/{TREE}",
            f"/repos/example/project/git/blobs/{BLOB}",
        ):
            previous = self.mock.responses[path]["sha"]
            self.mock.responses[path]["sha"] = "d" * 40
            with self.subTest(path=path), self.assertRaises(Problem):
                self.execute(self.payload("file", commit=COMMIT, path="readme.txt"))
            self.mock.responses[path]["sha"] = previous

    def test_four_segment_path_seven_calls_no_sibling_projection(self):
        tree = self.mock.responses[f"/repos/example/project/git/trees/{TREE}"]
        for index, segment in enumerate(("a", "b", "c")):
            next_sha = str(index + 1) * 40
            tree["tree"] = [{"path": segment, "mode": "040000", "type": "tree", "sha": next_sha}]
            tree = {"sha": next_sha, "truncated": False, "tree": []}
            self.mock.responses[f"/repos/example/project/git/trees/{next_sha}"] = tree
        tree["tree"] = [
            {"path": "readme.txt", "mode": "100755", "type": "blob", "sha": BLOB},
            {"path": "private-sibling", "mode": "100644", "type": "blob", "sha": "d" * 40},
        ]
        policy = replace(self.policy, paths=("a/b/c/readme.txt",))
        result = self.execute(self.payload("file", commit=COMMIT, path="a/b/c/readme.txt"), policy)
        self.assertEqual(result.http_calls, 7)
        self.assertNotIn("private-sibling", repr(result))

    def test_transport_hop_budget_and_binding_on_every_hop(self):
        transport = MockTransport(self.policy, self.hop)
        for _ in range(8):
            transport.get(self.policy.repository_path)
        with self.assertRaises(Problem) as caught:
            transport.get(self.policy.repository_path)
        self.assertEqual(caught.exception.code, "tool_http_limit")
        self.assertEqual(self.hops, 8)
        with self.assertRaises(Problem):
            MockTransport(self.policy, self.hop).get("/repos/example/project-evil")
        self.assertEqual(self.hops, 8)

    def test_total_timeout_bounds_slow_headers_and_dripping_body(self):
        policy = replace(self.policy, total_timeout=0.15, idle_timeout=0.1)
        self.mock.delay_headers = 0.3
        start = time.monotonic()
        with self.assertRaises(Problem):
            self.execute(policy=policy)
        self.assertLess(time.monotonic() - start, 0.6)
        self.mock.delay_headers = 0
        self.mock.drip_body = True
        start = time.monotonic()
        with self.assertRaises(Problem):
            self.execute(policy=policy)
        self.assertLess(time.monotonic() - start, 0.6)
        self.mock.drip_body = False
        self.mock.drip_headers = True
        start = time.monotonic()
        with self.assertRaises(Problem):
            self.execute(policy=policy)
        self.assertLess(time.monotonic() - start, 0.6)
        self.assertEqual(len(self.mock.calls), 3)


class PublicDialGuardTests(unittest.TestCase):
    def answer(self, ip):
        family = socket.AF_INET6 if ":" in ip else socket.AF_INET
        address = (ip, 443, 0, 0) if family == socket.AF_INET6 else (ip, 443)
        return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", address)

    def test_special_addresses_and_mixed_public_private_dns_fail_closed(self):
        for ip in (
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "::",
            "fe80::1",
            "fc00::1",
            "ff02::1",
            "::ffff:8.8.8.8",
            "2002:0a00:0001::",
            "64:ff9b::a00:1",
            "192.0.2.1",
        ):
            with (
                self.subTest(ip=ip),
                patch("socket.getaddrinfo", return_value=[self.answer("8.8.8.8"), self.answer(ip)]),
                self.assertRaises(Problem),
            ):
                public_addresses("api.github.com", 443)
        with self.assertRaises(Problem):
            public_addresses("elsewhere.invalid", 443)

    def test_checked_address_is_dialed_once_with_verified_hostname_sni(self):
        context = MagicMock()
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        sock = MagicMock()
        with (
            patch("socket.getaddrinfo", return_value=[self.answer("8.8.8.8")]) as resolve,
            patch("socket.socket", return_value=sock),
        ):
            connection = PublicGitHubConnection(context=context)
            connection.connect()
        resolve.assert_called_once_with("api.github.com", 443, type=socket.SOCK_STREAM)
        sock.connect.assert_called_once_with(("8.8.8.8", 443))
        context.wrap_socket.assert_called_once_with(sock, server_hostname="api.github.com")

    def test_tls_verification_cannot_be_disabled_and_failure_has_no_fallback(self):
        with self.assertRaises(ValueError):
            PublicGitHubConnection(context=ssl._create_unverified_context())
        context = MagicMock()
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        context.wrap_socket.side_effect = ssl.SSLCertVerificationError()
        sock = MagicMock()
        with (
            patch(
                "socket.getaddrinfo", return_value=[self.answer("8.8.8.8"), self.answer("1.1.1.1")]
            ),
            patch("socket.socket", return_value=sock),
            self.assertRaises(ssl.SSLCertVerificationError),
        ):
            PublicGitHubConnection(context=context).connect()
        sock.connect.assert_called_once_with(("8.8.8.8", 443))
        sock.close.assert_called_once()

    def test_real_tls_hostname_chain_and_selected_socket(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            certificate, key = root / "fixture.crt", root / "fixture.key"
            subprocess.run(
                [
                    "openssl",
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-nodes",
                    "-keyout",
                    str(key),
                    "-out",
                    str(certificate),
                    "-days",
                    "1",
                    "-subj",
                    "/CN=api.github.com",
                    "-addext",
                    "subjectAltName=DNS:api.github.com",
                    "-addext",
                    "basicConstraints=critical,CA:TRUE",
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.load_cert_chain(certificate, key)
            fixture = MockGitHub(tls_context=server_context)
            try:
                answer = (
                    socket.AF_INET,
                    socket.SOCK_STREAM,
                    socket.IPPROTO_TCP,
                    ("127.0.0.1", fixture.server.server_port),
                )
                trusted = ssl.create_default_context(cafile=str(certificate))
                # The resolver is substituted only to exercise real TLS locally. Its public-IP
                # rejection and actual socket address binding are covered independently above.
                with patch(
                    "agent_platform.tool_broker.transport.public_addresses", return_value=[answer]
                ):
                    connection = PublicGitHubConnection(context=trusted)
                    try:
                        connection.request("GET", "/repos/example/project")
                        response = connection.getresponse()
                        self.assertEqual(response.status, 200)
                        response.read()
                    finally:
                        connection.close()
                    for context, host in (
                        (ssl.create_default_context(), "api.github.com"),
                        (trusted, "wrong.invalid"),
                    ):
                        connection = PublicGitHubConnection(context=context)
                        connection.host = host
                        try:
                            with self.assertRaises(ssl.SSLCertVerificationError):
                                connection.connect()
                        finally:
                            connection.close()
                self.assertEqual(len(fixture.calls), 1)
            finally:
                fixture.close()

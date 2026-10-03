"""Local TLS acceptance for the control-side OpenAI-compatible HTTPS transport."""

import json
import os
import secrets
import ssl
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from agent_platform.domain import Problem
from agent_platform.model_dialect import sdk_response
from agent_platform.model_mock import mock_response
from agent_platform.model_policy import HTTPS_MODE, Policy, canonical
from agent_platform.model_upstream import FixtureUpstream

MODEL = "local/https-test-model"
RUN_ID = str(uuid4())


class TLSServer:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.certificate = self.directory / "localhost.crt"
        self.private_key = self.directory / "localhost.key"
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                str(self.private_key),
                "-out",
                str(self.certificate),
                "-days",
                "3",
                "-subj",
                "/CN=localhost",
                "-addext",
                "subjectAltName=DNS:localhost",
                "-addext",
                "basicConstraints=critical,CA:TRUE",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        os.chmod(self.certificate, 0o600)
        os.chmod(self.private_key, 0o600)
        self.calls = []
        self.status = 200
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                owner.calls.append(
                    {
                        "path": self.path,
                        "authorization": self.headers.get("Authorization"),
                        "test_run_header": self.headers.get("X-Local-Mock-Run-Id"),
                        "body": json.loads(body),
                    }
                )
                if owner.status != 200:
                    self.send_response(owner.status)
                    self.send_header("Location", "http://127.0.0.1:1/redirect-target")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                raw = canonical(mock_response(owner.calls[-1]["body"], RUN_ID))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.certificate, self.private_key)
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.endpoint = f"https://localhost:{self.server.server_port}/v1/chat/completions"

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)


class HTTPSProviderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tls = TLSServer(self.root)
        self.addCleanup(self.tls.close)
        self.token = "synthetic-test-token-" + secrets.token_urlsafe(24)
        self.secret_file = self.root / "provider.secret"
        self.secret_file.write_text(self.token)
        os.chmod(self.secret_file, 0o600)
        self.config_file = self.root / "model.json"
        self.write_config()
        self.policy = Policy.read(self.config_file)
        self.payload = {
            "model": MODEL,
            "messages": [{"role": "user", "content": "local TLS transport test"}],
            "tools": [{"type": "function", "function": {"name": "terminal"}}],
            "max_tokens": 32,
            "stream": False,
        }

    def write_config(self, *, endpoint=None, ca_file=True):
        value = {
            "mode": HTTPS_MODE,
            "endpoint": endpoint or self.tls.endpoint,
            "credential_ref": str(self.secret_file),
            "request_limit": 2,
            "model": MODEL,
        }
        if ca_file:
            value["ca_bundle_file"] = str(self.tls.certificate)
        self.config_file.write_text(json.dumps(value))
        os.chmod(self.config_file, 0o600)

    def test_tls_hostname_auth_exact_path_no_proxy_or_mock_header(self):
        with patch.dict(os.environ, {"HTTPS_PROXY": "http://127.0.0.1:1", "https_proxy": ""}):
            raw = FixtureUpstream(self.policy).complete(self.payload)
        self.assertEqual(len(self.tls.calls), 1)
        request = self.tls.calls[0]
        self.assertEqual(request["path"], "/v1/chat/completions")
        self.assertEqual(request["authorization"], "Bearer " + self.token)
        self.assertIsNone(request["test_run_header"])
        value, usage = sdk_response(raw, self.payload, (self.token,), compatible=True)
        self.assertEqual(value["model"], MODEL)
        self.assertEqual(usage["total_tokens"], 15)
        self.assertNotIn(self.token, repr(self.policy))

    def test_redirect_is_rejected_without_following_or_replaying_auth(self):
        self.tls.status = 302
        with self.assertRaises(Problem) as caught:
            FixtureUpstream(self.policy).complete(self.payload)
        self.assertEqual(caught.exception.code, "model_upstream_rejected")
        self.assertEqual(len(self.tls.calls), 1)
        self.assertEqual(self.tls.calls[0]["authorization"], "Bearer " + self.token)

    def test_hostname_mismatch_and_untrusted_certificate_fail_closed(self):
        ip_policy = Policy(
            self.tls.endpoint.replace("localhost", "127.0.0.1"),
            self.token,
            mode=HTTPS_MODE,
            model=MODEL,
            ca_bundle=self.tls.certificate.read_bytes(),
        )
        with self.assertRaises(Problem):
            FixtureUpstream(ip_policy).complete(self.payload)
        self.write_config(ca_file=False)
        untrusted = Policy.read(self.config_file)
        with self.assertRaises(Problem):
            FixtureUpstream(untrusted).complete(self.payload)
        self.assertEqual(self.tls.calls, [])

    def test_endpoint_rejects_ambiguous_or_unsafe_url_forms(self):
        for endpoint in (
            self.tls.endpoint.replace("https://", "http://"),
            self.tls.endpoint.replace("https://", "https://user@"),
            self.tls.endpoint + "?",
            self.tls.endpoint + "#",
            self.tls.endpoint.replace("/v1/chat/completions", "/v1/../admin"),
            self.tls.endpoint.replace("localhost", "bad_host"),
        ):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                Policy(endpoint, self.token, mode=HTTPS_MODE, model=MODEL)

    def test_secret_reference_is_owner_private_and_policy_digest_tracks_rotation(self):
        first = self.policy.digest
        self.secret_file.write_text("synthetic-rotated-token-" + secrets.token_urlsafe(24))
        changed = Policy.read(self.config_file)
        self.assertNotEqual(first, changed.digest)
        symlink = self.root / "symlink.secret"
        symlink.symlink_to(self.secret_file)
        config = json.loads(self.config_file.read_text())
        config["credential_ref"] = str(symlink)
        self.config_file.write_text(json.dumps(config))
        with self.assertRaises(ValueError):
            Policy.read(self.config_file)
        config["credential_ref"] = str(self.secret_file)
        self.config_file.write_text(json.dumps(config))
        os.chmod(self.secret_file, 0o644)
        with self.assertRaises(ValueError):
            Policy.read(self.config_file)


if __name__ == "__main__":
    unittest.main()

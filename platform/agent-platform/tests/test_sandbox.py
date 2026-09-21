import json
import tempfile
import threading
import unittest
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cocoonsandbox import APIError

from agent_platform_m0.contracts import OPENHANDS_BINARY_SHA256
from agent_platform_m0.preflight import cpu_capabilities
from agent_platform_m0.sandbox_client import SingleNodeClient
from agent_platform_m0.sandbox_smoke import Config, run, wait_stopped
from agent_platform_m0.transport import ProbeError

TEMPLATE = "registry.example/guest@sha256:" + "a" * 64


class SDKWireTests(unittest.TestCase):
    """Exercise the real pinned SDK against an HTTP fixture, not a MicroVM."""

    def setUp(self):
        self.calls = []
        self.status = 200
        self.reply = {"id": "sb-fixture", "token": "claim-secret"}
        test = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                test.calls.append(
                    (self.path, self.headers.get("Authorization"), json.loads(raw) if raw else None)
                )
                body = json.dumps(test.reply).encode()
                self.send_response(test.status)
                if test.status == 302:
                    self.send_header("Location", test.origin + "/must-not-follow")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.client = SingleNodeClient(self.origin, "operator-secret")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_claim_scope_and_release_bearer(self):
        sandbox = self.client.new(
            TEMPLATE, net="none", size="medium", ttl_seconds=900, claim_ref="owned"
        )
        body = self.calls[0][2]
        self.assertEqual(body["net"], "none")
        self.assertTrue(body["no_redirect"])
        self.assertEqual(body["claim_ref"], "owned")
        self.assertEqual(self.calls[0][1], "Bearer operator-secret")
        self.status = 404
        sandbox.close()
        sandbox.close()
        self.assertEqual([c[1] for c in self.calls[1:]], ["Bearer claim-secret"] * 2)

    def test_server_error_does_not_retry_allocation(self):
        self.status = 503
        with self.assertRaises(APIError):
            self.client.new(TEMPLATE)
        self.assertEqual(len(self.calls), 1)

    def test_http_redirect_never_receives_bearer(self):
        self.status = 302
        with self.assertRaises(APIError):
            self.client.new(TEMPLATE)
        self.assertEqual(len(self.calls), 1)

    def test_placement_redirect_does_not_retry_origin_or_peer(self):
        self.reply = {"redirect": [self.origin]}
        with self.assertRaisesRegex(ProbeError, "placement_redirect_refused"):
            self.client.new(TEMPLATE)
        self.assertEqual(len(self.calls), 1)

    def test_owner_change_and_relay_destination_rejected(self):
        self.reply["owner_addr"] = "https://other.example"
        with self.assertRaisesRegex(ProbeError, "sandbox_origin_changed"):
            self.client.new(TEMPLATE)
        with self.assertRaisesRegex(ProbeError, "sandbox_origin_changed"):
            self.client._dial("https://other.example", "sb-fixture", "secret")
        self.assertEqual(len(self.calls), 1)

    def test_invalid_id_rejected_before_use_in_path(self):
        self.reply["id"] = "../other/release"
        with self.assertRaisesRegex(ProbeError, "invalid_sandbox_id"):
            self.client.new(TEMPLATE)


class FakeListener:
    def getsockname(self):
        return ("127.0.0.1", 12345)

    def shutdown(self, _):
        pass

    def close(self):
        pass


class FakeSandbox:
    id = "sb-fixture"
    template_digest = ""
    deadline = (datetime.now(UTC) + timedelta(minutes=15)).isoformat()

    def __init__(self):
        self.releases = 0
        self.fail_release = False
        self.spawns = []

    def exec(self, *args, **kwargs):
        return OPENHANDS_BINARY_SHA256 + "  /usr/local/bin/openhands-agent-server"

    def write_file(self, path, data, mode):
        self.written = (path, mode)

    def spawn(self, *args, **kwargs):
        self.spawns.append((args, kwargs))
        return len(self.spawns)

    def proxy_port(self, addr, port):
        self.proxy = (addr, port)
        return FakeListener()

    def kill(self, pid, signal):
        self.killed = (pid, signal)

    def ps(self):
        return []

    def close(self):
        self.releases += 1
        if self.fail_release:
            raise RuntimeError("upstream body with secret")


class FakeClient:
    def __init__(self):
        self.sandbox = FakeSandbox()
        self.allocations = 0
        self.ambiguous = False
        self.still_listed = False
        self.reported_template = TEMPLATE

    def new(self, template, **kwargs):
        self.allocations += 1
        self.claim = kwargs
        if self.ambiguous:
            raise TimeoutError("operator-secret")
        return self.sandbox

    def sandboxes(self):
        if self.ambiguous or self.still_listed or self.sandbox.releases == 0:
            return [
                {
                    "id": self.sandbox.id,
                    "claim_ref": self.claim["claim_ref"],
                    "deadline": self.sandbox.deadline,
                    "key": {
                        "template": self.reported_template,
                        "net": "none",
                        "size": self.claim["size"],
                    },
                }
            ]
        return []


class FakeProbe:
    def __init__(self, http, journal, report):
        self.report = report

    def check_server(self):
        pass

    def create(self):
        pass

    def lifecycle(self):
        return []

    def after_restart(self, events, restart_scope):
        if restart_scope != "guest_process":
            raise AssertionError("not a VM or container restart")


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.output = Path(self.directory.name) / "run"
        self.client = FakeClient()
        self.config = Config("http://127.0.0.1:7777", TEMPLATE)

    def tearDown(self):
        self.directory.cleanup()

    def run_probe(self, probe=FakeProbe):
        return run(
            self.config,
            "operator-secret",
            self.output,
            client_factory=lambda *_: self.client,
            probe_factory=probe,
        )

    def test_success_does_not_claim_vm_stop_or_full_m0(self):
        report = self.run_probe()
        self.assertTrue(report["sandbox_contract_passed"])
        self.assertFalse(report["vm_removal_confirmed"])
        self.assertFalse(report["full_m0_complete"])
        self.assertEqual(self.client.sandbox.releases, 2)
        self.assertEqual(self.client.claim["net"], "none")
        self.assertEqual(self.client.sandbox.proxy, ("127.0.0.1:0", 8000))
        self.assertNotIn("operator-secret", (self.output / "report.json").read_text())
        self.assertEqual((self.output / "report.json").stat().st_mode & 0o777, 0o600)
        self.assertTrue(
            all(kwargs["user"] == "agentprobe" for _, kwargs in self.client.sandbox.spawns)
        )

    def test_wrong_template_key_releases_without_starting_processes(self):
        self.client.reported_template = "image:mutable"
        report = self.run_probe()
        self.assertEqual(report["error"], "claimed_template_key_mismatch")
        self.assertEqual(self.client.sandbox.releases, 2)
        self.assertEqual(self.client.sandbox.spawns, [])

    def test_promoted_snapshot_digest_is_not_an_oci_digest(self):
        self.client.sandbox.template_digest = "sha256:" + "a" * 64
        report = self.run_probe()
        self.assertEqual(report["error"], "promoted_template_not_supported")
        self.assertEqual(self.client.sandbox.releases, 2)

    def test_short_lease_releases(self):
        self.client.sandbox.deadline = datetime.now(UTC).isoformat()
        report = self.run_probe()
        self.assertEqual(report["error"], "claim_remaining_ttl_too_short")
        self.assertEqual(self.client.sandbox.releases, 2)

    def test_ambiguous_allocation_never_retries_or_claims_cleanup(self):
        self.client.ambiguous = True
        report = self.run_probe()
        self.assertEqual(self.client.allocations, 1)
        self.assertEqual(report["checks"]["allocation_reconciliation"], "operator_required")
        self.assertEqual(report["matching_claims"][0]["id"], self.client.sandbox.id)
        self.assertFalse(report["sandbox_contract_passed"])
        self.assertNotIn("operator-secret", (self.output / "report.json").read_text())

    def test_release_error_and_stale_claim_cannot_pass(self):
        self.client.sandbox.fail_release = True
        self.assertFalse(self.run_probe()["sandbox_contract_passed"])
        self.output = self.output.with_name("second")
        self.client.sandbox.fail_release = False
        self.client.still_listed = True
        self.assertFalse(self.run_probe()["sandbox_contract_passed"])

    def test_interrupt_still_releases(self):
        class InterruptProbe(FakeProbe):
            def create(self):
                raise KeyboardInterrupt

        report = self.run_probe(InterruptProbe)
        self.assertEqual(report["error"], "KeyboardInterrupt")
        self.assertEqual(self.client.sandbox.releases, 2)

    def test_configuration_rejected_before_allocation(self):
        for config in (
            Config("http://remote.example", TEMPLATE),
            Config(self.config.origin, "image:latest"),
            Config(self.config.origin, TEMPLATE, ttl_seconds=100),
            Config(self.config.origin, TEMPLATE, size="small"),
        ):
            with self.subTest(config=config), self.assertRaises(ProbeError):
                config.validate()
        self.assertEqual(self.client.allocations, 0)

    def test_cpu_diagnosis_does_not_confuse_hypervisor_with_nested_support(self):
        missing = cpu_capabilities("flags : hypervisor fpu\n")
        self.assertTrue(missing["hypervisor_present"])
        self.assertFalse(missing["x86_virtualization_exposed"])
        self.assertTrue(cpu_capabilities("flags : hypervisor svm\n")["x86_virtualization_exposed"])


class StopStateTests(unittest.TestCase):
    def test_unknown_process_state_is_not_stopped(self):
        class Sandbox:
            def ps(self):
                return [{"pid": 10, "state": "unknown"}]

        with self.assertRaisesRegex(ProbeError, "guest_process_state_unknown"):
            wait_stopped(Sandbox(), 10)

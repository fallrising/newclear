"""Policy, live Linux attestation, immutable config and conservative lifecycle tests."""

import copy
import fcntl
import hashlib
import json
import os
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from agent_platform.connector_journal import Journal
from agent_platform.connector_recovery import STOP_KEYS
from agent_platform.domain import Problem
from agent_platform.egress_node import BINARY, SEALS, attest, drained, identity, sealed_config
from agent_platform.egress_policy import REVISION, digest, policy, validate_node


def configuration(root, port=17777):
    token = root / "token"
    token.write_text("test-node-token-" + "x" * 32)
    token.chmod(0o600)
    config = {
        "origin": f"http://127.0.0.1:{port}",
        "template": "guest@sha256:" + "a" * 64,
        "sandbox_data_dir": str(root),
        "sandbox_token_file": str(token),
        "state_dir": str(root / "journal"),
        "egress_receipt_file": str(root / "receipt.json"),
        "egress_policy": {
            "revision": REVISION,
            "allow": [
                {"host": "example.com", "methods": ["GET", "HEAD"], "ports": [80]},
                {"host": "example.com", "methods": ["CONNECT"], "ports": [443]},
            ],
        },
    }
    node = {
        "listen": config["origin"][7:],
        "advertise_addr": config["origin"][7:],
        "client_advertise": config["origin"],
        "data_dir": str(root),
        "api_token": token.read_text(),
        "audit_log": True,
        "max_claims": 4,
        "pools": [
            {
                "template": config["template"],
                "net": "none",
                "size": "large",
                "warm": 0,
                "egress": {"allow": copy.deepcopy(config["egress_policy"]["allow"])},
            }
        ],
    }
    return config, node


class EgressPolicyTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.config, self.node = configuration(self.root)

    def test_exact_public_rules_and_explicit_deny_all(self):
        self.assertEqual(
            validate_node(self.node, self.config, self.node["api_token"]),
            digest(self.config["egress_policy"]),
        )
        self.assertEqual(policy({"revision": REVISION, "allow": []})["allow"], [])

    def test_implicit_wildcard_internal_literal_and_credential_rules_rejected(self):
        invalid = [
            {"host": "*"},
            {"host": "*.example.com"},
            {"host": "127.0.0.1"},
            {"host": "[::1]"},
            {"host": "169.254.169.254"},
            {"host": "example.com."},
            {"host": "metadata.internal"},
            {"host": "foo.localhost"},
            {"host": "EXAMPLE.com"},
            {"host": "user@example.com"},
            {"ports": []},
            {"ports": [80, 443]},
            {"ports": [80.0]},
            {"ports": [22]},
            {"methods": []},
            {"methods": ["GET", "GET"]},
            {"methods": ["CONNECT"]},
            {"methods": ["POST"]},
            {"secret": "provider"},
            {"intercept": True},
        ]
        for change in invalid:
            with self.subTest(change=change):
                value = copy.deepcopy(self.config["egress_policy"])
                value["allow"][0].update(change)
                with self.assertRaises(Problem):
                    policy(value)

    def test_duplicate_unknown_and_old_policy_revision_rejected(self):
        for change in (
            {"revision": "old"},
            {"socks5": True},
            {"allow": [self.config["egress_policy"]["allow"][0]] * 2},
        ):
            with self.subTest(change=change), self.assertRaises(Problem):
                policy({**self.config["egress_policy"], **change})

    def test_node_cannot_add_internal_override_tenant_nic_or_secret(self):
        for field in (
            "egress_internal_allow",
            "secrets",
            "tenants",
            "networks",
            "bridges",
            "mesh",
            "preview_listen",
            "egress_ca",
        ):
            with self.subTest(field=field), self.assertRaises(Problem):
                validate_node({**self.node, field: []}, self.config, self.node["api_token"])
        for field, value in (
            ("listen", "0.0.0.0:17777"),
            ("audit_log", False),
            ("data_dir", "/other"),
            ("max_claims", 5),
        ):
            with self.subTest(field=field), self.assertRaises(Problem):
                validate_node({**self.node, field: value}, self.config, self.node["api_token"])
        for field, value in (("net", "egress"), ("warm", 1), ("egress", {"allow": []})):
            node = copy.deepcopy(self.node)
            node["pools"][0][field] = value
            with self.subTest(field=field), self.assertRaises(Problem):
                validate_node(node, self.config, self.node["api_token"])

    def test_kernel_seals_prevent_write_truncate_and_removal_of_seals(self):
        raw = json.dumps(self.node).encode()
        fd = sealed_config(raw)
        self.addCleanup(os.close, fd)
        self.assertEqual(fcntl.fcntl(fd, fcntl.F_GET_SEALS), SEALS)
        self.assertEqual(os.fstat(fd).st_mode & 0o777, 0o600)
        for operation in (
            lambda: os.pwrite(fd, b"x", 0),
            lambda: os.ftruncate(fd, 0),
            lambda: fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_WRITE),
        ):
            with self.assertRaises(PermissionError):
                operation()
        self.assertEqual(os.pread(fd, len(raw), 0), raw)

    def test_drain_requires_all_stop_proofs_and_preserves_uncertain_journal(self):
        host = SimpleNamespace(vms=lambda: [], removal=lambda _: {"vm": True, "process": False})
        journal = Journal(self.config["state_dir"])
        row = {"run_id": str(uuid4()), "operations": {"allocate": {"state": "started"}}}
        journal.write(row)
        journal.close()
        for update in ({}, {"handle": {"id": "old"}}, {"observed": {"pid": 1}}):
            row.update(update)
            journal = Journal(self.config["state_dir"])
            journal.write(row)
            journal.close()
            before = (Path(self.config["state_dir"]) / (row["run_id"] + ".json")).read_bytes()
            with self.assertRaises(Problem):
                drained(self.config, host)
            self.assertEqual(
                (Path(self.config["state_dir"]) / (row["run_id"] + ".json")).read_bytes(), before
            )
        host.removal = lambda _: dict.fromkeys(STOP_KEYS, True)
        drained(self.config, host)
        (self.root / "claims.json").write_text('{"claim": {}}')
        with self.assertRaises(Problem):
            drained(self.config, host)

    def test_missing_receipt_has_safe_error_and_never_reads_guest(self):
        with self.assertRaisesRegex(Problem, "egress_node_unconfirmed"):
            attest(self.config)


class LiveNodeAttestationTests(unittest.TestCase):
    """Real /proc, sealed fd, TCP listener and process lifetime; no VM claim."""

    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        cls.root = Path(cls.directory.name)
        source = cls.root / "fixture.c"
        source.write_text("#include <unistd.h>\nint main(void) { for (;;) pause(); }\n")
        cls.binary = cls.root / "fixture"
        subprocess.run(["cc", str(source), "-o", str(cls.binary)], check=True, capture_output=True)
        cls.hash = hashlib.sha256(cls.binary.read_bytes()).hexdigest()

    def setUp(self):
        self.listener = socket.socket()
        self.addCleanup(self.listener.close)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen()
        self.config, self.node = configuration(self.root, self.listener.getsockname()[1])
        self.fd = sealed_config(json.dumps(self.node).encode())
        self.addCleanup(os.close, self.fd)
        self.process = subprocess.Popen(
            [BINARY, "-config", f"/proc/self/fd/{self.fd}"],
            executable=str(self.binary),
            pass_fds=(self.fd, self.listener.fileno()),
        )
        self.addCleanup(self.stop)
        self.receipt = {
            "revision": REVISION,
            "identity": identity(self.process.pid),
            "config_fd": self.fd,
        }
        self.save()
        self.patched = patch("agent_platform.egress_node.SANDBOXD_SHA256", self.hash)
        self.patched.start()
        self.addCleanup(self.patched.stop)

    def save(self):
        receipt = Path(self.config["egress_receipt_file"])
        receipt.write_text(json.dumps(self.receipt))
        receipt.chmod(0o600)

    def stop(self):
        if self.process.poll() is None:
            self.process.terminate()
        self.process.wait(timeout=5)

    def test_live_proof_and_policy_change_cannot_reauthorize_existing_run(self):
        proof = attest(self.config)
        self.assertEqual(attest(self.config, {"egress": proof}), proof)
        self.assertNotIn(self.node["api_token"], json.dumps(proof))
        with self.assertRaisesRegex(Problem, "egress_run_policy_changed"):
            attest(self.config, {})
        changed = copy.deepcopy(self.config)
        changed["egress_policy"]["allow"] = []
        with self.assertRaisesRegex(Problem, "egress_pool_policy_mismatch"):
            attest(changed)
        old = copy.deepcopy(proof)
        old["identity"]["start_ticks"] -= 1
        with self.assertRaisesRegex(Problem, "egress_run_policy_changed"):
            attest(self.config, {"egress": old})

    def test_pid_reuse_dead_process_wrong_binary_and_wrong_listener_fail_closed(self):
        self.receipt["identity"]["start_ticks"] -= 1
        self.save()
        with self.assertRaisesRegex(Problem, "egress_node_identity_changed"):
            attest(self.config)
        self.receipt["identity"] = identity(self.process.pid)
        self.save()
        with patch("agent_platform.egress_node.SANDBOXD_SHA256", "0" * 64):
            with self.assertRaisesRegex(Problem, "egress_node_binary_mismatch"):
                attest(self.config)
        with patch("agent_platform.egress_node.owns_listener", return_value=False):
            with self.assertRaisesRegex(Problem, "egress_node_listener_mismatch"):
                attest(self.config)
        self.stop()
        with self.assertRaisesRegex(Problem, "egress_node_not_live"):
            attest(self.config)

    def test_unsealed_config_rejected_even_when_contents_match(self):
        with patch("agent_platform.egress_node.fcntl.fcntl", return_value=0):
            with self.assertRaisesRegex(Problem, "egress_config_not_sealed"):
                attest(self.config)


class EgressAdmissionTests(unittest.TestCase):
    def test_changed_policy_blocks_admission_but_not_stop(self):
        from agent_platform.connector import Connector

        service = Connector.__new__(Connector)
        service.fences = SimpleNamespace(require=Mock())
        service.network = Mock(side_effect=Problem(409, "egress_run_policy_changed"))
        row = {"run_id": str(uuid4()), "generation": 9}
        for flags in ({}, {"controlling": True}):
            with self.assertRaisesRegex(Problem, "egress_run_policy_changed"):
                service.guard(row, **flags)
        service.guard(row, stopping=True)

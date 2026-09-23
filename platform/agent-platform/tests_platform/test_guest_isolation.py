"""Host admission contracts; real credential/UID enforcement is verified on KVM."""

import hashlib
import json
import subprocess
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from agent_platform.build_terminal import build
from agent_platform.connector import Connector
from agent_platform.connector_isolation import ATTESTED, CODE, CONTROL, REVISION, attest
from agent_platform.domain import Problem
from agent_platform_m0.contracts import OPENHANDS_BINARY_SHA256, OPENHANDS_SHA, OPENHANDS_VERSION


class GuestIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.manifest = build(cls.root / "terminal")
        cls.executable = cls.root / "test-terminal"
        cls.executable.write_bytes((cls.root / "terminal").read_bytes())
        cls.executable.chmod(0o700)  # Never setuid on the host.

    def test_prepare_uses_private_sdk_workspace_and_fixed_nonroot_terminal_launcher(self):
        service = Connector.__new__(Connector)
        guest = Mock()
        guest.exec.side_effect = lambda *args, **kwargs: (
            OPENHANDS_BINARY_SHA256
            if args[0] == "sha256sum"
            else json.dumps({"base_sha": "a" * 40})
        )
        service.handle = Mock(return_value=guest)
        service.guard = Mock()
        service.journal = SimpleNamespace(write=Mock())
        service.isolation = Mock()
        service.entries = {("repo", "a" * 40): {}}
        service.bundle = Mock(return_value=b"fixture")
        service.launcher = Mock(return_value=b"test-launcher")
        row = {"run_id": "run", "input": {"canonical_repo": "repo", "base_sha": "a" * 40}}
        created = []

        @contextmanager
        def relay(row):
            class HTTP:
                def expect(self, method, path, data=None, **kwargs):
                    if path == "/server_info":
                        return {"build_git_sha": OPENHANDS_SHA, "version": OPENHANDS_VERSION}
                    created.append(data)
                    return {"id": row["run_id"]}

            yield HTTP()

        service.relay = relay
        with patch("agent_platform.connector.wait_ready"):
            service.prepare(row)
        request = created[0]
        self.assertEqual(request["workspace"]["working_dir"], CONTROL + "/workspace")
        self.assertEqual(
            request["agent"]["tools"],
            [
                {
                    "name": "terminal",
                    "params": {
                        "terminal_type": "subprocess",
                        "shell_path": CODE + "/terminal",
                    },
                }
            ],
        )
        self.assertTrue(all(value is False for value in request["agent"]["agent_context"].values()))
        self.assertEqual(row["isolation_revision"], REVISION)
        for call in guest.spawn.call_args_list:
            self.assertEqual(call.args[:2], ("python3", "-I"))
            self.assertEqual(call.kwargs["cwd"], CONTROL)
            self.assertEqual(call.kwargs["user"], "agentcontrol")
        checkout = next(
            c for c in guest.exec.call_args_list if c.kwargs.get("user") == "agentprobe"
        )
        self.assertEqual(checkout.args[:3], ("python3", "-I", CODE + "/guest_workspace.py"))
        for call in guest.write_file.call_args_list:
            if call.args[0] != "/tmp/source.bundle":
                self.assertTrue(call.args[0].startswith(CODE + "/"))
                self.assertEqual(call.kwargs["mode"] & 0o022, 0)

    def test_legacy_guest_cannot_prompt_result_pause_or_reattest(self):
        service = Connector.__new__(Connector)
        service.handle = Mock(side_effect=AssertionError("guest must not be contacted"))
        for operation in (
            lambda: service.prompt({}, "goal"),
            lambda: service.result({}),
            lambda: service.quiescence({}),
            lambda: service.isolation({}),
        ):
            with self.assertRaisesRegex(Problem, "guest_isolation_upgrade_required"):
                operation()
        service.handle.assert_not_called()

    def test_changed_probe_is_not_executed(self):
        guest = Mock()
        guest.exec.return_value = "bad-hash"
        service = SimpleNamespace(
            handle=Mock(return_value=guest), launcher=lambda: b"test-launcher"
        )
        with self.assertRaisesRegex(Problem, "guest_isolation_probe_changed"):
            attest(service, {"isolation_revision": REVISION})
        self.assertEqual(guest.exec.call_count, 1)

    def test_forged_proof_does_not_admit_terminal(self):
        source = Path(__file__).parents[1] / "src/agent_platform/guest_control.py"
        guest = Mock()
        guest.exec.side_effect = [
            hashlib.sha256(source.read_bytes()).hexdigest(),
            json.dumps({"revision": REVISION, "terminal_uid": 0}),
        ]
        service = SimpleNamespace(
            handle=Mock(return_value=guest), launcher=lambda: b"test-launcher"
        )
        with self.assertRaisesRegex(Problem, "guest_isolation_unconfirmed"):
            attest(service, {"isolation_revision": REVISION}, terminal=True)
        call = guest.exec.call_args
        self.assertEqual(call.args[:3], ("python3", "-I", CODE + "/guest_control.py"))
        request = json.loads(call.args[3])
        self.assertTrue(request["terminal"])
        self.assertEqual(set(request["files"]), set(ATTESTED) | {"terminal"})

    def test_compiled_launcher_never_accepts_unprivileged_or_command_arguments(self):
        for args in ([], ["-i"], ["-c", "touch " + str(self.root / "forbidden")], ["root", "-i"]):
            reply = subprocess.run([str(self.executable), *args], capture_output=True, timeout=5)
            self.assertEqual(reply.returncode, 125)
            self.assertEqual(reply.stderr, b"terminal_launcher_denied\n")
        self.assertFalse((self.root / "forbidden").exists())

    def test_builder_keeps_private_data_file_and_refuses_overwrite(self):
        self.assertEqual((self.root / "terminal").stat().st_mode & 0o7777, 0o600)
        with self.assertRaises(FileExistsError):
            build(self.root / "terminal")

    def test_pinned_launcher_rejects_changed_digest_and_public_file(self):
        service = Connector.__new__(Connector)
        service.config = dict(self.manifest)
        self.assertTrue(service.launcher().startswith(b"\x7fELF"))
        service.config["terminal_launcher_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "terminal_launcher_mismatch"):
            service.launcher()
        service.config = {**self.manifest, "terminal_launcher_file": str(self.executable)}
        self.executable.chmod(0o755)
        try:
            with self.assertRaisesRegex(ValueError, "private_and_owned"):
                service.launcher()
        finally:
            self.executable.chmod(0o700)

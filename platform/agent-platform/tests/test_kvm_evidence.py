"""Hardware evidence must not infer removal merely from a missing claim/VM row."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from agent_platform_m0.kvm_lifecycle import Host, process_identity


class ProcessIdentityTests(unittest.TestCase):
    def test_command_name_with_spaces_and_parentheses_keeps_start_time(self):
        fields = ["S"] + ["0"] * 18 + ["123456"]
        with patch.object(
            Path, "read_text", return_value="42 (a name (worker)) " + " ".join(fields)
        ):
            self.assertEqual(process_identity(42), {"pid": 42, "start_ticks": 123456, "state": "S"})

    def test_permission_failure_is_not_process_removal(self):
        with patch.object(Path, "read_text", side_effect=PermissionError):
            with self.assertRaises(PermissionError):
                process_identity(42)


class RemovalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.observed = {
            "identity": {"pid": 42, "start_ticks": 100, "state": "S"},
            "vm_id": "owned-vm",
            "run_dir": str(self.root / "runtime"),
            "scope": str(self.root / "scope"),
        }
        self.host = object.__new__(Host)

    def removal(self, identity, vms=()):
        with (
            patch("agent_platform_m0.kvm_lifecycle.process_identity", return_value=identity),
            patch.object(self.host, "vms", return_value=list(vms)),
        ):
            return self.host.removal(self.observed)

    def test_missing_vm_record_cannot_hide_live_vmm(self):
        result = self.removal({"pid": 42, "start_ticks": 100, "state": "S"})
        self.assertTrue(result["vm_record_gone"])
        self.assertFalse(result["original_vmm_process_gone"])
        self.assertFalse(all(result.values()))

    def test_dead_process_cannot_hide_leftover_disk_or_scope(self):
        for key in ("run_dir", "scope"):
            with self.subTest(key=key):
                path = Path(self.observed[key])
                path.mkdir()
                self.assertFalse(all(self.removal(None).values()))
                path.rmdir()

    def test_pid_reuse_does_not_match_original_process(self):
        self.assertTrue(all(self.removal({"pid": 42, "start_ticks": 200, "state": "S"}).values()))

    def test_stale_vm_row_still_blocks_removal(self):
        self.assertFalse(all(self.removal(None, [{"id": "owned-vm"}]).values()))

    def test_failed_host_observation_is_not_empty_inventory(self):
        with (
            patch("agent_platform_m0.kvm_lifecycle.process_identity", return_value=None),
            patch.object(self.host, "vms", side_effect=PermissionError),
        ):
            with self.assertRaises(PermissionError):
                self.host.removal(self.observed)

"""Explicit reconciliation for an allocate intent that never saved a VM handle."""

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from agent_platform.connector_journal import Journal
from agent_platform.connector_recovery import (
    blocks_new_admission,
    reconcile_unconfirmed_allocation,
)
from agent_platform.domain import Problem
from agent_platform.egress_node import drained


def host(vms=None, cgroup=None, root_dir=None):
    return SimpleNamespace(
        vms=lambda: list(vms or []),
        cgroup=cgroup,
        config={"root_dir": root_dir} if root_dir else {},
        removal=lambda _: {},
    )


class UnconfirmedAllocationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.run_id = str(uuid4())
        self.config = {
            "state_dir": str(self.root / "journal"),
            "sandbox_data_dir": str(self.root / "sandbox"),
        }
        (self.root / "sandbox").mkdir()
        self.row = {
            "run_id": self.run_id,
            "generation": 2,
            "operations": {"allocate": {"state": "started", "payload_hash": "abc"}},
        }
        journal = Journal(self.config["state_dir"])
        journal.write(self.row)
        journal.close()
        fences = Journal(Path(self.config["state_dir"]) / "fences")
        fences.write(
            {"run_id": self.run_id, "generation": 2, "lease_until": "2099-01-01T00:00:00+00:00"}
        )
        fences.close()

    def path(self):
        return Path(self.config["state_dir"]) / (self.run_id + ".json")

    def fence(self):
        return Path(self.config["state_dir"]) / "fences" / (self.run_id + ".json")

    def test_pending_intent_blocks_drain_and_other_admission(self):
        before = self.path().read_bytes()
        fence = self.fence().read_bytes()
        with self.assertRaises(Problem) as caught:
            drained(self.config, host())
        self.assertEqual(caught.exception.code, "egress_allocation_ownership_uncertain")
        self.assertEqual(self.path().read_bytes(), before)
        self.assertEqual(self.fence().read_bytes(), fence)
        self.assertTrue(blocks_new_admission(self.row, str(uuid4())))
        self.assertFalse(blocks_new_admission(self.row, self.run_id))

    def test_reconcile_records_decision_without_deleting_or_lowering_generation(self):
        fence = self.fence().read_bytes()
        result = reconcile_unconfirmed_allocation(self.config, host(), self.run_id)
        self.assertEqual(result["decision"], "unconfirmed_allocation_not_observed")
        self.assertEqual(result["generation"], 2)
        saved = json.loads(self.path().read_text())
        self.assertEqual(saved["generation"], 2)
        self.assertNotIn("handle", saved)
        self.assertNotIn("observed", saved)
        self.assertEqual(saved["operations"]["allocate"]["state"], "reconciled")
        self.assertEqual(self.fence().read_bytes(), fence)
        self.assertFalse(blocks_new_admission(saved, str(uuid4())))
        drained(self.config, host())
        again = reconcile_unconfirmed_allocation(self.config, host(), self.run_id)
        self.assertEqual(again, result)
        self.assertEqual(json.loads(self.path().read_text()), saved)

    def test_reconcile_refuses_when_host_vm_claim_scope_or_runtime_remains(self):
        before = self.path().read_bytes()
        with self.assertRaises(Problem) as caught:
            reconcile_unconfirmed_allocation(self.config, host(vms=[{"id": "vm"}]), self.run_id)
        self.assertEqual(caught.exception.code, "unconfirmed_allocation_host_not_clear")
        (self.root / "sandbox" / "claims.json").write_text('{"claim": {}}')
        with self.assertRaises(Problem):
            reconcile_unconfirmed_allocation(self.config, host(), self.run_id)
        (self.root / "sandbox" / "claims.json").unlink()
        scope_dir = self.root / "cgroup"
        scope_dir.mkdir()
        (scope_dir / "vm-old.scope").mkdir()
        with self.assertRaises(Problem):
            reconcile_unconfirmed_allocation(self.config, host(cgroup=scope_dir), self.run_id)
        runtime = self.root / "cocoon"
        (runtime / "vm-orphan").mkdir(parents=True)
        with self.assertRaises(Problem):
            reconcile_unconfirmed_allocation(self.config, host(root_dir=str(runtime)), self.run_id)
        self.assertEqual(self.path().read_bytes(), before)

    def test_reconcile_refuses_saved_handle_or_fence_mismatch(self):
        journal = Journal(self.config["state_dir"])
        self.row["handle"] = {"id": "sandbox"}
        journal.write(self.row)
        journal.close()
        with self.assertRaises(Problem) as caught:
            reconcile_unconfirmed_allocation(self.config, host(), self.run_id)
        self.assertEqual(caught.exception.code, "unconfirmed_allocation_not_reconcilable")
        self.row.pop("handle")
        journal = Journal(self.config["state_dir"])
        journal.write(self.row)
        journal.close()
        fences = Journal(Path(self.config["state_dir"]) / "fences")
        fences.write(
            {"run_id": self.run_id, "generation": 3, "lease_until": "2099-01-01T00:00:00+00:00"}
        )
        fences.close()
        with self.assertRaises(Problem) as caught:
            reconcile_unconfirmed_allocation(self.config, host(), self.run_id)
        self.assertEqual(caught.exception.code, "unconfirmed_allocation_fence_mismatch")
        self.assertEqual(json.loads(self.path().read_text())["generation"], 2)

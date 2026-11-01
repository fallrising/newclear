"""Independent adversarial checks; synthetic data and temporary directories only."""
import copy
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

import test_fresh_rebuild as planner_fixtures
import fresh_simulation
import fresh_simulation_store


class IndependentFreshSimulationReview(unittest.TestCase):
    def setUp(self):
        fixture = planner_fixtures.FreshRebuildPlanTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.envelope, _ = fixture.save()
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name) / 'simulation'
        self.bindings = fresh_simulation.synthetic_bindings(self.envelope)
        self.adapter = fresh_simulation.SimulationAdapter()
        self.sim = fresh_simulation.Simulation(
            self.root, self.envelope, self.bindings, adapter=self.adapter)

    def test_real_directory_fsync_failure_leaves_intent_without_any_dispatch(self):
        original = os.fsync
        def fail_directory(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                raise OSError('synthetic directory durability failure')
            return original(fd)
        with patch.object(fresh_simulation_store.os, 'fsync', side_effect=fail_directory):
            with self.assertRaises(OSError):
                self.sim.execute(self.bindings)
        self.assertEqual(self.adapter.mutation_calls, [])
        self.assertEqual(self.sim.store.names(), ['execution.json', 'intent-000.json'])
        restarted = fresh_simulation.Simulation(self.root, self.envelope, self.bindings)
        self.assertEqual(restarted.execute(self.bindings)['status'], 'uncertain')
        self.assertEqual(restarted.reconcile(self.bindings)['status'], 'uncertain')
        self.assertEqual(restarted.adapter.mutation_calls, [])
        self.assertNotIn('receipt-000.json', restarted.store.names())

    def test_unknown_well_formed_private_record_blocks_both_entrypoints(self):
        # Valid JSON, canonical content, secure permissions: rejection must be
        # coordinator namespace auditing, not incidental filesystem validation.
        self.sim.store.write_once('foreign-record.json', {'synthetic': True})
        self.assertIn('foreign-record.json', self.sim.store.names())
        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        for method in (self.sim.execute, self.sim.reconcile):
            with self.assertRaises(ValueError):
                method(self.bindings)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.root.iterdir()})
        self.assertEqual(self.adapter.mutation_calls, [])
        self.assertEqual(self.adapter.observation_calls, [])

    def test_root_replacement_blocks_reconcile_without_observing_or_writing(self):
        moved = self.root.with_name('original')
        self.root.rename(moved)
        self.root.mkdir(mode=0o700)
        for method in (self.sim.execute, self.sim.reconcile):
            with self.assertRaises(ValueError):
                method(self.bindings)
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertEqual(self.adapter.mutation_calls, [])
        self.assertEqual(self.adapter.observation_calls, [])

    def test_foreign_valid_action_evidence_cannot_seal_current_action(self):
        self.adapter.outcomes['controller-ready'] = 'lost'
        self.sim.execute(self.bindings)
        action = self.adapter.mutation_calls[0]
        own = copy.deepcopy(self.adapter.observations[action])
        foreign_root = self.root.with_name('foreign')
        envelope = copy.deepcopy(self.envelope)
        envelope['plan']['id'] += '-foreign'
        envelope['sha256'] = fresh_simulation.plan_digest(envelope['plan'])
        foreign_bindings = fresh_simulation.synthetic_bindings(envelope)
        foreign = fresh_simulation.Simulation(foreign_root, envelope, foreign_bindings)
        foreign.execute(foreign_bindings)
        foreign_action = foreign.adapter.mutation_calls[0]
        self.adapter.observations[action] = foreign.adapter.observations[foreign_action]
        self.assertEqual(self.sim.reconcile(self.bindings)['status'], 'uncertain')
        self.assertNotIn('receipt-000.json', self.sim.store.names())
        self.assertEqual(len(self.adapter.mutation_calls), 1)
        self.adapter.observations[action] = own
        self.assertEqual(self.sim.reconcile(self.bindings)['status'], 'observed-complete')
        self.assertEqual(len(self.adapter.mutation_calls), 1)

    def test_recovery_receipt_requires_exact_last_observation_digest(self):
        self.adapter.outcomes['controller-ready'] = 'lost'
        self.sim.execute(self.bindings)
        self.sim.reconcile(self.bindings)
        path = self.root / 'receipt-000.json'
        record = json.loads(path.read_bytes())
        record['observation_sha256'] = 'a' * 64
        path.write_text(json.dumps(record))
        for method in (self.sim.execute, self.sim.reconcile):
            with self.assertRaises(ValueError):
                method(self.bindings)
        self.assertEqual(len(self.adapter.mutation_calls), 1)
        self.assertEqual(len(self.adapter.observation_calls), 1)


if __name__ == '__main__':
    unittest.main()

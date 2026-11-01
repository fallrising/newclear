"""Offline contracts for the synthetic-only fresh coordinator."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_fresh_rebuild as planner_fixtures
import fresh_simulation


class FreshSimulationTests(unittest.TestCase):
    def setUp(self):
        fixture = planner_fixtures.FreshRebuildPlanTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.envelope, _ = fixture.save()
        self.sentinel = fixture.sentinel
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / 'simulation'
        self.bindings = fresh_simulation.synthetic_bindings(self.envelope)

    def coordinator(self, outcomes=None):
        adapter = fresh_simulation.SimulationAdapter(outcomes=outcomes)
        return fresh_simulation.Simulation(
            self.root, self.envelope, self.bindings, adapter=adapter), adapter

    def test_lost_response_second_execute_does_not_dispatch(self):
        coordinator, adapter = self.coordinator({'controller-ready': 'lost'})
        first = coordinator.execute(self.bindings)
        second = coordinator.execute(self.bindings)
        self.assertEqual(first['status'], 'uncertain')
        self.assertEqual(second['status'], 'uncertain')
        self.assertEqual(len(adapter.mutation_calls), 1)

    def test_full_chain_is_only_simulation_and_duplicate_is_noop(self):
        coordinator, adapter = self.coordinator()
        before = copy.deepcopy(self.envelope)
        for ordinal in range(12):
            result = coordinator.execute(self.bindings)
            self.assertEqual(result['completed_stages'], ordinal + 1)
        self.assertEqual(result['status'], 'simulation-complete')
        self.assertEqual(coordinator.execute(self.bindings), result)
        self.assertEqual(coordinator.reconcile(self.bindings), result)
        self.assertEqual(len(adapter.mutation_calls), 12)
        self.assertEqual(len(set(adapter.mutation_calls)), 12)
        self.assertFalse(result['accepted_run_created'])
        self.assertFalse(result['generation_changed'])
        self.assertFalse(result['remote_mutation_performed'])
        self.assertEqual(self.envelope, before)
        self.assertEqual(len(coordinator.store.names()), 25)
        public = json.dumps(result)
        self.assertNotIn(self.sentinel, public)
        self.assertNotIn('192.0.2.', public)
        self.assertNotIn('provider-', public)

    def test_reconcile_is_observation_only_and_seals_exact_completion(self):
        coordinator, adapter = self.coordinator({'controller-ready': 'lost'})
        self.assertEqual(coordinator.reconcile(self.bindings)['status'], 'not-started')
        coordinator.execute(self.bindings)
        result = coordinator.reconcile(self.bindings)
        self.assertEqual(result['status'], 'observed-complete')
        self.assertEqual(result['completed_stages'], 1)
        self.assertEqual(len(adapter.mutation_calls), 1)
        self.assertEqual(len(adapter.observation_calls), 1)
        self.assertEqual(coordinator.reconcile(self.bindings)['status'], 'not-started')
        self.assertEqual(len(adapter.mutation_calls), 1)
        coordinator.execute(self.bindings)
        self.assertEqual(len(adapter.mutation_calls), 2)

    def test_restart_with_no_observations_never_replays(self):
        coordinator, adapter = self.coordinator({'controller-ready': 'lost'})
        coordinator.execute(self.bindings)
        restarted, fresh_adapter = self.coordinator()
        self.assertEqual(restarted.execute(self.bindings)['status'], 'uncertain')
        self.assertEqual(restarted.reconcile(self.bindings)['status'], 'uncertain')
        self.assertEqual(fresh_adapter.mutation_calls, [])
        self.assertEqual(len(adapter.mutation_calls), 1)

    def test_incomplete_wrong_failed_and_missing_observations_do_not_advance(self):
        coordinator, adapter = self.coordinator({'controller-ready': 'lost'})
        coordinator.execute(self.bindings)
        action = adapter.mutation_calls[0]
        complete = copy.deepcopy(adapter.observations[action])
        invalid = [None, {}, {**complete, 'postcondition': 'incomplete'},
                   {**complete, 'action_id': 'a' * 64},
                   {**complete, 'bindings_sha256': 'b' * 64},
                   {**complete, 'result': 'failed'}, {**complete, 'synthetic': False}]
        for observation in invalid:
            adapter.observations[action] = observation
            self.assertEqual(coordinator.reconcile(self.bindings)['status'], 'uncertain')
            self.assertEqual(coordinator.execute(self.bindings)['completed_stages'], 0)
        adapter.observations[action] = complete
        self.assertEqual(coordinator.reconcile(self.bindings)['status'], 'observed-complete')
        self.assertEqual(len(adapter.mutation_calls), 1)

    def test_failed_receipt_cannot_be_promoted_or_advance(self):
        coordinator, adapter = self.coordinator({'controller-ready': 'failed'})
        self.assertEqual(coordinator.execute(self.bindings)['status'], 'failed')
        self.assertEqual(coordinator.execute(self.bindings)['status'], 'failed')
        self.assertEqual(coordinator.reconcile(self.bindings)['status'], 'failed')
        self.assertEqual(len(adapter.mutation_calls), 1)
        self.assertEqual(adapter.observation_calls, [])

    def test_absent_receipt_is_uncertain(self):
        coordinator, adapter = self.coordinator({'controller-ready': 'absent'})
        self.assertEqual(coordinator.execute(self.bindings)['status'], 'uncertain')
        self.assertEqual(coordinator.execute(self.bindings)['status'], 'uncertain')
        self.assertEqual(len(adapter.mutation_calls), 1)

    def test_binding_drift_blocks_execute_and_reconcile_without_dispatch(self):
        coordinator, adapter = self.coordinator()
        for key, value in (('review_sha256', 'f' * 64), ('scope_sha256', 'a' * 64),
                           ('generation_after', 99), ('synthetic', False),
                           ('hosts', []), ('authorization', {}), ('fence', {})):
            changed = copy.deepcopy(self.bindings)
            changed[key] = value
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    coordinator.execute(changed)
                with self.assertRaises(ValueError):
                    coordinator.reconcile(changed)
        self.assertEqual(adapter.mutation_calls, [])
        self.assertEqual(adapter.observation_calls, [])

    def test_invalid_review_is_rejected_before_journal_publication(self):
        cases = [lambda p: p.update(executable=True),
                 lambda p: p.update(execution_implemented=True),
                 lambda p: p.update(decision='blocked'),
                 lambda p: p.update(blockers=['blocked']),
                 lambda p: p.update(generation_after=20),
                 lambda p: p['stages'].reverse(),
                 lambda p: p['stages'][1].update(prerequisites=[]),
                 lambda p: p['scope']['hosts'][0].update(provider_resource_ref='changed'),
                 lambda p: p['bindings'].update(code_inputs_sha256='0' * 64),
                 lambda p: p['bindings']['controller'].update(ready_for_review=False),
                 lambda p: p['bindings']['controller'].update(checked_at='2020-01-01T00:00:00+00:00'),
                 lambda p: p.update(campaign_sha256='0' * 64)]
        for mutate in cases:
            envelope = copy.deepcopy(self.envelope)
            mutate(envelope['plan'])
            envelope['sha256'] = fresh_simulation.plan_digest(envelope['plan'])
            with self.assertRaises(ValueError):
                fresh_simulation.Simulation(self.root, envelope, self.bindings)
            self.assertFalse(self.root.exists())
        envelope = copy.deepcopy(self.envelope)
        envelope['sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            fresh_simulation.synthetic_bindings(envelope)

    def test_unexpected_receipt_gap_and_unknown_record_block(self):
        for filename in ('receipt-000.json', 'intent-001.json', 'unknown.json', '.temporary'):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as temp:
                adapter = fresh_simulation.SimulationAdapter()
                coordinator = fresh_simulation.Simulation(Path(temp) / 'sim', self.envelope,
                                                         self.bindings, adapter=adapter)
                (Path(temp) / 'sim' / filename).write_text('{}')
                with self.assertRaises(ValueError):
                    coordinator.execute(self.bindings)
                self.assertEqual(adapter.mutation_calls, [])

    def test_intent_predecessor_schema_and_execution_tamper_block(self):
        coordinator, adapter = self.coordinator({'controller-ready': 'lost'})
        coordinator.execute(self.bindings)
        intent_path = self.root / 'intent-000.json'
        original = intent_path.read_bytes()
        for key, value in (('predecessor_sha256', '0' * 64), ('ordinal', True),
                           ('action_id', '1' * 64), ('synthetic', False), ('extra', 1)):
            record = json.loads(original)
            record[key] = value
            intent_path.write_text(json.dumps(record))
            with self.assertRaises(ValueError):
                coordinator.execute(self.bindings)
            with self.assertRaises(ValueError):
                coordinator.reconcile(self.bindings)
        intent_path.write_bytes(original)
        execution = self.root / 'execution.json'
        record = json.loads(execution.read_bytes())
        record['bindings']['hosts'] = []
        execution.write_text(json.dumps(record))
        with self.assertRaises(ValueError):
            coordinator.execute(self.bindings)
        self.assertEqual(len(adapter.mutation_calls), 1)

    def test_receipt_tamper_and_duplicate_json_fail_closed(self):
        coordinator, adapter = self.coordinator()
        coordinator.execute(self.bindings)
        receipt_path = self.root / 'receipt-000.json'
        original = receipt_path.read_bytes()
        for raw in (b'{"schema_version":1,"schema_version":1}', b'{"result":NaN}',
                    b'{', json.dumps({**json.loads(original), 'intent_sha256': '0' * 64}).encode()):
            receipt_path.write_bytes(raw)
            with self.assertRaises(ValueError):
                coordinator.execute(self.bindings)
        self.assertEqual(len(adapter.mutation_calls), 1)

    def test_intent_publication_failure_never_dispatches_and_restart_is_uncertain(self):
        coordinator, adapter = self.coordinator()
        original = coordinator.store.write_once
        def published_then_failed(name, value):
            original(name, value)
            raise OSError('synthetic directory fsync failure')
        with patch.object(coordinator.store, 'write_once', side_effect=published_then_failed):
            with self.assertRaises(OSError):
                coordinator.execute(self.bindings)
        self.assertEqual(adapter.mutation_calls, [])
        restarted, restarted_adapter = self.coordinator()
        self.assertEqual(restarted.execute(self.bindings)['status'], 'uncertain')
        self.assertEqual(restarted_adapter.mutation_calls, [])

    def test_receipt_publication_failure_never_replays(self):
        coordinator, adapter = self.coordinator()
        original = coordinator.store.write_once
        def fail_receipt(name, value):
            if name.startswith('receipt-'):
                raise OSError('synthetic receipt write failure')
            return original(name, value)
        with patch.object(coordinator.store, 'write_once', side_effect=fail_receipt):
            with self.assertRaises(OSError):
                coordinator.execute(self.bindings)
        self.assertEqual(coordinator.execute(self.bindings)['status'], 'uncertain')
        self.assertEqual(coordinator.reconcile(self.bindings)['status'], 'observed-complete')
        self.assertEqual(len(adapter.mutation_calls), 1)

    def test_input_alias_mutation_and_live_adapter_rejected(self):
        coordinator, adapter = self.coordinator()
        self.envelope['plan']['scope']['hosts'].clear()
        self.bindings['hosts'].clear()
        with self.assertRaises(ValueError):
            coordinator.execute(self.bindings)
        self.assertEqual(len(coordinator.envelope['plan']['scope']['hosts']), 4)
        self.assertEqual(len(coordinator.bindings['hosts']), 4)
        class LiveAdapter(fresh_simulation.SimulationAdapter):
            pass
        with self.assertRaises(ValueError):
            fresh_simulation.Simulation(self.root, coordinator.envelope, coordinator.bindings, adapter=LiveAdapter())

    def test_observation_predecessor_tampering_blocks(self):
        coordinator, adapter = self.coordinator({'controller-ready': 'lost'})
        coordinator.execute(self.bindings)
        adapter.observations.clear()
        coordinator.reconcile(self.bindings)
        path = self.root / 'observation-000-000.json'
        observation = json.loads(path.read_bytes())
        observation['predecessor_sha256'] = '0' * 64
        path.write_text(json.dumps(observation))
        with self.assertRaises(ValueError):
            coordinator.reconcile(self.bindings)
        self.assertEqual(len(adapter.mutation_calls), 1)

    def test_existing_planner_rejects_simulation_as_accepted_run(self):
        coordinator, _ = self.coordinator()
        for _ in range(12):
            summary = coordinator.execute(self.bindings)
        plan = self.envelope['plan']
        reference = {
            'id': plan['id'], 'plan_sha256': self.envelope['sha256'],
            'generation': plan['generation_after'],
            'acceptance': {'path': 'private/fixture-acceptance.json', 'sha256': 'a' * 64},
        }
        series = {'id': plan['series']['id'], 'required_successes': 3,
                  'iteration': 2, 'previous_accepted_run': reference}
        for candidate in (summary, coordinator.store.read('receipt-011.json'), coordinator.execution):
            proof = {'review_plan': self.envelope, 'review_path': 'private/fixture-review.json',
                     'acceptance': candidate, 'acceptance_path': reference['acceptance']['path'],
                     'acceptance_sha256': 'a' * 64}
            with self.assertRaisesRegex(ValueError, 'accepted run evidence is malformed'):
                planner_fixtures.fresh_rebuild._series(series, plan['generation_after'], proof)

    def test_intent_failure_before_publication_keeps_not_started(self):
        coordinator, adapter = self.coordinator()
        with patch.object(coordinator.store, 'write_once', side_effect=OSError('synthetic publish failure')):
            with self.assertRaises(OSError):
                coordinator.execute(self.bindings)
        self.assertEqual(adapter.mutation_calls, [])
        self.assertEqual(coordinator.reconcile(self.bindings)['status'], 'not-started')
        self.assertEqual(coordinator.execute(self.bindings)['completed_stages'], 1)

    def test_competing_coordinators_cannot_dispatch_same_action(self):
        from concurrent.futures import ThreadPoolExecutor
        first, first_adapter = self.coordinator({'controller-ready': 'lost'})
        second, second_adapter = self.coordinator({'controller-ready': 'lost'})
        def run(coordinator):
            try:
                return coordinator.execute(self.bindings)['status']
            except FileExistsError:
                return 'collision'
            except ValueError:
                # An in-flight publication temporary is intentionally blocked.
                return 'blocked'
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(run, (first, second)))
        self.assertTrue(set(outcomes) <= {'uncertain', 'collision', 'blocked'})
        dispatched = len(first_adapter.mutation_calls) + len(second_adapter.mutation_calls)
        self.assertLessEqual(dispatched, 1)
        restarted, restarted_adapter = self.coordinator()
        self.assertEqual(restarted.execute(self.bindings)['status'], 'uncertain')
        self.assertEqual(restarted_adapter.mutation_calls, [])
        if dispatched:
            winner = first if first_adapter.mutation_calls else second
            self.assertEqual(winner.reconcile(self.bindings)['status'], 'observed-complete')
            # A new reader accepts the complete durable chain after reconciliation.
            recovered, recovered_adapter = self.coordinator()
            self.assertEqual(recovered.reconcile(self.bindings)['completed_stages'], 1)
            self.assertEqual(recovered_adapter.mutation_calls, [])
        else:
            self.assertEqual(restarted.reconcile(self.bindings)['status'], 'uncertain')
        self.assertEqual(len(first_adapter.mutation_calls) + len(second_adapter.mutation_calls), dispatched)

    def test_saved_receipt_is_independent_of_adapter_ledger_aliases(self):
        coordinator, adapter = self.coordinator()
        coordinator.execute(self.bindings)
        receipt_before = (self.root / 'receipt-000.json').read_bytes()
        adapter.observations[adapter.mutation_calls[0]]['result'] = 'failed'
        self.assertEqual((self.root / 'receipt-000.json').read_bytes(), receipt_before)
        self.assertEqual(coordinator.execute(self.bindings)['completed_stages'], 2)

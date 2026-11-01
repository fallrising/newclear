"""Independent adversarial checks for the integrated fresh completion gate."""
import base64
import copy
import json
import unittest
from unittest.mock import patch

import fresh_replay_host as replay_host
import fresh_replay_ops as replay_ops
import fresh_generation as generation_contract
import fresh_generation_ops as generation_ops
import fresh_run_authority as run_authority
from fresh_execution_ops import PrivateFiles
from fresh_bootstrap_render import canonical
from test_fresh_replay_host import Harness
import test_fresh_replay_ops as replay_fixtures
import test_fresh_generation_ops as generation_fixtures


class ReplayMetadataIdentityReview(unittest.TestCase):
    def setUp(self):
        self.h = Harness()
        self.addCleanup(self.h.close)

    def test_readonly_resource_accept_rejects_changed_bootstrap_node_value(self):
        # A real desired app is present. Only the etcd raw value of a known
        # bootstrap node key changes; the independent CLI node view stays good.
        self.h.dispatch(self.h.action(2), 'b' * 64)
        index = next(i for i, step in enumerate(self.h.plan['steps'])
                     if step['step'] == 'resources-accept')
        action = self.h.action(index)
        before = self.h.observe(action)
        replay_host.validate_evidence(action, before)
        after = copy.deepcopy(before)
        command = after['evidence']['captures'][0]['commands']['keys']
        keyspace = json.loads(base64.b64decode(command['stdout_base64']))
        target = b'/eru/node/worker-2'
        changed = False
        for row in keyspace['kvs']:
            if base64.b64decode(row['key']) == target:
                node = json.loads(base64.b64decode(row['value']))
                node['endpoint'] = 'containerd://foreign@100.64.0.2:22'
                row['value'] = base64.b64encode(canonical(node)).decode()
                changed = True
        self.assertTrue(changed, 'fixture must contain the bootstrap node key')
        command['stdout_base64'] = base64.b64encode(canonical(keyspace)).decode()
        with self.assertRaises(ValueError):
            replay_host.validate_transition(action, before, after, before)

    def deployed(self):
        action = self.h.action(2)
        before = self.h.observe(action)
        self.h.dispatch(action, 'b' * 64)
        after = self.h.observe(action)
        replay_host.validate_transition(action, before, after, None)
        self.assertTrue(self.h.rows)
        return action, before, after, self.h.rows[0]['id']

    @staticmethod
    def keyspace(observed):
        command = observed['evidence']['captures'][0]['commands']['keys']
        return command, json.loads(base64.b64decode(command['stdout_base64']))

    def test_app_deploy_rejects_foreign_key_aliasing_owned_workload_id(self):
        action, before, after, wid = self.deployed()
        command, keyspace = self.keyspace(after)
        keyspace['kvs'].append({'key': base64.b64encode(('/eru/foreign/' + wid).encode()).decode(),
                                'value': base64.b64encode(wid.encode()).decode()})
        keyspace['count'] += 1
        command['stdout_base64'] = base64.b64encode(canonical(keyspace)).decode()
        with self.assertRaises(ValueError):
            replay_host.validate_transition(action, before, after, None)

    def test_app_deploy_rejects_bare_id_at_canonical_workload_key(self):
        action, before, after, wid = self.deployed()
        command, keyspace = self.keyspace(after)
        target = ('/eru/workloads/' + wid).encode()
        row = next(row for row in keyspace['kvs'] if base64.b64decode(row['key']) == target)
        row['value'] = base64.b64encode(wid.encode()).decode()
        command['stdout_base64'] = base64.b64encode(canonical(keyspace)).decode()
        with self.assertRaises(ValueError):
            replay_host.validate_transition(action, before, after, None)

    def test_app_deploy_requires_canonical_workload_key(self):
        action, before, after, wid = self.deployed()
        command, keyspace = self.keyspace(after)
        target = ('/eru/workloads/' + wid).encode()
        keyspace['kvs'] = [row for row in keyspace['kvs']
                           if base64.b64decode(row['key']) != target]
        keyspace['count'] -= 1
        command['stdout_base64'] = base64.b64encode(canonical(keyspace)).decode()
        with self.assertRaises(ValueError):
            replay_host.validate_transition(action, before, after, None)


class ReplayCurrentAuthorityReview(unittest.TestCase):
    def test_writer_rechecks_owner_after_nested_history_before_dispatch(self):
        fixture = replay_fixtures.ReplayJournalTests(methodName='runTest')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.assertEqual(fixture.execute(0)['status'], 'replay-step-complete')
        intent_path = replay_ops._path('synthetic-run', 1) + '/intent.json'
        original_publication_check = replay_ops._Publications.check
        expired = False
        dispatches = []
        original_dispatch = fixture.h.dispatch

        def expire_after_nested_check(publications):
            nonlocal expired
            result = original_publication_check(publications)
            if intent_path in publications.files.seen:
                expired = True
            return result

        def current_owner():
            if expired:
                raise ValueError('synthetic owner renewal expired after nested proof check')

        def dispatch(action, digest):
            dispatches.append((action['step_index'], digest))
            return original_dispatch(action, digest)

        with patch.object(replay_ops._Publications, 'check', expire_after_nested_check), \
                patch.object(replay_ops.authority, 'check_current', side_effect=current_owner), \
                patch.object(fixture.h, 'dispatch', side_effect=dispatch):
            fixture.execute(1)
        self.assertTrue(expired, 'fixture must expire owner after the nested proof check')
        self.assertEqual(dispatches, [], 'expired owner renewal must dispatch zero times')


class GenerationCurrentOwnerBoundaryReview(unittest.TestCase):
    """Narrow before-byte counter; semantic acceptance is the fixture's mock."""

    def prefix(self):
        fixture = generation_fixtures.GenerationStorageTests(methodName='runTest')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.prepare()
        original = generation_ops._replace
        calls = []

        def fail_second(*args, **kwargs):
            calls.append(1)
            if len(calls) == 2:
                raise OSError('synthetic crash after first durable inventory write')
            return original(*args, **kwargs)

        with patch.object(generation_ops, '_replace', side_effect=fail_second):
            self.assertEqual(fixture.finalize()['status'], 'blocked')
        self.assertEqual(generation_ops.inspect_generation(
            fixture.project, fixture.run, fixture.generation_sha,
            now=fixture.now)['prefix_length'], 1)
        return fixture

    def step(self, fixture, seam):
        step = run_authority._Step.__new__(run_authority._Step)
        step.files = PrivateFiles(fixture.project)
        self.addCleanup(step.files.close)
        step.operation = 'finalize_generation'
        step.historical = False
        step._generation_proof_depth = 0
        step.binding = {'run_id': fixture.run}
        step.target = {'generation_sha': fixture.generation_sha}
        step.pending = fixture.pending
        step.now = fixture.now
        step.source_state = None
        step._check_inputs = seam
        return step

    def check_in_physical_writer_context(self, fixture, step):
        with generation_contract._historical(
                fixture.project, fixture.before, fixture.pending,
                fixture.pending['reservation']['private_identity'], lambda: None):
            with generation_contract._physical():
                return step.check()

    def test_legitimate_prefix_owner_recheck_keeps_original_inventory_binding(self):
        fixture = self.prefix()
        path = generation_contract.PATHS[0]
        original_sha = generation_contract.sha(fixture.before[path])

        def bound_input(*, skip_lock=False):
            raw, _, observed_sha = step.files.read(path)
            if observed_sha != original_sha:
                raise ValueError('current owner recheck lost original inventory binding')
            self.assertEqual(raw, fixture.before[path])

        step = self.step(fixture, bound_input)
        self.check_in_physical_writer_context(fixture, step)

    def test_foreign_prefix_rejected_before_owner_binding_check(self):
        fixture = self.prefix()
        fixture.write(generation_contract.PATHS[0], {'foreign': 'inventory'})
        checks = []
        step = self.step(fixture, lambda *, skip_lock=False: checks.append(1))
        with self.assertRaises(ValueError):
            self.check_in_physical_writer_context(fixture, step)
        self.assertEqual(checks, [])


if __name__ == '__main__':
    unittest.main()

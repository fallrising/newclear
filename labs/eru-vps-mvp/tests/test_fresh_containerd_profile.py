"""Pinned containerd fixture contract; all command effects are synthetic."""
import copy
import json
import unittest

from app_cli_adapter import EruCLIAdapter
from fresh_rebuild import plan_digest
from test_app_cli_adapter import FakeOperator
from test_fresh_replay_host import Harness, contract, host


class ContainerdProfileTests(unittest.TestCase):
    def setUp(self):
        self.h = Harness()
        self.addCleanup(self.h.close)

    def deploy(self, entry='web'):
        self.h.plan['desired_apps'][0]['entrypoint'] = entry
        self.h.plan['steps'] = contract.steps(self.h.plan['desired_apps'])
        self.h.digest = plan_digest(self.h.plan)
        self.h.dispatch(self.h.action(2), 'b' * 64)
        return self.h.rows[0]

    def test_default_containerd_id_equals_source_generated_name(self):
        row = self.deploy()
        self.assertEqual(self.h.identity_profile, 'containerd')
        self.assertEqual(row['id'], row['name'])
        self.assertRegex(row['name'], r'^erumvp[0-9a-f]{12}_web_[a-zA-Z]{6}$')
        self.assertLessEqual(len(row['id']), 64)

    def test_actual_entrypoint_survives_cli_metadata_and_runtime(self):
        row = self.deploy('api-v2-main')
        wid = row['id']
        desired, _, appname = host.apps.spec_identity(self.h.plan['desired_apps'][0])
        self.assertRegex(wid, '^' + appname + r'_api-v2-main_[A-Za-z]{6}$')
        self.assertEqual(wid, row['name'])
        cli = self.h.metadata_rows()[0]
        self.assertEqual((cli['id'], cli['name']), (wid, wid))
        ledger = self.h.metadata_state()
        primary = ledger['/eru/workloads/' + wid]
        self.assertEqual(primary, ledger['/eru/node/worker-2:workloads/' + wid])
        self.assertEqual(primary, ledger['/eru/deploy/' + appname + '/api-v2-main/worker-2/' + wid])
        stored = json.loads(primary)
        self.assertEqual(len(stored), 13)
        self.assertEqual((stored['id'], stored['name']), (wid, wid))
        runtime = self.h.runner(1)(('/usr/bin/ctr', '--namespace', 'eru', 'containers', 'list', '-q'))
        tasks = self.h.runner(1)(('/usr/bin/ctr', '--namespace', 'eru', 'tasks', 'list', '-q'))
        self.assertEqual(runtime['stdout'], (wid + '\n').encode())
        self.assertEqual(tasks['stdout'], runtime['stdout'])
        self.assertTrue((self.h.roots[1] / 'run/eru/workloads' / wid).is_file())
        self.assertEqual((self.h.roots[1] / 'var/lib/cni/networks/eru/10.1.0.1').read_text(), wid + '\n')
        action = self.h.action(3)
        host.validate_evidence(action, self.h.observe(action))

    def test_suffix_is_deterministic_unique_bounded_and_not_reused(self):
        other = Harness()
        self.addCleanup(other.close)
        generated = [self.h.workload_identity('erumvp' + 'a' * 12, 'api') for _ in range(53)]
        self.assertEqual(generated, [other.workload_identity('erumvp' + 'a' * 12, 'api') for _ in range(53)])
        self.assertEqual(len({wid for wid, _ in generated}), 53)
        for wid, name in generated:
            self.assertEqual(wid, name)
            self.assertRegex(name.rsplit('_', 1)[1], r'^[A-Za-z]{6}$')
        self.h.rows.clear()  # Removal cannot reset the instance sequence.
        self.assertNotIn(self.h.workload_identity('erumvp' + 'a' * 12, 'api'), generated)
        self.h.counter = 52 ** 6 - 1
        self.assertTrue(self.h.workload_identity('erumvp' + 'a' * 12, 'api')[0].endswith('_ZZZZZZ'))
        with self.assertRaisesRegex(ValueError, 'exhausted'):
            self.h.workload_identity('erumvp' + 'a' * 12, 'api')

    def test_ordinary_exact_get_remove_and_probe_accept_current_profile(self):
        row = self.deploy('api-v2-main')
        operator = FakeOperator()
        operator.rows = self.h.metadata_rows()
        adapter = EruCLIAdapter(operator)
        self.assertEqual(adapter.get_workload(row['id']), operator.rows[0])
        result = adapter.probe(operator.rows[0], self.h.plan['desired_apps'][0])
        self.assertEqual(result, {'status': 200, 'body_match': True})
        probe = operator.commands[-1]
        self.assertEqual(probe['host'], 'ckc-disposable-02')
        self.assertIn(row['id'], probe['stdin'])
        adapter.remove_exact(row['id'])
        self.assertEqual(operator.commands[-1]['argv'][-4:], ['workload', 'remove', '--force', row['id']])
        self.assertEqual(operator.commands[-1]['host'], 'ckc-disposable-01')
        # FakeOperator records commands; no SSH, ctr, or HTTP is executed.

    def test_ordinary_probe_rejects_foreign_node_labels_and_spec_before_command(self):
        row = self.deploy('api-v2-main')
        operator = FakeOperator()
        adapter = EruCLIAdapter(operator)
        for field, value in (('id', 'foreign_api_aaaaaa'), ('nodename', 'worker-3'),
                             ('owner', 'foreign'), ('logical_app', 'foreign'), ('spec_sha256', '0' * 64)):
            bad = copy.deepcopy(row)
            if field in ('id', 'nodename'):
                bad[field] = value
            else:
                bad['labels'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                adapter.probe(bad, self.h.plan['desired_apps'][0])
        self.assertEqual(operator.commands, [])
        operator.rows = [dict(row, id='foreign_api_aaaaaa')]
        self.assertIsNone(adapter.get_workload(row['id']))
        operator.rows = [copy.deepcopy(row), copy.deepcopy(row)]
        with self.assertRaises(RuntimeError):
            adapter.get_workload(row['id'])

    def test_full_replay_proof_rejects_foreign_entrypoint_and_owned_fields(self):
        original = copy.deepcopy(self.deploy('api-v2-main'))
        for field, value in (('name', original['name'].replace('_api-v2-main_', '_other_')),
                             ('name', 'foreign_api-v2-main_aaaaaa'), ('nodename', 'worker-3'),
                             ('owner', 'foreign'), ('logical_app', 'foreign'), ('spec_sha256', '0' * 64)):
            self.h.rows[0] = copy.deepcopy(original)
            if field in ('name', 'nodename'):
                self.h.rows[0][field] = value
            else:
                self.h.rows[0]['labels'][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                action = self.h.action(3)
                host.validate_evidence(action, self.h.observe(action))

    def test_opaque_parser_profile_requires_explicit_opt_in(self):
        opaque = Harness(identity_profile='opaque-parser')
        self.addCleanup(opaque.close)
        opaque.dispatch(opaque.action(2), 'b' * 64)
        row = opaque.rows[0]
        self.assertNotEqual(row['id'], row['name'])
        self.assertRegex(row['id'], r'^[0-9a-f]{64}$')
        self.assertRegex(row['name'], r'^erumvp[0-9a-f]{12}_web_[A-Za-z]{6}$')
        with self.assertRaises(ValueError):
            Harness(identity_profile='process')


if __name__ == '__main__':
    unittest.main()

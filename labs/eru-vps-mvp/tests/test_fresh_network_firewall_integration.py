"""Directory/file helpers plus activation coordinator; fake kernel only."""
import copy
import json
import unittest

import test_fresh_network_directory_integration as fixture
import fresh_network_firewall as policy
import fresh_network_firewall_ops as ops


class FirewallIntegration(unittest.TestCase):
    def setUp(self):
        self.d = fixture.DirectoryIntegrationTests()
        self.d.setUp()
        self.addCleanup(self.d.doCleanups)
        self.f = self.d.f
        auth = copy.deepcopy(self.f.auth)
        auth.update(operation='fresh-network-firewall-activation-authorization',
                    scope='activate-fresh-firewall-only')
        self.authpath = 'private/firewall-authorization.json'
        self.authsha = self.f.f.f.f.r.write(self.authpath, auth)
        self.f.f.f.f.r.f.secure()
        self.calls, self.tables = [], {}
        self.lost = True

    def observe(self, action):
        self.calls.append(('observe', action['host_index']))
        staged = {k: copy.deepcopy(action[k]) for k in ('schema_version', 'plan_id',
            'plan_sha256', 'run_id', 'execution_sha256', 'pending_sha256', 'host_index', 'host')}
        staged['operation'] = 'fresh-network-file-staging'
        value = self.f.adapter.observe(staged)
        value['table'] = copy.deepcopy(self.tables.get(action['host_index'], {'kind': 'absent'}))
        return value

    def activate(self, action, intent_sha256):
        self.calls.append(('activate', action['host_index']))
        path = self.f.project / ops.AREA / self.f.run / ('host-' + str(action['host_index'])) / 'intent.json'
        stored = json.loads(path.read_text())
        self.assertEqual(stored['sha256'], intent_sha256)
        self.assertEqual(stored['intent']['action'], action)
        self.tables[action['host_index']] = {'kind': 'present',
            'ruleset': policy.expected_ruleset(action), 'intent_sha256': intent_sha256}
        if self.lost:
            raise OSError('synthetic lost reply PRIVATE-SENTINEL')

    def run_activation(self, index=0):
        return ops.activate_network_firewall(self.f.project, self.f.plan['id'],
            self.f.plan['sha256'], self.authpath, self.authsha, index, self,
            now=self.f.now, source_state=self.f.source)

    def test_bare_directory_files_then_firewall_lost_response_only_observes(self):
        self.assertEqual(self.run_activation()['status'], 'blocked')
        self.assertEqual(self.calls, [])
        for index in range(4):
            self.assertEqual(self.d.prepare(index)['status'], 'prepared')
            self.assertEqual(self.f.stage(index)['status'], 'staged')
        result = self.run_activation()
        self.assertEqual(result['status'], 'uncertain')
        calls = list(self.calls)
        self.assertEqual(self.run_activation()['status'], 'uncertain')
        self.assertEqual(self.calls, calls)
        recovered = ops.reconcile_network_firewall(self.f.project, self.f.run, 0,
            result['intent_sha256'], self, now=self.f.now, source_state=self.f.source)
        self.assertEqual(recovered['status'], 'firewall-active')
        self.assertEqual(self.calls[len(calls):], [('observe', 0)])
        calls = list(self.calls)
        inspected = ops.inspect_network_firewall(self.f.project, self.f.run, 0,
            result['intent_sha256'], now=self.f.now, source_state=self.f.source)
        self.assertEqual(inspected['status'], 'firewall-active')
        self.assertEqual(self.calls, calls)
        self.assertEqual(self.calls.count(('activate', 0)), 1)
        for name in ('stage_accepted', 'generation_changed', 'external_fence_verified'):
            self.assertIs(recovered[name], False)
        self.assertNotIn('PRIVATE-SENTINEL', json.dumps(result))

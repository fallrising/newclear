"""Actual directory/file/firewall helpers over temp roots; fake kernel only."""
import ast
import base64
import copy
import json
import os
import unittest

import test_fresh_network_directory_integration as fixture
import fresh_network_firewall as policy
import fresh_network_firewall_ops as ops
import fresh_network_firewall_host as host_helper
from fresh_network_firewall_ssh import SSHNetworkFirewallAdapter


class AdapterIntegration(unittest.TestCase):
    def setUp(self):
        self.d = fixture.DirectoryIntegrationTests()
        self.d.setUp()
        self.addCleanup(self.d.doCleanups)
        self.f = self.d.f
        auth = copy.deepcopy(self.f.auth)
        auth.update(operation=policy.OPERATION + '-authorization', scope='activate-fresh-firewall-only')
        self.authpath = 'private/firewall-authorization.json'
        self.authsha = self.f.f.f.f.r.write(self.authpath, auth)
        self.f.f.f.f.r.f.secure()
        self.tables, self.calls, self.kcalls, self.lose = {}, [], [], True
        self.adapter = SSHNetworkFirewallAdapter(self.d.keys, transport=self.transport)

    def transport(self, host, program, key):
        self.assertEqual(key, self.d.keys[host['alias']])
        compile(program, '<fixed-firewall-bundle>', 'exec')
        call = ast.parse(program).body[-1].value
        self.assertEqual(call.func.id, 'main')
        request = json.loads(base64.b64decode(ast.literal_eval(call.args[0]), validate=True))
        self.calls.append((request['operation'], request['action']['host_index']))
        action = request['action']
        def runner(argv, input_bytes=None):
            argv = list(argv)
            self.kcalls.append((action['host_index'], argv, input_bytes))
            table = self.tables.get(host['alias'])
            if 'tables' in argv:
                rows = [{'table': {'family': 'inet', 'name': 'unrelated_table', 'handle': 99}}]
                if table is not None:
                    rows.append(copy.deepcopy(table['nftables'][0]))
                return json.dumps({'nftables': rows}).encode()
            if 'list' in argv:
                self.assertIsNotNone(table)
                return json.dumps(table).encode()
            self.assertIsNotNone(input_bytes)
            batch = json.loads(input_bytes)
            self.assertEqual(batch['nftables'][0], {'create': {'table': {'family': 'inet', 'name': 'eru_fresh_access'}}})
            self.assertTrue(all(set(row)=={'add'} for row in batch['nftables'][1:]))
            self.assertIsNone(table)
            rules = policy.expected_ruleset(action)
            for number, row in enumerate(rules['nftables'], 1):
                next(iter(row.values()))['handle'] = number
            self.tables[host['alias']] = rules
            return b''
        result = host_helper.handle(request, root=str(self.d.roots[host['alias']]),
            owner_uid=os.getuid(), owner_gid=os.getgid(), now=self.f.now, runner=runner)
        result['directory'].update(uid=0, gid=0)
        for row in result['files']:
            row.update(uid=0, gid=0)
        if request['operation'] == 'activate' and self.lose:
            raise OSError('synthetic lost firewall response SECRET')
        return json.dumps(result).encode()

    def activate(self):
        return ops.activate_network_firewall(self.f.project, self.f.plan['id'],
            self.f.plan['sha256'], self.authpath, self.authsha, 0, self.adapter,
            now=self.f.now, source_state=self.f.source)

    def test_helpers_then_lost_ssh_response_recover_without_kernel_replay(self):
        self.assertEqual(self.activate()['status'], 'blocked')
        self.assertEqual(self.calls, [])
        for index in range(4):
            self.assertEqual(self.d.prepare(index)['status'], 'prepared')
            self.assertEqual(self.f.stage(index)['status'], 'staged')
        result = self.activate()
        self.assertEqual(result['status'], 'uncertain')
        calls = list(self.calls)
        self.assertEqual(self.activate()['status'], 'uncertain')
        self.assertEqual(self.calls, calls)
        recovered = ops.reconcile_network_firewall(self.f.project, self.f.run, 0,
            result['intent_sha256'], self.adapter, now=self.f.now, source_state=self.f.source)
        self.assertEqual(recovered['status'], 'firewall-active')
        self.assertEqual(self.calls[len(calls):], [('observe', 0)])
        self.assertEqual(sum(raw is not None for _, _, raw in self.kcalls), 1)
        calls = list(self.calls)
        inspected = ops.inspect_network_firewall(self.f.project, self.f.run, 0,
            result['intent_sha256'], now=self.f.now, source_state=self.f.source)
        self.assertEqual(inspected['status'], 'firewall-active')
        self.assertEqual(self.calls, calls)
        for flag in ('stage_accepted', 'generation_changed', 'external_fence_verified'):
            self.assertIs(recovered[flag], False)
        self.assertNotIn('SECRET', json.dumps(result))

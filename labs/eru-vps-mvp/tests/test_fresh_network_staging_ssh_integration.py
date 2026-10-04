"""Coordinator through actual adapter/helper with fake SSH and synthetic owner mapping."""
import ast
import base64
import json
import os
from pathlib import Path
import tempfile
import unittest

import test_fresh_network_staging as fixture
import fresh_network_staging_host as host_helper
from fresh_network_staging_ssh import SSHNetworkStagingAdapter


class SSHStagingIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkStagingTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        render = self.f.f.record()['plan']['render']
        keys = dict(line.split(' ', 1) for line in render['controller_known_hosts'].splitlines())
        self.keys = {h['alias']: keys[h['ip']] for h in render['hosts']}
        self.roots, self.hosts, self.calls = {}, render['hosts'], []
        self.lose, self.race = False, False
        for index, host in enumerate(self.hosts):
            path = root / str(index)
            for directory in ('etc/eru', 'etc/ssh', 'proc/sys/kernel/random'):
                (path / directory).mkdir(parents=True, mode=0o700, exist_ok=True)
            path.chmod(0o700)
            for ancestor in path.rglob('*'):
                if ancestor.is_dir():
                    ancestor.chmod(0o700)
            for relative, value in [('etc/machine-id', host['machine_id']),
                    ('proc/sys/kernel/random/boot_id', host['boot_id']),
                    ('etc/ssh/ssh_host_ed25519_key.pub', self.keys[host['alias']] + ' fixture')]:
                target = path / relative
                target.write_text(value + '\n')
                target.chmod(0o644)
            self.roots[host['alias']] = path
        self.f.adapter = SSHNetworkStagingAdapter(self.keys, transport=self.transport)

    def transport(self, host, source, key):
        self.assertEqual(key, self.keys[host['alias']])
        call = ast.parse(source).body[-1].value
        self.assertIsInstance(call, ast.Call)
        self.assertEqual(call.func.id, 'main')
        self.assertEqual(len(call.args), 1)
        request = json.loads(base64.b64decode(ast.literal_eval(call.args[0]), validate=True))
        self.calls.append((request['operation'], request['action']['host_index']))
        root = self.roots[host['alias']]
        if request['operation'] == 'stage' and self.race:
            target = root / request['action']['host']['files'][0]['path'].lstrip('/')
            target.write_text('foreign writer')
            target.chmod(0o600)
        result = host_helper.handle(request, root=str(root), owner_uid=os.geteuid(),
                                    owner_gid=os.getegid(), now=self.f.now)
        # Explicit synthetic ownership mapping: no claim of testing real root deployment.
        result['directory']['uid'] = result['directory']['gid'] = 0
        for row in result['files']:
            if row['kind'] == 'regular':
                row['uid'] = row['gid'] = 0
        if request['operation'] == 'stage' and self.lose:
            raise OSError('synthetic lost reply PRIVATE-SENTINEL')
        return json.dumps(result).encode()

    def test_actual_helper_stage_and_offline_inspection(self):
        result = self.f.stage()
        self.assertEqual(result['status'], 'staged')
        self.assertEqual(self.calls, [('observe', 0), ('stage', 0), ('observe', 0)])
        before = list(self.calls)
        self.assertEqual(self.f.inspect(result)['status'], 'staged')
        self.assertEqual(self.calls, before)
        for file in self.hosts[0]['files']:
            path = self.roots[self.hosts[0]['alias']] / file['path'].lstrip('/')
            self.assertEqual(path.read_text(), file['content'])
        for key in ('stage_accepted', 'generation_changed', 'external_fence_verified'):
            self.assertIs(result[key], False)

    def test_worker_lost_response_recovers_only_by_observe(self):
        self.assertEqual(self.f.stage()['status'], 'staged')
        self.lose = True
        result = self.f.stage(1)
        self.assertEqual(result['status'], 'uncertain')
        calls = list(self.calls)
        self.assertEqual(self.f.stage(1)['status'], 'uncertain')
        self.assertEqual(self.calls, calls)
        recovered = self.f.reconcile(result, 1)
        self.assertEqual(recovered['status'], 'staged')
        self.assertEqual(self.calls[len(calls):], [('observe', 1)])
        self.assertEqual(self.calls.count(('stage', 1)), 1)
        self.assertNotIn('PRIVATE-SENTINEL', json.dumps(result))

    def test_remote_before_write_race_preserves_foreign_bytes_and_never_replays(self):
        self.race = True
        result = self.f.stage()
        self.assertEqual(result['status'], 'uncertain')
        target = self.roots[self.hosts[0]['alias']] / 'etc/eru/fresh-access.nft'
        self.assertEqual(target.read_text(), 'foreign writer')
        calls = list(self.calls)
        self.assertEqual(self.f.stage()['status'], 'uncertain')
        self.assertEqual(self.calls, calls)
        self.assertEqual(self.f.reconcile(result)['status'], 'uncertain')
        self.assertEqual(target.read_text(), 'foreign writer')
        self.assertEqual(self.calls.count(('stage', 0)), 1)

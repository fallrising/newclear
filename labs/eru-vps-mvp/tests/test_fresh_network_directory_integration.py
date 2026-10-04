"""Real directory-to-file-staging flow on synthetic roots; no SSH or root access."""
import ast
import base64
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest

import test_fresh_network_staging as fixture
import fresh_network_directory_host as directory_host
import fresh_network_directory_ops as directory_ops
from fresh_network_directory_ssh import SSHNetworkDirectoryAdapter
import fresh_network_staging_host as file_host
from fresh_network_staging_ssh import SSHNetworkStagingAdapter


class DirectoryIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkStagingTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        render = self.f.f.record()['plan']['render']
        by_ip = dict(line.split(' ', 1) for line in render['controller_known_hosts'].splitlines())
        self.keys = {h['alias']: by_ip[h['ip']] for h in render['hosts']}
        self.roots, self.calls, self.lose = {}, [], False
        for index, h in enumerate(render['hosts']):
            root = Path(temp.name) / str(index)
            for name in ('etc/ssh', 'proc/sys/kernel/random'):
                (root / name).mkdir(parents=True, mode=0o700, exist_ok=True)
            root.chmod(0o700)
            for child in root.rglob('*'):
                child.chmod(0o700)
            for name, text in [('etc/machine-id', h['machine_id']),
                    ('proc/sys/kernel/random/boot_id', h['boot_id']),
                    ('etc/ssh/ssh_host_ed25519_key.pub', self.keys[h['alias']] + ' fixture')]:
                p = root / name
                p.write_text(text + '\n')
                p.chmod(0o644)
            self.roots[h['alias']] = root
        auth = copy.deepcopy(self.f.auth)
        auth.update(operation='fresh-network-directory-preparation-authorization',
                    scope='prepare-network-directory-only')
        self.authpath = 'private/directory-authorization.json'
        self.authsha = self.f.f.f.f.r.write(self.authpath, auth)
        self.f.f.f.f.r.f.secure()
        self.adapter = SSHNetworkDirectoryAdapter(self.keys, transport=self.transport)
        self.f.adapter = SSHNetworkStagingAdapter(self.keys, transport=self.transport)

    def transport(self, host, program, key):
        self.assertEqual(key, self.keys[host['alias']])
        compile(program, '<bundled-host>', 'exec')
        call = ast.parse(program).body[-1].value
        self.assertEqual(call.func.id, 'main')
        request = json.loads(base64.b64decode(ast.literal_eval(call.args[0]), validate=True))
        is_directory = request['action']['operation'] == 'fresh-network-directory-preparation'
        self.calls.append(('directory' if is_directory else 'files', request['operation'], request['action']['host_index']))
        helper = directory_host if is_directory else file_host
        result = helper.handle(request, root=str(self.roots[host['alias']]),
            owner_uid=os.getuid(), owner_gid=os.getgid(), now=self.f.now)
        # Explicit local-only synthetic metadata mapping, not real privileged deployment.
        if result['directory']['kind'] == 'directory':
            result['directory'].update(uid=0, gid=0)
        for row in result.get('files', []):
            if row['kind'] == 'regular':
                row.update(uid=0, gid=0)
        if is_directory and request['operation'] == 'prepare' and self.lose:
            raise OSError('synthetic lost response SECRET')
        return json.dumps(result).encode()

    def prepare(self, index=0, **kwargs):
        return directory_ops.prepare_network_directory(self.f.project, self.f.plan['id'],
            self.f.plan['sha256'], self.authpath, self.authsha, index, self.adapter,
            now=self.f.now, source_state=self.f.source, **kwargs)

    def recover(self, result, index=0):
        return directory_ops.reconcile_network_directory(self.f.project, self.f.run, index,
            result['intent_sha256'], self.adapter, now=self.f.now, source_state=self.f.source)

    def test_directory_preparation_bridges_bare_roots_to_file_staging(self):
        self.assertEqual(self.f.stage()['status'], 'blocked')
        results = [self.prepare(i) for i in range(4)]
        self.assertEqual([r['status'] for r in results], ['prepared'] * 4)
        for r in results:
            for flag in ('stage_accepted', 'generation_changed', 'external_fence_verified'):
                self.assertIs(r[flag], False)
        self.assertEqual(self.f.stage()['status'], 'staged')
        calls = list(self.calls)
        result = directory_ops.inspect_network_directory(self.f.project, self.f.run, 0,
            results[0]['intent_sha256'], now=self.f.now, source_state=self.f.source)
        self.assertEqual(result['status'], 'prepared')
        self.assertEqual(self.calls, calls)
        # Remote directory provenance remains valid after subsequent staged contents.
        slot = self.f.project / directory_ops.AREA / self.f.run / 'host-0' / 'intent.json'
        action = json.loads(slot.read_text())['intent']['action']
        self.assertEqual(self.adapter.observe(action)['directory']['intent_sha256'], results[0]['intent_sha256'])

    def test_lost_prepare_reply_recovers_without_replay_then_files_stage(self):
        self.lose = True
        result = self.prepare()
        self.assertEqual(result['status'], 'uncertain')
        calls = list(self.calls)
        self.assertEqual(self.prepare()['status'], 'uncertain')
        self.assertEqual(self.calls, calls)
        recovered = self.recover(result)
        self.assertEqual(recovered['status'], 'prepared')
        self.assertEqual(self.calls[len(calls):], [('directory', 'observe', 0)])
        self.assertEqual(self.calls.count(('directory', 'prepare', 0)), 1)
        self.assertNotIn('SECRET', json.dumps(result))
        self.assertEqual(self.f.stage()['status'], 'staged')

    def test_file_only_authorization_cannot_prepare_directory(self):
        self.authpath, self.authsha = self.f.authpath, self.f.authsha
        self.assertEqual(self.prepare()['status'], 'blocked')
        self.assertEqual(self.calls, [])
        self.assertTrue(all(not (root / 'etc/eru').exists() for root in self.roots.values()))

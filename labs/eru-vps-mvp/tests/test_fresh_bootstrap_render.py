"""Synthetic token/artifact rendering only."""
import base64
import copy
import hashlib
import unittest

from fresh_bootstrap_render import build_render, validate_render


def fixture():
    def sha(raw):
        return hashlib.sha256(raw).hexdigest()
    hosts = [{'alias': 'ckc-disposable-%02d' % (i + 1), 'node': 'worker-%d' % (i + 1),
              'ip': '100.91.0.%d' % (i + 1), 'machine_id': 'machine-%d' % i,
              'boot_id': '00000000-0000-0000-0000-%012d' % (i + 1),
              'host_key_sha256': sha(b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([i + 1]) * 32),
              'files': []} for i in range(4)]
    access = {'hosts': hosts, 'profile': 'A', 'private_interface': 'tailscale0',
              'controller_ip': '100.91.0.10', 'controller_known_hosts': ''}
    tags = [('projecteru2/core', 'v0.1.5'), ('projecteru2/cli', 'v0.1.5'),
            ('projecteru2/resource-extend', 'v0.1.5'), ('etcd-io/etcd', 'v3.6.14'),
            ('projecteru2/agent', 'v0.1.3'), ('containernetworking/plugins', 'v1.9.1')]
    lock = {'architecture': 'linux/amd64', 'artifacts': [
        {'repository': r, 'tag': t, 'url': 'https://github.com/' + r + '/releases/download/' + t + '/fixture.tar.gz',
         'sha256': sha(r.encode())} for r, t in tags]}
    binary = b'synthetic-safe-core'
    safe = {'selection': {'repository': 'projecteru2/core', 'architecture': 'linux/amd64',
        'source_tag': 'v0.1.5', 'target_version': 'v0.1.5',
        'validation_file': 'patches/core-v0.1.5-safe-node-add.validation.json',
        'validation_sha256': 'a' * 64, 'patch_file': 'core-v0.1.5-safe-node-add.patch',
        'artifact_sha256': sha(binary)}, 'binary_base64': base64.b64encode(binary).decode()}
    capacities = [{'node': h['node'], 'resource_capacity': {'storage': {'storage': 10737418240}},
                   'labels': {'owner': 'eru-vps-mvp', 'role': 'worker'}} for h in hosts[1:]]
    token = b'new-reviewed-token-123'
    return access, lock, token, {'run_id': 'run-1', 'target_token_sha256': sha(token),
        'prior_token_sha256': 'f' * 64, 'safe_core': safe, 'capacities': capacities}


class RenderTests(unittest.TestCase):
    def test_deterministic_fresh_token_and_safe_core(self):
        access, lock, token, options = fixture()
        result = build_render(access, lock, token, **options)
        self.assertEqual(result, build_render(access, lock, token, **options))
        self.assertEqual(result, validate_render(result))
        self.assertEqual(result['data_root'], '/var/lib/eru-fresh-etcd/run-1')
        self.assertEqual(len(result['workers']), 3)
        self.assertNotIn('projecteru2/core', [a['repository'] for a in result['hosts'][0]['core_install']['artifacts']])

    def test_raw_token_and_unpatched_binary_guards(self):
        access, lock, token, options = fixture()
        for bad in (token + b'\n', b'', b'x\nmalicious', 'string'):
            with self.assertRaises(ValueError):
                build_render(access, lock, bad, **options)
        bad = copy.deepcopy(options)
        bad['prior_token_sha256'] = bad['target_token_sha256']
        with self.assertRaises(ValueError):
            build_render(access, lock, token, **bad)
        bad = copy.deepcopy(options)
        bad['safe_core']['selection']['artifact_sha256'] = 'b' * 64
        with self.assertRaises(ValueError):
            build_render(access, lock, token, **bad)

    def test_actual_private_binary_larger_than_old_sixteen_mib_limit(self):
        access, lock, token, options = fixture()
        raw = b'x' * (17 * 1024 * 1024)
        options['safe_core']['selection']['artifact_sha256'] = hashlib.sha256(raw).hexdigest()
        options['safe_core']['binary_base64'] = base64.b64encode(raw).decode()
        result = build_render(access, lock, token, **options)
        self.assertEqual(result, validate_render(result))
        payload = result['hosts'][0]['core_install']['binaries'][0]
        self.assertEqual(payload['source'], 'safe-core')
        self.assertNotIn('content_base64', payload)
        self.assertEqual(len(result['inputs']['safe_core']['binary_base64']), len(options['safe_core']['binary_base64']))

    def test_forged_payload_and_identity_capacity_rejected(self):
        access, lock, token, options = fixture()
        result = build_render(access, lock, token, **options)
        result['hosts'][0]['etcd_install']['files'][0]['content'] += 'snapshot: old\n'
        with self.assertRaises(ValueError):
            validate_render(result)
        options['capacities'][1]['node'] = 'worker-2'
        with self.assertRaises(ValueError):
            build_render(access, lock, token, **options)

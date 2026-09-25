"""Offline checks for exact worker-only bootstrap payload generation."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from worker_payload import build_worker_payload


LOCK = {
    'architecture': 'linux/amd64',
    'artifacts': [
        {'repository': 'projecteru2/core', 'tag': 'v0.1.5', 'sha256': 'a' * 64,
         'url': 'https://example.invalid/core.tar.gz'},
        {'repository': 'projecteru2/agent', 'tag': 'v0.1.3', 'sha256': 'b' * 64,
         'url': 'https://example.invalid/agent.tar.gz'},
        {'repository': 'containernetworking/plugins', 'tag': 'v1.9.1', 'sha256': 'c' * 64,
         'url': 'https://example.invalid/cni.tar.gz'},
        {'repository': 'projecteru2/cli', 'tag': 'v0.1.5', 'sha256': 'd' * 64,
         'url': 'https://example.invalid/cli.tar.gz'},
    ],
}
HOST = {'alias': 'ckc-disposable-04', 'ip': '100.64.0.4', 'node': 'worker-4', 'index': 4}


class WorkerPayloadTests(unittest.TestCase):
    def test_builds_one_worker_payload_with_only_worker_artifacts_and_files(self):
        plan = build_worker_payload(HOST, '100.64.0.1', LOCK)
        self.assertEqual((plan['alias'], plan['node'], plan['role']),
                         ('ckc-disposable-04', 'worker-4', 'worker'))
        self.assertEqual(plan['core_ip'], '100.64.0.1')
        self.assertEqual({row['repository'] for row in plan['artifacts']}, {
            'projecteru2/agent', 'containernetworking/plugins'})
        agent = next(row for row in plan['artifacts'] if row['repository'] == 'projecteru2/agent')
        self.assertEqual(agent['files'], {'eru-agent': '/usr/local/bin/eru-agent'})
        cni = next(row for row in plan['artifacts'] if row['repository'] == 'containernetworking/plugins')
        self.assertEqual(cni['files'], {
            'bridge': '/opt/cni/bin/bridge', 'host-local': '/opt/cni/bin/host-local',
            'loopback': '/opt/cni/bin/loopback'})
        files = {row['path']: row['content'] for row in plan['files']}
        self.assertEqual(set(files), {
            '/usr/local/libexec/eru-ssh-command', '/etc/eru/agent.yaml',
            '/etc/cni/net.d/10-eru.conflist',
            '/etc/systemd/system/eru-containerd-proxy.socket',
            '/etc/systemd/system/eru-containerd-proxy.service',
            '/etc/systemd/system/eru-agent.service',
        })
        self.assertIn('100.64.0.1:5001', files['/etc/eru/agent.yaml'])
        self.assertIn('10.66.4.0/24', files['/etc/cni/net.d/10-eru.conflist'])
        self.assertIn('ERU_HOSTNAME=worker-4', files['/etc/systemd/system/eru-agent.service'])
        self.assertFalse(any('eru-core' in path or 'etcd' in path for path in files))
        self.assertEqual(plan['start_units'], ['eru-containerd-proxy.socket'])
        self.assertFalse(any('docker' in unit or 'containerd.service' in unit
                             for unit in plan['start_units'] + plan['verify_units']))

    def test_builds_correct_fixed_subnet_for_each_worker_alias(self):
        for alias, (node, index) in {
            'ckc-disposable-02': ('worker-2', 2),
            'ckc-disposable-03': ('worker-3', 3),
            'ckc-disposable-04': ('worker-4', 4),
        }.items():
            with self.subTest(alias=alias):
                plan = build_worker_payload({'alias': alias, 'node': node, 'index': index,
                                             'ip': f'100.64.0.{index}'}, '100.64.0.1', LOCK)
                config = next(row['content'] for row in plan['files']
                              if row['path'] == '/etc/cni/net.d/10-eru.conflist')
                self.assertIn(f'10.66.{index}.0/24', config)

    def test_rejects_identity_address_architecture_and_artifact_drift(self):
        invalid = [
            ({'alias': 'ckc-disposable-01', 'node': 'worker-1', 'index': 1, 'ip': '100.64.0.1'}, LOCK, 'worker alias'),
            ({**HOST, 'node': 'worker-3'}, LOCK, 'identity'),
            ({**HOST, 'index': 3}, LOCK, 'identity'),
            ({**HOST, 'ip': '192.0.2.4'}, LOCK, 'Tailscale IPv4'),
            (HOST, {**LOCK, 'architecture': 'linux/arm64'}, 'architecture'),
            (HOST, {**LOCK, 'artifacts': [row for row in LOCK['artifacts']
                                             if row['repository'] != 'containernetworking/plugins']},
             'include agent and CNI'),
            (HOST, {**LOCK, 'artifacts': LOCK['artifacts'] + [LOCK['artifacts'][1]]}, 'exactly once'),
            (HOST, {**LOCK, 'artifacts': [dict(row, sha256='bad')
                                          if row['repository'] == 'projecteru2/agent' else row
                                          for row in LOCK['artifacts']]}, 'SHA-256 metadata'),
        ]
        for host, lock, message in invalid:
            with self.subTest(host=host, message=message):
                with self.assertRaisesRegex(ValueError, message):
                    build_worker_payload(host, '100.64.0.1', lock)

    def test_plan_payload_is_serializable_and_contains_no_private_material(self):
        plan = build_worker_payload(HOST, '100.64.0.1', LOCK)
        encoded = json.dumps(plan, sort_keys=True)
        self.assertIn('worker-4', encoded)
        self.assertNotIn('private/', encoded)
        self.assertNotIn('private_key', encoded)
        self.assertNotIn('password', encoded)


if __name__ == '__main__':
    unittest.main()

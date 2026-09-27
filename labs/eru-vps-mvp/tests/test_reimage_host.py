"""Offline tests for the post-reimage, read-only SSH identity gate."""
import base64
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from reimage_host import REMOTE_FACTS, inspect_replacement_host


ALIAS = 'ckc-disposable-04'
KEY_BLOB = b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00 ' + b'\x01' * 32
FINGERPRINT = 'SHA256:' + base64.b64encode(hashlib.sha256(KEY_BLOB).digest()).decode().rstrip('=')
EXPECTED = {
    'machine_id': 'replacement-machine-id-4',
    'boot_id': '11111111-1111-1111-1111-111111111111',
    'os_release': 'Debian GNU/Linux 13',
    'host_key_fingerprints': {'ssh-ed25519': FINGERPRINT},
}


def facts():
    return {
        'schema_version': 1,
        'machine_id': EXPECTED['machine_id'],
        'boot_id': EXPECTED['boot_id'],
        'os_release': EXPECTED['os_release'],
        'tailscale_ipv4': '100.64.0.4',
        'services': {'ssh.service': 'active', 'tailscaled.service': 'active',
                     'docker.service': 'active', 'containerd.service': 'active'},
        'core_config_present': False,
        'etcd_data_present': False,
        'eru_agent_binary_present': False,
        'eru_agent_config_present': False,
        'eru_agent_unit_present': False,
        'runtime_counts': {'containers': 0, 'tasks': 0},
        'docker_version': 'Docker version 28.0.0',
        'containerd_version': 'containerd v2.3.5',
    }


class Runner:
    def __init__(self, report, config=None):
        self.report = report
        self.config = config or ('user ckc\nhostname 100.64.0.4\nport 22\n'
                                 'proxycommand /usr/bin/tailscale nc %h %p\nproxyjump none\n')
        self.calls = []

    def __call__(self, argv, *, input=None, capture_output, text, timeout):
        self.calls.append((argv, input, timeout))
        if argv == ['ssh', '-G', ALIAS]:
            return SimpleNamespace(returncode=0, stdout=self.config, stderr='')
        return SimpleNamespace(returncode=0, stdout=json.dumps(self.report), stderr='')


class ReimageHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.trusted = Path(self.temp.name)
        (self.trusted / 'disposable-04').write_text(
            ALIAS + ' ssh-ed25519 ' + base64.b64encode(KEY_BLOB).decode() + '\n')

    def test_read_only_gate_uses_only_strict_fixed_alias_and_existing_key(self):
        runner = Runner(facts())
        result = inspect_replacement_host(ALIAS, EXPECTED, self.trusted, runner=runner)
        self.assertEqual(result['machine_id'], EXPECTED['machine_id'])
        self.assertEqual(result['boot_id'], EXPECTED['boot_id'])
        self.assertEqual(result['host_key_file_check']['host_key_fingerprints'],
                         EXPECTED['host_key_fingerprints'])
        self.assertEqual(len(runner.calls), 2)
        argv, stdin, timeout = runner.calls[1]
        self.assertEqual(argv[-2], ALIAS)
        self.assertEqual(argv[-1], 'sudo -n python3 -')
        self.assertIn('StrictHostKeyChecking=yes', argv)
        self.assertIn('UpdateHostKeys=no', argv)
        self.assertIn('GlobalKnownHostsFile=/dev/null', argv)
        self.assertIn('UserKnownHostsFile=' + str(self.trusted / 'disposable-04'), argv)
        self.assertEqual(stdin, REMOTE_FACTS)
        self.assertEqual(timeout, 90)
        self.assertNotIn('--apply', argv)

    def test_gate_rejects_unreviewed_alias_or_mismatched_local_key_before_ssh(self):
        runner = Runner(facts())
        with self.assertRaisesRegex(ValueError, 'must use ckc-disposable'):
            inspect_replacement_host('root@192.0.2.4', EXPECTED, self.trusted, runner=runner)
        wrong_fingerprint = 'SHA256:' + base64.b64encode(hashlib.sha256(b'wrong key').digest()).decode().rstrip('=')
        wrong = dict(EXPECTED, host_key_fingerprints={'ssh-ed25519': wrong_fingerprint})
        with self.assertRaisesRegex(ValueError, 'differ from the owner receipt'):
            inspect_replacement_host(ALIAS, wrong, self.trusted, runner=runner)
        self.assertEqual(runner.calls, [])

    def test_gate_rejects_unsafe_ssh_alias_config_without_remote_command(self):
        runner = Runner(facts(), config='user root\nhostname 100.64.0.4\nport 22\n'
                                      'proxycommand /tmp/side-effect\nproxyjump none\n')
        with self.assertRaisesRegex(ValueError, 'SSH alias configuration'):
            inspect_replacement_host(ALIAS, EXPECTED, self.trusted, runner=runner)
        self.assertEqual(len(runner.calls), 1)

    def test_gate_rejects_identity_state_and_readiness_drift(self):
        invalid = [
            ({'machine_id': 'other-machine'}, 'machine id'),
            ({'boot_id': '22222222-2222-2222-2222-222222222222'}, 'boot id'),
            ({'os_release': 'Debian GNU/Linux 12'}, 'os release'),
            ({'tailscale_ipv4': '192.0.2.4'}, 'tailnet range'),
            ({'services': {'ssh.service': 'active', 'tailscaled.service': 'inactive',
                           'docker.service': 'active', 'containerd.service': 'active'}}, 'must all be active'),
            ({'core_config_present': True}, 'control-plane or ERU agent state'),
            ({'runtime_counts': {'containers': 0, 'tasks': 1}}, 'runtime must be empty'),
            ({'containerd_version': ''}, 'version is unavailable'),
            ({'extra': True}, 'schema'),
        ]
        for changes, message in invalid:
            with self.subTest(changes=changes):
                report = facts()
                report.update(changes)
                with self.assertRaisesRegex(ValueError, message):
                    inspect_replacement_host(ALIAS, EXPECTED, self.trusted, runner=Runner(report))


if __name__ == '__main__':
    unittest.main()

"""Strict network readiness evidence; all endpoints and records are synthetic."""
import base64
import copy
from datetime import datetime, timedelta, timezone
import hashlib
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from fresh_network_access import _file, _firewall, MANAGEMENT_PORTS
from fresh_observation import ALIASES, public_key
from fresh_rebuild import plan_digest

NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


def key(n):
    return 'ssh-ed25519 ' + base64.b64encode(b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([n]) * 32).decode()


def fixture():
    keys = {a: key(i + 1) for i, a in enumerate(ALIASES)}
    hosts = [{'alias': a, 'node': 'worker-' + str(i + 1), 'ip': '100.100.1.' + str(i + 1),
              'machine_id': str(i + 1) * 32, 'boot_id': str(i + 1) * 8 + '-1234-1234-1234-123456789abc',
              'host_key_sha256': public_key(keys[a])} for i, a in enumerate(ALIASES)]
    for i, host in enumerate(hosts):
        access = ''.join(h['ip'] + ' ' + keys[h['alias']] + '\n' for h in hosts[1:]) if i == 0 else (
            'from="100.100.1.1",command="/usr/local/libexec/eru-ssh-command",'
            'no-agent-forwarding,no-X11-forwarding,no-pty,no-port-forwarding,no-user-rc ' + key(9) + '\n')
        host['files'] = [_file('/etc/eru/fresh-access.nft', _firewall(hosts, i, '100.100.1.9', 'wg0')),
                         _file('/etc/eru/' + ('known_hosts' if i == 0 else 'fresh-core-authorized-key'), access)]
    render = {'profile': 'A', 'private_interface': 'wg0', 'controller_ip': '100.100.1.9', 'hosts': hosts,
              'controller_known_hosts': ''.join(h['ip'] + ' ' + keys[h['alias']] + '\n' for h in hosts)}
    setup = {'schema_version': 1, 'hosts': [{'host_index': i, 'public_ipv4': '8.8.8.' + str(i + 1),
             'public_ipv6': None, 'authorized_keys_sha256': None if i == 0 else hosts[i]['files'][1]['sha256'], 'console_action_ref': 'console-' + str(i)} for i in range(4)],
             'core_key': {'path': '/root/.ssh/eru-fresh-core', 'public_key_sha256': public_key(key(9))},
             'worker_authorized_keys_path': '/home/ckc/.ssh/authorized_keys',
             'core_known_hosts_path': '/etc/eru/known_hosts',
             'worker_helper_path': '/usr/local/libexec/eru-ssh-command', 'worker_helper_sha256': 'a' * 64,
             'controller_egress': {'interface': 'eth0', 'source_ipv4': '192.168.1.2', 'source_ipv6': None}}
    return render, setup, keys


def sample_evidence(render, setup, now=NOW):
    import fresh_network_probe as probe
    import fresh_network_firewall as firewall
    hosts = []
    for i, h in enumerate(render['hosts']):
        access = {'role': 'core', 'client_key_sha256': setup['core_key']['public_key_sha256'],
                  'known_hosts_sha256': h['files'][1]['sha256']} if i == 0 else {
                  'role': 'worker', 'helper_sha256': setup['worker_helper_sha256'],
                  'authorized_keys_sha256': setup['hosts'][i]['authorized_keys_sha256']}
        hosts.append({'host': {k: h[k] for k in probe.HOST_FIELDS}, 'private_interface': render['private_interface'],
                      'private_ipv4': h['ip'], 'global_ipv6': [setup['hosts'][i]['public_ipv6']] if setup['hosts'][i]['public_ipv6'] else [], 'services': {s: 'inactive' for s in probe.SERVICES},
                      'effective_access': access, 'current_files': [{k: f[k] for k in ('path', 'sha256')} |
                      {'uid': 0, 'gid': 0, 'mode': '0600', 'nlink': 1, 'kind': 'regular'} for f in h['files']],
                      'firewall_ruleset': firewall.expected_ruleset(probe.firewall_action(render, i))})
    return {'schema_version': 1, 'operation': 'fresh-network-ready-probes', 'observed_at': now.isoformat(),
            'render_sha256': plan_digest(render), 'setup_sha256': plan_digest(setup), 'hosts': hosts,
            'core_worker_ssh': [probe.auth_record(render, setup, i) for i in range(1, 4)],
            'controller_private_ssh': [probe.controller_record(h) for h in render['hosts']],
            'public_denials': [{**row, 'outcome': 'timed-out'} for row in probe.public_targets(render, setup)]}


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        import fresh_network_probe as probe
        self.probe = probe
        self.render, self.setup, self.keys = fixture()
        self.evidence = sample_evidence(self.render, self.setup)

    def validate(self, value):
        return self.probe.validate_network_evidence(value, self.render, NOW, setup=self.setup)

    def test_complete_evidence(self):
        self.assertEqual(self.validate(self.evidence), self.evidence)

    def test_missing_extra_duplicate_inconsistent_or_stale_rejected(self):
        mutations = [lambda e: e.update(extra=True), lambda e: e.update(schema_version=True),
            lambda e: e['hosts'].pop(), lambda e: e['hosts'].__setitem__(1, e['hosts'][0]),
            lambda e: e['hosts'][0]['host'].update(boot_id='foreign'),
            lambda e: e['hosts'][0]['services'].update({'etcd.service': 'active'}),
            lambda e: e['hosts'][0].update(global_ipv6=['2001:4860::1']),
            lambda e: e['hosts'][0].update(private_interface='eth0'),
            lambda e: e['hosts'][0]['current_files'][0].update(uid=True),
            lambda e: e['hosts'][0]['firewall_ruleset']['nftables'].pop(),
            lambda e: e['core_worker_ssh'][0].update(authentication='tcp-open'),
            lambda e: e['core_worker_ssh'][0].update(client_key_sha256='f' * 64),
            lambda e: e['controller_private_ssh'].pop(), lambda e: e['public_denials'].pop(),
            lambda e: e['public_denials'][0].update(port=True),
            lambda e: e['public_denials'][0].update(outcome='no-route'),
            lambda e: e['public_denials'][0].update(source_ip='192.168.1.3'),
            lambda e: e.update(observed_at=(NOW - timedelta(minutes=16)).isoformat())]
        for change in mutations:
            value = copy.deepcopy(self.evidence)
            change(value)
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.validate(value)

    def test_setup_arbitrary_paths_targets_and_key_hash_fail(self):
        for change in (lambda s: s['core_key'].update(path='/etc/shadow'),
                       lambda s: s['core_key'].update(public_key_sha256='f' * 64),
                       lambda s: s['hosts'][0].update(public_ipv4='127.0.0.1'),
                       lambda s: s['hosts'][0].update(host_index=True),
                       lambda s: s['controller_egress'].update(interface='eth0; touch /tmp/no')):
            setup = copy.deepcopy(self.setup)
            change(setup)
            with self.assertRaises(ValueError):
                self.probe.validate_setup(setup, self.render)


if __name__ == '__main__':
    unittest.main()

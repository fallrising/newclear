"""Pinned firewall transport; synthetic fixtures, no network or kernel calls."""
import ast
import base64
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_access as access
import fresh_network_firewall as policy
from fresh_observation import ALIASES, public_key


def key(number):
    raw = b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([number]) * 32
    return 'ssh-ed25519 ' + base64.b64encode(raw).decode()


def action(index=0):
    hosts = [{'alias': alias, 'node': 'worker-' + str(i + 1),
              'ip': '100.100.1.' + str(i + 1), 'machine_id': 'machine-' + str(i),
              'boot_id': '00000000-0000-0000-0000-%012d' % i,
              'host_key_sha256': public_key(key(i + 1))}
             for i, alias in enumerate(ALIASES)]
    for i, host in enumerate(hosts):
        host['files'] = [access._file('/etc/eru/fresh-access.nft',
            access._firewall(hosts, i, '100.100.1.10', 'tailscale0')),
            access._file('/etc/eru/' + ('known_hosts' if i == 0 else 'fresh-core-authorized-key'),
                         'fixture\n')]
    plan = {'id': 'plan-1', 'run_id': 'run-1', 'execution_sha256': 'a' * 64,
            'render': {'profile': 'A', 'private_interface': 'tailscale0',
                       'controller_ip': '100.100.1.10', 'controller_known_hosts': 'fixture\n',
                       'hosts': hosts}}
    return policy.action(plan, 'b' * 64, {'sha256': 'c' * 64}, index, 'd' * 64, 'e' * 64)


def observation(expected, intent=None):
    table = {'kind': 'absent'}
    if intent is not None:
        rules = policy.expected_ruleset(expected)
        for number, row in enumerate(rules['nftables'], 1):
            next(iter(row.values()))['handle'] = number
        table = {'kind': 'present', 'ruleset': rules, 'intent_sha256': intent}
    return {'observed_at': datetime.now(timezone.utc).isoformat(),
            'host': {k: copy.deepcopy(expected['host'][k]) for k in policy.HOST_FIELDS},
            'directory': {'path': '/etc/eru', 'kind': 'directory', 'uid': 0,
                          'gid': 0, 'mode': '0700'},
            'files': [{'path': f['path'], 'kind': 'regular', 'uid': 0, 'gid': 0,
                       'mode': '0600', 'nlink': 1, 'sha256': f['sha256'],
                       'intent_sha256': expected['staging_intent_sha256']}
                      for f in expected['host']['files']], 'table': table}


class SSHFirewallTests(unittest.TestCase):
    def setUp(self):
        import fresh_network_firewall_ssh as ssh
        self.ssh = ssh
        self.keys = {alias: key(i) for i, alias in enumerate(ALIASES, 1)}
        self.action = action()
        self.transport = Mock(return_value=json.dumps(observation(self.action)).encode())
        self.adapter = ssh.SSHNetworkFirewallAdapter(self.keys, transport=self.transport)

    def test_key_digest_mismatch_never_calls_transport(self):
        self.action['host']['host_key_sha256'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, '^network firewall adapter rejected$'):
            self.adapter.observe(self.action)
        self.transport.assert_not_called()

    def test_exact_canonical_distinct_trust_and_callable_transport(self):
        invalid = [None, {}, {**self.keys, 'extra': key(8)},
                   {alias: key(1) for alias in ALIASES}]
        for value in ('not-a-key', key(1) + ' comment', ' ' + key(1), 7):
            invalid.append({**self.keys, ALIASES[0]: value})
        for manifest in invalid:
            with self.subTest(manifest=manifest), self.assertRaisesRegex(ValueError, '^network firewall adapter rejected$'):
                self.ssh.SSHNetworkFirewallAdapter(manifest, transport=self.transport)
        with self.assertRaises(ValueError):
            self.ssh.SSHNetworkFirewallAdapter(self.keys, transport=object())
        self.transport.assert_not_called()

    def test_manifest_copy_each_role_one_pinned_endpoint_call(self):
        self.keys[ALIASES[0]] = key(9)
        for index in range(4):
            expected = action(index)
            reply = observation(expected)
            self.transport.return_value = json.dumps(reply).encode()
            self.assertEqual(self.adapter.observe(expected), reply)
            host, source, trusted = self.transport.call_args.args
            self.assertEqual(host, reply['host'])
            self.assertEqual(trusted, key(index + 1))
            compile(source, '<fixed-helper>', 'exec')
        self.assertEqual(self.transport.call_count, 4)

    def test_policy_and_path_injection_rejected_before_transport(self):
        changes = [lambda a: a.update(command='PRIVATE_INJECTION'),
                   lambda a: a.update(host_index=True), lambda a: a.update(host_index=4),
                   lambda a: a['host'].update(alias='-oProxyCommand=bad'),
                   lambda a: a['host'].update(ip='8.8.8.8'),
                   lambda a: a['host'].update(node='worker-2'),
                   lambda a: a['host']['files'][0].update(path='/etc/shadow'),
                   lambda a: a['host']['files'][0].update(mode='0644'),
                   lambda a: a['host']['files'][0].update(content='flush ruleset\n'),
                   lambda a: a['network'].update(controller_ip='100.100.1.1'),
                   lambda a: a['network'].update(private_interface='eth0'),
                   lambda a: a.update(staging_intent_sha256='INVALID')]
        for change in changes:
            request = copy.deepcopy(self.action)
            change(request)
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.adapter.observe(request)
        self.transport.assert_not_called()

    def test_wire_request_exact_and_data_only_fixed_bundle_order(self):
        request = {'schema_version': 1, 'operation': 'observe', 'action': self.action}
        tree = ast.parse(self.ssh.build_program(request))
        entry = tree.body[-1].value
        self.assertEqual(entry.func.id, 'main')
        self.assertEqual(json.loads(base64.b64decode(ast.literal_eval(entry.args[0]))), request)
        names = [ast.literal_eval(node.value.args[0]) for node in tree.body
                 if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call)
                 and isinstance(node.value.func, ast.Attribute)
                 and node.value.func.attr == 'ModuleType']
        self.assertEqual(names, ['app_desired', 'fresh_rebuild', 'fresh_execution',
            'fresh_observation', 'fresh_network_access', 'fresh_network_staging_host',
            'fresh_network_staging', 'fresh_network_firewall'])
        for field in ('root', 'owner_uid', 'owner_gid', 'now', 'runner', 'command', 'module', 'source'):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.ssh.build_program({**request, field: 'PRIVATE_INJECTION'})
        for change in ({'schema_version': True}, {'operation': 'prepare'}, {'intent_sha256': 'a' * 64}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.ssh.build_program({**request, **change})

    def test_activate_requires_exact_intent_complete_bound_response(self):
        intent = 'a' * 64
        reply = observation(self.action, intent)
        self.transport.return_value = json.dumps(reply).encode()
        self.assertEqual(self.adapter.activate(self.action, intent), reply)
        encoded = ast.literal_eval(ast.parse(self.transport.call_args.args[1]).body[-1].value.args[0])
        self.assertEqual(json.loads(base64.b64decode(encoded)), {
            'schema_version': 1, 'operation': 'activate', 'action': self.action,
            'intent_sha256': intent})
        self.assertEqual(self.transport.call_count, 1)
        for response in (observation(self.action), observation(self.action, 'b' * 64)):
            self.transport.return_value = json.dumps(response).encode()
            with self.assertRaises(ValueError):
                self.adapter.activate(self.action, intent)
        self.transport.reset_mock()
        for invalid in (None, True, 'g' * 64, 'a' * 63):
            with self.subTest(intent=invalid), self.assertRaises(ValueError):
                self.adapter.activate(self.action, invalid)
        self.transport.assert_not_called()

    def test_observe_accepts_present_provenance_and_leading_metainfo(self):
        reply = observation(self.action, 'a' * 64)
        reply['table']['ruleset']['nftables'].insert(0, {'metainfo': {
            'version': 'fixture', 'release_name': 'synthetic', 'json_schema_version': 1}})
        self.transport.return_value = json.dumps(reply).encode()
        self.assertEqual(self.adapter.observe(self.action), reply)

    def test_all_present_output_objects_require_valid_handles(self):
        for number in range(len(policy.expected_ruleset(self.action)['nftables'])):
            for invalid in (None, True, 0, -1, 2**64, 1.5):
                reply = observation(self.action, 'a' * 64)
                body = next(iter(reply['table']['ruleset']['nftables'][number].values()))
                if invalid is None:
                    body.pop('handle')
                else:
                    body['handle'] = invalid
                self.transport.return_value = json.dumps(reply).encode()
                with self.subTest(object=number, handle=invalid), self.assertRaises(ValueError):
                    self.adapter.observe(self.action)

    def test_transport_failure_generic_never_retried(self):
        self.transport.side_effect = RuntimeError('PRIVATE_HOST_AND_TOKEN')
        with self.assertRaisesRegex(ValueError, '^network firewall adapter rejected$') as caught:
            self.adapter.activate(self.action, 'a' * 64)
        self.assertTrue(caught.exception.__suppress_context__)
        self.assertEqual(self.transport.call_count, 1)

    def test_transport_mutation_cannot_change_expected_action(self):
        original = copy.deepcopy(self.action)
        def mutate(host, source, trusted):
            host['ip'] = '100.100.9.9'
            reply = observation(original)
            reply['host']['ip'] = host['ip']
            return json.dumps(reply).encode()
        self.transport.side_effect = mutate
        with self.assertRaises(ValueError):
            self.adapter.observe(self.action)
        self.assertEqual(self.action, original)

    def test_bounded_strict_response_with_generic_redaction(self):
        valid = json.dumps(observation(self.action)).encode()
        invalid = [valid.decode(), bytearray(valid), b'', b'null', b'[]', b'\xff',
                   b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":1e999}',
                   b'[' * 66 + b'0' + b']' * 66,
                   b' ' * (self.ssh.WIRE_LIMIT + 1), valid + b'{}',
                   b'{"PRIVATE_ENDPOINT":"PRIVATE_OUTPUT"}']
        for raw in invalid:
            self.transport.return_value = raw
            with self.subTest(raw=repr(raw)[:50]), self.assertRaisesRegex(ValueError, '^network firewall adapter rejected$'):
                self.adapter.observe(self.action)
        self.assertEqual(self.transport.call_count, len(invalid))

    def test_foreign_unsafe_or_changed_policy_responses_rejected(self):
        mutations = [lambda v: v.update(extra=1),
                     lambda v: v.update(observed_at='not-a-time'),
                     lambda v: v.update(observed_at='2026-10-04T10:00:00'),
                     lambda v: v['host'].update(machine_id='foreign'),
                     lambda v: v['host'].update(host_key_sha256='f' * 64),
                     lambda v: v['directory'].update(uid=True),
                     lambda v: v['directory'].update(mode='0755'),
                     lambda v: v['files'][0].update(kind='symlink'),
                     lambda v: v['files'][0].update(nlink=2),
                     lambda v: v['files'][0].update(sha256='f' * 64),
                     lambda v: v['files'][0].update(intent_sha256='f' * 64),
                     lambda v: v['table'].update(intent_sha256='INVALID'),
                     lambda v: v['table'].update(extra='unknown'),
                     lambda v: v['table']['ruleset']['nftables'][1]['chain'].update(policy='drop'),
                     lambda v: v['table']['ruleset']['nftables'][3]['rule']['expr'][0]['match'].update(right='eth0')]
        for change in mutations:
            reply = observation(self.action, 'a' * 64)
            change(reply)
            self.transport.return_value = json.dumps(reply).encode()
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.adapter.observe(self.action)

    def test_default_transport_fixed_argv_memfd_bounded_capture(self):
        import fresh_observation_ops
        response = json.dumps(observation(self.action)).encode()
        captured = []
        def capture(argv, limit, timeout, *, input_bytes, pass_fds):
            captured.append((argv, limit, timeout, input_bytes, pass_fds[0]))
            self.assertEqual(os.read(pass_fds[0], 4096), (ALIASES[0] + ' ' + key(1) + '\n').encode())
            return response
        with patch.object(fresh_observation_ops, 'capture', side_effect=capture):
            adapter = self.ssh.SSHNetworkFirewallAdapter(self.keys)
            self.assertEqual(adapter.observe(self.action), json.loads(response))
        self.assertEqual(len(captured), 1)
        argv, limit, timeout, source, fd = captured[0]
        self.assertEqual(argv[:4], ['ssh', '-F', '/dev/null', '-T'])
        self.assertEqual(argv[-7:], ['-p', '22', '-l', 'ckc', '--', '100.100.1.1', 'sudo -n python3 -'])
        for option in ('BatchMode=yes', 'StrictHostKeyChecking=yes', 'UpdateHostKeys=no',
                       'HostKeyAlgorithms=ssh-ed25519', 'GlobalKnownHostsFile=/dev/null',
                       'ConnectTimeout=10', 'ConnectionAttempts=1', 'PermitLocalCommand=no',
                       'ProxyCommand=none', 'ProxyJump=none', 'ControlMaster=no',
                       'ControlPath=none', 'ControlPersist=no', 'ClearAllForwardings=yes',
                       'ForwardAgent=no', 'ForwardX11=no', 'RemoteCommand=none', 'RequestTTY=no'):
            self.assertIn(option, argv)
        self.assertEqual((limit, timeout), (4 * 1024 * 1024, 90))
        compile(source.decode(), '<fixed-helper>', 'exec')
        with self.assertRaises(OSError):
            os.fstat(fd)

    def test_actual_bundle_runs_isolated_without_controller_repository_imports(self):
        for operation in ('observe', 'activate'):
            request = {'schema_version': 1, 'operation': operation, 'action': self.action}
            if operation == 'activate':
                request['intent_sha256'] = 'a' * 64
            parsed = ast.parse(self.ssh.build_program(request))
            entry = ast.unparse(parsed.body[-1])
            prefix = ast.unparse(ast.Module(body=parsed.body[:-1], type_ignores=[]))
            harness = prefix + "\nhandle = lambda request: {'decoded': validate_request(request)}\n" + entry
            result = subprocess.run([sys.executable, '-I', '-'], cwd='/',
                                    input=harness.encode(), capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(json.loads(result.stdout), {'decoded': request})


if __name__ == '__main__':
    unittest.main()

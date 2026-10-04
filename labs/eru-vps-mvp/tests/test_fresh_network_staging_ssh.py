"""Pinned staging transport contract; synthetic requests and no network access."""
import base64
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from fresh_observation import ALIASES, public_key


def key(number):
    raw = b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([number]) * 32
    return 'ssh-ed25519 ' + base64.b64encode(raw).decode()


def action(index=0):
    paths = ['/etc/eru/fresh-access.nft', '/etc/eru/known_hosts' if index == 0
             else '/etc/eru/fresh-core-authorized-key']
    return {'schema_version': 1, 'operation': 'fresh-network-file-staging',
            'plan_id': 'access-1', 'run_id': 'run-1', 'plan_sha256': '1' * 64,
            'execution_sha256': '2' * 64, 'pending_sha256': '3' * 64,
            'host_index': index, 'host': {'alias': ALIASES[index],
            'node': 'worker-' + str(index + 1), 'ip': '100.100.1.' + str(index + 1),
            'machine_id': 'a' * 32, 'boot_id': '12345678-1234-1234-1234-123456789abc',
            'host_key_sha256': public_key(key(index + 1)),
            'files': [{'path': p, 'mode': '0600', 'content': 'payload\n',
                       'sha256': hashlib.sha256(b'payload\n').hexdigest()} for p in paths]}}


def observation(expected, intent=None):
    return {'observed_at': datetime.now(timezone.utc).isoformat(),
            'host': {k: v for k, v in expected['host'].items() if k != 'files'},
            'directory': {'path': '/etc/eru', 'kind': 'directory', 'uid': 0,
                          'gid': 0, 'mode': '0700'},
            'files': [({'path': f['path'], 'kind': 'absent'} if intent is None else
                       {'path': f['path'], 'kind': 'regular', 'uid': 0, 'gid': 0,
                        'mode': '0600', 'nlink': 1, 'sha256': f['sha256'],
                        'intent_sha256': intent}) for f in expected['host']['files']]}


class SSHStagingTests(unittest.TestCase):
    def setUp(self):
        import fresh_network_staging_ssh as ssh
        self.ssh = ssh
        self.keys = {alias: key(i) for i, alias in enumerate(ALIASES, 1)}
        self.action = action()
        self.transport = Mock(return_value=json.dumps(observation(self.action)).encode())
        self.adapter = ssh.SSHNetworkStagingAdapter(self.keys, transport=self.transport)

    def test_key_digest_mismatch_never_calls_transport(self):
        self.action['host']['host_key_sha256'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, '^network staging adapter rejected$'):
            self.adapter.observe(self.action)
        self.transport.assert_not_called()


    def test_trust_manifest_exact_canonical_and_distinct(self):
        invalid = [None, {}, {**self.keys, 'extra': key(8)},
                   {alias: key(1) for alias in ALIASES}]
        for value in ('not-a-key', key(1) + ' comment', ' ' + key(1), 7):
            invalid.append({**self.keys, ALIASES[0]: value})
        for manifest in invalid:
            with self.subTest(manifest=manifest), self.assertRaisesRegex(ValueError, '^network staging adapter rejected$'):
                self.ssh.SSHNetworkStagingAdapter(manifest, transport=self.transport)
        self.transport.assert_not_called()

    def test_manifest_is_copied_and_each_role_uses_pinned_endpoint_once(self):
        self.keys[ALIASES[0]] = key(9)
        for index in range(4):
            expected = action(index)
            response = observation(expected)
            self.transport.return_value = json.dumps(response).encode()
            self.assertEqual(self.adapter.observe(expected), response)
            host, source, trusted = self.transport.call_args.args
            self.assertEqual(host, response['host'])
            self.assertEqual(trusted, key(index + 1))
            compile(source, '<fixed-helper>', 'exec')
        self.assertEqual(self.transport.call_count, 4)

    def test_request_injection_rejected_before_transport(self):
        mutations = [lambda a: a.update(command='touch /tmp/unwanted'),
                     lambda a: a.update(host_index=True),
                     lambda a: a.update(host_index=4),
                     lambda a: a['host'].update(alias='-oProxyCommand=bad'),
                     lambda a: a['host'].update(ip='8.8.8.8'),
                     lambda a: a['host'].update(ip='100.100.1.1;bad'),
                     lambda a: a['host'].update(node='worker-2'),
                     lambda a: a['host']['files'][0].update(path='/etc/shadow'),
                     lambda a: a['host']['files'][0].update(mode='0644'),
                     lambda a: a['host']['files'][0].update(content='changed'),
                     lambda a: a['host']['files'][0].update(extra='ignored')]
        for mutate in mutations:
            request = copy.deepcopy(self.action)
            mutate(request)
            with self.subTest(request=request), self.assertRaises(ValueError):
                self.adapter.observe(request)
        self.transport.assert_not_called()

    def test_fixed_program_embeds_only_data_and_rejects_wire_overrides(self):
        request = {'schema_version': 1, 'operation': 'observe', 'action': self.action}
        program = self.ssh.build_program(request)
        import ast
        tree = ast.parse(program)
        last = tree.body[-1]
        self.assertEqual(last.value.func.id, 'main')
        encoded = ast.literal_eval(last.value.args[0])
        self.assertEqual(json.loads(base64.b64decode(encoded)), request)
        for override in ('root', 'owner_uid', 'owner_gid', 'now', 'command', 'options'):
            with self.subTest(override=override), self.assertRaises(ValueError):
                self.ssh.build_program({**request, override: '/'})

    def test_utf8_payload_limits_are_applied_to_utf8_wire_bytes(self):
        import ast
        request = {'schema_version': 1, 'operation': 'observe', 'action': copy.deepcopy(self.action)}
        payload = '\U0001f525' * (65536 // 4)
        for item in request['action']['host']['files']:
            item.update(content=payload, sha256=hashlib.sha256(payload.encode()).hexdigest())
        source = self.ssh.build_program(request)
        encoded = ast.literal_eval(ast.parse(source).body[-1].value.args[0])
        raw = base64.b64decode(encoded)
        self.assertLessEqual(len(raw), self.ssh.WIRE_LIMIT)
        self.assertEqual(json.loads(raw), request)

    def test_stage_requires_exact_intent_and_complete_response(self):
        intent = 'a' * 64
        complete = observation(self.action, intent)
        self.transport.return_value = json.dumps(complete).encode()
        self.assertEqual(self.adapter.stage(self.action, intent), complete)
        self.assertEqual(self.transport.call_count, 1)
        self.transport.return_value = json.dumps(observation(self.action)).encode()
        with self.assertRaises(ValueError):
            self.adapter.stage(self.action, intent)
        self.assertEqual(self.transport.call_count, 2)
        self.transport.reset_mock()
        for invalid in (None, True, 'g' * 64, 'a' * 63):
            with self.subTest(intent=invalid), self.assertRaises(ValueError):
                self.adapter.stage(self.action, invalid)
        self.transport.assert_not_called()

    def test_observe_accepts_completed_provenance_without_caller_intent(self):
        response = observation(self.action, 'b' * 64)
        self.transport.return_value = json.dumps(response).encode()
        self.assertEqual(self.adapter.observe(self.action), response)
        response['files'][1]['intent_sha256'] = 'c' * 64
        self.transport.return_value = json.dumps(response).encode()
        with self.assertRaises(ValueError):
            self.adapter.observe(self.action)

    def test_transport_failure_is_generic_and_never_retried(self):
        self.transport.side_effect = RuntimeError('PRIVATE_HOST_AND_TOKEN')
        with self.assertRaisesRegex(ValueError, '^network staging adapter rejected$') as caught:
            self.adapter.stage(self.action, 'a' * 64)
        self.assertTrue(caught.exception.__suppress_context__)
        self.assertEqual(self.transport.call_count, 1)

    def test_transport_mutation_cannot_change_authoritative_action(self):
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

    def test_malformed_bounded_strict_response(self):
        valid = json.dumps(observation(self.action)).encode()
        invalid = [valid.decode(), bytearray(valid), b'', b'null', b'[]', b'\xff',
                   b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":1e999}',
                   b'[' * 66 + b'0' + b']' * 66,
                   b' ' * (self.ssh.WIRE_LIMIT + 1), valid + b'{}']
        for raw in invalid:
            self.transport.return_value = raw
            with self.subTest(raw=repr(raw)[:80]), self.assertRaisesRegex(ValueError, '^network staging adapter rejected$'):
                self.adapter.observe(self.action)
        self.assertEqual(self.transport.call_count, len(invalid))

    def test_foreign_or_unsafe_response_never_accepted(self):
        mutations = [lambda v: v.update(extra=1),
                     lambda v: v.update(observed_at='not-a-time'),
                     lambda v: v.update(observed_at='2026-10-04T10:00:00'),
                     lambda v: v['host'].update(machine_id='foreign'),
                     lambda v: v['host'].update(host_key_sha256='f' * 64),
                     lambda v: v['directory'].update(uid=True),
                     lambda v: v['directory'].update(mode='0755'),
                     lambda v: v['directory'].update(kind='symlink'),
                     lambda v: v['files'].reverse(),
                     lambda v: v['files'][0].update(kind='symlink'),
                     lambda v: v['files'][0].update(uid=True),
                     lambda v: v['files'][0].update(nlink=2),
                     lambda v: v['files'][0].update(mode='0644'),
                     lambda v: v['files'][0].update(sha256='f' * 64),
                     lambda v: v['files'][0].update(intent_sha256='c' * 64),
                     lambda v: v['files'].__setitem__(0, {'path': v['files'][0]['path'], 'kind': 'absent'})]
        for mutate in mutations:
            reply = observation(self.action, 'a' * 64)
            mutate(reply)
            self.transport.return_value = json.dumps(reply).encode()
            with self.subTest(reply=reply), self.assertRaises(ValueError):
                self.adapter.stage(self.action, 'a' * 64)

    def test_default_transport_preserves_fixed_argv_memfd_and_bounded_capture(self):
        import fresh_observation_ops
        response = json.dumps(observation(self.action)).encode()
        captured = []
        def capture(argv, limit, timeout, *, input_bytes, pass_fds):
            captured.append((argv, limit, timeout, input_bytes, pass_fds[0]))
            self.assertEqual(os.read(pass_fds[0], 4096),
                             (ALIASES[0] + ' ' + key(1) + '\n').encode())
            return response
        with patch.object(fresh_observation_ops, 'capture', side_effect=capture):
            adapter = self.ssh.SSHNetworkStagingAdapter(self.keys)
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


    def test_real_host_helper_local_stage_and_readonly_observe(self):
        import fresh_network_staging_host as helper
        import ast
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for directory in ('etc/eru', 'etc/ssh', 'proc/sys/kernel/random'):
                (root / directory).mkdir(parents=True, mode=0o700)
            for directory in root.rglob('*'):
                if directory.is_dir():
                    directory.chmod(0o700)
            for relative, content in (
                    ('etc/machine-id', self.action['host']['machine_id'] + '\n'),
                    ('proc/sys/kernel/random/boot_id', self.action['host']['boot_id'] + '\n'),
                    ('etc/ssh/ssh_host_ed25519_key.pub', key(1) + ' fixture-comment\n')):
                (root / relative).write_text(content)
                (root / relative).chmod(0o600)
            calls = []
            def local_transport(host, source, trusted):
                calls.append(host)
                tree = ast.parse(source)
                encoded = ast.literal_eval(tree.body[-1].value.args[0])
                request = json.loads(base64.b64decode(encoded))
                value = helper.handle(request, root=str(root), owner_uid=os.geteuid(),
                                      owner_gid=os.getegid())
                # Owner injection is local-only; map fixture metadata to the
                # production root assertion that the adapter must require.
                value['directory'].update(uid=0, gid=0)
                for item in value['files']:
                    if item['kind'] == 'regular':
                        item.update(uid=0, gid=0)
                return json.dumps(value).encode()
            adapter = self.ssh.SSHNetworkStagingAdapter(self.keys, transport=local_transport)
            before = adapter.observe(self.action)
            self.assertEqual([f['kind'] for f in before['files']], ['absent', 'absent'])
            after = adapter.stage(self.action, 'a' * 64)
            self.assertEqual([f['intent_sha256'] for f in after['files']], ['a' * 64] * 2)
            for item in self.action['host']['files']:
                self.assertEqual((root / item['path'].lstrip('/')).read_text(), item['content'])
            def snapshot():
                return {str(p.relative_to(root)): (p.stat().st_ino, p.stat().st_mtime_ns,
                            p.read_bytes() if p.is_file() else None)
                        for p in root.rglob('*')}
            saved = snapshot()
            observed = adapter.observe(self.action)
            self.assertEqual(observed['files'], after['files'])
            self.assertEqual(snapshot(), saved)
            with self.assertRaises(ValueError):
                adapter.stage(self.action, 'a' * 64)
            self.assertEqual(snapshot(), saved)
            self.assertEqual(len(calls), 4)


if __name__ == '__main__':
    unittest.main()

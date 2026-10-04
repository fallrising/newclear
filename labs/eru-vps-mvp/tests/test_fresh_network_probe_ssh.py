"""Run fixed bundles only against synthetic roots and injected fake transports."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from test_fresh_network_probe import NOW, fixture, key, sample_evidence
import fresh_network_probe as probe
import fresh_network_probe_ssh as ssh
import fresh_network_firewall as firewall
from fresh_observation import public_key


class SyntheticProbe:
    """Reusable fully synthetic transport executing the actual bundled observer."""
    def __init__(self, render=None, setup=None, *, dual_stack=False):
        r, s, self.keys = fixture()
        self.render, self.setup = copy.deepcopy(render or r), copy.deepcopy(setup or s)
        by_ip = dict(line.split(" ", 1) for line in self.render["controller_known_hosts"].splitlines())
        self.keys = {h["alias"]: by_ip[h["ip"]] for h in self.render["hosts"]}
        self.client_key = " ".join(self.render["hosts"][1]["files"][1]["content"].split()[-2:])
        if dual_stack:
            self.setup['controller_egress']['source_ipv6'] = '2001:4860:1::9'
            for i, row in enumerate(self.setup['hosts']):
                row['public_ipv6'] = '2001:4860:1::' + str(i + 1)
        self.helper = b'#!/bin/sh\n# SYNTHETIC fixed reviewed helper\n'
        self.setup['worker_helper_sha256'] = hashlib.sha256(self.helper).hexdigest()
        self.authorized = [h['files'][1]['content'].encode() + (key(10) + '\n').encode() for h in self.render['hosts']]
        for i in range(1, 4):
            self.setup['hosts'][i]['authorized_keys_sha256'] = hashlib.sha256(self.authorized[i]).hexdigest()
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.calls, self.transports = [], []
        self.public_outcome = 'timed-out'
        self.wrong_route = False
        self.bad_auth = False
        self.active_unit = False
        self.extra_v6 = False
        self.auth_method = 'publickey'
        self.direct_process = False
        self.authorized_path = '.ssh/authorized_keys'
        for i, host in enumerate(self.render['hosts']):
            root = self.root / str(i)
            for directory in ('etc/eru', 'etc/ssh', 'proc/sys/kernel/random', 'root/.ssh',
                              'usr/local/libexec', 'home/ckc/.ssh'):
                (root / directory).mkdir(parents=True, exist_ok=True)
            for path in [root, *root.rglob('*')]:
                if path.is_dir():
                    path.chmod(0o755)
            (root / 'etc/eru').chmod(0o700)
            files = {'etc/machine-id': host['machine_id'].encode(),
                     'proc/sys/kernel/random/boot_id': host['boot_id'].encode(),
                     'etc/ssh/ssh_host_ed25519_key.pub': self.keys[host['alias']].encode(),
                     'root/.ssh/eru-fresh-core': b'SYNTHETIC NOT A PRIVATE KEY',
                     'usr/local/libexec/eru-ssh-command': self.helper,
                     'home/ckc/.ssh/authorized_keys': self.authorized[i]}
            files.update({f['path'].lstrip('/'): f['content'].encode() for f in host['files']})
            for path, data in files.items():
                (root / path).write_bytes(data)
                (root / path).chmod(0o755 if path == 'usr/local/libexec/eru-ssh-command' else 0o600)

    def close(self):
        self.temporary.cleanup()

    def runner(self, argv, limit, timeout, **kw):
        return self.run(None, argv, limit, timeout, **kw)

    def run(self, index, argv, limit, timeout, **kw):
        self.calls.append((index, argv, limit, timeout, kw))
        if argv[0] == '/usr/sbin/ip' and 'route' in argv:
            target, source = argv[-3], argv[-1]
            interface = self.render['private_interface'] if target.startswith('100.100.') else self.setup['controller_egress']['interface']
            if self.wrong_route:
                interface = 'wrong0'
            return json.dumps([{'dst': target, 'prefsrc': source, 'dev': interface}]).encode()
        if argv[0] == '/usr/sbin/ip' and 'address' in argv:
            host = self.render['hosts'][index]
            addresses = [{'family': 'inet', 'scope': 'global', 'local': host['ip']}]
            v6 = self.setup['hosts'][index]['public_ipv6']
            if v6:
                addresses.append({'family': 'inet6', 'scope': 'global', 'local': v6})
            if self.extra_v6:
                addresses.append({'family': 'inet6', 'scope': 'global', 'local': '2001:4860::ffff'})
            return json.dumps([{'ifname': self.render['private_interface'], 'addr_info': addresses}]).encode()
        if argv[0] == '/usr/bin/systemctl':
            return b'LoadState=loaded\nActiveState=' + (b'active' if self.active_unit else b'inactive') + b'\nSubState=dead\n'
        if argv[0] == '/usr/bin/ps':
            return b'eru-core\n' if self.direct_process else b'init\n'
        if argv[0] == '/usr/sbin/sshd':
            return ('authorizedkeysfile ' + self.authorized_path + '\nauthorizedkeyscommand none\npubkeyauthentication yes\n').encode()
        if argv[0] == '/usr/sbin/nft':
            return json.dumps(firewall.expected_ruleset(probe.firewall_action(self.render, index))).encode()
        if argv[0] == '/usr/bin/ssh-keygen':
            return self.client_key.encode()
        if argv[0] == '/usr/bin/ssh':
            host = next(h for h in self.render['hosts'] if h['ip'] == argv[-2])
            record = {k: host[k] for k in ('machine_id', 'boot_id', 'host_key_sha256')}
            if self.bad_auth:
                record['boot_id'] = 'foreign'
            fingerprint = 'SHA256:' + __import__('base64').b64encode(bytes.fromhex(public_key(self.client_key))).decode().rstrip('=')
            accepted = 'debug1: Server accepts key: ' + argv[argv.index('-i') + 1] + ' ED25519 ' + fingerprint + ' explicit\n'
            authenticated = 'Authenticated to ' + host['ip'] + ' ([' + host['ip'] + ']:22) using \"' + self.auth_method + '\".\n'
            return (accepted + authenticated + json.dumps(record) + '\n').encode()
        if argv[1:4] == ['-I', '-c', ssh.CONNECT_SOURCE]:
            return json.dumps({'outcome': self.public_outcome, 'source_ip': argv[-2]}).encode()
        raise AssertionError('unreviewed command: ' + repr(argv))

    def transport(self, host, source, trusted):
        self.transports.append(host['alias'])
        index = next(i for i, h in enumerate(self.render['hosts']) if h['alias'] == host['alias'])
        assert public_key(trusted) == host['host_key_sha256']
        tree = ast.parse(source)
        request = json.loads(__import__('base64').b64decode(ast.literal_eval(tree.body[-1].value.args[0])))
        # Execute actual fixed source with no invocation of its production entry.
        ns = {}
        exec(compile(ast.Module(body=tree.body[:-1], type_ignores=[]), '<synthetic-bundle>', 'exec'), ns)
        result = ns['observe_host'](request, root=str(self.root / str(index)), uid=os.getuid(), gid=os.getgid(),
            user_uid=os.getuid(), runner=lambda argv, limit, timeout, **kw: self.run(index, argv, limit, timeout, **kw))
        return json.dumps(result).encode()

    def collect(self):
        return probe.collect_network_evidence(self.render, self.keys, setup=self.setup,
            transport=self.transport, runner=self.runner, now=NOW)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.env = SyntheticProbe()
        self.addCleanup(self.env.close)

    def test_complete_actual_fixed_bundle_and_core_authentication(self):
        value = self.env.collect()
        self.assertEqual(value, sample_evidence(self.env.render, self.env.setup))
        auth = [call for call in self.env.calls if call[1][0] == '/usr/bin/ssh']
        self.assertEqual(len(auth), 3)
        for _, argv, limit, timeout, kw in auth:
            self.assertEqual(argv[-1], ssh.IDENTITY_COMMAND)
            for option in ('IdentitiesOnly=yes', 'IdentityAgent=none', 'PreferredAuthentications=publickey',
                           'StrictHostKeyChecking=yes', 'UpdateHostKeys=no', 'ProxyCommand=none',
                           'GlobalKnownHostsFile=/dev/null', 'ControlMaster=no'):
                self.assertIn(option, argv)
            self.assertEqual(len(kw['pass_fds']), 2)
            self.assertEqual((limit, timeout), (262144, 20))
        self.assertNotIn('SYNTHETIC NOT A PRIVATE KEY', json.dumps(value))

    def test_identity_command_compatible_with_existing_forced_wrapper(self):
        import contextlib
        import io
        import shlex
        # The existing wrapper invokes /bin/sh -c "$SSH_ORIGINAL_COMMAND".
        # Parse exactly that shell argument without running a shell or SSH.
        source = Path(__file__).resolve().parents[1] / 'scripts/worker_payload.py'
        self.assertIn('exec sudo -n -- /bin/sh -c "$SSH_ORIGINAL_COMMAND"', source.read_text())
        command = shlex.split(ssh.IDENTITY_COMMAND)
        self.assertEqual(command[:3], ['/usr/bin/python3', '-I', '-c'])
        self.assertEqual(command[3], ssh.IDENTITY_SOURCE)
        host = self.env.render['hosts'][1]
        paths = {'/etc/machine-id': host['machine_id'], '/proc/sys/kernel/random/boot_id': host['boot_id'],
                 '/etc/ssh/ssh_host_ed25519_key.pub': self.env.keys[host['alias']]}
        out = io.StringIO()
        with patch.object(Path, 'read_text', lambda path: paths[str(path)]), contextlib.redirect_stdout(out):
            exec(command[3], {})
        self.assertEqual(json.loads(out.getvalue()), {k: host[k] for k in ('machine_id', 'boot_id', 'host_key_sha256')})

    def test_dual_stack_complete(self):
        self.env.close()
        self.env = SyntheticProbe(dual_stack=True)
        self.addCleanup(self.env.close)
        evidence = self.env.collect()
        self.assertEqual(len(evidence['public_denials']), 64)
        self.assertEqual(evidence, sample_evidence(self.env.render, self.env.setup))
        self.assertTrue(any('-6' in call[1] for call in self.env.calls))

    def test_dual_stack_local_error_route_and_observed_address_mismatch(self):
        env = SyntheticProbe(dual_stack=True)
        self.addCleanup(env.close)
        original = env.run
        def bad_v6(index, argv, limit, timeout, **kw):
            if argv[1:4] == ['-I', '-c', ssh.CONNECT_SOURCE] and ':' in argv[-3]:
                return json.dumps({'outcome': 'error', 'source_ip': argv[-2]}).encode()
            return original(index, argv, limit, timeout, **kw)
        env.run = bad_v6
        with self.assertRaises(ValueError):
            env.collect()
        def wrong_v6_route(index, argv, limit, timeout, **kw):
            raw = original(index, argv, limit, timeout, **kw)
            if '-6' in argv and 'route' in argv:
                route = json.loads(raw)
                route[0]['dev'] = 'wrong6'
                return json.dumps(route).encode()
            return raw
        env.run = wrong_v6_route
        with self.assertRaises(ValueError):
            env.collect()
        env.run, env.extra_v6 = original, True
        with self.assertRaises(ValueError):
            env.collect()

    def test_socket_program_distinguishes_timeout_refusal_and_local_error(self):
        import contextlib
        import errno
        import io
        import socket
        import sys
        source = '2001:4860:1::9'
        for error, wanted in ((None, 'open'), (socket.timeout(), 'timed-out'),
                              (OSError(errno.ECONNREFUSED, 'synthetic'), 'refused'),
                              (OSError(errno.ENETUNREACH, 'synthetic'), 'error'),
                              (OSError(errno.EAGAIN, 'synthetic'), 'error')):
            client = Mock()
            client.__enter__ = Mock(return_value=client)
            client.__exit__ = Mock(return_value=False)
            client.connect.side_effect = error
            client.getsockname.return_value = (source, 1000, 0, 0)
            out = io.StringIO()
            with patch.object(socket, 'socket', return_value=client) as factory, contextlib.redirect_stdout(out), patch.object(
                    sys, 'argv', ['fixed', '2001:4860:1::1', source, '22']):
                exec(ssh.CONNECT_SOURCE, {})
            factory.assert_called_once_with(socket.AF_INET6, socket.SOCK_STREAM)
            client.bind.assert_called_once_with((source, 0))
            self.assertEqual(json.loads(out.getvalue()), {'outcome': wanted, 'source_ip': source})

    def test_foreign_oob_key_rejected_before_any_io(self):
        self.env.keys[next(iter(self.env.keys))] = key(12)
        with self.assertRaisesRegex(ValueError, '^network readiness probes rejected$'):
            self.env.collect()
        self.assertEqual(self.env.calls, [])
        self.assertEqual(self.env.transports, [])

    def test_actual_identity_route_service_and_ipv6_fail_closed(self):
        for field in ('bad_auth', 'wrong_route', 'active_unit', 'extra_v6', 'direct_process'):
            with self.subTest(field=field):
                setattr(self.env, field, True)
                with self.assertRaises(ValueError):
                    self.env.collect()
                setattr(self.env, field, False)

    def test_open_local_error_and_unknown_denials_rejected(self):
        for outcome in ('open', 'error', 'no-route', 'unknown'):
            self.env.public_outcome = outcome
            with self.subTest(outcome=outcome), self.assertRaises(ValueError):
                self.env.collect()

    def test_negotiated_none_password_and_wrong_authorized_path_rejected(self):
        for method in ('none', 'password', ''):
            self.env.auth_method = method
            with self.subTest(method=method), self.assertRaises(ValueError):
                self.env.collect()
        self.env.auth_method = 'publickey'
        self.env.authorized_path = '/etc/ssh/other-authorized'
        with self.assertRaises(ValueError):
            self.env.collect()

    def test_preserves_reviewed_controller_key_but_rejects_duplicate_core_key(self):
        evidence = self.env.collect()
        self.assertNotEqual(evidence['hosts'][1]['effective_access']['authorized_keys_sha256'],
                            self.env.render['hosts'][1]['files'][1]['sha256'])
        path = self.env.root / '1/home/ckc/.ssh/authorized_keys'
        raw = path.read_bytes() + (key(9) + '\n').encode()
        path.write_bytes(raw)
        self.env.setup['hosts'][1]['authorized_keys_sha256'] = hashlib.sha256(raw).hexdigest()
        with self.assertRaises(ValueError):
            self.env.collect()

    def test_effective_key_file_symlink_and_mode_rejected(self):
        path = self.env.root / '0/root/.ssh/eru-fresh-core'
        path.chmod(0o644)
        with self.assertRaises(ValueError):
            self.env.collect()
        path.unlink()
        path.symlink_to('/does-not-exist')
        with self.assertRaises(ValueError):
            self.env.collect()
        self.assertFalse(any(c[1][0] == '/usr/bin/ssh-keygen' for c in self.env.calls))

    def test_no_auth_success_if_ssh_errors_or_returns_staged_boolean(self):
        original = self.env.run
        for response in (b'{"authenticated":true}', b''):
            def run(index, argv, limit, timeout, **kw):
                if argv[0] == '/usr/bin/ssh':
                    return response
                return original(index, argv, limit, timeout, **kw)
            self.env.run = run
            with self.assertRaises(ValueError):
                self.env.collect()
        self.env.run = original

    def test_transport_error_and_oversize_redacted(self):
        for response in (b'x' * (ssh.LIMIT + 1), b'{"observation":1,"observation":2}', b'{"x":NaN}'):
            with self.assertRaisesRegex(ValueError, '^network readiness probes rejected$'):
                probe.collect_network_evidence(self.env.render, self.env.keys, setup=self.env.setup,
                    runner=self.env.runner, transport=Mock(return_value=response), now=NOW)
        with self.assertRaisesRegex(ValueError, '^network readiness probes rejected$'):
            probe.collect_network_evidence(self.env.render, self.env.keys, setup=self.env.setup,
                runner=self.env.runner, transport=Mock(side_effect=RuntimeError('PRIVATE_SECRET')), now=NOW)

    def test_default_controller_transport_is_fixed_sshreader(self):
        with patch.object(ssh, 'SSHReader', return_value=self.env.transport) as reader:
            value = probe.collect_network_evidence(self.env.render, self.env.keys, setup=self.env.setup,
                                                  runner=self.env.runner, now=NOW)
        reader.assert_called_once_with()
        self.assertEqual(len(value['controller_private_ssh']), 4)


if __name__ == '__main__':
    unittest.main()

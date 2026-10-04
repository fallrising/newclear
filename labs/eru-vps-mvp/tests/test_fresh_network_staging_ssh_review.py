"""Independent host/filesystem and pinned transport adversarial review."""
import base64
import copy
from contextlib import ExitStack, redirect_stdout, redirect_stderr
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_staging_host as helper
import fresh_network_staging_ssh as ssh


def raw(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def public_key(index):
    wire = b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([index + 80]) * 32
    return 'ssh-ed25519 ' + base64.b64encode(wire).decode()


class SSHStagingIndependentReview(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.keys = {'ckc-disposable-%02d' % (i + 1): public_key(i) for i in range(4)}
        self.now = datetime(2026, 10, 4, 9, tzinfo=timezone.utc)
        self.intent = '9' * 64
        for name in ('etc/eru', 'etc/ssh', 'proc/sys/kernel/random'):
            (self.root / name).mkdir(parents=True)
        for path in self.root.rglob('*'):
            if path.is_dir():
                path.chmod(0o755)
        (self.root / 'etc/eru').chmod(0o700)
        self.action = self.make_action()
        self.write('etc/machine-id', self.action['host']['machine_id'] + '\n', 0o644)
        self.write('proc/sys/kernel/random/boot_id', self.action['host']['boot_id'] + '\n', 0o444)
        self.write('etc/ssh/ssh_host_ed25519_key.pub', public_key(0) + ' fixture-comment\n', 0o644)

    def make_action(self, index=0):
        files = []
        for path, content in [('/etc/eru/fresh-access.nft', '# private staged data\n'),
                ('/etc/eru/known_hosts' if index == 0 else '/etc/eru/fresh-core-authorized-key', 'staged trust\n')]:
            files.append({'path': path, 'mode': '0600', 'content': content, 'sha256': digest(content.encode())})
        key = public_key(index).split()[1]
        return {'schema_version': 1, 'operation': 'fresh-network-file-staging',
            'plan_id': 'independent-plan', 'plan_sha256': '1' * 64, 'run_id': 'independent-run',
            'execution_sha256': '2' * 64, 'pending_sha256': '3' * 64, 'host_index': index,
            'host': {'alias': 'ckc-disposable-%02d' % (index + 1), 'node': 'worker-' + str(index + 1),
                'ip': '10.31.0.' + str(index + 1), 'machine_id': 'a' * 32,
                'boot_id': '11111111-2222-4333-8444-555555555555',
                'host_key_sha256': digest(base64.b64decode(key)), 'files': files}}

    def write(self, path, content, mode=0o600):
        path = self.root / path
        if path.exists():
            path.chmod(0o600)
        path.write_text(content)
        path.chmod(mode)
        return path

    @property
    def directory(self):
        return self.root / 'etc/eru'

    @property
    def journal(self):
        return self.directory / '.fresh-network-stage'

    def request(self, operation='observe'):
        request = {'schema_version': 1, 'operation': operation, 'action': copy.deepcopy(self.action)}
        if operation == 'stage':
            request['intent_sha256'] = self.intent
        return request

    def call(self, operation='observe'):
        return helper.handle(self.request(operation), root=str(self.root),
            owner_uid=os.getuid(), owner_gid=os.getgid(), now=self.now)

    def test_roundtrip_exact_immutable_journal_and_readonly_observe(self):
        before = self.call()
        self.assertEqual(before['files'], [{'path': f['path'], 'kind': 'absent'} for f in self.action['host']['files']])
        self.call('stage')
        self.assertEqual({p.name for p in self.journal.iterdir()}, {'intent.json', 'complete.json'})
        intent = json.loads((self.journal / 'intent.json').read_bytes())
        self.assertEqual(intent, {'schema_version': 1, 'action': self.action, 'intent_sha256': self.intent})
        complete = json.loads((self.journal / 'complete.json').read_bytes())
        self.assertEqual(complete, {'schema_version': 1, 'action_sha256': digest(raw(self.action)),
            'intent_sha256': self.intent, 'files': [{'path': f['path'], 'sha256': f['sha256']} for f in self.action['host']['files']]})
        with ExitStack() as stack:
            for name in ('mkdir', 'unlink', 'link', 'rename', 'replace', 'chmod', 'chown', 'write', 'fsync'):
                stack.enter_context(patch.object(helper.os, name, side_effect=AssertionError('observe attempted write')))
            observed = self.call()
        self.assertEqual([f['intent_sha256'] for f in observed['files']], [self.intent] * 2)
        for f in self.action['host']['files']:
            path = self.root / f['path'].lstrip('/')
            self.assertEqual(path.read_text(), f['content'])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(path.stat().st_nlink, 1)

    def test_matching_existing_file_never_adopted_or_overwritten(self):
        f = self.action['host']['files'][0]
        path = self.write(f['path'].lstrip('/'), f['content'])
        before = path.stat()
        with self.assertRaises(Exception):
            self.call('stage')
        self.assertEqual(path.read_text(), f['content'])
        self.assertEqual(path.stat().st_ino, before.st_ino)
        self.assertFalse(self.journal.exists())

    def test_symlink_destination_and_hardlinked_identity_rejected(self):
        destination = self.directory / 'fresh-access.nft'
        target = self.write('sentinel', 'do not modify')
        destination.symlink_to(target)
        with self.assertRaises(Exception):
            self.call('stage')
        self.assertEqual(target.read_text(), 'do not modify')
        destination.unlink()
        os.link(self.root / 'etc/machine-id', self.root / 'second-machine-link')
        with self.assertRaises(Exception):
            self.call('stage')
        self.assertFalse(self.journal.exists())

    def test_unsafe_directory_and_wrong_incarnation_fail_before_claim(self):
        self.directory.chmod(0o750)
        with self.assertRaises(Exception):
            self.call('stage')
        self.assertFalse(self.journal.exists())
        self.directory.chmod(0o700)
        self.write('proc/sys/kernel/random/boot_id', '99999999-2222-4333-8444-555555555555\n')
        with self.assertRaises(Exception):
            self.call('stage')
        self.assertFalse(self.journal.exists())

    def test_payload_publication_requires_durable_intent(self):
        original_link, original_fsync = os.link, os.fsync
        seen, durable = [], set()
        expected = raw({'schema_version': 1, 'action': self.action, 'intent_sha256': self.intent})
        def fsync(fd):
            result = original_fsync(fd)
            if stat.S_ISREG(os.fstat(fd).st_mode):
                data = Path('/proc/self/fd/' + str(fd)).read_bytes()
                if data.lstrip().startswith(b'{') and json.loads(data) == json.loads(expected):
                    durable.add('intent-file')
            elif (self.journal / 'intent.json').exists():
                current = os.fstat(fd)
                journal = self.journal.stat()
                if (current.st_dev, current.st_ino) == (journal.st_dev, journal.st_ino):
                    durable.add('intent-directory')
            return result
        def link(source, destination, *args, **kwargs):
            if str(destination) in ('fresh-access.nft', 'known_hosts'):
                self.assertEqual(json.loads((self.journal / 'intent.json').read_bytes())['intent_sha256'], self.intent)
                self.assertEqual(durable, {'intent-file', 'intent-directory'})
                seen.append(str(destination))
            return original_link(source, destination, *args, **kwargs)
        with patch.object(helper.os, 'link', side_effect=link), patch.object(helper.os, 'fsync', side_effect=fsync):
            self.call('stage')
        self.assertEqual(seen, ['fresh-access.nft', 'known_hosts'])

    def test_claim_directory_replacement_before_open_is_not_written_or_poisoned(self):
        original = os.open
        changed = []
        foreign_bytes = b'foreign journal entry'
        def opened(path, flags, *args, **kwargs):
            if str(path) == '.fresh-network-stage' and not changed:
                self.journal.rename(self.root / 'original-claim')
                self.journal.mkdir(mode=0o700)
                (self.journal / 'foreign').write_bytes(foreign_bytes)
                changed.append(True)
            return original(path, flags, *args, **kwargs)
        with patch.object(helper.os, 'open', side_effect=opened):
            with self.assertRaises(Exception):
                self.call('stage')
        self.assertTrue(changed)
        self.assertEqual({p.name: p.read_bytes() for p in self.journal.iterdir()}, {'foreign': foreign_bytes})
        self.assertFalse((self.directory / 'fresh-access.nft').exists())

    def test_empty_claim_replacement_before_open_is_not_adopted(self):
        original = os.open
        changed = []
        def opened(path, flags, *args, **kwargs):
            if str(path) == '.fresh-network-stage' and not changed:
                self.journal.rename(self.root / 'original-claim')
                self.journal.mkdir(mode=0o700)
                changed.append(True)
            return original(path, flags, *args, **kwargs)
        with patch.object(helper.os, 'open', side_effect=opened):
            with self.assertRaises(Exception):
                self.call('stage')
        self.assertTrue(changed)
        self.assertEqual(list(self.journal.iterdir()), [])
        self.assertFalse((self.directory / 'fresh-access.nft').exists())

    def test_claim_loser_does_not_poison_winner(self):
        self.call('stage')
        before = {p.name: p.read_bytes() for p in self.journal.iterdir()}
        self.intent = '8' * 64
        with self.assertRaises(Exception):
            self.call('stage')
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.journal.iterdir()})
        observed = self.call()
        self.assertEqual(observed['files'][0]['intent_sha256'], '9' * 64)

    def test_partial_publication_is_preserved_and_not_replayed(self):
        original = os.link
        def link(source, destination, *args, **kwargs):
            if str(destination) == 'known_hosts':
                raise OSError('simulated disk failure')
            return original(source, destination, *args, **kwargs)
        with patch.object(helper.os, 'link', side_effect=link):
            with self.assertRaises(Exception):
                self.call('stage')
        first = (self.directory / 'fresh-access.nft').read_bytes()
        self.assertFalse((self.directory / 'known_hosts').exists())
        with self.assertRaises(Exception):
            self.call()
        with self.assertRaises(Exception):
            self.call('stage')
        self.assertEqual((self.directory / 'fresh-access.nft').read_bytes(), first)
        self.assertGreater(len(list(self.journal.iterdir())), 1)

    def test_late_directory_fsync_failure_does_not_return_success(self):
        original = os.fsync
        triggered = []
        def fsync(fd):
            if (self.journal / 'complete.json').exists() and stat.S_ISDIR(os.fstat(fd).st_mode) and not triggered:
                triggered.append(True)
                raise OSError('late durable write failure')
            return original(fd)
        with patch.object(helper.os, 'fsync', side_effect=fsync):
            with self.assertRaises(Exception):
                self.call('stage')
        self.assertTrue(triggered)
        with self.assertRaises(Exception):
            self.call()

    def test_post_link_intent_raw_rewrite_is_detected(self):
        original = os.link
        def link(source, destination, *args, **kwargs):
            result = original(source, destination, *args, **kwargs)
            if str(destination) == 'intent.json':
                path = self.journal / 'intent.json'
                path.write_bytes(path.read_bytes() + b' ')
            return result
        with patch.object(helper.os, 'link', side_effect=link):
            with self.assertRaises(Exception):
                self.call('stage')
        self.assertFalse((self.directory / 'fresh-access.nft').exists())

    def test_directory_swap_after_intent_publication_is_detected(self):
        original = os.link
        moved = self.root / 'saved-eru'
        def link(source, destination, *args, **kwargs):
            result = original(source, destination, *args, **kwargs)
            if str(destination) == 'intent.json':
                self.directory.rename(moved)
                self.directory.mkdir(mode=0o700)
            return result
        with patch.object(helper.os, 'link', side_effect=link):
            with self.assertRaises(Exception):
                self.call('stage')
        self.assertFalse((self.directory / 'fresh-access.nft').exists())
        self.assertFalse((moved / 'fresh-access.nft').exists())

    def test_identity_raw_rewrite_after_intent_publication_is_detected(self):
        original = os.link
        def link(source, destination, *args, **kwargs):
            result = original(source, destination, *args, **kwargs)
            if str(destination) == 'intent.json':
                path = self.root / 'etc/machine-id'
                path.write_bytes(path.read_bytes() + b' ')
            return result
        with patch.object(helper.os, 'link', side_effect=link):
            with self.assertRaises(Exception):
                self.call('stage')
        self.assertFalse((self.directory / 'fresh-access.nft').exists())

    def test_identity_directory_swap_with_same_key_is_detected(self):
        original = os.link
        def link(source, destination, *args, **kwargs):
            result = original(source, destination, *args, **kwargs)
            if str(destination) == 'intent.json':
                directory = self.root / 'etc/ssh'
                directory.rename(self.root / 'saved-ssh')
                directory.mkdir(mode=0o755)
                self.write('etc/ssh/ssh_host_ed25519_key.pub', public_key(0) + ' fixture-comment\n', 0o644)
            return result
        with patch.object(helper.os, 'link', side_effect=link):
            with self.assertRaises(Exception):
                self.call('stage')
        self.assertFalse((self.directory / 'fresh-access.nft').exists())

    def test_unknown_or_missing_journal_never_establishes_provenance(self):
        self.call('stage')
        extra = self.write('etc/eru/.fresh-network-stage/unknown', 'foreign')
        with self.assertRaises(Exception):
            self.call()
        extra.unlink()
        (self.journal / 'complete.json').unlink()
        with self.assertRaises(Exception):
            self.call()

    def test_request_mutation_matrix_rejected_before_io(self):
        changes = [lambda r: r.update(root='/'), lambda r: r.update(owner_uid=0),
            lambda r: r.update(schema_version=True), lambda r: r['action'].update(host_index=True),
            lambda r: r['action']['host'].update(ip='127.0.0.1'),
            lambda r: r['action']['host'].update(ip='10.031.0.1'),
            lambda r: r['action']['host'].update(alias='--proxy-command=bad'),
            lambda r: r['action']['host']['files'][0].update(path='/root/.ssh/authorized_keys'),
            lambda r: r['action']['host']['files'][0].update(mode=600),
            lambda r: r['action']['host']['files'][0].update(content='different'),
            lambda r: r['action']['host']['files'].reverse()]
        for mutate in changes:
            with self.subTest(mutate=mutate):
                request = self.request('stage')
                mutate(request)
                with patch.object(helper.os, 'open', side_effect=AssertionError('validation performed IO')):
                    with self.assertRaises(ValueError):
                        helper.validate_request(request)

    def test_validate_returns_independent_copy(self):
        request = self.request('stage')
        validated = helper.validate_request(request)
        validated['action']['host']['files'][0]['content'] = 'changed'
        self.assertNotEqual(validated, request)

    def test_wire_main_rejects_duplicate_nonfinite_deep_or_override_input(self):
        duplicate = raw(self.request()).replace(b'"schema_version":1', b'"schema_version":1,"schema_version":1', 1)
        override = self.request(); override['root'] = '/private-secret-root'
        candidates = [duplicate, b'{"value":NaN}', b'[' * 1000 + b'0' + b']' * 1000,
            b' ' * (256 * 1024 + 1), raw(override)]
        for candidate in candidates:
            with self.subTest(size=len(candidate)):
                stdout, stderr = io.StringIO(), io.StringIO()
                with patch.object(helper.os, 'open') as opened, redirect_stdout(stdout), redirect_stderr(stderr):
                    with self.assertRaises((SystemExit, ValueError)):
                        helper.main(base64.b64encode(candidate).decode())
                opened.assert_not_called()
                self.assertNotIn('private-secret-root', stdout.getvalue() + stderr.getvalue())

    def response(self, published=False):
        result = self.call('stage' if published else 'observe')
        # Fixture uid/gid injection is local only; transport contract requires root.
        result['directory'].update(uid=0, gid=0)
        for f in result['files']:
            if f['kind'] == 'regular':
                f.update(uid=0, gid=0)
        return result

    def test_pinned_key_mismatch_and_request_injection_never_dispatch(self):
        calls = []
        adapter = ssh.SSHNetworkStagingAdapter(self.keys, transport=lambda *args: calls.append(args))
        for change in (lambda a: a['host'].update(host_key_sha256='0' * 64),
                lambda a: a['host'].update(ip='10.31.0.1;uname'),
                lambda a: a.update(root='/')):
            action = copy.deepcopy(self.action)
            change(action)
            with self.assertRaises(ValueError):
                adapter.observe(action)
        self.assertEqual(calls, [])

    def test_transport_receives_fixed_program_once_and_failure_is_redacted(self):
        calls = []
        def transport(host, source, key):
            calls.append((host, source, key))
            compile(source, '<fixed-helper>', 'exec')
            self.assertEqual(key, self.keys[host['alias']])
            raise OSError('SECRET private 10.31.0.1')
        adapter = ssh.SSHNetworkStagingAdapter(self.keys, transport=transport)
        with self.assertRaises(ValueError) as error:
            adapter.stage(self.action, self.intent)
        self.assertEqual(len(calls), 1)
        self.assertNotIn('SECRET', str(error.exception))
        self.assertNotIn('10.31.0.1', str(error.exception))
        self.assertNotIn('private staged data', calls[0][1])

    def test_default_transport_has_fixed_command_and_ephemeral_pinned_trust(self):
        import fresh_observation_ops
        response = raw(self.response())
        calls = []
        def capture(argv, limit, timeout, *, input_bytes, pass_fds):
            calls.append(argv)
            self.assertEqual(argv[-2:], [self.action['host']['ip'], 'sudo -n python3 -'])
            self.assertEqual(argv[:4], ['ssh', '-F', '/dev/null', '-T'])
            for option in ('StrictHostKeyChecking=yes', 'UpdateHostKeys=no',
                    'GlobalKnownHostsFile=/dev/null', 'ConnectionAttempts=1',
                    'ClearAllForwardings=yes', 'ForwardAgent=no', 'ForwardX11=no',
                    'ProxyCommand=none', 'ProxyJump=none', 'ControlMaster=no'):
                self.assertIn(option, argv)
            self.assertEqual(timeout, 90)
            self.assertLessEqual(limit, 4 * 1024 * 1024)
            self.assertEqual(len(pass_fds), 1)
            self.assertEqual(os.read(pass_fds[0], 4096).decode(),
                self.action['host']['alias'] + ' ' + public_key(0) + '\n')
            compile(input_bytes, '<stdin-helper>', 'exec')
            self.assertNotIn(b'private staged data', input_bytes)
            return response
        with patch.object(fresh_observation_ops, 'capture', side_effect=capture):
            observed = ssh.SSHNetworkStagingAdapter(self.keys).observe(self.action)
        self.assertEqual(observed, json.loads(response))
        self.assertEqual(len(calls), 1)

    def test_strict_response_matrix_rejects_extra_mixed_boolean_and_provenance(self):
        before = self.response()
        after = self.response(True)
        candidates = []
        value = copy.deepcopy(after); value['files'][0]['uid'] = True; candidates.append(raw(value))
        value = copy.deepcopy(after); value['files'][0]['intent_sha256'] = '8' * 64; candidates.append(raw(value))
        value = copy.deepcopy(after); value['files'][1] = before['files'][1]; candidates.append(raw(value))
        value = copy.deepcopy(after); value['host']['machine_id'] = 'b' * 32; candidates.append(raw(value))
        value = copy.deepcopy(after); value['extra'] = 1; candidates.append(raw(value))
        candidates.extend([b'{"x":1,"x":2}', b'{"x":NaN}', b' ' * (512 * 1024), raw(before), 'not bytes'])
        for response in candidates:
            with self.subTest(response_type=type(response)):
                calls = []
                def transport(*args):
                    calls.append(args)
                    return response
                adapter = ssh.SSHNetworkStagingAdapter(self.keys, transport=transport)
                with self.assertRaises(ValueError):
                    adapter.stage(self.action, self.intent)
                self.assertEqual(len(calls), 1)
        adapter = ssh.SSHNetworkStagingAdapter(self.keys, transport=lambda *args: raw(after))
        self.assertEqual(adapter.stage(self.action, self.intent), after)


if __name__ == '__main__':
    unittest.main()

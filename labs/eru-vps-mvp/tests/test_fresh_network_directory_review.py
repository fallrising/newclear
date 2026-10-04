"""Independent synthetic directory review; no live SSH or root filesystem access."""
import base64
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_directory_host as host
import fresh_network_directory_ops as ops
from fresh_network_directory_ssh import SSHNetworkDirectoryAdapter, build_program
import test_fresh_network_access as access_fixture
import pending_generation


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def key(index):
    wire = b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([index]) * 32
    return 'ssh-ed25519 ' + base64.b64encode(wire).decode(), hashlib.sha256(wire).hexdigest()


class HostFixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.etc = self.root / 'etc'
        for path in ('etc/ssh', 'proc/sys/kernel/random'):
            (self.root / path).mkdir(parents=True, mode=0o700)
        for path in self.root.rglob('*'):
            if path.is_dir():
                path.chmod(0o700)
        self.target = self.etc / 'eru'
        self.slot = self.etc / '.eru-fresh-directory'
        self.now = datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc)
        self.action = {'schema_version': 1, 'operation': 'fresh-network-directory-preparation',
            'plan_id': 'review-plan', 'plan_sha256': 'a' * 64, 'run_id': 'review-run',
            'execution_sha256': 'b' * 64, 'pending_sha256': 'c' * 64, 'host_index': 0,
            'host': {'alias': 'ckc-disposable-01', 'node': 'worker-1', 'ip': '10.7.0.1',
                     'machine_id': 'review-machine', 'boot_id': '11111111-2222-3333-4444-555555555555',
                     'host_key_sha256': key(1)[1]},
            'directory': {'path': '/etc/eru', 'uid': 0, 'gid': 0, 'mode': '0700'}}
        (self.etc / 'machine-id').write_text(self.action['host']['machine_id'] + '\n')
        (self.root / 'proc/sys/kernel/random/boot_id').write_text(self.action['host']['boot_id'] + '\n')
        (self.etc / 'ssh/ssh_host_ed25519_key.pub').write_text(key(1)[0] + ' review-comment\n')
        for path in self.root.rglob('*'):
            if path.is_file():
                path.chmod(0o644)

    def request(self, prepare=False):
        result = {'schema_version': 1, 'operation': 'prepare' if prepare else 'observe',
                  'action': copy.deepcopy(self.action)}
        if prepare:
            result['intent_sha256'] = 'd' * 64
        return result

    def call(self, prepare=False):
        return host.handle(self.request(prepare), root=str(self.root), owner_uid=os.getuid(),
                           owner_gid=os.getgid(), now=self.now)

    def close(self):
        self.temp.cleanup()


class DirectoryHostReview(unittest.TestCase):
    def setUp(self):
        self.f = HostFixture()
        self.addCleanup(self.f.close)

    def test_readonly_absent_then_complete_and_nonempty_same_inode(self):
        original = os.open
        def readonly(path, flags, *args, **kwargs):
            self.assertFalse(flags & (os.O_CREAT | os.O_WRONLY | os.O_RDWR | os.O_TRUNC))
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'mkdir', side_effect=AssertionError('write')), patch.object(os, 'open', side_effect=readonly):
            self.assertEqual(self.f.call()['directory'], {'path': '/etc/eru', 'kind': 'absent'})
        result = self.f.call(True)
        self.assertEqual(result['directory']['intent_sha256'], 'd' * 64)
        info = self.f.target.stat()
        self.assertEqual((result['directory']['device'], result['directory']['inode']), (info.st_dev, info.st_ino))
        (self.f.target / 'later-staging-content').write_bytes(b'allowed downstream content')
        with patch.object(os, 'mkdir', side_effect=AssertionError('write')), patch.object(os, 'open', side_effect=readonly):
            self.assertEqual(self.f.call(), result)
        with self.assertRaises(ValueError):
            self.f.call(True)

    def test_preexisting_target_never_adopted_or_permission_repaired(self):
        for kind in ('directory', 'file', 'symlink'):
            with self.subTest(kind=kind):
                f = HostFixture()
                try:
                    if kind == 'directory':
                        f.target.mkdir(mode=0o755)
                    elif kind == 'file':
                        f.target.write_bytes(b'foreign')
                    else:
                        f.target.symlink_to('ssh', target_is_directory=True)
                    before = f.target.lstat()
                    with patch.object(os, 'chmod', side_effect=AssertionError('repair')):
                        with self.assertRaises(ValueError):
                            f.call(True)
                    self.assertEqual(f.target.lstat(), before)
                    self.assertFalse(f.slot.exists())
                finally:
                    f.close()

    def test_intent_bytes_and_directory_fsync_precede_target_mkdir(self):
        mkdir, fsync = os.mkdir, os.fsync
        synced = []
        checked = []
        def sync(fd):
            synced.append((os.fstat(fd).st_dev, os.fstat(fd).st_ino))
            return fsync(fd)
        def create(path, *args, **kwargs):
            if str(path) == 'eru':
                intent = self.f.slot / 'intent.json'
                self.assertEqual(intent.read_bytes(), canonical({'schema_version': 1,
                    'action': self.f.action, 'intent_sha256': 'd' * 64}))
                for required in (intent, self.f.slot, self.f.etc):
                    i = required.stat()
                    self.assertIn((i.st_dev, i.st_ino), synced)
                checked.append(True)
            return mkdir(path, *args, **kwargs)
        with patch.object(os, 'mkdir', side_effect=create), patch.object(os, 'fsync', side_effect=sync):
            self.f.call(True)
        self.assertEqual(checked, [True])

    def test_every_success_path_fsync_failure_refuses_recovery_and_replay(self):
        fsync = os.fsync
        count = []
        with patch.object(os, 'fsync', side_effect=lambda fd: (count.append(fd), fsync(fd))[1]):
            self.f.call(True)
        self.assertGreaterEqual(len(count), 6)
        for position in range(1, len(count) + 1):
            with self.subTest(position=position):
                f, seen = HostFixture(), []
                def fail(fd):
                    seen.append(fd)
                    if len(seen) == position:
                        raise OSError('synthetic fsync failure')
                    return fsync(fd)
                try:
                    with patch.object(os, 'fsync', side_effect=fail):
                        with self.assertRaises(ValueError):
                            f.call(True)
                    self.assertTrue(f.slot.exists())
                    with self.assertRaises(ValueError):
                        f.call()
                    with self.assertRaises(ValueError):
                        f.call(True)
                finally:
                    f.close()

    def test_claim_swap_after_first_stat_never_poisons_replacement(self):
        for nonempty in (False, True):
            with self.subTest(nonempty=nonempty):
                f, fired = HostFixture(), []
                original = os.stat
                def swapped(path, *args, **kwargs):
                    result = original(path, *args, **kwargs)
                    if str(path) == '.eru-fresh-directory' and not fired:
                        fired.append(True)
                        f.slot.rename(f.etc / 'held-claim')
                        f.slot.mkdir(mode=0o700)
                        if nonempty:
                            (f.slot / 'foreign').write_bytes(b'owner')
                    return result
                try:
                    with patch.object(os, 'stat', side_effect=swapped):
                        with self.assertRaises(ValueError):
                            f.call(True)
                    self.assertEqual(fired, [True])
                    self.assertEqual(sorted(p.name for p in f.slot.iterdir()), ['foreign'] if nonempty else [])
                    self.assertFalse(f.target.exists())
                finally:
                    f.close()

    def test_target_swap_after_first_stat_never_gets_complete_receipt(self):
        for nonempty in (False, True):
            with self.subTest(nonempty=nonempty):
                f, fired = HostFixture(), []
                original = os.stat
                def swapped(path, *args, **kwargs):
                    result = original(path, *args, **kwargs)
                    if str(path) == 'eru' and f.target.exists() and not fired:
                        fired.append(True)
                        f.target.rename(f.etc / 'held-target')
                        f.target.mkdir(mode=0o700)
                        if nonempty:
                            (f.target / 'foreign').write_bytes(b'owner')
                    return result
                try:
                    with patch.object(os, 'stat', side_effect=swapped):
                        with self.assertRaises(ValueError):
                            f.call(True)
                    self.assertEqual(fired, [True])
                    self.assertFalse((f.slot / 'complete.json').exists())
                    with self.assertRaises(ValueError):
                        f.call()
                finally:
                    f.close()

    def test_complete_target_replacement_and_journal_whitespace_are_rejected(self):
        self.f.call(True)
        self.f.target.rename(self.f.etc / 'held-target')
        self.f.target.mkdir(mode=0o700)
        with self.assertRaises(ValueError):
            self.f.call()
        self.f.target.rmdir()
        (self.f.etc / 'held-target').rename(self.f.target)
        self.assertEqual(self.f.call()['directory']['kind'], 'directory')
        intent = self.f.slot / 'intent.json'
        intent.write_bytes(intent.read_bytes() + b' ')
        with self.assertRaises(ValueError):
            self.f.call()

    def test_identity_changes_hardlink_records_and_mode_drift_reject(self):
        self.f.call(True)
        machine = self.f.etc / 'machine-id'
        old = machine.read_bytes()
        machine.write_bytes(b'foreign-host\n')
        with self.assertRaises(ValueError):
            self.f.call()
        machine.write_bytes(old)
        os.link(self.f.slot / 'intent.json', self.f.etc / 'linked-intent')
        with self.assertRaises(ValueError):
            self.f.call()
        (self.f.etc / 'linked-intent').unlink()
        self.f.target.chmod(0o755)
        with self.assertRaises(ValueError):
            self.f.call()

    def test_existing_claim_loser_leaves_winner_bytes_intact(self):
        self.f.call(True)
        before = {p.name: p.read_bytes() for p in self.f.slot.iterdir()}
        with self.assertRaises(ValueError):
            self.f.call(True)
        self.assertEqual({p.name: p.read_bytes() for p in self.f.slot.iterdir()}, before)
        self.assertEqual(self.f.call()['directory']['kind'], 'directory')

    def test_request_overrides_and_boolean_owners_refuse_before_io(self):
        for mutate in (lambda r: r.update(root='/tmp'),
                       lambda r: r['action']['directory'].update(uid=False),
                       lambda r: r['action']['directory'].update(path='/etc/ssh'),
                       lambda r: r['action'].update(host_index=True),
                       lambda r: r['action']['host'].update(files=[])):
            value = self.f.request(True)
            mutate(value)
            with patch.object(os, 'open', side_effect=AssertionError('IO')):
                with self.assertRaises(ValueError):
                    host.validate_request(value)


class DirectoryAdapterReview(unittest.TestCase):
    def setUp(self):
        self.f = HostFixture()
        self.addCleanup(self.f.close)
        self.keys = {'ckc-disposable-%02d' % i: key(i)[0] for i in range(1, 5)}

    def test_mismatched_key_never_calls_transport_and_keys_are_copied(self):
        called = []
        def transport(*args):
            called.append(args)
            return canonical({'observed_at': self.f.now.isoformat(), 'host': self.f.action['host'],
                              'directory': {'path': '/etc/eru', 'kind': 'absent'}})
        adapter = SSHNetworkDirectoryAdapter(self.keys, transport=transport)
        self.keys['ckc-disposable-01'] = key(9)[0]
        self.assertEqual(adapter.observe(self.f.action)['directory']['kind'], 'absent')
        self.assertEqual(len(called), 1)
        altered = copy.deepcopy(self.f.action)
        altered['host']['host_key_sha256'] = 'f' * 64
        with self.assertRaises(ValueError):
            adapter.observe(altered)
        self.assertEqual(len(called), 1)

    def test_strict_response_rejects_extra_fields_booleans_duplicates_and_wrong_intent(self):
        good = {'observed_at': self.f.now.isoformat(), 'host': self.f.action['host'],
            'directory': {'path': '/etc/eru', 'kind': 'directory', 'uid': 0, 'gid': 0,
                          'mode': '0700', 'device': 0, 'inode': 12, 'intent_sha256': 'd' * 64}}
        values = []
        for changed in ({'device': False}, {'inode': True}, {'inode': 0}, {'intent_sha256': 'e' * 64}, {'extra': 1}):
            value = copy.deepcopy(good)
            value['directory'].update(changed)
            values.append(canonical(value))
        values.extend((b'{"x":1,"x":2}', b'{"x":NaN}', b'x' * (256 * 1024 + 1)))
        for raw in values:
            calls = []
            def transport(*args):
                calls.append(args)
                return raw
            adapter = SSHNetworkDirectoryAdapter(self.keys, transport=transport)
            with self.assertRaises(ValueError) as caught:
                adapter.prepare(self.f.action, 'd' * 64)
            self.assertEqual(len(calls), 1)
            self.assertNotIn('review-machine', str(caught.exception))

    def test_program_compiles_without_runtime_repository_import(self):
        source = build_program(self.f.request(True))
        compile(source, '<fixed-directory-program>', 'exec')
        import ast
        parsed = ast.parse(source)
        repo_imports = [node for node in ast.walk(parsed) if isinstance(node, ast.ImportFrom)
                        and node.module and node.module.startswith('fresh_')]
        self.assertEqual(repo_imports, [])
        direct = [alias.name for node in ast.walk(parsed) if isinstance(node, ast.Import)
                  for alias in node.names if alias.name.startswith('fresh_')]
        self.assertEqual(direct, [])


class DirectoryCoordinatorReview(unittest.TestCase):
    def setUp(self):
        self.f = access_fixture.NetworkAccessTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.plan = self.f.prepare()
        self.assertEqual(self.plan['status'], 'planned')
        self.project, self.now, self.source = self.f.project, self.f.now, self.f.source
        self.run = self.f.f.f.r.run
        self.authpath = 'private/review-directory-authorization.json'
        self.auth = {'schema_version': 1, 'operation': 'fresh-network-directory-preparation-authorization',
                     'plan_id': self.plan['id'], 'plan_sha256': self.plan['sha256'],
                     'execution_sha256': self.plan['execution_sha256'],
                     'pending_sha256': pending_generation.inspect(self.project)['sha256'],
                     'scope': 'prepare-network-directory-only', 'owner_confirmed': True,
                     'authorized_at': self.now.isoformat(),
                     'expires_at': (self.now + timedelta(minutes=15)).isoformat()}
        self.save_auth()
        self.calls, self.states = [], {}
        self.lose = False
        outer = self
        class Adapter:
            def observe(self, action):
                outer.calls.append(('observe', action['host_index']))
                return {'observed_at': outer.now.isoformat(), 'host': action['host'],
                        'directory': copy.deepcopy(outer.states.get(action['host_index'],
                            {'path': '/etc/eru', 'kind': 'absent'}))}
            def prepare(self, action, digest):
                outer.calls.append(('prepare', action['host_index']))
                outer.assertTrue((outer.slot(action['host_index']) / 'intent.json').exists())
                outer.states[action['host_index']] = {'path': '/etc/eru', 'kind': 'directory',
                    'uid': 0, 'gid': 0, 'mode': '0700', 'device': 0, 'inode': 100 + action['host_index'],
                    'intent_sha256': digest}
                if outer.lose:
                    raise OSError('private synthetic lost reply')
        self.adapter = Adapter()

    def save_auth(self):
        self.authsha = self.f.f.f.r.write(self.authpath, self.auth)
        self.f.f.f.r.f.secure()

    def slot(self, index=0):
        return self.project / ops.AREA / self.run / ('host-' + str(index))

    def prepare(self, index=0, **kw):
        return ops.prepare_network_directory(self.project, self.plan['id'], self.plan['sha256'],
            self.authpath, self.authsha, index, self.adapter, now=self.now, source_state=self.source, **kw)

    def inspect(self, result):
        return ops.inspect_network_directory(self.project, self.run, 0, result['intent_sha256'],
                                            now=self.now, source_state=self.source)

    def reconcile(self, result):
        return ops.reconcile_network_directory(self.project, self.run, 0, result['intent_sha256'],
                                              self.adapter, now=self.now, source_state=self.source)

    def test_directory_requires_own_current_authorization_before_observation(self):
        original = copy.deepcopy(self.auth)
        for changes in ({'operation': 'fresh-network-file-staging-authorization', 'scope': 'stage-network-files-only'},
                        {'owner_confirmed': 1}, {'pending_sha256': 'f' * 64},
                        {'expires_at': (self.now - timedelta(seconds=1)).isoformat()},
                        {'authorized_at': (self.now + timedelta(seconds=1)).isoformat()}):
            self.auth = {**original, **changes}
            self.save_auth()
            self.assertEqual(self.prepare()['status'], 'blocked')
        self.assertEqual(self.calls, [])

    def test_lost_reply_only_recovers_via_observe_and_inspect_is_readonly(self):
        self.lose = True
        result = self.prepare()
        self.assertEqual(result['status'], 'uncertain')
        before = list(self.calls)
        self.assertEqual(self.prepare()['status'], 'uncertain')
        self.assertEqual(self.calls, before)
        original = os.open
        def readonly(path, flags, *args, **kwargs):
            self.assertFalse(flags & (os.O_CREAT | os.O_WRONLY | os.O_RDWR | os.O_TRUNC))
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=readonly), patch.object(os, 'mkdir', side_effect=AssertionError('write')):
            self.assertEqual(self.inspect(result)['status'], 'uncertain')
        self.assertEqual(self.calls, before)
        recovered = self.reconcile(result)
        self.assertEqual(recovered['status'], 'prepared')
        self.assertEqual([x for x in self.calls if x[0] == 'prepare'], [('prepare', 0)])
        self.assertEqual(self.calls[len(before):], [('observe', 0)])
        for flag in ('stage_accepted', 'generation_changed', 'external_fence_verified'):
            self.assertIs(recovered[flag], False)
        self.assertNotIn('private', json.dumps(recovered))

    def test_pending_drift_after_last_observe_blocks_receipt(self):
        original = self.adapter.observe
        def drift(action):
            result = original(action)
            if self.states:
                path = self.project / 'private/pending-generation/reservation.json'
                path.write_bytes(path.read_bytes() + b' ')
            return result
        with patch.object(self.adapter, 'observe', side_effect=drift):
            result = self.prepare()
        self.assertEqual(result['status'], 'blocked')
        self.assertTrue(result['dispatch_attempted'])
        self.assertFalse((self.slot() / 'receipt.json').exists())
        self.assertEqual([x for x in self.calls if x[0] == 'prepare'], [('prepare', 0)])

    def test_source_drift_blocks_before_adapter_and_new_plan_cannot_replay(self):
        old = copy.deepcopy(self.source)
        self.source = {**old, 'sha': 'e' * 40}
        self.assertEqual(self.prepare()['status'], 'blocked')
        self.assertEqual(self.calls, [])
        self.source = old
        self.lose = True
        self.assertEqual(self.prepare()['status'], 'uncertain')
        calls = list(self.calls)
        self.f.plan_id = 'review-new-plan'
        self.plan = self.f.prepare()
        self.assertEqual(self.plan['status'], 'planned')
        self.auth.update(plan_id=self.plan['id'], plan_sha256=self.plan['sha256'])
        self.authpath = 'private/review-new-authorization.json'
        self.save_auth()
        self.assertEqual(self.prepare()['status'], 'blocked')
        self.assertEqual(self.calls, calls)

    def test_raw_intent_drift_before_dispatch_prevents_replay(self):
        original = ops._publish
        def changed(files, directory, name, value):
            result = original(files, directory, name, value)
            target = self.slot() / name
            target.write_bytes(target.read_bytes() + b' ')
            return result
        with patch.object(ops, '_publish', side_effect=changed):
            self.assertEqual(self.prepare()['status'], 'blocked')
        self.assertFalse(any(c[0] == 'prepare' for c in self.calls))
        self.assertEqual(self.prepare()['status'], 'blocked')

    def test_local_claim_swap_never_poisons_replacement(self):
        # Each variant uses a fresh controller fixture and distinct execution journal.
        for nonempty in (False, True):
            with self.subTest(nonempty=nonempty):
                case = DirectoryCoordinatorReview()
                case.setUp()
                try:
                    original, fired = os.stat, []
                    def swap(path, *args, **kwargs):
                        result = original(path, *args, **kwargs)
                        if str(path) == 'host-0' and not fired:
                            fired.append(True)
                            case.slot().rename(case.slot().with_name('held-slot'))
                            case.slot().mkdir(mode=0o700)
                            if nonempty:
                                (case.slot() / 'foreign').write_bytes(b'owner')
                        return result
                    with patch.object(os, 'stat', side_effect=swap):
                        result = case.prepare()
                    self.assertEqual(fired, [True])
                    self.assertEqual(result['status'], 'blocked')
                    self.assertFalse(result['dispatch_attempted'])
                    self.assertEqual(sorted(p.name for p in case.slot().iterdir()), ['foreign'] if nonempty else [])
                    self.assertFalse(any(c[0] == 'prepare' for c in case.calls))
                finally:
                    case.doCleanups()

    def test_final_pending_drift_after_last_raw_recheck_prevents_dispatch(self):
        plans, changed = [], []
        plan, recheck = ops._Session.plan, ops.PrivateFiles.recheck
        def counted(session, *args):
            value = plan(session, *args)
            plans.append(True)
            return value
        def drifting(files):
            recheck(files)
            if len(plans) == 3 and not changed:
                changed.append(True)
                path = self.project / 'private' / pending_generation.PENDING_DIRECTORY / 'foreign-entry'
                path.write_text('synthetic pending drift')
                path.chmod(0o600)
        with patch.object(ops._Session, 'plan', counted), patch.object(ops.PrivateFiles, 'recheck', drifting):
            result = self.prepare()
        self.assertEqual(changed, [True])
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(result['dispatch_attempted'])
        self.assertFalse(any(c[0] == 'prepare' for c in self.calls))

    def test_predecessor_receipts_require_actual_directory_operation(self):
        self.assertEqual(self.prepare(1)['status'], 'blocked')
        self.assertEqual(self.calls, [])
        result = self.prepare()
        self.assertEqual(result['status'], 'prepared')
        self.assertEqual(self.prepare(1)['status'], 'prepared')
        intent = json.loads((self.slot(1) / 'intent.json').read_text())['intent']
        self.assertEqual(intent['predecessor_sha256'], result['receipt_sha256'])


if __name__ == '__main__':
    unittest.main()

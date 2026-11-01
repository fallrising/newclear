"""Directory preparation against synthetic temporary roots, without SSH."""
import copy
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_directory_host as host
import test_fresh_network_staging_host as fixtures


class DirectoryHostTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.HostTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        (self.root / 'etc/eru').rmdir()
        self.action = copy.deepcopy(self.fixture.action)
        self.action['operation'] = 'fresh-network-directory-preparation'
        del self.action['host']['files']
        self.action['directory'] = {'path': '/etc/eru', 'uid': 0, 'gid': 0, 'mode': '0700'}
        self.request = {'schema_version': 1, 'operation': 'prepare', 'action': self.action,
                        'intent_sha256': 'd' * 64}
        self.target = self.root / 'etc/eru'
        self.slot = self.root / 'etc/.eru-fresh-directory'

    def call(self, request=None):
        return host.handle(request or self.request, root=str(self.root),
                           owner_uid=os.getuid(), owner_gid=os.getgid(), now=self.fixture.now)

    def observe(self):
        return self.call({'schema_version': 1, 'operation': 'observe', 'action': self.action})

    def test_prepare_persisted_identity_and_lost_response_recovery(self):
        self.assertEqual(self.observe()['directory'], {'path': '/etc/eru', 'kind': 'absent'})
        result = self.call()
        self.assertEqual(result, self.observe())
        self.assertEqual(result['directory']['inode'], self.target.stat().st_ino)
        self.assertEqual(result['directory']['device'], self.target.stat().st_dev)
        self.assertEqual(result['directory']['intent_sha256'], 'd' * 64)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o700)
        self.assertEqual(list(self.target.iterdir()), [])
        self.assertEqual(sorted(p.name for p in self.slot.iterdir()), ['complete.json', 'intent.json'])
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(self.observe(), result)
        (self.target / 'later-staged-file').write_text('later')
        self.assertEqual(self.observe(), result)

    def test_preexisting_target_directory_file_and_symlink_never_adopted(self):
        self.target.mkdir(mode=0o700)
        with self.assertRaises(ValueError):
            self.call()
        self.assertFalse(self.slot.exists())
        self.target.rmdir()
        self.target.write_text('foreign')
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(self.target.read_text(), 'foreign')
        self.target.unlink()
        self.target.symlink_to(self.root / 'etc/ssh')
        with self.assertRaises(ValueError):
            self.call()
        self.assertFalse(self.slot.exists())

    def test_durable_intent_precedes_target(self):
        original, synced = os.fsync, []
        def sync(fd):
            synced.append((os.fstat(fd).st_dev, os.fstat(fd).st_ino))
            return original(fd)
        mkdir = os.mkdir
        def create(path, *args, **kwargs):
            if path == 'eru':
                intent = self.slot / 'intent.json'
                self.assertTrue(intent.is_file())
                for p in (intent, self.slot, self.root / 'etc'):
                    self.assertIn((p.stat().st_dev, p.stat().st_ino), synced)
            return mkdir(path, *args, **kwargs)
        with patch.object(os, 'fsync', side_effect=sync), patch.object(os, 'mkdir', side_effect=create):
            self.call()

    def test_readonly_observe_no_write_syscalls(self):
        expected = self.call()
        original = os.open
        def readonly(path, flags, *args, **kwargs):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=readonly), \
                patch.object(os, 'mkdir', side_effect=AssertionError('write')), \
                patch.object(os, 'fsync', side_effect=AssertionError('write')), \
                patch.object(os, 'link', side_effect=AssertionError('write')), \
                patch.object(os, 'unlink', side_effect=AssertionError('write')):
            self.assertEqual(self.observe(), expected)

    def test_claim_replacement_empty_and_nonempty_never_owned(self):
        for foreign in (False, True):
            with self.subTest(foreign=foreign):
                original = os.open
                def swap(path, flags, *args, **kwargs):
                    if path == '.eru-fresh-directory' and flags & os.O_DIRECTORY:
                        self.slot.rename(self.root / 'etc/original-claim')
                        self.slot.mkdir(mode=0o700)
                        if foreign:
                            (self.slot / 'foreign').write_text('foreign')
                    return original(path, flags, *args, **kwargs)
                with patch.object(os, 'open', side_effect=swap), self.assertRaises(ValueError):
                    self.call()
                self.assertEqual(sorted(p.name for p in self.slot.iterdir()), ['foreign'] if foreign else [])
                self.assertEqual(list((self.root / 'etc/original-claim').iterdir()), [])
                self.assertFalse(self.target.exists())
                if foreign:
                    (self.slot / 'foreign').unlink()
                self.slot.rmdir()
                (self.root / 'etc/original-claim').rmdir()

    def test_raw_intent_mutation_blocks_target(self):
        original = os.link
        def tamper(source, destination, *args, **kwargs):
            result = original(source, destination, *args, **kwargs)
            if destination == 'intent.json':
                path = self.slot / 'intent.json'
                path.write_bytes(path.read_bytes() + b' ')
            return result
        with patch.object(os, 'link', side_effect=tamper), self.assertRaises(ValueError):
            self.call()
        self.assertFalse(self.target.exists())
        with self.assertRaises(ValueError):
            self.observe()

    def test_target_replacement_after_creation_cannot_complete(self):
        original = os.open
        def swap(path, flags, *args, **kwargs):
            if path == 'eru' and flags & os.O_DIRECTORY:
                self.target.rename(self.root / 'etc/original-eru')
                self.target.mkdir(mode=0o700)
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=swap), self.assertRaises(ValueError):
            self.call()
        self.assertFalse((self.slot / 'complete.json').exists())
        with self.assertRaises(ValueError):
            self.observe()

    def test_target_replacement_after_completion_not_accepted(self):
        self.call()
        self.target.rename(self.root / 'etc/original-eru')
        self.target.mkdir(mode=0o700)
        with self.assertRaises(ValueError):
            self.observe()

    def test_partial_target_and_late_fsync_failures_do_not_replay(self):
        original = os.fsync
        def fail(fd):
            if self.target.exists():
                raise OSError('SECRET synthetic failure')
            return original(fd)
        with patch.object(os, 'fsync', side_effect=fail), self.assertRaisesRegex(ValueError, '^network directory preparation unavailable$'):
            self.call()
        self.assertTrue(self.target.is_dir())
        self.assertFalse((self.slot / 'complete.json').exists())
        with self.assertRaises(ValueError):
            self.observe()
        with self.assertRaises(ValueError):
            self.call()

    def test_mode_owner_identity_and_hardlinks_rejected(self):
        with self.assertRaises(ValueError):
            host.handle(self.request, root=str(self.root), owner_uid=os.getuid() + 1,
                        owner_gid=os.getgid())
        machine = self.root / 'etc/machine-id'
        os.link(machine, self.root / 'alias')
        with self.assertRaises(ValueError):
            self.call()
        (self.root / 'alias').unlink()
        machine.write_text('changed-machine')
        with self.assertRaises(ValueError):
            self.call()
        machine.write_text(self.fixture.machine + '\n')
        self.call()
        for p, mode in ((self.target, 0o755), (self.slot, 0o755), (self.slot / 'intent.json', 0o644)):
            original = p.stat().st_mode & 0o777
            p.chmod(mode)
            with self.assertRaises(ValueError):
                self.observe()
            p.chmod(original)

    def test_schema_and_wire_strict_pure_redaction(self):
        import base64
        import contextlib
        import io
        import json
        with patch.object(os, 'open', side_effect=AssertionError('IO')):
            self.assertEqual(host.validate_request(self.request), self.request)
            for field, value in [('root', '/SECRET'), ('owner_uid', 0), ('command', 'evil')]:
                with self.assertRaises(ValueError):
                    host.validate_request({**self.request, field: value})
        for mutate in (lambda r: r.update(schema_version=True),
                       lambda r: r['action']['directory'].update(uid=False),
                       lambda r: r['action']['directory'].update(path='/evil'),
                       lambda r: r['action']['directory'].update(mode='0755'),
                       lambda r: r['action']['host'].update(files=[])):
            value = copy.deepcopy(self.request)
            mutate(value)
            with self.assertRaises(ValueError):
                host.validate_request(value)
        for raw in (b'{"schema_version":1,"schema_version":1}', b'{"a":NaN}',
                    b'[' * 1000 + b']' * 1000, b'x' * (256 * 1024 + 1),
                    json.dumps({**self.request, 'root': '/SECRET'}).encode()):
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), self.assertRaises(SystemExit):
                host.main(base64.b64encode(raw).decode())
            self.assertEqual(out.getvalue(), '')
            self.assertEqual(err.getvalue(), 'network directory preparation unavailable\n')

    def test_concurrent_claim_loser_cannot_poison_winner(self):
        from concurrent.futures import ThreadPoolExecutor
        import threading
        barrier, original = threading.Barrier(2), os.mkdir
        def claim(name, *args, **kwargs):
            if name == '.eru-fresh-directory':
                barrier.wait(timeout=10)
            return original(name, *args, **kwargs)
        def run(_):
            try:
                return self.call()
            except ValueError:
                return None
        with patch.object(os, 'mkdir', side_effect=claim), ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, range(2)))
        self.assertEqual(sum(r is not None for r in results), 1)
        self.assertEqual(self.observe(), next(r for r in results if r))

    def test_complete_record_and_unknown_journal_entries_rejected(self):
        self.call()
        complete = self.slot / 'complete.json'
        raw = complete.read_bytes()
        complete.write_bytes(raw + b' ')
        with self.assertRaises(ValueError):
            self.observe()
        complete.write_bytes(raw)
        (self.slot / 'unknown').write_bytes(b'')
        with self.assertRaises(ValueError):
            self.observe()

    def test_unknown_journal_entry_after_intent_prevents_target(self):
        original = host._Session.publish
        def foreign(session, directory, name, raw):
            result = original(session, directory, name, raw)
            if name == 'intent.json':
                (self.slot / 'foreign').write_text('other-operation')
            return result
        with patch.object(host._Session, 'publish', new=foreign), self.assertRaises(ValueError):
            self.call()
        self.assertFalse(self.target.exists())
        self.assertEqual((self.slot / 'foreign').read_text(), 'other-operation')

    def test_identity_bytes_drift_after_intent_prevents_target(self):
        original = os.link
        def drift(source, destination, *args, **kwargs):
            result = original(source, destination, *args, **kwargs)
            if destination == 'intent.json':
                path = self.root / 'proc/sys/kernel/random/boot_id'
                path.write_bytes(path.read_bytes() + b' ')
            return result
        with patch.object(os, 'link', side_effect=drift), self.assertRaises(ValueError):
            self.call()
        self.assertFalse(self.target.exists())

    def test_claim_replacement_after_intent_only_original_gets_failure(self):
        original = os.link
        def swap(source, destination, *args, **kwargs):
            result = original(source, destination, *args, **kwargs)
            if destination == 'intent.json':
                self.slot.rename(self.root / 'etc/original-claim')
                self.slot.mkdir(mode=0o700)
                (self.slot / 'foreign').write_text('unrelated')
            return result
        with patch.object(os, 'link', side_effect=swap), self.assertRaises(ValueError):
            self.call()
        self.assertEqual(sorted(p.name for p in self.slot.iterdir()), ['foreign'])
        self.assertTrue((self.root / 'etc/original-claim/.directory-failed').exists())
        self.assertFalse(self.target.exists())

    def test_late_complete_fsync_failure_blocks_recovery(self):
        original = os.fsync
        complete, failed = self.slot / 'complete.json', []
        def fail(fd):
            if complete.exists() and not failed:
                failed.append(True)
                raise OSError('SECRET late completion failure')
            return original(fd)
        with patch.object(os, 'fsync', side_effect=fail), self.assertRaises(ValueError):
            self.call()
        self.assertTrue(complete.exists())
        self.assertTrue((self.slot / '.directory-failed').exists())
        with self.assertRaises(ValueError):
            self.observe()

    def test_absence_observation_rechecks_target_and_claim(self):
        original = host._Session.check
        calls = []
        def appeared(session):
            original(session)
            calls.append(True)
            if len(calls) == 3:
                self.target.mkdir(mode=0o700)
        with patch.object(host._Session, 'check', new=appeared), self.assertRaises(ValueError):
            self.observe()
        self.assertFalse(self.slot.exists())

    def test_different_plan_is_never_adopted(self):
        result = self.call()
        changed = copy.deepcopy(self.request)
        changed['intent_sha256'] = 'f' * 64
        with self.assertRaises(ValueError):
            self.call(changed)
        self.assertEqual(self.observe(), result)
        self.action['plan_id'] = 'other-plan'
        with self.assertRaises(ValueError):
            self.observe()

    def test_main_calls_fixed_defaults_only(self):
        import base64
        import contextlib
        import io
        import json
        encoded = base64.b64encode(json.dumps(self.request).encode()).decode()
        with patch.object(host, 'handle', return_value={'ok': True}) as called, \
                contextlib.redirect_stdout(io.StringIO()):
            host.main(encoded)
        called.assert_called_once_with(self.request)

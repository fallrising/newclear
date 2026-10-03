"""Persistent local barrier regression tests use synthetic temporary roots only."""
import os
import hashlib
import json
import stat
import subprocess
from unittest import mock
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from labops import ClusterLock, LOCK_ENV, lock_fds
import pending_generation as pending


class PendingGenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.private = self.project / 'private'
        self.private.mkdir(mode=0o700)
        self.old_env = os.environ.pop(LOCK_ENV, None)
        self.addCleanup(self.restore_env)

    def restore_env(self):
        os.environ.pop(LOCK_ENV, None)
        if self.old_env is not None:
            os.environ[LOCK_ENV] = self.old_env

    def test_empty_pending_directory_blocks_actual_context_entry(self):
        (self.private / 'pending-generation').mkdir(mode=0o700)
        calls = []
        with self.assertRaisesRegex(RuntimeError, 'pending generation'):
            with ClusterLock(self.project):
                calls.append('mutation')
        self.assertEqual(calls, [])
        self.assertNotIn(LOCK_ENV, os.environ)

    def test_absent_preserves_lock_behavior(self):
        with ClusterLock(self.project):
            self.assertIn(LOCK_ENV, os.environ)
        self.assertNotIn(LOCK_ENV, os.environ)

    def bindings(self):
        return {'cluster_id': 'eru-vps-mvp', 'run_id': 'synthetic-run',
                'generation_before': 1, 'target_generation': 2,
                **{field: 'a' * 64 for field in pending._HASH_FIELDS}}

    def reserve(self):
        return pending.reserve(self.project, self.bindings())

    def assert_blocked(self):
        with self.assertRaisesRegex(RuntimeError, 'pending generation'):
            with ClusterLock(self.project):
                self.fail('mutation admitted')

    def test_reservation_is_private_bound_immutable_and_blocks_other_generation(self):
        sha = self.reserve()
        directory = self.private / pending.PENDING_DIRECTORY
        record = directory / pending.RECORD_NAME
        before = record.read_bytes()
        self.assertEqual(hashlib.sha256(before).hexdigest(), sha)
        self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(record.stat().st_mode), 0o600)
        observed = pending.inspect(self.project)
        self.assertEqual(observed['status'], 'pending')
        self.assertTrue(observed['blocked'])
        self.assertEqual(observed['sha256'], sha)
        self.assertEqual(observed['reservation']['bindings'], self.bindings())
        other = {**self.bindings(), 'generation_before': 2, 'target_generation': 3}
        with self.assertRaises(RuntimeError):
            pending.reserve(self.project, other)
        self.assertEqual(record.read_bytes(), before)
        self.assert_blocked()

    def test_invalid_bindings_never_create_pending(self):
        changes = [{'target_generation': 3}, {'generation_before': True},
                   {'target_generation': 2.0}, {'cluster_id': 'other'},
                   {'run_id': '../escape'}, {'run_id': 'x' * 65},
                   {'scope_sha256': 'A' * 64}, {'fence_sha256': None},
                   {'extra': 'field'}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                pending.reserve(self.project, {**self.bindings(), **change})
        self.assertFalse((self.private / pending.PENDING_DIRECTORY).exists())

    def test_inspect_absent_is_read_only(self):
        self.assertEqual(pending.inspect(self.project), {'status': 'absent', 'blocked': False})
        self.assertEqual(list(self.private.iterdir()), [])
        self.private.rmdir()
        self.assertEqual(pending.inspect(self.project), {'status': 'absent', 'blocked': False})
        self.assertFalse(self.private.exists())

    def test_pending_file_dangling_symlink_and_fifo_all_block_without_hang(self):
        path = self.private / pending.PENDING_DIRECTORY
        for create in (lambda: path.write_text('invalid'),
                       lambda: path.symlink_to('missing'), lambda: os.mkfifo(path)):
            create()
            self.assert_blocked()
            self.assertEqual(pending.inspect(self.project), {'status': 'invalid', 'blocked': True})
            path.unlink()  # Fixture reset only; no production clear API exists.

    def test_empty_directory_denial_releases_process_and_file_lock(self):
        path = self.private / pending.PENDING_DIRECTORY
        path.mkdir(mode=0o700)
        for _ in range(3):
            self.assert_blocked()
            self.assertNotIn(LOCK_ENV, os.environ)
        path.rmdir()
        with ClusterLock(self.project):
            pass

    def test_inherited_parent_descriptor_survives_pending_denial(self):
        with ClusterLock(self.project) as outer:
            original = os.environ[LOCK_ENV]
            (self.private / pending.PENDING_DIRECTORY).mkdir(mode=0o700)
            self.assert_blocked()
            self.assertEqual(os.environ[LOCK_ENV], original)
            os.fstat(outer.fd)
        self.assertNotIn(LOCK_ENV, os.environ)

    def child_result(self, inherited=False):
        code = ('from labops import ClusterLock; import sys; '
                'lock=ClusterLock(sys.argv[1]); lock.__enter__(); print("MUTATION")')
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1',
                   PYTHONPATH=str(Path(__file__).resolve().parents[1] / 'scripts'))
        return subprocess.run([sys.executable, '-c', code, str(self.project)],
                              env=env, pass_fds=lock_fds() if inherited else (),
                              capture_output=True, text=True, timeout=10)

    def test_restart_and_inherited_child_remain_blocked(self):
        with ClusterLock(self.project):
            (self.private / pending.PENDING_DIRECTORY).mkdir(mode=0o700)
            result = self.child_result(inherited=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('pending generation', result.stderr)
            self.assertNotIn('MUTATION', result.stdout)
        result = self.child_result()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('pending generation', result.stderr)
        self.assertNotIn('MUTATION', result.stdout)

    def test_trusted_private_root_symlink_is_supported(self):
        backing = self.project / 'backing'
        self.private.rename(backing)
        self.private.symlink_to(backing, target_is_directory=True)
        self.reserve()
        self.assertEqual(pending.inspect(self.project)['status'], 'pending')
        self.assert_blocked()
        self.assertTrue((backing / pending.PENDING_DIRECTORY / pending.RECORD_NAME).is_file())

    def test_controller_lock_symlink_is_rejected(self):
        target = self.private / 'other'
        target.write_text('do not modify')
        (self.private / 'controller.lock').symlink_to(target)
        with self.assertRaises(OSError):
            with ClusterLock(self.project):
                self.fail('unsafe lock admitted')
        self.assertEqual(target.read_text(), 'do not modify')
        self.assertNotIn(LOCK_ENV, os.environ)

    def test_reservation_record_symlink_hardlink_fifo_and_bad_modes_are_invalid(self):
        self.reserve()
        record = self.private / pending.PENDING_DIRECTORY / pending.RECORD_NAME
        saved = record.read_bytes()
        other = self.private / 'other.json'
        other.write_bytes(saved)
        other.chmod(0o600)
        for create in (lambda: record.symlink_to(other),
                       lambda: os.link(other, record), lambda: os.mkfifo(record),
                       lambda: (record.write_bytes(saved), record.chmod(0o644))):
            record.unlink()
            create()
            self.assertEqual(pending.inspect(self.project)['status'], 'invalid')
            self.assert_blocked()

    def test_duplicate_fields_nan_oversize_and_identity_tampering_are_invalid(self):
        self.reserve()
        record = self.private / pending.PENDING_DIRECTORY / pending.RECORD_NAME
        value = json.loads(record.read_bytes())
        bad = [b'{"schema":1,"schema":1}', b'{"schema":NaN}', b' ' * 4097,
               json.dumps({**value, 'private_identity': [0, 0]}).encode(),
               json.dumps({**value, 'schema': True}).encode(),
               json.dumps({**value, 'private_identity': [True, 1]}).encode()]
        for raw in bad:
            with self.subTest(raw=raw[:40]):
                record.write_bytes(raw)
                self.assertEqual(pending.inspect(self.project)['status'], 'invalid')
                self.assert_blocked()

    def test_unknown_extra_record_keeps_valid_reservation_blocked(self):
        self.reserve()
        (self.private / pending.PENDING_DIRECTORY / 'unknown.json').write_text('{}')
        self.assertEqual(pending.inspect(self.project)['status'], 'invalid')
        self.assert_blocked()

    def test_fsync_failure_retains_pending_for_every_durability_boundary(self):
        real_sync = os.fsync
        for boundary in range(1, 5):
            with self.subTest(boundary=boundary), tempfile.TemporaryDirectory() as root:
                project = Path(root)
                (project / 'private').mkdir(mode=0o700)
                count = 0
                def fail(fd):
                    nonlocal count
                    count += 1
                    if count == boundary:
                        raise OSError('synthetic fsync failure')
                    return real_sync(fd)
                with mock.patch.object(pending.os, 'fsync', side_effect=fail):
                    with self.assertRaisesRegex(OSError, 'synthetic fsync failure'):
                        pending.reserve(project, self.bindings())
                self.assertTrue((project / 'private' / pending.PENDING_DIRECTORY).exists())
                self.assertTrue(pending.inspect(project)['blocked'])
                with self.assertRaisesRegex(RuntimeError, 'pending generation'):
                    with ClusterLock(project):
                        self.fail('failed publication admitted mutation')
                self.assertNotIn(LOCK_ENV, os.environ)

    def test_root_replacement_during_admission_is_rejected(self):
        real_check = pending.assert_no_pending
        def replace(fd):
            real_check(fd)
            self.private.rename(self.project / 'old-private')
            self.private.mkdir(mode=0o700)
        with mock.patch.object(pending, 'assert_no_pending', side_effect=replace):
            with self.assertRaisesRegex(RuntimeError, 'private root changed'):
                with ClusterLock(self.project):
                    self.fail('replacement root admitted mutation')
        self.assertNotIn(LOCK_ENV, os.environ)

    def test_root_replacement_during_publication_is_rejected(self):
        real_sync = os.fsync
        count = 0
        def replace(fd):
            nonlocal count
            real_sync(fd)
            count += 1
            if count == 3:
                self.private.rename(self.project / 'old-private')
                self.private.mkdir(mode=0o700)
        with mock.patch.object(pending.os, 'fsync', side_effect=replace):
            with self.assertRaisesRegex(RuntimeError, 'private root changed'):
                self.reserve()
        old = self.project / 'old-private' / pending.PENDING_DIRECTORY
        self.assertTrue(old.is_dir())
        self.assertEqual(list(self.private.iterdir()), [])

    def test_pending_directory_replacement_during_publication_is_rejected(self):
        real_sync = os.fsync
        count = 0
        directory = self.private / pending.PENDING_DIRECTORY
        def replace(fd):
            nonlocal count
            real_sync(fd)
            count += 1
            if count == 3:
                directory.rename(self.private / 'old-pending')
                directory.mkdir(mode=0o700)
        with mock.patch.object(pending.os, 'fsync', side_effect=replace):
            with self.assertRaisesRegex(RuntimeError, 'directory changed'):
                self.reserve()
        self.assert_blocked()


    def test_inspect_unsafe_private_root_is_invalid(self):
        self.private.rmdir()
        self.private.write_text('not a directory')
        self.assertEqual(pending.inspect(self.project), {'status': 'invalid', 'blocked': True})
        self.private.unlink()
        self.private.symlink_to('missing')
        self.assertEqual(pending.inspect(self.project), {'status': 'invalid', 'blocked': True})

    def test_inspect_root_drift_without_pending_is_invalid(self):
        real_check = pending.assert_no_pending
        def replace(fd):
            real_check(fd)
            self.private.rename(self.project / 'old-private')
            self.private.mkdir(mode=0o700)
        with mock.patch.object(pending, 'assert_no_pending', side_effect=replace):
            self.assertEqual(pending.inspect(self.project), {'status': 'invalid', 'blocked': True})

    def test_concurrent_reservation_has_one_winner(self):
        code = ('from pending_generation import reserve; import json,sys; '
                'print(reserve(sys.argv[1],json.loads(sys.argv[2])))')
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1',
                   PYTHONPATH=str(Path(__file__).resolve().parents[1] / 'scripts'))
        children = [subprocess.Popen([sys.executable, '-c', code, str(self.project),
                                      json.dumps(self.bindings())], env=env,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True) for _ in range(2)]
        results = [child.communicate(timeout=10) for child in children]
        self.assertEqual(sorted(child.returncode == 0 for child in children), [False, True])
        observed = pending.inspect(self.project)
        self.assertEqual(observed['status'], 'pending')
        winner = next(stdout.strip() for child, (stdout, _) in zip(children, results)
                      if child.returncode == 0)
        self.assertEqual(observed['sha256'], winner)
        self.assert_blocked()



if __name__ == '__main__':
    unittest.main()

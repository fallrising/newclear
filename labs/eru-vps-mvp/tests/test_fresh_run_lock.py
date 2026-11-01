"""Owned admission uses synthetic private roots and fixed child processes only."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from labops import ClusterLock, LOCK_ENV, lock_fds
import pending_generation as pending


class FreshRunLockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.private = self.project / 'private'
        self.private.mkdir(mode=0o700)
        self.old_env = os.environ.pop(LOCK_ENV, None)
        self.addCleanup(self.restore_env)
        self.bindings = {'cluster_id': 'eru-vps-mvp', 'run_id': 'synthetic-run',
                         'generation_before': 1, 'target_generation': 2,
                         **{field: 'a' * 64 for field in pending._HASH_FIELDS}}

    def restore_env(self):
        os.environ.pop(LOCK_ENV, None)
        if self.old_env is not None:
            os.environ[LOCK_ENV] = self.old_env

    def reserve(self):
        pending.reserve(self.project, self.bindings)
        self.expected = pending.inspect(self.project)
        self.record = self.private / pending.PENDING_DIRECTORY / pending.RECORD_NAME
        self.original = self.record.read_bytes()

    def fresh(self, expected=None):
        from fresh_run_lock import FreshRunLock
        return FreshRunLock(self.project, self.expected if expected is None else expected)

    def assert_ordinary_blocked(self):
        with self.assertRaisesRegex(RuntimeError, 'pending generation'):
            with ClusterLock(self.project):
                self.fail('ordinary mutation admitted')

    def test_checked_reservation_validates_before_publication(self):
        calls = []
        def verify(lock):
            calls.append(lock)
            self.assertIsNotNone(lock.private_fd)
            lock.check_private_root()
            self.assertFalse((self.private / pending.PENDING_DIRECTORY).exists())
            self.assertIn(LOCK_ENV, os.environ)
            return self.bindings
        sha = pending.reserve(self.project, self.bindings, verify=verify)
        self.assertEqual(len(calls), 1)
        self.assertEqual(pending.inspect(self.project)['sha256'], sha)
        self.assert_ordinary_blocked()

    def test_checked_callback_holds_actual_exclusive_lock(self):
        code = ('from labops import ClusterLock; import sys; '
                'ClusterLock(sys.argv[1]).__enter__(); print("ADMITTED")')
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1',
                   PYTHONPATH=str(Path(__file__).resolve().parents[1] / 'scripts'))
        env.pop(LOCK_ENV, None)
        def verify(_lock):
            result = subprocess.run([sys.executable, '-c', code, str(self.project)],
                                    env=env, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('cluster operation already running', result.stderr)
            self.assertNotIn('ADMITTED', result.stdout)
            return self.bindings
        pending.reserve(self.project, self.bindings, verify=verify)
        self.assert_ordinary_blocked()

    def test_existing_pending_blocks_before_checked_callback(self):
        self.reserve()
        callback = mock.Mock(return_value=self.bindings)
        with self.assertRaisesRegex(RuntimeError, 'pending generation'):
            pending.reserve(self.project, self.bindings, verify=callback)
        callback.assert_not_called()
        self.assertEqual(self.record.read_bytes(), self.original)

    def test_checked_reservation_failure_never_publishes(self):
        def fail(_lock):
            raise RuntimeError('synthetic current evidence drift')
        with self.assertRaisesRegex(RuntimeError, 'current evidence drift'):
            pending.reserve(self.project, self.bindings, verify=fail)
        self.assertEqual(pending.inspect(self.project), {'status': 'absent', 'blocked': False})
        self.assertNotIn(LOCK_ENV, os.environ)
        with ClusterLock(self.project):
            pass

    def test_checked_reservation_requires_exact_full_bindings(self):
        for result in (None, False, {'run_id': self.bindings['run_id']},
                       {**self.bindings, 'scope_sha256': 'b' * 64},
                       {**self.bindings, 'generation_before': True}):
            with self.subTest(result=result), self.assertRaises((ValueError, RuntimeError)):
                pending.reserve(self.project, self.bindings, verify=lambda _lock: result)
            self.assertFalse((self.private / pending.PENDING_DIRECTORY).exists())
            self.assertNotIn(LOCK_ENV, os.environ)

    def test_checked_reservation_root_drift_prevents_publication(self):
        def replace(_lock):
            self.private.rename(self.project / 'old-private')
            self.private.mkdir(mode=0o700)
            return self.bindings
        with self.assertRaisesRegex(RuntimeError, 'private root changed'):
            pending.reserve(self.project, self.bindings, verify=replace)
        self.assertFalse((self.private / pending.PENDING_DIRECTORY).exists())
        self.assertFalse((self.project / 'old-private' / pending.PENDING_DIRECTORY).exists())

    def test_exact_owned_admission_keeps_permanent_barrier(self):
        self.reserve()
        before = pending.inspect(self.project)
        with self.fresh() as lock:
            self.assertFalse(lock.inherited)
            lock.check_pending()
        self.assertEqual(pending.inspect(self.project), before)
        self.assertEqual(self.record.read_bytes(), self.original)
        self.assertNotIn(LOCK_ENV, os.environ)
        self.assert_ordinary_blocked()
        with self.fresh():
            pass

    def test_every_binding_and_record_field_is_exact(self):
        self.reserve()
        for field in self.bindings:
            expected = copy.deepcopy(self.expected)
            value = expected['reservation']['bindings'][field]
            expected['reservation']['bindings'][field] = value + 1 if type(value) is int else 'different'
            with self.subTest(field=field), self.assertRaises((ValueError, RuntimeError)):
                with self.fresh(expected):
                    self.fail('different binding admitted')
        for change in ({'sha256': 'b' * 64}, {'extra': True}, {'blocked': 1},
                       {'pending_identity': [0, 0]}, {'record_identity': [0, 0]}):
            with self.subTest(change=change), self.assertRaises((ValueError, RuntimeError)):
                with self.fresh({**self.expected, **change}):
                    self.fail('different observation admitted')
        self.assertEqual(self.record.read_bytes(), self.original)
        self.assert_ordinary_blocked()

    def test_reservation_metadata_and_private_identity_are_exact(self):
        self.reserve()
        for change in ({'schema': True}, {'schema': 2}, {'operation': 'other'},
                       {'private_identity': [0, 0]}, {'extra': 'field'}):
            expected = copy.deepcopy(self.expected)
            expected['reservation'].update(change)
            with self.subTest(change=change), self.assertRaises((ValueError, RuntimeError)):
                with self.fresh(expected):
                    self.fail('changed reservation admitted')
        self.assertEqual(self.record.read_bytes(), self.original)
        self.assert_ordinary_blocked()

    def test_expected_observation_is_snapshotted(self):
        self.reserve()
        expected = copy.deepcopy(self.expected)
        lock = self.fresh(expected)
        expected['reservation']['bindings']['run_id'] = 'other-run'
        with lock:
            pass

    def test_absent_invalid_and_partial_observations_cannot_admit(self):
        self.reserve()
        for expected in ({'status': 'absent', 'blocked': False},
                         {'status': 'invalid', 'blocked': True},
                         {'status': 'pending', 'blocked': True},
                         self.expected['reservation'], self.bindings['run_id']):
            with self.subTest(expected=expected), self.assertRaises((ValueError, RuntimeError)):
                with self.fresh(expected):
                    self.fail('non-reservation admitted')
        self.assert_ordinary_blocked()

    def test_raw_reformatting_drift_blocks_same_record(self):
        self.reserve()
        lock = self.fresh()
        self.record.write_text(json.dumps(self.expected['reservation'], indent=2))
        self.assertEqual(pending.inspect(self.project)['reservation'], self.expected['reservation'])
        with self.assertRaisesRegex(RuntimeError, 'pending reservation changed'):
            with lock:
                self.fail('raw drift admitted')
        self.assert_ordinary_blocked()

    def test_same_bytes_record_and_directory_replacement_are_drift(self):
        self.reserve()
        lock = self.fresh()
        self.record.rename(self.record.with_suffix('.old'))
        self.record.write_bytes(self.original)
        self.record.chmod(0o600)
        self.record.with_suffix('.old').unlink()
        with self.assertRaisesRegex(RuntimeError, 'pending reservation changed'):
            with lock:
                self.fail('replacement record admitted')
        self.expected = pending.inspect(self.project)
        lock = self.fresh()
        directory = self.record.parent
        directory.rename(self.private / 'old-pending')
        directory.mkdir(mode=0o700)
        self.record.write_bytes(self.original)
        self.record.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, 'pending reservation changed'):
            with lock:
                self.fail('replacement directory admitted')
        self.assert_ordinary_blocked()

    def test_private_root_replacement_cannot_adopt_reservation(self):
        self.reserve()
        lock = self.fresh()
        self.private.rename(self.project / 'old-private')
        self.private.mkdir(mode=0o700)
        directory = self.private / pending.PENDING_DIRECTORY
        directory.mkdir(mode=0o700)
        self.record.write_bytes(self.original)
        self.record.chmod(0o600)
        self.assertEqual(pending.inspect(self.project)['status'], 'invalid')
        with self.assertRaisesRegex(RuntimeError, 'pending reservation changed'):
            with lock:
                self.fail('other private root admitted')
        self.assert_ordinary_blocked()

    def test_malformed_actual_record_never_admits_or_clears(self):
        self.reserve()
        for raw in (b'', b'{"schema":1,"schema":1}', b'{"schema":NaN}', b' ' * 4097):
            with self.subTest(raw=raw[:40]):
                self.record.write_bytes(raw)
                with self.assertRaisesRegex(RuntimeError, 'pending reservation changed'):
                    with self.fresh():
                        self.fail('malformed reservation admitted')
                self.assertEqual(self.record.read_bytes(), raw)
                self.assert_ordinary_blocked()

    def test_empty_or_unsafe_pending_path_blocks_owned_admission(self):
        self.reserve()
        directory = self.record.parent
        target = self.private / 'synthetic-record'
        target.write_bytes(self.original)
        target.chmod(0o600)
        self.record.unlink()
        with self.assertRaisesRegex(RuntimeError, 'pending reservation changed'):
            with self.fresh():
                self.fail('empty permanent barrier admitted')
        self.assertTrue(directory.exists())
        self.assert_ordinary_blocked()
        for create in (lambda: self.record.symlink_to(target),
                       lambda: os.link(target, self.record), lambda: os.mkfifo(self.record)):
            create()
            with self.assertRaisesRegex(RuntimeError, 'pending reservation changed'):
                with self.fresh():
                    self.fail('unsafe reservation admitted')
            self.assert_ordinary_blocked()
            self.record.unlink()  # Synthetic fixture reset; no production release.

    def test_root_drift_during_entry_observation_is_rechecked(self):
        self.reserve()
        real_inspect = pending.inspect
        def replace(project):
            result = real_inspect(project)
            self.private.rename(self.project / 'old-private')
            self.private.mkdir(mode=0o700)
            return result
        with mock.patch.object(pending, 'inspect', side_effect=replace):
            with self.assertRaisesRegex(RuntimeError, 'private root changed'):
                with self.fresh():
                    self.fail('drift during observation admitted')
        self.assertNotIn(LOCK_ENV, os.environ)
        self.assertEqual((self.project / 'old-private' / pending.PENDING_DIRECTORY
                          / pending.RECORD_NAME).read_bytes(), self.original)

    def test_trusted_root_symlink_supported_but_retarget_is_drift(self):
        backing = self.project / 'backing'
        self.private.rename(backing)
        self.private.symlink_to(backing, target_is_directory=True)
        self.reserve()
        with self.fresh():
            pass
        with self.assertRaisesRegex(RuntimeError, 'private root changed'):
            with self.fresh():
                other = self.project / 'other-backing'
                other.mkdir(mode=0o700)
                self.private.unlink()
                self.private.symlink_to(other, target_is_directory=True)
        self.assertNotIn(LOCK_ENV, os.environ)
        self.assertEqual((backing / pending.PENDING_DIRECTORY / pending.RECORD_NAME).read_bytes(), self.original)

    def test_exit_rechecks_actual_pending_and_releases_only_transient_lock(self):
        self.reserve()
        with self.assertRaisesRegex(RuntimeError, 'pending reservation changed'):
            with self.fresh():
                self.record.write_bytes(b'{}')
        self.assertEqual(self.record.read_bytes(), b'{}')
        self.assertNotIn(LOCK_ENV, os.environ)
        self.assert_ordinary_blocked()

    def test_body_failure_preserves_pending_and_original_exception(self):
        self.reserve()
        with self.assertRaisesRegex(RuntimeError, 'synthetic action failure'):
            with self.fresh():
                raise RuntimeError('synthetic action failure')
        self.assertEqual(self.record.read_bytes(), self.original)
        self.assertNotIn(LOCK_ENV, os.environ)
        self.assert_ordinary_blocked()

    def test_inherited_and_recursive_fresh_entry_is_rejected(self):
        self.reserve()
        code = ('from fresh_run_lock import FreshRunLock; import sys,json; '
                'FreshRunLock(sys.argv[1],json.loads(sys.argv[2])).__enter__(); print("ADMITTED")')
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1',
                   PYTHONPATH=str(Path(__file__).resolve().parents[1] / 'scripts'))
        with self.fresh() as lock:
            env[LOCK_ENV] = os.environ[LOCK_ENV]
            result = subprocess.run([sys.executable, '-c', code, str(self.project),
                                     json.dumps(self.expected)], env=env, pass_fds=lock_fds(),
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('inherited controller lock', result.stderr)
            self.assertNotIn('ADMITTED', result.stdout)
            with self.assertRaisesRegex(RuntimeError, 'inherited controller lock'):
                with self.fresh():
                    self.fail('recursive lock admitted')
            os.fstat(lock.fd)
        self.assert_ordinary_blocked()

    def test_same_and_different_run_contend_on_actual_exclusive_lock(self):
        self.reserve()
        code = ('from fresh_run_lock import FreshRunLock; import sys,json; '
                'FreshRunLock(sys.argv[1],json.loads(sys.argv[2])).__enter__(); print("ADMITTED")')
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1',
                   PYTHONPATH=str(Path(__file__).resolve().parents[1] / 'scripts'))
        env.pop(LOCK_ENV, None)
        with self.fresh():
            for run in (self.bindings['run_id'], 'other-run'):
                expected = copy.deepcopy(self.expected)
                expected['reservation']['bindings']['run_id'] = run
                result = subprocess.run([sys.executable, '-c', code, str(self.project),
                                         json.dumps(expected)], env=env, capture_output=True,
                                        text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('cluster operation already running', result.stderr)
                self.assertNotIn('ADMITTED', result.stdout)
        self.assert_ordinary_blocked()


if __name__ == '__main__':
    unittest.main()

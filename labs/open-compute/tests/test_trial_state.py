import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import lab
import trial_state as state


def manifest():
    return dict(schema_version=1, uid=os.geteuid(), trial_id='a'*32,
                scope=dict(device=1, inode=2, marker='b'*64), port=8787,
                binary=dict(path='/private/ocd', sha256='c'*64), fixture_sha256='d'*64,
                identity=None, clean=False, workflow=None)


def identity():
    return dict(instance_id='instance', account_id='account', database_id='database',
                deployment=dict(deployment_id='deployment', version_id='version',
                  script_etag='e'*64, runtime={'engine': {'flags': ['one', 1, True, None]}},
                  bindings=[dict(type='d1', name='DB', database_id='database'),
                    dict(type='workflow', name='FLOW', workflow_name='m1-flow', class_name='LabFlow')]))


def workflow(phase='waiting'):
    return dict(id='flow-1', job_id='job-1', created_at=1234.5,
                boot_id='12345678-1234-1234-1234-123456789abc', created_monotonic=42.0,
                phase=phase, nonce_sha256=None if phase == 'reserved' else 'f'*64,
                completed=phase == 'complete')


class ManifestTests(unittest.TestCase):
    def test_private_manifest_roundtrip_and_independent_copy(self):
        value = manifest()
        value.update(identity=identity(), clean=True, workflow=workflow())
        result = state.validate_manifest(value)
        self.assertEqual(value, result)
        result['identity']['deployment']['runtime']['engine']['flags'].append('new')
        self.assertNotEqual(value, result)

    def test_invalid_types_bounds_bindings_and_runtime(self):
        value = manifest()
        for changes in [dict(schema_version=True), dict(uid=True), dict(port=True), dict(port=80),
                        dict(extra='secret'), dict(trial_id='A'*32), dict(clean=1),
                        dict(binary=dict(path='relative', sha256='c'*64))]:
            with self.subTest(changes=changes), self.assertRaises(state.StateError):
                state.validate_manifest(dict(value, **changes))
        for runtime in [[], {'bad': float('nan')}, {'bad': 1 << 100}, {'bad': 's'*257},
                        {'nested': [[[[[0]]]]]}]:
            value['identity'] = identity()
            value['identity']['deployment']['runtime'] = runtime
            with self.subTest(runtime=runtime), self.assertRaises(state.StateError):
                state.validate_manifest(value)
        value['identity'] = identity()
        value['identity']['deployment']['bindings'][0]['database_id'] = 'other'
        with self.assertRaises(state.StateError): state.validate_manifest(value)

    def test_workflow_clock_and_phase_invariants(self):
        for phase in ['reserved', 'waiting', 'complete']:
            value = dict(manifest(), workflow=workflow(phase))
            self.assertEqual(state.validate_manifest(value)['workflow']['phase'], phase)
        for change in [dict(created_at=0), dict(created_at=float('inf')), dict(created_monotonic=-1),
                       dict(created_monotonic=True), dict(boot_id='UPPER'), dict(completed=True),
                       dict(nonce_sha256=None), dict(extra=1)]:
            with self.subTest(change=change), self.assertRaises(state.StateError):
                state.validate_manifest(dict(manifest(), workflow=dict(workflow(), **change)))

    def test_scope_uses_passwd_home_and_exact_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            scope = lab.OwnedScope(home / '.open-compute', 8787, bounded_owner=True)
            scope.create()
            value = manifest()
            value['identity'] = identity()
            value['clean'] = True
            value['scope'] = dict(scope.identity, marker=scope.marker)
            with mock.patch.object(state.pwd, 'getpwuid', return_value=mock.Mock(pw_dir=str(home))):
                self.assertEqual(state.validate_scope(value).path, scope.path)
                (scope.path / lab.MARKER).write_text('0'*64)
                with self.assertRaises(state.StateError): state.validate_scope(value)


class DirectoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'state'
        # The managed authoring mount maps system root to uid65534 and shared
        # workspace ancestors to mode0775. Simulate safe *outside-fixture*
        # ancestors only; production must still reject those real paths.
        original_fstat = state.os.fstat
        fixture = Path(self.temp.name)
        def safe_external_ancestors(fd):
            info = original_fstat(fd)
            target = Path(os.readlink('/proc/self/fd/' + str(fd)))
            if target != fixture and target in fixture.parents:
                values = list(info)
                values[0] &= ~0o022
                values[4] = 0
                return os.stat_result(values)
            return info
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(state.os, 'fstat', side_effect=safe_external_ancestors).start()

    def test_atomic_private_roundtrip_and_contention(self):
        with state.StateDirectory(self.path, create=True) as directory:
            directory.save(manifest())
            self.assertEqual(directory.load(), manifest())
            self.assertEqual(self.path.stat().st_mode & 0o777, 0o700)
            self.assertEqual((self.path / 'manifest.json').stat().st_mode & 0o777, 0o600)
            with self.assertRaises(state.StateError) as error:
                with state.StateDirectory(self.path): pass
            self.assertEqual(error.exception.reason, 'busy')
            with self.assertRaises(state.StateError):
                with state.StateDirectory(self.path, create=True): pass
        with state.StateDirectory(self.path) as directory:
            self.assertEqual(directory.load(), manifest())

    def test_relative_and_world_writable_parent_refused(self):
        relative = Path(os.path.relpath(self.path, Path.cwd()))
        with self.assertRaises(state.StateError):
            with state.StateDirectory(relative, create=True): pass
        Path(self.temp.name).chmod(0o777)
        try:
            with self.assertRaises(state.StateError):
                with state.StateDirectory(self.path, create=True): pass
        finally:
            Path(self.temp.name).chmod(0o700)
        self.assertFalse(self.path.exists())

    def test_unsafe_ancestor_and_symlink_parent_refused(self):
        base = Path(self.temp.name)
        parent = base / 'private'
        parent.mkdir(mode=0o700)
        base.chmod(0o777)
        try:
            with self.assertRaises(state.StateError):
                with state.StateDirectory(parent / 'state', create=True): pass
        finally:
            base.chmod(0o700)
        link = base / 'link'
        link.symlink_to(parent, target_is_directory=True)
        with self.assertRaises(state.StateError):
            with state.StateDirectory(link / 'state', create=True): pass
        self.assertFalse((parent / 'state').exists())
        with state.StateDirectory(parent / 'state', create=True) as directory:
            directory.save(manifest())
            parent.chmod(0o770)
            try:
                with self.assertRaises(state.StateError): directory.load()
            finally:
                parent.chmod(0o700)

    def test_foreign_parent_and_changed_parent_refused(self):
        original_fstat = state.os.fstat
        parent = Path(self.temp.name) / 'private-parent'
        parent.mkdir(mode=0o700)
        def foreign_parent(fd):
            info = original_fstat(fd)
            if Path(os.readlink('/proc/self/fd/' + str(fd))) == parent:
                values = list(info)
                values[4] = os.geteuid() + 1
                return os.stat_result(values)
            return info
        with mock.patch.object(state.os, 'fstat', side_effect=foreign_parent):
            with self.assertRaises(state.StateError):
                with state.StateDirectory(parent / 'state', create=True): pass
        with state.StateDirectory(parent / 'state', create=True) as directory:
            directory.save(manifest())
            parent.rename(parent.with_name('old-parent'))
            parent.mkdir(mode=0o700)
            with self.assertRaises(state.StateError): directory.check()

    def test_existing_root_without_lock_is_not_adopted(self):
        self.path.mkdir(mode=0o700)
        with self.assertRaises(state.StateError):
            with state.StateDirectory(self.path): pass
        self.assertFalse((self.path / 'owner.lock').exists())

    def test_changed_root_or_lock_refused(self):
        with state.StateDirectory(self.path, create=True) as directory:
            (self.path / 'owner.lock').rename(self.path / 'original.lock')
            (self.path / 'owner.lock').write_bytes(b'')
            (self.path / 'owner.lock').chmod(0o600)
            with self.assertRaises(state.StateError): directory.save(manifest())
        with state.StateDirectory(self.path) as directory:
            moved = self.path.with_name('moved')
            self.path.rename(moved)
            self.path.mkdir(mode=0o700)
            with self.assertRaises(state.StateError): directory.check()

    def test_symlinks_hardlinks_and_bad_modes_fail_closed(self):
        with state.StateDirectory(self.path, create=True) as directory:
            directory.save(manifest())
        original = self.path / 'manifest.json'
        saved = self.path / 'saved'
        original.rename(saved)
        original.symlink_to(saved)
        with state.StateDirectory(self.path) as directory:
            with self.assertRaises(state.StateError): directory.load()
            with self.assertRaises(state.StateError): directory.save(manifest())
        original.unlink()
        os.link(saved, original)
        with state.StateDirectory(self.path) as directory:
            with self.assertRaises(state.StateError): directory.load()
        original.unlink()
        saved.rename(original)
        original.chmod(0o644)
        with state.StateDirectory(self.path) as directory:
            with self.assertRaises(state.StateError): directory.load()

    def test_invalid_json_size_duplicates_and_trailing_data(self):
        with state.StateDirectory(self.path, create=True) as directory:
            directory.save(manifest())
            for data in [b'{"a":1,"a":2}', b'{"a":NaN}', b'x'*65537,
                         json.dumps(manifest()).encode()+b' {}', b'\xff']:
                (self.path / 'manifest.json').write_bytes(data)
                with self.subTest(data=data[:30]), self.assertRaises(state.StateError): directory.load()

    def test_write_failure_preserves_old_record_and_temp(self):
        with state.StateDirectory(self.path, create=True) as directory:
            directory.save(manifest())
            before = (self.path / 'manifest.json').read_bytes()
            with mock.patch.object(state.os, 'replace', side_effect=OSError('disk')):
                with self.assertRaises(state.StateError): directory.save(dict(manifest(), port=8888))
            self.assertEqual((self.path / 'manifest.json').read_bytes(), before)
            self.assertTrue(list(self.path.glob('.manifest-*.tmp')))
            self.assertEqual(directory.load()['port'], 8787)

    def test_deleted_manifest_never_recreated_by_initial_context(self):
        with state.StateDirectory(self.path, create=True) as directory:
            directory.save(manifest())
            (self.path / 'manifest.json').unlink()
            with self.assertRaises(state.StateError): directory.save(manifest())
            self.assertFalse((self.path / 'manifest.json').exists())

    def test_manifest_deadline_uses_fixed_error_and_restores_budget(self):
        from contextlib import contextmanager
        @contextmanager
        def expired(*_):
            yield
            raise lab.LabError('private path total deadline exceeded')
        with state.StateDirectory(self.path, create=True) as directory:
            with mock.patch.object(lab, 'm3_deadline', expired):
                with self.assertRaises(state.StateError) as failure: directory.save(manifest())
            self.assertEqual(failure.exception.reason, 'deadline')
            self.assertEqual(directory.load(), manifest())

    def test_lock_content_mutation_refused(self):
        with state.StateDirectory(self.path, create=True) as directory:
            (self.path / 'owner.lock').write_bytes(b'changed')
            with self.assertRaises(state.StateError): directory.check()

    def test_io_error_has_fixed_reason_and_no_secret_diagnostics(self):
        with state.StateDirectory(self.path, create=True) as directory:
            with mock.patch.object(state.os, 'write', side_effect=OSError('private credential text')):
                with self.assertRaises(state.StateError) as failure: directory.save(manifest())
            self.assertEqual(str(failure.exception), 'io')
            self.assertEqual(failure.exception.reason, 'io')
            self.assertFalse((self.path / 'manifest.json').exists())

    def test_directory_fsync_failure_returns_failure_after_complete_replace(self):
        with state.StateDirectory(self.path, create=True) as directory:
            directory.save(manifest())
            fsync = state.os.fsync
            def fail_directory(fd):
                import stat
                if stat.S_ISDIR(os.fstat(fd).st_mode): raise OSError('disk')
                return fsync(fd)
            with mock.patch.object(state.os, 'fsync', side_effect=fail_directory):
                with self.assertRaises(state.StateError): directory.save(dict(manifest(), port=8888))
            self.assertEqual(directory.load()['port'], 8888)


class ProtocolTests(unittest.TestCase):
    def test_requests_all_commands(self):
        for command, args in [('status', {}), ('stop', {}), ('approve', {}),
                              ('read', {'id': 'job-1'}), ('submit', {'id': 'job-1', 'payload': 'hello'}),
                              ('workflow', {'id': 'flow-1', 'job_id': 'job-1'})]:
            value = dict(schema_version=1, command=command, args=args)
            self.assertEqual(state.decode_message(state.encode_message(value)), value)

    def test_frames_reject_extras_partial_duplicates_nonfinite(self):
        valid = state.encode_message(dict(schema_version=1, command='status', args={}))
        for frame in [valid[:-1], valid+b'\n', valid+b'{}\n', b'\xff\n', b'{}\n',
                      b'{"schema_version":1,"schema_version":1,"command":"status","args":{}}\n',
                      b'{"schema_version":NaN,"command":"status","args":{}}\n', b' '*16384+b'\n']:
            with self.subTest(frame=frame[:30]), self.assertRaises(state.StateError): state.decode_message(frame)
        for value in [dict(schema_version=True, command='status', args={}),
                      dict(schema_version=1, command='submit', args=dict(id='job-1', payload='x'*129)),
                      dict(schema_version=1, command='read', args=dict(id='JOB')),
                      dict(schema_version=1, command='stop', args=dict(token='secret'))]:
            with self.assertRaises(state.StateError): state.encode_message(value)

    def test_response_projection_and_invariants(self):
        job = dict(id='job-1', payload='hello', callback_count=0, nonce_sha256=None, completed=0)
        good = dict(schema_version=1, command='read', result='passed', error=None,
                    data=dict(job=job, row_count=1))
        self.assertEqual(state.decode_message(state.encode_message(good)), good)
        for changed in [dict(error='io'), dict(data=dict(job=dict(job, step_nonce='secret'), row_count=1)),
                        dict(data=dict(job=dict(job, callback_count=True), row_count=1)),
                        dict(data=dict(job=dict(job, callback_count=1), row_count=1)),
                        dict(data=dict(job=job, row_count=2)), dict(result='failed')]:
            with self.assertRaises(state.StateError): state.encode_message(dict(good, **changed))
        failed = dict(good, result='failed', error='not_found', data={})
        self.assertEqual(state.decode_message(state.encode_message(failed)), failed)
        with self.assertRaises(state.StateError): state.encode_message(dict(failed, data={'secret':'bad'}))

    def test_payload_matches_original_javascript_utf16_limit(self):
        request = dict(schema_version=1, command='submit', args=dict(id='job-1', payload='😀'*64))
        self.assertEqual(state.decode_message(state.encode_message(request)), request)
        for payload in ['😀'*65, '😀'*128, 'a'*127+'😀']:
            with self.subTest(payload_length=len(payload)), self.assertRaises(state.StateError):
                state.encode_message(dict(request, args=dict(id='job-1', payload=payload)))
        response = dict(schema_version=1, command='read', result='passed', error=None,
                        data=dict(job=dict(id='job-1', payload='😀'*65, callback_count=0,
                                           nonce_sha256=None, completed=0), row_count=1))
        with self.assertRaises(state.StateError): state.encode_message(response)

    def test_all_success_shapes(self):
        cases = dict(init=dict(initialized=True), destroy=dict(destroyed=True),
                     serve=dict(ready=True), status=dict(running=True, daemon=dict(pid=1,start_ticks=2),
                      instance_id='instance', account_id='account', database_id='database',
                      deployment_id='deployment', version_id='version', worker_healthy=True, workflow=None),
                     workflow=dict(id='flow-1',job_id='job-1',status='waiting',callback_count=1,nonce_sha256='f'*64),
                     approve=dict(id='flow-1',job_id='job-1',status='complete',callback_count=1,nonce_sha256='f'*64,completed=1),
                     stop=dict(was_running=True,signal='SIGTERM',forced=False,exit_code=0,all_owned_exited=True))
        for command,data in cases.items():
            value=dict(schema_version=1,command=command,result='passed',error=None,data=data)
            with self.subTest(command=command): self.assertEqual(state.decode_message(state.encode_message(value)),value)

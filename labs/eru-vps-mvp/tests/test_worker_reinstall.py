"""Exercise quarantine/recovery on a temporary filesystem; no service or SSH calls."""
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import test_worker_scope as fixture
from worker_scope import audit, REINSTALL_FILES, STATE_DIRS, SHARED_FILES, MANIFEST
from worker_reinstall import WorkerReinstall, sha


class ReinstallTests(unittest.TestCase):
    setUp = fixture.ScopeTests.setUp
    write_manifest = fixture.ScopeTests.write_manifest

    def worker(self):
        return WorkerReinstall(self.root, os.getuid())

    def quarantine(self, run='test-run'):
        return self.worker().quarantine(run, audit(self.root, os.getuid())['manifest_sha256'])

    def test_quarantine_restore_round_trip_preserves_shared_files(self):
        before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.quarantine()
        for name in REINSTALL_FILES + STATE_DIRS:
            self.assertFalse((self.root / name.lstrip('/')).exists())
        self.assertTrue(self.worker().reconcile('test-run')['restore_possible'])
        self.worker().restore('test-run')
        for name, data in before.items():
            self.assertEqual((self.root / name).read_bytes(), data)
        self.assertTrue(audit(self.root, os.getuid())['scope_verified'])

    def test_install_accepts_only_identical_pinned_six_files_and_keeps_state_absent(self):
        files = {name: (self.root / name.lstrip('/')).read_bytes() for name in REINSTALL_FILES}
        shared = {name: (self.root / name.lstrip('/')).read_bytes() for name in SHARED_FILES}
        self.quarantine()
        result = self.worker().install('test-run', files)
        self.assertEqual(result['stage'], 'installed')
        self.assertTrue(audit(self.root, os.getuid())['scope_verified'])
        for name in STATE_DIRS:
            self.assertFalse((self.root / name.lstrip('/')).exists())
        for name, data in shared.items():
            self.assertEqual((self.root / name.lstrip('/')).read_bytes(), data)
        self.worker().restore('test-run')
        self.assertTrue((self.root / STATE_DIRS[0].lstrip('/')).exists())

    def test_target_identity_is_bound_through_quarantine_and_recovery(self):
        unit = self.root / 'etc/systemd/system/eru-agent.service'
        unit.write_text('[Service]\nEnvironment=ERU_HOSTNAME=worker-2\n')
        self.files['/etc/systemd/system/eru-agent.service'] = sha(unit.read_bytes())
        self.write_manifest()
        wrong = WorkerReinstall(self.root, os.getuid(), target='worker-3')
        with self.assertRaisesRegex(ValueError, 'identity'):
            wrong.quarantine('peer-run', audit(self.root, os.getuid())['manifest_sha256'])
        self.assertFalse((self.root / 'var/lib/eru-mvp/recovery/peer-run').exists())
        worker = WorkerReinstall(self.root, os.getuid(), target='worker-2')
        files = {name: (self.root / name.lstrip('/')).read_bytes() for name in REINSTALL_FILES}
        worker.quarantine('peer-run', audit(self.root, os.getuid())['manifest_sha256'])
        with self.assertRaisesRegex(ValueError, 'recovery identity mismatch'):
            wrong.reconcile('peer-run')
        worker.install('peer-run', files)
        worker.restore('peer-run')
        self.assertTrue(audit(self.root, os.getuid(), expected_node='worker-2')['scope_verified'])

    def test_existing_worker_four_journal_without_node_remains_recoverable(self):
        unit = self.root / 'etc/systemd/system/eru-agent.service'
        unit.write_text('[Service]\nEnvironment=ERU_HOSTNAME=worker-4\n')
        self.files['/etc/systemd/system/eru-agent.service'] = sha(unit.read_bytes())
        self.write_manifest()
        worker = WorkerReinstall(self.root, os.getuid(), target='worker-4')
        worker.quarantine('old-run', audit(self.root, os.getuid())['manifest_sha256'])
        journal = self.root / 'var/lib/eru-mvp/recovery/old-run/journal.json'
        record = json.loads(journal.read_text());record.pop('node')
        journal.write_text(json.dumps(record))
        self.assertTrue(worker.reconcile('old-run')['restore_possible'])
        worker.restore('old-run')

    def test_backup_corruption_blocks_restore_before_writes(self):
        self.quarantine()
        backup = self.root / 'var/lib/eru-mvp/recovery/test-run/backup/usr/local/bin/eru-agent'
        backup.write_bytes(b'corrupted')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.worker().restore('test-run')
        self.assertFalse((self.root / REINSTALL_FILES[0].lstrip('/')).exists())

    def test_snapshot_tampering_blocks_recovery(self):
        self.quarantine()
        snapshot = self.root / 'var/lib/eru-mvp/recovery/test-run/snapshot.json'
        snapshot.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'snapshot checksum'):
            self.worker().restore('test-run')

    def test_new_state_blocks_restore_of_all_paths(self):
        self.quarantine()
        state = self.root / STATE_DIRS[0].lstrip('/')
        state.mkdir(); (state / 'new-cursor').write_text('new data')
        with self.assertRaisesRegex(ValueError, 'new or changed data'):
            self.worker().restore('test-run')
        self.assertEqual((state / 'new-cursor').read_text(), 'new data')
        self.assertFalse((self.root / REINSTALL_FILES[0].lstrip('/')).exists())

    def test_recreated_identical_file_is_not_an_untouched_original(self):
        data = (self.root / REINSTALL_FILES[0].lstrip('/')).read_bytes()
        self.quarantine()
        (self.root / REINSTALL_FILES[0].lstrip('/')).write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'new or changed data'):
            self.worker().restore('test-run')

    def test_interrupted_quarantine_can_restore_only_missing_originals(self):
        worker = self.worker(); original = worker.save
        def fail_after_first_remove(directory, journal):
            original(directory, journal)
            if len(journal['removed']) == 1 and 'error' not in journal:
                raise RuntimeError('simulated lost response')
        with patch.object(worker, 'save', side_effect=fail_after_first_remove):
            with self.assertRaisesRegex(RuntimeError, 'lost response'):
                worker.quarantine('test-run', audit(self.root, os.getuid())['manifest_sha256'])
        self.assertTrue(self.worker().reconcile('test-run')['restore_possible'])
        self.worker().restore('test-run')
        self.assertTrue(audit(self.root, os.getuid())['scope_verified'])

    def test_run_cannot_be_replayed(self):
        self.quarantine()
        self.worker().restore('test-run')
        with self.assertRaises(FileExistsError):
            self.quarantine()

    def test_wrong_manifest_blocks_before_backup_or_removal(self):
        with self.assertRaisesRegex(ValueError, 'manifest changed'):
            self.worker().quarantine('test-run', 'wrong')
        self.assertFalse((self.root / 'var/lib/eru-mvp/recovery').exists())

    def test_wrong_installer_bytes_block_before_install(self):
        files = {name: (self.root / name.lstrip('/')).read_bytes() for name in REINSTALL_FILES}
        self.quarantine(); files[REINSTALL_FILES[0]] = b'wrong release'
        with self.assertRaisesRegex(ValueError, 'pinned component'):
            self.worker().install('test-run', files)
        self.assertFalse((self.root / REINSTALL_FILES[0].lstrip('/')).exists())

    def test_symlink_backup_and_untrusted_parent_block(self):
        self.quarantine()
        backup = self.root / 'var/lib/eru-mvp/recovery/test-run/backup/usr/local/bin/eru-agent'
        backup.unlink(); backup.symlink_to(self.root / SHARED_FILES[0].lstrip('/'))
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.worker().restore('test-run')

    def test_absent_state_stays_absent_after_restore(self):
        state = self.root / STATE_DIRS[0].lstrip('/')
        (state / 'cursor').unlink(); state.rmdir()
        self.quarantine(); self.worker().restore('test-run')
        self.assertFalse(state.exists())


    def test_agent_state_after_install_blocks_recovery_without_deleting_files(self):
        files = {name: (self.root / name.lstrip('/')).read_bytes() for name in REINSTALL_FILES}
        self.quarantine(); self.worker().install('test-run', files)
        state = self.root / STATE_DIRS[0].lstrip('/')
        state.mkdir(); (state / 'fresh').write_text('new agent state')
        with self.assertRaisesRegex(ValueError, 'new or changed data'):
            self.worker().restore('test-run')
        for name, data in files.items():
            self.assertEqual((self.root / name.lstrip('/')).read_bytes(), data)

    def test_partial_install_with_durable_records_can_restore(self):
        files = {name: (self.root / name.lstrip('/')).read_bytes() for name in REINSTALL_FILES}
        self.quarantine();worker = self.worker();original = worker.write_new;count = 0
        def interrupted(*args, **kwargs):
            nonlocal count
            count += 1
            if count == 2: raise RuntimeError('simulated interruption before second write')
            return original(*args, **kwargs)
        with patch.object(worker, 'write_new', side_effect=interrupted):
            with self.assertRaises(RuntimeError): worker.install('test-run', files)
        self.assertTrue(self.worker().reconcile('test-run')['restore_possible'])
        self.worker().restore('test-run')
        self.assertTrue(audit(self.root, os.getuid())['scope_verified'])

    def test_unjournaled_install_result_is_uncertain_and_blocks_restore(self):
        files = {name: (self.root / name.lstrip('/')).read_bytes() for name in REINSTALL_FILES}
        self.quarantine();worker = self.worker();original = worker.write_new
        def interrupted(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError('lost before journal commit')
        with patch.object(worker, 'write_new', side_effect=interrupted):
            with self.assertRaises(RuntimeError): worker.install('test-run', files)
        with self.assertRaisesRegex(ValueError, 'new or changed data'):
            self.worker().restore('test-run')


if __name__ == '__main__':
    unittest.main()

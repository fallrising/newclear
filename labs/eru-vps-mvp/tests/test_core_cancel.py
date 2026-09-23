"""Early cancellation preserves evidence and only unblocks verified archives."""
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import core_update
import test_core_update as core_fixture
import test_core_crash as crash_fixture
import test_labctl as lab_fixture
from core_update import BINARY, MANIFEST, UNIT
from labops import atomic_json, digest
from recovery import RecoveryOperator
from remote_install import verify_core_selection
from worker_reinstall import sha


def proof(before):
    return {'before': before, 'new_sha256': sha(b'new-binary'), 'plan_sha256': digest(before)}


def interrupt_early(updater, before, run='source'):
    save = updater.save
    def stop(directory, record):
        save(directory, record)
        raise OSError('interrupted before backups')
    with patch.object(updater, 'save', side_effect=stop):
        with unittest.TestCase().assertRaisesRegex(OSError, 'interrupted'):
            updater.install(run, before, b'new-binary', sha(b'new-binary'))


class CancellationFilesTests(unittest.TestCase):
    def setUp(self):
        previous_umask = os.umask(0o077)
        self.addCleanup(os.umask, previous_umask)
        fixture = core_fixture.CoreUpdateTests('test_existing_run_cannot_be_replayed')
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        self.updater, self.before, self.root = fixture.updater, fixture.before, fixture.root
        self.source = proof(self.before)
        interrupt_early(self.updater, self.before)

    def inspect(self): return self.updater.inspect_cancellation('source', self.source)
    def cancel(self, name='cancel-1'): return self.updater.cancel('source', name, self.inspect())
    def verify(self, selected=None):
        config = {'files': [], 'artifacts': [{'repository': 'projecteru2/core', 'files': {'eru-core': BINARY}}]}
        if selected: config['preserve_core'] = selected
        verify_core_selection(config, json.loads(self.updater.path(MANIFEST).read_text()),
                              self.root, self.updater.uid, sha(b'new-binary'))

    def test_partial_backups_staged_binary_and_unknown_files_are_preserved(self):
        directory = self.updater.directory('source')
        (directory / 'binary.before').write_bytes(b'partial backup')
        (directory / 'unknown').mkdir(mode=0o700)
        (directory / 'unknown/note').write_bytes(b'not ours to delete')
        self.updater.path('/usr/local/bin/.eru-core-source').write_bytes(b'partial payload')
        observed = self.inspect()
        receipt = self.cancel()
        self.assertEqual(receipt['observed'], observed)
        self.assertEqual(self.updater.inspect(), self.before)
        self.assertEqual(self.updater.retained_update_files('source'), observed['retained'])
        self.assertEqual(json.loads((directory / 'journal.json').read_text())['stage'], 'backing-up')
        self.assertEqual(self.inspect()['stage'], 'cancelled')
        self.verify()
        with self.assertRaisesRegex(ValueError, 'already cancelled'): self.cancel('cancel-2')
        self.assertFalse(self.updater.cancellation_directory('cancel-2').exists())

    def test_durable_replace_intent_or_missing_journal_cannot_be_cancelled(self):
        path = self.updater.directory('source') / 'journal.json'
        original = json.loads(path.read_text())
        for stage in ['replace-intent', 'binary-replaced', 'installed', 'rolled-back', 'cancelled']:
            atomic_json(path, {**original, 'stage': stage})
            with self.subTest(stage=stage), self.assertRaisesRegex(ValueError, 'before replacement'):
                self.cancel()
        path.unlink()
        with self.assertRaisesRegex(ValueError, 'durable original'): self.cancel()
        with self.assertRaisesRegex(ValueError, 'unsafe core update journal'): self.verify()

    def test_source_mismatch_or_later_original_file_change_refuses_cancellation(self):
        for key in ['before', 'new_sha256', 'plan_sha256']:
            source = deepcopy(self.source)
            source[key] = {} if key == 'before' else 'wrong'
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'source plan'):
                self.updater.inspect_cancellation('source', source)
        self.updater.path(BINARY).chmod(0o700)
        with self.assertRaisesRegex(ValueError, 'original core files changed'): self.cancel()
        self.assertFalse(self.updater.cancellation_directory('cancel-1').exists())

    def test_preserved_configuration_is_verified_against_original_manifest(self):
        config = self.updater.path('/etc/eru/core.yaml')
        config.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        config.write_bytes(b'initial')
        owner = json.loads(self.updater.path(MANIFEST).read_text())
        owner['files']['/etc/eru/core.yaml'] = sha(b'initial')
        atomic_json(self.updater.path(MANIFEST), owner)
        before = self.updater.inspect()
        interrupt_early(self.updater, before, 'config-source')
        config.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'configuration changed'):
            self.updater.inspect_cancellation('config-source', proof(before))

    def test_state_drift_after_plan_does_not_create_cancellation(self):
        observed = self.inspect()
        (self.updater.directory('source') / 'new-file').write_bytes(b'appeared later')
        with self.assertRaisesRegex(ValueError, 'state changed after plan'):
            self.updater.cancel('source', 'cancel-1', observed)
        self.assertFalse(self.updater.cancellation_directory('cancel-1').exists())

    def test_unsafe_evidence_blocks_without_deleting_it(self):
        directory = self.updater.directory('source')
        extra = directory / 'unknown'
        extra.symlink_to(self.updater.path(BINARY))
        with self.assertRaisesRegex(ValueError, 'symlink'): self.cancel()
        extra.unlink(); os.link(self.updater.path(BINARY), extra)
        with self.assertRaisesRegex(ValueError, 'hardlink'): self.cancel()
        extra.unlink(); extra.write_bytes(b'unknown'); extra.chmod(0o666)
        with self.assertRaisesRegex(ValueError, 'permissions'): self.cancel()
        extra.chmod(0o600)
        self.updater.mounts.add('/var/lib/eru-mvp/core-updates/source/unknown')
        with self.assertRaisesRegex(ValueError, 'mount'): self.cancel()
        self.assertEqual(extra.read_bytes(), b'unknown')

    def test_receipt_requires_matching_intent_and_unchanged_archived_evidence(self):
        receipt = self.cancel()
        path = self.updater.cancellation_directory('cancel-1') / 'journal.json'
        original = path.read_bytes()
        path.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'intent/receipt'): self.verify()
        path.write_bytes(original)
        journal = self.updater.directory('source') / 'journal.json'
        value = json.loads(journal.read_text()); value['later'] = True; atomic_json(journal, value)
        with self.assertRaisesRegex(ValueError, 'archive changed'): self.verify()
        self.assertEqual(self.updater.path(BINARY).read_bytes(), b'old-binary')
        self.assertEqual(receipt['stage'], 'cancelled')

    def test_a_cancelled_label_or_unverified_receipt_never_bypasses_reapply(self):
        path = self.updater.directory('source') / 'journal.json'
        record = json.loads(path.read_text())
        atomic_json(path, {**record, 'stage': 'cancelled'})
        with self.assertRaisesRegex(ValueError, 'downgrade'): self.verify()
        atomic_json(path, record)
        atomic_json(path.parent / 'cancelled.json', {'stage': 'cancelled'})
        with self.assertRaisesRegex(ValueError, 'invalid cancellation receipt'): self.verify()

    def test_verified_archive_allows_later_patch_but_never_release_downgrade(self):
        self.cancel()
        self.updater.install('later', self.before, b'new-binary', sha(b'new-binary'))
        self.verify({'run': 'later', 'sha256': sha(b'new-binary')})
        with self.assertRaisesRegex(ValueError, 'downgrade'): self.verify()
        (self.updater.directory('source') / 'new-unknown').write_bytes(b'retain')
        with self.assertRaisesRegex(ValueError, 'archive changed'):
            self.verify({'run': 'later', 'sha256': sha(b'new-binary')})

    def test_changes_while_intent_is_saved_leave_no_receipt_and_preserve_new_data(self):
        original = self.updater.save
        def changed(directory, record):
            original(directory, record)
            (self.updater.directory('source') / 'arrived-during-cancel').write_bytes(b'retain me')
        with patch.object(self.updater, 'save', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'while recording intent'): self.cancel()
        self.assertFalse((self.updater.directory('source') / 'cancelled.json').exists())
        self.assertEqual((self.updater.directory('source') / 'arrived-during-cancel').read_bytes(), b'retain me')
        with self.assertRaisesRegex(ValueError, 'downgrade'): self.verify()
        self.assertEqual(self.cancel('fresh-cancel')['stage'], 'cancelled')

    def test_cancel_receipt_links_and_non_regular_staged_payload_are_rejected(self):
        staged = self.updater.path('/usr/local/bin/.eru-core-source')
        staged.mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, 'unsafe staged'): self.cancel()
        staged.rmdir()
        self.cancel()
        receipt = self.updater.directory('source') / 'cancelled.json'
        os.link(receipt, self.root / 'receipt-alias')
        with self.assertRaisesRegex(ValueError, 'hardlink'): self.verify()

    def test_disappearing_receipt_does_not_unblock_reapply(self):
        self.cancel()
        with patch.object(core_update.CoreUpdate, 'cancellation_archive', return_value=None):
            with self.assertRaisesRegex(ValueError, 'disappeared'): self.verify()

    def test_interrupted_cancellation_id_cannot_be_replayed(self):
        with patch('core_update.atomic_json', side_effect=OSError('receipt interrupted')):
            # save uses labops.atomic_json; only the final receipt is interrupted.
            with self.assertRaisesRegex(OSError, 'receipt interrupted'): self.cancel()
        with self.assertRaises(FileExistsError): self.cancel()
        self.assertEqual(self.cancel('cancel-2')['stage'], 'cancelled')
        self.assertTrue((self.updater.cancellation_directory('cancel-1') / 'journal.json').exists())


class CancellationCrashTests(unittest.TestCase):
    fixture = crash_fixture.CoreCrashTests.fixture
    kill = crash_fixture.CoreCrashTests.kill

    def test_all_durable_early_update_cuts_can_cancel_preserving_exact_evidence(self):
        points = ['journal:source:backing-up', 'write:binary.before', 'write:owner.before',
                  'write:.eru-core-source', 'journal:source:replace-intent']
        for point in points:
            for edge in ['before', 'after']:
                if point == 'journal:source:backing-up' and edge == 'before': continue
                if point == 'journal:source:replace-intent' and edge == 'after': continue
                with self.subTest(point=point, edge=edge):
                    fixture = self.fixture()
                    self.kill(fixture, 'install', point, edge)
                    updater = fixture.updater
                    observed = updater.inspect_cancellation('source', proof(fixture.before))
                    updater.cancel('source', 'cancel-next', observed)
                    self.assertEqual(updater.inspect(), fixture.before)
                    self.assertEqual(updater.retained_update_files('source'), observed['retained'])

    def test_sigkill_during_cancellation_requires_fresh_attempt_or_verification_only(self):
        for point in ['journal:recovery-killed:cancel-intent', 'replace:receipt']:
            for edge in ['before', 'after']:
                with self.subTest(point=point, edge=edge):
                    fixture = self.fixture()
                    interrupt_early(fixture.updater, fixture.before)
                    self.kill(fixture, 'cancel', point, edge)
                    updater = fixture.updater
                    attempt = updater.cancellation_directory('recovery-killed')
                    retained = {p.name: p.read_bytes() for p in attempt.iterdir() if p.is_file()}
                    observed = updater.inspect_cancellation('source', proof(fixture.before))
                    if observed['stage'] == 'cancelled':
                        with self.assertRaisesRegex(ValueError, 'already cancelled'):
                            updater.cancel('source', 'cancel-next', observed)
                    else:
                        updater.cancel('source', 'cancel-next', observed)
                    self.assertEqual(updater.inspect(), fixture.before)
                    self.assertEqual(retained, {p.name: p.read_bytes() for p in attempt.iterdir() if p.is_file()})
                    self.assertEqual(updater.inspect_cancellation('source', proof(fixture.before))['stage'], 'cancelled')


class LocalCancellation(RecoveryOperator):
    def __init__(self, project, snapshot, backend):
        super().__init__(project)
        self.live = deepcopy(snapshot)
        self.backend = backend
        self.cancel_calls = 0
        self.lost_reply = False
        self.runtime = {'ActiveState': 'active', 'InvocationID': 'original', 'sha256': sha(b'old-binary')}
    def host_snapshot(self): return deepcopy(self.live['hosts'])
    def core_runtime(self): return deepcopy(self.runtime)
    def protected_services(self): return {'protected': 'unchanged'}
    def etcd_ready(self): pass
    def remote(self, config):
        if config['action'] == 'inspect-cancellation':
            return self.backend.inspect_cancellation(config['source_run'], config['source'])
        assert config['action'] == 'cancel'
        self.cancel_calls += 1
        result = self.backend.cancel(config['source_run'], config['id'], config['expected_cancellation'])
        if self.lost_reply: raise TimeoutError('cancel reply lost')
        return result
    def command(self, *args, **kwargs): raise AssertionError('no service/API mutation allowed')


class CancellationControllerTests(unittest.TestCase):
    def setUp(self):
        previous_umask = os.umask(0o077)
        self.addCleanup(os.umask, previous_umask)
        core = core_fixture.CoreUpdateTests('test_existing_run_cannot_be_replayed'); core.setUp()
        lab = lab_fixture.OperatorTests('test_wrong_supplied_hash_cannot_remove'); lab.setUp()
        self.addCleanup(core.doCleanups); self.addCleanup(lab.doCleanups)
        self.op = LocalCancellation(lab.project, lab.snapshot, core.updater)
        source = {'id': 'source', 'operation': 'core-patch', 'snapshot': deepcopy(lab.snapshot),
                  'bindings': {'inventory': self.op.inventory, 'cluster': self.op.cluster()},
                  'footprint': core.before, 'sha256': sha(b'new-binary'), 'core_runtime': self.op.core_runtime()}
        atomic_json(self.op.root / 'plans/source.json', {'plan': source, 'sha256': digest(source)})
        atomic_json(self.op.root / 'runs/source.json', {'id': 'source', 'operation': 'core-patch',
            'plan_hash': digest(source), 'status': 'failed', 'started_at': '2026-09-22T01:00:00+00:00'})
        atomic_json(self.op.root / 'core-revision.json', {'existing': 'unchanged'})
        interrupt_early(core.updater, core.before)
    def plan(self): return self.op.make_recovery_plan('source', 'core-cancel')
    def execute(self, envelope): return self.op.execute_recovery(envelope['plan']['id'], envelope['sha256'])

    def test_plan_execute_preserves_core_revision_source_failure_and_services(self):
        envelope = self.plan()
        self.assertEqual(envelope['plan']['mutation_hosts'], ['ckc-disposable-01'])
        self.assertEqual(envelope['plan']['operation'], 'core-recovery')
        self.assertEqual(self.execute(envelope)['status'], 'complete')
        self.assertEqual(self.op.cancel_calls, 1)
        self.assertEqual(json.loads((self.op.root / 'core-revision.json').read_text()), {'existing': 'unchanged'})
        self.assertEqual(json.loads((self.op.root / 'runs/source.json').read_text())['status'], 'failed')
        with self.assertRaisesRegex(ValueError, 'never replay'): self.execute(envelope)

    def test_lost_reply_requires_new_plan_and_does_not_repeat_remote_mutation(self):
        envelope = self.plan(); self.op.lost_reply = True
        with self.assertRaisesRegex(TimeoutError, 'cancel reply lost'): self.execute(envelope)
        self.assertEqual(self.op.journal['failed_at'], 'cancelling-core-update')
        with self.assertRaisesRegex(ValueError, 'never replay'): self.execute(envelope)
        self.op.lost_reply = False
        self.assertEqual(self.execute(self.plan())['status'], 'complete')
        self.assertEqual(self.op.cancel_calls, 1)

    def test_wrong_hash_drift_or_changed_source_blocks_before_remote_mutation(self):
        envelope = self.plan()
        with self.assertRaisesRegex(ValueError, 'invalid'):
            self.op.execute_recovery(envelope['plan']['id'], 'wrong')
        self.assertFalse((self.op.root / 'runs' / (envelope['plan']['id'] + '.json')).exists())
        path = self.op.root / 'runs/source.json'
        source = json.loads(path.read_text()); source['reconciled_at'] = 'later'; atomic_json(path, source)
        with self.assertRaisesRegex(ValueError, 'source journal changed'): self.execute(envelope)
        self.assertEqual(self.op.cancel_calls, 0)

    def test_completed_source_later_reapply_or_changed_core_invocation_blocks_plan(self):
        self.op.runtime['InvocationID'] = 'restarted'
        with self.assertRaisesRegex(ValueError, 'running core changed'): self.plan()
        self.op.runtime['InvocationID'] = 'original'
        atomic_json(self.op.root / 'runs/later.json', {'id': 'later', 'operation': 'reapply',
            'status': 'failed', 'started_at': '2026-09-23T01:00:00+00:00'})
        with self.assertRaisesRegex(ValueError, 'superseded'): self.plan()
        (self.op.root / 'runs/later.json').unlink()
        path = self.op.root / 'runs/source.json'; record = json.loads(path.read_text())
        record['status'] = 'complete'; atomic_json(path, record)
        with self.assertRaisesRegex(ValueError, 'completed core update'): self.plan()

    def test_remote_state_changes_after_plan_block_cancellation(self):
        envelope = self.plan()
        (self.op.backend.directory('source') / 'new-file').write_bytes(b'new evidence')
        with self.assertRaisesRegex(ValueError, 'state changed after plan'): self.execute(envelope)
        self.assertEqual(self.op.cancel_calls, 0)


if __name__ == '__main__': unittest.main()

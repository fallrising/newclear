"""Preserving a patch must not become a second, unverified core installer."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import test_core_update as fixture
from core_update import BINARY, MANIFEST
from labops import atomic_json, digest
from patched_reapply import selection, gate
from remote_install import verify_core_selection
from worker_reinstall import sha


class ReapplySelectionTests(unittest.TestCase):
    setUp = fixture.CoreUpdateTests.setUp
    install = fixture.CoreUpdateTests.install

    def config(self):
        return {'preserve_core': {'run': 'run-1', 'sha256': sha(b'new-binary')},
                'artifacts': [{'repository': 'projecteru2/core', 'files': {'eru-core': BINARY}}], 'files': []}

    def verify(self, config=None, runtime=None):
        config = self.config() if config is None else config
        state = json.loads(self.updater.path(MANIFEST).read_text())
        return verify_core_selection(config, state, self.root, self.updater.uid, runtime or sha(b'new-binary'))

    def test_matching_patch_is_preserved_byte_for_byte(self):
        self.install()
        before = self.updater.inspect()
        self.verify()
        self.assertEqual(self.updater.inspect(), before)

    def test_release_path_cannot_bypass_patch_guard(self):
        self.install()
        config = self.config();del config['preserve_core']
        with self.assertRaisesRegex(ValueError, 'downgrade'): self.verify(config)

    def test_wrong_running_binary_or_selected_sha_is_rejected(self):
        self.install()
        with self.assertRaisesRegex(ValueError, 'running core'): self.verify(runtime=sha(b'old-binary'))
        config = self.config(); config['preserve_core']['sha256'] = sha(b'wrong')
        with self.assertRaisesRegex(ValueError, 'selected patch'): self.verify(config)

    def test_pending_update_and_aliasing_destinations_are_rejected(self):
        self.install()
        for mutation in ['second-artifact', 'configuration', 'wrong-core-map', 'pending-update']:
            with self.subTest(mutation=mutation):
                config = self.config()
                if mutation == 'second-artifact':
                    config['artifacts'].append({'repository': 'another', 'files': {'other': BINARY}})
                if mutation == 'configuration': config['files'] = [{'path': BINARY}]
                if mutation == 'wrong-core-map': config['artifacts'][0]['files']['other'] = '/tmp/other'
                if mutation == 'pending-update':
                    atomic_json(self.updater.directory('pending') / 'journal.json', {'id': 'pending', 'stage': 'replace-intent'})
                with self.assertRaises(ValueError): self.verify(config)

    def test_local_selection_requires_complete_deployment_and_matching_artifact(self):
        root = self.root / 'private/operations'
        atomic_json(root / 'core-revision.json', {'run': 'patch-1', 'operation': 'core-patch', 'artifact_sha256': 'expected'})
        atomic_json(root / 'runs/patch-1.json', {'operation': 'core-patch', 'status': 'failed'})
        with patch('patched_reapply.artifact', return_value=(b'artifact', 'expected')):
            with self.assertRaisesRegex(ValueError, 'not complete'): selection(self.root, 'artifact')
            atomic_json(root / 'runs/patch-1.json', {'operation': 'core-patch', 'status': 'complete'})
            self.assertEqual(selection(self.root, 'artifact'), {'run': 'patch-1', 'sha256': 'expected'})
        with patch('patched_reapply.artifact', return_value=(b'other', 'other')):
            with self.assertRaisesRegex(ValueError, 'must match'): selection(self.root, 'artifact')

    def test_recovery_snapshot_binding_rejects_a_later_binary_even_if_still_known(self):
        self.install()
        expected = self.updater.inspect_recovery('run-1')
        self.updater.path(BINARY).write_bytes(b'old-binary')
        with self.assertRaisesRegex(ValueError, 'changed after plan'):
            self.updater.rollback('run-1', 'recovery-1', expected)
        self.assertFalse(self.updater.directory('recovery-1').exists())

    def test_recovery_does_not_ignore_changed_config(self):
        path = self.updater.path('/etc/eru/core.yaml');path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.write_bytes(b'original config');path.chmod(0o600)
        state = json.loads(self.updater.path(MANIFEST).read_text())
        state['files']['/etc/eru/core.yaml'] = sha(path.read_bytes())
        atomic_json(self.updater.path(MANIFEST), state)
        self.before = self.updater.inspect();self.install()
        path.write_bytes(b'prefix changed')
        with self.assertRaisesRegex(ValueError, 'configuration changed'): self.updater.inspect_recovery('run-1')


class ReapplyGateTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import Mock
        fixture_case=fixture.PatchFlowTests('test_health_evidence_drift_prevents_install')
        fixture_case.setUp();self.addCleanup(fixture_case.doCleanups)
        self.op=fixture_case.op
        self.runtime={'sha256':sha(b'new'), 'InvocationID':'core-instance'}
        atomic_json(self.op.root/'core-revision.json',{'operation':'core-patch','core_runtime':self.runtime})
        report=json.loads((self.op.project/'private/health.json').read_text())
        for sample in report['samples']:
            sample['commands']['services']['stdout']+='InvocationID=core-instance\n'
        atomic_json(self.op.project/'private/health.json',report)
        self.probe=Mock();self.probe.events=[]
        self.probe.core_runtime.return_value=self.runtime
        self.probe.remote.return_value={'binary':{'sha256':sha(b'new')}}
        self.enterContext(patch('patched_reapply.PatchOperator',return_value=self.probe))
        self.enterContext(patch('patched_reapply.selection',return_value={'sha256':sha(b'new'),'run':'source'}))

    def test_verified_patch_and_fresh_matching_invocation_pass(self):
        result=gate(self.op,'artifact','private/health.json',self.op.live)
        self.assertEqual(result['blockers'],[])

    def test_new_invocation_or_unowned_binary_blocks(self):
        self.probe.core_runtime.return_value={**self.runtime,'InvocationID':'other'}
        self.assertTrue(gate(self.op,'artifact','private/health.json',self.op.live)['blockers'])
        self.probe.core_runtime.return_value=self.runtime
        self.probe.remote.return_value={'binary':{'sha256':'another'}}
        self.assertTrue(gate(self.op,'artifact','private/health.json',self.op.live)['blockers'])

    def test_plan_rejects_missing_health_and_execute_rechecks_health_digest(self):
        self.assertFalse(self.op.plan('reapply',core_artifact='artifact')['plan']['executable'])
        plan=self.op.plan('reapply',core_artifact='artifact',health_file='private/health.json')
        self.assertTrue(plan['plan']['executable'])
        report=json.loads((self.op.project/'private/health.json').read_text())
        report['extra_observation']='changed after plan'
        atomic_json(self.op.project/'private/health.json',report)
        with self.assertRaisesRegex(ValueError,'patched artifact/runtime/health changed'):
            self.op.execute(plan['plan']['id'],plan['sha256'])
        self.assertEqual(self.op.journal['failed_at'],'preflight')

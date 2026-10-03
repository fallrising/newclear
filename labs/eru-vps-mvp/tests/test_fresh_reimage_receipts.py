"""Offline four-host console receipt assessment and adversarial linkage tests."""
import base64
import copy
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_reimage_receipt_ops as ops
import fresh_reimage_receipts as protocol
import fresh_execution_ops as execution_ops
import pending_generation
from fresh_rebuild import plan_digest
import test_fresh_observation_review as fixtures


class FreshReceiptTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ObservationEvidenceReviewTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.f = self.fixture.f
        self.project, self.now, self.run = self.f.project, self.f.now, self.f.run
        _, self.refs = self.f.collect()
        self.execution, _ = self.fixture.prepare(self.refs)
        self.plan = self.f.review['plan']
        self.baseline = json.loads((self.project / self.refs['host_baseline']['path']).read_text())
        self.binding = {**self.f.binding, 'execution_sha256': self.execution['sha256'],
                        'observation_sha256': self.refs['observation']['sha256']}
        self.actions, self.receipts = [], []
        self.document = {'schema_version': 1, 'binding': self.binding, 'hosts': []}
        for i, host in enumerate(self.plan['scope']['hosts'], 1):
            common = {'schema_version': 1, 'binding': copy.deepcopy(self.binding),
                'target': {'alias': host['alias'], 'node': host['node'],
                           'machine_id': host['current_machine_id']},
                'provider_resource_ref': host['provider_resource_ref'],
                'os_image_ref': host['os_image_ref'], 'erase_scope': copy.deepcopy(host['erase_scope']),
                'provider_api_used': False, 'owner_confirmed': True,
                'provider_console_action_ref': 'console-action-' + str(i)}
            action = {**copy.deepcopy(common), 'kind': 'fresh-console-action',
                      'host_intent': copy.deepcopy(host['source']),
                      'created_at': (self.now + timedelta(minutes=1)).isoformat()}
            receipt = {**copy.deepcopy(common), 'kind': 'fresh-console-receipt', 'action': {},
                'host_intent': copy.deepcopy(host['source']),
                'replacement': {'machine_id': 'replacement-machine-' + str(i),
                    'boot_id': '11111111-1111-1111-1111-%012d' % i, 'os_release': 'Debian GNU/Linux 12'},
                'volume_results': [{'volume_ref': v, 'result': 'erased'} for v in
                    [host['erase_scope']['boot_volume_ref'], *host['erase_scope']['additional_volume_refs']]],
                'console_completed_at': (self.now + timedelta(hours=1)).isoformat(),
                'owner_reviewed_at': (self.now + timedelta(hours=2)).isoformat(),
                'host_key_verified_via': 'provider-console',
                'host_key_fingerprints': {'ssh-ed25519': 'SHA256:' + base64.b64encode(bytes([i + 20]) * 32).decode().rstrip('=')}}
            self.actions.append(action)
            self.receipts.append(receipt)
            self.document['hosts'].append({'alias': host['alias'], 'node': host['node'],
                'action': {'path': 'private/fresh-reimage-receipts/action-' + str(i) + '.json', 'sha256': ''},
                'receipt': {'path': 'private/fresh-reimage-receipts/receipt-' + str(i) + '.json', 'sha256': ''}})
        self.input_path = 'private/fresh-reimage-receipts/request.json'
        self.save()

    def write(self, path, value):
        self.f.fixture.write_json(path, value)
        return hashlib.sha256((self.project / path).read_bytes()).hexdigest()

    def save(self):
        for row, action, receipt in zip(self.document['hosts'], self.actions, self.receipts):
            row['action']['sha256'] = self.write(row['action']['path'], action)
            receipt['action'] = copy.deepcopy(row['action'])
            row['receipt']['sha256'] = self.write(row['receipt']['path'], receipt)
        self.write(self.input_path, self.document)
        self.f.secure()

    def inspect(self, **kwargs):
        options = {'now': self.now + timedelta(hours=2), 'source_state': self.f.fixture.report['source']}
        options.update(kwargs)
        return ops.inspect_receipts(self.project, self.run, self.execution['sha256'], self.input_path, **options)

    def snapshot(self):
        return {str(p.relative_to(self.project)): p.read_bytes() for p in self.project.rglob('*') if p.is_file()}

    def test_all_four_including_core_pass_after_baseline_expiry_without_writes(self):
        before = self.snapshot()
        with patch.object(execution_ops.os, 'mkdir', side_effect=AssertionError('write')):
            result = self.inspect()
        self.assertEqual(result['status'], 'receipts-reviewed')
        self.assertEqual(result['host_count'], 4)
        self.assertNotIn(self.f.fixture.sentinel, json.dumps(result))
        for flag in ('stage_accepted', 'executable', 'remote_mutation_performed', 'generation_changed'):
            self.assertIs(result[flag], False)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(len(self.f.calls), 4)

    def test_rehashed_cross_binding_action_scope_and_volume_results_rejected(self):
        original = copy.deepcopy(self.receipts)
        changes = [lambda r: r['binding'].update(run_id='foreign'),
            lambda r: r['binding'].update(target_generation=True),
            lambda r: r.update(provider_resource_ref='foreign'),
            lambda r: r.update(os_image_ref='foreign'),
            lambda r: r.update(provider_console_action_ref='foreign'),
            lambda r: r.update(provider_api_used=True),
            lambda r: r.update(owner_confirmed=False),
            lambda r: r['volume_results'].pop(),
            lambda r: r['volume_results'][0].update(result='unknown'),
            lambda r: r['volume_results'][0].update(volume_ref='foreign'),
            lambda r: r.update(unknown=True)]
        for change in changes:
            with self.subTest(change=change):
                self.receipts = copy.deepcopy(original)
                change(self.receipts[0])
                self.save()
                self.assertEqual(self.inspect()['status'], 'blocked')

    def test_old_cross_host_and_duplicate_replacement_identities_rejected(self):
        original = copy.deepcopy(self.receipts)
        old = self.baseline['hosts'][1]
        changes = [lambda r: r['replacement'].update(machine_id=old['machine_id']),
            lambda r: r['replacement'].update(boot_id='00000000-0000-0000-0000-000000000002'),
            lambda r: r['host_key_fingerprints'].update({'ssh-ed25519': 'SHA256:' + base64.b64encode(bytes.fromhex(old['host_key_sha256'])).decode().rstrip('=')}),
            lambda r: r['replacement'].update(machine_id=original[1]['replacement']['machine_id']),
            lambda r: r['replacement'].update(boot_id=original[1]['replacement']['boot_id']),
            lambda r: r.update(host_key_fingerprints=original[1]['host_key_fingerprints'])]
        for change in changes:
            with self.subTest(change=change):
                self.receipts = copy.deepcopy(original)
                change(self.receipts[0])
                self.save()
                self.assertEqual(self.inspect()['status'], 'blocked')

    def test_time_order_freshness_and_future_are_enforced(self):
        original = copy.deepcopy(self.receipts)
        for field, value in [('console_completed_at', self.now.isoformat()),
            ('console_completed_at', (self.now + timedelta(days=2)).isoformat()),
            ('owner_reviewed_at', (self.now + timedelta(hours=3)).isoformat()),
            ('owner_reviewed_at', '2026-09-27T13:00:00')]:
            with self.subTest(field=field, value=value):
                self.receipts = copy.deepcopy(original)
                self.receipts[0][field] = value
                self.save()
                self.assertEqual(self.inspect()['status'], 'blocked')
        self.receipts = original
        self.save()
        self.assertEqual(self.inspect(now=self.now + timedelta(days=8))['status'], 'blocked')

    def test_missing_duplicate_and_reordered_hosts_rejected(self):
        original = copy.deepcopy(self.document)
        for rows in [original['hosts'][:3], [original['hosts'][0]] * 4,
                     list(reversed(original['hosts']))]:
            self.write(self.input_path, {**original, 'hosts': rows})
            self.assertEqual(self.inspect()['status'], 'blocked')

    def test_unsafe_raw_reference_and_changed_original_input_rejected(self):
        path = self.project / self.document['hosts'][0]['receipt']['path']
        raw = path.read_bytes()
        path.unlink()
        path.symlink_to('/dev/null')
        self.assertEqual(self.inspect()['status'], 'blocked')
        path.unlink()
        path.write_bytes(raw)
        self.f.secure()
        original_input = self.project / self.execution['execution']['input']['path']
        original_input.write_bytes(original_input.read_bytes() + b' ')
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_exact_pending_linkage_and_pending_changes(self):
        record = self.execution['execution']
        fields = ('cluster_id', 'run_id', 'generation_before', 'target_generation', 'review_sha256', 'scope_sha256')
        binding = {k: record['binding'][k] for k in fields}
        binding.update(execution_sha256=self.execution['sha256'], cluster_sha256=record['cluster_sha256'],
                       fence_sha256=record['evidence']['writer_fence']['sha256'])
        pending_generation.reserve(self.project, binding)
        self.assertEqual(self.inspect()['status'], 'receipts-reviewed')
        before = pending_generation.inspect(self.project)
        with patch.object(ops.pending_generation, 'inspect', side_effect=[before, {'status': 'absent', 'blocked': False}]):
            self.assertEqual(self.inspect()['status'], 'blocked')
        reservation = self.project / 'private/pending-generation/reservation.json'
        value = json.loads(reservation.read_text())
        value['bindings']['execution_sha256'] = 'f' * 64
        reservation.write_text(json.dumps(value))
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_rehashed_action_preparation_time_and_original_observation_binding(self):
        original = copy.deepcopy(self.actions)
        for field, value in [('created_at', (self.now - timedelta(seconds=1)).isoformat()),
                             ('host_intent', {'path': 'private/foreign.json', 'sha256': 'a' * 64})]:
            self.actions = copy.deepcopy(original)
            self.actions[0][field] = value
            self.save()
            self.assertEqual(self.inspect()['status'], 'blocked')
        self.actions = original
        self.binding['observation_sha256'] = 'f' * 64
        self.save()
        self.assertEqual(self.inspect()['status'], 'blocked')


    def test_action_reference_reuse_and_receipt_raw_hash_tampering(self):
        self.actions[1]['provider_console_action_ref'] = self.actions[0]['provider_console_action_ref']
        self.receipts[1]['provider_console_action_ref'] = self.actions[0]['provider_console_action_ref']
        self.save()
        self.assertEqual(self.inspect()['status'], 'blocked')
        self.actions[1]['provider_console_action_ref'] = 'restored-action-2'
        self.receipts[1]['provider_console_action_ref'] = 'restored-action-2'
        self.save()
        self.assertEqual(self.inspect()['status'], 'receipts-reviewed')
        path = self.project / self.document['hosts'][0]['receipt']['path']
        path.write_bytes(path.read_bytes() + b' ')
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_duplicate_json_and_noncanonical_paths_fail_closed(self):
        path = self.project / self.document['hosts'][0]['receipt']['path']
        raw = path.read_text()
        path.write_text(raw.replace('"schema_version": 1', '"schema_version": 1, "schema_version": 1'))
        self.document['hosts'][0]['receipt']['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.write(self.input_path, self.document)
        self.assertEqual(self.inspect()['status'], 'blocked')
        self.save()
        self.document['hosts'][0]['action']['path'] = 'private/../private/fresh-reimage-receipts/action-1.json'
        self.write(self.input_path, self.document)
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_source_and_observation_publication_markers_block(self):
        changed = {**self.f.fixture.report['source'], 'commit': 'f' * 40}
        self.assertEqual(self.inspect(source_state=changed)['status'], 'blocked')
        directory = (self.project / self.refs['observation']['path']).parent
        marker = directory / '.collection-failed'
        marker.write_text('')
        marker.chmod(0o600)
        self.assertEqual(self.inspect()['status'], 'blocked')
        marker.unlink()
        directory = self.project / execution_ops.AREA / self.run
        (directory / '.publication-failed').write_text('')
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_v1_operator_host_baseline_cannot_substitute_for_observation(self):
        baseline = copy.deepcopy(self.baseline)
        baseline.pop('observation')
        baseline['schema_version'] = 1
        ref = self.execution['execution']['evidence']['host_baseline']
        ref['sha256'] = self.write(ref['path'], baseline)
        record = self.execution['execution']
        request = json.loads((self.project / record['input']['path']).read_text())
        request['host_baseline'] = copy.deepcopy(ref)
        record['input']['sha256'] = self.write(record['input']['path'], request)
        self.execution['sha256'] = plan_digest(record)
        self.write(str(Path(execution_ops.AREA) / self.run / 'execution.json'), self.execution)
        self.binding['execution_sha256'] = self.execution['sha256']
        for action, receipt in zip(self.actions, self.receipts):
            action['binding']['execution_sha256'] = self.execution['sha256']
            receipt['binding']['execution_sha256'] = self.execution['sha256']
        self.save()
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_raw_request_bytes_bound_to_assessment_digest(self):
        first = self.inspect()
        path = self.project / self.input_path
        path.write_bytes(path.read_bytes() + b' ')
        second = self.inspect()
        self.assertEqual(second['status'], 'receipts-reviewed')
        self.assertNotEqual(first['sha256'], second['sha256'])

    def test_boolean_schema_and_unknown_success_fields_rejected(self):
        for target in (self.actions[0], self.receipts[0], self.document):
            target['schema_version'] = True
            self.save()
            self.assertEqual(self.inspect()['status'], 'blocked')
            target['schema_version'] = 1
        self.receipts[0]['volume_results'][0]['result'] = 'passed'
        self.save()
        self.assertEqual(self.inspect()['status'], 'blocked')


if __name__ == '__main__':
    unittest.main()

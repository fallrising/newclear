"""Independent four-host manual receipt boundary and tampering regressions."""
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
import reimage_receipt
import test_labctl as old_fixtures
from labops import digest


class OriginalWorkerBoundaryReviewTests(unittest.TestCase):
    def test_original_receipt_validator_still_rejects_core_role(self):
        fixture = old_fixtures.OperatorTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        envelope = fixture.prepared_reimage_plan()
        plan = copy.deepcopy(envelope['plan'])
        for row in plan['bindings']['inventory']:
            if row['node'] == plan['node']:
                row['role'] = 'core'
        receipt = fixture.write_reimage_receipt(plan)
        with self.assertRaisesRegex(ValueError, 'bound worker inventory'):
            reimage_receipt.load_receipt(fixture.project, receipt, plan=plan,
                                        plan_sha256=digest(plan))

    def test_original_local_trust_validator_still_rejects_core_alias(self):
        with self.assertRaisesRegex(ValueError, 'reviewed worker SSH alias'):
            reimage_receipt.verify_local_hostkeys('ckc-disposable-01', {}, Path('.'))


class FreshReceiptEvidenceReviewTests(unittest.TestCase):
    def setUp(self):
        import test_fresh_reimage_receipts as fixtures
        self.f = fixtures.FreshReceiptTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)

    def test_history_can_be_assessed_but_does_not_renew_authority(self):
        import fresh_execution_ops
        f = self.f
        result = f.inspect()
        self.assertEqual(result['status'], 'receipts-reviewed')
        self.assertIs(result['stage_accepted'], False)
        self.assertIs(result['executable'], False)
        current_preparation = fresh_execution_ops.inspect_execution(
            f.project, f.run, f.execution['sha256'], now=f.now + timedelta(hours=2),
            source_state=f.f.fixture.report['source'])
        self.assertEqual(current_preparation['status'], 'blocked')
        drift = {**f.f.fixture.report['source'], 'commit': 'f' * 40}
        self.assertEqual(f.inspect(source_state=drift)['status'], 'blocked')

    def test_actual_assessment_performs_no_filesystem_writes_or_remote_calls(self):
        import fresh_reimage_receipt_ops as ops
        f = self.f
        before = f.snapshot()
        actual_open = os.open
        def readonly_open(path, flags, *args, **kwargs):
            self.assertFalse(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC),
                             'assessment attempted writing a file')
            return actual_open(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=readonly_open), \
                patch.object(os, 'mkdir', side_effect=AssertionError('mkdir')), \
                patch.object(os, 'fsync', side_effect=AssertionError('fsync')), \
                patch.object(ops.subprocess, 'run', side_effect=AssertionError('subprocess')):
            self.assertEqual(f.inspect()['status'], 'receipts-reviewed')
        self.assertEqual(before, f.snapshot())

    def test_rehashed_duplicate_json_key_is_rejected(self):
        f = self.f
        row = f.document['hosts'][0]
        path = f.project / row['action']['path']
        raw = path.read_bytes()
        duplicate = b'{"schema_version":1,' + raw[raw.index(b'{') + 1:]
        path.write_bytes(duplicate)
        row['action']['sha256'] = hashlib.sha256(duplicate).hexdigest()
        f.receipts[0]['action'] = copy.deepcopy(row['action'])
        row['receipt']['sha256'] = f.write(row['receipt']['path'], f.receipts[0])
        f.write(f.input_path, f.document)
        self.assertEqual(f.inspect()['status'], 'blocked')

    def test_rehashed_receipt_cannot_link_another_hosts_action(self):
        f = self.f
        f.receipts[0]['action'] = copy.deepcopy(f.document['hosts'][1]['action'])
        row = f.document['hosts'][0]
        row['receipt']['sha256'] = f.write(row['receipt']['path'], f.receipts[0])
        f.write(f.input_path, f.document)
        self.assertEqual(f.inspect()['status'], 'blocked')

    def test_rehashed_shared_console_action_is_rejected(self):
        f = self.f
        shared = f.actions[0]['provider_console_action_ref']
        f.actions[1]['provider_console_action_ref'] = shared
        f.receipts[1]['provider_console_action_ref'] = shared
        f.save()
        self.assertEqual(f.inspect()['status'], 'blocked')

    def test_hardlinked_receipt_and_incomplete_preparation_are_rejected(self):
        import fresh_execution_ops
        f = self.f
        path = f.project / f.document['hosts'][0]['receipt']['path']
        second = path.parent / 'hardlink.json'
        os.link(path, second)
        self.assertEqual(f.inspect()['status'], 'blocked')
        second.unlink()
        self.assertEqual(f.inspect()['status'], 'receipts-reviewed')
        marker = f.project / fresh_execution_ops.AREA / f.run / '.publication-failed'
        marker.touch(mode=0o600)
        self.assertEqual(f.inspect()['status'], 'blocked')

    def test_actual_cli_routes_assessment_and_redacts_private_evidence(self):
        import contextlib
        import io
        import labctl
        import fresh_reimage_receipt_ops as ops
        f = self.f
        original = ops.inspect_receipts
        def assess(project, run, sha, input_file):
            return original(project, run, sha, input_file,
                now=f.now + timedelta(hours=2), source_state=f.f.fixture.report['source'])
        output = io.StringIO()
        argv = ['labctl', 'inspect-fresh-reimage-receipts', '--run', f.run,
                '--sha256', f.execution['sha256'], '--input', f.input_path]
        before = f.snapshot()
        with patch.object(labctl, 'PROJECT', f.project), patch.object(sys, 'argv', argv), \
                patch.object(ops, 'inspect_receipts', side_effect=assess), \
                patch.object(labctl, 'Operator', side_effect=AssertionError('operator')), \
                patch.object(labctl, 'ClusterLock', side_effect=AssertionError('lock')), \
                contextlib.redirect_stdout(output):
            labctl.main()
        result = json.loads(output.getvalue())
        self.assertEqual(result['status'], 'receipts-reviewed')
        for private in (f.input_path, f.f.fixture.sentinel,
                        f.actions[0]['provider_resource_ref'],
                        f.receipts[0]['replacement']['machine_id']):
            self.assertNotIn(private, output.getvalue())
        self.assertEqual(before, f.snapshot())

    def test_valid_pending_records_still_require_exact_execution_bindings(self):
        import pending_generation
        f = self.f
        record = f.execution['execution']
        names = ('cluster_id', 'run_id', 'generation_before', 'target_generation',
                 'review_sha256', 'scope_sha256')
        binding = {key: record['binding'][key] for key in names}
        binding.update(execution_sha256=f.execution['sha256'],
                       cluster_sha256=record['cluster_sha256'],
                       fence_sha256=record['evidence']['writer_fence']['sha256'])
        pending_generation.reserve(f.project, binding)
        self.assertEqual(f.inspect()['status'], 'receipts-reviewed')
        path = f.project / 'private/pending-generation/reservation.json'
        original = json.loads(path.read_text())
        for name in ('run_id', 'review_sha256', 'scope_sha256', 'cluster_sha256', 'fence_sha256'):
            with self.subTest(name=name):
                changed = copy.deepcopy(original)
                changed['bindings'][name] = 'foreign-run' if name == 'run_id' else 'e' * 64
                path.write_text(json.dumps(changed))
                self.assertEqual(pending_generation.inspect(f.project)['status'], 'pending')
                self.assertEqual(f.inspect()['status'], 'blocked')

    def test_assessment_digest_tracks_raw_receipt_bytes(self):
        f = self.f
        first = f.inspect()
        row = f.document['hosts'][0]
        path = f.project / row['receipt']['path']
        path.write_bytes(path.read_bytes() + b'\n')
        row['receipt']['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        f.write(f.input_path, f.document)
        second = f.inspect()
        self.assertEqual(second['status'], 'receipts-reviewed')
        self.assertNotEqual(first['sha256'], second['sha256'])

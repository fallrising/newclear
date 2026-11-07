"""Restore inspection must never authorize execution or silently normalize evidence."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('restore_audit', Path(__file__).parents[1]/'tools/restore_audit.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def fixture():
    command = {'idempotency_key': 'test', 'parameters': {'max_sample_age_seconds': 30}}
    ref = {'owner': 'node', 'adapter_id': 'health', 'external_id': 'cmd-test'}
    result = {'owner_outcome': 'succeeded', 'started_at': '2026-10-28T01:00:00Z',
              'finished_at': '2026-10-28T01:00:01Z', 'artifact': '  original 雲 bytes\n'}
    record = {'command_id': 'cmd-test', 'revision': 3, 'command': command,
              'external_ref': ref, 'delivery': 'result_recorded', 'artifact': result['artifact'],
              'result': {k: v for k, v in result.items() if k != 'artifact'}}
    record['result']['artifact_sha256'] = 'sha256:'+digest(result['artifact'])
    body = encoded(command)
    row = {'id': 'cmd-test', 'revision': 3, 'active': 0, 'body': body,
           'body_digest': digest(body), 'record': encoded(record)}
    journal = ['cmd-test', digest(encoded({'command': command, 'external_ref': ref})),
               encoded(ref), 'completed', encoded(result)]
    return row, journal

class RestoreAuditTests(unittest.TestCase):
    def setUp(self): self.row, self.journal = fixture()

    def audit(self):
        before = copy.deepcopy((self.row, self.journal))
        result = a.audit_restore([self.row], [self.journal])[0]
        self.assertEqual((self.row, self.journal), before)
        self.assertIs(result['dispatch_allowed'], False)
        return result['status']

    def record(self, **changes):
        record = json.loads(self.row['record']); record.update(changes)
        self.row['record'] = encoded(record)

    def test_completed_preserves_original_bytes_and_times(self):
        self.assertEqual(self.audit(), 'completed_preserved')

    def test_raw_body_whitespace_is_hashed_without_normalizing(self):
        self.row['body'] += ' '
        with self.assertRaisesRegex(ValueError, '^invalid restore evidence$'): self.audit()

    def test_record_command_must_match_raw_body(self):
        self.record(command={'idempotency_key': 'other'})
        with self.assertRaises(ValueError): self.audit()

    def test_ids_revision_and_active_are_consistent(self):
        for changes in ({'command_id': 'other'}, {'revision': 2}, {'revision': True}, {'delivery': 'reconciling'}):
            with self.subTest(changes=changes):
                self.row, self.journal = fixture(); self.record(**changes)
                with self.assertRaises(ValueError): self.audit()

    def test_artifact_whitespace_and_digest_corruption_are_quarantined(self):
        for field in ('artifact', 'artifact_sha256'):
            with self.subTest(field=field):
                self.row, self.journal = fixture(); r=json.loads(self.row['record'])
                if field == 'artifact': r[field] = r[field].strip()
                else: r['result'][field] = 'sha256:'+'0'*64
                self.row['record'] = encoded(r)
                self.assertEqual(self.audit(), 'quarantined')

    def test_original_outcome_and_each_time_must_match(self):
        for field in ('owner_outcome', 'started_at', 'finished_at'):
            with self.subTest(field=field):
                self.row, self.journal = fixture(); r=json.loads(self.journal[4]); r[field] = 'changed'
                self.journal[4] = encoded(r)
                self.assertEqual(self.audit(), 'quarantined')

    def test_identity_and_external_reference_mismatch_quarantine(self):
        for index, value in ((1, '0'*64), (2, '{"external_id":"other"}')):
            with self.subTest(index=index):
                self.row, self.journal = fixture(); self.journal[index] = value
                self.assertEqual(self.audit(), 'quarantined')

    def test_started_remains_unknown_and_active(self):
        self.row['active'] = 1
        self.record(delivery='reconciling', result=None, artifact=None)
        self.journal[3:] = ['started', None]
        self.assertEqual(self.audit(), 'unknown_preserved')

    def test_explicit_unknown_remains_unknown(self):
        self.row['active'] = 1
        self.record(delivery='reconciling', result=None, artifact=None)
        self.journal[3:] = ['unknown', encoded(dict(owner_outcome='unknown', started_at=None, finished_at=None, artifact=None))]
        self.assertEqual(self.audit(), 'unknown_preserved')

    def test_completed_journal_with_older_accepted_control_is_quarantined(self):
        self.row['active'] = 1
        self.record(delivery='accepted', result=None, artifact=None)
        self.assertEqual(self.audit(), 'quarantined')

    def test_dispatching_snapshot_with_started_journal_is_quarantined(self):
        self.row['active'] = 1
        self.record(delivery='dispatching', result=None, artifact=None)
        self.journal[3:] = ['started', None]
        self.assertEqual(self.audit(), 'quarantined')

    def test_missing_journal_and_orphan_journal_are_quarantined(self):
        for rows, journals in (([self.row], []), ([], [self.journal])):
            output = a.audit_restore(rows, journals)
            self.assertEqual(output[0]['status'], 'quarantined')
            self.assertIs(output[0]['dispatch_allowed'], False)

    def test_duplicates_are_rejected(self):
        for rows, journals in (([self.row]*2, [self.journal]), ([self.row], [self.journal]*2)):
            with self.assertRaises(ValueError): a.audit_restore(rows, journals)

    def test_malformed_duplicate_keys_nonfinite_and_oversized_json_rejected(self):
        for raw in ('[]', '{"x":1,"x":2}', '{"x":NaN}', '{"x":1.0}', '{', ' '*131073):
            with self.subTest(raw=raw[:30]):
                self.row, self.journal = fixture(); self.row['record'] = raw
                with self.assertRaisesRegex(ValueError, '^invalid restore evidence$'): self.audit()

    def test_invalid_journal_shape_and_state_rejected(self):
        for journal in ([1], ['cmd-test','0'*64,'{}','unexpected',None]):
            with self.assertRaises(ValueError): a.audit_restore([self.row], [journal])

    def test_counts_bounded(self):
        with self.assertRaises(ValueError): a.audit_restore([self.row]*10001, [])

    def test_no_result_payload_is_returned(self):
        self.assertEqual(set(a.audit_restore([self.row], [self.journal])[0]), {'command_id','status','dispatch_allowed'})

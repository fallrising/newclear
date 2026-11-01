"""Independent synthetic adversarial review of replacement facts evidence."""
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
import fresh_replacement_ops as ops
import fresh_replacement as protocol
import fresh_observation
import pending_generation
from fresh_rebuild import plan_digest
import test_fresh_reimage_receipts as fixtures
import test_fresh_observation as baseline_fixtures


class ReplacementEvidenceReviewTests(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.FreshReceiptTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.project, self.run = self.f.project, self.f.run
        self.now = self.f.now + timedelta(hours=2)
        self.source = self.f.f.fixture.report['source']
        self.hosts = []
        for i, (row, receipt) in enumerate(zip(self.f.document['hosts'], self.f.receipts), 21):
            key = baseline_fixtures.key(i)
            digest = bytes.fromhex(fresh_observation.public_key(key))
            receipt['host_key_fingerprints']['ssh-ed25519'] = 'SHA256:' + base64.b64encode(digest).decode().rstrip('=')
            self.hosts.append({'alias': row['alias'], 'node': row['node'],
                               'ip': '192.0.2.' + str(i), 'public_key': key})
        self.f.save()
        assessment = self.f.inspect()
        self.assertEqual(assessment['status'], 'receipts-reviewed')
        self.request = {'schema_version': 1, 'run_id': self.run,
            'execution_sha256': self.f.execution['sha256'],
            'receipt_request': {'path': self.f.input_path,
                'sha256': hashlib.sha256((self.project / self.f.input_path).read_bytes()).hexdigest()},
            'receipt_assessment_sha256': assessment['sha256'], 'hosts': self.hosts}
        self.input_path = 'private/replacement-request.json'
        self.calls = []
        self.save()

    def save(self):
        self.input_sha = self.f.write(self.input_path, self.request)
        self.f.f.secure()

    def collect(self, observation_id='independent-facts', **kwargs):
        options = {'now': self.now, 'source_state': self.source, 'reader': self.reader}
        options.update(kwargs)
        return ops.collect_replacement_facts(self.project, self.run, self.f.execution['sha256'],
                                            self.input_path, self.input_sha, observation_id, **options)

    def reader(self, host, script, key):
        self.calls.append(host['alias'])
        index = [h['alias'] for h in self.hosts].index(host['alias'])
        self.assertEqual(key, self.hosts[index]['public_key'])
        identity = {**self.f.receipts[index]['replacement'], 'public_key': key}
        outputs = {'schema_version': 1, 'before': identity, 'after': copy.deepcopy(identity),
                   'architecture': 'x86_64', 'markers': {path: False for path in protocol.MARKERS}}
        return json.dumps(outputs).encode()

    def inspect(self, summary, **kwargs):
        options = {'now': self.now, 'source_state': self.source}
        options.update(kwargs)
        return ops.inspect_replacement_facts(self.project, summary['id'], summary['sha256'], **options)

    def observation_path(self, observation_id='independent-facts'):
        return self.project / ops.AREA / observation_id / 'observation.json'

    def test_success_with_matching_pending_remains_non_executable_and_offline_readonly(self):
        self.reserve()
        summary = self.collect()
        self.assertEqual(summary['status'], 'observed')
        self.assertEqual(len(self.calls), 4)
        before = self.f.snapshot()
        real_open = os.open
        def readonly_open(path, flags, *args, **kwargs):
            self.assertFalse(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC))
            return real_open(path, flags, *args, **kwargs)
        with patch.object(ops, 'SSHReader', side_effect=AssertionError('SSH')), \
                patch.object(os, 'mkdir', side_effect=AssertionError('mkdir')), \
                patch.object(os, 'open', side_effect=readonly_open):
            result = self.inspect(summary)
        self.assertEqual(result['status'], 'observed')
        self.assertEqual(before, self.f.snapshot())
        for flag in ('stage_accepted', 'executable', 'remote_mutation_performed', 'generation_changed'):
            self.assertIs(result[flag], False)
        self.assertNotIn(self.f.f.fixture.sentinel, json.dumps(result))
        self.assertNotIn('192.0.2.', json.dumps(result))

    def test_pending_created_after_first_capture_is_drift_even_when_exact_execution(self):
        original = self.reader
        def moving_pending(host, script, key):
            raw = original(host, script, key)
            if len(self.calls) == 1:
                self.reserve()
            return raw
        self.assert_blocked(lambda: self.collect(reader=moving_pending))
        self.assertEqual(len(self.calls), 1)

    def test_offline_rehash_cannot_change_endpoint_script_identity_or_marker(self):
        summary = self.collect()
        self.assertEqual(summary['status'], 'observed')
        path = self.observation_path()
        original = json.loads(path.read_text())
        changes = [lambda d: d['captures'][-1].update(ip='192.0.2.99'),
                   lambda d: d['captures'][-1].update(script_sha256='f' * 64),
                   lambda d: d['captures'][-1]['outputs']['before'].update(machine_id='forged'),
                   lambda d: d['captures'][-1]['outputs']['after'].update(boot_id='11111111-1111-1111-1111-111111111111'),
                   lambda d: d['captures'][-1]['outputs']['markers'].update({protocol.MARKERS[0]: True}),
                   lambda d: d.update(receipt_assessment_sha256='e' * 64),
                   lambda d: d.update(private_identity=[0, 0]),
                   lambda d: d['input'].update(path='private/../private/replacement-request.json')]
        for change in changes:
            forged = copy.deepcopy(original)
            change(forged['observation'])
            forged['sha256'] = plan_digest(forged['observation'])
            path.write_text(json.dumps(forged))
            self.assertEqual(self.inspect({**summary, 'sha256': forged['sha256']})['status'], 'blocked')
        self.assertEqual(len(self.calls), 4)

    def test_late_publish_failure_cannot_be_inspected_or_reused(self):
        publish = ops._publish
        def fail_after_link(*args, **kwargs):
            publish(*args, **kwargs)
            raise OSError('synthetic late fsync failure')
        with patch.object(ops, '_publish', side_effect=fail_after_link):
            self.assert_blocked(self.collect)
        path = self.observation_path()
        self.assertTrue(path.exists())
        envelope = json.loads(path.read_text())
        self.assertEqual(self.inspect({'id': 'independent-facts', 'sha256': envelope['sha256']})['status'], 'blocked')
        self.assert_blocked(self.collect)
        self.assertEqual(len(self.calls), 4)


    def assert_blocked(self, operation):
        try:
            result = operation()
        except (ValueError, OSError):
            return
        self.assertEqual(result['status'], 'blocked')

    def test_last_host_oob_mismatch_and_duplicate_endpoint_prevent_every_transport(self):
        original = copy.deepcopy(self.request)
        changes = [lambda d: d['hosts'][-1].update(public_key=baseline_fixtures.key(99)),
                   lambda d: d['hosts'][-1].update(ip=d['hosts'][0]['ip']),
                   lambda d: d['hosts'][-1].update(ip='192.000.2.44'),
                   lambda d: d['hosts'][-1].update(node=d['hosts'][0]['node']),
                   lambda d: d.update(receipt_assessment_sha256='f' * 64)]
        for i, change in enumerate(changes):
            with self.subTest(case=i):
                self.request = copy.deepcopy(original)
                change(self.request)
                self.save()
                self.assert_blocked(lambda: self.collect('invalid-input-' + str(i)))
                self.assertEqual(self.calls, [])

    def test_collection_rechecks_facts_freshness_after_publication(self):
        current = [self.now]
        publish = ops._publish
        def slow_publish(*args, **kwargs):
            result = publish(*args, **kwargs)
            current[0] += timedelta(minutes=16)
            return result
        with patch.object(ops, '_time', side_effect=lambda ignored: current[0]), \
                patch.object(ops, '_publish', side_effect=slow_publish):
            self.assertEqual(self.collect()['status'], 'blocked')

    def test_offline_rechecks_facts_freshness_after_slow_context(self):
        summary = self.collect()
        self.assertEqual(summary['status'], 'observed')
        current = [self.now]
        context = ops._context
        def slow_context(*args, **kwargs):
            result = context(*args, **kwargs)
            current[0] += timedelta(minutes=16)
            return result
        with patch.object(ops, '_time', side_effect=lambda ignored: current[0]), \
                patch.object(ops, '_context', side_effect=slow_context):
            self.assertEqual(self.inspect(summary)['status'], 'blocked')

    def test_observation_directory_replacement_during_capture_blocks(self):
        original = self.reader
        def swapping_directory(host, script, key):
            raw = original(host, script, key)
            if len(self.calls) == 1:
                directory = self.observation_path().parent
                directory.rename(directory.with_name('moved-claim'))
                directory.mkdir(mode=0o700)
            return raw
        self.assertEqual(self.collect(reader=swapping_directory)['status'], 'blocked')
        self.assertEqual(len(self.calls), 1)
        self.assertFalse(self.observation_path().exists())

    def test_raw_request_pin_and_receipt_bytes_checked_before_transport(self):
        path = self.project / self.input_path
        original = path.read_bytes()
        path.write_bytes(original + b' ')
        self.assert_blocked(self.collect)
        path.write_bytes(original)
        receipt = self.project / self.f.document['hosts'][-1]['receipt']['path']
        receipt.write_bytes(receipt.read_bytes() + b' ')
        self.assert_blocked(self.collect)
        self.assertEqual(self.calls, [])

    def reserve(self):
        record = self.f.execution['execution']
        binding = {k: record['binding'][k] for k in ('cluster_id', 'run_id',
            'generation_before', 'target_generation', 'review_sha256', 'scope_sha256')}
        binding.update(execution_sha256=self.f.execution['sha256'],
            cluster_sha256=record['cluster_sha256'],
            fence_sha256=record['evidence']['writer_fence']['sha256'])
        pending_generation.reserve(self.project, binding)

    def test_foreign_pending_prevents_transport(self):
        self.reserve()
        reservation = self.project / 'private/pending-generation/reservation.json'
        data = json.loads(reservation.read_text())
        data['bindings']['execution_sha256'] = 'e' * 64
        reservation.write_text(json.dumps(data))
        self.assert_blocked(self.collect)
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()

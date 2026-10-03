import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from labops import atomic_json
from soak_evidence import HOSTS, collect
from soak_remote import config_hash, copy_prefix
from soak_report import io_window, report
from soak_runner import Summary
from test_soak import control

RUN = '20260923T000000Z-1234abcd'


def make_sample(role, offset, workload='canary'):
    sample = control(100 + offset) if role == 'control' else {'ok': True, 'http_status': 200, 'workload_id': workload,
        'commands': {'services': control()['commands']['services'], 'tasks': {'exit_code': 0, 'stdout': workload + '\n'}}}
    sample.update(time=1000 + offset, monotonic=5000 + offset, seconds=.1,
        stat=f'cpu 100 0 30 {1000 + offset * 8} {5 + offset} 0 0 {3 + offset} 10 0\n',
        diskstats=f'252 0 vda {100 + offset} 0 0 {200 + offset * 2} {100 + offset} 0 0 {200 + offset * 4} 0 {300 + offset} {300 + offset * 2}\n',
        **{'pressure/io': f'some avg10=0 avg60=0 avg300=0 total={100 + offset * 1000}\nfull avg10=0 avg60=0 avg300=0 total={100 + offset * 500}\n'})
    return sample


def fixture(directory, offsets=(0, 15, 30), state='complete', mutate=None):
    manifest = {'id': RUN, 'start_epoch': 1000, 'deadline_epoch': 1030, 'hosts': {},
                'source_sha256': {'soak_runner.py': 'a' * 64, 'control_probe.py': 'b' * 64}}
    record = {'id': '20260923T010000Z-abcd1234', 'run_id': RUN, 'state': 'complete', 'hosts': {}}
    for alias in HOSTS:
        role = 'control' if alias == HOSTS[0] else 'http'
        cfg = {'run_id': RUN, 'role': role, 'start_epoch': 1000, 'deadline_epoch': 1030,
               'interval': 15, 'workload': {'id': 'canary'}}
        manifest['hosts'][alias] = {'config': cfg, 'config_sha256': config_hash(cfg)}
        summary = Summary(role)
        rows = [make_sample(role, offset) for offset in offsets]
        if mutate:
            mutate(alias, rows)
        for sample in rows:
            summary.add(sample)
        data = ''.join(json.dumps(row) + '\n' for row in rows).encode()
        (directory / (alias + '.samples.jsonl')).write_bytes(data)
        status = {'run_id': RUN, 'role': role, 'config_sha256': config_hash(cfg), 'start_epoch': 1000,
            'deadline_epoch': 1030, 'state': state, 'bytes': len(data), 'samples': len(rows),
            'last_sample_epoch': rows[-1]['time'], 'boot_id': 'boot1', 'summary': summary.report()}
        record['hosts'][alias] = {'state': 'complete', 'snapshot': {'status': status,
            'evidence': {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()},
            'source_sha256': manifest['source_sha256'], 'current_boot_id': 'boot1',
            'observed_at_epoch': rows[-1]['time'] + 1, 'systemd': {'SubState': 'running' if state == 'running' else 'exited'}}}
    atomic_json(directory / 'manifest.json', manifest)
    atomic_json(directory / 'collection.json', record)
    return manifest, record


class EvidenceTests(unittest.TestCase):
    def test_prefix_ignores_growing_uncommitted_tail(self):
        output = io.BytesIO()
        checksum = copy_prefix(io.BytesIO(b'committed\npartial-next'), 10, output)
        self.assertEqual(output.getvalue(), b'committed\n')
        self.assertEqual(checksum, hashlib.sha256(output.getvalue()).hexdigest())

    def test_prefix_short_read_and_excessive_budget_rejected(self):
        with self.assertRaisesRegex(ValueError, 'shorter'):
            copy_prefix(io.BytesIO(b'abc'), 4)
        with self.assertRaisesRegex(ValueError, 'byte count'):
            copy_prefix(io.BytesIO(), 193 * 1024 * 1024)

    def test_finished_collection_is_reviewable_not_automatic_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fixture(root)
            with patch('subprocess.run', side_effect=AssertionError('offline report must not invoke SSH')):
                result = report(root)
            self.assertEqual(result['assessment'], 'complete_needs_review')
            self.assertEqual(result['common_coverage_seconds'], 30)
            self.assertTrue(all(r['samples'] == 3 for r in result['hosts'].values()))

    def test_running_prefix_never_becomes_completed_acceptance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fixture(root, (0, 15), 'running')
            result = report(root)
            self.assertEqual(result['assessment'], 'in_progress')
            self.assertEqual(result['common_coverage_seconds'], 15)

    def test_complete_status_cannot_hide_short_duration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fixture(root, (0, 15))
            self.assertEqual(report(root)['assessment'], 'invalid_evidence')

    def test_missing_host_cannot_reuse_older_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fixture(root)
            (root / (HOSTS[2] + '.samples.jsonl')).unlink()
            self.assertEqual(report(root)['assessment'], 'invalid_evidence')

    def test_truncated_or_modified_evidence_rejected(self):
        for mode in ('truncated', 'checksum', 'count', 'source'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); _, record = fixture(root)
                path = root / (HOSTS[0] + '.samples.jsonl')
                if mode == 'truncated':
                    path.write_bytes(path.read_bytes()[:-1])
                elif mode == 'checksum':
                    path.write_bytes(path.read_bytes().replace(b'cpu 100', b'cpu 101'))
                elif mode == 'count':
                    record['hosts'][HOSTS[0]]['snapshot']['status']['samples'] = 2
                else:
                    record['hosts'][HOSTS[0]]['snapshot']['source_sha256'] = {}
                atomic_json(root / 'collection.json', record)
                self.assertEqual(report(root)['assessment'], 'invalid_evidence')

    def test_raw_http_failure_survives_later_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def mutate(alias, rows):
                if alias == HOSTS[1]: rows[0]['ok'] = False
            fixture(root, mutate=mutate)
            result = report(root)
            self.assertEqual(result['assessment'], 'observed_failures')
            self.assertEqual(result['hosts'][HOSTS[1]]['summary']['failures']['http_failed'], 1)

    def test_missing_middle_sample_and_reordered_time_rejected(self):
        for mode in ('gap', 'reorder'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                def mutate(alias, rows):
                    if alias == HOSTS[1]:
                        if mode == 'gap': del rows[1]
                        else: rows[0], rows[1] = rows[1], rows[0]
                fixture(root, mutate=mutate)
                self.assertEqual(report(root)['assessment'], 'invalid_evidence')

    def test_runtime_restart_is_detected_from_raw_services(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def mutate(alias, rows):
                rows[1]['commands']['services']['stdout'] = rows[1]['commands']['services']['stdout'].replace('old', 'new')
            fixture(root, mutate=mutate)
            self.assertEqual(report(root)['assessment'], 'observed_failures')

    def test_reboot_or_stale_running_capture_is_incomplete(self):
        for mode in ('reboot', 'stale'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); _, record = fixture(root, (0, 15), 'running')
                info = record['hosts'][HOSTS[0]]['snapshot']
                if mode == 'reboot': info['current_boot_id'] = 'boot2'
                else: info['observed_at_epoch'] = 1200
                atomic_json(root / 'collection.json', record)
                self.assertEqual(report(root)['assessment'], 'incomplete')

    def test_guest_metrics_use_deltas_and_do_not_double_count_guest_cpu(self):
        window = io_window(make_sample('control', 0), make_sample('control', 15))
        self.assertEqual(window['issues'], [])
        self.assertAlmostEqual(window['iowait_percent'], 10)
        self.assertAlmostEqual(window['steal_percent'], 10)
        self.assertAlmostEqual(window['io_pressure_some_percent'], .1)
        self.assertAlmostEqual(window['devices']['vda']['read_write_mean_ms'], 3)

    def test_counter_reset_is_unknown_not_zero_wait(self):
        a, b = make_sample('control', 15), make_sample('control', 0)
        b.update(monotonic=a['monotonic'] + 15, time=a['time'] + 15)
        window = io_window(a, b)
        self.assertNotIn('iowait_percent', window)
        self.assertNotIn('io_pressure_some_percent', window)
        self.assertFalse(window['devices'])
        self.assertTrue(window['issues'])

    def test_slow_etcd_sample_includes_same_window_guest_metrics(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def mutate(alias, rows):
                if alias == HOSTS[0]: rows[1]['commands']['journal']['stdout'] = 'slow fdatasync'
            fixture(root, mutate=mutate)
            event = report(root)['hosts'][HOSTS[0]]['events'][0]
            self.assertEqual(event['warnings_by_sample']['slow_fdatasync'], 1)
            self.assertEqual(event['guest_interval']['seconds'], 15)
            self.assertIn('steal_percent', event['guest_interval'])

    def test_failed_transfer_keeps_partial_and_reports_incomplete_collection(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp); root = project / 'private/soak' / RUN
            root.mkdir(parents=True)
            manifest, record = fixture(root)
            (project / 'scripts').mkdir()
            (project / 'scripts/soak_remote.py').write_text('# fixture')
            class Fake:
                def __init__(self): self.project = project
                def command(self, alias, argv, stdin):
                    self_test.assertEqual(argv, ['sudo', '-n', 'python3', '-'])
                    return json.dumps(record['hosts'][alias]['snapshot'])
            self_test = self
            def fail(op, alias, request, path):
                path.write_bytes(b'partial')
                raise RuntimeError('SSH interrupted')
            with patch('soak_evidence.transfer', fail):
                directory = collect(Fake(), RUN)
            self.assertEqual(json.loads((directory / 'collection.json').read_text())['state'], 'partial')
            self.assertEqual(len(list(directory.glob('*.partial'))), 3)
            self.assertEqual(report(directory)['assessment'], 'invalid_evidence')


if __name__ == '__main__':
    unittest.main()

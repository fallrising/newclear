import copy
import hashlib
import hmac
import importlib.util
import json
import sqlite3
import os
from pathlib import Path
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
from unittest.mock import patch
from types import SimpleNamespace

MODULE = Path(__file__).resolve().parents[1] / 'adapters/node-health/runner.py'
spec = importlib.util.spec_from_file_location('cloudlab_runner', MODULE)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

NOW = 1793023200

def config(path, **extra):
    value = dict(base_url='https://lab.example', audience='cloud-lab',
        credential_id='runner-1', generation=1, secret_hex='ab' * 32,
        journal_path=str(path), workspace_id='lab',
        resource_ref={'resource_id': 'node-1', 'generation': 1},
        recipe_ref={'recipe_id': 'node-health', 'version': '1.0.0', 'digest': 'sha256:' + 'c' * 64})
    value.update(extra)
    return r.Config.from_dict(value)


def assignment(cfg, mode='dispatch', fence=1):
    return dict(command_id='cmd-1', command=dict(schema_version='cloudlab.command.v1', schema_minor=0,
        workspace_id=cfg.workspace_id, resource_ref=cfg.resource_ref, recipe_ref=cfg.recipe_ref,
        parameters={'max_sample_age_seconds': 30}, idempotency_key='key-1',
        not_before=r.utc(NOW - 1), dispatch_deadline=r.utc(NOW + 30),
        execution_deadline=r.utc(NOW + 60), timeout_seconds=10, output_budget_bytes=16384),
        attempt=dict(attempt_id='attempt-1', fence=fence, mode=mode, lease_expires_at=r.utc(NOW + 15)),
        external_ref=dict(owner='python-node-health', adapter_id='node-health', external_id='cmd-1'))


class FakeClient:
    def __init__(self, value, fail=False):
        self.value = value
        self.fail = fail
        self.calls = []

    def post(self, path, body):
        self.calls.append((path, body))
        if path.endswith('/claim'):
            return {'assignment': self.value, 'request_id': 'req-1'}
        if self.fail:
            raise OSError('offline')
        return {'command': {'command_id': self.value['command_id']}, 'request_id': 'req-2'}


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cfg = config(Path(self.tmp.name) / 'journal.sqlite')
        self.journal = r.Journal(self.cfg.journal_path)
        self.addCleanup(self.journal.close)
        self.collects = 0

    def collector(self):
        self.collects += 1
        return {'status': 'healthy', 'sample_age_seconds': 0, 'checks': {'collector': 'ok'},
                'metrics': {'load_1m_milli': 1250, 'cpu_count': 2, 'disk_free_percent': 40}}

    def run_assignment(self, value, fail=False):
        client = FakeClient(value, fail)
        runner = r.Runner(self.cfg, self.journal, client=client, collector=self.collector, clock=lambda: NOW)
        runner.run_once()
        return client

    def test_completion_persisted_before_failed_report_and_exact_retry(self):
        a = assignment(self.cfg)
        client = FakeClient(a, True)
        with self.assertRaises(OSError):
            r.Runner(self.cfg, self.journal, client, self.collector, lambda: NOW).run_once()
        first = client.calls[-1][1]
        self.journal.close()
        self.journal = r.Journal(self.cfg.journal_path)
        self.addCleanup(self.journal.close)
        client = self.run_assignment(a)
        self.assertEqual(first, client.calls[-1][1])
        self.assertEqual(self.collects, 1)
        self.assertEqual(len(client.calls), 2)

    def test_started_commit_visible_to_another_connection_before_collector(self):
        def observe():
            with sqlite3.connect(self.cfg.journal_path) as db:
                state = db.execute('SELECT state FROM executions WHERE command_id=?', ('cmd-1',)).fetchone()[0]
            self.assertEqual(state, 'started')
            return self.collector()
        client = FakeClient(assignment(self.cfg))
        r.Runner(self.cfg, self.journal, client, observe, lambda: NOW).run_once()
        self.assertEqual(self.collects, 1)

    def test_idle_cycle_claims_once_and_never_reports(self):
        client = self.run_assignment(None)
        self.assertEqual([path for path, body in client.calls], ['/api/runner/claim'])
        self.assertEqual(self.collects, 0)

    def test_expired_reconcile_still_reuses_completed_evidence(self):
        self.run_assignment(assignment(self.cfg))
        a = assignment(self.cfg, 'reconcile_only', 2)
        a['command']['dispatch_deadline'] = r.utc(NOW - 1)
        # Immutable deadlines cannot change; seed completion with those original deadlines.
        self.journal.close()
        self.cfg = config(Path(self.tmp.name) / 'other.sqlite')
        self.journal = r.Journal(self.cfg.journal_path)
        self.addCleanup(self.journal.close)
        self.journal.start(a)
        self.journal.complete(a, dict(owner_outcome='succeeded', started_at=r.utc(NOW - 2),
            finished_at=r.utc(NOW - 1), artifact=r.validate_artifact(self.collector())))
        client = self.run_assignment(a)
        self.assertEqual(r.strict_json(client.calls[-1][1])['owner_outcome'], 'succeeded')

    def test_started_restart_never_recollects(self):
        a = assignment(self.cfg)
        self.journal.start(a)
        client = self.run_assignment(a)
        report = r.strict_json(client.calls[-1][1])
        self.assertEqual(report['owner_outcome'], 'unknown')
        self.assertIsNone(report['artifact'])
        self.assertEqual(self.collects, 0)

    def test_reconcile_missing_never_collects_even_later_dispatch(self):
        self.run_assignment(assignment(self.cfg, 'reconcile_only'))
        self.run_assignment(assignment(self.cfg))
        self.assertEqual(self.collects, 0)

    def test_reconcile_completed_reuses_result_with_new_fence(self):
        first = self.run_assignment(assignment(self.cfg))
        second = self.run_assignment(assignment(self.cfg, 'reconcile_only', 2))
        a, b = [r.strict_json(c.calls[-1][1]) for c in (first, second)]
        self.assertEqual(a['artifact'], b['artifact'])
        self.assertEqual(b['fence'], 2)
        self.assertEqual(self.collects, 1)

    def test_mutated_command_or_external_reference_refused(self):
        self.run_assignment(assignment(self.cfg))
        for key in ('command', 'external_ref'):
            a = assignment(self.cfg)
            if key == 'command':
                a[key]['idempotency_key'] = 'other'
            else:
                a[key]['external_id'] = 'other'
            with self.subTest(key=key), self.assertRaises(r.ProtocolError):
                self.run_assignment(a)
        self.assertEqual(self.collects, 1)

    def test_untrusted_assignment_rejected_before_journal_or_collection(self):
        mutations = [lambda a: a['command'].update(shell='touch /tmp/no'),
            lambda a: a['command']['resource_ref'].update(resource_id='other'),
            lambda a: a['command']['recipe_ref'].update(digest='sha256:' + 'd' * 64),
            lambda a: a['command'].update(timeout_seconds=True),
            lambda a: a['attempt'].update(fence=True),
            lambda a: a['attempt'].update(lease_expires_at=r.utc(NOW)),
            lambda a: a['attempt'].update(mode='execute'),
            lambda a: a['command']['parameters'].update(max_sample_age_seconds=30.0),
            lambda a: a['command'].update(schema_minor=True)]
        for mutation in mutations:
            a = copy.deepcopy(assignment(self.cfg))
            mutation(a)
            with self.subTest(a=a), self.assertRaises(r.ProtocolError):
                self.run_assignment(a)
        self.assertEqual(self.collects, 0)

    def test_sample_age_accepts_integer_range(self):
        for value in (1, 60):
            a = copy.deepcopy(assignment(self.cfg))
            a['command']['parameters']['max_sample_age_seconds'] = value
            self.assertTrue(r.validate_assignment(a, self.cfg, NOW))
        for value in (0, 61, True, 1.0):
            a = copy.deepcopy(assignment(self.cfg))
            a['command']['parameters']['max_sample_age_seconds'] = value
            with self.assertRaises(r.ProtocolError):
                r.validate_assignment(a, self.cfg, NOW)

    def test_insufficient_execution_window_does_not_collect(self):
        a = assignment(self.cfg)
        a['command']['dispatch_deadline'] = r.utc(NOW + 1)
        a['command']['execution_deadline'] = r.utc(NOW + 9)
        client = self.run_assignment(a)
        self.assertEqual(self.collects, 0)
        self.assertEqual(r.strict_json(client.calls[-1][1])['owner_outcome'], 'unknown')

    def test_finish_after_execution_deadline_is_unknown(self):
        a = assignment(self.cfg)
        a['command']['dispatch_deadline'] = r.utc(NOW + 1)
        a['command']['execution_deadline'] = r.utc(NOW + 10)
        clock = iter([NOW, NOW, NOW + 11])
        client = FakeClient(a)
        r.Runner(self.cfg, self.journal, client, self.collector, lambda: next(clock)).run_once()
        self.assertEqual(r.strict_json(client.calls[-1][1])['owner_outcome'], 'unknown')

    def test_journal_commit_consumes_execution_window_without_collection(self):
        a = assignment(self.cfg)
        a['command']['dispatch_deadline'] = r.utc(NOW + 10)
        a['command']['execution_deadline'] = r.utc(NOW + 11)
        clock = iter([NOW, NOW + 2])
        client = FakeClient(a)
        r.Runner(self.cfg, self.journal, client, self.collector, lambda: next(clock)).run_once()
        self.assertEqual(self.collects, 0)
        self.assertEqual(r.strict_json(client.calls[-1][1])['owner_outcome'], 'unknown')

    def test_backwards_finish_clock_is_unknown(self):
        client = FakeClient(assignment(self.cfg))
        clock = iter([NOW, NOW, NOW - 1])
        r.Runner(self.cfg, self.journal, client, self.collector, lambda: next(clock)).run_once()
        self.assertEqual(r.strict_json(client.calls[-1][1])['owner_outcome'], 'unknown')

    def test_observed_unhealthy_is_successful_execution(self):
        def unhealthy():
            value = self.collector()
            value['metrics']['disk_free_percent'] = 9
            value['status'] = 'unhealthy'
            return value
        client = FakeClient(assignment(self.cfg))
        r.Runner(self.cfg, self.journal, client, unhealthy, lambda: NOW).run_once()
        report = r.strict_json(client.calls[-1][1])
        self.assertEqual(report['owner_outcome'], 'succeeded')
        self.assertEqual(r.strict_json(report['artifact'].encode())['status'], 'unhealthy')

    def test_real_os_collector_failure_is_unknown(self):
        client = FakeClient(assignment(self.cfg))
        with patch.object(r.os, 'getloadavg', side_effect=OSError('private diagnostic')):
            r.Runner(self.cfg, self.journal, client, clock=lambda: NOW).run_once()
        self.assertEqual(r.strict_json(client.calls[-1][1])['owner_outcome'], 'unknown')

    def test_expired_dispatch_is_unknown(self):
        a = assignment(self.cfg)
        a['command']['dispatch_deadline'] = r.utc(NOW - 1)
        self.run_assignment(a)
        self.assertEqual(self.collects, 0)

    def test_root_refused(self):
        with patch.object(r.os, 'geteuid', return_value=0), self.assertRaises(r.ProtocolError):
            r.Runner(self.cfg, self.journal)

    def test_collector_exception_is_durable_unknown(self):
        def explode():
            raise RuntimeError('failure with private content')
        client = FakeClient(assignment(self.cfg))
        r.Runner(self.cfg, self.journal, client, explode, lambda: NOW).run_once()
        report = r.strict_json(client.calls[-1][1])
        self.assertEqual(report['owner_outcome'], 'unknown')
        self.run_assignment(assignment(self.cfg))
        self.assertEqual(self.collects, 0)

    def test_strict_json(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":1.0}', b'"\xff"', b'[' * 1500, b' ' * 32769, b'"\\ud800"', b'{"\\udfff":1}'):
            with self.subTest(raw=raw[:30]), self.assertRaises(r.ProtocolError):
                r.strict_json(raw)

    def test_hmac_vector(self):
        body = b'{}'
        headers = r.signed_headers(self.cfg, '/api/runner/claim', body, NOW, '0' * 32)
        message = '\n'.join(['CLOUDLAB-M1', 'cloud-lab', 'runner-1', '1', 'POST', '/api/runner/claim',
            str(NOW), '0' * 32, hashlib.sha256(body).hexdigest()]).encode()
        self.assertEqual(headers['X-Lab-Signature'], hmac.new(bytes.fromhex('ab' * 32), message, hashlib.sha256).hexdigest())
        self.assertEqual(headers['X-Lab-Nonce'], '0' * 32)
        self.assertNotEqual(r.signed_headers(self.cfg, '/api/runner/claim', body)['X-Lab-Nonce'],
                            r.signed_headers(self.cfg, '/api/runner/claim', body)['X-Lab-Nonce'])

    def test_config_transport_and_secret_validation(self):
        raw = dict(base_url='http://127.0.0.1:8080', audience='lab', credential_id='runner', generation=1,
            secret_hex='ab' * 32, journal_path='journal', workspace_id='lab',
            resource_ref=self.cfg.resource_ref, recipe_ref=self.cfg.recipe_ref)
        with self.assertRaises(r.ProtocolError):
            r.Config.from_dict(raw)
        self.assertEqual(r.Config.from_dict(raw, allow_loopback_http=True).base_url, raw['base_url'])
        for url in ('http://example.com', 'https://user:password@example.com', 'https://example.com/?x=1',
                    'https://example.com/path', 'http://127.0.0.1.evil.example'):
            with self.subTest(url=url), self.assertRaises(r.ProtocolError):
                r.Config.from_dict(dict(raw, base_url=url), allow_loopback_http=True)
        with self.assertRaises(r.ProtocolError):
            r.Config.from_dict(dict(raw, base_url='https://example.com', secret_hex='ab'))
        self.assertNotIn('ab' * 32, repr(self.cfg))


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.reply_status = 200
        self.reply_body = b'{"assignment":null,"request_id":"req-1"}'
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers['Content-Length']))
                owner.requests.append((self.path, dict(self.headers), body))
                self.send_response(owner.reply_status)
                self.send_header('Content-Type', 'application/json')
                if owner.reply_status == 307:
                    self.send_header('Location', '/redirect-target')
                self.end_headers()
                self.wfile.write(owner.reply_body)
            def log_message(self, *args):
                pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.cfg = config('unused')
        self.cfg.base_url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.client = r.HttpClient(self.cfg)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_real_http_uses_exact_body_and_hmac_headers(self):
        response = self.client.post('/api/runner/claim', b'{}')
        self.assertIsNone(response['assignment'])
        path, headers, body = self.requests[0]
        expected = r.signed_headers(self.cfg, path, body, int(headers['X-Lab-Time']), headers['X-Lab-Nonce'])
        self.assertEqual(headers['X-Lab-Signature'], expected['X-Lab-Signature'])
        self.assertEqual(body, b'{}')

    def test_access_headers_separate_from_signed_payload(self):
        self.cfg = config('unused', cloudflare_access_client_id='synthetic-id.access',
                          cloudflare_access_client_secret='synthetic-access-secret')
        self.cfg.base_url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.client = r.HttpClient(self.cfg)
        self.client.post('/api/runner/claim', b'{}')
        path, headers, body = self.requests[0]
        self.assertEqual(headers['Cf-Access-Client-Id'], 'synthetic-id.access')
        self.assertEqual(headers['Cf-Access-Client-Secret'], 'synthetic-access-secret')
        self.assertEqual(body, b'{}')
        self.assertNotIn('synthetic-access-secret', repr(self.cfg))
        expected = r.signed_headers(self.cfg, path, body, int(headers['X-Lab-Time']), headers['X-Lab-Nonce'])
        self.assertEqual(headers['X-Lab-Signature'], expected['X-Lab-Signature'])

    def test_redirect_never_followed(self):
        self.reply_status = 307
        with self.assertRaises(r.ProtocolError):
            self.client.post('/api/runner/claim', b'{}')
        self.assertEqual(len(self.requests), 1)

    def test_oversize_or_duplicate_json_response_refused(self):
        for raw in (b'x' * 32769, b'{"assignment":null,"assignment":null,"request_id":"r"}'):
            self.reply_body = raw
            with self.assertRaises(r.ProtocolError):
                self.client.post('/api/runner/claim', b'{}')


class CollectorTests(unittest.TestCase):
    def collect(self, load=1.2349, cpus=2, free=10, blocks=100):
        with patch.object(r.os, 'getloadavg', return_value=(load, 0, 0)), \
             patch.object(r.os, 'cpu_count', return_value=cpus), \
             patch.object(r.os, 'statvfs', return_value=SimpleNamespace(f_bavail=free, f_blocks=blocks)) as stat:
            result = r.fixed_collector()
        stat.assert_called_once_with('/')
        return result

    def test_metrics_are_floored_and_thresholds_inclusive(self):
        value = self.collect()
        self.assertEqual(value['metrics'], {'load_1m_milli': 1234, 'cpu_count': 2, 'disk_free_percent': 10})
        self.assertEqual(value['status'], 'healthy')
        self.assertEqual(self.collect(load=4)['status'], 'healthy')
        self.assertEqual(self.collect(load=4.001)['status'], 'unhealthy')
        self.assertEqual(self.collect(free=9)['status'], 'unhealthy')
        self.assertEqual(self.collect(free=9)['checks'], {'collector': 'ok'})

    def test_missing_or_invalid_os_observations_raise(self):
        for kwargs in ({'load': float('nan')}, {'load': float('inf')}, {'load': -1},
                       {'cpus': None}, {'cpus': 0}, {'blocks': 0}, {'free': -1}, {'free': 101}):
            with self.subTest(kwargs=kwargs), self.assertRaises((r.ProtocolError, ValueError, TypeError)):
                self.collect(**kwargs)

    def test_metric_contract_rejects_inconsistent_status_and_nonintegers(self):
        value = self.collect()
        r.validate_artifact(value)
        for key, bad in (('load_1m_milli', 1.0), ('cpu_count', True), ('disk_free_percent', 101)):
            mutated = copy.deepcopy(value)
            mutated['metrics'][key] = bad
            with self.assertRaises(r.ProtocolError):
                r.validate_artifact(mutated)
        value['status'] = 'unhealthy'
        with self.assertRaises(r.ProtocolError):
            r.validate_artifact(value)

    def test_fixed_collector_real_smoke(self):
        artifact = r.fixed_collector()
        r.validate_artifact(artifact)
        self.assertIn(artifact['status'], ('healthy', 'unhealthy'))
        self.assertGreater(artifact['metrics']['cpu_count'], 0)

    def test_access_optional_fields_must_be_paired_and_header_safe(self):
        for extra in ({'cloudflare_access_client_id': 'only-id'},
                      {'cloudflare_access_client_secret': 'only-secret'},
                      {'cloudflare_access_client_id': 'id', 'cloudflare_access_client_secret': 'secret\r\ninjected'},
                      {'cloudflare_access_client_id': 'id', 'cloudflare_access_client_secret': ''},
                      {'unexpected': 'x'}):
            with self.subTest(extra=extra), self.assertRaises(r.ProtocolError):
                config('unused', **extra)


if __name__ == '__main__':
    unittest.main()

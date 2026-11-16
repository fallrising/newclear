"""Real loopback HTTP and CLI tests with synthetic saved runs; no provider calls."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import local_text_task as task
import office_console as console
import office_results as results
import result_redaction as redaction
import pi_retry
import test_pi_retry

SECRET_A = 'SYNTHSECRET_0123456789abcdef'
SECRET_B = 'SYNTHSECRET_fedcba9876543210'


def revision_run(root, name, before, after, status='completed'):
    run = root / name
    workspace = run / 'workspace'
    workspace.mkdir(parents=True)
    target = SECRET_A + '.py'
    data = task.request('fixture', 'synthetic test', {target: before}, target)
    task.prepare(workspace, data)
    raw = after.encode('utf8')
    (workspace / 'output.md').write_bytes(raw)
    (run / 'text-task.json').write_bytes(task.encoded(data))
    change = task.revision(data, raw)
    artifact = task.output(workspace)
    model = 'model-' + SECRET_A
    report = {'harness': 'office-opencode', 'model': model, 'version': SECRET_A,
              'task': 'local_revision', 'status': status, 'cleanup_errors': [],
              'model_inference_verified': True, 'source_snapshot_unchanged': True,
              'text_output': artifact,
              'text_task': {'source_snapshot_sha256': task.digest(task.encoded(data['files']))},
              'revision': {k: change[k] for k in ('target', 'before_sha256', 'after_sha256', 'changed')},
              'office_result': {'model': 'strata/' + model, 'status': 'completed',
                                'cleanup_completed': True, 'model_inference_verified': True,
                                'text_task_completed': True, 'artifact_sha256': artifact['sha256']}}
    (run / 'result.json').write_text(json.dumps(report))
    return run


def file_evidence(root):
    return {str(p.relative_to(root)): (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
            for p in root.rglob('*') if p.is_file() and not p.is_symlink()}


class RedactionHttpTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.lab = Path(self.temp.name).resolve()
        self.root = self.lab / 'runs'
        self.before = '安全 café 😀\r\n' + SECRET_A + '\r\n'
        self.after = '安全 café 😀\r\n' + SECRET_B + '\r\n'
        self.name = 'local-work-' + SECRET_A
        self.run = revision_run(self.root, self.name, self.before, self.after)
        revision_run(self.root, 'local-work-' + SECRET_B, self.before, self.after, 'failed')
        self.app = console.Console(self.lab)
        self.addCleanup(self.app.close)
        log = self.app.directory / 'finished.log'
        log.write_text(json.dumps({'artifacts': str(self.run)}) + '\n')
        self.app.jobs['synthetic-job'] = {'id': 'synthetic-job', 'provider': 'opencode',
            'phase': 'finished', 'exit_code': 0, 'run_id': None, 'log': log,
            'keep_open': False, 'process': SimpleNamespace(poll=lambda: 0)}
        self.server = console.serve(self.app)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.original = file_evidence(self.root)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def request(self, path='/api/state', value=None, authorized=True):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        headers = {'Origin': 'http://127.0.0.1:' + str(self.server.server_port),
                   'Content-Type': 'application/json'}
        if authorized:
            headers['Authorization'] = 'Bearer ' + self.app.token
        try:
            connection.request('GET' if value is None else 'POST', path,
                               None if value is None else json.dumps(value), headers)
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def assert_safe(self, raw):
        self.assertNotIn(SECRET_A.encode(), raw)
        self.assertNotIn(SECRET_B.encode(), raw)

    def test_real_http_jobs_catalog_hashes_diff_and_source_preservation(self):
        for _ in range(2):
            code, raw = self.request()
            self.assertEqual(code, 200)
            self.assert_safe(raw)
            data = json.loads(raw)
            job = data['jobs'][0]['result']
            row = next(r for r in data['results']['runs'] if r['ref'] == job['ref'])
            self.assertEqual(row['status'], 'completed')
            self.assertEqual(job['artifact'], row['artifact'])
            self.assertEqual(len({r['ref'] for r in data['results']['runs']}), 2)
            self.assertEqual(len({r['id'] for r in data['results']['runs']}), 1)
            self.assertEqual({r['status'] for r in data['results']['runs']}, {'completed', 'failed'})
            artifact = row['artifact']
            self.assertTrue(artifact['changed'])
            self.assertFalse(artifact['display_changed'])
            self.assertEqual(artifact['diff'], '')
            self.assertEqual(artifact['sha256'], task.digest(self.after.encode()))
            self.assertEqual(artifact['before_sha256'], task.digest(self.before.encode()))
            self.assertEqual(artifact['display_sha256'], task.digest(artifact['text'].encode()))
            self.assertEqual(artifact['display_original_sha256'], task.digest(artifact['original'].encode()))
            self.assertEqual(artifact['text'], '安全 café 😀\r\nSYNTHSECRET_REDACTED\r\n')
        self.assertEqual(file_evidence(self.root), self.original)
        self.assertEqual(len(self.app.jobs), 1)

    def test_tampered_output_and_source_do_not_verify(self):
        output = self.run / 'workspace/output.md'
        original = output.read_bytes()
        output.write_bytes(original + b'tampered')
        for tamper_source in (False, True):
            if tamper_source:
                output.write_bytes(original)
                (self.run / 'workspace/source' / (SECRET_A + '.py')).write_text('tampered')
            code, raw = self.request()
            self.assertEqual(code, 200)
            self.assert_safe(raw)
            row = json.loads(raw)['jobs'][0]['result']
            self.assertNotEqual(row['status'], 'completed')
            self.assertNotEqual(row['artifact']['status'], 'verified')

    def test_unsafe_directory_and_job_fallback_are_projected(self):
        link = self.root / ('pi-work-' + SECRET_A)
        link.symlink_to(self.run, target_is_directory=True)
        self.app.jobs['synthetic-job']['run_id'] = link.name
        self.app.jobs['synthetic-job']['log'].write_text(json.dumps({'artifacts': str(link)}))
        code, raw = self.request()
        self.assertEqual(code, 200)
        self.assert_safe(raw)
        self.assertEqual(next(r for r in json.loads(raw)['results']['runs']
                              if r.get('reason') == 'unsafe_run_directory')['status'], 'invalid')

    def test_retry_ref_is_private_lookup_and_cannot_bypass_eligibility(self):
        ref = redaction.make_ref(1, self.name)
        self.assertEqual(self.app.resolve_ref(ref), self.name)
        with patch.object(console.dispatch, 'retry_plan', return_value=(
                {'provider': 'pi', 'remote': False, 'retry_of': self.name,
                 'command': ['retry', self.name], 'attempt': 1}, None)) as planned:
            code, raw = self.request('/api/plan', {'retry_ref': ref})
            self.assertEqual(code, 200)
            self.assert_safe(raw)
            planned.assert_called_once_with(self.name, self.lab)
            key = json.loads(raw)['plan_id']
            self.assertEqual(self.app.plans[key]['selection'], {'retry_id': self.name})
        # With the real dispatcher this non-Pi/no-retry-receipt run is still rejected.
        with patch('office_console.subprocess.Popen') as spawn:
            self.assertEqual(self.request('/api/plan', {'retry_ref': ref})[0], 409)
            self.assertEqual(self.request('/api/plan', {'retry_ref': 'r1_' + '0' * 32})[0], 409)
            self.assertEqual(self.request('/api/plan', {'retry_ref': ref}, authorized=False)[0], 403)
            spawn.assert_not_called()
        with patch.object(redaction, 'make_ref', return_value=ref):
            with self.assertRaisesRegex(console.ConsoleError, 'ambiguous'):
                self.app.resolve_ref(ref)
        self.app.roots = [self.lab / 'foreign']
        with self.assertRaisesRegex(console.ConsoleError, 'unavailable'):
            self.app.resolve_ref(ref)

    def test_cli_ref_across_processes_and_offline_embedding(self):
        script = str(Path(results.__file__))
        def cli(*args):
            return subprocess.run([sys.executable, script, '--runs-root', str(self.root), *args],
                                  capture_output=True, timeout=10)
        listed = cli()
        self.assertEqual(listed.returncode, 0)
        self.assert_safe(listed.stdout)
        data = json.loads(listed.stdout)
        ref = redaction.make_ref(1, self.name)
        shown = cli('--show', ref)
        self.assertEqual(shown.returncode, 0)
        self.assertEqual(len(json.loads(shown.stdout)['runs']), 1)
        self.assert_safe(shown.stdout)
        for name in (data['runs'][0]['id'], '1:' + self.name):
            denied = cli('--show', name)
            self.assertEqual(denied.returncode, 1)
            self.assert_safe(denied.stderr)
        plain = revision_run(self.root, 'local-work-plain', 'old', 'new')
        self.assertEqual(cli('--show', '1:' + plain.name).returncode, 0)
        literal = revision_run(self.root, 'local-work-SYNTHSECRET_REDACTED', 'old', 'new')
        self.assertEqual(cli('--show', '1:' + literal.name).returncode, 1)
        self.assertEqual(cli('--show', redaction.make_ref(1, literal.name)).returncode, 0)
        self.original = file_evidence(self.root)
        html = self.lab / 'results.html'
        self.assertEqual(cli('--html', str(html)).returncode, 0)
        self.assert_safe(html.read_bytes())
        self.assertEqual(file_evidence(self.root), self.original)

    def test_valid_retry_ref_uses_real_dispatcher_and_preserves_ledger(self):
        builder = test_pi_retry.RetryTests()
        builder.lab = self.lab
        builder.fixture = {'marker': 'fixture', 'values': [7, 11, -2, 9]}
        # Only source fingerprint is substituted: this temporary lab has no installed CLI.
        # Receipt, ledger, result eligibility, HTTP and dispatcher are real implementations.
        with patch.object(pi_retry, 'fingerprint', return_value='a' * 64):
            run, _ = builder.attempt('pi-work-' + SECRET_A)
            before = file_evidence(self.root)
            ref = redaction.make_ref(1, run.name)
            code, raw = self.request('/api/plan', {'retry_ref': ref})
            self.assertEqual(code, 200)
            self.assert_safe(raw)
            self.assertEqual(json.loads(raw)['plan']['retry_of'], 'pi-work-SYNTHSECRET_REDACTED')
            self.assertEqual(file_evidence(self.root), before)
            code, raw = self.request()
            self.assert_safe(raw)
            row = next(r for r in json.loads(raw)['results']['runs'] if r['ref'] == ref)
            self.assertEqual(row['status'], 'failed')
            self.assertEqual(row['retry']['root_ref'], ref)
            self.assertIsNone(row['retry']['parent_ref'])
            (run / 'attempts.json').write_text(json.dumps({'schema': 1, 'runs': [run.name, 'pi-work-unknown']}))
            self.assertEqual(self.request('/api/plan', {'retry_ref': ref})[0], 409)


if __name__ == '__main__':
    unittest.main()

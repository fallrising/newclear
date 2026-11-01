"""Synthetic boundary tests; no original runtime execution or lab monkeypatch."""
import copy
import io
import json
import os
import signal
from pathlib import Path
import tempfile
import time
import unittest
from contextlib import ExitStack, redirect_stdout, contextmanager
from types import SimpleNamespace
from unittest.mock import Mock, patch

import retry


def row(job, name, terminal=False):
    exhausted = name == 'exhausted'
    entries = [dict(attempt=n, retry_limit=1, delay_ms=100, backoff='constant',
                    timeout_ms=5000, effect_acknowledged=1,
                    outcome_marker='throw' if n == 1 or exhausted else 'return') for n in (1, 2)]
    return dict(job=dict(id=job, case_name=name, completed=int(terminal and not exhausted)),
                job_count=1, entries=entries if terminal else [], entry_count=2 if terminal else 0,
                effect_count=(1 if name == 'idempotent' else 2) if terminal else 0)


def terminal(job, name):
    success = name != 'exhausted'
    return dict(status='complete' if success else 'errored', success=success,
                error=None if success else dict(name='Error', message='Workflow execution failed'),
                output=dict(jobId=job, caseName=name, attempt=2) if success else None,
                params=dict(jobId=job, caseName=name), step_count=1,
                steps=[dict(name='controlled-effect', type='step', success=success)])


class BudgetTests(unittest.TestCase):
    def test_deadline_and_get_limit_precede_io(self):
        transport = Mock()
        budget = retry.RequestBudget(time.monotonic() - 1)
        client = retry.BoundedHTTP(transport, budget)
        with self.assertRaises(Exception):
            client.request('GET', '/health')
        transport.request.assert_not_called()
        budget.deadline = time.monotonic() + 20
        budget.case_deadline = budget.deadline
        budget.get_requests = 256
        with self.assertRaises(Exception):
            client.request('GET', '/health')
        transport.request.assert_not_called()

    def test_failed_get_charged_and_deadline_forwarded(self):
        transport = Mock()
        transport.request.side_effect = OSError('private')
        budget = retry.RequestBudget(time.monotonic() + 20)
        budget.case_deadline = time.monotonic() + 10
        with self.assertRaises(OSError):
            retry.BoundedHTTP(transport, budget).request('GET', '/health')
        self.assertEqual(budget.get_requests, 1)
        self.assertLessEqual(transport.request.call_args.kwargs['deadline'], budget.case_deadline)


class IntegrationTests(unittest.TestCase):
    def run_case(self, failure=None, limits=None):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root = Path(tmp)
            scope_path, output = root / '.open-compute', root / 'evidence'
            events, owners = [], []
            state = dict(job=None, name=None, created=False, reads=0)
            def command(argv, timeout=30):
                events.append('cli')
                if '--version' in argv:
                    return 'ocd 0.2.4'
                if 'setup' in argv:
                    keys = scope_path / 'instances/lab/data/keys'
                    keys.mkdir(parents=True)
                    for name in ('deployer.token', 'read-only.token', 'master.key'):
                        p = keys / name
                        p.write_text('private-value-' + name)
                        p.chmod(0o600)
                    if failure == 'secret_fifo':
                        (keys / 'master.key').unlink()
                        os.mkfifo(keys / 'master.key', 0o600)
                    return ''
                return json.dumps(dict(instances=[dict(name='lab', state='running', instance_id='instance-1')]))
            class HTTP:
                def __init__(self, *args): pass
                def request(self, method, path, body=None, content_type='application/json', host=None, **kwargs):
                    events.append(method + ':' + path)
                    if path == '/health/live': return dict(ok=True)
                    if path == '/health': return dict(fixture='open-compute-m6', ok=True)
                    if path.startswith('/jobs/'):
                        if failure == 'case_two' and state['name'] == 'idempotent':
                            raise OSError('private path /secret')
                        value = row(state['job'], state['name'], state['created'])
                        if state['created']:
                            state['reads'] += 1
                            if failure == 'row_readback' and state['reads'] == 2:
                                value['effect_count'] += 1
                        return value
                    if path.startswith('/client/v4'):
                        return dict(success=True, result=self.v4(method, path[len('/client/v4'):], body))
                    raise AssertionError(path)
                def v4(self, method, path, body=None):
                    if path == '/accounts': return [dict(id='account-1')]
                    if path.endswith('/d1/database'): return dict(uuid='database-1')
                    if path.endswith('/query'):
                        if body['sql'].startswith('INSERT'):
                            state.update(job=body['params'][0], name=body['params'][1], created=False, reads=0)
                        return []
                    if path.endswith('/endpoints'):
                        return [dict(kind='local_origin', scope='local_machine', url='http://retry.localhost:8787')]
                    if path.endswith('/deployments'):
                        return dict(deployments=[dict(id='deployment-1', versions=[dict(version_id='version-1', percentage=100)])])
                    if '/versions/' in path:
                        return dict(id='version-1', resources=dict(script=dict(etag='c'*64), script_runtime=dict(compatibility_date='2026-09-08'), bindings=[
                            dict(type='d1', name='DB', database_id='wrong' if failure == 'binding' else 'database-1'),
                            dict(type='workflow', name='FLOW', workflow_name='retry-flow', class_name='RetryFlow')]))
                    if path.endswith('/instances'):
                        state['created'] = True
                        return dict(id='wrong' if failure == 'create_id' else body['instance_id'])
                    if '/instances/' in path:
                        if failure == 'daemon_dead': owners[0].process.poll.return_value = -9
                        value = terminal(state['job'], state['name'])
                        if failure == 'terminal_readback' and state['reads']:
                            value['output'] = None
                        return value
                    return {}
            def process(argv):
                item = Mock()
                item.identity = dict(pid=10, pgid=10, start_ticks=100)
                item.process.poll.return_value = -1 if failure == 'startup' else None
                item.observation_error = None
                item.live.return_value = [item.identity]
                item.reader.is_alive.return_value = False
                item.monitor.is_alive.return_value = False
                def stop():
                    events.append('stop')
                    prior = item.process.poll()
                    item.live.return_value = [item.identity] if failure == 'survivor' else []
                    item.process.poll.return_value = 0
                    if failure == 'observer': item.observation_error = 'private observer error'
                    if failure == 'drain': item.reader.is_alive.return_value = True
                    if failure == 'marker': (scope_path / retry.MARKER).write_text('f'*64)
                    return dict(was_running=prior is None, signal='SIGTERM', forced=failure == 'forced',
                                exit_code=0, all_owned_exited=failure not in ('observer', 'survivor'))
                item.stop.side_effect = stop
                owners.append(item)
                if failure == 'signal_transfer': signal.raise_signal(signal.SIGTERM)
                return item
            def poll(probe, predicate, timeout, phase):
                if phase == 'daemon bootstrap':
                    if failure == 'startup': probe()
                    return True
                value = probe()
                if not predicate(value): raise retry.LabError('schema')
                return value
            def download(*args):
                self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0), 'download helper owns its watchdog')
                return root/'ocd'
            patches = dict(preflight=lambda port: scope_path, source_commit=lambda: 'a'*40,
                           download_binary=download, sha256_file=lambda p: retry.PIN['artifact']['sha256'],
                           command=command, Process=process, LocalHTTP=HTTP, poll=poll,
                           scope_hint=lambda: scope_path, fixture_bytes=lambda: b'fixture')
            for name, value in patches.items(): stack.enter_context(patch('retry.'+name, value))
            if failure in ('write', 'slow_write'):
                original = retry.exclusive_file
                def write(path, contents, mode=0o600):
                    if path.name == 'report.json':
                        if failure == 'write': raise OSError('/private/evidence')
                        time.sleep(.08)
                    return original(path, contents, mode)
                stack.enter_context(patch('retry.exclusive_file', write))
            if failure == 'remove':
                stack.enter_context(patch.object(retry.OwnedScope, 'remove', side_effect=OSError('/private/remove')))
            if failure == 'slow_remove':
                original_remove = retry.OwnedScope.remove
                def remove(owner, processes_stopped):
                    time.sleep(.08)
                    original_remove(owner, processes_stopped)
                stack.enter_context(patch.object(retry.OwnedScope, 'remove', remove))
            if failure == 'slow_cleanup':
                original_stop = process
                def slow_process(argv):
                    item = original_stop(argv)
                    stop = item.stop.side_effect
                    def slow_stop():
                        time.sleep(.08)
                        return stop()
                    item.stop.side_effect = slow_stop
                    return item
                stack.enter_context(patch('retry.Process', slow_process))
            if failure == 'scenario_exit':
                original_deadline = retry.m3_deadline
                @contextmanager
                def deadline_exit(seconds, phase):
                    with original_deadline(seconds, phase) as deadline:
                        yield deadline
                    if phase == 'scenario': raise retry.LabError('deadline')
                stack.enter_context(patch('retry.m3_deadline', deadline_exit))
            if failure == 'projection':
                original_project = retry.project_retries
                def project(value, *, complete=False):
                    if complete: value['get_requests'] = True
                    return original_project(value, complete=complete)
                stack.enter_context(patch('retry.project_retries', project))
            if limits:
                old = retry.m3_deadline
                stack.enter_context(patch('retry.m3_deadline', lambda seconds, phase: old(limits.get(seconds, seconds), phase)))
            stream = io.StringIO()
            with redirect_stdout(stream):
                code = retry.integration(SimpleNamespace(port=8787, cache=str(root/'cache'), output=str(output)))
            report = json.loads(stream.getvalue())
            evidence = json.loads((output/'report.json').read_text()) if (output/'report.json').exists() else None
            return code, report, events, scope_path.exists(), evidence

    def test_complete_three_cases_and_exclusive_sanitized_report(self):
        code, report, events, exists, evidence = self.run_case()
        self.assertEqual(code, 0, report)
        self.assertFalse(exists)
        self.assertEqual(report, evidence)
        self.assertEqual([v['name'] for v in report['retries']['cases']], ['unguarded', 'idempotent', 'exhausted'])
        self.assertTrue(all(v == 'passed' for v in report['acceptance'].values()))

    def test_mismatches_fail_and_keep_only_completed_prefix(self):
        for failure in ('create_id', 'row_readback', 'terminal_readback', 'binding', 'case_two'):
            with self.subTest(failure=failure):
                code, report, events, exists, evidence = self.run_case(failure)
                self.assertEqual(code, 1)
                self.assertFalse(exists)
                self.assertEqual(len(report['retries']['cases']), int(failure == 'case_two'))
                self.assertNotIn('/secret', json.dumps(report))
                self.assertNotEqual(report['acceptance']['M6-05'], 'passed')

    def test_lifecycle_failures_refuse_removal(self):
        for failure in ('startup', 'daemon_dead', 'observer', 'survivor', 'drain', 'marker', 'forced'):
            with self.subTest(failure=failure):
                code, report, events, exists, evidence = self.run_case(failure)
                self.assertEqual(code, 1)
                self.assertTrue(exists)
                self.assertIn('stop', events)
                self.assertNotEqual(report['acceptance']['M6-05'], 'passed')

    def test_secret_special_file_is_rejected_without_blocking(self):
        code, report, events, exists, evidence = self.run_case('secret_fifo')
        self.assertEqual(code, 1)
        self.assertFalse(exists)
        self.assertFalse(report['retries']['cases'])

    def test_cleanup_and_write_failure_revoke_success(self):
        for failure in ('remove', 'write'):
            with self.subTest(failure=failure):
                code, report, events, exists, evidence = self.run_case(failure)
                self.assertEqual(code, 1)
                self.assertNotEqual(report['acceptance']['M6-05'], 'passed')
                self.assertNotIn('/private', json.dumps(report))
                if failure == 'write': self.assertIsNone(evidence)

    def test_failed_shutdown_signal_rejects_arbitrary_strings(self):
        code, report, _, _, _ = self.run_case()
        self.assertEqual(code, 0)
        failed = copy.deepcopy(report)
        failed.update(result='failed', phase='cleanup')
        failed['acceptance']['M6-05'] = 'not_run'
        for signal_value in ('/private/raw-secret', 'SIGKILL', '', 'sigterm'):
            with self.subTest(signal=signal_value):
                failed['final_shutdown']['signal'] = signal_value
                with self.assertRaises(Exception): retry.project_report(failed)
        failed['final_shutdown'].update(signal='SIGTERM', forced=True, was_running=False,
                                        exit_code=-9, all_owned_exited=False)
        self.assertEqual(retry.project_report(failed)['final_shutdown'], failed['final_shutdown'])

    def test_unsupported_environment_preflight_is_bounded_failed_json(self):
        for field, raw in (('machine', 'riscv64'), ('system', '/private/unsupported-os'),
                           ('python_version', '/private/unsupported-version')):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
                root = Path(tmp)
                stack.enter_context(patch('retry.scope_hint', return_value=root/'.open-compute'))
                stack.enter_context(patch('retry.platform.' + field, return_value=raw))
                if field == 'python_version':
                    # Exercise the real helper refusal before pin/download work.
                    stack.enter_context(patch('retry.platform.machine', return_value='riscv64'))
                process = stack.enter_context(patch('retry.Process'))
                stream = io.StringIO()
                with redirect_stdout(stream):
                    code = retry.integration(SimpleNamespace(port=8787, cache=str(root/'cache'), output=str(root/'output')))
                self.assertEqual(code, 1)
                process.assert_not_called()
                report = json.loads(stream.getvalue())
                key = {'machine': 'architecture', 'system': 'os', 'python_version': 'python'}[field]
                self.assertEqual(report['environment'][key], 'unknown')
                self.assertNotIn(raw, stream.getvalue())
                self.assertFalse((root/'.open-compute').exists())
                self.assertEqual(report['error'], 'preflight')
                self.assertLess(len(stream.getvalue().encode()), 128*1024)

    def test_unsupported_environment_cannot_escape_final_projection_failure(self):
        # Reproduce T009's exact route: the integration double bypasses preflight,
        # so unknown metadata reaches the success gate and must revoke success.
        with patch('retry.platform.machine', return_value='riscv64'):
            code, report, _, exists, _ = self.run_case()
        self.assertEqual(code, 1)
        self.assertEqual(report['environment']['architecture'], 'unknown')
        self.assertFalse(exists)
        self.assertFalse(report['evidence_file_written'])
        self.assertNotEqual(report['acceptance']['M6-05'], 'passed')

    def test_success_requires_supported_observed_environment(self):
        code, report, _, _, _ = self.run_case()
        self.assertEqual(code, 0)
        for key, value in (('os', 'unknown'), ('os', 'Darwin'), ('architecture', 'unknown'),
                           ('architecture', 'aarch64'), ('euid', 0), ('python', 'unknown'),
                           ('python', '3.10.0')):
            with self.subTest(key=key, value=value):
                invalid = copy.deepcopy(report)
                invalid['environment'][key] = value
                with self.assertRaises(Exception): retry.project_report(invalid)

    def test_projection_failure_is_bounded_and_never_passes(self):
        code, report, _, exists, _ = self.run_case('projection')
        self.assertEqual(code, 1)
        self.assertFalse(exists)
        self.assertIs(type(report['retries']['get_requests']), int)
        self.assertNotEqual(report['acceptance']['M6-05'], 'passed')

    def test_scenario_exit_failure_revokes_passed_result(self):
        code, report, _, exists, _ = self.run_case('scenario_exit')
        self.assertEqual(code, 1)
        self.assertEqual(report['error'], 'deadline')
        self.assertFalse(exists)
        self.assertNotEqual(report['acceptance']['M6-05'], 'passed')

    def test_signal_at_process_transfer_still_cleans_known_owner(self):
        code, report, events, exists, _ = self.run_case('signal_transfer')
        self.assertEqual(code, 1)
        self.assertIn('stop', events)
        self.assertFalse(exists)
        self.assertFalse(report['retries']['cases'])

    def test_report_whitelist_and_strict_pin_types(self):
        code, report, _, _, _ = self.run_case()
        self.assertEqual(code, 0)
        for change in ('pin_bool', 'unknown', 'get_bool', 'identity_bool', 'nan'):
            with self.subTest(change=change):
                invalid = copy.deepcopy(report)
                if change == 'pin_bool': invalid['upstream']['schema_version'] = True
                if change == 'unknown': invalid['diagnostics'] = '/private/raw'
                if change == 'get_bool': invalid['retries']['get_requests'] = True
                if change == 'identity_bool': invalid['daemon']['pid'] = True
                if change == 'nan': invalid['daemon']['start_ticks'] = float('nan')
                with self.assertRaises(Exception): retry.project_report(invalid)

    def test_refused_output_is_never_used_for_diagnostics(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root/'existing'
            output.mkdir()
            sentinel = output/'sentinel'
            sentinel.write_text('unique')
            stream = io.StringIO()
            with patch('retry.scope_hint', return_value=root/'.open-compute'), \
                    patch('retry.preflight') as preflight, redirect_stdout(stream):
                code = retry.integration(SimpleNamespace(port=8787, cache=str(root/'cache'), output=str(output)))
            self.assertEqual(code, 1)
            preflight.assert_not_called()
            self.assertEqual(list(output.iterdir()), [sentinel])
            self.assertEqual(sentinel.read_text(), 'unique')
            self.assertFalse(json.loads(stream.getvalue())['evidence_file_written'])

    def test_separate_cleanup_removal_and_write_budgets(self):
        for failure, seconds in (('slow_cleanup', 150), ('slow_remove', 30), ('slow_write', 10)):
            with self.subTest(failure=failure):
                code, report, events, exists, evidence = self.run_case(failure, {seconds: .02})
                self.assertEqual(code, 1)
                self.assertNotEqual(report['acceptance']['M6-05'], 'passed')


if __name__ == '__main__':
    unittest.main()

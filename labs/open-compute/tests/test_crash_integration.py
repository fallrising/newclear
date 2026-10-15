"""M5 harness contracts with a synthetic runtime; no upstream certification."""
from contextlib import ExitStack, redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lab


class HTTPTests(unittest.TestCase):
    def test_writes_and_request_257_are_refused_before_connection(self):
        client = lab.CrashReadOnlyHTTP(8787)
        with patch('lab.LocalHTTP.request', return_value={}) as request:
            for method, body in [('POST', None), ('GET', {})]:
                with self.assertRaises(lab.LabError):
                    client.request(method, '/health', body)
            request.assert_not_called()
            for _ in range(256):
                client.request('GET', '/health')
            with self.assertRaises(lab.LabError):
                client.request('GET', '/health')
            self.assertEqual(request.call_count, 256)
            self.assertEqual(client.read_requests, 256)

    def test_only_completed_gets_are_counted_and_m2_is_unchanged(self):
        client = lab.CrashReadOnlyHTTP(8787)
        with patch('lab.LocalHTTP.request', side_effect=OSError('refused')):
            with self.assertRaises(OSError):
                client.request('GET', '/health')
            self.assertEqual(client.read_requests, 0)
            historical = lab.ReadOnlyHTTP(8787)
            with self.assertRaises(OSError):
                historical.request('GET', '/health')
            self.assertEqual(historical.read_requests, 1)

    def test_cli_routes_only_crash(self):
        with patch('sys.argv', ['lab.py', 'integration-crash']), patch('lab.integration', return_value=0) as run:
            self.assertEqual(lab.main(), 0)
        self.assertEqual(run.call_args.kwargs, dict(restore=False, resources=False, storage=False, crash=True))


class IntegrationTests(unittest.TestCase):
    def run_case(self, failure=None, limits=None):
        # The helper is supplied by the orchestrator, never edited by this worker.
        import crash
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root = Path(tmp)
            scope = root / '.open-compute'
            output = root / 'evidence'
            events, processes = [], []
            job = dict(id=None, payload='synthetic-m1', callback_count=0, step_nonce=None, completed=0)
            workflow = dict(id=None, approved=False)
            stage = ['setup']

            def command(argv, timeout=30):
                if '--version' in argv:
                    return 'ocd 0.2.4'
                if 'setup' in argv:
                    events.append('setup')
                    config = scope / 'instances/lab/compute.toml'
                    config.parent.mkdir(parents=True)
                    config.write_text('synthetic')
                    keys = config.parent / 'data/keys'
                    keys.mkdir(parents=True)
                    for name in ('deployer.token', 'read-only.token', 'master.key'):
                        path = keys / name
                        path.write_text('private-' + name)
                        path.chmod(0o600)
                    return ''
                return json.dumps({'instances': [{'name': 'lab', 'state': 'running', 'instance_id': 'changed' if failure == 'instance' and len(processes) == 2 else 'instance-1'}]})

            class HTTP:
                def __init__(self, *args):
                    self.read_requests = 0
                def request(self, method, path, body=None, content_type='application/json', host=None, *, deadline=None, expected_status=None):
                    events.append(stage[0] + ':' + method + ':' + path)
                    if path in ('/health', '/health/live'):
                        return {'fixture': 'open-compute-m1', 'ok': (1 if failure == 'health_numeric' else False) if failure in ('health', 'health_numeric') and stage[0] == 'readback' else True}
                    if path == '/jobs':
                        job['id'] = body['id']
                        value = dict(job)
                        if failure == 'submission_bool':
                            value['callback_count'] = False
                        return dict(job=value, row_count=True if failure == 'submission_count' else 1)
                    if path.startswith('/jobs/'):
                        value = dict(job, completed=int(workflow['approved']))
                        if stage[0] == 'checkpoint':
                            if failure in ('counter_bool', 'counter_zero', 'counter_two'):
                                value['callback_count'] = {'counter_bool': True, 'counter_zero': 0, 'counter_two': 2}[failure]
                            if failure == 'checkpoint_completed':
                                value['completed'] = True
                            if failure == 'checkpoint_id':
                                value['id'] = 'wrong'
                        if stage[0] == 'readback' and failure in ('row', 'nonce'):
                            value['payload' if failure == 'row' else 'step_nonce'] = 'changed'
                        if workflow['approved'] and failure == 'completion_bool':
                            value['completed'] = True
                        return dict(job=value, row_count=True if failure == 'row_count' and stage[0] == 'readback' else 1)
                    if path.startswith('/client/v4'):
                        return dict(success=True, result=HTTP.v4(self, method, path[len('/client/v4'):], body, content_type))
                    raise AssertionError(path)
                def v4(self, method, path, body=None, content_type='application/json'):
                    # Ordinary mock v4 goes through request accounting only for
                    # recovery; actual CrashReadOnlyHTTP uses inherited v4.
                    if path == '/accounts':
                        return [{'id': 'changed' if failure == 'account' and stage[0] == 'readback' else 'account-1'}]
                    if path.endswith('/d1/database'):
                        return {'uuid': 'database-1'}
                    if path.endswith('/endpoints'):
                        return [{'kind': 'local_origin', 'url': 'http://worker.local:8787'}]
                    if path.endswith('/deployments'):
                        return {'deployments': [{'id': 'deployment-1', 'versions': [{'version_id': 'version-1', 'percentage': 100}]}]}
                    if '/versions/' in path:
                        return {'id': 'version-1', 'resources': {'script': {'etag': 'c' * 64}, 'script_runtime': {'compatibility_date': '2026-09-08'}, 'bindings': [
                            {'type': 'd1', 'name': 'DB', 'database_id': 'changed' if failure == 'binding' and stage[0] == 'readback' else 'database-1'},
                            {'type': 'workflow', 'name': 'FLOW', 'workflow_name': lab.FLOW, 'class_name': 'LabFlow'}]}}
                    if path.endswith('/instances'):
                        workflow['id'] = body['instance_id']
                        job.update(callback_count=1, step_nonce='fixture-nonce')
                        stage[0] = 'checkpoint'
                        return {'id': workflow['id']}
                    if path.endswith('/events/approval'):
                        events.append('approval')
                        workflow['approved'] = True
                        return {'instanceId': workflow['id']}
                    if '/instances/' in path:
                        return {'status': 'waiting', 'steps': [{'name': 'instrumented-callback', 'success': True}]}
                    return {}

            def process(argv):
                n = len(processes) + 1
                events.append('spawn:' + str(n))
                item = Mock()
                item.identity = dict(pid=('/private/secret' if failure == 'numeric_identity' and n == 1 else 10 + n), start_ticks=100 + n, pgid=10 + n)
                item.process.pid = 10 + n
                item.process.poll.return_value = None
                item.observation_error = None
                item.text.return_value = ''
                item.children.return_value = [dict(pid=20 + n, start_ticks=200 + n)]
                item.live.return_value = [item.identity, dict(pid=20 + n, start_ticks=200 + n, pgid=20 + n)]
                def stop():
                    events.append('stop:' + str(n))
                    if failure == 'slow_cleanup' and n == 2:
                        time.sleep(.15)
                    item.live.return_value = []
                    item.process.poll.return_value = 0
                    if failure == 'unknown' and n == 2:
                        item.observation_error = lab.ProcessObservationError('unknown')
                    return dict(was_running=failure != 'not_running' or n != 2, signal='SIGKILL' if failure == 'wrong_final_signal' and n == 2 else 'SIGTERM', forced=failure == 'forced' and n == 2, all_owned_exited=not item.observation_error, exit_code=0)
                item.stop.side_effect = stop
                processes.append(item)
                return item

            def stimulus(owner, *, deadline, read_identity):
                events.append('crash')
                self.assertGreater(deadline, time.monotonic())
                self.assertIs(read_identity, lab.process_info)
                if failure == 'crash_timeout':
                    time.sleep(.15)
                if failure == 'interrupted':
                    raise lab.LabError('harness interrupted by signal 2')
                value = crash.initial_crash()
                value.update(status='verified', attempted=2, signaled=2, root_exit_code=-9,
                             all_owned_exited=True, observers_closed=True, elapsed_seconds=.01,
                             targets=[dict(owner.identity, signal_sent=True, exit_observed=True),
                                      dict(pid=21, pgid=21, start_ticks=201, signal_sent=True, exit_observed=True)])
                if failure == 'stimulus':
                    value.update(status='failed', reason='signal', attempted=1, signaled=0,
                                 root_exit_code=None, all_owned_exited=False, observers_closed=False)
                    for target in value['targets']:
                        target.update(signal_sent=False, exit_observed=False)
                    raise crash.CrashError('signal', value)
                owner.live.return_value = []
                owner.process.poll.return_value = -9
                stage[0] = 'readback'
                if failure == 'wrong_root':
                    value['targets'][0]['start_ticks'] += 1
                if failure == 'projection':
                    value['private_path'] = '/private/secret'
                if failure == 'marker':
                    (scope / lab.MARKER).write_text('f' * 64)
                return value

            def poll(probe, predicate, timeout, phase):
                if phase == 'daemon bootstrap':
                    return True
                value = probe()
                self.assertTrue(predicate(value))
                return value
            def wait(api, path, target, timeout=60):
                if stage[0] == 'readback':
                    api.request('GET', '/client/v4' + path)
                    if failure == 'workflow_expired':
                        monotonic = time.monotonic
                        stack.enter_context(patch('lab.time.monotonic', lambda: monotonic() + 400))
                    if failure == 'final_dead':
                        processes[-1].live.return_value = []
                        processes[-1].process.poll.return_value = -9
                status = 'running' if failure == 'workflow' and stage[0] == 'readback' else target
                return dict(status=status, steps=[dict(name='instrumented-callback', success=failure != 'step')], output=dict(jobId=job['id'], nonce='fixture-nonce'))

            patches = {'pwd.getpwuid': lambda uid: SimpleNamespace(pw_dir=str(root)), 'preflight': lambda port: scope, 'source_commit': lambda: 'a' * 40, 'download_binary': lambda *args: root / 'ocd', 'sha256_file': lambda path: 'b' * 64, 'command': command, 'Process': process, 'LocalHTTP': HTTP, 'poll': poll, 'wait_workflow': wait, 'worker_host': lambda *args: 'worker.local:8787', 'state_identity': lambda *args: dict({name: {'device': 1, 'inode': 2 if failure == 'state' and stage[0] == 'readback' else 1} for name in ('scope', 'data', 'control_db', 'scheduler_db')}, config_sha256='d' * 64)}
            # Retain the real GET-only wrapper and its inherited LocalHTTP.v4;
            # replace only its low-level transport for synthetic observations.
            for name, value in patches.items():
                stack.enter_context(patch('lab.' + name, value))
            stack.enter_context(patch.object(lab.CrashReadOnlyHTTP.__mro__[1], 'request', HTTP.request))
            stack.enter_context(patch('crash.abrupt_shutdown', stimulus))
            if limits:
                old = lab.m3_deadline
                def budget(seconds, phase):
                    events.append('budget:' + str(seconds))
                    return old(limits.get(seconds, seconds), phase)
                stack.enter_context(patch('lab.m3_deadline', budget))
            if failure in ('evidence', 'slow_evidence'):
                original_write = lab.exclusive_file
                def write(path, contents, mode=0o600):
                    if path.name == 'report.json':
                        if failure == 'evidence':
                            raise OSError('private evidence refusal')
                        time.sleep(.15)
                    return original_write(path, contents, mode)
                stack.enter_context(patch('lab.exclusive_file', write))
            if failure == 'slow_remove':
                original_remove = lab.OwnedScope.remove
                def remove(owner, processes_stopped):
                    time.sleep(.15)
                    return original_remove(owner, processes_stopped)
                stack.enter_context(patch.object(lab.OwnedScope, 'remove', remove))
            if failure == 'readback_projection':
                original_project = crash.project_readback
                def project(value, *, complete=False):
                    if complete:
                        value['read_requests'] = True
                    return original_project(value, complete=complete)
                stack.enter_context(patch('crash.project_readback', project))
            stream = io.StringIO()
            with redirect_stdout(stream):
                code = lab.integration(SimpleNamespace(port=8787, cache=str(root / 'cache'), output=str(output)), crash=True)
            evidence = json.loads((output / 'report.json').read_text()) if (output / 'report.json').exists() else None
            return code, json.loads(stream.getvalue()), events, scope.exists(), evidence

    def test_verified_crash_readback_then_original_approval_and_cleanup(self):
        code, report, events, exists, evidence = self.run_case()
        self.assertEqual(code, 0, report)
        self.assertFalse(exists)
        self.assertEqual(report, evidence)
        self.assertEqual(set(report['acceptance']), {f'M5-{n:02}' for n in range(1, 6)})
        self.assertTrue(all(v == 'passed' for v in report['acceptance'].values()))
        self.assertNotIn('AC-06', report.get('functional_acceptance', {}))
        self.assertEqual([e for e in events if e.startswith(('spawn:', 'stop:')) or e in ('crash', 'approval')], ['spawn:1', 'crash', 'spawn:2', 'approval', 'stop:2'])
        self.assertGreaterEqual(report['readback']['read_requests'], 6)
        reads = [e for e in events if e.startswith('readback:')]
        self.assertTrue(reads and all(':GET:' in e for e in reads))
        self.assertNotIn('r2', report)

    def test_checkpoint_failures_prevent_stimulus_restart_and_approval(self):
        for failure in ('submission_bool', 'submission_count', 'counter_bool', 'counter_zero', 'counter_two', 'checkpoint_completed', 'checkpoint_id', 'step'):
            with self.subTest(failure=failure):
                code, report, events, exists, _ = self.run_case(failure)
                self.assertEqual(code, 1)
                self.assertNotIn('crash', events)
                self.assertNotIn('spawn:2', events)
                self.assertNotIn('approval', events)
                self.assertFalse(exists)

    def test_failed_or_forged_stimulus_never_restarts_or_approves(self):
        for failure in ('stimulus', 'wrong_root', 'projection'):
            with self.subTest(failure=failure):
                code, report, events, _, _ = self.run_case(failure)
                self.assertEqual(code, 1)
                self.assertNotIn('spawn:2', events)
                self.assertNotIn('approval', events)
                self.assertNotEqual(report['acceptance']['M5-02'], 'passed')
                self.assertNotIn('/private/secret', json.dumps(report))

    def test_original_readbacks_and_deadline_precede_approval(self):
        for failure in ('health', 'health_numeric', 'account', 'binding', 'instance', 'state', 'row', 'nonce', 'row_count', 'workflow', 'workflow_expired', 'readback_projection'):
            with self.subTest(failure=failure):
                code, report, events, exists, _ = self.run_case(failure)
                self.assertEqual(code, 1)
                self.assertNotIn('approval', events)
                if failure != 'workflow_expired':
                    self.assertNotEqual(report['acceptance']['M5-03'], 'passed')
                self.assertFalse(exists)
                self.assertIs(type(report['readback']['read_requests']), int)

    def test_stimulus_watchdog_and_interruption_never_grant_restart(self):
        for failure in ('crash_timeout', 'interrupted'):
            with self.subTest(failure=failure):
                code, report, events, exists, _ = self.run_case(failure, {10: .03})
                self.assertEqual(code, 1)
                self.assertNotIn('spawn:2', events)
                self.assertNotIn('approval', events)
                self.assertNotEqual(report['acceptance']['M5-02'], 'passed')
                self.assertFalse(exists)
                self.assertEqual(report['error'], 'deadline' if failure == 'crash_timeout' else 'schema')

    def test_numeric_identity_injection_is_not_public_evidence(self):
        code, report, events, _, _ = self.run_case('numeric_identity')
        self.assertEqual(code, 1)
        self.assertNotIn('crash', events)
        self.assertNotIn('/private/secret', json.dumps(report))

    def test_projection_fallback_preserves_independent_valid_facts(self):
        code, report, events, _, _ = self.run_case('readback_projection')
        self.assertEqual(code, 1)
        self.assertEqual(report['crash']['status'], 'verified')
        self.assertEqual(report['readback']['read_requests'], 0)
        self.assertFalse(any(v for key, v in report['readback'].items() if key != 'read_requests'))
        self.assertNotIn('approval', events)
        code, report, events, _, _ = self.run_case('wrong_root')
        self.assertEqual(code, 1)
        self.assertEqual(report['crash']['status'], 'not_run')
        self.assertEqual(report['readback']['read_requests'], 0)

    def test_cleanup_and_evidence_failures_revoke_success(self):
        for failure in ('completion_bool', 'final_dead', 'forced', 'unknown', 'marker', 'not_running', 'wrong_final_signal', 'evidence'):
            with self.subTest(failure=failure):
                code, report, events, exists, evidence = self.run_case(failure)
                self.assertEqual(code, 1)
                self.assertNotEqual(report['acceptance']['M5-05'], 'passed')
                if failure in ('final_dead', 'forced', 'unknown', 'marker', 'not_running', 'wrong_final_signal'):
                    self.assertTrue(exists)
                    self.assertNotEqual(report['acceptance']['M5-04'], 'passed')
                if failure == 'evidence':
                    self.assertFalse(exists)
                    self.assertIsNone(evidence)

    def test_cleanup_remove_evidence_have_separate_bounded_budgets(self):
        for failure, seconds in [('slow_cleanup', 150), ('slow_remove', 30), ('slow_evidence', 10)]:
            with self.subTest(failure=failure):
                code, report, events, exists, _ = self.run_case(failure, {seconds: .03})
                self.assertEqual(code, 1)
                self.assertIn('budget:' + str(seconds), events)
                self.assertNotEqual(report['acceptance']['M5-05'], 'passed')
                if seconds != 10:
                    self.assertTrue(exists)

if __name__ == '__main__':
    unittest.main()

"""M4 mocked-runtime contracts; not original-runtime evidence."""
from contextlib import ExitStack, redirect_stdout
import io, json, os, sys, tempfile, time, unittest, signal, threading
from pathlib import Path
from types import SimpleNamespace, ModuleType
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lab
import storage_lifecycle as lifecycle
PHASES = ('cold_baseline', 'cold_after_writes', 'cold_after_completion')

class IntegrationTests(unittest.TestCase):

    def run_case(self, failure=None, limits=None):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root = Path(tmp)
            scope = root / '.open-compute'
            output = root / 'evidence'
            events = []
            processes = []
            rows = {}
            original = [None]
            approved = [False]

            def command(argv, timeout=30):
                if '--version' in argv:
                    return 'ocd 0.2.4'
                if 'setup' in argv:
                    config = scope / 'instances/lab/compute.toml'
                    config.parent.mkdir(parents=True)
                    config.write_text('synthetic')
                    keys = config.parent / 'data/keys'
                    keys.mkdir(parents=True)
                    for name in ('deployer.token', 'read-only.token', 'master.key'):
                        path = keys / name
                        path.write_text('private-' + name)
                        path.chmod(384)
                    return ''
                return json.dumps({'instances': [{'name': 'lab', 'state': 'running', 'instance_id': 'instance-1'}]})

            class HTTP:

                def __init__(self, *args):
                    pass

                def request(self, method, path, body=None, content_type='application/json', host=None, *, deadline=None, expected_status=None):
                    if path in ('/health', '/health/live'):
                        return {'fixture': 'open-compute-m1', 'ok': True}
                    if path == '/jobs':
                        index = body['id']
                        events.append('submit:' + index)
                        if index.startswith('disk-') and failure in ('write', 'cleanup_timeout'):
                            raise lab.LabError('fixture write failure')
                        rows.setdefault(index, dict(id=index, payload=body['payload'], callback_count=0, step_nonce=None, completed=0))
                        if not index.startswith('disk-'):
                            original[0] = index
                            rows[index].update(callback_count=1, step_nonce='fixture-nonce')
                        value = {'job': dict(rows[index]), 'row_count': 1}
                        if index.startswith('disk-') and failure == 'boolean':
                            value['row_count'] = True
                        if index.startswith('disk-') and failure == 'callback':
                            value['job']['callback_count'] = 1
                        return value
                    if path.startswith('/jobs/'):
                        index = path[6:]
                        events.append('read:' + index)
                        if expected_status == 404:
                            return {'job': {'id': index}, 'row_count': 1} if failure == 'exists' else {'job': None, 'row_count': 0}
                        value = {'job': dict(rows[index]), 'row_count': 1}
                        if index.startswith('disk-') and failure == 'retained':
                            value['job']['payload'] = 'changed'
                        if index == original[0] and approved[0]:
                            value['job']['completed'] = 1
                        return value
                    raise AssertionError(path)

                def v4(self, method, path, body=None, content_type='application/json'):
                    if path.endswith('/accounts'):
                        return [{'id': 'account-1'}]
                    if path.endswith('/d1/database'):
                        return {'uuid': 'database-1'}
                    if path.endswith('/endpoints'):
                        return [{'kind': 'local_origin', 'url': 'http://worker.local:8787'}]
                    if path.endswith('/instances'):
                        return {'id': body['instance_id']}
                    if path.endswith('/events/approval'):
                        events.append('approval')
                        approved[0] = True
                        return {'instanceId': path.split('/')[-3]}
                    return {}

            def process(argv):
                n = len(processes) + 1
                events.append('spawn:' + str(n))
                item = Mock()
                item.identity = dict(pid=10 + n, start_ticks=100 + n, pgid=10 + n)
                item.process.pid = 10 + n
                item.process.poll.return_value = None
                item.observation_error = None
                item.text.return_value = ''
                item.children.return_value = [dict(pid=20 + n, start_ticks=200 + n)]
                item.live.return_value = [item.identity, dict(pid=20 + n, start_ticks=200 + n, pgid=20 + n)]

                def stop():
                    events.append('stop:' + str(n))
                    if failure == 'cleanup_timeout' and n == 2:
                        time.sleep(.15)
                    item.live.return_value = []
                    item.process.poll.return_value = 0
                    if failure == 'unknown':
                        item.observation_error = lab.ProcessObservationError('unknown')
                    return dict(was_running=True, forced=failure == 'forced', all_owned_exited=failure != 'unknown', exit_code=0)
                item.stop.side_effect = stop
                processes.append(item)
                return item

            def poll(probe, predicate, timeout, phase):
                if phase == 'daemon bootstrap':
                    return True
                value = probe()
                self.assertTrue(predicate(value))
                return value

            def wait(api, path, target, timeout=60):
                if failure == 'workflow_expired' and len(processes) == 3 and (target == 'waiting'):
                    monotonic = time.monotonic
                    stack.enter_context(patch('lab.time.monotonic', lambda: monotonic() + 400))
                return dict(status=target, steps=[dict(name='instrumented-callback', success=True)], output=dict(jobId=original[0], nonce='fixture-nonce'))
            module = ModuleType('storage')

            class StorageError(Exception):

                def __init__(self, reason):
                    self.reason = reason
                    super().__init__(reason)
            module.StorageError = StorageError
            module.PHASE_NAMES = PHASES
            module.initial_workload = lambda: dict(jobs=16, payload_bytes_per_job=128, unique_payload_bytes=2048, submission_attempted=0, submission_completed=0, absence_checks_attempted=0, absence_checks_completed=0, retained_reads_attempted=0, retained_reads_completed=0)

            def snapshot(owner, phase, *, deadline):
                events.append(phase)
                self.assertEqual(processes[-1].process.poll(), 0)
                self.assertGreater(deadline, time.monotonic())
                owner.check_owner()
                if failure == phase or failure == 'partial_projection':
                    raise StorageError('metadata')
                if failure in ('snapshot_timeout', 'scenario_timeout'):
                    time.sleep(0.15)
                if failure == 'injected':
                    return {'phase': phase, 'private_path': '/private/secret'}
                if failure == 'marker':
                    (owner.path / lab.MARKER).write_text('f' * 64)
                return {'phase': phase}
            module.cold_snapshot = snapshot

            def project(value):
                if set(value) != {'phase'}:
                    raise StorageError('schema')
                return dict(value)
            module.project_snapshot = project

            def extension(snapshots, workload):
                self.assertEqual(set(snapshots), set(PHASES))
                for key, n in [('submission_attempted', 32), ('submission_completed', 32), ('absence_checks_attempted', 16), ('absence_checks_completed', 16), ('retained_reads_attempted', 16), ('retained_reads_completed', 16)]:
                    self.assertEqual(workload[key], n)
                return dict(snapshots=dict(snapshots), workload=dict(workload))
            module.storage_extension = extension
            module.project_storage = lambda value: dict(value)
            partial_calls = [0]
            def partial(snapshots, workload):
                partial_calls[0] += 1
                if failure == 'partial_projection' and partial_calls[0] <= 2:
                    raise StorageError('schema')
                return dict(snapshots=dict(snapshots), workload=dict(workload))
            module.partial_extension = partial
            patches = {'pwd.getpwuid': lambda uid: SimpleNamespace(pw_dir=str(root)), 'preflight': lambda port: scope, 'source_commit': lambda: 'a' * 40, 'download_binary': lambda *args: root / 'ocd', 'sha256_file': lambda path: 'b' * 64, 'command': command, 'Process': process, 'LocalHTTP': HTTP, 'poll': poll, 'wait_workflow': wait, 'worker_host': lambda *args: 'worker.local:8787', 'state_identity': lambda *args: {'fixture': 1}}
            class FakeRunner:
                def __init__(self):
                    self.value=lifecycle.initial();self.value['epochs'].append(lifecycle.epoch_record(1))
                    self.failure=None;self.current=None
                @property
                def epoch(self):return self.value['epochs'][-1]
                def source_commit(self):return 'a'*40
                def bind_scope(self,scope):pass
                def command(self,argv,timeout=30):return command(argv,timeout)
                def start_daemon(self,argv):
                    item=process(argv);item.epoch=self.epoch;self.current=item
                    self.epoch['root']=lab.public_process(item.identity);self.epoch['launches']=1
                    return item
                def root_check(self,item):return True
                def sample_liveness(self,item):
                    self.epoch['sampling'].update(attempted=1,stable_children=1)
                    return [dict(pid=20,start_ticks=200,pgid=20)]
                def latch(self,reason):
                    if self.failure is None:self.failure=reason;self.value['failure']=reason
                    if not self.epoch['closed']:self.epoch['failure']=self.failure
                def cancel(self):self.latch('cancelled')
                def close_epoch(self,item,deadline):
                    if self.failure:raise lifecycle.LifecycleError(self.failure)
                    stopped=item.stop() if item is not None else None
                    if stopped and (stopped['forced'] or not stopped['all_owned_exited']):
                        self.latch('forced' if stopped['forced'] else 'identity')
                        raise lifecycle.LifecycleError(self.failure)
                    self.epoch.update(waited=self.epoch['launches'],closed=True)
                    if item is not None:self.epoch.update(root_exit_code=0,was_running=True)
                    return object()
                def shutdown(self,item):
                    return dict(was_running=True,signal='SIGTERM',forced=False,exit_code=0,
                                all_owned_exited=True,observation_error=None,children=[])
                def consume_snapshot(self,receipt,phase):self.epoch['snapshot_consumed']=True
                def snapshot_finished(self,receipt,*,success,locks_released):
                    self.epoch.update(snapshot_complete=success,locks_released=locks_released)
                def next_epoch(self):self.value['epochs'].append(lifecycle.epoch_record(len(self.value['epochs'])+1))
                def finalize(self,deadline):
                    if self.failure:
                        self.value['cleanup']=dict(status='refused',reason=self.failure,kernel_echild=False)
                        raise lifecycle.LifecycleError(self.failure)
                    if not self.epoch['closed']:self.close_epoch(self.current,deadline)
                    self.value['cleanup']=dict(status='verified',reason=None,kernel_echild=True)
                    return object()
                def consume_deletion(self,seal,remove):return remove()
                def evidence(self,*,complete=False):return lifecycle.project(self.value,complete=complete)
            owner=FakeRunner()
            for name, value in patches.items():
                stack.enter_context(patch('lab.' + name, value))
            stack.enter_context(patch.dict(sys.modules, {'storage': module}))
            if limits:
                old = lab.m3_deadline

                def deadline(seconds, phase):
                    events.append('budget:' + str(seconds))
                    return old(limits.get(seconds, seconds), phase)
                stack.enter_context(patch('lab.m3_deadline', deadline))
            if failure in ('evidence', 'slow_evidence'):
                old_write = lab.exclusive_file

                def write(path, content, mode=384):
                    if path.name == 'report.json':
                        if failure == 'evidence':
                            raise OSError('fixture refused')
                        time.sleep(0.15)
                    return old_write(path, content, mode)
                stack.enter_context(patch('lab.exclusive_file', write))
            if failure == 'remove_timeout':
                original_remove = lab.OwnedScope.remove
                def removing(owner, processes_stopped):
                    time.sleep(.15)
                    return original_remove(owner, processes_stopped)
                stack.enter_context(patch.object(lab.OwnedScope, 'remove', removing))
            stream = io.StringIO()
            with redirect_stdout(stream):
                code = lab.integration(SimpleNamespace(port=8787, cache=str(root / 'cache'), output=str(output)), storage=True, lifecycle=owner)
            return (code, json.loads(stream.getvalue()), events, scope.exists())

    def test_three_cold_checkpoints_exact_batch_and_final_stopped_cleanup(self):
        code, report, events, exists = self.run_case()
        self.assertEqual(code, 0, report)
        self.assertFalse(exists)
        self.assertEqual([e for e in events if e in PHASES or e.startswith(('spawn:', 'stop:')) or e == 'approval'], ['spawn:1', 'stop:1', PHASES[0], 'spawn:2', 'stop:2', PHASES[1], 'spawn:3', 'approval', 'stop:3', PHASES[2]])
        self.assertEqual(sum((e.startswith('submit:disk-') for e in events)), 32)
        self.assertEqual(sum((e.startswith('read:disk-') for e in events)), 32)
        self.assertEqual(set(report['storage_shutdowns']), set(PHASES))
        self.assertEqual(set(report['acceptance']), {f'M4-{n:02}' for n in range(1, 6)})
        self.assertTrue(all((v == 'passed' for v in report['acceptance'].values())))
        self.assertNotIn('storage_partial', report)

    def test_failures_prevent_approval_and_emit_partial(self):
        for failure in (PHASES[0], PHASES[1], 'exists', 'write', 'boolean', 'callback', 'retained', 'injected', 'workflow_expired'):
            with self.subTest(failure=failure):
                code, report, events, exists = self.run_case(failure)
                self.assertEqual(code, 1)
                self.assertNotIn('approval', events)
                self.assertIn('storage_partial', report)
                self.assertNotIn('storage', report)
                self.assertEqual(exists, failure in PHASES[:2])

    def test_final_failure_projection_rebuilds_bounded_failure_report(self):
        code, report, events, exists = self.run_case('partial_projection')
        self.assertEqual(code, 1)
        self.assertIn('storage_partial', report)
        self.assertNotIn('storage', report)
        self.assertNotIn('approval', events)
        self.assertTrue(exists)

    def test_cleanup_and_removal_deadlines_preserve_unfinished_scope(self):
        for failure, seconds in [('cleanup_timeout', 150), ('remove_timeout', 30)]:
            with self.subTest(failure=failure):
                code, report, events, exists = self.run_case(failure, {seconds: .03})
                self.assertEqual(code, 1)
                self.assertTrue(exists)
                self.assertEqual(report['cleanup_error'], 'deadline')
                self.assertIn('budget:' + str(seconds), events)
                self.assertNotEqual(report['acceptance']['M4-04'], 'passed')

    def test_final_snapshot_failure_revokes_success(self):
        code, report, events, exists = self.run_case(PHASES[2])
        self.assertEqual(code, 1)
        self.assertIn('approval', events)
        self.assertEqual(len(report['storage_partial']['snapshots']), 2)
        self.assertTrue(exists)

    def test_unknown_forced_or_changed_marker_preserves_scope(self):
        for failure in ('forced', 'unknown', 'marker'):
            with self.subTest(failure=failure):
                code, report, events, exists = self.run_case(failure)
                self.assertEqual(code, 1)
                self.assertNotIn('approval', events)
                self.assertTrue(exists)
                self.assertNotEqual(report['acceptance']['M4-04'], 'passed')

    def test_evidence_failure_revokes_full_projection_and_gate(self):
        code, report, events, exists = self.run_case('evidence')
        self.assertEqual(code, 1)
        self.assertFalse(exists)
        self.assertIn('storage_partial', report)
        self.assertNotIn('storage', report)
        self.assertNotEqual(report['acceptance']['M4-05'], 'passed')

    def test_snapshot_and_evidence_deadlines(self):
        for failure in ('snapshot_timeout', 'slow_evidence', 'scenario_timeout'):
            with self.subTest(failure=failure):
                code, report, events, exists = self.run_case(failure, {300: 0.03} if failure == 'scenario_timeout' else {10: 0.03})
                self.assertEqual(code, 1)
                self.assertIn('budget:150', events)
                self.assertEqual(exists, failure in ('snapshot_timeout', 'scenario_timeout'))

class OwnerTests(unittest.TestCase):

    def test_bounded_owner_rejects_oversize_symlink_fifo_and_wrong_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            scope = lab.OwnedScope(Path(tmp) / 'scope', 8787, bounded_owner=True)
            scope.create()
            scope.check_owner()
            marker = scope.path / lab.MARKER
            for kind in ('oversize', 'symlink', 'fifo', 'changed'):
                marker.unlink()
                if kind == 'symlink':
                    marker.symlink_to(Path(tmp) / 'foreign')
                elif kind == 'fifo':
                    os.mkfifo(marker, 384)
                else:
                    marker.write_text('x' * 100000 if kind == 'oversize' else 'f' * 64)
                    marker.chmod(384)
                with self.subTest(kind=kind), self.assertRaises(lab.LabError):
                    scope.check_owner()

    def test_interruption_after_open_and_during_close_never_leaks_owned_fds(self):
        def live_fds():
            result = set()
            for value in os.listdir('/proc/self/fd'):
                try:
                    os.fstat(int(value))
                    result.add(int(value))
                except OSError:
                    pass
            return result
        for stage in ('root_open', 'marker_open', 'marker_close', 'marker_signal', 'thread_alarm'):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as tmp:
                scope = lab.OwnedScope(Path(tmp) / 'scope', 8787, bounded_owner=True)
                scope.create()
                real_open, real_close = os.open, os.close
                opened, triggered = [], [False]
                previous = signal.getsignal(signal.SIGALRM)
                def interrupted(*args):
                    raise lab.LabError('deadline')
                def deliver():
                    if stage == 'thread_alarm':
                        done = threading.Event()
                        def sender():
                            signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGALRM})
                            signal.pthread_kill(threading.get_ident(), signal.SIGALRM)
                            done.set()
                        thread = threading.Thread(target=sender)
                        thread.start()
                        self.assertTrue(done.wait(1))
                        thread.join(timeout=1)
                        time.sleep(.01)
                    else:
                        signal.raise_signal(signal.SIGALRM)
                def opening(*args, **kwargs):
                    fd = real_open(*args, **kwargs)
                    opened.append(fd)
                    if not triggered[0] and ((stage in ('root_open', 'thread_alarm') and len(opened) == 1) or
                                             (stage == 'marker_open' and len(opened) == 2)):
                        triggered[0] = True
                        deliver()
                    return fd
                def closing(fd):
                    real_close(fd)
                    if stage == 'marker_signal' and not triggered[0]:
                        triggered[0] = True
                        deliver()
                    if stage == 'marker_close' and not triggered[0]:
                        triggered[0] = True
                        raise OSError('injected close after close')
                before = live_fds()
                signal.signal(signal.SIGALRM, interrupted)
                try:
                    with patch('lab.os.open', opening), patch('lab.os.close', closing):
                        with self.assertRaises((lab.LabError, OSError)):
                            scope.check_owner()
                    self.assertIs(signal.getsignal(signal.SIGALRM), interrupted)
                    after = live_fds()
                    leaked = after - before
                    # Close only the known descriptors from this test to keep a
                    # failing red reproduction from contaminating later tests.
                    for fd in leaked & set(opened):
                        real_close(fd)
                    self.assertEqual(leaked, set())
                finally:
                    signal.signal(signal.SIGALRM, previous)

class HTTPTests(unittest.TestCase):

    def request(self, status, raw, *, expected=True):
        connection = Mock()
        connection.getresponse.return_value.status = status
        connection.getresponse.return_value.read.return_value = raw
        with patch('lab.http.client.HTTPConnection', return_value=connection):
            return lab.LocalHTTP(8787).request('GET', '/jobs/disk-00', host='worker.local', **{'expected_status': 404} if expected else {})

    def test_only_explicit_exact_missing_job_404_is_accepted(self):
        self.assertEqual(self.request(404, b'{"job":null,"row_count":0}'), {'job': None, 'row_count': 0})
        for status, raw in [(200, b'{"job":null,"row_count":0}'), (500, b'{"job":null,"row_count":0}'), (302, b'{}'), (404, b'{"job":null,"row_count":false}'), (404, b'{"job":null,"row_count":0,"error":"private"}'), (404, b'{"error":"missing"}')]:
            with self.subTest(status=status, raw=raw), self.assertRaises(lab.LabError):
                self.request(status, raw)
        with self.assertRaises(lab.LabError):
            self.request(404, b'{"job":null,"row_count":0}', expected=False)

    def test_expected_status_cannot_bypass_management_or_write_errors(self):
        for kwargs in [dict(method='POST', path='/jobs/disk-00'), dict(method='GET', path='/client/v4/accounts'), dict(method='GET', path='/jobs/disk-00', expected_status=200), dict(method='GET', path='/jobs/disk-00', body={})]:
            options = dict(method='GET', path='/jobs/disk-00', host='worker.local', expected_status=404)
            options.update(kwargs)
            with patch('lab.http.client.HTTPConnection') as connect, self.subTest(options=options), self.assertRaises(lab.LabError):
                lab.LocalHTTP(8787).request(**options)
            connect.assert_not_called()

    def test_scenario_http_deadline_refuses_expired_connection(self):
        client = lab.LocalHTTP(8787)
        client.scenario_deadline = time.monotonic() - 1
        with patch('lab.http.client.HTTPConnection') as connect, self.assertRaisesRegex(lab.LabError, 'deadline'):
            client.request('GET', '/health')
        connect.assert_not_called()

    def test_cli_routes_storage_without_other_scenario_flags(self):
        with patch('sys.argv', ['lab.py', 'integration-storage']), patch('storage_lifecycle.dispatch', return_value=0) as dispatch:
            self.assertEqual(lab.main(), 0)
        self.assertEqual(dispatch.call_args.args[0].command, 'integration-storage')
if __name__ == '__main__':
    unittest.main()

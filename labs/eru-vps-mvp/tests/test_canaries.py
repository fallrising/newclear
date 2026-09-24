"""Use real HTTP and subprocess streams; replace only the SSH transport locally."""
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from canaries import HTTPGuards, PROBE


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(503 if self.server.fail else 200)
        self.end_headers()
        self.wfile.write(b'Welcome to nginx!')
    def log_message(self, *args): pass


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = self.enterContext(tempfile.TemporaryDirectory())
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.fail = False
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        url = f'http://127.0.0.1:{self.server.server_port}/'
        self.targets = [{'alias': f'ckc-disposable-0{i}', 'id': f'fixture-{i}', 'url': url} for i in [2, 3]]
        real_popen = subprocess.Popen
        self.enterContext(patch('canaries.subprocess.Popen', side_effect=lambda argv, **kwargs:
            real_popen([sys.executable, '-u', '-c', PROBE] if argv[0] == 'ssh' else argv, **kwargs)))
        self.enterContext(redirect_stdout(io.StringIO()))

    def test_continuous_real_http_is_recorded_and_children_exit(self):
        guard = HTTPGuards(self.temp, 'guard-1', self.targets)
        with guard:
            guard.check()
        self.assertTrue(all(p.poll() is not None for p in guard.processes))
        self.assertEqual(guard.summary['failures'], [])
        self.assertTrue(all(row['samples'] >= 2 for row in guard.summary['hosts'].values()))
        saved = json.loads((guard.directory / 'summary.json').read_text())
        self.assertEqual(saved, guard.summary)

    def test_transient_http_failure_is_retained_even_after_recovery(self):
        guard = HTTPGuards(self.temp, 'guard-1', self.targets)
        with guard:
            self.server.fail = True
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not guard.failures:time.sleep(.05)
            self.server.fail = False
            with self.assertRaisesRegex(ValueError, 'HTTP failure'):guard.check()
        self.assertTrue(guard.summary['failures'])

    def test_dead_or_stale_observer_cannot_look_healthy(self):
        guard = HTTPGuards(self.temp, 'guard-1', self.targets)
        with guard:
            with guard.lock:
                for rows in guard.samples.values(): rows[-1]['received_monotonic'] -= 10
            with self.assertRaisesRegex(ValueError, 'stale'):guard.check()

    def test_startup_readiness_precedes_the_no_failure_guard_window(self):
        from canaries import warmup
        from types import SimpleNamespace
        self.server.fail = True
        timer = threading.Timer(.5, lambda: setattr(self.server, 'fail', False))
        timer.start();self.addCleanup(timer.cancel)
        def command(alias, argv):
            return subprocess.run(argv, capture_output=True, text=True, check=True, timeout=35).stdout
        warmup(SimpleNamespace(command=command), self.targets)
        guard = HTTPGuards(self.temp, 'guard-ready', self.targets)
        with guard: guard.check()
        self.assertFalse(guard.summary['failures'])

class PlacementTests(unittest.TestCase):
    def test_pair_is_bound_to_owned_alias_and_expected_nodes(self):
        from canaries import canary_nodes, guard_targets
        from types import SimpleNamespace
        self.assertEqual(list(canary_nodes('worker-2')), ['worker-3', 'worker-4'])
        self.assertEqual(list(canary_nodes('worker-3')), ['worker-2', 'worker-4'])
        with self.assertRaises(ValueError): canary_nodes('core')
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            directory = project / 'private/smoke'; directory.mkdir(parents=True)
            run_id = 'fixture-run'
            nodes = {'worker-3': {'app': 'erumvp' + 'a' * 12, 'worker_alias': 'ckc-disposable-03', 'workload_ids': []},
                     'worker-4': {'app': 'erumvp' + 'b' * 12, 'worker_alias': 'ckc-disposable-04', 'workload_ids': []}}
            for value in nodes.values():
                value['workload_ids'] = [value['app'] + '_web_one']
            evidence = {'run_id': run_id, 'purpose': 'reinstall-canaries', 'status': 'running', 'nodes': nodes}
            path = directory / (run_id + '.json');path.write_text(json.dumps(evidence))
            snapshot = {'workloads': [
                {'id': value['app'] + '_web_one', 'nodename': node,
                 'labels': {'owner': 'eru-vps-mvp', 'run': run_id}}
                for node, value in nodes.items()]}
            op = SimpleNamespace(project=project, command=lambda alias, argv:
                json.dumps({'Labels': {'eru.network.eru': '10.66.0.2'}}))
            targets = guard_targets(op, snapshot, run_id, {'worker-3', 'worker-4'})
            self.assertEqual({row['alias'] for row in targets}, {'ckc-disposable-03', 'ckc-disposable-04'})
            with self.assertRaisesRegex(ValueError, 'placement'):
                guard_targets(op, snapshot, run_id, {'worker-2', 'worker-3'})
            evidence['nodes']['worker-4']['worker_alias'] = 'ckc-disposable-02'
            path.write_text(json.dumps(evidence))
            with self.assertRaisesRegex(ValueError, 'placement'):
                guard_targets(op, snapshot, run_id)
            evidence['nodes']['worker-4']['worker_alias'] = 'ckc-disposable-04'
            evidence['nodes']['worker-4']['workload_ids'] = ['wrong-id']
            path.write_text(json.dumps(evidence))
            with self.assertRaisesRegex(ValueError, 'workload ID'):
                guard_targets(op, snapshot, run_id)

    def test_start_places_canaries_only_on_selected_peers(self):
        import copy
        from canaries import start_canaries
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            (project / 'private/smoke').mkdir(parents=True)
            (project / 'artifacts.amd64.lock.json').write_text(json.dumps({'nginx': {'image': 'pinned'}}))
            before = {'pods': [{'name': 'eru'}], 'workloads': [],
                      'nodes': [{'name': f'worker-{i}', 'resource_usage': '{}', 'available': True} for i in (2, 3, 4)],
                      'hosts': {f'ckc-disposable-{i:02d}': {'containers': '', 'tasks': 'TASK PID STATUS\n',
                                'machine_id': f'machine-{i}'} for i in (1, 2, 3, 4)}}
            after = copy.deepcopy(before)
            plan = {'id': 'fixture-run', 'guard_exclude': 'worker-2', 'guard_nodes': ['worker-3', 'worker-4']}
            class Fake:
                def __init__(self):
                    self.project = project;self.core = {'alias': 'ckc-disposable-01', 'ip': '10.0.0.1'}
                    self.journal = {};self.deployed = [];self.pending_app = None
                def save_journal(self): pass
                def stage(self, name): pass
                def command(self, alias, argv, stdin=None):
                    if argv == ['python3', '-']:
                        report = json.loads((project / 'private/smoke/fixture-run.json').read_text())
                        self.pending_app = next(reversed(report['nodes'].values()))['app']
                        return '/tmp/eru-mvp-canary-fixture.yaml\n'
                    if 'deploy' in argv:
                        node = argv[argv.index('--node') + 1]
                        self.deployed.append(node)
                        row = {'id': self.pending_app + '_web_one', 'nodename': node,
                               'labels': {'owner': 'eru-vps-mvp', 'run': plan['id']}}
                        after['workloads'].append(row)
                        host = after['hosts'][f'ckc-disposable-0{node[-1]}']
                        host['containers'] = row['id'];host['tasks'] += row['id'] + ' 1 RUNNING\n'
                        next(n for n in after['nodes'] if n['name'] == node)['resource_usage'] = '{"cpu":0.25}'
                        return ''
                    if 'info' in argv:
                        return json.dumps({'Labels': {'eru.network.eru': '10.66.0.2'}})
                    if argv[0] == 'curl': return 'Welcome to nginx!'
                    return ''
                def cli(self, *args):
                    return [w for w in after['workloads'] if w['id'].startswith(args[-1] + '_')]
                def snapshot(self): return copy.deepcopy(after)
            class DummyGuards:
                def __init__(self, *args): pass
                def __enter__(self): return self
                def __exit__(self, *args): pass
                def check(self): pass
            op = Fake()
            with patch('canaries.HTTPGuards', DummyGuards):
                start_canaries(op, plan, before)
            self.assertEqual(op.deployed, ['worker-3', 'worker-4'])
            self.assertEqual(after['hosts']['ckc-disposable-02'], before['hosts']['ckc-disposable-02'])
            self.assertEqual(json.loads((project / 'private/smoke/fixture-run.json').read_text())['status'], 'running')
            bad = {**plan, 'guard_nodes': ['worker-2', 'worker-3']}
            with self.assertRaisesRegex(ValueError, 'placement'):
                start_canaries(op, bad, before)

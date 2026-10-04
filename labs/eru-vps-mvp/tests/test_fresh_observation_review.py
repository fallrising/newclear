"""Independent read-only transport and saved-evidence adversarial checks."""
import contextlib
import copy
from datetime import timedelta
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_observation as protocol
import fresh_observation_ops as ops
import test_fresh_observation as observation_fixtures
import fresh_execution_ops as execution_ops
from fresh_rebuild import plan_digest


class ObservationTransportReviewTests(unittest.TestCase):
    def test_timeout_kills_descendant_when_process_leader_already_exited(self):
        with tempfile.TemporaryDirectory() as temporary:
            pidfile = Path(temporary) / 'child.pid'
            source = ('import os,time,pathlib; child=os.fork(); '
                      'pathlib.Path(%r).write_text(str(child)) if child else None; '
                      'os._exit(0) if child else time.sleep(30)') % str(pidfile)
            try:
                with self.assertRaises(ValueError):
                    protocol.capture([sys.executable, '-c', source], 4096, .2)
                pid = int(pidfile.read_text())
                for _ in range(30):
                    state = Path('/proc') / str(pid) / 'stat'
                    if not state.exists() or state.read_text().split()[2] == 'Z':
                        break
                    time.sleep(.01)
                else:
                    self.fail('capture timeout left descendant alive')
            finally:
                if pidfile.exists():
                    with contextlib.suppress(ProcessLookupError):
                        os.kill(int(pidfile.read_text()), signal.SIGKILL)

    def test_real_subprocess_capture_bounds_both_streams_and_timeout(self):
        for source in ('import sys;sys.stdout.write("x"*20000)',
                       'import sys;sys.stderr.write("x"*20000)',
                       'import time;time.sleep(10)'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                protocol.capture([sys.executable, '-c', source], 1024, .1)

    def test_ssh_reader_fixed_options_and_memfd_survive_real_child(self):
        host = {'alias': 'ckc-disposable-01', 'ip': '192.0.2.1'}
        def capture(argv, limit, timeout, *, input_bytes, pass_fds):
            self.assertEqual(argv[:4], ['ssh', '-F', '/dev/null', '-T'])
            self.assertEqual(argv[-3:], ['--', host['ip'], 'sudo -n python3 -'])
            for required in ('StrictHostKeyChecking=yes', 'UpdateHostKeys=no',
                             'ProxyCommand=none', 'ProxyJump=none', 'ControlPath=none',
                             'PermitLocalCommand=no', 'ForwardAgent=no'):
                self.assertIn(required, argv)
            fd = pass_fds[0]
            source = ('import os,sys; assert os.read(%d,4096)==%r; '
                      'sys.stdout.buffer.write(sys.stdin.buffer.read())') % (
                          fd, ('ckc-disposable-01 ' + observation_fixtures.key(1) + '\n').encode())
            return protocol.capture([sys.executable, '-c', source], limit, timeout,
                                    input_bytes=input_bytes, pass_fds=pass_fds)
        with patch.object(ops, 'capture', side_effect=capture):
            self.assertEqual(ops.SSHReader()(host, 'fixed-script', observation_fixtures.key(1)), b'fixed-script')

    def test_fixed_remote_projection_discards_credentials(self):
        calls = []
        commands = protocol.commands('192.0.2.1', True)
        by_command = {tuple(command): name for name, command in commands.items()}
        def capture(argv, limit, timeout):
            calls.append(argv)
            name = by_command[tuple(argv)]
            if name == 'nodes':
                return json.dumps([{'name': 'worker-2', 'podname': 'eru',
                    'resource_capacity': '{"cpu":4}', 'resource_usage': '{}',
                    'ca': 'PRIVATE-SENTINEL', 'key': 'PRIVATE-SENTINEL'}]).encode()
            if name == 'workloads':
                return json.dumps([{'id': 'workload-1', 'nodename': 'worker-2',
                                    'env': ['PRIVATE-SENTINEL']}]).encode()
            if name.startswith('public_key'):
                return b'ssh-ed25519 encoded comment-with-private-sentinel\n'
            return b'fixed-output\n'
        tail = protocol.script('192.0.2.1', True).split('\nimport json, sys\n', 1)[1]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exec('import json, sys\n' + tail, {'capture': capture})
        self.assertEqual(calls, list(commands.values()))
        self.assertNotIn('PRIVATE-SENTINEL', output.getvalue())
        self.assertNotIn('comment-with-private-sentinel', output.getvalue())


class ObservationEvidenceReviewTests(unittest.TestCase):
    def setUp(self):
        self.f = observation_fixtures.ObservationTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)

    def request(self, baseline_ref):
        f = self.f
        values = {
            'owner_authorization': {'authority': 'owner', 'approved': True,
                'issued_at': f.now.isoformat(),
                'expires_at': (f.now + timedelta(minutes=30)).isoformat()},
            'writer_fence': {'observed_at': f.now.isoformat(), 'active': True,
                            'controller_count': 1, 'in_flight_writers': 0},
            'external_materials': {'observed_at': f.now.isoformat(), 'materials': {}},
        }
        for name in f.review['plan']['bindings']['external_materials']:
            relative = 'private/fresh-execution-inputs/' + name + '.bin'
            path = f.project / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(name.encode())
            values['external_materials']['materials'][name] = {
                'path': relative, 'sha256': hashlib.sha256(name.encode()).hexdigest(),
                'size': len(name)}
        document = {'schema_version': 1, 'binding': f.binding, 'host_baseline': baseline_ref}
        for kind, fields in values.items():
            relative = 'private/fresh-execution-inputs/' + kind + '.json'
            f.fixture.write_json(relative, {'schema_version': 1, 'kind': kind,
                                          'binding': f.binding, **fields})
            document[kind] = {'path': relative, 'sha256': f.fixture.file_sha(relative)}
        relative = 'private/fresh-execution-inputs/request.json'
        f.fixture.write_json(relative, document)
        f.secure()
        return relative

    def prepare(self, refs):
        f = self.f
        return execution_ops.prepare_execution(f.project, f.review['plan']['id'],
            f.review['sha256'], self.request(refs['host_baseline']), f.run,
            now=f.now, source_state=f.fixture.report['source'])

    def test_actual_collected_v2_prepare_and_inspect_never_reprobe(self):
        f = self.f
        before = (f.project / 'private/operations/cluster.json').read_bytes()
        _, refs = f.collect()
        envelope, _ = self.prepare(refs)
        with patch.object(ops.SSHReader, '__call__', side_effect=AssertionError('reprobe')):
            result = execution_ops.inspect_execution(f.project, f.run, envelope['sha256'],
                now=f.now, source_state=f.fixture.report['source'])
        self.assertEqual(result['status'], 'prepared')
        self.assertEqual(len(f.calls), 4)
        self.assertFalse(envelope['execution']['executable'])
        self.assertEqual(before, (f.project / 'private/operations/cluster.json').read_bytes())
        self.assertFalse((f.project / 'private/pending-generation').exists())

    def test_rehashed_endpoint_evidence_cannot_retarget_review(self):
        f = self.f
        _, refs = f.collect()
        path = f.project / refs['observation']['path']
        envelope = json.loads(path.read_text())
        envelope['observation']['captures'][1]['ip'] = '192.0.2.99'
        envelope['sha256'] = plan_digest(envelope['observation'])
        path.write_text(json.dumps(envelope))
        refs['observation']['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        baseline_path = f.project / refs['host_baseline']['path']
        baseline = json.loads(baseline_path.read_text())
        baseline['observation'] = refs['observation']
        baseline_path.write_text(json.dumps(baseline))
        refs['host_baseline']['sha256'] = hashlib.sha256(baseline_path.read_bytes()).hexdigest()
        with self.assertRaises(ValueError):
            self.prepare(refs)
        self.assertFalse((f.project / execution_ops.AREA).exists())

    def test_raw_observation_symlink_blocks_preparation(self):
        f = self.f
        _, refs = f.collect()
        path = f.project / refs['observation']['path']
        elsewhere = f.project / 'private/raw-observation-copy.json'
        elsewhere.write_bytes(path.read_bytes())
        elsewhere.chmod(0o600)
        path.unlink()
        path.symlink_to(elsewhere)
        with self.assertRaises((OSError, ValueError)):
            self.prepare(refs)

    def test_late_directory_fsync_failure_leaves_unusable_evidence(self):
        f = self.f
        actual = os.fsync
        failed = []
        def fsync(fd):
            try:
                entries = sorted(os.listdir(fd))
            except (OSError, NotADirectoryError):
                entries = []
            if entries == ['host-baseline.json', 'observation.json'] and not failed:
                failed.append(True)
                raise OSError('synthetic late directory fsync failure')
            return actual(fd)
        with patch.object(ops.os, 'fsync', side_effect=fsync), self.assertRaises(OSError):
            f.collect()
        path = f.project / ops.AREA / 'observation-1/observation.json'
        self.assertTrue(path.exists())
        self.assertTrue((path.parent / '.collection-failed').exists())
        ref = {'path': str(path.relative_to(f.project)),
               'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        with self.assertRaises(ValueError):
            f.load(ref)
        with self.assertRaises(FileExistsError):
            f.collect()
        self.assertEqual(len(f.calls), 4)

    def test_malformed_nested_json_is_uniformly_valueerror(self):
        original = self.f.envelope()
        for field, value in [('status_before', '[null]'), ('members', '[]'),
                             ('keys', 'null'), ('nodes', '[null,null,null]'),
                             ('workloads', '[null]')]:
            with self.subTest(field=field):
                envelope = copy.deepcopy(original)
                envelope['observation']['captures'][0]['outputs'][field] = value
                with self.assertRaises(ValueError):
                    self.f.validate(envelope)

    def test_boot_identity_change_during_probe_rejects_rehashed_evidence(self):
        envelope = self.f.envelope()
        envelope['observation']['captures'][1]['outputs']['boot_after'] = (
            '11111111-1111-1111-1111-111111111111\n')
        with self.assertRaises(ValueError):
            self.f.validate(envelope)

    def test_actual_etcd_member_header_omits_revision(self):
        envelope = self.f.envelope()
        outputs = envelope['observation']['captures'][0]['outputs']
        members = json.loads(outputs['members'])
        members['header'].pop('revision', None)
        members['header']['raft_term'] = 1
        outputs['members'] = json.dumps(members)
        derived = self.f.validate(envelope)
        self.assertEqual(len(derived['hosts']), 4)

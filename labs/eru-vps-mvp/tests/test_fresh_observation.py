"""Synthetic-only bounded observation contracts."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_observation
import fresh_observation_ops

import base64
import copy
from datetime import timedelta
import hashlib
import json
import os
from unittest.mock import patch
import test_fresh_rebuild as fixtures
import fresh_execution_ops as execution_ops
from fresh_rebuild import plan_digest


def key(index):
    return 'ssh-ed25519 ' + base64.b64encode(b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([index]) * 32).decode()


class ObservationTests(unittest.TestCase):
    def test_fixed_transport_is_read_only(self):
        commands = fresh_observation.commands('192.0.2.1', True)
        self.assertIn('keys', commands)
        self.assertIn('--keys-only', commands['keys'])
        self.assertNotIn('health', str(commands))

    def setUp(self):
        self.fixture = fixtures.FreshRebuildPlanTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        f = self.fixture
        self.project, self.now, self.run = f.project, f.now, 'observation-run'
        f.write_json('private/verified-host-public-keys.json', {
            h['alias']: [key(i)] for i, h in enumerate(f.inventory, 1)})
        self.review, _ = f.save()
        self.binding = fresh_observation.context(self.review['plan'], self.review['sha256'], self.run)
        self.calls = []
        self.outputs = {}
        header = {'cluster_id': 1234, 'member_id': 5678, 'revision': 99}
        status = [{'Endpoint': 'http://127.0.0.1:2379', 'Status': {'header': header, 'leader': 5678}}]
        for i, host in enumerate(self.review['plan']['scope']['hosts'], 1):
            self.outputs[host['alias']] = {
                'machine': host['current_machine_id'] + '\n',
                'boot': ('00000000-0000-0000-0000-%012d' % i) + '\n',
                'public_key': key(i) + '\n', 'containers': '', 'tasks': ''}
        for outputs in self.outputs.values():
            for name in ('machine', 'boot', 'public_key'):
                outputs[name + '_after'] = outputs[name]
        self.outputs[f.inventory[0]['alias']].update(
            status_before=json.dumps(status), status_after=json.dumps(status),
            members=json.dumps({'header': {'cluster_id': 1234, 'member_id': 5678}, 'members': [{'ID': 5678}]}),
            keys=json.dumps({'header': header, 'count': 1, 'kvs': [{'key': base64.b64encode(b'/foreign/identity').decode()}]}),
            nodes=json.dumps([{'name': h['node'], 'podname': 'eru',
                'resource_capacity': '{"cpumem":{"cpu":4,"memory":1024}}',
                'resource_usage': '{}'} for h in f.inventory[1:]]), workloads='[]')
        self.secure()

    def secure(self):
        for path in self.fixture.private.rglob('*'):
            if not path.is_symlink():
                path.chmod(0o700 if path.is_dir() else 0o600)
        self.fixture.private.chmod(0o700)

    def reader(self, host, source, trusted_key):
        self.calls.append(host['alias'])
        self.assertEqual(trusted_key, self.outputs[host['alias']]['public_key'].strip())
        compile(source, '<fixed observation>', 'exec')
        return json.dumps(self.outputs[host['alias']]).encode()

    def collect(self, **kwargs):
        options = {'reader': self.reader, 'now': self.now,
                   'source_state': self.fixture.report['source']}
        observation_id = kwargs.pop('observation_id', 'observation-1')
        options.update(kwargs)
        return fresh_observation_ops.collect_observation(self.project, self.review['plan']['id'],
            self.review['sha256'], self.run, observation_id, **options)

    def load(self, ref, now=None):
        files = execution_ops.PrivateFiles(self.project)
        try:
            return fresh_observation_ops.load_observation(files, ref, self.review['plan'], self.binding, now or self.now)
        finally:
            files.close()

    def test_complete_baseline_rederives_without_remote_replay(self):
        old = (self.fixture.private / 'operations/cluster.json').read_bytes()
        summary, refs = self.collect()
        self.assertEqual(len(self.calls), 4)
        derived = self.load(refs['observation'])
        self.assertEqual(len(derived['hosts']), 4)
        self.assertEqual(derived['schema_version'], 1)
        self.assertEqual(len(self.calls), 4)
        self.assertNotIn(self.fixture.sentinel, json.dumps(summary))
        self.assertFalse(summary['remote_mutation_performed'])
        self.assertEqual(old, (self.fixture.private / 'operations/cluster.json').read_bytes())
        with self.assertRaises(FileExistsError):
            self.collect()
        self.assertEqual(len(self.calls), 4)

    def test_invalid_complete_probe_never_publishes_baseline(self):
        original = copy.deepcopy(self.outputs)
        cases = [('machine', 'different'), ('boot', 'not-a-uuid'), ('tasks', 'orphan\n'),
                 ('containers', 'duplicate\nduplicate\n'), ('machine', 'x' * (fresh_observation.PROBE_LIMIT + 1))]
        for index, (field, value) in enumerate(cases):
            with self.subTest(field=field):
                self.outputs = copy.deepcopy(original)
                self.outputs['ckc-disposable-02'][field] = value
                self.run = 'run-' + str(index)
                with self.assertRaises((ValueError, FileExistsError)):
                    self.collect(observation_id='invalid-' + str(index))
                root = self.project / fresh_observation_ops.AREA / ('invalid-' + str(index))
                self.assertFalse((root / 'host-baseline.json').exists())
                if index == 0:
                    self.assertTrue((root / '.collection-failed').exists())

    def envelope(self):
        _, refs = self.collect()
        return json.loads((self.project / refs['observation']['path']).read_text())

    def validate(self, envelope):
        envelope['sha256'] = plan_digest(envelope['observation'])
        return fresh_observation.validate_observation(envelope, self.review['plan'], self.binding, self.now)

    def test_etcd_partial_values_duplicates_and_revision_drift_rejected(self):
        original = self.envelope()
        cases = ['more', 'count', 'value', 'duplicate', 'revision', 'cluster', 'membership', 'missing-resource', 'unknown-node']
        for case in cases:
            with self.subTest(case=case):
                env = copy.deepcopy(original)
                outputs = env['observation']['captures'][0]['outputs']
                inventory = json.loads(outputs['keys'])
                if case == 'more': inventory['more'] = True
                if case == 'count': inventory['count'] = 4097
                if case == 'value': inventory['kvs'][0]['value'] = base64.b64encode(b'SECRET').decode()
                if case == 'duplicate':
                    inventory['kvs'] *= 2
                    inventory['count'] = 2
                if case == 'revision': inventory['header']['revision'] += 1
                if case == 'cluster': inventory['header']['cluster_id'] += 1
                if case == 'membership': outputs['members'] = '{"header":{},"members":[]}'
                if case in ('missing-resource', 'unknown-node'):
                    nodes = json.loads(outputs['nodes'])
                    if case == 'missing-resource': nodes[0].pop('resource_usage')
                    else: nodes[0]['name'] = 'foreign'
                    outputs['nodes'] = json.dumps(nodes)
                outputs['keys'] = json.dumps(inventory)
                with self.assertRaises(ValueError): self.validate(env)

    def test_binding_identity_and_freshness_fail_closed(self):
        original = self.envelope()
        for case in ['run', 'scope', 'future', 'stale', 'boot', 'key', 'script', 'duplicate-json', 'nonfinite']:
            with self.subTest(case=case):
                env = copy.deepcopy(original)
                row = env['observation']
                if case == 'run': row['binding']['run_id'] = 'foreign'
                if case == 'scope': row['binding']['scope_sha256'] = 'f' * 64
                if case == 'future': row['observed_at'] = (self.now + timedelta(seconds=1)).isoformat()
                if case == 'stale': row['observed_at'] = (self.now - timedelta(minutes=16)).isoformat()
                if case == 'boot': row['captures'][1]['outputs']['boot'] = row['captures'][0]['outputs']['boot']
                if case == 'key': row['captures'][1]['outputs']['public_key'] = key(5)
                if case == 'script': row['captures'][0]['script_sha256'] = 'f' * 64
                if case == 'duplicate-json': row['captures'][0]['outputs']['keys'] = '{"count":0,"count":0}'
                if case == 'nonfinite': row['captures'][0]['outputs']['nodes'] = '[NaN]'
                with self.assertRaises(ValueError): self.validate(env)

    def test_transport_error_oversize_and_crash_claim_prevent_replay(self):
        def fail(*args):
            self.calls.append('attempt')
            raise ValueError('read failure')
        with self.assertRaises(ValueError): self.collect(reader=fail)
        with self.assertRaises(FileExistsError): self.collect(reader=fail)
        self.assertEqual(self.calls, ['attempt'])
        self.assertFalse((self.project / fresh_observation_ops.AREA / 'observation-1/host-baseline.json').exists())

    def test_publication_failure_remains_incomplete(self):
        with patch.object(fresh_observation_ops.os, 'link', side_effect=OSError('crash')):
            with self.assertRaises(OSError): self.collect()
        with self.assertRaises(FileExistsError): self.collect()
        self.assertEqual(len(self.calls), 4)

    def test_trusted_root_symlink_and_extra_files(self):
        backing = self.project / 'backing'
        self.fixture.private.rename(backing)
        self.fixture.private.symlink_to(backing, target_is_directory=True)
        _, refs = self.collect()
        self.load(refs['observation'])
        directory = (self.project / refs['observation']['path']).parent
        (directory / '.crash').write_text('stopped')
        with self.assertRaises(ValueError): self.load(refs['observation'])

    def test_source_drift_stops_collection(self):
        def changed(host, source, trusted):
            result = self.reader(host, source, trusted)
            (self.project / 'scripts/fixture.py').write_text('# changed\n')
            return result
        with self.assertRaises(ValueError): self.collect(reader=changed)
        self.assertEqual(len(self.calls), 1)

    def test_unsafe_descendant_and_bad_identifier_are_rejected(self):
        area = self.project / fresh_observation_ops.AREA
        area.parent.mkdir(parents=True, exist_ok=True)
        elsewhere = self.project / 'elsewhere'
        elsewhere.mkdir()
        area.symlink_to(elsewhere, target_is_directory=True)
        self.secure()
        with self.assertRaises(OSError): self.collect()
        self.assertEqual(self.calls, [])
        with self.assertRaises(ValueError):
            fresh_observation_ops.collect_observation(self.project, 'plan', 'f' * 64, 'run', '../bad')

    def test_capped_process_timeout_nonzero_and_stderr_overflow(self):
        for code, limit, timeout in [('import time; time.sleep(2)', 100, .02),
                ('raise SystemExit(1)', 100, 1),
                ('import sys; sys.stderr.write("X"*10000)', 100, 1)]:
            with self.subTest(code=code), self.assertRaises(ValueError):
                fresh_observation.capture([sys.executable, '-c', code], limit, timeout)
        self.assertEqual(fresh_observation.capture([sys.executable, '-c', 'print("ok")'], 100, 1), b'ok\n')

    def test_ssh_transport_pins_manifest_without_config_or_trust_mutation(self):
        captured = []
        def fake(argv, limit, timeout, **kwargs):
            captured.append(argv)
            fd = kwargs['pass_fds'][0]
            self.assertEqual(os.read(fd, 1024), ('ckc-disposable-01 ' + key(1) + '\n').encode())
            return b'{}'
        with patch.object(fresh_observation_ops, 'capture', side_effect=fake):
            fresh_observation_ops.SSHReader()(self.fixture.inventory[0], 'fixed', key(1))
        argv = captured[0]
        for flag in ['StrictHostKeyChecking=yes', 'UpdateHostKeys=no', 'ProxyCommand=none',
                     'ControlPath=none', 'PermitLocalCommand=no', 'ClearAllForwardings=yes']:
            self.assertIn(flag, argv)
        self.assertEqual(argv[1:3], ['-F', '/dev/null'])
        self.assertEqual(argv[-2:], ['192.0.2.1', 'sudo -n python3 -'])

    def test_malformed_oversized_transport_is_redacted_and_claimed(self):
        cases = [b'{"machine":1,"machine":2}', b'null', b'[' + b'[' * 66 + b'0' + b']' * 67,
                 b'x' * (fresh_observation.HOST_LIMIT + 1)]
        for i, raw in enumerate(cases):
            with self.subTest(index=i), self.assertRaises(ValueError):
                self.collect(observation_id='bad-' + str(i), reader=lambda *args: raw)
        self.assertEqual(self.calls, [])

    def test_malformed_provenance_and_shapes_are_value_errors(self):
        original = self.envelope()
        for field, value in [('status_before', '[null]'), ('members', '[]'),
                             ('keys', 'null'), ('nodes', '[null,null,null]')]:
            with self.subTest(field=field):
                env = copy.deepcopy(original)
                env['observation']['captures'][0]['outputs'][field] = value
                with self.assertRaises(ValueError): self.validate(env)
        env = copy.deepcopy(original)
        env['observation']['source']['commit'] = 'f' * 40
        with self.assertRaises(ValueError): self.validate(env)

    def test_host_after_identity_change_rejects(self):
        for field in ('machine', 'boot', 'public_key'):
            outputs = self.outputs['ckc-disposable-03']
            original = outputs[field + '_after']
            outputs[field + '_after'] = 'changed'
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.collect(observation_id='drift-' + field.replace('_', '-'))
            outputs[field + '_after'] = original

    def test_failed_directory_sync_retains_stop_marker(self):
        fsync = fresh_observation_ops.os.fsync
        def fail(fd):
            import stat
            if stat.S_ISDIR(os.fstat(fd).st_mode) and sorted(os.listdir(fd)) == ['host-baseline.json', 'observation.json']:
                raise OSError('late sync failure')
            return fsync(fd)
        with patch.object(fresh_observation_ops.os, 'fsync', side_effect=fail):
            with self.assertRaises(OSError): self.collect()
        directory = self.project / fresh_observation_ops.AREA / 'observation-1'
        self.assertTrue((directory / '.collection-failed').exists())
        ref = {'path': str((directory / 'observation.json').relative_to(self.project)),
               'sha256': hashlib.sha256((directory / 'observation.json').read_bytes()).hexdigest()}
        with self.assertRaises(ValueError): self.load(ref)

    def test_rehashed_baseline_cannot_replace_command_evidence(self):
        _, refs = self.collect()
        path = self.project / refs['host_baseline']['path']
        baseline = json.loads(path.read_text())
        baseline['hosts'][0]['boot_id_sha256'] = 'f' * 64
        path.write_text(json.dumps(baseline))
        with self.assertRaises(ValueError): self.load(refs['observation'])

    def test_replaced_private_root_is_rejected(self):
        import shutil
        _, refs = self.collect()
        backing = self.project / 'replacement'
        shutil.copytree(self.fixture.private, backing)
        original = self.project / 'original'
        self.fixture.private.rename(original)
        self.fixture.private.symlink_to(backing, target_is_directory=True)
        with self.assertRaises(ValueError): self.load(refs['observation'])

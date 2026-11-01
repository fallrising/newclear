"""Synthetic replacement-host observations; never connect to any remote host."""
import base64
import copy
from datetime import timedelta
import hashlib
import io
from contextlib import redirect_stdout
import json
import os
from pathlib import Path
import sys
import unittest
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_replacement as protocol
import fresh_replacement_ops as ops
from fresh_rebuild import plan_digest
import fresh_observation
import pending_generation
import test_fresh_reimage_receipts as receipts_fixture
import test_fresh_observation as observation_fixture


class ReplacementTests(unittest.TestCase):
    def setUp(self):
        self.r = receipts_fixture.FreshReceiptTests()
        self.r.setUp()
        self.addCleanup(self.r.doCleanups)
        self.project = self.r.project
        self.now = self.r.now + timedelta(hours=2)
        self.keys = [observation_fixture.key(i + 20) for i in range(1, 5)]
        for receipt, key in zip(self.r.receipts, self.keys):
            digest = bytes.fromhex(fresh_observation.public_key(key))
            receipt['host_key_fingerprints']['ssh-ed25519'] = 'SHA256:' + base64.b64encode(digest).decode().rstrip('=')
        self.r.save()
        self.request = {'schema_version': 1, 'run_id': self.r.run,
            'execution_sha256': self.r.execution['sha256'],
            'receipt_request': {'path': self.r.input_path,
                'sha256': hashlib.sha256((self.project / self.r.input_path).read_bytes()).hexdigest()},
            'receipt_assessment_sha256': self.r.inspect()['sha256'], 'hosts': []}
        self.outputs, self.calls = {}, []
        for i, (row, receipt, key) in enumerate(zip(self.r.document['hosts'], self.r.receipts, self.keys), 1):
            host = {'alias': row['alias'], 'node': row['node'], 'ip': '192.0.2.' + str(i), 'public_key': key}
            self.request['hosts'].append(host)
            identity = {**receipt['replacement'], 'public_key': key}
            self.outputs[host['alias']] = {'schema_version': 1, 'before': identity,
                'after': copy.deepcopy(identity), 'architecture': 'x86_64',
                'markers': {path: False for path in protocol.MARKERS}}
        self.path = 'private/replacement-request.json'
        self.save()

    def save(self):
        self.input_sha = self.r.write(self.path, self.request)
        self.r.f.secure()

    def reader(self, host, source, key):
        self.calls.append(host['alias'])
        self.assertEqual(source, protocol.script())
        self.assertEqual(key, host['public_key'])
        return json.dumps(self.outputs[host['alias']]).encode()

    def collect(self, **kwargs):
        options = {'now': self.now, 'reader': self.reader,
                   'source_state': self.r.f.fixture.report['source']}
        observation_id = kwargs.pop('observation_id', 'replacement-1')
        options.update(kwargs)
        return ops.collect_replacement_facts(self.project, self.r.run, self.r.execution['sha256'],
            self.path, self.input_sha, observation_id, **options)

    def inspect(self, summary, **kwargs):
        options = {'now': self.now, 'source_state': self.r.f.fixture.report['source']}
        options.update(kwargs)
        return ops.inspect_replacement_facts(self.project, summary['id'], summary['sha256'], **options)

    def test_four_hosts_offline_recheck_and_immutable_claim(self):
        before = (self.project / 'private/operations/cluster.json').read_bytes()
        result = self.collect()
        self.assertEqual(result['status'], 'observed')
        self.assertEqual(len(self.calls), 4)
        self.assertEqual(result['host_count'], 4)
        with patch.object(ops, 'SSHReader', side_effect=AssertionError('remote')):
            with patch.object(ops.os, 'mkdir', side_effect=AssertionError('write')):
                self.assertEqual(self.inspect(result), result)
        self.assertEqual(len(self.calls), 4)
        self.assertEqual(self.collect()['status'], 'blocked')
        self.assertEqual(len(self.calls), 4)
        self.assertEqual(before, (self.project / 'private/operations/cluster.json').read_bytes())
        for flag in ('stage_accepted', 'executable', 'remote_mutation_performed', 'generation_changed'):
            self.assertIs(result[flag], False)
        self.assertNotIn(self.keys[0], json.dumps(result))

    def test_all_keys_and_endpoints_checked_before_first_transport(self):
        original = copy.deepcopy(self.request)
        for index, change in enumerate((
            lambda r: r['hosts'][3].update(public_key=self.keys[0]),
            lambda r: r['hosts'][3].update(ip=r['hosts'][0]['ip']),
            lambda r: r['hosts'][3].update(ip='192.0.002.4'),
            lambda r: r.update(receipt_assessment_sha256='f' * 64),
            lambda r: r.update(run_id='foreign'),
            lambda r: r['hosts'].reverse())):
            self.request = copy.deepcopy(original)
            change(self.request)
            self.save()
            self.assertEqual(self.collect(observation_id='invalid-' + str(index))['status'], 'blocked')
            self.assertEqual(self.calls, [])

    def test_invalid_facts_or_unknown_state_never_accept(self):
        first = self.request['hosts'][0]['alias']
        original = copy.deepcopy(self.outputs[first])
        for index, change in enumerate((
            lambda f: f['after'].update(machine_id='changed'),
            lambda f: f['before'].update(os_release='unknown'),
            lambda f: f.update(architecture='aarch64'),
            lambda f: f['markers'].update({protocol.MARKERS[0]: True}),
            lambda f: f['markers'].update({protocol.MARKERS[0]: 0}),
            lambda f: f.update(unexpected=False))):
            self.outputs[first] = copy.deepcopy(original)
            change(self.outputs[first])
            result = self.collect(observation_id='bad-facts-' + str(index))
            self.assertEqual(result['status'], 'blocked')
            directory = self.project / ops.AREA / result['id']
            self.assertTrue((directory / '.collection-failed').exists())
            self.assertFalse((directory / 'observation.json').exists())

    def test_transport_errors_and_duplicate_json_are_blocked(self):
        for i, output in enumerate((b'{"schema_version":1,"schema_version":1}', b'NaN',
                                   b'x' * (fresh_observation.HOST_LIMIT + 1), 'not-bytes')):
            self.assertEqual(self.collect(observation_id='bad-output-' + str(i),
                reader=lambda *_: output)['status'], 'blocked')
        with patch.object(ops, 'SSHReader', return_value=lambda *_: (_ for _ in ()).throw(TimeoutError())):
            self.assertEqual(self.collect(observation_id='timeout', reader=None)['status'], 'blocked')

    def test_raw_request_pin_and_drift_rejected(self):
        (self.project / self.path).write_bytes((self.project / self.path).read_bytes() + b' ')
        self.assertEqual(self.collect()['status'], 'blocked')
        self.assertEqual(self.calls, [])
        self.save()
        def reader(*args):
            raw = self.reader(*args)
            (self.project / self.path).write_bytes((self.project / self.path).read_bytes() + b' ')
            return raw
        self.assertEqual(self.collect(reader=reader)['status'], 'blocked')
        self.assertEqual(len(self.calls), 1)

    def test_freshness_and_rehashed_tampering(self):
        result = self.collect()
        self.assertEqual(self.inspect(result, now=self.now + timedelta(minutes=15, seconds=1))['status'], 'blocked')
        path = self.project / ops.AREA / result['id'] / 'observation.json'
        value = json.loads(path.read_bytes())
        value['observation']['captures'][0]['outputs']['architecture'] = 'aarch64'
        value['sha256'] = plan_digest(value['observation'])
        path.write_text(json.dumps(value))
        self.assertEqual(self.inspect({**result, 'sha256': value['sha256']})['status'], 'blocked')

    def test_exact_pending_supported_and_foreign_rejected(self):
        record = self.r.execution['execution']
        fields = ('cluster_id', 'run_id', 'generation_before', 'target_generation', 'review_sha256', 'scope_sha256')
        binding = {k: record['binding'][k] for k in fields}
        binding.update(execution_sha256=self.r.execution['sha256'], cluster_sha256=record['cluster_sha256'],
                       fence_sha256=record['evidence']['writer_fence']['sha256'])
        pending_generation.reserve(self.project, binding)
        before = pending_generation.inspect(self.project)
        result = self.collect()
        self.assertEqual(result['status'], 'observed')
        self.assertEqual(self.inspect(result)['status'], 'observed')
        self.assertEqual(before, pending_generation.inspect(self.project))
        path = self.project / 'private/pending-generation/reservation.json'
        value = json.loads(path.read_bytes())
        value['bindings']['execution_sha256'] = 'f' * 64
        path.write_text(json.dumps(value))
        self.assertEqual(self.collect(observation_id='foreign')['status'], 'blocked')
        self.assertEqual(len(self.calls), 4)

    def test_failure_after_publication_poisoned_and_never_reused(self):
        publish = ops._publish
        def fail(*args):
            publish(*args)
            raise OSError('late directory fsync')
        with patch.object(ops, '_publish', side_effect=fail):
            result = self.collect()
        self.assertEqual(result['status'], 'blocked')
        directory = self.project / ops.AREA / result['id']
        self.assertTrue((directory / '.collection-failed').exists())
        digest = json.loads((directory / 'observation.json').read_bytes())['sha256']
        self.assertEqual(self.inspect({**result, 'sha256': digest})['status'], 'blocked')
        self.assertEqual(self.collect()['status'], 'blocked')
        self.assertEqual(len(self.calls), 4)

    def test_trusted_root_symlink_and_descendant_symlink_rejection(self):
        private = self.project / 'private'
        backing = self.project / 'private-backing'
        private.rename(backing)
        private.symlink_to(backing, target_is_directory=True)
        result = self.collect()
        self.assertEqual(result['status'], 'observed')
        self.assertEqual(self.inspect(result)['status'], 'observed')
        request = private / 'replacement-request.json'
        other = private / 'request-other.json'
        request.rename(other)
        request.symlink_to(other.name)
        self.assertEqual(self.inspect(result)['status'], 'blocked')

    def test_publication_directory_replacement_rejected(self):
        original = self.reader
        def replacement(*args):
            raw = original(*args)
            if len(self.calls) == 1:
                directory = self.project / ops.AREA / 'replacement-1'
                directory.rename(directory.with_name('held-directory'))
                directory.mkdir(mode=0o700)
            return raw
        result = self.collect(reader=replacement)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(len(self.calls), 1)
        self.assertTrue((self.project / ops.AREA / 'held-directory/.collection-failed').exists())

    def test_current_source_and_complete_time_window_rechecked(self):
        result = self.collect()
        source = copy.deepcopy(self.r.f.fixture.report['source'])
        source['sha'] = 'f' * 40
        self.assertEqual(self.inspect(result, source_state=source)['status'], 'blocked')
        path = self.project / ops.AREA / result['id'] / 'observation.json'
        value = json.loads(path.read_bytes())
        value['observation']['completed_at'] = (self.now + timedelta(seconds=361)).isoformat()
        value['sha256'] = plan_digest(value['observation'])
        path.write_text(json.dumps(value))
        self.assertEqual(self.inspect({**result, 'sha256': value['sha256']},
            now=self.now + timedelta(seconds=361))['status'], 'blocked')


class BareOSProbeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.key = observation_fixture.key(21)
        self.values = {'/etc/machine-id': 'replacement-machine-1\n',
            '/proc/sys/kernel/random/boot_id': '11111111-1111-1111-1111-000000000001\n',
            '/etc/ssh/ssh_host_ed25519_key.pub': self.key + ' root@fixture\n',
            '/usr/lib/os-release': 'NAME=Debian\nPRETTY_NAME="Debian GNU/Linux 12"\n'}
        for path, value in self.values.items():
            local = self.root / path.lstrip('/')
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_text(value)
        (self.root / 'etc/os-release').symlink_to('../usr/lib/os-release')

    def probe(self, marker_error=None):
        original_open, original_stat, original_lstat = os.open, os.stat, os.lstat
        def local(path):
            return self.root / str(path).lstrip('/')
        def opened(path, flags, *args, **kwargs):
            return original_open(local(path), flags, *args, **kwargs)
        def stated(path, *args, **kwargs):
            return original_stat(local(path), *args, **kwargs)
        def lstated(path, *args, **kwargs):
            if marker_error is not None:
                raise marker_error
            return original_lstat(local(path), *args, **kwargs)
        output = io.StringIO()
        with patch.object(os, 'open', side_effect=opened), patch.object(os, 'stat', side_effect=stated):
            with patch.object(os, 'lstat', side_effect=lstated), redirect_stdout(output):
                exec(compile(protocol.script(), '<fixed synthetic probe>', 'exec'), {})
        return json.loads(output.getvalue())

    def test_fixed_probe_runs_on_bare_os_with_osrelease_symlink_and_key_comment(self):
        facts = self.probe()
        self.assertEqual(facts['before'], facts['after'])
        self.assertEqual(facts['before']['public_key'], self.key)
        self.assertEqual(facts['before']['os_release'], 'Debian GNU/Linux 12')
        self.assertTrue(all(value is False for value in facts['markers'].values()))
        for command in ('subprocess', 'systemctl', 'docker', 'containerd', 'tailscale'):
            self.assertNotIn(command, protocol.PROBE)

    def test_broken_marker_symlink_counts_present_and_other_errors_fail(self):
        marker = self.root / protocol.MARKERS[0].lstrip('/')
        marker.symlink_to('missing-target')
        self.assertIs(self.probe()['markers'][protocol.MARKERS[0]], True)
        with self.assertRaises(PermissionError):
            self.probe(marker_error=PermissionError())

    def test_fifo_oversized_and_duplicate_osrelease_fail_without_shell(self):
        release = self.root / 'usr/lib/os-release'
        for contents in ('PRETTY_NAME=Debian\nPRETTY_NAME=Debian\n', 'x' * 65537):
            release.write_text(contents)
            with self.assertRaises(ValueError):
                self.probe()
        release.unlink()
        os.mkfifo(release)
        with self.assertRaises(ValueError):
            self.probe()

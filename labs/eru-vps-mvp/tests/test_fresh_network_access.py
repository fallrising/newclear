"""Local synthetic planning; no transport or active host changes."""
import copy
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_access as policy
import fresh_network_access_ops as ops
import fresh_replacement_ops
from fresh_rebuild import plan_digest
import test_fresh_network_admission as fixture
import test_fresh_observation as keys


class NetworkAccessTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkAdmissionTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.project, self.now = self.f.project, self.f.now
        for index, host in enumerate(self.f.f.request['hosts'], 1):
            host['ip'] = '100.100.1.' + str(index)
        self.f.f.save()
        self.f.observation = self.f.f.collect(observation_id='replacement-private')
        self.assertEqual(self.f.observation['status'], 'observed')
        self.f.binding['replacement_sha256'] = self.f.observation['sha256']
        self.f.document['replacement_observation'] = self.f.ref(
            fresh_replacement_ops.AREA + '/' + self.f.observation['id'] + '/observation.json')
        self.f.save()
        admission = self.f.inspect()
        self.assertEqual(admission['status'], 'prerequisites-reviewed')
        self.key = {'public_key': keys.key(71)}
        self.keypath = 'private/core-client-key.json'
        self.f.f.r.write(self.keypath, self.key)
        self.document = {'schema_version': 1, 'binding': copy.deepcopy(self.f.binding),
            'admission_request': self.f.ref(self.f.path), 'admission_sha256': admission['sha256'],
            'controller_ip': '100.100.1.10', 'private_interface': 'tailscale0',
            'core_client_key': self.f.ref(self.keypath)}
        self.path = 'private/network-access-request.json'
        self.plan_id = 'access-1'
        self.source = self.f.f.r.f.fixture.report['source']
        self.save()

    def save(self):
        self.input_sha = self.f.f.r.write(self.path, self.document)
        self.f.f.r.f.secure()

    def prepare(self, **kwargs):
        options = {'now': self.now, 'source_state': self.source}
        options.update(kwargs)
        return ops.prepare_network_access(self.project, self.f.f.r.run,
            self.f.execution['sha256'], self.path, self.input_sha, self.plan_id, **options)

    def inspect(self, result, **kwargs):
        options = {'now': self.now, 'source_state': self.source}
        options.update(kwargs)
        return ops.inspect_network_access(self.project, result['id'], result['sha256'], **options)

    def record(self):
        return json.loads((self.project / ops.AREA / self.plan_id / 'plan.json').read_text())

    def test_complete_plan_rederives_offline_and_has_eight_staged_files(self):
        before_calls = len(self.f.f.calls)
        result = self.prepare()
        self.assertEqual(result['status'], 'planned')
        self.assertEqual(result['file_count'], 8)
        self.assertEqual(self.inspect(result), result)
        self.assertEqual(len(self.f.f.calls), before_calls)
        value = self.record()['plan']['render']
        self.assertEqual(len(value['hosts']), 4)
        self.assertEqual(len(value['controller_known_hosts'].splitlines()), 4)
        self.assertEqual([len(h['files']) for h in value['hosts']], [2, 2, 2, 2])
        for host in value['hosts']:
            for item in host['files']:
                self.assertEqual(item['mode'], '0600')
                self.assertEqual(item['sha256'], hashlib.sha256(item['content'].encode()).hexdigest())
                self.assertNotIn('authorized_keys', item['path'])
        for flag in ('stage_accepted', 'executable', 'remote_mutation_performed',
                     'generation_changed', 'external_fence_verified'):
            self.assertIs(result[flag], False)
        summary = json.dumps(result)
        for secret in ('private/', '100.100.', self.key['public_key'], 'replacement-machine-'):
            self.assertNotIn(secret, summary)
        self.assertEqual(self.prepare()['status'], 'blocked')

    def test_strict_request_key_interface_and_address_rejection(self):
        original = copy.deepcopy(self.document)
        mutations = [lambda d: d.update(schema_version=True), lambda d: d.update(extra='x'),
            lambda d: d['binding'].update(stage='bootstrap'),
            lambda d: d.update(admission_sha256='f' * 64),
            lambda d: d.update(private_interface='eth0'),
            lambda d: d.update(private_interface='wg0\nflush ruleset')]
        mutations += [lambda d, address=address: d.update(controller_ip=address)
                      for address in ('127.0.0.1', '169.254.1.1', '192.0.2.1', '8.8.8.8',
                                      '0.0.0.0', '224.0.0.1', '::1', '100.100.1.1', '010.0.0.1')]
        for mutate in mutations:
            self.document = copy.deepcopy(original)
            mutate(self.document)
            self.save()
            self.assertEqual(self.prepare()['status'], 'blocked')
        self.document = original
        for key in (self.f.f.keys[0], self.key['public_key'] + ' comment',
                    'command="sh" ' + self.key['public_key']):
            self.f.f.r.write(self.keypath, {'public_key': key})
            self.document['core_client_key'] = self.f.ref(self.keypath)
            self.save()
            self.assertEqual(self.prepare()['status'], 'blocked')

    def test_rehashed_policy_forgery_and_expired_plan_reject(self):
        result = self.prepare()
        self.assertEqual(result['status'], 'planned')
        path = self.project / ops.AREA / self.plan_id / 'plan.json'
        original = self.record()
        for mutate in (lambda r: r['render']['hosts'][0]['files'][0].update(content='flush ruleset\n'),
                       lambda r: r['render'].update(controller_ip='8.8.8.8'),
                       lambda r: r.update(created_at=(self.now + timedelta(seconds=1)).isoformat()),
                       lambda r: r.update(extra=True)):
            envelope = copy.deepcopy(original)
            mutate(envelope['plan'])
            envelope['sha256'] = plan_digest(envelope['plan'])
            path.write_text(json.dumps(envelope))
            self.assertEqual(self.inspect({**result, 'sha256': envelope['sha256']})['status'], 'blocked')
        path.write_text(json.dumps(original))
        self.assertEqual(self.inspect(result, now=self.now + timedelta(minutes=15, seconds=1))['status'], 'blocked')

    def test_inspector_has_zero_writes_and_transport(self):
        result = self.prepare()
        self.assertEqual(result['status'], 'planned')
        real_open = os.open
        def read_only(path, flags, *args, **kwargs):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return real_open(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=read_only), \
                patch.object(os, 'mkdir', side_effect=AssertionError('write')), \
                patch('subprocess.Popen', side_effect=AssertionError('transport')):
            self.assertEqual(self.inspect(result)['status'], 'planned')

    def test_late_publication_failure_poisoned_and_not_reusable(self):
        publish = ops._publish
        def fail(*args):
            publish(*args)
            raise OSError('late fsync failure')
        with patch.object(ops, '_publish', side_effect=fail):
            self.assertEqual(self.prepare()['status'], 'blocked')
        envelope = self.record()
        result = {'id': self.plan_id, 'sha256': envelope['sha256']}
        self.assertTrue((self.project / ops.AREA / self.plan_id / '.planning-failed').exists())
        self.assertEqual(self.inspect(result)['status'], 'blocked')
        self.assertEqual(self.prepare()['status'], 'blocked')

    def test_private_network_boundaries_and_key_document_schema(self):
        for address in ('10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1',
                        '100.64.0.1', '100.127.255.254'):
            self.assertEqual(policy.private_ip(address), address)
        for address in ('172.15.255.254', '172.32.0.1', '100.63.255.254', '100.128.0.1',
                        True, 167772161, '10.1', ' 10.0.0.1'):
            with self.assertRaises(ValueError):
                policy.private_ip(address)
        for document in ({'public_key': self.key['public_key'], 'options': 'shell'},
                         {'private_key': 'sensitive'}, {'public_key': self.key['public_key'] + '\n'}):
            self.f.f.r.write(self.keypath, document)
            self.document['core_client_key'] = self.f.ref(self.keypath)
            self.save()
            self.assertEqual(self.prepare()['status'], 'blocked')

    def test_pure_render_refuses_nonprivate_hosts_and_duplicate_ips(self):
        request = copy.deepcopy(self.f.f.request)
        for address in ('192.0.2.1', '8.8.8.8', self.document['controller_ip'], request['hosts'][0]['ip']):
            changed = copy.deepcopy(request)
            changed['hosts'][3]['ip'] = address
            with self.assertRaises(ValueError):
                policy.render(self.document, self.f.document, changed, self.f.f.r.receipts, self.key)

    def test_raw_key_admission_and_source_changes_block(self):
        original = (self.project / self.keypath).read_bytes()
        (self.project / self.keypath).write_bytes(original + b' ')
        self.assertEqual(self.prepare()['status'], 'blocked')
        (self.project / self.keypath).write_bytes(original)
        source = copy.deepcopy(self.source)
        source['sha'] = 'f' * 40
        self.assertEqual(self.prepare(source_state=source)['status'], 'blocked')
        (self.project / self.f.path).write_bytes((self.project / self.f.path).read_bytes() + b' ')
        self.assertEqual(self.prepare()['status'], 'blocked')

    def test_mid_operation_pending_drift_and_final_expiry_poison(self):
        original = ops._publish
        path = self.project / 'private/pending-generation/reservation.json'
        raw = path.read_bytes()
        def mutate(*args):
            result = original(*args)
            path.write_bytes(raw + b' ')
            return result
        with patch.object(ops, '_publish', side_effect=mutate):
            self.assertEqual(self.prepare()['status'], 'blocked')
        path.write_bytes(raw)
        self.assertTrue((self.project / ops.AREA / self.plan_id / '.planning-failed').exists())
        self.plan_id = 'access-expired'
        clock = [self.now] * 4 + [self.now + timedelta(minutes=15, seconds=1)]
        with patch.object(ops, '_time', side_effect=clock):
            self.assertEqual(self.prepare()['status'], 'blocked')
        self.assertTrue((self.project / ops.AREA / self.plan_id / 'plan.json').exists())
        self.assertTrue((self.project / ops.AREA / self.plan_id / '.planning-failed').exists())

    def test_replaced_publication_and_new_extra_entry_never_inspect(self):
        result = self.prepare()
        self.assertEqual(result['status'], 'planned')
        original = ops._context
        directory = self.project / ops.AREA / self.plan_id
        fired = []
        def replace(*args, **kwargs):
            values = original(*args, **kwargs)
            if not fired:
                raw = (directory / 'plan.json').read_bytes()
                directory.rename(directory.with_name('held'))
                directory.mkdir(mode=0o700)
                (directory / 'plan.json').write_bytes(raw)
                (directory / 'plan.json').chmod(0o600)
                fired.append(True)
            return values
        with patch.object(ops, '_context', side_effect=replace):
            self.assertEqual(self.inspect(result)['status'], 'blocked')
        self.assertEqual(fired, [True])
        (directory / '.planning-failed').write_bytes(b'')
        self.assertEqual(self.inspect(result)['status'], 'blocked')

    def test_root_retarget_and_raw_publication_change_after_publish_block(self):
        original = ops._publish
        def mutate(*args):
            digest = original(*args)
            path = self.project / ops.AREA / self.plan_id / 'plan.json'
            path.write_bytes(path.read_bytes() + b' ')
            return digest
        with patch.object(ops, '_publish', side_effect=mutate):
            self.assertEqual(self.prepare()['status'], 'blocked')
        self.plan_id = 'retarget'
        def retarget(*args):
            digest = original(*args)
            private = self.project / 'private'
            private.rename(self.project / 'private-held')
            private.mkdir(mode=0o700)
            return digest
        with patch.object(ops, '_publish', side_effect=retarget):
            self.assertEqual(self.prepare()['status'], 'blocked')
        self.assertTrue((self.project / 'private-held' / ops.AREA.removeprefix('private/') /
                         self.plan_id / '.planning-failed').exists())

    def test_prepare_never_invokes_transport_and_safe_public_arguments(self):
        with patch('subprocess.Popen', side_effect=AssertionError('transport')):
            self.assertEqual(self.prepare()['status'], 'planned')
        for value in ('../escape', 'space id', ''):
            with self.assertRaises(ValueError):
                ops.inspect_network_access(self.project, value, 'a' * 64)
        with self.assertRaises(ValueError):
            ops.inspect_network_access(self.project, self.plan_id, 'not-a-digest')

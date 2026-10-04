"""Independent policy and immutable-plan review; synthetic inputs, no nft or SSH."""
import copy
from contextlib import redirect_stdout
import io
from datetime import timedelta
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_access as policy
import fresh_network_access_ops as ops
from fresh_rebuild import plan_digest
import fresh_observation_ops
import fresh_execution_ops
import labctl
import test_fresh_network_admission as admission_fixture
import test_fresh_replacement as replacement_fixture
import test_fresh_observation as observation_fixture



def firewall_rules(content):
    """Recognize the whole narrow nft grammar; unknown/wider rules fail review."""
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    if lines[:4] != ['table inet eru_fresh_access {', 'chain input {',
            'type filter hook input priority -20; policy accept;', 'iifname "lo" accept']:
        raise AssertionError('unknown chain or unexpected early acceptance')
    if lines[-2:] != ['}', '}']:
        raise AssertionError('unexpected chain/table statements')
    drop = re.fullmatch(r'tcp dport \{ ([0-9, ]+) \} drop', lines[-3])
    if not drop:
        raise AssertionError('missing unconditional management drop')
    ports = {int(port.strip()) for port in drop[1].split(',')}
    rules = []
    for line in lines[4:-3]:
        rule = re.fullmatch(r'iifname "(tailscale0|wg0)" ip saddr ([0-9.]+) '
                            r'ip daddr ([0-9.]+) tcp dport ([0-9]+) accept', line)
        if not rule:
            raise AssertionError('unrecognized policy statement: ' + line)
        interface, source, destination, port = rule.groups()
        rules.append((interface, str(ipaddress.IPv4Address(source)),
                      str(ipaddress.IPv4Address(destination)), int(port)))
    return rules, ports


def packet_allowed(parsed, interface, source, destination, port):
    rules, drop_ports = parsed
    if interface == 'lo':
        return True
    if (interface, source, destination, port) in rules:
        return True
    return port not in drop_ports


class NetworkAccessIndependentReview(unittest.TestCase):
    def setUp(self):
        collect = replacement_fixture.ReplacementTests.collect
        def private_collect(instance, **kwargs):
            for index, host in enumerate(instance.request['hosts'], 1):
                host['ip'] = '100.91.0.' + str(index)
            instance.save()
            return collect(instance, **kwargs)
        self.f = admission_fixture.NetworkAdmissionTests()
        with patch.object(replacement_fixture.ReplacementTests, 'collect', private_collect):
            self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.project, self.now = self.f.project, self.f.now
        self.source = self.f.f.r.f.fixture.report['source']
        self.key = observation_fixture.key(75)
        self.key_path = 'private/review-core-key.json'
        self.f.f.r.write(self.key_path, {'public_key': self.key})
        self.document = {'schema_version': 1, 'binding': self.f.binding,
            'admission_request': self.f.ref(self.f.path),
            'admission_sha256': self.f.inspect()['sha256'],
            'controller_ip': '10.20.30.40', 'private_interface': 'wg0',
            'core_client_key': self.f.ref(self.key_path)}
        self.path = 'private/review-access-request.json'
        self.save()

    def save(self):
        self.sha = self.f.f.r.write(self.path, self.document)
        self.f.f.r.f.secure()

    def prepare(self, plan_id='independent-plan', **kwargs):
        options = {'now': self.now, 'source_state': self.source}
        options.update(kwargs)
        return ops.prepare_network_access(self.project, self.f.f.r.run,
            self.f.execution['sha256'], self.path, self.sha, plan_id, **options)

    def inspect(self, result, **kwargs):
        options = {'now': self.now, 'source_state': self.source}
        options.update(kwargs)
        return ops.inspect_network_access(self.project, result['id'], result['sha256'], **options)

    def envelope(self, result):
        path = self.project / ops.AREA / result['id'] / 'plan.json'
        return path, json.loads(path.read_bytes())

    def test_policy_truth_table_for_every_role_family_interface_and_destination(self):
        result = self.prepare()
        self.assertEqual(result['status'], 'planned')
        _, envelope = self.envelope(result)
        hosts = envelope['plan']['render']['hosts']
        controller = self.document['controller_ip']
        core = hosts[0]['ip']
        management = {22, 80, 2375, 2376, 2379, 2380, 5001, 12345}
        sources = [controller, *(host['ip'] for host in hosts), '100.91.0.99', '8.8.8.8', '2001:db8::1']
        for index, host in enumerate(hosts):
            parsed = firewall_rules(host['files'][0]['content'])
            self.assertEqual(parsed[1], management)
            for interface in ('wg0', 'tailscale0', 'eth0'):
                for source in sources:
                    for destination in (host['ip'], '100.91.0.99', '2001:db8::2'):
                        for port in management:
                            expected = False
                            if interface == 'wg0' and destination == host['ip']:
                                if port == 22:
                                    expected = source in ({controller} if index == 0 else {controller, core})
                                if port == 5001 and index == 0:
                                    expected = source in {controller, *(h['ip'] for h in hosts)}
                                if port == 80 and index > 0:
                                    expected = source in {controller, core}
                            with self.subTest(host=index, interface=interface, source=source,
                                              destination=destination, port=port):
                                self.assertEqual(packet_allowed(parsed, interface, source, destination, port), expected)
            for port in management:
                self.assertTrue(packet_allowed(parsed, 'lo', '::1', '::1', port))
            self.assertTrue(packet_allowed(parsed, 'eth0', '8.8.8.8', host['ip'], 443))

    def test_cli_real_prepare_and_inspect_leave_only_dedicated_plan_writes(self):
        before = self.f.f.r.snapshot()
        def invoke(args):
            output = io.StringIO()
            with patch.object(labctl, 'PROJECT', self.project), patch.object(sys, 'argv', ['labctl.py', *args]), \
                    patch.object(fresh_execution_ops, '_git_source', return_value=self.source), \
                    patch.object(ops, '_time', return_value=self.now), \
                    patch.object(labctl, 'Operator', side_effect=AssertionError('operator')), \
                    patch.object(labctl, 'ClusterLock', side_effect=AssertionError('mutation lock')), \
                    patch.object(fresh_observation_ops, 'SSHReader', side_effect=AssertionError('transport')), \
                    redirect_stdout(output):
                labctl.main()
            return json.loads(output.getvalue())
        result = invoke(['prepare-fresh-network-access', '--run', self.f.f.r.run,
            '--sha256', self.f.execution['sha256'], '--input', self.path,
            '--input-sha256', self.sha, '--plan-id', 'cli-plan'])
        self.assertEqual(result['status'], 'planned')
        after = self.f.f.r.snapshot()
        for path, value in before.items():
            self.assertEqual(after[path], value)
        added = set(after) - set(before)
        self.assertEqual(added, {ops.AREA + '/cli-plan/plan.json'})
        with patch.object(ops.os, 'mkdir', side_effect=AssertionError('write')):
            self.assertEqual(invoke(['inspect-fresh-network-access', '--plan', 'cli-plan',
                                    '--sha256', result['sha256']]), result)
        self.assertEqual(after, self.f.f.r.snapshot())

    def test_offline_zero_transport_zero_writes_and_fixed_trust_destinations(self):
        with patch.object(fresh_observation_ops, 'SSHReader', side_effect=AssertionError('transport')):
            result = self.prepare()
            self.assertEqual(result['status'], 'planned')
            before = self.f.f.r.snapshot()
            with patch.object(ops.os, 'mkdir', side_effect=AssertionError('write')):
                self.assertEqual(self.inspect(result), result)
            self.assertEqual(before, self.f.f.r.snapshot())
        _, envelope = self.envelope(result)
        render = envelope['plan']['render']
        self.assertEqual(len(render['controller_known_hosts'].splitlines()), 4)
        endpoints = self.f.f.request['hosts']
        self.assertEqual(render['controller_known_hosts'], ''.join(
            host['ip'] + ' ' + host['public_key'] + '\n' for host in endpoints))
        for index, host in enumerate(render['hosts']):
            files = {f['path']: f for f in host['files']}
            expected = {'/etc/eru/fresh-access.nft', '/etc/eru/known_hosts' if index == 0
                        else '/etc/eru/fresh-core-authorized-key'}
            self.assertEqual(set(files), expected)
            for file in files.values():
                self.assertEqual(file['mode'], '0600')
                self.assertEqual(file['sha256'], hashlib.sha256(file['content'].encode()).hexdigest())
            if index:
                candidate = files['/etc/eru/fresh-core-authorized-key']['content'].strip()
                prefix, key = candidate.split(' ssh-ed25519 ', 1)
                self.assertEqual('ssh-ed25519 ' + key, self.key)
                self.assertEqual(prefix, 'from="100.91.0.1",command="/usr/local/libexec/eru-ssh-command",'
                    'no-agent-forwarding,no-X11-forwarding,no-pty,no-port-forwarding,no-user-rc')
            else:
                self.assertEqual(files['/etc/eru/known_hosts']['content'], ''.join(
                    h['ip'] + ' ' + h['public_key'] + '\n' for h in endpoints[1:]))
        self.assertEqual(result['file_count'], 8)
        for key in ('stage_accepted', 'executable', 'remote_mutation_performed',
                    'generation_changed', 'external_fence_verified'):
            self.assertIs(result[key], False)
        public = json.dumps(result)
        for secret in (self.key, '100.91.0.1', self.path, '10.20.30.40', 'replacement-machine'):
            self.assertNotIn(secret, public)

    def test_rehashed_render_forgery_does_not_become_authoritative(self):
        result = self.prepare()
        self.assertEqual(result['status'], 'planned')
        path, original = self.envelope(result)
        mutations = [lambda p: p['render']['hosts'][0]['files'][0].update(content='flush ruleset\n'),
            lambda p: p['render'].update(controller_known_hosts='10.20.30.40 ' + self.key + '\n'),
            lambda p: p['render']['hosts'][1]['files'][1].update(path='/root/.ssh/authorized_keys'),
            lambda p: p['render']['hosts'][1]['files'][1].update(mode='0644'),
            lambda p: p['render']['hosts'][0].update(machine_id='foreign'),
            lambda p: p.update(created_at=(self.now + timedelta(seconds=1)).isoformat())]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                envelope = copy.deepcopy(original)
                mutate(envelope['plan'])
                for host in envelope['plan']['render']['hosts']:
                    for file in host['files']:
                        file['sha256'] = hashlib.sha256(file['content'].encode()).hexdigest()
                envelope['sha256'] = plan_digest(envelope['plan'])
                path.write_text(json.dumps(envelope))
                self.assertEqual(self.inspect({**result, 'sha256': envelope['sha256']})['status'], 'blocked')
        path.write_text(json.dumps(original))
        self.assertEqual(self.inspect(result)['status'], 'planned')

    def test_untrusted_request_fields_and_key_options_cannot_inject(self):
        original = copy.deepcopy(self.document)
        values = [('controller_ip', '127.0.0.1'), ('controller_ip', '169.254.1.2'),
            ('controller_ip', '224.0.0.1'), ('controller_ip', '0.0.0.0'),
            ('controller_ip', '192.0.2.1'), ('controller_ip', '8.8.8.8'),
            ('controller_ip', '::1'), ('controller_ip', '100.91.0.1'),
            ('controller_ip', '10.20.30.040'), ('controller_ip', '10.2.3.4; accept'),
            ('private_interface', 'wg0" accept'), ('private_interface', 'eth0'),
            ('private_interface', 'lo'), ('private_interface', 'wg0\nflush ruleset'),
            ('profile', 'B'), ('path', '/root/.ssh/authorized_keys'), ('command', 'sh')]
        for index, (field, value) in enumerate(values):
            with self.subTest(field=field, value=value):
                self.document = {**original, field: value}
                self.save()
                self.assertEqual(self.prepare('bad-input-' + str(index))['status'], 'blocked')
        self.document = original
        for index, key in enumerate((self.key + ' comment', 'command="sh" ' + self.key,
                                    self.key + '\n' + self.key, self.f.f.keys[0])):
            self.f.f.r.write(self.key_path, {'public_key': key})
            self.document['core_client_key'] = self.f.ref(self.key_path)
            self.save()
            self.assertEqual(self.prepare('bad-key-' + str(index))['status'], 'blocked')

    def test_replacement_endpoint_and_hostkey_cannot_inject_policy_or_trust(self):
        for value in ('::1', '10.1.2.3\naccept', '10.1.2.3; flush ruleset',
                      '192.168.1.2/24', '192.168.1.2 ', '8.8.8.8'):
            request = copy.deepcopy(self.f.f.request)
            request['hosts'][3]['ip'] = value
            with self.subTest(endpoint=value), self.assertRaises(ValueError):
                policy.render(self.document, self.f.document, request, self.f.f.r.receipts,
                              {'public_key': self.key})
        request = copy.deepcopy(self.f.f.request)
        request['hosts'][3]['public_key'] += '\n@cert-authority * ' + self.key
        with self.assertRaises(ValueError):
            policy.render(self.document, self.f.document, request, self.f.f.r.receipts,
                          {'public_key': self.key})

    def test_postpublication_expiry_poison_prevents_success_and_id_reuse(self):
        original_publish = ops._publish
        late = [False]
        def after_publish(*args, **kwargs):
            result = original_publish(*args, **kwargs)
            late[0] = True
            return result
        with patch.object(ops, '_publish', side_effect=after_publish), patch.object(
                ops, '_time', side_effect=lambda _: self.now + timedelta(minutes=16) if late[0] else self.now):
            result = self.prepare()
        self.assertEqual(result['status'], 'blocked')
        directory = self.project / ops.AREA / result['id']
        self.assertTrue((directory / 'plan.json').exists())
        before = {p.name: p.read_bytes() for p in directory.iterdir()}
        self.assertGreater(len(before), 1)
        self.assertEqual(self.prepare()['status'], 'blocked')
        self.assertEqual(before, {p.name: p.read_bytes() for p in directory.iterdir()})
        envelope = json.loads((directory / 'plan.json').read_bytes())
        self.assertEqual(self.inspect({**result, 'sha256': envelope['sha256']})['status'], 'blocked')

    def test_postpublication_whitespace_change_rejects_changed_raw_bytes(self):
        original = ops._publish
        def rewrite(*args, **kwargs):
            digest = original(*args, **kwargs)
            path = self.project / ops.AREA / 'independent-plan' / 'plan.json'
            path.write_bytes(path.read_bytes() + b' ')
            return digest
        with patch.object(ops, '_publish', side_effect=rewrite):
            result = self.prepare()
        self.assertEqual(result['status'], 'blocked')
        directory = self.project / ops.AREA / result['id']
        self.assertTrue((directory / '.planning-failed').exists())
        self.assertEqual(self.prepare()['status'], 'blocked')

    def test_published_directory_swap_with_identical_bytes_is_rejected(self):
        original = ops._publish
        def swap(*args, **kwargs):
            result = original(*args, **kwargs)
            directory = self.project / ops.AREA / 'independent-plan'
            moved = directory.with_name('displaced-plan')
            directory.rename(moved)
            directory.mkdir(mode=0o700)
            target = directory / 'plan.json'
            target.write_bytes((moved / 'plan.json').read_bytes())
            target.chmod(0o600)
            return result
        with patch.object(ops, '_publish', side_effect=swap):
            self.assertEqual(self.prepare()['status'], 'blocked')


if __name__ == '__main__':
    unittest.main()

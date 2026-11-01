"""Independent synthetic host/transport adversarial review; never runs nft or SSH."""
import base64
import copy
from datetime import datetime, timezone
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_access as access
import fresh_network_staging_host as staging
import test_fresh_network_firewall_review as policy_fixture


def wire(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=False, allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def key(index):
    raw = b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([65 + index]) * 32
    return 'ssh-ed25519 ' + base64.b64encode(raw).decode('ascii')


class Fixture:
    """Construct action and staged bytes from independent test-only inputs."""
    def __init__(self, case):
        self.temp = tempfile.TemporaryDirectory()
        case.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
        self.activation = 'e' * 64
        self.stage_intent = 'd' * 64
        self.keys = {'ckc-disposable-%02d' % (i + 1): key(i) for i in range(4)}
        self.ips = ['10.31.0.%d' % i for i in range(1, 5)]
        self.controller = '10.31.0.10'
        for name in ('etc/eru', 'etc/ssh', 'proc/sys/kernel/random'):
            (self.root / name).mkdir(parents=True)
        for path in self.root.rglob('*'):
            if path.is_dir():
                path.chmod(0o700)
        self.machine = 'fixture-machine-1'
        self.boot = '11111111-2222-4333-8444-555555555555'
        for path, value in (('etc/machine-id', self.machine + '\n'),
                ('proc/sys/kernel/random/boot_id', self.boot + '\n'),
                ('etc/ssh/ssh_host_ed25519_key.pub', key(0) + ' fixture\n')):
            target = self.root / path
            target.write_text(value)
            target.chmod(0o600)
        hosts = [{'ip': ip} for ip in self.ips]
        payload = access._firewall(hosts, 0, self.controller, 'tailscale0')
        files = []
        for path, content in (('/etc/eru/fresh-access.nft', payload),
                              ('/etc/eru/known_hosts', 'fixed fixture trust\n')):
            files.append({'path': path, 'mode': '0600', 'content': content,
                          'sha256': digest(content.encode())})
        self.staged_action = {'schema_version': 1, 'operation': staging.OPERATION,
            'plan_id': 'plan-1', 'plan_sha256': 'a' * 64, 'run_id': 'run-1',
            'execution_sha256': 'b' * 64, 'pending_sha256': 'c' * 64,
            'host_index': 0, 'host': {'alias': 'ckc-disposable-01', 'node': 'worker-1',
                'ip': self.ips[0], 'machine_id': self.machine, 'boot_id': self.boot,
                'host_key_sha256': digest(base64.b64decode(key(0).split()[1])),
                'files': files}}
        stage = {'schema_version': 1, 'operation': 'stage',
                 'action': self.staged_action, 'intent_sha256': self.stage_intent}
        staging.handle(stage, root=str(self.root), owner_uid=os.getuid(),
                       owner_gid=os.getgid(), now=self.now)
        self.action = copy.deepcopy(self.staged_action)
        self.action.update(operation='fresh-network-firewall-activation',
                           staging_intent_sha256=self.stage_intent,
                           staging_receipt_sha256='f' * 64,
                           network={'controller_ip': self.controller,
                                    'private_interface': 'tailscale0',
                                    'host_ips': self.ips})
        self.slot = self.root / 'etc/eru/.fresh-network-firewall'

    def request(self, operation='observe'):
        result = {'schema_version': 1, 'operation': operation,
                  'action': copy.deepcopy(self.action)}
        if operation == 'activate':
            result['intent_sha256'] = self.activation
        return result

    def call(self, helper, runner, operation='observe'):
        return helper.handle(self.request(operation), root=str(self.root),
                             owner_uid=os.getuid(), owner_gid=os.getgid(),
                             now=self.now, runner=runner)


class Kernel:
    """A fake command boundary with a separate explicit create-only batch oracle."""
    INVENTORY = ('/usr/sbin/nft', '-j', '-n', '-a', 'list', 'tables', 'inet')
    TABLE = ('/usr/sbin/nft', '-j', '-n', '-a', 'list', 'table', 'inet', 'eru_fresh_access')
    BATCH = ('/usr/sbin/nft', '-j', '-n', '-a', '-f', '-')

    def __init__(self, case, fixture):
        self.case, self.fixture = case, fixture
        self.calls = []
        self.table = None
        self.on_batch = None
        self.on_list = None

    def __call__(self, argv, input_bytes=None):
        argv = tuple(argv)
        self.calls.append((argv, input_bytes))
        self.case.assertIn(argv, (self.INVENTORY, self.TABLE, self.BATCH))
        if argv == self.INVENTORY:
            self.case.assertIsNone(input_bytes)
            rows = [] if self.table is None else [self.table['nftables'][0]]
            return wire({'nftables': rows})
        if argv == self.TABLE:
            self.case.assertIsNone(input_bytes)
            self.case.assertIsNotNone(self.table)
            if self.on_list:
                self.on_list()
            return wire(self.table)
        self.case.assertIs(type(input_bytes), bytes)
        batch = json.loads(input_bytes)
        self.case.assertEqual(set(batch), {'nftables'})
        commands = batch['nftables']
        self.case.assertEqual(commands[0], {'create': {'table': {
            'family': 'inet', 'name': 'eru_fresh_access'}}})
        expected = policy_fixture.rules_for(self.fixture.action)['nftables']
        self.case.assertEqual(commands[1:], [{'add': row} for row in expected[1:]])
        self.case.assertIsNone(self.table, 'create must reject a table appearing after precheck')
        self.case.assertTrue((self.fixture.slot / 'intent.json').is_file())
        self.case.assertFalse((self.fixture.slot / 'complete.json').exists())
        if self.on_batch:
            self.on_batch()
        rows = copy.deepcopy(expected)
        for handle, row in enumerate(rows, 1):
            next(iter(row.values()))['handle'] = handle
        self.table = {'nftables': rows}
        return wire({'nftables': []})


class HostIndependentReview(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(self)
        self.helper = importlib.import_module('fresh_network_firewall_host')
        self.kernel = Kernel(self, self.f)

    def test_request_is_pure_exact_bounded_and_copied(self):
        original = self.f.request('activate')
        with patch.object(os, 'open', side_effect=AssertionError('validation IO')):
            checked = self.helper.validate_request(original)
            checked['action']['host']['files'][0]['content'] = 'changed'
            self.assertNotEqual(checked, original)
            for field, value in (('root', '/tmp/other'), ('runner', 'evil'),
                                 ('owner_uid', 0), ('command', 'flush ruleset')):
                with self.subTest(field=field), self.assertRaises(ValueError):
                    self.helper.validate_request({**original, field: value})
            for value in (True, -1, '1'):
                bad = copy.deepcopy(original)
                bad['schema_version'] = value
                with self.assertRaises(ValueError):
                    self.helper.validate_request(bad)
            bad = copy.deepcopy(original)
            bad['action']['host']['files'][0]['content'] = 'flush ruleset\n'
            bad['action']['host']['files'][0]['sha256'] = digest(b'flush ruleset\n')
            with self.assertRaises(ValueError):
                self.helper.validate_request(bad)

    def test_absent_then_single_fixed_create_batch_and_complete_provenance(self):
        before = self.f.call(self.helper, self.kernel)
        self.assertEqual(before['table'], {'kind': 'absent'})
        self.assertFalse(self.f.slot.exists())
        active = self.f.call(self.helper, self.kernel, 'activate')
        self.assertEqual(active['table']['kind'], 'present')
        self.assertEqual(active['table']['intent_sha256'], self.f.activation)
        self.assertEqual(active['table']['ruleset'], self.kernel.table)
        self.assertEqual([argv for argv, _ in self.kernel.calls].count(Kernel.BATCH), 1)
        self.assertEqual(wire(json.loads((self.f.slot / 'intent.json').read_bytes())),
                         (self.f.slot / 'intent.json').read_bytes())
        self.assertEqual(wire(json.loads((self.f.slot / 'complete.json').read_bytes())),
                         (self.f.slot / 'complete.json').read_bytes())
        calls = len(self.kernel.calls)
        with self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel, 'activate')
        self.assertEqual(len(self.kernel.calls), calls)
        self.assertEqual(self.f.call(self.helper, self.kernel), active)

    def test_foreign_table_and_late_create_race_never_adopt(self):
        self.kernel.table = {'nftables': [{'table': {'family': 'inet',
            'name': 'eru_fresh_access', 'handle': 99}}]}
        with self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel, 'activate')
        self.assertFalse(self.f.slot.exists())
        self.assertFalse(any(argv == Kernel.BATCH for argv, _ in self.kernel.calls))

    def test_failed_batch_leaves_incomplete_claim_without_replay(self):
        def lost():
            raise OSError('fixture-secret-kernel-uncertain')
        self.kernel.on_batch = lost
        with self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel, 'activate')
        self.assertTrue(self.f.slot.exists())
        self.assertFalse((self.f.slot / 'complete.json').exists())
        batches = [argv for argv, _ in self.kernel.calls].count(Kernel.BATCH)
        for operation in ('observe', 'activate'):
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                self.f.call(self.helper, self.kernel, operation)
        self.assertEqual([argv for argv, _ in self.kernel.calls].count(Kernel.BATCH), batches)

    def test_missing_handles_and_recreated_table_cannot_complete_or_observe(self):
        def strip_handle():
            self.kernel.table['nftables'][2]['rule'].pop('handle')
        self.kernel.on_list = strip_handle
        with self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel, 'activate')
        self.assertFalse((self.f.slot / 'complete.json').exists())
        self.kernel.on_list = None
        self.kernel.table['nftables'][2]['rule']['handle'] = 3
        # This claim remains poisoned even if a later table looks correct.
        with self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel)

    def test_complete_table_recreation_by_handle_is_rejected(self):
        self.f.call(self.helper, self.kernel, 'activate')
        prior = (self.f.slot / 'complete.json').read_bytes()
        self.kernel.table['nftables'][2]['rule']['handle'] += 1000
        with self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel)
        self.assertEqual((self.f.slot / 'complete.json').read_bytes(), prior)

    def test_observe_is_readonly_even_with_complete_journal(self):
        self.f.call(self.helper, self.kernel, 'activate')
        original = os.open
        def readonly(path, flags, *args, **kwargs):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=readonly), \
                patch.object(os, 'mkdir', side_effect=AssertionError('observe write')), \
                patch.object(os, 'fsync', side_effect=AssertionError('observe write')), \
                patch.object(os, 'link', side_effect=AssertionError('observe write')), \
                patch.object(os, 'unlink', side_effect=AssertionError('observe write')):
            self.assertEqual(self.f.call(self.helper, self.kernel)['table']['kind'], 'present')

    def test_parent_fsync_failure_prevents_kernel_and_retains_poison(self):
        original = os.fsync
        calls = 0
        def fail_once(fd):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise OSError('synthetic fsync failure')
            return original(fd)
        with patch.object(os, 'fsync', side_effect=fail_once), self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel, 'activate')
        self.assertFalse(any(argv == Kernel.BATCH for argv, _ in self.kernel.calls))
        self.assertTrue((self.f.slot / '.firewall-failed').is_file())
        self.assertFalse((self.f.slot / 'complete.json').exists())

    def test_claim_replacement_is_never_written_or_poisoned(self):
        original = os.fsync
        moved = self.f.slot.with_name('.old-firewall-claim')
        swapped = False
        def swap_after_parent_fsync(fd):
            nonlocal swapped
            result = original(fd)
            if not swapped:
                swapped = True
                self.f.slot.rename(moved)
                self.f.slot.mkdir(mode=0o700)
            return result
        with patch.object(os, 'fsync', side_effect=swap_after_parent_fsync), \
                self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel, 'activate')
        self.assertEqual(list(self.f.slot.iterdir()), [])
        self.assertTrue((moved / '.firewall-failed').exists())
        self.assertFalse(any(argv == Kernel.BATCH for argv, _ in self.kernel.calls))

    def test_post_kernel_staged_raw_drift_never_completes(self):
        def change_raw():
            target = self.f.root / 'etc/machine-id'
            target.write_text('changed-machine\n')
            target.chmod(0o600)
            self.kernel.on_list = None
        self.kernel.on_list = change_raw
        with self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel, 'activate')
        self.assertIsNotNone(self.kernel.table)
        self.assertFalse((self.f.slot / 'complete.json').exists())
        self.assertTrue((self.f.slot / '.firewall-failed').exists())

    def test_invalid_inventory_never_establishes_absence(self):
        bad = (b'{"nftables":[],"nftables":[]}', b'{"nftables":[NaN]}',
               b'{"nftables":[{"table":{"family":"inet","name":"other","handle":true}}]}',
               b' ' * (257 * 1024))
        for response in bad:
            with self.subTest(response=response[:36]):
                def runner(argv, input_bytes=None):
                    self.assertEqual(tuple(argv), Kernel.INVENTORY)
                    return response
                with self.assertRaises(ValueError):
                    self.f.call(self.helper, runner, 'activate')
                self.assertFalse(self.f.slot.exists())

    def test_create_race_preserves_foreign_table_without_retry(self):
        foreign = {'nftables': [{'table': {'family': 'inet',
            'name': 'eru_fresh_access', 'handle': 989}}]}
        def appears_before_create():
            self.kernel.table = copy.deepcopy(foreign)
            raise OSError('create rejected existing table')
        self.kernel.on_batch = appears_before_create
        with self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel, 'activate')
        self.assertEqual(self.kernel.table, foreign)
        self.assertEqual([argv for argv, _ in self.kernel.calls].count(Kernel.BATCH), 1)
        self.assertFalse((self.f.slot / 'complete.json').exists())
        self.assertTrue((self.f.slot / '.firewall-failed').exists())

    def test_each_activation_fsync_failure_refuses_completion(self):
        original = os.fsync
        seen = 0
        def count(fd):
            nonlocal seen
            seen += 1
            return original(fd)
        with patch.object(os, 'fsync', side_effect=count):
            self.f.call(self.helper, self.kernel, 'activate')
        self.assertGreaterEqual(seen, 5)
        for failing in range(1, seen + 1):
            with self.subTest(fsync=failing):
                fixture = Fixture(self)
                kernel = Kernel(self, fixture)
                count_now = 0
                def fail(fd):
                    nonlocal count_now
                    count_now += 1
                    if count_now == failing:
                        raise OSError('synthetic fsync boundary')
                    return original(fd)
                with patch.object(os, 'fsync', side_effect=fail), self.assertRaises(ValueError):
                    fixture.call(self.helper, kernel, 'activate')
                self.assertTrue(fixture.slot.exists())
                self.assertTrue((fixture.slot / '.firewall-failed').exists())
                before = [argv for argv, _ in kernel.calls].count(Kernel.BATCH)
                with self.assertRaises(ValueError):
                    fixture.call(self.helper, kernel, 'activate')
                self.assertEqual([argv for argv, _ in kernel.calls].count(Kernel.BATCH), before)

    def test_default_runner_reaps_harmless_timeout_and_output_overflow(self):
        original = self.helper.subprocess.Popen
        processes = []
        def record(*args, **kwargs):
            process = original(*args, **kwargs)
            processes.append(process)
            return process
        harmless = (sys.executable, '-c', 'import time; time.sleep(5)')
        with patch.object(self.helper.subprocess, 'Popen', side_effect=record):
            with self.assertRaises(ValueError):
                self.helper._run_process(harmless, timeout=0.05)
        self.assertEqual(len(processes), 1)
        self.assertIsNotNone(processes[0].poll())
        output = (sys.executable, '-c', "import sys; sys.stdout.write('x'*4096)")
        with patch.object(self.helper.subprocess, 'Popen', side_effect=record):
            with self.assertRaises(ValueError):
                self.helper._run_process(output, timeout=2, output_limit=32)
        self.assertEqual(len(processes), 2)
        self.assertIsNotNone(processes[1].poll())

    def test_failure_after_complete_publication_still_poisons_slot(self):
        listed = 0
        def fail_late():
            nonlocal listed
            listed += 1
            # First list establishes post-create state; second is in final observe.
            if listed == 2:
                raise OSError('synthetic late list failure')
        self.kernel.on_list = fail_late
        with self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel, 'activate')
        self.assertTrue((self.f.slot / 'complete.json').exists())
        self.assertTrue((self.f.slot / '.firewall-failed').exists())
        self.kernel.on_list = None
        with self.assertRaises(ValueError):
            self.f.call(self.helper, self.kernel)

    def test_absent_observe_rechecks_table_after_last_staging_read(self):
        inventories = 0
        foreign = {'nftables': [{'table': {'family': 'inet',
            'name': 'eru_fresh_access', 'handle': 501}}]}
        def appeared(argv, input_bytes=None):
            nonlocal inventories
            self.assertEqual(tuple(argv), Kernel.INVENTORY)
            inventories += 1
            return wire({'nftables': []}) if inventories == 1 else wire(foreign)
        with self.assertRaises(ValueError):
            self.f.call(self.helper, appeared)
        self.assertEqual(inventories, 2)
        self.assertFalse(self.f.slot.exists())

    def test_response_timestamp_is_taken_after_final_ruleset_read(self):
        calls_at_clock = []
        class Clock:
            @staticmethod
            def now(zone):
                calls_at_clock.append([argv for argv, _ in self.kernel.calls].count(Kernel.TABLE))
                return self.f.now
        with patch.object(self.helper, 'datetime', Clock):
            result = self.helper.handle(self.f.request('activate'), root=str(self.f.root),
                owner_uid=os.getuid(), owner_gid=os.getgid(), runner=self.kernel)
        self.assertEqual(result['observed_at'], self.f.now.isoformat())
        self.assertEqual(calls_at_clock, [3])


class SSHIndependentReview(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(self)
        self.ssh = importlib.import_module('fresh_network_firewall_ssh')

    def test_data_only_bundle_has_fixed_sources_and_compiles(self):
        program = self.ssh.build_program(self.f.request())
        compile(program, '<fixed-firewall-review>', 'exec')
        self.assertNotIn('flush ruleset', program)
        self.assertNotIn(str(self.f.root), program)
        self.assertNotIn('importlib.import_module(', program)

    def test_trust_mismatch_and_bad_request_do_not_dispatch(self):
        calls = []
        adapter = self.ssh.SSHNetworkFirewallAdapter(self.f.keys,
            transport=lambda *args: calls.append(args))
        bad = copy.deepcopy(self.f.action)
        bad['host']['host_key_sha256'] = '1' * 64
        with self.assertRaises(ValueError):
            adapter.observe(bad)
        with self.assertRaises(ValueError):
            adapter.activate(self.f.action, 'NOT-A-SHA')
        self.assertEqual(calls, [])

    def test_fake_transport_accepts_host_evidence_only_with_current_binding(self):
        helper = importlib.import_module('fresh_network_firewall_host')
        kernel = Kernel(self, self.f)
        requests = []
        def transport(host, source, trusted):
            self.assertEqual(host['alias'], 'ckc-disposable-01')
            self.assertEqual(trusted, self.f.keys[host['alias']])
            requests.append(source)
            operation = 'activate' if len(requests) == 2 else 'observe'
            value = self.f.call(helper, kernel, operation)
            # The synthetic filesystem uses this process's uid/gid. The actual
            # SSH helper runs as root; map fixture metadata at this boundary.
            value['directory']['uid'] = value['directory']['gid'] = 0
            for row in value['files']:
                row['uid'] = row['gid'] = 0
            return wire(value)
        adapter = self.ssh.SSHNetworkFirewallAdapter(self.f.keys, transport=transport)
        self.assertEqual(adapter.observe(self.f.action)['table'], {'kind': 'absent'})
        self.assertEqual(adapter.activate(self.f.action, self.f.activation)['table']['kind'], 'present')
        self.assertEqual(len(requests), 2)
        self.assertEqual([argv for argv, _ in kernel.calls].count(Kernel.BATCH), 1)


if __name__ == '__main__':
    unittest.main()

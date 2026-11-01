"""Temporary staged roots, fake kernel and harmless synthetic subprocesses only."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import time
import unittest
from unittest.mock import patch

import test_fresh_network_staging_host as staging_fixture
from test_fresh_network_firewall import fixture
import fresh_network_firewall as policy
import fresh_network_staging_host as staging
import fresh_network_firewall_host as host


class FakeKernel:
    def __init__(self, action):
        self.action, self.table, self.calls = action, None, []
        self.before_create = None

    def __call__(self, argv, input_bytes=None):
        self.calls.append((tuple(argv), input_bytes))
        if tuple(argv) == host.INVENTORY:
            return staging._bytes({'nftables': [] if self.table is None else [self.table['nftables'][0]]})
        if tuple(argv) == host.LIST_TABLE:
            if self.table is None:
                raise ValueError('missing')
            return staging._bytes(self.table)
        if tuple(argv) != host.CREATE or type(input_bytes) is not bytes:
            raise AssertionError('unexpected command')
        if self.before_create:
            self.before_create()
        if self.table is not None:
            raise ValueError('already exists')
        batch = json.loads(input_bytes)
        expected = policy.expected_ruleset(self.action)['nftables']
        wanted = {'nftables': [{'create': expected[0]}] + [{'add': row} for row in expected[1:]]}
        if batch != wanted:
            raise AssertionError('unexpected mutation')
        self.table = {'nftables': copy.deepcopy(expected)}
        for index, row in enumerate(self.table['nftables']):
            next(iter(row.values()))['handle'] = index + 1
        return b''


class HostTests(unittest.TestCase):
    def setUp(self):
        staging_fixture.HostTests.setUp(self)
        self.action = policy.action(*fixture(getattr(self, 'index', 0)))
        self.action['host'].update(machine_id=self.machine, boot_id=self.boot,
                                  host_key_sha256=hashlib.sha256(base64.b64decode(self.key.split()[1])).hexdigest())
        stage = {k: copy.deepcopy(v) for k, v in self.action.items()
                 if k not in ('network', 'staging_intent_sha256', 'staging_receipt_sha256')}
        stage['operation'] = staging.OPERATION
        staging.handle({'schema_version': 1, 'operation': 'stage', 'action': stage,
                        'intent_sha256': self.action['staging_intent_sha256']},
                       root=str(self.root), owner_uid=os.getuid(), owner_gid=os.getgid(), now=self.now)
        self.request = {'schema_version': 1, 'operation': 'activate', 'action': self.action,
                        'intent_sha256': 'f' * 64}
        self.kernel = FakeKernel(self.action)
        self.slot = self.root / 'etc/eru/.fresh-network-firewall'

    def call(self, request=None):
        return host.handle(request or self.request, root=str(self.root), owner_uid=os.getuid(),
                           owner_gid=os.getgid(), now=self.now, runner=self.kernel)

    def observe(self):
        return self.call({'schema_version': 1, 'operation': 'observe', 'action': self.action})

    def test_activate_observe_no_replay(self):
        self.assertEqual(self.observe()['table'], {'kind': 'absent'})
        result = self.call()
        self.assertEqual(result, self.observe())
        self.assertEqual(result['table']['intent_sha256'], 'f' * 64)
        self.assertTrue(all(row['intent_sha256'] == 'd' * 64 for row in result['files']))
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(sum(argv == host.CREATE for argv, _ in self.kernel.calls), 1)
        self.assertFalse((self.slot / '.firewall-failed').exists())

    def test_no_nft_before_staging_and_policy_validation(self):
        (self.root / 'etc/eru/fresh-access.nft').write_text('tampered')
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(self.kernel.calls, [])
        self.assertFalse(self.slot.exists())

    def test_durable_intent_precedes_single_create(self):
        def before():
            self.assertEqual(set(p.name for p in self.slot.iterdir()), {'intent.json'})
            self.assertEqual(json.loads((self.slot / 'intent.json').read_bytes()),
                             {'schema_version': 1, 'action': self.action, 'intent_sha256': 'f' * 64})
        self.kernel.before_create = before
        self.call()
        self.assertEqual(set(p.name for p in self.slot.iterdir()), {'intent.json', 'complete.json'})

    def test_foreign_and_create_race_are_preserved(self):
        self.kernel.table = policy.expected_ruleset(self.action)
        self.kernel.table['nftables'][0]['table']['handle'] = 42
        original = copy.deepcopy(self.kernel.table)
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(self.kernel.table, original)
        self.assertFalse(self.slot.exists())
        self.kernel.table = None
        self.kernel.before_create = lambda: setattr(self.kernel, 'table', original)
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(self.kernel.table, original)
        self.assertTrue((self.slot / '.firewall-failed').exists())
        with self.assertRaises(ValueError):
            self.observe()

    def test_changed_handle_and_missing_handles_rejected(self):
        self.call()
        self.kernel.table['nftables'][0]['table']['handle'] += 10
        with self.assertRaises(ValueError):
            self.observe()
        self.kernel.table['nftables'][0]['table']['handle'] -= 10
        del self.kernel.table['nftables'][2]['rule']['handle']
        with self.assertRaises(ValueError):
            self.observe()

    def test_readonly_observe(self):
        result = self.call()
        original = os.open
        def readonly(path, flags, *args, **kwargs):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=readonly), \
                patch.object(os, 'mkdir', side_effect=AssertionError('write')), \
                patch.object(os, 'fsync', side_effect=AssertionError('write')):
            self.assertEqual(result, self.observe())

    def test_strict_pure_request_and_policy(self):
        with patch.object(os, 'open', side_effect=AssertionError('IO')):
            self.assertEqual(host.validate_request(self.request), self.request)
            for field in ('root', 'owner_uid', 'runner', 'command', 'now'):
                with self.assertRaises(ValueError):
                    host.validate_request({**self.request, field: 'forbidden'})
        bad = copy.deepcopy(self.request)
        bad['action']['host']['files'][0]['content'] = 'flush ruleset\n'
        bad['action']['host']['files'][0]['sha256'] = hashlib.sha256(b'flush ruleset\n').hexdigest()
        with self.assertRaises(ValueError):
            host.validate_request(bad)

    def test_invalid_inventory_never_proves_absence(self):
        invalid = [b'{"nftables":[],"nftables":[]}', b'{"nftables":[NaN]}',
                   b'{"nftables":[1e999]}', b'[]', b'not JSON', b' ' * (host.LIMIT + 1),
                   'not bytes', b'{"nftables":[{"rule":{}}]}',
                   b'{"nftables":[{"table":{"family":"ip","name":"foreign","handle":1}}]}',
                   b'{"nftables":[{"table":{"family":"inet","name":"foreign"}}]}']
        for raw in invalid:
            with self.subTest(raw=str(raw)[:60]), self.assertRaises(ValueError):
                host.handle(self.request, root=str(self.root), owner_uid=os.getuid(),
                            owner_gid=os.getgid(), runner=lambda *_: raw)
            self.assertFalse(self.slot.exists())
        def error(*_):
            raise ValueError('No such file or directory SECRET')
        with self.assertRaisesRegex(ValueError, '^network firewall unavailable$'):
            host.handle(self.request, root=str(self.root), owner_uid=os.getuid(),
                        owner_gid=os.getgid(), runner=error)
        self.assertFalse(self.slot.exists())

    def test_staging_intent_and_safe_attributes_are_required(self):
        bad = copy.deepcopy(self.request)
        bad['action']['staging_intent_sha256'] = '1' * 64
        with self.assertRaises(ValueError):
            self.call(bad)
        for name in ('fresh-access.nft', 'known_hosts'):
            path = self.root / 'etc/eru' / name
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                self.call()
            path.chmod(0o600)
        self.assertEqual(self.kernel.calls, [])

    def test_raw_staging_identity_and_intent_drift_before_create(self):
        original = host._Session.publish
        for target in ('etc/eru/fresh-access.nft', 'etc/machine-id',
                       'etc/eru/.fresh-network-stage/intent.json',
                       'etc/eru/.fresh-network-firewall/intent.json'):
            case = HostTests()
            case.setUp()
            def drift(session, directory, name, raw):
                original(session, directory, name, raw)
                if directory == host.SLOT_PATH and name == 'intent.json':
                    path = case.root / target
                    path.write_bytes(path.read_bytes() + b' ')
            try:
                with patch.object(host._Session, 'publish', new=drift), self.assertRaises(ValueError):
                    case.call()
                self.assertFalse(any(argv == host.CREATE for argv, _ in case.kernel.calls))
                self.assertTrue((case.slot / '.firewall-failed').exists())
            finally:
                case.doCleanups()

    def test_every_fsync_failure_rejects_and_never_replays(self):
        original = os.fsync
        count = []
        def counted(fd):
            count.append(fd)
            return original(fd)
        with patch.object(os, 'fsync', side_effect=counted):
            self.call()
        self.assertGreaterEqual(len(count), 5)
        for failing in range(1, len(count) + 1):
            case, calls = HostTests(), []
            case.setUp()
            def fail(fd):
                calls.append(fd)
                if len(calls) == failing:
                    raise OSError('synthetic fsync failure')
                return original(fd)
            try:
                with self.subTest(fsync=failing), patch.object(os, 'fsync', side_effect=fail), \
                        self.assertRaises(ValueError):
                    case.call()
                self.assertTrue((case.slot / '.firewall-failed').exists())
                with self.assertRaises(ValueError):
                    case.observe()
                with self.assertRaises(ValueError):
                    case.call()
                self.assertLessEqual(sum(argv == host.CREATE for argv, _ in case.kernel.calls), 1)
            finally:
                case.doCleanups()

    def test_kernel_success_then_exception_is_incomplete_forever(self):
        original = self.kernel
        def lost(argv, input_bytes=None):
            result = original(argv, input_bytes)
            if tuple(argv) == host.CREATE:
                raise OSError('lost output')
            return result
        with self.assertRaises(ValueError):
            host.handle(self.request, root=str(self.root), owner_uid=os.getuid(),
                        owner_gid=os.getgid(), now=self.now, runner=lost)
        self.assertIsNotNone(self.kernel.table)
        self.assertFalse((self.slot / 'complete.json').exists())
        with self.assertRaises(ValueError):
            self.observe()
        with self.assertRaises(ValueError):
            self.call()

    def test_complete_drift_extra_files_and_table_loss_reject(self):
        self.call()
        for name in ('intent.json', 'complete.json'):
            path = self.slot / name
            raw = path.read_bytes()
            path.write_bytes(raw + b' ')
            with self.assertRaises(ValueError):
                self.observe()
            path.write_bytes(raw)
        (self.slot / 'extra').write_bytes(b'')
        with self.assertRaises(ValueError):
            self.observe()
        (self.slot / 'extra').unlink()
        self.kernel.table = None
        with self.assertRaises(ValueError):
            self.observe()
        with self.assertRaises(ValueError):
            self.call()

    def test_claim_replacement_never_writes_or_poisons_foreign_slot(self):
        original, replaced = os.open, []
        def replace(path, flags, *args, **kwargs):
            if path == host.SLOT and flags & os.O_DIRECTORY and not replaced:
                replaced.append(True)
                self.slot.rename(self.slot.with_name('original-claim'))
                self.slot.mkdir(mode=0o700)
                (self.slot / 'foreign').write_text('untouched')
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=replace), self.assertRaises(ValueError):
            self.call()
        self.assertEqual([p.name for p in self.slot.iterdir()], ['foreign'])
        self.assertEqual(list(self.slot.with_name('original-claim').iterdir()), [])
        self.assertFalse(any(argv == host.CREATE for argv, _ in self.kernel.calls))

    def test_owned_slot_replacement_keeps_poison_on_pinned_original(self):
        original = host._Session.publish
        def replace(session, directory, name, raw):
            original(session, directory, name, raw)
            if directory == host.SLOT_PATH and name == 'intent.json':
                self.slot.rename(self.slot.with_name('original-claim'))
                self.slot.mkdir(mode=0o700)
        with patch.object(host._Session, 'publish', new=replace), self.assertRaises(ValueError):
            self.call()
        self.assertEqual(list(self.slot.iterdir()), [])
        self.assertTrue((self.slot.with_name('original-claim') / '.firewall-failed').exists())

    def test_concurrent_claim_loser_does_not_poison_winner(self):
        from concurrent.futures import ThreadPoolExecutor
        import threading
        barrier, original = threading.Barrier(2), os.mkdir
        def claim(name, *args, **kwargs):
            if name == host.SLOT:
                barrier.wait(timeout=5)
            return original(name, *args, **kwargs)
        def run(_):
            try:
                return self.call()
            except ValueError:
                return None
        with patch.object(os, 'mkdir', side_effect=claim), ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, range(2)))
        self.assertEqual(sum(r is not None for r in results), 1)
        self.assertFalse((self.slot / '.firewall-failed').exists())
        self.assertEqual(self.observe(), next(r for r in results if r))

    def test_final_table_and_staging_drift_are_detected(self):
        self.call()
        original, count = self.kernel, []
        def drift(argv, input_bytes=None):
            result = original(argv, input_bytes)
            if tuple(argv) == host.LIST_TABLE:
                count.append(True)
                if len(count) == 1:
                    self.kernel.table['nftables'][0]['table']['handle'] += 100
            return result
        with self.assertRaises(ValueError):
            host.handle({'schema_version': 1, 'operation': 'observe', 'action': self.action},
                        root=str(self.root), owner_uid=os.getuid(), owner_gid=os.getgid(), runner=drift)
        self.assertFalse((self.slot / '.firewall-failed').exists())

    def test_main_strict_decode_redacted_error(self):
        import contextlib
        import io
        for raw in (b'{"schema_version":1,"schema_version":1}', b'{"a":NaN}',
                    b'[' * 1000 + b']' * 1000, b'x' * (host.LIMIT + 1),
                    json.dumps({**self.request, 'root': '/SECRET'}).encode()):
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                    self.assertRaises(SystemExit):
                host.main(base64.b64encode(raw).decode())
            self.assertEqual(out.getvalue(), '')
            self.assertEqual(err.getvalue(), 'network firewall unavailable\n')

    def test_all_four_roles_send_only_derived_create_batch(self):
        for index in range(4):
            case = HostTests()
            case.index = index
            case.setUp()
            try:
                result = case.call()
                policy.validate_ruleset(result['table']['ruleset'], case.action)
                self.assertEqual(sum(argv == host.CREATE for argv, _ in case.kernel.calls), 1)
                self.assertEqual(case.observe(), result)
            finally:
                case.doCleanups()

    def test_metainfo_changes_are_nonsemantic_but_rules_and_handles_are_bound(self):
        self.call()
        self.kernel.table['nftables'].insert(0, {'metainfo': {
            'version': 'fixture', 'release_name': 'fixture', 'json_schema_version': 1}})
        original = self.kernel
        def with_metadata(argv, input_bytes=None):
            if tuple(argv) == host.INVENTORY:
                return staging._bytes({'nftables': [self.kernel.table['nftables'][0],
                                                  self.kernel.table['nftables'][1]]})
            return original(argv, input_bytes)
        request = {'schema_version': 1, 'operation': 'observe', 'action': self.action}
        result = host.handle(request, root=str(self.root), owner_uid=os.getuid(),
                             owner_gid=os.getgid(), now=self.now, runner=with_metadata)
        self.assertEqual(result['table']['kind'], 'present')
        self.kernel.table['nftables'][3]['rule']['expr'][-1] = {'drop': None}
        with self.assertRaises(ValueError):
            host.handle(request, root=str(self.root), owner_uid=os.getuid(),
                        owner_gid=os.getgid(), now=self.now, runner=with_metadata)

    def test_all_output_handles_required_before_completion(self):
        for offset in (0, 1, 2):
            case = HostTests()
            case.setUp()
            original = case.kernel
            def missing(argv, input_bytes=None):
                result = original(argv, input_bytes)
                if tuple(argv) == host.CREATE:
                    del next(iter(case.kernel.table['nftables'][offset].values()))['handle']
                return result
            try:
                with self.assertRaises(ValueError):
                    host.handle(case.request, root=str(case.root), owner_uid=os.getuid(),
                                owner_gid=os.getgid(), now=case.now, runner=missing)
                self.assertFalse((case.slot / 'complete.json').exists())
                self.assertTrue((case.slot / '.firewall-failed').exists())
            finally:
                case.doCleanups()

    def test_complete_safe_path_attributes_and_modes(self):
        self.call()
        self.slot.chmod(0o755)
        with self.assertRaises(ValueError):
            self.observe()
        self.slot.chmod(0o700)
        path = self.slot / 'complete.json'
        path.chmod(0o644)
        with self.assertRaises(ValueError):
            self.observe()
        path.chmod(0o600)
        alias = self.root / 'complete-alias'
        os.link(path, alias)
        with self.assertRaises(ValueError):
            self.observe()
        alias.unlink()
        path.rename(alias)
        path.symlink_to(alias)
        with self.assertRaises(ValueError):
            self.observe()

    def test_import_is_io_free_and_final_timestamp_follows_reads(self):
        import importlib
        import datetime
        with patch.object(os, 'open', side_effect=AssertionError('IO')), \
                patch.object(host.subprocess, 'Popen', side_effect=AssertionError('process')):
            importlib.reload(host)
        events, original = [], self.kernel
        def runner(argv, input_bytes=None):
            events.append('runner')
            return original(argv, input_bytes)
        class Clock:
            @staticmethod
            def now(zone):
                events.append('clock')
                return datetime.datetime(2026, 10, 4, tzinfo=zone)
        with patch.object(host, 'datetime', Clock):
            host.handle(self.request, root=str(self.root), owner_uid=os.getuid(),
                        owner_gid=os.getgid(), runner=runner)
        self.assertEqual(events[-1], 'clock')


class ProcessTests(unittest.TestCase):
    def test_bounded_success_and_error(self):
        self.assertEqual(host._run_process((sys.executable, '-c', 'import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())'),
                                          b'fixture', timeout=2), b'fixture')
        for code in ('import sys; sys.exit(1)', 'import time; time.sleep(5)',
                     'import sys; sys.stdout.write("x" * 10000)',
                     'import sys; sys.stderr.write("x" * 10000)'):
            with self.assertRaises(ValueError):
                host._run_process((sys.executable, '-c', code), timeout=0.1, output_limit=1024)

    def test_default_runner_never_accepts_arbitrary_command(self):
        with patch.object(host, '_run_process', side_effect=AssertionError('dispatch')):
            with self.assertRaises(ValueError):
                host._runner(('/bin/echo', 'SECRET'))

    def test_timeout_kills_descendants_and_reaps_parent(self):
        import tempfile
        import subprocess
        original, children = subprocess.Popen, []
        def spawn(*args, **kwargs):
            process = original(*args, **kwargs)
            children.append(process)
            return process
        with tempfile.TemporaryDirectory() as temp:
            pidfile = Path(temp) / 'child.pid'
            code = ('import os,time; p=os.fork(); '
                    'open(' + repr(str(pidfile)) + ',"w").write(str(p)) if p else None; '
                    'time.sleep(30)')
            start = time.monotonic()
            with patch.object(subprocess, 'Popen', side_effect=spawn), self.assertRaises(ValueError):
                host._run_process((sys.executable, '-c', code), timeout=0.3)
            self.assertLess(time.monotonic() - start, 3)
            self.assertIsNotNone(children[0].returncode)
            pid = int(pidfile.read_text())
            for _ in range(100):
                state = Path('/proc') / str(pid) / 'stat'
                if not state.exists():
                    break
                try:
                    process_state = state.read_text()
                except FileNotFoundError:
                    break
                if process_state.split()[2] == 'Z':
                    break
                time.sleep(0.01)
            else:
                self.fail('descendant remains running')

    def test_controlled_process_environment_and_input_bounds(self):
        import subprocess
        original, settings = subprocess.Popen, []
        def spawn(*args, **kwargs):
            settings.append(kwargs)
            return original(*args, **kwargs)
        with patch.object(subprocess, 'Popen', side_effect=spawn):
            self.assertEqual(host._run_process((sys.executable, '-c', 'print("safe")')), b'safe\n')
        self.assertEqual(settings[0]['env'], {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin',
                                             'LANG': 'C', 'LC_ALL': 'C'})
        self.assertIs(settings[0]['shell'], False)
        self.assertIs(settings[0]['start_new_session'], True)
        self.assertIs(settings[0]['close_fds'], True)
        with patch.object(subprocess, 'Popen', side_effect=AssertionError('dispatch')):
            for payload in ('string', b'x' * (host.LIMIT + 1)):
                with self.assertRaises(ValueError):
                    host._run_process((sys.executable, '-c', 'pass'), payload)

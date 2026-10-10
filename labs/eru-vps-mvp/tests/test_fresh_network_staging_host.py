"""Real temporary filesystem checks; never contacts a host."""
import base64
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_staging_host as host


class HostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('etc/eru', 'etc/ssh', 'proc/sys/kernel/random'):
            (self.root / name).mkdir(parents=True, mode=0o700)
        self.key = 'ssh-ed25519 ' + base64.b64encode(
            b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + b'a' * 32).decode()
        self.machine, self.boot = 'replacement-machine-1', '00000000-0000-0000-0000-000000000001'
        for name, value in (('etc/machine-id', self.machine),
                            ('proc/sys/kernel/random/boot_id', self.boot),
                            ('etc/ssh/ssh_host_ed25519_key.pub', self.key + ' fixture')):
            (self.root / name).write_text(value + '\n')
        for path in self.root.rglob('*'):
            path.chmod(0o700 if path.is_dir() else 0o600)
        self.files = [{'path': '/etc/eru/' + name, 'mode': '0600', 'content': value,
                       'sha256': hashlib.sha256(value.encode()).hexdigest()}
                      for name, value in [('fresh-access.nft', 'table inet fixture {}\n'),
                                          ('known_hosts', 'fixture host key\n')]]
        self.action = {'schema_version': 1, 'operation': 'fresh-network-file-staging',
            'plan_id': 'plan-1', 'run_id': 'run-1', 'plan_sha256': 'a' * 64,
            'execution_sha256': 'b' * 64, 'pending_sha256': 'c' * 64, 'host_index': 0,
            'host': {'alias': 'ckc-disposable-01', 'node': 'worker-1', 'ip': '100.91.0.1',
                     'machine_id': self.machine, 'boot_id': self.boot,
                     'host_key_sha256': hashlib.sha256(base64.b64decode(self.key.split()[1])).hexdigest(),
                     'files': self.files}}
        self.request = {'schema_version': 1, 'operation': 'stage', 'action': self.action,
                        'intent_sha256': 'd' * 64}
        self.now = datetime(2026, 10, 4, tzinfo=timezone.utc)

    def call(self, request=None):
        return host.handle(request or self.request, root=str(self.root),
                           owner_uid=os.getuid(), owner_gid=os.getgid(), now=self.now)

    def observe(self):
        return self.call({'schema_version': 1, 'operation': 'observe', 'action': self.action})

    def test_existing_target_is_not_overwritten_or_claimed(self):
        path = self.root / 'etc/eru/fresh-access.nft'
        path.write_text('existing')
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(path.read_text(), 'existing')
        self.assertFalse((self.root / 'etc/eru/.fresh-network-stage').exists())

    def test_symlink_target_is_not_followed(self):
        (self.root / 'etc/eru/fresh-access.nft').symlink_to(self.root / 'etc/machine-id')
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual((self.root / 'etc/machine-id').read_text().strip(), self.machine)

    def test_stage_observe_and_no_replay(self):
        self.assertEqual([r['kind'] for r in self.observe()['files']], ['absent'] * 2)
        result = self.call()
        self.assertEqual(self.observe(), result)
        self.assertEqual([r['intent_sha256'] for r in result['files']], ['d' * 64] * 2)
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(self.observe(), result)

    def test_schema_validation_is_pure_and_defensively_copied(self):
        with patch.object(os, 'open', side_effect=AssertionError('IO')):
            copied = host.validate_request(self.request)
            copied['action']['host']['files'][0]['content'] = 'changed'
            self.assertNotEqual(copied, self.request)
            for field, value in [('root', '/evil'), ('owner_uid', 0), ('command', 'evil')]:
                with self.assertRaises(ValueError):
                    host.validate_request({**self.request, field: value})
        for modifier in (lambda r: r.update(schema_version=True),
                         lambda r: r['action'].update(host_index=True),
                         lambda r: r['action']['host'].update(ip='203.0.113.1'),
                         lambda r: r['action']['host'].update(alias='unknown'),
                         lambda r: r['action']['host']['files'][0].update(path='/evil'),
                         lambda r: r['action']['host']['files'][0].update(sha256='e' * 64),
                         lambda r: r['action']['host']['files'][0].update(content='x' * 65537)):
            value = copy.deepcopy(self.request)
            modifier(value)
            with self.assertRaises(ValueError):
                host.validate_request(value)

    def test_absent_eru_is_never_created(self):
        (self.root / 'etc/eru').rmdir()
        with self.assertRaises(ValueError):
            self.call()
        self.assertFalse((self.root / 'etc/eru').exists())

    def test_owner_mode_hardlink_and_identity_fail_before_claim(self):
        for name, mode in [('etc', 0o777), ('etc/eru', 0o755), ('etc/machine-id', 0o666)]:
            path = self.root / name
            original = path.stat().st_mode & 0o777
            path.chmod(mode)
            with self.assertRaises(ValueError):
                self.call()
            path.chmod(original)
        with self.assertRaises(ValueError):
            host.handle(self.request, root=str(self.root), owner_uid=os.getuid() + 1,
                        owner_gid=os.getgid(), now=self.now)
        machine = self.root / 'etc/machine-id'
        os.link(machine, self.root / 'other')
        with self.assertRaises(ValueError):
            self.call()
        (self.root / 'other').unlink()
        machine.write_text('other-machine\n')
        with self.assertRaises(ValueError):
            self.call()
        self.assertFalse((self.root / 'etc/eru/.fresh-network-stage').exists())

    def test_readonly_observe_performs_no_write_syscall(self):
        expected = self.call()
        original = os.open
        def readonly(path, flags, *args, **kwargs):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=readonly), \
                patch.object(os, 'mkdir', side_effect=AssertionError('write')), \
                patch.object(os, 'fsync', side_effect=AssertionError('write')), \
                patch.object(os, 'link', side_effect=AssertionError('write')), \
                patch.object(os, 'unlink', side_effect=AssertionError('write')):
            self.assertEqual(self.observe(), expected)

    def test_partial_publication_retained_and_cannot_replay(self):
        original = host._Session.publish
        def crash(session, directory, name, raw):
            original(session, directory, name, raw)
            if name == 'fresh-access.nft':
                raise OSError('synthetic crash')
        with patch.object(host._Session, 'publish', new=crash), self.assertRaises(ValueError):
            self.call()
        self.assertTrue((self.root / 'etc/eru/fresh-access.nft').exists())
        self.assertFalse((self.root / 'etc/eru/known_hosts').exists())
        self.assertTrue((self.root / 'etc/eru/.fresh-network-stage/.staging-failed').exists())
        with self.assertRaises(ValueError):
            self.observe()
        with self.assertRaises(ValueError):
            self.call()

    def test_post_intent_raw_identity_and_directory_drift(self):
        original = os.link
        def drift(source, destination, *args, **kwargs):
            result = original(source, destination, *args, **kwargs)
            if destination == 'intent.json':
                path = self.root / 'etc/machine-id'
                path.write_bytes(path.read_bytes() + b' ')
            return result
        with patch.object(os, 'link', side_effect=drift), self.assertRaises(ValueError):
            self.call()
        self.assertFalse((self.root / 'etc/eru/fresh-access.nft').exists())

    def test_directory_replacement_after_intent_fails(self):
        original = os.link
        def drift(source, destination, *args, **kwargs):
            result = original(source, destination, *args, **kwargs)
            if destination == 'intent.json':
                (self.root / 'etc/ssh').rename(self.root / 'etc/old-ssh')
                (self.root / 'etc/ssh').mkdir(mode=0o700)
                (self.root / 'etc/ssh/ssh_host_ed25519_key.pub').write_text(self.key + '\n')
                (self.root / 'etc/ssh/ssh_host_ed25519_key.pub').chmod(0o600)
            return result
        with patch.object(os, 'link', side_effect=drift), self.assertRaises(ValueError):
            self.call()
        self.assertFalse((self.root / 'etc/eru/fresh-access.nft').exists())

    def test_raw_intent_drift_after_atomic_link_prevents_payload(self):
        original = os.link
        def drift(source, destination, *args, **kwargs):
            result = original(source, destination, *args, **kwargs)
            if destination == 'intent.json':
                path = self.root / 'etc/eru/.fresh-network-stage/intent.json'
                path.write_bytes(path.read_bytes() + b' ')
            return result
        with patch.object(os, 'link', side_effect=drift), self.assertRaises(ValueError):
            self.call()
        self.assertFalse((self.root / 'etc/eru/fresh-access.nft').exists())

    def test_complete_journal_tamper_and_extra_files_reject(self):
        self.call()
        slot = self.root / 'etc/eru/.fresh-network-stage'
        for name in ('intent.json', 'complete.json'):
            path = slot / name
            original = path.read_bytes()
            path.write_bytes(original + b' ')
            with self.assertRaises(ValueError):
                self.observe()
            path.write_bytes(original)
        (slot / 'unknown').write_bytes(b'')
        with self.assertRaises(ValueError):
            self.observe()

    def test_different_action_and_intent_cannot_replay(self):
        result = self.call()
        changed = copy.deepcopy(self.request)
        changed['intent_sha256'] = 'f' * 64
        with self.assertRaises(ValueError):
            self.call(changed)
        self.assertEqual(self.observe(), result)
        self.action['plan_id'] = 'other-plan'
        with self.assertRaises(ValueError):
            self.observe()

    def test_complete_fsync_failure_retains_poison(self):
        original = os.fsync
        complete = self.root / 'etc/eru/.fresh-network-stage/complete.json'
        fired = []
        def fail(fd):
            if complete.exists() and not fired:
                fired.append(True)
                raise OSError('late failure')
            return original(fd)
        with patch.object(os, 'fsync', side_effect=fail), self.assertRaises(ValueError):
            self.call()
        self.assertTrue(complete.exists())
        with self.assertRaises(ValueError):
            self.observe()

    def test_concurrent_claim_loser_cannot_poison_winner(self):
        from concurrent.futures import ThreadPoolExecutor
        import threading
        barrier = threading.Barrier(2)
        original = os.mkdir
        def claim(name, *args, **kwargs):
            if name == host.SLOT:
                barrier.wait(timeout=10)
            return original(name, *args, **kwargs)
        def run(_):
            try:
                return self.call()
            except ValueError:
                return None
        with patch.object(os, 'mkdir', side_effect=claim), ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, range(2)))
        self.assertEqual(sum(result is not None for result in results), 1)
        self.assertFalse((self.root / 'etc/eru/.fresh-network-stage/.staging-failed').exists())
        self.assertEqual(self.observe(), next(result for result in results if result))

    def test_main_strict_decode_redaction_and_no_wire_override(self):
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
            self.assertEqual(err.getvalue(), 'network staging unavailable\n')
        with patch.object(host, 'handle', return_value={'ok': True}) as called, \
                contextlib.redirect_stdout(io.StringIO()):
            host.main(base64.b64encode(json.dumps(self.request).encode()).decode())
        called.assert_called_once_with(self.request)

    def test_final_absence_rechecked_during_observe(self):
        original = host._Session.check
        counts = []
        def inserted(session):
            original(session)
            counts.append(True)
            if len(counts) == 3:
                (self.root / 'etc/eru/known_hosts').write_text('foreign')
        with patch.object(host._Session, 'check', new=inserted), self.assertRaises(ValueError):
            self.observe()

    def test_published_file_mode_hardlink_and_bytes_reject(self):
        self.call()
        path = self.root / 'etc/eru/fresh-access.nft'
        path.chmod(0o644)
        with self.assertRaises(ValueError):
            self.observe()
        path.chmod(0o600)
        os.link(path, self.root / 'alias')
        with self.assertRaises(ValueError):
            self.observe()
        (self.root / 'alias').unlink()
        path.write_text('other-content')
        with self.assertRaises(ValueError):
            self.observe()

    def test_eru_directory_swap_during_intent_retains_original_poison(self):
        original = os.link
        def swapped(source, destination, *args, **kwargs):
            result = original(source, destination, *args, **kwargs)
            if destination == 'intent.json':
                (self.root / 'etc/eru').rename(self.root / 'etc/old-eru')
                (self.root / 'etc/eru').mkdir(mode=0o700)
            return result
        with patch.object(os, 'link', side_effect=swapped), self.assertRaises(ValueError):
            self.call()
        self.assertEqual(list((self.root / 'etc/eru').iterdir()), [])
        self.assertTrue((self.root / 'etc/old-eru/.fresh-network-stage/.staging-failed').exists())

    def test_zero_stat_size_does_not_skip_boot_id_bytes(self):
        original = os.fstat
        target = (self.root / 'proc/sys/kernel/random/boot_id').stat().st_ino
        class ProcInfo:
            def __init__(self, info):
                self.info = info
            def __getattr__(self, key):
                return 0 if key == 'st_size' else getattr(self.info, key)
        def proc_info(fd):
            info = original(fd)
            return ProcInfo(info) if info.st_ino == target else info
        real_stat = os.stat
        def proc_stat(*args, **kwargs):
            info = real_stat(*args, **kwargs)
            return ProcInfo(info) if info.st_ino == target else info
        with patch.object(os, 'fstat', side_effect=proc_info), patch.object(os, 'stat', side_effect=proc_stat):
            self.assertEqual([row['kind'] for row in self.call()['files']], ['regular'] * 2)

    def test_claim_directory_replacement_cannot_receive_writes_or_poison(self):
        original = os.open
        swapped = []
        slot = self.root / 'etc/eru/.fresh-network-stage'
        def replace(path, flags, *args, **kwargs):
            if path == host.SLOT and flags & os.O_DIRECTORY and not swapped:
                swapped.append(True)
                slot.rename(self.root / 'etc/eru/original-claim')
                slot.mkdir(mode=0o700)
                (slot / 'foreign').write_text('unrelated')
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=replace), self.assertRaises(ValueError):
            self.call()
        self.assertEqual(sorted(p.name for p in slot.iterdir()), ['foreign'])
        self.assertFalse((self.root / 'etc/eru/fresh-access.nft').exists())
        self.assertEqual(list((self.root / 'etc/eru/original-claim').iterdir()), [])

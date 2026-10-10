"""Synthetic SHA trailer fixtures are not bbolt or authentic etcd snapshots."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import metadata_backup as mb


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        (self.project / 'private/backup').mkdir(parents=True, mode=0o700)
        (self.project / 'private').chmod(0o700)
        self.snapshot = b'S' * 512
        self.snapshot += hashlib.sha256(self.snapshot).digest()
        self.manifest = {'schema': 'eru.metadata-backup.v1', 'backup_id': 'fixture',
            'cluster_id': 'cluster', 'generation': 1, 'etcd_version': 'v3.6.14',
            'captured_at': '2026-10-09T00:00:00Z',
            'capture_method': 'etcdctl-snapshot-save', 'scope': 'full-keyspace',
            'snapshot': {'file': 'snapshot.db', 'bytes': len(self.snapshot),
                         'sha256': sha(self.snapshot)}}
        self.request = {'schema': 'eru.metadata-restore-request.v1',
            'recovery_id': 'recovery', 'cluster_token': 'review-token',
            'members': [{'name': 'node', 'peer_url': 'https://example.invalid:2380',
                         'data_dir': '/var/lib/etcd-recovery/recovery/node'}]}
        self.write('private/backup/snapshot.db', self.snapshot)
        self.write('artifacts.amd64.lock.json', json.dumps({'artifacts': [
            {'repository': 'etcd-io/etcd', 'tag': 'v3.6.14'}]}).encode())
        self.save_manifest()
        self.save_request()

    def write(self, path, raw):
        target = self.project / path
        target.write_bytes(raw)
        target.chmod(0o600)
        return sha(raw)

    def save_manifest(self, raw=None):
        self.manifest_sha = self.write('private/backup/manifest.json',
            json.dumps(self.manifest).encode() if raw is None else raw)

    def save_request(self, raw=None):
        self.request_sha = self.write('private/backup/restore.json',
            json.dumps(self.request).encode() if raw is None else raw)

    def verify(self, **kwargs):
        return mb.verify(self.project, kwargs.pop('manifest', 'private/backup/manifest.json'),
            kwargs.pop('sha256', self.manifest_sha), kwargs.pop('cluster', 'cluster'),
            kwargs.pop('generation', 1), **kwargs)

    def plan(self, plan_id='plan'):
        return mb.plan_restore(self.project, 'private/backup/manifest.json',
            self.manifest_sha, 'cluster', 1, 'private/backup/restore.json',
            self.request_sha, plan_id)

    def test_synthetic_integrity_only(self):
        with patch('subprocess.run', side_effect=AssertionError('external call')):
            result = self.verify()
        self.assertEqual(result['status'], 'integrity-verified')
        self.assertFalse(result['execution_allowed'])
        self.assertFalse(result['bbolt_validated'])
        self.assertFalse(result['live_validated'])
        self.assertEqual(result['snapshot_sha256'], sha(self.snapshot))
        self.assertTrue(all(x == 'UNEXECUTED' for x in result['gates'].values()))
        self.assertNotIn('cluster', result)

    def test_raw_hash_cluster_generation_and_version_bindings(self):
        for args in [{'sha256': '0'*64}, {'cluster': 'other'}, {'generation': 2},
                     {'generation': True}, {'sha256': self.manifest_sha.upper()}]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.verify(**args)
        self.manifest['etcd_version'] = 'v3.6.13'
        self.save_manifest()
        with self.assertRaises(ValueError):
            self.verify()

    def test_checksum_and_lengths(self):
        for raw in [self.snapshot[:-1], b'X'*544, b'X'*512, self.snapshot+b'X'*512]:
            with self.subTest(length=len(raw)):
                self.write('private/backup/snapshot.db', raw)
                self.manifest['snapshot'].update(bytes=len(raw), sha256=sha(raw))
                self.save_manifest()
                with self.assertRaises(ValueError):
                    self.verify()

    def test_exact_schema_types_and_json(self):
        baseline = copy.deepcopy(self.manifest)
        for key, value in [('generation', True), ('generation', -1),
                ('generation', 2**63), ('backup_id', 'bad/path'),
                ('captured_at', '2026-10-09T00:00:00+01:00'),
                ('captured_at', '2026-02-30T00:00:00Z'), ('extra', 1),
                ('scope', 'partial'), ('snapshot', {'file': 'other'})]:
            self.manifest = {**baseline, key: value}
            self.save_manifest()
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.verify()
        for raw in [b'{"schema":1,"schema":2}', b'{"generation":NaN}',
                    b'['*100+b'0'+b']'*100, b' '*65537]:
            self.save_manifest(raw)
            with self.assertRaises(ValueError):
                self.verify()

    def test_private_paths_permissions_and_aliases(self):
        for path in ['private/../private/backup/manifest.json',
                     'private//backup/manifest.json', './private/backup/manifest.json',
                     'artifacts.amd64.lock.json']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.verify(manifest=path)
        for path in ['private', 'private/backup', 'private/backup/manifest.json']:
            target = self.project / path
            old = target.stat().st_mode & 0o777
            target.chmod(old | 0o040)
            with self.assertRaises(ValueError):
                self.verify()
            target.chmod(old)
        os.link(self.project/'private/backup/manifest.json', self.project/'private/backup/alias')
        with self.assertRaises(ValueError):
            self.verify()

    def test_symlink_fifo_and_root_symlink(self):
        path = self.project/'private/backup/snapshot.db'
        path.unlink()
        path.symlink_to('manifest.json')
        with self.assertRaises((ValueError, OSError)):
            self.verify()
        path.unlink()
        os.mkfifo(path, 0o600)
        with self.assertRaises(ValueError):
            self.verify()
        path.unlink()
        self.write('private/backup/snapshot.db', self.snapshot)
        (self.project/'private').rename(self.project/'saved')
        (self.project/'private').symlink_to('saved', target_is_directory=True)
        with self.assertRaises((ValueError, OSError)):
            self.verify()

    def test_plan_is_private_nonexecuting_and_exclusive(self):
        result = self.plan()
        planpath = self.project/'private/metadata/restore-plans/plan/plan.json'
        plan = json.loads(planpath.read_bytes())
        self.assertEqual(result['status'], 'review-only')
        self.assertEqual(result['plan_sha256'], sha(planpath.read_bytes()))
        self.assertEqual(planpath.stat().st_mode & 0o777, 0o600)
        self.assertEqual(planpath.parent.stat().st_mode & 0o777, 0o700)
        self.assertFalse(plan['execution_allowed'])
        self.assertEqual(plan['source']['manifest']['sha256'], self.manifest_sha)
        self.assertEqual(plan['source']['request']['sha256'], self.request_sha)
        self.assertEqual(plan['target'], self.request)
        self.assertNotIn('review-token', json.dumps(result))
        with self.assertRaises((ValueError, OSError)):
            self.plan()

    def test_request_injection_and_raw_binding(self):
        baseline = copy.deepcopy(self.request)
        for url in ['http://example.invalid:2380', 'https://example.invalid',
                'https://user@example.invalid:2380', 'https://example.invalid:2380/',
                'https://example.invalid:0', 'https://bad_host:2380',
                'https://example.invalid:2380?x=1', 'https://example.invalid:2380#x']:
            self.request = copy.deepcopy(baseline)
            self.request['members'][0]['peer_url'] = url
            self.save_request()
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.plan()
        self.request = copy.deepcopy(baseline)
        self.request['execution_allowed'] = True
        self.save_request()
        with self.assertRaises(ValueError):
            self.plan()
        self.request = baseline
        self.save_request()
        self.request_sha = '0'*64
        with self.assertRaises(ValueError):
            self.plan()

    def test_three_members_ipv6_and_targets(self):
        self.request['members'] = [{'name': name,
            'peer_url': f'https://[::1]:{2380+i}',
            'data_dir': f'/var/lib/etcd-recovery/recovery/{name}'}
            for i, name in enumerate(['one','two','three'])]
        self.save_request()
        self.assertEqual(self.plan()['member_count'], 3)
        self.request['members'][1]['data_dir'] = '/var/lib/etcd'
        self.save_request()
        with self.assertRaises(ValueError):
            self.plan('other')

    def test_fsync_failure_keeps_permanent_claim(self):
        original = os.fsync
        def fail(fd):
            if (self.project/'private/metadata/restore-plans/plan').exists():
                raise OSError('injected fsync')
            return original(fd)
        with patch.object(mb.os, 'fsync', side_effect=fail), self.assertRaises(OSError):
            self.plan()
        self.assertTrue((self.project/'private/metadata/restore-plans/plan').is_dir())
        with self.assertRaises((ValueError, OSError)):
            self.plan()

    def test_streaming_and_mutation_during_read(self):
        payload = b'S' * (3 * 1024 * 1024)
        self.snapshot = payload + hashlib.sha256(payload).digest()
        self.write('private/backup/snapshot.db', self.snapshot)
        self.manifest['snapshot'].update(bytes=len(self.snapshot), sha256=sha(self.snapshot))
        self.save_manifest()
        original = os.read
        sizes = []
        def observe(fd, size):
            sizes.append(size)
            return original(fd, size)
        with patch.object(mb.os, 'read', side_effect=observe):
            self.verify()
        self.assertTrue(sizes)
        self.assertLessEqual(max(sizes), 1024 * 1024)
        changed = False
        def mutate(fd, size):
            nonlocal changed
            data = original(fd, size)
            if not changed and os.fstat(fd).st_size == len(self.snapshot):
                changed = True
                self.write('private/backup/snapshot.db', b'X' * len(self.snapshot))
            return data
        with patch.object(mb.os, 'read', side_effect=mutate), self.assertRaises(ValueError):
            self.verify()
        self.assertTrue(changed)

    def test_lock_version_symlink_and_read_drift(self):
        path = self.project/'artifacts.amd64.lock.json'
        for data in [{'artifacts': []}, {'artifacts': [
                {'repository':'etcd-io/etcd', 'tag':'v3.6.13'}]},
                {'artifacts': [{'repository':'etcd-io/etcd', 'tag':'v3.6.14'}]*2}]:
            self.write('artifacts.amd64.lock.json', json.dumps(data).encode())
            with self.assertRaises(ValueError):
                self.verify()
        path.unlink()
        path.symlink_to('private/backup/manifest.json')
        with self.assertRaises((ValueError, OSError)):
            self.verify()

    def test_snapshot_limit_without_large_fixture(self):
        self.manifest['snapshot']['bytes'] = mb.SNAPSHOT_LIMIT+1
        self.save_manifest()
        with self.assertRaises(ValueError):
            self.verify()
        self.manifest['snapshot']['bytes'] = True
        self.save_manifest()
        with self.assertRaises(ValueError):
            self.verify()

    def test_request_member_counts_duplicates_and_bool(self):
        baseline = copy.deepcopy(self.request)
        for members in [[], baseline['members']*2, baseline['members']*3,
                        True, [{'name': 'node', 'peer_url': 'https://example.invalid:2380',
                                'data_dir': '/var/lib/etcd-recovery/recovery/node', 'extra':1}]]:
            self.request = copy.deepcopy(baseline)
            self.request['members'] = members
            self.save_request()
            with self.subTest(members=members), self.assertRaises(ValueError):
                self.plan()

    def test_equivalent_peer_endpoints_are_duplicate(self):
        for urls in [
            ['https://EXAMPLE.invalid:2380', 'https://example.invalid:2380',
             'https://third.invalid:2380'],
            ['https://[::1]:2380', 'https://[0:0:0:0:0:0:0:1]:2380',
             'https://third.invalid:2380'],
            ['https://example.invalid:02380', 'https://example.invalid:2380',
             'https://third.invalid:2380'],
        ]:
            self.request['members'] = [{'name': name, 'peer_url': url,
                'data_dir': f'/var/lib/etcd-recovery/recovery/{name}'}
                for name, url in zip(['one','two','three'], urls)]
            self.save_request()
            with self.subTest(urls=urls), self.assertRaises(ValueError):
                self.plan()

    def test_request_rejects_duplicate_nan_and_excessive_input(self):
        for raw in [b'{"schema":1,"schema":2}', b'{"members":NaN}', b' '*65537]:
            self.save_request(raw)
            with self.assertRaises(ValueError):
                self.plan()

    def test_output_route_symlink_is_never_followed(self):
        external = self.project/'outside'
        external.mkdir(mode=0o700)
        (self.project/'private/metadata').symlink_to(external, target_is_directory=True)
        with self.assertRaises((ValueError, OSError)):
            self.plan()
        self.assertEqual(list(external.iterdir()), [])

    def test_replacement_and_modes_fail_at_final_read_check(self):
        original = os.read
        replaced = False
        def replace(fd, size):
            nonlocal replaced
            data = original(fd, size)
            if not replaced and os.fstat(fd).st_size == len(self.snapshot):
                replaced = True
                target = self.project/'private/backup/snapshot.db'
                target.rename(target.with_name('old'))
                self.write('private/backup/snapshot.db', self.snapshot)
            return data
        with patch.object(mb.os, 'read', side_effect=replace), self.assertRaises(ValueError):
            self.verify()

    def test_late_file_fsync_failure_keeps_claim_and_no_success(self):
        original = os.fsync
        def fail(fd):
            if not __import__('stat').S_ISDIR(os.fstat(fd).st_mode):
                raise OSError('injected file fsync')
            return original(fd)
        with patch.object(mb.os, 'fsync', side_effect=fail), self.assertRaises(OSError):
            self.plan()
        self.assertTrue((self.project/'private/metadata/restore-plans/plan').is_dir())
        with self.assertRaises((ValueError, OSError)):
            self.plan()

    def assert_output_rewrite_rejected(self, same_length):
        target = self.project/'private/metadata/restore-plans/plan/plan.json'
        original = os.fsync
        corrupted = False
        def rewrite(fd):
            nonlocal corrupted
            if __import__('stat').S_ISREG(os.fstat(fd).st_mode):
                before = target.stat()
                raw = target.read_bytes()
                replacement = b'X' + raw[1:] if same_length else b'{}'
                target.write_bytes(replacement)
                self.assertEqual(target.stat().st_ino, before.st_ino)
                self.assertEqual(target.stat().st_size == len(raw), same_length)
                corrupted = True
            return original(fd)
        with patch.object(mb.os, 'fsync', side_effect=rewrite), self.assertRaises(ValueError):
            self.plan()
        self.assertTrue(corrupted)
        self.assertTrue(target.parent.is_dir())
        with self.assertRaises((ValueError, OSError)):
            self.plan()

    def test_different_length_output_rewrite_during_fsync_is_rejected(self):
        self.assert_output_rewrite_rejected(same_length=False)

    def test_same_length_output_rewrite_during_fsync_is_rejected(self):
        self.assert_output_rewrite_rejected(same_length=True)

    def test_input_drift_and_parent_replacement_before_publication(self):
        original = mb.PrivateFiles.recheck
        def drift(files):
            self.write('private/backup/manifest.json', b'{}')
            return original(files)
        with patch.object(mb.PrivateFiles, 'recheck', drift), self.assertRaises(ValueError):
            self.plan()
        self.save_manifest()
        def rename(files):
            (self.project/'private/backup').rename(self.project/'private/saved')
            (self.project/'private/backup').mkdir(mode=0o700)
            return original(files)
        with patch.object(mb.PrivateFiles, 'recheck', rename), self.assertRaises(ValueError):
            self.plan('renamed')


if __name__ == '__main__':
    unittest.main()

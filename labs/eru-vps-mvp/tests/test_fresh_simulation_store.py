"""Synthetic filesystem safety checks for the isolated simulation journal."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_simulation_store as store_module
from fresh_simulation_store import RecordStore, record_digest


class RecordStoreTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.parent = Path(temporary.name)
        self.root = self.parent / 'simulation'
        self.store = RecordStore(self.root)

    def raw(self, value):
        path = self.root / 'raw.json'
        path.write_bytes(value)
        path.chmod(0o600)

    def test_round_trip_digest_modes_and_fresh_values(self):
        value = {'b': [1, True, None], 'a': 'synthetic'}
        digest = self.store.write_once('intent.json', value)
        self.assertEqual(digest, record_digest(value))
        self.assertEqual(digest, hashlib.sha256((self.root / 'intent.json').read_bytes()).hexdigest())
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.root / 'intent.json').stat().st_mode), 0o600)
        self.store.read('intent.json')['b'].append(9)
        self.assertEqual(self.store.read('intent.json'), value)
        self.assertEqual(self.store.names(), ['intent.json'])

    def test_existing_record_never_clobbered(self):
        self.store.write_once('intent.json', {'a': 1})
        for value in ({'a': 1}, {'a': 2}):
            with self.assertRaises(FileExistsError):
                self.store.write_once('intent.json', value)
        self.assertEqual(self.store.read('intent.json'), {'a': 1})

    def test_concurrent_writers_have_one_winner(self):
        def write(index):
            try:
                RecordStore(self.root).write_once('race.json', {'index': index})
                return index
            except FileExistsError:
                return None
        with ThreadPoolExecutor(max_workers=8) as pool:
            winners = [value for value in pool.map(write, range(16)) if value is not None]
        self.assertEqual(len(winners), 1)
        self.assertEqual(self.store.read('race.json'), {'index': winners[0]})

    def test_strict_json_read_and_sanitized_errors(self):
        for raw in (b'{"secret":1,"secret":2}', b'{"secret":NaN}',
                    b'{"secret":Infinity}', b'{"secret":-Infinity}',
                    b'{"secret":1e999}', b'[]', b'{"secret":', b'\xff'):
            with self.subTest(raw=raw):
                self.raw(raw)
                with self.assertRaises(ValueError) as caught:
                    self.store.read('raw.json')
                self.assertNotIn('secret', str(caught.exception))

    def test_invalid_values_and_bounds(self):
        cyclic = {}; cyclic['loop'] = cyclic
        for value in ([], {1: 'value'}, {'a': float('nan')}, {'a': float('inf')},
                      {'a': (1, 2)}, {'a': object()}, cyclic,
                      {'a': 'x' * store_module.MAX_RECORD_BYTES}):
            with self.subTest(value_type=type(value)):
                with self.assertRaises(ValueError):
                    self.store.write_once('bad.json', value)
        self.assertEqual(self.store.names(), [])
        self.raw(b' ' * (store_module.MAX_RECORD_BYTES + 1))
        with self.assertRaises(ValueError):
            self.store.read('raw.json')

    def test_paths_and_missing(self):
        for name in ('../escape.json', '/tmp/escape.json', '.json', 'x/y.json',
                     'x.txt', 'x\n.json', 'a' * 129 + '.json', 1):
            for method in (self.store.read, lambda name: self.store.write_once(name, {})):
                with self.subTest(name=name):
                    with self.assertRaises(ValueError):
                        method(name)
        with self.assertRaises(FileNotFoundError):
            self.store.read('missing.json')

    def test_symlink_components_and_root_replacement(self):
        alias = self.parent / 'alias'; alias.symlink_to(self.root)
        with self.assertRaises(ValueError):
            RecordStore(alias)
        with self.assertRaises(ValueError):
            RecordStore(alias / 'nested')
        self.root.rename(self.parent / 'old')
        self.root.mkdir(mode=0o700)
        for method in (self.store.names, lambda: self.store.read('x.json'),
                       lambda: self.store.write_once('x.json', {})):
            with self.assertRaises(ValueError):
                method()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_symlink_hardlink_nonregular_and_insecure_mode(self):
        outside = self.parent / 'outside'; outside.write_text('{}'); outside.chmod(0o600)
        path = self.root / 'bad.json'
        for kind in ('symlink', 'hardlink', 'directory', 'fifo', 'mode'):
            with self.subTest(kind=kind):
                if kind == 'symlink': path.symlink_to(outside)
                elif kind == 'hardlink': os.link(outside, path)
                elif kind == 'directory': path.mkdir()
                elif kind == 'fifo': os.mkfifo(path)
                else: path.write_text('{}'); path.chmod(0o644)
                with self.assertRaises(ValueError): self.store.read('bad.json')
                with self.assertRaises(ValueError): self.store.names()
                if path.is_dir(): path.rmdir()
                else: path.unlink()
        self.assertEqual(outside.read_text(), '{}')

    def test_unknown_entries_fail_closed(self):
        for name in ('unexpected.txt', '.fresh-abandoned.tmp'):
            path = self.root / name; path.write_text('{}')
            with self.assertRaises(ValueError): self.store.names()
            path.unlink()

    def test_ancestor_replacement_with_symlink_is_rejected(self):
        original = self.parent / 'container'
        original.mkdir(mode=0o700)
        store = RecordStore(original / 'records')
        moved = self.parent / 'moved'
        original.rename(moved)
        original.symlink_to(moved)
        for method in (store.names, lambda: store.write_once('x.json', {})):
            with self.assertRaises(ValueError): method()
        self.assertEqual(list((moved / 'records').iterdir()), [])

    def test_root_creation_and_retry_require_parent_fsync(self):
        root = self.parent / 'durable'
        with patch.object(store_module.os, 'fsync', side_effect=OSError('synthetic')):
            with self.assertRaises(OSError): RecordStore(root)
        self.assertTrue(root.is_dir())
        with patch.object(store_module.os, 'fsync', wraps=os.fsync) as sync:
            RecordStore(root)
        self.assertEqual(sync.call_count, 1)

    def test_root_replaced_during_publication_cannot_report_success(self):
        real_link = os.link
        def replace_then_link(*args, **kwargs):
            self.root.rename(self.parent / 'detached')
            self.root.mkdir(mode=0o700)
            return real_link(*args, **kwargs)
        with patch.object(store_module.os, 'link', side_effect=replace_then_link):
            with self.assertRaises(ValueError): self.store.write_once('intent.json', {})
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertEqual((self.parent / 'detached' / 'intent.json').read_bytes(), b'{}')

    def test_file_sync_precedes_publish_and_directory_sync_precedes_return(self):
        events = []
        real_fsync, real_link = os.fsync, os.link
        def sync(fd):
            events.append('directory-sync' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file-sync')
            return real_fsync(fd)
        def link(*args, **kwargs):
            events.append('publish')
            return real_link(*args, **kwargs)
        with patch.object(store_module.os, 'fsync', side_effect=sync), \
                patch.object(store_module.os, 'link', side_effect=link):
            self.store.write_once('intent.json', {})
            events.append('return')
        self.assertEqual(events, ['file-sync', 'publish', 'directory-sync', 'return'])

    def test_file_fsync_failure_prevents_publication(self):
        with patch.object(store_module.os, 'fsync', side_effect=OSError('synthetic failure')):
            with self.assertRaises(OSError): self.store.write_once('intent.json', {})
        self.assertEqual(self.store.names(), [])

    def test_publication_failure_preserves_store(self):
        with patch.object(store_module.os, 'link', side_effect=OSError('synthetic failure')):
            with self.assertRaises(OSError): self.store.write_once('intent.json', {})
        self.assertEqual(self.store.names(), [])

    def test_directory_fsync_failure_retains_complete_record(self):
        real_fsync = os.fsync
        def fail_directory(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode): raise OSError('synthetic failure')
            return real_fsync(fd)
        with patch.object(store_module.os, 'fsync', side_effect=fail_directory):
            with self.assertRaises(OSError): self.store.write_once('intent.json', {'a': 1})
        self.assertEqual(self.store.read('intent.json'), {'a': 1})
        with self.assertRaises(FileExistsError): self.store.write_once('intent.json', {'a': 1})


if __name__ == '__main__':
    unittest.main()

"""Live snapshot state contracts against the pinned real Graphify extractor."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from graphify_lab import live_state
from graphify_lab.live_state import LiveWorkspace, LiveWorkspaceError


class LiveStateContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.program = self.source / 'sample.py'
        self.original = 'def leaf():\n    return 42\n\ndef caller():\n    return leaf()\n'
        self.program.write_text(self.original)
        self.cache = self.root / 'cache'

    def state(self):
        return LiveWorkspace(self.source, self.cache)

    def test_L01_current_status_never_opens_an_index(self):
        state = self.state()
        with patch.object(live_state, 'open_workspace', side_effect=AssertionError('status built index')):
            status = state.status()
        self.assertEqual(status['status'], 'current')
        self.assertEqual(status['index_id'], state.index['index_id'])
        labels = state.execute(lambda i: [n['label'] for n in json.loads(Path(i['graph']).read_text())['nodes']])
        self.assertIn('leaf()', labels)
        returned = state.index
        returned['source_fingerprint']['sha256'] = 'changed'
        self.assertNotEqual(returned, state.index)

    def test_L01_source_change_stale_no_query_or_automatic_build(self):
        state = self.state()
        old = state.index
        self.program.write_text(self.original.replace('leaf', 'renamed'))
        with patch.object(live_state, 'open_workspace', side_effect=AssertionError('status built index')):
            self.assertEqual(state.status()['status'], 'stale')
            with self.assertRaises(LiveWorkspaceError):
                state.execute(lambda i: self.fail('stale callback ran'))
        self.assertEqual(state.index, old)
        self.assertEqual(len(list((self.cache / 'indexes').iterdir())), 1)

    def test_L01_ancestor_context_change_stale(self):
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True)
        state = self.state()
        (self.root / '.graphifyignore').write_text('absent.py\n')
        self.assertEqual(state.status()['status'], 'stale')
        with self.assertRaises(LiveWorkspaceError):
            state.execute(lambda i: 'old data')
        state.refresh()
        self.assertEqual(state.status()['status'], 'current')

    def test_L01_deleted_source_error(self):
        state = self.state()
        self.program.unlink()
        self.source.rmdir()
        self.assertEqual(state.status()['status'], 'error')
        with self.assertRaises(LiveWorkspaceError):
            state.execute(lambda i: 'old data')

    def test_L01_corruption_and_symlink_fail_closed(self):
        state = self.state()
        graph = Path(state.index['graph'])
        original = graph.read_bytes()
        graph.write_text('{}')
        self.assertEqual(state.status()['status'], 'error')
        with self.assertRaises(LiveWorkspaceError):
            state.execute(lambda i: 'old data')
        graph.unlink()
        outside = self.root / 'graph-copy.json'
        outside.write_bytes(original)
        graph.symlink_to(outside)
        self.assertEqual(state.status()['status'], 'error')

    def test_L01_runtime_change_stale(self):
        state = self.state()
        runtime = live_state.runtime_identity()
        runtime['lock_sha256'] = 'different'
        with patch.object(live_state, 'runtime_identity', return_value=runtime):
            self.assertEqual(state.status()['status'], 'stale')
            with self.assertRaises(LiveWorkspaceError):
                state.execute(lambda i: 'old data')

    def test_L02_unchanged_refresh_reuses_and_rename_switches(self):
        state = self.state()
        old = state.index
        self.assertTrue(state.refresh()['cache_hit'])
        self.assertEqual(state.index['index_id'], old['index_id'])
        before = hashlib.sha256(Path(old['graph']).read_bytes()).hexdigest()
        self.program.write_text(self.original.replace('leaf', 'renamed'))
        refreshed = state.refresh()
        self.assertEqual(refreshed['status'], 'current')
        self.assertNotEqual(refreshed['index_id'], old['index_id'])
        labels = state.execute(lambda i: [n['label'] for n in json.loads(Path(i['graph']).read_text())['nodes']])
        self.assertIn('renamed()', labels)
        self.assertNotIn('leaf()', labels)
        self.assertEqual(hashlib.sha256(Path(old['graph']).read_bytes()).hexdigest(), before)

    def test_L02_failed_refresh_retains_old_and_recovers(self):
        state = self.state()
        old = state.index
        self.program.unlink()
        with self.assertRaises(LiveWorkspaceError):
            state.refresh()
        self.assertEqual(state.index, old)
        self.assertEqual(state.status()['status'], 'stale')
        with self.assertRaises(LiveWorkspaceError):
            state.execute(lambda i: 'old data')
        self.program.write_text(self.original.replace('leaf', 'restored'))
        self.assertEqual(state.refresh()['status'], 'current')
        self.assertNotEqual(state.index['index_id'], old['index_id'])

    def test_L02_candidate_change_before_publication_retains_old(self):
        state = self.state()
        old = state.index
        self.program.write_text(self.original.replace('leaf', 'candidate'))
        real_open = live_state.open_workspace
        def racing_open(*args):
            candidate = real_open(*args)
            self.program.write_text(self.original.replace('leaf', 'later'))
            return candidate
        with patch.object(live_state, 'open_workspace', side_effect=racing_open):
            with self.assertRaises(LiveWorkspaceError):
                state.refresh()
        self.assertEqual(state.index, old)
        self.assertEqual(state.status()['status'], 'stale')

    def test_L01_result_discarded_on_source_context_or_graph_race(self):
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True)
        state = self.state()
        for kind in ('source', 'context', 'graph'):
            with self.subTest(kind=kind):
                state.refresh()
                def change(index):
                    if kind == 'source':
                        self.program.write_text(self.original + '\n# changed\n')
                    elif kind == 'context':
                        (self.root / '.graphifyignore').write_text('absent.py\n')
                    else:
                        Path(index['graph']).write_text('{}')
                    return 'must not return'
                with self.assertRaises(LiveWorkspaceError):
                    state.execute(change)

    def test_L01_stale_callback_error_does_not_expose_old_diagnostics(self):
        state = self.state()
        for kind in ('source', 'graph'):
            with self.subTest(kind=kind):
                if kind == 'graph':
                    state.refresh()
                def fail_after_edit(index):
                    if kind == 'source':
                        self.program.write_text(self.original + '\n# edited\n')
                    else:
                        Path(index['graph']).write_text('{}')
                    raise ValueError('old-query-body-must-not-escape')
                with self.assertRaises(LiveWorkspaceError) as caught:
                    state.execute(fail_after_edit)
                self.assertNotIn('old-query-body', str(caught.exception))
                self.assertIsNone(caught.exception.__context__)
                self.assertIsNone(caught.exception.__cause__)

    def test_L01_current_callback_preserves_original_error(self):
        state = self.state()
        original = ValueError('invalid query while snapshot current')
        def fail(index):
            raise original
        with self.assertRaises(ValueError) as caught:
            state.execute(fail)
        self.assertIs(caught.exception, original)
        self.assertEqual(state.status()['status'], 'current')

    def test_L02_reader_and_refresh_are_serialized(self):
        state = self.state()
        entered, release, refreshed = threading.Event(), threading.Event(), threading.Event()
        errors = []
        def read():
            try:
                state.execute(lambda i: (entered.set(), release.wait(5)))
            except Exception as exc:
                errors.append(exc)
        def refresh():
            try:
                state.refresh()
                refreshed.set()
            except Exception as exc:
                errors.append(exc)
        reader = threading.Thread(target=read)
        reader.start()
        self.assertTrue(entered.wait(5))
        writer = threading.Thread(target=refresh)
        writer.start()
        try:
            self.assertFalse(refreshed.wait(.1))
        finally:
            release.set()
            reader.join(10)
            writer.join(10)
        self.assertFalse(reader.is_alive())
        self.assertFalse(writer.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(refreshed.is_set())


if __name__ == '__main__':
    unittest.main()

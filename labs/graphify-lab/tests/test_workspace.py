"""Mutable workspace CLI regressions using the real pinned Graphify engine."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from graphify_lab import workspace
from graphify_lab.cache import source_fingerprint
from graphify_lab.source import source_excerpt

LAB = Path(__file__).resolve().parents[1]


class WorkspaceContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.program = self.source / 'sample.py'
        self.program.write_text('def old_name():\n    return 42\n\ndef caller():\n    return old_name()\n')
        self.cache = self.root / 'cache'

    def call(self, *args, source=None, cache=None):
        return subprocess.run(
            [sys.executable, '-m', 'graphify_lab.workspace', '--source',
             str(self.source if source is None else source), '--cache',
             str(self.cache if cache is None else cache), *args],
            cwd=LAB, text=True, capture_output=True, timeout=60)

    def locate(self, **kwargs):
        result = self.call('locate', **kwargs)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_real_extraction_shared_hit_and_canonical_identity(self):
        before = source_fingerprint(self.source)
        first = self.locate()
        second = self.locate(source=self.source / '..' / 'source')
        self.assertFalse(first['cache_hit'])
        self.assertTrue(second['cache_hit'])
        for field in ('graph', 'index_id', 'source_id', 'source_fingerprint', 'context_sha256'):
            self.assertEqual(first[field], second[field])
        self.assertEqual(first['source'], str(self.source.resolve()))
        self.assertIn('source_commit', first)
        self.assertEqual(before, source_fingerprint(self.source))
        graph = json.loads(Path(first['graph']).read_text())
        self.assertIn('old_name()', [node['label'] for node in graph['nodes']])

    def test_rename_reindexes_and_retains_old_graph(self):
        first = self.locate()
        self.program.write_text(self.program.read_text().replace('old_name', 'new_name'))
        second = self.locate()
        self.assertFalse(second['cache_hit'])
        self.assertNotEqual(first['index_id'], second['index_id'])
        self.assertEqual(first['source_id'], second['source_id'])
        self.assertTrue(Path(first['graph']).is_file())
        labels = [n['label'] for n in json.loads(Path(second['graph']).read_text())['nodes']]
        self.assertIn('new_name()', labels)
        self.assertNotIn('old_name()', labels)
        self.assertTrue(self.locate()['cache_hit'])

    def test_real_query_explain_and_source(self):
        index = self.locate()
        graph = json.loads(Path(index['graph']).read_text())
        node = next(n for n in graph['nodes'] if n['label'] == 'old_name()')
        for operation, value in (('query', 'old_name'), ('explain', node['id'])):
            result = self.call(operation, value)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('old_name', result.stdout)
        result = self.call('source', 'old_name()', '--file', 'sample.py', '--lines', '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        excerpt = json.loads(result.stdout)
        self.assertEqual(excerpt['content'], 'def old_name():')
        self.assertEqual(excerpt['line'], 1)
        self.assertEqual(excerpt['source'], str(self.source))
        self.assertEqual(excerpt['source_fingerprint'], index['source_fingerprint'])

    def test_bad_options_do_not_create_cache(self):
        cases = [('query', 'old_name', '--budget', '0'),
                 ('query', 'old_name', '--budget', '32001'),
                 ('source', 'old_name()', '--lines', '0'),
                 ('source', 'old_name()', '--lines', '101'),
                 ('source', 'old_name()', '--file', '../outside.py'),
                 ('source', 'old_name()', '--file', '/outside.py')]
        for arguments in cases:
            with self.subTest(arguments=arguments):
                result = self.call(*arguments)
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertFalse(self.cache.exists())

    def test_native_query_ambiguity_and_no_match_are_preserved(self):
        self.program.write_text('def sample():\n    return 7\n')
        ambiguous = self.call('query', 'sample')
        self.assertEqual(ambiguous.returncode, 3, ambiguous.stderr)
        self.assertIn('Ambiguous', ambiguous.stdout)
        index = self.locate()
        graph = json.loads(Path(index['graph']).read_text())
        node = next(n for n in graph['nodes'] if n['label'] == 'sample()')
        exact = self.call('query', node['id'])
        self.assertEqual(exact.returncode, 0, exact.stderr)
        self.assertIn('sample', exact.stdout)
        missing = self.call('query', 'never_present_unique_name')
        self.assertEqual(missing.returncode, 4, missing.stderr)
        self.assertIn('No matching nodes', missing.stdout)

    def test_explicit_existing_directory_and_external_cache_required(self):
        for source in (self.root / 'missing', self.program):
            result = self.call('locate', source=source)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(self.cache.exists())
        for cache in (self.source, self.source / 'cache'):
            result = self.call('locate', cache=cache)
            self.assertEqual(result.returncode, 2)
            self.assertIn('outside', result.stderr)
        self.assertFalse((self.source / 'cache').exists())
        result = subprocess.run([sys.executable, '-m', 'graphify_lab.workspace', 'locate'],
                                cwd=LAB, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 2)
        self.assertIn('--source', result.stderr)

    def test_ambiguity_missing_symbol_and_file_selection(self):
        (self.source / 'other.py').write_text('def old_name():\n    return 0\n')
        for label, count in (('old_name()', 2), ('missing()', 0)):
            result = self.call('source', label)
            self.assertEqual(result.returncode, 2)
            self.assertIn(f'found {count}', result.stderr)
            self.assertEqual(result.stdout, '')
        result = self.call('source', 'old_name()', '--file', 'other.py', '--lines', '2')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('return 0', json.loads(result.stdout)['content'])

    def test_corrupt_graph_is_rejected(self):
        index = self.locate()
        Path(index['graph']).write_text('{}')
        result = self.call('locate')
        self.assertEqual(result.returncode, 2)
        self.assertIn('integrity', result.stderr)

    def test_source_symlink_escape_is_rejected(self):
        outside = self.root / 'outside.py'
        outside.write_text('def outside():\n    return 0\n')
        (self.source / 'escape.py').symlink_to(outside)
        result = self.call('source', 'outside()')
        self.assertEqual(result.returncode, 2)
        self.assertIn('escapes', result.stderr)
        self.assertEqual(result.stdout, '')

    def test_ancestor_context_change_reindexes(self):
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True)
        first = self.locate()
        (self.root / '.graphifyignore').write_text('never-present.py\n')
        second = self.locate()
        self.assertEqual(first['source_fingerprint'], second['source_fingerprint'])
        self.assertNotEqual(first['context_sha256'], second['context_sha256'])
        self.assertNotEqual(first['index_id'], second['index_id'])

    def test_excerpt_races_reject_output(self):
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True)
        for change in ('source', 'context'):
            with self.subTest(change=change):
                def racing_read(*args, **kwargs):
                    result = source_excerpt(*args, **kwargs)
                    if change == 'source':
                        self.program.write_text(self.program.read_text() + '\n# concurrent edit\n')
                    else:
                        (self.root / '.graphifyignore').write_text('changed-context.py\n')
                    return result
                out, err = io.StringIO(), io.StringIO()
                with patch.object(workspace, 'source_excerpt', side_effect=racing_read):
                    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                        status = workspace.main(['--source', str(self.source), '--cache',
                                                 str(self.cache), 'source', 'old_name()'])
                self.assertEqual(status, 2)
                self.assertIn('changed', err.getvalue())
                self.assertEqual(out.getvalue(), '')

    def test_serve_help_describes_snapshot(self):
        result = self.call('serve', '--help')
        self.assertEqual(result.returncode, 0)
        self.assertIn('snapshot', result.stdout)
        self.assertIn('restart', result.stdout)
        self.assertFalse(self.cache.exists())


if __name__ == '__main__':
    unittest.main()

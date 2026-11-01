"""Public source-location contract independent of CLI orchestration."""
import json
from pathlib import Path
import tempfile
import unittest

from graphify_lab.source import node_at, source_excerpt
from graphify_lab import __main__ as cli


class SourceContract(unittest.TestCase):
    def test_legacy_imports_are_compatible(self):
        self.assertIs(cli.node_at, node_at)
        self.assertIs(cli.source_excerpt, source_excerpt)

    def test_unicode_line_ranges_and_last_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'source.py').write_text('# 中文\ndef sample():\n    return "✓"\n', encoding='utf-8')
            for location in ('L2', 'L2-L3', 'L2:3'):
                result = source_excerpt(root, {'source_file': 'source.py', 'source_location': location}, 1)
                self.assertEqual(result, {'path': 'source.py', 'line': 2, 'content': 'def sample():'})
            self.assertEqual(source_excerpt(root, {'source_file': 'source.py', 'source_location': 'L3'}, 100)['content'], '    return "✓"')

    def test_ambiguous_and_missing_symbols(self):
        with tempfile.TemporaryDirectory() as tmp:
            graph = Path(tmp) / 'graph.json'
            graph.write_text(json.dumps({'nodes': [{'label': 'same()', 'source_file': 'a.py'}, {'label': 'same()', 'source_file': 'b.py'}]}))
            with self.assertRaisesRegex(ValueError, 'found 2'):
                node_at(graph, 'same()')
            with self.assertRaisesRegex(ValueError, 'found 0'):
                node_at(graph, 'missing()')
            self.assertEqual(node_at(graph, 'same()', 'b.py')['source_file'], 'b.py')

    def test_rejects_symlink_escape_and_invalid_locations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'source'
            root.mkdir()
            outside = Path(tmp) / 'outside.py'
            outside.write_text('private')
            (root / 'escape.py').symlink_to(outside)
            with self.assertRaisesRegex(ValueError, 'escapes'):
                source_excerpt(root, {'source_file': 'escape.py', 'source_location': 'L1'})
            (root / 'safe.py').write_text('safe\n')
            for location in ('L0', 'L2', 'unknown'):
                with self.assertRaises(ValueError):
                    source_excerpt(root, {'source_file': 'safe.py', 'source_location': location})
            for lines in (0, 101):
                with self.assertRaisesRegex(ValueError, 'between 1 and 100'):
                    source_excerpt(root, {'source_file': 'safe.py', 'source_location': 'L1'}, lines)

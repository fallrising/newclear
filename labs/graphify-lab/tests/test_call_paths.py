"""Directed path contracts on real Graphify extraction plus algorithm edge cases."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from graphify_lab.call_paths import calls_path
from graphify_lab.workspace import open_workspace


class RealCallsPaths(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        root = Path(cls.temp.name)
        source = root / 'source'
        source.mkdir()
        (source / 'chain.py').write_text(
            'def leaf():\n    return 7\n\ndef middle():\n    return leaf()\n\n'
            'def entry():\n    return middle()\n\ndef isolated():\n    return 0\n\n'
            'def cycle_a():\n    return cycle_b()\n\ndef cycle_b():\n    return cycle_a()\n\n'
            'def duplicate():\n    return 1\n')
        (source / 'other.py').write_text('def duplicate():\n    return 2\n')
        cls.index = open_workspace(source, root / 'cache')
        cls.graph = json.loads(Path(cls.index['graph']).read_text())

    def node(self, label):
        return next(n for n in self.graph['nodes'] if n['label'] == label)

    def test_L03_forward_chain_returns_real_nodes_and_directed_calls(self):
        result = calls_path(self.graph, 'entry()', 'leaf()')
        self.assertEqual(result['status'], 'found')
        self.assertEqual(result['hops'], 2)
        self.assertEqual(result['relation'], 'calls')
        self.assertEqual(result['direction'], 'forward')
        self.assertEqual([n['label'] for n in result['path']], ['entry()', 'middle()', 'leaf()'])
        for caller, callee, edge in zip(result['path'], result['path'][1:], result['edges']):
            self.assertEqual((edge['source'], edge['target'], edge['relation']),
                             (caller['id'], callee['id'], 'calls'))
            self.assertIn(edge, self.graph.get('links', self.graph.get('edges', [])))
        self.assertTrue(all(node['source_file'] == 'chain.py' for node in result['path']))

    def test_L03_reverse_and_unrelated_are_not_found(self):
        for source, target in [('leaf()', 'entry()'), ('entry()', 'isolated()')]:
            with self.subTest(source=source, target=target):
                result = calls_path(self.graph, source, target)
                self.assertEqual(result['status'], 'not_found')
                self.assertEqual(result['path'], [])
                self.assertEqual(result['edges'], [])
                self.assertIsNone(result['hops'])

    def test_L03_contains_edge_does_not_become_call_path(self):
        edge = next(e for e in self.graph.get('links', self.graph.get('edges', []))
                    if e['relation'] == 'contains' and e['target'] == self.node('entry()')['id'])
        result = calls_path(self.graph, edge['source'], edge['target'])
        self.assertEqual(result['status'], 'not_found')

    def test_L03_ambiguity_unknown_and_exact_id(self):
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            calls_path(self.graph, 'duplicate()', 'leaf()')
        with self.assertRaisesRegex(ValueError, 'unknown'):
            calls_path(self.graph, 'does-not-exist', 'leaf()')
        duplicate = self.node('duplicate()')
        result = calls_path(self.graph, duplicate['id'], duplicate['id'])
        self.assertEqual(result['status'], 'found')
        self.assertEqual(result['hops'], 0)
        self.assertEqual(result['path'], [duplicate])
        self.assertEqual(result['edges'], [])

    def test_L03_cycles_terminate_without_inventing_paths(self):
        self.assertEqual(calls_path(self.graph, 'cycle_a()', 'cycle_b()')['status'], 'found')
        self.assertEqual(calls_path(self.graph, 'cycle_a()', 'leaf()')['status'], 'not_found')

    def test_L03_hop_limit_and_visited_limit_are_explicit(self):
        hops = calls_path(self.graph, 'entry()', 'leaf()', max_hops=1)
        self.assertEqual((hops['status'], hops['reason']), ('limit_reached', 'max_hops'))
        visited = calls_path(self.graph, 'entry()', 'leaf()', max_visited=2)
        self.assertEqual((visited['status'], visited['reason']), ('limit_reached', 'max_visited'))
        self.assertLessEqual(visited['visited'], 2)
        self.assertEqual(calls_path(self.graph, 'entry()', 'leaf()', max_hops=2,
                                    max_visited=3)['status'], 'found')
        self.assertEqual(calls_path(self.graph, 'leaf()', 'entry()', max_hops=1,
                                    max_visited=1)['status'], 'not_found')

    def test_L03_bounds_reject_nonintegers_and_invalid_ranges(self):
        for field, values in [('max_hops', [0, 101, True, 1.0, '2', None]),
                              ('max_visited', [0, 100001, False, 2.0, '3', None])]:
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    calls_path(self.graph, 'entry()', 'leaf()', **{field: value})
        for value in (None, True, [], ''):
            with self.subTest(selector=value), self.assertRaises(ValueError):
                calls_path(self.graph, value, 'leaf()')


class CallsPathAlgorithmEdges(unittest.TestCase):
    """Supplementary synthetic graph cases; not extraction correctness evidence."""
    def graph(self):
        return {'nodes': [{'id': n, 'label': n} for n in 'abcde'], 'links': [
            {'source': 'a', 'target': 'c', 'relation': 'calls'},
            {'source': 'a', 'target': 'b', 'relation': 'calls'},
            {'source': 'c', 'target': 'd', 'relation': 'calls'},
            {'source': 'b', 'target': 'd', 'relation': 'calls'}]}

    def test_L03_equal_paths_are_deterministic_and_inputs_unchanged(self):
        graph = self.graph()
        before = copy.deepcopy(graph)
        expected = calls_path(graph, 'a', 'd')
        self.assertEqual([n['id'] for n in expected['path']], ['a', 'b', 'd'])
        self.assertEqual(graph, before)
        graph['nodes'].reverse()
        graph['links'].reverse()
        self.assertEqual(calls_path(graph, 'a', 'd'), expected)

    def test_L03_id_precedes_label_and_edges_alias_is_supported(self):
        graph = self.graph()
        graph['nodes'][-1]['label'] = 'a'
        graph['edges'] = graph.pop('links')
        self.assertEqual(calls_path(graph, 'a', 'd')['status'], 'found')

    def test_L03_exhausted_budget_still_checks_already_discovered_target(self):
        graph = self.graph()
        result = calls_path(graph, 'a', 'c', max_visited=3)
        self.assertEqual(result['status'], 'found')
        self.assertEqual(result['hops'], 1)

    def test_L03_invalid_graph_identity_does_not_silently_collapse_nodes(self):
        graph = self.graph()
        graph['nodes'].append({'id': 'a', 'label': 'another a'})
        with self.assertRaises(ValueError):
            calls_path(graph, 'a', 'd')
        graph = self.graph()
        graph['links'].append({'source': 'a', 'target': 'missing', 'relation': 'calls'})
        with self.assertRaises(ValueError):
            calls_path(graph, 'a', 'd')


if __name__ == '__main__':
    unittest.main()

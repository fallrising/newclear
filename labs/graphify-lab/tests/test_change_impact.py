"""M5 contracts on real Graphify extraction, with supplementary graph edge cases."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from graphify_lab.change_impact import change_impact
from graphify_lab.source import source_excerpt
from graphify_lab.workspace import open_workspace


class RealChangeImpact(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        root = Path(cls.temp.name)
        cls.source = root / 'source'
        cls.source.mkdir()
        (cls.source / 'test_chain.py').write_text(
            'def leaf():\n    return 7\n\n'
            'def middle():\n    return leaf()\n\n'
            'def test_entry():\n    return middle()\n\n'
            'def test_direct():\n    return leaf()\n\n'
            'def test_unrelated():\n    return 0\n\n'
            'def cycle_a():\n    return cycle_b()\n\n'
            'def cycle_b():\n    return cycle_c()\n\n'
            'def cycle_c():\n    return cycle_a()\n\n'
            'def duplicate():\n    return 1\n')
        (cls.source / 'other.py').write_text('def duplicate():\n    return 2\n')
        cls.index = open_workspace(cls.source, root / 'cache')
        cls.graph = json.loads(Path(cls.index['graph']).read_text())

    def test_I01_callers_paths_and_source_lines(self):
        result = change_impact(self.graph, 'leaf()')
        self.assertEqual((result['status'], result['direction'], result['relation']),
                         ('complete', 'reverse', 'calls'))
        callers = {r['node']['label']: r for r in result['callers']}
        self.assertEqual(set(callers), {'middle()', 'test_entry()', 'test_direct()'})
        self.assertTrue(callers['middle()']['direct'])
        self.assertEqual(callers['test_entry()']['hops'], 2)
        self.assertFalse(callers['test_entry()']['direct'])
        for caller in callers.values():
            path = caller['path']
            self.assertEqual(path[0], caller['node'])
            self.assertEqual(path[-1]['label'], 'leaf()')
            self.assertEqual(caller['hops'], len(caller['edges']))
            for a, b, edge in zip(path, path[1:], caller['edges']):
                self.assertEqual((edge['source'], edge['target'], edge['relation']),
                                 (a['id'], b['id'], 'calls'))
                self.assertIn(edge, self.graph['links'])
            excerpt = source_excerpt(self.source, caller['node'], lines=1)
            self.assertIn('def ' + caller['node']['label'].removesuffix('()'), excerpt['content'])

    def test_I01_unknown_ambiguity_and_exact_id(self):
        for name, message in [('absent', 'unknown'), ('duplicate()', 'ambiguous')]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, message):
                change_impact(self.graph, name)
        node = next(n for n in self.graph['nodes'] if n['label'] == 'duplicate()')
        result = change_impact(self.graph, node['id'])
        self.assertEqual(result['target'], node['id'])
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['callers'], [])

    def test_I02_only_reachable_test_hints_with_reasons(self):
        result = change_impact(self.graph, 'leaf()')
        ids = {r['node']['label']: r['node']['id'] for r in result['callers']}
        self.assertEqual({h['id'] for h in result['test_hints']},
                         {ids['test_entry()'], ids['test_direct()']})
        self.assertTrue(all(h['reasons'] == ['python_test_name', 'python_test_path']
                            for h in result['test_hints']))
        self.assertIn('not a complete test selector', result['limitations'])

    def test_I03_limits_keep_partial_evidence(self):
        for options, reason in [({'max_hops': 1}, 'max_hops'),
                                ({'max_visited': 1}, 'max_visited'),
                                ({'max_results': 1}, 'max_results')]:
            with self.subTest(options=options):
                result = change_impact(self.graph, 'leaf()', **options)
                self.assertEqual(result['status'], 'limit_reached')
                self.assertIn(reason, result['reasons'])
                self.assertLessEqual(len(result['callers']), options.get('max_results', 100))
                self.assertLessEqual(result['visited'], options.get('max_visited', 10000))
        complete = change_impact(self.graph, 'leaf()', max_hops=2, max_visited=4, max_results=3)
        self.assertEqual(complete['status'], 'complete')
        self.assertEqual(len(complete['callers']), 3)

    def test_I03_cycle_excludes_target_and_contains_is_not_impact(self):
        result = change_impact(self.graph, 'cycle_a()')
        self.assertEqual(result['status'], 'complete')
        self.assertEqual([r['node']['label'] for r in result['callers']], ['cycle_c()', 'cycle_b()'])
        result = change_impact(self.graph, 'test_unrelated()', max_hops=1, max_visited=1)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['callers'], [])
        self.assertEqual(result['test_hints'], [])

    def test_I03_invalid_bounds_and_selectors(self):
        for key, maximum in [('max_hops', 100), ('max_visited', 100000), ('max_results', 1000)]:
            for value in (0, maximum + 1, True, 1.0, None, '1'):
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    change_impact(self.graph, 'leaf()', **{key: value})
        for value in ('', None, True, []):
            with self.subTest(value=value), self.assertRaises(ValueError):
                change_impact(self.graph, value)


class ImpactAlgorithmEdges(unittest.TestCase):
    """Small graphs only establish algorithm and metadata rules, not parser quality."""
    def graph(self):
        return {'nodes': [{'id': n, 'label': n} for n in 'abcde'], 'links': [
            {'source':'a','target':'b','relation':'calls'},
            {'source':'a','target':'c','relation':'calls'},
            {'source':'b','target':'d','relation':'calls'},
            {'source':'c','target':'d','relation':'calls'},
            {'source':'a','target':'b','relation':'calls','confidence':0.9},
            {'source':'e','target':'d','relation':'contains'}]}

    def test_I03_deterministic_diamond_parallel_edges_no_mutation(self):
        graph = self.graph()
        before = copy.deepcopy(graph)
        first = change_impact(graph, 'd')
        self.assertEqual(graph, before)
        by_id = {r['node']['id']:r for r in first['callers']}
        self.assertEqual([n['id'] for n in by_id['a']['path']], ['a','b','d'])
        self.assertEqual(set(by_id), {'a','b','c'})
        graph['nodes'].reverse(); graph['links'].reverse()
        self.assertEqual(change_impact(graph, 'd'), first)

    def test_I03_id_precedence_edges_alias_and_invalid_graph(self):
        graph = self.graph()
        graph['nodes'][0]['label'] = 'd'
        graph['edges'] = graph.pop('links')
        self.assertEqual(change_impact(graph, 'd')['target'], 'd')
        graph['edges'].append({'source':'missing','target':'d','relation':'calls'})
        with self.assertRaises(ValueError):
            change_impact(graph, 'd')
        for value in ({}, {'nodes':[{'id':'x'},{'id':'x'}]}, {'nodes':[], 'links':{}}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                change_impact(value, 'd')

    def test_I02_hints_require_python_name_and_path(self):
        cases = [
            ('test_leaf()', 'test_api.py', True),
            ('Suite.test_leaf()', 'tests/api.py', True),
            ('test_leaf()', 'test/api.py', True),
            ('test_leaf()', 'api_test.py', True),
            ('helper()', 'tests/api.py', False),
            ('test_leaf()', 'production.py', False),
            ('test_leaf()', 'tests/api.ts', False),
            ('test_leaf()', 'contest/api.py', False),
            ('test_leaf()', None, False),
        ]
        for label, filename, expected in cases:
            with self.subTest(label=label, filename=filename):
                graph = {'nodes':[{'id':'a','label':label,'source_file':filename},{'id':'b','label':'leaf()'}],
                         'links':[{'source':'a','target':'b','relation':'calls'}]}
                self.assertEqual(bool(change_impact(graph, 'b')['test_hints']), expected)

    def test_I03_limits_on_diamond_do_not_invent_callers(self):
        result = change_impact(self.graph(), 'd', max_results=2)
        self.assertEqual(result['status'], 'limit_reached')
        self.assertEqual([r['node']['id'] for r in result['callers']], ['b','c'])
        self.assertEqual(result['visited'], 3)
        self.assertEqual(result['test_hints'], [])
        self.assertEqual(change_impact(self.graph(), 'd', max_results=3, max_visited=4, max_hops=2)['status'], 'complete')

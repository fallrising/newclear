"""M6 real CLI integration and deterministic read-race boundaries."""
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
from graphify_lab.live_mcp import dispatch
from graphify_lab.live_state import LiveWorkspace

LAB = Path(__file__).resolve().parents[1]
SOURCE = '''def leaf():
    return 1

def middle():
    return leaf()

def test_entry():
    return middle()

def isolated():
    return 0
'''


class WorkspaceAnalysis(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'; self.source.mkdir()
        self.program = self.source / 'test_chain.py'; self.program.write_text(SOURCE)
        self.cache = self.root / 'cache'

    def cli(self, *args):
        return subprocess.run([sys.executable, '-m', 'graphify_lab.workspace',
            '--source', str(self.source), '--cache', str(self.cache), *args],
            cwd=LAB, capture_output=True, text=True, timeout=60)

    def test_C01_real_cli_matches_mcp_readers_and_provenance(self):
        for command, args, tool, params in [
            ('calls-path', ('test_entry()', 'leaf()'), 'calls_path', {'source':'test_entry()', 'target':'leaf()'}),
            ('impact', ('leaf()',), 'change_impact', {'target':'leaf()'})]:
            with self.subTest(command=command):
                result = self.cli(command, *args)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stderr, '')
                body = json.loads(result.stdout)
                state = LiveWorkspace(self.source, self.cache)
                self.assertEqual(body, dispatch(state, tool, params))
                self.assertEqual(body['status'], 'ok')
                self.assertEqual(set(body['index']), {'index_id','source_commit','source_fingerprint','context_sha256','graph_sha256'})
                if command == 'calls-path':
                    self.assertEqual([n['label'] for n in body['result']['path']], ['test_entry()', 'middle()', 'leaf()'])
                    self.assertEqual(body['result']['path'][-1]['source_location'], 'L1')
                else:
                    self.assertEqual({c['node']['label'] for c in body['result']['callers']}, {'middle()', 'test_entry()'})
                    self.assertEqual(len(body['result']['test_hints']), 1)

    def test_C02_result_status_exit_codes_and_partial_json(self):
        cases = [
            (('calls-path','leaf()','test_entry()'),4,'not_found'),
            (('calls-path','test_entry()','leaf()','--max-hops','1'),5,'limit_reached'),
            (('calls-path','test_entry()','leaf()','--max-visited','1'),5,'limit_reached'),
            (('impact','leaf()','--max-hops','1'),5,'limit_reached'),
            (('impact','leaf()','--max-visited','1'),5,'limit_reached'),
            (('impact','leaf()','--max-results','1'),5,'limit_reached'),
            (('impact','isolated()'),0,'complete'),
        ]
        for args, status, expected in cases:
            with self.subTest(args=args):
                result = self.cli(*args)
                self.assertEqual(result.returncode, status, result.stderr)
                self.assertEqual(result.stderr, '')
                body = json.loads(result.stdout)
                self.assertEqual(body['result']['status'], expected)
                if args[0]=='impact' and '--max-results' in args:
                    self.assertEqual(len(body['result']['callers']), 1)
                if args[1]=='isolated()':
                    self.assertEqual(body['result']['callers'], [])

    def test_C02_bad_options_precede_cache_creation(self):
        cases = [('calls-path','','leaf()'), ('calls-path','test_entry()',' '), ('impact',' '),
                 ('calls-path','test_entry()','leaf()','--max-hops','0'),
                 ('calls-path','test_entry()','leaf()','--max-hops','101'),
                 ('impact','leaf()','--max-visited','0'), ('impact','leaf()','--max-visited','100001'),
                 ('impact','leaf()','--max-results','0'), ('impact','leaf()','--max-results','1001'),
                 ('impact','leaf()','--max-results','1.5'), ('impact','leaf()','--max-hops','true'),
                 ('calls-path','test_entry()'), ('impact','leaf()','--unknown')]
        for args in cases:
            with self.subTest(args=args):
                result = self.cli(*args)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, '')
                self.assertTrue(result.stderr)
                self.assertFalse(self.cache.exists())

    def test_C02_unknown_ambiguous_and_exact_id(self):
        (self.source/'other.py').write_text('def isolated():\n    return 2\n')
        for args, message in [(('impact','absent()'),'unknown'), (('impact','isolated()'),'ambiguous'),
                              (('calls-path','isolated()','leaf()'),'ambiguous')]:
            with self.subTest(args=args):
                result = self.cli(*args)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, '')
                self.assertIn(message, result.stderr)
        state = LiveWorkspace(self.source, self.cache)
        graph = json.loads(Path(state.index['graph']).read_text())
        node = next(n for n in graph['nodes'] if n['label']=='isolated()')
        result = self.cli('calls-path', node['id'], node['id'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['result']['hops'], 0)

    def test_C03_between_commands_reindexes_and_keeps_old_graph(self):
        first = self.cli('impact','leaf()')
        self.assertEqual(first.returncode, 0, first.stderr)
        old = json.loads(first.stdout)
        self.program.write_text(SOURCE.replace('test_entry','test_replacement'))
        second = self.cli('impact','leaf()')
        self.assertEqual(second.returncode, 0, second.stderr)
        new = json.loads(second.stdout)
        self.assertNotEqual(old['index']['index_id'], new['index']['index_id'])
        self.assertEqual({c['node']['label'] for c in new['result']['callers']}, {'middle()', 'test_replacement()'})
        self.assertTrue((self.cache/'indexes'/old['index']['index_id']/'graphify-out/graph.json').is_file())

    def test_C03_corrupt_cache_rejects_without_stdout(self):
        state = LiveWorkspace(self.source, self.cache)
        Path(state.index['graph']).write_text('{}')
        for args in [('calls-path','test_entry()','leaf()'),('impact','leaf()')]:
            with self.subTest(args=args):
                result = self.cli(*args)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, '')
                self.assertIn('integrity', result.stderr)

    def test_C03_success_and_error_races_discard_results_and_diagnostics(self):
        subprocess.run(['git','init','--quiet',str(self.root)],check=True)
        for command, function, args in [('calls-path','calls_path',['test_entry()','leaf()']),
                                       ('impact','change_impact',['leaf()'])]:
            real = getattr(workspace, function)
            for change in ('source','context','graph'):
                for fail in (False, True):
                    with self.subTest(command=command,change=change,fail=fail):
                        # Each race has a separate real index so graph corruption cannot contaminate later cases.
                        cache = self.root / f'cache-{command}-{change}-{fail}'
                        def racing(*a, **kw):
                            answer = real(*a, **kw)
                            if change=='source':
                                self.program.write_text(self.program.read_text()+'\n# edited\n')
                            elif change=='context':
                                (self.root/'.graphifyignore').write_text(f'not-present-{command}-{fail}.py\n')
                            else:
                                graph = next((cache/'indexes').glob('*/graphify-out/graph.json'))
                                graph.write_text('{}')
                            if fail:
                                raise ValueError('OLD-DIAGNOSTIC-MUST-NOT-LEAK')
                            return answer
                        out, err = io.StringIO(), io.StringIO()
                        with patch.object(workspace, function, side_effect=racing), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                            code = workspace.main(['--source',str(self.source),'--cache',str(cache),command,*args])
                        self.assertEqual(code, 2)
                        self.assertEqual(out.getvalue(), '')
                        self.assertNotIn('OLD-DIAGNOSTIC',err.getvalue())
                        self.assertIn('ERROR:',err.getvalue())

    def test_C02_help_describes_json_and_does_not_build(self):
        for command in ('calls-path','impact'):
            result = self.cli(command,'--help')
            self.assertEqual(result.returncode,0)
            self.assertIn('JSON',result.stdout)
            self.assertIn('--max-hops',result.stdout)
            self.assertFalse(self.cache.exists())

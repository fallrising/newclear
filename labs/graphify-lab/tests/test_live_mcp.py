"""Real same-session MCP edit/refresh journey; source is parsed, never executed."""
import json
from pathlib import Path
import sys
import tempfile
from datetime import timedelta
import importlib.metadata
import unittest

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from graphify_lab.__main__ import LAB, environment

SOURCE = '''def leaf():
    return 1

def middle():
    return leaf()

def entry():
    return middle()

def unrelated():
    return 0
'''


class LiveMCPJourney(unittest.IsolatedAsyncioTestCase):
    async def test_L04_same_session_edit_refresh_failure_recovery(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'source'; source.mkdir()
            code = source / 'sample.py'; code.write_text(SOURCE)
            params = StdioServerParameters(command=sys.executable,
                args=['-m', 'graphify_lab.workspace', '--source', str(source),
                      '--cache', str(root / 'cache'), 'serve-live'], cwd=str(LAB), env=environment())
            with (root / 'stderr.log').open('w') as log:
                async with stdio_client(params, errlog=log) as (read, write):
                    timeout = timedelta(seconds=60) if importlib.metadata.version('mcp').startswith('1.') else 60.0
                    async with ClientSession(read, write, read_timeout_seconds=timeout) as session:
                        await session.initialize()
                        names = {t.name for t in (await session.list_tools()).tools}
                        self.assertEqual(names, {'workspace_status', 'refresh_workspace', 'query_graph', 'source_excerpt', 'calls_path', 'change_impact', 'source_node'})
                        observations = []
                        async def call(name, args=None, error=False):
                            response = await session.call_tool(name, args or {})
                            self.assertEqual(bool(response.is_error), error, response)
                            data = json.loads(response.content[0].text)
                            observations.append({'tool':name, 'is_error':bool(response.is_error), 'status':data.get('status')})
                            if error:
                                self.assertNotIn('result', data)
                            return data
                        initial = await call('workspace_status')
                        self.assertEqual(initial['status'], 'current')
                        old_id = initial['index_id']
                        query = await call('query_graph', {'question': 'middle', 'budget': 1000})
                        self.assertIn('middle()', query['result'])
                        path = await call('calls_path', {'source': 'entry()', 'target': 'leaf()'})
                        self.assertEqual(path['result']['status'], 'found')
                        self.assertEqual(path['result']['hops'], 2)
                        reverse = await call('calls_path', {'source': 'leaf()', 'target': 'entry()'})
                        self.assertEqual(reverse['result']['status'], 'not_found')
                        excerpt = await call('source_excerpt', {'label': 'leaf()', 'file': 'sample.py', 'lines': 2})
                        self.assertEqual(excerpt['result']['line'], 1)
                        self.assertIn('def leaf', excerpt['result']['content'])
                        await call('calls_path', {'source': 'entry()', 'target': 'leaf()', 'max_hops': 0}, error=True)
                        await call('query_graph', {'question': 'entry', 'budget': True}, error=True)
                        await call('source_excerpt', {'label': 'leaf()', 'file': '../sample.py'}, error=True)
                        code.write_text(SOURCE.replace('leaf', 'renamed_leaf'))
                        stale = await call('workspace_status')
                        self.assertEqual(stale['status'], 'stale')
                        self.assertEqual(stale['index_id'], old_id)
                        for tool, args in [('query_graph', {'question':'middle'}), ('source_excerpt', {'label':'leaf()'}), ('calls_path', {'source':'entry()','target':'leaf()'})]:
                            await call(tool, args, error=True)
                        refreshed = await call('refresh_workspace')
                        self.assertEqual(refreshed['status'], 'current')
                        self.assertNotEqual(refreshed['index_id'], old_id)
                        new_id = refreshed['index_id']
                        self.assertEqual((await call('refresh_workspace'))['index_id'], new_id)
                        new_path = await call('calls_path', {'source':'entry()', 'target':'renamed_leaf()'})
                        self.assertEqual(new_path['result']['status'], 'found')
                        await call('source_excerpt', {'label':'leaf()'}, error=True)
                        code.unlink()  # Empty graph cannot be published by the real cache.
                        await call('refresh_workspace', error=True)
                        self.assertEqual((await call('workspace_status'))['index_id'], new_id)
                        await call('query_graph', {'question':'middle'}, error=True)
                        code.write_text(SOURCE.replace('leaf', 'recovered_leaf'))
                        recovered = await call('refresh_workspace')
                        self.assertEqual(recovered['status'], 'current')
                        answer = await call('query_graph', {'question':'recovered_leaf'})
                        self.assertIn('recovered_leaf()', answer['result'])
                        self.assertTrue((root / 'cache' / 'indexes' / old_id / 'graphify-out/graph.json').is_file())
                        print(json.dumps({'journey':'L-04', 'status':'passed', 'requests':len(observations)+2, 'initialize_and_list_included':True, 'observations':observations, 'provider_requests':None, 'tokens':None, 'cost':None}))


if __name__ == '__main__':
    unittest.main()

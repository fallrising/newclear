"""One real stdio journey proves M5 wiring, provenance and refresh behavior."""
import importlib.metadata
import json
from pathlib import Path
import sys
import tempfile
from datetime import timedelta
import unittest

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from graphify_lab.__main__ import LAB, environment

SOURCE = '''def leaf():
    return 7

def middle():
    return leaf()

def test_entry():
    return middle()

def test_unrelated():
    return 0
'''


class ChangeImpactMCP(unittest.IsolatedAsyncioTestCase):
    async def test_I04_impact_edit_refresh_and_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'source'; source.mkdir()
            code = source / 'test_chain.py'; code.write_text(SOURCE)
            params = StdioServerParameters(command=sys.executable,
                args=['-m','graphify_lab.workspace','--source',str(source),
                      '--cache',str(root / 'cache'),'serve-live'], cwd=str(LAB), env=environment())
            with (root / 'stderr.log').open('w') as log:
                async with stdio_client(params, errlog=log) as (read, write):
                    timeout = timedelta(seconds=60) if importlib.metadata.version('mcp').startswith('1.') else 60.0
                    async with ClientSession(read, write, read_timeout_seconds=timeout) as session:
                        await session.initialize()
                        tools = {t.name:t for t in (await session.list_tools()).tools}
                        self.assertIn('change_impact', tools)
                        self.assertEqual(tools['change_impact'].input_schema['required'], ['target'])
                        requests = 2
                        async def call(name, args=None, error=False):
                            nonlocal requests
                            response = await session.call_tool(name, args or {})
                            requests += 1
                            self.assertEqual(bool(response.is_error), error, response)
                            data = json.loads(response.content[0].text)
                            if error:
                                self.assertNotIn('result', data)
                            return data
                        answer = await call('change_impact', {'target':'leaf()'})
                        self.assertEqual(answer['status'], 'ok')
                        self.assertEqual(answer['result']['status'], 'complete')
                        labels = {r['node']['label'] for r in answer['result']['callers']}
                        self.assertEqual(labels, {'middle()', 'test_entry()'})
                        self.assertEqual(len(answer['result']['test_hints']), 1)
                        old_id = answer['index']['index_id']
                        caller = next(r for r in answer['result']['callers'] if r['node']['label']=='test_entry()')
                        excerpt = await call('source_excerpt', {'label':caller['node']['label'], 'file':caller['node']['source_file'], 'lines':1})
                        self.assertEqual(excerpt['index'], answer['index'])
                        self.assertEqual(excerpt['result']['line'], 7)
                        self.assertEqual(excerpt['result']['content'], 'def test_entry():')
                        partial = await call('change_impact', {'target':'leaf()', 'max_results':1})
                        self.assertEqual(partial['result']['status'], 'limit_reached')
                        for args in ({}, {'target':'leaf()','max_results':True}, {'target':'leaf()','max_visited':0},
                                     {'target':'leaf()','max_hops':101}, {'target':'leaf()','unexpected':1}):
                            await call('change_impact', args, error=True)
                        code.write_text(SOURCE.replace('test_entry', 'test_replacement'))
                        stale = await call('change_impact', {'target':'leaf()'}, error=True)
                        self.assertEqual(stale['snapshot_status'], 'stale')
                        self.assertEqual(stale['index_id'], old_id)
                        refreshed = await call('refresh_workspace')
                        self.assertEqual(refreshed['status'], 'current')
                        self.assertNotEqual(refreshed['index_id'], old_id)
                        new = await call('change_impact', {'target':'leaf()'})
                        self.assertEqual(new['index']['index_id'], refreshed['index_id'])
                        self.assertEqual({r['node']['label'] for r in new['result']['callers']}, {'middle()', 'test_replacement()'})
                        hint_id = new['result']['test_hints'][0]['id']
                        self.assertIn(hint_id, {r['node']['id'] for r in new['result']['callers'] if r['node']['label']=='test_replacement()'})
                        code.unlink()
                        await call('refresh_workspace', error=True)
                        await call('change_impact', {'target':'leaf()'}, error=True)
                        print(json.dumps({'journey':'I-04','status':'passed','requests':requests,
                                          'initialize_and_list_included':True,'provider_requests':None,'tokens':None,'cost':None}))

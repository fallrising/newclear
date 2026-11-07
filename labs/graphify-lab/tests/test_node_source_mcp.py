"""One real stdio journey binds node source evidence to its graph snapshot."""
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
from graphify_lab.workspace import open_workspace
from test_node_source import SOURCE


class NodeSourceMCP(unittest.IsolatedAsyncioTestCase):
    async def test_N03_exact_node_edit_refresh_and_index_guard(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); source=root/'source'; source.mkdir()
            code=source/'sample.py'; code.write_text(SOURCE); cache=root/'cache'
            index=open_workspace(source,cache)
            nodes=sorted([n for n in json.loads(Path(index['graph']).read_text())['nodes']
                          if n['label']=='.run()'],key=lambda n:n['source_location'])
            self.assertEqual(len(nodes),2)
            params=StdioServerParameters(command=sys.executable,
                args=['-m','graphify_lab.workspace','--source',str(source),'--cache',str(cache),'serve-live'],
                cwd=str(LAB),env=environment())
            with (root/'stderr.log').open('w') as log:
                async with stdio_client(params,errlog=log) as (read,write):
                    timeout=timedelta(seconds=60) if importlib.metadata.version('mcp').startswith('1.') else 60.0
                    async with ClientSession(read,write,read_timeout_seconds=timeout) as session:
                        await session.initialize()
                        tools={t.name:t for t in (await session.list_tools()).tools}
                        self.assertEqual(tools['source_node'].input_schema['required'],['node_id'])
                        requests=2
                        async def call(name,args=None,error=False):
                            nonlocal requests
                            response=await session.call_tool(name,args or {}); requests+=1
                            self.assertEqual(bool(response.is_error),error,response)
                            data=json.loads(response.content[0].text)
                            if error:self.assertNotIn('result',data)
                            return data
                        path=await call('calls_path',{'source':nodes[0]['id'],'target':nodes[0]['id']})
                        old_id=path['index']['index_id']; self.assertEqual(old_id,index['index_id'])
                        self.assertEqual(path['result']['path'][0]['id'],nodes[0]['id'])
                        for node,value in zip(nodes,(1,2)):
                            excerpt=await call('source_node',{'node_id':node['id'],'lines':2,'expected_index_id':old_id})
                            self.assertEqual(excerpt['index'],path['index'])
                            self.assertEqual(excerpt['result']['node'],node)
                            self.assertEqual(excerpt['result']['content'],f'    def run(self):\n        return {value}')
                        await call('source_excerpt',{'label':'.run()','file':'sample.py'},error=True)
                        for args in ({},{'node_id':'missing'},{'node_id':'.run()'},
                                     {'node_id':nodes[0]['id'],'lines':True},
                                     {'node_id':nodes[0]['id'],'expected_index_id':'A'*64}):
                            await call('source_node',args,error=True)
                        code.write_text(SOURCE.replace('return 1','return 11'))
                        stale=await call('source_node',{'node_id':nodes[0]['id'],'expected_index_id':old_id},error=True)
                        self.assertEqual(stale['snapshot_status'],'stale')
                        refreshed=await call('refresh_workspace')
                        self.assertEqual(refreshed['status'],'current'); self.assertNotEqual(refreshed['index_id'],old_id)
                        mismatch=await call('source_node',{'node_id':nodes[0]['id'],'expected_index_id':old_id},error=True)
                        self.assertIn('index',mismatch['message']); self.assertNotIn('return 11',mismatch['message'])
                        new=await call('source_node',{'node_id':nodes[0]['id'],'lines':2,'expected_index_id':refreshed['index_id']})
                        self.assertEqual(new['index']['index_id'],refreshed['index_id'])
                        self.assertEqual(new['result']['node']['id'],nodes[0]['id'])
                        self.assertIn('return 11',new['result']['content'])
                        print(json.dumps({'journey':'N-03','status':'passed','requests':requests,
                                          'initialize_and_list_included':True,'provider_requests':None,'tokens':None,'cost':None}))

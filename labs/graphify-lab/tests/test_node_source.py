"""Exact node readback on real extraction; adversarial metadata is rejection-only."""
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
from graphify_lab.source import source_node, validate_source_node_options

LAB = Path(__file__).resolve().parents[1]
SOURCE = '''class Alpha:
    def run(self):
        return 1

class Beta:
    def run(self):
        return 2
'''


class NodeSource(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.source = self.root/'src'; self.source.mkdir()
        self.code = self.source/'sample.py'; self.code.write_text(SOURCE)
        self.cache = self.root/'cache'; self.state = LiveWorkspace(self.source,self.cache)
        self.index = self.state.index; self.graph = json.loads(Path(self.index['graph']).read_text())
        self.nodes = sorted([n for n in self.graph['nodes'] if n['label']=='.run()'], key=lambda n:n['source_location'])
        self.assertEqual(len(self.nodes),2)

    def cli(self, *args, cache=None):
        return subprocess.run([sys.executable,'-m','graphify_lab.workspace','--source',str(self.source),
            '--cache',str(cache or self.cache),*args],cwd=LAB,text=True,capture_output=True,timeout=60)

    def test_N01_same_file_same_label_uses_exact_id_and_provenance(self):
        old = self.cli('source','.run()','--file','sample.py')
        self.assertEqual(old.returncode,2); self.assertEqual(old.stdout,'')
        for node, line, value in zip(self.nodes,(2,6),(1,2)):
            with self.subTest(node=node['id']):
                args={'node_id':node['id'],'lines':2,'expected_index_id':self.index['index_id']}
                cli=self.cli('source-node',node['id'],'--lines','2','--expected-index-id',self.index['index_id'])
                self.assertEqual(cli.returncode,0,cli.stderr); self.assertEqual(cli.stderr,'')
                body=json.loads(cli.stdout)
                self.assertEqual(body,dispatch(self.state,'source_node',args))
                self.assertEqual(body['index']['index_id'],self.index['index_id'])
                self.assertEqual(body['result']['node'],node)
                self.assertEqual(body['result']['line'],line)
                self.assertEqual(body['result']['path'],'sample.py')
                self.assertEqual(body['result']['content'],f'    def run(self):\n        return {value}')
                self.assertEqual(len(body['result']['content'].splitlines()),2)

    def test_N02_no_label_fallback_unknown_and_duplicate_ids(self):
        for selector in ('.run()','missing-id'):
            with self.subTest(selector=selector):
                result=self.cli('source-node',selector)
                self.assertEqual(result.returncode,2); self.assertEqual(result.stdout,'')
        graph=dict(self.graph); graph['nodes']=self.graph['nodes']+[self.nodes[0]]
        forged=self.root/'duplicate.json'; forged.write_text(json.dumps(graph))
        with self.assertRaisesRegex(ValueError,'found 2'):
            source_node({**self.index,'graph':str(forged)},self.nodes[0]['id'])

    def test_N02_invalid_options_rejected_before_cli_cache(self):
        cases=[('',),(' ',),('x','--lines','0'),('x','--lines','101'),('x','--lines','true'),
               ('x','--expected-index-id','bad'),('x','--expected-index-id','A'*64),('x','--expected-index-id','')]
        fresh=self.root/'fresh'
        for args in cases:
            with self.subTest(args=args):
                result=self.cli('source-node',*args,cache=fresh)
                self.assertEqual(result.returncode,2); self.assertEqual(result.stdout,'')
                self.assertFalse(fresh.exists())
        for options in [(None,20,None),([],20,None),('x',True,None),('x',1.0,None),('x',20,False)]:
            with self.subTest(options=options),self.assertRaises(ValueError):
                validate_source_node_options(*options)

    def test_N02_expected_index_mismatch_has_no_source(self):
        wrong='0'*64
        result=self.cli('source-node',self.nodes[0]['id'],'--expected-index-id',wrong)
        self.assertEqual(result.returncode,2); self.assertEqual(result.stdout,'')
        self.assertIn('index',result.stderr)
        self.assertNotIn('return 1',result.stderr)
        with self.assertRaisesRegex(ValueError,'index'):
            dispatch(self.state,'source_node',{'node_id':self.nodes[0]['id'],'expected_index_id':wrong})

    def test_N02_adversarial_source_metadata_is_rejected(self):
        outside=self.root/'outside.py'; outside.write_text('PRIVATE-SENTINEL')
        (self.source/'escape.py').symlink_to(outside)
        cases=[{'source_file':'../outside.py'}, {'source_file':'escape.py'},
               {'source_location':'L999'}, {'source_location':'unknown'}]
        for changes in cases:
            node={**self.nodes[0],**changes}; forged=self.root/'bad.json'
            forged.write_text(json.dumps({'nodes':[node]}))
            with self.subTest(changes=changes),self.assertRaises(ValueError) as caught:
                source_node({**self.index,'graph':str(forged)},node['id'])
            self.assertNotIn('PRIVATE-SENTINEL',str(caught.exception))

    def test_N03_cli_guard_rejects_old_index_even_when_node_id_survives(self):
        self.code.write_text(SOURCE.replace('return 1','return 11'))
        old=self.cli('source-node',self.nodes[0]['id'],'--expected-index-id',self.index['index_id'])
        self.assertEqual(old.returncode,2); self.assertEqual(old.stdout,'')
        new=self.cli('source-node',self.nodes[0]['id'],'--lines','2')
        self.assertEqual(new.returncode,0,new.stderr)
        body=json.loads(new.stdout); self.assertNotEqual(body['index']['index_id'],self.index['index_id'])
        self.assertIn('return 11',body['result']['content'])
        self.assertTrue(Path(self.index['graph']).is_file())

    def test_N03_cli_read_races_discard_success_and_error_diagnostics(self):
        subprocess.run(['git','init','--quiet',str(self.root)],check=True)
        for change in ('source','context','graph'):
            for fail in (False,True):
                with self.subTest(change=change,fail=fail):
                    cache=self.root/f'race-{change}-{fail}'
                    def racing(index,*args,**kwargs):
                        result=source_node(index,*args,**kwargs)
                        if change=='source':self.code.write_text(self.code.read_text()+'\n# edit\n')
                        elif change=='context':(self.root/'.graphifyignore').write_text(f'never-present-{fail}.py\n')
                        else:Path(index['graph']).write_text('{}')
                        if fail:raise ValueError('OLD-NODE-DIAGNOSTIC')
                        return result
                    out,err=io.StringIO(),io.StringIO()
                    with patch.object(workspace,'source_node',side_effect=racing),contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
                        status=workspace.main(['--source',str(self.source),'--cache',str(cache),'source-node',self.nodes[0]['id']])
                    self.assertEqual(status,2); self.assertEqual(out.getvalue(),'')
                    self.assertNotIn('OLD-NODE-DIAGNOSTIC',err.getvalue())
                    self.assertNotIn('return 1',err.getvalue())

    def test_N02_help_and_default_reader(self):
        help=self.cli('source-node','--help'); self.assertEqual(help.returncode,0)
        self.assertIn('--expected-index-id',help.stdout)
        result=source_node(self.index,self.nodes[1]['id'])
        self.assertEqual(result['content'],'    def run(self):\n        return 2')

import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mcp_stdio', ROOT/'tools/mcp_stdio.py')
mcp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mcp)
RID = '12345678-1234-4234-8234-123456789abc'
INIT = {'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'test','version':'1'}}}
READY = {'jsonrpc':'2.0','method':'notifications/initialized'}
REQUEST = {'schema_version':'cloudlab.bot-request.v1','operation':'health.status','request_id':RID}

def call(name='cloudlab_health_status', arguments=None, id=2):
    return {'jsonrpc':'2.0','id':id,'method':'tools/call','params':{'name':name,'arguments':arguments if arguments is not None else {'request_id':RID}}}

def result(state='not_found'):
    return {'schema_version':'cloudlab.bot-response.v1','request_id':RID,'operation':'health.status','state':state,'code':'NO_LOCAL_REQUEST','command_id':None,'verified':False,'health':None,'observed_at':None}

def lines(*values):
    return b''.join(json.dumps(x).encode()+b'\n' for x in values)

class MCPTests(unittest.TestCase):
    def session(self, raw, allow=False, invoke=None):
        out=io.BytesIO(); seen=[]
        def fake(request):
            seen.append(request)
            return result()
        code=mcp.serve(io.BytesIO(raw),out,invoke or fake,allow_submit=allow)
        return code,[json.loads(x) for x in out.getvalue().splitlines()],seen

    def test_lifecycle_tools_and_structured_result(self):
        code,replies,seen=self.session(lines(INIT,READY,{'jsonrpc':'2.0','id':2,'method':'tools/list'},call(id=3)))
        self.assertEqual(code,0);self.assertEqual(len(replies),3)
        self.assertEqual(replies[0]['result']['protocolVersion'],'2025-11-25')
        self.assertEqual(replies[0]['result']['capabilities'],{'tools':{'listChanged':False}})
        tools=replies[1]['result']['tools'];self.assertEqual([t['name'] for t in tools],['cloudlab_health_status'])
        self.assertEqual(tools[0]['inputSchema']['required'],['request_id'])
        self.assertFalse(tools[0]['inputSchema']['additionalProperties'])
        value=replies[2]['result'];self.assertEqual(value['structuredContent'],result());self.assertEqual(json.loads(value['content'][0]['text']),result());self.assertFalse(value['isError'])
        self.assertEqual(seen,[REQUEST])

    def test_tools_before_ready_duplicate_init_and_version_negotiation(self):
        other={**INIT,'params':{**INIT['params'],'protocolVersion':'2099-01-01'}}
        _,replies,seen=self.session(lines(call(),other,call(),READY,INIT,{'jsonrpc':'2.0','id':'p','method':'ping'}))
        self.assertEqual([r.get('error',{}).get('code') for r in replies],[-32000,None,-32000,-32600,None])
        self.assertEqual(replies[1]['result']['protocolVersion'],'2025-11-25');self.assertEqual(replies[-1]['result'],{});self.assertEqual(seen,[])

    def test_notifications_cannot_initialize_or_submit(self):
        notification=call('cloudlab_health_check');notification.pop('id')
        init_notice={k:v for k,v in INIT.items() if k!='id'}
        _,replies,seen=self.session(lines(init_notice,notification,INIT,READY,notification,{'jsonrpc':'2.0','method':'notifications/cancelled','params':{'requestId':3}},call()),allow=True)
        self.assertEqual(len(replies),2);self.assertEqual(seen,[REQUEST])

    def test_submit_hidden_and_denied_without_trusted_flag(self):
        _,replies,seen=self.session(lines(INIT,READY,call('cloudlab_health_check')))
        self.assertEqual(replies[-1]['error']['code'],-32602);self.assertEqual(seen,[])
        _,replies,seen=self.session(lines(INIT,READY,{'jsonrpc':'2.0','id':2,'method':'tools/list'},call('cloudlab_health_check')),allow=True)
        self.assertEqual(len(replies[1]['result']['tools']),2);self.assertEqual(seen[0]['operation'],'health.check')
        self.assertFalse(replies[1]['result']['tools'][1]['annotations']['readOnlyHint'])

    def test_arguments_reject_authority_injection_and_invalid_uuid(self):
        for args in [{'request_id':RID,'policy':'/secret'}, {'request_id':RID,'initialize_policy':True}, {'request_id':RID,'renew_policy':True}, {'request_id':RID,'next_policy':'/secret'}, {'request_id':RID,'config':'/secret'},{'request_id':RID,'url':'https://evil.example'},{'request_id':RID,'allow_submit':True},{'request_id':RID.upper()},{'request_id':'../shell'},[],None]:
            request=call();request['params']['arguments']=args
            with self.subTest(args=args):
                _,replies,seen=self.session(lines(INIT,READY,request),allow=True)
                self.assertEqual(seen,[])
                if isinstance(args,dict):
                    self.assertTrue(replies[-1]['result']['isError']);self.assertEqual(replies[-1]['result']['structuredContent']['code'],'INVALID_REQUEST')
                else:self.assertEqual(replies[-1]['error']['code'],-32602)

    def test_envelope_rejects_batch_duplicates_invalid_ids_and_params(self):
        invalid=[b'[]\n',b'{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}\n',b'{\n',b'\xff\n',lines({'jsonrpc':'2.0','id':True,'method':'ping'}),lines({'jsonrpc':'2.0','id':None,'method':'ping'}),lines({'jsonrpc':'2.0','id':2,'method':'ping','params':[]})]
        for raw in invalid:
            with self.subTest(raw=raw):
                _,replies,seen=self.session(raw);self.assertIn(replies[0]['error']['code'],[-32700,-32600]);self.assertEqual(seen,[])

    def test_oversize_and_partial_frames_close_session_without_execution(self):
        for raw in [b'x'*16385+lines(INIT),json.dumps(INIT).encode()]:
            code,replies,seen=self.session(raw);self.assertEqual(code,2);self.assertEqual(len(replies),1);self.assertEqual(seen,[])

    def test_tool_errors_have_safe_content_and_no_traceback(self):
        def broken(request):raise OSError('private-secret-path')
        _,replies,_=self.session(lines(INIT,READY,call()),invoke=broken)
        value=replies[-1]['result'];self.assertTrue(value['isError']);self.assertEqual(value['structuredContent']['state'],'unconfirmed');self.assertNotIn('private',json.dumps(replies))

    def test_rate_limit_does_not_invoke_or_replace_request(self):
        _,replies,seen=self.session(lines(INIT,READY,call(),call(id=3)))
        self.assertEqual(seen,[REQUEST]);self.assertTrue(replies[-1]['result']['isError'])
        self.assertEqual(replies[-1]['result']['structuredContent']['code'],'RATE_LIMITED')

    def test_unknown_method_malformed_initialize_and_optional_meta(self):
        malformed={**INIT,'params':{'protocolVersion':'2025-11-25'}}
        request=call();request['params']['_meta']={'progressToken':1.5}
        _,replies,seen=self.session(lines(malformed,INIT,READY,{'jsonrpc':'2.0','id':9,'method':'shell.exec'},request))
        self.assertEqual(replies[0]['error']['code'],-32602);self.assertEqual(replies[2]['error']['code'],-32601);self.assertEqual(seen,[REQUEST])

    def test_real_cli_multiple_frames_and_no_credentials_in_errors(self):
        data=lines(INIT,READY,{'jsonrpc':'2.0','id':2,'method':'tools/list'},call(),{'jsonrpc':'2.0','id':4,'method':'ping'})
        proc=subprocess.run([sys.executable,str(ROOT/'tools/mcp_stdio.py'),'--config','/not-read/private-secret','--state-dir','/not-read/state'],input=data,capture_output=True,timeout=5)
        self.assertEqual(proc.returncode,0);self.assertEqual(proc.stderr,b'');self.assertNotIn(b'private-secret',proc.stdout)
        replies=[json.loads(x) for x in proc.stdout.splitlines()];self.assertEqual(len(replies),4);self.assertTrue(replies[2]['result']['isError']);self.assertEqual(replies[3]['result'],{})

class ChildTests(unittest.TestCase):
    def invoke(self, source, request=REQUEST, allow=False, timeout=2, policy=None):
        with tempfile.TemporaryDirectory() as folder:
            script=Path(folder)/'child.py';script.write_text(source)
            with patch.object(mcp,'BRIDGE_SCRIPT',script),patch.object(mcp,'CALL_TIMEOUT',timeout):
                return mcp.run_bridge(request,'/trusted/config','/trusted/state',allow_submit=allow, policy_path=policy)

    def test_child_argv_is_fixed_and_input_only_has_bridge_envelope(self):
        source="""import json,sys
assert sys.argv[1:]==['--config','/trusted/config','--state-dir','/trusted/state','--allow-submit']
a=json.load(sys.stdin)
assert a==%r
print(%r)
""" % (REQUEST,json.dumps(result()))
        self.assertEqual(self.invoke(source,allow=True),result())

    def test_policy_path_is_trusted_argv_and_policy_errors_are_preserved(self):
        value={'schema_version':'cloudlab.bot-error.v1','code':'POLICY_CALL_LIMIT'}
        source="import sys,json\nassert sys.argv[-2:]==['--policy','/trusted/policy']\nprint(%r)\nsys.exit(2)" % json.dumps(value)
        self.assertEqual(self.invoke(source, policy='/trusted/policy'), value)
        for code in mcp.bridge.POLICY_CODES:
            error={**value, 'code':code}
            self.assertEqual(mcp.validate_output(json.dumps(error).encode(),REQUEST,2), error)

    def test_child_timeout_is_unknown_and_process_is_reaped(self):
        with tempfile.TemporaryDirectory() as folder:
            pidfile=Path(folder)/'pid'
            source=f'import os,time\nopen({str(pidfile)!r},"w").write(str(os.getpid()))\ntime.sleep(30)\n'
            start=time.monotonic();value=self.invoke(source,timeout=0.3)
            self.assertLess(time.monotonic()-start,3);self.assertEqual(value['code'],'BRIDGE_TIMEOUT_UNCONFIRMED');self.assertEqual(value['request_id'],RID);self.assertFalse(value['verified']);self.assertIsNone(value['health'])
            with self.assertRaises(ProcessLookupError):os.kill(int(pidfile.read_text()),0)

    def test_child_oversize_malformed_identity_and_stderr_are_not_exposed(self):
        sources=["print('secret'*2000)","print('private malformed')",'import json; print('+repr(json.dumps({**result(),'request_id':'another'}))+')',"import sys;sys.stderr.write('secret');sys.exit(9)",'print('+repr(json.dumps({**result(),'secret':'private'}))+')']
        for source in sources:
            with self.subTest(source=source[:20]):
                value=self.invoke(source);self.assertEqual(value['state'],'unconfirmed');self.assertFalse(value['verified']);self.assertNotIn('private',json.dumps(value));self.assertNotIn('secret',json.dumps(value))

    def test_sigterm_reaps_active_child(self):
        import signal
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);pidfile=root/'pid';script=root/'child.py';entry=root/'entry.py'
            script.write_text(f'import os,time\nopen({str(pidfile)!r},"w").write(str(os.getpid()))\ntime.sleep(30)\n')
            entry.write_text(f"import runpy,sys\nsys.path.insert(0,{str(ROOT/'tools')!r})\nimport mcp_stdio as m\nm.BRIDGE_SCRIPT={str(script)!r}\nsys.exit(m.main())\n")
            proc=subprocess.Popen([sys.executable,str(entry),'--config','/trusted/config','--state-dir','/trusted/state'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                proc.stdin.write(lines(INIT,READY,call()));proc.stdin.flush()
                deadline=time.monotonic()+3
                while not pidfile.exists() and time.monotonic()<deadline:time.sleep(.01)
                self.assertTrue(pidfile.exists());pid=int(pidfile.read_text())
                proc.send_signal(signal.SIGTERM);out,err=proc.communicate(timeout=3)
                self.assertEqual(proc.returncode,143);self.assertEqual(err,b'')
                with self.assertRaises(ProcessLookupError):os.kill(pid,0)
            finally:
                if proc.poll() is None:proc.kill();proc.communicate()

    def test_bridge_errors_and_denial_are_tool_errors(self):
        error={'schema_version':'cloudlab.bot-error.v1','code':'CONFIG_OR_STATE_UNAVAILABLE'}
        self.assertEqual(self.invoke('import sys;print('+repr(json.dumps(error))+');sys.exit(2)'),error)
        denial={**result('denied'),'code':'AUTHORIZATION_DENIED'}
        self.assertEqual(self.invoke('import sys;print('+repr(json.dumps(denial))+');sys.exit(1)'),denial)

if __name__=='__main__':unittest.main()

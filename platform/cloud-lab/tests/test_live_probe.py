import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('cloudlab_probe', ROOT / 'tools/live_probe.py')
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)

class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        # Host launcher storage has enclosing Git metadata. Isolate only metadata
        # above this synthetic fixture, preserving actual nested .git checks.
        original_exists = Path.exists
        fixture_root = self.root
        def fixture_exists(path):
            if path.name == '.git' and not path.parent.is_relative_to(fixture_root):
                return False
            return original_exists(path)
        self.marker_patch = patch.object(Path, 'exists', fixture_exists)
        self.marker_patch.start()
        self.addCleanup(self.marker_patch.stop)
        self.profile = {'base_url':'https://lab.example','audience':'probe-test','credential_id':'bot', 'generation':1,'secret_hex':'ab'*32,'journal_path':'unused.sqlite','workspace_id':'test','resource_ref':{'resource_id':'node','generation':1},'recipe_ref':{'recipe_id':'node-health','version':'1.0.0','digest':'sha256:'+'a'*64}}
        self.config = self.root/'bot.json'
        self.config.write_text(json.dumps(self.profile));self.config.chmod(0o600)
        self.now = 1793059200
        self.calls = []
    def tearDown(self): self.temp.cleanup()
    def transport(self, method, path, raw, headers):
        self.calls.append((method,path,raw,headers))
        if not headers.get('X-Lab-Signature'): return 401, {'code':'UNAUTHENTICATED'}
        if path=='/api/bootstrap': return 200, {'workspace_id':'test','resource_ref':self.profile['resource_ref'],'recipe_ref':self.profile['recipe_ref'],'capabilities':['commands:submit','commands:read','node:health:read'],'now':probe.utc(self.now),'request_id':'r'}
        if path=='/api/commands' and method=='GET':return 200, {'commands':[], 'now':probe.utc(self.now),'request_id':'r'}
        if path=='/api/commands' and method=='POST':
            self.command=json.loads(raw);return 202, {'command':{'command_id':'cmd','command':self.command,'delivery':'accepted'},'request_id':'r'}
        if path=='/api/commands/cmd':return 200, {'command':{'command_id':'cmd','command':self.command,'delivery':'result_recorded','result':{'owner_outcome':'succeeded','validation':{'status':'passed'},'health':'healthy','finished_at':probe.utc(self.now)}},'request_id':'r'}
        raise AssertionError(path)
    def test_default_is_readonly_and_redacts_values(self):
        result=probe.run_probe(self.config,self.root/'evidence',transport=self.transport,clock=lambda:self.now)
        self.assertTrue(result['readiness_passed']);self.assertEqual(result['execution'],'not_requested')
        self.assertFalse(any(x[0]=='POST' for x in self.calls))
        evidence=(self.root/'evidence/probe.json').read_text()
        for secret in [self.profile['secret_hex'],self.profile['base_url'],'node','test']:
            self.assertNotIn('"'+secret+'"',evidence)
        self.assertEqual((self.root/'evidence').stat().st_mode&0o777,0o700)
    def test_anonymous_asset_exposure_fails_before_signed_read(self):
        def exposed(method,path,raw,headers):return (200,{}) if path=='/dashboard.mjs' else self.transport(method,path,raw,headers)
        result=probe.run_probe(self.config,self.root/'evidence',transport=exposed,clock=lambda:self.now)
        self.assertFalse(result['readiness_passed']);self.assertTrue(any(c['code']=='ANONYMOUS_EXPOSURE' for c in result['checks']))
        self.assertFalse(any(x[0]=='POST' for x in self.calls))
    def test_scope_mismatch_prevents_submission(self):
        def wrong(method,path,raw,headers):
            status,body=self.transport(method,path,raw,headers)
            if path=='/api/bootstrap' and headers.get('X-Lab-Signature'):body['workspace_id']='other'
            return status,body
        result=probe.run_probe(self.config,self.root/'evidence',submit=True,transport=wrong,clock=lambda:self.now)
        self.assertFalse(result['readiness_passed']);self.assertFalse(any(x[0]=='POST' for x in self.calls))
    def test_explicit_submission_is_persisted_before_network_and_identical_retry(self):
        output=self.root/'evidence';attempts=[]
        def flaky(method,path,raw,headers):
            if method=='POST':
                self.assertEqual((output/'submission.json').read_bytes(),raw);attempts.append(raw)
                if len(attempts)==1:raise probe.ProbeError('NETWORK_UNAVAILABLE')
            return self.transport(method,path,raw,headers)
        result=probe.run_probe(self.config,output,submit=True,wait_seconds=1,transport=flaky,clock=lambda:self.now,sleep=lambda _:None)
        self.assertEqual(result['execution'],'validated');self.assertEqual(len(attempts),2);self.assertEqual(attempts[0],attempts[1])
    def test_unknown_never_becomes_success(self):
        def unknown(method,path,raw,headers):
            status,body=self.transport(method,path,raw,headers)
            if path=='/api/commands/cmd':body['command']['delivery']='reconciling';body['command']['result']=None
            return status,body
        result=probe.run_probe(self.config,self.root/'evidence',submit=True,wait_seconds=1,transport=unknown,clock=lambda:self.now,sleep=lambda _:None)
        self.assertEqual(result['execution'],'unknown');self.assertFalse(result['execution_passed'])
    def test_resume_does_not_refresh_command_or_deadline(self):
        output=self.root/'evidence'
        def broken(method,path,raw,headers):
            if method=='POST':raise probe.ProbeError('NETWORK_UNAVAILABLE')
            return self.transport(method,path,raw,headers)
        first=probe.run_probe(self.config,output,submit=True,transport=broken,clock=lambda:self.now,sleep=lambda _:None)
        self.assertEqual(first['execution'],'unconfirmed');old=(output/'submission.json').read_bytes()
        second=probe.run_probe(self.config,output,submit=True,resume=True,transport=self.transport,clock=lambda:self.now+100,sleep=lambda _:None)
        self.assertEqual((output/'submission.json').read_bytes(),old)
        self.assertEqual(second['execution'],'accepted')
    def test_unsafe_files_and_invalid_schema_fail_closed(self):
        self.config.chmod(0o644)
        with self.assertRaises(probe.ProbeError):probe.run_probe(self.config,self.root/'evidence',transport=self.transport)
        self.config.chmod(0o600);link=self.root/'link';link.symlink_to(self.config)
        with self.assertRaises(probe.ProbeError):probe.run_probe(link,self.root/'evidence',transport=self.transport)
        self.config.write_text('{"base_url":"https://lab.example","base_url":"https://other.example"}')
        with self.assertRaises(probe.ProbeError):probe.run_probe(self.config,self.root/'evidence',transport=self.transport)
    def test_existing_output_not_overwritten(self):
        out=self.root/'evidence';out.mkdir();(out/'unique').write_text('keep')
        with self.assertRaises(probe.ProbeError):probe.run_probe(self.config,out,transport=self.transport)
        self.assertEqual((out/'unique').read_text(),'keep')
    def test_machine_signing_vector_is_exact_and_access_headers_separate(self):
        headers=probe.sign_headers(self.profile,'GET','/api/bootstrap',b'',self.now,'a'*32)
        import hashlib,hmac
        message='\n'.join(['CLOUDLAB-M1','probe-test','bot','1','GET','/api/bootstrap',str(self.now),'a'*32,hashlib.sha256(b'').hexdigest()]).encode()
        self.assertEqual(headers['X-Lab-Signature'],hmac.new(bytes.fromhex('ab'*32),message,hashlib.sha256).hexdigest())
        self.assertNotIn('CF-Access-Client-Secret',headers)

if __name__=='__main__':unittest.main()

class TransportTests(unittest.TestCase):
    setUp = ProbeTests.setUp
    tearDown = ProbeTests.tearDown
    transport = ProbeTests.transport
    def test_real_http_signatures_and_redirects_are_not_forwarded(self):
        import http.server, threading, hashlib, hmac
        test=self
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                if self.path=='/leak':test.fail('redirect followed')
                if self.headers.get('X-Lab-Signature'):
                    message='\n'.join(['CLOUDLAB-M1','probe-test','bot','1','GET',self.path,self.headers['X-Lab-Time'],self.headers['X-Lab-Nonce'],hashlib.sha256(b'').hexdigest()]).encode()
                    test.assertEqual(self.headers['X-Lab-Signature'],hmac.new(bytes.fromhex('ab'*32),message,hashlib.sha256).hexdigest())
                    if getattr(test,'redirect',False):
                        self.send_response(302);self.send_header('Location','/leak');self.end_headers();return
                status,body=test.transport('GET',self.path,b'',self.headers)
                raw=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(raw)
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            self.profile['base_url']='http://127.0.0.1:'+str(server.server_port);self.config.write_text(json.dumps(self.profile))
            result=probe.run_probe(self.config,self.root/'evidence',allow_loopback_http=True,clock=lambda:self.now)
            self.assertTrue(result['readiness_passed'])
            self.redirect=True
            result=probe.run_probe(self.config,self.root/'redirect',allow_loopback_http=True,clock=lambda:self.now)
            self.assertFalse(result['readiness_passed'])
            self.assertTrue(any(c['code']=='NON_JSON_RESPONSE' for c in result['checks']))
        finally:server.shutdown();thread.join();server.server_close()
    def test_git_checkout_and_special_private_files_rejected(self):
        other=self.root/'other-checkout';other.mkdir();(other/'.git').write_text('gitdir: synthetic')
        with self.assertRaises(probe.ProbeError):probe.run_probe(self.config,other/'evidence',transport=self.transport)
        fifo=self.root/'fifo';os.mkfifo(fifo,0o600)
        with self.assertRaises(probe.ProbeError):probe.private_read(fifo)

class ReviewRegressionTests(unittest.TestCase):
    setUp = ProbeTests.setUp
    tearDown = ProbeTests.tearDown
    transport = ProbeTests.transport
    def test_dangling_git_marker_is_checkout_boundary(self):
        repo=self.root/'dangling-checkout';repo.mkdir(mode=0o700);(repo/'.git').symlink_to('missing-gitdir')
        with self.assertRaisesRegex(probe.ProbeError,'UNSAFE_EVIDENCE_DIRECTORY'):
            probe.run_probe(self.config,repo/'evidence',transport=self.transport,clock=lambda:self.now)
        self.assertFalse((repo/'evidence').exists())
    def test_directory_entries_are_fsynced_before_submission(self):
        import stat
        kinds=[];real_fsync=os.fsync
        def tracked(fd):
            kinds.append('directory' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file')
            return real_fsync(fd)
        def inspect(method,path,raw,headers):
            if method=='POST':self.assertGreaterEqual(kinds.count('directory'),4)
            return self.transport(method,path,raw,headers)
        with patch.object(probe.os,'fsync',tracked):
            result=probe.run_probe(self.config,self.root/'evidence',submit=True,transport=inspect,clock=lambda:self.now)
        self.assertEqual(result['execution'],'accepted')
    def test_malformed_nested_result_never_escapes_or_validates(self):
        for n,broken in enumerate([['invalid'],{'owner_outcome':'succeeded','validation':None,'finished_at':probe.utc(self.now)}]):
            def malformed(method,path,raw,headers):
                status,body=self.transport(method,path,raw,headers)
                if path=='/api/commands/cmd':body['command']['result']=broken
                return status,body
            result=probe.run_probe(self.config,self.root/('evidence'+str(n)),submit=True,wait_seconds=1,transport=malformed,clock=lambda:self.now)
            self.assertFalse(result['execution_passed']);self.assertTrue(any(not c['passed'] for c in result['checks']))
    def test_nonstring_capabilities_fail_before_any_submission(self):
        def malformed(method,path,raw,headers):
            status,body=self.transport(method,path,raw,headers)
            if path=='/api/bootstrap' and headers.get('X-Lab-Signature'):body['capabilities']=['commands:read',{}]
            return status,body
        result=probe.run_probe(self.config,self.root/'evidence',submit=True,transport=malformed,clock=lambda:self.now)
        self.assertFalse(result['readiness_passed']);self.assertFalse(any(c[0]=='POST' for c in self.calls))

    def test_nonstring_command_id_is_not_acknowledged(self):
        def malformed(method,path,raw,headers):
            status,body=self.transport(method,path,raw,headers)
            if method=='POST':body['command']['command_id']=123
            return status,body
        result=probe.run_probe(self.config,self.root/'evidence',submit=True,wait_seconds=1,transport=malformed,clock=lambda:self.now)
        self.assertEqual(result['execution'],'unconfirmed')
        self.assertFalse(result['execution_passed'])
        self.assertTrue(any(c['code']=='ADMISSION_UNCONFIRMED' for c in result['checks']))
        self.assertFalse(any(c[1].startswith('/api/commands/') for c in self.calls))

    def test_directory_sync_failure_prevents_submission(self):
        import stat
        calls=0;real_fsync=os.fsync
        def failing(fd):
            nonlocal calls
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                calls+=1
                if calls==3:raise OSError('synthetic sync failure')
            return real_fsync(fd)
        with patch.object(probe.os,'fsync',failing):
            result=probe.run_probe(self.config,self.root/'evidence',submit=True,transport=self.transport,clock=lambda:self.now)
        self.assertFalse(any(c[0]=='POST' for c in self.calls))
        self.assertTrue(any(c['code']=='EVIDENCE_WRITE_FAILED' for c in result['checks']))

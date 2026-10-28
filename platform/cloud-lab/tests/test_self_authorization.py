"""Self inspection must not acquire a runner journal or trust mismatched metadata."""
import copy
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import test_runner as helpers

r = helpers.r
NOW = helpers.NOW


class SelfAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cfg = helpers.config(str(Path(self.tmp.name)/'journal.sqlite'))
        self.value = {'schema_version': 'cloudlab.authorization-self.v1', 'observed_at': r.utc(NOW), 'request_id': 'test',
            'credential': {'id': self.cfg.credential_id, 'generation': self.cfg.generation, 'principal_id': 'runner', 'grant_id': 'grant', 'revoked': False, 'expires_at': r.utc(NOW+3600)},
            'grant': {'id': 'grant', 'revision': 1, 'principal_id': 'runner', 'not_before': r.utc(NOW-1), 'expires_at': r.utc(NOW+7200)},
            'scope': {'workspace_id': self.cfg.workspace_id, 'resource_ref': self.cfg.resource_ref, 'recipe_ref': self.cfg.recipe_ref}}
        self.calls = []
        outer = self
        class Client:
            def post(self, path, raw):
                outer.calls.append((path,raw))
                return copy.deepcopy(outer.value)
        self.client = Client()

    def inspect(self, times=None):
        times = iter(times or [NOW, NOW])
        return r.inspect_authorization(self.cfg, self.client, clock=lambda: next(times))

    def test_only_self_query_and_redacted_output(self):
        out = self.inspect()
        self.assertEqual(self.calls, [('/api/authorization/self', b'{}')])
        self.assertEqual(out['credential_expires_at'], r.utc(NOW+3600))
        self.assertIsNone(out['runner_stop_at'])
        self.assertIsNone(out['access_service_expires_at'])
        self.assertEqual(out['source'], 'worker_self')
        for text in [self.cfg.base_url, self.cfg.credential_id, self.cfg._secret.hex(), 'principal_id', 'grant_id']:
            self.assertNotIn(text, json.dumps(out))
        self.assertFalse(Path(self.cfg.journal_path).exists())

    def test_rejects_wrong_identity_scope_extra_fields_or_expired_response(self):
        changes = [('credential','id','other'),('credential','generation',True),('credential','generation',2),
            ('credential','grant_id','wrong'),('credential','principal_id','wrong'),('credential','revoked',True),
            ('credential','expires_at',r.utc(NOW)),('grant','expires_at',r.utc(NOW)),('grant','revision',True),
            ('grant','not_before',r.utc(NOW+1)),('scope','workspace_id','other'),('scope','resource_ref',{'resource_id':'other','generation':1}),
            ('scope','recipe_ref',{'recipe_id':'wrong','version':'1.0.0','digest':'sha256:'+'a'*64}),('credential','secret_hex','ab'*32)]
        original=copy.deepcopy(self.value)
        for section,key,value in changes:
            with self.subTest(section=section,key=key,value=value):
                self.value=copy.deepcopy(original);self.value[section][key]=value
                with self.assertRaises(r.ProtocolError): self.inspect()
        self.value=copy.deepcopy(original);self.value['schema_version']='unknown'
        with self.assertRaises(r.ProtocolError): self.inspect()

    def test_rejects_slow_backwards_or_skewed_observations(self):
        for times in ([NOW,NOW+11],[NOW,NOW-1],[NOW+121,NOW+121],[NOW-121,NOW-121]):
            with self.subTest(times=times),self.assertRaises(r.ProtocolError):self.inspect(times)
        self.assertEqual(self.inspect([NOW,NOW+10])['source'],'worker_self')

    def test_authentication_errors_propagate_without_retry(self):
        with patch.object(self.client,'post',side_effect=r.AuthenticationError('private')) as post:
            with self.assertRaises(r.AuthenticationError): self.inspect()
            self.assertEqual(post.call_count,1)

    def test_signing_adds_only_the_fixed_self_route(self):
        headers=r.signed_headers(self.cfg,'/api/authorization/self',b'{}',now=NOW,nonce='ab'*16)
        self.assertEqual(headers['X-Lab-Key-Id'],self.cfg.credential_id)
        with self.assertRaises(r.ProtocolError):r.signed_headers(self.cfg,'/api/authorization/other',b'{}')

    def write_config(self):
        p=Path(self.tmp.name)/'runner.json'
        data={'base_url':self.cfg.base_url,'audience':self.cfg.audience,'credential_id':self.cfg.credential_id,
              'generation':1,'secret_hex':self.cfg._secret.hex(),'journal_path':self.cfg.journal_path,
              'workspace_id':self.cfg.workspace_id,'resource_ref':self.cfg.resource_ref,'recipe_ref':self.cfg.recipe_ref}
        p.write_text(json.dumps(data));p.chmod(0o600);return p

    def test_cli_never_opens_journal_or_lock(self):
        p=self.write_config();out=io.StringIO()
        with patch.object(r,'inspect_authorization',return_value={'source':'worker_self'}) as inspect,patch.object(r,'Journal',side_effect=AssertionError('journal')),patch.object(r,'InstanceLock',side_effect=AssertionError('lock')),contextlib.redirect_stdout(out):
            self.assertEqual(r.main(['--config',str(p),'--authorization-status']),0)
        self.assertEqual(inspect.call_count,1);self.assertEqual(json.loads(out.getvalue()),{'source':'worker_self'})

    def test_inspection_refuses_unsafe_config_before_network(self):
        p=self.write_config();alias=p.with_name('alias.json');alias.symlink_to(p)
        hard=p.with_name('hard.json');os.link(p,hard)
        with patch.object(r,'inspect_authorization',side_effect=AssertionError('network')),contextlib.redirect_stderr(io.StringIO()):
            for path in (alias,p):
                self.assertEqual(r.main(['--config',str(path),'--authorization-status']),1)
        hard.unlink();p.chmod(0o644)
        with patch.object(r,'inspect_authorization',side_effect=AssertionError('network')),contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(r.main(['--config',str(p),'--authorization-status']),1)

    def test_inspection_rejects_resident_or_once_flags(self):
        p=self.write_config()
        with patch.object(r,'inspect_authorization',side_effect=AssertionError('network')),contextlib.redirect_stderr(io.StringIO()):
            for args in (['--once'],['--stop-at',r.utc(NOW+3600)]):
                self.assertEqual(r.main(['--config',str(p),'--authorization-status',*args]),1)

class InspectionDeadlineTests(unittest.TestCase):
    def test_slow_stream_is_interrupted_by_total_deadline(self):
        import threading
        import time
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        finished = threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200); self.send_header('Content-Type','application/json')
                self.send_header('Content-Length','40'); self.end_headers()
                try:
                    for _ in range(40):
                        self.wfile.write(b' '); self.wfile.flush(); time.sleep(.05)
                except OSError: pass
                finally: finished.set()
            def log_message(self,*args): pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            cfg=helpers.config('unused',base_url='https://lab.example')
            # Explicit local test configuration, matching Config's loopback opt-in.
            cfg.base_url=f'http://127.0.0.1:{server.server_port}'
            started=time.monotonic()
            with patch.object(r,'INSPECTION_TIMEOUT',.2,create=True), self.assertRaises(r.ProtocolError):
                r.inspect_authorization(cfg)
            self.assertLess(time.monotonic()-started,.8)
            self.assertTrue(finished.wait(1))
        finally:
            server.shutdown();server.server_close();thread.join(2)

    def test_late_connect_cannot_send_after_cancellation(self):
        import threading
        connected,release,closed=threading.Event(),threading.Event(),threading.Event()
        calls=[]
        class Connection:
            sock=None
            def __init__(self,*args,**kwargs): self.auto_open=True
            def connect(self): connected.set();release.wait(2)
            def request(self,*args): calls.append(args)
            def close(self): closed.set()
        cfg=helpers.config('unused')
        try:
            with patch.object(r,'INSPECTION_TIMEOUT',.1),patch.object(r.http.client,'HTTPSConnection',Connection):
                with self.assertRaises(r.ProtocolError):r.InspectionClient(cfg).post('/api/authorization/self',b'{}')
                self.assertTrue(connected.is_set());release.set();self.assertTrue(closed.wait(1));self.assertEqual(calls,[])
        finally:release.set()

    def test_new_transport_rejects_redirect_html_oversize_and_auth_failures(self):
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        cases=[]
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']));cases.append(self.path)
                self.send_response(self.server.reply_status);self.send_header('Content-Type',self.server.reply_type)
                self.send_header('Location','https://must-not-follow.invalid/');self.end_headers()
                try:self.wfile.write(self.server.reply)
                except OSError:pass
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        cfg=helpers.config('unused');cfg.base_url=f'http://127.0.0.1:{server.server_port}'
        try:
            for code,content,body in [(302,'application/json',b'{}'),(200,'text/html',b'private'),(200,'application/json',b' '*32769),(401,'application/json',b'private'),(403,'application/json',b'private'),(500,'application/json',b'private')]:
                server.reply_status=code;server.reply_type=content;server.reply=body
                error=r.AuthenticationError if code in (401,403) else r.ProtocolError
                with self.subTest(code=code,content=content),self.assertRaises(error) as cm:
                    r.InspectionClient(cfg).post('/api/authorization/self',b'{}')
                self.assertNotIn('private',str(cm.exception))
            self.assertEqual(cases,['/api/authorization/self']*6)
        finally:server.shutdown();server.server_close();thread.join(2)

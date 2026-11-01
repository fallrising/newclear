import importlib.util
import copy
import tempfile
import threading
import time
from unittest.mock import patch
import http.client
from pathlib import Path
import unittest

PATH=Path(__file__).resolve().parents[1]/'tools/remote_recovery.py'
spec=importlib.util.spec_from_file_location('remote_recovery',PATH)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class RelayTests(unittest.TestCase):
    def exercise(self,mode):
        calls=[]
        def forward(path,body,headers):
            calls.append((path,body));return 200,b'{"command":{"command_id":"one"}}'
        with m.FaultRelay(forward,mode) as relay:
            client=http.client.HTTPConnection('127.0.0.1',relay.port,timeout=2)
            self.addCleanup(client.close)
            client.request('POST','/api/runner/report',b'{}',{'Content-Type':'application/json'})
            if mode in ('before','after'):
                with self.assertRaises(http.client.RemoteDisconnected):client.getresponse()
            else:self.assertEqual(client.getresponse().status,200)
            self.assertIsNone(relay.error)
        return calls
    def test_drop_before_never_forwards(self):self.assertEqual(self.exercise('before'),[])
    def test_drop_after_forwards_once(self):self.assertEqual(self.exercise('after'),[('/api/runner/report',b'{}')])
    def test_normal_passes(self):self.assertEqual(self.exercise(None),[('/api/runner/report',b'{}')])
    def test_unexpected_route_never_forwards(self):
        calls=[]
        with m.FaultRelay(lambda *args:calls.append(args),None) as relay:
            c=http.client.HTTPConnection('127.0.0.1',relay.port,timeout=2)
            self.addCleanup(c.close);c.request('POST','/outside',b'{}')
            self.assertEqual(c.getresponse().status,400)
        self.assertEqual(calls,[])
    def test_target_requires_https_origin(self):
        for url in ('http://127.0.0.1','https://user:secret@example.com','https://example.com/path','https://example.com?x=1'):
            with self.subTest(url=url),self.assertRaises(m.r.ProtocolError):m.RemoteClient(url)
    def test_marker_empty_and_invalid_not_success(self):
        self.assertEqual(m.marker_count(b''),0)
        self.assertEqual(m.marker_count(b'collect\n'),1)
        with self.assertRaises(m.r.ProtocolError):m.marker_count(b'collect')

class ProfileTests(unittest.TestCase):
    def profile(self):
        value=dict(base_url='https://isolated.example',audience='test',credential_id='test',generation=1,secret_hex='ab'*32,journal_path='unused',workspace_id='recovery-test',resource_ref={'resource_id':'node','generation':1},recipe_ref={'recipe_id':'node-health','version':'1.0.0','digest':'sha256:'+'a'*64})
        p=dict(schema_version='cloudlab.remote-recovery.v1',isolated=True,isolation_id='recovery-test',mode='before',expected_commands=0)
        p.update({role:dict(value,credential_id=role) for role in ('observer','submitter','runner','reconciler')})
        return p
    def test_valid_profile(self):self.assertEqual(m.validate_profile(self.profile())['expected_commands'],0)
    def test_no_isolation_or_scope_mismatch_rejected(self):
        for change in ('isolation','scope','identity'):
            p=self.profile()
            if change=='isolation':p['isolated']=False
            if change=='scope':p['reconciler']['workspace_id']='other'
            if change=='identity':p['reconciler']['credential_id']=p['runner']['credential_id']
            with self.subTest(change=change),self.assertRaises(m.r.ProtocolError):m.validate_profile(p)
    def test_unbounded_count_and_modes_rejected(self):
        for key,value in [('expected_commands',True),('expected_commands',3),('mode','delete')]:
            p=self.profile();p[key]=value
            with self.subTest(key=key),self.assertRaises(m.r.ProtocolError):m.validate_profile(p)

class BoundTests(unittest.TestCase):
    def test_stalled_forward_does_not_block_relay_exit(self):
        entered=threading.Event();release=threading.Event()
        def forward(*args):
            entered.set();release.wait(3);return 200,b'{}'
        try:
            with m.FaultRelay(forward,None) as relay:
                c=http.client.HTTPConnection('127.0.0.1',relay.port,timeout=2)
                self.addCleanup(c.close);c.request('POST','/api/runner/report',b'{}')
                self.assertTrue(entered.wait(1));start=time.monotonic()
            self.assertLess(time.monotonic()-start,1.5)
        finally:release.set()
    def test_remote_total_deadline_cancels_stalled_read(self):
        cancelled=threading.Event()
        class Connection:
            sock=None
            def __init__(self,*args,**kwargs):pass
            def connect(self):self.sock=self
            def request(self,*args):pass
            def getresponse(self):return self
            def __enter__(self):return self
            def __exit__(self,*args):pass
            status=200
            def read(self,*args):cancelled.wait(2);return b'{}'
            def shutdown(self,*args):cancelled.set()
            def close(self):cancelled.set()
        with patch.object(m.http.client,'HTTPSConnection',Connection):
            start=time.monotonic()
            with self.assertRaises(m.r.ProtocolError):m.RemoteClient('https://example.com',.05).send('GET','/api/bootstrap',b'',{})
            self.assertLess(time.monotonic()-start,1)
            self.assertTrue(cancelled.is_set())
    def test_late_connect_cannot_send_after_deadline(self):
        release=threading.Event();closed=threading.Event();sent=[]
        class Connection:
            sock=None
            def __init__(self,*args,**kwargs):pass
            def connect(self):release.wait(2);self.sock=self
            def request(self,*args):sent.append(True)
            def shutdown(self,*args):pass
            def close(self):closed.set()
        with patch.object(m.http.client,'HTTPSConnection',Connection):
            try:
                with self.assertRaises(m.r.ProtocolError):m.RemoteClient('https://example.com',.05).send('POST','/api/runner/report',b'{}',{})
            finally:release.set()
            self.assertTrue(closed.wait(1));self.assertEqual(sent,[])
    def test_cancel_during_send_cannot_implicitly_reconnect(self):
        released=threading.Event();closed=threading.Event();sent=[];instances=[]
        class Connection:
            auto_open=True
            def __init__(self,*args,**kwargs):self.sock=None;instances.append(self)
            def connect(self):self.sock=self
            def request(self,*args):
                released.wait(2)
                if self.sock is None:
                    if self.auto_open:self.connect()
                    else:raise http.client.NotConnected()
                sent.append(True)
            def shutdown(self,*args):self.sock=None;released.set()
            def close(self):closed.set()
        with patch.object(m.http.client,'HTTPSConnection',Connection):
            with self.assertRaises(m.r.ProtocolError):m.RemoteClient('https://example.com',.05).send('POST','/api/runner/report',b'{}',{})
            self.assertTrue(closed.wait(1));self.assertFalse(instances[0].auto_open);self.assertEqual(sent,[])
    def test_world_writable_evidence_parent_refused_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            parent=Path(directory);parent.chmod(0o777)
            # Shared launcher fixtures can reside below a checkout; isolate the parent-mode guard.
            with patch.object(m.prep,'require_outside_checkout'),patch.object(m,'RemoteClient') as network:
                with self.assertRaises(m.r.ProtocolError):m.run_case(ProfileTests().profile(),parent/'evidence')
                network.assert_not_called()
            self.assertFalse((parent/'evidence').exists())
            parent.chmod(0o700)

if __name__=='__main__':unittest.main()

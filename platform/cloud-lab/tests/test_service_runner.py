"""Service lifetime is independent of submit grants and never resets on restart."""
import copy
import contextlib
import hashlib
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


class ServicePolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config_path = self.root / 'runner.json'
        self.config_value = dict(base_url='https://lab.example', audience='cloud-lab',
            credential_id='runner-1', generation=1, secret_hex='ab'*32,
            journal_path='journal.sqlite', workspace_id='lab',
            resource_ref=dict(resource_id='node-1', generation=1),
            recipe_ref=dict(recipe_id='node-health', version='1.0.0', digest='sha256:'+'c'*64),
            cloudflare_access_client_id='synthetic-id', cloudflare_access_client_secret='synthetic-secret')
        self.config_path.write_bytes(r.encode(self.config_value))
        self.config_path.chmod(0o600)
        self.config = r.read_inspection_config(self.config_path)
        self.policy = dict(schema_version='cloudlab.runner-service.v1',
            config_sha256=self.config._loaded_sha256, service_until=r.utc(NOW+3600),
            access_expires_at=r.utc(NOW+1800))
        self.policy_path = self.root / 'service.json'
        self.write_policy()
        self.response = dict(schema_version='cloudlab.authorization-self.v1',observed_at=r.utc(NOW),request_id='test',
            credential=dict(id='runner-1',generation=1,principal_id='runner',grant_id='runner-grant',revoked=False,expires_at=r.utc(NOW+1200)),
            grant=dict(id='runner-grant',revision=1,principal_id='runner',not_before=r.utc(NOW-1),expires_at=r.utc(NOW+900)),
            scope=dict(workspace_id='lab',resource_ref=self.config.resource_ref,recipe_ref=self.config.recipe_ref))
        self.calls=[]
        outer=self
        class Client:
            def post(self,path,raw):
                outer.calls.append((path,raw))
                return copy.deepcopy(outer.response)
        self.client=Client()

    def write_policy(self):
        self.policy_path.write_bytes(r.encode(self.policy))
        self.policy_path.chmod(0o600)

    def authorize(self, clock=lambda: NOW, monotonic=lambda: 100):
        policy=r.read_service_policy(self.policy_path,self.config)
        return r.ServiceWindow.authorize(policy,self.config,client=self.client,clock=clock,monotonic=monotonic)

    def test_each_layer_is_a_bound_and_no_submit_identity_required(self):
        for layer in ('service','access','credential','grant'):
            with self.subTest(layer=layer):
                original=copy.deepcopy(self.policy),copy.deepcopy(self.response)
                if layer=='service': self.policy['service_until']=r.utc(NOW+10)
                elif layer=='access': self.policy['access_expires_at']=r.utc(NOW+10)
                else: self.response[layer]['expires_at']=r.utc(NOW+10)
                self.write_policy()
                window=self.authorize()
                self.assertEqual(window.stop_at,NOW+10)
                self.assertEqual(window.deadline,110)
                self.policy,self.response=original
        self.assertEqual(self.calls,[('/api/authorization/self',b'{}')]*4)

    def test_restart_preserves_absolute_end_not_duration(self):
        first=self.authorize()
        self.response['observed_at']=r.utc(NOW+100)
        restarted=self.authorize(clock=lambda:NOW+100,monotonic=lambda:200)
        self.assertEqual((first.stop_at,first.deadline),(restarted.stop_at,restarted.deadline))

    def test_query_elapsed_and_backwards_clock_cannot_extend_deadline(self):
        self.response['grant']['not_before']=r.utc(NOW-1000)
        times=iter([NOW,NOW,NOW,NOW-100])
        ticks=iter([100,105])
        window=self.authorize(clock=lambda:next(times),monotonic=lambda:next(ticks))
        self.assertLessEqual(window.deadline,100+900)
        self.assertFalse(window.allows_start(clock=lambda:NOW-100,monotonic=lambda:1000))

    def test_future_server_time_reduces_remaining_duration(self):
        self.response['observed_at']=r.utc(NOW+120)
        self.assertLessEqual(self.authorize().deadline,100+900-120)

    def test_server_ahead_also_bounds_each_local_policy_deadline(self):
        self.response['observed_at']=r.utc(NOW+120)
        for key in ('service_until','access_expires_at'):
            original=copy.deepcopy(self.policy)
            self.policy[key]=r.utc(NOW+200);self.write_policy()
            with self.subTest(key=key):
                self.assertLessEqual(self.authorize().deadline,180)
            self.policy=original

    def test_policy_expired_at_server_time_refuses_even_with_valid_remote_grant(self):
        self.response['observed_at']=r.utc(NOW+120)
        for key in ('service_until','access_expires_at'):
            original=copy.deepcopy(self.policy)
            self.policy[key]=r.utc(NOW+60);self.write_policy()
            with self.subTest(key=key),self.assertRaises(r.AuthenticationError):self.authorize()
            self.policy=original

    def test_expired_local_policy_refuses_network(self):
        for key in ('service_until','access_expires_at'):
            saved=self.policy[key];self.policy[key]=r.utc(NOW);self.write_policy()
            with self.assertRaises(r.ProtocolError): self.authorize()
            self.assertEqual(self.calls,[])
            self.policy[key]=saved

    def test_invalid_policy_binding_and_private_files(self):
        for key,value in [('config_sha256','0'*64),('schema_version','unknown'),('extra','secret'),('access_expires_at',None),('service_until','invalid')]:
            original=copy.deepcopy(self.policy);self.policy[key]=value;self.write_policy()
            with self.subTest(key=key),self.assertRaises(r.ProtocolError): r.read_service_policy(self.policy_path,self.config)
            self.policy=original
        self.write_policy();self.policy_path.chmod(0o644)
        with self.assertRaises(r.ProtocolError): r.read_service_policy(self.policy_path,self.config)
        self.policy_path.chmod(0o600)
        alias=self.root/'alias';alias.symlink_to(self.policy_path)
        with self.assertRaises((r.ProtocolError,OSError)):r.read_service_policy(alias,self.config)
        hard=self.root/'hard';os.link(self.policy_path,hard)
        with self.assertRaises(r.ProtocolError):r.read_service_policy(self.policy_path,self.config)
        hard.unlink();self.policy_path.write_text('{"schema_version":1,"schema_version":1}')
        with self.assertRaises(r.ProtocolError):r.read_service_policy(self.policy_path,self.config)
        self.policy_path.write_bytes(b' '*32769)
        with self.assertRaises(r.ProtocolError):r.read_service_policy(self.policy_path,self.config)

    def test_policy_requires_bound_access_configuration(self):
        self.config._access_client_secret=None
        with self.assertRaises(r.ProtocolError):r.read_service_policy(self.policy_path,self.config)

    def test_rejected_self_does_not_open_journal_or_claim(self):
        with patch.object(r.InspectionClient,'post',side_effect=r.AuthenticationError('private')) as post,patch.object(r,'Journal',side_effect=AssertionError('journal opened')),patch.object(r.time,'time',return_value=NOW),contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(r.main(['--config',str(self.config_path),'--service-policy',str(self.policy_path)]),1)
        self.assertEqual(post.call_count,1)
        self.assertFalse((self.root/'journal.sqlite').exists())
        self.assertNotIn('private',err.getvalue())

    def test_incompatible_modes_refuse_before_network(self):
        with patch.object(r.InspectionClient,'post',side_effect=AssertionError('network')),contextlib.redirect_stderr(io.StringIO()):
            for extra in (['--once'],['--stop-at',r.utc(NOW+10)],['--authorization-status'],['--observe-resident','--observation-socket',str(self.root/'sock')]):
                with self.subTest(extra=extra):
                    self.assertEqual(r.main(['--config',str(self.config_path),'--service-policy',str(self.policy_path),*extra]),1)

    def test_window_consumed_during_self_query_is_rejected(self):
        self.policy['service_until']=r.utc(NOW+2);self.write_policy()
        times=iter([NOW,NOW,NOW+3,NOW+3])
        ticks=iter([100,103])
        with self.assertRaises(r.AuthenticationError):
            self.authorize(clock=lambda:next(times),monotonic=lambda:next(ticks))

    def test_shortened_or_invalid_remote_metadata_cannot_authorize(self):
        for section,key,value in [('credential','expires_at',r.utc(NOW)),
                ('credential','id','wrong'),('grant','principal_id','wrong'),
                ('grant','not_before',r.utc(NOW+1))]:
            original=copy.deepcopy(self.response);self.response[section][key]=value
            with self.subTest(section=section,key=key),self.assertRaises(r.ProtocolError):self.authorize()
            self.response=original

    def test_resident_preserves_precomputed_monotonic_bound(self):
        import test_resident
        stop=test_resident.ClockStop()
        runner=type('Runner',(),{'run_once':lambda self:False})()
        window=r.ServiceWindow(stop_at=1100,deadline=1031)
        self.assertEqual(r.resident_loop(runner,stop,stop_at=1200,poll_seconds=30,
            clock=lambda:900,monotonic=lambda:stop.now,emit=lambda **kw:None,service_window=window),0)
        self.assertEqual(stop.delays,[30,1])


class ServiceAdmissionTests(unittest.TestCase):
    setUp = helpers.RunnerTests.setUp
    collector = helpers.RunnerTests.collector
    def test_late_claim_does_not_collect_and_persists_unknown(self):
        client=helpers.FakeClient(helpers.assignment(self.cfg))
        runner=r.Runner(self.cfg,self.journal,client=client,collector=self.collector,clock=lambda:NOW,admission_open=lambda:False)
        runner.run_once()
        self.assertEqual(self.collects,0)
        self.assertEqual(json.loads(client.calls[-1][1])['owner_outcome'],'unknown')
        # Reconciliation after a restart cannot turn that unknown into new work.
        runner=r.Runner(self.cfg,self.journal,client=client,collector=self.collector,clock=lambda:NOW,admission_open=lambda:True)
        runner.run_once();self.assertEqual(self.collects,0)

    def test_journal_commit_crossing_service_deadline_does_not_collect(self):
        permits=iter([True,False])
        client=helpers.FakeClient(helpers.assignment(self.cfg))
        runner=r.Runner(self.cfg,self.journal,client=client,collector=self.collector,clock=lambda:NOW,admission_open=lambda:next(permits))
        runner.run_once();self.assertEqual(self.collects,0)
        self.assertEqual(json.loads(client.calls[-1][1])['owner_outcome'],'unknown')

    def test_completed_result_survives_closed_admission(self):
        client=helpers.FakeClient(helpers.assignment(self.cfg))
        r.Runner(self.cfg,self.journal,client=client,collector=self.collector,clock=lambda:NOW).run_once()
        previous=json.loads(client.calls[-1][1])
        r.Runner(self.cfg,self.journal,client=client,collector=self.collector,clock=lambda:NOW,admission_open=lambda:False).run_once()
        self.assertEqual(self.collects,1)
        self.assertEqual(json.loads(client.calls[-1][1]),previous)




class ServiceProcessTests(unittest.TestCase):
    setUp = ServicePolicyTests.setUp
    write_policy = ServicePolicyTests.write_policy

    def start_server(self):
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        self.seen=[];self.reports=[];self.reported=threading.Event();self.claimed=threading.Event()
        self.auth_status=200;self.claim_status=200;self.assignment=None
        outer=self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body=self.rfile.read(int(self.headers['Content-Length']))
                outer.seen.append(self.path)
                status=200
                if self.path=='/api/authorization/self':
                    reply=outer.response;status=outer.auth_status
                elif self.path=='/api/runner/claim':
                    reply={'assignment':outer.assignment,'request_id':'claim'}
                    outer.claimed.set();status=outer.claim_status
                elif self.path=='/api/runner/report':
                    report=json.loads(body);outer.reports.append(report)
                    reply={'command':{'command_id':report['command_id']},'request_id':'report'}
                else:
                    reply={};status=404
                raw=r.encode(reply)
                self.send_response(status);self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
                if self.path=='/api/runner/report':outer.reported.set()
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        self.config_value['base_url']=f'http://127.0.0.1:{server.server_port}'
        self.config_path.write_bytes(r.encode(self.config_value))
        self.policy['config_sha256']=hashlib.sha256(r.encode(self.config_value)).hexdigest()
        self.processes=[];self.addCleanup(self.reap)
        return server

    def setup_window(self,seconds=120):
        import time
        now=int(time.time())
        self.policy['service_until']=r.utc(now+seconds)
        self.policy['access_expires_at']=r.utc(now+180)
        self.write_policy()
        self.response['observed_at']=r.utc(now)
        self.response['credential']['expires_at']=r.utc(now+180)
        self.response['grant'].update(not_before=r.utc(now-10),expires_at=r.utc(now+180))
        return now

    def spawn(self):
        import subprocess,sys
        extra=['--observation-socket',str(self.root/'resident.sock')] if getattr(self,'observe',False) else []
        proc=subprocess.Popen([sys.executable,r.__file__,'--config',str(self.config_path),
            '--service-policy',str(self.policy_path),'--allow-loopback-http','--poll-seconds','5',*extra],
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.processes.append(proc);return proc

    def reap(self):
        for p in self.processes:
            if p.poll() is None:p.kill()
            p.communicate(timeout=5)

    def stop_after_report(self):
        import signal
        self.reported.clear()
        p=self.spawn()
        self.assertTrue(self.reported.wait(5))
        if getattr(self,'observe',False):
            observed=r.observe_resident(self.config_path,self.root/'resident.sock',True)
            self.assertEqual(observed['configured_stop_at'],self.policy['service_until'])
            self.assertLessEqual(r.timestamp(observed['runner_stop_at']),r.timestamp(self.policy['service_until']))
        p.send_signal(signal.SIGTERM)
        out,err=p.communicate(timeout=5)
        self.assertEqual(p.returncode,0,err)
        self.assertIn('service_authorized',out)
        self.assertFalse((self.root/'resident.sock').exists())
        self.assertNotIn('synthetic-secret',out+err)
        return out

    def test_real_process_restart_reuses_completed_journal(self):
        self.observe=True
        self.start_server();now=self.setup_window()
        self.assignment=helpers.assignment(self.config)
        command=self.assignment['command']
        command.update(not_before=r.utc(now-1),dispatch_deadline=r.utc(now+90),execution_deadline=r.utc(now+100))
        self.assignment['attempt']['lease_expires_at']=r.utc(now+90)
        self.stop_after_report()
        journal_path=self.root/'journal.sqlite'
        inode=journal_path.stat().st_ino
        journal=r.Journal(journal_path)
        try:before=journal.lookup(self.assignment)
        finally:journal.close()
        self.stop_after_report()
        self.assertEqual(journal_path.stat().st_ino,inode)
        journal=r.Journal(journal_path)
        try:self.assertEqual(journal.lookup(self.assignment),before)
        finally:journal.close()
        self.assertEqual(self.reports[0]['owner_outcome'],'succeeded')
        self.assertEqual(self.reports[0],self.reports[1])
        self.assertEqual(self.seen.count('/api/authorization/self'),2)
        self.assertEqual(self.seen[:3],['/api/authorization/self','/api/runner/claim','/api/runner/report'])

    def test_real_process_started_unknown_is_not_recollected(self):
        self.start_server();now=self.setup_window()
        self.assignment=helpers.assignment(self.config)
        self.assignment['command'].update(not_before=r.utc(now-1),dispatch_deadline=r.utc(now+90),execution_deadline=r.utc(now+100))
        self.assignment['attempt']['lease_expires_at']=r.utc(now+90)
        journal=r.Journal(self.root/'journal.sqlite')
        try:journal.start(self.assignment)
        finally:journal.close()
        self.stop_after_report()
        self.assertEqual(self.reports[0]['owner_outcome'],'unknown')
        self.assertIsNone(self.reports[0]['artifact'])

    def test_real_process_natural_policy_expiry_stops_without_extra_claim(self):
        self.start_server();self.setup_window(2)
        p=self.spawn();out,err=p.communicate(timeout=6)
        self.assertEqual(p.returncode,0,err)
        self.assertIn('deadline',out)
        self.assertEqual(self.seen,['/api/authorization/self','/api/runner/claim'])
        with r.InstanceLock(self.root/'journal.sqlite'):pass
        # Same absolute policy cannot restart a fresh window.
        q=self.spawn();_,err=q.communicate(timeout=5)
        self.assertEqual(q.returncode,1,err)
        self.assertEqual(len(self.seen),2)

    def test_real_claim_revocation_stops_without_retry(self):
        self.start_server();self.setup_window();self.claim_status=403
        p=self.spawn();out,err=p.communicate(timeout=5)
        self.assertEqual(p.returncode,1,err)
        self.assertIn('authorization',out)
        self.assertEqual(self.seen,['/api/authorization/self','/api/runner/claim'])


    def test_real_authentication_rejection_prevents_journal(self):
        self.start_server();self.setup_window();self.auth_status=403
        p=self.spawn();out,err=p.communicate(timeout=5)
        self.assertEqual(p.returncode,1)
        self.assertEqual(self.seen,['/api/authorization/self'])
        self.assertFalse((self.root/'journal.sqlite').exists())
        self.assertNotIn('synthetic-secret',out+err)


if __name__=='__main__':unittest.main()

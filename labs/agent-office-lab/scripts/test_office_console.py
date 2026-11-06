import http.client
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import office_console as console
import office_dispatch as dispatch
import execution_slot as slots


class ConsoleTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.lab=Path(self.tmp.name);(self.lab/'runs').mkdir()
        self.app=console.Console(self.lab);self.addCleanup(self.app.close)
        self.server=console.serve(self.app)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.close_server)
        self.origin=f'http://127.0.0.1:{self.server.server_port}'

    def close_server(self):
        self.server.shutdown();self.server.server_close();self.thread.join(5)

    def request(self,path,body=None,headers=None,raw=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=10)
        base={'Authorization':'Bearer '+self.app.token}
        if body is not None or raw is not None:base.update(Origin=self.origin,**{'Content-Type':'application/json'})
        if headers:base.update(headers)
        data=raw if raw is not None else json.dumps(body) if body is not None else None
        try:
            connection.request('POST' if data is not None else 'GET',path,data,base)
            response=connection.getresponse();return response.status,response.read(),dict(response.getheaders())
        finally:connection.close()

    def test_project_file_list_requires_authorization_and_known_registration(self):
        project=self.lab/'project';project.mkdir();(project/'file.py').write_text('private source text')
        self.app.projects['project-1']=project.resolve()
        status,raw,_=self.request('/api/project',{'project':'project-1'})
        self.assertEqual(status,200);self.assertEqual(json.loads(raw)['files'][0]['name'],'file.py')
        self.assertNotIn(b'private source text',raw)
        for headers in [{'Authorization':'wrong'},{'Origin':'http://attacker.invalid'}]:
            self.assertEqual(self.request('/api/project',{'project':'project-1'},headers)[0],403)
        self.assertEqual(self.request('/api/project',{'project':'unknown'})[0],409)
        self.assertEqual(self.request('/api/project',{'project':'project-1','path':'/etc'})[0],404)

    def test_auth_origin_host_and_body_boundaries(self):
        for path,body,headers in [('/api/state',None,{'Authorization':'wrong'}),('/api/state',None,{'Host':'attacker.invalid'}),
                                  ('/api/plan',{'provider':'pi','mode':'http_429'},{'Origin':'http://attacker.invalid'}),
                                  ('/api/plan',{'provider':'pi','mode':'http_429'},{'Origin':''}),
                                  ('/api/state',None,{'Sec-Fetch-Site':'cross-site'})]:
            self.assertEqual(self.request(path,body,headers)[0],403)
        self.assertEqual(self.request('/api/plan',raw='{"provider":"pi","provider":"grok"}')[0],400)
        self.assertEqual(self.request('/api/plan',raw='x'*4097)[0],400)
        self.assertEqual(self.request('/api/plan',{}, {'Content-Type':'text/plain'})[0],415)
        self.assertEqual(self.request('/../state/dispatch/active.json')[0],404)
        code,_,headers=self.request('/')
        self.assertEqual(code,200);self.assertEqual(headers['Cache-Control'],'no-store')
        self.assertIn("frame-ancestors 'none'",headers['Content-Security-Policy'])
        self.assertNotIn('Access-Control-Allow-Origin',headers)

    def test_paid_and_arbitrary_inputs_never_spawn(self):
        with patch('office_console.subprocess.Popen') as spawn:
            for provider in ('pi','grok','cursor'):
                code,raw,_=self.request('/api/plan',{'provider':provider,'mode':'task'})
                self.assertEqual(code,200);plan=json.loads(raw);self.assertFalse(plan['executable'])
                self.assertEqual(self.request('/api/execute',{'plan_id':plan['plan_id']})[0],409)
            for selection in ({'provider':'pi','mode':'http_429','argv':['sh']},{'provider':'grok','mode':'crash'},
                              {'provider':'opencode','mode':'shell'},{'provider':[],'mode':'task'}):
                self.assertEqual(self.request('/api/plan',selection)[0],409)
            self.assertEqual(self.request('/api/execute',{'plan_id':'missing','command':'sh'})[0],404)
            spawn.assert_not_called()

    def launch_helper(self,selection,body):
        key=self.app.plan(selection)['plan_id']
        native=subprocess.Popen
        commands=[]
        def launch(argv,**kwargs):
            commands.append(argv)
            return native([sys.executable,'-c',body],**kwargs)
        with patch('office_console.subprocess.Popen',side_effect=launch):
            result=self.app.execute(key)
        return key,result['job_id'],commands

    def wait_job(self,key):
        deadline=time.monotonic()+5
        while self.app.jobs[key]['phase']!='finished' and time.monotonic()<deadline:time.sleep(.01)
        self.assertEqual(self.app.jobs[key]['phase'],'finished')

    def test_one_shot_fixed_command_refresh_and_failure_exit_zero(self):
        out=self.lab/'runs/pi-work-fixture';out.mkdir();(out/'workspace').mkdir()
        (out/'result.json').write_text(json.dumps({'provider':'pi','model':'deepseek-flash','status':'failed',
            'cleanup_errors':[],'office':{'model':'deepseek/deepseek-flash','cleanup_completed':True},'secret':'PRIVATE_SECRET'}))
        key,job,commands=self.launch_helper({'provider':'pi','mode':'http_429'},f'import json;print(json.dumps({{"artifacts":{str(out)!r}}}))')
        self.wait_job(job)
        self.assertEqual(commands[0][2:],['run','pi','--execute','--check-failure','429'])
        for _ in range(2):
            code,raw,_=self.request('/api/state');self.assertEqual(code,200);snapshot=json.loads(raw)
            self.assertEqual(snapshot['jobs'][0]['exit_code'],0)
            self.assertEqual(snapshot['jobs'][0]['result']['status'],'failed')
            self.assertNotIn(b'PRIVATE_SECRET',raw);self.assertNotIn(str(self.lab).encode(),raw)
        with self.assertRaisesRegex(console.ConsoleError,'plan_expired_or_used'):self.app.execute(key)
        self.assertEqual(len(self.app.jobs),1)

    def test_owned_stop_busy_and_foreign_id(self):
        key,job,_=self.launch_helper({'provider':'opencode','mode':'terminal'},'import time;time.sleep(20)')
        other=self.app.plan({'provider':'pi','mode':'http_401'})['plan_id']
        with self.assertRaisesRegex(console.ConsoleError,'execution_busy'):self.app.execute(other)
        with self.assertRaisesRegex(console.ConsoleError,'no_owned_active_job'):self.app.stop('foreign')
        self.app.stop(job);self.wait_job(job)
        self.assertIsNone(self.app.active)
        self.assertFalse((self.lab/'state/dispatch/active.json').exists())

    def test_close_stops_owned_process_and_stale_plan_rechecks(self):
        _,job,_=self.launch_helper({'provider':'pi','mode':'crash'},'import time;time.sleep(20)')
        self.app.close();self.assertIsNotNone(self.app.jobs[job]['process'].poll())
        with self.assertRaisesRegex(console.ConsoleError,'closing'):self.app.execute('anything')
        self.app.closing=False
        key=self.app.plan({'provider':'pi','mode':'http_401'})['plan_id']
        self.app.plans[key]['expires']=0
        with self.assertRaisesRegex(console.ConsoleError,'expired'):self.app.execute(key)
        key=self.app.plan({'provider':'pi','mode':'http_401'})['plan_id']
        with patch.object(console,'selection_plan',side_effect=console.SlotError('retry_requires_latest_attempt')):
            with self.assertRaisesRegex(console.SlotError,'latest'):self.app.execute(key)

    def test_run_reference_and_terminal_link_allowlist(self):
        for bad in ('/tmp/pi-work-foreign',str(self.lab/'runs/../private'),'PRIVATE_SECRET'):
            self.assertIsNone(console.report_reference(json.dumps({'artifacts':bad}),self.lab))
        self.assertEqual(console.report_reference(f'Artifacts: {self.lab}/runs/local-work-test\n',self.lab),'local-work-test')
        for bad in ('https://example.com/login#key='+'a'*32,'javascript:alert(1)','http://localhost:123/login#key='+'a'*32,
                    'http://127.0.0.1:123/private#key='+'a'*32,'http://user@127.0.0.1:123/login#key='+'a'*32):
            self.assertIsNone(console.terminal_link(bad))
        good='http://127.0.0.1:123/login#key='+'a'*32
        self.assertEqual(console.terminal_link(good),good)

    def test_external_slot_blocks_stale_plan_before_spawn_and_preserves_journal(self):
        key=self.app.plan({'provider':'pi','mode':'cancel'})['plan_id']
        with slots.execution_slot(self.lab):
            slots.mark_started()
            before=(self.lab/'state/dispatch/active.json').read_bytes()
            snapshot=json.loads(self.request('/api/state')[1])
            self.assertEqual(snapshot['shared_execution'],{'status':'busy'})
            self.assertIsNone(snapshot['active_job']);self.assertEqual(snapshot['jobs'],[])
            with patch('office_console.subprocess.Popen') as spawn:
                self.assertEqual(self.request('/api/execute',{'plan_id':key})[0],409);spawn.assert_not_called()
            self.assertEqual((self.lab/'state/dispatch/active.json').read_bytes(),before)
        with self.assertRaisesRegex(console.ConsoleError,'expired_or_used'):self.app.execute(key)
        key=self.app.plan({'provider':'pi','mode':'cancel'})['plan_id']
        with patch('office_console.subprocess.Popen') as spawn:
            self.assertEqual(self.request('/api/execute',{'plan_id':key})[0],409);spawn.assert_not_called()
        self.assertEqual(self.request('/api/acknowledge',{})[0],404)

    def test_recreated_console_reads_uncertain_state_without_adoption_or_unlock(self):
        with slots.execution_slot(self.lab):slots.mark_started()
        journal=self.lab/'state/dispatch/active.json';before=journal.read_bytes()
        restarted=console.Console(self.lab);self.addCleanup(restarted.close)
        snapshot=restarted.snapshot()
        self.assertEqual(snapshot['shared_execution'],{'status':'cleanup_unconfirmed'})
        self.assertEqual(snapshot['jobs'],[]);self.assertIsNone(snapshot['active_job'])
        restarted.close();self.assertEqual(journal.read_bytes(),before)
        journal.write_text('broken')
        key=self.app.plan({'provider':'pi','mode':'cancel'})['plan_id']
        with patch('office_console.subprocess.Popen') as spawn:
            with self.assertRaisesRegex(console.ConsoleError,'execution_state_unavailable'):self.app.execute(key)
            spawn.assert_not_called()
        self.assertEqual(journal.read_text(),'broken')

    def test_pi_resume_console_plan_is_fixed_and_local(self):
        code,raw,_=self.request('/api/plan',{'provider':'pi','mode':'resume'})
        self.assertEqual(code,200);plan=json.loads(raw);self.assertTrue(plan['executable'])
        self.assertEqual(plan['plan']['command'][2:],['run','pi','--execute','--check-resume'])
        self.assertFalse(plan['plan']['remote']);self.assertTrue(plan['plan']['native_resume_check'])
        key,job,commands=self.launch_helper({'provider':'pi','mode':'resume'},'pass');self.wait_job(job)
        self.assertEqual(commands[0][2:],['run','pi','--execute','--check-resume'])

    def test_pi_host_restart_console_plan_is_fixed_and_local(self):
        code,raw,_=self.request('/api/plan',{'provider':'pi','mode':'host_restart'})
        self.assertEqual(code,200);plan=json.loads(raw);self.assertTrue(plan['executable'])
        self.assertEqual(plan['plan']['command'][2:],['run','pi','--execute','--check-host-restart'])
        self.assertFalse(plan['plan']['remote']);self.assertTrue(plan['plan']['native_host_restart_check'])
        key,job,commands=self.launch_helper({'provider':'pi','mode':'host_restart'},'pass');self.wait_job(job)
        self.assertEqual(commands[0][2:],['run','pi','--execute','--check-host-restart'])

    def test_pi_cancel_console_plan_is_fixed_local_and_single_use(self):
        code, raw, _ = self.request('/api/plan', {'provider':'pi','mode':'cancel'})
        self.assertEqual(code,200);plan=json.loads(raw)
        self.assertTrue(plan['executable']);self.assertFalse(plan['plan']['remote'])
        self.assertEqual(plan['plan']['command'][2:], ['run','pi','--execute','--check-cancel'])
        key,job,commands=self.launch_helper({'provider':'pi','mode':'cancel'},'pass')
        self.wait_job(job);self.assertEqual(commands[0][2:],['run','pi','--execute','--check-cancel'])
        with self.assertRaises(console.ConsoleError):self.app.execute(key)

    def test_terminal_dispatch_only_local_and_cannot_mix_modes(self):
        with patch.object(dispatch,'detect') as detect:
            for provider,options in [('pi',{}),('grok',{}),('opencode',{'check_cancel':True}),('opencode',{'check_failure':401})]:
                with self.assertRaises(console.SlotError):dispatch.launch(provider,False,self.lab,keep_open=True,**options)
            detect.assert_not_called()
        plan=dispatch.plan('opencode',keep_open=True)
        self.assertIn('--keep-open',plan['command']);self.assertFalse(plan['remote'])


if __name__=='__main__':unittest.main()

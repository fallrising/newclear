"""M4 kernel closure, not original-runtime qualification."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import storage_lifecycle as lifecycle


class ProjectionTests(unittest.TestCase):
    def test_empty_failure_prefix_is_strict_and_private_fields_are_rejected(self):
        value = lifecycle.initial()
        self.assertEqual(lifecycle.project(value), value)
        for key, item in [('extra', 'SECRET'), ('mode', 'fake'), ('schema_version', True)]:
            bad = copy.deepcopy(value); bad[key] = item
            with self.subTest(key=key), self.assertRaises(lifecycle.LifecycleError):
                lifecycle.project(bad)

    def test_closed_epoch_and_complete_projection_enforce_proof_relationships(self):
        value = lifecycle.initial()
        row = lifecycle.epoch_record(1)
        row.update(root=dict(pid=1, pgid=1, start_ticks=1), root_exit_code=0,
                   was_running=True, launches=1, waited=1, closed=True)
        value['epochs'] = [row]
        self.assertEqual(lifecycle.project(value), value)
        for changes in (dict(waited=0), dict(pipes_open=1), dict(root_exit_code=7),
                        dict(forced=True), dict(snapshot_complete=True), dict(launches=True),
                        dict(adopted_reaped=1025)):
            bad=copy.deepcopy(value); bad['epochs'][0].update(changes)
            with self.subTest(changes=changes), self.assertRaises(lifecycle.LifecycleError):
                lifecycle.project(bad)
        with self.assertRaises(lifecycle.LifecycleError): lifecycle.project(value, complete=True)

    def test_incremental_launch_bound_and_schema_counter_bounds(self):
        owner=lifecycle.Runner.__new__(lifecycle.Runner)
        owner.value=lifecycle.initial();owner.value['epochs']=[lifecycle.epoch_record(1)]
        owner.registry=[None]*1024;owner.failure=None;owner.terminal=False;owner.receipts={}
        owner.check=lambda:None
        with self.assertRaises(lifecycle.LifecycleError) as caught:owner.launch_check()
        self.assertEqual(caught.exception.reason,'limit')
        for changes in (dict(root_exit_code=0),dict(forced=True),dict(was_running=True),dict(launches=1025)):
            value=lifecycle.initial();row=lifecycle.epoch_record(1);row.update(changes);value['epochs']=[row]
            with self.subTest(changes=changes),self.assertRaises(lifecycle.LifecycleError):lifecycle.project(value)
        value=lifecycle.initial();row=lifecycle.epoch_record(1);value['epochs']=[row]
        row['sampling']['reasons']['child_missing']=1025
        row['sampling']['ambiguous_edges']=1025
        with self.assertRaises(lifecycle.LifecycleError):lifecycle.project(value)

    def test_entry_refusal_is_bounded_sanitized_and_does_not_start_integration(self):
        stream=StringIO()
        with patch.object(lifecycle,'Runner',side_effect=lifecycle.LifecycleError('policy')), \
             patch.object(sys,'argv',['storage_lifecycle.py']), \
             patch.object(lab:=lifecycle.lab,'integration') as integration,redirect_stdout(stream):
            self.assertEqual(lifecycle.main(),1)
        integration.assert_not_called()
        value=json.loads(stream.getvalue())
        self.assertFalse(value['runtime_started'])
        self.assertEqual(value['storage_lifecycle']['failure'],'policy')
        self.assertLess(len(stream.getvalue()),8192)


FIXTURE = r'''
import json,os,signal,subprocess,sys,time
from pathlib import Path
import storage_lifecycle as s
root=Path(sys.argv[1]); case=sys.argv[2]
r=s.Runner(); result={};timers=[]
try:
    if case=='source-cwd':
        result['source']=r.source_commit()
        seal=r.finalize(time.monotonic()+1)
        r.consume_deletion(seal,lambda:result.update(deleted=True))
    elif case=='bind-failure':
        class BadScope:
            def check_owner(self):raise s.lab.LabError('fixture ownership failure')
        r.bind_scope(BadScope())
    elif case=='flood':
        output=r.command([sys.executable,'-c','print("x"*100000);print("EXACT-TAIL-MARKER")'],1)
        result['tail_bytes']=len(output.encode());result['tail_marker']=output.endswith('EXACT-TAIL-MARKER\n')
        seal=r.finalize(time.monotonic()+1)
        r.consume_deletion(seal,lambda:result.update(deleted=True))
    elif case in ('command-timeout','stolen-status'):
        if case=='stolen-status':
            import ctypes
            oldwait=subprocess.Popen.wait
            def steal(self,*args,**kwargs):
                ctypes.CDLL(None).waitpid(self.pid,ctypes.byref(ctypes.c_int()),0)
                return oldwait(self,*args,**kwargs)
            subprocess.Popen.wait=steal
        code={'command-timeout':'import time;time.sleep(10)',
              'stolen-status':'raise SystemExit(7)'}[case]
        r.command([sys.executable,'-c',code],.05 if case=='command-timeout' else 1)
    elif case=='command-nonzero':
        try:r.command([sys.executable,'-c','raise SystemExit(7)'],1)
        except s.lab.LabError:
            result['actual_status']=r.registry[-1][0].returncode
        seal=r.finalize(time.monotonic()+1)
        r.consume_deletion(seal,lambda:result.update(deleted=True))
    elif case=='command':
        assert r.command([sys.executable,'-c','print("ok")'],1).strip()=='ok'
        seal=r.finalize(time.monotonic()+1)
        r.consume_deletion(seal,lambda:result.update(deleted=True))
        result['cleanup']=r.evidence()['cleanup']
    else:
        helper=root/'helper.py'
        helper.write_text(r"""import json,os,signal,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]); case=sys.argv[2]
child=subprocess.Popen([sys.executable,'-c',"from pathlib import Path;import sys,time\np=Path(sys.argv[1])\nwhile not p.exists():time.sleep(.005)",str(root/'release')])
transient=None
if case in ('transient','generic-transient'):
 transient=subprocess.Popen([sys.executable,'-c','import time; time.sleep(10)'])
 (root/'transient').write_text(str(transient.pid))
def stop(*_):
 if case=='held-pipe':sys.exit(0)
 if transient is not None and transient.poll() is None:transient.terminate();transient.wait(timeout=1)
 child.terminate();child.wait(timeout=1);sys.exit(7 if case=='nonzero' else 0)
signal.signal(signal.SIGTERM,stop)
if case=='forced':signal.signal(signal.SIGTERM,signal.SIG_IGN)
(root/'ready').write_text(str(child.pid))
if case in ('orphan','kernel-alarm'):
 p=os.fork()
 if p==0:
  signal.signal(signal.SIGTERM,signal.SIG_DFL)
  os.close(0);os.close(1);os.close(2)
  (root/'orphan').write_text(str(os.getpid()))
  while not (root/'release').exists():time.sleep(.005)
  os._exit(0)
while True:
 if transient is not None and (root/'kill-transient').exists() and transient.poll() is None:
  transient.terminate();transient.wait(timeout=1);(root/'transient-gone').touch()
 time.sleep(.005)
""")
        if case=='foreign-internal-wait':
            def foreign_read(self):
                try:self.process._internal_poll()
                except s.LifecycleError:pass
            s.Daemon._read=foreign_read
        if case=='partial-start':r.identity=lambda process:r.fail('identity')
        d=r.start_daemon([sys.executable,str(helper),str(root),case])
        end=time.monotonic()+2
        while not (root/'ready').exists():
            assert time.monotonic()<end;time.sleep(.005)
        if case in ('transient','generic-transient'):
            import lab
            original_info=lab.process_info;pid=int((root/'transient').read_text());reads=[0]
            def hooked_info(value):
                if value==pid:
                    reads[0]+=1
                    if reads[0]==2:
                        (root/'kill-transient').touch()
                        while not (root/'transient-gone').exists():
                            assert time.monotonic()<end;time.sleep(.005)
                return original_info(value)
            lab.process_info=hooked_info
            if case=='generic-transient':
                import threading
                generic=lab.Process.__new__(lab.Process)
                generic.identity=d.identity;generic.process=d.process
                generic.known={(d.identity['pid'],d.identity['start_ticks']):d.identity}
                generic.lock=threading.Lock();generic.scan_lock=threading.Lock()
                generic.observation_error=None;generic.observation_reason=None
                try:generic.snapshot()
                except lab.ProcessObservationError as exc:result['generic_reason']=exc.observation_reason
                else:raise AssertionError('generic observer accepted disappearing helper')
                lab.process_info=original_info
        assert r.sample_liveness(d)
        if case=='transient':lab.process_info=original_info
        if case.startswith('raw-'):
            name=case[4:]
            args={'wait':(), 'wait3':(os.WNOHANG,), 'wait4':(-1,os.WNOHANG),
                  'waitpid':(-1,os.WNOHANG), 'waitid':(os.P_ALL,0,os.WEXITED|os.WNOHANG)}[name]
            getattr(os,name)(*args)
        if case=='foreign-thread':
            import threading
            threading.Thread(target=lambda:None).start()
        if case=='foreign-fork':os.fork()
        if case=='low-thread-alias':
            import _thread
            _thread.start_new(lambda:None,())
        if case=='thread-limit':
            import threading
            def expire():pass
            expire.__module__='lab';expire.__qualname__='LocalHTTP.request.<locals>.expire'
            for _ in range(2):
                timer=threading.Timer(5,expire);timers.append(timer);timer.start()
        if case=='identity':d.identity=dict(d.identity,start_ticks=d.identity['start_ticks']+1)
        if case=='cancel': r.cancel()
        if case=='policy': signal.signal(signal.SIGCHLD,lambda *_:None)
        if case=='early': d.process.terminate();d.process.wait(timeout=1)
        if case=='kernel-wait-error':
            def broken_wait(*_):raise OSError('fixture kernel wait failure')
            r._waitid=broken_wait
            r.finalize(time.monotonic()+1)
        elif case=='kernel-alarm':
            while not (root/'orphan').exists():
                assert time.monotonic()<end;time.sleep(.005)
            def alarm(*_):raise s.lab.LabError('fixture cleanup deadline')
            signal.signal(signal.SIGALRM,alarm);signal.setitimer(signal.ITIMER_REAL,.03)
            r.finalize(time.monotonic()+1)
        elif case in ('late','late-thread'):
            r.close_epoch(d,time.monotonic()+1)
            if case=='late-thread':
                import threading
                threading.Thread(target=lambda:None).start()
            else:r.command([sys.executable,'-c','pass'],1)
        elif case in ('forced','held-pipe'):
            r.close_epoch(d,time.monotonic()+.08)
        elif case=='orphan':
            while not (root/'orphan').exists():
                assert time.monotonic()<end;time.sleep(.005)
            r.close_epoch(d,time.monotonic()+.15)
        elif case in ('cancel','policy','early','identity','nonzero'):
            r.close_epoch(d,time.monotonic()+1)
        else:
            receipt_deadline=time.monotonic()+(.25 if case=='receipt-expired' else 1)
            receipt=r.close_epoch(d,receipt_deadline)
            result['shutdown']=r.shutdown(d)
            if case=='receipt-expired':time.sleep(max(0,receipt_deadline-time.monotonic()+.01))
            r.consume_snapshot(receipt,'cold_baseline')
            if case=='replay':r.consume_snapshot(receipt,'cold_baseline')
            elif case=='snapshot-failed':
                r.snapshot_finished(receipt,success=False,locks_released=True)
                r.next_epoch()
            else:
                r.snapshot_finished(receipt,success=True,locks_released=True)
                r.next_epoch()
                if case=='three-epochs':
                    for phase in s.PHASES[1:]:
                        (root/'ready').unlink()
                        d=r.start_daemon([sys.executable,str(helper),str(root),case])
                        until=time.monotonic()+2
                        while not (root/'ready').exists():
                            assert time.monotonic()<until;time.sleep(.005)
                        receipt=r.close_epoch(d,time.monotonic()+1)
                        r.consume_snapshot(receipt,phase)
                        r.snapshot_finished(receipt,success=True,locks_released=True)
                        if phase!=s.PHASES[-1]:r.next_epoch()
                # A failure in epoch2 before its daemon exists may safely close.
                seal_deadline=time.monotonic()+(.1 if case=='seal-expired' else 1)
                seal=r.finalize(seal_deadline)
                if case=='seal-expired':time.sleep(max(0,seal_deadline-time.monotonic()+.01))
                if case=='delete-cancel':r.cancel()
                r.consume_deletion(seal,lambda:result.update(deleted=True))
                if case=='seal-replay':r.consume_deletion(seal,lambda:None)
                if case=='generic-transient':result['generic_still_refused']=bool(generic.observation_error)
except s.lab.LabError as exc:
    result['error']=getattr(exc,'reason',r.failure)
finally:
    signal.setitimer(signal.ITIMER_REAL,0)
    for timer in timers:
        timer.cancel()
        if timer.ident is not None:timer.join(timeout=1)
    (root/'release').touch()
    # Exact registered direct children only; test helper reaps its own child.
    r.contain(time.monotonic()+2)
    signal.signal(signal.SIGCHLD,signal.SIG_DFL)
    result['evidence']=r.evidence()
print(json.dumps(result))
'''

COORDINATOR = r'''
import ctypes,json,os,signal,subprocess,sys,time
signal.signal(signal.SIGCHLD,signal.SIG_DFL)
assert ctypes.CDLL(None).prctl(36,1,0,0,0)==0
p=subprocess.run([sys.executable,'-c',sys.argv[1],*sys.argv[2:]],capture_output=True,text=True,timeout=6)
assert p.returncode==0,p.stderr
value=json.loads(p.stdout);end=time.monotonic()+2;adopted=0
while True:
 try:item=os.waitid(os.P_ALL,0,os.WEXITED|os.WNOHANG|os.WNOWAIT)
 except ChildProcessError:break
 if item is not None:os.waitpid(item.si_pid,0);adopted+=1
 else:
  assert time.monotonic()<end;time.sleep(.005)
value['no_children']=True
value['coordinator_adopted_reaped']=adopted
print(json.dumps(value))
'''


class ActualOwnershipTests(unittest.TestCase):
    def run_case(self, case):
        with tempfile.TemporaryDirectory() as tmp:
            env=dict(os.environ);env.pop('PYTHONPATH',None)
            source='import sys;sys.path.insert(0,'+repr(str(Path(__file__).resolve().parents[1]))+')\n'+FIXTURE
            done=subprocess.run([sys.executable,'-c',COORDINATOR,source,tmp,case],
                                capture_output=True,text=True,env=env,cwd=tmp,timeout=8)
            self.assertEqual(done.returncode,0,done.stderr)
            value=json.loads(done.stdout)
            self.assertTrue(value['no_children'])
            if 'AGENT_EVIDENCE_DIR' in os.environ:
                Path(os.environ['AGENT_EVIDENCE_DIR'],'owned-'+case+'.json').write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
            return value

    def test_real_root_identity_normal_shutdown_epochs_and_distinct_terminal_seal(self):
        value=self.run_case('normal')
        self.assertTrue(value['deleted'])
        self.assertEqual(value['shutdown']['exit_code'],0)
        self.assertFalse(value['shutdown']['forced'])
        self.assertTrue(value['shutdown']['all_owned_exited'])
        self.assertEqual(len(value['evidence']['epochs']),2)
        self.assertIsNone(value['evidence']['epochs'][1]['root'])
        self.assertTrue(value['evidence']['cleanup']['kernel_echild'])

    def test_no_daemon_command_cleanup(self):
        self.assertTrue(self.run_case('command')['deleted'])
        value=self.run_case('command-nonzero')
        self.assertEqual(value['actual_status'],7)
        self.assertTrue(value['deleted'])
        flood=self.run_case('flood')
        self.assertTrue(flood['deleted'])
        self.assertTrue(flood['tail_marker'])
        self.assertEqual(flood['tail_bytes'],32768)

    def test_actual_disappearing_helper_retains_stable_child_and_kernel_closure(self):
        value=self.run_case('transient')
        self.assertTrue(value['deleted'])
        sample=value['evidence']['epochs'][0]['sampling']
        self.assertGreater(sample['stable_children'],0)
        self.assertEqual(sample['reasons']['child_missing'],1)
        generic=self.run_case('generic-transient')
        self.assertEqual(generic['generic_reason'],'child_missing')
        self.assertTrue(generic['generic_still_refused'])
        self.assertTrue(generic['deleted'])

    def test_source_identity_is_component_bound_from_external_cwd(self):
        expected=subprocess.check_output(['git','rev-parse','HEAD'],cwd=Path(__file__).resolve().parents[1],text=True).strip()
        self.assertEqual(self.run_case('source-cwd')['source'],expected)

    def test_three_real_daemon_generations_close_three_single_use_epochs(self):
        value=self.run_case('three-epochs')
        self.assertTrue(value['deleted'])
        projected=lifecycle.project(value['evidence'],complete=True)
        roots=[row['root'] for row in projected['epochs']]
        self.assertEqual(len({row['pid'] for row in roots}),3)

    def test_expired_capabilities_cannot_authorize_snapshot_or_deletion(self):
        for case in ('receipt-expired','seal-expired'):
            with self.subTest(case=case):
                value=self.run_case(case)
                self.assertEqual(value.get('error'),'deadline')
                self.assertNotIn('deleted',value)
                self.assertNotEqual(value['evidence']['cleanup']['status'],'verified')

    def test_live_double_fork_blocks_closure_without_deletion(self):
        value=self.run_case('orphan')
        self.assertEqual(value['error'],'deadline')
        self.assertNotIn('deleted',value)
        self.assertIsNotNone(value['evidence']['failure'])

    def test_authority_and_replay_boundaries_are_sticky(self):
        for case,reason in [('cancel','cancelled'),('policy','policy'),('early','root_exit'),
                            ('late','launch'),('replay','receipt'),
                            ('snapshot-failed','receipt'),('delete-cancel','cancelled'),
                            ('seal-replay','receipt')]:
            with self.subTest(case=case):
                value=self.run_case(case)
                self.assertEqual(value['error'],reason)
                if case!='seal-replay':self.assertNotIn('deleted',value)

    def test_real_wait_thread_launch_output_and_root_failure_boundaries(self):
        cases=[('raw-'+name,'wait') for name in ('wait','wait3','wait4','waitpid','waitid')]
        cases += [('foreign-internal-wait','wait'),('foreign-thread','launch'),
                  ('foreign-fork','launch'),('late-thread','launch'),('stolen-status','wait'),
                  ('identity','identity'),('partial-start','identity'),('nonzero','root_exit'),
                  ('forced','forced'),('held-pipe','output'),
                  ('command-timeout','deadline'),('bind-failure','identity'),
                  ('kernel-wait-error','wait'),('kernel-alarm','deadline'),
                  ('low-thread-alias','launch'),('thread-limit','limit')]
        for case,reason in cases:
            with self.subTest(case=case):
                value=self.run_case(case)
                self.assertEqual(value['error'],reason)
                self.assertNotIn('deleted',value)
                self.assertNotEqual(value['evidence']['cleanup']['status'],'verified')

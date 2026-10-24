"""Isolated actual-process M5 ownership tests; no upstream qualification."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lab

ROOT = r'''
import json,os,signal,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]); children=[]
def stop(*_):
    for p in children:
        if p.poll() is None:p.terminate()
    for p in children:p.wait(timeout=2)
    raise SystemExit(0)
signal.signal(signal.SIGTERM,stop)
stable=subprocess.Popen([sys.executable,'-c','import time;time.sleep(12)'],start_new_session=True,stdout=subprocess.DEVNULL)
helper=subprocess.Popen([sys.executable,'-c',"import sys,time;from pathlib import Path;p=Path(sys.argv[1]);end=time.monotonic()+10\nwhile not p.exists() and time.monotonic()<end:time.sleep(.002)",str(root/'exit')],stdout=subprocess.DEVNULL)
children=[stable,helper];(root/'pids').write_text(json.dumps([stable.pid,helper.pid]))
end=time.monotonic()+10
while time.monotonic()<end:
    if (root/'exit').exists() and helper.poll() is not None:(root/'reaped').touch()
    time.sleep(.002)
stop()
'''

REPARENT = r'''
import json,signal,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]);level=sys.argv[2] if len(sys.argv)>2 else 'root'
code=sys.argv[3] if len(sys.argv)>3 else ''
if level=='retained':
    end=time.monotonic()+7
    while not (root/'grand').exists() and time.monotonic()<end:time.sleep(.002)
    grand=subprocess.Popen([sys.executable,'-c','import time;time.sleep(6)'],start_new_session=True,stdout=subprocess.DEVNULL)
    (root/'grandpid').write_text(str(grand.pid))
    def stop(*_):
        grand.terminate();grand.wait(timeout=1);raise SystemExit(0)
    signal.signal(signal.SIGTERM,stop)
    while time.monotonic()<end:time.sleep(.002)
    stop()
elif level=='middle':
    child=subprocess.Popen([sys.executable,'-c',code,str(root),'retained',code],start_new_session=True,stdout=subprocess.DEVNULL)
    (root/'retained').write_text(str(child.pid));end=time.monotonic()+7
    while not (root/'detach').exists() and time.monotonic()<end:time.sleep(.002)
else:
    middle=subprocess.Popen([sys.executable,'-c',code,str(root),'middle',code],stdout=subprocess.DEVNULL)
    def stop(*_):
        if middle.poll() is None:middle.terminate()
        middle.wait(timeout=1);raise SystemExit(0)
    signal.signal(signal.SIGTERM,stop);end=time.monotonic()+7
    while time.monotonic()<end:
        if (root/'detach').exists() and middle.poll() is not None:(root/'detached').touch()
        time.sleep(.002)
    stop()
'''


def wait_file(path):
    end=time.monotonic()+3
    while not path.exists():
        if time.monotonic()>=end:raise AssertionError('fixture barrier timeout')
        time.sleep(.002)


class CausalTests(unittest.TestCase):
    def test_actual_generic_observer_retains_child_missing_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            with patch.object(lab.Process,'_monitor',lambda self:None):
                owner=lab.Process([sys.executable,'-c',ROOT,tmp])
            try:
                wait_file(root/'pids');stable,helper=json.loads((root/'pids').read_text())
                original=lab.process_info;reads=0
                def read(pid):
                    nonlocal reads
                    if pid==helper:
                        reads+=1
                        if reads==2:
                            (root/'exit').touch();wait_file(root/'reaped')
                    return original(pid)
                with patch.object(lab,'process_info',read):
                    with self.assertRaises(lab.ProcessObservationError) as caught:owner.snapshot()
                self.assertEqual(caught.exception.observation_reason,'child_missing')
                self.assertEqual(owner.observation_reason,'child_missing')
                self.assertIsNotNone(original(stable))
            finally:
                owner.process.terminate();owner.process.wait(timeout=3)
                owner.reader.join(2);owner.monitor.join(2);owner.process.stdout.close()

    def test_new_owner_strict_entry_and_projection_contract_exists(self):
        import crash_lifecycle as lifecycle
        self.assertEqual(lifecycle.project(lifecycle.initial())['mode'],'m5-kernel-owner')
        bad=lifecycle.initial();bad['limits']['targets']=True
        with self.assertRaises(lifecycle.LifecycleError):lifecycle.project(bad)


FIXTURE = r'''
import copy,ctypes,errno,json,os,shutil,signal,subprocess,sys,time
from pathlib import Path
from unittest.mock import patch
import crash_lifecycle as c
import lab,crash
root=Path(sys.argv[1]);case=sys.argv[2];code=sys.argv[3]
r=c.Runner();result={};daemon=None
def barrier(path):
    end=time.monotonic()+2
    while not path.exists():
        if time.monotonic()>end:raise AssertionError('barrier timeout')
        time.sleep(.002)
class Scope:
    def __init__(self):
        self.path=root/'scope';self.path.mkdir();self.marker='private-fixture'
        self.identity=dict(device=self.path.stat().st_dev,inode=self.path.stat().st_ino)
        self.checks=0;self.expire=None
    def check_owner(self):
        self.checks+=1
        if self.expire is not None and self.checks==3:time.sleep(max(0,self.expire-time.monotonic())+.01)
        assert self.path.is_dir() and self.identity==dict(device=self.path.stat().st_dev,inode=self.path.stat().st_ino)
try:
    if case in ('collect-waitid-expired','collect-waitpid-expired'):
        r.command([sys.executable,'-c','import os,time\npid=os.fork()\nif pid==0:os._exit(0)\ntime.sleep(.03)'],1)
        actual_waitid,actual_waitpid=r._waitid,r._waitpid
        cutoff=time.monotonic()+.08;calls=[];observed=[]
        def delayed_waitid(*args):
            item=actual_waitid(*args)
            if item is not None:
                observed.append(item.si_pid)
                if case=='collect-waitid-expired':time.sleep(max(0,cutoff-time.monotonic())+.02)
            return item
        def delayed_waitpid(*args):
            calls.append(dict(pid=args[0],after_cutoff=time.monotonic()>=cutoff))
            value=actual_waitpid(*args)
            if case=='collect-waitpid-expired':time.sleep(max(0,cutoff-time.monotonic())+.02)
            return value
        r._waitid,r._waitpid=delayed_waitid,delayed_waitpid
        try:
            try:r.finalize(deadline=cutoff)
            except c.LifecycleError as exc:result['reason']=exc.reason
        finally:r._waitid,r._waitpid=actual_waitid,actual_waitpid
        result.update(calls=calls,observed=observed,adopted_reaped=r.epoch['adopted_reaped'])
    elif case=='stolen-wait':
        daemon=r.start_daemon([sys.executable,'-c','raise SystemExit(7)'])
        r._waitpid(daemon.process.pid,0)
        try:daemon.process.poll()
        except c.LifecycleError as exc:result['reason']=exc.reason
    elif case=='reentrant':
        entered=False
        def audit(event,args):
            global entered
            if event=='subprocess.Popen' and not entered:
                entered=True;r.command([sys.executable,'-c','pass'],1)
        sys.addaudithook(audit)
        try:r.command([sys.executable,'-c','pass'],1)
        except c.LifecycleError as exc:result['reason']=exc.reason
    elif case=='policy':
        signal.signal(signal.SIGCHLD,signal.SIG_IGN)
        try:r.command([sys.executable,'-c','pass'],1)
        except c.LifecycleError as exc:result['reason']=exc.reason
        finally:signal.signal(signal.SIGCHLD,signal.SIG_DFL)
    elif case in ('deletion-expired','deletion-overrun','deletion-replay'):
        scope=Scope();r.bind_scope(scope)
        r.command([sys.executable,'-c','pass'],1)
        seal,shutdown=r.finalize(deadline=time.monotonic()+.08)
        def remove():
            shutil.rmtree(scope.path);r._record_removal()
            if case=='deletion-overrun':time.sleep(.15)
            return dict(scope_removed=True)
        if case=='deletion-expired':time.sleep(max(0,seal.deadline-time.monotonic())+.01)
        try:
            r.consume_deletion(seal,remove)
            if case=='deletion-replay':r.consume_deletion(seal,remove)
        except (c.LifecycleError,lab.LabError) as exc:result['reason']=getattr(exc,'reason','deadline')
        result.update(exists=scope.path.exists(),removed=r.removal_observed,evidence=r.evidence())
    elif case=='reparented':
        daemon=r.start_daemon([sys.executable,'-c',code,str(root),'root',code])
        barrier(root/'retained');retained=int((root/'retained').read_text())
        r.sample_liveness(daemon);(root/'detach').touch();barrier(root/'detached')
        assert lab.process_info(retained)['ppid']==os.getpid()
        (root/'grand').touch();barrier(root/'grandpid');grand=int((root/'grandpid').read_text())
        receipt,token=r.abrupt_shutdown(daemon,deadline=time.monotonic()+2)
        result.update(targets=[x['pid'] for x in receipt['targets']],retained=retained,grand=grand,status=receipt['status'])
    elif case=='output':
        text=r.command([sys.executable,'-c','print("x"*100000);print("TAIL-MARKER")'],1)
        result.update(tail_bytes=len(text.encode()),marker=text.endswith('TAIL-MARKER\n'))
        r.finalize(deadline=time.monotonic()+1)
    elif case=='drain-timeout':
        writer="import subprocess,sys;subprocess.Popen([sys.executable,'-c','import time;time.sleep(.2)'])"
        try:r.command([sys.executable,'-c',writer],.05)
        except c.LifecycleError as exc:result['reason']=exc.reason
    elif case=='target-limit':
        many="""import signal,subprocess,sys,time
from pathlib import Path
children=[]
def stop(*_):
    for p in children:
        if p.poll() is None:p.terminate()
    for p in children:p.wait(timeout=2)
    raise SystemExit(0)
signal.signal(signal.SIGTERM,stop)
for _ in range(64):children.append(subprocess.Popen([sys.executable,'-c','import time;time.sleep(7)'],stdout=subprocess.DEVNULL))
Path(sys.argv[1]).touch()
time.sleep(6)
stop()
"""
        daemon=r.start_daemon([sys.executable,'-c',many,str(root/'ready')]);barrier(root/'ready')
        try:r.abrupt_shutdown(daemon,deadline=time.monotonic()+2)
        except crash.CrashError as exc:result.update(reason=r.failure,signaled=exc.receipt['signaled'])
    elif case=='commands':
        result['source']=r.source_commit()
        try:r.command([sys.executable,'-c','raise SystemExit(7)'],1)
        except lab.LabError:result['ordinary']=r.failure is None
        seal,shutdown=r.finalize(deadline=time.monotonic()+1)
        result['closed']=r.epoch['closed'];result['echild']=r.epoch['kernel_echild']
    elif case=='cancel':
        r.cancel()
        try:r.start_daemon([sys.executable,'-c','pass'])
        except c.LifecycleError as exc:result['reason']=exc.reason
    else:
        if case=='scope-expiry':
            scope=Scope();r.bind_scope(scope)
        if case=='unknown':
            orphan="import os,time;pid=os.fork()\nif pid==0:time.sleep(.35);os._exit(0)\n"
            injection="\nunknown=subprocess.Popen([sys.executable,'-c',"+repr(orphan)+"],stdout=subprocess.DEVNULL);unknown.wait(timeout=1)\n"
            code=code.replace("children=[stable,helper];",injection+"children=[stable,helper];")
        daemon=r.start_daemon([sys.executable,'-c',code,str(root)])
        end=time.monotonic()+2
        while not (root/'pids').exists():
            if time.monotonic()>end:raise AssertionError('barrier')
            time.sleep(.002)
        stable,helper=json.loads((root/'pids').read_text());original=lab.process_info;reads=0
        def read(pid):
            global reads
            if pid==helper:
                reads+=1
                if reads==2:
                    (root/'exit').touch();end=time.monotonic()+2
                    while not (root/'reaped').exists():
                        if time.monotonic()>end:raise AssertionError('reap barrier')
                        time.sleep(.002)
            return original(pid)
        if case=='strict':
            with patch.object(lab,'process_info',read):
                try:r.abrupt_shutdown(daemon,deadline=time.monotonic()+2)
                except crash.CrashError as exc:result.update(reason=exc.reason,signaled=exc.receipt['signaled'])
        else:
            with patch.object(lab,'process_info',read):r.sample_liveness(daemon)
            result['ambiguous']=r.value['sampling']['reasons']['child_missing']
            if case=='unknown':
                try:r.abrupt_shutdown(daemon,deadline=time.monotonic()+1)
                except crash.CrashError as exc:result.update(reason=r.failure,signaled=exc.receipt['signaled'])
            elif case=='normal-root':
                daemon.process.terminate();daemon.process.wait(timeout=1)
                try:r.abrupt_shutdown(daemon,deadline=time.monotonic()+1)
                except crash.CrashError as exc:result.update(reason=r.failure,signaled=exc.receipt['signaled'])
            elif case=='identity':
                read=r._read
                def changed(pid):
                    item=read(pid)
                    if item is not None and pid==daemon.identity['pid']:item=dict(item,start_ticks=item['start_ticks']+1)
                    return item
                with patch.object(r,'_read',changed):
                    try:r.abrupt_shutdown(daemon,deadline=time.monotonic()+1)
                    except crash.CrashError as exc:result.update(reason=r.failure,signaled=exc.receipt['signaled'])
            elif case=='partial':
                kill=os.kill
                def disappear(pid,sig):
                    kill(pid,sig)
                    if pid==daemon.identity['pid']:
                        kill(stable,signal.SIGKILL);end=time.monotonic()+1
                        while (value:=original(stable)) is not None and value['state']!='Z':
                            if time.monotonic()>end:raise AssertionError('child exit barrier')
                            time.sleep(.002)
                with patch.object(c.os,'kill',disappear):
                    try:r.abrupt_shutdown(daemon,deadline=time.monotonic()+1)
                    except crash.CrashError as exc:result.update(reason=exc.reason,signaled=exc.receipt['signaled'],receipt=exc.receipt)
            elif case=='normal':
                seal,shutdown=r.finalize(deadline=time.monotonic()+2)
                result.update(code=shutdown['exit_code'],kind=r.epoch['closure_kind'])
            elif case=='late-launch':
                r.freeze_targets(daemon,deadline=time.monotonic()+2)
                try:r.command([sys.executable,'-c','pass'],1)
                except c.LifecycleError as exc:result['reason']=exc.reason
            else:
                receipt,token=r.abrupt_shutdown(daemon,deadline=time.monotonic()+(.12 if case in ('expired','scope-expiry') else 2))
                result.update(crash=receipt,echild=r.epoch['kernel_echild'])
                if case=='expired':
                    time.sleep(max(0,token.deadline-time.monotonic())+.01)
                    try:r.consume_restart(token,[sys.executable,'-c','pass'])
                    except c.LifecycleError as exc:result['reason']=exc.reason
                elif case=='scope-expiry':
                    scope.expire=token.deadline
                    try:r.consume_restart(token,[sys.executable,'-c',code,str(root)])
                    except c.LifecycleError as exc:result['reason']=exc.reason
                else:
                    other=root/'second';other.mkdir()
                    daemon=r.consume_restart(token,[sys.executable,'-c',code,str(other)])
                    end=time.monotonic()+2
                    while not (other/'pids').exists():
                        if time.monotonic()>end:raise AssertionError('second barrier')
                        time.sleep(.002)
                    seal,shutdown=r.finalize(deadline=time.monotonic()+2)
                    result.update(final_code=shutdown['exit_code'],closed=r.epoch['closed'],evidence=r.evidence())
finally:
    end=time.monotonic()+3
    while True:
        r.contain(deadline=end)
        try:item=r._waitid(os.P_ALL,0,os.WEXITED|os.WNOHANG|os.WNOWAIT)
        except ChildProcessError as exc:
            assert exc.errno==errno.ECHILD;result['final_echild']=True;break
        if time.monotonic()>=end:raise AssertionError('fixture leaked children')
        if item is not None:r._waitpid(item.si_pid,0)
        time.sleep(.01)
print(json.dumps(result),flush=True)
'''


class ActualOwnerTests(unittest.TestCase):
    def run_case(self,case):
        with tempfile.TemporaryDirectory() as tmp:
            result=subprocess.run([sys.executable,'-c',FIXTURE,tmp,case,REPARENT if case=='reparented' else ROOT],cwd=Path(lab.__file__).parent,capture_output=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr.decode())
            value=json.loads(result.stdout);self.assertTrue(value['final_echild']);return value

    def test_actual_causal_sample_then_strict_crash_restart_normal0(self):
        value=self.run_case('positive')
        self.assertEqual(value['ambiguous'],1)
        self.assertEqual(value['crash']['status'],'verified')
        self.assertEqual(value['crash']['root_exit_code'],-9)
        self.assertEqual(value['crash']['signaled'],2)
        self.assertTrue(value['echild'])
        self.assertEqual(value['final_code'],0)
        self.assertTrue(value['closed'])

    def test_same_disappearance_at_strict_freeze_refuses_before_signal(self):
        value=self.run_case('strict');self.assertEqual(value['signaled'],0)
        self.assertEqual(value['reason'],'ownership')

    def test_ordinary_failure_source_normal0_cleanup(self):
        value=self.run_case('normal');self.assertEqual(value['code'],0);self.assertEqual(value['kind'],'normal')

    def test_registered_source_and_clean_nonzero_before_daemon(self):
        value=self.run_case('commands');self.assertTrue(value['ordinary']);self.assertTrue(value['closed']);self.assertTrue(value['echild'])

    def test_expired_receipt_does_not_restart(self):
        self.assertEqual(self.run_case('expired')['reason'],'deadline')

    def test_cancel_and_closed_launch_gate_refuse(self):
        self.assertEqual(self.run_case('cancel')['reason'],'cancelled')
        self.assertEqual(self.run_case('late-launch')['reason'],'launch')

    def test_retained_reparented_live_parent_and_new_grandchild_both_signaled(self):
        value=self.run_case('reparented');self.assertEqual(value['status'],'verified')
        self.assertIn(value['retained'],value['targets']);self.assertIn(value['grand'],value['targets'])

    def test_actual_unknown_live_adopted_refuses_without_signal(self):
        value=self.run_case('unknown');self.assertEqual(value['reason'],'unknown_child');self.assertEqual(value['signaled'],0)

    def test_actual_postfreeze_child_disappearance_remains_failed_stimulus(self):
        value=self.run_case('partial');self.assertEqual(value['reason'],'identity');self.assertEqual(value['signaled'],1)
        self.assertFalse(value['receipt']['targets'][1]['signal_sent'])

    def test_actual_stolen_wait_reentrant_launch_and_policy_refuse(self):
        for case,reason in [('stolen-wait','wait'),('reentrant','launch'),('policy','policy')]:
            with self.subTest(case=case):self.assertEqual(self.run_case(case)['reason'],reason)

    def test_actual_original_cutoff_after_restart_scope_check(self):
        self.assertEqual(self.run_case('scope-expiry')['reason'],'deadline')

    def test_actual_deletion_expiry_overrun_and_replay_preserve_facts(self):
        for case,reason in [('deletion-expired','deadline'),('deletion-overrun','deadline'),('deletion-replay','receipt')]:
            with self.subTest(case=case):
                value=self.run_case(case);self.assertEqual(value['reason'],reason)
                self.assertEqual(value['exists'],case=='deletion-expired')
                self.assertEqual(value['removed'],case!='deletion-expired')
                if value['removed']:self.assertEqual(value['evidence']['cleanup']['status'],'removed')

    def test_bounded_output_tail_and_inherited_pipe_timeout(self):
        value=self.run_case('output');self.assertEqual(value['tail_bytes'],32768);self.assertTrue(value['marker'])
        self.assertEqual(self.run_case('drain-timeout')['reason'],'output')

    def test_actual_collect_wait_boundaries_preserve_original_cutoff(self):
        for case in ('collect-waitid-expired','collect-waitpid-expired'):
            with self.subTest(case=case):
                value=self.run_case(case)
                self.assertTrue(value['observed'])
                self.assertEqual(value['reason'],'deadline')
                self.assertFalse(any(call['after_cutoff'] for call in value['calls']))
                self.assertEqual(len(value['calls']),0 if case=='collect-waitid-expired' else 1)
                self.assertEqual(value['adopted_reaped'],0)

    def test_target_ceiling_identity_and_normal_exit_refuse_before_signals(self):
        for case,reason in [('target-limit','limit'),('identity','identity'),('normal-root','root_exit')]:
            with self.subTest(case=case):
                value=self.run_case(case);self.assertEqual(value['reason'],reason);self.assertEqual(value['signaled'],0)


class SchemaTests(unittest.TestCase):
    def setUp(self):
        import crash_lifecycle as c
        self.c=c

    def test_private_bool_nonfinite_counts_and_fixed_limits_are_refused(self):
        for mutate in (
            lambda v:v.update(private_path='/private/SECRET'),
            lambda v:v.update(schema_version=True),
            lambda v:v['limits'].update(targets=True),
            lambda v:v['limits'].update(targets=65),
            lambda v:v['sampling'].update(attempted=True),
            lambda v:v['sampling'].update(stable_children=1025),
            lambda v:v['sampling'].update(stable_children=float('nan')),
            lambda v:v['sampling']['reasons'].update(child_missing=1),
            lambda v:v['restart'].update(status='consumed'),
            lambda v:v['cleanup'].update(status='removed',kernel_echild=True),
            lambda v:v['containment'].update(complete=True)):
            value=self.c.initial();mutate(value)
            with self.subTest(value=value),self.assertRaises(self.c.LifecycleError):self.c.project(value)

    def test_closed_proof_and_generation_identity_cannot_be_fabricated(self):
        c=self.c;value=c.initial();row=c.generation_record(1)
        row.update(root=dict(pid=10,pgid=10,start_ticks=5),launches=1,waited=1,
                   launches_closed=True,history_nonlive=True,drains_closed=True,
                   kernel_echild=True,closed=True,closure_kind='crash',root_exit_code=-9)
        value['generations']=[row];value['restart']=dict(status='consumed',reason=None)
        self.assertEqual(c.project(value),value)
        for changes in (dict(waited=0),dict(pipes_open=1),dict(threads_open=1),dict(kernel_echild=False),
                        dict(root_exit_code=0),dict(failure='wait'),dict(closed=True,closure_kind='not_run')):
            bad=copy.deepcopy(value);bad['generations'][0].update(changes)
            with self.subTest(changes=changes),self.assertRaises(c.LifecycleError):c.project(bad)
        other=c.generation_record(2);other.update(root=dict(pid=10,pgid=999,start_ticks=5),launches=1)
        value['generations'].append(other)
        with self.assertRaises(c.LifecycleError):c.project(value)

    def test_contextual_projector_rejects_unbacked_crash_and_false_removed_claim(self):
        import crash
        c=self.c;value=c.initial();row=c.generation_record(1)
        row.update(root=dict(pid=10,pgid=10,start_ticks=5),launches=1,waited=1,
                   launches_closed=True,history_nonlive=True,drains_closed=True,
                   kernel_echild=True,closed=True,closure_kind='crash',root_exit_code=-9)
        value['generations']=[row]
        with self.assertRaises(c.LifecycleError):
            c.project_report(value,crash_receipt=crash.initial_crash(),daemon_before=row['root'],daemon_after=None,final_shutdown=None,scope_removed=None)
        value=c.initial();row=c.generation_record(1)
        row.update(launches_closed=True,history_nonlive=True,drains_closed=True,kernel_echild=True,closed=True,closure_kind='commands')
        value['generations']=[row];value['cleanup']=dict(status='removed',reason=None,kernel_echild=True)
        with self.assertRaises(c.LifecycleError):
            c.project_report(value,crash_receipt=crash.initial_crash(),daemon_before=None,daemon_after=None,final_shutdown=None,scope_removed=False)

    def test_contextual_normal_closure_rejects_observation_error(self):
        import crash
        c=self.c;value=c.initial();row=c.generation_record(1)
        row.update(root=dict(pid=10,pgid=10,start_ticks=5),launches=1,waited=1,
                   launches_closed=True,history_nonlive=True,drains_closed=True,
                   kernel_echild=True,closed=True,closure_kind='normal',root_exit_code=0)
        value['generations']=[row]
        shutdown=dict(was_running=True,signal='SIGTERM',forced=False,exit_code=0,
                      all_owned_exited=True,observation_error='identity')
        with self.assertRaises(c.LifecycleError):
            c.project_report(value,crash_receipt=crash.initial_crash(),daemon_before=row['root'],
                             daemon_after=None,final_shutdown=shutdown,scope_removed=None)


if __name__=='__main__':unittest.main()

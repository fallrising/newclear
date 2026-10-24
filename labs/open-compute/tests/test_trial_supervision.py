"""Synthetic M7 delegation; kernel policy is changed only in new child processes."""
import copy
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lab
import trial_supervision as supervision


class FrameTests(unittest.TestCase):
    def frame(self):
        return dict(version=1, kind='READY', seq=0, pid=12, start=34, deadline_ns=123456)

    def test_closed_schema_rejects_ambiguous_types_and_extra_authority(self):
        for key, value in [('version', True), ('seq', False), ('pid', []),
                           ('start', True), ('deadline_ns', -1), ('kind', 'GO')]:
            item = self.frame(); item[key] = value
            with self.subTest(key=key), self.assertRaises(supervision.SupervisionError):
                supervision.validate_frame(item)
        item = self.frame(); item['argv'] = 'private-canary'
        with self.assertRaises(supervision.SupervisionError):
            supervision.validate_frame(item)

    def test_packet_bounds_duplicates_partial_and_eof(self):
        for raw in [b'{', b'{"version":1,"version":1}', b'x' * 4097, b'']:
            with self.subTest(size=len(raw)):
                left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
                channel = supervision.Channel(left, time.monotonic()+2)
                try:
                    if raw: right.send(raw)
                    else: right.close()
                    with self.assertRaises(supervision.SupervisionError):channel.receive()
                finally:
                    channel.close(); right.close()

    def test_pending_terminal_rejects_bool_integer_aliases(self):
        value = dict(schema_version=1, command='serve', result='passed', error=None,
                     data=dict(stopped=True, clean_pending=True))
        for field in ('schema_version', 'stopped', 'clean_pending'):
            bad = copy.deepcopy(value)
            if field == 'schema_version':bad[field] = True
            else:bad['data'][field] = 1
            with self.subTest(field=field), self.assertRaises(supervision.SupervisionError):
                supervision.validate_pending_terminal(bad)


class ActualDelegationTests(unittest.TestCase):
    FIXTURE = r'''
import argparse, json, os, signal, subprocess, sys, threading, time
import lab
import trial_supervision as s
p = argparse.ArgumentParser()
p.add_argument('command'); p.add_argument('--state'); p.add_argument('--case')
p.add_argument('--supervision-fd',type=int);p.add_argument('--supervision-deadline-ns',type=int)
a=p.parse_args()
if a.case=='dispatch':
    import trial
    trial.run_destroy=lambda args:trial.success('destroy',{'destroyed':True})
    raise SystemExit(trial.main(['destroy','--state',a.state,'--supervision-fd',str(a.supervision_fd),
                                '--supervision-deadline-ns',str(a.supervision_deadline_ns)]))
if a.case.startswith('commit'):
    # Match existing DirectoryTests: only simulate safe external managed-mount
    # ancestry. Every file/dir inside this synthetic fixture stays real.
    from pathlib import Path
    import trial_state
    original_fstat=os.fstat;fixture=Path(a.state).parent
    def safe_external(fd):
        info=original_fstat(fd)
        target=Path(os.readlink('/proc/self/fd/'+str(fd)))
        if target!=fixture and target in fixture.parents:
            values=list(info);values[0]&=~0o022;values[4]=0
            return os.stat_result(values)
        return info
    trial_state.os.fstat=safe_external
if a.case=='initial-ignored':signal.signal(signal.SIGCHLD,signal.SIG_IGN)
if a.case=='unsupported':s.platform.machine=lambda:'unsupported'
if a.case=='slow-ready':time.sleep(.3)
owner=s.OwnerControl(a.supervision_fd,a.supervision_deadline_ns)
try:
    if a.case == 'nested':
        for _ in range(4):lab.command([sys.executable,'-c','pass'])
    elif a.case == 'orphan':
        code="import os,time; child=os.fork(); time.sleep(.08) if child==0 else None; os._exit(0)"
        child=subprocess.Popen([sys.executable,'-c',code],stdout=subprocess.DEVNULL)
        child.wait(timeout=2)
    elif a.case == 'orphan-gated':
        from pathlib import Path
        code="""
import os,sys,time
from pathlib import Path
root=Path(sys.argv[1]);child=os.fork()
if child==0:
    os.setsid();end=time.monotonic()+4
    while not (root/'release-orphan').exists() and time.monotonic()<end:time.sleep(.005)
os._exit(0)
"""
        child=subprocess.Popen([sys.executable,'-c',code,a.state],stdout=subprocess.DEVNULL)
        child.wait(timeout=2)
        collect=owner.collect
        def mark_collect():
            (Path(a.state)/'collecting').touch()
            return collect()
        owner.collect=mark_collect
    elif a.case == 'fd':
        code="import os,sys; fd=int(sys.argv[1]); expected=int(sys.argv[2]);\ntry: assert os.fstat(fd).st_ino!=expected\nexcept OSError: pass\nprint('closed')"
        assert lab.command([sys.executable,'-c',code,str(a.supervision_fd),
                            str(os.fstat(a.supervision_fd).st_ino)]).strip()=='closed'
    elif a.case == 'killed':
        os.kill(os.getpid(),signal.SIGKILL)
    elif a.case == 'ignored':
        signal.signal(signal.SIGCHLD,signal.SIG_IGN)
    elif a.case == 'nocldwait':
        import ctypes
        action=s.Sigaction();action.flags=2
        assert s.checked_libc().sigaction(signal.SIGCHLD,ctypes.byref(action),None)==0
    elif a.case == 'subreaper-off':assert s.checked_libc().prctl(36,0,0,0,0)==0
    elif a.case == 'leak':
        subprocess.Popen([sys.executable,'-c','pass'],pass_fds=(a.supervision_fd,))
    elif a.case == 'unknown-fork':os.fork()
    elif a.case == 'unfinished-pipe':
        child=subprocess.Popen([sys.executable,'-c','pass'],stdout=subprocess.PIPE)
        child.wait(timeout=2)
    elif a.case == 'waiter':
        child=subprocess.Popen([sys.executable,'-c','pass'],stdout=subprocess.DEVNULL)
        errors=[]
        def steal():
            try:child.wait(timeout=2)
            except s.SupervisionError:errors.append('refused')
        t=threading.Thread(target=steal);t.start();t.join();child.wait(timeout=2)
        assert errors==['refused']
    elif a.case == 'late':
        owner.collect()
        try:os.fork()
        except s.SupervisionError:pass
        else:raise AssertionError('late fork admitted')
    elif a.case == 'output':
        print('x'*(lab.LOG_LIMIT+1),flush=True)
    elif a.case == 'running':time.sleep(.3)
    if a.case.startswith('commit'):
        from pathlib import Path
        from trial_state import StateDirectory
        with StateDirectory(Path(a.state)) as state:owner.prepare_clean(state)
    if a.command=='serve':
        print(json.dumps(dict(schema_version=1,command='serve',result='passed',error=None,
                              data={'ready':True})),flush=True)
    data={'initialized':True} if a.command=='init' else {'stopped':True,'clean':True} if a.command=='serve' else {'destroyed':True}
    response=dict(schema_version=1,command=a.command,result='passed',error=None,data=data)
    if a.case == 'nonzero':response.update(result='failed',error='runtime',data={})
    if a.case == 'commit-expired':owner.begin_cleanup(time.monotonic()-.01)
    if a.case == 'cleanup-clamp':
        global_end=owner.channel.deadline;wire_end=owner.deadline_ns
        owner.begin_cleanup(global_end+10);assert owner.channel.deadline==global_end
        earlier=time.monotonic()+1;owner.begin_cleanup(earlier)
        owner.begin_cleanup(global_end+10)
        assert owner.channel.deadline==earlier and owner.deadline_ns==wire_end
    response=owner.finish(response)
    if a.case=='extra-frame':
        owner.channel.send(owner.frame('CLOSED',2,exit_code=0,reaped=0,commit=None,
                                        closure=owner.closure_nonce))
    if a.case=='commit-hold':time.sleep(.3)
    if a.case=='commit-nooutput':os._exit(0)
    print(json.dumps(response),flush=True)
    code=0 if response['result']=='passed' else 1
except BaseException as exc:
    owner.abort(getattr(exc,'reason','command'));code=1
finally:owner.close()
raise SystemExit(code)
'''

    def capture(self, case, seconds=5, command='destroy', state=None):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        source = Path(temp.name)/'synthetic_trial.py'
        source.write_text(self.FIXTURE)
        state = state or temp.name
        with patch.object(supervision, 'TRIAL_PATH', source):
            captured = supervision.SupervisedCapture(
                [sys.executable, str(source), command, '--state', str(state), '--case', case],
                deadline=time.monotonic()+seconds, state=state)
        def finish():
            if not captured.finished:captured.cancel(time.monotonic()+.1)
            self.assertIsNotNone(captured.process.returncode)
            self.assertFalse(captured.reader.is_alive())
        self.addCleanup(finish)
        return captured

    def test_actual_nested_reap_completes_only_under_explicit_kernel_delegation(self):
        captured=self.capture('nested')
        value=captured.completion()
        self.assertEqual(value['result'],'passed')
        self.assertEqual(captured.process.returncode,0)
        self.assertIsNone(captured.closure['commit'])
        self.assertFalse(captured.clean_committed)

    def test_actual_adopted_double_fork_is_collected_before_closed(self):
        captured=self.capture('orphan')
        captured.completion()
        self.assertEqual(captured.closure['reaped'],1)

    def test_control_descriptor_absent_in_actual_exec(self):
        self.capture('fd').completion()

    def test_actual_trial_main_opt_in_dispatch_uses_same_popen(self):
        captured=self.capture('dispatch')
        direct=captured.process.pid
        captured.completion()
        self.assertEqual(captured.identity['pid'],direct)
        self.assertEqual(captured.process.returncode,0)

    def test_nonzero_and_sigkill_are_actual_popen_results(self):
        captured=self.capture('nonzero')
        self.assertEqual(captured.completion('failed')['error'],'runtime')
        self.assertEqual(captured.process.returncode,1)
        killed=self.capture('killed')
        with self.assertRaises(supervision.SupervisionError):killed.completion()
        killed.process.wait(timeout=2)
        self.assertEqual(killed.process.returncode,-signal.SIGKILL)
        self.assertFalse(killed.clean_committed)

    def test_signal_policy_competing_waiter_and_late_launch_refuse_closure(self):
        for case in ('ignored','nocldwait','subreaper-off','waiter','late','unsupported',
                     'leak','unknown-fork','unfinished-pipe'):
            with self.subTest(case=case):
                captured=self.capture(case)
                with self.assertRaises(supervision.SupervisionError):captured.completion()
                self.assertIsNone(captured.closure)

    def test_forged_generation_extra_frame_and_nonowner_clean_request_fail(self):
        captured=self.capture('running')
        actual=captured.channel.receive
        message=actual();message['start']+=1
        with patch.object(captured.channel,'receive',return_value=message):
            with self.assertRaises(supervision.SupervisionError):captured.ready()
        self.assertFalse(captured.admitted)
        extra=self.capture('extra-frame')
        with self.assertRaises(supervision.SupervisionError):extra.completion()
        client=self.capture('nested')
        client.ready()
        closed=client.channel.receive();closed['commit']='f'*64
        with patch.object(client.channel,'receive',return_value=closed), \
             patch.object(supervision,'commit_clean') as save:
            with self.assertRaises(supervision.SupervisionError):client.completion()
            save.assert_not_called()

    def test_ack_while_collecting_live_orphan_is_rejected_and_fixture_reaps_it(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        root=Path(temp.name)
        source=root/'owner.py';source.write_text(self.FIXTURE)
        coordinator=r'''
import json,os,sys,time
from pathlib import Path
import trial_supervision as s
s.kernel_setup();s.TRIAL_PATH=Path(sys.argv[1]);root=Path(sys.argv[2])
c=s.SupervisedCapture([sys.executable,str(s.TRIAL_PATH),'destroy','--state',str(root),
                       '--case','orphan-gated'],deadline=time.monotonic()+5,state=root)
refused=False
try:
    c.ready();end=time.monotonic()+3
    while not (root/'collecting').exists():
        assert time.monotonic()<end
        time.sleep(.005)
    c.channel.send(c.frame('ACK',3,closure='0'*32))
    try:c.completion()
    except s.SupervisionError:refused=True
finally:
    (root/'release-orphan').touch();c.cancel(time.monotonic()+.2)
reaped=0;end=time.monotonic()+3
while True:
    try:r=os.waitid(os.P_ALL,0,os.WEXITED|os.WNOHANG|os.WNOWAIT)
    except ChildProcessError:break
    if r is not None:os.waitpid(r.si_pid,0);reaped+=1
    else:
        assert time.monotonic()<end
        time.sleep(.005)
print(json.dumps({'refused':refused,'reaped':reaped,'closed':True}))
'''
        result=subprocess.run([sys.executable,'-c',coordinator,str(source),str(root)],
                              capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout),{'refused':True,'reaped':1,'closed':True})

    def test_cancel_during_output_drain_prevents_clean_commit(self):
        path,_=self.private_state()
        captured=self.capture('commit',command='init',state=path)
        join=captured.reader.join;triggered=[]
        def cancel_after_join(*args,**kwargs):
            value=join(*args,**kwargs)
            if not triggered:
                triggered.append(True);captured.cancel(time.monotonic()+.1)
            return value
        with patch.object(captured.reader,'join',side_effect=cancel_after_join):
            with self.assertRaises((supervision.SupervisionError,OSError)):
                captured.completion()
        self.assertFalse(captured.clean_committed)
        self.assertFalse(self.read_clean(path))

    def test_existing_cleanup_end_only_shortens_and_expiry_refuses_closed(self):
        self.capture('cleanup-clamp').completion()
        path,_=self.private_state()
        captured=self.capture('commit-expired',command='init',state=path)
        with self.assertRaises(supervision.SupervisionError):captured.completion()
        self.assertIsNone(captured.closure)
        self.assertFalse(captured.clean_committed)
        self.assertFalse(self.read_clean(path))

    def test_output_bound_does_not_become_successful_cleanup(self):
        captured=self.capture('output')
        with self.assertRaises(supervision.SupervisionError):captured.completion()
        self.assertFalse(captured.clean_committed)

    def test_inherited_ignored_sigchld_is_reset_in_isolated_owner(self):
        policy=signal.getsignal(signal.SIGCHLD)
        self.capture('initial-ignored').completion()
        self.assertEqual(signal.getsignal(signal.SIGCHLD),policy)

    def test_phase_deadline_applies_before_ready_and_cancel_never_renews_it(self):
        captured=self.capture('slow-ready')
        cutoff=time.monotonic()+.05
        started=time.monotonic()
        with self.assertRaises((TimeoutError,supervision.SupervisionError)):
            captured.completion(deadline=cutoff)
        self.assertLess(time.monotonic()-started,.25)
        captured.cancel(time.monotonic()+2)
        self.assertLessEqual(captured.channel.deadline,cutoff)

    def test_stalled_ready_uses_readiness_cutoff_without_shortening_scenario(self):
        import trial_integration
        captured=self.capture('slow-ready')
        global_deadline=captured.channel.deadline
        started=time.monotonic()
        with self.assertRaises((TimeoutError,supervision.SupervisionError)):
            trial_integration.observe_ready(captured,[],time.monotonic()+.05)
        self.assertLess(time.monotonic()-started,.25)
        self.assertEqual(captured.channel.deadline,global_deadline)
        captured.cancel(time.monotonic()+.05)
        normal=self.capture('running')
        normal.ready(deadline=time.monotonic()+2)
        normal.ready(deadline=time.monotonic()+.01)
        time.sleep(.03)
        normal.completion(deadline=time.monotonic()+2)

    def test_cancel_before_admit_and_while_running_never_completes(self):
        for admitted in (False,True):
            with self.subTest(admitted=admitted):
                captured=self.capture('running')
                if admitted:captured.ready()
                self.assertFalse(captured.cancel(time.monotonic()+.15))
                self.assertFalse(captured.clean_committed)
                with self.assertRaises(supervision.SupervisionError):captured.completion()

    def test_early_ack_cannot_pre_satisfy_completion(self):
        captured=self.capture('running')
        captured.ready()
        captured.channel.send(captured.frame('ACK',3,closure='0'*32))
        with self.assertRaises(supervision.SupervisionError):captured.completion()
        self.assertFalse(captured.clean_committed)

    def test_constructor_launch_and_identity_failures_close_fds_and_reap(self):
        before=len(os.listdir('/proc/self/fd'))
        argv=[sys.executable,str(supervision.TRIAL_PATH),'destroy','--state','/nonexistent']
        with patch.object(supervision.subprocess,'Popen',side_effect=OSError('synthetic')):
            with self.assertRaises(OSError):
                supervision.SupervisedCapture(argv,deadline=time.monotonic()+2,state='/nonexistent')
        self.assertEqual(len(os.listdir('/proc/self/fd')),before)
        actual=subprocess.Popen;created=[]
        def spawn(*args,**kwargs):
            value=actual(*args,**kwargs);created.append(value);return value
        with patch.object(supervision.subprocess,'Popen',side_effect=spawn), \
             patch.object(supervision,'identity',side_effect=supervision.SupervisionError('ownership')):
            with self.assertRaises(supervision.SupervisionError):
                supervision.SupervisedCapture(argv,deadline=time.monotonic()+2,state='/nonexistent')
        self.assertEqual(len(created),1)
        self.assertIsNotNone(created[0].returncode)
        self.assertTrue(created[0].stdout.closed)
        self.assertEqual(len(os.listdir('/proc/self/fd')),before)

    def private_state(self):
        from test_trial_state import manifest, identity
        from trial_state import StateDirectory
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        root=Path(temp.name)
        import trial_state
        original_fstat=trial_state.os.fstat
        def safe_external(fd):
            info=original_fstat(fd)
            target=Path(os.readlink('/proc/self/fd/'+str(fd)))
            if target!=root and target in root.parents:
                values=list(info);values[0]&=~0o022;values[4]=0
                return os.stat_result(values)
            return info
        patched=patch.object(trial_state.os,'fstat',side_effect=safe_external)
        patched.start();self.addCleanup(patched.stop)
        home=root/'home';home.mkdir(mode=0o700)
        scope=lab.OwnedScope(home/'.open-compute',8787,bounded_owner=True);scope.create()
        value=manifest();value.update(identity=identity(),scope=dict(scope.identity,marker=scope.marker))
        path=root/'state'
        with StateDirectory(path,create=True) as state:state.save(value)
        return path,home

    def read_clean(self,path):
        from trial_state import StateDirectory
        with StateDirectory(path) as state:return state.load()['clean']

    def test_parent_clean_commit_occurs_only_after_actual_exit_and_output(self):
        from unittest.mock import Mock
        path,home=self.private_state()
        captured=self.capture('commit',command='init',state=path)
        actual=supervision.commit_clean
        def checked_commit(*args):
            self.assertEqual(captured.process.returncode,0)
            self.assertFalse(captured.reader.is_alive())
            self.assertFalse(self.read_clean(path))
            return actual(*args)
        with patch('trial_state.pwd.getpwuid',return_value=Mock(pw_dir=str(home))), \
             patch.object(supervision,'commit_clean',side_effect=checked_commit):
            captured.completion()
        self.assertTrue(captured.clean_committed)
        self.assertTrue(self.read_clean(path))

    def test_serve_ready_pending_terminal_and_parent_commit(self):
        from unittest.mock import Mock
        import trial_integration
        path,home=self.private_state()
        captured=self.capture('commit-serve',command='serve',state=path)
        commands=[]
        deadline=time.monotonic()+3
        while not trial_integration.observe_ready(captured,commands):
            self.assertLess(time.monotonic(),deadline)
            time.sleep(.005)
        self.assertFalse(self.read_clean(path))
        with patch('trial_state.pwd.getpwuid',return_value=Mock(pw_dir=str(home))):
            value=captured.completion()
        self.assertEqual(value['data'],{'stopped':True,'clean_pending':True})
        self.assertTrue(captured.clean_committed)
        self.assertTrue(self.read_clean(path))
        trial_integration.finalize_children([captured],time.monotonic()+1)

    def test_actual_parent_death_running_and_before_clean_commit_fail_conservatively(self):
        parent_source = r'''
import os,sys,time
from pathlib import Path
import trial_supervision as s
s.TRIAL_PATH=Path(sys.argv[1])
stage=sys.argv[3]
command='init' if stage=='commit' else 'destroy'
case='commit' if stage=='commit' else 'running'
c=s.SupervisedCapture([sys.executable,str(s.TRIAL_PATH),command,'--state',sys.argv[2],
                       '--case',case],deadline=time.monotonic()+4,state=sys.argv[2])
if stage=='commit':
    s.commit_clean=lambda *_:os._exit(7)
    c.completion()
else:
    c.ready();os._exit(7)
'''
        coordinator_source = r'''
import json,os,subprocess,sys,time
import trial_supervision as s
s.kernel_setup()
p=subprocess.Popen([sys.executable,*sys.argv[1:]],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
code=p.wait(timeout=5)
errors=p.stderr.read();p.stderr.close()
assert code==7,errors
end=time.monotonic()+4;adopted=0
while True:
    try:r=os.waitid(os.P_ALL,0,os.WEXITED|os.WNOHANG|os.WNOWAIT)
    except ChildProcessError:break
    if r is not None:
        os.waitpid(r.si_pid,0);adopted+=1
    else:
        assert time.monotonic()<end
        time.sleep(.005)
print(json.dumps({'parent_exit':code,'adopted':adopted,'kernel_closed':True}))
'''
        for stage in ('running','commit'):
            with self.subTest(stage=stage):
                path,_=self.private_state()
                temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
                root=Path(temp.name)
                owner=root/'owner.py';owner.write_text(self.FIXTURE)
                parent=root/'parent.py';parent.write_text(parent_source)
                result=subprocess.run([sys.executable,'-c',coordinator_source,str(parent),
                                       str(owner),str(path),stage],capture_output=True,text=True,timeout=10)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(json.loads(result.stdout),
                                 {'parent_exit':7,'adopted':1 if stage=='running' else 0,
                                  'kernel_closed':True})
                self.assertFalse(self.read_clean(path))

    def test_manifest_drift_and_save_failure_never_commit(self):
        from unittest.mock import Mock
        from trial_state import StateDirectory
        for kind in ('manifest','lock','save'):
            with self.subTest(kind=kind):
                path,home=self.private_state()
                captured=self.capture('commit',command='init',state=path)
                actual=supervision.commit_clean
                def changed(*args):
                    if kind=='manifest':
                        with StateDirectory(path) as state:
                            value=state.load();value['trial_id']='f'*32;state.save(value)
                    if kind=='lock':
                        (path/'owner.lock').unlink()
                        (path/'owner.lock').touch(mode=0o600)
                    if kind=='save':
                        with patch.object(StateDirectory,'save',side_effect=OSError('synthetic full')):
                            return actual(*args)
                    return actual(*args)
                with patch('trial_state.pwd.getpwuid',return_value=Mock(pw_dir=str(home))), \
                     patch.object(supervision,'commit_clean',side_effect=changed):
                    with self.assertRaises((supervision.SupervisionError,OSError)):
                        captured.completion()
                self.assertFalse(self.read_clean(path))
                self.assertFalse(captured.clean_committed)

    def test_cancel_at_closed_and_missing_terminal_after_ack_leave_dirty(self):
        path,_=self.private_state()
        captured=self.capture('commit',command='init',state=path)
        captured.ready()
        captured.closure=captured.channel.receive()
        captured.check(captured.closure)
        self.assertEqual(captured.closure['kind'],'CLOSED')
        captured.cancel(time.monotonic()+.1)
        self.assertFalse(self.read_clean(path))
        for case in ('commit-nooutput','commit-hold'):
            with self.subTest(case=case):
                path,_=self.private_state()
                captured=self.capture(case,command='init',state=path)
                captured.ready()
                closed=captured.channel.receive()
                self.assertEqual(closed['kind'],'CLOSED')
                with patch.object(captured.channel,'receive',return_value=closed):
                    with self.assertRaises((supervision.SupervisionError,subprocess.TimeoutExpired)):
                        captured.completion(deadline=time.monotonic()+.1)
                self.assertFalse(self.read_clean(path))
                self.assertFalse(captured.clean_committed)


if __name__=='__main__':unittest.main()

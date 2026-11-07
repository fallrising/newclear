"""M5-only kernel owner. Importing this module never changes process policy.

Guard primitives are deliberately duplicated from M4; crash authority is separate.
"""
import copy
import _thread
import ctypes
from dataclasses import dataclass
import errno
import json
import math
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import sys
import threading
import time
from types import MappingProxyType

import crash
import lab

EDGES=('parent_missing','parent_zombie','parent_reused','child_missing',
       'child_reused','child_reparented','child_zombie','start_order')
REASONS=frozenset(('unsupported','policy','launch','wait','identity','sampling',
 'limit','output','deadline','cancelled','receipt','root_exit','forced',
 'unknown_child','crash','scope','schema'))
LIMITS=dict(targets=64,proc_entries=8192,history=1024,launches=1024,
 adopted_reaped=1024,edge_events=1024,threads=16,tail_bytes=32768,extension_bytes=16384)


class LifecycleError(lab.LabError):
    def __init__(self,reason='schema'):
        self.reason=reason if type(reason) is str and reason in REASONS else 'schema'
        super().__init__(self.reason)


def require(ok,reason='schema'):
    if not ok:raise LifecycleError(reason)


def integer(value,upper=2**63-1,lower=0):
    return type(value) is int and lower<=value<=upper


def generation_record(index):
    return dict(index=index,root=None,launches=0,waited=0,pipes_open=0,
       threads_open=0,adopted_reaped=0,launches_closed=False,closure_kind='not_run',
       root_exit_code=None,history_nonlive=False,drains_closed=False,
       kernel_echild=False,closed=False,failure=None)


def initial():
    return dict(schema_version=1,mode='m5-kernel-owner',failure=None,
       sampling=dict(attempted=0,stable_children=0,ambiguous_edges=0,
                     reasons={key:0 for key in EDGES}),generations=[],
       restart=dict(status='not_run',reason=None),
       cleanup=dict(status='not_run',reason=None,kernel_echild=False),
       containment=dict(attempted=False,complete=False,reason=None),limits=dict(LIMITS))


def _reason(value):
    return value is None or type(value) is str and value in REASONS


def _identity(value):
    require(type(value) is dict and set(value)=={'pid','pgid','start_ticks'})
    require(integer(value['pid'],lower=1) and integer(value['pgid'],lower=1) and integer(value['start_ticks']))
    return value


def project(value,*,complete=False):
    require(type(complete) is bool)
    blank=initial();require(type(value) is dict and set(value)==set(blank))
    require(type(value['schema_version']) is int and value['schema_version']==1)
    require(type(value['mode']) is str and value['mode']==blank['mode'])
    require(type(value['limits']) is dict and set(value['limits'])==set(LIMITS))
    require(all(type(value['limits'][key]) is int and value['limits'][key]==v for key,v in LIMITS.items()))
    require(_reason(value['failure']))
    sample=value['sampling'];require(type(sample) is dict and set(sample)==set(blank['sampling']))
    require(integer(sample['attempted'],1) and integer(sample['stable_children'],1024) and integer(sample['ambiguous_edges'],1024))
    require(type(sample['reasons']) is dict and set(sample['reasons'])==set(EDGES))
    require(all(integer(n,1024) for n in sample['reasons'].values()))
    require(sum(sample['reasons'].values())==sample['ambiguous_edges'])
    require(sample['stable_children']+sample['ambiguous_edges']<=1024)
    if not sample['attempted']:require(sample['stable_children']==sample['ambiguous_edges']==0)
    rows=value['generations'];require(type(rows) is list and len(rows)<=2)
    roots=[]
    for index,row in enumerate(rows,1):
        require(type(row) is dict and set(row)==set(generation_record(index)))
        require(type(row['index']) is int and row['index']==index and _reason(row['failure']))
        if row['root'] is not None:
            _identity(row['root']);key=(row['root']['pid'],row['root']['start_ticks']);require(key not in roots);roots.append(key)
            require(row['launches']>=1)
        for key in ('launches','waited','adopted_reaped'):require(integer(row[key],1024))
        require(row['waited']<=row['launches'] and integer(row['pipes_open'],min(3072,3*row['launches'])) and integer(row['threads_open'],16))
        for key in ('launches_closed','history_nonlive','drains_closed','kernel_echild','closed'):require(type(row[key]) is bool)
        require(type(row['closure_kind']) is str and row['closure_kind'] in ('not_run','crash','normal','commands'))
        require(row['root_exit_code'] is None or integer(row['root_exit_code'],255,-255))
        if row['root'] is None:require(row['root_exit_code'] is None)
        if row['closed']:
            require(row['launches_closed'] and row['waited']==row['launches'] and row['pipes_open']==row['threads_open']==0)
            require(row['history_nonlive'] and row['drains_closed'] and row['kernel_echild'] and row['failure'] is None)
            if row['closure_kind']=='crash':require(index==1 and row['root'] is not None and row['root_exit_code']==-9)
            elif row['closure_kind']=='normal':require(row['root'] is not None and row['root_exit_code']==0)
            elif row['closure_kind']=='commands':require(row['root'] is None)
            else:require(False)
        else:require(row['closure_kind']=='not_run')
    require(sum(r['launches'] for r in rows)<=1024 and sum(r['adopted_reaped'] for r in rows)<=1024)
    restart=value['restart'];require(type(restart) is dict and set(restart)=={'status','reason'})
    require(type(restart['status']) is str and restart['status'] in ('not_run','issued','consumed','refused'))
    require(_reason(restart['reason']))
    if restart['status']=='refused':require(restart['reason'] is not None)
    else:require(restart['reason'] is None)
    if restart['status'] in ('issued','consumed'):require(rows and rows[0]['closed'] and rows[0]['closure_kind']=='crash')
    if len(rows)==2:require(restart['status']=='consumed')
    cleanup=value['cleanup'];require(type(cleanup) is dict and set(cleanup)==set(blank['cleanup']))
    require(type(cleanup['status']) is str and cleanup['status'] in ('not_run','verified','removed','refused'))
    require(type(cleanup['kernel_echild']) is bool and _reason(cleanup['reason']))
    if cleanup['status'] in ('verified','removed'):
        require(rows and rows[-1]['closed'] and cleanup['kernel_echild'] and cleanup['reason'] is None)
        if cleanup['status']=='verified':require(value['failure'] is None)
    elif cleanup['status']=='not_run':require(not cleanup['kernel_echild'] and cleanup['reason'] is None)
    else:require(cleanup['reason'] is not None)
    containment=value['containment'];require(type(containment) is dict and set(containment)==set(blank['containment']))
    require(type(containment['attempted']) is bool and type(containment['complete']) is bool and _reason(containment['reason']))
    if not containment['attempted']:require(not containment['complete'] and containment['reason'] is None)
    elif containment['complete']:require(containment['reason'] is None)
    else:require(containment['reason'] is not None)
    if complete:
        require(value['failure'] is None and len(rows)==2 and all(r['closed'] for r in rows))
        require(rows[0]['closure_kind']=='crash' and rows[1]['closure_kind']=='normal')
        require(restart['status']=='consumed' and cleanup['status']=='removed')
        require(sample['attempted']==1 and sample['stable_children']>0)
    require(len(json.dumps(value,indent=2,sort_keys=True,allow_nan=False).encode())<=16384)
    return copy.deepcopy(value)


def project_report(value,*,crash_receipt,daemon_before,daemon_after,final_shutdown,scope_removed,complete=False):
    result=project(value,complete=complete);receipt=crash.project_crash(crash_receipt)
    rows=result['generations']
    if rows and rows[0]['root'] is not None and daemon_before is not None:require(rows[0]['root']==_identity(daemon_before))
    if receipt['targets']:
        require(rows and rows[0]['root']=={k:receipt['targets'][0][k] for k in ('pid','pgid','start_ticks')})
        require(daemon_before==rows[0]['root'])
    for row in rows:
        if row['closure_kind']=='crash':require(receipt['status']=='verified' and receipt['root_exit_code']==row['root_exit_code'])
        if row['closure_kind']=='normal':
            require(type(final_shutdown) is dict and final_shutdown.get('was_running') is True and final_shutdown.get('signal')=='SIGTERM')
            require(final_shutdown.get('forced') is False and type(final_shutdown.get('exit_code')) is int and final_shutdown['exit_code']==0 and final_shutdown.get('all_owned_exited') is True)
            require('observation_error' in final_shutdown and final_shutdown['observation_error'] is None)
    if len(rows)==2 and rows[1]['root'] is not None and daemon_after is not None:require(rows[1]['root']==_identity(daemon_after))
    if complete:require(daemon_after is not None)
    if result['cleanup']['status']=='removed':require(scope_removed is True)
    if result['cleanup']['status']=='refused':require(scope_removed is not True)
    if complete:require(receipt['status']=='verified' and scope_removed is True)
    return result


@dataclass(frozen=True,eq=False)
class FrozenTargets:
    owner: object
    daemon: object
    deadline: float
    targets: tuple


@dataclass(frozen=True,eq=False)
class RestartReceipt:
    owner: object
    daemon: object
    deadline: float
    scope_binding: object


@dataclass(frozen=True,eq=False)
class DeletionSeal:
    owner: object
    deadline: float
    scope_binding: object


class Sigaction(ctypes.Structure):
    _fields_=[('handler',ctypes.c_void_p),('mask',ctypes.c_ulong*16),
              ('flags',ctypes.c_int),('restorer',ctypes.c_void_p)]


def libc():
    require(sys.platform=='linux' and platform.machine()=='x86_64' and
            ctypes.sizeof(ctypes.c_void_p)==8 and ctypes.sizeof(Sigaction)==152 and
            Sigaction.mask.offset==8 and Sigaction.flags.offset==136 and Sigaction.restorer.offset==144,'unsupported')
    value=ctypes.CDLL(None,use_errno=True)
    require(hasattr(value,'gnu_get_libc_version'),'unsupported')
    value.gnu_get_libc_version.restype=ctypes.c_char_p
    version=value.gnu_get_libc_version()
    require(type(version) is bytes and len(version)<=32 and re.fullmatch(rb'2\.[0-9]+(?:\.[0-9]+)?',version) is not None,'unsupported')
    return value


def policy():
    value=libc();action=Sigaction();enabled=ctypes.c_int()
    require(value.sigaction(signal.SIGCHLD,None,ctypes.byref(action))==0 and
            action.handler is None and not action.flags&2 and signal.getsignal(signal.SIGCHLD)==signal.SIG_DFL,'policy')
    require(value.prctl(37,ctypes.byref(enabled),0,0,0)==0 and enabled.value==1,'policy')
    require(lab.proc_namespace_supported(),'unsupported')


class Daemon:
    def __init__(self, owner, process):
        self.owner,self.process=owner,process
        self.identity=MappingProxyType(owner.identity(process))
        self.tail=bytearray();self.lock=threading.Lock();self.samples=[]
        self.reader=threading.Thread(target=self._read,daemon=True)
        owner.readers[process]=self.reader
        self.reader.start()

    def _read(self):
        try:
            while chunk:=self.process.stdout.read1(4096):
                with self.lock:
                    self.tail.extend(chunk);del self.tail[:-32768]
        except Exception:self.owner.latch('output')

    def text(self):
        with self.lock:return bytes(self.tail).decode(errors='replace')





class Runner:
    def __init__(self):
        require(threading.current_thread() is threading.main_thread() and len(threading.enumerate())==1,'wait')
        value=libc();signal.signal(signal.SIGCHLD,signal.SIG_DFL)
        require(value.prctl(36,1,0,0,0)==0,'policy');policy()
        self._waitid,self._waitpid=os.waitid,os.waitpid
        try:self._waitid(os.P_ALL,0,os.WEXITED|os.WNOHANG|os.WNOWAIT)
        except ChildProcessError as exc:require(exc.errno==errno.ECHILD,'wait')
        else:raise LifecycleError('unknown_child')
        self.value=initial();self.value['generations'].append(generation_record(1))
        self.registry=[];self.readers={};self.daemons=[];self.history={};self.failure=None
        self.scope=None;self.scope_binding=None;self.cancelled=False;self.terminal=False
        self.launching=False;self.waiting=False;self.collecting=False;self.restart_receipt=None
        self.restart_used=False;self.deletion_seal=None;self.deletion_used=False;self.frozen=None
        self.operation_deadline=None;self.cleanup_end=None;self.edge_events=0;self.final_shutdown=None;self.removal_observed=False
        self._install()

    @property
    def epoch(self):return self.value['generations'][-1]

    def latch(self,reason):
        reason=reason if reason in REASONS else 'schema'
        if self.failure is None:
            self.failure=reason;self.value['failure']=reason
            if not self.epoch['closed']:self.epoch['failure']=reason
        self.epoch['launches_closed']=True
        if self.value['cleanup']['status']!='removed':
            self.value['cleanup']=dict(status='refused',reason=self.failure,kernel_echild=False)

    def fail(self,reason):
        self.latch(reason);raise LifecycleError(self.failure)

    def cancel(self):self.cancelled=True;self.latch('cancelled')

    def check(self,*,check_policy=True):
        if threading.current_thread() is not threading.main_thread():self.fail('wait')
        if self.failure:self.fail(self.failure)
        if self.cancelled:self.fail('cancelled')
        if check_policy:
            try:policy()
            except LifecycleError as exc:self.fail(exc.reason)

    def remaining(self,deadline):
        self.check(check_policy=False)
        if type(deadline) not in (int,float) or not math.isfinite(deadline) or time.monotonic()>=deadline:self.fail('deadline')
        return deadline-time.monotonic()

    def _install(self):
        owner=self;original=subprocess.Popen
        class Registered(original):
            def __init__(self,*args,**kwargs):
                if owner.launching:owner.fail('launch')
                owner.launch_check()
                if not kwargs.get('close_fds',True) or kwargs.get('pass_fds',()):owner.fail('launch')
                owner.launching=True
                try:super().__init__(*args,**kwargs)
                except BaseException:
                    if getattr(self,'pid',None) is not None:
                        owner.registry.append((self,owner.epoch))
                        if self.returncode is None:owner.latch('launch')
                    raise
                else:owner.registry.append((self,owner.epoch))
                finally:owner.launching=False
                owner.refresh()
            def wait(self,*args,**kwargs):
                return owner._direct_wait(super().wait,*args,**kwargs)
            def poll(self,*args,**kwargs):
                return owner._direct_wait(super().poll,*args,**kwargs)
            def _internal_poll(self,*_args,**_kwargs):
                if self.returncode is not None:return self.returncode
                if _kwargs.get('_deadstate') is not None:
                    # Destructor disposal must not reap or manufacture a code
                    # after unknown wait ownership. Strong registry references
                    # retain live objects throughout every authorization check.
                    owner.latch('wait');return None
                owner.wait_permission()
                if self.returncode is None:
                    if not self._waitpid_lock.acquire(False):owner.fail('wait')
                    try:
                        try:pid,status=owner._waitpid(self.pid,os.WNOHANG)
                        except ChildProcessError:owner.fail('wait')
                        if pid==self.pid:self._handle_exitstatus(status)
                    finally:self._waitpid_lock.release()
                return self.returncode
            def _try_wait(self,flags):
                owner.wait_permission()
                try:return owner._waitpid(self.pid,flags)
                except ChildProcessError:owner.fail('wait')
        subprocess.Popen=Registered
        def audit(event,_args):
            if event in ('subprocess.Popen','os.fork','os.forkpty','os.posix_spawn'):
                owner.launch_check()
                if not owner.launching:owner.fail('launch')
        sys.addaudithook(audit)
        def waitpid(*args,**kwargs):
            owner.wait_permission()
            return owner._waitpid(*args,**kwargs)
        def waitid(*args,**kwargs):
            if threading.current_thread() is not threading.main_thread() or not owner.collecting:owner.fail('wait')
            return owner._waitid(*args,**kwargs)
        os.waitpid,os.waitid=waitpid,waitid
        for name in ('wait','wait3','wait4'):
            if hasattr(os,name):
                original_wait=getattr(os,name)
                def guarded(*args,_wait=original_wait,**kwargs):
                    owner.wait_permission();return _wait(*args,**kwargs)
                setattr(os,name,guarded)
        original_start=threading.Thread.start
        original_low=threading._start_new_thread
        owner.starting_thread=False
        def start(thread):
            owner.check()
            timer=(isinstance(thread,threading.Timer) and
                   getattr(thread.function,'__module__',None)=='lab' and
                   getattr(thread.function,'__qualname__',None)=='LocalHTTP.request.<locals>.expire')
            if (owner.terminal or owner.epoch['launches_closed'] or
                (thread not in owner.readers.values() and not timer)):owner.fail('launch')
            active=len(threading.enumerate())-1
            launches=sum(e is owner.epoch for p,e in owner.registry)
            if active+1>min(2*launches,16):owner.fail('limit')
            owner.starting_thread=True
            try:return original_start(thread)
            except BaseException:
                owner.latch('launch');raise
            finally:owner.starting_thread=False
        def low_start(*args,**kwargs):
            if not owner.starting_thread or threading.current_thread() is not threading.main_thread():owner.fail('launch')
            return original_low(*args,**kwargs)
        threading.Thread.start=start
        threading._start_new_thread=_thread.start_new_thread=low_start
        if hasattr(_thread,'start_new'):_thread.start_new=low_start



    def wait_permission(self):
        if threading.current_thread() is not threading.main_thread() or not (self.waiting or self.collecting or self.launching):self.fail('wait')

    def _direct_wait(self,fn,*args,**kwargs):
        if threading.current_thread() is not threading.main_thread():self.fail('wait')
        old=self.waiting;self.waiting=True
        try:return fn(*args,**kwargs)
        finally:self.waiting=old

    def launch_check(self):
        if self.operation_deadline is not None:self.remaining(self.operation_deadline)
        self.check()
        if self.operation_deadline is not None:self.remaining(self.operation_deadline)
        if self.terminal or self.epoch['launches_closed']:self.fail('launch')
        if len(self.registry)>=1024:self.fail('limit')

    def identity(self,process):
        try:current=lab.process_info(process.pid)
        except (lab.ProcessObservationError,OSError):self.fail('identity')
        if current is None or current['state']=='Z':self.fail('identity')
        return current

    def root_check(self,daemon,deadline=None):
        if deadline is not None:self.remaining(deadline)
        self.check()
        if deadline is not None:self.remaining(deadline)
        if daemon not in self.daemons or daemon.epoch is not self.epoch:self.fail('receipt')
        if daemon.process.poll() is not None:self.fail('root_exit')
        if deadline is not None:self.remaining(deadline)
        current=self.identity(daemon.process)
        if deadline is not None:self.remaining(deadline)
        if any(current[k]!=daemon.identity[k] for k in ('pid','pgid','start_ticks')):self.fail('identity')
        return True

    def refresh(self):
        for row in self.value['generations']:
            ps=[p for p,e in self.registry if e is row]
            row['launches']=len(ps);row['waited']=sum(p.returncode is not None for p in ps)
            row['pipes_open']=sum(stream is not None and not stream.closed for p in ps for stream in (p.stdin,p.stdout,p.stderr))
            row['threads_open']=sum(self.readers[p].is_alive() for p in ps if p in self.readers)
            if row is self.epoch:row['threads_open']+=sum(isinstance(t,threading.Timer) and t.is_alive() for t in threading.enumerate())

    def bind_scope(self,scope):
        self.check()
        if self.scope is not None:self.fail('scope')
        try:scope.check_owner()
        except BaseException:self.latch('scope');raise
        self.scope=scope;self.scope_binding=(scope.path,tuple(sorted(scope.identity.items())),scope.marker)

    def _scope_check(self,binding):
        if self.scope is None:
            if binding is not None:self.fail('scope')
            return
        try:
            if (self.scope.path,tuple(sorted(self.scope.identity.items())),self.scope.marker)!=binding:self.fail('scope')
            self.scope.check_owner()
        except BaseException:self.latch('scope');raise

    def command(self,argv,timeout=30,*,cwd=None):
        self.launch_check()
        deadline=time.monotonic()+timeout
        process=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,close_fds=True,cwd=cwd)
        chunks=bytearray()
        def drain():
            try:
                while block:=process.stdout.read1(4096):
                    chunks.extend(block);del chunks[:-32768]
            except Exception:self.latch('output')
        reader=threading.Thread(target=drain,daemon=True);self.readers[process]=reader;reader.start()
        try:
            process.wait(timeout=max(0,deadline-time.monotonic()))
            reader.join(timeout=max(0,min(2,deadline-time.monotonic())))
            if reader.is_alive():self.fail('output')
            process.stdout.close()
        except subprocess.TimeoutExpired:
            self.latch('deadline');process.kill();process.poll();raise LifecycleError('deadline')
        except BaseException as exc:
            self.latch('deadline' if isinstance(exc,lab.LabError) else 'wait')
            raise
        finally:self.refresh()
        self.check();self.remaining(deadline)
        lab.require(process.returncode==0,'CLI command failed')
        # Match generic command's bounded tail-ring semantics, including large
        # setup/progress logs. Structured consumers still reject truncated JSON.
        return bytes(chunks).decode(errors='replace')

    def source_commit(self):
        try:
            value=self.command(['git','rev-parse','HEAD'],5,cwd=lab.HERE).strip()
        except (OSError,lab.LabError) as exc:
            self.check()
            if isinstance(exc,LifecycleError):raise
            return None
        self.check()
        return value if len(value)==40 and all(c in '0123456789abcdef' for c in value) else None



    def start_daemon(self,argv):
        self.launch_check()
        if self.epoch['root'] is not None:self.fail('launch')
        process=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True,close_fds=True)
        try:daemon=Daemon(self,process)
        except BaseException:self.latch('identity');raise
        daemon.epoch=self.epoch;self.daemons.append(daemon)
        self.epoch['root']=lab.public_process(daemon.identity,strict=True)
        self.history[self._key(daemon.identity)]=dict(daemon.identity)
        self.refresh();return daemon

    @staticmethod
    def _key(item):return item['pid'],item['start_ticks']

    def _table(self,deadline=None):
        if deadline is not None:self.remaining(deadline)
        table={};count=0
        try:
            with os.scandir('/proc') as entries:
                for entry in entries:
                    if entry.name.isdecimal():
                        count+=1
                        if count>8192:self.fail('limit')
                        if deadline is not None:self.remaining(deadline)
                        info=lab.process_info(int(entry.name))
                        if deadline is not None:self.remaining(deadline)
                        if info is not None:table[info['pid']]=info
        except (OSError,lab.ProcessObservationError):self.fail('identity')
        return table

    def _read(self,pid):
        try:return lab.process_info(pid)
        except (OSError,lab.ProcessObservationError):self.fail('identity')

    def _discover(self,daemon,*,strict,deadline=None):
        self.root_check(daemon,deadline);table=self._table(deadline);parents={}
        for key,record in self.history.items():
            if deadline is not None:self.remaining(deadline)
            current=self._read(record['pid'])
            if deadline is not None:self.remaining(deadline)
            if current is not None and self._key(current)==key and current['state']!='Z':parents[current['pid']]=current
        visited=set();stable=[];sample=self.value['sampling']
        while True:
            added=False
            for pid,candidate in table.items():
                if deadline is not None:self.remaining(deadline)
                if pid in visited or pid==daemon.identity['pid'] or candidate['ppid'] not in parents:continue
                if self._key(candidate) in self.history:
                    parents[pid]=candidate;visited.add(pid);continue
                visited.add(pid);self.edge_events+=1
                if self.edge_events>1024:self.fail('limit')
                parent=parents[candidate['ppid']];reason=None
                for _ in range(2):
                    if deadline is not None:self.remaining(deadline)
                    p=self._read(parent['pid'])
                    if deadline is not None:self.remaining(deadline)
                    c=self._read(pid)
                    if deadline is not None:self.remaining(deadline)
                    if p is None:reason='parent_missing'
                    elif p['state']=='Z':reason='parent_zombie'
                    elif p['start_ticks']!=parent['start_ticks']:reason='parent_reused'
                    elif c is None:reason='child_missing'
                    elif self._key(c)!=self._key(candidate):reason='child_reused'
                    elif c['ppid']!=candidate['ppid']:reason='child_reparented'
                    elif c['state']=='Z':reason='child_zombie'
                    elif c['start_ticks']<p['start_ticks']:reason='start_order'
                    if reason:break
                self.root_check(daemon,deadline)
                if reason:
                    if strict or self._key(candidate) in self.history:self.fail('identity')
                    sample['ambiguous_edges']+=1;sample['reasons'][reason]+=1
                    continue
                if self._key(c) not in self.history and len(self.history)>=1024:self.fail('limit')
                self.history[self._key(c)]=dict(c);stable.append(dict(c));parents[pid]=c;added=True
            if not added:break
        self.root_check(daemon,deadline);return stable,table

    def sample_liveness(self,daemon):
        sample=self.value['sampling']
        if self.epoch['index']!=1 or sample['attempted']:self.fail('sampling')
        sample['attempted']=1
        stable,_=self._discover(daemon,strict=False)
        sample['stable_children']=len(stable)
        if not stable:self.fail('sampling')
        daemon.samples=[lab.public_process(item,strict=True) for item in stable]
        return copy.deepcopy(daemon.samples)

    def freeze_targets(self,daemon,*,deadline):
        self.remaining(deadline);self.root_check(daemon,deadline)
        if self.epoch['index']!=1 or self.frozen is not None or self.epoch['launches_closed']:self.fail('receipt')
        self.epoch['launches_closed']=True
        _,table=self._discover(daemon,strict=True,deadline=deadline)
        live=[]
        for key,item in self.history.items():
            self.remaining(deadline);current=self._read(item['pid']);self.remaining(deadline)
            if current is not None and self._key(current)==key and current['state']!='Z':live.append(current)
        direct={p.pid for p,row in self.registry if p.returncode is None}
        known={self._key(item) for item in live}
        for item in table.values():
            if item['ppid']==os.getpid() and item['state']!='Z' and item['pid'] not in direct and self._key(item) not in known:self.fail('unknown_child')
        root=self._key(daemon.identity)
        if not 2<=len(live)<=64 or root not in known or len({p['pid'] for p in live})!=len(live):self.fail('limit' if len(live)>64 else 'identity')
        live.sort(key=lambda item:(self._key(item)!=root,*self._key(item)))
        targets=tuple((p['pid'],p['pgid'],p['start_ticks']) for p in live)
        self.remaining(deadline);self.frozen=FrozenTargets(self,daemon,deadline,targets)
        return self.frozen

    def _history_nonlive(self,deadline):
        for key,item in self.history.items():
            self.remaining(deadline);current=self._read(item['pid']);self.remaining(deadline)
            if current is not None and self._key(current)==key and current['state']!='Z':return False
        return True

    def _drain(self,deadline):
        for p,row in self.registry:
            if p.returncode is None:self.fail('wait')
        threads=[t for t in threading.enumerate() if t is not threading.main_thread()]
        if len(threads)>16:self.fail('limit')
        for thread in threads:
            thread.join(timeout=min(2,self.remaining(deadline)))
            if thread.is_alive():self.fail('output')
        for p,row in self.registry:
            for stream in (p.stdin,p.stdout,p.stderr):
                if stream is not None:stream.close()
        self.refresh();self.epoch['drains_closed']=True

    def collect(self,deadline):
        self.check();self.refresh()
        if any(p.returncode is None for p,row in self.registry):self.fail('wait')
        if any(r['pipes_open'] or r['threads_open'] for r in self.value['generations']):self.fail('output')
        self.collecting=True
        try:
            while True:
                self.remaining(deadline);self.check();self.remaining(deadline)
                try:item=self._waitid(os.P_ALL,0,os.WEXITED|os.WNOHANG|os.WNOWAIT)
                except ChildProcessError as exc:
                    if exc.errno!=errno.ECHILD:self.fail('wait')
                    self.remaining(deadline);self.epoch['kernel_echild']=True;return
                self.remaining(deadline)
                if item is None:
                    # Unknown live adopted children cannot receive blind signals.
                    table=self._table(deadline);registered={p.pid for p,row in self.registry}
                    for child in table.values():
                        if child['ppid']==os.getpid() and child['state']!='Z' and child['pid'] not in registered and self._key(child) not in self.history:self.fail('unknown_child')
                    time.sleep(min(.01,self.remaining(deadline)));continue
                if sum(r['adopted_reaped'] for r in self.value['generations'])>=1024:self.fail('limit')
                self.remaining(deadline)
                waited=self._waitpid(item.si_pid,0)
                self.remaining(deadline)
                if waited[0]!=item.si_pid:self.fail('wait')
                self.remaining(deadline)
                self.epoch['adopted_reaped']+=1
        except ChildProcessError:self.fail('wait')
        finally:self.collecting=False

    def abrupt_shutdown(self,daemon,*,deadline):
        started=time.monotonic();cutoff=min(deadline,started+10);receipt=crash.initial_crash();phase='ownership'
        try:
            frozen=self.freeze_targets(daemon,deadline=cutoff)
            receipt['targets']=[dict(pid=p,pgid=g,start_ticks=s,signal_sent=False,exit_observed=False) for p,g,s in frozen.targets]
            for target in receipt['targets']:
                phase='identity';self.remaining(cutoff);self.check();self.remaining(cutoff);current=self._read(target['pid']);self.remaining(cutoff)
                if current is None or self._key(current)!=self._key(target) or current['state']=='Z':self.fail('identity')
                phase='signal';receipt['attempted']+=1;os.kill(target['pid'],signal.SIGKILL)
                target['signal_sent']=True;receipt['signaled']+=1
            phase='survivor'
            while True:
                self.remaining(cutoff);receipt['root_exit_code']=daemon.process.poll()
                for target in receipt['targets']:
                    self.remaining(cutoff);current=self._read(target['pid'])
                    target['exit_observed']=current is None or self._key(current)!=self._key(target) or current['state']=='Z'
                receipt['all_owned_exited']=all(t['exit_observed'] for t in receipt['targets']) and self._history_nonlive(cutoff)
                self.remaining(cutoff)
                if receipt['all_owned_exited'] and receipt['root_exit_code'] is not None:break
                time.sleep(min(.01,self.remaining(cutoff)))
            if receipt['root_exit_code']!=-9:self.fail('root_exit')
            self.epoch['root_exit_code']=-9;phase='observer';self._drain(cutoff)
            receipt['observers_closed']=True
            if not self._history_nonlive(cutoff):self.fail('identity')
            self.epoch['history_nonlive']=True;self.collect(cutoff);self.remaining(cutoff);self.check()
            receipt.update(status='verified',elapsed_seconds=time.monotonic()-started)
            receipt=crash.project_crash(receipt)
            self.epoch.update(closed=True,closure_kind='crash')
            self.restart_receipt=RestartReceipt(self,daemon,cutoff,self.scope_binding)
            self.value['restart']=dict(status='issued',reason=None)
            return receipt,self.restart_receipt
        except Exception as exc:
            reason='deadline' if time.monotonic()>=cutoff else exc.reason if isinstance(exc,crash.CrashError) else phase
            self.latch(exc.reason if isinstance(exc,LifecycleError) else 'crash')
            receipt.update(status='failed',reason=reason,elapsed_seconds=time.monotonic()-started)
            raise crash.CrashError(reason,receipt) from None

    def consume_restart(self,receipt,argv):
        self.check()
        if receipt is not self.restart_receipt or self.restart_used or receipt.owner is not self or not self.epoch['closed'] or self.terminal:self.fail('receipt')
        self.remaining(receipt.deadline);self._scope_check(receipt.scope_binding);self.collect(receipt.deadline)
        self.restart_used=True;self.value['restart']=dict(status='consumed',reason=None)
        self.value['generations'].append(generation_record(2))
        self.operation_deadline=receipt.deadline
        try:
            daemon=self.start_daemon(argv)
            self.remaining(receipt.deadline);self.check();self._scope_check(receipt.scope_binding);self.remaining(receipt.deadline)
            return daemon
        finally:self.operation_deadline=None

    def finalize(self,*,deadline):
        if self.cleanup_end is None:self.cleanup_end=deadline
        cutoff=min(deadline,self.cleanup_end)
        try:
            self.check();self.remaining(cutoff)
            if self.terminal:self.fail('receipt')
            self.epoch['launches_closed']=True
            daemon=next((d for d in self.daemons if d.epoch is self.epoch),None)
            if not self.epoch['closed']:
                if daemon is not None:
                    self.root_check(daemon);daemon.process.terminate()
                    try:daemon.process.wait(timeout=min(30,self.remaining(cutoff)))
                    except subprocess.TimeoutExpired:self.fail('forced')
                    self.epoch['root_exit_code']=daemon.process.returncode
                    if daemon.process.returncode!=0:self.fail('root_exit')
                self._drain(cutoff)
                if not self._history_nonlive(cutoff):self.fail('identity')
                self.epoch['history_nonlive']=True;self.collect(cutoff);self.remaining(cutoff)
                self.epoch.update(closed=True,closure_kind='normal' if daemon else 'commands')
                if daemon is not None:
                    self.final_shutdown=dict(was_running=True,signal='SIGTERM',forced=False,exit_code=0,all_owned_exited=True,observation_error=None,children=copy.deepcopy(daemon.samples))
            self.terminal=True;self.collect(cutoff);self.check();self.remaining(cutoff)
            self.deletion_seal=DeletionSeal(self,cutoff,self.scope_binding)
            self.value['cleanup']=dict(status='verified',reason=None,kernel_echild=True)
            return self.deletion_seal,self.final_shutdown
        except BaseException as exc:
            self.latch(exc.reason if isinstance(exc,LifecycleError) else 'deadline' if time.monotonic()>=cutoff else 'wait')
            try:self.contain(deadline=cutoff)
            except Exception:pass
            raise

    def consume_deletion(self,seal,remove):
        self.check()
        if seal is not self.deletion_seal or self.deletion_used or seal.owner is not self or not self.terminal or self.scope is None:self.fail('receipt')
        self.remaining(seal.deadline);self._scope_check(seal.scope_binding);self.collect(seal.deadline)
        if len(threading.enumerate())!=1:self.fail('wait')
        self.deletion_used=True;cutoff=min(seal.deadline,time.monotonic()+30)
        try:
            with lab.m3_deadline(self.remaining(cutoff),'M5 terminal deletion'):
                result=remove()
                # Cache actual successful removal before any post-callback check.
                if type(result) is dict and result.get('scope_removed') is True:self._record_removal()
                self.remaining(cutoff);self.check()
                require(type(result) is dict and result.get('scope_removed') is True,'scope')
                return result
        except BaseException as exc:
            self.latch('deadline' if time.monotonic()>=cutoff else exc.reason if isinstance(exc,LifecycleError) else 'scope');raise

    def _record_removal(self):
        # A completed validated absence is a historical fact even if a later
        # timer fires. This method itself performs no I/O and grants no authority.
        if not self.deletion_used or not self.terminal:self.fail('receipt')
        self.removal_observed=True
        self.value['cleanup']=dict(status='removed',reason=None,kernel_echild=True)

    def _failure_evidence(self):
        # Bypass a broken external projection hook, revalidate cached owner facts.
        return project(self.value)

    def contain(self,*,deadline):
        self.epoch['launches_closed']=True
        record=self.value['containment'];record.update(attempted=True,complete=False,reason=self.failure or 'crash')
        def left():return max(0,deadline-time.monotonic())
        for process,row in self.registry:
            if left()<=0:return
            try:running=process.poll() is None
            except LifecycleError:continue
            if running:
                process.terminate()
                try:process.wait(timeout=min(1,left()))
                except subprocess.TimeoutExpired:
                    if left()<=0:return
                    process.kill()
                    try:process.wait(timeout=min(1,left()))
                    except subprocess.TimeoutExpired:pass
            if row['root'] and row['root']['pid']==process.pid:row['root_exit_code']=process.returncode
        for key,item in self.history.items():
            if left()<=0:return
            try:
                current=lab.process_info(item['pid'])
                if current is not None and self._key(current)==key and current['state']!='Z':os.kill(item['pid'],signal.SIGKILL)
            except (OSError,lab.ProcessObservationError):return
        for process,reader in self.readers.items():
            reader.join(timeout=min(1,left()))
            if reader.is_alive():return
        for process,row in self.registry:
            for stream in (process.stdin,process.stdout,process.stderr):
                if stream is not None:stream.close()
        self.refresh()
        # Best effort reaping does not restore authority, even if ECHILD occurs.
        self.collecting=True
        try:
            while left()>0:
                try:item=self._waitid(os.P_ALL,0,os.WEXITED|os.WNOHANG|os.WNOWAIT)
                except ChildProcessError:
                    record.update(complete=True,reason=None);return
                if item is None:return
                self._waitpid(item.si_pid,0)
        finally:self.collecting=False

    def evidence(self,*,complete=False):
        self.refresh();return project(self.value,complete=complete)


def dispatch(args):
    os.execv(sys.executable,[sys.executable,str(Path(__file__).resolve()),'--port',str(args.port),'--cache',str(args.cache),*(['--output',str(args.output)] if args.output else [])])


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8787);parser.add_argument('--cache',default=str(lab.HERE/'.lab-cache'));parser.add_argument('--output')
    args=parser.parse_args();runner=None
    try:
        runner=Runner()
        return lab.integration(args,crash=True,lifecycle=runner)
    except (LifecycleError,OSError) as exc:
        if runner is not None:
            runner.latch(exc.reason if isinstance(exc,LifecycleError) else 'identity')
            runner.contain(deadline=time.monotonic()+150)
        value=initial();value['failure']=exc.reason if isinstance(exc,LifecycleError) else 'unsupported'
        value['cleanup']=dict(status='refused',reason=value['failure'],kernel_echild=False)
        print(json.dumps(dict(schema_version=1,scenario='checkpoint-sigkill',command='make integration-crash',result='failed',phase='preflight',harness_commit=None,error='ownership',runtime_started=False,evidence_file_written=False,acceptance={f'M5-{n:02}':'not_run' for n in range(1,6)},crash_lifecycle=project(value)),sort_keys=True))
        return 1


if __name__=='__main__':
    sys.modules['crash_lifecycle']=sys.modules[__name__]
    raise SystemExit(main())

"""M4-only kernel ownership; imported code does not change process policy."""
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

import lab

PHASES = ('cold_baseline', 'cold_after_writes', 'cold_after_completion')
EDGES = ('parent_missing', 'parent_zombie', 'parent_reused', 'child_missing',
         'child_reused', 'child_reparented', 'start_order')
REASONS = frozenset(('unsupported','namespace','policy','launch','wait','identity',
                    'output','children','limit','deadline','cancelled','root_exit',
                    'forced','receipt','locks','sampling','schema'))
LIMITS = dict(max_epochs=3,max_launches=1024,max_adopted_reaped=1024,
              max_proc_entries=8192,max_sampled_generations=1024,max_samples_per_epoch=1,
              max_threads=16,max_pipes=3072,stat_bytes=4096,log_tail_bytes=32768,
              thread_join_seconds=2,poll_seconds=.01,extension_bytes=8192)


class LifecycleError(lab.LabError):
    def __init__(self, reason='schema'):
        self.reason = reason if reason in REASONS else 'schema'
        super().__init__(self.reason)


@dataclass(frozen=True,eq=False)
class _Receipt:
    deadline: float


@dataclass(frozen=True,eq=False)
class _Seal:
    deadline: float


def require(ok, reason='schema'):
    if not ok: raise LifecycleError(reason)


def integer(value, upper=2**63-1, lower=0):
    return type(value) is int and lower <= value <= upper


def epoch_record(index):
    return dict(index=index,phase=PHASES[index-1],root=None,root_exit_code=None,
                was_running=None,forced=False,launches=0,waited=0,pipes_open=0,
                threads_open=0,adopted_reaped=0,closed=False,snapshot_consumed=False,
                snapshot_complete=False,locks_released=False,
                sampling=dict(attempted=0,stable_children=0,ambiguous_edges=0,
                              reasons={key:0 for key in EDGES}),failure=None)


def initial():
    return dict(schema_version=1,mode='kernel_epochs',limits=dict(LIMITS),epochs=[],
                failure=None,cleanup=dict(status='not_run',reason=None,kernel_echild=False))


def project(value, *, complete=False):
    blank=initial()
    require(type(value) is dict and set(value)==set(blank))
    require(type(value['schema_version']) is int and value['schema_version']==1)
    require(value['mode']=='kernel_epochs' and type(value['mode']) is str)
    require(type(value['limits']) is dict and set(value['limits'])==set(LIMITS))
    require(all(type(value['limits'][k]) is type(v) and value['limits'][k]==v for k,v in LIMITS.items()))
    require(value['failure'] is None or type(value['failure']) is str and value['failure'] in REASONS)
    cleanup=value['cleanup']
    require(type(cleanup) is dict and set(cleanup)==set(blank['cleanup']))
    require(type(cleanup['kernel_echild']) is bool)
    require(type(cleanup['status']) is str and cleanup['status'] in ('not_run','verified','refused'))
    if cleanup['status']=='verified':require(cleanup['kernel_echild'] and cleanup['reason'] is None)
    elif cleanup['status']=='not_run':require(not cleanup['kernel_echild'] and cleanup['reason'] is None)
    else: require(type(cleanup['reason']) is str and cleanup['reason'] in REASONS)
    if value['failure'] is not None:require(cleanup['status']!='verified')
    rows=value['epochs'];require(type(rows) is list and len(rows)<=3)
    roots=[]
    for index,row in enumerate(rows,1):
        require(type(row) is dict and set(row)==set(epoch_record(index)))
        require(type(row['index']) is int and row['index']==index and row['phase']==PHASES[index-1])
        if index>1:require(rows[index-2]['snapshot_complete'])
        root=row['root']
        if root is not None:
            require(type(root) is dict and set(root)=={'pid','pgid','start_ticks'})
            require(integer(root['pid'],lower=1) and integer(root['pgid'],lower=1) and integer(root['start_ticks']))
            require(root not in roots);roots.append(root)
        code=row['root_exit_code'];require(code is None or integer(code,255,-255))
        require(row['was_running'] is None or type(row['was_running']) is bool)
        for key in ('forced','closed','snapshot_consumed','snapshot_complete','locks_released'):
            require(type(row[key]) is bool)
        if root is None:require(code is None and row['was_running'] is None and not row['forced'])
        for key in ('launches','waited','adopted_reaped'):
            require(integer(row[key],1024))
        require(row['waited']<=row['launches'])
        require(integer(row['pipes_open'],min(3*row['launches'],3072)))
        require(integer(row['threads_open'],min(2*row['launches'],16)))
        require(row['failure'] is None or type(row['failure']) is str and row['failure'] in REASONS)
        if row['closed']:
            require(row['waited']==row['launches'] and row['pipes_open']==row['threads_open']==0 and row['failure'] is None)
            if root is None:require(not complete and code is None and row['was_running'] is None and not row['forced'])
            else:require(code==0 and row['was_running'] is True and not row['forced'])
        if row['snapshot_consumed']:require(row['closed'] and root is not None)
        if row['snapshot_complete']:require(row['snapshot_consumed'] and row['locks_released'])
        sample=row['sampling']
        require(type(sample) is dict and set(sample)=={'attempted','stable_children','ambiguous_edges','reasons'})
        require(integer(sample['attempted'],1))
        require(integer(sample['stable_children'],1024) and integer(sample['ambiguous_edges'],1024))
        require(sample['stable_children']+sample['ambiguous_edges']<=1024)
        reasons=sample['reasons'];require(type(reasons) is dict and set(reasons)==set(EDGES))
        require(all(integer(count,1024) for count in reasons.values()) and sum(reasons.values())==sample['ambiguous_edges'])
        if not sample['attempted']:require(sample['stable_children']==sample['ambiguous_edges']==0)
        if index>1:require(not sample['attempted'])
    require(sum(row['launches'] for row in rows)<=1024 and sum(row['adopted_reaped'] for row in rows)<=1024)
    if complete:
        require(value['failure'] is None and cleanup['status']=='verified' and len(rows)==3)
        require(all(row['closed'] and row['snapshot_complete'] for row in rows))
        require(rows[0]['sampling']['attempted']==1 and rows[0]['sampling']['stable_children']>0)
    encoded=json.dumps(value,indent=2,sort_keys=True,allow_nan=False)
    require(len(encoded.encode())<=8192)
    return copy.deepcopy(value)


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
    require(lab.proc_namespace_supported(),'namespace')


class Daemon:
    def __init__(self, owner, process):
        self.owner,self.process=owner,process
        self.identity=owner.identity(process)
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
        except ChildProcessError as exc:require(exc.errno==errno.ECHILD,'children')
        else:raise LifecycleError('children')
        self.value=initial();self.registry=[];self.daemons=[];self.readers={};self.failure=None
        self.cancelled=False;self.launching=False;self.waiting=False;self.collecting=False
        self.scope=None;self.scope_binding=None
        self.receipts={};self.seals={};self.terminal=False
        self.value['epochs'].append(epoch_record(1));self._install()

    @property
    def epoch(self):return self.value['epochs'][-1]

    def latch(self,reason):
        reason=reason if reason in REASONS else 'schema'
        if self.failure is None:
            self.failure=reason;self.value['failure']=reason
            if not self.epoch['closed']:self.epoch['failure']=reason
        self.value['cleanup'].update(status='refused',reason=self.failure)

    def fail(self,reason):
        self.latch(reason);raise LifecycleError(self.failure)

    def cancel(self):self.cancelled=True;self.latch('cancelled')

    def check(self, *, check_policy=True):
        if threading.current_thread() is not threading.main_thread():self.fail('wait')
        if self.failure:self.fail(self.failure)
        if self.cancelled:self.fail('cancelled')
        if check_policy:
            try:policy()
            except LifecycleError as exc:self.fail(exc.reason)

    def remaining(self,deadline):
        self.check(check_policy=False)
        left=deadline-time.monotonic()
        if not math.isfinite(deadline) or left<=0:self.fail('deadline')
        return left

    def _install(self):
        owner=self;original=subprocess.Popen
        class Registered(original):
            def __init__(self,*args,**kwargs):
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
            if (owner.terminal or id(owner.epoch) in owner.receipts or
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
        self.check()
        if self.terminal or self.epoch['closed'] or id(self.epoch) in self.receipts:self.fail('launch')
        if len(self.registry)>=1024:self.fail('limit')

    def identity(self,process):
        try:current=lab.process_info(process.pid)
        except lab.ProcessObservationError:self.fail('identity')
        if current is None or current['state']=='Z':self.fail('identity')
        return current

    def root_check(self,daemon):
        self.check()
        if daemon.process.poll() is not None:self.fail('root_exit')
        current=self.identity(daemon.process)
        if any(current[k]!=daemon.identity[k] for k in ('pid','pgid','start_ticks')):self.fail('identity')
        return True

    def refresh(self):
        for row in self.value['epochs']:
            ps=[p for p,e in self.registry if e is row]
            row['launches']=len(ps);row['waited']=sum(p.returncode is not None for p in ps)
            row['pipes_open']=sum(stream is not None and not stream.closed for p in ps for stream in (p.stdin,p.stdout,p.stderr))
            row['threads_open']=sum(self.readers[p].is_alive() for p in ps if p in self.readers)
            if row is self.epoch:
                row['threads_open']+=sum(isinstance(t,threading.Timer) and t.is_alive() for t in threading.enumerate())

    def bind_scope(self,scope):
        self.check()
        if self.scope is not None:self.fail('identity')
        try:scope.check_owner()
        except BaseException:
            self.latch('identity');raise
        self.scope=scope
        self.scope_binding=(scope.path,dict(scope.identity),scope.marker)

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
        self.check()
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
        except Exception:
            self.latch('identity');raise
        daemon.epoch=self.epoch;self.daemons.append(daemon)
        self.epoch['root']=lab.public_process(daemon.identity)
        self.refresh();return daemon

    def sample_liveness(self,daemon):
        self.root_check(daemon)
        sample=self.epoch['sampling']
        if self.epoch['index']!=1 or sample['attempted']:self.fail('sampling')
        sample['attempted']=1
        try:
            table={}
            with os.scandir('/proc') as entries:
                count=0
                for entry in entries:
                    if entry.name.isdecimal():
                        count+=1
                        if count>8192:self.fail('limit')
                        info=lab.process_info(int(entry.name))
                        if info is not None:table[info['pid']]=info
            parents={daemon.identity['pid']:daemon.identity};visited=set();stable=[]
            while True:
                added=False
                for pid,candidate in table.items():
                    if pid in visited or pid==daemon.identity['pid'] or candidate['ppid'] not in parents:continue
                    if len(visited)>=1024:self.fail('limit')
                    visited.add(pid);parent=parents[candidate['ppid']];reason=None
                    for _ in range(2):
                        p=lab.process_info(parent['pid']);c=lab.process_info(pid)
                        if p is None:reason='parent_missing'
                        elif p['state']=='Z':reason='parent_zombie'
                        elif p['start_ticks']!=parent['start_ticks']:reason='parent_reused'
                        elif c is None:reason='child_missing'
                        elif c['start_ticks']!=candidate['start_ticks']:reason='child_reused'
                        elif c['ppid']!=candidate['ppid']:reason='child_reparented'
                        elif c['start_ticks']<p['start_ticks']:reason='start_order'
                        if reason:break
                    self.root_check(daemon)
                    if reason:
                        sample['ambiguous_edges']+=1;sample['reasons'][reason]+=1
                    elif c['state']!='Z':
                        stable.append(lab.public_process(c));parents[pid]=c;added=True
                if not added:break
        except (OSError,lab.ProcessObservationError):self.fail('sampling')
        self.root_check(daemon);sample['stable_children']=len(stable)
        if not stable:self.fail('sampling')
        daemon.samples=stable;return copy.deepcopy(stable)

    def _collect_waitid(self):
        if not self.collecting or threading.current_thread() is not threading.main_thread():self.fail('wait')
        return self._waitid(os.P_ALL,0,os.WEXITED|os.WNOHANG|os.WNOWAIT)

    def _collect_waitpid(self,pid):
        if not self.collecting or threading.current_thread() is not threading.main_thread():self.fail('wait')
        return self._waitpid(pid,0)

    def collect(self,deadline):
        self.check();self.refresh()
        if any(p.returncode is None for p,e in self.registry):self.fail('wait')
        if any(row['pipes_open'] or row['threads_open'] for row in self.value['epochs']):self.fail('output')
        self.collecting=True
        try:
            while True:
                self.remaining(deadline);self.check()
                try:item=self._collect_waitid()
                except ChildProcessError as exc:
                    if exc.errno!=errno.ECHILD:self.fail('wait')
                    return
                if item is None:time.sleep(min(.01,self.remaining(deadline)));continue
                if sum(row['adopted_reaped'] for row in self.value['epochs'])>=1024:self.fail('limit')
                if self._collect_waitpid(item.si_pid)[0]!=item.si_pid:self.fail('wait')
                self.epoch['adopted_reaped']+=1
        except LifecycleError as exc:
            self.latch(exc.reason);raise
        except lab.LabError:
            self.fail('deadline')
        except OSError:
            self.fail('wait')
        except BaseException:
            self.latch('wait');raise
        finally:self.collecting=False

    def close_epoch(self,daemon,deadline):
        try:return self._close_epoch(daemon,deadline)
        except LifecycleError:raise
        except lab.ProcessObservationError:
            self.fail('identity')
        except lab.LabError:
            self.fail('deadline')
        except BaseException:
            self.latch('wait');raise

    def _close_epoch(self,daemon,deadline):
        self.check()
        if self.epoch['closed'] or id(self.epoch) in self.receipts:self.fail('receipt')
        # Closing the launch gate precedes every wait, even on failure paths.
        self.receipts[id(self.epoch)]=None
        if daemon is not None:
            self.root_check(daemon)
            if daemon.epoch is not self.epoch:self.fail('receipt')
            self.epoch['was_running']=True
            daemon.process.terminate()
            try:daemon.process.wait(timeout=min(30,self.remaining(deadline)))
            except subprocess.TimeoutExpired:
                self.epoch['forced']=True;self.latch('forced')
                daemon.process.kill()
                try:daemon.process.wait(timeout=max(0,min(5,deadline-time.monotonic())))
                except subprocess.TimeoutExpired:pass
                raise LifecycleError('forced')
            self.epoch['root_exit_code']=daemon.process.returncode
            if daemon.process.returncode!=0:self.fail('root_exit')
        for process,row in self.registry:
            if row is self.epoch and process.returncode is None:self.fail('wait')
        threads=[t for t in threading.enumerate() if t is not threading.main_thread()]
        if len(threads)>16:self.fail('limit')
        for thread in threads:
            thread.join(timeout=min(2,self.remaining(deadline)))
            if thread.is_alive():self.fail('output')
        for process,row in self.registry:
            if row is self.epoch:
                for stream in (process.stdin,process.stdout,process.stderr):
                    if stream is not None:stream.close()
        self.collect(deadline)
        self.remaining(deadline)
        self.epoch['closed']=True;self.refresh()
        receipt=_Receipt(deadline);self.receipts[id(self.epoch)]=receipt;return receipt

    def consume_snapshot(self,receipt,phase):
        self.check()
        if len(threading.enumerate())!=1:self.fail('wait')
        if self.receipts.get(id(self.epoch)) is not receipt or not self.epoch['closed'] or self.epoch['snapshot_consumed'] or phase!=self.epoch['phase'] or self.epoch['root'] is None:self.fail('receipt')
        self.remaining(receipt.deadline)
        self.epoch['snapshot_consumed']=True

    def snapshot_finished(self,receipt,*,success,locks_released):
        self.check()
        if type(success) is not bool or type(locks_released) is not bool:self.fail('schema')
        if self.receipts.get(id(self.epoch)) is not receipt or not self.epoch['snapshot_consumed']:self.fail('receipt')
        self.remaining(receipt.deadline)
        if not locks_released:self.fail('locks')
        self.epoch['locks_released']=True;self.epoch['snapshot_complete']=bool(success)

    def next_epoch(self):
        self.check()
        if self.terminal or not self.epoch['snapshot_complete'] or len(self.value['epochs'])>=3:self.fail('receipt')
        self.remaining(self.receipts[id(self.epoch)].deadline)
        self.value['epochs'].append(epoch_record(len(self.value['epochs'])+1))

    def shutdown(self,daemon):
        row=daemon.epoch
        return dict(was_running=row['was_running'],signal='SIGTERM',forced=row['forced'],
                    exit_code=row['root_exit_code'],all_owned_exited=row['closed'],
                    observation_error=None if row['failure'] is None else row['failure'],children=copy.deepcopy(daemon.samples))

    def finalize(self,deadline):
        try:
            return self._finalize(deadline)
        except LifecycleError as exc:self.latch(exc.reason)
        except lab.LabError:self.latch('deadline')
        except OSError:self.latch('wait')
        except BaseException:
            self.latch('wait')
            self.value['cleanup']=dict(status='refused',reason=self.failure,kernel_echild=False)
            raise
        self.value['cleanup']=dict(status='refused',reason=self.failure,kernel_echild=False)
        try:self.contain(deadline)
        except Exception:pass  # First authority failure remains the outcome.
        raise LifecycleError(self.failure)

    def _finalize(self,deadline):
        self.check()
        if self.terminal:self.fail('receipt')
        if not self.epoch['closed']:
            daemon=next((d for d in self.daemons if d.epoch is self.epoch),None)
            self.close_epoch(daemon,deadline)
        self.terminal=True;self.collect(deadline)
        self.remaining(deadline)
        seal=_Seal(deadline);self.seals[seal]=False
        self.value['cleanup']=dict(status='verified',reason=None,kernel_echild=True)
        return seal

    def consume_deletion(self,seal,remove):
        self.check()
        if len(threading.enumerate())!=1:self.fail('wait')
        token=next((item for item in self.seals if item is seal),None)
        if not self.terminal or not self.epoch['closed'] or token is None or self.seals[token]:self.fail('receipt')
        if self.scope is not None:
            try:
                if (self.scope.path,dict(self.scope.identity),self.scope.marker)!=self.scope_binding:self.fail('identity')
                self.scope.check_owner()
            except BaseException:
                self.latch('identity');raise
        remaining=self.remaining(seal.deadline)
        self.seals[seal]=True
        try:
            with lab.m3_deadline(remaining,'M4 terminal deletion'):
                self.remaining(seal.deadline)
                result=remove()
                self.remaining(seal.deadline)
                return result
        except LifecycleError:
            raise
        except BaseException:
            self.latch('deadline' if time.monotonic()>=seal.deadline else 'identity');raise

    def contain(self,deadline):
        # Exact direct unreaped Popen children are kernel-owned, independent of
        # sampled PIDs. Containment never repairs the authority latch.
        for process,row in self.registry:
            try:running=process.poll() is None
            except LifecycleError:
                # A stolen exit status remains unknown. Never invent code0 or
                # signal a PID after kernel wait ownership has been lost.
                continue
            if running:
                process.terminate()
                try:process.wait(timeout=max(0,min(1,deadline-time.monotonic())))
                except subprocess.TimeoutExpired:
                    process.kill()
                    try:process.wait(timeout=max(0,min(1,deadline-time.monotonic())))
                    except subprocess.TimeoutExpired:pass
            if row.get('root') and row['root']['pid']==process.pid:row['root_exit_code']=process.returncode
        for process,reader in self.readers.items():
            reader.join(timeout=max(0,min(1,deadline-time.monotonic())))
            if not reader.is_alive():process.stdout.close()
        for process,row in self.registry:
            if process not in self.readers or not self.readers[process].is_alive():
                for stream in (process.stdin,process.stdout,process.stderr):
                    if stream is not None:stream.close()
        self.refresh()

    def evidence(self,*,complete=False):
        self.refresh();return project(self.value,complete=complete)


def dispatch(args):
    os.execv(sys.executable,[sys.executable,str(Path(__file__).resolve()),
                            '--port',str(args.port),'--cache',str(args.cache),
                            *(['--output',str(args.output)] if args.output else [])])


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8787)
    parser.add_argument('--cache',default=str(lab.HERE/'.lab-cache'))
    parser.add_argument('--output')
    args=parser.parse_args()
    try:runner=Runner()
    except (LifecycleError,OSError):
        # Refuse before scope/upstream and emit only fixed bounded facts. The
        # unvalidated output path must not be used for a sidecar here.
        error=sys.exc_info()[1]
        reason=error.reason if isinstance(error,LifecycleError) else 'unsupported'
        value=initial();value['failure']=reason
        value['cleanup']=dict(status='refused',reason=reason,kernel_echild=False)
        print(json.dumps(dict(schema_version=1,scenario='cold-storage-footprint',
                              command='make integration-storage',result='failed',phase='preflight',
                              harness_commit=None,error='ownership',runtime_started=False,
                              evidence_file_written=False,acceptance={f'M4-{n:02}':'not_run' for n in range(1,6)},
                              storage_lifecycle=project(value)),sort_keys=True))
        return 1
    return lab.integration(args,storage=True,lifecycle=runner)


if __name__=='__main__':
    sys.modules['storage_lifecycle']=sys.modules[__name__]
    raise SystemExit(main())

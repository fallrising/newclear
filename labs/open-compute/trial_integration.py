#!/usr/bin/env python3
"""Finite separate-process rehearsal of the retained manual lab (stdlib only)."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time

import lab
import failure_diagnostics
from trial_supervision import SupervisedCapture

ACCEPTANCE = tuple(f'M7-0{i}' for i in range(1, 6))
RETAINED = ('after_first_stop', 'after_second_stop', 'after_third_stop',
            'state_after_destroy', 'original_identity', 'waiting_row',
            'completed_row', 'workflow_nonce')
LIMITATIONS = dict(lab_ci_only=True, host_installed=False, detached=False,
                   service_manager=False, soak=False, capacity=False,
                   power_loss=False, untrusted_isolation=False,
                   same_uid_path=True, same_boot_pending_workflow=True)
SEQUENCE = [dict(command=c, result=r) for c, r in (
    ('init','passed'), ('init','failed'), ('serve','passed'), ('status','passed'),
    ('submit','passed'), ('submit','passed'), ('submit','failed'), ('read','passed'),
    ('workflow','passed'), ('stop','passed'), ('serve','passed'), ('status','passed'),
    ('read','passed'), ('approve','passed'), ('stop','passed'), ('serve','passed'),
    ('status','passed'), ('read','passed'), ('stop','passed'), ('destroy','passed'))]
ERRORS = {'schema','ownership','busy','dirty','protocol','io','deadline','preflight',
          'pin','bootstrap','deployment','runtime','workload','workflow','shutdown',
          'interrupted','evidence','conflict','not_found'}
PHASES = {'preflight','init','first_owner','second_owner','third_owner','destroy','complete'}
STOP_KEYS = {'was_running','signal','forced','exit_code','all_owned_exited'}

class TrialFailure(Exception):
    pass


def need(condition, reason='schema'):
    if not condition:
        raise TrialFailure(reason)


def initial_report():
    commit = subprocess.check_output(['git','rev-parse','HEAD'], cwd=lab.HERE,
                                     timeout=5, text=True).strip()
    return dict(schema_version=1, scenario='manual-retained', result='failed',
                phase='preflight', error='runtime',
                acceptance={name:'not_run' for name in ACCEPTANCE},
                upstream=json.loads((lab.HERE/'upstream.lock.json').read_text()),
                harness_commit=commit,
                environment=dict(os=platform.system(), architecture=platform.machine(),
                                 python=platform.python_version(), euid=os.geteuid()),
                fixture_sha256=hashlib.sha256((lab.HERE/'fixtures/worker.js').read_bytes()).hexdigest(),
                commands=[], retained={name:False for name in RETAINED},
                daemon_generations=[], shutdowns=[], scope_removed=False,
                evidence_file_written=False, limitations=LIMITATIONS.copy())


def project_report(value):
    keys = {'schema_version','scenario','result','phase','error','acceptance','upstream',
            'harness_commit','environment','fixture_sha256','commands','retained',
            'daemon_generations','shutdowns','scope_removed','evidence_file_written','limitations'}
    need(type(value) is dict and set(value)==keys)
    v=value
    need(type(v['schema_version']) is int and v['schema_version']==1)
    need(v['scenario']=='manual-retained' and v['result'] in ('passed','failed'))
    need(v['phase'] in PHASES and (v['error'] is None or v['error'] in ERRORS))
    need(type(v['acceptance']) is dict and set(v['acceptance'])==set(ACCEPTANCE))
    need(all(x in ('passed','failed','not_run') for x in v['acceptance'].values()))
    lock=json.loads((lab.HERE/'upstream.lock.json').read_text())
    need(json.dumps(v['upstream'],sort_keys=True,allow_nan=False)==json.dumps(lock,sort_keys=True))
    need(type(v['harness_commit']) is str and re.fullmatch('[a-f0-9]{40}',v['harness_commit']))
    e=v['environment']
    need(type(e) is dict and set(e)=={'os','architecture','python','euid'})
    need(e['os'] in ('Linux','unknown') and e['architecture'] in ('x86_64','unknown'))
    need(type(e['python']) is str and re.fullmatch(r'[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,3}',e['python']))
    need(type(e['euid']) is int and 0<=e['euid']<=2**32-1)
    need(v['fixture_sha256']==hashlib.sha256((lab.HERE/'fixtures/worker.js').read_bytes()).hexdigest())
    need(type(v['commands']) is list and len(v['commands'])<=64)
    for c in v['commands']:
        need(type(c) is dict and set(c)=={'command','result'})
        need(c['command'] in {x['command'] for x in SEQUENCE} and c['result'] in ('passed','failed'))
    need(type(v['retained']) is dict and set(v['retained'])==set(RETAINED))
    need(all(type(x) is bool for x in v['retained'].values()))
    need(type(v['daemon_generations']) is list and len(v['daemon_generations'])<=3)
    ids=[]
    for d in v['daemon_generations']:
        need(type(d) is dict and set(d)=={'pid','start_ticks'})
        need(all(type(x) is int and 0<x<=2**63-1 for x in d.values()))
        ids.append((d['pid'],d['start_ticks']))
    need(len(ids)==len(set(ids)))
    need(type(v['shutdowns']) is list and len(v['shutdowns'])<=3)
    for stop in v['shutdowns']:
        need(type(stop) is dict and set(stop)==STOP_KEYS)
        need(all(type(stop[k]) is bool for k in ('was_running','forced','all_owned_exited')))
        need(stop['signal']=='SIGTERM' and (stop['exit_code'] is None or
             type(stop['exit_code']) is int and -255<=stop['exit_code']<=255))
    need(type(v['scope_removed']) is bool and type(v['evidence_file_written']) is bool)
    need(type(v['limitations']) is dict and set(v['limitations'])==set(LIMITATIONS))
    need(all(type(v['limitations'][k]) is bool and v['limitations'][k] is x for k,x in LIMITATIONS.items()))
    if v['result']=='passed':
        need(v['phase']=='complete' and v['error'] is None and e['euid']>0 and
             e['os']=='Linux' and e['architecture']=='x86_64')
        need(all(x=='passed' for x in v['acceptance'].values()) and all(v['retained'].values()))
        need(v['commands']==SEQUENCE and len(ids)==3 and len(v['shutdowns'])==3)
        need(all(x==dict(was_running=True,signal='SIGTERM',forced=False,exit_code=0,
                         all_owned_exited=True) for x in v['shutdowns']))
        need(v['scope_removed'] and v['evidence_file_written'])
    else:
        need(v['error'] in ERRORS and v['acceptance']['M7-05']!='passed')
    need(len(json.dumps(v,allow_nan=False).encode())<=128*1024,'evidence')
    return copy.deepcopy(v)


def write_report(output, report):
    """Exclusive publication; write failure revokes the in-memory success claim."""
    report['evidence_file_written']=True
    try:
        value=project_report(report)
        encoded=(json.dumps(value,indent=2,sort_keys=True,allow_nan=False)+'\n').encode()
        need(len(encoded)<=128*1024,'evidence')
        with lab.m3_deadline(10,'M7 evidence'):
            lab.exclusive_file(output/'report.json',encoded)
    except Exception:
        report.update(result='failed',error='evidence',evidence_file_written=False)
        report['acceptance']['M7-05']='failed'
        raise TrialFailure('evidence') from None


def manifest_bytes(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        info=os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid==os.geteuid() and
             info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600 and info.st_size<=65536,'ownership')
        data=os.read(fd,65537)
        after=os.fstat(fd)
        need(len(data)<=65536 and len(data)==info.st_size and
             (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns)==
             (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'ownership')
        return data
    finally:
        os.close(fd)


def manifest_identity(state):
    from trial_state import _parse, validate_manifest
    value=validate_manifest(_parse(manifest_bytes(state/'manifest.json')))
    need(value['identity'] is not None,'deployment')
    return value['identity']


def require_same_identity(original, observed):
    # Canonical JSON preserves boolean/number distinctions in runtime metadata.
    need(json.dumps(original,sort_keys=True,allow_nan=False)==
         json.dumps(observed,sort_keys=True,allow_nan=False),'deployment')


def finalize_children(children, deadline=None):
    failed=False
    for child in reversed(children):
        need(deadline is None or time.monotonic()<deadline,'deadline')
        try:
            if isinstance(child,SupervisedCapture):
                if not child.finished:
                    child.cancel(deadline or time.monotonic()+30)
                    raise TrialFailure('shutdown')
                continue
            if child.process.poll() is None or child.live(strict=False):
                receipt=child.stop(grace=30)
                need(receipt['forced'] is False and receipt['all_owned_exited'] is True and
                     receipt['exit_code']==0 and not receipt['observation_error'],'shutdown')
            else:
                child.finish_threads()
            need(child.process.poll() is not None and not child.live(strict=False) and
                 not child.observation_error,'shutdown')
        except Exception:
            failed=True
        need(deadline is None or time.monotonic()<deadline,'deadline')
    need(not failed,'shutdown')


def observe_ready(child,commands,deadline=None):
    from trial_state import decode_message
    if isinstance(child,SupervisedCapture):child.ready(deadline)
    exited=child.process.poll() is not None
    if exited:
        if isinstance(child,SupervisedCapture):raise TrialFailure('bootstrap')
        child.finish_threads()
    need(not child.observation_error,'bootstrap')
    output=child.text()
    if '\n' in output:
        value=decode_message(output.splitlines(keepends=True)[0].encode())
        need(value['command']=='serve','protocol')
        if value['result']=='failed':
            commands.append(dict(command='serve',result='failed'))
            raise TrialFailure(value['error'])
        need(not exited and value==dict(schema_version=1,command='serve',result='passed',
             error=None,data={'ready':True}),'bootstrap')
        commands.append(dict(command='serve',result='passed'))
        return True
    need(not exited,'bootstrap')
    return False


class Capture(lab.Process):
    """Count complete output as well as keeping the inherited bounded ring."""
    def __init__(self, argv):
        self.output_bytes = 0
        super().__init__(argv)

    def _read(self):
        try:
            while chunk := self.process.stdout.read1(4096):
                with self.lock:
                    self.output_bytes += len(chunk)
                    if self.output_bytes > lab.LOG_LIMIT:
                        self.observation_error = 'bounded command output exceeded'
                    self.tail.extend(chunk)
                    del self.tail[:-lab.LOG_LIMIT]
        except Exception:
            self.observation_error = 'command output read failed'


def execute(args, report, recorder=None):
    from trial_state import decode_message
    cache = Path(args.cache)
    scope = Path(pwd.getpwuid(os.getuid()).pw_dir)/'.open-compute'
    cache = cache.resolve()
    lab.preflight(args.port)
    pin = report['upstream']
    lab.validate_lock(pin)
    lab.download_binary(cache, pin['artifact'], 'm7-'+os.urandom(8).hex())
    # State is private and deliberately retained even after explicit scope disposal.
    parent = Path(tempfile.mkdtemp(prefix='oc-m7-', dir=os.environ.get('RUNNER_TEMP')))
    state = parent/'state'
    need(len(os.fsencode(state/'control.sock')) <= 100, 'preflight')
    children = []
    current = None
    end = time.monotonic()+300

    def spawn(command, *options):
        with lab.defer_owner_signals():
            child = SupervisedCapture([sys.executable, str(lab.HERE/'trial.py'), command,
                             '--state', str(state), *map(str, options)],deadline=end,state=state)
            children.append(child)
        return child

    def response(child, command, expected='passed'):
        if isinstance(child,SupervisedCapture):
            value=child.completion(expected,deadline=min(end,time.monotonic()+(160 if command=='stop' else 100)))
        else:
            child.process.wait(timeout=max(0.01, min(160 if command=='stop' else 100, end-time.monotonic())))
            child.finish_threads()
            need(not child.observation_error and not child.live(), 'runtime')
            value = decode_message(child.text().encode())
        need(value['command']==command and value['result']==expected, 'workload')
        need((child.process.returncode==0)==(expected=='passed'), 'runtime')
        report['commands'].append(dict(command=command, result=value['result']))
        return value

    def call(command, *options, expected='passed'):
        need(time.monotonic()<end, 'deadline')
        return response(spawn(command,*options),command,expected)

    def serve():
        nonlocal current
        current = spawn('serve','--seconds','600')
        cutoff = min(end,time.monotonic()+120)
        while time.monotonic()<cutoff:
            if observe_ready(current,report['commands'],cutoff):
                return
            time.sleep(.05)
        raise TrialFailure('deadline')

    def stop():
        nonlocal current
        value = call('stop')
        if isinstance(current,SupervisedCapture):
            current.completion(deadline=min(end,time.monotonic()+20))
            need(current.clean_committed,'shutdown')
            receipt=value['data']
            need(receipt==dict(was_running=True,signal='SIGTERM',forced=False,
                              exit_code=0,all_owned_exited=True),'shutdown')
            report['shutdowns'].append(receipt)
            current=None
            need(scope.is_dir() and (state/'manifest.json').is_file(),'ownership')
            return
        current.process.wait(timeout=max(.01,min(20,end-time.monotonic())))
        current.finish_threads()
        need(current.process.returncode==0 and not current.live() and
             not current.observation_error, 'shutdown')
        lines = current.text().splitlines(keepends=True)
        need(len(lines)==2, 'protocol')
        final = decode_message(lines[1].encode())
        need(final==dict(schema_version=1,command='serve',result='passed',error=None,
                        data={'stopped':True,'clean':True}), 'shutdown')
        receipt = value['data']
        need(receipt==dict(was_running=True,signal='SIGTERM',forced=False,
                          exit_code=0,all_owned_exited=True), 'shutdown')
        report['shutdowns'].append(receipt)
        current = None
        need(scope.is_dir() and (state/'manifest.json').is_file(), 'ownership')

    def status():
        data = call('status')['data']
        need(data['running'] is True and data['worker_healthy'] is True, 'runtime')
        report['daemon_generations'].append(data['daemon'])
        return data

    def check_identity(status):
        observed=manifest_identity(state)
        require_same_identity(original,observed)
        need(all(status[k]==original[k] for k in ('instance_id','account_id','database_id')) and
             all(status[k]==original['deployment'][k] for k in ('deployment_id','version_id')),'deployment')

    def row(v, callback, completed):
        need(v['row_count']==1 and type(v['row_count']) is int, 'workload')
        j=v['job']
        need(j['id']=='trial-01' and j['payload']=='synthetic-m7' and
             j['callback_count']==callback and j['completed']==completed, 'workload')
        return j

    try:
        with lab.m3_deadline(300,'M7 scenario'):
            report['phase']='init'
            call('init','--cache',cache,'--port',args.port)
            manifest_before=manifest_bytes(state/'manifest.json')
            original=manifest_identity(state)
            call('init','--cache',cache,'--port',args.port,expected='failed')
            need(manifest_bytes(state/'manifest.json')==manifest_before, 'ownership')
            report['acceptance']['M7-01']='passed'
            report['phase']='first_owner'
            serve(); first=status(); check_identity(first)
            a=call('submit','--id','trial-01','--payload','synthetic-m7')['data']
            b=call('submit','--id','trial-01','--payload','synthetic-m7')['data']
            need(a==b,'workload'); row(a,0,0)
            conflict=call('submit','--id','trial-01','--payload','different',expected='failed')
            need(conflict['error']=='conflict','workload')
            need(call('read','--id','trial-01')['data']==a,'workload')
            report['acceptance']['M7-02']='passed'
            flow=call('workflow','--id','trial-flow-01','--job-id','trial-01')['data']
            need(flow['id']=='trial-flow-01' and flow['job_id']=='trial-01' and
                 flow['status']=='waiting' and flow['callback_count']==1,'workflow')
            stop(); report['retained']['after_first_stop']=True
            report['phase']='second_owner'
            serve(); second=status()
            check_identity(second)
            need(second['workflow']['id']=='trial-flow-01' and
                 second['workflow']['job_id']==flow['job_id'] and
                 second['workflow']['nonce_sha256']==flow['nonce_sha256'] and
                 second['workflow']['status']=='waiting','workflow')
            waiting=row(call('read','--id','trial-01')['data'],1,0)
            need(waiting['nonce_sha256']==flow['nonce_sha256'],'workflow')
            report['retained']['waiting_row']=True
            approved=call('approve')['data']
            need(approved['id']==flow['id'] and approved['job_id']==flow['job_id'] and
                 approved['nonce_sha256']==flow['nonce_sha256'] and
                 approved['status']=='complete' and approved['callback_count']==1 and
                 approved['completed']==1,'workflow')
            stop(); report['retained']['after_second_stop']=True
            report['acceptance']['M7-03']='passed'
            report['phase']='third_owner'
            serve(); third=status()
            check_identity(third)
            need(third['workflow']['id']=='trial-flow-01' and
                 third['workflow']['job_id']==flow['job_id'] and
                 third['workflow']['status']=='complete' and third['workflow']['completed'] is True and
                 third['workflow']['nonce_sha256']==flow['nonce_sha256'],'workflow')
            completed=row(call('read','--id','trial-01')['data'],1,1)
            need(completed['nonce_sha256']==waiting['nonce_sha256'],'workflow')
            report['retained'].update(original_identity=True,completed_row=True,workflow_nonce=True)
            stop(); report['retained']['after_third_stop']=True
            report['acceptance']['M7-04']='passed'
            report['phase']='destroy'
            call('destroy')
            need(not os.path.lexists(scope),'ownership')
            report['scope_removed']=True
            report['retained']['state_after_destroy']=(state/'manifest.json').is_file()
            need(report['retained']['state_after_destroy'],'ownership')
    except Exception as exc:
        if recorder is not None:
            recorder.capture("original", report['phase'], exc)
            if current is not None:
                recorder.observe("original", getattr(current, "observation_reason", None))
        raise
    finally:
        # Failure cleanup never calls destroy or clears the child's dirty marker.
        try:
            with lab.m3_deadline(150,'M7 cleanup') as deadline:
                finalize_children(children,deadline)
        except Exception as exc:
            if recorder is not None:
                recorder.capture("cleanup", report['phase'], exc)
            raise


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',default=str(lab.HERE/'.lab-cache'))
    parser.add_argument('--output',default=str(lab.HERE/'.lab-runs'/('m7-'+os.urandom(8).hex())))
    parser.add_argument('--port',type=int,default=8787)
    args=parser.parse_args(argv)
    report=initial_report()
    diagnostic_record=failure_diagnostics.Recorder("trial",report['harness_commit'])
    output=None
    def interrupted(signum,frame):
        raise TrialFailure('interrupted')
    old={s:signal.signal(s,interrupted) for s in (signal.SIGINT,signal.SIGTERM)}
    try:
        scope=Path(pwd.getpwuid(os.getuid()).pw_dir)/'.open-compute'
        _,output=lab.validate_artifact_paths(scope,Path(args.cache),Path(args.output))
        # validate_artifact_paths owns exclusive output admission only; mkdir below.
        output.mkdir(mode=0o700,parents=True,exist_ok=False)
        execute(args,report,recorder=diagnostic_record)
        report.update(result='passed',phase='complete',error=None,evidence_file_written=True)
        report['acceptance']['M7-05']='passed'
        write_report(output,report)
    except Exception as exc:
        if isinstance(exc,TrialFailure) and str(exc)=='evidence':
            diagnostic_record.capture("evidence",report['phase'],exc)
        elif diagnostic_record.value['failures']['cleanup'] is None:
            diagnostic_record.capture("original",report['phase'],exc)
        reason=str(exc) if isinstance(exc,TrialFailure) and str(exc) in ERRORS else 'runtime'
        if report['evidence_file_written']:
            reason='evidence'
        report.update(result='failed',error=reason,evidence_file_written=False)
        report['acceptance']['M7-05']='failed'
        # A failed exclusive write is never overwritten and never reported as success.
        if output is not None and output.is_dir() and not os.path.lexists(output/'report.json'):
            try:
                write_report(output,report)
            except TrialFailure as exc:
                diagnostic_record.capture("evidence",report['phase'],exc)
    finally:
        for s,h in old.items(): signal.signal(s,h)
    try:
        value=project_report(report)
        encoded=json.dumps(value,indent=2,sort_keys=True,allow_nan=False)+'\n'
        need(len(encoded.encode())<=128*1024,'evidence')
        print(encoded,end='')
    except Exception as exc:
        diagnostic_record.capture("evidence",report['phase'],exc)
        if output is not None:
            failure_diagnostics.write_record(output,diagnostic_record,dict(report,result='failed'),1)
        print('{"result":"failed","error":"evidence"}')
        return 1
    exit_code=0 if report['result']=='passed' else 1
    if output is not None:
        failure_diagnostics.write_record(output,diagnostic_record,report,exit_code)
    return exit_code

if __name__=='__main__':
    raise SystemExit(main())

#!/usr/bin/env python3
"""Manual retained lab lifecycle: one foreground owner, finite private clients."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import platform
import pwd
import re
import secrets
import signal
import socket
import stat
import struct
import sys
import time

import lab
from trial_state import (StateDirectory, StateError, validate_scope,
                         validate_manifest, encode_message, decode_message)

HERE = Path(__file__).resolve().parent
ID = re.compile(r'[a-z0-9][a-z0-9-]{0,63}\Z')
ERRORS = frozenset(('schema','ownership','busy','dirty','protocol','io','deadline',
    'preflight','pin','bootstrap','deployment','runtime','workload','workflow',
    'shutdown','interrupted','evidence','conflict','not_found'))
LOCK_PATHS = ('ocd.lock', 'instances/lab/data/platform.lock',
              'instances/lab/data/objects/backend.lock')
SCHEMA_SQL = ('CREATE TABLE jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, '
              'callback_count INTEGER NOT NULL DEFAULT 0, step_nonce TEXT, '
              'completed INTEGER NOT NULL DEFAULT 0)')


class TrialError(Exception):
    def __init__(self, reason):
        self.reason = reason if reason in ERRORS else 'runtime'
        super().__init__(self.reason)


def require(value, reason='schema'):
    if not value:
        raise TrialError(reason)


def success(command, data):
    return dict(schema_version=1,command=command,result='passed',error=None,data=data)


def failure(command, exc):
    reason = getattr(exc,'reason',None)
    if reason not in ERRORS:
        # StateError is required to expose a fixed public reason, but no other
        # exception message is ever copied to operator output.
        reason = str(exc) if isinstance(exc,StateError) and str(exc) in ERRORS else None
    if reason is None:
        reason = 'io' if isinstance(exc,OSError) else 'runtime'
    return dict(schema_version=1,command=command,result='failed',error=reason,data={})


def emit(response):
    sys.stdout.buffer.write(encode_message(response))
    sys.stdout.buffer.flush()


def scope_path():
    return Path(pwd.getpwuid(os.getuid()).pw_dir) / '.open-compute'


def fixture_hash():
    return hashlib.sha256((HERE/'fixtures/worker.js').read_bytes()).hexdigest()


def pin():
    value=json.loads((HERE/'upstream.lock.json').read_text())
    lab.validate_lock(value)
    return value


def nofollow_parents(path):
    require(path.is_absolute() and '..' not in path.parts,'ownership')
    for ancestor in (path,*path.parents):
        info=ancestor.lstat()
        require(not stat.S_ISLNK(info.st_mode),'ownership')
        require(stat.S_ISDIR(info.st_mode) and info.st_uid in (0,os.geteuid()) and
                not info.st_mode&0o7022,'ownership')


def socket_path(state):
    path=Path(state)/'control.sock'
    require(len(os.fsencode(path))<=100,'protocol')
    return path


def validate_client_path(state):
    root=Path(state)
    nofollow_parents(root)
    require(root.parent.lstat().st_uid==os.geteuid(),'ownership')
    info=root.lstat()
    require(info.st_uid==os.geteuid() and stat.S_IMODE(info.st_mode)==0o700,'ownership')
    path=socket_path(root);info=path.lstat()
    require(stat.S_ISSOCK(info.st_mode) and info.st_uid==os.geteuid() and
            stat.S_IMODE(info.st_mode)==0o600,'ownership')
    return path


def metadata(info):
    return (info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_nlink,
            info.st_size,info.st_mtime_ns,info.st_ctime_ns)


def client_snapshot(root,path):
    rootinfo=Path(root).lstat();info=path.lstat()
    return (rootinfo.st_dev,rootinfo.st_ino,info.st_dev,info.st_ino)


def read_private(path, limit=4096):
    nofollow_parents(path.parent)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        info=os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid==os.geteuid() and
            info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600 and
            0<info.st_size<=limit,'ownership')
        value=os.read(fd,limit+1)
        after=os.fstat(fd)
        require(len(value)==info.st_size and metadata(info)==metadata(after) and
                metadata(path.lstat())==metadata(after),'ownership')
        return value
    finally:os.close(fd)


def verified_binary(path):
    path=Path(path)
    nofollow_parents(path.parent)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        info=os.fstat(fd);artifact=pin()['artifact']
        require(stat.S_ISREG(info.st_mode) and info.st_uid==os.geteuid() and
            info.st_nlink==1 and not info.st_mode&0o7022 and
            info.st_mode&0o111 and info.st_size==artifact['bytes'],'pin')
        digest=hashlib.sha256()
        while chunk:=os.read(fd,1024*1024):digest.update(chunk)
        require(digest.hexdigest()==artifact['sha256'] and metadata(os.fstat(fd))==metadata(info) and
            metadata(path.lstat())==metadata(info),'pin')
    finally:os.close(fd)
    return path


def boot_id():
    with open('/proc/sys/kernel/random/boot_id','rb') as stream:value=stream.read(38)
    require(re.fullmatch(b'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n',value),'workflow')
    return value.decode().strip()


def pending_deadline(record):
    require(record['phase']=='waiting','workflow')
    mono,wall=time.monotonic(),time.time()
    dm,dw=mono-record['created_monotonic'],wall-record['created_at']
    require(boot_id()==record['boot_id'] and dm>=0 and dw>=0 and
        abs(dm-dw)<=2 and max(dm,dw)<270,'workflow')
    return mono+300-max(dm,dw)


def project_row(value):
    require(type(value) is dict and set(value)=={'job','row_count'},'workload')
    row=value['job'];count=value['row_count']
    require(type(count) is int and count==1 and type(row) is dict and
        set(row)=={'id','payload','callback_count','step_nonce','completed'},'workload')
    require(type(row['id']) is str and ID.fullmatch(row['id']) and
        type(row['payload']) is str and len(row['payload'].encode('utf-16-le'))//2<=128 and
        type(row['callback_count']) is int and row['callback_count'] in (0,1) and
        type(row['completed']) is int and row['completed'] in (0,1),'workload')
    nonce=row['step_nonce']
    require((row['callback_count']==0 and nonce is None and row['completed']==0) or
            (row['callback_count']==1 and type(nonce) is str and bool(nonce)),'workload')
    require(nonce is None or (type(nonce) is str and 0<len(nonce)<=256),'workload')
    return dict(job=dict(id=row['id'],payload=row['payload'],
        callback_count=row['callback_count'],
        nonce_sha256=hashlib.sha256(nonce.encode()).hexdigest() if nonce is not None else None,
        completed=row['completed']),row_count=count)


@contextmanager
def cold_locks(scope, *, deleting=False):
    """Open only known nofollow lock paths under the verified scope tree."""
    held=[]
    try:
        scope.check_owner()
        root=os.open(scope.path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        held.append(root)
        rootinfo=os.fstat(root)
        require(dict(device=rootinfo.st_dev,inode=rootinfo.st_ino)==scope.identity,'ownership')
        for relative in LOCK_PATHS:
            current=os.dup(root)
            try:
                for part in relative.split('/')[:-1]:
                    nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=current)
                    os.close(current);current=nxt
                    info=os.fstat(current)
                    require(info.st_uid==os.geteuid() and not stat.S_IMODE(info.st_mode)&0o022,'ownership')
                fd=os.open(relative.split('/')[-1],os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=current)
                held.append(fd);info=os.fstat(fd)
                require(stat.S_ISREG(info.st_mode) and info.st_uid==os.geteuid() and
                    info.st_nlink==1 and not stat.S_IMODE(info.st_mode)&0o022,'ownership')
                try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError:raise TrialError('busy') from None
            finally:os.close(current)
        scope.check_owner()
        yield
        if not deleting:scope.check_owner()
    finally:
        for fd in reversed(held):os.close(fd)


class BudgetHTTP:
    def __init__(self,owner,transport):self.owner,self.transport=owner,transport
    def request(self,method,path,body=None,content_type='application/json',host=None,**kwargs):
        owner=self.owner
        deadline=min(owner.deadline,time.monotonic()+20)
        require(time.monotonic()<deadline,'deadline')
        if method=='GET':
            require(owner.gets<64,'deadline');owner.gets+=1
        # Historical LocalHTTP intentionally supports only an expected GET404.
        # For the bounded missing-row probe distinguish that exact schema from
        # successful GET200 without a second request or copying raw HTTP errors.
        missing=kwargs.pop('expected_status',None)==404
        try:
            result=self.transport.request(method,path,body,content_type,host,deadline=deadline,**kwargs)
        except lab.LabError as exc:
            if missing and str(exc).startswith('HTTP 404 for GET '+path+': '):
                require(owner.gets<64,'deadline');owner.gets+=1
                result=self.transport.request(method,path,body,content_type,host,deadline=deadline,expected_status=404)
            else:raise TrialError('workload' if host else 'runtime') from None
        require(time.monotonic()<deadline,'deadline')
        return result
    def v4(self,method,path,body=None,content_type='application/json'):
        envelope=self.request(method,'/client/v4'+path,body,content_type)
        require(type(envelope) is dict and envelope.get('success') is True,'runtime')
        return envelope.get('result')


class TrialOwner:
    def __init__(self,state,manifest,scope,supervision=None):
        self.state,self.manifest,self.scope=state,manifest,scope
        self.supervision=supervision
        self.process=None;self.api=None;self.worker=None;self.host=None
        self.poisoned=False;self.gets=0;self.deadline=float('inf');self.submissions=0

    @contextmanager
    def operation(self,seconds=90,limit=None):
        old=self.deadline
        self.deadline=min(time.monotonic()+seconds,limit or float('inf'))
        self.gets=0
        require(self.deadline>time.monotonic(),'deadline')
        try:
            with lab.m3_deadline(self.deadline-time.monotonic(),'M7 operation'):
                yield
        finally:self.deadline=old

    def live(self):
        self.state.check();self.scope.check_owner()
        require(self.process is not None and self.process.process.poll() is None and
            not self.process.observation_error,'runtime')
        self.process.snapshot()
        require(not self.process.observation_error,'ownership')

    def save(self):
        try:
            with lab.m3_deadline(10,'M7 manifest'):self.state.save(self.manifest)
        except BaseException:
            self.poisoned=True
            raise

    def start(self,binary):
        self.manifest['clean']=False;self.save()
        # Defer owner cancellation during transfer from Popen into the owner.
        with lab.defer_owner_signals():
            self.process=lab.Process([str(binary),'--no-update-check','run'])
        health_client=BudgetHTTP(self,lab.LocalHTTP(self.manifest['port']))
        # Avoid assuming a particular health JSON, just require successful GET.
        def probe():
            self.live()
            if not (self.scope.path/'run/control.sock').is_socket():return False
            try:health_client.request('GET','/health/live');return True
            except (OSError,http.client.HTTPException,TrialError):return False
        lab.poll(probe,bool,min(60,max(.001,self.deadline-time.monotonic())),'M7 readiness')

    def wait_instance(self,binary):
        """Shared daemon health precedes asynchronous retained-instance startup."""
        limit=min(self.deadline,time.monotonic()+60)
        identity=self.manifest['identity']
        def probe():
            self.live()
            remaining=limit-time.monotonic()
            require(remaining>0,'deadline')
            result=json.loads(lab.command([str(binary),'--no-update-check',
                'instances','--json'],timeout=min(20,remaining)))
            self.live()
            require(type(result) is dict and type(result.get('instances')) is list and
                len(result['instances'])<=1,'deployment')
            records=result['instances']
            if not records:return False
            record=records[0]
            require(type(record) is dict and record.get('name')==lab.INSTANCE and
                type(record.get('instance_id')) is str and
                record['instance_id']==identity['instance_id'] and
                type(record.get('state')) is str and len(record['state'])<=32,'deployment')
            require(record['state']!='failed','runtime')
            return record['state']=='running'
        lab.poll(probe,bool,max(.001,limit-time.monotonic()),'M7 retained instance')

    def resume(self,binary):
        self.start(binary)
        self.wait_instance(binary)
        self.connect()
        self.verify_identity(binary)

    def connect(self):
        data=self.scope.path/'instances'/lab.INSTANCE/'data'
        token=read_private(data/'keys/deployer.token').decode('ascii').strip()
        require(bool(token) and len(token)<=4096,'ownership')
        self.api=BudgetHTTP(self,lab.LocalHTTP(self.manifest['port'],token))
        self.worker=BudgetHTTP(self,lab.LocalHTTP(self.manifest['port']))
        account=self.manifest['identity']['account_id']
        endpoints=self.api.v4('GET','/accounts/'+account+'/open-compute/workers/'+lab.WORKER+'/endpoints')
        records=[r for r in endpoints if type(r) is dict and r.get('kind')=='local_origin']
        require(len(records)==1,'deployment')
        self.host=lab.worker_host(records[0],self.manifest['port'])

    def verify_identity(self,binary):
        identity=self.manifest['identity'];self.live()
        records=json.loads(lab.command([str(binary),'--no-update-check','instances','--json'],timeout=20))['instances']
        require(len(records)==1 and records[0]['name']==lab.INSTANCE and
            records[0]['state']=='running' and records[0]['instance_id']==identity['instance_id'],'deployment')
        accounts=self.api.v4('GET','/accounts')
        require(len(accounts)==1 and accounts[0]['id']==identity['account_id'],'deployment')
        database=self.api.v4('GET','/accounts/'+identity['account_id']+'/d1/database/'+identity['database_id'])
        require(type(database) is dict and len(database)<=32 and
            type(database.get('uuid')) is str and database['uuid']==identity['database_id'],'deployment')
        try:
            encoded=json.dumps(database,allow_nan=False,separators=(',',':')).encode('utf-8')
        except (TypeError,ValueError,UnicodeError,RecursionError):
            raise TrialError('deployment') from None
        require(len(encoded)<=16384,'deployment')
        deployment=lab.deployment_observation(self.api,'/accounts/'+identity['account_id'],identity['database_id'],with_r2=False)
        require(deployment==identity['deployment'],'deployment')
        require(self.worker.request('GET','/health',host=self.host)==dict(fixture='open-compute-m1',ok=True),'deployment')
        if self.manifest['workflow'] is not None:
            if self.manifest['workflow']['phase']=='waiting':pending_deadline(self.manifest['workflow'])
            self.workflow_status()

    def read(self,job_id):
        value=self.worker.request('GET','/jobs/'+job_id,host=self.host,expected_status=404)
        if value=={'job':None,'row_count':0}:raise TrialError('not_found')
        result=project_row(value);require(result['job']['id']==job_id,'workload')
        return result

    def submit(self,job_id,payload):
        require(type(payload) is str and len(payload.encode('utf-16-le'))//2<=128,'schema')
        require(self.submissions<32,'workload');self.submissions+=1
        existing=self.worker.request('GET','/jobs/'+job_id,host=self.host,expected_status=404)
        if existing!={'job':None,'row_count':0}:
            before=project_row(existing)
            require(before['job']['id']==job_id,'workload')
            require(before['job']['payload']==payload,'conflict')
        # No automatic retry: response loss may follow a committed insert.
        value=self.worker.request('POST','/jobs',dict(id=job_id,payload=payload),host=self.host)
        result=project_row(value)
        require(result['job']['id']==job_id and result['job']['payload']==payload,'workload')
        return result

    def flow_path(self,w):
        return '/accounts/'+self.manifest['identity']['account_id']+'/workflows/'+lab.FLOW+'/instances/'+w['id']

    def workflow_status(self):
        w=self.manifest['workflow']
        if w is None:return None
        require(w['phase']!='reserved','dirty')
        value=self.api.v4('GET',self.flow_path(w))
        require(type(value) is dict and value.get('status') in ('waiting','complete','errored','terminated','paused'),'workflow')
        row=self.read(w['job_id'])['job']
        require(row['callback_count']==1 and row['nonce_sha256']==w['nonce_sha256'],'workflow')
        if w['phase']=='complete':
            require(value['status']=='complete' and row['completed']==1,'workflow')
            require(value.get('output')==dict(jobId=w['job_id'],nonce=self._nonce(w['job_id'])),'workflow')
        elif value['status']=='waiting':require(row['completed']==0,'workflow')
        return dict(id=w['id'],job_id=w['job_id'],status=value['status'],
            nonce_sha256=w['nonce_sha256'],completed=bool(row['completed']))

    def _nonce(self,job_id):
        value=self.worker.request('GET','/jobs/'+job_id,host=self.host)
        project_row(value)
        require(value['job']['id']==job_id,'workflow')
        return value['job']['step_nonce']

    def workflow(self,flow_id,job_id):
        require(self.manifest['workflow'] is None,'workflow')
        row=self.read(job_id)['job']
        require(row['callback_count']==0 and row['completed']==0 and row['nonce_sha256'] is None,'workflow')
        w=dict(id=flow_id,job_id=job_id,created_at=time.time(),boot_id=boot_id(),
            created_monotonic=time.monotonic(),phase='reserved',nonce_sha256=None,completed=False)
        self.manifest['workflow']=w
        # Reservation acknowledgement before POST is mandatory. Every uncertain
        # mutation/save makes the session permanently dirty, even if stop succeeds.
        self.poisoned=True
        self.save()
        created=self.api.v4('POST',self.flow_path(w).rsplit('/',1)[0],
            dict(instance_id=flow_id,params=dict(jobId=job_id)))
        require(created['id']==flow_id,'workflow')
        waiting=self.wait_flow(w,'waiting')
        row=self.read(job_id)['job']
        require(row['callback_count']==1 and row['completed']==0 and row['nonce_sha256'] is not None,'workflow')
        require(any(s.get('name')=='instrumented-callback' and s.get('success') is True
            for s in waiting.get('steps',[])),'workflow')
        w.update(phase='waiting',nonce_sha256=row['nonce_sha256'])
        self.save();self.poisoned=False
        return dict(id=flow_id,job_id=job_id,status='waiting',callback_count=1,nonce_sha256=w['nonce_sha256'])

    def wait_flow(self,w,target,deadline=None):
        limit=min(self.deadline,deadline or float('inf'),time.monotonic()+60)
        def probe():
            require(time.monotonic()<limit,'deadline')
            value=self.api.v4('GET',self.flow_path(w))
            require(type(value) is dict and value.get('status') not in ('errored','terminated','paused','rollingBack','waitingForPause'),'workflow')
            if target=='waiting':require(value.get('status')!='complete','workflow')
            return value
        return lab.poll(probe,lambda v:v.get('status')==target,max(.001,limit-time.monotonic()),'M7 Workflow')

    def approve(self):
        w=self.manifest['workflow'];require(w is not None and w['phase']=='waiting','workflow')
        deadline=pending_deadline(w)
        self.poisoned=True
        old=self.deadline;self.deadline=min(old,deadline)
        try:
            row=self.read(w['job_id'])['job']
            require(row['callback_count']==1 and row['nonce_sha256']==w['nonce_sha256'] and row['completed']==0,'workflow')
            answer=self.api.v4('POST',self.flow_path(w)+'/events/approval',dict(approved=True))
            require(type(answer) is dict and answer.get('instanceId')==w['id'],'workflow')
            complete=self.wait_flow(w,'complete',deadline)
            row=self.read(w['job_id'])['job'];nonce=self._nonce(w['job_id'])
            require(row['callback_count']==1 and row['nonce_sha256']==w['nonce_sha256'] and row['completed']==1 and
                complete.get('output')==dict(jobId=w['job_id'],nonce=nonce),'workflow')
            w.update(phase='complete',completed=True);self.save();self.poisoned=False
            return dict(id=w['id'],job_id=w['job_id'],status='complete',callback_count=1,
                nonce_sha256=w['nonce_sha256'],completed=1)
        finally:self.deadline=old

    def status(self):
        self.live();identity=self.manifest['identity']
        require(self.worker.request('GET','/health',host=self.host)==dict(fixture='open-compute-m1',ok=True),'runtime')
        return dict(running=True,daemon={k:self.process.identity[k] for k in ('pid','start_ticks')},
            instance_id=identity['instance_id'],account_id=identity['account_id'],
            database_id=identity['database_id'],deployment_id=identity['deployment']['deployment_id'],
            version_id=identity['deployment']['version_id'],worker_healthy=True,workflow=self.workflow_status())

    def shutdown(self):
        # Pre-existing exit (even status0) cannot masquerade as commanded stop.
        was_running=self.process is not None and self.process.process.poll() is None
        require(self.process is not None,'shutdown')
        shutdown=self.process.stop()
        require(was_running and shutdown['was_running'] is True and shutdown['signal']=='SIGTERM' and
            shutdown['forced'] is False and type(shutdown['exit_code']) is int and shutdown['exit_code']==0 and
            shutdown['all_owned_exited'] is True and not shutdown['observation_error'],'shutdown')
        self.scope.check_owner()
        require(not self.poisoned and self.manifest['identity'] is not None and
            (self.manifest['workflow'] is None or self.manifest['workflow']['phase']!='reserved'),'dirty')
        self.manifest['clean']=self.supervision is None
        try:self.save()
        except BaseException:
            self.manifest['clean']=False
            raise
        if self.supervision is not None:
            self.supervision.prepare_clean(self.state)
        return {k:shutdown[k] for k in ('was_running','signal','forced','exit_code','all_owned_exited')}


def clean_manifest(state):
    value=state.load()
    require(value['uid']==os.geteuid() and os.geteuid()!=0 and os.getuid()==os.geteuid(),'ownership')
    require(value['clean'] is True and value['identity'] is not None and
        (value['workflow'] is None or value['workflow']['phase']!='reserved'),'dirty')
    require(platform.system()=='Linux' and platform.machine()=='x86_64' and
        lab.proc_namespace_supported(),'preflight')
    require(not any(k.startswith('OPEN_COMPUTE_TEST_') for k in os.environ),'preflight')
    require(value['fixture_sha256']==fixture_hash() and
        value['binary']['sha256']==pin()['artifact']['sha256'],'pin')
    return value


@contextmanager
def owner_signals():
    stopped=[]
    previous={sig:signal.getsignal(sig) for sig in (signal.SIGINT,signal.SIGTERM)}
    def request_stop(sig,frame):stopped.append(sig)
    try:
        for sig in previous:signal.signal(sig,request_stop)
        yield stopped
    finally:
        for sig,handler in previous.items():signal.signal(sig,handler)


def bootstrap(owner,binary):
    scope=owner.scope
    config=scope.path/'instances'/lab.INSTANCE/'compute.toml'
    data=config.parent/'data'
    lab.command([str(binary),'--no-update-check','--config',str(config),'instance','setup',
        '--name',lab.INSTANCE,'--data-dir',str(data),'--yes'],timeout=90)
    records=json.loads(lab.command([str(binary),'--no-update-check','instances','--json'],timeout=20))['instances']
    require(len(records)==1 and records[0]['name']==lab.INSTANCE and records[0]['state']=='running','bootstrap')
    token=read_private(data/'keys/deployer.token').decode('ascii').strip()
    owner.api=BudgetHTTP(owner,lab.LocalHTTP(owner.manifest['port'],token))
    accounts=owner.api.v4('GET','/accounts')
    require(type(accounts) is list and len(accounts)==1,'bootstrap')
    account=accounts[0]['id'];require(type(account) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,100}',account),'schema')
    base='/accounts/'+account
    database=owner.api.v4('POST',base+'/d1/database',dict(name='lab-db'))
    db=database['uuid'];require(type(db) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,100}',db),'schema')
    owner.api.v4('POST',base+'/d1/database/'+db+'/query',dict(sql=SCHEMA_SQL,params=[]))
    body,kind=lab.multipart(db,with_r2=False)
    owner.api.v4('PUT',base+'/workers/scripts/'+lab.WORKER,body,kind)
    deployment=lab.deployment_observation(owner.api,base,db,with_r2=False)
    owner.manifest['identity']=dict(instance_id=records[0]['instance_id'],account_id=account,database_id=db,deployment=deployment)
    owner.connect()
    require(owner.worker.request('GET','/health',host=owner.host)==dict(fixture='open-compute-m1',ok=True),'deployment')
    owner.save()


def run_init(args):
    statepath=Path(args.state);cache=Path(args.cache).absolute()
    socket_path(statepath)
    nofollow_parents(cache.parent)
    if os.path.lexists(cache):
        nofollow_parents(cache)
        cacheinfo=cache.lstat()
        require(cacheinfo.st_uid==os.geteuid() and not stat.S_IMODE(cacheinfo.st_mode)&0o022,'ownership')
    require(statepath.is_absolute() and not any(statepath.is_relative_to(p) or p.is_relative_to(statepath)
        for p in (scope_path(),cache)),'ownership')
    # Existing scope is rejected by preflight, never adopted even if state is new.
    with StateDirectory(statepath,create=True) as state,owner_signals() as interrupted:
        path=lab.preflight(args.port)
        require(not cache.is_relative_to(path) and not path.is_relative_to(cache),'ownership')
        lock=pin();binary=lab.download_binary(cache,lock['artifact'],secrets.token_hex(8))
        binary=verified_binary(binary)
        require(lab.command([str(binary),'--version']).strip()=='ocd '+lock['release'].removeprefix('v'),'pin')
        owner=None;problem=None
        try:
            with lab.m3_deadline(300,'M7 initialization'):
                require(not interrupted,'interrupted')
                scope=lab.OwnedScope(path,args.port,bounded_owner=True)
                scope.create()
                manifest=dict(schema_version=1,uid=os.geteuid(),trial_id=secrets.token_hex(16),
                    scope=dict(**scope.identity,marker=scope.marker),port=args.port,
                    binary=dict(path=str(binary),sha256=lock['artifact']['sha256']),
                    fixture_sha256=fixture_hash(),identity=None,clean=False,workflow=None)
                state.save(manifest)
                owner=TrialOwner(state,manifest,scope,getattr(args,'supervision',None))
                with owner.operation(300):
                    require(not interrupted,'interrupted')
                    owner.start(binary);require(not interrupted,'interrupted')
                    bootstrap(owner,binary);require(not interrupted,'interrupted')
        except BaseException as exc:
            problem=exc
            if owner is not None:owner.poisoned=True
        finally:
            if owner is not None and owner.process is not None:
                try:
                    with lab.m3_deadline(150,'M7 final cleanup') as cleanup_end:
                        if owner.supervision is not None:owner.supervision.begin_cleanup(cleanup_end)
                        owner.shutdown()
                except BaseException as exc:
                    if problem is None:problem=exc
        if problem is not None:raise problem
        return success('init',dict(initialized=True))


def check_peer(connection):
    require(hasattr(socket,'SO_PEERCRED'),'ownership')
    raw=connection.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,struct.calcsize('3i'))
    _,uid,_=struct.unpack('3i',raw)
    require(uid==os.geteuid(),'ownership')


def receive(connection,deadline):
    data=bytearray()
    while True:
        remaining=deadline-time.monotonic();require(remaining>0,'deadline')
        connection.settimeout(remaining)
        chunk=connection.recv(min(4096,16385-len(data)))
        if not chunk:return decode_message(bytes(data))
        data.extend(chunk)
        require(len(data)<=16384,'protocol')
        # Do not accept a valid first frame until EOF: later chunks may contain
        # an extra frame. Finite senders half-close their write side.
        if b'\n' in data and (data[-1:]!=b'\n' or data.count(b'\n')!=1):
            raise TrialError('protocol')


def send(connection,value,deadline):
    remaining=deadline-time.monotonic();require(remaining>0,'deadline')
    connection.settimeout(remaining);connection.sendall(encode_message(value))
    connection.shutdown(socket.SHUT_WR)


def dispatch(owner,request):
    command,args=request['command'],request['args']
    if command=='status':return owner.status()
    if command=='read':return owner.read(args['id'])
    if command=='submit':return owner.submit(args['id'],args['payload'])
    if command=='workflow':return owner.workflow(args['id'],args['job_id'])
    if command=='approve':return owner.approve()
    raise TrialError('protocol')


def run_serve(args):
    statepath=Path(args.state);control=socket_path(statepath)
    require(type(args.seconds) is int and 1<=args.seconds<=86400,'schema')
    with StateDirectory(statepath) as state,owner_signals() as interrupted:
        manifest=clean_manifest(state);scope=validate_scope(manifest)
        require(not os.path.lexists(control),'ownership')
        if manifest['workflow'] is not None and manifest['workflow']['phase']=='waiting':pending_deadline(manifest['workflow'])
        binary=verified_binary(manifest['binary']['path'])
        with lab.m3_deadline(10,'M7 cold locks'):
            with cold_locks(scope):pass
        owner=TrialOwner(state,manifest,scope,getattr(args,'supervision',None))
        server=None;socket_identity=None;stop_client=None;stop_response=None;problem=None
        lease=None
        try:
            with owner.operation(120):
                require(not interrupted,'interrupted');owner.resume(binary)
                require(not interrupted,'interrupted')
            state.check()
            with lab.defer_owner_signals():
                server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
                server.bind(str(control))
                info=control.lstat();socket_identity=(info.st_dev,info.st_ino)
                os.chmod(control,0o600)
            server.listen(1);server.settimeout(.25)
            lease=time.monotonic()+args.seconds
            emit(success('serve',dict(ready=True)))
            while not interrupted and time.monotonic()<lease:
                owner.live()
                try:connection,_=server.accept()
                except socket.timeout:continue
                command='status'
                try:
                    check_peer(connection)
                    request=receive(connection,min(time.monotonic()+5,lease))
                    command=request['command']
                    require(command in ('status','submit','read','workflow','approve','stop'),'protocol')
                    if command=='stop':
                        stop_client=connection;break
                    with owner.operation(90,lease):
                        require(not interrupted,'interrupted');owner.live();data=dispatch(owner,request)
                    send(connection,success(command,data),time.monotonic()+5)
                except Exception as exc:
                    try:send(connection,failure(command,exc),time.monotonic()+5)
                    except Exception:pass
                    if owner.poisoned:raise TrialError('dirty') from None
                finally:
                    if connection is not stop_client:connection.close()
            require(not owner.poisoned,'dirty')
        except BaseException as exc:
            problem=exc
            # Any owner-level uncertainty must never regain clean authority.
            owner.poisoned=True
        finally:
            try:
                if owner.process is not None:
                    with lab.m3_deadline(150,'M7 final cleanup') as cleanup_end:
                        if owner.supervision is not None:owner.supervision.begin_cleanup(cleanup_end)
                        stop_response=owner.shutdown()
                else:raise TrialError('shutdown')
            except BaseException as exc:
                if problem is None:problem=exc
            if server is not None:server.close()
            if socket_identity is not None:
                try:
                    state.check();info=control.lstat()
                    require((info.st_dev,info.st_ino)==socket_identity and stat.S_ISSOCK(info.st_mode),'ownership')
                    control.unlink()
                except BaseException as exc:
                    if problem is None:problem=exc
            if stop_client is not None:
                try:
                    send(stop_client,failure('stop',problem) if problem else success('stop',stop_response),time.monotonic()+5)
                except Exception as exc:
                    if problem is None:problem=exc
                finally:stop_client.close()
        if problem is not None:raise problem
        return success('serve',dict(stopped=True,clean=True))


def run_destroy(args):
    with StateDirectory(Path(args.state)) as state:
        manifest=clean_manifest(state)
        require(not os.path.lexists(socket_path(state.path)),'ownership')
        scope=validate_scope(manifest)
        with lab.m3_deadline(30,'M7 destroy'):
            with cold_locks(scope,deleting=True):
                state.check();scope.remove(processes_stopped=True)
                require(not os.path.lexists(scope.path),'ownership')
        return success('destroy',dict(destroyed=True))


def run_client(args):
    command=args.command
    values={}
    if command in ('read','submit','workflow'):values['id']=args.id
    if command=='submit':values['payload']=args.payload
    if command=='workflow':values['job_id']=args.job_id
    request=dict(schema_version=1,command=command,args=values)
    # Validate before connection as well as on owner side.
    encode_message(request)
    path=validate_client_path(args.state)
    identity=client_snapshot(args.state,path)
    with lab.m3_deadline(160 if command=='stop' else 100,'M7 client'):
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as connection:
            connection.settimeout(5);connection.connect(str(path));check_peer(connection)
            # Root/socket validation repeated after connect to detect replacement.
            require(validate_client_path(args.state)==path and client_snapshot(args.state,path)==identity,'ownership')
            send(connection,request,time.monotonic()+5)
            response=receive(connection,time.monotonic()+(155 if command=='stop' else 95))
            require(response.get('command')==command and 'result' in response,'protocol')
            return response


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    for name in ('init','serve','status','submit','read','workflow','approve','stop','destroy'):
        item=sub.add_parser(name);item.add_argument('--state',required=True)
        item.add_argument('--supervision-fd',type=int,help=argparse.SUPPRESS)
        item.add_argument('--supervision-deadline-ns',type=int,help=argparse.SUPPRESS)
        if name=='init':
            item.add_argument('--port',type=int,default=8787)
            item.add_argument('--cache',default=str(HERE/'.lab-cache'))
        if name=='serve':item.add_argument('--seconds',type=int,default=3600)
        if name in ('read','submit','workflow'):item.add_argument('--id',required=True)
        if name=='submit':item.add_argument('--payload',required=True)
        if name=='workflow':item.add_argument('--job-id',required=True)
    args=parser.parse_args(argv)
    supervision=None
    try:
        if args.supervision_fd is not None or args.supervision_deadline_ns is not None:
            from trial_supervision import OwnerControl
            supervision=OwnerControl(args.supervision_fd,args.supervision_deadline_ns)
            args.supervision=supervision
        operation=dict(init=run_init,serve=run_serve,destroy=run_destroy).get(args.command,run_client)
        response=operation(args)
    except BaseException as exc:
        if isinstance(exc,(KeyboardInterrupt,SystemExit)):exc=TrialError('interrupted')
        response=failure(args.command,exc)
    try:
        if supervision is not None:
            # Validate the ordinary result before constructing the private
            # terminal clean_pending variant. It is never emitted as clean=true.
            encode_message(response)
            response=supervision.finish(response)
            raw=(json.dumps(response,separators=(',',':'),allow_nan=False)+'\n').encode()
            require(len(raw)<=16384,'protocol')
            sys.stdout.buffer.write(raw);sys.stdout.buffer.flush()
        else:
            emit(response)
        return 0 if response['result']=='passed' else 1
    except BaseException as exc:
        if supervision is not None:supervision.abort(getattr(exc,'reason','command'))
        return 1
    finally:
        if supervision is not None:supervision.close()


if __name__=='__main__':sys.exit(main())

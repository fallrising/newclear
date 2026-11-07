"""Explicit isolated remote qualification library; never provisions or revokes resources.

Trusted private operator calls run_case(profile, evidence, after_fault=hook).
All provider administration stays in separately reviewed private operator receipts.
"""
from contextlib import closing
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
import uuid

ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
probe=load('remote_probe',ROOT/'tools/live_probe.py')
prep=load('remote_preparation',ROOT/'tools/prepare_deployment.py')
r=probe._protocol

def require(condition):
    if not condition:raise r.ProtocolError('remote qualification invariant failed')

class RemoteClient:
    def __init__(self,base_url,deadline_seconds=6):
        r.Config.from_dict(dict(base_url=base_url,audience='check',credential_id='check',generation=1,secret_hex='ab'*32,journal_path='unused',workspace_id='check',resource_ref={'resource_id':'check','generation':1},recipe_ref={'recipe_id':'node-health','version':'1.0.0','digest':'sha256:'+'a'*64}))
        require(0<deadline_seconds<=10)
        self.url=urlsplit(base_url);self.deadline_seconds=deadline_seconds
    def send(self,method,path,body,headers):
        require(path in ('/api/bootstrap','/api/commands','/api/runner/claim','/api/runner/report') or re.fullmatch(r'/api/commands/[A-Za-z0-9_-]{1,128}(/artifact)?',path))
        require(method in ('GET','POST') and len(body)<=r.MAX_JSON)
        # Direct TLS verifies certificates, ignores ambient proxies and never follows redirects.
        conn=http.client.HTTPSConnection(self.url.hostname,self.url.port,timeout=5)
        conn.auto_open=False # Only the explicit connect below is allowed; timeout cannot reconnect.
        done=threading.Event();cancelled=threading.Event();result=[];connected=[]
        def perform():
            try:
                if cancelled.is_set():return
                conn.connect()
                if conn.sock is not None:connected.append(conn.sock)
                if cancelled.is_set():return  # DNS/connect finishing after the deadline cannot send.
                outgoing=dict(headers);outgoing['User-Agent']='cloud-lab-m1/1.0'
                conn.request(method,path,body if method=='POST' else None,outgoing)
                with conn.getresponse() as response:
                    raw=response.read(r.MAX_JSON+1);require(len(raw)<=r.MAX_JSON)
                    result.append((response.status,raw))
            except Exception:
                pass # Stable diagnostic only; never disclose request headers or provider bodies.
            finally:
                conn.close();done.set()
        thread=threading.Thread(target=perform,daemon=True);thread.start()
        if not done.wait(self.deadline_seconds):
            cancelled.set()
            try:
                if connected:connected[0].shutdown(socket.SHUT_RDWR)
            except OSError:pass
            # The worker owns conn.close(): HTTPResponse.close can wait on its read lock.
            # Shutdown the captured socket even if getresponse cleared conn.sock.
            raise r.ProtocolError('remote request deadline exceeded; outcome requires reconciliation')
        require(len(result)==1);return result[0]

class FaultRelay:
    """One local listener, fixed runner routes, bounded requests and bodies; no logs."""
    def __init__(self,forward,drop):
        require(drop in (None,'before','after'))
        self.forward,self.drop=forward,drop
        self.error=None;self.assignments=[];self.reports=[];self.requests=0
        self.connections=set();self.connection_lock=threading.Lock()
    def __enter__(self):
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def setup(self):
                super().setup();self.connection.settimeout(6)
                with owner.connection_lock:owner.connections.add(self.connection)
            def finish(self):
                try:super().finish()
                finally:
                    with owner.connection_lock:owner.connections.discard(self.connection)
            def do_POST(self):
                try:
                    owner.requests+=1
                    if self.path not in ('/api/runner/claim','/api/runner/report') or owner.requests>8:
                        self.send_error(400);return
                    size=int(self.headers.get('Content-Length','-1'));require(0<=size<=r.MAX_JSON)
                    body=self.rfile.read(size);require(len(body)==size)
                    report=self.path.endswith('/report')
                    if report:
                        owner.reports.append(r.strict_json(body))
                        if owner.drop=='before':owner.drop=None;self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
                    headers={k:v for k,v in self.headers.items() if k.lower() not in ('host','connection','content-length')}
                    status,raw=owner.forward(self.path,body,headers)
                    require(len(raw)<=r.MAX_JSON)
                    if not report and status==200:owner.assignments.append(r.strict_json(raw)['assignment'])
                    if report and owner.drop=='after':
                        require(status==200);owner.drop=None;self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
                    self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
                except Exception:
                    owner.error='RELAY_FAILED'
                    self.close_connection=True
            def log_message(self,*args):pass
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.server.daemon_threads=True
        self.server.block_on_close=False
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.port=self.server.server_port;return self
    def __exit__(self,*args):
        self.server.shutdown()
        with self.connection_lock:connections=list(self.connections)
        for connection in connections:
            try:connection.shutdown(socket.SHUT_RDWR)
            except OSError:pass
            connection.close()
        self.server.server_close();self.thread.join(timeout=1)

def marker_count(raw):
    require(isinstance(raw,bytes) and (raw==b'' or re.fullmatch(rb'(collect\n)+',raw)))
    return raw.count(b'\n')

def snapshot(path):
    with closing(sqlite3.connect(Path(path).as_uri()+'?mode=ro',uri=True)) as db:
        return [[v.decode() if isinstance(v,bytes) else v for v in row] for row in db.execute('SELECT * FROM executions ORDER BY command_id')]

def validate_profile(profile):
    r.fields(profile,'schema_version isolated isolation_id mode expected_commands observer submitter runner reconciler')
    require(profile['schema_version']=='cloudlab.remote-recovery.v1' and profile['isolated'] is True)
    require(profile['mode'] in ('before','after','started'))
    require(type(profile['expected_commands']) is int and profile['expected_commands'] in (0,1,2))
    configs=[profile[role] for role in ('observer','submitter','runner','reconciler')]
    for config in configs:r.Config.from_dict(config)
    require(profile['isolation_id'].startswith('recovery-') and configs[0]['workspace_id']==profile['isolation_id'])
    for config in configs[1:]:
        require(all(config[k]==configs[0][k] for k in ('base_url','audience','workspace_id','resource_ref','recipe_ref')))
    require(profile['runner']['credential_id']!=profile['reconciler']['credential_id'])
    return profile

def run_case(profile,evidence,after_fault=None):
    """One explicit case, no resume/retry/renewal. New private evidence directory required."""
    validate_profile(profile)
    output=prep.canonical_path(evidence);prep.require_outside_checkout(output)
    parent=prep.open_directory(output.parent)
    try:
        metadata=os.fstat(parent)
        require(metadata.st_uid==os.geteuid() and not metadata.st_mode & 0o022)
        os.mkdir(output.name,mode=0o700,dir_fd=parent)
    finally:os.close(parent)
    def save(name,value):probe.private_write(output,name,r.encode(value)+b'\n')
    client=RemoteClient(profile['observer']['base_url']);children=[]
    def request(role,path,body=None):
        raw=b'' if body is None else r.encode(body);method='GET' if body is None else 'POST'
        return client.send(method,path,raw,probe.sign_headers(profile[role],method,path,raw,time.time()))
    def get(role,path):
        status,raw=request(role,path);require(status==200);return r.strict_json(raw)
    try:
        bootstrap=get('observer','/api/bootstrap')
        require(all(bootstrap[k]==profile['observer'][k] for k in ('workspace_id','resource_ref','recipe_ref')))
        listing=get('observer','/api/commands')['commands']
        require(len(listing)==profile['expected_commands'] and all(c['delivery'] in ('result_recorded','expired_before_dispatch','cancelled_before_dispatch') for c in listing))
        now=time.time();config=profile['submitter'];mode=profile['mode']
        command=dict(schema_version='cloudlab.command.v1',schema_minor=0,workspace_id=config['workspace_id'],resource_ref=config['resource_ref'],recipe_ref=config['recipe_ref'],parameters={'max_sample_age_seconds':60},idempotency_key='rf-'+mode+'-'+uuid.uuid4().hex,not_before=r.utc(now-1),dispatch_deadline=r.utc(now+60),execution_deadline=r.utc(now+120),timeout_seconds=10,output_budget_bytes=16384)
        save('intent.json',{'command':command,'mode':mode})
        status,raw=request('submitter','/api/commands',command);require(status==202)
        admitted=r.strict_json(raw)['command'];require(admitted['command']==command)
        command_id=r.identifier(admitted['command_id']);require(re.fullmatch(r'[A-Za-z0-9_-]{1,128}',command_id))
        save('admitted.json',admitted)
        journal=output/'journal.sqlite';marker=output/'collector.log'
        def count():return marker_count(marker.read_bytes()) if marker.exists() else 0
        def launch(role,port,block=False):
            local=dict(profile[role],base_url=f'http://127.0.0.1:{port}',journal_path=str(journal))
            filename=role+'.json';save(filename,local)
            p=subprocess.Popen([sys.executable,str(ROOT/'tests/fixtures/recovery_runner.py'),'--config',str(output/filename),'--collector-log',str(marker),*(['--block-collector'] if block else [])],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            children.append(p);return p
        def finish(p):
            stdout,stderr=p.communicate(timeout=15);return {'code':p.returncode,'stdout':stdout,'stderr':stderr}
        with FaultRelay(lambda path,body,headers:client.send('POST',path,body,headers),mode if mode!='started' else None) as relay:
            first=launch('runner',relay.port,mode=='started')
            if mode=='started':
                until=time.monotonic()+7
                while count()!=1 and first.poll() is None and time.monotonic()<until:time.sleep(.02)
                require(count()==1 and first.poll() is None)
                started=snapshot(journal);require(started[0][3]=='started' and started[0][4] is None)
                first.kill()
            exited=finish(first);require(exited['code']==(-9 if mode=='started' else 1))
            require(relay.error is None and count()==1 and len(relay.assignments)==1)
            assignment=relay.assignments[-1];require(assignment['command_id']==command_id and assignment['attempt']['mode']=='dispatch')
            before=snapshot(journal);remote_before=get('observer','/api/commands/'+command_id)['command']
            require(remote_before['delivery']==('result_recorded' if mode=='after' else 'dispatching'))
            save('fault.json',{'exit':exited,'journal':before,'command':remote_before,'assignment':assignment})
            if after_fault is not None:after_fault() # Separate private operator authority; never silently retry.
            if mode!='after':
                wait=max(0,r.timestamp(assignment['attempt']['lease_expires_at'])-time.time()+1.1);require(wait<=17);time.sleep(wait)
            prior_reports=len(relay.reports)
            restarted=finish(launch('reconciler',relay.port));require(restarted['code']==0 and relay.error is None)
            after=snapshot(journal);remote=get('observer','/api/commands/'+command_id)['command']
            require(before==after and count()==1 and len(after)==1 and len(relay.assignments)==2)
            require(remote['command']==command and json.loads(after[0][2])==remote['external_ref'])
            require(after[0][1]==hashlib.sha256(r.encode({'command':command,'external_ref':remote['external_ref']})).hexdigest())
            current=relay.assignments[-1]
            if mode=='after':require(current is None and len(relay.reports)==prior_reports and remote==remote_before)
            else:require(current['attempt']['mode']=='reconcile_only' and current['attempt']['fence']==assignment['attempt']['fence']+1)
            if mode=='started':
                require(remote['delivery']=='reconciling' and remote['result'] is None)
                require(relay.reports[-1]==dict(r.UNKNOWN,command_id=command_id,attempt_id=current['attempt']['attempt_id'],fence=current['attempt']['fence']))
            else:
                result=json.loads(after[0][4]);require(after[0][3]=='completed' and remote['delivery']=='result_recorded')
                require(all(result[k]==remote['result'][k] for k in ('owner_outcome','started_at','finished_at')))
                require(remote['result']['validation']['status']=='passed' and remote['result']['artifact_sha256']=='sha256:'+hashlib.sha256(result['artifact'].encode()).hexdigest())
                code,artifact=request('observer','/api/commands/'+command_id+'/artifact');require(code==200 and artifact==result['artifact'].encode())
            save('recovered.json',{'exit':restarted,'journal':after,'command':remote,'assignment':current,'collector_calls':count()})
        summary={'status':'passed','mode':mode,'delivery':remote['delivery'],'collector_calls':1,'journal_unchanged':True,'command_id':command_id}
        save('summary.json',summary);return summary
    except BaseException as error:
        save('failure.json',{'status':'failed','type':type(error).__name__});raise
    finally:
        for child in children:
            if child.poll() is None:child.kill()
            child.communicate(timeout=5)

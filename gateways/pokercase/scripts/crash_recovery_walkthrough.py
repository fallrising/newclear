#!/usr/bin/env python3
"""Three bounded real-gateway crash cuts; launch only after external pin review."""
import argparse
import contextlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from crash_recovery_fixture import Fixture, IMAGE, alive, identity, read_receipts, rows
from crash_recovery_check import CASES, SOURCES, InvalidReport, digest, loads, receipt_counts, require, validate_report


@contextlib.contextmanager
def interrupt_cleanup():
    require(threading.current_thread() is threading.main_thread(),'runner_requires_main_thread')
    previous=signal.getsignal(signal.SIGTERM)
    entered=False
    def interrupted(*_):
        nonlocal entered
        if not entered:
            entered=True
            raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,interrupted)
    try:yield
    finally:signal.signal(signal.SIGTERM,previous)


def wait_until(predicate, code, seconds=10):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        result=predicate()
        if result:return result
        time.sleep(.02)
    require(False,code)


class Gateway:
    def __init__(self,binary,fixture,directory):
        self.binary=binary;self.fixture=fixture;self.directory=directory
        self.admin='synthetic-'+uuid.uuid4().hex;self.key=None;self.child=None;self.birth=None
        self.port=None;self.ports=[];self.trace=[];self.drainer=None;self.ready=threading.Event()
        self.announcement=None;self.drain_failed=False;self.fake=directory/'fake'
        self.fake.mkdir();(directory/'claude-config').mkdir()
        source=Path(__file__).with_name('crash_recovery_fixture.py').read_text()
        for name in ('claude','cursor-agent','runtime'):
            p=self.fake/name;p.write_text('#!'+str(Path(sys.executable).resolve())+'\n'+source.split('\n',1)[1]);p.chmod(0o700)

    def drain(self,stream):
        pending=b'';discard=False
        try:
            while True:
                chunk=os.read(stream.fileno(),4096)
                if not chunk:break
                for byte in chunk:
                    if byte==10:
                        if not discard:
                            line=re.sub(rb'\x1b\[[0-9;]*m',b'',pending)
                            if b'thinrouter listening' in line:
                                m=re.search(rb'\baddr=127\.0\.0\.1:([0-9]+)\b',line)
                                if not m or not 0<int(m[1])<65536 or self.announcement is not None:
                                    self.drain_failed=True
                                else:self.announcement=int(m[1]);self.ready.set()
                        pending=b'';discard=False
                    elif not discard:
                        if len(pending)>=4096:pending=b'';discard=True
                        else:pending+=bytes((byte,))
        except (OSError,ValueError):self.drain_failed=True

    def start(self):
        require(self.child is None,'gateway_already_started')
        self.ready.clear();self.announcement=None;self.drain_failed=False
        env={'PATH':'/usr/bin:/bin','HOME':str(self.directory),'CLAUDE_CONFIG_DIR':str(self.directory/'claude-config'),
             'HTTP_PROXY':self.fixture.proxy_url,'HTTPS_PROXY':self.fixture.proxy_url,'ALL_PROXY':self.fixture.proxy_url,
             'http_proxy':self.fixture.proxy_url,'https_proxy':self.fixture.proxy_url,'all_proxy':self.fixture.proxy_url,
             'NO_PROXY':'','no_proxy':'','RUST_LOG':'thinrouter::server=info','NO_COLOR':'1'}
        command=[str(self.binary),'serve','--host','127.0.0.1','--port','0','--data-dir',str(self.directory),
                 '--admin-token',self.admin,'--claude-bin',str(self.fake/'claude'),'--claude-idle-secs','120',
                 '--cursor-bin',str(self.fake/'cursor-agent'),'--cursor-runtime-bin',str(self.fake/'runtime'),
                 '--cursor-image',IMAGE,'--cursor-profile-volume','thinrouter-cursor-offline','--cursor-max-runs','1',
                 '--cursor-accept-account-plugins']
        self.child=subprocess.Popen(command,env=env,cwd=self.directory,stdin=subprocess.DEVNULL,
                                    stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,start_new_session=True)
        self.birth=identity(self.child.pid);require(self.birth is not None,'gateway_identity_missing')
        self.drainer=threading.Thread(target=self.drain,args=(self.child.stderr,),daemon=True);self.drainer.start()
        def announced():
            require(self.child.poll() is None and not self.drain_failed,'gateway_start_failed')
            return self.ready.is_set()
        wait_until(announced,'owned_announcement_timeout',15)
        self.port=self.announcement;self.ports.append(self.port)
        def authenticated():
            require(self.child.poll() is None and alive(self.birth),'gateway_start_exited')
            try:
                code,body=self.request('GET','/admin/api/stats',admin=True)
                require(code==200 and 'usage_events' in loads(body),'owned_admin_identity')
                return self.child.poll() is None
            except (OSError,http.client.HTTPException):return False
        wait_until(authenticated,'owned_admin_timeout',5)
        return dict(self.birth)

    def open(self,method,path,body=None,admin=False):
        kind='admin' if admin else 'client'
        self.trace.append({'sequence':len(self.trace)+1,'method':method,'path':path,
                           'destination':f'http://127.0.0.1:{self.port}','kind':kind})
        c=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5)
        headers={'Content-Type':'application/json','Connection':'close'}
        headers['x-admin-token' if admin else 'Authorization']=self.admin if admin else 'Bearer '+self.key
        try:c.request(method,path,json.dumps(body) if body is not None else None,headers)
        except BaseException:c.close();raise
        return c

    def request(self,method,path,body=None,admin=False):
        c=self.open(method,path,body,admin)
        try:
            response=c.getresponse();body=response.read(2097153);require(len(body)<=2097152,'response_limit')
            return response.status,body
        finally:c.close()

    def api(self,method,path,body=None):
        status,raw=self.request(method,'/admin/api/'+path,body,True)
        require(status==(201 if method=='POST' else 200),'admin_status');return loads(raw)

    def kill(self):
        require(self.child is not None and self.child.poll() is None and alive(self.birth),'kill_identity_lost')
        pid=self.child.pid;os.kill(pid,signal.SIGKILL);rc=self.child.wait(timeout=5)
        require(rc==-signal.SIGKILL,'kill_not_observed')
        return {'identity':dict(self.birth),'target_pid':pid,'target':'owned_gateway_pid',
                'identity_checked':True,'signal':9,'returncode':rc}

    def stop(self):
        if self.child is None:return
        if self.child.poll() is None:
            require(alive(self.birth),'stop_identity_lost');os.kill(self.child.pid,signal.SIGTERM)
            try:self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                require(alive(self.birth),'stop_identity_lost');os.kill(self.child.pid,signal.SIGKILL);self.child.wait(timeout=5)
        if self.drainer is not None:
            self.drainer.join(3);require(not self.drainer.is_alive(),'gateway_drainer_cleanup')
        self.child.stderr.close();self.child=None


def cleanup_fake(directory):
    owned={ (e['process']['pid'],e['process']['birth']):e['process']
            for e in read_receipts(directory/'fake') if e['kind'] in ('spawn','input') }
    for item in owned.values():
        if alive(item):os.kill(item['pid'],signal.SIGTERM)
    end=time.monotonic()+3
    while any(alive(item) for item in owned.values()) and time.monotonic()<end:time.sleep(.02)
    for item in owned.values():
        if alive(item):os.kill(item['pid'],signal.SIGKILL)
    wait_until(lambda:not any(alive(item) for item in owned.values()),'fake_child_cleanup',3)
    return [{'pid':i['pid'],'birth':i['birth'],'stopped':not alive(i)} for i in owned.values()]


def prove(g,f):
    require(Path(sys.executable).resolve().is_absolute(),'absolute_python')
    fake=[g.fake/n for n in ('claude','cursor-agent','runtime')]
    require(all(p.is_absolute() and p.is_file() and not p.is_symlink() and digest(p)==digest(fake[0]) for p in fake),'owned_fake_files')
    require(all(s.server_address[0]=='127.0.0.1' for s in f._servers),'owned_fixture_hosts')
    probes=[]
    for method,target,label in [('GET','http://unknown.invalid/','unknown'),('CONNECT','unknown.invalid:443','connect'),('GET','http://unknown.invalid/redirect','redirect')]:
        c=http.client.HTTPConnection('127.0.0.1',f._servers[1].server_port,timeout=2)
        try:c.request(method,target);response=c.getresponse();response.read();require(response.status==403,'proxy_denial');probes.append({'method':method,'target':label,'status':response.status})
        finally:c.close()
    require(f.denials==3,'proof_count')
    return {'proved_before_dispatch':True,'synthetic_home_db':True,'environment_cleared':True,
            'no_provider_configuration_before_launch':True,'absolute_owned_fake_executables':True,
            'owned_home':str(g.directory),'fake_executables':[str(p) for p in fake],
            'fake_sha256':digest(fake[0]),'python':str(Path(sys.executable).resolve()),'python_sha256':digest(Path(sys.executable).resolve()),
            'fixture_ports':[s.server_port for s in f._servers],'proof_denied_requests':3,'probes':probes}


def snapshot(g,index):
    original=rows(g.directory);events=g.api('GET','usage');daily=g.api('GET','usage/daily?schema=2')
    status,csv=g.request('GET','/admin/api/usage/export.csv',admin=True);require(status==200,'csv_status')
    return {'restart':index,'gateway':dict(g.birth),'receipts':read_receipts(g.fake),'sqlite':original,
            'surfaces':{'events_rows':events['data'],'daily_api':daily,'csv_raw':csv.decode(),
                        'scope':{'selected_ids':[r['id'] for r in original],'filter':None,
                                 'events_limit':100,'csv_limit':1000,'day_bucket_limit':30}}}


def run_case(binary,name,output,update):
    directory=Path(tempfile.mkdtemp(prefix='synthetic-crash-',dir=output)).resolve()
    f=Fixture(directory);g=None;client=None
    record={'name':name,'status':'running','layer':'actual_gateway_http_fakecli','client_protocol':'chat','stream':False,'restarts':[]}
    update(record)
    try:
        g=Gateway(binary,f,directory);f.start();record['isolation']=prove(g,f);update(record)
        g.start();g.key=g.api('POST','keys',{'name':'synthetic-crash'})['secret']
        connection=g.api('POST','connections',{'name':'synthetic-http','base_url':f.base_url,
            'api_key':'synthetic-crash-key','default_model':'history','input_price_per_m':250000,'output_price_per_m':250000})['id']
        def route(public,connection):
            g.api('POST','routes',{'public_model':public,'targets':[{'connection_id':connection,'model_override':public}]})
        route('history',connection)
        status,body=g.request('POST','/v1/chat/completions',{'model':'history','messages':[{'role':'user','content':'synthetic'}]})
        require(status==200 and loads(body)['choices'][0]['message']['content']=='synthetic history','history_response')
        wait_until(lambda:len(rows(directory))==1 and rows(directory)[0]['finalized_at'] is not None,'history_not_finalized')
        if name!='buffered_http':
            connection=g.api('POST','connections/oauth/import',{'name':'synthetic-'+name,'provider':name.removeprefix('buffered_'),'access_token':'','default_model':name})['connection']['id']
        route(name,connection)
        client=g.open('POST','/v1/chat/completions',{'model':name,'stream':False,'messages':[{'role':'user','content':'synthetic active'}]})
        def barrier():
            receipts=read_receipts(g.fake)
            if not any(e['model']==name and e['kind']==('http_inference' if name=='buffered_http' else 'input') for e in receipts):return False
            rr=rows(directory)
            return len(rr)==2 and rr[1]['finalized_at'] is None
        wait_until(barrier,'dispatch_pending_barrier')
        record['before_kill']=rows(directory);record['receipts_before_kill']=read_receipts(g.fake);update(record)
        record['kill']=g.kill();record['after_kill']=rows(directory);client.close();client=None
        record['harness_fake_cleanup']=cleanup_fake(directory);g.stop();update(record)
        for index in (1,2):
            g.start();record['restarts'].append(snapshot(g,index));update(record);g.stop()
        record['status']='passed'
    finally:
        # Attempt every owned cleanup even when a previous cleanup operation fails.
        cleanup_errors=[]
        def clean(label,action):
            try:action();return True
            except BaseException:cleanup_errors.append(label);return False
        if client is not None:clean('client_close',client.close)
        gateway_stopped=clean('gateway_stop',g.stop) if g is not None else True
        fake_stopped=True
        if g is not None:
            def fake_cleanup():record['final_fake_cleanup']=cleanup_fake(directory)
            fake_stopped=clean('fake_stop',fake_cleanup)
        fixture_closed=clean('fixture_close',f.close)
        ports=(g.ports if g is not None else [])+[s.server_port for s in f._servers]
        def released():
            for port in set(ports):
                with socket.socket() as probe:
                    probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                    probe.bind(('127.0.0.1',port))
        listeners_released=clean('listener_release',released)
        record['receipts_final']=read_receipts(directory/'fake')
        record['counts']=receipt_counts(record['receipts_final'])
        record['gateway_ports']=g.ports if g is not None else []
        record['request_trace']=g.trace if g is not None else []
        record['client_requests']=sum(x['kind']=='client' for x in record['request_trace'])
        record['admin_requests']=sum(x['kind']=='admin' for x in record['request_trace'])
        if 'isolation' in record:record['isolation']['denied_requests_final']=f.denials
        # Retain synthetic data on failed ownership cleanup, rather than erase evidence.
        temporary_removed=clean('temporary_remove',lambda:shutil.rmtree(directory)) if gateway_stopped and fake_stopped and fixture_closed else False
        record['cleanup']={'gateway_stopped':gateway_stopped,'fake_children_stopped':fake_stopped,
            'fixture_closed':fixture_closed,'temporary_data_removed':temporary_removed and not directory.exists(),
            'listeners_released':listeners_released,
            'fake_child_cleanup_basis':'harness_pid_birth_checked_not_product_guarantee'}
        if cleanup_errors:record['cleanup_errors']=cleanup_errors
        update(record)
        require(not cleanup_errors and temporary_removed,'owned_cleanup_incomplete')
    return record


def run(binary,expected_binary_sha256,output):
    binary=binary.resolve();require(binary.is_file() and digest(binary)==expected_binary_sha256,'binary_pin')
    source={n:digest(Path(__file__).with_name(n)) for n in SOURCES}
    output.mkdir(parents=True,exist_ok=False);report={'schema_version':1,'status':'running','synthetic':True,
        'case_inventory':list(CASES),'cases':[],'binary_sha256':expected_binary_sha256,'source_sha256':source,
        'owner_personal_run_claimed':False,'live_client_version_provider_verified':False,'actual_cost_usd':None,
        'whole_round_metrics':None,'stream_coverage':'existing_native_regression_separate_not_these_cases'}
    def save():
        (output/'report.json').write_text(json.dumps(report,indent=2,sort_keys=True,allow_nan=False)+'\n')
    save()
    try:
        with interrupt_cleanup():
            for name in CASES:
                def update(record):
                    if report['cases'] and report['cases'][-1]['name']==record['name']:report['cases'][-1]=record
                    else:report['cases'].append(record)
                    save()
                run_case(binary,name,output,update)
        require(source=={n:digest(Path(__file__).with_name(n)) for n in SOURCES},'source_changed_during_run')
        report['status']='passed';validate_report(report,expected_binary_sha256,source);save()
    except BaseException as error:
        report['status']='failed'
        report['failure_code']=str(error) if isinstance(error,InvalidReport) else type(error).__name__
        save();raise
    return report


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true')
    p.add_argument('--binary',type=Path);p.add_argument('--expected-binary-sha256',required=True)
    p.add_argument('--output-dir',type=Path);p.add_argument('--verify-report',type=Path);a=p.parse_args(argv)
    if a.verify_report:
        require(a.verify_report.stat().st_size<=4*1024*1024,'report_size')
        validate_report(loads(a.verify_report.read_bytes()),a.expected_binary_sha256)
    else:
        require(a.binary is not None and a.output_dir is not None,'check_arguments')
        run(a.binary,a.expected_binary_sha256,a.output_dir)
    print('Crash recovery check: passed (verified)')


if __name__=='__main__':main()

"""Real temporary host roots and production helper, synthetic command results only."""
import base64
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

import fresh_replay as contract
import fresh_replay_host as host
from fresh_bootstrap_render import canonical
from fresh_rebuild import plan_digest
from test_app_desired import spec


class Harness:
    def __init__(self, *, identity_profile='containerd'):
        if identity_profile not in ('containerd', 'opaque-parser'):
            raise ValueError('unknown synthetic identity profile')
        self.identity_profile=identity_profile
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        self.now=datetime(2026,10,6,17,tzinfo=timezone.utc)
        self.rows=[]; self.running=set(); self.calls=[]; self.writes=[]; self.counter=0
        self.keys={}; self.roots=[]; self.with_status=False
        hosts=[]
        for i in range(4):
            raw=b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20'+bytes([i+1])*32
            key='ssh-ed25519 '+base64.b64encode(raw).decode()
            self.keys['ckc-disposable-%02d'%(i+1)]=key
            h={'alias':'ckc-disposable-%02d'%(i+1),'node':'worker-'+str(i+1),'ip':'100.64.0.'+str(i+1),
               'machine_id':'fresh-machine-'+str(i),'boot_id':'00000000-0000-0000-0000-%012d'%(i+1),
               'host_key_sha256':hashlib.sha256(raw).hexdigest(),'files':[]}
            hosts.append(h)
            root=self.root/str(i); root.mkdir(mode=0o700); self.roots.append(root)
            for p in ('etc/eru','etc/ssh','proc/sys/kernel/random','var/lib/cni/networks/eru','run/eru/workloads'):
                (root/p).mkdir(parents=True,mode=0o700)
            for p,value in (('etc/machine-id',h['machine_id']),('proc/sys/kernel/random/boot_id',h['boot_id']),('etc/ssh/ssh_host_ed25519_key.pub',key)):
                (root/p).write_text(value); (root/p).chmod(0o600)
        for root in self.roots:
            for directory in root.rglob('*'):
                if directory.is_dir(): directory.chmod(0o700)
        capacity={'cpumem':{'cpu':4,'cpu_map':{str(i):100 for i in range(4)},'memory':2*1024**3,'numa_memory':{},'numa':{}},'resource-storage':{'volumes':{},'disks':[],'storage':10*1024**3}}
        workers=[{**h,'podname':'eru','endpoint':'containerd://ckc@'+h['ip']+':22',
                 'labels':{'owner':'eru-vps-mvp','role':'worker'},'resource_capacity':copy.deepcopy(capacity)} for h in hosts[1:]]
        self.plan={'schema_version':1,'operation':'fresh-replay-plan','run_id':'synthetic-run',
            'plan_id':'network','plan_sha256':'1'*64,'execution_sha256':'2'*64,'pending_sha256':'3'*64,
            'bootstrap_sha256':'4'*64,'bootstrap_receipt_sha256':'5'*64,
            'created_at':self.now.isoformat(),'private_identity':[0,0],
            'network_render':{'hosts':hosts,'controller_known_hosts':'\n'.join(h['ip']+' '+self.keys[h['alias']] for h in hosts)},
            'network_setup':{},'render':{'hosts':hosts,'workers':workers},'desired_apps':[spec()],
            'canary_image':'nginx@sha256:'+'a'*64,'bootstrap_facts':{'etcd':{'cluster_id':'101','member_id':'201'}},
            'prior':{'cluster_id':'100','member_ids':['200']},'dependencies':[], 'context_refs':{}}
        self.bad_http=False; self.bad_quota=False; self.extra_key=False
        self.plan['bootstrap_facts']['etcd']['keys']=[{'key':base64.b64encode(key.encode()).decode(),'value':base64.b64encode(value.encode()).decode()} for key,value in self.metadata_state().items()]
        self.plan['steps']=contract.steps(self.plan['desired_apps'])
        self.digest=plan_digest(self.plan)
        self.bad_http=False; self.bad_quota=False; self.extra_key=False

    def close(self): self.tmp.cleanup()

    def workload_identity(self,appname,entry):
        # Pinned core uses RandomString(6), ASCII letters. Determinism is test-only.
        alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
        if type(self.counter) is not int or not 0 <= self.counter < len(alphabet)**6:
            raise ValueError('synthetic instance suffix space exhausted')
        value=self.counter; suffix=''
        for _ in range(6):
            suffix=alphabet[value % len(alphabet)]+suffix; value//=len(alphabet)
        self.counter+=1
        name=appname+'_'+entry+'_'+suffix
        wid=name if self.identity_profile=='containerd' else hashlib.sha256(str(self.counter).encode()).hexdigest()
        return wid,name

    def action(self,index): return contract.action(self.plan,self.digest,index)

    def nodes(self):
        nodes=[]
        for w in self.plan['render']['workers']:
            selected=[r for r in self.rows if r['nodename']==w['node']]
            usage={'cpumem':{'cpu':sum(r['_cpu'] for r in selected),'memory':sum(r['_memory'] for r in selected)},
                   'storage':{'storage':sum(r['_storage'] for r in selected)}}
            if self.bad_quota: usage['storage']['storage']+=1
            nodes.append({k:w[k] for k in ('podname','endpoint','labels','resource_capacity')}|
                         {'name':w['node'],'available':True,'bypass':False,'resource_usage':usage})
        return nodes

    def cli_nodes(self):
        result=self.nodes()
        for n in result:
            ledger=self.metadata_state()
            for field,part in (('resource_capacity','capacity'),('resource_usage','usage')):
                cpumem=json.loads(ledger['/eru/resource/cpumem/'+n['name']])[part]
                storage=json.loads(ledger['/eru-storage/resource/storage/'+n['name']])[part]
                n[field]=canonical({'cpumem':cpumem,'resource-storage':storage}).decode()
        return result

    def metadata_rows(self):
        ledger=self.metadata_state()
        return [{k:r[k] for k in host.IDENTITY_FIELDS}|{'resources':canonical(json.loads(ledger['/eru/workloads/'+r['id']])['resources']).decode(),'create_time':1791306000,'status':self.status(r) if self.with_status else {}} for r in self.rows]

    def status(self,row):
        return {'id':row['id'],'running':True} if row['id'] in self.running else {'id':row['id']}

    def metadata_state(self):
        result={}
        for n in self.nodes():
            static={k:n[k] for k in ('name','podname','endpoint','labels')}
            for key in ('/eru/node/'+n['name'],'/eru/node/'+n['podname']+':pod/'+n['name']): result[key]=canonical(static).decode()
            cap={'cpu':n['resource_capacity']['cpumem']['cpu'],'memory':n['resource_capacity']['cpumem']['memory'],'cpu_map':{str(i):100 for i in range(4)},'numa_memory':{},'numa':{}}
            usage={'cpu':n['resource_usage']['cpumem']['cpu'],'memory':n['resource_usage']['cpumem']['memory'],'cpu_map':{str(i):0 for i in range(4)},'numa_memory':{},'numa':{}}
            result['/eru/resource/cpumem/'+n['name']]=canonical({'capacity':cap,'usage':usage}).decode()
            result['/eru-storage/resource/storage/'+n['name']]=canonical({'capacity':{'volumes':{},'disks':[],'storage':n['resource_capacity']['resource-storage']['storage']},'usage':{'volumes':{},'disks':[],'storage':n['resource_usage']['storage']['storage']}}).decode()
        for r in self.rows:
            resource={'cpu_request':r['_cpu'],'cpu_limit':r['_cpu'],'memory_request':r['_memory'],'memory_limit':r['_memory'],'cpu_map':None,'numa_memory':None,'numa_node':''}
            data={k:r[k] for k in host.IDENTITY_FIELDS}|{'resources':{'cpumem':resource},'engine_params':{'cpumem':{'cpu':r['_cpu'],'memory':r['_memory'],'cpu_map':None,'numa_node':'','remap':False}},'hook':None,'privileged':False,'user':'root','env':None,'create_time':1791306000}
            data['resources']['resource-storage']={'volumes_request':[],'volumes_limit':[],'volume_plan_request':{},'volume_plan_limit':{},'storage_request':r['_storage'],'storage_limit':r['_storage'],'disks_request':[],'disks_limit':[]}
            data['engine_params']['resource-storage']={'volumes':None,'volume_changed':False,'storage':r['_storage'],'iops_options':{}}
            app,entry,_=host.apps.workload_name(r)
            for key in ('/eru/workloads/'+r['id'],'/eru/node/'+r['nodename']+':workloads/'+r['id'],'/eru/deploy/'+app+'/'+entry+'/'+r['nodename']+'/'+r['id']): result[key]=canonical(data).decode()
            if self.with_status:result['/eru/status/'+app+'/'+entry+'/'+r['nodename']+'/'+r['id']]=canonical(self.status(r)).decode()
        return result

    def runner(self,index):
        def run(argv,input_bytes=None):
            self.calls.append((index,argv)); value=b''; error=b''; code=0
            if argv[0]=='/usr/local/bin/etcdctl':
                header={'cluster_id':101,'member_id':201,'revision':10}
                if argv[-2:]==('endpoint','status'): result=[{'Endpoint':'http://127.0.0.1:2379','Status':{'header':header,'leader':201}}]
                elif argv[-2:]==('member','list'): result={'header':header,'members':[{'ID':201}]}
                else:
                    keys=self.metadata_state()
                    if self.extra_key: keys['/foreign/unexpected']='unknown'
                    kvs=[{'key':base64.b64encode(k.encode()).decode(),'value':base64.b64encode(v.encode()).decode()} for k,v in sorted(keys.items())]
                    result={'header':header,'kvs':kvs,'count':len(kvs),'more':False}
                value=canonical(result)
            elif argv[0]=='/usr/local/bin/eru-cli':
                parts=argv[5:]
                if parts==('pod','list'): value=canonical([{'name':'eru'}])
                elif parts==('pod','nodes','eru'): value=canonical(self.cli_nodes())
                elif parts==('workload','list'): value=canonical(self.metadata_rows())
                elif parts[:2]==('workload','get'): value=canonical([r for r in self.metadata_rows() if r['id']==parts[2]])
                elif parts[:2]==('workload','logs'): value=b'GET / HTTP/1.1 200\n'
                elif parts[:2]==('image','cache'): self.writes.append((index,parts))
                elif parts[:2]==('workload','deploy'):
                    self.writes.append((index,parts)); node=parts[parts.index('--node')+1]
                    memory=host.quantity(parts[parts.index('--memory')+1]); storage=host.quantity(parts[parts.index('--storage')+1])
                    if memory>2*1024**3 or storage>10*1024**3:
                        code=1; error=b'not enough resources'
                    else:
                        text=(self.roots[0]/parts[-1].lstrip('/')).read_text(); lines=text.splitlines()
                        appname=json.loads(lines[0].split(': ',1)[1])
                        labels={}; start=lines.index('labels:')
                        for line in lines[start+1:]:
                            k,v=line.strip().split(': ',1)
                            try: labels[k]=json.loads(v)
                            except json.JSONDecodeError: labels[k]=v
                        for replica in range(int(parts[parts.index('--count')+1])):
                            wid,name=self.workload_identity(appname,parts[parts.index('--entry')+1])
                            row={'id':wid,'name':name,'nodename':node,'podname':'eru','image':parts[parts.index('--image')+1],
                                 'labels':labels,'_cpu':float(parts[parts.index('--cpu')+1]),'_memory':memory,'_storage':storage}
                            self.rows.append(row); self.running.add(wid)
                            root=self.roots[int(node[-1])-1]
                            if parts[parts.index('--network')+1]=='eru':
                                (root/'var/lib/cni/networks/eru'/('10.1.0.'+str(self.counter))).write_text(wid+'\n')
                                (root/'var/lib/cni/networks/eru'/('10.1.0.'+str(self.counter))).chmod(0o600)
                            (root/'run/eru/workloads'/wid).write_text('{}'); (root/'run/eru/workloads'/wid).chmod(0o600)
                elif parts[:2] in (('workload','stop'),('workload','start'),('workload','remove'),('workload','exec')):
                    self.writes.append((index,parts)); wid=parts[-1] if parts[1]=='remove' else parts[2]
                    if parts[1]=='stop': self.running.remove(wid)
                    elif parts[1]=='start': self.running.add(wid)
                    elif parts[1]=='remove':
                        row=next(r for r in self.rows if r['id']==wid); self.rows.remove(row); self.running.discard(wid)
                        root=self.roots[int(row['nodename'][-1])-1]
                        for f in (root/'var/lib/cni/networks/eru').iterdir():
                            if f.read_text().strip()==wid: f.unlink()
                        (root/'run/eru/workloads'/wid).unlink()
                    else: error=b'nginx version: nginx/1.27.0'
                else: raise AssertionError(argv)
            elif argv[0]=='/usr/bin/ctr':
                rows=[r for r in self.rows if r['nodename']=='worker-'+str(index+1)]
                if argv[3:]==('containers','list','-q'): value=('\n'.join(r['id'] for r in rows)+'\n' if rows else '').encode()
                elif argv[3:]==('tasks','list','-q'):
                    task_ids=[r['id'] for r in rows if r['id'] in self.running]
                    value=('\n'.join(task_ids)+'\n' if task_ids else '').encode()
                else:
                    row=next(r for r in rows if r['id']==argv[-1])
                    value=canonical({'ID':row['id'],'Image':row['image'],'Labels':row['labels']|{'eru.network.eru':'10.1.0.1'}})
            elif argv==('/usr/bin/python3','-'):
                self.assert_http_input=input_bytes
                value=canonical({'status':500 if self.bad_http else 200,'body_match':True})
            else: raise AssertionError(argv)
            return {'exit_code':code,'stdout':value,'stderr':error}
        return run

    def send(self,action,operation,intent=None,index=0):
        request={'schema_version':1,'operation':operation,'action':action}
        if intent is not None: request['intent_sha256']=intent
        if operation=='capture': request['capture_index']=index
        return host.handle(request,root=str(self.roots[index]),owner_uid=os.getuid(),owner_gid=os.getgid(),now=self.now,runner=self.runner(index))

    def observe(self,action):
        value=self.send(action,'observe')
        value['evidence']['captures'] += [self.send(action,'capture',index=i) for i in range(1,4)]
        value['observed_at']=max(row['completed_at'] for row in value['evidence']['captures'])
        return value

    def dispatch(self,action,intent): return self.send(action,'dispatch',intent)


class ReplayHostTests(unittest.TestCase):
    def setUp(self): self.h=Harness(); self.addCleanup(self.h.close)

    def test_real_helper_full_fixed_schedule_and_owned_cleanup(self):
        previous=None
        for i,descriptor in enumerate(self.h.plan['steps']):
            action=self.h.action(i); before=self.h.observe(action)
            host.validate_evidence(action,before,before=descriptor['step'] not in contract.READONLY)
            if descriptor['step'] not in contract.READONLY: self.h.dispatch(action,'b'*64)
            observed=self.h.observe(action)
            host.validate_evidence(action,observed)
            host.validate_transition(action,before,observed,previous)
            previous=observed
        self.assertEqual(len(self.h.rows),1)
        self.assertEqual(self.h.rows[0]['labels']['logical_app'],'hello-api')
        removes=[parts[-1] for _,parts in self.h.writes if parts[:2]==('workload','remove')]
        self.assertEqual(len(removes),6); self.assertEqual(len(set(removes)),6)

    def test_host_intent_cannot_dispatch_twice_and_observe_is_readonly(self):
        action=self.h.action(1)
        self.h.dispatch(action,'b'*64)
        count=len(self.h.writes)
        with self.assertRaises(ValueError): self.h.dispatch(action,'b'*64)
        self.h.observe(action)
        self.assertEqual(len(self.h.writes),count)

    def test_foreign_canary_or_host_identity_has_zero_writes(self):
        action=self.h.action(1)
        (self.h.roots[0]/'etc/machine-id').write_text('foreign')
        with self.assertRaises(ValueError): self.h.dispatch(action,'b'*64)
        self.assertEqual(self.h.writes,[])

    def test_readiness_wrong_image_quota_cni_or_command_identity_cannot_pass(self):
        for i in (0,1,2):
            action=self.h.action(i)
            if action['step'] not in contract.READONLY: self.h.dispatch(action,'b'*64)
        action=self.h.action(3); observed=self.h.observe(action)
        host.validate_evidence(action,observed)
        bad=copy.deepcopy(observed)
        key='http:'+self.h.rows[0]['id']
        bad['evidence']['captures'][1]['commands'][key]['stdout_base64']=base64.b64encode(b'{"status":500,"body_match":true}').decode()
        with self.assertRaises(ValueError): host.validate_evidence(action,bad)
        self.h.rows[0]['image']='foreign@sha256:'+'b'*64
        with self.assertRaises(ValueError): host.validate_evidence(action,self.h.observe(action))
        self.h.rows[0]['image']=self.h.plan['desired_apps'][0]['image']
        index=next(i for i,s in enumerate(self.h.plan['steps']) if s['step']=='apps-accept')
        accepted=self.h.action(index)
        self.h.bad_quota=True
        with self.assertRaises(ValueError): host.validate_evidence(accepted,self.h.observe(accepted))
        self.h.bad_quota=False
        allocation=next((self.h.roots[1]/'var/lib/cni/networks/eru').iterdir())
        allocation.write_text('foreign-old-id\n')
        with self.assertRaises(ValueError): host.validate_evidence(accepted,self.h.observe(accepted))

    def test_caller_success_result_with_different_fixed_writer_argv_rejected(self):
        action=self.h.action(1); self.h.dispatch(action,'b'*64)
        observed=self.h.observe(action)
        observed['evidence']['result']['argv'][-1]='foreign@sha256:'+'b'*64
        with self.assertRaises(ValueError): host.validate_evidence(action,observed)

    def test_unknown_or_linked_owned_state_is_preserved_and_blocks_capture(self):
        target=self.h.roots[1]/'var/lib/cni/networks/eru'/'foreign-link'
        target.symlink_to('/tmp')
        with self.assertRaises((ValueError,OSError)): self.h.observe(self.h.action(0))
        self.assertTrue(target.is_symlink()); self.assertEqual(self.h.writes,[])

    def test_entire_keyspace_unknown_or_original_workload_residue_rejected(self):
        action=self.h.action(0)
        self.h.extra_key=True
        with self.assertRaises(ValueError): host.validate_evidence(action,self.h.observe(action))
        self.h.extra_key=False
        action['bootstrap_facts']['prior_workload_ids']=['worker-2']
        with self.assertRaises(ValueError): host.validate_evidence(action,self.h.observe(action))

    def test_multiple_exact_reviewed_apps_and_replicas_preserved(self):
        first=copy.deepcopy(self.h.plan['desired_apps'][0]); first['replicas']=3
        second=copy.deepcopy(first); second['name']='second-api'; second['node']='worker-3'; second['replicas']=2
        self.h.plan['desired_apps']=[first,second]; self.h.plan['steps']=contract.steps([first,second]); self.h.digest=plan_digest(self.h.plan)
        previous=None
        for i,step in enumerate(self.h.plan['steps']):
            action=self.h.action(i); before=self.h.observe(action)
            host.validate_evidence(action,before,before=step['step'] not in contract.READONLY)
            if step['step'] not in contract.READONLY: self.h.dispatch(action,'b'*64)
            observed=self.h.observe(action);host.validate_evidence(action,observed);host.validate_transition(action,before,observed,previous);previous=observed
        self.assertEqual(len(self.h.rows),5)
        self.assertEqual(sum(r['nodename']=='worker-3' for r in self.h.rows),2)

    def test_unknown_key_inside_owned_prefix_cannot_become_residue_baseline(self):
        action=self.h.action(0);observed=self.h.observe(action)
        command=observed['evidence']['captures'][0]['commands']['keys']
        value=json.loads(base64.b64decode(command['stdout_base64']))
        value['kvs'].append({'key':base64.b64encode(b'/eru/unknown/key').decode(),'value':base64.b64encode(b'unknown').decode()});value['count']+=1
        command['stdout_base64']=base64.b64encode(canonical(value)).decode()
        with self.assertRaises(ValueError): host.validate_evidence(action,observed)


    @staticmethod
    def replace_metadata_value(observed,key,text):
        command=observed['evidence']['captures'][0]['commands']['keys']
        value=json.loads(base64.b64decode(command['stdout_base64']))
        selected=next(row for row in value['kvs'] if base64.b64decode(row['key']).decode()==key)
        selected['value']=base64.b64encode(text.encode()).decode()
        command['stdout_base64']=base64.b64encode(canonical(value)).decode()

    def test_original_node_metadata_value_cannot_change_to_foreign_identity(self):
        action=self.h.action(0); observed=self.h.observe(action)
        self.replace_metadata_value(observed,'/eru/node/worker-2','foreign-value')
        with self.assertRaises(ValueError): host.validate_evidence(action,observed)
        self.assertEqual(self.h.writes,[])

    def test_readonly_step_cannot_change_raw_metadata_even_when_semantics_match(self):
        action=self.h.action(0); before=self.h.observe(action); after=copy.deepcopy(before)
        node=json.loads(self.h.metadata_state()['/eru/node/worker-2'])
        self.replace_metadata_value(after,'/eru/node/worker-2',json.dumps(node,indent=2))
        host.validate_evidence(action,before)
        with self.assertRaises(ValueError): host.validate_transition(action,before,after,None)


    def test_opaque_original_plugin_metadata_requires_exact_raw_value(self):
        action=self.h.action(0); observed=self.h.observe(action)
        entry={'key':base64.b64encode(b'/eru-storage/original').decode(),'value':base64.b64encode(b'original-opaque-value').decode()}
        action['bootstrap_facts']['etcd']['keys'].append(entry)
        command=observed['evidence']['captures'][0]['commands']['keys']
        value=json.loads(base64.b64decode(command['stdout_base64']))
        value['kvs'].append(copy.deepcopy(entry)); value['count']+=1
        command['stdout_base64']=base64.b64encode(canonical(value)).decode()
        host.validate_evidence(action,observed)
        self.replace_metadata_value(observed,'/eru-storage/original','foreign-plugin-value')
        with self.assertRaises(ValueError): host.validate_evidence(action,observed)

    def test_matching_cli_and_metadata_quota_lie_is_not_owned_resource_derivation(self):
        self.h.dispatch(self.h.action(2),'b'*64)
        action=self.h.action(3); observed=self.h.observe(action)
        command=observed['evidence']['captures'][0]['commands']['nodes']
        nodes=json.loads(base64.b64decode(command['stdout_base64']))
        node=next(row for row in nodes if row['name']=='worker-2')
        usage=json.loads(node['resource_usage']);usage['cpumem']['memory']+=1;node['resource_usage']=canonical(usage).decode()
        command['stdout_base64']=base64.b64encode(canonical(nodes)).decode()
        ledger=json.loads(self.h.metadata_state()['/eru/resource/cpumem/worker-2']);ledger['usage']['memory']+=1
        self.replace_metadata_value(observed,'/eru/resource/cpumem/worker-2',canonical(ledger).decode())
        with self.assertRaises(ValueError): host.validate_evidence(action,observed)


    def test_exact_canonical_keys_and_full_raw_records(self):
        self.h.dispatch(self.h.action(2),'b'*64)
        action=self.h.action(3); good=self.h.observe(action)
        host.validate_evidence(action,good)
        wid=self.h.rows[0]['id']
        for variant in ('alias','bare','missing','record_drift','extra_field'):
            bad=copy.deepcopy(good);command=bad['evidence']['captures'][0]['commands']['keys'];data=json.loads(base64.b64decode(command['stdout_base64']))
            primary=next(k for k in data['kvs'] if base64.b64decode(k['key']).decode()=='/eru/workloads/'+wid)
            if variant=='alias': data['kvs'].append({'key':base64.b64encode(('/eru/foreign/'+wid).encode()).decode(),'value':base64.b64encode(wid.encode()).decode()})
            elif variant=='bare': primary['value']=base64.b64encode(wid.encode()).decode()
            elif variant=='missing': data['kvs'].remove(primary)
            elif variant=='record_drift': primary['value']=base64.b64encode(json.dumps(json.loads(base64.b64decode(primary['value'])),indent=2).encode()).decode()
            else:
                record=json.loads(base64.b64decode(primary['value']));record['unknown']=True
                for k in data['kvs']:
                    if base64.b64decode(k['key']).decode().endswith('/'+wid):k['value']=base64.b64encode(canonical(record)).decode()
            data['count']=len(data['kvs']);command['stdout_base64']=base64.b64encode(canonical(data)).decode()
            with self.subTest(variant=variant),self.assertRaises(ValueError):host.validate_evidence(action,bad)

    def test_explicit_opaque_parser_fixture_uses_name_for_revision(self):
        # Generic parser regression only; this does not model a current engine.
        self.h=Harness(identity_profile='opaque-parser'); self.addCleanup(self.h.close)
        self.h.dispatch(self.h.action(2),'b'*64); row=self.h.rows[0]
        self.assertFalse(row['id'].startswith(host.apps.spec_identity(self.h.plan['desired_apps'][0])[2]+'_'))
        host.validate_evidence(self.h.action(3),self.h.observe(self.h.action(3)))
        self.assertFalse(any(index>0 and argv[0]=='/usr/local/bin/eru-cli' for index,argv in self.h.calls))
        row['name']='foreign_web_1'
        with self.assertRaises(ValueError):host.validate_evidence(self.h.action(3),self.h.observe(self.h.action(3)))


    def test_stored_resource_schema_and_topology_fail_closed(self):
        self.h.dispatch(self.h.action(2),'b'*64);action=self.h.action(3);good=self.h.observe(action);wid=self.h.rows[0]['id']
        for variant in ('resource_unknown','resource_bool','engine_bool','storage_volume','missing_field','numa_foreign'):
            bad=copy.deepcopy(good);cmd=bad['evidence']['captures'][0]['commands']['keys'];data=json.loads(base64.b64decode(cmd['stdout_base64']));record=json.loads(self.h.metadata_state()['/eru/workloads/'+wid])
            if variant=='resource_unknown':record['resources']['foreign']={}
            elif variant=='resource_bool':record['resources']['cpumem']['cpu_request']=True
            elif variant=='engine_bool':record['engine_params']['cpumem']['remap']=0
            elif variant=='storage_volume':record['resources']['resource-storage']['volumes_request']=['/unknown:/target']
            elif variant=='missing_field':del record['create_time']
            else:record['resources']['cpumem']['numa_node']='foreign'
            for kv in data['kvs']:
                if base64.b64decode(kv['key']).decode().endswith('/'+wid):kv['value']=base64.b64encode(canonical(record)).decode()
            cmd['stdout_base64']=base64.b64encode(canonical(data)).decode()
            if variant not in ('missing_field','engine_bool'):
                workloadcmd=bad['evidence']['captures'][0]['commands']['workloads'];rows=json.loads(base64.b64decode(workloadcmd['stdout_base64']));rows[0]['resources']=canonical(record['resources']).decode();workloadcmd['stdout_base64']=base64.b64encode(canonical(rows)).decode()
            with self.subTest(variant=variant),self.assertRaises(ValueError):host.validate_evidence(action,bad)


    def test_deploy_cannot_mutate_preexisting_raw_workload_record(self):
        self.h.dispatch(self.h.action(2),'b'*64)
        index=next(i for i,s in enumerate(self.h.plan['steps']) if s['step']=='bridge-deploy')
        action=self.h.action(index);before=self.h.observe(action);self.h.dispatch(action,'b'*64);after=self.h.observe(action)
        host.validate_transition(action,before,after,before)
        wid=self.h.rows[0]['id'];cmd=after['evidence']['captures'][0]['commands']['keys'];data=json.loads(base64.b64decode(cmd['stdout_base64']))
        for kv in data['kvs']:
            if base64.b64decode(kv['key']).decode().endswith('/'+wid):kv['value']=base64.b64encode(json.dumps(json.loads(base64.b64decode(kv['value'])),indent=2).encode()).decode()
        cmd['stdout_base64']=base64.b64encode(canonical(data)).decode()
        host.validate_evidence(action,after)
        with self.assertRaises(ValueError):host.validate_transition(action,before,after,before)


    def test_source_owned_status_and_canary_stop_start(self):
        self.h.with_status=True
        for i in (0,1,2):
            action=self.h.action(i)
            if action['step'] not in contract.READONLY:self.h.dispatch(action,'b'*64)
        host.validate_evidence(self.h.action(3),self.h.observe(self.h.action(3)))
        deploy=next(i for i,s in enumerate(self.h.plan['steps']) if s['step']=='bridge-deploy')
        self.h.dispatch(self.h.action(deploy),'b'*64)
        for step in ('canary-stop','canary-start'):
            index=next(i for i,s in enumerate(self.h.plan['steps']) if s['step']==step);action=self.h.action(index)
            before=self.h.observe(action);self.h.dispatch(action,'b'*64);after=self.h.observe(action)
            host.validate_transition(action,before,after,before)
            bad=copy.deepcopy(after);wid=self.h.rows[0]['id'];key=host._status_key(self.h.rows[0]);record=self.h.status(self.h.rows[0])|{'extension':'YQ=='}
            self.replace_metadata_value(bad,key,canonical(record).decode())
            cmd=bad['evidence']['captures'][0]['commands']['workloads'];cli=json.loads(base64.b64decode(cmd['stdout_base64']));next(r for r in cli if r['id']==wid)['status']=record;cmd['stdout_base64']=base64.b64encode(canonical(cli)).decode()
            host.validate_evidence(action,bad)
            with self.assertRaises(ValueError):host.validate_transition(action,before,bad,before)
        readonly=self.h.action(3);before=self.h.observe(readonly);after=copy.deepcopy(before);key=host._status_key(self.h.rows[0]);self.replace_metadata_value(after,key,json.dumps(self.h.status(self.h.rows[0]),indent=2))
        host.validate_evidence(readonly,after)
        with self.assertRaises(ValueError):host.validate_transition(readonly,before,after,before)

    def test_optional_status_missing_foreign_or_unknown_schema_rejected(self):
        self.h.with_status=True;self.h.dispatch(self.h.action(2),'b'*64);action=self.h.action(3);good=self.h.observe(action)
        host.validate_evidence(action,good)
        for variant in ('missing','foreign','orphan','unknown','bad_bool','bad_extension','cli_drift'):
            bad=copy.deepcopy(good);cmd=bad['evidence']['captures'][0]['commands']['keys'];data=json.loads(base64.b64decode(cmd['stdout_base64']));kv=next(k for k in data['kvs'] if base64.b64decode(k['key']).decode().startswith('/eru/status/'));record=json.loads(base64.b64decode(kv['value']))
            if variant=='cli_drift':
                cli=bad['evidence']['captures'][0]['commands']['workloads'];rows=json.loads(base64.b64decode(cli['stdout_base64']));rows[0]['status']['running']=False;cli['stdout_base64']=base64.b64encode(canonical(rows)).decode()
            elif variant=='missing':data['kvs'].remove(kv)
            elif variant=='orphan':kv['key']=base64.b64encode(b'/eru/status/foreign/web/worker-2/orphan').decode()
            else:
                if variant=='foreign':record['id']='foreign'
                elif variant=='unknown':record['ttl']=10
                elif variant=='bad_bool':record['running']=1
                else:record['extension']='not-base64!'
                kv['value']=base64.b64encode(canonical(record)).decode()
            data['count']=len(data['kvs']);cmd['stdout_base64']=base64.b64encode(canonical(data)).decode()
            with self.subTest(variant=variant),self.assertRaises(ValueError):host.validate_evidence(action,bad)

    def test_decimal_cpu_usage_matches_source_round9(self):
        first=copy.deepcopy(self.h.plan['desired_apps'][0]);first['resources']['cpu']=0.1
        second=copy.deepcopy(first);second['name']='decimal-second';second['resources']['cpu']=0.2
        self.h.plan['desired_apps']=[first,second];self.h.plan['steps']=contract.steps([first,second]);self.h.digest=plan_digest(self.h.plan)
        for index in (2,6):self.h.dispatch(self.h.action(index),'b'*64)
        action=self.h.action(7);observed=self.h.observe(action)
        for name in ('nodes','keys'):
            cmd=observed['evidence']['captures'][0]['commands'][name];data=json.loads(base64.b64decode(cmd['stdout_base64']))
            if name=='nodes':
                for node in data:
                    if node['name']=='worker-2':usage=json.loads(node['resource_usage']);usage['cpumem']['cpu']=0.3;node['resource_usage']=canonical(usage).decode()
            else:
                for kv in data['kvs']:
                    if base64.b64decode(kv['key']).decode()=='/eru/resource/cpumem/worker-2':ledger=json.loads(base64.b64decode(kv['value']));ledger['usage']['cpu']=0.3;kv['value']=base64.b64encode(canonical(ledger)).decode()
            cmd['stdout_base64']=base64.b64encode(canonical(data)).decode()
        host.validate_evidence(action,observed)

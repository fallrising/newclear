"""Fixed bounded fresh-owned CLI probes, host journals and residue verification.

Fixture root/runner seams are not wire-selectable. Recovery reads immutable
writer results and current identities without dispatching another writer.
"""
import base64
import copy
import ipaddress
import os
import re
import sys

import app_desired as apps
import fresh_replay as contract
from fresh_bootstrap_host import _Session, _time, _decode
from fresh_bootstrap_render import canonical, digest
from fresh_execution import exact
from fresh_observation import CAPTURE_SOURCE, public_key
from fresh_rebuild import plan_digest

LIMIT=8*1024*1024
WIRE_LIMIT=128*1024*1024
PROGRAM_LIMIT=192*1024*1024
ERROR='fresh replay unavailable'
ETCD=('/usr/local/bin/etcdctl','--endpoints=http://127.0.0.1:2379','--write-out=json')
CORE_COMMANDS={'pods':('pod','list'),'nodes':('pod','nodes','eru'),'workloads':('workload','list')}
_RESULT_SOURCE=CAPTURE_SOURCE.replace('if p.wait(timeout=max(0.01, deadline - time.monotonic())) != 0:\n            raise ValueError("observation probe failed")\n        return bytes(chunks["stdout"])',
    'code = p.wait(timeout=max(0.01, deadline - time.monotonic()))\n        return {"exit_code": code, "stdout": bytes(chunks["stdout"]), "stderr": bytes(chunks["stderr"])}')
exec(_RESULT_SOURCE)


def _runner(argv,input_bytes=None):
    return capture(argv,LIMIT,180,input_bytes=input_bytes)


def _cli(action,*parts):
    return ('/usr/local/bin/eru-cli','--eru',action['render']['hosts'][0]['ip']+':5001','--output','json')+parts


def quantity(value):
    m=re.fullmatch(r'([1-9][0-9]*)([KMGT]?)(i?B?)',value)
    if m is None: raise ValueError(ERROR)
    return int(m[1])*(1024 if m[3].startswith('i') else 1000)**{'':0,'K':1,'M':2,'G':3,'T':4}[m[2]]


def canary(action,mode='bridge'):
    node=action['node']
    if node not in ('worker-2','worker-3','worker-4') or mode not in ('bridge','host','memory','storage'): raise ValueError(ERROR)
    name='erumvp'+digest((action['run_id']+'\0'+node+'\0'+mode).encode())[:12]
    import json
    text='appname: '+json.dumps(name)+'\nentrypoints:\n  web:\n    commands: [nginx, -g, "daemon off;"]\n    restart: always\n    publish: ["80"]\nlabels:\n  owner: eru-vps-mvp\n  run: '+json.dumps(action['run_id'])+'\n  fresh_canary: '+json.dumps(mode)+'\n'
    return name,text


def validate_request(value):
    if type(value) is not dict: raise ValueError(ERROR)
    fields={'schema_version','operation','action'}
    if value.get('operation')=='capture': fields.add('capture_index')
    if value.get('operation')=='dispatch': fields.add('intent_sha256')
    exact(value,fields)
    if type(value['schema_version']) is not int or value['schema_version']!=1 or value['operation'] not in ('capture','observe','dispatch'): raise ValueError(ERROR)
    contract.validate_action(value['action'])
    if value['operation']=='capture' and (type(value['capture_index']) is not int or not 0<=value['capture_index']<4): raise ValueError(ERROR)
    if value['operation']=='dispatch':
        contract.sha256(value['intent_sha256'])
        if value['action']['step'] in contract.READONLY: raise ValueError(ERROR)
    if len(canonical(value))>WIRE_LIMIT: raise ValueError(ERROR)
    return copy.deepcopy(value)


def _invoke(runner,argv,input_bytes=None):
    value=runner(tuple(argv),input_bytes=input_bytes)
    exact(value,{'exit_code','stdout','stderr'})
    if type(value['exit_code']) is not int or not -255<=value['exit_code']<=255 or any(type(value[k]) is not bytes for k in ('stdout','stderr')) or sum(len(value[k]) for k in ('stdout','stderr'))>LIMIT: raise ValueError(ERROR)
    return {'argv':list(argv),'exit_code':value['exit_code'],'stdout_base64':base64.b64encode(value['stdout']).decode(),'stderr_base64':base64.b64encode(value['stderr']).decode()}


def raw_result(value,expected=None):
    exact(value,{'argv','exit_code','stdout_base64','stderr_base64'})
    if type(value['argv']) is not list or any(type(v) is not str for v in value['argv']) or type(value['exit_code']) is not int or expected is not None and value['argv']!=list(expected): raise ValueError(ERROR)
    streams=[]
    for key in ('stdout_base64','stderr_base64'):
        raw=base64.b64decode(value[key],validate=True)
        if base64.b64encode(raw).decode()!=value[key] or len(raw)>LIMIT: raise ValueError(ERROR)
        streams.append(raw)
    return value['exit_code'],*streams


def _output(runner,argv):
    record=_invoke(runner,argv); code,raw,_=raw_result(record)
    if code!=0: raise ValueError(ERROR)
    return record,raw


def _identity(session,host):
    key=session.data('etc/ssh/ssh_host_ed25519_key.pub').decode().split()
    value={'machine_id':session.data('etc/machine-id').decode().strip(),'boot_id':session.data('proc/sys/kernel/random/boot_id').decode().strip(),'host_key_sha256':public_key(' '.join(key[:2]))}
    if value!={k:host[k] for k in contract.HOST_FIELDS}: raise ValueError(ERROR)
    return value


def _tree(session,path):
    if not session.exists(path): return []
    result=[]
    def walk(parent,depth):
        import stat
        if depth>8: raise ValueError(ERROR)
        for name in sorted(os.listdir(session.ensure(parent))):
            if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,255}',name): raise ValueError(ERROR)
            target=parent+'/'+name; row=os.stat(name,dir_fd=session.dirs[parent],follow_symlinks=False)
            if stat.S_ISDIR(row.st_mode):
                session.ensure(target)
                result.append({'path':'/'+target,'sha256':None,'raw_base64':None,'kind':'directory'})
                walk(target,depth+1)
            else:
                raw=session.data(target)
                if len(raw)>1024*1024: raise ValueError(ERROR)
                result.append({'path':'/'+target,'sha256':digest(raw),'raw_base64':base64.b64encode(raw).decode(),'kind':'file'})
            if len(result)>4096: raise ValueError(ERROR)
    walk(path,0)
    return result


def _http_program(wid,spec,host_mode=False):
    import json
    payload={'workload_id':wid,'port':spec['service']['port'],'path':spec['service']['path'],'body_contains':spec['service']['body_contains']}
    return ('import http.client,ipaddress,json,subprocess\ndata=json.loads('+repr(json.dumps(payload))+')\n'
        'info=subprocess.run(["ctr","--namespace","eru","containers","info",data["workload_id"]],capture_output=True,text=True,check=True,timeout=10)\ncontainer=json.loads(info.stdout)\n'
        'address="127.0.0.1" if '+repr(host_mode)+' else str(ipaddress.ip_address(container["Labels"]["eru.network.eru"]))\n'
        'connection=http.client.HTTPConnection(address,data["port"],timeout=5)\ntry:\n connection.request("GET",data["path"],headers={"Connection":"close"})\n response=connection.getresponse()\n body=response.read(1048577)\n assert len(body)<=1048576\n print(json.dumps({"status":response.status,"body_match":data["body_contains"] in body.decode("utf-8",errors="replace")}))\nfinally:connection.close()\n').encode()


def collect_capture(action,index,*,root='/',owner_uid=0,owner_gid=0,runner=None,now=None):
    runner=runner or _runner; local={**action,'host':action['render']['hosts'][index]}
    session=_Session(root,owner_uid,owner_gid,local)
    try:
        started=_time(now)
        identity=_identity(session,local['host']); commands={}
        if index==0:
            for name,parts in CORE_COMMANDS.items(): commands[name]=_output(runner,_cli(action,*parts))[0]
            for name,parts in (('status',('endpoint','status')),('members',('member','list')),('keys',('get','','--from-key'))): commands[name]=_output(runner,ETCD+parts)[0]
        else:
            for name,parts in (('containers',('containers','list','-q')),('tasks',('tasks','list','-q'))): commands[name]=_output(runner,('/usr/bin/ctr','--namespace','eru')+parts)[0]
            ids=raw_result(commands['containers'])[1].decode().splitlines()
            for wid in ids:
                if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}',wid): raise ValueError(ERROR)
                commands['info:'+wid]=_output(runner,('/usr/bin/ctr','--namespace','eru','containers','info',wid))[0]
            if action['step'] in ('app-ready','bridge-http','host-http','residue-accept','apps-accept','resources-accept','quota-accept'):
                desired=[]
                for document in action['desired_apps']:
                    spec,_,name=apps.spec_identity(document)
                    if spec['node']==local['host']['node']: desired.append((name,spec,False))
                if action['step'] in ('bridge-http','host-http') and action['node']==local['host']['node']:
                    mode='host' if action['step']=='host-http' else 'bridge'; name,_=canary(action,mode)
                    desired.append((name,{'service':{'port':80,'path':'/','expected_status':200,'body_contains':'Welcome to nginx!'}},mode=='host'))
                for name,spec,mode in desired:
                    for wid in ids:
                        info=_decode(raw_result(commands['info:'+wid])[1],LIMIT)
                        if 'name' in spec:
                            _,spec_sha,_=apps.spec_identity(spec)
                            labels={'owner':apps.OWNER,'logical_app':spec['name'],'spec_sha256':spec_sha}
                        else:
                            labels={'owner':apps.OWNER,'run':action['run_id'],'fresh_canary':'host' if mode else 'bridge'}
                        if info.get('Image')==spec.get('image',action['canary_image']) and all(info.get('Labels',{}).get(k)==v for k,v in labels.items()):
                            commands['http:'+wid]=_invoke(runner,('/usr/bin/python3','-'),_http_program(wid,spec,mode))
        value={'index':index,'identity':identity,'started_at':started,'completed_at':_time(now),'commands':commands,'cni':_tree(session,'var/lib/cni/networks/eru') if index else [],'workload_files':_tree(session,'run/eru/workloads') if index else []}
        _identity(session,local['host']); session.check(); return value
    finally: session.close()


def _snapshot(evidence,action):
    captures=evidence['captures']
    if type(captures) is not list or len(captures)!=4: raise ValueError(ERROR)
    for i,row in enumerate(captures):
        exact(row,{'index','identity','started_at','completed_at','commands','cni','workload_files'})
        if contract.timestamp(row['started_at'])>contract.timestamp(row['completed_at']): raise ValueError('capture timing reversed')
        if type(row['index']) is not int or row['index']!=i or row['identity']!={k:action['render']['hosts'][i][k] for k in contract.HOST_FIELDS}: raise ValueError(ERROR)
    core=captures[0]['commands']
    def parsed(name,argv):
        code,raw,_=raw_result(core[name],argv)
        if code!=0: raise ValueError(ERROR)
        return _decode(raw,LIMIT)
    snapshot={name:parsed(name,_cli(action,*parts)) or [] for name,parts in CORE_COMMANDS.items()}
    for name,parts in (('status',('endpoint','status')),('members',('member','list')),('keys',('get','','--from-key'))): snapshot[name]=parsed(name,ETCD+parts)
    if len(snapshot['pods'])!=1 or snapshot['pods'][0].get('name')!='eru': raise ValueError(ERROR)
    nodes=snapshot['nodes']; workers=action['render']['workers']
    if len(nodes)!=3 or len({n.get('name') for n in nodes})!=3: raise ValueError(ERROR)
    for node,want in zip(sorted(nodes,key=lambda r:r['name']),sorted(workers,key=lambda r:r['node'])):
        if any(node.get(k)!=want[k] for k in ('podname','endpoint','labels')) or node.get('name')!=want['node'] or node.get('available') is not True or node.get('bypass',False) is not False: raise ValueError(ERROR)
        resources=_cli_resources(node)
        if resources['resource_capacity']!=want['resource_capacity']: raise ValueError(ERROR)
    status=snapshot['status']
    if type(status) is not list or len(status)!=1: raise ValueError(ERROR)
    current_status=status[0]['Status']
    header=current_status['header']; wanted=action['bootstrap_facts']['etcd']
    if status[0].get('Endpoint')!='http://127.0.0.1:2379' or current_status.get('errors') or type(current_status.get('leader')) is not int or current_status['leader']!=header['member_id']: raise ValueError('current etcd is not the exact healthy single leader')
    if str(header['cluster_id'])!=wanted['cluster_id'] or str(header['member_id'])!=wanted['member_id'] or any(type(header[k]) is not int for k in ('cluster_id','member_id','revision')): raise ValueError(ERROR)
    keys=snapshot['keys']; members=snapshot['members']
    for h in (keys['header'],members['header']):
        if any(type(h[k]) is not int or h[k]!=header[k] for k in ('cluster_id','member_id')): raise ValueError(ERROR)
    if len(members['members'])!=1 or type(members['members'][0]['ID']) is not int or str(members['members'][0]['ID'])!=wanted['member_id']: raise ValueError(ERROR)
    kvs=keys.get('kvs',[])
    if keys.get('more',False) is not False or type(keys.get('count',0)) is not int or keys.get('count',0)!=len(kvs) or len(kvs)>4096: raise ValueError(ERROR)
    decoded={}
    for kv in kvs:
        k=base64.b64decode(kv['key'],validate=True); v=base64.b64decode(kv.get('value',''),validate=True)
        if not k or k.decode() in decoded or base64.b64encode(k).decode()!=kv['key']: raise ValueError(ERROR)
        decoded[k.decode()]=v.decode()
    snapshot['metadata']=decoded; snapshot['nodes']=sorted(nodes,key=lambda r:r['name']); snapshot['workloads']=sorted(snapshot['workloads'],key=lambda r:r['id'])
    ids=[r.get('id') for r in snapshot['workloads']]
    if any(type(w) is not str for w in ids) or len(set(ids))!=len(ids): raise ValueError(ERROR)
    if any(not key.startswith(('/eru/','/eru-storage/')) for key in decoded): raise ValueError('unknown entire-keyspace metadata')
    for old_id in action['bootstrap_facts'].get('prior_workload_ids',[]):
        if old_id in ids or any(old_id in key or old_id in value for key,value in decoded.items()): raise ValueError('prior workload/runtime incarnation residue')
    validate_owned_rows(snapshot,action)
    validate_metadata_identities(snapshot,action)
    for index,worker in enumerate(workers,1):
        commands=captures[index]['commands']
        expected={r['id'] for r in snapshot['workloads'] if r['nodename']==worker['node']}
        observed_sets={}
        for name in ('containers','tasks'):
            code,raw,_=raw_result(commands[name],('/usr/bin/ctr','--namespace','eru',name,'list','-q'))
            values=raw.decode().splitlines()
            if code!=0 or len(set(values))!=len(values): raise ValueError(ERROR)
            observed_sets[name]=set(values)
        if observed_sets['containers']!=expected or not observed_sets['tasks']<=expected: raise ValueError('current runtime/metadata identity drift')
        for row in (r for r in snapshot['workloads'] if r['nodename']==worker['node']):
            if row.get('status',{}) and _status(row['status'],row['id'])['running']!=(row['id'] in observed_sets['tasks']): raise ValueError('stored/CLI status running differs from runtime task')
            code,raw,_=raw_result(commands['info:'+row['id']],('/usr/bin/ctr','--namespace','eru','containers','info',row['id']))
            info=_decode(raw,LIMIT)
            if code!=0 or info.get('ID')!=row['id'] or info.get('Image')!=row['image'] or any(info.get('Labels',{}).get(k)!=v for k,v in row['labels'].items()): raise ValueError('current runtime image/ownership drift')
    return snapshot


# Pinned v0.1.5 store/common keys and types.Workload, CPUMEM types.
IDENTITY_FIELDS=('id','name','podname','nodename','image','labels')
CLI_WORKLOAD_FIELDS=set(IDENTITY_FIELDS)|{'privileged','publish','status','create_time','env','resources'}
WORKLOAD_FIELDS=set(IDENTITY_FIELDS)|{'resources','engine_params','hook','privileged','user','env','create_time'}
NODE_RESOURCE_FIELDS={'cpu','cpu_map','memory','numa_memory','numa'}
WORKLOAD_RESOURCE_FIELDS={'cpu_request','cpu_limit','memory_request','memory_limit','cpu_map','numa_memory','numa_node'}


def _number(value,integer=False):
    import math
    if type(value) not in ((int,) if integer else (int,float)) or value<0 or not math.isfinite(value): raise ValueError('invalid resource number')
    return value


def _map(value,string=False):
    if type(value) is not dict or any(type(k) is not str or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,255}',k) for k in value): raise ValueError('invalid resource map')
    for v in value.values():
        if string:
            if type(v) is not str or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,255}',v): raise ValueError('invalid NUMA identity')
        else: _number(v,True)
    return value


def _node_resource(value):
    exact(value,NODE_RESOURCE_FIELDS)
    _number(value['cpu']); _number(value['memory'],True)
    for k in ('cpu_map','numa_memory'): _map(value[k])
    _map(value['numa'],True)
    return value


def _workload_resources(data,row,action):
    exact(data['resources'],{'cpumem','resource-storage'}); exact(data['engine_params'],{'cpumem','resource-storage'})
    resource=data['resources']['cpumem']; exact(resource,WORKLOAD_RESOURCE_FIELDS)
    for k in ('cpu_request','cpu_limit'): _number(resource[k])
    for k in ('memory_request','memory_limit'): _number(resource[k],True)
    for k in ('cpu_map','numa_memory'):
        if resource[k] is not None: _map(resource[k])
    if type(resource['numa_node']) is not str: raise ValueError('invalid workload NUMA identity')
    spec=next((d for d in action['desired_apps'] if apps.revision_matches(row,apps.spec_identity(d)[2],d['entrypoint'])),None)
    want=spec['resources'] if spec else {'cpu':1,'memory':'256M','storage':'1G'}
    if resource['cpu_request']!=want['cpu'] or resource['cpu_limit']!=want['cpu'] or resource['memory_request']!=quantity(want['memory']) or resource['memory_limit']!=quantity(want['memory']): raise ValueError('stored workload resources differ from exact request')
    engine=data['engine_params']['cpumem']; exact(engine,{'cpu','cpu_map','numa_node','memory','remap'})
    _number(engine['cpu']);_number(engine['memory'],True)
    if engine['cpu_map'] is not None: _map(engine['cpu_map'])
    if type(engine['remap']) is not bool or type(engine['numa_node']) is not str: raise ValueError('unknown CPUMEM engine types')
    if engine!={'cpu':resource['cpu_limit'],'cpu_map':resource['cpu_map'],'numa_node':resource['numa_node'],'memory':resource['memory_limit'],'remap':False}: raise ValueError('stored engine params differ from resources')
    storage=data['resources']['resource-storage']
    storage_want={'volumes_request':[],'volumes_limit':[],'volume_plan_request':{},'volume_plan_limit':{},'storage_request':quantity(want['storage']),'storage_limit':quantity(want['storage']),'disks_request':[],'disks_limit':[]}
    exact(storage,set(storage_want))
    for key in ('storage_request','storage_limit'): _number(storage[key],True)
    if storage!=storage_want: raise ValueError('unknown or differing workload storage allocation')
    storage_engine=data['engine_params']['resource-storage']
    exact(storage_engine,{'volumes','volume_changed','storage','iops_options'})
    _number(storage_engine['storage'],True)
    if type(storage_engine['volume_changed']) is not bool: raise ValueError('invalid storage engine boolean')
    if storage_engine!={'volumes':None,'volume_changed':False,'storage':quantity(want['storage']),'iops_options':{}}: raise ValueError('unknown or differing storage engine allocation')
    return resource


def _storage_resource(value):
    exact(value,{'volumes','disks','storage'}); _number(value['storage'],True)
    if value['volumes']!={} or value['disks']!=[]: raise ValueError('unreviewed storage volume/disk topology')
    return value


def _cpu_add(left,right):
    import math
    return math.floor((left+right)*1000000000+0.5)/1000000000


def _cpu_repeat(initial,value,count):
    for _ in range(count):initial=_cpu_add(initial,value)
    return initial


def _status(value,wid):
    fields={'id','networks','running','healthy','extension'}
    if type(value) is not dict or 'id' not in value or set(value)-fields or value['id']!=wid: raise ValueError('unknown or foreign workload status schema')
    for key in ('running','healthy'):
        if key in value and type(value[key]) is not bool: raise ValueError('invalid workload status boolean')
    networks=value.get('networks',{})
    if type(networks) is not dict or any(type(k) is not str or not k or len(k)>255 or type(v) is not str or len(v)>1024 for k,v in networks.items()): raise ValueError('invalid workload status networks')
    extension=value.get('extension','')
    if type(extension) is not str: raise ValueError('invalid workload status extension')
    try:raw=base64.b64decode(extension,validate=True)
    except Exception:raise ValueError('invalid workload status extension') from None
    if len(raw)>LIMIT or base64.b64encode(raw).decode()!=extension: raise ValueError('invalid workload status extension')
    return {'id':wid,'running':value.get('running',False),'healthy':value.get('healthy',False),'networks':networks,'extension':extension}


def _status_key(row):
    app,entry,_=apps.workload_name(row)
    return '/eru/status/'+app+'/'+entry+'/'+row['nodename']+'/'+row['id']


def validate_metadata_identities(snapshot,action):
    if 'keys' not in action['bootstrap_facts']['etcd']: raise ValueError('missing original bootstrap keyspace')
    baseline={base64.b64decode(kv['key'],validate=True).decode():base64.b64decode(kv.get('value',''),validate=True).decode() for kv in action['bootstrap_facts']['etcd']['keys']}
    metadata=snapshot['metadata']; expected_keys=set(baseline); resources={}
    for row in snapshot['workloads']:
        if set(row)-CLI_WORKLOAD_FIELDS: raise ValueError('unknown CLI workload projection fields')
        if not set(IDENTITY_FIELDS)<=set(row) or any(type(row[k]) is not str for k in IDENTITY_FIELDS if k!='labels') or type(row['labels']) is not dict or any(type(k) is not str or type(v) is not str for k,v in row['labels'].items()): raise ValueError('missing or malformed source workload identity')
        identity=apps.workload_name(row)
        if identity is None or any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}',v) for v in (*identity,row['id'],row['nodename'])): raise ValueError('unsafe stored workload identity')
        app,entry,_=identity; wid=row['id']; node=row['nodename']
        keys=('/eru/workloads/'+wid,'/eru/node/'+node+':workloads/'+wid,'/eru/deploy/'+app+'/'+entry+'/'+node+'/'+wid)
        if any(k in baseline or k not in metadata for k in keys): raise ValueError('missing or conflicting canonical workload keys')
        if len({metadata[k] for k in keys})!=1: raise ValueError('canonical workload raw records differ')
        data=_decode(metadata[keys[0]].encode(),LIMIT); exact(data,WORKLOAD_FIELDS)
        if any(data[k]!=row[k] for k in IDENTITY_FIELDS): raise ValueError('stored workload identity differs from CLI')
        if row.get('privileged',False) is not False or row.get('env',[]) not in (None,[]) or ('create_time' in row and (type(row['create_time']) is not int or row['create_time']!=data['create_time'])): raise ValueError('CLI workload execution defaults differ')
        if data['hook'] is not None or data['privileged'] is not False or data['user']!='root' or data['env'] not in (None,[]) or type(data['create_time']) is not int or data['create_time']<=0: raise ValueError('unknown stored workload execution schema')
        if type(row.get('resources')) is not str or _decode(row['resources'].encode(),LIMIT)!=data['resources']: raise ValueError('CLI resource JSON differs from stored workload')
        resources[wid]=_workload_resources(data,row,action); expected_keys.update(keys)
        status_key=_status_key(row);cli_status=row.get('status',{})
        if status_key in metadata:
            status=_status(_decode(metadata[status_key].encode(),LIMIT),wid)
            if _status(cli_status,wid)!=status: raise ValueError('CLI status differs from exact associated stored status')
            expected_keys.add(status_key)
        elif cli_status!={}: raise ValueError('CLI status has no associated stored status')
    if set(metadata)!=expected_keys: raise ValueError('unknown or missing metadata key')
    mutable=set()
    for node in snapshot['nodes']:
        name=node['name']; static={'name':name,**{k:node[k] for k in ('podname','endpoint','labels')}}
        for key in ('/eru/node/'+name,'/eru/node/'+node['podname']+':pod/'+name):
            if key not in baseline: raise ValueError('missing original static node record')
            prior=_decode(baseline[key].encode(),LIMIT); current=_decode(metadata[key].encode(),LIMIT)
            if type(prior) is not dict or not set(static)<=set(prior) or set(prior)-set(static)-{'bypass','test'} or any(type(prior[k]) is not bool for k in set(prior)-set(static)) or any(prior[k]!=v for k,v in static.items()) or current!=prior: raise ValueError('static node schema/identity changed')
        key='/eru/resource/cpumem/'+name
        if key not in baseline: raise ValueError('missing original CPUMEM ledger')
        prior=_decode(baseline[key].encode(),LIMIT); current=_decode(metadata[key].encode(),LIMIT)
        for value in (prior,current):
            exact(value,{'capacity','usage'}); _node_resource(value['capacity']); _node_resource(value['usage'])
        cap=prior['capacity']; zero={'cpu':0,'memory':0,'cpu_map':{k:0 for k in cap['cpu_map']},'numa_memory':{k:0 for k in cap['numa_memory']},'numa':cap['numa']}
        expected=copy.deepcopy(zero)
        for row in snapshot['workloads']:
            if row['nodename']!=name: continue
            res=resources[row['id']]; expected['cpu']=_cpu_add(expected['cpu'],res['cpu_request']); expected['memory']+=res['memory_request']
            for source,target in (('cpu_map','cpu_map'),('numa_memory','numa_memory')):
                for k,v in (res[source] or {}).items():
                    if k not in expected[target]: raise ValueError('unknown allocation topology')
                    expected[target][k]+=v
            if res['numa_node'] and res['numa_node'] not in cap['numa_memory']: raise ValueError('unknown workload NUMA node')
        if prior['usage']!=zero or current['capacity']!=cap or current['usage']!=expected: raise ValueError('CPUMEM ledger differs from exact owned resources')
        for k in ('cpu','memory'):
            if expected[k]>cap[k] or _cli_resources(node)['resource_capacity']['cpumem'][k]!=cap[k] or _cli_resources(node)['resource_usage']['cpumem'][k]!=expected[k]: raise ValueError('CPUMEM CLI/capacity ledger differs')
        for k in ('cpu_map','numa_memory'):
            if any(v>cap[k][i] for i,v in expected[k].items()): raise ValueError('CPUMEM allocation exceeds capacity')
        if _cli_resources(node)['resource_capacity']['cpumem']!=cap or _cli_resources(node)['resource_usage']['cpumem']!=expected: raise ValueError('raw CLI CPUMEM topology differs')
        storage_key='/eru-storage/resource/storage/'+name
        if storage_key not in baseline: raise ValueError('missing original storage ledger')
        storage_prior=_decode(baseline[storage_key].encode(),LIMIT);storage_current=_decode(metadata[storage_key].encode(),LIMIT)
        for value in (storage_prior,storage_current):
            exact(value,{'capacity','usage'});_storage_resource(value['capacity']);_storage_resource(value['usage'])
        wanted_storage={'volumes':{},'disks':[],'storage':expected_usage(snapshot,action,name)['storage']['storage']}
        if storage_prior['usage']!={'volumes':{},'disks':[],'storage':0} or storage_current['capacity']!=storage_prior['capacity'] or storage_current['usage']!=wanted_storage or wanted_storage['storage']>storage_prior['capacity']['storage']: raise ValueError('storage ledger differs from exact requests')
        if _cli_resources(node)['resource_capacity']['resource-storage']!=storage_prior['capacity'] or _cli_resources(node)['resource_usage']['resource-storage']!=wanted_storage: raise ValueError('raw CLI storage topology differs')
        mutable.add(storage_key)
        projected={'cpumem':{k:expected[k] for k in ('cpu','memory')},'storage':{'storage':wanted_storage['storage']}}
        if projected!=expected_usage(snapshot,action,name): raise ValueError('CLI plugin usage differs from exact desired request')
        mutable.add(key)
    for key in set(baseline)-mutable:
        if metadata[key]!=baseline[key]: raise ValueError('immutable original metadata bytes changed')


def validate_owned_rows(snapshot,action):
    desired={apps.spec_identity(d)[2]:(d,apps.spec_identity(d)[1]) for d in action['desired_apps']}
    for row in snapshot['workloads']:
        wid=row['id']; labels=row.get('labels',{})
        if type(labels) is not dict or type(row.get('name')) is not str: raise ValueError('unknown workload identity schema')
        if labels.get('owner')!=apps.OWNER: raise ValueError('unknown workload owner')
        matching=[(name,spec,h) for name,(spec,h) in desired.items() if apps.revision_matches(row,name,spec['entrypoint'])]
        if matching:
            _,spec,h=matching[0]
            if row.get('nodename')!=spec['node'] or row.get('image')!=spec['image'] or labels.get('logical_app')!=spec['name'] or labels.get('spec_sha256')!=h: raise ValueError('desired identity/spec/image differs')
            continue
        mode=labels.get('fresh_canary'); node=row.get('nodename')
        if labels.get('run')!=action['run_id'] or mode not in ('bridge','host','memory','storage') or node not in ('worker-2','worker-3','worker-4'): raise ValueError('unknown canary identity')
        name,_=canary({**action,'node':node},mode)
        if not apps.revision_matches(row,name,'web') or row.get('image')!=action['canary_image']: raise ValueError(ERROR)


def _rows(snapshot,action,mode='bridge'):
    name,_=canary(action,mode); rows=[r for r in snapshot['workloads'] if apps.revision_matches(r,name,'web')]
    for row in rows:
        labels=row.get('labels',{})
        if row.get('nodename')!=action['node'] or labels.get('owner')!=apps.OWNER or labels.get('run')!=action['run_id'] or labels.get('fresh_canary')!=mode: raise ValueError(ERROR)
    if len(rows)>1: raise ValueError(ERROR)
    return rows


def _desired(snapshot,action,readiness=False):
    from app_executor import _safe_revision_rows
    wanted=[]
    for document in action['desired_apps']:
        spec,h,name=apps.spec_identity(document); rows=[r for r in snapshot['workloads'] if apps.revision_matches(r,name,spec['entrypoint'])]
        if not _safe_revision_rows(rows,{'spec':spec,'spec_sha256':h,'appname':name,'logical_app':spec['name']})[0] or any(r.get('image')!=spec['image'] for r in rows): raise ValueError(ERROR)
        wanted+=rows
    if readiness: _runtime(snapshot,action,wanted,require_http=True)
    return wanted


def _runtime(snapshot,action,rows,require_http=False,exact_ids=False):
    captures=snapshot['_captures']
    for i,worker in enumerate(action['render']['workers'],1):
        expected={r['id'] for r in rows if r['nodename']==worker['node']}; commands=captures[i]['commands']; actual={}
        for name,part in (('containers','containers'),('tasks','tasks')):
            code,raw,_=raw_result(commands[name],('/usr/bin/ctr','--namespace','eru',part,'list','-q')); ids=raw.decode().splitlines()
            if code!=0 or len(set(ids))!=len(ids): raise ValueError(ERROR)
            actual[name]=set(ids)
            if exact_ids and set(ids)!=expected or not expected<=set(ids): raise ValueError(ERROR)
        if not actual['tasks']<=actual['containers']: raise ValueError(ERROR)
        for row in (r for r in rows if r['nodename']==worker['node']):
            code,raw,_=raw_result(commands['info:'+row['id']],('/usr/bin/ctr','--namespace','eru','containers','info',row['id'])); info=_decode(raw,LIMIT)
            if code!=0 or info.get('ID')!=row['id'] or info.get('Image')!=row['image'] or any(info.get('Labels',{}).get(k)!=v for k,v in row['labels'].items()): raise ValueError(ERROR)
            if require_http:
                code,raw,_=raw_result(commands['http:'+row['id']],('/usr/bin/python3','-')); result=_decode(raw,LIMIT)
                desired=next((d for d in action['desired_apps'] if d['name']==row['labels'].get('logical_app')),None); status=desired['service']['expected_status'] if desired else 200
                if code!=0 or result!={'status':status,'body_match':True}: raise ValueError(ERROR)
        if exact_ids:
            allocations=set()
            for field in ('cni','workload_files'):
                for entry in captures[i][field]:
                    exact(entry,{'path','sha256','raw_base64','kind'})
                    if entry['kind']=='directory':
                        if entry['sha256'] is not None or entry['raw_base64'] is not None or field=='cni' or not any(wid in entry['path'] for wid in expected): raise ValueError(ERROR)
                        continue
                    if entry['kind']!='file': raise ValueError(ERROR)
                    raw=base64.b64decode(entry['raw_base64'],validate=True)
                    if digest(raw)!=entry['sha256']: raise ValueError(ERROR)
                    basename=entry['path'].rsplit('/',1)[-1]
                    if field=='cni' and basename in ('lock','last_reserved_ip.0'): continue
                    if field=='cni':
                        ipaddress.IPv4Address(basename)
                        values=raw.decode().strip().splitlines()
                        if not values or values[0] not in expected: raise ValueError(ERROR)
                        allocations.add(values[0])
                    if field=='workload_files' and not any(wid in entry['path'] for wid in expected): raise ValueError(ERROR)
            if allocations!=expected: raise ValueError('exact desired CNI allocation identities differ')



def expected_usage(snapshot,action,node):
    result={'cpumem':{'cpu':0,'memory':0},'storage':{'storage':0}}
    for row in snapshot['workloads']:
        if row['nodename']!=node: continue
        document=next((d for d in action['desired_apps'] if apps.revision_matches(row,apps.spec_identity(d)[2],d['entrypoint'])),None)
        if document is not None:
            resources=document['resources']
        elif row['labels'].get('fresh_canary') in ('bridge','host'):
            resources={'cpu':1,'memory':'256M','storage':'1G'}
        else:
            raise ValueError('rejected resource canary exists in exact node ledger')
        result['cpumem']['cpu']=_cpu_add(result['cpumem']['cpu'],resources['cpu'])
        result['cpumem']['memory']+=quantity(resources['memory'])
        result['storage']['storage']+=quantity(resources['storage'])
    return result


def _cli_resources(node):
    result={}
    for field in ('resource_capacity','resource_usage'):
        if type(node.get(field)) is not str: raise ValueError('CLI resource projection is not raw JSON text')
        value=_decode(node[field].encode(),LIMIT); exact(value,{'cpumem','resource-storage'})
        _node_resource(value['cpumem']);_storage_resource(value['resource-storage']);result[field]=value
    return result


def validate_quotas(snapshot,action):
    for node in snapshot['nodes']:
        expected={'cpumem':{'cpu':0,'memory':0},'storage':{'storage':0}}
        for spec in action['desired_apps']:
            if spec['node']!=node['name']: continue
            expected['cpumem']['cpu']=_cpu_repeat(expected['cpumem']['cpu'],spec['resources']['cpu'],spec['replicas']); expected['cpumem']['memory']+=quantity(spec['resources']['memory'])*spec['replicas']; expected['storage']['storage']+=quantity(spec['resources']['storage'])*spec['replicas']
        resources=_cli_resources(node)
        for key in ('cpu','memory'):
            if resources['resource_usage']['cpumem'][key]!=expected['cpumem'][key] or expected['cpumem'][key]>resources['resource_capacity']['cpumem'][key]: raise ValueError('exact legal CPUMEM ledger differs')
        if resources['resource_usage']['resource-storage']['storage']!=expected['storage']['storage'] or expected['storage']['storage']>resources['resource_capacity']['resource-storage']['storage']: raise ValueError('exact legal storage ledger differs')


def _deploy_argv(action,snapshot,spec_path):
    step=action['step']
    if step=='app-deploy':
        spec=apps.validate_spec(action['desired_apps'][action['app_index']])
        return _cli(action,'workload','deploy','--pod','eru','--node',spec['node'],'--entry',spec['entrypoint'],'--image',spec['image'],'--network','eru','--count',str(spec['replicas']),'--cpu',format(spec['resources']['cpu'],'.15g'),'--memory',spec['resources']['memory'],'--storage',spec['resources']['storage'],spec_path)
    memory,storage='256M','1G'
    if step in ('memory-reject','storage-reject'):
        capacity=_cli_resources(next(n for n in snapshot['nodes'] if n['name']==action['node']))['resource_capacity']
        if max(int(capacity['cpumem']['memory']),int(capacity['resource-storage']['storage']))>1024**5: raise ValueError(ERROR)
        if step=='memory-reject': memory=str(int(capacity['cpumem']['memory'])+1)+'B'
        else: storage=str(int(capacity['resource-storage']['storage'])+1)+'B'
    return _cli(action,'workload','deploy','--pod','eru','--node',action['node'],'--entry','web','--image',action['canary_image'],'--network','host' if step=='host-deploy' else 'eru','--count','1','--cpu','1','--memory',memory,'--storage',storage,spec_path)


def validate_evidence(action,observed,*,before=False):
    contract.validate_action(action); evidence=observed['evidence']; exact(evidence,{'captures','result','child_plan'})
    snapshot=_snapshot(evidence,action); snapshot['_captures']=evidence['captures']; step=action['step']; before=before and step not in contract.READONLY
    child=evidence['child_plan']
    if child is not None:
        if action['app_index'] is None: raise ValueError(ERROR)
        from app_executor import execution_plan, plan_digest as child_digest
        spec=action['desired_apps'][action['app_index']]
        if step=='app-deploy':
            normalized,h,name=apps.spec_identity(spec)
            if child['plan_sha256']!=child_digest(child) or child['spec']!=normalized or child['spec_sha256']!=h or child['appname']!=name or child['action']!='deploy_revision' or not child['executable']: raise ValueError(ERROR)
        elif child!=execution_plan(spec,snapshot,True,[],plan_id=child['id']): raise ValueError(ERROR)
    if step=='child-plan' and (child is None or not child['executable'] or child['action']!='deploy_revision'): raise ValueError(ERROR)
    if before:
        if evidence['result'] is not None: raise ValueError(ERROR)
        if step=='app-deploy':
            planned=apps.build_plan(action['desired_apps'][action['app_index']],snapshot)
            if planned['action']!='deploy_revision' or planned['decision']!='reviewable': raise ValueError(ERROR)
        if step in ('bridge-deploy','host-deploy','memory-reject','storage-reject') and _rows(snapshot,action,{'bridge-deploy':'bridge','host-deploy':'host','memory-reject':'memory','storage-reject':'storage'}[step]): raise ValueError(ERROR)
        return snapshot
    if step=='app-ready':
        from app_executor import _safe_revision_rows
        spec,h,name=apps.spec_identity(action['desired_apps'][action['app_index']]); rows=[r for r in snapshot['workloads'] if apps.revision_matches(r,name,spec['entrypoint'])]
        if not _safe_revision_rows(rows,{'spec':spec,'spec_sha256':h,'appname':name,'logical_app':spec['name']})[0]: raise ValueError(ERROR)
        _runtime(snapshot,action,rows,require_http=True)
    if step in ('apps-accept','quota-accept','resources-accept','residue-accept'):
        rows=_desired(snapshot,action,readiness=True)
        if len(rows)!=len(snapshot['workloads']): raise ValueError(ERROR)
        _runtime(snapshot,action,rows,require_http=True,exact_ids=True); validate_quotas(snapshot,action)
    if step in ('bridge-http','host-http'):
        rows=_rows(snapshot,action,'host' if step=='host-http' else 'bridge')
        if len(rows)!=1: raise ValueError(ERROR)
        _runtime(snapshot,action,rows,require_http=True)
    if step in ('canary-get','canary-logs'):
        rows=_rows(snapshot,action)
        if len(rows)!=1 or evidence['result'] is None: raise ValueError(ERROR)
        parts=('workload','get',rows[0]['id']) if step=='canary-get' else ('workload','logs','--tail','30',rows[0]['id'])
        code,raw,err=raw_result(evidence['result'],_cli(action,*parts))
        if code!=0 or step=='canary-logs' and b'GET / HTTP/' not in raw+err: raise ValueError(ERROR)
        if step=='canary-get':
            value=_decode(raw,LIMIT)
            values=value if type(value) is list else [value] if type(value) is dict else []
            if len(values)!=1 or values[0].get('id')!=rows[0]['id']: raise ValueError(ERROR)
    if step not in contract.READONLY:
        if evidence['result'] is None: raise ValueError(ERROR)
        code,raw,err=raw_result(evidence['result'])
        if step in ('app-cache','canary-cache'):
            image=action['desired_apps'][action['app_index']]['image'] if step=='app-cache' else action['canary_image']; raw_result(evidence['result'],_cli(action,'image','cache','--node',action['node'],image))
        if step in ('app-deploy','bridge-deploy','host-deploy','memory-reject','storage-reject'): raw_result(evidence['result'],_deploy_argv(action,snapshot,'/'+_slot(action)+'/spec.yaml'))
        if step=='canary-exec':
            rows=_rows(snapshot,action)
            if len(rows)!=1: raise ValueError(ERROR)
            code,raw,err=raw_result(evidence['result'],_cli(action,'workload','exec',rows[0]['id'],'--','nginx','-v'))
            if b'nginx version:' not in raw+err: raise ValueError(ERROR)
        if step in ('memory-reject','storage-reject'):
            if code==0 or not any(t in (raw+err).lower() for t in (b'insufficient',b'not enough',b'notenough')) or _rows(snapshot,action,'memory' if step=='memory-reject' else 'storage'): raise ValueError(ERROR)
        elif code!=0: raise ValueError(ERROR)
        if step in ('bridge-deploy','host-deploy') and len(_rows(snapshot,action,'host' if step=='host-deploy' else 'bridge'))!=1: raise ValueError(ERROR)
        if step in ('bridge-remove','host-remove') and _rows(snapshot,action,'host' if step=='host-remove' else 'bridge'): raise ValueError(ERROR)
    return snapshot


def validate_boundary(action,before,predecessor):
    current=validate_evidence(action,before,before=action['step'] not in contract.READONLY)
    if predecessor is None:
        if current['workloads']: raise ValueError('fresh replay starts with unexpected workload')
        baseline={}
        for row in action['bootstrap_facts']['etcd'].get('keys',[]):
            key=base64.b64decode(row['key'],validate=True).decode()
            baseline[key]=base64.b64decode(row.get('value',''),validate=True).decode()
        if 'keys' in action['bootstrap_facts']['etcd'] and baseline!=current['metadata']: raise ValueError('current full keyspace differs from bootstrap acceptance')
        return
    prior=_snapshot(predecessor['evidence'],action)
    for key in ('metadata','workloads','nodes'):
        if plan_digest(prior[key])!=plan_digest(current[key]): raise ValueError('current metadata differs from exact predecessor')


def validate_transition(action,before,observed,predecessor):
    after=validate_evidence(action,observed)
    if before is None: return
    old=validate_evidence(action,before,before=action['step'] not in contract.READONLY); step=action['step']
    if step in contract.READONLY or step in ('memory-reject','storage-reject','app-cache','canary-cache','canary-exec'):
        for key in ('workloads','nodes','metadata'):
            if plan_digest(old[key])!=plan_digest(after[key]): raise ValueError('nondeploy/rejected create changed exact metadata/quota')
    if step in ('canary-stop','canary-start','bridge-remove','host-remove'):
        rows=_rows(old,action,'host' if step=='host-remove' else 'bridge')
        if len(rows)!=1: raise ValueError(ERROR)
        verb={'canary-stop':'stop','canary-start':'start','bridge-remove':'remove','host-remove':'remove'}[step]
        parts=('workload',verb,'--force',rows[0]['id']) if verb=='remove' else ('workload',verb,rows[0]['id']); raw_result(observed['evidence']['result'],_cli(action,*parts))
        if step in ('canary-stop','canary-start'):
            if [r['id'] for r in _rows(after,action)]!=[r['id'] for r in rows]: raise ValueError(ERROR)
            target=rows[0]['id'];status_key=_status_key(rows[0])
            if status_key in old['metadata'] and status_key not in after['metadata']: raise ValueError('owned status disappeared during stop/start')
            for snapshot in (old,after):
                if status_key in snapshot['metadata']:
                    status=_status(_decode(snapshot['metadata'][status_key].encode(),LIMIT),target)
                    if snapshot is after and status['running']!=(step=='canary-start'): raise ValueError('canary status running differs from requested transition')
            old_rows={r['id']:{k:v for k,v in r.items() if k!='status' or r['id']!=target} for r in old['workloads']}
            new_rows={r['id']:{k:v for k,v in r.items() if k!='status' or r['id']!=target} for r in after['workloads']}
            if old_rows!=new_rows or old['nodes']!=after['nodes']: raise ValueError('stop/start changed unrelated workload/node projection')
            if {k:v for k,v in old['metadata'].items() if k!=status_key}!={k:v for k,v in after['metadata'].items() if k!=status_key}: raise ValueError('stop/start changed unrelated raw metadata')
            index=next(i for i,w in enumerate(action['render']['hosts']) if w['node']==action['node']); code,raw,_=raw_result(after['_captures'][index]['commands']['tasks'])
            if code!=0 or (rows[0]['id'] in raw.decode().splitlines())!=(step=='canary-start'): raise ValueError(ERROR)
    if step in ('app-deploy','bridge-deploy','host-deploy','bridge-remove','host-remove'):
        old_rows={r['id']:r for r in old['workloads']};new_rows={r['id']:r for r in after['workloads']}
        if step=='app-deploy':
            document=action['desired_apps'][action['app_index']];_,_,name=apps.spec_identity(document)
            target={wid for wid,r in new_rows.items() if apps.revision_matches(r,name,document['entrypoint'])}
            if len(target)!=document['replicas'] or target&set(old_rows) or set(new_rows)-set(old_rows)!=target or not set(old_rows)<=set(new_rows): raise ValueError('app deploy exact workload delta differs')
        elif step in ('bridge-deploy','host-deploy'):
            target={r['id'] for r in _rows(after,action,'host' if step=='host-deploy' else 'bridge')}
            if len(target)!=1 or target&set(old_rows) or set(new_rows)-set(old_rows)!=target or not set(old_rows)<=set(new_rows): raise ValueError('canary deploy exact workload delta differs')
        else:
            target={r['id'] for r in _rows(old,action,'host' if step=='host-remove' else 'bridge')}
            if set(old_rows)-set(new_rows)!=target or not set(new_rows)<=set(old_rows): raise ValueError('canary remove exact workload delta differs')
        for wid in set(old_rows)&set(new_rows):
            if old_rows[wid]!=new_rows[wid]: raise ValueError('unrelated workload projection changed')
        ledgers={'/eru/resource/cpumem/'+w['node'] for w in action['render']['workers']}|{'/eru-storage/resource/storage/'+w['node'] for w in action['render']['workers']}
        for key in set(old['metadata'])&set(after['metadata'])-ledgers:
            if old['metadata'][key]!=after['metadata'][key]: raise ValueError('unrelated stored record bytes changed')
    if step=='app-deploy':
        from app_desired import snapshot_binding
        child=observed['evidence']['child_plan']
        if child is None or child['snapshot']!=snapshot_binding(old): raise ValueError('child plan differs from exact fresh snapshot')
    if step=='residue-accept' and predecessor is not None:
        prior=_snapshot(predecessor['evidence'],action)
        for key in ('workloads','nodes','metadata'):
            if plan_digest(prior[key])!=plan_digest(after[key]): raise ValueError('residue drift after resource acceptance')


def _slot(action):
    return 'etc/eru/.fresh-bootstrap/replay-'+action['run_id']+'/%03d'%action['step_index']


def _core_observe(session,action,runner,now):
    readonly=action['step'] in contract.READONLY; slot=_slot(action); provenance=None; result=None; child=None
    capture=collect_capture(action,0,root=session.root,owner_uid=session.uid,owner_gid=session.gid,runner=runner,now=now)
    snapshot={k:_decode(raw_result(capture['commands'][k])[1],LIMIT) or [] for k in CORE_COMMANDS}
    if readonly:
        state='complete'
        if action['step']=='child-plan':
            from app_executor import execution_plan
            child=execution_plan(action['desired_apps'][action['app_index']],snapshot,True,[],plan_id=action['run_id']+'-app-'+str(action['app_index']))
        if action['step'] in ('canary-get','canary-logs'):
            rows=_rows(snapshot,action)
            if len(rows)!=1: raise ValueError(ERROR)
            parts=('workload','get',rows[0]['id']) if action['step']=='canary-get' else ('workload','logs','--tail','30',rows[0]['id']); result=_invoke(runner,_cli(action,*parts))
    elif not session.exists(slot): state='absent'
    else:
        names=set(os.listdir(session.ensure(slot)))
        if names not in ({'intent.json'},{'intent.json','complete.json'},{'intent.json','spec.yaml'},{'intent.json','spec.yaml','complete.json'}): raise ValueError(ERROR)
        intent=_decode(session.data(slot+'/intent.json',0o600),WIRE_LIMIT)
        if intent['action']!=action: raise ValueError(ERROR)
        provenance={'intent_sha256':intent['intent_sha256'],'action_sha256':plan_digest(action),'started_at':intent['started_at'],'completed_at':None}
        if 'complete.json' not in names: state='uncertain'
        else:
            complete=_decode(session.data(slot+'/complete.json',0o600),LIMIT); exact(complete,{'provenance','result','child_plan'})
            if any(complete['provenance'][k]!=v for k,v in provenance.items() if k!='completed_at'): raise ValueError(ERROR)
            provenance=complete['provenance']; result=complete['result']; child=complete['child_plan']; state='complete'
    return {'schema_version':1,'action_sha256':plan_digest(action),'observed_at':_time(now),'host':{k:action['host'][k] for k in contract.HOST_FIELDS},'state':state,'provenance':provenance,'evidence':{'captures':[capture],'result':result,'child_plan':child}}


def handle(request,*,root='/',owner_uid=0,owner_gid=0,now=None,runner=None):
    request=validate_request(request); action=request['action']; runner=runner or _runner
    if request['operation']=='capture': return collect_capture(action,request['capture_index'],root=root,owner_uid=owner_uid,owner_gid=owner_gid,runner=runner,now=now)
    session=_Session(root,owner_uid,owner_gid,action)
    try:
        before=_core_observe(session,action,runner,now)
        if request['operation']=='observe': return before
        if before['state']!='absent': raise ValueError(ERROR)
        slot=_slot(action); parent,_,name=slot.rpartition('/'); session.ensure(parent,create=True,private=True)
        os.mkdir(name,0o700,dir_fd=session.dirs[parent]); os.fsync(session.dirs[parent]); session.ensure(slot); started=_time(now)
        session.publish_file(slot+'/intent.json',canonical({'action':action,'intent_sha256':request['intent_sha256'],'started_at':started}),0o600)
        capture=collect_capture(action,0,root=root,owner_uid=owner_uid,owner_gid=owner_gid,runner=runner,now=now); snapshot={k:_decode(raw_result(capture['commands'][k])[1],LIMIT) or [] for k in CORE_COMMANDS}
        step=action['step']; child=None
        if step in ('app-cache','canary-cache'):
            image=action['desired_apps'][action['app_index']]['image'] if step=='app-cache' else action['canary_image']; argv=_cli(action,'image','cache','--node',action['node'],image)
        elif step in ('app-deploy','bridge-deploy','host-deploy','memory-reject','storage-reject'):
            if step=='app-deploy':
                from app_executor import execution_plan
                child=execution_plan(action['desired_apps'][action['app_index']],snapshot,True,[],plan_id=action['run_id']+'-app-'+str(action['app_index']))
                if not child['executable'] or child['action']!='deploy_revision': raise ValueError(ERROR)
                text=child['eru_spec']
            else:
                mode={'bridge-deploy':'bridge','host-deploy':'host','memory-reject':'memory','storage-reject':'storage'}[step]
                if _rows(snapshot,action,mode): raise ValueError(ERROR)
                _,text=canary(action,mode)
            session.publish_file(slot+'/spec.yaml',text.encode(),0o600); argv=_deploy_argv(action,snapshot,'/'+slot+'/spec.yaml')
        else:
            rows=_rows(snapshot,action,'host' if step=='host-remove' else 'bridge')
            if len(rows)!=1: raise ValueError(ERROR)
            wid=rows[0]['id']; parts={'canary-exec':('workload','exec',wid,'--','nginx','-v'),'canary-stop':('workload','stop',wid),'canary-start':('workload','start',wid),'bridge-remove':('workload','remove','--force',wid),'host-remove':('workload','remove','--force',wid)}[step]; argv=_cli(action,*parts)
        _identity(session,action['host']); session.check(); result=_invoke(runner,argv); completed=_time(now)
        provenance={'intent_sha256':request['intent_sha256'],'action_sha256':plan_digest(action),'started_at':started,'completed_at':completed}
        session.publish_file(slot+'/complete.json',canonical({'provenance':provenance,'result':result,'child_plan':child}),0o600)
        return _core_observe(session,action,runner,now)
    finally: session.close()


def main(encoded):
    try:
        raw=base64.b64decode(encoded,validate=True)
        if len(raw)>WIRE_LIMIT or base64.b64encode(raw).decode()!=encoded: raise ValueError(ERROR)
        output=canonical(handle(_decode(raw,WIRE_LIMIT)))
        if len(output)>LIMIT: raise ValueError(ERROR)
        sys.stdout.write(output.decode())
    except Exception:
        sys.stderr.write(ERROR+'\n'); raise SystemExit(1) from None

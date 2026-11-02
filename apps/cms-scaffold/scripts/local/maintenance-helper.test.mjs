import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHelperPolicy, helperCreateArgs, assertHelperPolicy, executeHelperLifecycle } from './maintenance-helper.mjs';
import { canonicalBytes, sha256 } from '../ops/recovery-protocol.mjs';
const full = n => n.repeat(64), operationId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
function context(kind = 'INVENTORY', side = 'source') {
  const target = {images:{api:`sha256:${full('a')}`,node:`sha256:${full('b')}`,postgres:`sha256:${full('c')}`},
    networkIds:{data:full('d'),web:full('e')},volumeNames:{'media-data':'owned_media'}};
  return {kind,side,operationId,seq:'1',target,helperRoot:'/private/helper/1',runRoot:'/private/source',
    cwd:'/source',nodeBinary:'/verified/node',uid:1000,gid:1000,mediaUser:'0:0',
    image:{Id:target.images[kind.startsWith('PG_')?'postgres':kind.startsWith('MEDIA_')?'node':'api'],
      Os:'linux',Config:{Env:['PATH=/usr/bin'],Labels:{'source':'reviewed'},Volumes:kind.startsWith('PG_')?{'/var/lib/postgresql/data':{}}:null}}};
}
function fixture(kind = 'INVENTORY', side = 'source') {
  const c = context(kind,side), p = buildHelperPolicy(c), id=full('f');
  const expected={fullContainerId:id,name:`cms-pp1c-${operationId}-1`,state:'created',dataNetworkName:'owned_data',noneNetworkId:full('9'),
    labels:{source:'reviewed','org.cms.pp1c.operation':operationId,'org.cms.pp1c.seq':'1',
      'org.cms.pp1c.kind':kind,'org.cms.pp1c.policy':sha256(canonicalBytes(p))},volumeMountpoints:{owned_media:'/volumes/media'}};
  const container={Id:id,Name:`/${expected.name}`,Image:p.imageId,
    State:{Running:false,Status:'created',ExitCode:0},
    Config:{Labels:expected.labels,Env:p.env,User:p.user,Entrypoint:[p.entrypoint],Cmd:p.args,OpenStdin:true,Tty:false},
    HostConfig:{NetworkMode:p.networkId??'none',ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],CapAdd:null,
      SecurityOpt:['no-new-privileges'],RestartPolicy:{Name:'no'},LogConfig:{Type:'none'},PortBindings:{},
      Devices:[],DeviceRequests:null,PidMode:'',IpcMode:'private',ExtraHosts:null,
      Tmpfs:{'/tmp':'rw,nosuid,nodev,size=67108864',...(kind.startsWith('PG_')?{'/var/lib/postgresql/data':'ro,nosuid,nodev,noexec,size=1048576'}:{})}},
    Mounts:p.mounts.map(m=>({Type:m.type,Source:m.type==='volume'?'/volumes/media':m.source,
      ...(m.type==='volume'?{Name:m.source}:{}),Destination:m.destination,RW:!m.readOnly})),
    NetworkSettings:{Ports:{},Networks:p.networkId?{owned_data:{NetworkID:p.networkId,IPAddress:'',EndpointID:''}}:{none:{NetworkID:'',IPAddress:'',EndpointID:''}}}};
  return {c,p,expected,container:structuredClone(container)};
}
test('H01a_exact_inventory_policy_and_create_vector',()=>{
  const {c,p,expected,container}=fixture();
  assert.equal(p.user,'1000:1000');assert.deepEqual(p.args,['-jar','/app/app.jar','ops-inventory','--request','/run/pp1/request.json']);
  assert.equal(p.mounts.length,4);assert.equal(p.networkId,full('d'));
  const args=helperCreateArgs(p,expected);assert.deepEqual(args.slice(0,3),['create','--pull=never','--name']);
  assert.ok(args.includes('--log-driver=none'));assert.ok(args.includes('--interactive'));
  assert.ok(!args.includes('--rm'));assert.ok(!args.includes('--privileged'));
  assert.equal(assertHelperPolicy(container,p,expected),container);
  assert.equal(c.image.Config.Labels.source,'reviewed');
});
for(const [kind,side,network,mounts] of [['INVENTORY','target',true,4],['REVOKE_SESSIONS','target',true,2],
  ['PG_DUMP','source',true,1],['PG_RESTORE','target',true,1],['MEDIA_PACK','source',false,3],['MEDIA_RESTORE','target',false,3]]) {
  test(`H01a_fixed_${kind}_${side}`,()=>{
    const {p,expected,container}=fixture(kind,side);assert.equal(Boolean(p.networkId),network);assert.equal(p.mounts.length,mounts);
    assertHelperPolicy(container,p,expected);
    if(kind==='MEDIA_RESTORE'){assert.equal(p.user,'0:0');assert.equal(p.mounts.find(m=>m.destination==='/media').readOnly,false);}
    if(kind.startsWith('PG_')){assert.ok(p.env.includes(`PGAPPNAME=${operationId}`));assert.ok(p.env.includes('PGPASSFILE=/run/pp1/pgpass'));assert.ok(!p.args.some(a=>a.includes('password=')));}
  });
}
for(const [name,change] of Object.entries({
  full_id:c=>c.Id=full('0'),name:c=>c.Name='/other',image:c=>c.Image=`sha256:${full('0')}`,
  labels:c=>c.Config.Labels.extra='untrusted',environment:c=>c.Config.Env.push('PASSWORD=canary'),
  duplicate_env:c=>c.Config.Env.push(c.Config.Env[0]),user:c=>c.Config.User='0:0',argv:c=>c.Config.Cmd.push('--other'),
  entrypoint:c=>c.Config.Entrypoint=['/bin/sh'],tty:c=>c.Config.Tty=true,stdin:c=>c.Config.OpenStdin=false,
  writable_root:c=>c.HostConfig.ReadonlyRootfs=false,privileged:c=>c.HostConfig.Privileged=true,
  cap_add:c=>c.HostConfig.CapAdd=['SYS_ADMIN'],cap_drop:c=>c.HostConfig.CapDrop=[],security:c=>c.HostConfig.SecurityOpt=[],
  restart:c=>c.HostConfig.RestartPolicy.Name='always',logs:c=>c.HostConfig.LogConfig.Type='json-file',
  port:c=>c.HostConfig.PortBindings={'8080/tcp':[{HostPort:'8080'}]},device:c=>c.HostConfig.Devices=[{PathOnHost:'/dev/x'}],
  pid:c=>c.HostConfig.PidMode='host',ipc:c=>c.HostConfig.IpcMode='host',hosts:c=>c.HostConfig.ExtraHosts=['x:1.2.3.4'],
  socket:c=>c.Mounts.push({Type:'bind',Source:'/var/run/docker.sock',Destination:'/socket',RW:true}),
  mount_rw:c=>c.Mounts[0].RW=!c.Mounts[0].RW,volume_source:c=>c.Mounts.find(m=>m.Type==='volume').Source='/other',
  extra_network:c=>c.NetworkSettings.Networks.extra={NetworkID:full('0'),IPAddress:'172.1.1.1'},
  wrong_network:c=>c.HostConfig.NetworkMode='host',tmpfs:c=>c.HostConfig.Tmpfs['/other']='rw'
})) test(`H01a_reject_${name}`,()=>{
  const {p,expected,container}=fixture();change(container);
  assert.throws(()=>assertHelperPolicy(container,p,expected),e=>e.code==='ADAPTER_UNSEALED'&&!e.message.includes('canary'));
});
test('H01a_running_and_exit_state_are_checked',()=>{
  const {p,expected,container}=fixture();expected.state='running';
  assert.throws(()=>assertHelperPolicy(container,p,expected));
  container.State.Running=true;container.State.Status='running';container.NetworkSettings.Networks.owned_data.IPAddress='172.30.0.8';
  assertHelperPolicy(container,p,expected);expected.state='exited';assert.throws(()=>assertHelperPolicy(container,p,expected));
  container.State.Running=false;container.State.Status='exited';container.NetworkSettings.Networks.owned_data.IPAddress='';assertHelperPolicy(container,p,expected);
});
for(const [name,mutate] of [['wrong_side',c=>c.side='target'],['unknown_kind',c=>c.kind='SHELL'],
  ['image_changed',c=>c.image.Id=`sha256:${full('0')}`],['uid_name',c=>c.uid='root'],
  ['unsafe_path',c=>c.helperRoot='/private,other'],['image_env_collision',c=>c.image.Config.Labels['org.cms.pp1c.kind']='x']]) {
  test(`H01a_context_${name}`,()=>{const c=context('PG_DUMP');mutate(c);assert.throws(()=>buildHelperPolicy(c));});
}

function lifecycleFixture(fault) {
  const f=fixture(), calls=[]; let removed=false, started=false;
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin.on('finish',()=>{f.container.NetworkSettings.Networks.owned_data.IPAddress='';f.container.State={Running:false,Status:'exited',ExitCode:fault==='nonzero'?7:0};queueMicrotask(()=>child.emit('close',f.container.State.ExitCode,null));});
  const deps={environment:{PATH:'/usr/bin',DOCKER_CONTEXT:'default'},
    command:async(file,args,options)=>{
      assert.equal(file,'docker');assert.deepEqual(args.slice(0,2),['--host','unix:///var/run/docker.sock']);
      assert.equal(options.shell,false);assert.equal(options.env.DOCKER_CONTEXT,undefined);assert.ok(options.timeout<=30000);
      const command=args.slice(2);calls.push(command);
      if(command[0]==='create')return {stdout:f.expected.fullContainerId+'\n'};
      if(command[0]==='inspect'){
        if(removed)return {code:1,stdout:'',stderr:`Error: No such object: ${f.expected.fullContainerId}\n`};
        const c=structuredClone(f.container);if(fault==='wrong_image')c.Image=`sha256:${full('0')}`;
        return {stdout:JSON.stringify([c])};
      }
      if(command[0]==='wait')return {stdout:String(f.container.State.ExitCode)+'\n'};
      if(command[0]==='stop'){f.container.NetworkSettings.Networks.owned_data.IPAddress='';f.container.State={Running:false,Status:'exited',ExitCode:143};return {stdout:''};}
      if(command[0]==='rm'){assert.equal(command.length,2);removed=true;return {stdout:command[1]+'\n'};}
      throw Error('unexpected command');
    },
    spawn:(file,args,options)=>{assert.equal(file,'docker');assert.equal(options.shell,false);
      assert.deepEqual(args.slice(2),['start','--attach','--interactive',f.expected.fullContainerId]);
      calls.push(args.slice(2));started=true;f.container.State={Running:true,Status:'running',ExitCode:0};
      f.container.NetworkSettings.Networks.owned_data.IPAddress='172.30.0.8';return child;},
    onCreated:async()=>calls.push(['registered']),onRunning:async()=>calls.push(['running']),
    onExited:async()=>calls.push(['exited']),onRemoved:async()=>calls.push(['removed'])};
  const consume=async p=>{if(fault==='consume')throw Error('secret-canary');p.stdin.end();return {verified:true};};
  return {...f,calls,deps,consume,wasStarted:()=>started,wasRemoved:()=>removed};
}
test('H01b_create_inspect_register_attach_wait_remove_exact_full_ID',async()=>{
  const f=lifecycleFixture();assert.deepEqual(await executeHelperLifecycle(f.p,f.expected,f.consume,f.deps),{verified:true});
  assert.ok(f.wasStarted()&&f.wasRemoved());
  const verbs=f.calls.map(x=>x[0]);assert.ok(verbs.indexOf('inspect')<verbs.indexOf('registered'));
  assert.ok(verbs.indexOf('registered')<verbs.indexOf('start'));assert.ok(verbs.indexOf('wait')<verbs.indexOf('rm'));
  assert.equal(verbs.at(-1),'removed');assert.equal(f.calls.filter(x=>x[0]==='create').length,1);
});
test('H01b_policy_mismatch_never_start_or_remove_unknown_container',async()=>{
  const f=lifecycleFixture('wrong_image');await assert.rejects(()=>executeHelperLifecycle(f.p,f.expected,f.consume,f.deps));
  assert.equal(f.wasStarted(),false);assert.equal(f.wasRemoved(),false);
});
for(const fault of ['nonzero','consume'])test(`H01b_${fault}_preserves_failure_and_only_cleans_verified_helper`,async()=>{
  const f=lifecycleFixture(fault);await assert.rejects(()=>executeHelperLifecycle(f.p,f.expected,f.consume,f.deps),e=>e.code==='CAPTURE_FAILED'&&!e.message.includes('canary'));
  assert.equal(f.wasRemoved(),true);assert.ok(f.calls.filter(x=>['stop','wait','rm'].includes(x[0])).every(x=>x.at(-1)===f.expected.fullContainerId));
});
test('H01b_remove_requires_conclusive_missing_inspect',async()=>{
  const f=lifecycleFixture(),run=f.deps.command;
  f.deps.command=async(...args)=>f.wasRemoved()?{code:1,stderr:'daemon unavailable'}:run(...args);
  await assert.rejects(()=>executeHelperLifecycle(f.p,f.expected,f.consume,f.deps));
  assert.ok(!f.calls.some(x=>x[0]==='removed'));
});

test('H01b_signal_aborts_pending_consumer_and_preserves_fixed_failure',async()=>{
  const f=lifecycleFixture();
  f.consume=()=>{queueMicrotask(()=>process.emit('SIGINT'));return new Promise(()=>{});};
  await assert.rejects(()=>executeHelperLifecycle(f.p,f.expected,f.consume,f.deps),e=>e.code==='INTERRUPTED');
  assert.equal(f.wasRemoved(),true);
});

for(const fault of ['actual','wrong-ID','extra-text','wrong-code'])test(`H02b2d_main_Docker_missing_${fault}`,async()=>{
  const f=lifecycleFixture(),run=f.deps.command;
  f.deps.command=async(...args)=>f.wasRemoved()?{code:fault==='wrong-code'?2:1,
    stderr:`error: no such object: ${fault==='wrong-ID'?'0'.repeat(64):f.expected.fullContainerId}${fault==='extra-text'?' extra':''}\n`}:run(...args);
  if(fault==='actual'){assert.deepEqual(await executeHelperLifecycle(f.p,f.expected,f.consume,f.deps),{verified:true});assert.equal(f.calls.at(-1)[0],'removed');}
  else {await assert.rejects(()=>executeHelperLifecycle(f.p,f.expected,f.consume,f.deps));assert.ok(!f.calls.some(x=>x[0]==='removed'));}
});

const pgData='/var/lib/postgresql/data', pgMask='ro,nosuid,nodev,noexec,size=1048576';
for(const [kind,side] of [['PG_DUMP','source'],['PG_RESTORE','target']]) {
  test(`T126_${kind}_exact_mask_and_unchanged_policy_keys`,()=>{
    const {p,expected,container}=fixture(kind,side);
    const args=helperCreateArgs(p,expected), at=args.indexOf('--tmpfs=/tmp:rw,nosuid,nodev,size=67108864');
    assert.equal(args[at+1],`--tmpfs=${pgData}:${pgMask}`);
    assert.deepEqual(Object.keys(p).sort(),['version','kind','side','imageId','user','entrypoint','args','env','mounts','networkId','readOnlyRootfs','capDrop','noNewPrivileges','restart','logDriver'].sort());
    container.HostConfig.Tmpfs[pgData]=pgMask;
    for(const state of ['created','running','exited']) {
      container.State={Status:state,Running:state==='running'};expected.state=state;
      container.NetworkSettings.Networks.owned_data.IPAddress=state==='running'?'172.30.0.8':'';
      assertHelperPolicy(container,p,expected);
    }
  });
}
for(const [fault,change] of Object.entries({missing:c=>delete c.HostConfig.Tmpfs[pgData],
  writable:c=>c.HostConfig.Tmpfs[pgData]=pgMask.replace('ro,','rw,'),oversized:c=>c.HostConfig.Tmpfs[pgData]=pgMask.replace('1048576','2097152'),
  extra:c=>c.HostConfig.Tmpfs['/other']='ro',anonymous:c=>c.Mounts.push({Type:'volume',Name:'unknown',Source:'/unknown',Destination:pgData,RW:true})})) {
  test(`T126_PG_mask_rejects_${fault}`,()=>{const {p,expected,container}=fixture('PG_DUMP');container.HostConfig.Tmpfs[pgData]=pgMask;change(container);assert.throws(()=>assertHelperPolicy(container,p,expected));});
}
for(const [fault,volumes] of [['missing',null],['extra',{[pgData]:{},'/extra':{}}],['wrong',{[pgData]:{extra:true}}]]) {
  test(`T126_PG_image_rejects_${fault}_declaration`,()=>{const c=context('PG_DUMP');c.image.Config.Volumes=volumes;assert.throws(()=>buildHelperPolicy(c));});
}
for(const kind of ['INVENTORY','MEDIA_PACK'])test(`T126_nonPG_${kind}_rejects_volume_and_mask`,()=>{
  const c=context(kind);c.image.Config.Volumes={[pgData]:{}};assert.throws(()=>buildHelperPolicy(c));
  const {p,expected,container}=fixture(kind);assert.ok(!helperCreateArgs(p,expected).some(x=>x.includes(pgData)));
  container.HostConfig.Tmpfs[pgData]=pgMask;assert.throws(()=>assertHelperPolicy(container,p,expected));
});

for(const [role,tool] of [['PG_DUMP_VERSION','pg_dump'],['PG_RESTORE_VERSION','pg_restore']]) {
  test(`T126_${role}_binds_verified_image_executable_and_exact_args`,()=>{
    const {p,expected,container,c}=fixture('PG_DUMP');
    Object.assign(p,{kind:role,entrypoint:`/usr/local/bin/${tool}`,args:['--version'],networkId:null});
    expected.pgProfileImageId=c.target.images.postgres;
    container.Config.Entrypoint=[p.entrypoint];container.Config.Cmd=p.args;
    container.HostConfig.NetworkMode='none';container.NetworkSettings.Networks={none:{NetworkID:'',EndpointID:'',IPAddress:''}};
    assertHelperPolicy(container,p,expected);
    assert.ok(helperCreateArgs(p,expected).includes(`--tmpfs=${pgData}:${pgMask}`));
    for(const mutate of [v=>v.imageId=`sha256:${full('0')}`,v=>v.entrypoint='/bin/sh',v=>v.args=['--version','extra'],v=>v.networkId=full('d')]) {
      const altered=structuredClone(p);mutate(altered);assert.throws(()=>helperCreateArgs(altered,expected));
    }
    assert.throws(()=>helperCreateArgs(p,{...expected,pgProfileImageId:undefined}));
    assert.throws(()=>assertHelperPolicy(container,{...p,kind:'PROFILE'},expected));
  });
}

test('T126_nonPG_declared_volumes_must_be_existing_exact_mount_destinations',()=>{
  const c=context('INVENTORY');c.image.Config.Volumes={'/media':{},'/run/pp1/request.json':{}};
  const p=buildHelperPolicy(c);assert.equal(p.mounts.length,4);
  c.image.Config.Volumes={'/media':{unexpected:true}};assert.throws(()=>buildHelperPolicy(c));
  c.image.Config.Volumes={'/tmp':{}};assert.throws(()=>buildHelperPolicy(c));
});

for(const address of ['8.8.8.8','127.0.0.1','::1'])test(`T126_network_running_rejects_nonprivate_${address}`,()=>{
  const {p,expected,container}=fixture();expected.state='running';container.State={Status:'running',Running:true};
  container.NetworkSettings.Networks.owned_data.IPAddress=address;assert.throws(()=>assertHelperPolicy(container,p,expected));
});

for(const [fault,mutate] of Object.entries({
  identity:(c,e)=>e.noneNetworkId=full('7'),network:c=>c.NetworkSettings.Networks.none.NetworkID=full('7'),
  extra:c=>c.NetworkSettings.Networks.bridge={},name:c=>c.NetworkSettings.Networks={host:c.NetworkSettings.Networks.none},
  host:c=>c.HostConfig.NetworkMode='host',endpoint:c=>c.NetworkSettings.Networks.none.EndpointID='short',
  address:c=>c.NetworkSettings.Networks.none.IPAddress='172.31.0.1',gateway:c=>c.NetworkSettings.Networks.none.Gateway='172.31.0.1',
  ipv6:c=>c.NetworkSettings.Networks.none.GlobalIPv6Address='::1',mac:c=>c.NetworkSettings.Networks.none.MacAddress='aa:bb:cc:dd:ee:ff',
  prefix:c=>c.NetworkSettings.Networks.none.IPPrefixLen=24
}))test(`T126_none_running_rejects_${fault}`,()=>{
  const {p,expected,container}=fixture('MEDIA_PACK');expected.state='running';container.State={Status:'running',Running:true};
  Object.assign(container.NetworkSettings.Networks.none,{NetworkID:expected.noneNetworkId,EndpointID:full('8')});
  mutate(container,expected);assert.throws(()=>assertHelperPolicy(container,p,expected));
});
for(const state of ['created','exited'])test(`T126_none_${state}_rejects_internal_endpoint`,()=>{
  const {p,expected,container}=fixture('MEDIA_PACK');expected.state=state;container.State={Status:state,Running:false};
  container.NetworkSettings.Networks.none.EndpointID=full('8');assert.throws(()=>assertHelperPolicy(container,p,expected));
});

import { run as runReadonlyCli193 } from '../ops/local-recovery-verify.mjs';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { readonlyRunnerFixture } from './maintenance-readonly-runner.fixture.mjs';
import * as helperAuthority188 from './maintenance-helper.mjs';
import { EventEmitter, getEventListeners } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHelperPolicy, helperCreateArgs, assertHelperPolicy, executeHelperLifecycle, runJdbcHandshake, runPgTool } from './maintenance-helper.mjs';
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


function browserFixture() {
  const c = context('BROWSER', 'target'); c.image.Id = c.target.images.node; c.runRoot = '/private/target';
  c.browser = {worktreeRoot: '/private/helper/1/browser-worktree', chromiumRoot: '/verified/chromium', nssToolsRoot: '/verified/nss',
    caFile: '/private/target/tls/ca.crt', inputFile: '/private/helper/1/browser.json', socketFile: '/tmp/cms-pp1c-test/credential.sock'};
  const p = buildHelperPolicy(c), f = fixture();
  f.expected.webNetworkName = 'owned_web';
  f.expected.labels['org.cms.pp1c.kind'] = 'BROWSER'; f.expected.labels['org.cms.pp1c.policy'] = sha256(canonicalBytes(p));
  const container = f.container; Object.assign(container, {Image: p.imageId});
  Object.assign(container.Config, {Env: [...p.env], Entrypoint: [p.entrypoint], Cmd: [...p.args], Labels: f.expected.labels});
  container.HostConfig.NetworkMode = p.networkId; container.HostConfig.Tmpfs = {'/tmp': 'rw,nosuid,nodev,size=536870912'};
  container.Mounts = p.mounts.map(m => ({Type: m.type, Source: m.source, Destination: m.destination, RW: !m.readOnly}));
  container.NetworkSettings.Networks = {owned_web: {NetworkID: '', IPAddress: '', EndpointID: ''}};
  return {c, p, expected: f.expected, container};
}
test('T162_B1_browser_exact_child_web_seven_RO_mounts_fixed_env_and_tmpfs', () => {
  const {c, p, expected, container} = browserFixture();
  assert.equal(p.imageId, c.target.images.node); assert.equal(p.networkId, c.target.networkIds.web);
  assert.equal(p.entrypoint, '/opt/pp1-node'); assert.deepEqual(p.args, ['/work/scripts/ops/local-restore-smoke.mjs', 'browser-child']);
  assert.equal(p.mounts.length, 7); assert.ok(p.mounts.every(m => m.type === 'bind' && m.readOnly));
  assert.deepEqual(p.mounts.map(m => m.destination), ['/chromium', '/fixture/browser.json', '/fixture/ca.crt', '/nss-tools', '/opt/pp1-node', '/run/pp1/credential.sock', '/work']);
  for (const variable of ['CMS_PP1_SUITE=recovery', 'CMS_PP1_TLS_MODE=trusted', 'HOME=/tmp/browser-home', 'XDG_CACHE_HOME=/tmp/browser-cache']) assert.ok(p.env.includes(variable));
  const args = helperCreateArgs(p, expected);
  assert.ok(args.includes('--tmpfs=/tmp:rw,nosuid,nodev,size=536870912'));
  assert.ok(args.includes('CMS_PP1_RECOVERY_INPUT=/fixture/browser.json'));
  assert.equal(assertHelperPolicy(container, p, expected), container);
});
for (const fault of ['full_id', 'source_network', 'data_network', 'second_endpoint', 'rw_socket', 'extra_mount', 'env', 'tmpfs', 'argv']) {
  test(`T162_B1_browser_${fault}_policy_rejected`, () => {
    const {c, p, expected, container} = browserFixture();
    if (fault === 'full_id') container.Id = full('0');
    if (fault === 'source_network') container.NetworkSettings.Networks = {source_web: container.NetworkSettings.Networks.owned_web};
    if (fault === 'data_network') container.HostConfig.NetworkMode = c.target.networkIds.data;
    if (fault === 'second_endpoint') container.NetworkSettings.Networks.other = {};
    if (fault === 'rw_socket') container.Mounts.find(m => m.Destination === '/run/pp1/credential.sock').RW = true;
    if (fault === 'extra_mount') container.Mounts.push({Type: 'bind', Source: '/private/source', Destination: '/source', RW: false});
    if (fault === 'env') container.Config.Env.push('NODE_OPTIONS=--inspect');
    if (fault === 'tmpfs') container.HostConfig.Tmpfs['/tmp'] = 'rw,size=1073741824';
    if (fault === 'argv') container.Config.Cmd.push('arbitrary');
    assert.throws(() => assertHelperPolicy(container, p, expected), e => e.code === 'ADAPTER_UNSEALED');
  });
}
test('T162_B1_browser_source_side_or_unknown_material_rejected', () => {
  const {c} = browserFixture();
  assert.throws(() => buildHelperPolicy({...c, side: 'source'}), e => e.code === 'ADAPTER_UNSEALED');
  assert.throws(() => buildHelperPolicy({...c, browser: {...c.browser, arbitrary: '/bad'}}), e => e.code === 'ADAPTER_UNSEALED');
});

for(const when of ['already','created','consume'])test(`T169_external_abort_${when}_never_allows_late_helper_work`,async()=>{
  const f=lifecycleFixture(),controller=new AbortController();f.deps.signal=controller.signal;
  if(when==='already')controller.abort();
  if(when==='created'){const created=f.deps.onCreated;f.deps.onCreated=async(...args)=>{await created(...args);controller.abort();};}
  if(when==='consume')f.consume=async child=>{controller.abort();child.stdin.end();return{verified:true};};
  await assert.rejects(executeHelperLifecycle(f.p,f.expected,f.consume,f.deps),e=>e.code==='INTERRUPTED');
  if(when==='already')assert.equal(f.calls.length,0);
  else {assert.equal(f.wasRemoved(),true);assert.equal(f.wasStarted(),when==='consume');}
});

test('T169_active_external_abort_stops_removes_owned_ID_and_detaches_listener',async()=>{
  const f=lifecycleFixture(),controller=new AbortController();f.deps.signal=controller.signal;
  f.consume=()=>{queueMicrotask(()=>controller.abort());return new Promise(()=>{});};
  await assert.rejects(executeHelperLifecycle(f.p,f.expected,f.consume,f.deps),e=>e.code==='INTERRUPTED');
  assert.ok(f.calls.some(args=>args[0]==='stop'&&args.at(-1)===f.expected.fullContainerId));
  assert.ok(f.wasRemoved());assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

function permitCancellationFixture(when) {
  const controller=new AbortController(),sent=[],hash='a'.repeat(64);
  const request={version:1,mode:'INVENTORY',operationId,side:'source',targetId:`pp1-local:${'b'.repeat(32)}`,
    releaseId:`sha256:${hash}`,jdbcUrl:'jdbc:postgresql://172.30.0.2:5432/cms',dbUser:'cms_local',
    passwordFile:'/run/secrets/spring.datasource.password',mediaRoot:'/media',outputFile:'/run/pp1/output/inventory.json',backupId:null,rawProofSha256:null};
  const backend={pid:71,backendStartEpoch:'1793550000.123456',db:'cms',role:'cms_local',clientAddr:'172.30.0.9',applicationName:operationId};
  const ready={version:1,operationId,side:'source',mode:'INVENTORY',requestSha256:sha256(canonicalBytes(request)),backend,readOnly:true};
  const result={version:1,operationId,mode:'INVENTORY',inventorySha256:hash,dbSnapshotSha256:hash,
    assetCount:'0',referencedFileCount:'0',orphanFileCount:'0',fileCount:'0',fileBytes:'0'};
  const child={stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()};let checks=0,observations=0;
  child.stdin.on('data',bytes=>{sent.push(bytes);if(when==='write')controller.abort();});
  child.stdin.on('finish',()=>{child.stdout.end(canonicalBytes(result));child.stderr.end();});
  queueMicrotask(()=>child.stdout.write(canonicalBytes(ready)));
  const deps={signal:controller.signal,address:backend.clientAddr,
    assertCurrent:async()=>{if(++checks===3&&when==='current'){await Promise.resolve();controller.abort();}},
    observe:async()=>++observations===1?[backend]:[],onReady:async()=>{},
    onPermitted:async()=>{if(when==='permitted'){await Promise.resolve();controller.abort();}}};
  return{child,request,deps,sent,controller};
}
for(const when of ['permitted','current','write'])test(`T169_JDBC_abort_during_${when}_cannot_admit_late_permit_or_result`,async()=>{
  const f=permitCancellationFixture(when);
  try {
    await assert.rejects(runJdbcHandshake(f.child,f.request,f.deps),e=>e.code==='INTERRUPTED');
    if(when!=='write')assert.equal(Buffer.concat(f.sent).length,0);
    assert.equal(getEventListeners(f.controller.signal,'abort').length,0);
  }finally{f.child.stdin.destroy();f.child.stdout.destroy();f.child.stderr.destroy();}
});

test('T174_JSON_historical_backend_is_not_a_private_PG_live_witness',async()=>{
  await assert.rejects(runPgTool({}, {policy:{kind:'PG_DUMP'},liveWitness:{claimed:true,backend:{pid:71}}}),e=>e.code==='CAPTURE_FAILED');
});

test('T188_readonly_creation_and_result_authority_reject_JSON_without_normal_authority',()=>{
  for(const name of ['claimReadonlyCreation','verifiedReadonlyInventoryResult'])
    assert.throws(()=>helperAuthority188[name]({}, {}, {}),{code:'ADAPTER_UNSEALED'});
});

test('T188_real_observation_six_profiles_then_inventory_survives_ended_child_delayed_EOF',async t=>{
  const f=await readonlyRunnerFixture(t),paths=['lease.json','target.json','recovery-candidate.json',`operations/${f.lease.operationId}.json`,`operations/${f.lease.operationId}.request.json`];
  const before=await Promise.all(paths.map(path=>readFile(join(f.base,path))));
  const result=await helperAuthority188.runReadonlyInventory(f.token,f.deps);
  assert.deepEqual(await Promise.all(paths.map(path=>readFile(join(f.base,path)))),before);assert.equal(f.state.containers.length,3);
  assert.equal(f.events.created.length,7);assert.equal(f.events.maxActive,1);
  assert.deepEqual(f.events.started,f.events.created);assert.deepEqual(f.events.removed,f.events.created);
  assert.equal(f.events.permits.length,1);assert.equal(f.events.endedBeforeFrames,1);
  assert.deepEqual(result.inventory,f.captured.inventory);
  assert.throws(()=>{result.profile.javaRuntimeVersion='forged';},TypeError);
  assert.throws(()=>{result.inventory.tables.push({});},TypeError);
  assert.throws(()=>helperAuthority188.verifiedInventoryResult(f.token,result),{code:'ADAPTER_UNSEALED'});
  assert.throws(()=>helperAuthority188.verifiedReadonlyInventoryResult({},result),{code:'ADAPTER_UNSEALED'});
  assert.throws(()=>helperAuthority188.verifiedReadonlyInventoryResult(f.token,structuredClone(result)),{code:'ADAPTER_UNSEALED'});
  const profile=await helperAuthority188.verifiedReadonlyHelperProfile(f.token,f.deps);
  assert.deepEqual(await helperAuthority188.verifiedReadonlyHelperProfile(f.token,f.deps),profile);
  const metadata=helperAuthority188.verifiedReadonlyInventoryResult(f.token,result);
  assert.throws(()=>{metadata.profile.javaRuntimeVersion='forged';},TypeError);
  assert.equal(metadata.requestSha256,f.events.permits[0].requestSha256);assert.equal(metadata.fullContainerId,f.events.created[6]);
  assert.throws(()=>helperAuthority188.verifiedReadonlyInventoryResult(f.token,result),{code:'ADAPTER_UNSEALED'});
  await f.observation.finishObservation(f.token,f.deps);f.observation.assertObservationGate(f.token);
  f.observation.closeObservation(f.token);await assert.rejects(helperAuthority188.verifiedReadonlyHelperProfile(f.token,f.deps));
});

for(const fault of ['request','compiled-class'])test(`T188_real_observation_rejects_${fault}_bytes_changed_during_delayed_drain`,async t=>{
  const f=await readonlyRunnerFixture(t,{afterBackendEnded:({c})=>{
    const path=fault==='request'?c.Mounts.find(m=>m.Destination==='/run/pp1/request.json').Source:
      c.Mounts.find(m=>m.Destination==='/run/pp1/request.json').Source.replace(/request.json$/,'profile/classes/Profile.class');
    appendFileSync(path,' ');
  }});
  await assert.rejects(helperAuthority188.runReadonlyInventory(f.token,f.deps));
});

for(const fault of ['pid','epoch','endpoint','extra'])test(`T188_real_observation_rejects_wrong_${fault}_before_Permit`,async t=>{
  const f=await readonlyRunnerFixture(t,{afterReady:({state})=>{
    if(fault==='pid')state.backends[0].pid++;if(fault==='epoch')state.backends[0].backend_start_epoch='1770000001.123';
    if(fault==='endpoint')state.backends[0].client_addr='172.31.0.10';
    if(fault==='extra')state.backends.push({...state.backends[0],pid:92});
  }});
  await assert.rejects(helperAuthority188.runReadonlyInventory(f.token,f.deps));assert.equal(f.events.permits.length,0);
});
for(const fault of ['reappearing','registry','source','cancel'])test(`T188_real_observation_rejects_${fault}_during_delayed_EOF`,async t=>{
  const abort=new AbortController(),f=await readonlyRunnerFixture(t,{signal:abort.signal,delay:350,reappearAfterZero:fault==='reappearing',afterBackendEnded:({state,f})=>{
    if(fault==='registry')mkdirSync(join(f.base,'operation.lock'),{mode:0o700});
    if(fault==='source')state.oid='99999';if(fault==='cancel')abort.abort();
  }});
  await assert.rejects(helperAuthority188.runReadonlyInventory(f.token,f.deps),fault==='cancel'?{code:'INTERRUPTED'}:undefined);
  assert.equal(f.events.permits.length,1);await assert.rejects(f.observation.observationContext(f.token,f.deps));
});

for(const fault of ['abort','registry','policy','identity'])test(`T193_real_default_cleanup_${fault}`,async t=>{
  const abort=new AbortController(),f=await readonlyRunnerFixture(t,{signal:abort.signal,afterBackendEnded:({c,f})=>{
    if(fault==='registry')mkdirSync(join(f.base,'operation.lock'),{mode:0o700});
    else {if(fault==='policy')c.Image='sha256:'+'0'.repeat(64);if(fault==='identity')c.Id='f'.repeat(64);abort.abort();}
  }});f.observation.closeObservation(f.token);const chunks=[];
  const args=['--run-id',f.readonlyIds.runId,'--backup-id',f.readonlyIds.backupId,'--restore-operation-id',f.readonlyIds.restoreOperationId];
  const exit=await runReadonlyCli193(args,{...f.deps,stdout:{write:b=>chunks.push(Buffer.from(b))}});
  assert.notEqual(exit,0);assert.equal(chunks.length,1);assert.equal(JSON.parse(chunks[0]).phase,null);
  assert.equal(f.events.created.length,7);
  if(fault==='abort'||fault==='registry')assert.deepEqual(f.events.removed,f.events.created);
  else {assert.equal(f.events.removed.length,6);assert.ok(!f.events.removed.includes(f.events.created[6]));assert.ok(!f.events.removed.includes('f'.repeat(64)));}
  t.diagnostic(JSON.stringify({fault,created:f.events.created.length,removed:f.events.removed.length,code:JSON.parse(chunks[0]).code}));
});
test('T193_unbranded_caller_flags_cannot_skip_normal_onExited',async()=>{
  const f=lifecycleFixture('consume');let exited=0;
  f.deps.readonlyCleanup=true;f.deps.cleanup=true;f.deps.owner={verified:true};f.deps.onCleanup=async()=>({verified:true});
  f.deps.onExited=async()=>{exited++;throw Error('mandatory operational check');};
  await assert.rejects(executeHelperLifecycle(f.p,f.expected,f.consume,f.deps),{code:'CAPTURE_FAILED'});
  assert.equal(exited,1);assert.equal(f.wasRemoved(),false);
});

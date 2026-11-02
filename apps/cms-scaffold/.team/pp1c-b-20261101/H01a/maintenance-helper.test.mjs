import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHelperPolicy, helperCreateArgs, assertHelperPolicy } from './maintenance-helper.mjs';
import { canonicalBytes, sha256 } from '../ops/recovery-protocol.mjs';
const full = n => n.repeat(64), operationId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
function context(kind = 'INVENTORY', side = 'source') {
  const target = {images:{api:`sha256:${full('a')}`,node:`sha256:${full('b')}`,postgres:`sha256:${full('c')}`},
    networkIds:{data:full('d'),web:full('e')},volumeNames:{'media-data':'owned_media'}};
  return {kind,side,operationId,seq:'1',target,helperRoot:'/private/helper/1',runRoot:'/private/source',
    cwd:'/source',nodeBinary:'/verified/node',uid:1000,gid:1000,mediaUser:'0:0',
    image:{Id:target.images[kind.startsWith('PG_')?'postgres':kind.startsWith('MEDIA_')?'node':'api'],
      Os:'linux',Config:{Env:['PATH=/usr/bin'],Labels:{'source':'reviewed'}}}};
}
function fixture(kind = 'INVENTORY', side = 'source') {
  const c = context(kind,side), p = buildHelperPolicy(c), id=full('f');
  const expected={fullContainerId:id,name:`cms-pp1c-${operationId}-1`,state:'created',
    labels:{source:'reviewed','org.cms.pp1c.operation':operationId,'org.cms.pp1c.seq':'1',
      'org.cms.pp1c.kind':kind,'org.cms.pp1c.policy':sha256(canonicalBytes(p))},volumeMountpoints:{owned_media:'/volumes/media'}};
  const container={Id:id,Name:`/${expected.name}`,Image:p.imageId,
    State:{Running:false,Status:'created',ExitCode:0},
    Config:{Labels:expected.labels,Env:p.env,User:p.user,Entrypoint:[p.entrypoint],Cmd:p.args,OpenStdin:true,Tty:false},
    HostConfig:{NetworkMode:p.networkId??'none',ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],CapAdd:null,
      SecurityOpt:['no-new-privileges'],RestartPolicy:{Name:'no'},LogConfig:{Type:'none'},PortBindings:{},
      Devices:[],DeviceRequests:null,PidMode:'',IpcMode:'private',ExtraHosts:null,
      Tmpfs:{'/tmp':'rw,nosuid,nodev,size=67108864'}},
    Mounts:p.mounts.map(m=>({Type:m.type,Source:m.type==='volume'?'/volumes/media':m.source,
      ...(m.type==='volume'?{Name:m.source}:{}),Destination:m.destination,RW:!m.readOnly})),
    NetworkSettings:{Ports:{},Networks:p.networkId?{owned_data:{NetworkID:p.networkId,IPAddress:'',EndpointID:''}}:{none:{NetworkID:'',IPAddress:'',EndpointID:''}}}};
  return {c,p,expected,container};
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
  container.State.Running=false;container.State.Status='exited';assertHelperPolicy(container,p,expected);
});
for(const [name,mutate] of [['wrong_side',c=>c.side='target'],['unknown_kind',c=>c.kind='SHELL'],
  ['image_changed',c=>c.image.Id=`sha256:${full('0')}`],['uid_name',c=>c.uid='root'],
  ['unsafe_path',c=>c.helperRoot='/private,other'],['image_env_collision',c=>c.image.Config.Labels['org.cms.pp1c.kind']='x']]) {
  test(`H01a_context_${name}`,()=>{const c=context('PG_DUMP');mutate(c);assert.throws(()=>buildHelperPolicy(c));});
}

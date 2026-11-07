import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectTarget } from './maintenance-target.mjs';
import * as workflow from './maintenance-workflow.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const runId = 'a'.repeat(32), project = `cms-pp1-local-${runId}`, commit = 'b'.repeat(40);
const services = ['postgres', 'cms-api', 'ingress'], kinds = ['postgres', 'api', 'node'];
const full = n => String(n).repeat(64), image = n => `sha256:${full(n)}`;
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'pp1-target-')), root = join(cwd, 'local/pp1', runId);
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(join(cwd, 'services/cms-api/build/libs'), { recursive: true });
  await mkdir(join(cwd, 'scripts/local'), { recursive: true });
  const jar = join(cwd, 'services/cms-api/build/libs/app.jar'), node = join(cwd, 'node');
  const script = join(cwd, 'scripts/local/ingress.mjs'), probe = join(cwd, 'scripts/local/maintenance-media-probe.mjs');
  for (const [path, bytes] of [[jar, 'jar'], [node, 'node'], [script, 'ingress'], [probe, 'probe']]) await writeFile(path, bytes);
  const images = { postgres: image(4), api: image(5), node: image(6) };
  const apiBuild = { sourceCommit: commit, jarSha256: sha('jar'), baseImage: image(7) };
  const receipt = { version: 1, environment: 'local-isolated', phase: 'PREPARED', runId, project, sourceCommit: commit,
    images, imageRefs: Object.fromEntries(kinds.map(k => [k, `${project}-${k}:verified`])), apiBuild, apiOrigin: 'https://api.cms.test:8443' };
  const artifacts = { version: 1, sourceCommit: commit, apiBuild, apiOrigin: receipt.apiOrigin,
    ingressScriptSha256: sha('ingress'), nodeBinarySha256: sha('node'), dist: {} };
  const bind = (Source, Destination) => ({ Type: 'bind', Source, Destination, RW: false });
  const volume = (name, Destination) => ({ Type: 'volume', Name: `${project}_${name}`, Source: `/var/lib/docker/volumes/${project}_${name}/_data`, Destination, RW: true });
  const networks = ['web', 'data'].map((name, index) => ({ Id: full(index + 8), Name: `${project}_${name}`, Driver: 'bridge', Internal: true,
    Labels: { 'com.docker.compose.project': project, 'com.docker.compose.network': name },
    IPAM: { Config: [{ Subnet: `172.${30 + index}.0.0/16`, Gateway: `172.${30 + index}.0.1` }] }, Containers: {} }));
  const containers = services.map((service, index) => {
    const names = service === 'cms-api' ? ['web', 'data'] : [service === 'postgres' ? 'data' : 'web'];
    const endpoints = Object.fromEntries(names.map(name => {
      const network = networks.find(n => n.Name === `${project}_${name}`), ip = `${network.IPAM.Config[0].Gateway.slice(0, -1)}${index + 2}`;
      network.Containers[full(index + 1)] = { IPv4Address: `${ip}/16` };
      return [network.Name, { NetworkID: network.Id, IPAddress: ip, IPPrefixLen: 16, Gateway: network.IPAM.Config[0].Gateway,
        Aliases: [`${project}-${service}-1`, service, ...(service === 'ingress' ? ['front.cms.test', 'back.cms.test', 'admin.cms.test', 'api.cms.test'] : [])] }];
    }));
    return { Id: full(index + 1), Name: `/${project}-${service}-1`, Image: images[kinds[index]],
      Config: { Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': service }, Env: [] },
      State: { Running: true, Health: { Status: 'healthy' } },
      HostConfig: { RestartPolicy: { Name: 'no' }, Privileged: false, NetworkMode: `${project}_${names[0]}`, PortBindings: {} },
      NetworkSettings: { Ports: { '5432/tcp': null }, Networks: endpoints }, Mounts: [] };
  });
  const apiEnv = { SPRING_PROFILES_ACTIVE: 'prod', CMS_RUNTIME_PRODUCTION_REQUIRED: 'true', CMS_SITE_DOMAIN: 'cms.test', CMS_API_ORIGIN: receipt.apiOrigin,
    CMS_CORS_ORIGINS: 'https://front.cms.test:8443,https://back.cms.test:8443,https://admin.cms.test:8443',
    CMS_SURFACE_ORIGINS: 'https://front.cms.test:8443:front,https://back.cms.test:8443:back,https://admin.cms.test:8443:admin',
    CMS_IDENTITY_SEED_ENABLED: 'false', CMS_IDENTITY_COOKIE_SECURE: 'true', SPRING_DATASOURCE_URL: 'jdbc:postgresql://postgres:5432/cms',
    SPRING_DATASOURCE_USERNAME: 'cms_local', SPRING_CONFIG_IMPORT: 'configtree:/run/secrets/', CMS_MEDIA_ROOT: '/data/media', SERVER_PORT: '8080' };
  containers[0].Config.Env = ['POSTGRES_DB=cms', 'POSTGRES_USER=cms_local', 'POSTGRES_PASSWORD_FILE=/run/secrets/spring.datasource.password'];
  containers[1].Config.Env = Object.entries(apiEnv).map(([k, v]) => `${k}=${v}`);
  for (let i = 0; i < 2; i++) containers[i].Mounts = [volume(i ? 'media-data' : 'db-data', i ? '/data/media' : '/var/lib/postgresql/data'),
    bind(join(root, 'secrets/spring.datasource.password'), '/run/secrets/spring.datasource.password')];
  containers[2].Mounts = [bind(node, '/opt/pp1-node'), bind(script, '/tool/ingress.mjs'), bind(join(root, 'ingress.json'), '/config/ingress.json'),
    bind(join(root, 'tls/leaf.crt'), '/tls/leaf.crt'), bind(join(root, 'tls/leaf.key'), '/tls/leaf.key')];
  for (const surface of ['front', 'back', 'admin']) {
    const dist = join(cwd, 'apps', `web-${surface}`, 'dist'); await mkdir(dist, { recursive: true });
    await writeFile(join(dist, 'index.html'), surface); artifacts.dist[surface] = { 'index.html': sha(surface) };
    containers[2].Mounts.push(bind(dist, `/dist/${surface}`));
  }
  const volumes = ['db-data', 'media-data'].map(name => ({ Name: `${project}_${name}`, Mountpoint: `/var/lib/docker/volumes/${project}_${name}/_data`, Driver: 'local',
    Labels: { 'com.docker.compose.project': project, 'com.docker.compose.volume': name }, Options: {} }));
  const apiLabels = { 'org.cms.pp1.source-commit': commit, 'org.cms.pp1.jar-sha256': apiBuild.jarSha256, 'org.cms.pp1.base-image': apiBuild.baseImage };
  const calls = [], state = { containers, networks, volumes, apiLabels, oid: '16384\n' };
  const save = async () => { for (const [name, data] of [['receipt', receipt], ['artifacts', artifacts]]) await writeFile(join(root, `${name}.json`), JSON.stringify(data), { mode: 0o600 }); }; await save();
  const command = async (file, args, options) => {
    assert.equal(file, 'docker'); assert.deepEqual(args.slice(0, 2), ['--host', 'unix:///var/run/docker.sock']);
    assert.equal(options.shell, false); assert.equal(options.timeout, 30000); calls.push(args);
    const a = args.slice(2); let result;
    if (a[0] === 'ps') result = containers.map(c => c.Id).join('\n');
    else if (a[0] === 'inspect') result = JSON.stringify(containers);
    else if (a[0] === 'network') result = JSON.stringify(networks);
    else if (a[0] === 'volume') result = JSON.stringify(volumes);
    else if (a[0] === 'image') { const kind = kinds.find(k => a.at(-1) === receipt.imageRefs[k]) ?? kinds.find(k => images[k] === a.at(-1)); result = JSON.stringify([{ Id: kind ? images[kind] : apiBuild.baseImage, Os: 'linux', Config: { Labels: kind === 'api' ? state.apiLabels : {} } }]); }
    else if (a[0] === 'exec') { assert.deepEqual(a, ['exec', full(1), 'psql', '-X', '-q', '-t', '-A', '-U', 'cms_local', '-d', 'cms', '-c', 'SELECT oid FROM pg_database WHERE datname = current_database();']); result = state.oid; }
    else assert.fail(`unexpected mutation ${a[0]}`);
    return { stdout: result, stderr: '' };
  };
  return { cwd, root, jar, node, script, probe, receipt, artifacts, state, calls, save, deps: { command, environment: {} } };
}
const operationId='11111111-1111-4111-8111-111111111111';
const request=()=>({operationId,purpose:'BACKUP_LOCAL',completionPolicy:'RESTORE_ORIGINAL',targetRunId:null,incidentStartedAt:null});
async function liveFixture(t,apiState='running') {
  const f=await fixture(t),original=f.deps.command,api=f.state.containers[1];f.deps.cwd=f.cwd;
  const originalEndpoints=structuredClone(api.NetworkSettings.Networks);
  const setRunning=running=>{
    api.State.Running=running;api.NetworkSettings.Networks=structuredClone(originalEndpoints);
    for(const network of f.state.networks) {
      const endpoint=api.NetworkSettings.Networks[network.Name];
      if(running)network.Containers[api.Id]={IPv4Address:`${endpoint.IPAddress}/16`};
      else {delete network.Containers[api.Id];endpoint.IPAddress='';}
    }
  };
  setRunning(apiState==='running');f.state.backends=[];
  f.deps.command=async(file,args,options)=>{
    const a=args.slice(2);
    if(a[0]==='stop'||a[0]==='start') {f.calls.push(args);assert.equal(a.at(-1),api.Id);setRunning(a[0]==='start');return{stdout:''};}
    if(a[0]==='inspect'&&a[1]==='--format')return{stdout:'healthy\n'};
    if(a[0]==='exec'&&a.at(-1).includes('pg_stat_activity'))return{stdout:JSON.stringify(f.state.backends)};
    return original(file,args,options);
  };
  return f;
}
test('PP1C_L03a_forged_or_serialized_tokens_have_no_authority', async t=>{
  const f=await liveFixture(t),inspection=await inspectTarget(f.root,f.deps,{apiState:'running'});
  await assert.rejects(workflow.beginWorkflow(structuredClone(inspection),request(),f.deps));
  const token=await workflow.beginWorkflow(inspection,request(),f.deps);
  await assert.rejects(workflow.assertWorkflow({}, {},f.deps));
  await assert.rejects(workflow.assertWorkflow(JSON.parse(JSON.stringify(token)),{},f.deps));
});
test('PP1C_L03a_lock_inode_swap_and_source_drift_rejected', async t=>{
  const f=await liveFixture(t),inspection=await inspectTarget(f.root,f.deps,{apiState:'running'});
  const token=await workflow.beginWorkflow(inspection,request(),f.deps),lock=join(f.root,'maintenance/operation.lock');
  await rename(lock,`${lock}.old`);await mkdir(lock,{mode:0o700});
  await assert.rejects(workflow.assertWorkflow(token,{},f.deps));
});
test('PP1C_L03a_backup_restores_only_original_running_state', async t=>{
  for(const state of ['running','stopped']) {
    const f=await liveFixture(t,state),inspection=await inspectTarget(f.root,f.deps,{apiState:state});
    const token=await workflow.beginWorkflow(inspection,request(),f.deps);
    for(const phase of ['SOURCE_QUIESCED','LOCAL_CAPTURED','LOCAL_VERIFIED']) {
      await workflow.beginPhase(token,phase,{},f.deps);await workflow.endPhase(token,{},f.deps);
    }
    await workflow.finishWorkflow(token,{success:true},f.deps);
    assert.equal(f.state.containers[1].State.Running,state==='running');
    await assert.rejects(workflow.assertWorkflow(token,{},f.deps));
    assert.equal(f.calls.filter(a=>a[2]==='start').length,state==='running'?1:0);
  }
});
test('PP1C_L03a_writer_failure_retains_lock_and_never_restarts', async t=>{
  const f=await liveFixture(t),inspection=await inspectTarget(f.root,f.deps,{apiState:'running'});
  const token=await workflow.beginWorkflow(inspection,request(),f.deps);
  f.state.backends=[{pid:9}];await assert.rejects(workflow.beginPhase(token,'SOURCE_QUIESCED',{},f.deps));
  await workflow.failWorkflow(token,'WRITER_NOT_QUIESCED',f.deps);
  assert.equal(f.state.containers[1].State.Running,false);
  assert.equal(JSON.parse(await readFile(join(f.root,'maintenance/lease.json'))).phase,'FAILED_OR_UNKNOWN');
});
test('PP1C_L03a_source_identity_drift_is_not_token_authority',async t=>{
  const f=await liveFixture(t),inspection=await inspectTarget(f.root,f.deps,{apiState:'running'});
  const token=await workflow.beginWorkflow(inspection,request(),f.deps);f.state.oid='99999\n';
  await assert.rejects(workflow.assertWorkflow(token,{},f.deps));
  assert.equal(f.calls.filter(a=>a[2]==='start').length,0);
});
import { buildHelperPolicy } from './maintenance-helper.mjs';
import { canonicalBytes, sha256 } from '../ops/recovery-protocol.mjs';
async function capturePhase(t,restore=false) {
  const f=await liveFixture(t,'stopped'),inspection=await inspectTarget(f.root,f.deps,{apiState:'stopped'});
  const r=request();if(restore)Object.assign(r,{purpose:'RESTORE_VERIFY_LOCAL',completionPolicy:'KEEP_STOPPED',targetRunId:'d'.repeat(32),incidentStartedAt:'2026-11-01T00:00:00.000Z'});
  const token=await workflow.beginWorkflow(inspection,r,f.deps);
  await workflow.beginPhase(token,'SOURCE_QUIESCED',{},f.deps);await workflow.endPhase(token,{},f.deps);
  await workflow.beginPhase(token,'LOCAL_CAPTURED',{},f.deps);return{...f,token,r};
}
test('PP1C_L03b_single_restore_child_marker_cannot_be_adopted',async t=>{
  const f=await capturePhase(t,true);
  await workflow.endPhase(f.token,{},f.deps);await workflow.beginPhase(f.token,'LOCAL_VERIFIED',{},f.deps);await workflow.endPhase(f.token,{},f.deps);
  const child=await workflow.reserveRestoreTarget(f.token,{runId:f.r.targetRunId},f.deps);
  assert.equal(child.target.creationPhase,'RESERVED');
  await assert.rejects(workflow.reserveRestoreTarget(f.token,{runId:f.r.targetRunId},f.deps));
  await assert.rejects(inspectTarget(child.root,f.deps,{apiState:'stopped'}));
  assert.equal(JSON.parse(await readFile(join(child.root,'restore-target.json'))).sourceOperationId,operationId);
});
test('PP1C_L03b_helper_reservation_is_unique_and_uses_approved_path',async t=>{
  const f=await capturePhase(t),context=await workflow.reserveHelper(f.token,{side:'source',kind:'MEDIA_PACK'},f.deps);
  assert.equal(context.helperRoot,join(f.root,'maintenance','operations',operationId,'helper','1'));
  await assert.rejects(workflow.reserveHelper(f.token,{side:'source',kind:'MEDIA_PACK'},f.deps));
  await assert.rejects(workflow.reserveHelper({}, {side:'source',kind:'MEDIA_PACK'},f.deps));
});
function helperContainer(policy,expected,volumeMountpoints) {
  return {Id:expected.fullContainerId,Name:`/${expected.name}`,Image:policy.imageId,
    State:{Status:'created',Running:false},Config:{Labels:expected.labels,Env:policy.env,User:policy.user,
      Entrypoint:[policy.entrypoint],Cmd:policy.args,OpenStdin:true,Tty:false},
    HostConfig:{ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],CapAdd:[],SecurityOpt:['no-new-privileges'],
      RestartPolicy:{Name:'no'},LogConfig:{Type:'none'},PortBindings:{},Devices:[],DeviceRequests:[],ExtraHosts:[],
      PidMode:'',IpcMode:'private',AutoRemove:false,Tmpfs:{'/tmp':'rw,nosuid,nodev,size=67108864',...(policy.entrypoint==='/usr/local/bin/pg_dump'||policy.entrypoint==='/usr/local/bin/pg_restore'?{'/var/lib/postgresql/data':'ro,nosuid,nodev,noexec,size=1048576'}:{})},NetworkMode:policy.networkId??'none'},
    NetworkSettings:{Ports:{},Networks:policy.networkId?{}:{none:{NetworkID:'',EndpointID:'',IPAddress:''}}},Mounts:policy.mounts.map(m=>({Type:m.type,Name:m.type==='volume'?m.source:undefined,
      Source:m.type==='volume'?volumeMountpoints[m.source]:m.source,Destination:m.destination,RW:!m.readOnly}))};
}
async function helperFixture(t,kind='MEDIA_PACK') {
  const f=await capturePhase(t),original=f.deps.command;
  f.deps.command=async(file,args,options)=>{
    const a=args.slice(2);
    if(a[0]==='image') {const result=await original(file,args,options);const rows=JSON.parse(result.stdout);rows.forEach(x=>Object.assign(x.Config,{Env:[],User:'',Volumes:x.Id===f.receipt.images.postgres?{'/var/lib/postgresql/data':{}}:null}));return{stdout:JSON.stringify(rows)};}
    if(a[0]==='network'&&a[2]==='none')return{stdout:JSON.stringify([{Id:'9'.repeat(64),Name:'none',Driver:'null',Scope:'local'}])};
    if(a[0]==='volume')return{stdout:JSON.stringify(f.state.volumes.filter(v=>a.slice(2).includes(v.Name)))};
    if(a[0]==='inspect'&&a.length===2) {
      const rows=f.state.containers.filter(c=>c.Id===a[1]);
      if(rows.length===0)return{code:1,stderr:`Error: No such object: ${a[1]}`};return{stdout:JSON.stringify(rows)};
    }
    return original(file,args,options);
  };
  const context=await workflow.reserveHelper(f.token,{side:'source',kind},f.deps);
  const image={Id:context.target.images[kind==='MEDIA_PACK'?'node':'api'],Os:'linux',Config:{Env:[],User:'',Labels:kind==='INVENTORY'?f.state.apiLabels:{}}};
  const policy=buildHelperPolicy({...context,image,kind,side:'source'}),policySha256=sha256(canonicalBytes(policy));
  const expected={fullContainerId:'f'.repeat(64),name:`cms-pp1c-${operationId}-1`,labels:{...image.Config.Labels,'org.cms.pp1c.operation':operationId,
    'org.cms.pp1c.seq':'1','org.cms.pp1c.kind':kind,'org.cms.pp1c.policy':policySha256},
    volumeMountpoints:Object.fromEntries(f.state.volumes.map(v=>[v.Name,v.Mountpoint])),state:'created',dataNetworkName:`${project}_data`,noneNetworkId:'9'.repeat(64)};
  const helper={kind,side:'source',fullContainerId:expected.fullContainerId,policySha256,state:'CREATED',endpoint:null,backend:null,startedAt:new Date().toISOString()};
  const container=helperContainer(policy,expected,expected.volumeMountpoints);
  if(policy.networkId) container.NetworkSettings.Networks[`${project}_data`]={NetworkID:policy.networkId,IPAddress:''};
  f.state.containers.push(container);
  return{...f,context,policy,expected,helper,container};
}
test('PP1C_L03b_only_exact_registered_helper_passes_fresh_inspection',async t=>{
  const f=await helperFixture(t);
  await assert.rejects(inspectTarget(f.root,f.deps,{apiState:'stopped'}));
  await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  await workflow.assertWorkflow(f.token,{},f.deps);
  f.container.HostConfig.Privileged=true;
  await assert.rejects(workflow.assertWorkflow(f.token,{},f.deps));
});
test('PP1C_L03b_helper_clear_requires_verified_absence',async t=>{
  const f=await helperFixture(t);await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  await assert.rejects(workflow.clearOwnedHelper(f.token,f.deps));
  f.state.containers.pop();await workflow.clearOwnedHelper(f.token,f.deps);
  const next=await workflow.reserveHelper(f.token,{side:'source',kind:'MEDIA_PACK'},f.deps);assert.equal(next.seq,'2');
});
test('PP1C_L03b_media_helper_does_not_exempt_database_writers',async t=>{
  const f=await helperFixture(t);await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  f.state.backends=[{pid:999}];await assert.rejects(workflow.assertWorkflow(f.token,{},f.deps),/WRITER_NOT_QUIESCED/);
});
test('PP1C_L03b_helper_state_and_identity_cannot_be_replayed',async t=>{
  const f=await helperFixture(t);await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  f.container.State={Status:'running',Running:true};
  Object.assign(f.container.NetworkSettings.Networks.none,{NetworkID:'9'.repeat(64),EndpointID:'8'.repeat(64)});
  await workflow.updateOwnedHelper(f.token,{...f.helper,state:'RUNNING'},f.deps);
  await assert.rejects(workflow.updateOwnedHelper(f.token,{...f.helper,state:'RUNNING'},f.deps));
  await assert.rejects(workflow.updateOwnedHelper(f.token,{...f.helper,state:'EXITED',fullContainerId:'e'.repeat(64)},f.deps));
  f.container.State={Status:'exited',Running:false};f.container.NetworkSettings.Networks.none.EndpointID='';
  await workflow.updateOwnedHelper(f.token,{...f.helper,state:'EXITED'},f.deps);
  await assert.rejects(workflow.endPhase(f.token,{},f.deps));
});
test('PP1C_L03b_future_child_runtime_cannot_be_faked_by_phase_patch',async t=>{
  const f=await capturePhase(t,true);await workflow.endPhase(f.token,{},f.deps);
  await workflow.beginPhase(f.token,'LOCAL_VERIFIED',{},f.deps);await workflow.endPhase(f.token,{},f.deps);
  const child=await workflow.reserveRestoreTarget(f.token,{runId:f.r.targetRunId},f.deps);
  await assert.rejects(workflow.beginPhase(f.token,'TARGET_BLANK',{},f.deps),/ADAPTER_UNSEALED/);
  await assert.rejects(workflow.assertWorkflow(f.token,{side:'target'},f.deps),/ADAPTER_UNSEALED/);
  await assert.rejects(workflow.finishWorkflow(f.token,{success:true},f.deps),/ADAPTER_UNSEALED/);
  await rename(child.root,`${child.root}.old`);await mkdir(child.root,{mode:0o700});
  await assert.rejects(workflow.assertWorkflow(f.token,{},f.deps));
});
test('PP1C_L03b_registered_helper_never_exempts_an_extra_mount_holder',async t=>{
  const f=await helperFixture(t);await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  f.state.containers.push({...structuredClone(f.container),Id:'e'.repeat(64)});
  await assert.rejects(workflow.assertWorkflow(f.token,{},f.deps));
});
test('PP1C_L03b_caller_policy_cannot_authorize_arbitrary_command',async t=>{
  const f=await helperFixture(t);f.policy.args=['/bin/sh'];f.container.Config.Cmd=f.policy.args;
  f.helper.policySha256=sha256(canonicalBytes(f.policy));f.expected.labels['org.cms.pp1c.policy']=f.helper.policySha256;
  await assert.rejects(workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps),/ADAPTER_UNSEALED/);
});
test('PP1C_L03b_child_marker_replacement_is_rejected',async t=>{
  const f=await capturePhase(t,true);await workflow.endPhase(f.token,{},f.deps);
  await workflow.beginPhase(f.token,'LOCAL_VERIFIED',{},f.deps);await workflow.endPhase(f.token,{},f.deps);
  const child=await workflow.reserveRestoreTarget(f.token,{runId:f.r.targetRunId},f.deps),path=join(child.root,'restore-target.json');
  const bytes=await readFile(path);await rename(path,`${path}.old`);await writeFile(path,bytes,{mode:0o600});
  await assert.rejects(workflow.assertWorkflow(f.token,{},f.deps));
});

import { PassThrough } from 'node:stream';
import { runJdbcHandshake } from './maintenance-helper.mjs';
function setHelperRunning(f,running) {
  const network=f.state.networks.find(n=>n.Id===f.policy.networkId);
  f.container.State={Status:running?'running':'exited',Running:running,ExitCode:0};
  f.container.NetworkSettings.Networks[network.Name].IPAddress=running?'172.31.0.9':'';
  if(running) network.Containers[f.container.Id]={IPv4Address:'172.31.0.9/16'};
  else delete network.Containers[f.container.Id];
}
async function jdbcFixture(t) {
  const f=await helperFixture(t,'INVENTORY');
  await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  setHelperRunning(f,true);f.helper={...f.helper,state:'RUNNING',endpoint:{networkId:f.policy.networkId,address:'172.31.0.9'}};
  await workflow.updateOwnedHelper(f.token,f.helper,f.deps);
  f.backend={pid:81,backendStartEpoch:'1770000000.123',db:'cms',role:'cms_local',clientAddr:'172.31.0.9',applicationName:operationId};
  f.row={pid:81,backend_start_epoch:'1770000000.123',datname:'cms',usename:'cms_local',client_addr:'172.31.0.9',application_name:operationId,state:'idle in transaction'};
  f.state.backends=[f.row];return f;
}
for(const exited of [false,true,'reappearing']) test(`PP1C_H02b1_real_token_JDBC_closed_${exited==='reappearing'?'reappearing':exited?'EXITED':'running'}_before_result_and_EOF`,async t=>{
  const f=await jdbcFixture(t),child={stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()};
  t.after(()=>{for(const stream of Object.values(child))stream.destroy();});
  const request={version:1,mode:'INVENTORY',operationId,side:'source',targetId:f.context.target.targetId,
    releaseId:`sha256:${f.context.target.apiBuild.jarSha256}`,jdbcUrl:f.context.lease.sourceConnection.jdbcUrl,dbUser:'cms_local',
    passwordFile:'/run/secrets/spring.datasource.password',mediaRoot:'/media',outputFile:'/run/pp1/output/inventory.json',backupId:null,rawProofSha256:null};
  const ready={version:1,operationId,side:'source',mode:'INVENTORY',requestSha256:sha256(canonicalBytes(request)),backend:f.backend,readOnly:true};
  const result={version:1,operationId,mode:'INVENTORY',inventorySha256:'a'.repeat(64),dbSnapshotSha256:'b'.repeat(64),
    assetCount:'0',referencedFileCount:'0',orphanFileCount:'0',fileCount:'0',fileBytes:'0'};
  let permits=0,drains=0;
  child.stdin.on('data',()=>{permits++;f.state.backends=[];if(exited===true)setHelperRunning(f,false);});
  const observed=()=>{const rows=f.state.backends.map(r=>({pid:r.pid,backendStartEpoch:r.backend_start_epoch,db:r.datname,role:r.usename,clientAddr:r.client_addr,applicationName:r.application_name}));
    if(exited==='reappearing'&&drains>0)f.state.backends=[];return rows;};
  const promise=runJdbcHandshake(child,request,{address:f.backend.clientAddr,
    assertCurrent:()=>workflow.assertWorkflow(f.token,{},f.deps),observe:async()=>observed(),
    assertDraining:async()=>{const current=await workflow.assertHelperDrain(f.token,f.deps);drains++;
      if(exited==='reappearing')f.state.backends=[f.row];
      if(drains===1) child.stdout.write(canonicalBytes(result));
      if(drains===2){child.stdout.end();child.stderr.end();}return current;},
    onReady:async backend=>{f.helper={...f.helper,state:'READY',backend};await workflow.updateOwnedHelper(f.token,f.helper,f.deps);},
    onPermitted:async()=>{f.helper={...f.helper,state:'PERMITTED'};await workflow.updateOwnedHelper(f.token,f.helper,f.deps);}});
  child.stdout.write(canonicalBytes(ready));
  if(exited==='reappearing')await assert.rejects(promise);
  else{assert.deepEqual(await promise,result);assert.ok(drains>=2);}
  assert.equal(permits,1);
  await assert.rejects(workflow.reserveHelper(f.token,{side:'source',kind:'INVENTORY'},f.deps));
  await assert.rejects(workflow.assertHelperDrain({},f.deps));
});
async function permittedJdbc(t) {
  const f=await jdbcFixture(t);
  f.helper={...f.helper,state:'READY',backend:f.backend};await workflow.updateOwnedHelper(f.token,f.helper,f.deps);
  f.helper={...f.helper,state:'PERMITTED'};await workflow.updateOwnedHelper(f.token,f.helper,f.deps);return f;
}
for(const fault of ['extra','replaced','reappearing','policy','identity','network','second-helper','replay']) {
  test(`PP1C_H02b1_real_token_drain_rejects_${fault}`,async t=>{
    const f=await permittedJdbc(t);
    if(fault==='reappearing'){f.state.backends=[];await workflow.assertHelperDrain(f.token,f.deps);f.state.backends=[f.row];}
    if(fault==='extra')f.state.backends.push({...f.row,pid:82});
    if(fault==='replaced')f.state.backends=[{...f.row,pid:82}];
    if(fault==='policy')f.container.HostConfig.Privileged=true;
    if(fault==='identity')f.container.Id='e'.repeat(64);
    if(fault==='network')f.container.NetworkSettings.Networks[`${project}_data`].IPAddress='172.31.0.8';
    if(fault==='second-helper')f.state.containers.push({...structuredClone(f.container),Id:'e'.repeat(64)});
    if(fault==='replay') {
      f.state.backends=[];setHelperRunning(f,false);await workflow.assertHelperDrain(f.token,f.deps);
      setHelperRunning(f,true);
    }
    await assert.rejects(workflow.assertHelperDrain(f.token,f.deps));
  });
}
test('PP1C_H02b1_created_and_running_cannot_begin_JDBC_drain',async t=>{
  const f=await helperFixture(t,'INVENTORY');await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  await assert.rejects(workflow.assertHelperDrain(f.token,f.deps));
  setHelperRunning(f,true);const running={...f.helper,state:'RUNNING',endpoint:{networkId:f.policy.networkId,address:'172.31.0.9'}};
  await workflow.updateOwnedHelper(f.token,running,f.deps);await assert.rejects(workflow.assertHelperDrain(f.token,f.deps));
  setHelperRunning(f,false);
  await assert.rejects(workflow.updateOwnedHelper(f.token,{...running,state:'EXITED',endpoint:null},f.deps));
});
test('PP1C_H02b1_endpoint_cannot_be_invented_before_start_or_replaced',async t=>{
  const f=await helperFixture(t,'INVENTORY'),endpoint={networkId:f.policy.networkId,address:'172.31.0.9'};
  await assert.rejects(workflow.registerOwnedHelper(f.token,{...f.helper,endpoint},f.policy,f.expected,f.deps));
});

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runOwnedHelper } from './maintenance-helper.mjs';
import * as helperModule from './maintenance-helper.mjs';
function emptyInventory() {
  const java=readFileSync(new URL('../../services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventory.java',import.meta.url),'utf8');
  const tables=[...java.matchAll(/Map.entry\("([^"]+)", List.of\((.*?)\)\)/g)].map(([,tableName,values])=>{
    const schema={columns:[...values.matchAll(/"([^"]+)"/g)].map(([,name],i)=>({ordinalPosition:String(i+1),name,dataType:'text',udtSchema:'pg_catalog',udtName:'text',isNullable:true,
      characterMaximumLength:null,numericPrecision:null,numericScale:null,datetimePrecision:null,columnDefault:null,isIdentity:false,identityGeneration:null,isGenerated:false,generationExpression:null})),constraints:[],indexes:[]};
    return{tableName,schema,rows:[],schemaSha256:sha256(canonicalBytes(schema)),rowsSha256:sha256(canonicalBytes([])),rowCount:'0',snapshotSha256:sha256(canonicalBytes({schema,rows:[]}))};
  }).sort((a,b)=>a.tableName.localeCompare(b.tableName));
  return{version:1,files:[],tables,assets:[],variants:[],dbSnapshotSha256:sha256(canonicalBytes(tables.map(({tableName,schemaSha256,rowsSha256,rowCount})=>({tableName,schemaSha256,rowsSha256,rowCount})))),mediaHeaderSha256:sha256(canonicalBytes({version:1,files:[]}))};
}
async function ownedFixture(t,fault=null,restore=false) {
  const f=await capturePhase(t,restore),original=f.deps.command;f.inventory=emptyInventory();f.permits=0;f.requests=[];f.permitRecords=[];f.closedBeforeReceipt=0;let counter=10;
  await mkdir(join(f.cwd,'scripts/ops'),{recursive:true});
  await writeFile(join(f.cwd,'scripts/ops/local-media.mjs'),readFileSync(new URL('../ops/local-media.mjs',import.meta.url)));

  await mkdir(join(f.root,'secrets'),{mode:0o700});await writeFile(join(f.root,'secrets/spring.datasource.password'),'synthetic',{mode:0o600});
  const helperList=()=>f.state.containers.filter(c=>c.Config.Labels['org.cms.pp1c.operation']);
  const setState=(c,state)=>{
    c.State={Status:state,Running:state==='running',ExitCode:0};
    if(c.HostConfig.NetworkMode!=='none') {
      const network=[...f.state.networks,...(f.childState?.networks??[])].find(n=>n.Id===c.HostConfig.NetworkMode);
      const address=network.Name.startsWith(project)?'172.31.0.9':'172.29.0.9';
      c.NetworkSettings.Networks[network.Name]={NetworkID:state==='running'?network.Id:'',IPAddress:state==='running'?address:'',EndpointID:''};
      if(state==='running')network.Containers[c.Id]={IPv4Address:`${address}/16`};else delete network.Containers[c.Id];
    }else c.NetworkSettings.Networks={none:{NetworkID:state==='created'?'':f.noneId??'9'.repeat(64),EndpointID:state==='running'?'8'.repeat(64):'',IPAddress:''}};
  };
  f.deps.command=async(file,args,options)=>{
    if(file==='javac'||file.endsWith('/javac')) {
      if(args[0]==='-version')return{stdout:'javac 25.0.5\n'};
      await writeFile(join(args[args.indexOf('-d')+1],'Profile.class'),'synthetic-class');return{stdout:''};
    }
    const a=args.slice(2),find=key=>a.find(v=>v.startsWith(key+'='))?.slice(key.length+1);f.calls.push(args);
    if(a[0]==='image') {const r=await original(file,args,options),images=JSON.parse(r.stdout);images.forEach(x=>Object.assign(x.Config,{Env:[],User:'',Volumes:x.Id===f.receipt.images.postgres?{'/var/lib/postgresql/data':{}}:null}));return{stdout:JSON.stringify(images)};}
    if(a[0]==='network'&&a[2]==='none')return{stdout:JSON.stringify([{Id:f.noneId??'9'.repeat(64),Name:'none',Driver:'null',Scope:'local'}])};
    if(a[0]==='volume')return{stdout:JSON.stringify(f.state.volumes.filter(v=>a.slice(2).includes(v.Name)))};
    if(a[0]==='create') {
      const labels=a.includes(f.receipt.images.api)?{...f.state.apiLabels}:{};for(let i=0;i<a.length;i++)if(a[i]==='--label'){const text=a[++i],n=text.indexOf('=');labels[text.slice(0,n)]=text.slice(n+1);}
      const entry=a.indexOf('--entrypoint='+find('--entrypoint')),mounts=[];
      for(let i=0;i<a.length;i++)if(a[i]==='--mount') {const fields=Object.fromEntries(a[++i].split(',').map(v=>v.split('=')));
        mounts.push({type:fields.type,source:fields.src,destination:fields.dst,readOnly:Object.hasOwn(fields,'readonly')});}
      const policy={imageId:a[entry+1],user:find('--user'),entrypoint:find('--entrypoint'),args:a.slice(entry+2),env:[],mounts,networkId:find('--network')==='none'?null:find('--network')};
      for(let i=0;i<a.length;i++)if(a[i]==='--env')policy.env.push(a[++i]);policy.env.sort();
      const expected={fullContainerId:(counter++).toString(16).padStart(64,'0'),name:a[a.indexOf('--name')+1],labels};
      const c=helperContainer(policy,expected,Object.fromEntries([...f.state.volumes,...(f.childState?.volumes??[])].map(v=>[v.Name,v.Mountpoint])));
      if(policy.networkId)setState(c,'created');f.state.containers.push(c);return{stdout:c.Id+'\n'};
    }
    if(a[0]==='inspect'&&a.length===2&&a[1]!=='--format') {
      const c=f.state.containers.find(x=>x.Id===a[1]);return c?{stdout:JSON.stringify([c])}:{code:1,stderr:`${fault==='lowercase-missing'?'error: no such object:':'Error: No such object:'} ${a[1]}\n`};
    }
    if(a[0]==='start'&&a.includes('--attach')) {
      const c=helperList().find(x=>x.Id===a.at(-1));setState(c,'exited');
      if(c.Config.Entrypoint[0].endsWith('/java'))return{stdout:JSON.stringify({javaRuntimeVersion:'25.0.5+8',jdbc:true,imageio:true,privateFiles:true,mediaReadable:true})+'\n'};
      if(c.Config.Entrypoint[0].endsWith('/pg_dump'))return{stdout:'pg_dump (PostgreSQL) 16.15\n'};
      if(c.Config.Entrypoint[0].endsWith('/pg_restore'))return{stdout:'pg_restore (PostgreSQL) 16.15\n'};
      if(c.Config.Entrypoint[0].endsWith('/id'))return{stdout:'0\n'};
      return{stdout:JSON.stringify({node:'v24.18.0',uid:process.getuid(),gid:process.getgid(),privateFiles:true,directoryFsync:true})+'\n'};
    }
    if(a[0]==='exec'&&a.at(-1)==='SHOW server_version;')return{stdout:'16.15\n'};
    if(a[0]==='exec'&&a.at(-1)==='SHOW server_version_num;')return{stdout:'160015\n'};
    if(a[0]==='exec'&&a.at(-1).includes('pg_stat_activity')&&f.pendingPg) {
      const lease=JSON.parse(await readFile(join(f.root,'maintenance/lease.json')));
      if(lease.helper?.backend){const finish=f.pendingPg;delete f.pendingPg;setTimeout(finish,250);}
    }
    if(a[0]==='top') {
      const c=helperList().find(x=>x.Id===a[1]);
      const headers={'top-padded':'PID                 COMMAND','top-tabs':'  PID\t  COMMAND  ',
        'top-unknown':'PID ARGS','top-extra':'PID USER COMMAND','top-missing':'PID','top-newline':'PID\nCOMMAND','top-leading-newline':'\nPID COMMAND'};
      const command=[...c.Config.Entrypoint,...c.Config.Cmd].join(' ')+(fault==='top-wrong-argv'?' --unexpected':'');
      return{stdout:`${headers[fault]??'PID COMMAND'}\n17 ${command}\n${fault==='top-extra-process'?`18 ${command}\n`:''}`};
    }
    if(a[0]==='rm'){f.state.containers.splice(f.state.containers.findIndex(c=>c.Id===a[1]),1);return{stdout:a[1]};}
    if(a[0]==='wait')return{stdout:'0\n'};
    return original(file,args,options);
  };
  f.deps.spawn=(_file,args)=>{
    const c=helperList().find(x=>x.Id===args.at(-1));setState(c,'running');
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
    const target=c.HostConfig.NetworkMode===f.childState?.networks[1].Id;
    const backendState=target?f.childState:f.state,address=target?'172.29.0.9':'172.31.0.9';
    const close=()=>{backendState.backends=[];setState(c,'exited');child.stdout.end();child.stderr.end();child.emit('close',0,null);};
    const requestPath=c.Mounts.find(m=>m.Destination==='/run/pp1/request.json')?.Source;
    if(requestPath) {
      const request=JSON.parse(readFileSync(requestPath)),backend={pid:91,backendStartEpoch:'1770000000.123',db:'cms',role:'cms_local',clientAddr:address,applicationName:operationId};
      backendState.backends=[{pid:91,backend_start_epoch:backend.backendStartEpoch,datname:'cms',usename:'cms_local',client_addr:backend.clientAddr,application_name:operationId,state:'idle in transaction'}];
      f.requests.push(request);
      const readyRequest=f.readyImageRelease?{...request,releaseId:f.receipt.images.api}:request;
      child.stdout.write(canonicalBytes({version:1,operationId,side:request.side,mode:request.mode,requestSha256:sha256(canonicalBytes(readyRequest)),backend,readOnly:true}));
      child.stdin.on('data',bytes=>f.permitRecords.push(JSON.parse(bytes)));
      child.stdin.on('finish',async()=>{
        if(request.mode==='REVOKE_SESSIONS'){
          f.permits++;f.receivedRevokeRequest=request;backendState.backends=[];setState(c,'exited');
          setTimeout(()=>{if(!backendState.backends.length&&!c.State.Running)f.closedBeforeReceipt++;child.stdout.write(canonicalBytes({operationId,backupId:request.backupId,revokedCount:'0',auditEventId:'40000000-0000-4000-8000-000000000004',committed:true}));close();},120);return;
        }
        f.permits++;const output=join(c.Mounts.find(m=>m.Destination==='/run/pp1/output').Source,'inventory.json');
        await writeFile(output,canonicalBytes(f.inventory),{mode:fault==='output-mode'?0o644:0o600});backendState.backends=[];setState(c,'exited');
        setTimeout(()=>{if(!backendState.backends.length&&!c.State.Running)f.closedBeforeReceipt++;child.stdout.write(canonicalBytes({version:1,operationId,mode:'INVENTORY',inventorySha256:fault==='receipt-hash'?'0'.repeat(64):sha256(canonicalBytes(f.inventory)),dbSnapshotSha256:f.inventory.dbSnapshotSha256,
          assetCount:'0',referencedFileCount:'0',orphanFileCount:'0',fileCount:'0',fileBytes:'0'}));close();},120);
      });
    }else if(c.Config.Entrypoint[0].endsWith('/pg_restore')) {
      backendState.backends=[{pid:91,backend_start_epoch:'1770000000.123',datname:'cms',usename:'cms_local',client_addr:address,application_name:operationId,state:'active'}];
      const chunks=[];child.stdin.on('data',chunk=>chunks.push(chunk));child.stdin.on('finish',()=>{f.receivedRestore=Buffer.concat(chunks);});
      f.pendingTargetPg=()=>{backendState.backends=[];setState(c,'exited');setTimeout(close,120);};
    }else if(c.Config.Entrypoint[0].endsWith('/pg_dump')) {
      backendState.backends=[{pid:91,backend_start_epoch:'1770000000.123',datname:'cms',usename:'cms_local',client_addr:address,application_name:operationId,state:'active'}];
      f.pendingPg=()=>{child.stdout.write(Buffer.from('PGDMP-synthetic'));
        if(fault==='pg-exit-before-drain'){f.state.backends=[];setState(c,'exited');setTimeout(close,250);}else close();};
    }else {
      const input=[];child.stdin.on('data',bytes=>input.push(bytes));
      child.stdin.on('finish',()=>{
        if(c.Config.Cmd.at(-1)==='restore'){
          f.receivedRestore=Buffer.concat(input);child.stdout.write(canonicalBytes({version:1,operationId:null,fileCount:'0',fileBytes:'0',mediaHeaderSha256:f.inventory.mediaHeaderSha256}));close();return;
        }
        assert.deepEqual(Buffer.concat(input),canonicalBytes(f.inventory));
        const header=canonicalBytes({version:1,files:f.inventory.files}),length=Buffer.alloc(8);length.writeBigUInt64BE(BigInt(header.length));
        child.stdout.write(Buffer.concat([Buffer.from('PP1CMEDIA1\n'),length,header]));
        if(fault==='media-writer'){f.state.backends=[{pid:999}];setTimeout(close,350);}else close();
      });
    }
    return child;
  };return f;
}
test('PP1C_H02b2b_owned_inventory_uses_private_request_profile_and_receipt_binding',async t=>{
  const f=await ownedFixture(t),result=await runOwnedHelper(f.token,{side:'source',kind:'INVENTORY'},f.deps);
  assert.deepEqual(result.inventory,f.inventory);assert.equal(result.sha256,sha256(canonicalBytes(f.inventory)));assert.equal(f.permits,1);
  assert.deepEqual(Object.keys(result.profile).sort(),['javaRuntimeVersion','pgDumpVersion','pgRestoreVersion','postgresServerVersion']);
  assert.equal(result.profile.javaRuntimeVersion,'25.0.5+8');assert.equal((await workflow.assertWorkflow(f.token,{},f.deps)).lease.helper,null);
  assert.ok(result.path.startsWith(join(f.root,'maintenance/operations',operationId,'helper/1/output')));
});

test('PP1C_H02b2c_media_stream_rejects_transient_writer_before_EOF',async t=>{
  const f=await ownedFixture(t,'media-writer');await runOwnedHelper(f.token,{side:'source',kind:'INVENTORY'},f.deps);
  await assert.rejects(runOwnedHelper(f.token,{side:'source',kind:'MEDIA_PACK'},f.deps));
});
test('PP1C_H02b2c_owned_PG_and_media_streams_are_private_and_bound_to_prior_inventory',async t=>{
  const f=await ownedFixture(t);const inventory=await runOwnedHelper(f.token,{side:'source',kind:'INVENTORY'},f.deps);
  const pg=await runOwnedHelper(f.token,{side:'source',kind:'PG_DUMP'},f.deps);
  assert.equal(await readFile(pg.path,'utf8'),'PGDMP-synthetic');assert.equal(pg.sha256,sha256(Buffer.from('PGDMP-synthetic')));
  await assert.rejects(readFile(join(pg.path,'../pgpass')),{code:'ENOENT'});
  const media=await runOwnedHelper(f.token,{side:'source',kind:'MEDIA_PACK'},f.deps);
  assert.ok((await readFile(media.path)).subarray(0,11).equals(Buffer.from('PP1CMEDIA1\n')));
  assert.equal((await workflow.assertWorkflow(f.token,{},f.deps)).lease.helper,null);
  assert.equal(inventory.inventorySha256,sha256(canonicalBytes(f.inventory)));
});
for(const fault of ['output-mode','receipt-hash'])test(`PP1C_H02b2c_owned_inventory_rejects_${fault}_and_retains_lock`,async t=>{
  const f=await ownedFixture(t,fault);await assert.rejects(runOwnedHelper(f.token,{side:'source',kind:'INVENTORY'},f.deps));
  const lease=JSON.parse(await readFile(join(f.root,'maintenance/lease.json')));assert.equal(lease.phase,'FAILED_OR_UNKNOWN');
  await assert.rejects(workflow.assertWorkflow(f.token,{},f.deps));assert.equal(f.state.containers[1].State.Running,false);
});
test('PP1C_H02b2c_media_rejects_changed_prior_inventory_and_forged_token',async t=>{
  const f=await ownedFixture(t);const inventory=await runOwnedHelper(f.token,{side:'source',kind:'INVENTORY'},f.deps);
  await assert.rejects(runOwnedHelper({}, {side:'source',kind:'PG_DUMP'},f.deps));
  await assert.rejects(runOwnedHelper(f.token,{side:'source',kind:'PG_DUMP',path:'/arbitrary'},f.deps));
  await writeFile(inventory.path,'{}\n');
  await assert.rejects(runOwnedHelper(f.token,{side:'source',kind:'MEDIA_PACK'},f.deps));
});

test('PP1C_H02b2c_owned_PG_container_EXITED_before_output_drain',async t=>{
  const f=await ownedFixture(t,'pg-exit-before-drain');
  const result=await runOwnedHelper(f.token,{side:'source',kind:'PG_DUMP'},f.deps);
  assert.equal(await readFile(result.path,'utf8'),'PGDMP-synthetic');
  assert.equal((await workflow.assertWorkflow(f.token,{},f.deps)).lease.helper,null);
});

test('PP1C_H02b2c_media_source_script_drift_rejected',async t=>{
  const f=await ownedFixture(t);await runOwnedHelper(f.token,{side:'source',kind:'INVENTORY'},f.deps);
  await writeFile(join(f.cwd,'scripts/ops/local-media.mjs'),'changed');
  await assert.rejects(runOwnedHelper(f.token,{side:'source',kind:'MEDIA_PACK'},f.deps));
});

test('PP1C_H02b2e_real_token_wrapper_clears_lowercase_missing_helper_and_reservation',async t=>{
  const f=await ownedFixture(t,'lowercase-missing');
  const first=await runOwnedHelper(f.token,{side:'source',kind:'INVENTORY'},f.deps);
  assert.equal((await workflow.assertWorkflow(f.token,{},f.deps)).lease.helper,null);
  const second=await runOwnedHelper(f.token,{side:'source',kind:'INVENTORY'},f.deps);
  assert.equal((await workflow.assertWorkflow(f.token,{},f.deps)).lease.helper,null);
  assert.equal(f.permits,2);assert.equal(first.inventorySha256,second.inventorySha256);assert.notEqual(first.path,second.path);
});

for(const fault of ['wrong-ID','extra-text','wrong-code'])test(`PP1C_H02b2e_real_registry_rejects_missing_${fault}`,async t=>{
  const f=await helperFixture(t);await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  f.state.containers.pop();const run=f.deps.command;
  f.deps.command=async(file,args,options)=>args[2]==='inspect'&&args[3]===f.helper.fullContainerId?{
    code:fault==='wrong-code'?2:1,stderr:`error: no such object: ${fault==='wrong-ID'?'0'.repeat(64):f.helper.fullContainerId}${fault==='extra-text'?' extra':''}\n`}:run(file,args,options);
  await assert.rejects(workflow.clearOwnedHelper(f.token,f.deps));
  assert.equal(JSON.parse(await readFile(join(f.root,'maintenance/lease.json'))).helper.fullContainerId,f.helper.fullContainerId);
});

function inactiveEndpoint() {
  return {NetworkID:'',EndpointID:'',IPAddress:'',Gateway:'',MacAddress:'',IPv6Gateway:'',GlobalIPv6Address:'',IPPrefixLen:0,GlobalIPv6PrefixLen:0};
}
test('T126_network_real_registry_CREATED_blank_then_RUNNING_then_EXITED_blank',async t=>{
  const f=await helperFixture(t,'INVENTORY');
  f.expected.dataNetworkName=`${project}_data`;
  f.container.NetworkSettings.Networks={[`${project}_data`]:inactiveEndpoint()};
  await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  setHelperRunning(f,true);
  f.container.NetworkSettings.Networks[`${project}_data`].NetworkID=f.policy.networkId;
  f.helper={...f.helper,state:'RUNNING',endpoint:{networkId:f.policy.networkId,address:'172.31.0.9'}};
  await workflow.updateOwnedHelper(f.token,f.helper,f.deps);
  setHelperRunning(f,false);f.container.NetworkSettings.Networks={[`${project}_data`]:inactiveEndpoint()};
  f.helper={...f.helper,state:'EXITED'};await workflow.updateOwnedHelper(f.token,f.helper,f.deps);
  const state=await workflow.assertWorkflow(f.token,{},f.deps);assert.deepEqual(state.lease.helper.endpoint,f.helper.endpoint);
});
for(const fault of ['wrong-name','forged-name','host-network','network-ID','IP','endpoint','extra-network']) {
  test(`T126_network_real_registry_CREATED_rejects_${fault}`,async t=>{
    const f=await helperFixture(t,'INVENTORY');f.expected.dataNetworkName=`${project}_data`;
    const endpoint=inactiveEndpoint();f.container.NetworkSettings.Networks={[`${project}_data`]:endpoint};
    if(fault==='wrong-name'||fault==='forged-name')f.container.NetworkSettings.Networks={unknown:endpoint};
    if(fault==='forged-name')f.expected.dataNetworkName='unknown';
    if(fault==='host-network')f.container.HostConfig.NetworkMode='0'.repeat(64);
    if(fault==='network-ID')endpoint.NetworkID='0'.repeat(64);
    if(fault==='IP')endpoint.IPAddress='172.31.0.9';
    if(fault==='endpoint')endpoint.EndpointID='f'.repeat(64);
    if(fault==='extra-network')f.container.NetworkSettings.Networks.extra=inactiveEndpoint();
    await assert.rejects(workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps));
  });
}

for(const field of ['NetworkID','IPAddress','EndpointID','Gateway','MacAddress','IPv6Gateway','GlobalIPv6Address','IPPrefixLen','GlobalIPv6PrefixLen']) {
  test(`T126_network_real_registry_EXITED_rejects_${field}`,async t=>{
    const f=await helperFixture(t,'INVENTORY');
    await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
    f.container.State={Status:'exited',Running:false,ExitCode:0};
    const endpoint=inactiveEndpoint();endpoint[field]=field.endsWith('PrefixLen')?24:'unexpected';
    f.container.NetworkSettings.Networks={[`${project}_data`]:endpoint};
    await assert.rejects(workflow.updateOwnedHelper(f.token,{...f.helper,state:'EXITED'},f.deps));
  });
}

for(const fault of ['top-padded','top-tabs'])test(`T126_real_registry_PG_accepts_exact_columns_${fault}`,async t=>{
  const f=await ownedFixture(t,fault);
  const result=await runOwnedHelper(f.token,{side:'source',kind:'PG_DUMP'},f.deps);
  assert.equal(await readFile(result.path,'utf8'),'PGDMP-synthetic');
  assert.equal((await workflow.assertWorkflow(f.token,{},f.deps)).lease.helper,null);
});
for(const fault of ['top-unknown','top-extra','top-missing','top-newline','top-leading-newline','top-extra-process','top-wrong-argv']) {
  test(`T126_real_registry_PG_rejects_${fault}`,async t=>{
    const f=await ownedFixture(t,fault);
    await assert.rejects(runOwnedHelper(f.token,{side:'source',kind:'PG_DUMP'},f.deps));
  });
}

test('T126_none_real_registry_accepts_internal_running_endpoint_without_logical_endpoint',async t=>{
  const f=await helperFixture(t);f.expected.noneNetworkId='9'.repeat(64);
  f.container.NetworkSettings.Networks={none:inactiveEndpoint()};
  await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  f.container.State={Status:'running',Running:true,ExitCode:0};
  Object.assign(f.container.NetworkSettings.Networks.none,{NetworkID:f.expected.noneNetworkId,EndpointID:'8'.repeat(64)});
  f.helper={...f.helper,state:'RUNNING'};await workflow.updateOwnedHelper(f.token,f.helper,f.deps);
  assert.equal((await workflow.assertWorkflow(f.token,{},f.deps)).lease.helper.endpoint,null);
  f.container.State={Status:'exited',Running:false,ExitCode:0};f.container.NetworkSettings.Networks.none.EndpointID='';
  await workflow.updateOwnedHelper(f.token,{...f.helper,state:'EXITED'},f.deps);
  assert.equal((await workflow.assertWorkflow(f.token,{},f.deps)).lease.helper.endpoint,null);
});

for(const fault of ['id','name','driver','scope','forged-expected'])test(`T126_none_real_registry_rejects_${fault}`,async t=>{
  const f=await helperFixture(t),original=f.deps.command;
  const network={Id:'9'.repeat(64),Name:'none',Driver:'null',Scope:'local'};
  if(fault==='id')network.Id='7'.repeat(64);
  if(fault==='name')network.Name='bridge';
  if(fault==='driver')network.Driver='bridge';
  if(fault==='scope')network.Scope='swarm';
  if(fault==='forged-expected')f.expected.noneNetworkId='7'.repeat(64);
  f.deps.command=async(file,args,options)=>args[2]==='network'&&args[4]==='none'?{stdout:JSON.stringify([network])}:original(file,args,options);
  await assert.rejects(workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps));
});

async function reservedTargetFixture(t,base=null) {
  const f=base??await capturePhase(t,true);await workflow.endPhase(f.token,{},f.deps);
  await workflow.beginPhase(f.token,'LOCAL_VERIFIED',{},f.deps);await workflow.endPhase(f.token,{},f.deps);
  f.child=await workflow.reserveRestoreTarget(f.token,{runId:f.r.targetRunId},f.deps);
  const original=f.deps.command,tags=new Map();f.preparationCalls=[];f.tags=tags;
  f.deps.nodeVersion='v24.18.0';f.deps.portAvailable=()=>assert.fail('private preparation must not probe8443');
  f.deps.command=async(file,args,options)=>{
    if(file==='openssl') {for(const flag of ['-out','-keyout'])if(args.includes(flag))await writeFile(args[args.indexOf(flag)+1],'synthetic',{mode:0o600});return{stdout:''};}
    assert.notEqual(file,'git','restore preparation binds existing source provenance');
    const a=args.slice(2);f.preparationCalls.push(a);
    if(a[0]==='compose'&&a[1]==='version')return{stdout:'5.6.0'};
    if(a[0]==='image'&&a[1]==='tag'){tags.set(a[3],a[2]);return{stdout:''};}
    if(a[0]==='image'&&a[1]==='inspect'&&a[2].startsWith(f.child.target.project)) {
      if(tags.has(a[2]))return{stdout:JSON.stringify([{Id:tags.get(a[2])}])};
      throw Object.assign(new Error('No such image'),{code:1});
    }
    if(a.includes('--filter')&&a.some(x=>x.includes(f.child.target.project)))return{stdout:''};
    return original(file,args,options??{shell:false,timeout:30000});
  };return f;
}
test('T131_T01_private_prepare_binds_source_without_port_or_service_start',async t=>{
  const f=await reservedTargetFixture(t),{prepareRestore}=await import('./prepare.mjs');
  const receipt=await prepareRestore(f.token,f.deps);
  assert.equal(receipt.runId,f.r.targetRunId);assert.deepEqual(receipt.apiBuild,f.receipt.apiBuild);
  assert.deepEqual(receipt.images,f.receipt.images);
  assert.ok(!f.preparationCalls.some(a=>['start','up','run','pull'].includes(a[0])));
  await assert.rejects(prepareRestore(f.token,f.deps));
  await assert.rejects(prepareRestore({},f.deps));
  await assert.rejects(inspectTarget(f.child.root,f.deps,{apiState:'stopped'}));
});

async function childRuntimeFixture(t,prepared=true,base=null) {
  const f=await reservedTargetFixture(t,base),{prepareRestore}=await import('./prepare.mjs');if(prepared)await prepareRestore(f.token,f.deps);
  const replacement=value=>JSON.parse(JSON.stringify(value).replaceAll(project,f.child.target.project).replaceAll(f.root,f.child.root));
  const containers=replacement(f.state.containers),networks=replacement(f.state.networks),volumes=replacement(f.state.volumes);
  const ids=new Map(f.state.containers.map((c,i)=>[c.Id,String(i+4).repeat(64)]));
  networks.forEach((n,i)=>{n.Id=['c','d'][i].repeat(64);n.Containers={};n.IPAM.Config=[prepared?{Subnet:`172.${28+i}.0.0/16`,Gateway:`172.${28+i}.0.1`}:{Subnet:`192.168.${240+i}.0/24`,Gateway:`192.168.${240+i}.1`}];});
  const pgAddress=prepared?'172.29.0.2':'192.168.241.2',prefix=prepared?16:24;
  containers.forEach((c,i)=>{
    if(i===2){c.Config.Entrypoint=['/opt/pp1-node'];c.Config.Cmd=['/tool/ingress.mjs','--config','/config/ingress.json'];}
    c.Id=ids.get(c.Id);c.State={Status:i===0?'running':'created',Running:i===0,Health:{Status:'healthy'}};
    for(const [name,endpoint] of Object.entries(c.NetworkSettings.Networks)) {
      const network=networks.find(n=>n.Name===name);endpoint.NetworkID=i===0?network.Id:'';endpoint.IPAddress=i===0?pgAddress:'';
      endpoint.Gateway='';endpoint.EndpointID='';endpoint.IPPrefixLen=i===0?prefix:0;
      if(i===0)network.Containers[c.Id]={IPv4Address:`${pgAddress}/${prefix}`};
    }
  });
  const original=f.deps.command;f.childState={containers,networks,volumes,relations:'0',empty:true,backends:[],visible:new Set(prepared?services:[])};
  if(!prepared)for(const network of f.state.networks)network.IPAM.Driver='default';
  f.childState.networkCreated=new Set(prepared?['web','data']:[]);f.deps.readRoutes=async()=> 'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n';
  f.targetCalls=[];await writeFile(join(f.cwd,'compose.pp1-local.yaml'),await readFile(new URL('../../compose.pp1-local.yaml',import.meta.url)));
  if(!prepared){containers[0].State={Status:'created',Running:false,Health:{Status:'healthy'}};
    for(const network of networks)network.Containers={};containers[0].NetworkSettings.Networks[networks[1].Name]={...containers[0].NetworkSettings.Networks[networks[1].Name],NetworkID:'',IPAddress:'',IPPrefixLen:0};}
  f.deps.command=async(file,args,options)=>{
    const a=args.slice(2);if(file!=='docker')return original(file,args,options);
    const visible=containers.filter(c=>f.childState.visible.has(c.Config.Labels['com.docker.compose.service']));
    if(a[0]==='network'&&a[1]==='ls'&&!a.includes('--filter'))return{stdout:[...f.state.networks,...networks.filter(n=>f.childState.networkCreated.has(n.Labels['com.docker.compose.network']))].map(n=>n.Id).join('\n')};
    if(a[0]==='network'&&a[1]==='create'){const name=a.at(-1),n=networks.find(n=>n.Name===name);assert.ok(n);f.targetCalls.push(a);
      assert.equal(a[a.indexOf('--subnet')+1],n.IPAM.Config[0].Subnet);assert.equal(a[a.indexOf('--gateway')+1],n.IPAM.Config[0].Gateway);
      Object.assign(n,{Scope:'local',EnableIPv6:false,Attachable:false,Ingress:false,Options:{}});n.IPAM.Driver='default';n.IPAM.Options=null;n.Labels['com.docker.compose.version']='5.6.0';
      f.childState.networkCreated.add(n.Labels['com.docker.compose.network']);return{stdout:n.Id+'\n'};}
    if(a[0]==='network'&&a[1]==='inspect'&&a.slice(2).every(fullId=>/^[a-f0-9]{64}$/.test(fullId)))return{stdout:JSON.stringify([...f.state.networks,...networks.filter(n=>f.childState.networkCreated.has(n.Labels['com.docker.compose.network']))].filter(n=>a.includes(n.Id)))};
    if(a[0]==='compose'&&a.includes('create')){
      if(a.includes('--no-deps'))throw Object.assign(new Error('unknown flag: --no-deps'),{code:1});
      assert.ok(a.includes('--no-recreate'));f.targetCalls.push(a);f.childState.visible.add(a.at(-1));return{stdout:''};}
    if(a[0]==='start'&&a[1]===containers[0].Id){f.targetCalls.push(a);const c=containers[0],n=networks[1];c.State={Status:'running',Running:true,Health:{Status:'healthy'}};
      Object.assign(c.NetworkSettings.Networks[n.Name],{NetworkID:n.Id,IPAddress:pgAddress,IPPrefixLen:prefix});n.Containers[c.Id]={IPv4Address:`${pgAddress}/${prefix}`};return{stdout:c.Id};}
    if(a[0]==='ps'&&!a.includes('--filter'))return{stdout:[...f.state.containers,...visible].map(c=>c.Id).join('\n')};
    if(a[0]==='inspect'&&!a.includes('--format')){
      const rows=[...f.state.containers,...visible].filter(c=>a.includes(c.Id)||a.includes(c.Name.slice(1)));
      if(rows.length)return{stdout:JSON.stringify(rows)};
    }
    if(a[0]==='network'&&a[1]==='inspect'&&a.slice(2).some(n=>n.startsWith(f.child.target.project)))return{stdout:JSON.stringify(networks.filter(n=>a.includes(n.Name)))};
    if(a[0]==='volume'&&a[1]==='inspect'&&a.slice(2).some(n=>n.startsWith(f.child.target.project)))return{stdout:JSON.stringify(volumes.filter(n=>a.includes(n.Name)))};
    if(a[0]==='image'&&a[1]==='inspect'&&a[2].startsWith(f.child.target.project)&&f.tags.has(a[2])) {
      const kind=kinds.find(k=>a[2]===`${f.child.target.project}-${k}:verified`);
      return{stdout:JSON.stringify([{Id:f.receipt.images[kind],Os:'linux',Config:{Labels:kind==='api'?f.state.apiLabels:{}}}])};
    }
    if(a[0]==='exec'&&a[1]===containers[0].Id){if(a.at(-1).includes('pg_class'))f.targetCalls.push(['blank-query']);return{stdout:a.at(-1).includes('pg_stat_activity')?JSON.stringify(f.childState.backends):a.at(-1).includes('pg_class')?f.childState.relations:'16385'};}
    if(a[0]==='run'&&a.includes(`${f.child.target.project}-media-probe-${operationId}`))return{stdout:f.childState.empty?'EMPTY\n':'NOT_EMPTY\n'};
    return original(file,args,options);
  };return f;
}
test('T131_T02_reserved_child_inspection_is_token_bound_and_stopped',async t=>{
  const f=await childRuntimeFixture(t);
  const child=await inspectTarget(f.child.root,f.deps,{apiState:'stopped',workflow:f.token});
  assert.equal(child.target.runId,f.r.targetRunId);assert.notDeepEqual(child.target.networkIds,f.receipt.networkIds);
  await assert.rejects(inspectTarget(f.child.root,f.deps,{apiState:'stopped'}));
  await assert.rejects(inspectTarget(f.child.root,f.deps,{apiState:'stopped',workflow:{}}));
});

async function sealChild(f) {
  const inspection=await inspectTarget(f.child.root,f.deps,{apiState:'stopped',workflow:f.token});
  const preparation={receipt:JSON.parse(await readFile(join(f.child.root,'receipt.json'))),artifacts:JSON.parse(await readFile(join(f.child.root,'artifacts.json')))};
  const resources={containerIds:inspection.target.containerIds,networkIds:inspection.target.networkIds,volumeNames:inspection.target.volumeNames};
  return workflow.sealRestoreTarget(f.token,inspection,{preparationSha256:sha256(canonicalBytes(preparation)),createdResourceSetSha256:sha256(canonicalBytes(resources))},f.deps);
}
test('T131_T02_seals_fresh_blank_target_and_keeps_source_identity',async t=>{
  const f=await childRuntimeFixture(t),context=await sealChild(f);
  assert.equal(context.target.runId,f.r.targetRunId);assert.equal(context.lease.phase,'TARGET_BLANK');
  assert.equal(context.connection.jdbcUrl,'jdbc:postgresql://172.29.0.2:5432/cms');assert.equal(context.runRoot,f.child.root);
  assert.equal(context.lease.target.creationPhase,'BLANK_VERIFIED');assert.equal(context.lease.source.runId,runId);
  await assert.rejects(workflow.sealRestoreTarget({},context.inspection,{},f.deps));
  f.childState.containers[1].State.Running=true;await assert.rejects(workflow.assertWorkflow(f.token,{side:'target'},f.deps));
});
for(const fault of ['relations','media','shared-volume','same-container','started-ingress','unknown-container']) {
  test(`T131_T02_rejects_${fault}_before_restore`,async t=>{
    const f=await childRuntimeFixture(t);
    if(fault==='relations')f.childState.relations='1';
    if(fault==='media')f.childState.empty=false;
    if(fault==='shared-volume')f.childState.volumes[1].Mountpoint=f.state.volumes[1].Mountpoint;
    if(fault==='same-container')f.childState.containers[0].Id=f.state.containers[0].Id;
    if(fault==='started-ingress')f.childState.containers[2].State.Running=true;
    if(fault==='unknown-container')f.childState.containers.push({...structuredClone(f.childState.containers[0]),Id:'e'.repeat(64)});
    await assert.rejects(sealChild(f));
    assert.ok(!f.preparationCalls.some(a=>a[0]==='start'));
  });
}

test('T131_T02_factory_creates_PG_first_and_only_after_blank_creates_stopped_services',async t=>{
  const f=await childRuntimeFixture(t,false),{createRestoreTarget}=await import('./restore-target.mjs');
  const context=await createRestoreTarget(f.token,f.deps);
  assert.equal(context.lease.target.creationPhase,'BLANK_VERIFIED');assert.equal(context.lease.phase,'TARGET_BLANK');
  const creates=f.targetCalls.filter(a=>a[0]==='compose'&&a.includes('create')).map(a=>a.at(-1));assert.deepEqual(creates,['postgres','cms-api','ingress']);
  const blank=f.targetCalls.findIndex(a=>a[0]==='blank-query'),api=f.targetCalls.findIndex(a=>a.at(-1)==='cms-api');assert.ok(blank<api);
  assert.deepEqual(f.targetCalls.filter(a=>a[0]==='start'),[['start',f.childState.containers[0].Id]]);
  assert.equal(f.childState.containers[1].State.Running,false);assert.equal(f.childState.containers[2].State.Running,false);
});
for(const fault of ['relations','compose-drift','pg-started','pg-command','pg-mount','pg-network','pg-port']) {
  test(`T131_T02_factory_rejects_${fault}_without_starting_application`,async t=>{
    const f=await childRuntimeFixture(t,false),{createRestoreTarget}=await import('./restore-target.mjs');
    if(fault==='relations')f.childState.relations='1';
    if(fault==='compose-drift')await writeFile(join(f.cwd,'compose.pp1-local.yaml'),'unknown compose');
    if(fault==='pg-started')f.childState.containers[0].State.Running=true;
    if(fault==='pg-command')f.childState.containers[0].Config.Cmd=['sh','-c','unknown'];
    if(fault==='pg-mount')f.childState.containers[0].Mounts[0].Name=f.state.volumes[0].Name;
    if(fault==='pg-network')f.childState.networks[1].Internal=false;
    if(fault==='pg-port')f.childState.containers[0].HostConfig.PortBindings={'5432/tcp':[{HostPort:'5432'}]};
    await assert.rejects(createRestoreTarget(f.token,f.deps));
    assert.ok(!f.targetCalls.some(a=>a.at(-1)==='cms-api'||a.at(-1)==='ingress'));
    if(fault!=='relations')assert.ok(!f.targetCalls.some(a=>a[0]==='start'));
    await assert.rejects(workflow.assertWorkflow(f.token,{},f.deps));
  });
}
async function targetHelperFixture(t,kind='PG_RESTORE',seedProfile=false) {
  const base=seedProfile?await ownedFixture(t,null,true):null;
  if(base)await runOwnedHelper(base.token,{side:'source',kind:'INVENTORY'},base.deps);
  const f=await childRuntimeFixture(t,true,base);await sealChild(f);
  const phase={PG_RESTORE:'DB_RESTORED',MEDIA_RESTORE:'MEDIA_RESTORED',INVENTORY:'RAW_VERIFIED',REVOKE_SESSIONS:'SESSIONS_REVOKED'}[kind];
  for(const next of ['DB_RESTORED','MEDIA_RESTORED','RAW_VERIFIED','SESSIONS_REVOKED']){
    await workflow.beginPhase(f.token,next,{},f.deps);if(next===phase)break;await workflow.endPhase(f.token,{},f.deps);
  }
  const original=f.deps.command;
  f.deps.command=async(file,args,options)=>{
    const a=args.slice(2);if(a[0]==='image'){
      const r=await original(file,args,options),rows=JSON.parse(r.stdout);rows.forEach(x=>Object.assign(x.Config,{Env:[],User:'',Volumes:x.Id===f.receipt.images.postgres?{'/var/lib/postgresql/data':{}}:null}));return{stdout:JSON.stringify(rows)};
    }
    if(a[0]==='network'&&a[2]==='none')return{stdout:JSON.stringify([{Id:'7'.repeat(64),Name:'none',Driver:'null',Scope:'local'}])};
    return original(file,args,options);
  };
  const context=await workflow.reserveHelper(f.token,{side:'target',kind},f.deps);
  const image={Id:context.target.images[kind.startsWith('PG_')?'postgres':kind.startsWith('MEDIA_')?'node':'api'],Os:'linux',Config:{Env:[],User:'',Labels:kind==='INVENTORY'||kind==='REVOKE_SESSIONS'?f.state.apiLabels:{},Volumes:kind.startsWith('PG_')?{'/var/lib/postgresql/data':{}}:null}};
  const policy=buildHelperPolicy({...context,image,kind,side:'target',mediaUser:'0:0'}),policySha256=sha256(canonicalBytes(policy));
  const expected={fullContainerId:'f'.repeat(64),name:`cms-pp1c-${operationId}-${context.seq}`,labels:{...image.Config.Labels,'org.cms.pp1c.operation':operationId,'org.cms.pp1c.seq':context.seq,'org.cms.pp1c.kind':kind,'org.cms.pp1c.policy':policySha256},
    volumeMountpoints:Object.fromEntries(f.childState.volumes.map(v=>[v.Name,v.Mountpoint])),state:'created',dataNetworkName:`${f.child.target.project}_data`,noneNetworkId:'7'.repeat(64)};
  const helper={kind,side:'target',fullContainerId:expected.fullContainerId,policySha256,state:'CREATED',endpoint:null,backend:null,startedAt:new Date().toISOString()};
  const container=helperContainer(policy,expected,expected.volumeMountpoints);
  if(!policy.networkId)container.NetworkSettings.Networks.none.NetworkID='';
  if(policy.networkId)container.NetworkSettings.Networks[expected.dataNetworkName]={NetworkID:'',IPAddress:'',EndpointID:''};
  f.state.containers.push(container);return{...f,context,policy,expected,helper,container};
}
for(const kind of ['PG_RESTORE','INVENTORY','REVOKE_SESSIONS'])test(`T131_T02_target_helper_${kind}_uses_child_identity`,async t=>{
  const f=await targetHelperFixture(t,kind);await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  const current=await workflow.assertWorkflow(f.token,{side:'target'},f.deps);
  assert.equal(current.lease.helper.side,'target');assert.equal(current.target.runId,f.r.targetRunId);
  assert.equal(f.policy.networkId,current.target.networkIds.data);assert.notEqual(f.policy.networkId,current.lease.source.networkIds.data);
  assert.equal(current.lease.source.runId,runId);assert.equal(current.base,join(f.root,'maintenance'));
});
for(const fault of ['source-writer','target-writer','wrong-network','wrong-command','extra-holder'])test(`T131_T02_target_registry_rejects_${fault}`,async t=>{
  const f=await targetHelperFixture(t,'PG_RESTORE');
  if(fault==='source-writer')f.state.backends=[{pid:999}];
  if(fault==='target-writer')f.childState.backends=[{pid:999}];
  if(fault==='wrong-network')f.expected.dataNetworkName=`${project}_data`;
  if(fault==='wrong-command'){f.policy.args=['--clean'];f.container.Config.Cmd=f.policy.args;f.helper.policySha256=sha256(canonicalBytes(f.policy));f.expected.labels['org.cms.pp1c.policy']=f.helper.policySha256;}
  if(fault==='extra-holder')f.state.containers.push({...structuredClone(f.container),Id:'e'.repeat(64)});
  await assert.rejects(workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps));
});
for(const options of [{side:'target',kind:'PG_RESTORE'},{side:'target',kind:'MEDIA_RESTORE'},{side:'target',kind:'REVOKE_SESSIONS'},{side:'target',kind:'BROWSER'},{side:'source',kind:'PG_RESTORE'}])test(`T131_T02_rejects_${options.side}_${options.kind}_in_TARGET_BLANK`,async t=>{
  const f=await childRuntimeFixture(t);await sealChild(f);await assert.rejects(workflow.reserveHelper(f.token,options,f.deps));
});
for(const service of ['cms-api','ingress'])test(`T131_T02_rejects_${service}_command_drift_before_seal`,async t=>{
  const f=await childRuntimeFixture(t);f.childState.containers.find(c=>c.Config.Labels['com.docker.compose.service']===service).Config.Cmd=['unexpected'];
  await assert.rejects(sealChild(f));
});
test('T131_T02_target_media_requires_independently_cached_profile',async t=>{
  const f=await targetHelperFixture(t,'MEDIA_RESTORE');await assert.rejects(workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps));
});

test('T131_T02_target_media_uses_verified_profile_from_same_real_registry_token',async t=>{
  const f=await targetHelperFixture(t,'MEDIA_RESTORE',true);
  await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  assert.equal(f.policy.user,'0:0');assert.equal(f.policy.mounts.find(m=>m.destination==='/media').source,f.childState.volumes[1].Name);
  f.container.State={Status:'running',Running:true,ExitCode:0};Object.assign(f.container.NetworkSettings.Networks.none,{NetworkID:'7'.repeat(64),EndpointID:'8'.repeat(64)});
  await workflow.updateOwnedHelper(f.token,{...f.helper,state:'RUNNING'},f.deps);
  f.container.State={Status:'exited',Running:false,ExitCode:0};f.container.NetworkSettings.Networks.none.EndpointID='';
  const drained=await workflow.assertHelperDrain(f.token,f.deps);assert.equal(drained.target.runId,f.r.targetRunId);assert.equal(drained.lease.helper.endpoint,null);
});
test('T131_T02_source_after_inventory_is_allowed_only_at_raw_verification',async t=>{
  const f=await childRuntimeFixture(t);await sealChild(f);
  for(const phase of ['DB_RESTORED','MEDIA_RESTORED']){await workflow.beginPhase(f.token,phase,{},f.deps);await workflow.endPhase(f.token,{},f.deps);}
  await workflow.beginPhase(f.token,'RAW_VERIFIED',{},f.deps);
  await assert.rejects(workflow.reserveHelper(f.token,{side:'source',kind:'PG_DUMP'},f.deps));
  await assert.rejects(workflow.reserveHelper(f.token,{side:'source',kind:'MEDIA_PACK'},f.deps));
  const c=await workflow.reserveHelper(f.token,{side:'source',kind:'INVENTORY'},f.deps);assert.equal(c.target.runId,runId);
});

// Real registry/token; deterministic process and protected-material test seams only.
async function targetOwnedFixture(t,kind) {
  const f=await ownedFixture(t,null,true);await runOwnedHelper(f.token,{side:'source',kind:'INVENTORY'},f.deps);
  await childRuntimeFixture(t,true,f);await sealChild(f);f.noneId='7'.repeat(64);
  const phase={PG_RESTORE:'DB_RESTORED',MEDIA_RESTORE:'MEDIA_RESTORED',INVENTORY:'RAW_VERIFIED',REVOKE_SESSIONS:'SESSIONS_REVOKED'}[kind];
  for(const next of ['DB_RESTORED','MEDIA_RESTORED','RAW_VERIFIED','SESSIONS_REVOKED']){
    await workflow.beginPhase(f.token,next,{},f.deps);if(next===phase)break;await workflow.endPhase(f.token,{},f.deps);
  }
  const path=join(f.root,'synthetic-copy');await mkdir(path,{mode:0o700});
  const dump=Buffer.from('synthetic PG restore stream'),header=canonicalBytes({version:1,files:[]}),length=Buffer.alloc(8);length.writeBigUInt64BE(BigInt(header.length));
  const media=Buffer.concat([Buffer.from('PP1CMEDIA1\n'),length,header]);
  const artifacts=[];for(const [name,bytes]of [['db.dump',dump],['media.package',media]]){
    await writeFile(join(path,name),bytes,{mode:0o600});artifacts.push({path:name,sha256:sha256(bytes),byteSize:String(bytes.length)});
  }
  f.material={path,operationId,sourceRoot:f.root,backupId:'pp1-20261102T120000000Z-'+'b'.repeat(32),rawProofSha256:'a'.repeat(64),inventory:f.inventory,manifest:{artifacts,inventory:{fileCount:'0',fileBytes:'0'}}};
  f.deps.restoreMaterial=async token=>{assert.equal(token,f.token);return f.material;};
  const command=f.deps.command;
  f.deps.command=async(file,args,options)=>{
    if(args[2]==='exec'&&args.at(-1).includes('pg_stat_activity')&&f.pendingTargetPg){
      const lease=JSON.parse(await readFile(join(f.root,'maintenance/lease.json')));
      if(lease.helper?.backend){const finish=f.pendingTargetPg;delete f.pendingTargetPg;setTimeout(finish,250);}
    }
    return command(file,args,options);
  };
  return f;
}
for(const kind of ['INVENTORY','PG_RESTORE','MEDIA_RESTORE'])test(`PP1c_C12h1_real_registry_target_wrapper_${kind}`,async t=>{
  const f=await targetOwnedFixture(t,kind),result=await runOwnedHelper(f.token,{side:'target',kind},f.deps);
  assert.equal(result.kind,kind);const current=await workflow.assertWorkflow(f.token,{side:'target'},f.deps);
  assert.equal(current.lease.helper,null);assert.equal(f.state.containers[1].State.Running,false);
  assert.equal(f.childState.containers[1].State.Running,false);assert.equal(f.childState.containers[2].State.Running,false);
  if(kind==='INVENTORY'){
    const request=JSON.parse(await readFile(join(result.path,'../../request.json')));
    assert.equal(request.side,'target');assert.equal(request.jdbcUrl,current.connection.jdbcUrl);
  }else assert.deepEqual(f.receivedRestore,await readFile(join(f.material.path,kind==='PG_RESTORE'?'db.dump':'media.package')));
});
for(const fault of ['input-hash','media-receipt','source-writer'])test(`PP1c_C12h1_target_wrapper_rejects_${fault}_without_starting_API`,async t=>{
  const kind=fault==='media-receipt'?'MEDIA_RESTORE':'PG_RESTORE',f=await targetOwnedFixture(t,kind);
  const creates=f.calls.filter(a=>a[2]==='create').length;
  if(fault==='input-hash')f.material.manifest.artifacts[0].sha256='0'.repeat(64);
  if(fault==='media-receipt')f.material.manifest.inventory.fileCount='1';
  if(fault==='source-writer')f.state.backends=[{pid:999}];
  await assert.rejects(runOwnedHelper(f.token,{side:'target',kind},f.deps));
  assert.equal(f.state.containers[1].State.Running,false);assert.equal(f.childState.containers[1].State.Running,false);
  if(fault==='source-writer')assert.equal(f.calls.filter(a=>a[2]==='create').length,creates);
  else assert.equal(JSON.parse(await readFile(join(f.root,'maintenance/lease.json'))).phase,'FAILED_OR_UNKNOWN');
});
test('PP1c_C14n2_real_registry_REVOKE_wrapper_uses_private_raw_material_and_authority',async t=>{
  const f=await targetOwnedFixture(t,'REVOKE_SESSIONS'),result=await runOwnedHelper(f.token,{side:'target',kind:'REVOKE_SESSIONS'},f.deps);
  assert.equal(result.receipt.committed,true);assert.equal(f.receivedRevokeRequest.rawProofSha256,f.material.rawProofSha256);
  assert.equal(f.receivedRevokeRequest.backupId,f.material.backupId);assert.equal(f.receivedRevokeRequest.mediaRoot,null);
  const c=await workflow.assertWorkflow(f.token,{side:'target'},f.deps);assert.equal(f.receivedRevokeRequest.jdbcUrl,c.connection.jdbcUrl);
  const metadata=helperModule.verifiedSessionCommit(f.token,result);assert.equal(metadata.targetId,c.target.targetId);
  assert.equal(metadata.rawProofSha256,f.material.rawProofSha256);assert.equal(c.lease.helper,null);
  assert.throws(()=>helperModule.verifiedSessionCommit(f.token,structuredClone(result)),e=>e.code==='ADAPTER_UNSEALED');
  assert.throws(()=>helperModule.verifiedSessionCommit({},result),e=>e.code==='ADAPTER_UNSEALED');
  assert.equal(f.childState.containers[1].State.Running,false);
});
for(const rawProofSha256 of [null,'0'.repeat(63)])test(`PP1c_C14n2_revoke_without_private_raw_hash_${rawProofSha256===null?'null':'invalid'}_never_permits`,async t=>{
  const f=await targetOwnedFixture(t,'REVOKE_SESSIONS'),permits=f.permits;
  f.material.rawProofSha256=rawProofSha256;
  await assert.rejects(runOwnedHelper(f.token,{side:'target',kind:'REVOKE_SESSIONS'},f.deps),e=>e.code==='ADAPTER_UNSEALED');
  assert.equal(f.permits,permits);assert.equal(f.childState.containers[1].State.Running,false);
});
test('T131_T02_target_PG_backend_may_end_before_output_without_reappearing',async t=>{
  const f=await targetHelperFixture(t),network=f.childState.networks[1];await workflow.registerOwnedHelper(f.token,f.helper,f.policy,f.expected,f.deps);
  f.container.State={Status:'running',Running:true,ExitCode:0};Object.assign(f.container.NetworkSettings.Networks[network.Name],{NetworkID:network.Id,IPAddress:'172.29.0.9'});network.Containers[f.container.Id]={IPv4Address:'172.29.0.9/16'};
  f.helper={...f.helper,state:'RUNNING',endpoint:{networkId:network.Id,address:'172.29.0.9'}};await workflow.updateOwnedHelper(f.token,f.helper,f.deps);
  const backend={pid:91,backendStartEpoch:'1770000000.123',db:'cms',role:'cms_local',clientAddr:'172.29.0.9',applicationName:operationId};
  const row={pid:91,backend_start_epoch:backend.backendStartEpoch,datname:'cms',usename:'cms_local',client_addr:backend.clientAddr,application_name:operationId,state:'active'};
  f.childState.backends=[row];f.helper={...f.helper,backend};await workflow.updateOwnedHelper(f.token,f.helper,f.deps);
  f.childState.backends=[];assert.equal((await workflow.assertHelperDrain(f.token,f.deps)).helperBackendEnded,true);
  f.childState.backends=[row];await assert.rejects(workflow.assertHelperDrain(f.token,f.deps),/WRITER_NOT_QUIESCED/);
});

test('T146 factory preserves both privately created network IDs through unchanged Compose',async t=>{
  const f=await childRuntimeFixture(t,false),{createRestoreTarget}=await import('./restore-target.mjs');
  const context=await createRestoreTarget(f.token,f.deps);
  assert.equal(f.targetCalls.filter(a=>a[0]==='network'&&a[1]==='create').length,2);
  assert.equal(context.inspection.target.networkIds.web,f.childState.networks[0].Id);
  assert.equal(context.inspection.target.networkIds.data,f.childState.networks[1].Id);
  assert.equal(context.connection.jdbcUrl,'jdbc:postgresql://192.168.241.2:5432/cms');
});
for(const fault of ['web-id','data-id','subnet'])test(`T146 factory rejects Compose network ${fault} drift before PG start`,async t=>{
  const f=await childRuntimeFixture(t,false),{createRestoreTarget}=await import('./restore-target.mjs'),original=f.deps.command;
  f.deps.command=async(file,args,options)=>{
    const result=await original(file,args,options);
    if(file==='docker'&&args[2]==='compose'&&args.includes('create')){
      if(fault==='subnet')f.childState.networks[0].IPAM.Config[0].Subnet='192.168.242.0/24';
      else f.childState.networks[fault==='web-id'?0:1].Id='e'.repeat(64);
    }
    return result;
  };
  await assert.rejects(createRestoreTarget(f.token,f.deps));
  assert.equal(f.targetCalls.filter(a=>a[0]==='network'&&a[1]==='create').length,2);
  assert.ok(!f.targetCalls.some(a=>a[0]==='start'||a.at(-1)==='cms-api'||a.at(-1)==='ingress'));
});

test('T146d supported Compose create retains already-created dependencies and does not start apps',async t=>{
  const f=await childRuntimeFixture(t,false),{createRestoreTarget}=await import('./restore-target.mjs');
  const originalIds=Object.fromEntries(f.childState.containers.map(c=>[c.Config.Labels['com.docker.compose.service'],c.Id]));
  const context=await createRestoreTarget(f.token,f.deps);
  assert.deepEqual(context.inspection.target.containerIds,originalIds);
  const creates=f.targetCalls.filter(a=>a[0]==='compose'&&a.includes('create'));
  assert.deepEqual(creates.map(a=>a.at(-1)),['postgres','cms-api','ingress']);
  for(const a of creates)assert.deepEqual(a.slice(a.indexOf('create')),['create','--no-recreate','--pull','never','--no-build',a.at(-1)]);
  assert.deepEqual(f.targetCalls.filter(a=>a[0]==='start'),[['start',originalIds.postgres]]);
  assert.ok(f.childState.containers.slice(1).every(c=>c.State.Running===false));
});
for(const fault of ['pg-recreated','api-recreated','dependency-started'])test(`T146d rejects ${fault} during dependency-aware create`,async t=>{
  const f=await childRuntimeFixture(t,false),{createRestoreTarget}=await import('./restore-target.mjs'),original=f.deps.command;
  const originalPgId=f.childState.containers[0].Id;
  f.deps.command=async(file,args,options)=>{
    const result=await original(file,args,options);
    if(file==='docker'&&args[2]==='compose'&&args.includes('create')&&args.at(-1)===(fault==='pg-recreated'?'cms-api':'ingress')){
      const c=f.childState.containers[fault==='pg-recreated'?0:1];
      if(fault==='dependency-started')c.State={...c.State,Status:'running',Running:true};else c.Id='e'.repeat(64);
    }
    return result;
  };
  await assert.rejects(createRestoreTarget(f.token,f.deps));
  assert.ok(!f.targetCalls.some(a=>a[0]==='start'&&a[1]!==originalPgId));
  if(fault==='pg-recreated')assert.ok(!f.targetCalls.some(a=>a[0]==='compose'&&a.at(-1)==='ingress'));
});

function t147UnrelatedCreatedContainer() {
  return {Id:'e'.repeat(64),Name:'/unrelated-created',State:{Status:'created',Running:false},
    Config:{Labels:{'com.docker.compose.project':'unrelated-project'}},
    NetworkSettings:{Networks:{unrelated_data:{NetworkID:'',IPAddress:'',EndpointID:''}}},Mounts:[]};
}
test('T147_real_restore_token_ignores_unrelated_empty_network_ID_and_seals_blank_child',async t=>{
  const f=await childRuntimeFixture(t),foreign=t147UnrelatedCreatedContainer();f.state.containers.push(foreign);
  assert.equal(f.childState.containers[1].State.Status,'created');assert.equal(f.childState.containers[2].State.Status,'created');
  assert.ok(Object.values(f.childState.containers[1].NetworkSettings.Networks).every(n=>n.NetworkID===''));
  const result=await sealChild(f);
  assert.equal(result.lease.target.creationPhase,'BLANK_VERIFIED');assert.equal(result.lease.phase,'TARGET_BLANK');
  assert.equal(result.lease.source.runId,runId);assert.equal(f.childState.containers[1].State.Running,false);
  assert.equal(f.childState.containers[2].State.Running,false);assert.equal(foreign.State.Running,false);
  await workflow.assertWorkflow(f.token,{side:'target'},f.deps);
});
for(const shared of ['full-id','name','db-mount','media-mount'])test(`T147_real_restore_token_rejects_shared_${shared}`,async t=>{
  const f=await childRuntimeFixture(t),foreign=t147UnrelatedCreatedContainer();
  if(shared==='full-id')foreign.NetworkSettings.Networks.unrelated_data.NetworkID=f.childState.networks[1].Id;
  if(shared==='name')foreign.NetworkSettings.Networks={[f.childState.networks[0].Name]:{NetworkID:'',IPAddress:'',EndpointID:''}};
  if(shared.endsWith('mount')){const volume=f.childState.volumes[shared==='db-mount'?0:1];
    foreign.Mounts=[{Type:'volume',Name:volume.Name,Source:volume.Mountpoint,Destination:'/foreign',RW:true}];}
  f.state.containers.push(foreign);await assert.rejects(sealChild(f),/QUIESCENCE_NOT_PROVEN/);
  assert.equal(f.childState.containers[1].State.Running,false);assert.equal(f.childState.containers[2].State.Running,false);
});

// T152: approved JAR release ID stays distinct from the immutable Docker image ID.
for(const [side,kind] of [['source','INVENTORY'],['target','INVENTORY'],['target','REVOKE_SESSIONS']]) {
  test(`T152_helper_real_token_${side}_${kind}_jar_release_after_close_and_drain`,async t=>{
    const f=side==='source'?await ownedFixture(t):await targetOwnedFixture(t,kind);
    const prior=f.closedBeforeReceipt,result=await runOwnedHelper(f.token,{side,kind},f.deps);
    const c=await workflow.assertWorkflow(f.token,{side},f.deps),request=f.requests.at(-1);
    const releaseId=`sha256:${c.target.apiBuild.jarSha256}`;
    assert.notEqual(releaseId,c.target.images.api);assert.equal(c.lease.releaseId,releaseId);
    assert.equal(request.releaseId,releaseId);assert.equal(request.targetId,c.target.targetId);
    const authority=kind==='INVENTORY'?helperModule.verifiedInventoryResult:helperModule.verifiedSessionCommit;
    const metadata=authority(f.token,result);
    assert.equal(metadata.releaseId,releaseId);assert.equal(metadata.requestSha256,sha256(canonicalBytes(request)));
    assert.equal(f.permitRecords.at(-1).requestSha256,metadata.requestSha256);
    assert.equal(f.permitRecords.at(-1).action,kind==='INVENTORY'?'READ_INVENTORY':'REVOKE_SESSIONS');
    assert.equal(f.closedBeforeReceipt,prior+1);assert.equal(c.lease.helper,null);
    assert.ok(f.calls.filter(a=>a[2]==='create').at(-1).includes(c.target.images.api));
    assert.deepEqual(Object.keys(result.receipt).sort(),(kind==='INVENTORY'
      ?'version operationId mode inventorySha256 dbSnapshotSha256 assetCount referencedFileCount orphanFileCount fileCount fileBytes'
      :'operationId backupId revokedCount auditEventId committed').split(' ').sort());
    assert.throws(()=>authority(f.token,structuredClone(result)),e=>e.code==='ADAPTER_UNSEALED');
    assert.throws(()=>authority({},result),e=>e.code==='ADAPTER_UNSEALED');
  });
  test(`T152_helper_real_token_${side}_${kind}_image_substituted_Ready_rejected_before_permit`,async t=>{
    const f=side==='source'?await ownedFixture(t):await targetOwnedFixture(t,kind);
    f.readyImageRelease=true;const permits=f.permits,received=f.permitRecords.length;
    await assert.rejects(runOwnedHelper(f.token,{side,kind},f.deps),e=>e.code==='CAPTURE_FAILED');
    assert.equal(f.permits,permits);assert.equal(f.permitRecords.length,received);
    assert.equal(JSON.parse(await readFile(join(f.root,'maintenance/lease.json'))).phase,'FAILED_OR_UNKNOWN');
  });
}

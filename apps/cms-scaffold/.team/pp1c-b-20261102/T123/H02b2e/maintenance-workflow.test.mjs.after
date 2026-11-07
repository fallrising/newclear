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
      PidMode:'',IpcMode:'private',AutoRemove:false,Tmpfs:{'/tmp':'rw,nosuid,nodev,size=67108864'},NetworkMode:policy.networkId??'none'},
    NetworkSettings:{Ports:{},Networks:{}},Mounts:policy.mounts.map(m=>({Type:m.type,Name:m.type==='volume'?m.source:undefined,
      Source:m.type==='volume'?volumeMountpoints[m.source]:m.source,Destination:m.destination,RW:!m.readOnly}))};
}
async function helperFixture(t,kind='MEDIA_PACK') {
  const f=await capturePhase(t),original=f.deps.command;
  f.deps.command=async(file,args,options)=>{
    const a=args.slice(2);
    if(a[0]==='image') {const result=await original(file,args,options);const rows=JSON.parse(result.stdout);rows.forEach(x=>Object.assign(x.Config,{Env:[],User:''}));return{stdout:JSON.stringify(rows)};}
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
    volumeMountpoints:Object.fromEntries(f.state.volumes.map(v=>[v.Name,v.Mountpoint])),state:'created'};
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
  await workflow.updateOwnedHelper(f.token,{...f.helper,state:'RUNNING'},f.deps);
  await assert.rejects(workflow.updateOwnedHelper(f.token,{...f.helper,state:'RUNNING'},f.deps));
  await assert.rejects(workflow.updateOwnedHelper(f.token,{...f.helper,state:'EXITED',fullContainerId:'e'.repeat(64)},f.deps));
  f.container.State={Status:'exited',Running:false};
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
    releaseId:f.context.target.images.api,jdbcUrl:f.context.lease.sourceConnection.jdbcUrl,dbUser:'cms_local',
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
function emptyInventory() {
  const java=readFileSync(new URL('../../services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventory.java',import.meta.url),'utf8');
  const tables=[...java.matchAll(/Map.entry\("([^"]+)", List.of\((.*?)\)\)/g)].map(([,tableName,values])=>{
    const schema={columns:[...values.matchAll(/"([^"]+)"/g)].map(([,name],i)=>({ordinalPosition:String(i+1),name,dataType:'text',udtSchema:'pg_catalog',udtName:'text',isNullable:true,
      characterMaximumLength:null,numericPrecision:null,numericScale:null,datetimePrecision:null,columnDefault:null,isIdentity:false,identityGeneration:null,isGenerated:false,generationExpression:null})),constraints:[],indexes:[]};
    return{tableName,schema,rows:[],schemaSha256:sha256(canonicalBytes(schema)),rowsSha256:sha256(canonicalBytes([])),rowCount:'0',snapshotSha256:sha256(canonicalBytes({schema,rows:[]}))};
  }).sort((a,b)=>a.tableName.localeCompare(b.tableName));
  return{version:1,files:[],tables,assets:[],variants:[],dbSnapshotSha256:sha256(canonicalBytes(tables.map(({tableName,schemaSha256,rowsSha256,rowCount})=>({tableName,schemaSha256,rowsSha256,rowCount})))),mediaHeaderSha256:sha256(canonicalBytes({version:1,files:[]}))};
}
async function ownedFixture(t,fault=null) {
  const f=await capturePhase(t),original=f.deps.command;f.inventory=emptyInventory();f.permits=0;let counter=10;
  await mkdir(join(f.cwd,'scripts/ops'),{recursive:true});
  await writeFile(join(f.cwd,'scripts/ops/local-media.mjs'),readFileSync(new URL('../ops/local-media.mjs',import.meta.url)));

  await mkdir(join(f.root,'secrets'),{mode:0o700});await writeFile(join(f.root,'secrets/spring.datasource.password'),'synthetic',{mode:0o600});
  const helperList=()=>f.state.containers.filter(c=>c.Config.Labels['org.cms.pp1c.operation']);
  const setState=(c,state)=>{
    c.State={Status:state,Running:state==='running',ExitCode:0};
    if(c.HostConfig.NetworkMode!=='none') {
      const network=f.state.networks.find(n=>n.Id===c.HostConfig.NetworkMode);
      c.NetworkSettings.Networks[network.Name]={NetworkID:network.Id,IPAddress:state==='running'?'172.31.0.9':''};
      if(state==='running')network.Containers[c.Id]={IPv4Address:'172.31.0.9/16'};else delete network.Containers[c.Id];
    }
  };
  f.deps.command=async(file,args,options)=>{
    if(file==='javac'||file.endsWith('/javac')) {
      if(args[0]==='-version')return{stdout:'javac 25.0.5\n'};
      await writeFile(join(args[args.indexOf('-d')+1],'Profile.class'),'synthetic-class');return{stdout:''};
    }
    const a=args.slice(2),find=key=>a.find(v=>v.startsWith(key+'='))?.slice(key.length+1);f.calls.push(args);
    if(a[0]==='image') {const r=await original(file,args,options),images=JSON.parse(r.stdout);images.forEach(x=>Object.assign(x.Config,{Env:[],User:''}));return{stdout:JSON.stringify(images)};}
    if(a[0]==='volume')return{stdout:JSON.stringify(f.state.volumes.filter(v=>a.slice(2).includes(v.Name)))};
    if(a[0]==='create') {
      const labels=a.includes(f.receipt.images.api)?{...f.state.apiLabels}:{};for(let i=0;i<a.length;i++)if(a[i]==='--label'){const text=a[++i],n=text.indexOf('=');labels[text.slice(0,n)]=text.slice(n+1);}
      const entry=a.indexOf('--entrypoint='+find('--entrypoint')),mounts=[];
      for(let i=0;i<a.length;i++)if(a[i]==='--mount') {const fields=Object.fromEntries(a[++i].split(',').map(v=>v.split('=')));
        mounts.push({type:fields.type,source:fields.src,destination:fields.dst,readOnly:Object.hasOwn(fields,'readonly')});}
      const policy={imageId:a[entry+1],user:find('--user'),entrypoint:find('--entrypoint'),args:a.slice(entry+2),env:[],mounts,networkId:find('--network')==='none'?null:find('--network')};
      for(let i=0;i<a.length;i++)if(a[i]==='--env')policy.env.push(a[++i]);policy.env.sort();
      const expected={fullContainerId:(counter++).toString(16).padStart(64,'0'),name:a[a.indexOf('--name')+1],labels};
      const c=helperContainer(policy,expected,Object.fromEntries(f.state.volumes.map(v=>[v.Name,v.Mountpoint])));
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
      const c=helperList().find(x=>x.Id===a[1]);return{stdout:`PID COMMAND\n17 ${[...c.Config.Entrypoint,...c.Config.Cmd].join(' ')}\n`};
    }
    if(a[0]==='rm'){f.state.containers.splice(f.state.containers.findIndex(c=>c.Id===a[1]),1);return{stdout:a[1]};}
    if(a[0]==='wait')return{stdout:'0\n'};
    return original(file,args,options);
  };
  f.deps.spawn=(_file,args)=>{
    const c=helperList().find(x=>x.Id===args.at(-1));setState(c,'running');
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
    const close=()=>{f.state.backends=[];setState(c,'exited');child.stdout.end();child.stderr.end();child.emit('close',0,null);};
    const requestPath=c.Mounts.find(m=>m.Destination==='/run/pp1/request.json')?.Source;
    if(requestPath) {
      const request=JSON.parse(readFileSync(requestPath)),backend={pid:91,backendStartEpoch:'1770000000.123',db:'cms',role:'cms_local',clientAddr:'172.31.0.9',applicationName:operationId};
      f.state.backends=[{pid:91,backend_start_epoch:backend.backendStartEpoch,datname:'cms',usename:'cms_local',client_addr:backend.clientAddr,application_name:operationId,state:'idle in transaction'}];
      child.stdout.write(canonicalBytes({version:1,operationId,side:'source',mode:'INVENTORY',requestSha256:sha256(canonicalBytes(request)),backend,readOnly:true}));
      child.stdin.on('finish',async()=>{
        f.permits++;const output=join(c.Mounts.find(m=>m.Destination==='/run/pp1/output').Source,'inventory.json');
        await writeFile(output,canonicalBytes(f.inventory),{mode:fault==='output-mode'?0o644:0o600});f.state.backends=[];setState(c,'exited');
        setTimeout(()=>{child.stdout.write(canonicalBytes({version:1,operationId,mode:'INVENTORY',inventorySha256:fault==='receipt-hash'?'0'.repeat(64):sha256(canonicalBytes(f.inventory)),dbSnapshotSha256:f.inventory.dbSnapshotSha256,
          assetCount:'0',referencedFileCount:'0',orphanFileCount:'0',fileCount:'0',fileBytes:'0'}));close();},120);
      });
    }else if(c.Config.Entrypoint[0].endsWith('/pg_dump')) {
      f.state.backends=[{pid:91,backend_start_epoch:'1770000000.123',datname:'cms',usename:'cms_local',client_addr:'172.31.0.9',application_name:operationId,state:'active'}];
      f.pendingPg=()=>{child.stdout.write(Buffer.from('PGDMP-synthetic'));
        if(fault==='pg-exit-before-drain'){f.state.backends=[];setState(c,'exited');setTimeout(close,250);}else close();};
    }else {
      const input=[];child.stdin.on('data',bytes=>input.push(bytes));
      child.stdin.on('finish',()=>{
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

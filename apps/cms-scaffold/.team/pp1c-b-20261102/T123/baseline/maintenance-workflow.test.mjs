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
async function helperFixture(t) {
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
  const context=await workflow.reserveHelper(f.token,{side:'source',kind:'MEDIA_PACK'},f.deps);
  const image={Id:context.target.images.node,Os:'linux',Config:{Env:[],User:'',Labels:{}}};
  const policy=buildHelperPolicy({...context,image,kind:'MEDIA_PACK',side:'source'}),policySha256=sha256(canonicalBytes(policy));
  const expected={fullContainerId:'f'.repeat(64),name:`cms-pp1c-${operationId}-1`,labels:{'org.cms.pp1c.operation':operationId,
    'org.cms.pp1c.seq':'1','org.cms.pp1c.kind':'MEDIA_PACK','org.cms.pp1c.policy':policySha256},
    volumeMountpoints:Object.fromEntries(f.state.volumes.map(v=>[v.Name,v.Mountpoint])),state:'created'};
  const helper={kind:'MEDIA_PACK',side:'source',fullContainerId:expected.fullContainerId,policySha256,state:'CREATED',endpoint:null,backend:null,startedAt:new Date().toISOString()};
  const container=helperContainer(policy,expected,expected.volumeMountpoints);f.state.containers.push(container);
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

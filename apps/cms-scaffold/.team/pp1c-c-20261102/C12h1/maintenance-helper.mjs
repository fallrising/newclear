import { OpsError, canonicalBytes, parseStrictJson, sha256 } from '../ops/recovery-protocol.mjs';
import { isIP } from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, lstat, unlink, statfs, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { directory, syncDirectory } from './maintenance-store.mjs';
import { validateInventory } from '../ops/local-media.mjs';
const requirePolicy = value => { if (!value) throw new OpsError('ADAPTER_UNSEALED'); };
const same = (a,b) => canonicalBytes(a).equals(canonicalBytes(b));
const empty = value => value == null || Object.keys(value).length === 0;
const pathSafe = value => typeof value === 'string' && value.startsWith('/')
  && !/[,\r\n\0]/.test(value) && !value.split('/').some(x => x === '..' || x === '.');
const imageId = value => /^sha256:[a-f0-9]{64}$/.test(value);
const fullId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sides = { INVENTORY:['source','target'], REVOKE_SESSIONS:['target'], PG_DUMP:['source'],
  PG_RESTORE:['target'], MEDIA_PACK:['source'], MEDIA_RESTORE:['target'] };

const pgDataPath='/var/lib/postgresql/data';
const pgDataOptions='ro,nosuid,nodev,noexec,size=1048576';
const pgVersions={PG_DUMP_VERSION:'/usr/local/bin/pg_dump',PG_RESTORE_VERSION:'/usr/local/bin/pg_restore'};
function assertImageVolumes(image,pg,mounts=[]) {
  const volumes=image.Config?.Volumes??{};
  if(pg)requirePolicy(same(volumes,{[pgDataPath]:{}}));
  else {
    requirePolicy(typeof volumes==='object'&&!Array.isArray(volumes));
    for(const [path,value] of Object.entries(volumes)) {
      requirePolicy(mounts.some(m=>m.destination===path)&&same(value,{}));
    }
  }
}
function helperTmpfs(policy,expected) {
  const values={'/tmp':'rw,nosuid,nodev,size=67108864'};
  const version=Object.hasOwn(pgVersions,policy.kind);
  if(version) {
    requirePolicy(imageId(expected.pgProfileImageId)&&policy.imageId===expected.pgProfileImageId);
    requirePolicy(policy.entrypoint===pgVersions[policy.kind]&&same(policy.args,['--version'])&&policy.networkId===null);
  }
  if(version||policy.kind==='PG_DUMP'||policy.kind==='PG_RESTORE')values[pgDataPath]=pgDataOptions;
  return values;
}

// Inputs come from the workflow's private capability plus fresh immutable image inspection.
export function buildHelperPolicy(c) {
  try {
    const {kind,side,target,image,helperRoot:q,runRoot,cwd,nodeBinary} = c;
    requirePolicy(sides[kind]?.includes(side) && [q,runRoot,cwd,nodeBinary].every(pathSafe));
    requirePolicy(Number.isSafeInteger(c.uid) && c.uid >= 0 && Number.isSafeInteger(c.gid) && c.gid >= 0);
    requirePolicy(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c.operationId) && /^[1-9][0-9]*$/.test(c.seq));
    const pg = kind.startsWith('PG_'), media = kind.startsWith('MEDIA_');
    const selected = target.images[pg ? 'postgres' : media ? 'node' : 'api'];
    requirePolicy(imageId(selected) && image.Id === selected && image.Os === 'linux');
    requirePolicy(image.Config && Array.isArray(image.Config.Env));
    requirePolicy(!Object.keys(image.Config.Labels ?? {}).some(k => k.startsWith('org.cms.pp1c.')));
    const variables = new Map();
    for (const pair of image.Config.Env) {
      requirePolicy(typeof pair === 'string' && pair.indexOf('=') > 0);
      const name = pair.slice(0,pair.indexOf('=')); requirePolicy(!variables.has(name)); variables.set(name,pair);
    }
    if (pg) for (const pair of ['PGPASSFILE=/run/pp1/pgpass',`PGAPPNAME=${c.operationId}`,'PGCONNECT_TIMEOUT=15']) variables.set(pair.slice(0,pair.indexOf('=')),pair);
    let args, entrypoint, user = `${c.uid}:${c.gid}`;
    const mounts = [], bind = (source,destination,readOnly=true) => mounts.push({type:'bind',source,destination,readOnly});
    const volume = readOnly => mounts.push({type:'volume',source:target.volumeNames['media-data'],destination:'/media',readOnly});
    if (pg) {
      entrypoint = `/usr/local/bin/${kind === 'PG_DUMP' ? 'pg_dump' : 'pg_restore'}`;
      args = ['--host=postgres','--port=5432','--username=cms_local','--dbname=cms','--format=custom',
        ...(kind === 'PG_RESTORE' ? ['--single-transaction','--exit-on-error'] : []),
        '--no-owner','--no-privileges','--no-password',...(kind === 'PG_DUMP' ? ['--lock-wait-timeout=30000'] : [])];
      bind(`${q}/pgpass`,'/run/pp1/pgpass');
    } else if (media) {
      entrypoint='/opt/pp1-node'; args=['/tool/local-media.mjs',kind === 'MEDIA_PACK' ? 'pack' : 'restore'];
      bind(nodeBinary,'/opt/pp1-node'); bind(`${cwd}/scripts/ops/local-media.mjs`,'/tool/local-media.mjs');
      volume(kind === 'MEDIA_PACK');
      if (kind === 'MEDIA_RESTORE') { requirePolicy(/^[0-9]+:[0-9]+$/.test(c.mediaUser)); user=c.mediaUser; }
    } else {
      entrypoint='/opt/java/openjdk/bin/java';
      args=['-jar','/app/app.jar',kind === 'INVENTORY' ? 'ops-inventory' : 'ops-revoke-restored-sessions','--request','/run/pp1/request.json'];
      bind(`${q}/request.json`,'/run/pp1/request.json'); bind(`${runRoot}/secrets/spring.datasource.password`,'/run/secrets/spring.datasource.password');
      if (kind === 'INVENTORY') { volume(true); bind(`${q}/output`,'/run/pp1/output',false); }
    }
    assertImageVolumes(image,pg,mounts);
    requirePolicy(media || fullId(target.networkIds.data));
    return {version:1,kind,side,imageId:selected,user,entrypoint,args,env:[...variables.values()].sort(),
      mounts:mounts.sort((a,b)=>Buffer.compare(Buffer.from(a.destination),Buffer.from(b.destination))),
      networkId:media?null:target.networkIds.data,readOnlyRootfs:true,capDrop:['ALL'],noNewPrivileges:true,restart:'no',logDriver:'none'};
  } catch { throw new OpsError('ADAPTER_UNSEALED'); }
}

export function helperCreateArgs(policy, expected) {
  const args=['create','--pull=never','--name',expected.name];
  for (const [key,value] of Object.entries(expected.labels).filter(([key])=>key.startsWith('org.cms.pp1c.'))) args.push('--label',`${key}=${value}`);
  args.push('--restart=no','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--log-driver=none',
    `--user=${policy.user}`,`--network=${policy.networkId??'none'}`);
  for(const [path,options] of Object.entries(helperTmpfs(policy,expected)))args.push(`--tmpfs=${path}:${options}`);
  args.push('--interactive');
  for (const m of policy.mounts) args.push('--mount',`type=${m.type},src=${m.source},dst=${m.destination}${m.readOnly?',readonly':''}`);
  if (policy.kind.startsWith('PG_')) for (const pair of policy.env.filter(x=>/^(PGPASSFILE|PGAPPNAME|PGCONNECT_TIMEOUT)=/.test(x))) args.push('--env',pair);
  args.push(`--entrypoint=${policy.entrypoint}`,policy.imageId,...policy.args); return args;
}

export function assertHelperPolicy(container, policy, expected) {
  try {
    const p=container,h=p.HostConfig,c=p.Config,n=p.NetworkSettings;
    requirePolicy(fullId(expected.fullContainerId) && p.Id === expected.fullContainerId && p.Name === `/${expected.name}` && p.Image === policy.imageId);
    requirePolicy(same(c.Labels,expected.labels) && same([...c.Env].sort(),policy.env) && new Set(c.Env.map(x=>x.split('=')[0])).size===c.Env.length);
    requirePolicy(c.User===policy.user && same(c.Entrypoint,[policy.entrypoint]) && same(c.Cmd,policy.args) && c.OpenStdin===true && c.Tty===false);
    requirePolicy(h.ReadonlyRootfs===true && h.Privileged===false && same(h.CapDrop,['ALL']) && empty(h.CapAdd));
    requirePolicy(same(h.SecurityOpt,['no-new-privileges']) && h.RestartPolicy?.Name==='no' && h.LogConfig?.Type==='none');
    requirePolicy(empty(h.PortBindings) && empty(h.Devices) && empty(h.DeviceRequests) && empty(h.ExtraHosts));
    requirePolicy(h.PidMode==='' && ['', 'private'].includes(h.IpcMode) && !h.AutoRemove);
    requirePolicy(same(h.Tmpfs,helperTmpfs(policy,expected)));
    requirePolicy(h.NetworkMode===(policy.networkId??'none') && Object.values(n.Ports??{}).every(empty));
    requirePolicy(Array.isArray(p.Mounts) && p.Mounts.length===policy.mounts.length);
    const mounts=new Map(p.Mounts.map(m=>[m.Destination,m])); requirePolicy(mounts.size===p.Mounts.length);
    for (const m of policy.mounts) {
      const actual=mounts.get(m.destination); requirePolicy(actual?.Type===m.type && actual.RW===!m.readOnly);
      if(m.type==='volume') requirePolicy(actual.Name===m.source && actual.Source===expected.volumeMountpoints[m.source]);
      else requirePolicy(actual.Source===m.source);
    }
    const networks=Object.entries(n.Networks??{});
    if(policy.networkId) {
      requirePolicy(typeof expected.dataNetworkName==='string'&&networks.length===1&&networks[0][0]===expected.dataNetworkName);
      const endpoint=networks[0][1];
      if(expected.state==='running') {
        const [a,b]=String(endpoint.IPAddress).split('.').map(Number);
        requirePolicy(endpoint.NetworkID===policy.networkId&&isIP(endpoint.IPAddress)===4
          &&(a===10||a===172&&b>=16&&b<=31||a===192&&b===168));
      }else {
        requirePolicy(endpoint.NetworkID===''||endpoint.NetworkID===policy.networkId);
        for(const key of ['IPAddress','EndpointID','Gateway','MacAddress','IPv6Gateway','GlobalIPv6Address'])requirePolicy((endpoint[key]??'')==='');
        for(const key of ['IPPrefixLen','GlobalIPv6PrefixLen'])requirePolicy((endpoint[key]??0)===0);
      }
    } else {
      requirePolicy(fullId(expected.noneNetworkId)&&networks.length===1&&networks[0][0]==='none');
      const endpoint=networks[0][1];
      requirePolicy(endpoint.NetworkID===expected.noneNetworkId||expected.state!=='running'&&endpoint.NetworkID==='');
      requirePolicy(expected.state==='running'?fullId(endpoint.EndpointID):endpoint.EndpointID==='');
      for(const key of ['IPAddress','Gateway','MacAddress','IPv6Gateway','GlobalIPv6Address'])requirePolicy((endpoint[key]??'')==='');
      for(const key of ['IPPrefixLen','GlobalIPv6PrefixLen'])requirePolicy((endpoint[key]??0)===0);
    }
    requirePolicy(['created','running','exited'].includes(expected.state) && p.State.Status===expected.state && p.State.Running===(expected.state==='running'));
    return container;
  } catch { throw new OpsError('ADAPTER_UNSEALED'); }
}

async function inspectNoneNetwork(docker) {
  const networks=JSON.parse(await docker(['network','inspect','none']));
  requirePolicy(Array.isArray(networks)&&networks.length===1);
  const network=networks[0];
  requirePolicy(fullId(network.Id)&&network.Name==='none'&&network.Driver==='null'&&network.Scope==='local');
  return network.Id;
}

const execute = promisify(execFile);
function helperEnvironment(input = process.env) {
  const env={...input};
  requirePolicy(!env.DOCKER_HOST || env.DOCKER_HOST==='unix:///var/run/docker.sock');
  requirePolicy(!env.DOCKER_CONTEXT || env.DOCKER_CONTEXT==='default'); requirePolicy(!env.DOCKER_TLS_VERIFY);
  for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key];
  return env;
}
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function deadline(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new OpsError('INTERRUPTED')),milliseconds);})]); }
  finally { clearTimeout(timer); }
}

// The workflow wrapper supplies a capability-derived policy and fixed kind consumer.
// This execution core is separately testable with synthetic command/pipe adapters.
export async function executeHelperLifecycle(policy, expected, consume, deps = {}) {
  const env=helperEnvironment(deps.environment), command=deps.command??execute;
  const abort=new AbortController(), prefix=['--host','unix:///var/run/docker.sock'];
  let id, owned=false, child, exit, interrupted=false, cleaned=false, rejectAbort;
  const abortFailure=()=>rejectAbort?.(new OpsError('INTERRUPTED'));
  const aborted=new Promise((_,reject)=>{rejectAbort=reject;});aborted.catch(()=>{});
  abort.signal.addEventListener('abort',abortFailure,{once:true});
  const cancel=()=>{interrupted=true;abort.abort();};
  const docker=async(args,allowMissing=false)=>{
    let value;
    try { value=await command('docker',[...prefix,...args],{env,shell:false,timeout:30000,maxBuffer:16*1024*1024}); }
    catch(error) { value=error; }
    if(value.code!==undefined && value.code!==0) {
      const missing=String(value.stderr??'').trim();
      if(allowMissing && value.code===1 && [
        `Error: No such object: ${id}`,`error: no such object: ${id}`,`Error response from daemon: No such container: ${id}`
      ].includes(missing)) return null;
      throw new OpsError('CAPTURE_FAILED');
    }
    return value.stdout;
  };
  const inspect=async(state)=>{
    const values=JSON.parse(await docker(['inspect',id]));requirePolicy(Array.isArray(values)&&values.length===1);
    const current=values[0];assertHelperPolicy(current,policy,{...expected,fullContainerId:id,state:state??current.State?.Status});return current;
  };
  const remove=async()=>{
    await inspect('exited');await docker(['rm',id]);requirePolicy(await docker(['inspect',id],true)===null);
    cleaned=true;await deps.onRemoved?.(id);
  };
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try {
    id=String(await docker(helperCreateArgs(policy,expected))).trim();requirePolicy(fullId(id)&&!interrupted);
    expected={...expected,fullContainerId:id};const created=await inspect('created');owned=true;
    await deps.onCreated?.(id,created,expected);
    child=(deps.spawn??spawn)('docker',[...prefix,'start','--attach','--interactive',id],
      {env,shell:false,stdio:['pipe','pipe','pipe']});
    exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
    // Attach an early rejection handler while startup inspection is in flight.
    exit.catch(()=>{});
    const until=Date.now()+30000;let running;
    while(!running) {
      const snapshot=await inspect();requirePolicy(!interrupted&&Date.now()<until);
      if(snapshot.State.Status==='running') running=snapshot;
      else { requirePolicy(snapshot.State.Status==='created');await (deps.pause??pause)(50); }
    }
    await deps.onRunning?.(id,running);
    const limit=['PG_DUMP','PG_RESTORE','MEDIA_PACK','MEDIA_RESTORE'].includes(policy.kind)?7200000:600000;
    const result=await deadline(Promise.race([Promise.all([consume(child,{id,container:running,policy,signal:abort.signal}),exit]),aborted]),limit);
    if(interrupted) throw new OpsError('INTERRUPTED');
    if(result[1].code!==0||result[1].signal!==null||String(await docker(['wait',id])).trim()!=='0') throw new OpsError('CAPTURE_FAILED');
    const stopped=await inspect('exited');
    if(stopped.State.ExitCode!==0) throw new OpsError('CAPTURE_FAILED');await deps.onExited?.(id,stopped);
    await remove();return result[0];
  } catch(error) {
    if(owned&&!cleaned) {
      try {
        let current=await inspect();
        if(current.State.Running) {
          try { await docker(['stop','--time','30',id]); }
          catch { await inspect('running');await docker(['kill',id]); }
          await docker(['wait',id]); current=await inspect('exited');
        }
        if(current.State.Status==='created') {
          await docker(['rm',id]);requirePolicy(await docker(['inspect',id],true)===null);cleaned=true;
          await deps.onRemoved?.(id);
        } else { await deps.onExited?.(id,current);await remove(); }
      } catch { /* Unknown identity/cleanup keeps its durable registration and lock. */ }
    }
    if(error instanceof OpsError) throw error;
    throw new OpsError(interrupted?'INTERRUPTED':'CAPTURE_FAILED');
  } finally {
    if(child) { child.stdin?.destroy();child.stdout?.destroy();child.stderr?.destroy(); }
    abort.signal.removeEventListener('abort',abortFailure);
    process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
  }
}

const requireHandshake=value=>{if(!value) throw new OpsError('CAPTURE_FAILED');};
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&same(Object.keys(value).sort(),keys.split(',').sort());
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value);
function requestValid(r) {
  requireHandshake(exactKeys(r,'version,mode,operationId,side,targetId,releaseId,jdbcUrl,dbUser,passwordFile,mediaRoot,outputFile,backupId,rawProofSha256'));
  requireHandshake(r.version===1&&uuid(r.operationId)&&['source','target'].includes(r.side)&&/^pp1-local:[a-f0-9]{32}$/.test(r.targetId)&&imageId(r.releaseId));
  requireHandshake(r.dbUser==='cms_local'&&r.passwordFile==='/run/secrets/spring.datasource.password');
  const address=/^jdbc:postgresql:\/\/([0-9.]+):5432\/cms$/.exec(r.jdbcUrl)?.[1];requireHandshake(isIP(address??'')===4);
  if(r.mode==='INVENTORY') requireHandshake(r.mediaRoot==='/media'&&r.outputFile==='/run/pp1/output/inventory.json'&&r.backupId===null&&r.rawProofSha256===null);
  else requireHandshake(r.mode==='REVOKE_SESSIONS'&&r.side==='target'&&r.mediaRoot===null&&r.outputFile===null
    &&/^pp1-[0-9]{8}T[0-9]{9}Z-[a-f0-9]{32}$/.test(r.backupId)&&fullId(r.rawProofSha256));
}
async function* receiptLines(stream) {
  let buffered=Buffer.alloc(0),count=0;
  for await(const chunk of stream) {
    buffered=Buffer.concat([buffered,chunk]);let end;
    while((end=buffered.indexOf(10))!==-1) {
      requireHandshake(count<2&&end+1<=(count===0?4096:16384));
      const line=buffered.subarray(0,end+1);buffered=buffered.subarray(end+1);count++;yield parseStrictJson(line);
    }
    requireHandshake(buffered.length<=(count===0?4096:16384));
  }
  requireHandshake(buffered.length===0&&count===2);
}
async function fixedStderr(stream) {
  let size=0;const chunks=[];
  for await(const chunk of stream) {size+=chunk.length;requireHandshake(size<=4096);chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}
function backendValid(b,request,address) {
  return exactKeys(b,'pid,backendStartEpoch,db,role,clientAddr,applicationName')
    &&Number.isInteger(b.pid)&&b.pid>0&&b.pid<=2147483647
    &&typeof b.backendStartEpoch==='string'&&/^[1-9][0-9]*\.[0-9]+$/.test(b.backendStartEpoch)
    &&b.db==='cms'&&b.role==='cms_local'&&b.clientAddr===address&&b.applicationName===request.operationId;
}
export async function runJdbcHandshake(child,request,deps) {
  let reader, stderr;
  try {
    requestValid(request);const requestHash=sha256(canonicalBytes(request));
    stderr=fixedStderr(child.stderr);stderr.catch(()=>{});
    reader=receiptLines(child.stdout);const first=await (deps.waitDeadline??deadline)(reader.next(),30000);const ready=first.value;
    requireHandshake(!first.done&&exactKeys(ready,'version,operationId,side,mode,requestSha256,backend,readOnly'));
    requireHandshake(ready.version===1&&ready.operationId===request.operationId&&ready.side===request.side
      &&ready.mode===request.mode&&ready.requestSha256===requestHash&&ready.readOnly===true);
    requireHandshake(backendValid(ready.backend,request,deps.address));
    await deps.assertCurrent();const rows=await deps.observe();requireHandshake(Array.isArray(rows)&&rows.length===1&&same(rows[0],ready.backend));
    await deps.onReady(ready.backend);await deps.assertCurrent();
    const permit={version:1,operationId:request.operationId,requestSha256:requestHash,
      backendSha256:sha256(canonicalBytes(ready.backend)),action:request.mode==='INVENTORY'?'READ_INVENTORY':'REVOKE_SESSIONS'};
    await deps.onPermitted(ready.backend);
    await pipeline(Readable.from([canonicalBytes(permit)]),child.stdin);
    let closed=false;
    const drainRead=async()=>{
      const next=reader.next().then(item=>({item}));
      for(;;) {
        const observed=await Promise.race([next,pause(100).then(()=>({tick:true}))]);
        const current=await (deps.assertDraining??deps.assertCurrent)();
        if(current?.helperBackendEnded)closed=true;
        const active=await deps.observe();requireHandshake(Array.isArray(active));
        if(active.length===0)closed=true;
        else requireHandshake(!closed&&active.length===1&&same(active[0],ready.backend));
        if(observed.item)return observed.item;
      }
    };
    const second=await drainRead();
    requireHandshake(!second.done);const result=second.value;
    if(request.mode==='INVENTORY') {
      requireHandshake(exactKeys(result,'version,operationId,mode,inventorySha256,dbSnapshotSha256,assetCount,referencedFileCount,orphanFileCount,fileCount,fileBytes'));
      requireHandshake(result.version===1&&result.mode==='INVENTORY'&&result.operationId===request.operationId
        &&fullId(result.inventorySha256)&&fullId(result.dbSnapshotSha256));
      for(const field of ['assetCount','referencedFileCount','orphanFileCount','fileCount','fileBytes']) requireHandshake(decimal(result[field]));
      requireHandshake(BigInt(result.fileCount)===BigInt(result.referencedFileCount)+BigInt(result.orphanFileCount));
    } else {
      requireHandshake(exactKeys(result,'operationId,backupId,revokedCount,auditEventId,committed')
        &&result.operationId===request.operationId&&result.backupId===request.backupId
        &&decimal(result.revokedCount)&&uuid(result.auditEventId)&&result.committed===true);
    }
    requireHandshake((await drainRead()).done&&(await stderr)==='');
    await (deps.assertDraining??deps.assertCurrent)();
    const remaining=await deps.observe();requireHandshake(Array.isArray(remaining)&&remaining.length===0);return result;
  } catch(error) {
    if(error instanceof OpsError&&error.code==='INTERRUPTED') throw error;
    if(stderr&&child.stdout.readableEnded) {
      const code=await deadline(stderr,30000).catch(()=>null);
      if(typeof code==='string'&&/^[A-Z_]+\n$/.test(code)) {
        try { const failure=new OpsError(code.trim()); throw failure; }
        catch(failure) { if(failure instanceof OpsError&&failure.code===code.trim()) throw failure; }
      }
    }
    if(error instanceof OpsError&&!['INPUT_INVALID','ADAPTER_UNSEALED'].includes(error.code)) throw error;
    throw new OpsError('CAPTURE_FAILED');
  }
}

export function pgpassBytes(password) {
  try {
    requireHandshake(password instanceof Uint8Array && password.length>0 && password.length<=1048576);
    const text=new TextDecoder('utf8',{fatal:true}).decode(password);requireHandshake(!/[\r\n\0]/.test(text));
    return Buffer.from(`postgres:5432:cms:cms_local:${text.replaceAll('\\','\\\\').replaceAll(':','\\:')}\n`);
  } catch { throw new OpsError('INPUT_INVALID'); }
}

// Raw archives and diagnostic streams go only to the supplied private file streams.
// Stream success is not a semantic restore proof; the fresh-target gate remains required.
export async function runPgTool(child,deps) {
  const abort=new AbortController(),cancel=()=>abort.abort();deps.signal?.addEventListener('abort',cancel,{once:true});
  let pinned=null,missing=false,ended=false,processEnded=false,bytes=0n,diagnosticBytes=0;const hash=createHash('sha256');
  const safe=()=>new OpsError('CAPTURE_FAILED');
  try {
    requireHandshake(['PG_DUMP','PG_RESTORE'].includes(deps.policy.kind));
    const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{processEnded=true;resolve({code,signal});});});exit.catch(()=>{});
    const count=new Transform({transform(chunk,_encoding,callback){bytes+=BigInt(chunk.length);hash.update(chunk);callback(null,chunk);}});
    const diagnostics=new Transform({transform(chunk,_encoding,callback){diagnosticBytes+=chunk.length;
      if(diagnosticBytes>4194304)callback(safe());else callback(null,chunk);}});
    const streams=[pipeline(child.stderr,diagnostics,deps.diagnostic,{signal:abort.signal})];
    if(deps.policy.kind==='PG_DUMP') {
      child.stdin.end();streams.push(pipeline(child.stdout,count,deps.output,{signal:abort.signal}));
    } else {
      requireHandshake(deps.input);streams.push(pipeline(deps.input,child.stdin,{signal:abort.signal}));
      streams.push(pipeline(child.stdout,new Writable({write(chunk,_encoding,callback){callback(chunk.length?safe():null);}}),{signal:abort.signal}));
    }
    const completion=Promise.all([...streams,exit]).then(values=>{ended=true;const result=values.at(-1);
      requireHandshake(result.code===0&&result.signal===null);return result;});completion.catch(()=>{});
    while(!ended&&!processEnded) {
      let current;
      try { current=await deps.assertCurrent(); } catch(error) { if(processEnded) break;throw error; }
      if(processEnded) break;
      if(current?.helperBackendEnded)missing=true;
      if(current?.lease?.helper?.state==='EXITED'){processEnded=true;break;}
      let processes;
      try{processes=await deps.inspectProcess();}catch(error){
        const ended=await deps.assertCurrent();if(ended?.lease?.helper?.state==='EXITED'){processEnded=true;break;}throw error;
      }
      if(processEnded) break;
      requireHandshake(Array.isArray(processes)&&processes.length===1&&Number.isInteger(processes[0].pid)&&processes[0].pid>0
        &&same(processes[0].args,[deps.policy.entrypoint,...deps.policy.args]));
      const rows=await deps.observe();requireHandshake(Array.isArray(rows)&&rows.length<=1);
      if(rows.length) {
        const current=rows[0];requireHandshake(!missing&&backendValid(current,{operationId:deps.operationId},deps.address));
        if(pinned) requireHandshake(same(current,pinned));
        else {pinned=structuredClone(current);await deps.onBackend(pinned);}
      } else if(pinned) missing=true;
      await Promise.race([completion,pause(100)]);
    }
    await completion;requireHandshake(pinned!==null);
    const remaining=await deps.observe();requireHandshake(Array.isArray(remaining)&&remaining.length===0);
    if(deps.policy.kind==='PG_DUMP') requireHandshake(bytes>0n);
    return {backend:pinned,byteSize:String(bytes),sha256:hash.digest('hex')};
  } catch { abort.abort();throw new OpsError(deps.signal?.aborted?'INTERRUPTED':'CAPTURE_FAILED'); }
  finally { deps.signal?.removeEventListener('abort',cancel); }
}

async function privateBytes(path,bytes) {
  await directory(dirname(path));const handle=await open(path,'wx',0o600);
  try {await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  await syncDirectory(dirname(path));return path;
}
async function privateHandle(path) {
  await directory(dirname(path));const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {const info=await handle.stat();requirePolicy(info.isFile()&&info.nlink===1&&info.uid===process.getuid()
    &&info.gid===process.getgid()&&(info.mode&0o7777)===0o600);return{handle,info};}
  catch(error){await handle.close();throw error;}
}
async function artifact(path,readBytes=false) {
  const {handle,info}=await privateHandle(path),hash=createHash('sha256'),chunks=[];let size=0n;
  try {
    for await(const chunk of handle.createReadStream({autoClose:false})) {hash.update(chunk);size+=BigInt(chunk.length);if(readBytes)chunks.push(chunk);}
    const after=await handle.stat(),named=await lstat(path);
    requirePolicy(after.dev===info.dev&&after.ino===info.ino&&after.size===info.size&&after.mtimeMs===info.mtimeMs
      &&after.nlink===1&&named.dev===info.dev&&named.ino===info.ino&&size===BigInt(info.size));
    return{path,byteSize:String(size),sha256:hash.digest('hex'),...(readBytes?{bytes:Buffer.concat(chunks)}:{})};
  }finally{await handle.close();}
}
const javaProfile=String.raw`import java.nio.file.*; import java.util.zip.*; import java.net.*; import java.awt.image.*; import javax.imageio.*; import java.io.*;
class Profile { public static void main(String[] args) throws Exception {
  if(!Files.readString(Path.of("/probe/input")).equals("synthetic")) throw new Exception();
  try(ZipFile zip=new ZipFile("/app/app.jar")) {
    var entry=zip.stream().filter(e->e.getName().matches("BOOT-INF/lib/postgresql-.*[.]jar")).findFirst().orElseThrow();
    try(var input=zip.getInputStream(entry)){Files.copy(input,Path.of("/tmp/postgresql.jar"));}
  }
  try(var loader=new URLClassLoader(new URL[]{Path.of("/tmp/postgresql.jar").toUri().toURL()})){Class.forName("org.postgresql.Driver",true,loader);}
  var out=new ByteArrayOutputStream();ImageIO.write(new BufferedImage(2,2,BufferedImage.TYPE_INT_RGB),"png",out);
  if(ImageIO.read(new ByteArrayInputStream(out.toByteArray()))==null)throw new Exception();
  try(var files=Files.walk(Path.of("/media"))){if(files.anyMatch(p->!Files.isReadable(p)))throw new Exception();}
  Files.writeString(Path.of("/probe/output/java"),"synthetic",StandardOpenOption.CREATE_NEW);
  System.out.println("{\"javaRuntimeVersion\":\""+System.getProperty("java.runtime.version")+"\",\"jdbc\":true,\"imageio\":true,\"privateFiles\":true,\"mediaReadable\":true}");
}}
`;
const nodeProfile=`const f=require('node:fs');if(f.readFileSync('/probe/input','utf8')!=='synthetic')throw Error();const p='/probe/output/node';const d=f.openSync(p,'wx',0o600);f.writeSync(d,'synthetic');f.fsyncSync(d);f.closeSync(d);const q=f.openSync('/probe/output','r');f.fsyncSync(q);f.closeSync(q);console.log(JSON.stringify({node:process.version,uid:process.getuid(),gid:process.getgid(),privateFiles:true,directoryFsync:true}));`;
export async function probeHelperProfile(c,deps={}) {
  const env=helperEnvironment(deps.environment),command=deps.command??execute,base=join(c.helperRoot,'profile');
  const docker=async args=>{const result=await command('docker',['--host','unix:///var/run/docker.sock',...args],
    {env,shell:false,timeout:30000,maxBuffer:16384});requirePolicy(result.code===undefined||result.code===0);return result.stdout;};
  try {
    await directory(c.helperRoot);await mkdir(base,{mode:0o700});await mkdir(join(base,'output'),{mode:0o700});
    await privateBytes(join(base,'input'),Buffer.from('synthetic'));await privateBytes(join(base,'Profile.java'),Buffer.from(javaProfile));
    const compiler=env.JAVA_HOME?join(env.JAVA_HOME,'bin/javac'):'javac';
    const compile=async args=>{const result=await command(compiler,args,{env,shell:false,timeout:30000,maxBuffer:16384});
      requirePolicy(result.code===undefined||result.code===0);return `${result.stdout??''}${result.stderr??''}`.trim();};
    requirePolicy(/^javac 25(?:[.+]|$)/.test(await compile(['-version'])));
    const classes=join(base,'classes');await mkdir(classes,{mode:0o700});
    await compile(['--release','25','-d',classes,join(base,'Profile.java')]);
    const compiled=join(classes,'Profile.class'),classStat=await lstat(compiled);
    requirePolicy(classStat.isFile()&&!classStat.isSymbolicLink()&&classStat.nlink===1&&classStat.uid===c.uid&&classStat.gid===c.gid);
    await chmod(compiled,0o600);const classArtifact=await artifact(compiled),sourceArtifact=await artifact(join(base,'Profile.java'));
    requirePolicy(sourceArtifact.sha256===sha256(Buffer.from(javaProfile)));
    await privateBytes(join(base,'compile.json'),canonicalBytes({sourceSha256:sourceArtifact.sha256,classSha256:classArtifact.sha256,uid:c.uid,gid:c.gid}));
    const volume=c.target.volumeNames['media-data'],volumes=JSON.parse(await docker(['volume','inspect',volume]));
    requirePolicy(volumes.length===1&&volumes[0].Name===volume);
    const mount=(source,destination,type='bind',readOnly=true)=>({source,destination,type,readOnly});
    const io=[mount(join(base,'input'),'/probe/input'),mount(join(base,'output'),'/probe/output','bind',false)];
    let seq=0;
    const probe=async(kind,executable,args,mounts=[],defaultUser=false)=>{
      const imageId=c.target.images[kind],images=JSON.parse(await docker(['image','inspect',imageId]));
      requirePolicy(images.length===1&&images[0].Id===imageId&&images[0].Os==='linux');const image=images[0];
      assertImageVolumes(image,kind==='postgres',mounts);
      let role='PROFILE';
      if(kind==='postgres') {
        role=Object.keys(pgVersions).find(key=>pgVersions[key]===executable);
        requirePolicy(role&&same(args,['--version'])&&mounts.length===0&&!defaultUser);
      }
      const policy={version:1,kind:role,side:'source',imageId,user:defaultUser?(image.Config.User??''):`${c.uid}:${c.gid}`,
        entrypoint:executable,args,env:[...(image.Config.Env??[])].sort(),mounts:mounts.sort((a,b)=>a.destination.localeCompare(b.destination)),
        networkId:null,readOnlyRootfs:true,capDrop:['ALL'],noNewPrivileges:true,restart:'no',logDriver:'none'};
      const expected={name:`cms-pp1c-${c.operationId}-${c.seq}-profile-${++seq}`,labels:{...(image.Config.Labels??{}),
        'org.cms.pp1c.operation':c.operationId,'org.cms.pp1c.seq':c.seq,'org.cms.pp1c.kind':role,'org.cms.pp1c.policy':sha256(canonicalBytes(policy))},
        volumeMountpoints:{[volume]:volumes[0].Mountpoint},pgProfileImageId:c.target.images.postgres,noneNetworkId:await inspectNoneNetwork(docker)};
      let id,owned=false;
      const inspect=async state=>{const rows=JSON.parse(await docker(['inspect',id]));requirePolicy(rows.length===1);
        assertHelperPolicy(rows[0],policy,{...expected,fullContainerId:id,state});return rows[0];};
      try {
        id=String(await docker(helperCreateArgs(policy,expected))).trim();requirePolicy(fullId(id));await inspect('created');owned=true;
        await privateBytes(join(base,`probe-${seq}.json`),canonicalBytes({fullContainerId:id,policySha256:sha256(canonicalBytes(policy))}));
        const output=await docker(['start','--attach','--interactive',id]);const stopped=await inspect('exited');requirePolicy(stopped.State.ExitCode===0);
        await docker(['rm',id]);owned=false;
        let missing;try{missing=await command('docker',['--host','unix:///var/run/docker.sock','inspect',id],{env,shell:false,timeout:30000,maxBuffer:16384});}catch(error){missing=error;}
        requirePolicy(missing.code===1&&[`Error: No such object: ${id}`,`error: no such object: ${id}`,`Error response from daemon: No such container: ${id}`].includes(String(missing.stderr??'').trim()));
        return String(output);
      }catch(error){
        if(owned)try{const rows=JSON.parse(await docker(['inspect',id]));requirePolicy(rows.length===1);
          const state=rows[0].State.Status;await inspect(state);
          if(state==='running'){await docker(['stop','--time','30',id]);await docker(['wait',id]);await inspect('exited');}
          await docker(['rm',id]);
        }catch{/* Retain unknown identity and private probe record. */}
        throw error;
      }
    };
    const java=JSON.parse(await probe('api','/opt/java/openjdk/bin/java',['-cp','/probe/classes','Profile'],
      [...io,mount(classes,'/probe/classes'),mount(volume,'/media','volume')]));
    requirePolicy(/^25(?:[.+]|$)/.test(java.javaRuntimeVersion)&&['jdbc','imageio','privateFiles','mediaReadable'].every(k=>java[k]===true));
    const node=JSON.parse(await probe('node','/opt/pp1-node',['-e',nodeProfile],[...io,mount(c.nodeBinary,'/opt/pp1-node')]));
    requirePolicy(/^v24[.]/.test(node.node)&&node.uid===c.uid&&node.gid===c.gid&&node.privateFiles===true&&node.directoryFsync===true);
    const pgDumpVersion=(await probe('postgres','/usr/local/bin/pg_dump',['--version'])).trim().match(/^pg_dump [(]PostgreSQL[)] (16[.][0-9]+(?:[.][0-9]+)?(?: [^\r\n]+)?)$/)?.[1];
    const pgRestoreVersion=(await probe('postgres','/usr/local/bin/pg_restore',['--version'])).trim().match(/^pg_restore [(]PostgreSQL[)] (16[.][0-9]+(?:[.][0-9]+)?(?: [^\r\n]+)?)$/)?.[1];
    const uid=(await probe('api','/usr/bin/id',['-u'],[],true)).trim(),gid=(await probe('api','/usr/bin/id',['-g'],[],true)).trim();
    const postgresServerVersion=(await docker(['exec',c.target.containerIds.postgres,'psql','-X','-q','-t','-A','-U','cms_local','-d','cms','-c','SHOW server_version;'])).trim();
    const serverNumber=String(await docker(['exec',c.target.containerIds.postgres,'psql','-X','-q','-t','-A','-U','cms_local','-d','cms','-c','SHOW server_version_num;'])).trim();
    requirePolicy(pgDumpVersion&&pgRestoreVersion&&/^[0-9]+$/.test(uid)&&/^[0-9]+$/.test(gid)
      &&/^16[.][0-9]+(?:[.][0-9]+)?(?: [^\r\n]+)?$/.test(postgresServerVersion)&&/^16[0-9]{4}$/.test(serverNumber));
    return {javaRuntimeVersion:java.javaRuntimeVersion,pgDumpVersion,pgRestoreVersion,postgresServerVersion,mediaUser:`${uid}:${gid}`};
  }catch{throw new OpsError('ADAPTER_UNSEALED');}
}

function fileSink(handle) {
  return new Writable({write(chunk,_encoding,done){
    (async()=>{let offset=0;while(offset<chunk.length){const result=await handle.write(chunk,offset,chunk.length-offset);
      requireHandshake(result.bytesWritten>0);offset+=result.bytesWritten;}})().then(()=>done(),done);
  }});
}
async function mediaScriptHash(c) {
  const path=join(c.cwd,'scripts/ops/local-media.mjs'),handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {const before=await handle.stat();requirePolicy(before.isFile()&&before.nlink===1&&before.uid===c.uid);
    const bytes=await handle.readFile(),after=await handle.stat(),named=await lstat(path);
    requirePolicy(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs
      &&named.ino===before.ino&&named.dev===before.dev&&after.nlink===1);return sha256(bytes);
  }finally{await handle.close();}
}
const helperRuns=new WeakMap(),inventoryResults=new WeakMap();
export function verifiedInventoryResult(token,result) {
  const owned=inventoryResults.get(result);requirePolicy(owned?.token===token);
  return owned.metadata;
}
export async function verifiedHelperProfile(token,deps={}) {
  const state=helperRuns.get(token);requirePolicy(state?.profile);
  requirePolicy(state.profileContext&&await mediaScriptHash(state.profileContext)===state.scriptHash);
  return Object.freeze({...state.profile});
}
export async function runOwnedHelper(token,options,deps={}) {
  requirePolicy(exactKeys(options,'side,kind')&&options.kind!=='REVOKE_SESSIONS'&&sides[options.kind]?.includes(options.side));
  const workflow=await import('./maintenance-workflow.mjs'),{side,kind}=options;
  const c=await workflow.reserveHelper(token,options,deps),env=helperEnvironment(deps.environment),command=deps.command??execute;
  const docker=async args=>{const result=await command('docker',['--host','unix:///var/run/docker.sock',...args],
    {env,shell:false,timeout:30000,maxBuffer:16*1024*1024});requirePolicy(result.code===undefined||result.code===0);return result.stdout;};
  let registered,removed=false,pgpass=null,outputHandle,diagnosticHandle,primaryFailure,restoreFile;
  try {
    const state=helperRuns.get(token)??{};
    if(state.profileContext)requirePolicy(state.profileContext.cwd===c.cwd&&state.profileContext.uid===c.uid);
    else state.profileContext=Object.freeze({cwd:c.cwd,uid:c.uid});
    const scriptHash=await mediaScriptHash(c);if(state.scriptHash)requirePolicy(state.scriptHash===scriptHash);else state.scriptHash=scriptHash;
    if(!state.profile)state.profile=await probeHelperProfile(c,deps);
    helperRuns.set(token,state);await workflow.assertWorkflow(token,{},deps);
    const restoring=['PG_RESTORE','MEDIA_RESTORE'].includes(kind);
    const material=restoring?await(deps.restoreMaterial??(await import('../ops/local-recovery-verify.mjs')).restoreBundleMaterial)(token,deps):null;
    const selected=c.target.images[kind.startsWith('PG_')?'postgres':kind.startsWith('MEDIA_')?'node':'api'];
    const images=JSON.parse(await docker(['image','inspect',selected]));requirePolicy(images.length===1);
    const policy=buildHelperPolicy({...c,image:images[0],side,kind,mediaUser:state.profile.mediaUser}),policySha256=sha256(canonicalBytes(policy));
    const volumes=JSON.parse(await docker(['volume','inspect',c.target.volumeNames['media-data']]));
    requirePolicy(volumes.length===1&&volumes[0].Name===c.target.volumeNames['media-data']);
    const expected={name:`cms-pp1c-${c.operationId}-${c.seq}`,labels:{...(images[0].Config.Labels??{}),
      'org.cms.pp1c.operation':c.operationId,'org.cms.pp1c.seq':c.seq,'org.cms.pp1c.kind':kind,'org.cms.pp1c.policy':policySha256},
      volumeMountpoints:{[volumes[0].Name]:volumes[0].Mountpoint},dataNetworkName:`${c.target.project}_data`,noneNetworkId:policy.networkId?null:await inspectNoneNetwork(docker)};
    const request={version:1,mode:'INVENTORY',operationId:c.operationId,side,targetId:c.target.targetId,releaseId:c.target.images.api,
      jdbcUrl:(c.connection??c.lease.sourceConnection).jdbcUrl,dbUser:'cms_local',passwordFile:'/run/secrets/spring.datasource.password',
      mediaRoot:'/media',outputFile:'/run/pp1/output/inventory.json',backupId:null,rawProofSha256:null};
    let path;
    if(kind==='INVENTORY') {
      const bytes=canonicalBytes(request);requirePolicy(bytes.length<=65536);await privateBytes(join(c.helperRoot,'request.json'),bytes);
      await mkdir(join(c.helperRoot,'output'),{mode:0o700});path=join(c.helperRoot,'output/inventory.json');
    }else {
      if(restoring){
        const name=kind==='PG_RESTORE'?'db.dump':'media.package',expected=material.manifest.artifacts.find(a=>a.path===name);
        requirePolicy(expected&&material.operationId===c.operationId&&material.sourceRoot!==c.runRoot);
        const input=join(material.path,name);restoreFile={...(await privateHandle(input)),path:input,expected};
        requireHandshake(String(restoreFile.info.size)===expected.byteSize);
      }else {path=join(c.helperRoot,kind==='PG_DUMP'?'db.dump':'media.package');outputHandle=await open(path,'wx',0o600);}
      if(kind.startsWith('PG_')) {
        const secret=await privateHandle(join(c.runRoot,'secrets/spring.datasource.password'));
        try{requirePolicy(secret.info.size<=1048576);pgpass=await privateBytes(join(c.helperRoot,'pgpass'),pgpassBytes(await secret.handle.readFile()));}
        finally{await secret.handle.close();}
        diagnosticHandle=await open(join(c.helperRoot,'diagnostic'),'wx',0o600);
      }else if(!restoring) {
        requirePolicy(state.inventory);const prior=await artifact(state.inventory.path,true);
        requirePolicy(prior.sha256===state.inventory.sha256);validateInventory(parseStrictJson(prior.bytes));
      }
    }
    const observe=async()=>{
      const sql="SELECT COALESCE(json_agg(a), '[]'::json)::text FROM (SELECT pid, extract(epoch FROM backend_start)::text AS backend_start_epoch, usename, datname, application_name, host(client_addr) AS client_addr, state FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()) a;";
      const rows=JSON.parse(await docker(['exec',c.target.containerIds.postgres,'psql','-X','-q','-t','-A','-U','cms_local','-d','cms','-c',sql]));requireHandshake(Array.isArray(rows));
      return rows.map(r=>({pid:r.pid,backendStartEpoch:r.backend_start_epoch,db:r.datname,role:r.usename,clientAddr:r.client_addr,applicationName:r.application_name}));
    };
    const sourceCurrent=async()=>requirePolicy(await mediaScriptHash(c)===state.scriptHash);
    const assertCurrent=async()=>{await sourceCurrent();return workflow.assertWorkflow(token,{},deps);};
    const assertDraining=async()=>{await sourceCurrent();const value=await workflow.assertHelperDrain(token,deps);registered=value.lease.helper;return value;};
    const update=async patch=>{registered={...registered,...patch};await workflow.updateOwnedHelper(token,registered,deps);};
    const result=await executeHelperLifecycle(policy,expected,async(child,live)=>{
      if(kind==='INVENTORY')return runJdbcHandshake(child,request,{address:registered.endpoint.address,assertCurrent,assertDraining,observe,
        onReady:backend=>update({state:'READY',backend}),onPermitted:()=>update({state:'PERMITTED'})});
      if(restoring) {
        const hash=createHash('sha256');let size=0n;
        const input=restoreFile.handle.createReadStream({autoClose:false});
        const checkedInput=new Transform({transform(chunk,_encoding,done){size+=BigInt(chunk.length);hash.update(chunk);
          done(size>BigInt(restoreFile.expected.byteSize)?new OpsError('RESTORE_FAILED'):null,chunk);}});
        const transfer=pipeline(input,checkedInput);transfer.catch(()=>{});
        try {
          let receipt;
          if(kind==='PG_RESTORE')receipt=await runPgTool(child,{policy,input:checkedInput,diagnostic:fileSink(diagnosticHandle),signal:live.signal,
            operationId:c.operationId,address:registered.endpoint.address,observe,
            assertCurrent:()=>registered.backend?assertDraining():assertCurrent(),onBackend:backend=>update({backend}),
            inspectProcess:async()=>{
              const lines=String(await docker(['top',live.id,'-eo','pid,args'])).trimEnd().split('\n');
              requireHandshake(/^[ \t]*PID[ \t]+COMMAND[ \t]*$/.test(lines.shift()??''));
              return lines.map(line=>{const match=/^\s*([1-9][0-9]*)\s+(.+)$/.exec(line);requireHandshake(match);return{pid:Number(match[1]),args:match[2].split(/\s+/)};});
            }});
          else {
            const chunks=[];let bytes=0;
            const stdout=new Writable({write(chunk,_encoding,done){bytes+=chunk.length;if(bytes<=16384)chunks.push(chunk);
              done(bytes>16384?new OpsError('RESTORE_FAILED'):null);}});
            const errors=fixedStderr(child.stderr);errors.catch(()=>{});
            let drained=false;const completion=Promise.all([pipeline(checkedInput,child.stdin),pipeline(child.stdout,stdout)]).then(()=>{drained=true;});completion.catch(()=>{});
            while(!drained){await assertDraining();await Promise.race([completion,pause(100)]);}
            await completion;await assertDraining();requireHandshake((await errors)==='');
            receipt=parseStrictJson(Buffer.concat(chunks));
            requireHandshake(exactKeys(receipt,'version,operationId,fileCount,fileBytes,mediaHeaderSha256')&&receipt.version===1&&receipt.operationId===null
              &&receipt.fileCount===material.manifest.inventory.fileCount&&receipt.fileBytes===material.manifest.inventory.fileBytes
              &&receipt.mediaHeaderSha256===material.inventory.mediaHeaderSha256);
          }
          await transfer;
          const after=await restoreFile.handle.stat(),named=await lstat(restoreFile.path),before=restoreFile.info;
          requireHandshake(['dev','ino','size','mtimeMs','ctimeMs','mode','uid','gid','nlink'].every(key=>before[key]===after[key]&&before[key]===named[key])
            &&String(size)===restoreFile.expected.byteSize&&hash.digest('hex')===restoreFile.expected.sha256);
          return receipt;
        }catch(error){input.destroy();checkedInput.destroy();await transfer.catch(()=>{});throw error;}
      }
      const capacity=await statfs(c.helperRoot,{bigint:true}),available=capacity.bavail*capacity.bsize;
      const reserve=available/10n>536870912n?available/10n:536870912n;requireHandshake(available>reserve);let total=0n;
      const bound=new Transform({transform(chunk,_encoding,done){total+=BigInt(chunk.length);done(total>available-reserve?new OpsError('CAPTURE_FAILED'):null,chunk);}});
      const output=fileSink(outputHandle),sink=pipeline(bound,output);sink.catch(()=>{});
      try {
        if(kind==='PG_DUMP') {
          const value=await runPgTool(child,{policy,signal:live.signal,operationId:c.operationId,address:registered.endpoint.address,
            output:bound,diagnostic:fileSink(diagnosticHandle),observe,
            assertCurrent:()=>registered.backend?assertDraining():assertCurrent(),onBackend:backend=>update({backend}),
            inspectProcess:async()=>{
              const lines=String(await docker(['top',live.id,'-eo','pid,args'])).trimEnd().split('\n');
              requireHandshake(/^[ \t]*PID[ \t]+COMMAND[ \t]*$/.test(lines.shift()??''));
              return lines.map(line=>{const match=/^\s*([1-9][0-9]*)\s+(.+)$/.exec(line);requireHandshake(match);return{pid:Number(match[1]),args:match[2].split(/\s+/)};});
            }});
          await sink;return value;
        }
        const input=await artifact(state.inventory.path,true);requireHandshake(input.sha256===state.inventory.sha256);
        const errors=fixedStderr(child.stderr);errors.catch(()=>{});
        let drained=false;
        const completion=Promise.all([pipeline(Readable.from([input.bytes]),child.stdin),pipeline(child.stdout,bound),sink]).then(()=>{drained=true;});
        completion.catch(()=>{});
        while(!drained){await assertDraining();await Promise.race([completion,pause(100)]);}
        await completion;await assertDraining();
        requireHandshake((await errors)==='');return null;
      }catch(error){bound.destroy();output.destroy();await sink.catch(()=>{});throw error;}
    },{...deps,onCreated:async(id,_created,e)=>{
      registered={kind,side,fullContainerId:id,policySha256,state:'CREATED',endpoint:null,backend:null,startedAt:new Date().toISOString()};
      await workflow.registerOwnedHelper(token,registered,policy,e,deps);
    },onRunning:async(_id,running)=>{
      const endpoint=policy.networkId?Object.values(running.NetworkSettings.Networks)[0]:null;
      await update({state:'RUNNING',endpoint:endpoint?{networkId:endpoint.NetworkID,address:endpoint.IPAddress}:null});
    },onExited:async()=>{
      if(registered.backend&&['PERMITTED','RUNNING'].includes(registered.state))await assertDraining();
      if(registered.state!=='EXITED')await update({state:'EXITED'});else await assertCurrent();
    },onRemoved:async()=>{await workflow.clearOwnedHelper(token,deps);removed=true;}});
    if(outputHandle){await outputHandle.sync();await outputHandle.close();outputHandle=null;}
    if(diagnosticHandle){await diagnosticHandle.sync();await diagnosticHandle.close();diagnosticHandle=null;}
    if(restoring){await assertCurrent();return Object.freeze({kind,side,receipt:result});}
    await syncDirectory(dirname(path));const checked=await artifact(path,kind==='INVENTORY');await assertCurrent();
    if(kind==='INVENTORY') {
      const inventory=parseStrictJson(checked.bytes);validateInventory(inventory);
      const counts={assetCount:String(inventory.assets.length),referencedFileCount:String(inventory.files.filter(f=>f.classification==='referenced').length),
        orphanFileCount:String(inventory.files.filter(f=>f.classification==='orphan').length),fileCount:String(inventory.files.length),
        fileBytes:String(inventory.files.reduce((sum,f)=>sum+BigInt(f.byteSize),0n))};
      requireHandshake(result.inventorySha256===checked.sha256&&result.dbSnapshotSha256===inventory.dbSnapshotSha256
        &&Object.entries(counts).every(([key,value])=>result[key]===value));
      state.inventory={path,sha256:checked.sha256};const {bytes,...metadata}=checked;
      const finished=Object.freeze({kind,...metadata,inventory,inventorySha256:checked.sha256,receipt:result,profile:Object.fromEntries(['javaRuntimeVersion','pgDumpVersion','pgRestoreVersion','postgresServerVersion'].map(key=>[key,state.profile[key]]))});
      inventoryResults.set(finished,{token,metadata:Object.freeze({side,kind,seq:c.seq,operationId:c.operationId,targetId:c.target.targetId,
        releaseId:c.target.images.api,path,sha256:checked.sha256,byteSize:checked.byteSize,requestSha256:sha256(canonicalBytes(request))})});return finished;
    }
    if(kind==='PG_DUMP')requireHandshake(result.sha256===checked.sha256&&result.byteSize===checked.byteSize);
    return{kind,...checked};
  }catch(error){
    const code=error instanceof OpsError?error.code:'CAPTURE_FAILED';primaryFailure=new OpsError(code);
    await workflow.failWorkflow(token,code,deps);throw primaryFailure;
  }finally{
    await restoreFile?.handle.close().catch(()=>{});
    await outputHandle?.close().catch(()=>{});await diagnosticHandle?.close().catch(()=>{});
    try{if(pgpass&&removed){const check=await privateHandle(pgpass);await check.handle.close();await unlink(pgpass);await syncDirectory(dirname(pgpass));}}
    catch{if(!primaryFailure){await workflow.failWorkflow(token,'CAPTURE_FAILED',deps);throw new OpsError('CAPTURE_FAILED');}}
  }
}

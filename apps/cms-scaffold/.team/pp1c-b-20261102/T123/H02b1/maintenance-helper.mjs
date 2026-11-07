import { OpsError, canonicalBytes, parseStrictJson, sha256 } from '../ops/recovery-protocol.mjs';
import { isIP } from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
const requirePolicy = value => { if (!value) throw new OpsError('ADAPTER_UNSEALED'); };
const same = (a,b) => canonicalBytes(a).equals(canonicalBytes(b));
const empty = value => value == null || Object.keys(value).length === 0;
const pathSafe = value => typeof value === 'string' && value.startsWith('/')
  && !/[,\r\n\0]/.test(value) && !value.split('/').some(x => x === '..' || x === '.');
const imageId = value => /^sha256:[a-f0-9]{64}$/.test(value);
const fullId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sides = { INVENTORY:['source','target'], REVOKE_SESSIONS:['target'], PG_DUMP:['source'],
  PG_RESTORE:['target'], MEDIA_PACK:['source'], MEDIA_RESTORE:['target'] };

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
    `--user=${policy.user}`,`--network=${policy.networkId??'none'}`,'--tmpfs=/tmp:rw,nosuid,nodev,size=67108864','--interactive');
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
    requirePolicy(same(h.Tmpfs,{'/tmp':'rw,nosuid,nodev,size=67108864'}));
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
      requirePolicy(networks.length===1 && networks[0][1].NetworkID===policy.networkId);
      if(expected.state==='running') requirePolicy(isIP(networks[0][1].IPAddress)!==0);
    } else requirePolicy(networks.every(([name,v])=>name==='none' && !v.IPAddress && !v.GlobalIPv6Address && !v.EndpointID));
    requirePolicy(['created','running','exited'].includes(expected.state) && p.State.Status===expected.state && p.State.Running===(expected.state==='running'));
    return container;
  } catch { throw new OpsError('ADAPTER_UNSEALED'); }
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
        `Error: No such object: ${id}`,`Error response from daemon: No such container: ${id}`
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
        await (deps.assertDraining??deps.assertCurrent)();
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
      try { await deps.assertCurrent(); } catch(error) { if(processEnded) break;throw error; }
      if(processEnded) break;const processes=await deps.inspectProcess();
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

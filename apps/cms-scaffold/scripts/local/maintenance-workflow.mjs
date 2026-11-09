import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir, open, lstat, rename } from 'node:fs/promises';
import { inspectTarget, inspectionDetails, mediaProbeCommand } from './maintenance-target.mjs';
import { reserveWorkflow, loadWorkflow, persistWorkflow, releaseWorkflow, updatePendingWorkflow, WORKFLOW_PHASES, directory, syncDirectory, read } from './maintenance-store.mjs';
import { canonicalBytes, sha256, OpsError } from '../ops/recovery-protocol.mjs';
const tokens=new WeakMap(),workflowStarts=new WeakMap(),execute=promisify(execFile);
const ensure=(value,code='TARGET_NOT_OWNED')=>{if(!value)throw new OpsError(code);};
const same=(a,b)=>canonicalBytes(a).equals(canonicalBytes(b));
const activitySql="SELECT COALESCE(json_agg(a), '[]'::json)::text FROM (SELECT pid, extract(epoch FROM backend_start)::text AS backend_start_epoch, usename, datname, application_name, host(client_addr) AS client_addr, state FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()) a;";
async function docker(deps,args,signal) {
  const env={...(deps.environment??process.env)};
  ensure(!env.DOCKER_HOST||env.DOCKER_HOST==='unix:///var/run/docker.sock');
  ensure(!env.DOCKER_CONTEXT||env.DOCKER_CONTEXT==='default');ensure(!env.DOCKER_TLS_VERIFY);
  for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[k];
  const result=await(deps.command??execute)('docker',['--host','unix:///var/run/docker.sock',...args],
    {env,shell:false,timeout:30000,maxBuffer:16*1024*1024,...(signal?{signal}:{})});
  ensure(result.code===undefined||result.code===0,'SOURCE_CHANGED');return result.stdout;
}
async function owned(token,deps) {
  const c=tokens.get(token);ensure(c&&!c.released&&!c.failed);
  ensure((deps.cwd??process.cwd())===(c.deps.cwd??process.cwd()));
  const current=await loadWorkflow(c.record.lease.source.runId,deps,{allowPending:true});
  ensure(current.identity?.ino===c.record.identity.ino&&current.identity?.dev===c.record.identity.dev
    && same(current.lease,c.record.lease)&&same(current.journal,c.record.journal));
  return c;
}
async function noWriters(inspection,deps,helper=null,operationId=null,completion=null,apiAddress=null) {
  const rows=helper?.kind.startsWith('PG_')&&completion?.samplePgRaw?await completion.samplePgRaw():JSON.parse(await docker(deps,['exec',inspection.target.containerIds.postgres,'psql','-X','-q','-t','-A','-U','cms_local','-d','cms','-c',activitySql]));
  ensure(Array.isArray(rows),'WRITER_NOT_QUIESCED');
  if(apiAddress) {
    ensure(!helper||helper.kind==='BROWSER','WRITER_NOT_QUIESCED');
    ensure(new Set(rows.map(row=>row.pid)).size===rows.length&&rows.every(row=>Number.isInteger(row.pid)&&row.pid>0
      &&/^[1-9][0-9]*\.[0-9]+$/.test(row.backend_start_epoch)&&row.usename==='cms_local'&&row.datname==='cms'
      &&row.application_name==='PostgreSQL JDBC Driver'&&row.client_addr===apiAddress
      &&['active','idle','idle in transaction'].includes(row.state)),'WRITER_NOT_QUIESCED');return;
  }
  if(!helper || ['MEDIA_PACK','MEDIA_RESTORE','BROWSER'].includes(helper.kind)
      || ['CREATED','EXITED'].includes(helper.state)) {
    ensure(rows.length===0,'WRITER_NOT_QUIESCED');
    return;
  }
  ensure(rows.length<=1,'WRITER_NOT_QUIESCED');
  if(rows.length===0) {
    ensure(helper.backend===null||completion?.draining,'WRITER_NOT_QUIESCED');
    if(helper.backend!==null)completion.backendEnded=true;
    return;
  }
  ensure(!completion?.backendEnded,'WRITER_NOT_QUIESCED');
  const row=rows[0];
  ensure(row.usename==='cms_local'&&row.datname==='cms'&&row.application_name===operationId
    &&row.client_addr===helper.endpoint?.address&&['active','idle','idle in transaction'].includes(row.state),'WRITER_NOT_QUIESCED');
  if(helper.backend)ensure(row.pid===helper.backend.pid&&row.backend_start_epoch===helper.backend.backendStartEpoch,'WRITER_NOT_QUIESCED');
}
const nsPerMs=1000000n;
function clockFunctions(deps) {
  return {clock:deps.clock??Date.now,monotonic:deps.monotonic??process.hrtime.bigint};
}
function clockSample(clocks) {
  const before=clocks.monotonic(),utc=clocks.clock(),after=clocks.monotonic();
  ensure(typeof before==='bigint'&&typeof after==='bigint'&&before>=0n&&after>=before,'OBJECTIVE_UNKNOWN');
  ensure(Number.isSafeInteger(utc)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(new Date(utc).toISOString()),'OBJECTIVE_UNKNOWN');
  return {before,utc,after};
}
function compatibleClocks(previous,current) {
  ensure(current.utc>=previous.utc&&current.before>=previous.after,'OBJECTIVE_UNKNOWN');
  const wallMs=BigInt(current.utc)-BigInt(previous.utc);
  // UTC samples represent half-open millisecond bins; their difference has open endpoints.
  ensure(current.after-previous.before>(wallMs-1n)*nsPerMs
    &&current.before-previous.after<(wallMs+1n)*nsPerMs,'OBJECTIVE_UNKNOWN');
}
function advanceClock(anchor) {
  const current=clockSample(anchor);compatibleClocks(anchor.first,current);compatibleClocks(anchor.last,current);
  anchor.last=current;return current;
}
export function captureWorkflowStart(deps={}) {
  try {
    const clocks=clockFunctions(deps),first=clockSample(clocks),anchor=Object.freeze({});
    workflowStarts.set(anchor,{...clocks,first,last:first,claimed:false,owner:null});return anchor;
  } catch {throw new OpsError('OBJECTIVE_UNKNOWN');}
}
function claimWorkflowStart(request,deps) {
  try {
    const key=Object.hasOwn(deps,'workflowStart')?deps.workflowStart:captureWorkflowStart(deps),anchor=workflowStarts.get(key),clocks=clockFunctions(deps);
    ensure(anchor&&!anchor.claimed&&anchor.clock===clocks.clock&&anchor.monotonic===clocks.monotonic,'OBJECTIVE_UNKNOWN');
    anchor.claimed=true;const incident=request.incidentStartedAt;
    ensure(typeof incident==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(incident)
      &&new Date(incident).toISOString()===incident&&Date.parse(incident)<=anchor.first.utc,'OBJECTIVE_UNKNOWN');
    anchor.operationId=request.operationId;anchor.incidentStartedAt=incident;advanceClock(anchor);return anchor;
  } catch {throw new OpsError('OBJECTIVE_UNKNOWN');}
}

export async function workflowTimingContext(token,deps={}) {
  try {
    const c=await owned(token,deps),anchor=c.timing,request=c.record.request,clocks=clockFunctions(deps);
    ensure(c.record.lease.purpose==='RESTORE_VERIFY_LOCAL'&&anchor?.owner===token
      &&anchor.clock===clocks.clock&&anchor.monotonic===clocks.monotonic,'OBJECTIVE_UNKNOWN');
    ensure(!Object.hasOwn(deps,'workflowStart')||workflowStarts.get(deps.workflowStart)===anchor,'OBJECTIVE_UNKNOWN');
    const startedAt=new Date(anchor.first.utc).toISOString();
    ensure(request.startedAt===startedAt&&c.record.lease.createdAt===startedAt&&request.operationId===anchor.operationId
      &&request.incidentStartedAt===anchor.incidentStartedAt,'OBJECTIVE_UNKNOWN');
    const offset=BigInt(anchor.first.utc)-BigInt(Date.parse(request.incidentStartedAt));ensure(offset>=0n,'OBJECTIVE_UNKNOWN');
    // This final sample follows owned-registry/request validation; no asynchronous work follows it.
    const available=advanceClock(anchor),elapsed=available.after-anchor.first.before;
    return Object.freeze({startedAt,availableAt:new Date(available.utc).toISOString(),elapsedMs:String(offset+(elapsed+nsPerMs-1n)/nsPerMs)});
  } catch {throw new OpsError('OBJECTIVE_UNKNOWN');}
}

const workflowLimitNs=21600000n*1000000n;
function executionState(deps,start) {
  const monotonic=clockFunctions(deps).monotonic,controller=new AbortController();
  const first=start??monotonic(),schedule=deps.setWorkflowTimeout??setTimeout,clear=deps.clearWorkflowTimeout??clearTimeout;
  ensure(!deps.signal||deps.signal instanceof AbortSignal,'INTERRUPTED');
  const relay=()=>controller.abort();deps.signal?.addEventListener('abort',relay,{once:true});if(deps.signal?.aborted)relay();
  const state={controller,first,last:first,timer:null,closed:false};
  state.check=()=>{
    try {
      const now=monotonic();ensure(!controller.signal.aborted&&typeof first==='bigint'&&typeof now==='bigint'
        &&first>=0n&&now>=state.last&&now-first<workflowLimitNs,'INTERRUPTED');state.last=now;return now;
    } catch {controller.abort();throw new OpsError('INTERRUPTED');}
  };
  state.stop=(abort=false)=>{state.closed=true;if(state.timer!==null)clear(state.timer);deps.signal?.removeEventListener('abort',relay);if(abort)controller.abort();};
  const arm=()=>{
    if(state.closed)return;
    const now=state.check(),remaining=workflowLimitNs-(now-first);
    state.timer=schedule(()=>{try{if(!state.closed){state.check();arm();}}catch{/* Aborted signal drives owned cleanup. */}},Number((remaining+999999n)/1000000n));
    state.timer?.unref?.();
  };
  try{arm();return state;}catch(error){state.stop(true);throw error;}
}
const executionCheck=c=>{ensure(c.execution,'INTERRUPTED');return c.execution.check();};
export async function workflowSignalContext(token,deps={}) {
  const c=await owned(token,deps);executionCheck(c);return Object.freeze({signal:c.execution.controller.signal});
}

export async function beginWorkflow(inspection,request,deps={}) {
  let execution;
  try {
  const timing=request.purpose==='RESTORE_VERIFY_LOCAL'?claimWorkflowStart(request,deps):null;
  execution=executionState(deps,timing?.first.before);
  const details=inspectionDetails(inspection);
  ensure(request.purpose!=='RECOVER_ADMIN','ADAPTER_UNSEALED');
  const fresh=await inspectTarget(details.runRoot,deps,{apiState:details.apiState});ensure(same(fresh,inspection),'SOURCE_CHANGED');
  if(timing)try{advanceClock(timing);}catch{throw new OpsError('OBJECTIVE_UNKNOWN');}
  execution.check();
  const record=await reserveWorkflow(fresh,request,{...deps,originalApiState:details.apiState,
    ...(timing?{workflowStartedAt:new Date(timing.first.utc).toISOString()}: {})});
  const token=Object.freeze({});tokens.set(token,{record,deps,details,sequence:0,released:false,failed:false,timing,execution});
  if(timing)timing.owner=token;
  execution.check();await persistWorkflow(record,'BEGIN','PRECHECK',{},deps);
  await assertWorkflow(token,{side:'source',stage:'PRECHECK'},deps);
  execution.check();await persistWorkflow(record,'END','PRECHECK',{},deps);return token;
  }catch(error){execution?.stop(true);throw error;}
}
export async function assertWorkflow(token,{side='source',stage}={},deps={}) {
  const c=await owned(token,deps),l=c.record.lease;ensure(['source','target'].includes(side),'ADAPTER_UNSEALED');
  if(l.target)ensure(c.child&&l.target.runId===c.record.request.targetRunId);
  if(c.child){
    const stat=await directory(c.child.root),marker=join(c.child.root,'restore-target.json');
    ensure(stat.ino===c.child.identity.ino&&stat.dev===c.child.identity.dev);
    const markerStat=await lstat(marker);
    ensure(markerStat.ino===c.child.markerIdentity.ino&&markerStat.dev===c.child.markerIdentity.dev
      &&same(await read(marker,true),c.child.marker));
  }
  if(stage!==undefined)ensure(l.phase===stage);
  const apiState=l.phase==='PRECHECK'?l.originalApiState:l.phase==='COMPLETE'&&l.completionPolicy==='RESTORE_ORIGINAL'?l.originalApiState:'stopped';
  const inspection=await inspectTarget(c.record.root,deps,{apiState,workflow:token});
  ensure(same(inspection.target,l.source)&&same({jdbcUrl:inspection.jdbcUrl,dataGateway:inspection.dataGateway},l.sourceConnection),'SOURCE_CHANGED');
  if(apiState==='stopped')await noWriters(inspection,deps,l.helper?.side==='source'?l.helper:null,l.operationId,c.helper);
  let selected=inspection,selectedRoot=c.record.root,connection=l.sourceConnection;
  if(l.target?.identity) {
    const child=await inspectTarget(c.child.root,deps,{apiState:c.lifecycle?.api??'stopped',workflow:token});
    ensure(same(child.target,l.target.identity)&&same({jdbcUrl:child.jdbcUrl,dataGateway:child.dataGateway},l.target.connection));
    await noWriters(child,deps,l.helper?.side==='target'?l.helper:null,l.operationId,c.helper,
      c.lifecycle?.api==='running'?inspectionDetails(child).apiDataAddress:null);
    if(side==='target'){selected=child;selectedRoot=c.child.root;connection=l.target.connection;}
  }else ensure(side==='source','ADAPTER_UNSEALED');
  return Object.freeze({root:selectedRoot,connection:structuredClone(connection),base:c.record.base,lease:structuredClone(l),request:structuredClone(c.record.request),inspection:selected,
    nodeBinary:inspectionDetails(inspection).nodeBinary,helperSequence:c.sequence,
    helperRoot:c.sequence?join(c.record.base,'operations',l.operationId,'helper',String(c.sequence)):null,
    seq:String(c.sequence),operationId:l.operationId,target:selected.target,runRoot:selectedRoot,
    cwd:deps.cwd??process.cwd(),uid:c.record.identity.uid,gid:c.record.identity.gid});
}
export async function beginPhase(token,phase,patch={},deps={}) {
  const c=await owned(token,deps);executionCheck(c);ensure(Object.keys(patch).length===0);
  if(c.record.lease.purpose==='RESTORE_VERIFY_LOCAL') {
    if(WORKFLOW_PHASES.RESTORE_VERIFY_LOCAL.indexOf(phase)>=10)await lifecycleGate(token,c,phase,false,deps);
    if(WORKFLOW_PHASES.RESTORE_VERIFY_LOCAL.indexOf(phase)>=5)ensure(c.record.lease.target?.creationPhase==='BLANK_VERIFIED','ADAPTER_UNSEALED');
  }
  await assertWorkflow(token,{},deps);
  let changes=patch;
  if(c.record.lease.purpose==='RECOVER_ADMIN') {
    ensure(!['ACCOUNT_BOUND','ACCOUNT_COMMITTED','COMPLETE'].includes(phase),'ADAPTER_UNSEALED');
    if(phase==='PROOF_REVALIDATED')changes={proof:(await recoverCandidate(c,token,deps)).proof};
    if(phase==='ACCOUNT_PRE_CONNECTION') {
      const verifier=deps.revalidatedRecoveryContext??(await import('../ops/local-recovery-verify.mjs')).revalidatedRecoveryContext;
      ensure(typeof verifier==='function'&&same((await verifier(token,deps)).proof,c.record.lease.proof),'ADAPTER_UNSEALED');
      changes={account:{operation:'RECOVER_ADMIN',phase:'PRE_CONNECTION',boundBackend:null}};
    }
  }
  executionCheck(c);await persistWorkflow(c.record,'BEGIN',phase,changes,deps);
  if(phase==='SOURCE_QUIESCED') {
    executionCheck(c);if(c.record.lease.originalApiState==='running')await docker(deps,['stop','--time','30',c.record.lease.source.containerIds['cms-api']]);
    await assertWorkflow(token,{stage:phase},deps);
  }
  return structuredClone(c.record.lease);
}
export async function endPhase(token,patch={},deps={}) {
  const c=await owned(token,deps);executionCheck(c);ensure(Object.keys(patch).length===0&&!c.reservation&&!c.helper);await assertWorkflow(token,{},deps);
  if(c.record.lease.purpose==='RECOVER_ADMIN'&&c.record.lease.phase==='PROOF_REVALIDATED') {
    const verify=deps.revalidatedRecoveryContext??(await import('../ops/local-recovery-verify.mjs')).revalidatedRecoveryContext;
    ensure(typeof verify==='function'&&same((await verify(token,deps)).proof,c.record.lease.proof),'ADAPTER_UNSEALED');
  }
  if(c.record.lease.purpose==='RESTORE_VERIFY_LOCAL'&&WORKFLOW_PHASES.RESTORE_VERIFY_LOCAL.indexOf(c.record.lease.phase)>=10) {
    const gate=await lifecycleGate(token,c,c.record.lease.phase,true,deps);
    if(c.record.lease.phase==='RESTART_VERIFIED') {
      ensure(gate.finalProof,'ADAPTER_UNSEALED');executionCheck(c);await updatePendingWorkflow(c.record,{proof:gate.finalProof},deps);
    }
  }
  executionCheck(c);await persistWorkflow(c.record,'END',c.record.lease.phase,patch,deps);return structuredClone(c.record.lease);
}
export async function failWorkflow(token,code,deps={}) {
  const c=tokens.get(token);ensure(c&&!c.released);const failure=new OpsError(code,c.record.lease.phase,c.record.lease.operationId);
  if(c.failed)return c.failure;
  try {
    await owned(token,deps);
    if(c.child&&c.lifecycle)for(const [key,service]of [['ingress','ingress'],['api','cms-api']]) {
      if(c.lifecycle[key]!=='stopped')try{await stopOwnedTargetService(c,key,service,deps);}catch{/* Unknown lifecycle is retained; attempt the other owned service too. */}
    }
    if(c.record.journal.records.at(-1)?.event==='BEGIN')await persistWorkflow(c.record,'FAIL',c.record.lease.phase,{failureCode:failure.code},deps);
  }catch{/* Primary failure and lock are retained even when evidence persistence fails. */}
  c.execution?.stop(true);c.failed=true;c.failure=failure;return failure;
}
export async function finishWorkflow(token,outcome,deps={}) {
  const c=await owned(token,deps),l=c.record.lease;executionCheck(c);
  const restoring=l.purpose==='RESTORE_VERIFY_LOCAL';
  ensure(l.purpose==='BACKUP_LOCAL'||restoring||l.purpose==='RECOVER_ADMIN'&&l.phase==='ACCOUNT_COMMITTED'
    &&l.account?.phase==='COMMITTED'&&l.proof!==null,'ADAPTER_UNSEALED');
  if(restoring)ensure(l.proof!==null&&same(l.proof,await finalRestoreGate(token,c,deps)),'ADAPTER_UNSEALED');
  ensure(outcome?.success===true&&Object.keys(outcome).length===1&&l.helper===null);
  const phases=WORKFLOW_PHASES[l.purpose];ensure(l.phase===phases.at(-2)&&c.record.journal.records.at(-1)?.event==='END');
  await assertWorkflow(token,{},deps);executionCheck(c);await persistWorkflow(c.record,'BEGIN','COMPLETE',{},deps);
  let started=false;
  try {
    if(l.completionPolicy==='RESTORE_ORIGINAL'&&l.originalApiState==='running') {
      executionCheck(c);started=true;await docker(deps,['start',l.source.containerIds['cms-api']],c.execution.controller.signal);
      const clock=deps.clock??Date.now,deadline=clock()+120000;
      while((await docker(deps,['inspect','--format','{{.State.Health.Status}}',l.source.containerIds['cms-api']],c.execution.controller.signal)).trim()!=='healthy') {
        executionCheck(c);ensure(clock()<deadline,'LOCAL_VERIFY_FAILED');await new Promise(resolve=>setTimeout(resolve,250));
      }
    }
    await assertWorkflow(token,{stage:'COMPLETE'},deps);
    if(restoring)ensure(same(c.record.lease.proof,await finalRestoreGate(token,c,deps)),'ADAPTER_UNSEALED');
    executionCheck(c);await persistWorkflow(c.record,'END','COMPLETE',{},deps);executionCheck(c);
    await releaseWorkflow(c.record,deps);c.released=true;executionCheck(c);c.execution.stop();
    return structuredClone(c.record.lease);
  }catch(error){
    const primary=c.execution.controller.signal.aborted?(c.released?new OpsError('INTERRUPTED','COMPLETE',l.operationId):new OpsError('INTERRUPTED')):error;
    if(started&&!c.released&&c.record.identity)try{
      const lock=await directory(join(c.record.base,'operation.lock'));
      if(lock.ino===c.record.identity.ino&&lock.dev===c.record.identity.dev)
        await docker(deps,['stop','--time','30',l.source.containerIds['cms-api']]);
    }catch{/* Absent, replaced or unreadable lock cannot authorize source cleanup. */}
    if(c.released)c.execution?.stop(true);
    if(!c.released)await failWorkflow(token,primary instanceof OpsError?primary.code:'LOCAL_VERIFY_FAILED',deps);throw primary;
  }
}
async function privateDir(path,exclusive=false) {
  try{await mkdir(path,{mode:0o700});}catch(e){if(exclusive||e.code!=='EEXIST')throw e;}
  return directory(path);
}
export async function reserveRestoreTarget(token,{runId},deps={}) {
  const c=await owned(token,deps),l=c.record.lease;executionCheck(c);await assertWorkflow(token,{},deps);
  ensure(l.purpose==='RESTORE_VERIFY_LOCAL'&&l.phase==='LOCAL_VERIFIED'&&l.target===null&&!c.child
    &&runId===c.record.request.targetRunId,'TARGET_NOT_BLANK');
  executionCheck(c);const root=join(deps.cwd??process.cwd(),'local/pp1',runId),identity=await privateDir(root,true);
  const target={version:1,runId,targetId:`pp1-local:${runId}`,project:`cms-pp1-local-${runId}`,sourceOperationId:l.operationId,
    creationPhase:'RESERVED',identity:null,connection:null,preparationSha256:null,createdResourceSetSha256:null};
  const handle=await open(join(root,'restore-target.json'),'wx',0o600);
  let markerIdentity;
  try{await handle.writeFile(canonicalBytes(target));await handle.sync();markerIdentity=await handle.stat();}finally{await handle.close();}
  await syncDirectory(root);await syncDirectory(join(root,'..'));c.child={root,identity,markerIdentity,marker:structuredClone(target)};
  executionCheck(c);await persistWorkflow(c.record,'BEGIN','TARGET_RESERVED',{target},deps);
  return Object.freeze({root,target:structuredClone(target)});
}
export async function restoreTargetContext(token,deps={}) {
  const c=await owned(token,deps);executionCheck(c);await assertWorkflow(token,{},deps);
  ensure(c.child&&c.record.lease.purpose==='RESTORE_VERIFY_LOCAL'&&c.record.lease.phase==='TARGET_RESERVED'
    &&c.record.lease.target.creationPhase==='RESERVED','TARGET_NOT_BLANK');
  return Object.freeze({root:c.child.root,target:structuredClone(c.record.lease.target),source:structuredClone(c.record.lease.source),
    sourceRoot:c.record.root,nodeBinary:c.details.nodeBinary,receipt:await read(join(c.record.root,'receipt.json')),
    artifacts:await read(join(c.record.root,'artifacts.json'))});
}
export async function reserveHelper(token,{side,kind},deps={}) {
  const c=await owned(token,deps);executionCheck(c);ensure(!c.helper&&!c.reservation&&c.record.lease.helper===null);
  ensure(c.record.journal.records.at(-1)?.event==='BEGIN','JOURNAL_INCOMPLETE');
  const context=await assertWorkflow(token,{side},deps);executionCheck(c);
  if(context.lease.purpose==='RECOVER_ADMIN')ensure(side==='source'&&kind==='INVENTORY'
    &&context.lease.phase==='PROOF_REVALIDATED','ADAPTER_UNSEALED');
  const allowed={PG_RESTORE:['DB_RESTORED'],MEDIA_RESTORE:['MEDIA_RESTORED'],INVENTORY:['RAW_VERIFIED','SESSIONS_REVOKED','STARTUP_VERIFIED','TARGET_STOPPED','RESTART_VERIFIED'],REVOKE_SESSIONS:['SESSIONS_REVOKED'],BROWSER:['INGRESS_STARTED','BROWSER_VERIFIED']};
  ensure(side==='source'?['INVENTORY','PG_DUMP','MEDIA_PACK'].includes(kind)&&(['SOURCE_QUIESCED','LOCAL_CAPTURED','LOCAL_VERIFIED'].includes(context.lease.phase)||kind==='INVENTORY'&&['RAW_VERIFIED','RESTART_VERIFIED','PROOF_REVALIDATED'].includes(context.lease.phase)):
    context.lease.target?.creationPhase==='BLANK_VERIFIED'&&allowed[kind]?.includes(context.lease.phase),'ADAPTER_UNSEALED');
  if(kind==='BROWSER')ensure(c.lifecycle?.api==='running'&&c.lifecycle.healthy&&c.lifecycle.ingress==='running','ADAPTER_UNSEALED');
  if(kind==='INVENTORY'&&side==='target')ensure((c.lifecycle?.api??'stopped')==='stopped'
    &&(c.lifecycle?.ingress??'stopped')==='stopped','WRITER_NOT_QUIESCED');
  if(kind==='INVENTORY'&&side==='source'&&context.lease.phase==='RESTART_VERIFIED')
    ensure((await restoreGate(token,deps))?.verifiedThrough==='RESTART_VERIFIED','ADAPTER_UNSEALED');
  ensure(context.lease.phase!=='PRECHECK'&&context.lease.phase!=='COMPLETE');
  const parent=join(c.record.base,'operations',context.operationId);
  await privateDir(parent);await privateDir(join(parent,'helper'));c.sequence++;
  const helperRoot=join(parent,'helper',String(c.sequence));await privateDir(helperRoot,true);await syncDirectory(join(parent,'helper'));
  c.reservation={side,kind};return Object.freeze({...context,side,kind,seq:String(c.sequence),helperSequence:c.sequence,helperRoot});
}
async function helperSnapshot(c,helper,policy,expected,deps,liveWitness=false) {
  const {assertHelperPolicy}=await import('./maintenance-helper.mjs');
  const values=JSON.parse(await docker(deps,['inspect',helper.fullContainerId]));ensure(values.length===1);
  let state={CREATED:'created',RUNNING:'running',READY:'running',PERMITTED:'running',EXITED:'exited'}[helper.state];
  if(liveWitness){state=values[0].State?.Status;ensure(['running','exited'].includes(state));if(state==='exited')ensure(values[0].State.ExitCode===0);}
  return assertHelperPolicy(values[0],policy,{...expected,state});
}
export async function registerOwnedHelper(token,helper,policy,expected,deps={}) {
  const c=await owned(token,deps),r=c.reservation,l=c.record.lease;
  ensure(r&&!c.helper&&l.helper===null&&helper.kind===r.kind&&helper.side===r.side&&helper.state==='CREATED');
  ensure(helper.policySha256===sha256(canonicalBytes(policy))&&helper.fullContainerId===expected.fullContainerId);
  const registrationActive=()=>{if(r.kind==='BROWSER'){executionCheck(c);ensure(!deps.signal?.aborted,'INTERRUPTED');}};
  registrationActive();
  const {buildHelperPolicy,verifiedHelperProfile}=await import('./maintenance-helper.mjs');
  const images=JSON.parse(await docker(deps,['image','inspect',policy.imageId]));ensure(images.length===1);
  const image=images[0],helperRoot=join(c.record.base,'operations',l.operationId,'helper',String(c.sequence));
  const target=r.side==='target'?l.target.identity:l.source,runRoot=r.side==='target'?c.child.root:c.record.root;
  if(r.kind==='MEDIA_RESTORE')ensure(typeof verifiedHelperProfile==='function','ADAPTER_UNSEALED');
  const mediaUser=r.kind==='MEDIA_RESTORE'?(await verifiedHelperProfile(token,deps)).mediaUser:undefined;
  let browser;
  if(r.kind==='BROWSER') {
    registrationActive();ensure(!c.browserRegistration,'ADAPTER_UNSEALED');
    c.browserRegistration={token,reservation:r,sequence:c.sequence,operationId:l.operationId,phase:l.phase,
      fullContainerId:helper.fullContainerId,policySha256:helper.policySha256,targetSha256:sha256(canonicalBytes(target)),
      lock:{dev:c.record.identity.dev,ino:c.record.identity.ino}};
    try{browser=await(await import('../ops/local-restore-smoke.mjs')).browserRegistrationMaterial(token,deps);}
    finally{c.browserRegistration=null;}
    registrationActive();
  }
  const generated=buildHelperPolicy({browser,kind:r.kind,side:r.side,target,image,helperRoot,runRoot,mediaUser,
    cwd:deps.cwd??process.cwd(),nodeBinary:c.details.nodeBinary,uid:c.record.identity.uid,gid:c.record.identity.gid,
    operationId:l.operationId,seq:String(c.sequence)});
  ensure(same(generated,policy),'ADAPTER_UNSEALED');
  const labels={...(image.Config.Labels??{}),'org.cms.pp1c.operation':l.operationId,'org.cms.pp1c.seq':String(c.sequence),
    'org.cms.pp1c.kind':r.kind,'org.cms.pp1c.policy':helper.policySha256};
  ensure(expected.name===`cms-pp1c-${l.operationId}-${c.sequence}`&&same(expected.labels,labels));
  if(policy.networkId)ensure(r.kind==='BROWSER'?expected.webNetworkName===`${target.project}_web`
    &&policy.networkId===target.networkIds.web:expected.dataNetworkName===`${target.project}_data`);
  else {
    const networks=JSON.parse(await docker(deps,['network','inspect','none']));
    ensure(Array.isArray(networks)&&networks.length===1);
    const network=networks[0];
    ensure(/^[a-f0-9]{64}$/.test(network.Id)&&network.Id===expected.noneNetworkId
      &&network.Name==='none'&&network.Driver==='null'&&network.Scope==='local');
  }
  for(const mount of policy.mounts.filter(m=>m.type==='volume')) {
    const volumes=JSON.parse(await docker(deps,['volume','inspect',mount.source]));
    ensure(volumes.length===1&&volumes[0].Name===mount.source&&expected.volumeMountpoints[mount.source]===volumes[0].Mountpoint);
  }
  registrationActive();await helperSnapshot(c,helper,policy,expected,deps);registrationActive();
  // Register only after exact fresh helper inspection; a subsequent source failure retains this evidence.
  c.helper={policy:structuredClone(policy),expected:structuredClone(expected)};
  await updatePendingWorkflow(c.record,{helper:structuredClone(helper)},deps);
  await assertWorkflow(token,{},deps);registrationActive();return structuredClone(helper);
}
export async function updateOwnedHelper(token,helper,deps={},liveWitness=null) {
  const c=await owned(token,deps),old=c.record.lease.helper;ensure(c.helper&&old);
  ensure(['kind','side','fullContainerId','policySha256','startedAt'].every(k=>helper[k]===old[k]));
  const next={CREATED:['RUNNING','EXITED'],RUNNING:['READY','EXITED'],READY:['PERMITTED','EXITED'],PERMITTED:['EXITED'],EXITED:[]};
  const firstPgPin=old.kind.startsWith('PG_')&&old.state==='RUNNING'&&helper.state==='RUNNING'&&old.backend===null&&helper.backend!==null;
  ensure(next[old.state].includes(helper.state)||firstPgPin);
  if(old.backend!==null)ensure(same(old.backend,helper.backend));
  if(old.endpoint!==null)ensure(same(old.endpoint,helper.endpoint));
  if(liveWitness) {
    ensure(old.state==='CREATED'&&old.kind.startsWith('PG_')&&helper.state==='RUNNING');
    const {claimPgLiveWitness}=await import('./maintenance-helper.mjs');
    const witness=claimPgLiveWitness(liveWitness,token,c.sequence,helper,c.helper.policy);
    c.helper.draining=true;c.helper.samplePgRaw=witness.sampleRaw;
  }
  const snapshot=await helperSnapshot(c,helper,c.helper.policy,c.helper.expected,deps,!!liveWitness);
  if(old.state==='CREATED'&&helper.state==='EXITED')ensure(helper.endpoint===null&&helper.backend===null);
  if(helper.state==='RUNNING'&&c.helper.policy.networkId&&snapshot.State.Status==='running') {
    const endpoint=Object.values(snapshot.NetworkSettings.Networks)[0];
    ensure(helper.endpoint?.networkId===endpoint.NetworkID&&helper.endpoint?.address===endpoint.IPAddress);
  }
  await updatePendingWorkflow(c.record,{helper:structuredClone(helper)},deps);await assertWorkflow(token,{},deps);
}
export async function clearOwnedHelper(token,deps={}) {
  const c=await owned(token,deps),h=c.record.lease.helper;ensure(c.helper&&h);
  const env={...(deps.environment??process.env)};
  ensure(!env.DOCKER_HOST||env.DOCKER_HOST==='unix:///var/run/docker.sock');
  ensure(!env.DOCKER_CONTEXT||env.DOCKER_CONTEXT==='default');ensure(!env.DOCKER_TLS_VERIFY);
  for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[k];
  let result;try{result=await(deps.command??execute)('docker',['--host','unix:///var/run/docker.sock','inspect',h.fullContainerId],
    {env,shell:false,timeout:30000,maxBuffer:1048576});}catch(error){result=error;}
  ensure(result.code===1&&[`Error: No such object: ${h.fullContainerId}`,`error: no such object: ${h.fullContainerId}`,`Error response from daemon: No such container: ${h.fullContainerId}`].includes(String(result.stderr??'').trim()));
  await updatePendingWorkflow(c.record,{helper:null},deps);c.helper=null;c.reservation=null;
  await assertWorkflow(token,{},deps);
}
// Called only by the target inspector; possession of a JSON lookalike grants nothing.
export async function workflowInspectionContext(token,root,deps) {
  const c=await owned(token,deps),restore=root===c.child?.root;ensure(root===c.record.root||restore);
  if(restore){const stat=await directory(root),marker=await lstat(join(root,'restore-target.json'));
    ensure(stat.ino===c.child.identity.ino&&stat.dev===c.child.identity.dev&&marker.ino===c.child.markerIdentity.ino
      &&marker.dev===c.child.markerIdentity.dev&&same(await read(join(root,'restore-target.json'),true),c.child.marker));}
  const helper=c.helper&&c.record.lease.helper.side===(restore?'target':'source');
  return restore||helper?{restoreRoot:restore?root:null,...(restore?{apiState:c.lifecycle?.api??'stopped',
    ingressState:c.lifecycle?.ingress??'stopped',apiHealthy:c.lifecycle?.healthy===true}:{}),...(helper?{helper:structuredClone(c.record.lease.helper),policy:structuredClone(c.helper.policy),
    expected:structuredClone(c.helper.expected),allowExited:c.helper.draining===true}:{})}:null;
}

// Completion inspection is bound to the existing helper and in-memory token.
export async function assertHelperDrain(token,deps={}) {
  const c=await owned(token,deps),h=c.record.lease.helper;
  const media=['MEDIA_PACK','MEDIA_RESTORE'].includes(h?.kind);
  ensure(c.helper&&h&&(h.backend!==null||media)&&
    (h.state==='PERMITTED'||(h.kind.startsWith('PG_')||media)&&h.state==='RUNNING'||h.state==='EXITED'));
  c.helper.draining=true;
  const values=JSON.parse(await docker(deps,['inspect',h.fullContainerId]));ensure(values.length===1);
  const snapshot=values[0],state=snapshot.State?.Status;ensure(['running','exited'].includes(state));
  const {assertHelperPolicy}=await import('./maintenance-helper.mjs');
  assertHelperPolicy(snapshot,c.helper.policy,{...c.helper.expected,state});
  if(state==='exited')ensure(snapshot.State.ExitCode===0);
  await assertWorkflow(token,{},deps);
  if(state==='exited'&&h.state!=='EXITED') {
    ensure(media||c.helper.backendEnded,'WRITER_NOT_QUIESCED');
    await updatePendingWorkflow(c.record,{helper:{...h,state:'EXITED'}},deps);
  }
  const current=await assertWorkflow(token,{side:h.side},deps);
  return Object.freeze({...current,helperBackendEnded:c.helper.backendEnded===true});
}

export async function sealRestoreTarget(token,inspection,hashes,deps={}) {
  const c=await owned(token,deps);executionCheck(c);await restoreTargetContext(token,deps);
  ensure(inspectionDetails(inspection).runRoot===c.child.root);
  const fresh=await inspectTarget(c.child.root,deps,{apiState:'stopped',workflow:token});ensure(same(fresh,inspection));
  const preparation={receipt:await read(join(c.child.root,'receipt.json')),artifacts:await read(join(c.child.root,'artifacts.json'))};
  const resources={containerIds:fresh.target.containerIds,networkIds:fresh.target.networkIds,volumeNames:fresh.target.volumeNames};
  ensure(Object.keys(hashes).sort().join(',')==='createdResourceSetSha256,preparationSha256'
    &&hashes.preparationSha256===sha256(canonicalBytes(preparation))&&hashes.createdResourceSetSha256===sha256(canonicalBytes(resources)));
  ensure(same(fresh.target.images,c.record.lease.source.images)&&same(fresh.target.apiBuild,c.record.lease.source.apiBuild));
  const marker=async value=>{
    executionCheck(c);
    const temp=join(c.child.root,'restore-target.next'),file=await open(temp,'wx',0o600);
    try{await file.writeFile(canonicalBytes(value));await file.sync();}finally{await file.close();}
    await rename(temp,join(c.child.root,'restore-target.json'));await syncDirectory(c.child.root);
    c.child.marker=structuredClone(value);c.child.markerIdentity=await lstat(join(c.child.root,'restore-target.json'));
    await updatePendingWorkflow(c.record,{target:value},deps);
  };
  const target={...c.record.lease.target,creationPhase:'CREATED',identity:fresh.target,
    connection:{jdbcUrl:fresh.jdbcUrl,dataGateway:fresh.dataGateway},...hashes};
  await marker(target);await assertWorkflow(token,{},deps);
  const blank="SELECT count(*)::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' OR c.relname='flyway_schema_history';";
  ensure((await docker(deps,['exec',fresh.target.containerIds.postgres,'psql','-X','-q','-t','-A','-U','cms_local','-d','cms','-c',blank])).trim()==='0','TARGET_NOT_BLANK');
  const probe=mediaProbeCommand(fresh,c.record.lease.operationId),result=await(deps.command??execute)(probe.file,probe.args,probe.options);
  ensure((result.code===undefined||result.code===0)&&result.stdout==='EMPTY\n','TARGET_NOT_BLANK');
  await assertWorkflow(token,{},deps);await marker({...target,creationPhase:'BLANK_VERIFIED'});
  await persistWorkflow(c.record,'END','TARGET_RESERVED',{},deps);
  await beginPhase(token,'TARGET_BLANK',{},deps);await endPhase(token,{},deps);
  return assertWorkflow(token,{side:'target'},deps);
}

async function restoreGate(token,deps) {
  const gate=deps.restoreLifecycleContext??(await import('../ops/local-recovery-verify.mjs')).restoreLifecycleContext;
  ensure(typeof gate==='function','ADAPTER_UNSEALED');return gate(token,deps);
}
async function lifecycleGate(token,c,phase,ending,deps) {
  const gate=await restoreGate(token,deps),states=c.lifecycle??{api:'stopped',ingress:'stopped',healthy:false};
  const required={STARTUP_VERIFIED:ending?'STARTUP_VERIFIED':'SESSIONS_REVOKED',API_HEALTHY:'STARTUP_VERIFIED',
    INGRESS_STARTED:'STARTUP_VERIFIED',BROWSER_VERIFIED:ending?'BROWSER_VERIFIED':'STARTUP_VERIFIED',
    TARGET_STOPPED:ending?'TARGET_STOPPED':'BROWSER_VERIFIED',RESTART_VERIFIED:ending?'RESTART_VERIFIED':'TARGET_STOPPED'}[phase];
  ensure(required&&gate?.verifiedThrough===required,'ADAPTER_UNSEALED');
  if(['API_HEALTHY','INGRESS_STARTED','BROWSER_VERIFIED'].includes(phase)&&(ending||phase!=='API_HEALTHY'))
    ensure(states.api==='running'&&states.healthy,'ADAPTER_UNSEALED');
  if(ending&&['INGRESS_STARTED','BROWSER_VERIFIED'].includes(phase))ensure(states.ingress==='running','ADAPTER_UNSEALED');
  if(ending&&['STARTUP_VERIFIED','TARGET_STOPPED','RESTART_VERIFIED'].includes(phase))
    ensure(states.api==='stopped'&&states.ingress==='stopped','ADAPTER_UNSEALED');
  return gate;
}
async function finalRestoreGate(token,c,deps) {
  ensure(!c.helper&&!c.reservation&&c.lifecycle?.api==='stopped'&&c.lifecycle?.ingress==='stopped','ADAPTER_UNSEALED');
  const gate=await restoreGate(token,deps);ensure(gate?.verifiedThrough==='RESTART_VERIFIED'&&gate.finalProof,'ADAPTER_UNSEALED');
  return gate.finalProof;
}
async function changeTargetService(token,service,running,deps) {
  const c=await owned(token,deps),l=c.record.lease;
  ensure(l.purpose==='RESTORE_VERIFY_LOCAL'&&l.target?.creationPhase==='BLANK_VERIFIED'&&!c.helper&&!c.reservation,'ADAPTER_UNSEALED');
  ensure(c.record.journal.records.at(-1)?.event==='BEGIN','JOURNAL_INCOMPLETE');
  c.lifecycle??={api:'stopped',ingress:'stopped',healthy:false};
  const state=c.lifecycle,key=service==='cms-api'?'api':'ingress';
  ensure(state[key]===(running?'stopped':'running'),'ADAPTER_UNSEALED');
  const phases=service==='cms-api'?(running?['STARTUP_VERIFIED','API_HEALTHY','RESTART_VERIFIED']:['STARTUP_VERIFIED','TARGET_STOPPED','RESTART_VERIFIED']):
    (running?['INGRESS_STARTED']:['TARGET_STOPPED']);
  ensure(phases.includes(l.phase),'ADAPTER_UNSEALED');
  if(running) {
    executionCheck(c);const required=service==='ingress'?'STARTUP_VERIFIED':{STARTUP_VERIFIED:'SESSIONS_REVOKED',API_HEALTHY:'STARTUP_VERIFIED',RESTART_VERIFIED:'TARGET_STOPPED'}[l.phase];
    ensure((await restoreGate(token,deps))?.verifiedThrough===required,'ADAPTER_UNSEALED');
    if(service==='ingress')ensure(state.api==='running'&&state.healthy,'ADAPTER_UNSEALED');
  } else if(service==='cms-api')ensure(state.ingress==='stopped','ADAPTER_UNSEALED');
  await assertWorkflow(token,{},deps);
  const id=l.target.identity.containerIds[service];
  state[key]='unknown';if(service==='cms-api')state.healthy=false;
  try {
    if(running)executionCheck(c);
    await docker(deps,running?['start',id]:['stop','--time','30',id],running?c.execution.controller.signal:undefined);state[key]=running?'running':'stopped';
    if(running&&service==='cms-api') {
      const clock=deps.clock??Date.now,deadline=clock()+120000;
      while((await docker(deps,['inspect','--format','{{.State.Health.Status}}',id],c.execution.controller.signal)).trim()!=='healthy') {
        executionCheck(c);ensure(clock()<deadline,'LOCAL_VERIFY_FAILED');await new Promise(resolve=>setTimeout(resolve,250));
      }
      executionCheck(c);ensure(clock()<=deadline,'LOCAL_VERIFY_FAILED');
      state.healthy=true;
    }
    const result=await assertWorkflow(token,{side:'target'},deps);if(running)executionCheck(c);return result;
  } catch(error) {
    const primary=running&&c.execution?.controller.signal.aborted?new OpsError('INTERRUPTED'):error;
    if(running)try{await stopOwnedTargetService(c,key,service,deps);}catch{/* Retain unknown state and the primary failure. */}
    throw primary;
  }
}
export const startTargetApi=(token,deps={})=>changeTargetService(token,'cms-api',true,deps);
export const stopTargetApi=(token,deps={})=>changeTargetService(token,'cms-api',false,deps);
export const startTargetIngress=(token,deps={})=>changeTargetService(token,'ingress',true,deps);
export const stopTargetIngress=(token,deps={})=>changeTargetService(token,'ingress',false,deps);

// Read-only material admission during the registrar's private interval. This does
// not permit any container in target/source inspection; full inspection follows binding.
export async function browserRegistrationContext(token,deps={}) {
  const c=await owned(token,deps),l=c.record.lease,a=c.browserRegistration;executionCheck(c);
  ensure(a?.token===token&&a.reservation===c.reservation&&a.sequence===c.sequence&&a.operationId===l.operationId
    &&a.phase===l.phase&&a.lock.dev===c.record.identity.dev&&a.lock.ino===c.record.identity.ino
    &&!c.helper&&l.helper===null&&c.reservation?.kind==='BROWSER'&&c.reservation.side==='target'
    &&l.purpose==='RESTORE_VERIFY_LOCAL'&&['INGRESS_STARTED','BROWSER_VERIFIED'].includes(l.phase)
    &&l.target?.creationPhase==='BLANK_VERIFIED'&&a.targetSha256===sha256(canonicalBytes(l.target.identity))
    &&c.lifecycle?.api==='running'&&c.lifecycle.healthy&&c.lifecycle.ingress==='running','ADAPTER_UNSEALED');
  await workflowInspectionContext(token,c.child.root,deps);executionCheck(c);
  ensure(c.record.lease===l&&c.browserRegistration===a&&c.reservation===a.reservation,'ADAPTER_UNSEALED');
  return Object.freeze({operationId:l.operationId,seq:String(c.sequence),target:structuredClone(l.target.identity),
    helperRoot:join(c.record.base,'operations',l.operationId,'helper',String(c.sequence)),root:c.child.root,
    fullContainerId:a.fullContainerId,policySha256:a.policySha256});
}
export async function browserHelperContext(token,deps={}) {
  const c=await owned(token,deps),l=c.record.lease;
  ensure(l.purpose==='RESTORE_VERIFY_LOCAL'&&['INGRESS_STARTED','BROWSER_VERIFIED'].includes(l.phase)
    &&c.reservation?.kind==='BROWSER'&&c.reservation.side==='target'
    &&(!l.helper||l.helper.kind==='BROWSER'&&l.helper.side==='target'),'ADAPTER_UNSEALED');
  ensure(c.lifecycle?.api==='running'&&c.lifecycle.healthy&&c.lifecycle.ingress==='running','ADAPTER_UNSEALED');
  const context=await assertWorkflow(token,{side:'target'},deps),details=inspectionDetails(context.inspection);
  ensure(typeof details.ingressWebAddress==='string'&&details.ingressWebAddress.length>0,'ADAPTER_UNSEALED');
  return Object.freeze({...context,side:'target',kind:'BROWSER',webNetworkName:`${context.target.project}_web`,
    ingressWebAddress:details.ingressWebAddress});
}

async function recoverCandidate(c,token,deps) {
  const verify=deps.recoveryCandidateContext??(await import('../ops/local-recovery-verify.mjs')).recoveryCandidateContext;
  ensure(typeof verify==='function'&&c.recoveryCandidate,'ADAPTER_UNSEALED');
  const inspection=await inspectTarget(c.record.root,deps,{apiState:'stopped'});
  return verify(c.recoveryCandidate,inspection,deps);
}
export async function attachRecovery(inspection,{operationId},deps={}) {
  let token,execution;
  try {
    execution=executionState(deps);
    const preflight=deps.preflightRecovery??(await import('../ops/local-recovery-verify.mjs')).preflightRecovery;
    ensure(typeof preflight==='function','ADAPTER_UNSEALED');const candidate=await preflight(inspection,deps);
    const verify=deps.recoveryCandidateContext??(await import('../ops/local-recovery-verify.mjs')).recoveryCandidateContext;
    ensure(typeof verify==='function','ADAPTER_UNSEALED');await verify(candidate,inspection,deps);
    const details=inspectionDetails(inspection);ensure(details.apiState==='stopped','WRITER_NOT_QUIESCED');
    const fresh=await inspectTarget(details.runRoot,deps,{apiState:'stopped'});ensure(same(fresh,inspection),'SOURCE_CHANGED');
    const request={operationId,purpose:'RECOVER_ADMIN',completionPolicy:'KEEP_STOPPED',targetRunId:null,incidentStartedAt:null};
    execution.check();const record=await reserveWorkflow(fresh,request,{...deps,originalApiState:'stopped'});
    token=Object.freeze({});tokens.set(token,{record,deps,details,sequence:0,released:false,failed:false,recoveryCandidate:candidate,execution});
    await persistWorkflow(record,'BEGIN','PRECHECK',{},deps);await assertWorkflow(token,{},deps);await persistWorkflow(record,'END','PRECHECK',{},deps);
    await beginPhase(token,'SOURCE_QUIESCED',{},deps);await endPhase(token,{},deps);
    await beginPhase(token,'PROOF_REVALIDATED',{},deps);
    const helper=deps.runOwnedHelper??(await import('./maintenance-helper.mjs')).runOwnedHelper;
    const inventory=await helper(token,{side:'source',kind:'INVENTORY'},deps);
    const verifyProof=deps.verifyRecoveryProof??(await import('../ops/local-recovery-verify.mjs')).verifyRecoveryProof;
    ensure(typeof verifyProof==='function','ADAPTER_UNSEALED');await verifyProof(token,{candidate,inventory},deps);
    await endPhase(token,{},deps);await beginPhase(token,'ACCOUNT_PRE_CONNECTION',{},deps);return token;
  } catch(error) {
    if(token)try{await failWorkflow(token,error instanceof OpsError?error.code:'LOCAL_VERIFY_FAILED',deps);}catch{}
    else execution?.stop(true);throw error;
  }
}
export async function finishRecoverWorkflow(token,outcome,deps={}) {
  const c=tokens.get(token);ensure(c&&!c.failed&&!c.released&&c.record.lease.purpose==='RECOVER_ADMIN','ADAPTER_UNSEALED');
  try {
    ensure(outcome&&Object.keys(outcome).sort().join(',')==='exitCode,spawnFailure'&&Number.isInteger(outcome.exitCode)
      &&typeof outcome.spawnFailure==='boolean','INPUT_INVALID');
    const previous=c.record,current=await loadWorkflow(previous.lease.source.runId,deps,{allowPending:true});
    ensure(current.identity?.ino===previous.identity.ino&&current.identity?.dev===previous.identity.dev
      &&previous.lease.phase==='ACCOUNT_PRE_CONNECTION'&&current.lease.phase==='ACCOUNT_BOUND'
      &&same(current.lease,{...previous.lease,phase:'ACCOUNT_BOUND',account:current.lease.account})
      &&current.lease.account?.phase==='BOUND'&&current.lease.account.boundBackend!==null,'JOURNAL_INCOMPLETE');
    const prefix=previous.journal.records,records=current.journal.records;
    ensure(records.length===prefix.length+2&&same(records.slice(0,prefix.length),prefix),'JOURNAL_INCOMPLETE');
    const [end,begin]=records.slice(-2);
    ensure(end.event==='END'&&end.phase==='ACCOUNT_PRE_CONNECTION'&&end.leaseSha256===sha256(canonicalBytes(previous.lease))
      &&begin.event==='BEGIN'&&begin.phase==='ACCOUNT_BOUND'&&begin.leaseSha256===sha256(canonicalBytes(current.lease))
      &&end.proofSha256===current.lease.proof.proofSha256&&begin.proofSha256===current.lease.proof.proofSha256,'JOURNAL_INCOMPLETE');
    c.record=current;await assertWorkflow(token,{},deps);
    const result=await read(join(current.base,'operations',`${current.lease.operationId}.result.json`));
    ensure(result&&Object.keys(result).sort().join(',')==='completedAt,operation,operationId,principalId,releaseId,targetId'
      &&result.operationId===current.lease.operationId&&result.operation==='RECOVER_ADMIN'&&result.releaseId===current.lease.releaseId
      &&result.targetId===current.lease.source.targetId&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(result.principalId)
      &&typeof result.completedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(result.completedAt)
      &&Number.isFinite(Date.parse(result.completedAt))&&Date.parse(result.completedAt)>=Date.parse(current.lease.createdAt),'LOCAL_VERIFY_FAILED');
    await persistWorkflow(current,'END','ACCOUNT_BOUND',{},deps);
    await persistWorkflow(current,'BEGIN','ACCOUNT_COMMITTED',{account:{...current.lease.account,phase:'COMMITTED'}},deps);
    if(outcome.exitCode!==0||outcome.spawnFailure)throw new Error('COMMITTED_HOST_RESTORE_FAILED');
    executionCheck(c);
    await assertWorkflow(token,{},deps);await persistWorkflow(current,'END','ACCOUNT_COMMITTED',{},deps);
    return finishWorkflow(token,{success:true},deps);
  } catch(error) {
    try{await failWorkflow(token,error instanceof OpsError?error.code:'LOCAL_VERIFY_FAILED',deps);}catch{}
    throw error;
  }
}

async function stopOwnedTargetService(c,key,service,deps) {
  const id=c.record.lease.target.identity.containerIds[service];c.lifecycle[key]='unknown';
  if(key==='api')c.lifecycle.healthy=false;
  await docker(deps,['stop','--time','30',id]);
  const values=JSON.parse(await docker(deps,['inspect',id]));
  ensure(Array.isArray(values)&&values.length===1&&values[0].Id===id&&values[0].State?.Running===false
    &&['created','exited'].includes(values[0].State.Status),'TARGET_NOT_OWNED');
  c.lifecycle[key]='stopped';
}

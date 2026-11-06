import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir, open, lstat } from 'node:fs/promises';
import { inspectTarget, inspectionDetails } from './maintenance-target.mjs';
import { reserveWorkflow, loadWorkflow, persistWorkflow, releaseWorkflow, updatePendingWorkflow, WORKFLOW_PHASES, directory, syncDirectory, read } from './maintenance-store.mjs';
import { canonicalBytes, sha256, OpsError } from '../ops/recovery-protocol.mjs';
const tokens=new WeakMap(),execute=promisify(execFile);
const ensure=(value,code='TARGET_NOT_OWNED')=>{if(!value)throw new OpsError(code);};
const same=(a,b)=>canonicalBytes(a).equals(canonicalBytes(b));
const activitySql="SELECT COALESCE(json_agg(a), '[]'::json)::text FROM (SELECT pid, extract(epoch FROM backend_start)::text AS backend_start_epoch, usename, datname, application_name, host(client_addr) AS client_addr, state FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()) a;";
async function docker(deps,args) {
  const env={...(deps.environment??process.env)};
  ensure(!env.DOCKER_HOST||env.DOCKER_HOST==='unix:///var/run/docker.sock');
  ensure(!env.DOCKER_CONTEXT||env.DOCKER_CONTEXT==='default');ensure(!env.DOCKER_TLS_VERIFY);
  for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[k];
  const result=await(deps.command??execute)('docker',['--host','unix:///var/run/docker.sock',...args],
    {env,shell:false,timeout:30000,maxBuffer:16*1024*1024});
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
async function noWriters(inspection,deps,helper=null,operationId=null,completion=null) {
  const rows=JSON.parse(await docker(deps,['exec',inspection.target.containerIds.postgres,'psql','-X','-q','-t','-A','-U','cms_local','-d','cms','-c',activitySql]));
  ensure(Array.isArray(rows),'WRITER_NOT_QUIESCED');
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
export async function beginWorkflow(inspection,request,deps={}) {
  const details=inspectionDetails(inspection);
  ensure(request.purpose!=='RECOVER_ADMIN','ADAPTER_UNSEALED');
  const fresh=await inspectTarget(details.runRoot,deps,{apiState:details.apiState});ensure(same(fresh,inspection),'SOURCE_CHANGED');
  const record=await reserveWorkflow(fresh,request,{...deps,originalApiState:details.apiState});
  const token=Object.freeze({});tokens.set(token,{record,deps,details,sequence:0,released:false,failed:false});
  await persistWorkflow(record,'BEGIN','PRECHECK',{},deps);
  await assertWorkflow(token,{side:'source',stage:'PRECHECK'},deps);
  await persistWorkflow(record,'END','PRECHECK',{},deps);return token;
}
export async function assertWorkflow(token,{side='source',stage}={},deps={}) {
  const c=await owned(token,deps),l=c.record.lease;ensure(side==='source','ADAPTER_UNSEALED');
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
  if(apiState==='stopped')await noWriters(inspection,deps,l.helper,l.operationId,c.helper);
  return Object.freeze({root:c.record.root,base:c.record.base,lease:structuredClone(l),request:structuredClone(c.record.request),inspection,
    nodeBinary:inspectionDetails(inspection).nodeBinary,helperSequence:c.sequence,
    helperRoot:c.sequence?join(c.record.base,'operations',l.operationId,'helper',String(c.sequence)):null,
    seq:String(c.sequence),operationId:l.operationId,target:inspection.target,runRoot:c.record.root,
    cwd:deps.cwd??process.cwd(),uid:c.record.identity.uid,gid:c.record.identity.gid});
}
export async function beginPhase(token,phase,patch={},deps={}) {
  const c=await owned(token,deps);ensure(Object.keys(patch).length===0);
  if(c.record.lease.purpose==='RESTORE_VERIFY_LOCAL')ensure(WORKFLOW_PHASES.RESTORE_VERIFY_LOCAL.indexOf(phase)<4,'ADAPTER_UNSEALED');
  await assertWorkflow(token,{},deps);
  await persistWorkflow(c.record,'BEGIN',phase,patch,deps);
  if(phase==='SOURCE_QUIESCED') {
    if(c.record.lease.originalApiState==='running')await docker(deps,['stop','--time','30',c.record.lease.source.containerIds['cms-api']]);
    await assertWorkflow(token,{stage:phase},deps);
  }
  return structuredClone(c.record.lease);
}
export async function endPhase(token,patch={},deps={}) {
  const c=await owned(token,deps);ensure(Object.keys(patch).length===0&&!c.reservation&&!c.helper);await assertWorkflow(token,{},deps);
  await persistWorkflow(c.record,'END',c.record.lease.phase,patch,deps);return structuredClone(c.record.lease);
}
export async function failWorkflow(token,code,deps={}) {
  const c=tokens.get(token);ensure(c&&!c.released);const failure=new OpsError(code,c.record.lease.phase,c.record.lease.operationId);
  if(c.failed)return c.failure;
  try {
    await owned(token,deps);
    if(c.record.journal.records.at(-1)?.event==='BEGIN')await persistWorkflow(c.record,'FAIL',c.record.lease.phase,{failureCode:failure.code},deps);
  }catch{/* Primary failure and lock are retained even when evidence persistence fails. */}
  c.failed=true;c.failure=failure;return failure;
}
export async function finishWorkflow(token,outcome,deps={}) {
  const c=await owned(token,deps),l=c.record.lease;
  ensure(l.purpose==='BACKUP_LOCAL','ADAPTER_UNSEALED');
  ensure(outcome?.success===true&&Object.keys(outcome).length===1&&l.helper===null);
  const phases=WORKFLOW_PHASES[l.purpose];ensure(l.phase===phases.at(-2)&&c.record.journal.records.at(-1)?.event==='END');
  await assertWorkflow(token,{},deps);await persistWorkflow(c.record,'BEGIN','COMPLETE',{},deps);
  let started=false;
  try {
    if(l.completionPolicy==='RESTORE_ORIGINAL'&&l.originalApiState==='running') {
      started=true;await docker(deps,['start',l.source.containerIds['cms-api']]);
      const clock=deps.clock??Date.now,deadline=clock()+120000;
      while((await docker(deps,['inspect','--format','{{.State.Health.Status}}',l.source.containerIds['cms-api']])).trim()!=='healthy') {
        ensure(clock()<deadline,'LOCAL_VERIFY_FAILED');await new Promise(resolve=>setTimeout(resolve,250));
      }
    }
    await assertWorkflow(token,{stage:'COMPLETE'},deps);
    await persistWorkflow(c.record,'END','COMPLETE',{},deps);await releaseWorkflow(c.record,deps);c.released=true;
    return structuredClone(c.record.lease);
  }catch(error){
    if(started)try{await docker(deps,['stop','--time','30',l.source.containerIds['cms-api']]);}catch{}
    await failWorkflow(token,error instanceof OpsError?error.code:'LOCAL_VERIFY_FAILED',deps);throw error;
  }
}
async function privateDir(path,exclusive=false) {
  try{await mkdir(path,{mode:0o700});}catch(e){if(exclusive||e.code!=='EEXIST')throw e;}
  return directory(path);
}
export async function reserveRestoreTarget(token,{runId},deps={}) {
  const c=await owned(token,deps),l=c.record.lease;await assertWorkflow(token,{},deps);
  ensure(l.purpose==='RESTORE_VERIFY_LOCAL'&&l.phase==='LOCAL_VERIFIED'&&l.target===null&&!c.child
    &&runId===c.record.request.targetRunId,'TARGET_NOT_BLANK');
  const root=join(deps.cwd??process.cwd(),'local/pp1',runId),identity=await privateDir(root,true);
  const target={version:1,runId,targetId:`pp1-local:${runId}`,project:`cms-pp1-local-${runId}`,sourceOperationId:l.operationId,
    creationPhase:'RESERVED',identity:null,connection:null,preparationSha256:null,createdResourceSetSha256:null};
  const handle=await open(join(root,'restore-target.json'),'wx',0o600);
  let markerIdentity;
  try{await handle.writeFile(canonicalBytes(target));await handle.sync();markerIdentity=await handle.stat();}finally{await handle.close();}
  await syncDirectory(root);await syncDirectory(join(root,'..'));c.child={root,identity,markerIdentity,marker:structuredClone(target)};
  await persistWorkflow(c.record,'BEGIN','TARGET_RESERVED',{target},deps);
  await persistWorkflow(c.record,'END','TARGET_RESERVED',{},deps);return Object.freeze({root,target:structuredClone(target)});
}
export async function reserveHelper(token,{side,kind},deps={}) {
  const c=await owned(token,deps);ensure(!c.helper&&!c.reservation&&c.record.lease.helper===null);
  ensure(c.record.journal.records.at(-1)?.event==='BEGIN','JOURNAL_INCOMPLETE');
  const context=await assertWorkflow(token,{side},deps);
  ensure(side==='source'&&['INVENTORY','PG_DUMP','MEDIA_PACK'].includes(kind),'ADAPTER_UNSEALED');
  ensure(context.lease.phase!=='PRECHECK'&&context.lease.phase!=='COMPLETE');
  const parent=join(c.record.base,'operations',context.operationId);
  await privateDir(parent);await privateDir(join(parent,'helper'));c.sequence++;
  const helperRoot=join(parent,'helper',String(c.sequence));await privateDir(helperRoot,true);await syncDirectory(join(parent,'helper'));
  c.reservation={side,kind};return Object.freeze({...context,side,kind,seq:String(c.sequence),helperSequence:c.sequence,helperRoot});
}
async function helperSnapshot(c,helper,policy,expected,deps) {
  const {assertHelperPolicy}=await import('./maintenance-helper.mjs');
  const values=JSON.parse(await docker(deps,['inspect',helper.fullContainerId]));ensure(values.length===1);
  const state={CREATED:'created',RUNNING:'running',READY:'running',PERMITTED:'running',EXITED:'exited'}[helper.state];
  return assertHelperPolicy(values[0],policy,{...expected,state});
}
export async function registerOwnedHelper(token,helper,policy,expected,deps={}) {
  const c=await owned(token,deps),r=c.reservation,l=c.record.lease;
  ensure(r&&!c.helper&&l.helper===null&&helper.kind===r.kind&&helper.side===r.side&&helper.state==='CREATED');
  ensure(helper.policySha256===sha256(canonicalBytes(policy))&&helper.fullContainerId===expected.fullContainerId);
  const {buildHelperPolicy}=await import('./maintenance-helper.mjs');
  const images=JSON.parse(await docker(deps,['image','inspect',policy.imageId]));ensure(images.length===1);
  const image=images[0],helperRoot=join(c.record.base,'operations',l.operationId,'helper',String(c.sequence));
  const generated=buildHelperPolicy({kind:r.kind,side:r.side,target:l.source,image,helperRoot,runRoot:c.record.root,
    cwd:deps.cwd??process.cwd(),nodeBinary:c.details.nodeBinary,uid:c.record.identity.uid,gid:c.record.identity.gid,
    operationId:l.operationId,seq:String(c.sequence)});
  ensure(same(generated,policy),'ADAPTER_UNSEALED');
  const labels={...(image.Config.Labels??{}),'org.cms.pp1c.operation':l.operationId,'org.cms.pp1c.seq':String(c.sequence),
    'org.cms.pp1c.kind':r.kind,'org.cms.pp1c.policy':helper.policySha256};
  ensure(expected.name===`cms-pp1c-${l.operationId}-${c.sequence}`&&same(expected.labels,labels));
  if(policy.networkId)ensure(expected.dataNetworkName===`${l.source.project}_data`);
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
  await helperSnapshot(c,helper,policy,expected,deps);
  // Register only after exact fresh helper inspection; a subsequent source failure retains this evidence.
  c.helper={policy:structuredClone(policy),expected:structuredClone(expected)};
  await updatePendingWorkflow(c.record,{helper:structuredClone(helper)},deps);
  await assertWorkflow(token,{},deps);return structuredClone(helper);
}
export async function updateOwnedHelper(token,helper,deps={}) {
  const c=await owned(token,deps),old=c.record.lease.helper;ensure(c.helper&&old);
  ensure(['kind','side','fullContainerId','policySha256','startedAt'].every(k=>helper[k]===old[k]));
  const next={CREATED:['RUNNING','EXITED'],RUNNING:['READY','EXITED'],READY:['PERMITTED','EXITED'],PERMITTED:['EXITED'],EXITED:[]};
  const firstPgPin=old.kind.startsWith('PG_')&&old.state==='RUNNING'&&helper.state==='RUNNING'&&old.backend===null&&helper.backend!==null;
  ensure(next[old.state].includes(helper.state)||firstPgPin);
  if(old.backend!==null)ensure(same(old.backend,helper.backend));
  if(old.endpoint!==null)ensure(same(old.endpoint,helper.endpoint));
  const snapshot=await helperSnapshot(c,helper,c.helper.policy,c.helper.expected,deps);
  if(old.state==='CREATED'&&helper.state==='EXITED')ensure(helper.endpoint===null&&helper.backend===null);
  if(helper.state==='RUNNING'&&c.helper.policy.networkId) {
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
  const c=await owned(token,deps);ensure(root===c.record.root);
  return c.helper?{helper:structuredClone(c.record.lease.helper),policy:structuredClone(c.helper.policy),expected:structuredClone(c.helper.expected),allowExited:c.helper.draining===true}:null;
}

// Completion inspection is bound to the existing helper and in-memory token.
export async function assertHelperDrain(token,deps={}) {
  const c=await owned(token,deps),h=c.record.lease.helper;
  const media=h?.kind==='MEDIA_PACK';
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
  const current=await assertWorkflow(token,{},deps);
  return Object.freeze({...current,helperBackendEnded:c.helper.backendEnded===true});
}

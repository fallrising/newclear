import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as workflow from '../local/maintenance-workflow.mjs';
import * as targetModule from '../local/maintenance-target.mjs';
import { createRestoreTarget } from '../local/restore-target.mjs';
import { directory, syncDirectory, read as readPrivate } from '../local/maintenance-store.mjs';
import { runOwnedHelper } from '../local/maintenance-helper.mjs';
import { captureSource } from './local-bundle.mjs';
import * as verifier from './local-recovery-verify.mjs';
import { OpsError, canonicalBytes, sha256, parseStrictJson } from './recovery-protocol.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const runIdValid=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=value=>typeof value==='string'&&value.length>0&&!/[\u0000-\u001f\u007f]/u.test(value);
const ensure=(ok,code='INPUT_INVALID')=>{if(!ok)throw new OpsError(code);};
const exact=(value,keys)=>ensure(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(' ')===keys.split(' ').sort().join(' '));
const utc=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const mediaKeys='publicImageId publicPdfId draftImageId privateImageId replacedImageId deletedImageId';
const expectedKeys='privateEntrySha256 operatorEntrySha256 publicEntrySha256 revisionListSha256 publicOriginalSha256 publicThumbnailSha256 publicWebSha256 publicPdfSha256 draftOriginalSha256 privateOriginalSha256 replacedOriginalSha256';
function validateInput(input,secrets) {
  exact(input,'version sourceRunId adminPrincipalId operatorPrincipalId publishedEntryId revisionNo refEntryId media expected sessionAbsoluteSeconds sessionMaxSeconds');
  ensure(input.version===1&&runIdValid(input.sourceRunId)&&input.revisionNo===1);
  ensure(['adminPrincipalId','operatorPrincipalId','publishedEntryId','refEntryId'].every(k=>uuid(input[k])));
  ensure(input.adminPrincipalId!==input.operatorPrincipalId&&input.publishedEntryId!==input.refEntryId);
  exact(input.media,mediaKeys);ensure(Object.values(input.media).every(uuid)&&new Set(Object.values(input.media)).size===6);
  exact(input.expected,expectedKeys);ensure(Object.values(input.expected).every(hash));
  ensure(['sessionAbsoluteSeconds','sessionMaxSeconds'].every(k=>typeof input[k]==='string'&&/^[1-9][0-9]*$/.test(input[k])&&BigInt(input[k])<=BigInt(Number.MAX_SAFE_INTEGER)));
  validateRecoverySecrets(secrets);
  for(const role of ['admin','operator']) {
    ensure(secrets[role].principalId===input[role+'PrincipalId']);
  }
}
export function validateRestorePreflight(inspection,request,{recoverySecrets,smokeFixtureInput}={},now=new Date()) {
  try {
    exact(request,'operationId purpose completionPolicy targetRunId incidentStartedAt');
    ensure(uuid(request.operationId)&&request.purpose==='RESTORE_VERIFY_LOCAL'&&request.completionPolicy==='KEEP_STOPPED');
    ensure(runIdValid(request.targetRunId)&&runIdValid(inspection?.target?.runId)&&request.targetRunId!==inspection.target.runId);
    ensure(now instanceof Date&&Number.isFinite(now.getTime())&&utc(request.incidentStartedAt)&&Date.parse(request.incidentStartedAt)<=now.getTime());
    validateInput(smokeFixtureInput,recoverySecrets);ensure(smokeFixtureInput.sourceRunId===inspection.target.runId);
    return Object.freeze(structuredClone(smokeFixtureInput));
  }catch{throw new OpsError('INPUT_INVALID');}
}
function instant(value) {
  ensure(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value));
  const number=Date.parse(value);ensure(Number.isFinite(number));return number;
}
export function deriveSmokeFixture(input,secrets,inventory,now=new Date()) {
  try {
    validateInput(input,secrets);ensure(now instanceof Date&&Number.isFinite(now.getTime())&&Array.isArray(inventory?.tables));
    const rows=name=>{const tables=inventory.tables.filter(t=>t.tableName===name);ensure(tables.length===1&&Array.isArray(tables[0].rows));return tables[0].rows;};
    const one=(name,predicate)=>{const found=rows(name).filter(predicate);ensure(found.length===1);return found[0];};
    const oldSessionIds={};
    for(const role of ['admin','operator']) {
      const actor=secrets[role],principal=one('cms_principal',p=>p.id===actor.principalId);
      ensure(principal.username===actor.username&&principal.status==='active'&&principal.failed_login_count==='0'&&principal.locked_until===null&&principal.deleted_at===null);
      const tokenHash='\\x'+sha256(Buffer.from(actor.oldSessionToken,'utf8'));
      const session=one('cms_session',s=>s.principal_id===actor.principalId&&s.token_hash===tokenHash&&s.revoked_at===null&&instant(s.expires_at)>now.getTime());
      ensure(uuid(session.id)&&instant(session.created_at)<=now.getTime());oldSessionIds[role]=session.id;
    }
    ensure(oldSessionIds.admin!==oldSessionIds.operator);
    for(const entry of [input.publishedEntryId,input.refEntryId])one('cms_entry',row=>row.id===entry);
    one('cms_entry_revision',row=>row.entry_id===input.publishedEntryId&&row.revision_no==='1');
    for(const id of Object.values(input.media))one('cms_media',row=>row.id===id);
    return Object.freeze({...structuredClone(input),oldSessionIds});
  }catch{throw new OpsError('INPUT_INVALID');}
}
export async function restoreThroughSessions(inspection,request,deps={}) {
  let secrets=deps.recoverySecrets;
  const input=validateRestorePreflight(inspection,request,{recoverySecrets:secrets,smokeFixtureInput:deps.smokeFixtureInput},deps.now?.()??new Date());
  request=structuredClone(request);
  const {recoverySecrets:ignoredSecrets,smokeFixtureInput:ignoredInput,...safeDeps}=deps;
  const wf=deps.workflow??workflow,helper=deps.runOwnedHelper??runOwnedHelper;
  const config=deps.sessionConfig??targetModule.observedSessionConfig;
  const verifyRevoked=deps.verifyRevokedBundle??verifier.verifyRevokedBundle;
  ensure(typeof config==='function'&&typeof verifyRevoked==='function','ADAPTER_UNSEALED');
  const observed=await config(inspection,safeDeps);exact(observed,'sessionAbsoluteSeconds sessionMaxSeconds');
  ensure(observed.sessionAbsoluteSeconds===input.sessionAbsoluteSeconds&&observed.sessionMaxSeconds===input.sessionMaxSeconds);
  let token,phase='PRECHECK';
  try {
    token=await wf.beginWorkflow(inspection,structuredClone(request),safeDeps);
    phase='SOURCE_QUIESCED';await wf.beginPhase(token,phase,{},safeDeps);await wf.endPhase(token,{},safeDeps);
    const captured=await(deps.captureSource??captureSource)(token,safeDeps);phase='LOCAL_VERIFIED';
    await deps.onProgress?.({operationId:request.operationId,backupId:captured.backupId,phase});
    const fixture=deriveSmokeFixture(input,secrets,captured.inventory,deps.now?.()??new Date());
    const c=await wf.assertWorkflow(token,{side:'source',stage:phase},safeDeps),root=join(c.base,'operations',c.operationId);
    await directory(root);const bytes=canonicalBytes(fixture),path=join(root,'smoke-fixture.json');
    const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}await syncDirectory(root);
    const verified=await(deps.verifyCapturedBundle??verifier.verifyCapturedBundle)(token,captured.backupId,safeDeps);
    await(deps.protectCapturedBundle??verifier.protectCapturedBundle)(token,verified,safeDeps);
    await wf.reserveRestoreTarget(token,{runId:request.targetRunId},safeDeps);phase='TARGET_RESERVED';
    await(deps.createRestoreTarget??createRestoreTarget)(token,safeDeps);
    const invoke=async(side,kind)=>{await wf.assertWorkflow(token,{side,stage:phase},safeDeps);const result=await helper(token,{side,kind},safeDeps);
      ensure(result?.kind===kind,'RESTORE_FAILED');await wf.assertWorkflow(token,{side,stage:phase},safeDeps);return result;};
    for(const [next,kind]of [['DB_RESTORED','PG_RESTORE'],['MEDIA_RESTORED','MEDIA_RESTORE']]) {
      phase=next;await wf.beginPhase(token,phase,{},safeDeps);await invoke('target',kind);await wf.endPhase(token,{},safeDeps);
    }
    phase='RAW_VERIFIED';await wf.beginPhase(token,phase,{},safeDeps);
    const target=await invoke('target','INVENTORY'),source=await invoke('source','INVENTORY');
    const rawComparison=await(deps.compareRestoredBundle??verifier.compareRestoredBundle)(token,{target,source},safeDeps);
    await wf.endPhase(token,{},safeDeps);
    phase='SESSIONS_REVOKED';await wf.beginPhase(token,phase,{},safeDeps);
    const sessionCommit=await invoke('target','REVOKE_SESSIONS'),inventory=await invoke('target','INVENTORY');
    await verifyRevoked(token,{commit:sessionCommit,inventory},safeDeps);await wf.endPhase(token,{},safeDeps);
    await wf.assertWorkflow(token,{side:'target',stage:phase},safeDeps);
    return Object.freeze({token,backupId:captured.backupId,phase,fixture,fixtureSha256:sha256(bytes),rawComparison,sessionCommit});
  }catch(error){
    const failure=new OpsError(error instanceof OpsError?error.code:'RESTORE_FAILED',error instanceof OpsError?error.phase??phase:phase,request.operationId);
    if(token)try{await wf.failWorkflow(token,failure.code,safeDeps);}catch{/* Retain primary failure and all resources. */}
    throw failure;
  }finally{secrets=null;}
}

export function parseArgs(argv) {
  ensure(Array.isArray(argv)&&argv.length===8&&argv.every(v=>typeof v==='string'));
  const values=new Map(),flags=['--run-id','--operation-id','--target-run-id','--incident-started-at'];
  for(let i=0;i<argv.length;i+=2){ensure(flags.includes(argv[i])&&!values.has(argv[i]));values.set(argv[i],argv[i+1]);}
  const runId=values.get('--run-id'),operationId=values.get('--operation-id'),targetRunId=values.get('--target-run-id'),incidentStartedAt=values.get('--incident-started-at');
  ensure(runIdValid(runId)&&uuid(operationId)&&runIdValid(targetRunId)&&targetRunId!==runId&&utc(incidentStartedAt));
  return Object.freeze({runId,operationId,targetRunId,incidentStartedAt});
}
function validateRecoverySecrets(secrets) {
  exact(secrets,'admin operator');
  for(const actor of Object.values(secrets)) {
    exact(actor,'principalId username password oldSessionToken');
    ensure(uuid(actor.principalId)&&text(actor.username)&&text(actor.password)&&text(actor.oldSessionToken));
    ensure(actor.password.length>=12&&actor.password.toLowerCase()!==actor.username.toLowerCase());
  }
  return secrets;
}
function ttyStreams(deps) {
  const input=deps.stdin??process.stdin,output=deps.stdout??process.stdout,error=deps.stderr??process.stderr;
  ensure(input.isTTY===true&&output.isTTY===true&&error.isTTY===true);return{input,error};
}
export async function readRecoverySecrets(deps={}) {
  const {input,error}=ttyStreams(deps),previousRaw=input.isRaw===true,flowing=input.readableFlowing;
  ensure(typeof input.setRawMode==='function');const chunks=[];let length=0,bytes,onData,onEnd,onError;
  try {
    input.setRawMode(true);ensure(input.isRaw===true);error.write('Restore drill credentials (private JSON): ');
    return await new Promise((resolve,reject)=>{
      let done=false;const fail=()=>{if(!done){done=true;reject(new OpsError('INPUT_INVALID'));}};
      onEnd=fail;onError=fail;
      onData=chunk=>{
        if(done)return;
        try {
          const copy=Buffer.from(chunk);chunks.push(copy);length+=copy.length;ensure(length<=16384);
          bytes?.fill(0);bytes=Buffer.concat(chunks);const end=bytes.findIndex(value=>value===10||value===13);
          if(end<0){ensure(!bytes.includes(3)&&!bytes.includes(4));return;}
          const width=bytes[end]===13&&bytes[end+1]===10?2:1;ensure(end>0&&bytes.length===end+width);
          const line=Buffer.concat([bytes.subarray(0,end),Buffer.from('\n')]);
          try{const value=validateRecoverySecrets(parseStrictJson(line));done=true;resolve(value);}finally{line.fill(0);}
        }catch{fail();}
      };
      input.on('data',onData);input.once('end',onEnd);input.once('error',onError);input.resume();
    });
  } catch {throw new OpsError('INPUT_INVALID');}
  finally {
    if(onData)input.removeListener('data',onData);if(onEnd)input.removeListener('end',onEnd);if(onError)input.removeListener('error',onError);
    if(flowing!==true)input.pause();let restored=false;
    try{input.setRawMode(previousRaw);restored=input.isRaw===previousRaw;}catch{/* Reject input if the terminal cannot be restored. */}
    bytes?.fill(0);for(const chunk of chunks)chunk.fill(0);ensure(restored);
  }
}
export async function run(argv,deps={}) {
  let operationId=null,backupId=null,phase=null,code=null,exitCode=0,secrets=null;
  try {
    const options=parseArgs(argv);operationId=options.operationId;
    ensure(Date.parse(options.incidentStartedAt)<=(deps.now?.()??new Date()).getTime());ttyStreams(deps);
    const cwd=resolve(deps.cwd??process.cwd()),component=resolve(fileURLToPath(new URL('../../',import.meta.url)));
    ensure(deps.cwd!==undefined||cwd===component);ensure(process.versions.node.split('.')[0]==='24','ADAPTER_UNSEALED');
    const getStart=deps.captureWorkflowStart??workflow.captureWorkflowStart;ensure(typeof getStart==='function','ADAPTER_UNSEALED');
    const workflowStart=getStart(deps),root=join(cwd,'local/pp1',options.runId);
    const smokeFixtureInput=await readPrivate(join(root,'recovery-smoke-input.json'),true);
    secrets=await(deps.readRecoverySecrets??readRecoverySecrets)(deps);
    const inspect=deps.inspectTarget??targetModule.inspectTarget;let inspection;
    for(const apiState of ['running','stopped'])try {
      const current=await inspect(root,deps,{apiState});
      ensure(current.target.runId===options.runId&&current.target.targetId===`pp1-local:${options.runId}`,'TARGET_NOT_OWNED');inspection=current;break;
    }catch{/* Only a complete strict inspection establishes source ownership. */}
    ensure(inspection,'TARGET_NOT_OWNED');ensure(sha256(await readFile(process.execPath))===inspection.target.nodeBinarySha256,'ADAPTER_UNSEALED');
    const request={operationId,purpose:'RESTORE_VERIFY_LOCAL',completionPolicy:'KEEP_STOPPED',targetRunId:options.targetRunId,incidentStartedAt:options.incidentStartedAt};
    validateRestorePreflight(inspection,request,{recoverySecrets:secrets,smokeFixtureInput},deps.now?.()??new Date());
    const result=await(deps.restoreLocal??restoreLocal)(inspection,request,{...deps,workflowStart,recoverySecrets:secrets,smokeFixtureInput,onProgress:value=>{
      ensure(value.operationId===operationId&&typeof value.backupId==='string'&&/^pp1-\d{8}T\d{9}Z-[a-f0-9]{32}$/.test(value.backupId));backupId=value.backupId;
    }});
    ensure(result?.phase==='COMPLETE'&&typeof result.backupId==='string'&&/^pp1-\d{8}T\d{9}Z-[a-f0-9]{32}$/.test(result.backupId),'RESTORE_FAILED');
    backupId=result.backupId;phase='COMPLETE';ensure(typeof result.receipt?.withinRto==='boolean','OBJECTIVE_UNKNOWN');
    if(!result.receipt.withinRto){code='OBJECTIVE_MISSED';exitCode=11;}
  } catch(error) {
    const failure=error instanceof OpsError?error:new OpsError('INPUT_INVALID');code=failure.code;phase=failure.phase;exitCode=failure.exitCode;
  } finally {secrets=null;}
  try{(deps.stdout??process.stdout).write(canonicalBytes({operationId,backupId,phase,code,exitCode}));}catch{return 8;}
  return exitCode;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  process.stdout.on('error',()=>{process.exitCode=8;});process.exitCode=await run(process.argv.slice(2));
}

export async function restoreLocal(inspection,request,deps={}) {
  const wf=deps.workflow??workflow,pick=name=>Object.hasOwn(deps,name)?deps[name]:verifier[name];
  const verifyZero=pick('verifyLifecycleInventory'),beginSmoke=pick('beginRestoreSmoke'),verifyBrowser=pick('verifyBrowserResult');
  const verifyAuth=pick('verifyAuthInventory'),complete=pick('completeRestoreVerification'),publish=pick('publishRecoveryCandidate');
  const getStart=deps.captureWorkflowStart??workflow.captureWorkflowStart;
  const smokeRunner=Object.hasOwn(deps,'runRestoreSmoke')?deps.runRestoreSmoke:(await import('./local-restore-smoke.mjs')).runRestoreSmoke;
  ensure([verifyZero,beginSmoke,verifyBrowser,verifyAuth,complete,publish,getStart,smokeRunner,
    wf.startTargetApi,wf.stopTargetApi,wf.startTargetIngress,wf.stopTargetIngress,wf.finishWorkflow,wf.workflowSignalContext].every(value=>typeof value==='function'),'ADAPTER_UNSEALED');
  const workflowStart=deps.workflowStart??getStart(deps);
  ensure(deps.signal===undefined||deps.signal instanceof AbortSignal);
  const cancellation=new AbortController(),signal=deps.signal?AbortSignal.any([cancellation.signal,deps.signal]):cancellation.signal;
  const cancel=()=>cancellation.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  let secrets=deps.recoverySecrets,token,phase='PRECHECK',released=false;
  const {recoverySecrets:ignoredSecrets,smokeFixtureInput:ignoredInput,...safeDeps}=deps;
  safeDeps.workflowStart=workflowStart;safeDeps.signal=signal;const helper=deps.runOwnedHelper??runOwnedHelper;
  try {
    ensure(!signal.aborted,'INTERRUPTED');
    const captured=await restoreThroughSessions(inspection,request,{...deps,workflowStart,signal});token=captured.token;
    const execution=await wf.workflowSignalContext(token,safeDeps);exact(execution,'signal');ensure(execution.signal instanceof AbortSignal,'ADAPTER_UNSEALED');
    safeDeps.signal=AbortSignal.any([signal,execution.signal]);
    const invoke=async side=>{await wf.assertWorkflow(token,{side,stage:phase},safeDeps);
      const value=await helper(token,{side,kind:'INVENTORY'},safeDeps);ensure(value?.kind==='INVENTORY','RESTORE_FAILED');return value;};
    phase='STARTUP_VERIFIED';await wf.beginPhase(token,phase,{},safeDeps);
    await wf.startTargetApi(token,safeDeps);await wf.stopTargetApi(token,safeDeps);
    const startup=await verifyZero(token,await invoke('target'),safeDeps);await wf.endPhase(token,{},safeDeps);
    phase='API_HEALTHY';await wf.beginPhase(token,phase,{},safeDeps);await wf.startTargetApi(token,safeDeps);await wf.endPhase(token,{},safeDeps);
    phase='INGRESS_STARTED';await wf.beginPhase(token,phase,{},safeDeps);await wf.startTargetIngress(token,safeDeps);await wf.endPhase(token,{},safeDeps);
    phase='BROWSER_VERIFIED';await wf.beginPhase(token,phase,{},safeDeps);await beginSmoke(token,safeDeps);
    const browser=await smokeRunner(token,{fixture:captured.fixture,recoverySecrets:secrets,startupInventorySha256:startup.sha256},safeDeps);
    await verifyBrowser(token,browser,safeDeps);await wf.endPhase(token,{},safeDeps);
    phase='TARGET_STOPPED';await wf.beginPhase(token,phase,{},safeDeps);
    await wf.stopTargetIngress(token,safeDeps);await wf.stopTargetApi(token,safeDeps);
    await verifyAuth(token,{browser,inventory:await invoke('target')},safeDeps);await wf.endPhase(token,{},safeDeps);
    phase='RESTART_VERIFIED';await wf.beginPhase(token,phase,{},safeDeps);await wf.startTargetApi(token,safeDeps);await wf.stopTargetApi(token,safeDeps);
    await verifyZero(token,await invoke('target'),safeDeps);const verified=await complete(token,await invoke('source'),safeDeps);
    await wf.endPhase(token,{},safeDeps);await wf.finishWorkflow(token,{success:true},safeDeps);released=true;phase='COMPLETE';
    ensure(!safeDeps.signal.aborted,'INTERRUPTED');await publish(token,verified.proof,safeDeps);
    return Object.freeze({operationId:request.operationId,backupId:captured.backupId,phase,...verified});
  } catch(error) {
    const failure=new OpsError(error instanceof OpsError?error.code:'RESTORE_FAILED',error instanceof OpsError?error.phase??phase:phase,request.operationId);
    if(token&&!released)try{await wf.failWorkflow(token,failure.code,safeDeps);}catch{/* Preserve the primary error and all evidence. */}
    throw failure;
  } finally {secrets=null;process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}

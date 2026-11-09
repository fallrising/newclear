import { liveSourceFixture } from '../local/maintenance-source.fixture.mjs';
import { inspectTarget } from '../local/maintenance-target.mjs';
// Shared test-only full lifecycle and released private proof bytes. No .test imports.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as verifier from './local-recovery-verify.mjs';
import { canonicalBytes, sha256 } from './recovery-protocol.mjs';
import { revocationFixture, rehashInventory, revokedFixture } from './local-recovery.fixture.mjs';
import { authFixture, authRows, authId } from './local-recovery-auth.fixture.mjs';
import { WORKFLOW_PHASES, validateLeaseV2, validateJournalV2 } from '../local/maintenance-store.mjs';
export async function smokeContextFixture(t,options={}) {
  const auth=authFixture(),r=revocationFixture();
  if(options.large){authRows(auth.baseline,'cms_principal')[0].display_name='x'.repeat(1048576);
    for(const table of auth.baseline.tables)table.rows.sort((a,b)=>Buffer.compare(canonicalBytes(a),canonicalBytes(b)));}
  r.raw=structuredClone(auth.baseline);r.raw.files=[];
  authRows(r.raw,'cms_session').forEach(row=>{row.revoked_at=null;});rehashInventory(r.raw);
  r.after=structuredClone(r.raw);authRows(r.after,'cms_session').forEach(row=>{row.revoked_at='2026-11-06 11:30:00+00';});
  const added=revocationFixture().after.tables.find(table=>table.tableName==='cms_audit_event').rows[0];added.at='2026-11-06 11:30:00+00';
  authRows(r.after,'cms_audit_event').push(added);rehashInventory(r.after);
  const fixture=auth.context.fixture;let realSource;
  const f=await revokedFixture(t,{revocation:r,configure:async base=>{
    if(options.realSource){
      realSource=await liveSourceFixture(t,'stopped',{cwd:base.cwd,networkBase:4});realSource.deps.cwd=base.cwd;
      const inspection=await inspectTarget(realSource.root,realSource.deps,{apiState:'stopped'});
      base.ctx.target=inspection.target;base.ctx.lease.source=inspection.target;realSource.inspection=inspection;
      base.ctx.lease.sourceConnection={jdbcUrl:inspection.jdbcUrl,dataGateway:inspection.dataGateway};
    }
    const root=join(base.base,'operations',base.ctx.operationId);await mkdir(root,{recursive:true,mode:0o700});
    await writeFile(join(root,'smoke-fixture.json'),canonicalBytes(fixture),{mode:0o600});
  }});
  if(realSource){f.ctx.lease.sourceConnection={jdbcUrl:realSource.inspection.jdbcUrl,dataGateway:realSource.inspection.dataGateway};f.realSource=realSource;}
  await verifier.verifyRevokedBundle(f.token,{commit:f.commit,inventory:f.inventory},f.deps);
  f.ctx.lease.phase='STARTUP_VERIFIED';f.ctx.helperSequence=11;
  const result=await f.issueInventory('target','11',structuredClone(f.post));await verifier.verifyLifecycleInventory(f.token,result,f.deps);
  f.ctx.lease.phase='INGRESS_STARTED';return{...f,auth,smokeFixture:fixture};
}

export async function liveAuthFixture(t,options={}) {
  const f=await smokeContextFixture(t,options);f.ctx.lease.phase='BROWSER_VERIFIED';
  const context=await verifier.restoreSmokeContext(f.token,f.deps),observations=structuredClone(f.auth.context.observations),assertions=structuredClone(f.auth.context.assertions);
  for(const value of [observations,assertions])Object.assign(value,{operationId:f.ctx.operationId,targetRunId:f.child.runId});
  assertions.fixtureSha256=context.input.fixtureSha256;
  f.now='2026-11-06T12:00:00.000Z';f.deps.now=()=>new Date(f.now);
  f.deps.inspectionDetails=()=>({ingressWebAddress:f.auth.context.ingressWebAddress});
  const result=Object.freeze({version:1}),authority={operationId:f.ctx.operationId,targetRunId:f.child.runId,fixtureSha256:context.input.fixtureSha256,
    helperId:'f'.repeat(64),helperSequence:'12',inputSha256:sha256(canonicalBytes(context.input)),deliveredOnce:true,eof:true,exitCode:0,observations,assertions};
  const owned=new WeakMap([[result,authority]]);f.deps.browserAuthority=async(token,value)=>{assert.equal(token,f.token);const m=owned.get(value);if(!m)throw new Error('unowned');return m;};
  await verifier.beginRestoreSmoke(f.token,f.deps);f.ctx.helperSequence=12;f.now='2026-11-06T12:00:04.000Z';
  const after=structuredClone(f.post);
  for(const current of authRows(after,'cms_principal')) {
    const changed=authRows(f.auth.after,'cms_principal').find(row=>row.id===current.id);if(changed)Object.assign(current,{last_login_at:changed.last_login_at,updated_at:changed.updated_at});
  }
  authRows(after,'cms_session').push(...structuredClone(authRows(f.auth.after,'cms_session').filter(row=>[authId(21),authId(22)].includes(row.id))).map(row=>({...row,user_agent:`CMS-PP1C-RESTORE/${f.ctx.operationId}`})));
  authRows(after,'cms_audit_event').push(...structuredClone(authRows(f.auth.after,'cms_audit_event').filter(row=>[authId(31),authId(32)].includes(row.id))));
  for(const table of after.tables)table.rows.sort((a,b)=>Buffer.compare(canonicalBytes(a),canonicalBytes(b)));rehashInventory(after);
  return Object.assign(f,{browserResult:result,browserAuthority:authority,after});
}

export async function finalProofFixture(t,options={}) {
  const f=await liveAuthFixture(t,options);await verifier.verifyBrowserResult(f.token,f.browserResult,f.deps);
  f.ctx.lease.phase='TARGET_STOPPED';f.ctx.helperSequence=13;
  await verifier.verifyAuthInventory(f.token,{browser:f.browserResult,inventory:await f.issueInventory('target','13',f.after)},f.deps);
  f.ctx.lease.phase='RESTART_VERIFIED';f.ctx.helperSequence=14;
  await verifier.verifyLifecycleInventory(f.token,await f.issueInventory('target','14',structuredClone(f.after)),f.deps);
  f.ctx.helperSequence=15;f.ctx.request={...f.ctx.request,incidentStartedAt:f.ctx.request.startedAt,environment:'isolated-drill'};
  f.deps.workflowTimingContext=async()=>({startedAt:f.ctx.request.startedAt,availableAt:'2026-11-06T12:00:05.000Z',elapsedMs:'345665000'});
  f.sourceResult=await f.issueInventory('source','15',structuredClone(f.captured.inventory));return f;
}

export async function persistedProofFixture(t,options={}) {
  const f=await finalProofFixture(t,options),complete=await verifier.completeRestoreVerification(f.token,f.sourceResult,f.deps);
  const root=join(f.cwd,'local','pp1',f.ctx.target.runId),childRoot=join(f.cwd,'local','pp1',f.child.runId);
  assert.equal(f.root,root);
  await mkdir(childRoot,{mode:0o700});
  const put=(path,value)=>writeFile(path,canonicalBytes(value),{mode:0o600});
  const preparation={receipt:{version:1,runId:f.child.runId},artifacts:{version:1,sourceCommit:f.child.sourceCommit,apiBuild:f.child.apiBuild}};
  await put(join(childRoot,'receipt.json'),preparation.receipt);await put(join(childRoot,'artifacts.json'),preparation.artifacts);
  const marker={version:1,runId:f.child.runId,targetId:f.child.targetId,project:f.child.project,sourceOperationId:f.ctx.operationId,
    creationPhase:'BLANK_VERIFIED',identity:f.child,connection:f.ctx.lease.target.connection,
    preparationSha256:sha256(canonicalBytes(preparation)),createdResourceSetSha256:sha256(canonicalBytes({
      containerIds:f.child.containerIds,networkIds:f.child.networkIds,volumeNames:f.child.volumeNames}))};
  await put(join(childRoot,'restore-target.json'),marker);
  const request={version:1,operationId:f.ctx.operationId,sourceRunId:f.ctx.target.runId,purpose:'RESTORE_VERIFY_LOCAL',
    targetRunId:f.child.runId,incidentStartedAt:f.ctx.request.startedAt,startedAt:f.ctx.request.startedAt,environment:'isolated-drill'};
  const lease={version:2,operationId:f.ctx.operationId,purpose:'RESTORE_VERIFY_LOCAL',releaseId:`sha256:${f.ctx.target.apiBuild.jarSha256}`,
    phase:'COMPLETE',createdAt:request.startedAt,requestSha256:sha256(canonicalBytes(request)),source:f.ctx.target,
    sourceConnection:f.ctx.lease.sourceConnection,originalApiState:'running',completionPolicy:'KEEP_STOPPED',target:marker,helper:null,proof:complete.proof,account:null};
  validateLeaseV2(lease);
  const journal={version:2,operationId:lease.operationId,purpose:lease.purpose,sourceTargetId:lease.source.targetId,releaseId:lease.releaseId,records:[]};
  for(const phase of WORKFLOW_PHASES.RESTORE_VERIFY_LOCAL)for(const event of ['BEGIN','END'])journal.records.push({
    seq:String(journal.records.length+1),event,phase,at:request.startedAt,failureCode:null,leaseSha256:sha256(canonicalBytes(lease)),
    proofSha256:WORKFLOW_PHASES.RESTORE_VERIFY_LOCAL.indexOf(phase)>15||phase==='RESTART_VERIFIED'&&event==='END'?complete.proof.proofSha256:null});
  validateJournalV2(journal,lease);
  const base=join(root,'maintenance');
  await put(join(base,'operations',lease.operationId+'.request.json'),request);await put(join(base,'operations',lease.operationId+'.json'),journal);
  await put(join(base,'target.json'),lease.source);await put(join(base,'lease.json'),lease);
  await put(join(base,'recovery-candidate.json'),{version:1,sourceRunId:lease.source.runId,backupId:complete.proof.backupId,
    restoreOperationId:lease.operationId,proofSha256:complete.proof.proofSha256});
  const inspection=f.realSource?await inspectTarget(root,f.realSource.deps,{apiState:'stopped'}):Object.freeze({target:lease.source,...lease.sourceConnection});
  const deps={cwd:f.cwd,inspectionDetails:value=>{assert.equal(value,inspection);return {runRoot:root,apiState:'stopped'};}};
  return {...f,root,base,childRoot,lease,journal,request,proof:complete.proof,inspection,recoveryDeps:f.realSource?f.realSource.deps:deps,put};
}

// Real inspector authority for later readonly-owner tests; generation deps stay separate.
export async function releasedSourceFixture(t,options={}) {
  const f=await persistedProofFixture(t,{...options,realSource:true});
  const {cwd,root,base,childRoot,lease,journal,request,proof,inspection,put,captured,realSource}=f;
  return {cwd,root,base,childRoot,lease,journal,request,proof,inspection,put,captured,realSource,
    readonlyIds:Object.freeze({runId:lease.source.runId,backupId:proof.backupId,restoreOperationId:lease.operationId}),readonlyDeps:realSource.deps};
}

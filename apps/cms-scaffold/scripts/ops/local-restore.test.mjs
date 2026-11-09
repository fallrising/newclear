import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRestorePreflight, deriveSmokeFixture, restoreThroughSessions as restoreLocal } from './local-restore.mjs';
import { sha256, canonicalBytes, OpsError } from './recovery-protocol.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,runId='a'.repeat(32),now=new Date('2026-11-02T16:00:00.000Z');
function inputs() {
  const request={operationId:id(1),purpose:'RESTORE_VERIFY_LOCAL',completionPolicy:'KEEP_STOPPED',targetRunId:'b'.repeat(32),incidentStartedAt:'2026-11-02T15:00:00.000Z'};
  const smokeFixtureInput={version:1,sourceRunId:runId,adminPrincipalId:id(2),operatorPrincipalId:id(3),publishedEntryId:id(4),revisionNo:1,refEntryId:id(5),
    media:Object.fromEntries(['publicImageId','publicPdfId','draftImageId','privateImageId','replacedImageId','deletedImageId'].map((k,i)=>[k,id(i+6)])),
    expected:Object.fromEntries(['privateEntrySha256','operatorEntrySha256','publicEntrySha256','revisionListSha256','publicOriginalSha256','publicThumbnailSha256','publicWebSha256','publicPdfSha256','draftOriginalSha256','privateOriginalSha256','replacedOriginalSha256'].map(k=>[k,'c'.repeat(64)])),sessionAbsoluteSeconds:'43200',sessionMaxSeconds:'604800'};
  const recoverySecrets=Object.fromEntries(['admin','operator'].map((role,i)=>[role,{principalId:id(i+2),username:`actor-${role}`,password:`private-${role}-password`,oldSessionToken:`secret-old-${role}`}])) ;
  const rows={cms_principal:Object.values(recoverySecrets).map(a=>({id:a.principalId,username:a.username,status:'active',failed_login_count:'0',locked_until:null,deleted_at:null})),
    cms_session:Object.values(recoverySecrets).map((a,i)=>({id:id(i+20),principal_id:a.principalId,token_hash:'\\x'+sha256(Buffer.from(a.oldSessionToken)),created_at:'2026-11-02 15:00:00+00',expires_at:'2026-11-03 15:00:00+00',revoked_at:null})),
    cms_entry:[{id:id(4)},{id:id(5)}],cms_entry_revision:[{entry_id:id(4),revision_no:'1'}],cms_media:Object.values(smokeFixtureInput.media).map(id=>({id}))};
  return {inspection:{target:{runId}},request,recoverySecrets,smokeFixtureInput,inventory:{tables:Object.entries(rows).map(([tableName,rows])=>({tableName,rows}))}};
}
test('T138_C11_preflight_accepts_exact_memory_input_and_derives_only_safe_fixture',()=>{
  const f=inputs();validateRestorePreflight(f.inspection,f.request,f,now);
  const derived=deriveSmokeFixture(f.smokeFixtureInput,f.recoverySecrets,f.inventory,now);
  assert.deepEqual(derived.oldSessionIds,{admin:id(20),operator:id(21)});
  const bytes=canonicalBytes(derived).toString();for(const a of Object.values(f.recoverySecrets))for(const k of ['username','password','oldSessionToken'])assert.ok(!bytes.includes(a[k]));
});
for(const fault of ['no-secrets','extra-secret','principal-mismatch','short-password','equal-password','token-control','input-extra','missing-hash','bad-seconds','revision-two','duplicate-media','same-target','future-incident'])test(`T138_C11_preflight_rejects_${fault}`,()=>{
  const f=inputs();
  if(fault==='no-secrets')delete f.recoverySecrets;
  if(fault==='extra-secret')f.recoverySecrets.admin.path='/secret';
  if(fault==='principal-mismatch')f.recoverySecrets.admin.principalId=id(99);
  if(fault==='short-password')f.recoverySecrets.admin.password='short';
  if(fault==='equal-password')f.recoverySecrets.admin.username=f.recoverySecrets.admin.password.toUpperCase();
  if(fault==='token-control')f.recoverySecrets.admin.oldSessionToken+='\n';
  if(fault==='input-extra')f.smokeFixtureInput.oldSessionIds={admin:id(20),operator:id(21)};
  if(fault==='missing-hash')delete f.smokeFixtureInput.expected.privateEntrySha256;
  if(fault==='bad-seconds')f.smokeFixtureInput.sessionMaxSeconds=604800;
  if(fault==='revision-two')f.smokeFixtureInput.revisionNo=2;
  if(fault==='duplicate-media')f.smokeFixtureInput.media.publicPdfId=f.smokeFixtureInput.media.publicImageId;
  if(fault==='same-target')f.request.targetRunId=runId;
  if(fault==='future-incident')f.request.incidentStartedAt='2026-11-03T00:00:00.000Z';
  assert.throws(()=>validateRestorePreflight(f.inspection,f.request,f,now),{code:'INPUT_INVALID'});
});
for(const fault of ['missing-session','duplicate-session','expired','revoked','wrong-hash','inactive-principal','missing-entry','missing-media','missing-revision','ambiguous-revision'])test(`T138_C11_derive_rejects_${fault}`,()=>{
  const f=inputs(),table=name=>f.inventory.tables.find(t=>t.tableName===name).rows;
  if(fault==='missing-session')table('cms_session').shift();
  if(fault==='duplicate-session')table('cms_session').push({...table('cms_session')[0],id:id(99)});
  if(fault==='expired')table('cms_session')[0].expires_at='2026-11-02 15:00:00+00';
  if(fault==='revoked')table('cms_session')[0].revoked_at='2026-11-02 15:00:00+00';
  if(fault==='wrong-hash')table('cms_session')[0].token_hash='\\x'+'0'.repeat(64);
  if(fault==='inactive-principal')table('cms_principal')[0].status='disabled';
  if(fault==='missing-entry')table('cms_entry').shift();
  if(fault==='missing-media')table('cms_media').shift();
  if(fault==='missing-revision')table('cms_entry_revision')[0].revision_no='2';
  if(fault==='ambiguous-revision')table('cms_entry_revision').push({...table('cms_entry_revision')[0]});
  assert.throws(()=>deriveSmokeFixture(f.smokeFixtureInput,f.recoverySecrets,f.inventory,now),{code:'INPUT_INVALID'});
});
import { mkdtemp, mkdir, readFile, writeFile, lstat, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
async function orchestration(t,options={}) {
  const f=inputs(),root=await mkdtemp(join(tmpdir(),'cms-restore-')),base=join(root,'maintenance');t.after(()=>rm(root,{recursive:true,force:true}));
  const token=Object.freeze({}),calls=[],state={phase:'PRECHECK',failed:false},operation=join(base,'operations',f.request.operationId);
  const step=name=>{calls.push(name);if(options.fail===name)throw new OpsError(options.code??'RESTORE_FAILED');};
  const safe=deps=>{assert.equal(Object.hasOwn(deps,'recoverySecrets'),false);assert.equal(Object.hasOwn(deps,'smokeFixtureInput'),false);};
  const workflow={beginWorkflow:async(i,r,deps)=>{safe(deps);assert.equal(r.completionPolicy,'KEEP_STOPPED');step('begin');await mkdir(operation,{recursive:true,mode:0o700});return token;},
    assertWorkflow:async(t,{stage}={})=>{assert.equal(t,token);if(stage)assert.equal(state.phase,stage);if(options.changedSource)throw new OpsError('SOURCE_CHANGED');return{root,base,operationId:f.request.operationId,lease:{phase:state.phase,helper:null},target:f.inspection.target};},
    beginPhase:async(t,phase)=>{assert.equal(t,token);step('begin:'+phase);state.phase=phase;},endPhase:async()=>step('end:'+state.phase),
    reserveRestoreTarget:async(t,o)=>{assert.equal(t,token);assert.deepEqual(o,{runId:f.request.targetRunId});step('reserve');state.phase='TARGET_RESERVED';},
    failWorkflow:async(t,code)=>{assert.equal(t,token);calls.push('fail:'+code);state.failed=true;},finishWorkflow:()=>assert.fail('C must not finish')};
  const deps={...f,workflow,now:()=>now,sessionConfig:async()=>{step('config');return{sessionAbsoluteSeconds:'43200',sessionMaxSeconds:'604800'};},
    captureSource:async(t,d)=>{safe(d);step('capture');state.phase='LOCAL_VERIFIED';return{backupId:'pp1-20261102T160000000Z-'+'1'.repeat(32),inventory:f.inventory};},
    verifyCapturedBundle:async()=>{step('verify');return{verified:true};},protectCapturedBundle:async()=>step('copy'),
    createRestoreTarget:async()=>{step('create');state.phase='TARGET_BLANK';},
    runOwnedHelper:async(t,o,d)=>{safe(d);assert.equal(t,token);assert.deepEqual(Object.keys(o).sort(),['kind','side']);step(o.side+':'+o.kind);return{kind:o.kind,receipt:{committed:true}};},
    compareRestoredBundle:async(t,r)=>{assert.deepEqual(Object.keys(r).sort(),['source','target']);step('compare');return{equal:true};},
    verifyRevokedBundle:async(t,r)=>{assert.deepEqual(Object.keys(r).sort(),['commit','inventory']);step('verify-revoked');return{equal:true};}};
  return{...f,root,base,operation,token,calls,state,deps};
}
test('T138_C12_restore_orders_private_fixture_capture_copy_target_raw_and_commit',async t=>{
  const f=await orchestration(t),result=await restoreLocal(f.inspection,f.request,f.deps);
  assert.equal(result.phase,'SESSIONS_REVOKED');assert.equal(result.token,f.token);assert.equal(result.proof,undefined);
  assert.deepEqual(f.calls,['config','begin','begin:SOURCE_QUIESCED','end:SOURCE_QUIESCED','capture','verify','copy','reserve','create',
    'begin:DB_RESTORED','target:PG_RESTORE','end:DB_RESTORED','begin:MEDIA_RESTORED','target:MEDIA_RESTORE','end:MEDIA_RESTORED',
    'begin:RAW_VERIFIED','target:INVENTORY','source:INVENTORY','compare','end:RAW_VERIFIED','begin:SESSIONS_REVOKED','target:REVOKE_SESSIONS','target:INVENTORY','verify-revoked','end:SESSIONS_REVOKED']);
  const path=join(f.operation,'smoke-fixture.json'),bytes=await readFile(path),stat=await lstat(path);
  assert.equal(stat.mode&0o777,0o600);assert.equal(stat.nlink,1);assert.equal(sha256(bytes),result.fixtureSha256);
  for(const actor of Object.values(f.recoverySecrets))for(const k of ['password','oldSessionToken','username'])assert.ok(!bytes.toString().includes(actor[k]));
});
for(const [fault,later]of [['capture','verify'],['verify','copy'],['copy','reserve'],['reserve','create'],['create','target:PG_RESTORE'],['target:PG_RESTORE','target:MEDIA_RESTORE'],['target:MEDIA_RESTORE','target:INVENTORY'],['compare','target:REVOKE_SESSIONS'],['target:REVOKE_SESSIONS','verify-revoked'],['verify-revoked','end:SESSIONS_REVOKED']])test(`T138_C12_${fault}_failure_preserves_lock_and_blocks_${later}`,async t=>{
  const f=await orchestration(t,{fail:fault});await assert.rejects(restoreLocal(f.inspection,f.request,f.deps),{code:'RESTORE_FAILED'});
  assert.ok(f.calls.includes(fault));assert.ok(!f.calls.includes(later));assert.equal(f.state.failed,true);assert.equal(f.calls.at(-1),'fail:RESTORE_FAILED');
});
for(const fault of ['missing-secrets','invalid-input','config-mismatch','unsealed-config'])test(`T138_C12_${fault}_refuses_before_workflow`,async t=>{
  const f=await orchestration(t);
  if(fault==='missing-secrets')delete f.deps.recoverySecrets;
  if(fault==='invalid-input')f.smokeFixtureInput.expected.privateEntrySha256='bad';
  if(fault==='config-mismatch')f.deps.sessionConfig=async()=>({sessionAbsoluteSeconds:'1',sessionMaxSeconds:'2'});
  if(fault==='unsealed-config')f.deps.sessionConfig=null;
  await assert.rejects(restoreLocal(f.inspection,f.request,f.deps),{code:fault==='unsealed-config'?'ADAPTER_UNSEALED':'INPUT_INVALID'});
  assert.deepEqual(f.calls,[]);assert.deepEqual(await readdir(f.root),[]);
});
test('T138_C12_bad_captured_fixture_keeps_source_stopped_without_target',async t=>{
  const f=await orchestration(t);f.inventory.tables.find(t=>t.tableName==='cms_session').rows=[];
  await assert.rejects(restoreLocal(f.inspection,f.request,f.deps),{code:'INPUT_INVALID'});
  assert.ok(f.calls.includes('capture'));assert.ok(!f.calls.includes('reserve'));assert.equal(f.state.failed,true);
});
test('T138_C12_fixture_file_is_exclusive_and_no_second_target_write_occurs',async t=>{
  const f=await orchestration(t);await restoreLocal(f.inspection,f.request,f.deps);const original=await readFile(join(f.operation,'smoke-fixture.json'));f.calls.length=0;
  await assert.rejects(restoreLocal(f.inspection,f.request,f.deps),{code:'RESTORE_FAILED'});
  assert.ok(!f.calls.includes('reserve'));assert.deepEqual(await readFile(join(f.operation,'smoke-fixture.json')),original);
});
test('T138_C12_changed_source_blocks_target_writes_and_independent_fresh_target_can_succeed',async t=>{
  const f=await orchestration(t,{changedSource:true});await assert.rejects(restoreLocal(f.inspection,f.request,f.deps),{code:'SOURCE_CHANGED'});assert.ok(!f.calls.includes('reserve'));
  const second=await orchestration(t);second.request.targetRunId='c'.repeat(32);const result=await restoreLocal(second.inspection,second.request,second.deps);
  assert.equal(result.phase,'SESSIONS_REVOKED');assert.notEqual(second.request.targetRunId,f.request.targetRunId);assert.notEqual(second.root,f.root);
});
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const cliPath=fileURLToPath(new URL('./local-restore.mjs',import.meta.url)),execute=promisify(execFile);
const cliArgs=()=>['--run-id',runId,'--operation-id',id(1),'--target-run-id','b'.repeat(32),'--incident-started-at','2026-11-01T00:00:00.000Z'];
async function child(args){try{const r=await execute(process.execPath,[cliPath,...args],{timeout:10000});return{...r,code:0};}catch(e){return e;}}
test('T138_C12_public_restore_cli_requires_trueTTY_before_partial_dispatch',async()=>{
  const result=await child(cliArgs());assert.equal(result.code,2);assert.equal(result.stderr,'');
  assert.equal(result.stdout,canonicalBytes({operationId:id(1),backupId:null,phase:null,code:'INPUT_INVALID',exitCode:2}).toString());
});
for(const [name,args]of [
  ['missing',[]],['unknown',[...cliArgs(),'--shell','sh']],['duplicate',cliArgs().map((x,i)=>i===6?'--run-id':x)],
  ['uppercase',cliArgs().map((x,i)=>i===1?'A'.repeat(32):x)],['same-target',cliArgs().map((x,i)=>i===5?runId:x)],
  ['bad-utc',cliArgs().map((x,i)=>i===7?'2026-11-01T00:00:00Z':x)],['future',cliArgs().map((x,i)=>i===7?'2999-11-01T00:00:00.000Z':x)]
])test(`T138_C12_native_cli_${name}_is_input_invalid`,async()=>{
  const result=await child(args);assert.equal(result.code,2);assert.equal(result.stderr,'');const receipt=JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(receipt).sort(),['backupId','code','exitCode','operationId','phase']);assert.equal(receipt.code,'INPUT_INVALID');assert.equal(receipt.exitCode,2);
  assert.equal(receipt.backupId,null);assert.equal(receipt.phase,null);assert.equal(canonicalBytes(receipt).toString(),result.stdout);
});
test('T138_C12_native_import_is_side_effect_free',async()=>{
  const result=await execute(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('./local-restore.mjs',import.meta.url).href)}); process.stdout.write('IMPORTED');`],{timeout:10000});
  assert.equal(result.stdout,'IMPORTED');assert.equal(result.stderr,'');
});
test('T138_C12_valid_public_cli_never_calls_partial_core_or_reads_credentials',async()=>{
  const module=await import('./local-restore.mjs'),chunks=[];
  const code=await module.run(cliArgs(),{now:()=>now,stdout:{write:bytes=>chunks.push(bytes)},restoreLocal:()=>assert.fail('public core dispatch'),get recoverySecrets(){assert.fail('credential access');}});
  assert.equal(code,2);assert.equal(JSON.parse(Buffer.concat(chunks)).code,'INPUT_INVALID');
});
test('T138_C12_wrong_helper_kind_blocks_later_mutations',async t=>{
  const f=await orchestration(t),original=f.deps.runOwnedHelper;
  f.deps.runOwnedHelper=async(t,o,d)=>{const result=await original(t,o,d);return{...result,kind:'PG_DUMP'};};
  await assert.rejects(restoreLocal(f.inspection,f.request,f.deps),{code:'RESTORE_FAILED'});assert.ok(!f.calls.includes('target:MEDIA_RESTORE'));
});

test('T138_actual_PG_active_text_derives_fixture_with_native_text_columns',()=>{
  const f=inputs();f.inventory.tables.find(t=>t.tableName==='cms_session').rows[0].created_at='2026-11-02 15:00:00.123456+00';
  const result=deriveSmokeFixture(f.smokeFixtureInput,f.recoverySecrets,f.inventory,now);
  assert.deepEqual(result.oldSessionIds,{admin:id(20),operator:id(21)});
});
for(const status of ['ACTIVE','disabled','locked'])test(`T138_actual_PG_principal_rejects_${status}`,()=>{
  const f=inputs();for(const row of f.inventory.tables.find(t=>t.tableName==='cms_principal').rows)row.status=status;
  assert.throws(()=>deriveSmokeFixture(f.smokeFixtureInput,f.recoverySecrets,f.inventory,now),{code:'INPUT_INVALID'});
});

import {restoreLocal as restoreComplete} from './local-restore.mjs';
async function completeOrchestration(t,options={}) {
  const f=await orchestration(t,options),step=name=>{f.calls.push(name);if(options.fail===name)throw new OpsError('RESTORE_FAILED');};
  f.deps.captureWorkflowStart=()=>{step('clock-start');return Object.freeze({});};
  for(const name of ['startTargetApi','stopTargetApi','startTargetIngress','stopTargetIngress'])f.deps.workflow[name]=async(token,deps)=>{
    assert.equal(token,f.token);assert.ok(!Object.hasOwn(deps,'recoverySecrets'));step(name+':'+f.state.phase);};
  f.deps.workflow.finishWorkflow=async()=>{step('finish');f.state.phase='COMPLETE';};
  f.deps.workflow.workflowSignalContext=async(token,deps)=>{assert.equal(token,f.token);return{signal:deps.signal};};
  f.deps.verifyLifecycleInventory=async()=>{step('zero:'+f.state.phase);return{sha256:'d'.repeat(64)};};
  f.deps.beginRestoreSmoke=async()=>step('browser-begin');
  f.browser=Object.freeze({version:1});
  f.deps.runRestoreSmoke=async(token,options,deps)=>{assert.equal(token,f.token);assert.equal(options.recoverySecrets,f.recoverySecrets);
    assert.equal(options.startupInventorySha256,'d'.repeat(64));assert.ok(!Object.hasOwn(deps,'recoverySecrets'));step('browser');return f.browser;};
  f.deps.verifyBrowserResult=async(token,result)=>{assert.equal(result,f.browser);step('browser-verified');};
  f.deps.verifyAuthInventory=async(token,results)=>{assert.equal(results.browser,f.browser);assert.equal(results.inventory.kind,'INVENTORY');step('auth-exact');};
  f.deps.completeRestoreVerification=async()=>{step('proof');return{proof:{backupId:'pp1-20261102T160000000Z-'+'1'.repeat(32)},receipt:{withinRto:true},smoke:{}};};
  f.deps.publishRecoveryCandidate=async()=>{assert.equal(f.state.phase,'COMPLETE');step('locator');};return f;
}
test('PP1c_D_full_orchestrator_orders_separate_zero_auth_restart_source_and_release',async t=>{
  const f=await completeOrchestration(t),result=await restoreComplete(f.inspection,f.request,f.deps);
  assert.equal(result.phase,'COMPLETE');assert.equal(result.receipt.withinRto,true);assert.equal(result.token,undefined);
  assert.deepEqual(f.calls.slice(f.calls.indexOf('begin:STARTUP_VERIFIED')),[
    'begin:STARTUP_VERIFIED','startTargetApi:STARTUP_VERIFIED','stopTargetApi:STARTUP_VERIFIED','target:INVENTORY','zero:STARTUP_VERIFIED','end:STARTUP_VERIFIED',
    'begin:API_HEALTHY','startTargetApi:API_HEALTHY','end:API_HEALTHY','begin:INGRESS_STARTED','startTargetIngress:INGRESS_STARTED','end:INGRESS_STARTED',
    'begin:BROWSER_VERIFIED','browser-begin','browser','browser-verified','end:BROWSER_VERIFIED',
    'begin:TARGET_STOPPED','stopTargetIngress:TARGET_STOPPED','stopTargetApi:TARGET_STOPPED','target:INVENTORY','auth-exact','end:TARGET_STOPPED',
    'begin:RESTART_VERIFIED','startTargetApi:RESTART_VERIFIED','stopTargetApi:RESTART_VERIFIED','target:INVENTORY','zero:RESTART_VERIFIED','source:INVENTORY','proof','end:RESTART_VERIFIED','finish','locator']);
  assert.ok(f.calls.indexOf('clock-start')<f.calls.indexOf('begin'));assert.ok(f.calls.indexOf('proof')<f.calls.indexOf('finish'));
});
for(const fault of ['startTargetApi:STARTUP_VERIFIED','zero:STARTUP_VERIFIED','startTargetIngress:INGRESS_STARTED','browser','browser-verified','auth-exact','zero:RESTART_VERIFIED','proof','finish'])test(`PP1c_D_full_orchestrator_failure_at_${fault}_never_publishes_locator`,async t=>{
  const f=await completeOrchestration(t,{fail:fault});await assert.rejects(restoreComplete(f.inspection,f.request,f.deps),e=>e.code==='RESTORE_FAILED'&&e.phase!==null);
  assert.ok(!f.calls.includes('locator'));assert.equal(f.state.failed,true);
});
test('PP1c_D_full_orchestrator_unsealed_dependency_refuses_before_capture',async t=>{
  const f=await completeOrchestration(t);f.deps.verifyAuthInventory=null;
  await assert.rejects(restoreComplete(f.inspection,f.request,f.deps),{code:'ADAPTER_UNSEALED'});assert.ok(!f.calls.includes('begin'));
});

import {PassThrough} from 'node:stream';
import {run as restoreCli} from './local-restore.mjs';
async function ttySecrets(t,bytes,{tty=true,eof=false,raw=false,restoreFails=false}={}) {
  const stdin=new PassThrough();Object.assign(stdin,{isTTY:tty,isRaw:raw});const modes=[],messages=[];
  stdin.setRawMode=value=>{modes.push(value);if(!value&&restoreFails)throw Error('MODE_RESTORE_FAILED');stdin.isRaw=value;};
  const deps={stdin,stdout:{isTTY:true},stderr:{isTTY:true,write:value=>messages.push(value)}};
  t.after(()=>stdin.destroy());const module=await import('./local-restore.mjs');
  const promise=Promise.resolve().then(()=>module.readRecoverySecrets(deps));
  queueMicrotask(()=>{if(eof)stdin.end(bytes);else stdin.write(bytes);});
  return{promise,modes,messages,stdin};
}
test('PP1c_D_restore_TTY_reads_one_canonical_private_JSON_line_without_echo',async t=>{
  const secrets=inputs().recoverySecrets,f=await ttySecrets(t,canonicalBytes(secrets));assert.deepEqual(await f.promise,secrets);
  assert.deepEqual(f.messages,['Restore drill credentials (private JSON): ']);assert.deepEqual(f.modes,[true,false]);assert.equal(f.stdin.isRaw,false);
});
for(const fault of ['notty','EOF','overflow','duplicate','UTF8','extra-line','unknown-key'])test(`PP1c_D_restore_TTY_rejects_${fault}_and_restores_mode`,async t=>{
  const secrets=inputs().recoverySecrets;let bytes=canonicalBytes(secrets);
  if(fault==='EOF')bytes=bytes.subarray(0,bytes.length-1);if(fault==='overflow')bytes=Buffer.alloc(16385,120);
  if(fault==='duplicate')bytes=Buffer.from(`{"admin":${JSON.stringify(secrets.admin)},"admin":${JSON.stringify(secrets.admin)},"operator":${JSON.stringify(secrets.operator)}}\n`);
  if(fault==='UTF8')bytes=Buffer.from([0xc3,0x28,10]);if(fault==='extra-line')bytes=Buffer.concat([bytes,bytes]);
  if(fault==='unknown-key')bytes=canonicalBytes({...secrets,extra:true});
  const f=await ttySecrets(t,bytes,{tty:fault!=='notty',eof:fault==='EOF'});await assert.rejects(f.promise,e=>e.code==='INPUT_INVALID');
  assert.equal(f.stdin.isRaw,false);assert.ok(f.messages.every(value=>value==='Restore drill credentials (private JSON): '));
});
async function cliFixture(t) {
  const f=inputs(),cwd=await mkdtemp(join(tmpdir(),'pp1c-cli-')),root=join(cwd,'local/pp1',runId),chunks=[],events=[];
  t.after(()=>rm(cwd,{recursive:true,force:true}));await mkdir(root,{recursive:true,mode:0o700});
  await writeFile(join(root,'recovery-smoke-input.json'),canonicalBytes(f.smokeFixtureInput),{mode:0o600});
  const start=Object.freeze({}),backupId='pp1-20261102T160000000Z-'+'1'.repeat(32),inspection={target:{runId,targetId:`pp1-local:${runId}`,nodeBinarySha256:sha256(await readFile(process.execPath))}};
  const deps={cwd,now:()=>now,stdin:{isTTY:true},stdout:{isTTY:true,write:bytes=>chunks.push(bytes)},stderr:{isTTY:true,write:()=>{}},
    captureWorkflowStart:()=>{events.push('clock');return start;},readRecoverySecrets:async()=>{events.push('credentials');return f.recoverySecrets;},
    inspectTarget:async()=>{events.push('inspect');return inspection;},restoreLocal:async(actual,request,options)=>{
      assert.equal(actual,inspection);assert.equal(options.recoverySecrets,f.recoverySecrets);assert.deepEqual(options.smokeFixtureInput,f.smokeFixtureInput);assert.equal(options.workflowStart,start);
      assert.equal(request.completionPolicy,'KEEP_STOPPED');events.push('restore');return{backupId,phase:'COMPLETE',receipt:{withinRto:true}};}};
  return{...f,cwd,root,chunks,events,deps,backupId};
}
test('PP1c_D_restore_CLI_fixed_private_input_full_dispatch_and_canonical_receipt',async t=>{
  const f=await cliFixture(t);assert.equal(await restoreCli(cliArgs(),f.deps),0);
  assert.deepEqual(f.events,['clock','credentials','inspect','restore']);
  assert.equal(Buffer.concat(f.chunks).toString(),canonicalBytes({operationId:id(1),backupId:f.backupId,phase:'COMPLETE',code:null,exitCode:0}).toString());
  for(const a of Object.values(f.recoverySecrets))for(const key of ['password','oldSessionToken','username'])assert.ok(!Buffer.concat(f.chunks).includes(a[key]));
});
test('PP1c_D_restore_CLI_known_backup_failure_and_objective_miss_keep_factual_output',async t=>{
  const f=await cliFixture(t);f.deps.restoreLocal=async(i,r,deps)=>{deps.onProgress({operationId:r.operationId,backupId:f.backupId,phase:'LOCAL_VERIFIED'});throw new OpsError('SMOKE_FAILED','BROWSER_VERIFIED',r.operationId);};
  assert.equal(await restoreCli(cliArgs(),f.deps),8);assert.deepEqual(JSON.parse(Buffer.concat(f.chunks)),{operationId:id(1),backupId:f.backupId,phase:'BROWSER_VERIFIED',code:'SMOKE_FAILED',exitCode:8});
  const g=await cliFixture(t);g.deps.restoreLocal=async()=>({backupId:g.backupId,phase:'COMPLETE',receipt:{withinRto:false}});
  assert.equal(await restoreCli(cliArgs(),g.deps),11);assert.equal(JSON.parse(Buffer.concat(g.chunks)).code,'OBJECTIVE_MISSED');
});

test('PP1c_D_restore_TTY_does_not_return_credentials_if_mode_restore_fails',async t=>{
  const f=await ttySecrets(t,canonicalBytes(inputs().recoverySecrets),{restoreFails:true});
  await assert.rejects(f.promise,e=>e.code==='INPUT_INVALID');assert.deepEqual(f.messages,['Restore drill credentials (private JSON): ']);
});
test('PP1c_D_restore_TTY_preserves_prior_raw_mode',async t=>{
  const secrets=inputs().recoverySecrets,f=await ttySecrets(t,canonicalBytes(secrets),{raw:true});assert.deepEqual(await f.promise,secrets);
  assert.equal(f.stdin.isRaw,true);assert.deepEqual(f.modes,[true,true]);
});

test('PP1c_D_restore_cancellation_private_signal_reaches_browser_and_listeners_restore',async t=>{
  const f=await completeOrchestration(t),before=['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)),original=f.deps.runRestoreSmoke;
  f.deps.runRestoreSmoke=async(token,options,deps)=>{assert.ok(deps.signal instanceof AbortSignal);assert.equal(deps.signal.aborted,false);return original(token,options,deps);};
  await restoreComplete(f.inspection,f.request,f.deps);assert.deepEqual(['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)),before);
});
test('PP1c_D_restore_cancellation_caller_preabort_never_begins_workflow',async t=>{
  const f=await completeOrchestration(t);f.deps.signal=AbortSignal.abort();
  await assert.rejects(restoreComplete(f.inspection,f.request,f.deps),e=>e.code==='INTERRUPTED');assert.ok(!f.calls.includes('begin'));
});
test('PP1c_D_restore_cancellation_soft_signal_during_API_health_fails_and_restores_handlers',async t=>{
  const f=await completeOrchestration(t),before=['SIGINT','SIGTERM'].map(s=>process.listenerCount(s));
  f.deps.workflow.startTargetApi=async(token,deps)=>{assert.equal(token,f.token);process.emit('SIGTERM');assert.equal(deps.signal.aborted,true);throw new OpsError('INTERRUPTED');};
  await assert.rejects(restoreComplete(f.inspection,f.request,f.deps),e=>e.code==='INTERRUPTED'&&e.phase==='STARTUP_VERIFIED');
  assert.equal(f.state.failed,true);assert.ok(!f.calls.includes('browser'));assert.deepEqual(['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)),before);
});

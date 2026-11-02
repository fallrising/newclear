import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, link, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as store from './maintenance-store.mjs';
async function privateRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'pp1-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('PP1C_L01_v1_insertion_order_bytes_and_atomic_update', async t => {
  const root = await privateRoot(t), path = join(root, 'lease.json');
  const value = { version: 1, z: null, a: 'original' };
  await store.writeNew(path, value);
  assert.equal(await readFile(path, 'utf8'), '{"version":1,"z":null,"a":"original"}\n');
  await store.update(path, { z: 'next', a: null });
  assert.equal(await readFile(path, 'utf8'), '{"z":"next","a":null}\n');
  assert.deepEqual(await store.read(path), { z: 'next', a: null });
});
test('PP1C_L01_duplicate_reservation_preserves_existing_bytes', async t => {
  const root = await privateRoot(t), path = join(root, 'operation.json');
  await writeFile(path, '{"z":1,"a":2}\n', { mode: 0o600 });
  await assert.rejects(store.writeNew(path, { changed: true }), { code: 'EEXIST' });
  assert.equal(await readFile(path, 'utf8'), '{"z":1,"a":2}\n');
});
test('PP1C_L01_symlink_hardlink_and_mode_rejected', async t => {
  const root = await privateRoot(t), path = join(root, 'lease.json');
  await writeFile(path, '{}\n', { mode: 0o600 });
  await link(path, join(root, 'hard.json'));
  await assert.rejects(store.read(path), /QUIESCENCE_NOT_PROVEN/);
  await rm(join(root, 'hard.json')); await symlink(path, join(root, 'link.json'));
  await assert.rejects(store.read(join(root, 'link.json')), /QUIESCENCE_NOT_PROVEN/);
  await chmod(path, 0o644); await assert.rejects(store.read(path), /QUIESCENCE_NOT_PROVEN/);
});

const hash = 'a'.repeat(64), op = '11111111-1111-4111-8111-111111111111';
const run = 'b'.repeat(32), at = '2026-11-01T18:00:00.000Z';
function target(runId = run) {
  const project = `cms-pp1-local-${runId}`;
  return { version: 1, runId, targetId: `pp1-local:${runId}`, project, sourceCommit: 'c'.repeat(40),
    apiBuild: { sourceCommit: 'c'.repeat(40), jarSha256: hash, baseImage: `sha256:${hash}` },
    images: { api: `sha256:${hash}`, node: `sha256:${hash}`, postgres: `sha256:${hash}` },
    containerIds: { postgres: '1'.repeat(64), 'cms-api': '2'.repeat(64), ingress: '3'.repeat(64) },
    networkIds: { web: '4'.repeat(64), data: '5'.repeat(64) },
    volumeNames: { 'db-data': `${project}_db-data`, 'media-data': `${project}_media-data` },
    databaseOid: 1, ingressScriptSha256: hash, nodeBinarySha256: hash, mediaProbeSha256: hash };
}
const connection = () => ({ jdbcUrl: 'jdbc:postgresql://172.30.0.2:5432/cms', dataGateway: '172.30.0.1' });
function lease() {
  return { version: 2, operationId: op, purpose: 'BACKUP_LOCAL', releaseId: `sha256:${hash}`,
    phase: 'PRECHECK', createdAt: at, requestSha256: hash, source: target(), sourceConnection: connection(),
    originalApiState: 'running', completionPolicy: 'RESTORE_ORIGINAL', target: null, helper: null, proof: null, account: null };
}
const invalidLeases = [
  ['version', l => { l.version = 3; }], ['unknown', l => { l.password = 'canary'; }],
  ['missing', l => { delete l.helper; }], ['source_identity', l => { l.source.runId = 'bad'; }],
  ['source_unknown', l => { l.source.password = 'canary'; }],
  ['source_connection', l => { l.sourceConnection.jdbcUrl += '?password=canary'; }],
  ['operation', l => { l.operationId = 'A'.repeat(36); }], ['phase', l => { l.phase = 'COMMITTED'; }],
  ['source_release', l => { l.releaseId = `sha256:${'f'.repeat(64)}`; }],
  ['policy', l => { l.completionPolicy = 'KEEP_STOPPED'; }],
  ['time', l => { l.createdAt = '2026-02-30T00:00:00.000Z'; }],
  ['target_for_backup', l => { l.target = {}; }], ['proof_for_backup', l => { l.proof = {}; }],
  ['account_for_backup', l => { l.account = {}; }],
  ['helper_empty', l => { l.helper = {}; }],
  ['restore_missing_target', l => { l.purpose = 'RESTORE_VERIFY_LOCAL'; l.completionPolicy = 'KEEP_STOPPED'; l.phase = 'TARGET_RESERVED'; }],
  ['recover_running', l => { l.purpose = 'RECOVER_ADMIN'; l.completionPolicy = 'KEEP_STOPPED'; }]
];
for (const [name, mutate] of invalidLeases) test(`PP1C_L02_${name}`, () => {
  const value = lease(); mutate(value); assert.throws(() => store.validateLeaseV2(value), /INPUT_INVALID/);
});
test('PP1C_L02_valid_backup_phases_and_nested_required', () => {
  for (const phase of ['PRECHECK','SOURCE_QUIESCED','LOCAL_CAPTURED','LOCAL_VERIFIED','COMPLETE','FAILED_OR_UNKNOWN']) {
    const value = lease(); value.phase = phase; assert.equal(store.validateLeaseV2(value), value);
  }
  const paths = [[],['source'],['source','apiBuild'],['source','images'],['source','containerIds'],
    ['source','networkIds'],['source','volumeNames'],['sourceConnection']];
  for (const path of paths) for (const key of Object.keys(path.reduce((v,k)=>v[k],lease()))) {
    const value = lease(); delete path.reduce((v,k)=>v[k],value)[key];
    assert.throws(() => store.validateLeaseV2(value), /INPUT_INVALID/);
  }
});
import { canonicalBytes, sha256 } from '../ops/recovery-protocol.mjs';
function restoreLease() {
  const l = lease(); l.purpose = 'RESTORE_VERIFY_LOCAL'; l.completionPolicy = 'KEEP_STOPPED'; l.phase = 'TARGET_RESERVED';
  const runId = 'd'.repeat(32);
  l.target = { version: 1, runId, targetId: `pp1-local:${runId}`, project: `cms-pp1-local-${runId}`,
    sourceOperationId: op, creationPhase: 'RESERVED', identity: null, connection: null,
    preparationSha256: null, createdResourceSetSha256: null };
  return l;
}
test('PP1C_L02_restore_reserved_created_blank_and_no_second_source', () => {
  const l = restoreLease(); assert.equal(store.validateLeaseV2(l), l);
  const broken = structuredClone(l); broken.target.connection = connection();
  assert.throws(() => store.validateLeaseV2(broken), /INPUT_INVALID/);
  l.target.creationPhase = 'CREATED'; l.target.identity = target(l.target.runId);
  l.target.identity.containerIds = { postgres:'6'.repeat(64),'cms-api':'7'.repeat(64),ingress:'8'.repeat(64) };
  l.target.identity.networkIds = { web:'9'.repeat(64),data:'0'.repeat(64) };
  l.target.connection = connection(); l.target.preparationSha256 = hash; l.target.createdResourceSetSha256 = hash;
  assert.equal(store.validateLeaseV2(l), l);
  l.phase = 'DB_RESTORED'; assert.throws(() => store.validateLeaseV2(l), /INPUT_INVALID/);
  l.target.creationPhase = 'BLANK_VERIFIED'; assert.equal(store.validateLeaseV2(l), l);
  l.target.identity.containerIds.postgres = l.source.containerIds.postgres;
  assert.throws(() => store.validateLeaseV2(l), /INPUT_INVALID/);
});
test('PP1C_L02_helper_handshake_state_network_and_backend_bindings', () => {
  const l = lease(); l.phase = 'SOURCE_QUIESCED';
  l.helper = { kind:'INVENTORY',side:'source',fullContainerId:'9'.repeat(64),policySha256:hash,
    state:'CREATED',endpoint:null,backend:null,startedAt:at };
  assert.equal(store.validateLeaseV2(l), l);
  l.helper.state = 'READY'; assert.throws(() => store.validateLeaseV2(l), /INPUT_INVALID/);
  l.helper.endpoint = { networkId:l.source.networkIds.data,address:'172.30.0.4' };
  l.helper.backend = { pid:123,backendStartEpoch:'1234567890.000001',db:'cms',role:'cms_local',clientAddr:'172.30.0.4',applicationName:op };
  assert.equal(store.validateLeaseV2(l), l);
  for (const path of [[],['endpoint'],['backend']]) for (const key of Object.keys(path.reduce((v,k)=>v[k],l.helper))) {
    const broken = structuredClone(l); delete path.reduce((v,k)=>v[k],broken.helper)[key];
    assert.throws(() => store.validateLeaseV2(broken), /INPUT_INVALID/);
  }
  for (const mutate of [h => {h.side='target';},h => {h.backend.clientAddr='172.30.0.5';},
    h => {h.endpoint.networkId='f'.repeat(64);},h => {h.kind='PG_DUMP';},h => {h.kind='BROWSER';}]) {
    const broken = structuredClone(l); mutate(broken.helper); assert.throws(() => store.validateLeaseV2(broken), /INPUT_INVALID/);
  }
});
test('PP1C_L02_recover_proof_self_hash_and_account_phase', () => {
  const l = lease(); l.purpose='RECOVER_ADMIN'; l.originalApiState='stopped'; l.completionPolicy='KEEP_STOPPED';
  assert.equal(store.validateLeaseV2(l), l); l.phase='PROOF_REVALIDATED';
  assert.throws(() => store.validateLeaseV2(l), /INPUT_INVALID/);
  const p = { backupId:`pp1-20261101T180000000Z-${run}`,manifestSha256:hash,bundleSetSha256:hash,
    sourceInventorySha256:hash,sourceIdentitySha256:sha256(canonicalBytes(l.source)),restoreOperationId:op,
    restoreTargetId:`pp1-local:${'e'.repeat(32)}`,rawComparisonSha256:hash,sessionCommitSha256:hash,smokeSha256:hash };
  l.proof={...p,proofSha256:sha256(canonicalBytes(p))}; assert.equal(store.validateLeaseV2(l), l);
  l.phase='ACCOUNT_PRE_CONNECTION'; l.account={operation:'RECOVER_ADMIN',phase:'PRE_CONNECTION',boundBackend:null};
  assert.equal(store.validateLeaseV2(l), l); l.proof.proofSha256=hash;
  assert.throws(() => store.validateLeaseV2(l), /INPUT_INVALID/);
});
import { mkdir, lstat } from 'node:fs/promises';
async function registry(t) {
  const cwd = await privateRoot(t), root = join(cwd,'local/pp1',run);
  await mkdir(root,{recursive:true,mode:0o700});
  const inspection={target:target(),...connection()}, deps={cwd,clock:()=>Date.parse(at)};
  const request={operationId:op,purpose:'BACKUP_LOCAL',completionPolicy:'RESTORE_ORIGINAL',targetRunId:null,incidentStartedAt:null};
  return {cwd,root,inspection,request,deps};
}
test('PP1C_L04_BEGIN_without_END_is_incomplete_and_lock_retained', async t => {
  const f=await registry(t), r=await store.reserveWorkflow(f.inspection,f.request,{...f.deps,originalApiState:'stopped'});
  await store.persistWorkflow(r,'BEGIN','PRECHECK',{},f.deps);
  await assert.rejects(store.loadWorkflow(run,f.deps),/JOURNAL_INCOMPLETE/);
  assert.ok((await lstat(join(f.root,'maintenance/operation.lock'))).isDirectory());
  await store.persistWorkflow(r,'END','PRECHECK',{},f.deps);
  assert.equal((await store.loadWorkflow(run,f.deps)).lease.phase,'PRECHECK');
});
test('PP1C_L04_partial_bytes_and_unknown_sequence_fail_closed', async t => {
  const f=await registry(t), r=await store.reserveWorkflow(f.inspection,f.request,{...f.deps,originalApiState:'stopped'});
  await store.persistWorkflow(r,'BEGIN','PRECHECK',{},f.deps); await store.persistWorkflow(r,'END','PRECHECK',{},f.deps);
  const path=join(f.root,`maintenance/operations/${op}.json`), good=await readFile(path);
  await writeFile(path,good.subarray(0,good.length-3));
  await assert.rejects(store.loadWorkflow(run,f.deps),/JOURNAL_INCOMPLETE/);
  await writeFile(path,good); const j=JSON.parse(good);j.records[1].seq='3';
  await writeFile(path,canonicalBytes(j)); await assert.rejects(store.loadWorkflow(run,f.deps),/JOURNAL_INCOMPLETE/);
});
test('PP1C_L04_rename_or_sync_failure_never_releases_lock', async t => {
  for(const point of ['before-rename','before-directory-sync']) {
    const f=await registry(t),r=await store.reserveWorkflow(f.inspection,f.request,{...f.deps,originalApiState:'stopped'});
    await assert.rejects(store.persistWorkflow(r,'BEGIN','PRECHECK',{}, {...f.deps,fault:p=>{if(p===point)throw new Error('injected');}}));
    assert.ok((await lstat(join(f.root,'maintenance/operation.lock'))).isDirectory());
    await assert.rejects(store.releaseWorkflow(r,f.deps));
  }
});
test('PP1C_L04_FAIL_retains_original_phase_and_primary_failure', async t => {
  const f=await registry(t),r=await store.reserveWorkflow(f.inspection,f.request,{...f.deps,originalApiState:'stopped'});
  await store.persistWorkflow(r,'BEGIN','PRECHECK',{},f.deps);
  await store.persistWorkflow(r,'FAIL','PRECHECK',{failureCode:'CAPTURE_FAILED'},f.deps);
  const j=JSON.parse(await readFile(join(f.root,`maintenance/operations/${op}.json`)));
  assert.equal(j.records.at(-1).phase,'PRECHECK');assert.equal(j.records.at(-1).failureCode,'CAPTURE_FAILED');
  assert.equal(r.lease.phase,'FAILED_OR_UNKNOWN');await assert.rejects(store.releaseWorkflow(r,f.deps));
});
test('PP1C_L04_complete_requires_all_pairs_and_releases_only_owned_lock', async t => {
  const f=await registry(t),r=await store.reserveWorkflow(f.inspection,f.request,{...f.deps,originalApiState:'stopped'});
  await assert.rejects(store.persistWorkflow(r,'BEGIN','COMPLETE',{},f.deps),/JOURNAL_INCOMPLETE/);
  for(const phase of store.WORKFLOW_PHASES.BACKUP_LOCAL) {
    await store.persistWorkflow(r,'BEGIN',phase,{},f.deps);await store.persistWorkflow(r,'END',phase,{},f.deps);
  }
  await store.releaseWorkflow(r,f.deps);
  assert.equal((await store.loadWorkflow(run,f.deps)).identity,null);
});
test('PP1C_L04_inflight_metadata_requires_open_phase_and_final_hash', async t => {
  const f=await registry(t),r=await store.reserveWorkflow(f.inspection,f.request,{...f.deps,originalApiState:'stopped'});
  await assert.rejects(store.updatePendingWorkflow(r,{helper:null},f.deps),/JOURNAL_INCOMPLETE/);
  await store.persistWorkflow(r,'BEGIN','PRECHECK',{},f.deps);await store.persistWorkflow(r,'END','PRECHECK',{},f.deps);
  await store.persistWorkflow(r,'BEGIN','SOURCE_QUIESCED',{},f.deps);
  const helper={kind:'MEDIA_PACK',side:'source',fullContainerId:'9'.repeat(64),policySha256:hash,state:'CREATED',endpoint:null,backend:null,startedAt:at};
  await store.updatePendingWorkflow(r,{helper},f.deps);
  assert.deepEqual((await store.loadWorkflow(run,f.deps,{allowPending:true})).lease.helper,helper);
  await store.updatePendingWorkflow(r,{helper:null},f.deps);
  await store.persistWorkflow(r,'END','SOURCE_QUIESCED',{},f.deps);
  assert.equal(r.journal.records.at(-1).leaseSha256,sha256(canonicalBytes(r.lease)));
});
test('PP1C_L05_only_complete_END_and_absent_lock_is_released', async t => {
  const f=await registry(t),r=await store.reserveWorkflow(f.inspection,f.request,{...f.deps,originalApiState:'stopped'});
  await assert.rejects(store.assertPriorReleased(run,f.deps));
  for(const phase of store.WORKFLOW_PHASES.BACKUP_LOCAL) {
    await store.persistWorkflow(r,'BEGIN',phase,{},f.deps);await store.persistWorkflow(r,'END',phase,{},f.deps);
  }
  await assert.rejects(store.assertPriorReleased(run,f.deps));
  await store.releaseWorkflow(r,f.deps);assert.equal((await store.assertPriorReleased(run,f.deps)).lease.version,2);
  const next={...f.request,operationId:'22222222-2222-4222-8222-222222222222'};
  const second=await store.reserveWorkflow(f.inspection,next,{...f.deps,originalApiState:'stopped'});
  assert.equal(second.lease.operationId,next.operationId);
});
test('PP1C_L05_unknown_version_and_noncanonical_v2_never_fall_back', async t => {
  const f=await registry(t);await store.reserveWorkflow(f.inspection,f.request,{...f.deps,originalApiState:'stopped'});
  const path=join(f.root,'maintenance/lease.json'), original=await readFile(path);
  await writeFile(path,original.toString().replace('"version":2','"version":3'));
  await assert.rejects(store.loadRegistry(run,f.deps));
  await writeFile(path,` ${original}`);await assert.rejects(store.loadRegistry(run,f.deps));
});
import { dispatchGuard } from './maintenance-guard.mjs';
test('PP1C_L05_v2_inspect_is_readonly_and_account_bridge_unsealed', async t => {
  const f=await registry(t),r=await store.reserveWorkflow(f.inspection,f.request,{...f.deps,originalApiState:'stopped'});
  await store.persistWorkflow(r,'BEGIN','PRECHECK',{},f.deps);await store.persistWorkflow(r,'END','PRECHECK',{},f.deps);
  const before=await readFile(join(f.root,'maintenance/lease.json'));
  assert.deepEqual(await dispatchGuard(['inspect','--run-id',run],f.deps),{operationId:op,phase:'PRECHECK'});
  await assert.rejects(dispatchGuard(['assert','--run-id',run,'--operation-id',op,'--phase','pre-connection'],f.deps),/ADAPTER_UNSEALED/);
  assert.deepEqual(await readFile(join(f.root,'maintenance/lease.json')),before);
});
test('PP1C_L04_invalid_request_is_rejected_before_registry_mkdir',async t=>{
  for(const change of [{completionPolicy:'KEEP_STOPPED'},{incidentStartedAt:at},
    {purpose:'RESTORE_VERIFY_LOCAL',completionPolicy:'KEEP_STOPPED',targetRunId:'d'.repeat(32),incidentStartedAt:'2099-01-01T00:00:00.000Z'}]) {
    const f=await registry(t);
    await assert.rejects(store.reserveWorkflow(f.inspection,{...f.request,...change},{...f.deps,originalApiState:'stopped'}),/INPUT_INVALID/);
    await assert.rejects(lstat(join(f.root,'maintenance')),{code:'ENOENT'});
  }
});
test('PP1C_H02b1_endpoint_state_null_matrix',()=>{
  for(const state of ['CREATED','RUNNING','READY','PERMITTED','EXITED'])for(const hasEndpoint of [false,true]) {
    const l=lease();l.phase='LOCAL_CAPTURED';
    l.helper={kind:'INVENTORY',side:'source',fullContainerId:'f'.repeat(64),policySha256:hash,state,startedAt:at,
      endpoint:hasEndpoint?{networkId:l.source.networkIds.data,address:'172.30.0.4'}:null,
      backend:['READY','PERMITTED'].includes(state)?{pid:1,backendStartEpoch:'1770000000.123',db:'cms',role:'cms_local',clientAddr:'172.30.0.4',applicationName:op}:null};
    if(state==='CREATED'?!hasEndpoint:state==='EXITED'||hasEndpoint)assert.equal(store.validateLeaseV2(l),l);
    else assert.throws(()=>store.validateLeaseV2(l));
  }
});

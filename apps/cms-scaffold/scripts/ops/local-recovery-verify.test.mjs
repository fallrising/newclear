import { appendFileSync, mkdirSync } from 'node:fs';
import { validateInventory } from './local-media.mjs';
import { readonlyRunnerFixture } from '../local/maintenance-readonly-runner.fixture.mjs';
import { smokeContextFixture, liveAuthFixture, finalProofFixture, persistedProofFixture, releasedSourceFixture } from './local-recovery-released.fixture.mjs';
import { authId, authHash, authRehash, authRows, authFixture } from './local-recovery-auth.fixture.mjs';
import { WORKFLOW_PHASES, validateLeaseV2, validateJournalV2, reserveWorkflow, persistWorkflow, loadWorkflow } from '../local/maintenance-store.mjs';
import { verifiedHelperProfile } from '../local/maintenance-helper.mjs';
import { spawnSync } from 'node:child_process';
import * as verifier from './local-recovery-verify.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, symlink, chmod, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, rawFixture, revocationFixture, rehashInventory, revokedFixture, inventory } from './local-recovery.fixture.mjs';
import { captureSource } from './local-bundle.mjs';
import { canonicalBytes, sha256 } from './recovery-protocol.mjs';
import { verifyCapturedBundle, protectCapturedBundle, restoreBundleMaterial, compareRestoredBundle } from './local-recovery-verify.mjs';
async function captured(t) {
  const f=await fixture(t);f.ctx.lease.purpose='RESTORE_VERIFY_LOCAL';
  const result=await captureSource(f.token,f.deps);return {...f,result};
}
test('PP1c_C09_valid_private_bundle_verifies_without_target_mutation',async t=>{
  const f=await captured(t),value=await verifyCapturedBundle(f.token,f.result.backupId,f.deps);
  assert.equal(value.manifest.backupId,f.result.backupId);assert.equal(value.inventory.tables.length,20);
  assert.deepEqual(value.path,f.result.path);assert.ok(!f.calls.some(x=>x.includes('TARGET')));
});
for(const scenario of ['changed_artifact','noncanonical_marker','symlink_artifact'])test(`PP1c_C09_${scenario}_rejected_before_target_write`,async t=>{
  const f=await captured(t),path=f.result.path;
  if(scenario==='changed_artifact')await writeFile(join(path,'db.dump'),'truncated',{mode:0o600});
  if(scenario==='noncanonical_marker')await writeFile(join(path,'local-complete.json'),'{ "version": 1 }\n',{mode:0o600});
  if(scenario==='symlink_artifact'){await rename(join(path,'inventory.json'),join(path,'saved-inventory'));await symlink('saved-inventory',join(path,'inventory.json'));}
  await assert.rejects(verifyCapturedBundle(f.token,f.result.backupId,f.deps),e=>e.code===(scenario==='noncanonical_marker'?'INPUT_INVALID':'BUNDLE_MISMATCH'));
  assert.ok(!f.calls.some(x=>x.includes('TARGET')));
});

for(const scenario of ['extra_bundle_file','public_bundle_directory'])test(`PP1c_C10a1_${scenario}_rejects_fixed_layout`,async t=>{
  const f=await captured(t);
  if(scenario==='extra_bundle_file')await writeFile(join(f.result.path,'unexpected'),'extra',{mode:0o600});
  else await chmod(f.result.path,0o755);
  await assert.rejects(verifyCapturedBundle(f.token,f.result.backupId,f.deps),e=>e.code==='BUNDLE_MISMATCH');
});

for(const scenario of ['api_image','frontend','config','migration','java_version','pg_version','artifact_build'])test(`PP1c_C10a2_${scenario}_lineage_rejects_coherent_marker`,async t=>{
  const f=await captured(t),path=f.result.path;
  const m=JSON.parse(await readFile(join(path,'manifest.json')));
  if(scenario==='api_image')m.release.apiImageDigest='sha256:'+'0'.repeat(64);
  if(scenario==='frontend')m.release.frontend.front.artifactSha256='0'.repeat(64);
  if(scenario==='config')m.release.configSha256='0'.repeat(64);
  if(scenario==='migration')m.migration[0].checksum='123';
  if(scenario==='java_version'){m.release.javaRuntimeVersion='25.9';m.toolchain.inventoryJavaVersion='25.9';}
  if(scenario==='pg_version')m.toolchain.pgDumpVersion='16.14';
  if(scenario==='artifact_build'){
    const a=JSON.parse(await readFile(join(f.root,'artifacts.json')));a.apiBuild.jarSha256='0'.repeat(64);
    await writeFile(join(f.root,'artifacts.json'),JSON.stringify(a),{mode:0o600});
  }
  await writeFile(join(path,'manifest.json'),canonicalBytes(m));
  await writeFile(join(path,'local-complete.json'),canonicalBytes({...f.result.complete,manifestSha256:sha256(canonicalBytes(m))}));
  await assert.rejects(verifyCapturedBundle(f.token,f.result.backupId,f.deps),e=>e.code==='SOURCE_CHANGED');
  assert.ok(!f.calls.some(x=>x.includes('TARGET')));
});

test('PP1c_C10a2_profile_rejects_forged_capability',async()=>{await assert.rejects(verifiedHelperProfile({}),e=>e.code==='ADAPTER_UNSEALED');});

test('PP1c_C10a2_private_copy_is_exclusive_rehashed_and_never_offsite',async t=>{
  const f=await captured(t),verified=await verifyCapturedBundle(f.token,f.result.backupId,f.deps);
  const copy=await protectCapturedBundle(f.token,verified,f.deps);
  assert.equal(copy.path,join(f.root,'protected-copy',f.result.backupId));
  assert.equal((await lstat(copy.path)).mode&0o777,0o700);
  assert.deepEqual((await readdir(copy.path)).sort(),(await readdir(f.result.path)).sort());
  for(const name of await readdir(copy.path)){
    const file=await lstat(join(copy.path,name));assert.equal(file.mode&0o777,0o600);assert.equal(file.nlink,1);
    assert.notEqual(file.ino,(await lstat(join(f.result.path,name))).ino);
    assert.equal(sha256(await readFile(join(copy.path,name))),sha256(await readFile(join(f.result.path,name))));
  }
  assert.equal(Object.hasOwn(copy,'verifiedOffsiteAt'),false);
  await assert.rejects(protectCapturedBundle(f.token,verified,f.deps),e=>e.code==='BUNDLE_MISMATCH');
});
test('PP1c_C10a2_copy_rejects_json_authority_and_changed_source_before_directory_creation',async t=>{
  const f=await captured(t),verified=await verifyCapturedBundle(f.token,f.result.backupId,f.deps);
  await assert.rejects(protectCapturedBundle(f.token,structuredClone(verified),f.deps),e=>e.code==='ADAPTER_UNSEALED');
  await writeFile(join(f.result.path,'media.package'),'bad');
  await assert.rejects(protectCapturedBundle(f.token,verified,f.deps),e=>e.code==='BUNDLE_MISMATCH');
  await assert.rejects(lstat(join(f.root,'protected-copy')),{code:'ENOENT'});
});
test('PP1c_C10a2_copy_capacity_refusal_preserves_complete_source',async t=>{
  const f=await captured(t),verified=await verifyCapturedBundle(f.token,f.result.backupId,f.deps);
  const before=await readFile(join(f.result.path,'local-complete.json'));
  await assert.rejects(protectCapturedBundle(f.token,verified,{...f.deps,statfs:async()=>({bavail:0n,bsize:4096n})}),e=>e.code==='CAPTURE_FAILED');
  assert.deepEqual(await readFile(join(f.result.path,'local-complete.json')),before);
  await assert.rejects(lstat(join(f.root,'protected-copy')),{code:'ENOENT'});
});

test('PP1c_C10a2_restore_material_requires_original_token_and_rechecks_both_copies',async t=>{
  const f=await captured(t),verified=await verifyCapturedBundle(f.token,f.result.backupId,f.deps);
  const copy=await protectCapturedBundle(f.token,verified,f.deps);
  const material=await restoreBundleMaterial(f.token,f.deps);assert.equal(material.path,copy.path);assert.equal(material.backupId,f.result.backupId);
  await assert.rejects(restoreBundleMaterial({},f.deps),e=>e.code==='ADAPTER_UNSEALED');
  await writeFile(join(copy.path,'db.dump'),'changed');
  await assert.rejects(restoreBundleMaterial(f.token,f.deps),e=>e.code==='BUNDLE_MISMATCH');
});

test('PP1c_C10b1_full_twenty_table_comparison_persists_private_receipt',async t=>{
  const f=await rawFixture(t,{files:true});
  const receipt=await compareRestoredBundle(f.token,f.results,f.deps);
  assert.equal(receipt.equal,true);assert.equal(receipt.tables.length,20);
  assert.ok(receipt.tables.every(t=>t.schemaEqual&&t.rowsEqual));
  assert.equal(receipt.files.sourceCount,'1');assert.equal(receipt.files.changedCount,'0');
  const file=join(f.base,'operations',f.ctx.operationId,'raw-comparison.json');
  const bytes=await readFile(file);assert.deepEqual(JSON.parse(bytes),receipt);
  assert.equal((await lstat(file)).mode&0o777,0o600);
  assert.equal((await restoreBundleMaterial(f.token,f.deps)).rawProofSha256,sha256(bytes));
});
for(const scenario of ['same_count_permission','schema','flyway','file_hash'])test(`PP1c_C10b1_${scenario}_records_false_and_never_grants_revoke`,async t=>{
  const f=await rawFixture(t,{files:true,mutateTarget:v=>{
    if(scenario==='same_count_permission')v.tables.find(t=>t.tableName==='cms_permission').rows[0].action='write';
    if(scenario==='schema')v.tables[0].schema.columns[0].columnDefault='changed';
    if(scenario==='flyway')v.tables.find(t=>t.tableName==='flyway_schema_history').rows[0].checksum='123';
    if(scenario==='file_hash')v.files[0].sha256='0'.repeat(64);
  }});
  await assert.rejects(compareRestoredBundle(f.token,f.results,f.deps),e=>e.code==='RAW_MISMATCH');
  const receipt=JSON.parse(await readFile(join(f.base,'operations',f.ctx.operationId,'raw-comparison.json')));
  assert.equal(receipt.equal,false);assert.equal(receipt.tables.length,20);
  assert.equal((await restoreBundleMaterial(f.token,f.deps)).rawProofSha256,null);
});
test('PP1c_C10b1_inventory_JSON_lookalike_has_no_authority',async t=>{
  const f=await rawFixture(t);
  await assert.rejects(compareRestoredBundle(f.token,{...f.results,target:structuredClone(f.results.target)},f.deps),e=>e.code==='ADAPTER_UNSEALED');
  await assert.rejects(lstat(join(f.base,'operations',f.ctx.operationId,'raw-comparison.json')),{code:'ENOENT'});
});

test('PP1c_C10b2_strict_raw_receipt_validator_binds_current_identities',async t=>{
  const f=await rawFixture(t),receipt=await compareRestoredBundle(f.token,f.results,f.deps);
  assert.equal(typeof verifier.validateRawComparison,'function');
  const context={operationId:f.ctx.operationId,sourceIdentity:f.ctx.target,targetIdentity:f.child,
    sourceInventory:f.captured.inventory,targetInventory:JSON.parse(await readFile(f.results.target.path)),targetInventorySha256:f.results.target.sha256};
  assert.equal(verifier.validateRawComparison(receipt,f.captured.manifest,context),receipt);
});
test('PP1c_C10b2_native_verifier_cli_cannot_silently_succeed',()=>{
  const result=spawnSync(process.execPath,['scripts/ops/local-recovery-verify.mjs'],{encoding:'utf8'});
  assert.equal(result.status,2);assert.equal(result.stderr,'');
  assert.equal(JSON.parse(result.stdout).code,'INPUT_INVALID');
});
test('PP1c_C10b2_receipt_schema_and_claims_cannot_override_full_payload',async t=>{
  const f=await rawFixture(t,{files:true}),receipt=await compareRestoredBundle(f.token,f.results,f.deps);
  const context={operationId:f.ctx.operationId,sourceIdentity:f.ctx.target,targetIdentity:f.child,
    sourceInventory:f.captured.inventory,targetInventory:JSON.parse(await readFile(f.results.target.path)),targetInventorySha256:f.results.target.sha256};
  const alterations=[
    r=>{r.extra=true;},r=>{delete r.assetsEqual;},r=>{r.tables.reverse();},r=>{r.tables[0].extra=true;},
    r=>{r.tables[0].rowsEqual='true';},r=>{r.tables[0].sourceRowCount='00';},r=>{r.tables[0].sourceRowsSha256='0'.repeat(64);},
    r=>{r.operationId='0'.repeat(36);},r=>{r.sourceTargetId=r.targetTargetId;},r=>{r.targetIdentitySha256='0'.repeat(64);},
    r=>{r.releaseId='sha256:'+'0'.repeat(64);},r=>{r.sourceInventorySha256='0'.repeat(64);},
    r=>{r.files.changedCount='1';},r=>{r.files.targetBytes='4';},r=>{r.files.sourceHeaderSha256='0'.repeat(64);},
    r=>{r.comparedAt='2026-02-30T00:00:00.000Z';},r=>{r.comparedAt='2020-01-01T00:00:00.000Z';},
    r=>{r.flywayEqual=false;},r=>{r.equal=false;}
  ];
  for(const alter of alterations){const changed=structuredClone(receipt);alter(changed);
    assert.throws(()=>verifier.validateRawComparison(changed,f.captured.manifest,context),e=>e.code==='BUNDLE_MISMATCH');}
  assert.throws(()=>verifier.validateRawComparison(receipt,f.captured.manifest,{...context,targetInventorySha256:'0'.repeat(64)}),e=>e.code==='BUNDLE_MISMATCH');
});
test('PP1c_C10b2_false_receipt_is_valid_evidence_but_true_lie_is_rejected',async t=>{
  const f=await rawFixture(t,{mutateTarget:v=>{v.tables.find(t=>t.tableName==='cms_permission').rows[0].action='write';}});
  await assert.rejects(compareRestoredBundle(f.token,f.results,f.deps),e=>e.code==='RAW_MISMATCH');
  const receipt=JSON.parse(await readFile(join(f.base,'operations',f.ctx.operationId,'raw-comparison.json')));
  const context={operationId:f.ctx.operationId,sourceIdentity:f.ctx.target,targetIdentity:f.child,
    sourceInventory:f.captured.inventory,targetInventory:JSON.parse(await readFile(f.results.target.path)),targetInventorySha256:f.results.target.sha256};
  assert.equal(verifier.validateRawComparison(receipt,f.captured.manifest,context),receipt);
  receipt.tables.find(t=>t.tableName==='cms_permission').rowsEqual=true;receipt.equal=true;
  assert.throws(()=>verifier.validateRawComparison(receipt,f.captured.manifest,context),e=>e.code==='BUNDLE_MISMATCH');
});
test('PP1c_C10b2_source_after_drift_refuses_completed_receipt',async t=>{
  const f=await rawFixture(t,{mutateSource:v=>{v.tables.find(t=>t.tableName==='cms_permission').rows[0].action='write';}});
  await assert.rejects(compareRestoredBundle(f.token,f.results,f.deps),e=>e.code==='WRITER_NOT_QUIESCED');
  await assert.rejects(lstat(join(f.base,'operations',f.ctx.operationId,'raw-comparison.json')),{code:'ENOENT'});
  assert.equal((await restoreBundleMaterial(f.token,f.deps)).rawProofSha256,null);
});
test('PP1c_C10b2_public_cli_reaches_source_guard_and_import_is_idle',async()=>{
  const args=['--run-id','a'.repeat(32),'--backup-id','pp1-20261102T120000000Z-'+'b'.repeat(32),
    '--restore-operation-id','11111111-1111-4111-8111-111111111111'];
  const result=spawnSync(process.execPath,['scripts/ops/local-recovery-verify.mjs',...args],{encoding:'utf8',env:{PATH:''},timeout:5000});
  assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.notEqual(result.status,13);assert.equal(result.stderr,'');
  assert.notEqual(JSON.parse(result.stdout).code,'ADAPTER_UNSEALED');assert.equal(JSON.parse(result.stdout).exitCode,result.status);
  for(const invalid of [[],[...args,'--force','yes'],[...args.slice(0,4),'--run-id','a'.repeat(32)]])
    assert.throws(()=>verifier.parseArgs(invalid),e=>e.code==='INPUT_INVALID');
  const imported=spawnSync(process.execPath,['--input-type=module','-e',"await import('./scripts/ops/local-recovery-verify.mjs')"],{encoding:'utf8'});
  assert.equal(imported.status,0);assert.equal(imported.stdout,'');assert.equal(imported.stderr,'');
});

test('PP1c_C14n1_only_exact_all_session_revoke_and_single_AUTH_delta_is_accepted',()=>{
  const f=revocationFixture();assert.equal(verifier.verifyRevocationDelta(f.raw,f.after,f.receipt,f.context),true);
});
for(const fault of ['skip-expired','old-revoked','extra-session','session-column','extra-audit','audit-detail','audit-actor','permission','schema','orphan-bytes','receipt'])
test(`PP1c_C14n1_rejects_${fault}_despite_coherent_inventory_hashes`,()=>{
  const f=revocationFixture(),table=name=>f.after.tables.find(t=>t.tableName===name);
  if(fault==='skip-expired')table('cms_session').rows[0].revoked_at=null;
  if(fault==='old-revoked')table('cms_session').rows[2].revoked_at=table('cms_session').rows[0].revoked_at;
  if(fault==='extra-session')table('cms_session').rows.push({...table('cms_session').rows[0],id:'50000000-0000-4000-8000-000000000005'});
  if(fault==='session-column')table('cms_session').rows[0].last_seen_at='2026-11-02 12:00:00+00';
  if(fault==='extra-audit')table('cms_audit_event').rows.push({...table('cms_audit_event').rows[0],id:'50000000-0000-4000-8000-000000000005'});
  if(fault==='audit-detail')table('cms_audit_event').rows[0].detail_json=JSON.stringify({...JSON.parse(table('cms_audit_event').rows[0].detail_json),extra:true});
  if(fault==='audit-actor')table('cms_audit_event').rows[0].actor_principal_id=f.raw.tables.find(t=>t.tableName==='cms_session').rows[0].principal_id;
  if(fault==='permission')table('cms_permission').rows.push(Object.fromEntries(table('cms_permission').schema.columns.map(c=>[c.name,null])));
  if(fault==='schema')table('cms_session').schema.columns[0].columnDefault='changed';
  if(fault==='orphan-bytes')f.after.files.push({objectKey:'extra.bin',byteSize:'1',sha256:'0'.repeat(64),classification:'orphan'});
  if(fault==='receipt')f.receipt.revokedCount='1';
  for(const row of f.after.tables)row.rows.sort((a,b)=>Buffer.compare(canonicalBytes(a),canonicalBytes(b)));
  rehashInventory(f.after);
  assert.throws(()=>verifier.verifyRevocationDelta(f.raw,f.after,f.receipt,f.context),e=>e.code==='SESSION_REVOKE_FAILED');
});
test('PP1c_C14n2_token_bound_commit_and_post_inventory_prove_exact_revocation',async t=>{
  const f=await revokedFixture(t),result=await verifier.verifyRevokedBundle(f.token,{commit:f.commit,inventory:f.inventory},f.deps);
  assert.equal(result.revokedCount,'2');assert.equal(result.auditEventId,f.receipt.auditEventId);
  const path=join(f.base,'operations',f.ctx.operationId,'inventories/target-revoked.json');
  assert.deepEqual(JSON.parse(await readFile(path)),f.post);assert.equal((await lstat(path)).mode&0o777,0o600);
});
for(const fault of ['commit-clone','inventory-clone','request-hash','raw-baseline','permission-drift'])test(`PP1c_C14n2_rejects_${fault}_without_post_revoke_acceptance`,async t=>{
  const f=await revokedFixture(t);let commit=f.commit,inventory=f.inventory;
  if(fault==='commit-clone')commit=structuredClone(commit);
  if(fault==='inventory-clone')inventory=structuredClone(inventory);
  if(fault==='request-hash')await writeFile(join(f.base,'operations',f.ctx.operationId,'helper/9/request.json'),'{}\n');
  if(fault==='raw-baseline')await writeFile(join(f.base,'operations',f.ctx.operationId,'inventories/target-raw.json'),'{}\n');
  if(fault==='permission-drift'){
    f.post.tables.find(t=>t.tableName==='cms_permission').rows[0].action='write';
    f.ctx.helperSequence=11;inventory=await f.issueInventory('target','11',f.post);
  }
  await assert.rejects(verifier.verifyRevokedBundle(f.token,{commit,inventory},f.deps),e=>e.code===(fault==='raw-baseline'?'BUNDLE_MISMATCH':fault==='permission-drift'?'SESSION_REVOKE_FAILED':'ADAPTER_UNSEALED'));
  await assert.rejects(lstat(join(f.base,'operations',f.ctx.operationId,'inventories/target-revoked.json')),{code:'ENOENT'});
});

// T152: independent inspected JAR identity, never the manifest's Docker image digest.
function rawContext(f) {
  return {operationId:f.ctx.operationId,sourceIdentity:f.ctx.target,targetIdentity:f.child,
    sourceInventory:f.captured.inventory,targetInventory:f.captured.inventory,targetInventorySha256:f.results.target.sha256};
}
async function imageReleaseSubstitution(f,result,slot,change) {
  const field=slot==='commit'?'commitAuthority':'inventoryAuthority',original=f.deps[field];
  const metadata=await original(f.token,result),altered={...metadata};
  const identity=slot==='source'?f.ctx.target:f.child;
  if(change!=='request')altered.releaseId=identity.images.api;
  if(change!=='authority') {
    const path=join(f.base,'operations',f.ctx.operationId,'helper',metadata.seq,'request.json');
    const request=JSON.parse(await readFile(path));request.releaseId=identity.images.api;
    const bytes=canonicalBytes(request);await writeFile(path,bytes);altered.requestSha256=sha256(bytes);
  }
  f.deps[field]=async(token,value)=>value===result?altered:original(token,value);
}
test('T152_raw_producer_and_pure_validator_require_jar_release_and_retain_image_pin',async t=>{
  const f=await rawFixture(t),jar=`sha256:${f.ctx.target.apiBuild.jarSha256}`;
  assert.notEqual(jar,f.ctx.target.images.api);
  for(const side of ['source','target']) {
    const authority=await f.deps.inventoryAuthority(f.token,f.results[side]);
    const request=JSON.parse(await readFile(join(f.base,'operations',f.ctx.operationId,'helper',authority.seq,'request.json')));
    assert.equal(authority.releaseId,jar);assert.equal(request.releaseId,jar);
    assert.equal(authority.requestSha256,sha256(canonicalBytes(request)));
  }
  const receipt=await compareRestoredBundle(f.token,f.results,f.deps),context=rawContext(f);
  assert.equal(receipt.releaseId,jar);assert.equal(f.captured.manifest.release.apiImageDigest,f.ctx.target.images.api);
  assert.equal(verifier.validateRawComparison(receipt,f.captured.manifest,context),receipt);
  assert.throws(()=>verifier.validateRawComparison({...receipt,releaseId:f.ctx.target.images.api},f.captured.manifest,context),e=>e.code==='BUNDLE_MISMATCH');
  const changed=structuredClone(f.captured.manifest);changed.release.apiImageDigest=jar;
  assert.throws(()=>verifier.validateRawComparison({...receipt,manifestSha256:sha256(canonicalBytes(changed))},changed,context),e=>e.code==='BUNDLE_MISMATCH');
});
for(const side of ['source','target'])for(const change of ['authority','request','both']) {
  test(`T152_raw_${side}_image_release_${change}_rejected_before_receipt`,async t=>{
    const f=await rawFixture(t);await imageReleaseSubstitution(f,f.results[side],side,change);
    await assert.rejects(compareRestoredBundle(f.token,f.results,f.deps),e=>e.code==='ADAPTER_UNSEALED');
    await assert.rejects(lstat(join(f.base,'operations',f.ctx.operationId,'raw-comparison.json')),{code:'ENOENT'});
  });
}
test('T152_revocation_jar_authority_and_request_bind_commit_and_post_inventory',async t=>{
  const f=await revokedFixture(t),jar=`sha256:${f.child.apiBuild.jarSha256}`;
  assert.notEqual(jar,f.child.images.api);
  for(const [value,authority]of [[f.commit,f.deps.commitAuthority],[f.inventory,f.deps.inventoryAuthority]]) {
    const metadata=await authority(f.token,value);
    const request=JSON.parse(await readFile(join(f.base,'operations',f.ctx.operationId,'helper',metadata.seq,'request.json')));
    assert.equal(metadata.releaseId,jar);assert.equal(request.releaseId,jar);
    assert.equal(metadata.requestSha256,sha256(canonicalBytes(request)));
  }
  const receipt=await verifier.verifyRevokedBundle(f.token,{commit:f.commit,inventory:f.inventory},f.deps);
  assert.equal(receipt.revokedCount,'2');
  assert.deepEqual(Object.keys(f.commit.receipt).sort(),'operationId backupId revokedCount auditEventId committed'.split(' ').sort());
  assert.equal(receipt.targetInventorySha256,f.inventory.sha256);
});
for(const slot of ['commit','inventory'])for(const change of ['authority','request','both']) {
  test(`T152_revoke_${slot}_image_release_${change}_rejected_before_acceptance`,async t=>{
    const f=await revokedFixture(t);await imageReleaseSubstitution(f,f[slot],slot,change);
    await assert.rejects(verifier.verifyRevokedBundle(f.token,{commit:f.commit,inventory:f.inventory},f.deps),e=>e.code==='ADAPTER_UNSEALED');
    await assert.rejects(lstat(join(f.base,'operations',f.ctx.operationId,'inventories/target-revoked.json')),{code:'ENOENT'});
  });
}


// T156: compare only approved directed CHECK pairs; every stored hash stays raw.
const checkPolicy = JSON.parse(await readFile(new URL('../../docs/v2/contracts/fixtures/pp1c-check-definition-pairs-v1.json', import.meta.url)));
function checkInventory() {
  const value = inventory();
  for (const pair of checkPolicy.pairs) {
    const table = value.tables.find(t => t.tableName === pair.tableName);
    table.schema.constraints.push({...pair.constraintMetadata, definition: pair.sourceDefinition});
    table.schema.constraints.sort((a, b) => a.name.localeCompare(b.name));
  }
  return rehashInventory(value);
}
function restoreCheckPairs(value, selected = checkPolicy.pairs) {
  for (const pair of selected) {
    const table = value.tables.find(t => t.tableName === pair.tableName);
    table.schema.constraints.find(c => c.name === pair.constraintName).definition = pair.restoredDefinition;
  }
}
async function checkFixture(t, {selected, mutateTarget, mutateSource, configure, baseInventory = checkInventory()} = {}) {
  return rawFixture(t, {
    baseInventory: rehashInventory(baseInventory),
    configure: async f => {
      f.ctx.target.images.postgres = checkPolicy.postgresImageDigest;
      await configure?.(f);
    },
    mutateTarget: value => { restoreCheckPairs(value, selected); mutateTarget?.(value); },
    mutateSource
  });
}
async function checkRawContext(f) {
  return {operationId: f.ctx.operationId, sourceIdentity: f.ctx.target, targetIdentity: f.child,
    sourceInventory: f.captured.inventory, targetInventory: JSON.parse(await readFile(f.results.target.path)),
    targetInventorySha256: f.results.target.sha256};
}
test('T156_all_nine_directed_CHECK_pairs_pass_live_and_pure_with_distinct_raw_hashes', async t => {
  const f = await checkFixture(t), before = canonicalBytes(f.captured.inventory);
  const receipt = await compareRestoredBundle(f.token, f.results, f.deps), context = await checkRawContext(f);
  assert.equal(verifier.validateRawComparison(receipt, f.captured.manifest, context), receipt);
  assert.equal(receipt.equal, true);
  assert.equal(receipt.tables.filter(row => row.sourceSchemaSha256 !== row.targetSchemaSha256).length, 7);
  assert.notEqual(receipt.sourceInventorySha256, receipt.targetInventorySha256);
  assert.notEqual(context.sourceInventory.dbSnapshotSha256, context.targetInventory.dbSnapshotSha256);
  for (const pair of checkPolicy.pairs) {
    const row = receipt.tables.find(row => row.tableName === pair.tableName);
    assert.equal(row.schemaEqual, true);
    const source = context.sourceInventory.tables.find(row => row.tableName === pair.tableName);
    const target = context.targetInventory.tables.find(row => row.tableName === pair.tableName);
    assert.equal(source.schema.constraints.find(c => c.name === pair.constraintName).definition, pair.sourceDefinition);
    assert.equal(target.schema.constraints.find(c => c.name === pair.constraintName).definition, pair.restoredDefinition);
    assert.equal(row.sourceSchemaSha256, sha256(canonicalBytes(source.schema)));
    assert.equal(row.targetSchemaSha256, sha256(canonicalBytes(target.schema)));
  }
  const saved = join(f.base, 'operations', f.ctx.operationId, 'inventories');
  assert.deepEqual(await readFile(join(saved, 'source-before.json')), before);
  assert.deepEqual(await readFile(join(saved, 'source-after.json')), before);
  assert.deepEqual(canonicalBytes(f.captured.inventory), before);
  assert.equal((await restoreBundleMaterial(f.token, f.deps)).rawProofSha256, sha256(canonicalBytes(receipt)));
});
for (const pair of checkPolicy.pairs) {
  test(`T156_exact_pair_${pair.constraintName}_passes_independently`, async t => {
    const f = await checkFixture(t, {selected: [pair]});
    const receipt = await compareRestoredBundle(f.token, f.results, f.deps);
    assert.equal(verifier.validateRawComparison(receipt, f.captured.manifest, await checkRawContext(f)), receipt);
    assert.equal(receipt.tables.filter(row => row.sourceSchemaSha256 !== row.targetSchemaSha256).length, 1);
  });
}
for (const slot of ['source_commit', 'inventory_commit', 'postgres_image', 'db_snapshot', 'migration']) {
  test(`T156_pure_validator_binds_source_manifest_${slot}`, async t => {
    const f = await rawFixture(t), receipt = await compareRestoredBundle(f.token, f.results, f.deps);
    const manifest = structuredClone(f.captured.manifest), context = await checkRawContext(f);
    if (slot === 'source_commit') manifest.release.sourceCommit = '0'.repeat(40);
    if (slot === 'inventory_commit') manifest.toolchain.inventorySourceCommit = '0'.repeat(40);
    if (slot === 'postgres_image') manifest.release.postgresImageDigest = 'sha256:' + '0'.repeat(64);
    if (slot === 'db_snapshot') manifest.inventory.dbSnapshotSha256 = '0'.repeat(64);
    if (slot === 'migration') manifest.migration[0].checksum = '123';
    const changed = {...receipt, manifestSha256: sha256(canonicalBytes(manifest))};
    assert.throws(() => verifier.validateRawComparison(changed, manifest, context), e => e.code === 'BUNDLE_MISMATCH');
  });
}


async function rejectsCheckDrift(t, options) {
  const f = await checkFixture(t, options);
  await assert.rejects(compareRestoredBundle(f.token, f.results, f.deps), e => e.code === 'RAW_MISMATCH');
  const receipt = JSON.parse(await readFile(join(f.base, 'operations', f.ctx.operationId, 'raw-comparison.json')));
  const context = await checkRawContext(f);
  assert.equal(receipt.equal, false);
  assert.equal(verifier.validateRawComparison(receipt, f.captured.manifest, context), receipt);
  assert.equal((await restoreBundleMaterial(f.token, f.deps)).rawProofSha256, null);
  const forged = structuredClone(receipt);
  for (const row of forged.tables) { row.schemaEqual = true; row.rowsEqual = true; }
  forged.equal = true;
  assert.throws(() => verifier.validateRawComparison(forged, f.captured.manifest, context), e => e.code === 'BUNDLE_MISMATCH');
}
for (const pair of checkPolicy.pairs) {
  for (const fault of ['literal', 'order', 'cast', 'deferrable', 'initiallyDeferred', 'validated', 'name', 'type']) {
    test(`T156_${pair.constraintName}_${fault}_rejects_live_and_forged_pure_receipt`, async t => {
      await rejectsCheckDrift(t, {mutateTarget: value => {
        const table = value.tables.find(row => row.tableName === pair.tableName);
        const constraint = table.schema.constraints.find(row => row.name === pair.constraintName);
        if (fault === 'literal') constraint.definition += ' OR true';
        if (fault === 'order') {
          const literals = [...pair.restoredDefinition.matchAll(/'[^']*'/g)].map(match => match[0]);
          [literals[0], literals[1]] = [literals[1], literals[0]];
          let ordinal = 0;
          constraint.definition = pair.restoredDefinition.replace(/'[^']*'/g, () => literals[ordinal++]);
        }
        if (fault === 'cast') constraint.definition = pair.restoredDefinition.replace('::text', '::character varying');
        if (['deferrable', 'initiallyDeferred', 'validated'].includes(fault)) constraint[fault] = !constraint[fault];
        if (fault === 'name') constraint.name += '_unapproved';
        if (fault === 'type') constraint.type = 'UNIQUE';
        table.schema.constraints.sort((a, b) => a.name.localeCompare(b.name));
      }});
    });
  }
}
for (const fault of ['column', 'default', 'index', 'missing', 'extra', 'table', 'same_count_row']) {
  test(`T156_other_catalog_or_row_${fault}_remains_strict`, async t => {
    await rejectsCheckDrift(t, {mutateTarget: value => {
      const pair = checkPolicy.pairs[0], table = value.tables.find(row => row.tableName === pair.tableName);
      if (fault === 'column') table.schema.columns[0].isNullable = !table.schema.columns[0].isNullable;
      if (fault === 'default') table.schema.columns[0].columnDefault = "'unexpected'::text";
      if (fault === 'index') table.schema.indexes.push({name: 'unapproved_index', definition: 'CREATE INDEX unapproved_index ON public.cms_content_type(id)', unique: false, primary: false, valid: true, ready: true});
      if (fault === 'missing') table.schema.constraints.shift();
      if (fault === 'extra') table.schema.constraints.push({...pair.constraintMetadata, name: 'zzz_unapproved', definition: pair.restoredDefinition});
      if (fault === 'table') {
        const other = value.tables.find(row => row.tableName === 'cms_audit_event');
        other.schema.constraints.push(table.schema.constraints.shift());
      }
      if (fault === 'same_count_row') value.tables.find(row => row.tableName === 'cms_permission').rows[0].action = 'write';
    }});
  });
}
for (const kind of ['PRIMARY_KEY', 'FOREIGN_KEY', 'UNIQUE']) {
  test(`T156_unlisted_${kind}_difference_rejected_even_with_nine_valid_pairs`, async t => {
    const baseInventory = checkInventory(), name = 'aaa_unlisted';
    baseInventory.tables[0].schema.constraints = [{name, type: kind, definition: `${kind} (id)`, deferrable: false, initiallyDeferred: false, validated: true}];
    await rejectsCheckDrift(t, {baseInventory, mutateTarget: value => { value.tables[0].schema.constraints[0].definition += ' changed'; }});
  });
}
test('T156_reverse_pairs_rejected_with_full_raw_evidence', async t => {
  const baseInventory = checkInventory(); restoreCheckPairs(baseInventory);
  await rejectsCheckDrift(t, {baseInventory, mutateTarget: value => {
    for (const pair of checkPolicy.pairs) value.tables.find(row => row.tableName === pair.tableName)
      .schema.constraints.find(row => row.name === pair.constraintName).definition = pair.sourceDefinition;
  }});
});
test('T156_coherent_wrong_PG_image_disables_pair_exception', async t => {
  await rejectsCheckDrift(t, {configure: f => { f.ctx.target.images.postgres = 'sha256:' + '0'.repeat(64); }});
});
for (const slot of ['postgresServerVersion', 'pgDumpVersion', 'pgRestoreVersion']) {
  test(`T156_pure_coherent_wrong_${slot}_cannot_claim_pair_success`, async t => {
    const f = await checkFixture(t), receipt = await compareRestoredBundle(f.token, f.results, f.deps);
    const manifest = structuredClone(f.captured.manifest), context = await checkRawContext(f);
    (slot === 'postgresServerVersion' ? manifest.release : manifest.toolchain)[slot] = '16.14';
    const forged = {...receipt, manifestSha256: sha256(canonicalBytes(manifest))};
    assert.throws(() => verifier.validateRawComparison(forged, manifest, context), e => e.code === 'BUNDLE_MISMATCH');
    const rejected = structuredClone(forged);
    for (const row of rejected.tables) row.schemaEqual = row.sourceSchemaSha256 === row.targetSchemaSha256;
    rejected.equal = false;
    assert.equal(verifier.validateRawComparison(rejected, manifest, context), rejected);
  });
}
for (const direction of ['source', 'restored']) {
  test(`T156_identical_${direction}_CHECK_schema_needs_no_exception`, async t => {
    const baseInventory = checkInventory();
    if (direction === 'restored') restoreCheckPairs(baseInventory);
    const f = await checkFixture(t, {baseInventory, selected: [], configure: f => { f.ctx.target.images.postgres = 'sha256:' + '0'.repeat(64); }});
    const receipt = await compareRestoredBundle(f.token, f.results, f.deps);
    assert.equal(receipt.equal, true);
    assert.equal(receipt.sourceInventorySha256, receipt.targetInventorySha256);
    assert.equal(verifier.validateRawComparison(receipt, f.captured.manifest, await checkRawContext(f)), receipt);
  });
}
test('T156_source_after_cannot_use_approved_pair_to_hide_writer_drift', async t => {
  const f = await checkFixture(t, {mutateSource: value => restoreCheckPairs(value)});
  await assert.rejects(compareRestoredBundle(f.token, f.results, f.deps), e => e.code === 'WRITER_NOT_QUIESCED');
  await assert.rejects(lstat(join(f.base, 'operations', f.ctx.operationId, 'raw-comparison.json')), {code: 'ENOENT'});
});
for (const fault of ['target_release', 'manifest_release', 'normalized_hash']) {
  test(`T156_coherent_${fault}_substitution_rejected`, async t => {
    const f = await checkFixture(t), receipt = await compareRestoredBundle(f.token, f.results, f.deps);
    const manifest = structuredClone(f.captured.manifest), context = await checkRawContext(f), forged = structuredClone(receipt);
    context.targetIdentity = structuredClone(context.targetIdentity);
    if (fault === 'target_release') {
      context.targetIdentity.sourceCommit = '0'.repeat(40);
      context.targetIdentity.apiBuild.sourceCommit = '0'.repeat(40);
      forged.targetIdentitySha256 = sha256(canonicalBytes(context.targetIdentity));
    }
    if (fault === 'manifest_release') {
      manifest.release.sourceCommit = '0'.repeat(40); manifest.toolchain.inventorySourceCommit = '0'.repeat(40);
      forged.manifestSha256 = sha256(canonicalBytes(manifest));
    }
    if (fault === 'normalized_hash') {
      context.targetInventory = structuredClone(context.targetInventory);
      context.targetInventory.tables.find(row => row.tableName === checkPolicy.pairs[0].tableName).schemaSha256 =
        context.sourceInventory.tables.find(row => row.tableName === checkPolicy.pairs[0].tableName).schemaSha256;
      context.targetInventorySha256 = forged.targetInventorySha256 = sha256(canonicalBytes(context.targetInventory));
    }
    assert.throws(() => verifier.validateRawComparison(forged, manifest, context), e => e.code === 'BUNDLE_MISMATCH');
  });
}
test('T156_post_revoke_target_baseline_rejects_even_an_approved_pair', () => {
  const f = revocationFixture(), catalog = checkInventory();
  for (const value of [f.raw, f.after]) {
    for (const table of value.tables) table.schema.constraints = structuredClone(catalog.tables.find(row => row.tableName === table.tableName).schema.constraints);
  }
  rehashInventory(f.raw); rehashInventory(f.after);
  assert.equal(verifier.verifyRevocationDelta(f.raw, f.after, f.receipt, f.context), true);
  restoreCheckPairs(f.after); rehashInventory(f.after);
  assert.throws(() => verifier.verifyRevocationDelta(f.raw, f.after, f.receipt, f.context), e => e.code === 'SESSION_REVOKE_FAILED');
});


for (const fault of ['deferrable', 'initiallyDeferred', 'validated', 'name', 'table', 'source_byte']) {
  test(`T156_coherent_both_sides_${fault}_still_requires_exact_named_approved_pair`, async t => {
    const pair = checkPolicy.pairs[0], baseInventory = checkInventory();
    const table = baseInventory.tables.find(row => row.tableName === pair.tableName);
    const constraint = table.schema.constraints.find(row => row.name === pair.constraintName);
    if (['deferrable', 'initiallyDeferred', 'validated'].includes(fault)) constraint[fault] = !constraint[fault];
    if (fault === 'name') constraint.name += '_unapproved';
    if (fault === 'source_byte') constraint.definition += ' ';
    if (fault === 'table') {
      table.schema.constraints = table.schema.constraints.filter(row => row !== constraint);
      baseInventory.tables[0].schema.constraints.push(constraint);
    }
    await rejectsCheckDrift(t, {baseInventory, selected: checkPolicy.pairs.slice(1), mutateTarget: value => {
      const target = value.tables.find(row => row.tableName === (fault === 'table' ? baseInventory.tables[0].tableName : pair.tableName));
      target.schema.constraints.find(row => row.name === constraint.name).definition = pair.restoredDefinition;
    }});
  });
}

test('PP1C_D03_authDelta_valid_full20table_microseconds_returns_exact_derived_proof',()=>{
  const f=authFixture(),before=canonicalBytes(f.baseline),after=canonicalBytes(f.after);
  const proof=verifier.verifyAuthDelta(f.baseline,f.after,f.context);
  assert.deepEqual(Object.keys(proof).sort(),'version operationId targetRunId baselineInventorySha256 afterInventorySha256 fixtureSha256 authObservationsSha256 browserAssertionsSha256 ingressWebAddress expectedUserAgent actors changedPrincipalCount insertedSessionCount insertedAuditCount otherRowsEqual filesEqual'.split(' ').sort());
  assert.deepEqual(proof.actors.map(a=>[a.actor,a.sessionId,a.auditEventId]),[['admin',authId(21),authId(31)],['operator',authId(22),authId(32)]]);
  assert.equal(proof.authObservationsSha256,authHash(f.context.observations));assert.equal(proof.browserAssertionsSha256,authHash(f.context.assertions));
  assert.equal(proof.changedPrincipalCount,'2');assert.equal(proof.insertedSessionCount,'2');assert.equal(proof.insertedAuditCount,'2');
  assert.deepEqual(canonicalBytes(f.baseline),before);assert.deepEqual(canonicalBytes(f.after),after);
  assert.ok(!JSON.stringify(proof).includes('sessionTokenSha256')&&!JSON.stringify(proof).includes('token_hash'));
});
test('PP1C_D03_sessionTouchExactExpiry_rejects_same_millisecond_microsecond_drift',()=>{
  for(const column of ['updated_at','expires_at']) {
    const f=authFixture(),name=column==='updated_at'?'cms_principal':'cms_session';
    const row=authRows(f.after,name).find(r=>r.id===authId(column==='updated_at'?1:21));
    row[column]=row[column].replace(column==='updated_at'?'123456':'500123',column==='updated_at'?'123457':'500124');authRehash(f);
    assert.throws(()=>verifier.verifyAuthDelta(f.baseline,f.after,f.context),e=>e.code==='SMOKE_FAILED');
  }
});

const authMutations={
  unrelated:f=>{const table=f.after.tables.find(t=>t.tableName==='cms_entry');table.rows.push(Object.fromEntries(table.schema.columns.map(c=>[c.name,c.name==='id'?authId(99):null])));},
  schema:f=>{f.after.tables[0].schema.columns[0].columnDefault="'changed'";},
  files:f=>{f.after.files[0].sha256='0'.repeat(64);},
  extraFile:f=>{f.after.files.push({...f.after.files[0],objectKey:'other.bin'});},
  principalStatus:f=>{authRows(f.after,'cms_principal')[0].status='disabled';},
  principalFailureCount:f=>{authRows(f.after,'cms_principal')[0].failed_login_count='1';},
  principalLocked:f=>{authRows(f.after,'cms_principal')[0].locked_until='2026-11-07 00:00:00+00';},
  principalExtra:f=>{authRows(f.after,'cms_principal').push({...authRows(f.after,'cms_principal')[0],id:authId(3)});},
  principalOtherField:f=>{authRows(f.after,'cms_principal')[0].email='changed@example.test';},
  principalMicros:f=>{authRows(f.after,'cms_principal')[0].last_login_at='2026-11-06 12:00:00.123455+00';},
  oldSessionTouch:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(11)).last_seen_at='2026-11-06 12:00:00+00';},
  oldSessionDelete:f=>{const rows=authRows(f.after,'cms_session');rows.splice(rows.findIndex(r=>r.id===authId(11)),1);},
  oldAuditChange:f=>{authRows(f.after,'cms_audit_event').find(r=>r.id===authId(40)).outcome='failure';},
  extraSession:f=>{authRows(f.after,'cms_session').push({...authRows(f.after,'cms_session').find(r=>r.id===authId(21)),id:authId(23)});},
  extraAudit:f=>{authRows(f.after,'cms_audit_event').push({...authRows(f.after,'cms_audit_event').find(r=>r.id===authId(31)),id:authId(33)});},
  sessionPrincipal:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).principal_id=authId(3);},
  sessionSurface:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).created_surface='back';},
  sessionRevoked:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).revoked_at='2026-11-06 12:00:02+00';},
  sessionIp:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).ip='192.168.253.4';},
  sessionUa:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).user_agent='other';},
  sessionCookie:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).token_hash=String.fromCharCode(92)+'x'+'c'.repeat(64);},
  sessionByteaUpper:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).token_hash=String.fromCharCode(92)+'x'+'A'.repeat(64);},
  sessionByteaShort:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).token_hash=String.fromCharCode(92)+'x'+'a'.repeat(62);},
  sessionBeforeStart:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).created_at='2026-11-06 12:00:00.122999+00';},
  sessionAfterFinish:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).created_at='2026-11-06 12:00:00.125+00';},
  sessionSeenBeforeCreate:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).last_seen_at='2026-11-06 12:00:00.123455+00';},
  sessionSeenAfterBrowser:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).last_seen_at='2026-11-06 12:00:03.001+00';},
  sessionExpiryMicros:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).expires_at='2026-11-07 00:00:02.500122+00';},
  auditBeforeCreate:f=>{authRows(f.after,'cms_audit_event').find(r=>r.id===authId(31)).at='2026-11-06 12:00:00.123455+00';},
  auditAfterLogin:f=>{authRows(f.after,'cms_audit_event').find(r=>r.id===authId(31)).at='2026-11-06 12:00:00.125+00';},
  auditActor:f=>{authRows(f.after,'cms_audit_event').find(r=>r.id===authId(31)).actor_principal_id=authId(2);},
  auditTarget:f=>{authRows(f.after,'cms_audit_event').find(r=>r.id===authId(31)).target_id=authId(2);},
  auditAction:f=>{authRows(f.after,'cms_audit_event').find(r=>r.id===authId(31)).action='LOGOUT';},
  auditDetail:f=>{authRows(f.after,'cms_audit_event').find(r=>r.id===authId(31)).detail_json='{}';},
  auditIp:f=>{authRows(f.after,'cms_audit_event').find(r=>r.id===authId(31)).ip='192.168.253.4';},
  invalidCalendar:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).created_at='2026-02-30 12:00:00.123456+00';},
  unsupportedOffset:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).created_at='2026-11-06 12:00:00.123456+01';},
  precisionBeyondPg:f=>{authRows(f.after,'cms_session').find(r=>r.id===authId(21)).created_at='2026-11-06 12:00:00.1234567+00';},
};
for(const [name,mutate]of Object.entries(authMutations))test(`PP1C_D03_authDelta_rejects_${name}_despite_rehashed_inventory`,()=>{
  const f=authFixture();mutate(f);authRehash(f);
  assert.throws(()=>verifier.verifyAuthDelta(f.baseline,f.after,f.context),e=>e.code==='SMOKE_FAILED');
});
for(const name of ['obsExtra','actorExtra','actorId','cookieHash','oldRejectedAtExpiry','oldRejectedBeforeBrowser','oldRejectedAtLogin','loginOrder','assertExtra','checksExtra','falseCheck','secondLogin','secondDelivery','fixtureExtra','fixtureOldId','hashBaseline','hashAfter','hashFixture','contextExtra','operationId','targetRunId','publicIngress'])test(`PP1C_D03_authDelta_rejects_${name}_binding`,()=>{
  const f=authFixture(),c=f.context;
  if(name==='obsExtra')c.observations.extra=true;
  if(name==='actorExtra')c.observations.admin.extra=true;
  if(name==='actorId')c.observations.admin.principalId=authId(2);
  if(name==='cookieHash')c.observations.admin.sessionTokenSha256='c'.repeat(64);
  if(name==='oldRejectedAtExpiry')c.observations.admin.oldRejectedAt='2026-11-06T12:30:00.000Z';
  if(name==='oldRejectedBeforeBrowser')c.observations.admin.oldRejectedAt='2026-11-06T11:59:59.999Z';
  if(name==='oldRejectedAtLogin')c.observations.admin.oldRejectedAt=c.observations.admin.loginStartedAt;
  if(name==='loginOrder')c.observations.admin.loginFinishedAt='2026-11-06T12:00:00.122Z';
  if(name==='assertExtra')c.assertions.extra=true;
  if(name==='checksExtra')c.assertions.checks.extra=true;
  if(name==='falseCheck')c.assertions.checks.originTls=false;
  if(name==='secondLogin')c.assertions.loginCount='3';
  if(name==='secondDelivery')c.assertions.credentialDeliveries='2';
  if(name==='fixtureExtra')c.fixture.extra=true;
  if(name==='fixtureOldId')c.fixture.oldSessionIds.admin=authId(12);
  if(name==='contextExtra')c.extra=true;
  if(name==='operationId')c.operationId=authId(91);
  if(name==='targetRunId')c.targetRunId='c'.repeat(32);
  if(name==='publicIngress')c.ingressWebAddress='8.8.8.8';
  authRehash(f);
  if(name==='hashBaseline')c.baselineInventorySha256='0'.repeat(64);
  if(name==='hashAfter')c.afterInventorySha256='0'.repeat(64);
  if(name==='hashFixture')c.fixtureSha256='0'.repeat(64);
  assert.throws(()=>verifier.verifyAuthDelta(f.baseline,f.after,c),e=>e.code==='SMOKE_FAILED');
});
test('PP1C_D03_expiredOldCookieNotRevocationProof_uses_exact_raw_expiry',()=>{
  const f=authFixture();
  for(const value of [f.baseline,f.after])authRows(value,'cms_session').find(r=>r.id===authId(11)).expires_at='2026-11-06 12:00:00.049999+00';
  authRehash(f);assert.throws(()=>verifier.verifyAuthDelta(f.baseline,f.after,f.context),e=>e.code==='SMOKE_FAILED');
});
test('PP1C_D03_authDelta_accepts_last_microsecond_inside_browser_millisecond',()=>{
  const f=authFixture(),created='2026-11-06 12:00:00.124999+00';
  Object.assign(authRows(f.after,'cms_principal').find(r=>r.id===authId(1)),{last_login_at:created,updated_at:created});
  authRows(f.after,'cms_session').find(r=>r.id===authId(21)).created_at=created;
  authRows(f.after,'cms_audit_event').find(r=>r.id===authId(31)).at=created;
  authRehash(f);assert.equal(verifier.verifyAuthDelta(f.baseline,f.after,f.context).otherRowsEqual,true);
});
test('PP1C_D03_sessionTouchExactExpiry_uses_absolute_or_maximum_without_millisecond_rounding',()=>{
  const f=authFixture();f.context.fixture.sessionMaxSeconds='43200';
  authRows(f.after,'cms_session').find(r=>r.id===authId(21)).expires_at='2026-11-07 00:00:00.123456+00';
  authRows(f.after,'cms_session').find(r=>r.id===authId(22)).expires_at='2026-11-07 00:00:01.123456+00';
  authRehash(f);assert.equal(verifier.verifyAuthDelta(f.baseline,f.after,f.context).insertedSessionCount,'2');
});

test('PP1C_D03_authDelta_offline_reconstruction_decodes_bytea_and_revalidates_exact_proof',()=>{
  const f=authFixture(),proof=verifier.verifyAuthDelta(f.baseline,f.after,f.context);
  const before=canonicalBytes({baseline:f.baseline,after:f.after,proof,assertions:f.context.assertions,fixture:f.context.fixture});
  assert.deepEqual(verifier.revalidateAuthDelta(f.baseline,f.after,proof,f.context.assertions,f.context.fixture),proof);
  assert.deepEqual(canonicalBytes({baseline:f.baseline,after:f.after,proof,assertions:f.context.assertions,fixture:f.context.fixture}),before);
});
const authProofFaults=['extra','version','operationId','targetRunId','baselineInventorySha256','afterInventorySha256','fixtureSha256','authObservationsSha256',
  'browserAssertionsSha256','ingressWebAddress','expectedUserAgent','changedPrincipalCount','insertedSessionCount','insertedAuditCount','otherRowsEqual','filesEqual',
  'actorExtra','actorsReversed','actorsMissing','actorName','principalId','oldSessionId','sessionId','auditEventId','loginStartedAt','loginFinishedAt','oldRejectedAt'];
for(const fault of authProofFaults)test(`PP1C_D03_authDelta_offline_rejects_proof_${fault}`,()=>{
  const f=authFixture(),proof=structuredClone(verifier.verifyAuthDelta(f.baseline,f.after,f.context));
  if(fault==='extra')proof.extra=true;
  else if(fault==='version')proof.version=2;
  else if(fault.endsWith('Sha256'))proof[fault]='0'.repeat(64);
  else if(fault==='operationId')proof.operationId=authId(91);
  else if(fault==='targetRunId')proof.targetRunId='c'.repeat(32);
  else if(fault==='ingressWebAddress')proof.ingressWebAddress='192.168.253.4';
  else if(fault==='expectedUserAgent')proof.expectedUserAgent='other';
  else if(fault.endsWith('Count'))proof[fault]='3';
  else if(fault==='otherRowsEqual'||fault==='filesEqual')proof[fault]=false;
  else if(fault==='actorExtra')proof.actors[0].extra=true;
  else if(fault==='actorsReversed')proof.actors.reverse();
  else if(fault==='actorsMissing')proof.actors.pop();
  else if(fault==='actorName')proof.actors[0].actor='operator';
  else if(['principalId','oldSessionId','sessionId','auditEventId'].includes(fault))proof.actors[0][fault]=authId(99);
  else proof.actors[0][fault]='2026-11-06T12:00:00.122Z';
  assert.throws(()=>verifier.revalidateAuthDelta(f.baseline,f.after,proof,f.context.assertions,f.context.fixture),e=>e.code==='SMOKE_FAILED');
});
test('PP1C_D03_authDelta_offline_hashes_decoded_bytes_not_postgres_text',()=>{
  const f=authFixture(),proof=structuredClone(verifier.verifyAuthDelta(f.baseline,f.after,f.context));
  const wrong=structuredClone(f.context.observations),session=authRows(f.after,'cms_session').find(row=>row.id===authId(21));
  wrong.admin.sessionTokenSha256=sha256(Buffer.from(session.token_hash));proof.authObservationsSha256=authHash(wrong);
  assert.throws(()=>verifier.revalidateAuthDelta(f.baseline,f.after,proof,f.context.assertions,f.context.fixture),e=>e.code==='SMOKE_FAILED');
});

for(const [microseconds,accepted]of [['050000',false],['050001',true]])test(`PP1C_D03_old_cookie_expiry_microseconds_${microseconds}`,()=>{
  const f=authFixture();
  for(const value of [f.baseline,f.after])authRows(value,'cms_session').find(row=>row.id===authId(11)).expires_at=`2026-11-06 12:00:00.${microseconds}+00`;
  authRehash(f);
  if(accepted)assert.equal(verifier.verifyAuthDelta(f.baseline,f.after,f.context).insertedSessionCount,'2');
  else assert.throws(()=>verifier.verifyAuthDelta(f.baseline,f.after,f.context),e=>e.code==='SMOKE_FAILED');
});

test('PP1c_D_startup_private_revoked_baseline_and_fresh_owned_inventory',async t=>{
  const f=await revokedFixture(t);await assert.rejects(verifier.restoreLifecycleContext(f.token,f.deps));
  await verifier.verifyRevokedBundle(f.token,{commit:f.commit,inventory:f.inventory},f.deps);
  assert.equal((await verifier.restoreLifecycleContext(f.token,f.deps)).verifiedThrough,'SESSIONS_REVOKED');
  f.ctx.lease.phase='STARTUP_VERIFIED';f.ctx.helperSequence=11;
  const result=await f.issueInventory('target','11',structuredClone(f.post));
  const receipt=await verifier.verifyLifecycleInventory(f.token,result,f.deps);assert.equal(receipt.sha256,sha256(canonicalBytes(f.post)));
  assert.equal((await verifier.restoreLifecycleContext(f.token,f.deps)).verifiedThrough,'STARTUP_VERIFIED');
  await assert.rejects(verifier.verifyLifecycleInventory(f.token,result,f.deps));
  await assert.rejects(verifier.restoreLifecycleContext({},f.deps));
});
for(const fault of ['schema','rows','files','unowned','stale','baseline-bytes'])test(`PP1c_D_startup_zero_rejects_${fault}`,async t=>{
  const f=await revokedFixture(t);await verifier.verifyRevokedBundle(f.token,{commit:f.commit,inventory:f.inventory},f.deps);
  f.ctx.lease.phase='STARTUP_VERIFIED';f.ctx.helperSequence=11;const after=structuredClone(f.post);
  if(fault==='schema')after.tables[0].schema.indexes.push({name:'changed',definition:'changed',isUnique:false,isPrimary:false});
  if(fault==='rows')after.tables.find(t=>t.tableName==='cms_permission').rows[0].action='write';
  if(fault==='files')after.files.push({objectKey:'new.bin',byteSize:'1',sha256:'f'.repeat(64),classification:'orphan'});
  let result=await f.issueInventory('target',fault==='stale'?'9':'11',after);
  if(fault==='unowned')result=structuredClone(result);
  if(fault==='baseline-bytes')await writeFile(join(f.base,'operations',f.ctx.operationId,'inventories/target-revoked.json'),canonicalBytes({...after,unexpected:true}));
  await assert.rejects(verifier.verifyLifecycleInventory(f.token,result,f.deps));
});


test('PP1c_D_smoke_context_derives_exact_input_and_raw_credential_bindings',async t=>{
  const f=await smokeContextFixture(t),context=await verifier.restoreSmokeContext(f.token,f.deps);
  assert.deepEqual(Object.keys(context).sort(),['credentialBindings','input']);assert.equal(context.input.stage,'RESTORE_SMOKE_READY');
  assert.equal(context.input.operationId,f.ctx.operationId);assert.equal(context.input.targetRunId,f.child.runId);
  assert.deepEqual(context.input.fixture,f.smokeFixture);assert.equal(context.credentialBindings.admin.oldSessionId,f.smokeFixture.oldSessionIds.admin);
  assert.equal(context.credentialBindings.admin.oldSessionTokenSha256,'d'.repeat(64));
  f.ctx.lease.phase='TARGET_STOPPED';assert.deepEqual(await verifier.restoreSmokeContext(f.token,f.deps),context);
  await assert.rejects(verifier.restoreSmokeContext({},f.deps));
  await writeFile(join(f.base,'operations',f.ctx.operationId,'smoke-fixture.json'),canonicalBytes({...f.smokeFixture,revisionNo:2}));
  await assert.rejects(verifier.restoreSmokeContext(f.token,f.deps));
});
test('PP1c_D_smoke_context_cannot_bootstrap_fixture_after_capture_or_before_startup',async t=>{
  const f=await revokedFixture(t);await verifier.verifyRevokedBundle(f.token,{commit:f.commit,inventory:f.inventory},f.deps);
  f.ctx.lease.phase='INGRESS_STARTED';await assert.rejects(verifier.restoreSmokeContext(f.token,f.deps));
});


test('PP1c_D_auth_live_requires_sealed_browser_and_exact_next_stopped_inventory',async t=>{
  const f=await liveAuthFixture(t);await verifier.verifyBrowserResult(f.token,f.browserResult,f.deps);
  assert.equal((await verifier.restoreLifecycleContext(f.token,f.deps)).verifiedThrough,'BROWSER_VERIFIED');
  f.ctx.lease.phase='TARGET_STOPPED';f.ctx.helperSequence=13;
  const inventory=await f.issueInventory('target','13',f.after);
  const result=await verifier.verifyAuthInventory(f.token,{browser:f.browserResult,inventory},f.deps);
  assert.equal(result.changedPrincipalCount,'2');assert.equal((await verifier.restoreLifecycleContext(f.token,f.deps)).verifiedThrough,'TARGET_STOPPED');
  const proof=JSON.parse(await readFile(join(f.base,'operations',f.ctx.operationId,'auth-delta.json')));
  assert.deepEqual(proof,result);assert.ok(!JSON.stringify(proof).includes('sessionTokenSha256')&&!JSON.stringify(proof).includes('token_hash'));
  assert.deepEqual(JSON.parse(await readFile(join(f.base,'operations',f.ctx.operationId,'browser-assertions.json'))),f.browserAuthority.assertions);
});
for(const fault of ['cloned-browser','not-delivered','late-window','wrong-input','wrong-helper-seq','post-seq','extra-audit'])test(`PP1c_D_auth_live_rejects_${fault}`,async t=>{
  const f=await liveAuthFixture(t);
  if(fault==='not-delivered')f.browserAuthority.deliveredOnce=false;if(fault==='late-window')f.browserAuthority.assertions.finishedAt='2026-11-06T12:00:05.000Z';
  if(fault==='wrong-input')f.browserAuthority.inputSha256='0'.repeat(64);if(fault==='wrong-helper-seq')f.browserAuthority.helperSequence='11';
  if(['not-delivered','late-window','wrong-input','wrong-helper-seq','cloned-browser'].includes(fault)) {
    await assert.rejects(verifier.verifyBrowserResult(f.token,fault==='cloned-browser'?structuredClone(f.browserResult):f.browserResult,f.deps));return;
  }
  await verifier.verifyBrowserResult(f.token,f.browserResult,f.deps);f.ctx.lease.phase='TARGET_STOPPED';f.ctx.helperSequence=fault==='post-seq'?14:13;
  if(fault==='extra-audit')authRows(f.after,'cms_audit_event').push({...authRows(f.after,'cms_audit_event')[0],id:authId(99)});
  for(const table of f.after.tables)table.rows.sort((a,b)=>Buffer.compare(canonicalBytes(a),canonicalBytes(b)));
  const inventory=await f.issueInventory('target',String(f.ctx.helperSequence),f.after);
  await assert.rejects(verifier.verifyAuthInventory(f.token,{browser:f.browserResult,inventory},f.deps));
});


test('PP1c_D_final_proof_requires_restart_source_and_revalidates_all_private_evidence',async t=>{
  const f=await finalProofFixture(t),value=await verifier.completeRestoreVerification(f.token,f.sourceResult,f.deps);
  assert.equal(value.proof.sourceInventorySha256,f.captured.manifest.inventory.sha256);
  assert.equal(value.receipt.rawSnapshotSha256,f.captured.inventory.dbSnapshotSha256);
  assert.equal(value.receipt.availableAt,'2026-11-06T12:00:05.000Z');assert.equal(value.receipt.withinRto,false);
  const {proofSha256,...preimage}=value.proof;assert.equal(proofSha256,sha256(canonicalBytes(preimage)));
  assert.deepEqual(JSON.parse(await readFile(join(f.base,'operations',f.ctx.operationId+'.proof.json'))),value.proof);
  assert.deepEqual((await verifier.restoreLifecycleContext(f.token,f.deps)).finalProof,value.proof);
  await assert.rejects(readFile(join(f.base,'recovery-candidate.json')),{code:'ENOENT'});
  await assert.rejects(verifier.completeRestoreVerification(f.token,f.sourceResult,f.deps));
});
for(const fault of ['source-row','source-clone','source-stale','startup-bytes','auth-delta-bytes','restart-bytes','clock'])test(`PP1c_D_final_proof_rejects_${fault}_without_proof`,async t=>{
  const f=await finalProofFixture(t);let source=f.sourceResult;
  if(fault==='source-row') {
    const current=structuredClone(f.captured.inventory);authRows(current,'cms_principal')[0].display_name='changed';
    source=await f.issueInventory('source','15',current);
  }
  if(fault==='source-clone')source=structuredClone(source);if(fault==='source-stale')f.ctx.helperSequence=16;
  const root=join(f.base,'operations',f.ctx.operationId);
  if(fault==='startup-bytes')await writeFile(join(root,'inventories/target-startup.json'),'{}\n');
  if(fault==='auth-delta-bytes')await writeFile(join(root,'auth-delta.json'),'{}\n');
  if(fault==='restart-bytes')await writeFile(join(root,'inventories/target-after-restart.json'),'{}\n');
  if(fault==='clock')f.deps.workflowTimingContext=async()=>{throw new Error('badclock');};
  await assert.rejects(verifier.completeRestoreVerification(f.token,source,f.deps));
  await assert.rejects(readFile(join(f.base,'operations',f.ctx.operationId+'.proof.json')),{code:'ENOENT'});
});

test('PP1c_R01_preflight_requires_a_private_complete_persisted_proof', async () => {
  assert.equal(typeof verifier.preflightRecovery, 'function');
  await assert.rejects(verifier.preflightRecovery({}));
});


test('PP1c_R01_preflight_recomputes_complete_private_history_without_probe',async t=>{
  const f=await persistedProofFixture(t),candidate=await verifier.preflightRecovery(f.inspection,f.recoveryDeps);
  assert.deepEqual(candidate,{});assert.ok(Object.isFrozen(candidate));
  assert.equal(await readFile(join(f.base,'lease.json'),'utf8'),canonicalBytes(f.lease).toString());
});
for (const fault of ['locator-path','proof-hash','bundle-copy','source-final','raw','revoked','startup','delta','assertions','restart','smoke-extra','receipt-raw','marker','history-fail','history-hash','active-lock']) {
  test(`PP1c_R01_persisted_preflight_rejects_${fault}`, async t => {
    const f=await persistedProofFixture(t),opRoot=join(f.base,'operations',f.ctx.operationId);
    if(fault==='active-lock')await mkdir(join(f.base,'operation.lock'),{mode:0o700});
    else if(fault==='locator-path')await f.put(join(f.base,'recovery-candidate.json'),{version:1,sourceRunId:f.lease.source.runId,
      backupId:f.proof.backupId,restoreOperationId:f.lease.operationId,proofSha256:f.proof.proofSha256,path:'/tmp/forged'});
    else if(fault==='proof-hash')await f.put(join(f.base,'operations',f.lease.operationId+'.proof.json'),{...f.proof,proofSha256:'0'.repeat(64)});
    else if(fault==='bundle-copy')await writeFile(join(f.root,'protected-copy',f.proof.backupId,'db.dump'),'changed');
    else if(fault==='marker')await f.put(join(f.childRoot,'restore-target.json'),{...f.lease.target,preparationSha256:'0'.repeat(64)});
    else if(fault.startsWith('history-')) {
      const journal=structuredClone(f.journal),last=journal.records.at(-1);
      if(fault==='history-fail'){last.event='FAIL';last.failureCode='SOURCE_CHANGED';}
      else last.leaseSha256='0'.repeat(64);
      await f.put(join(f.base,'operations',f.lease.operationId+'.json'),journal);
    } else {
      const files={'source-final':'inventories/source-final.json',raw:'raw-comparison.json',revoked:'inventories/target-revoked.json',
        startup:'inventories/target-startup.json',delta:'auth-delta.json',assertions:'browser-assertions.json',restart:'inventories/target-after-restart.json',
        'smoke-extra':'smoke.json','receipt-raw':'restore-verified.json'};
      const path=join(opRoot,files[fault]),value=JSON.parse(await readFile(path));
      if(fault==='receipt-raw')value.rawSnapshotSha256='0'.repeat(64);
      else value.unapproved=true;
      await f.put(path,value);
    }
    await assert.rejects(verifier.preflightRecovery(f.inspection,f.recoveryDeps));
  });
}
test('PP1c_R01_historical_restore_need_not_be_latest_released_lease',async t=>{
  const f=await persistedProofFixture(t),id='22222222-2222-4222-8222-222222222222';
  const request={version:1,operationId:id,sourceRunId:f.lease.source.runId,purpose:'BACKUP_LOCAL',targetRunId:null,
    incidentStartedAt:null,startedAt:'2026-11-06T13:00:00.000Z',environment:null};
  const lease={...f.lease,operationId:id,purpose:'BACKUP_LOCAL',createdAt:request.startedAt,requestSha256:sha256(canonicalBytes(request)),
    originalApiState:'stopped',completionPolicy:'RESTORE_ORIGINAL',target:null,proof:null};
  const journal={...f.journal,operationId:id,purpose:lease.purpose,records:[]};
  for(const phase of WORKFLOW_PHASES.BACKUP_LOCAL)for(const event of ['BEGIN','END'])journal.records.push({seq:String(journal.records.length+1),
    event,phase,at:request.startedAt,failureCode:null,leaseSha256:sha256(canonicalBytes(lease)),proofSha256:null});
  await f.put(join(f.base,'operations',id+'.request.json'),request);await f.put(join(f.base,'operations',id+'.json'),journal);
  await f.put(join(f.base,'lease.json'),lease);
  assert.deepEqual(await verifier.preflightRecovery(f.inspection,f.recoveryDeps),{});
});
test('PP1c_R01_candidate_and_revalidation_exports_fail_closed_on_JSON',async()=>{
  for(const name of ['recoveryCandidateContext','verifyRecoveryProof','revalidatedRecoveryContext','revalidateRecoveryGuard']) {
    assert.equal(typeof verifier[name],'function');await assert.rejects(verifier[name]({}));
  }
});
test('PP1c_R01_private_candidate_rechecks_bytes_and_rejects_clones',async t=>{
  const f=await persistedProofFixture(t),candidate=await verifier.preflightRecovery(f.inspection,f.recoveryDeps);
  assert.deepEqual(await verifier.recoveryCandidateContext(candidate,f.inspection,f.recoveryDeps),{proof:f.proof});
  await assert.rejects(verifier.recoveryCandidateContext(structuredClone(candidate),f.inspection,f.recoveryDeps));
  const path=join(f.root,'bundles',f.proof.backupId,'media.package');await writeFile(path,'changed');
  await assert.rejects(verifier.recoveryCandidateContext(candidate,f.inspection,f.recoveryDeps));
});
async function newRecoveryFixture(t) {
  const f=await persistedProofFixture(t),deps=f.recoveryDeps,candidate=await verifier.preflightRecovery(f.inspection,deps);
  deps.clock=()=>Date.parse('2026-11-06T13:00:00.000Z');deps.originalApiState='stopped';
  const record=await reserveWorkflow(f.inspection,{operationId:'33333333-3333-4333-8333-333333333333',purpose:'RECOVER_ADMIN',
    completionPolicy:'KEEP_STOPPED',targetRunId:null,incidentStartedAt:null},deps);
  for(const phase of ['PRECHECK','SOURCE_QUIESCED'])for(const event of ['BEGIN','END'])await persistWorkflow(record,event,phase,{},deps);
  await verifier.recoveryCandidateContext(candidate,f.inspection,deps);
  await persistWorkflow(record,'BEGIN','PROOF_REVALIDATED',{proof:f.proof},deps);
  return {...f,record,candidate,deps};
}
async function accountRecoveryFixture(t) {
  const f=await newRecoveryFixture(t),root=join(f.base,'operations',f.record.lease.operationId,'inventories');
  await mkdir(root,{recursive:true,mode:0o700});await f.put(join(root,'source-revalidated.json'),f.captured.inventory);
  await persistWorkflow(f.record,'END','PROOF_REVALIDATED',{},f.deps);
  await persistWorkflow(f.record,'BEGIN','ACCOUNT_PRE_CONNECTION',{account:{operation:'RECOVER_ADMIN',phase:'PRE_CONNECTION',boundBackend:null}},f.deps);
  return f;
}
test('PP1c_R01_guard_revalidates_real_active_registry_and_fixed_source_copy_without_backend',async t=>{
  const f=await accountRecoveryFixture(t);f.deps.command=()=>{throw Error('unexpected backend/probe');};
  assert.equal(await verifier.revalidateRecoveryGuard(f.record,f.deps),true);
});
for(const fault of ['source-copy','missing-copy','current-request','current-lease','foreign-lock','clone-record'])test(`PP1c_R01_guard_rejects_${fault}`,async t=>{
  const f=await accountRecoveryFixture(t);let record=f.record;
  const sourcePath=join(f.base,'operations',record.lease.operationId,'inventories/source-revalidated.json');
  if(fault==='source-copy')await f.put(sourcePath,{...f.captured.inventory,files:[] ,unexpected:true});
  if(fault==='missing-copy')await rename(sourcePath,sourcePath+'.old');
  if(fault==='current-request')await f.put(join(f.base,'operations',record.lease.operationId+'.request.json'),{...record.request,environment:'changed'});
  if(fault==='current-lease')await f.put(join(f.base,'lease.json'),{...record.lease,helper:{}});
  if(fault==='foreign-lock')record={...record,identity:{...record.identity,ino:record.identity.ino+1}};
  if(fault==='clone-record')record={...record,lease:{...record.lease,proof:{...f.proof,sourceIdentitySha256:'0'.repeat(64)}}};
  await assert.rejects(verifier.revalidateRecoveryGuard(record,f.deps));
});
async function currentInventoryFixture(t) {
  const f=await newRecoveryFixture(t),token=Object.freeze({}),authority=new WeakMap(),op=f.record.lease.operationId;
  let sequence=1;
  f.deps.workflow={assertWorkflow:async(value,{side,stage}={})=>{
    assert.equal(value,token);assert.equal(side,'source');
    const record=await loadWorkflow(f.lease.source.runId,f.deps,{allowPending:true});if(stage)assert.equal(record.lease.phase,stage);
    return {...record,target:record.lease.source,inspection:f.inspection,connection:record.lease.sourceConnection,
      operationId:record.lease.operationId,helperSequence:sequence};
  }};
  f.deps.helperProfile=async value=>{assert.equal(value,token);return {javaRuntimeVersion:'25.0.5+8',postgresServerVersion:'16.15',pgDumpVersion:'16.15',pgRestoreVersion:'16.15'};};
  f.deps.inventoryAuthority=async(value,result)=>{assert.equal(value,token);assert.ok(authority.has(result),'unowned inventory');return authority.get(result);};
  const path=join(f.base,'operations',op,'helper/1/output/inventory.json'),requestPath=join(f.base,'operations',op,'helper/1/request.json');
  await mkdir(join(f.base,'operations',op,'helper/1/output'),{recursive:true,mode:0o700});
  const request={version:1,mode:'INVENTORY',operationId:op,side:'source',targetId:f.lease.source.targetId,releaseId:f.lease.releaseId,
    jdbcUrl:f.lease.sourceConnection.jdbcUrl,dbUser:'cms_local',passwordFile:'/run/secrets/spring.datasource.password',mediaRoot:'/media',
    outputFile:'/run/pp1/output/inventory.json',backupId:null,rawProofSha256:null};
  await f.put(requestPath,request);
  const issue=async inventory=>{
    rehashInventory(inventory);await f.put(path,inventory);const bytes=canonicalBytes(inventory),result=Object.freeze({});
    const metadata={kind:'INVENTORY',side:'source',operationId:op,seq:'1',targetId:f.lease.source.targetId,releaseId:f.lease.releaseId,
      path,sha256:sha256(bytes),byteSize:String(bytes.length),requestSha256:sha256(canonicalBytes(request))};
    authority.set(result,metadata);return {result,metadata};
  };
  return {...f,token,path,requestPath,issue,stale:()=>{sequence=2;}};
}
test('PP1c_R01_new_lock_seals_actual_owned_full_inventory_and_context',async t=>{
  const f=await currentInventoryFixture(t),{result}=await f.issue(structuredClone(f.captured.inventory));
  await assert.rejects(verifier.revalidatedRecoveryContext(f.token,f.deps));
  assert.deepEqual(await verifier.verifyRecoveryProof(f.token,{candidate:f.candidate,inventory:result},f.deps),{proof:f.proof});
  assert.deepEqual(await verifier.revalidatedRecoveryContext(f.token,f.deps),{proof:f.proof});
  const path=join(f.base,'operations',f.record.lease.operationId,'inventories/source-revalidated.json');
  assert.deepEqual(await readFile(path),canonicalBytes(f.captured.inventory));
  await assert.rejects(verifier.revalidatedRecoveryContext(structuredClone(f.token),f.deps));
  await assert.rejects(verifier.verifyRecoveryProof(f.token,{candidate:f.candidate,inventory:result},f.deps));
  await f.put(path,{...f.captured.inventory,unexpected:true});await assert.rejects(verifier.revalidatedRecoveryContext(f.token,f.deps));
});
for(const fault of ['rows','files','schema','unowned','stale','request','release','profile','candidate-clone'])test(`PP1c_R01_current_inventory_rejects_${fault}`,async t=>{
  const f=await currentInventoryFixture(t),inventory=structuredClone(f.captured.inventory);
  if(fault==='rows')authRows(inventory,'cms_principal')[0].display_name='different';
  if(fault==='files')inventory.files.push({objectKey:'new.bin',byteSize:'1',sha256:'f'.repeat(64),classification:'orphan'});
  if(fault==='schema')inventory.tables[0].schema.columns[0].columnDefault='different';
  let {result,metadata}=await f.issue(inventory);
  if(fault==='unowned')result=structuredClone(result);if(fault==='stale')f.stale();
  if(fault==='request')await f.put(f.requestPath,{});if(fault==='release')metadata.releaseId='sha256:'+'0'.repeat(64);
  if(fault==='profile')f.deps.helperProfile=async()=>({javaRuntimeVersion:'25.9',postgresServerVersion:'16.15',pgDumpVersion:'16.15',pgRestoreVersion:'16.15'});
  await assert.rejects(verifier.verifyRecoveryProof(f.token,{candidate:fault==='candidate-clone'?structuredClone(f.candidate):f.candidate,inventory:result},f.deps));
  await assert.rejects(readFile(join(f.base,'operations',f.record.lease.operationId,'inventories/source-revalidated.json')),{code:'ENOENT'});
});
test('PP1c_R01_lifecycle_rejects_tampered_final_smoke_bytes',async t=>{
  const f=await finalProofFixture(t);await verifier.completeRestoreVerification(f.token,f.sourceResult,f.deps);
  await writeFile(join(f.base,'operations',f.ctx.operationId,'smoke.json'),'{}\n');
  await assert.rejects(verifier.restoreLifecycleContext(f.token,f.deps));
});
test('PP1c_R01_publication_requires_private_generation_authority',async()=>{
  assert.equal(typeof verifier.publishRecoveryCandidate,'function');await assert.rejects(verifier.publishRecoveryCandidate({},{}));
});
test('PP1c_R01_publication_uses_original_proof_after_complete_release_and_atomically_replaces_locator',async t=>{
  const f=await persistedProofFixture(t),path=join(f.base,'recovery-candidate.json'),before=await readFile(path);
  await rename(path,path+'.previous');
  const locator=await verifier.publishRecoveryCandidate(f.token,f.proof,f.recoveryDeps);
  assert.deepEqual(await readFile(path),before);assert.equal(locator.proofSha256,f.proof.proofSha256);
  assert.equal((await lstat(path)).mode&0o777,0o600);
  await assert.rejects(verifier.publishRecoveryCandidate(f.token,f.proof,f.recoveryDeps));
  const candidate=await verifier.preflightRecovery(f.inspection,f.recoveryDeps);
  assert.deepEqual(await verifier.recoveryCandidateContext(candidate,f.inspection,f.recoveryDeps),{proof:f.proof});
});
test('PP1c_R01_publication_replaces_an_existing_private_locator',async t=>{
  const f=await persistedProofFixture(t),path=join(f.base,'recovery-candidate.json');
  const prior={version:1,sourceRunId:f.lease.source.runId,backupId:f.proof.backupId,restoreOperationId:f.lease.operationId,proofSha256:'0'.repeat(64)};
  await f.put(path,prior);
  const result=await verifier.publishRecoveryCandidate(f.token,f.proof,f.recoveryDeps);
  assert.equal(JSON.parse(await readFile(path)).proofSha256,f.proof.proofSha256);assert.equal(result.version,1);
});
for(const fault of ['token-clone','proof-clone','proof-bytes','smoke-bytes','receipt-bytes','bundle-bytes','unreleased','incomplete-history','occupied-temporary']) {
  test(`PP1c_R01_publication_rejects_${fault}_and_preserves_prior_locator`,async t=>{
    const f=await persistedProofFixture(t),path=join(f.base,'recovery-candidate.json'),before=await readFile(path);
    const proofPath=join(f.base,'operations',f.lease.operationId+'.proof.json'),originalProof=await readFile(proofPath);
    if(fault==='proof-bytes')await f.put(proofPath,{...f.proof,smokeSha256:'0'.repeat(64)});
    if(fault==='smoke-bytes')await f.put(join(f.base,'operations',f.lease.operationId,'smoke.json'),{});
    if(fault==='receipt-bytes')await f.put(join(f.base,'operations',f.lease.operationId,'restore-verified.json'),{});
    if(fault==='bundle-bytes')await writeFile(join(f.root,'bundles',f.proof.backupId,'db.dump'),'changed');
    if(fault==='unreleased')await mkdir(join(f.base,'operation.lock'),{mode:0o700});
    if(fault==='incomplete-history')await f.put(join(f.base,'operations',f.lease.operationId+'.json'),{...f.journal,records:f.journal.records.slice(0,-1)});
    if(fault==='occupied-temporary')await f.put(join(f.base,'recovery-candidate.next'),{preserve:true});
    await assert.rejects(verifier.publishRecoveryCandidate(fault==='token-clone'?structuredClone(f.token):f.token,
      fault==='proof-clone'?structuredClone(f.proof):f.proof,f.recoveryDeps));
    assert.deepEqual(await readFile(path),before);
    if(fault!=='proof-bytes')assert.deepEqual(await readFile(proofPath),originalProof);
  });
}
for(const name of ['proof','receipt','source-final','auth-delta','browser-assertions','smoke-fixture'])test(`PP1c_R01_final_context_rechecks_${name}`,async t=>{
  const f=await finalProofFixture(t);await verifier.completeRestoreVerification(f.token,f.sourceResult,f.deps);
  const opRoot=join(f.base,'operations',f.ctx.operationId);
  const path=name==='proof'?join(f.base,'operations',f.ctx.operationId+'.proof.json')
    :join(opRoot,name==='receipt'?'restore-verified.json':name==='source-final'?'inventories/source-final.json':name+'.json');
  await writeFile(path,'{}\n');await assert.rejects(verifier.restoreLifecycleContext(f.token,f.deps));
});
test('PP1c_R01_candidate_rejects_lock_replacement_after_binding',async t=>{
  const f=await newRecoveryFixture(t),lock=join(f.base,'operation.lock');
  await rename(lock,lock+'.prior');await mkdir(lock,{mode:0o700});
  await assert.rejects(verifier.recoveryCandidateContext(f.candidate,f.inspection,f.deps));
});

test('PP1c_R01_historical_inventory_preserves_existing_unbounded_artifact_size',async t=>{
  const f=await persistedProofFixture(t,{large:true});
  assert.ok(canonicalBytes(f.captured.inventory).length>1048576);
  assert.deepEqual(await verifier.preflightRecovery(f.inspection,f.recoveryDeps),{});
});
for(const fault of ['locator-stale','foreign-source','changed-connection'])test(`PP1c_R01_candidate_rejects_${fault}`,async t=>{
  const f=await persistedProofFixture(t),candidate=await verifier.preflightRecovery(f.inspection,f.recoveryDeps);
  if(fault==='locator-stale') {
    const path=join(f.base,'recovery-candidate.json'),locator=JSON.parse(await readFile(path));
    await f.put(path,{...locator,proofSha256:'0'.repeat(64)});
    await assert.rejects(verifier.recoveryCandidateContext(candidate,f.inspection,f.recoveryDeps));
  } else {
    const inspection=structuredClone(f.inspection);
    if(fault==='foreign-source'){inspection.target.sourceCommit='0'.repeat(40);inspection.target.apiBuild.sourceCommit=inspection.target.sourceCommit;}
    else inspection.jdbcUrl='jdbc:postgresql://10.0.0.3:5432/cms';
    const deps={...f.recoveryDeps,inspectionDetails:()=>({apiState:'stopped',runRoot:f.root})};
    await assert.rejects(verifier.recoveryCandidateContext(candidate,inspection,deps));
  }
});
test('PP1c_R01_default_guard_accepts_exact_bound_and_committed_account_without_probe',async t=>{
  const f=await accountRecoveryFixture(t),boundBackend={pid:42,backendStartEpoch:'1793970000.123456',db:'cms',role:'cms_local',
    clientAddr:f.record.lease.sourceConnection.dataGateway,applicationName:f.record.lease.operationId};
  f.deps.command=()=>{throw Error('unexpected backend/probe');};
  for(const phase of ['ACCOUNT_BOUND','ACCOUNT_COMMITTED']) {
    await persistWorkflow(f.record,'END',f.record.lease.phase,{},f.deps);
    await persistWorkflow(f.record,'BEGIN',phase,{account:{operation:'RECOVER_ADMIN',phase:phase==='ACCOUNT_BOUND'?'BOUND':'COMMITTED',boundBackend}},f.deps);
    assert.equal(await verifier.revalidateRecoveryGuard(f.record,f.deps),true);
  }
});
test('PP1c_R01_default_inventory_authority_cannot_be_reconstructed_from_result_JSON',async t=>{
  const f=await currentInventoryFixture(t),{result}=await f.issue(structuredClone(f.captured.inventory));
  delete f.deps.inventoryAuthority;
  await assert.rejects(verifier.verifyRecoveryProof(f.token,{candidate:f.candidate,inventory:result},f.deps));
});
test('PP1c_R01_final_context_remains_revalidated_during_complete_before_release',async t=>{
  const f=await finalProofFixture(t),result=await verifier.completeRestoreVerification(f.token,f.sourceResult,f.deps);
  f.ctx.lease.phase='COMPLETE';f.ctx.lease.proof=result.proof;
  assert.deepEqual((await verifier.restoreLifecycleContext(f.token,f.deps)).finalProof,result.proof);
  await writeFile(join(f.base,'operations',f.ctx.operationId,'restore-verified.json'),'{}\n');
  await assert.rejects(verifier.restoreLifecycleContext(f.token,f.deps));
});

async function coherentFailedRawProof(t,options={}) {
  const f=await persistedProofFixture(t,options),opRoot=join(f.base,'operations',f.lease.operationId);
  const captured=structuredClone(f.captured.inventory),manifest=structuredClone(f.captured.manifest);
  authRows(captured,'cms_permission')[0].action='write';rehashInventory(captured);
  const capturedBytes=canonicalBytes(captured),inventorySha256=sha256(capturedBytes);
  Object.assign(manifest.artifacts.find(a=>a.path==='inventory.json'),{sha256:inventorySha256,byteSize:String(capturedBytes.length)});
  Object.assign(manifest.inventory,{sha256:inventorySha256,dbSnapshotSha256:captured.dbSnapshotSha256});
  const manifestSha256=sha256(canonicalBytes(manifest));
  for(const root of [join(f.root,'bundles',f.proof.backupId),join(f.root,'protected-copy',f.proof.backupId)]) {
    await f.put(join(root,'inventory.json'),captured);await f.put(join(root,'manifest.json'),manifest);
    await f.put(join(root,'local-complete.json'),{...f.captured.complete,manifestSha256});
  }
  for(const name of ['source-before','source-after','source-final'])await f.put(join(opRoot,'inventories',name+'.json'),captured);
  const rawPath=join(opRoot,'raw-comparison.json'),raw=JSON.parse(await readFile(rawPath));
  const sourceTable=captured.tables.find(row=>row.tableName==='cms_permission');
  Object.assign(raw.tables.find(row=>row.tableName==='cms_permission'),{sourceRowsSha256:sourceTable.rowsSha256,rowsEqual:false});
  Object.assign(raw,{manifestSha256,sourceInventorySha256:inventorySha256,equal:false});
  const targetRaw=JSON.parse(await readFile(join(opRoot,'inventories/target-raw.json')));
  assert.equal(verifier.validateRawComparison(raw,manifest,{operationId:f.lease.operationId,sourceIdentity:f.lease.source,
    targetIdentity:f.lease.target.identity,sourceInventory:captured,targetInventory:targetRaw,
    targetInventorySha256:sha256(canonicalBytes(targetRaw))}).equal,false);
  await f.put(rawPath,raw);const rawComparisonSha256=sha256(canonicalBytes(raw));
  const commitRequestPath=join(opRoot,'helper/9/request.json'),commitRequest=JSON.parse(await readFile(commitRequestPath));
  await f.put(commitRequestPath,{...commitRequest,rawProofSha256:rawComparisonSha256});
  const smokePath=join(opRoot,'smoke.json'),smoke={...JSON.parse(await readFile(smokePath)),rawComparisonSha256};
  await f.put(smokePath,smoke);const smokeSha256=sha256(canonicalBytes(smoke));
  const receiptPath=join(opRoot,'restore-verified.json');
  await f.put(receiptPath,{...JSON.parse(await readFile(receiptPath)),manifestSha256,smokeReceiptSha256:smokeSha256});
  const {proofSha256:oldProofSha256,...oldProof}=f.proof;
  const proof={...oldProof,manifestSha256,bundleSetSha256:sha256(canonicalBytes(manifest.artifacts)),
    sourceInventorySha256:inventorySha256,rawComparisonSha256,smokeSha256};
  proof.proofSha256=sha256(canonicalBytes(proof));assert.notEqual(proof.proofSha256,oldProofSha256);
  await f.put(join(f.base,'operations',f.lease.operationId+'.proof.json'),proof);
  const lease={...f.lease,proof},journal=structuredClone(f.journal),leaseSha256=sha256(canonicalBytes(lease));
  for(const record of journal.records){record.leaseSha256=leaseSha256;if(record.proofSha256!==null)record.proofSha256=proof.proofSha256;}
  validateJournalV2(journal,lease);
  await f.put(join(f.base,'lease.json'),lease);await f.put(join(f.base,'operations',lease.operationId+'.json'),journal);
  await f.put(join(f.base,'recovery-candidate.json'),{version:1,sourceRunId:lease.source.runId,backupId:proof.backupId,
    restoreOperationId:lease.operationId,proofSha256:proof.proofSha256});
  return f;
}
test('PP1c_R01_complete_hashed_history_rejects_truthful_failed_RAW_comparison',async t=>{
  const f=await coherentFailedRawProof(t);
  await assert.rejects(verifier.preflightRecovery(f.inspection,f.recoveryDeps),{code:'RAW_MISMATCH'});
});

test('T186_reader_derives_real_private_inspection_and_full_released_material',async t=>{
  const f=await persistedProofFixture(t,{realSource:true});
  assert.equal(typeof verifier.readReadonlyMaterial,'function');
  const result=await verifier.readReadonlyMaterial({runId:f.lease.source.runId,backupId:f.proof.backupId,restoreOperationId:f.lease.operationId},f.recoveryDeps);
  assert.deepEqual(result.proof,f.proof);assert.ok(Object.isFrozen(result));
});
async function readonlyRegistryState186(base) {
  const rows=[];
  async function walk(path,relative='') {
    const info=await lstat(path);rows.push({path:relative,dev:info.dev,ino:info.ino,mode:info.mode,uid:info.uid,gid:info.gid,
      ...(info.isFile()?{sha256:sha256(await readFile(path))}:{})});
    if(info.isDirectory())for(const name of (await readdir(path)).sort())await walk(join(path,name),relative+'/'+name);
  }
  await walk(base);return rows;
}
test('T186_fixed_reader_ignores_fake_inspection_override_and_never_mutates_registry',async t=>{
  const f=await releasedSourceFixture(t),before=await readonlyRegistryState186(f.base);let overrides=0;
  assert.equal(f.token,undefined);assert.equal(f.deps,undefined);
  const deps={...f.readonlyDeps,inspectionDetails:()=>{overrides++;throw Error('fake authority must not be consulted');},inspectTarget:()=>{overrides++;throw Error('fake inspect must not be consulted');}};
  const result=await verifier.readReadonlyMaterial(f.readonlyIds,deps);
  assert.equal(overrides,0);assert.deepEqual(result.source.target,f.lease.source);assert.deepEqual(result.inventory,f.captured.inventory);
  assert.deepEqual(await readonlyRegistryState186(f.base),before);await assert.rejects(lstat(join(f.base,'operation.lock')),{code:'ENOENT'});
});
for(const fault of ['extra-path','extra-material','hidden-key','symbol-key','missing','wrong-run','wrong-backup','wrong-operation','proof','bundle','lock','journal','lease','source-oid','source-running','release','raw-false'])test(`T186_fixed_reader_rejects_${fault}`,async t=>{
  const f=fault==='raw-false'?await coherentFailedRawProof(t,{realSource:true}):await releasedSourceFixture(t);
  const ids={runId:f.lease.source.runId,backupId:f.proof.backupId,restoreOperationId:f.lease.operationId},deps=f.readonlyDeps??f.recoveryDeps;
  if(fault==='hidden-key')Object.defineProperty(ids,'path',{value:f.root});if(fault==='symbol-key')ids[Symbol('material')]={verified:true};
  if(fault==='extra-path')ids.path=f.root;if(fault==='extra-material')ids.material={verified:true};if(fault==='missing')delete ids.backupId;
  if(fault==='wrong-run')ids.runId='f'.repeat(32);if(fault==='wrong-backup')ids.backupId=ids.backupId.slice(0,-32)+'f'.repeat(32);
  if(fault==='wrong-operation')ids.restoreOperationId='ffffffff-ffff-4fff-8fff-ffffffffffff';
  if(fault==='proof')await f.put(join(f.base,'operations',ids.restoreOperationId+'.proof.json'),{...f.proof,smokeSha256:'0'.repeat(64)});
  if(fault==='bundle')await writeFile(join(f.root,'protected-copy',f.proof.backupId,'db.dump'),'changed');
  if(fault==='lock')await mkdir(join(f.base,'operation.lock'),{mode:0o700});
  if(fault==='journal')await f.put(join(f.base,'operations',ids.restoreOperationId+'.json'),{...f.journal,records:f.journal.records.slice(0,-1)});
  if(fault==='lease')await f.put(join(f.base,'lease.json'),{...f.lease,unknown:true});
  if(fault==='source-oid')f.realSource.state.oid='99999';if(fault==='source-running')f.realSource.state.containers[1].State.Running=true;
  if(fault==='release')f.realSource.state.containers[1].Image='sha256:'+'0'.repeat(64);
  await assert.rejects(verifier.readReadonlyMaterial(ids,deps));
});
test('T186_fixed_reader_rejects_registry_lock_race_at_final_source_inspection',async t=>{
  const f=await releasedSourceFixture(t),command=f.readonlyDeps.command;let oidReads=0;
  f.readonlyDeps.command=async(file,args,options)=>{
    const value=await command(file,args,options);
    if(args.at(-1)==='SELECT oid FROM pg_database WHERE datname = current_database();'&&++oidReads===2)
      await mkdir(join(f.base,'operation.lock'),{mode:0o700});
    return value;
  };
  await assert.rejects(verifier.readReadonlyMaterial(f.readonlyIds,f.readonlyDeps),{code:'LOCK_BUSY'});
});

test('T191_pure_current_inventory_rejects_coherent_same_count_row_drift',()=>{
  const before=inventory(),table=before.tables.find(t=>t.tableName==='cms_permission');
  table.rows=[Object.fromEntries(table.schema.columns.map(c=>[c.name,null]))];table.rows[0].action='read';rehashInventory(before);
  const after=structuredClone(before);after.tables.find(t=>t.tableName==='cms_permission').rows[0].action='write';rehashInventory(after);
  assert.throws(()=>verifier.validateCurrentSourceInventory(before,after),{code:'RAW_MISMATCH'});
});

function readonlyArgs191(f) {return ['--run-id',f.readonlyIds.runId,'--backup-id',f.readonlyIds.backupId,'--restore-operation-id',f.readonlyIds.restoreOperationId];}
test('T191_default_actual_private_observation_outputs_only_validated_COMPLETE',async t=>{
  const f=await readonlyRunnerFixture(t);f.observation.closeObservation(f.token);const chunks=[];let injected=0;
  const forbidden=()=>{injected++;throw Error('injected authority must never run');};
  const exit=await verifier.run(readonlyArgs191(f),{...f.deps,stdout:{write:b=>chunks.push(Buffer.from(b))},
    helperProfile:forbidden,inventoryAuthority:forbidden,beginReadonlyObservation:forbidden,runReadonlyInventory:forbidden,
    validator:forbidden,material:{verified:true},result:{verified:true}});
  assert.equal(exit,0);assert.equal(injected,0);assert.equal(chunks.length,1);
  const receipt=JSON.parse(chunks[0]);assert.deepEqual(receipt,{operationId:f.lease.operationId,backupId:f.proof.backupId,phase:'COMPLETE',code:null,exitCode:0});
  assert.deepEqual(chunks[0],canonicalBytes(receipt));assert.equal(f.events.created.length,7);assert.equal(f.events.endedBeforeFrames,1);
});

test('T191_real_direct_CLI_absent_source_never_deadlocks_self_import',async t=>{
  const f=await releasedSourceFixture(t),absent=join(f.cwd,'absent');await mkdir(absent,{mode:0o700});
  const script=new URL('./local-recovery-verify.mjs',import.meta.url).pathname;
  const result=spawnSync(process.execPath,[script,...readonlyArgs191(f)],{cwd:absent,env:{PATH:''},encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined);assert.notEqual(result.status,13);assert.notEqual(result.status,0);
  const receipt=JSON.parse(result.stdout);assert.deepEqual(Object.keys(receipt).sort(),['backupId','code','exitCode','operationId','phase']);
  assert.equal(receipt.operationId,f.lease.operationId);assert.equal(receipt.backupId,f.proof.backupId);
  assert.equal(receipt.exitCode,result.status);assert.equal(receipt.phase,null);assert.notEqual(receipt.code,'ADAPTER_UNSEALED');
  assert.deepEqual(Buffer.from(result.stdout),canonicalBytes(receipt));assert.equal(result.stderr,'');
});
test('T191_real_direct_CLI_present_private_source_empty_PATH_reaches_loader_before_Docker',async t=>{
  const f=await releasedSourceFixture(t),script=new URL('./local-recovery-verify.mjs',import.meta.url).pathname;
  const result=spawnSync(process.execPath,[script,...readonlyArgs191(f)],{cwd:f.cwd,env:{PATH:''},encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined);assert.notEqual(result.status,13);assert.notEqual(result.status,0);
  const receipt=JSON.parse(result.stdout);assert.deepEqual(Object.keys(receipt).sort(),['backupId','code','exitCode','operationId','phase']);
  assert.equal(receipt.operationId,f.lease.operationId);assert.equal(receipt.exitCode,result.status);assert.equal(receipt.phase,null);
  assert.deepEqual(Buffer.from(result.stdout),canonicalBytes(receipt));assert.equal(result.stderr,'');
});

function fullPureInventory191() {
  const value=inventory(),id='10000000-0000-4000-8000-000000000001';
  for(const table of value.tables)if(!table.rows.length)table.rows=[Object.fromEntries(table.schema.columns.map(c=>[c.name,null]))];
  const asset={id,contentType:'application/pdf',byteSize:'3',storedBytes:'3',checksumSha256:'a'.repeat(64),width:null,height:null,status:'available'};
  const variant={mediaId:id,variant:'original',contentType:'application/pdf',byteSize:'3',width:null,height:null,objectKey:'a.pdf'};
  value.assets=[asset];value.variants=[variant];value.files=[{objectKey:'a.pdf',byteSize:'3',sha256:asset.checksumSha256,classification:'referenced'}];
  Object.assign(value.tables.find(t=>t.tableName==='cms_media').rows[0],{id,content_type:asset.contentType,byte_size:'3',stored_bytes:'3',checksum_sha256:asset.checksumSha256,status:'available'});
  Object.assign(value.tables.find(t=>t.tableName==='cms_media_variant').rows[0],{media_id:id,variant:'original',content_type:variant.contentType,byte_size:'3',object_key:'a.pdf'});
  rehashInventory(value);validateInventory(value);return value;
}
for(const name of inventory().tables.map(t=>t.tableName))for(const kind of ['row','schema'])test(`T191_pure_${name}_${kind}_coherent_drift`,()=>{
  const before=fullPureInventory191(),after=structuredClone(before),table=after.tables.find(t=>t.tableName===name);
  if(kind==='schema')table.schema.columns[0].isNullable=!table.schema.columns[0].isNullable;
  else if(name==='cms_media_variant'){table.rows[0].object_key='z.pdf';after.variants[0].objectKey='z.pdf';after.files[0].objectKey='z.pdf';}
  else table.rows[0][name==='cms_media'?'title':name==='flyway_schema_history'?'description':table.schema.columns[0].name]='changed';
  rehashInventory(after);validateInventory(after);assert.equal(table.rowCount,before.tables.find(t=>t.tableName===name).rowCount);
  assert.throws(()=>verifier.validateCurrentSourceInventory(before,after),{code:'RAW_MISMATCH'});
});
test('T191_pure_literal_equal_and_physical_media_bytes_and_header',()=>{
  const before=fullPureInventory191();assert.equal(verifier.validateCurrentSourceInventory(before,structuredClone(before)),true);
  const after=structuredClone(before);after.files[0].sha256='b'.repeat(64);after.assets[0].checksumSha256='b'.repeat(64);
  after.tables.find(t=>t.tableName==='cms_media').rows[0].checksum_sha256='b'.repeat(64);rehashInventory(after);validateInventory(after);
  assert.throws(()=>verifier.validateCurrentSourceInventory(before,after),{code:'RAW_MISMATCH'});
  const bad=structuredClone(before);bad.mediaHeaderSha256='0'.repeat(64);assert.throws(()=>verifier.validateCurrentSourceInventory(before,bad),{code:'RAW_MISMATCH'});
});
test('T191_pure_does_not_apply_nine_directed_CHECK_exceptions',async()=>{
  const pairs=JSON.parse(await readFile(new URL('../../docs/v2/contracts/fixtures/pp1c-check-definition-pairs-v1.json',import.meta.url)));
  for(const pair of pairs.pairs){
    const before=fullPureInventory191(),after=structuredClone(before);
    before.tables.find(t=>t.tableName===pair.tableName).schema.constraints=[{...pair.constraintMetadata,definition:pair.sourceDefinition}];
    after.tables.find(t=>t.tableName===pair.tableName).schema.constraints=[{...pair.constraintMetadata,definition:pair.restoredDefinition}];
    rehashInventory(before);rehashInventory(after);validateInventory(before);validateInventory(after);
    assert.throws(()=>verifier.validateCurrentSourceInventory(before,after),{code:'RAW_MISMATCH'});
  }
});
for(const fault of ['current-row','final-bundle','registry','abort'])test(`T191_default_actual_${fault}_never_emits_success`,async t=>{
  const abort=new AbortController(),options={signal:abort.signal};
  if(fault==='current-row')options.mutateInventory=value=>{value.tables.find(t=>t.tableName==='cms_principal').rows[0].display_name='coherent-drift';rehashInventory(value);};
  options.afterBackendEnded=({f})=>{
    if(fault==='final-bundle')appendFileSync(join(f.root,'protected-copy',f.proof.backupId,'db.dump'),'changed');
    if(fault==='registry')mkdirSync(join(f.base,'operation.lock'),{mode:0o700});
    if(fault==='abort')abort.abort();
  };
  const f=await readonlyRunnerFixture(t,options);f.observation.closeObservation(f.token);const chunks=[];
  const listeners=['SIGINT','SIGTERM'].map(signal=>process.listenerCount(signal));
  const exit=await verifier.run(readonlyArgs191(f),{...f.deps,stdout:{write:b=>chunks.push(Buffer.from(b))}});
  assert.notEqual(exit,0);assert.equal(chunks.length,1);const receipt=JSON.parse(chunks[0]);
  assert.equal(receipt.operationId,f.lease.operationId);assert.equal(receipt.backupId,f.proof.backupId);assert.equal(receipt.phase,null);assert.equal(receipt.exitCode,exit);
  if(fault==='current-row')assert.equal(receipt.code,'RAW_MISMATCH');if(fault==='final-bundle')assert.equal(receipt.code,'BUNDLE_MISMATCH');if(fault==='abort')assert.equal(receipt.code,'INTERRUPTED');
  assert.equal(f.events.created.length,7);if(fault==='final-bundle')assert.equal(f.events.removed.length,7);
  t.diagnostic(JSON.stringify({fault,code:receipt.code,exit,created:f.events.created.length,removed:f.events.removed.length}));
  assert.deepEqual(['SIGINT','SIGTERM'].map(signal=>process.listenerCount(signal)),listeners);
});

for(const signalName of ['SIGINT','SIGTERM'])test(`T191_default_${signalName}_during_preflight_cancels_without_helpers`,async t=>{
  const f=await readonlyRunnerFixture(t);f.observation.closeObservation(f.token);const command=f.deps.command,chunks=[];let sent=false;
  const before=process.listenerCount(signalName);
  f.deps.command=async(...args)=>{if(!sent){sent=true;process.emit(signalName);}return command(...args);};
  const exit=await verifier.run(readonlyArgs191(f),{...f.deps,stdout:{write:b=>chunks.push(Buffer.from(b))}});
  assert.equal(exit,10);assert.equal(JSON.parse(chunks[0]).code,'INTERRUPTED');assert.equal(f.events.created.length,0);
  assert.equal(process.listenerCount(signalName),before);
});

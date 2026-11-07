import { verifiedHelperProfile } from '../local/maintenance-helper.mjs';
import { spawnSync } from 'node:child_process';
import * as verifier from './local-recovery-verify.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rename, symlink, chmod, lstat, readdir } from 'node:fs/promises';
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
test('PP1c_C10b2_valid_cli_is_explicitly_unsealed_and_import_is_idle',async()=>{
  const args=['--run-id','a'.repeat(32),'--backup-id','pp1-20261102T120000000Z-'+'b'.repeat(32),
    '--restore-operation-id','11111111-1111-4111-8111-111111111111'];
  const result=spawnSync(process.execPath,['scripts/ops/local-recovery-verify.mjs',...args],{encoding:'utf8'});
  assert.equal(result.status,7);assert.equal(result.stderr,'');assert.equal(JSON.parse(result.stdout).code,'ADAPTER_UNSEALED');
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
async function checkFixture(t, {selected, mutateTarget, mutateSource, configure} = {}) {
  return rawFixture(t, {
    baseInventory: checkInventory(),
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

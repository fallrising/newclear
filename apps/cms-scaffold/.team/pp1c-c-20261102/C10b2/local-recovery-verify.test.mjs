import { verifiedHelperProfile } from '../local/maintenance-helper.mjs';
import { spawnSync } from 'node:child_process';
import * as verifier from './local-recovery-verify.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rename, symlink, chmod, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, rawFixture } from './local-recovery.fixture.mjs';
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

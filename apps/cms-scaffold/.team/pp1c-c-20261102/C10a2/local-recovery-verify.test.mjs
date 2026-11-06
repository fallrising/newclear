import { verifiedHelperProfile } from '../local/maintenance-helper.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rename, symlink, chmod, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './local-recovery.fixture.mjs';
import { captureSource } from './local-bundle.mjs';
import { canonicalBytes, sha256 } from './recovery-protocol.mjs';
import { verifyCapturedBundle, protectCapturedBundle, restoreBundleMaterial } from './local-recovery-verify.mjs';
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

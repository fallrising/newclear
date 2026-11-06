import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './local-recovery.fixture.mjs';
import { captureSource } from './local-bundle.mjs';
import { canonicalBytes, sha256 } from './recovery-protocol.mjs';
import { verifyCapturedBundle } from './local-recovery-verify.mjs';
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

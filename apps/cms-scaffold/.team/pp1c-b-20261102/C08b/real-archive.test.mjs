import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from '../../../scripts/ops/local-bundle.test.mjs';
import {captureSource} from '../../../scripts/ops/local-bundle.mjs';
const dump = await readFile('local/pp1c-format-probe/actual-pg16.dump');
test('PP1c_C08_real_PG16_archive_and_truncated_copy',async t=>{
  const good=await fixture(t);good.state.dumpBytes=dump;
  const result=await captureSource(good.token,good.deps);
  assert.equal(result.manifest.artifacts[0].byteSize,String(dump.length));
  const bad=await fixture(t);bad.state.dumpBytes=dump.subarray(0,dump.length-1);
  await assert.rejects(captureSource(bad.token,bad.deps),e=>e.code==='BUNDLE_MISMATCH');
});

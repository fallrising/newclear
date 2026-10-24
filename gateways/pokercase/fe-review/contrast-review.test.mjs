import test from 'node:test';
import assert from 'node:assert/strict';
import {contrastViewport} from './contrast-review.mjs';
test('desktop contrast uses its real canonical viewport rather than mobile fallback',()=>{
  assert.deepEqual(contrastViewport('desktop'),{width:1440,height:900});
  assert.deepEqual(contrastViewport('tablet'),{width:834,height:1112});
  assert.deepEqual(contrastViewport('mobile'),{width:390,height:844});
  for(const name of ['unknown','toString','__proto__',''])assert.throws(()=>contrastViewport(name),/REVIEW_CONTRAST_UNKNOWN_VIEWPORT/);
});

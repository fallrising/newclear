import test from 'node:test';
import assert from 'node:assert/strict';
import {negativeState} from './negative-state.mjs';
test('missing mobile state has exact stable key, anonymous identity and actual401',()=>{
 assert.deepEqual(negativeState('mobile',401),{captureName:'mobile-bad-password',evidence:{anonymousContext:true,actualStatus:401,alert:true}});
 assert.throws(()=>negativeState({name:'mobile',width:390,height:844},401),/REVIEW_NEGATIVE_VIEWPORT/);
 assert.throws(()=>negativeState('mobile',200),/REVIEW_BAD_PASSWORD_STATUS/);
 assert.equal(negativeState('desktop',401).captureName,'desktop-bad-password');
});

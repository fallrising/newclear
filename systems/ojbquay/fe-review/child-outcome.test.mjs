import test from 'node:test';
import assert from 'node:assert/strict';
import {childFailure} from './child-outcome.mjs';
test('deadline and original exit remain primary when cleanup also fails',()=>{
 assert.equal(childFailure({label:'states',timedOut:true,exitCode:null,signal:'SIGTERM',cleanup:false}),'REVIEW_STATES_TIMEOUT');
 assert.equal(childFailure({label:'states',timedOut:false,exitCode:1,signal:null,cleanup:false}),'REVIEW_STATES_EXIT');
 assert.equal(childFailure({label:'states',timedOut:false,exitCode:0,signal:null,cleanup:false}),'REVIEW_CHILD_CLEANUP');
 assert.equal(childFailure({label:'states',timedOut:false,exitCode:0,signal:null,cleanup:true}),null);
});

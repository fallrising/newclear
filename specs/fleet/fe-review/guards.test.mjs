import test from 'node:test';
import assert from 'node:assert/strict';
import { enabledAction } from './guards.mjs';
test('enabled receipt requires the positive intended button and row identity',()=>{
 const good={present:true,id:'act-hello-redeploy',rowId:'row-hello',disabled:false};
 assert.equal(enabledAction(good),true);
 for(const value of [null,{}, {...good,present:false},{...good,disabled:true},{...good,rowId:'row-other'},{...good,id:'other'}])assert.equal(enabledAction(value),false);
});

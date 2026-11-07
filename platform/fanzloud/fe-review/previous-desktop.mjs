/** SPEC-T006R-tablet-mobile-v6 P01: fixed-source desktop evidence from the v4 recovery and v5 remaining runs. */
import assert from 'node:assert/strict';
import {scenarios} from './fixture.mjs';
export const PRODUCT_SOURCE_KEYS=Object.freeze(['fixture.mjs','transport.mjs','lifecycle.mjs','trust.mjs','baseline-support.mjs','/','/assets/p0-app.js','/assets/p0-client.js','/assets/p0.css']);
const fail='REVIEW_PREVIOUS_DESKTOP';
const goodRow=r=>r.semanticPassed===true&&r.assetStatus===200&&r.storageSafe===true&&r.dom?.bearerEmpty===true&&r.dom.promptEmpty===true&&r.dom.inertDiff===true&&typeof r.png?.sha256==='string'&&r.png.sha256.length>0&&Array.isArray(r.health)&&r.health.length>0&&r.health.every(e=>e.expected===true)&&(!r.key.startsWith('disconnected__')||(r.reconnectedWithoutMutation===true&&Array.isArray(r.postReconnectHealth)&&r.postReconnectHealth.length>0&&r.postReconnectHealth.every(e=>e.expected===true)));
export function assertPreviousDesktop(recovery,remaining,currentHashes){
 for(const[result,phase]of[[recovery,'desktop-recovery'],[remaining,'desktop-remaining']]){
  assert(result?.passed===true&&result.stage==='COMPLETE'&&result.mode==='remaining-baseline'&&result.phase===phase&&result.viewport==='desktop'&&result.reuse==='NONE_SOURCE_CHANGED',fail);
  assert(Array.isArray(result.captures)&&result.captures.every(goodRow),fail);
  for(const key of PRODUCT_SOURCE_KEYS)assert(typeof currentHashes[key]==='string'&&result.sourceHashes?.[key]===currentHashes[key],fail);
  for(const[key,hash]of Object.entries(currentHashes))if(Object.hasOwn(result.sourceHashes,key))assert.equal(result.sourceHashes[key],hash,fail);
  assert.deepEqual([result.tools?.node,result.tools?.playwright,result.tools?.chromium],['v24.18.0','1.63.0','153.0.8010.12'],fail);
  assert(result.cleanup?.cancelled===false&&result.cleanup.drainComplete===true&&result.cleanup.listenerAbsent===true&&result.cleanup.resources.every(r=>r.closed===true),fail);
 }
 assert.deepEqual([...recovery.captures,...remaining.captures].map(r=>r.key).sort(),scenarios.map(state=>state+'__desktop__dark').sort(),fail);
 assert.deepEqual(recovery.captures.map(r=>r.key),['recovery-required__desktop__dark'],fail);
 assert.deepEqual(remaining.captures.map(r=>r.key),scenarios.slice(0,8).map(state=>state+'__desktop__dark'),fail);
}

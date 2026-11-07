/** SPEC-T006R-recapture-v7 R702: assertPreviousPhase for a nine-key v7 desktop previous phase. */
import assert from 'node:assert/strict';
import {scenarios} from './fixture.mjs';
export function assertPreviousDesktopFull(previous,currentHashes){
 assert(previous?.passed===true&&previous.mode==='remaining-baseline'&&previous.phase==='desktop'&&previous.viewport==='desktop'&&previous.stage==='COMPLETE','REVIEW_PREVIOUS_PHASE');
 assert.deepEqual(previous.captures.map(r=>r.key),scenarios.map(state=>state+'__desktop__dark'),'REVIEW_PREVIOUS_KEYS');for(const r of previous.captures){assert(r.semanticPassed&&r.assetStatus===200&&r.storageSafe&&r.dom.bearerEmpty&&r.dom.promptEmpty&&r.dom.inertDiff&&r.png?.sha256&&r.health.length>0&&r.health.every(e=>e.expected),'REVIEW_PREVIOUS_ROW');if(r.key.startsWith('disconnected__'))assert(r.reconnectedWithoutMutation&&Array.isArray(r.postReconnectHealth)&&r.postReconnectHealth.length>0&&r.postReconnectHealth.every(e=>e.expected),'REVIEW_PREVIOUS_RECOVERY');}
 for(const[file,hash]of Object.entries(currentHashes))assert.equal(previous.sourceHashes[file],hash,'REVIEW_PREVIOUS_SOURCE');assert.deepEqual([previous.tools.node,previous.tools.playwright,previous.tools.chromium],['v24.18.0','1.63.0','153.0.8010.12'],'REVIEW_PREVIOUS_TOOLS');assert(previous.cleanup.cancelled===false&&previous.cleanup.drainComplete&&previous.cleanup.listenerAbsent&&previous.cleanup.resources.every(r=>r.closed),'REVIEW_PREVIOUS_CLEANUP');
}

/** Formal baseline adapter. Historical control acceptance is external and explicit. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readVerdict} from './disconnected-observer.mjs';
import {runOrderedAxe,assertFinalOrdering} from './disconnected-ordering.mjs';
import {assertStateCounts,assertPostReconnect} from './remaining-support.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const key='disconnected__desktop__dark';
const resultSha256='e02e4bf3a94884b7ad23bfde4cd0b557fedf4bfd36161fda9757fd2c0e7be6dc';
const pngSha256='31c869d51b24ca81b4a386e6b85b454f3996df69ca73788408df22c53c3b0de6';
// The formal runner/selection adapter changed. These actual product/observer dependencies did not.
export const REUSE_SOURCE_NAMES=Object.freeze(['fixture.mjs','transport.mjs','lifecycle.mjs','baseline-support.mjs','trust.mjs','bootstrap-observer.mjs','canceled-observer.mjs','canceled-combined.mjs','remaining-observe.mjs','disconnected-observer.mjs','disconnected-timeline.mjs','disconnected-timeline-observer.mjs','disconnected-ordering.mjs','/','/assets/p0-app.js','/assets/p0-client.js','/assets/p0.css']);
const clean=health=>Array.isArray(health)&&health.length>0&&health.every(e=>e.expected===true);
export async function runFormalAxe(state,options){return state==='disconnected'?runOrderedAxe(options):options.axe();}
export function assertFormalDisconnectedFinal(row,health,fixture){
 assert.equal(readVerdict(row.getObservation),'PASS','REVIEW_GET_OBSERVER');
 assert(row.reconnectSettled&&row.finalUI&&['connected','idle','authenticated','bearerEmpty','promptEmpty','errorEmpty'].every(k=>row.finalUI[k]===true),'REVIEW_RECONNECT_SETTLEMENT');
 assertPostReconnect(row,health,fixture);assertStateCounts('disconnected',fixture);
 assert.equal(row.disconnectCalls,1,'REVIEW_DISCONNECT_COUNT');assertFinalOrdering(row.preAxe,health);
}
export function assertOrderingEvidence(original,currentHashes){
 assert(original?.passed===true&&original.stage==='COMPLETE'&&!original.failure&&original.mode==='disconnected-only'&&original.viewport==='desktop','REVIEW_REUSE_RESULT');
 assert.deepEqual(original.captures?.map(r=>r.key),[key],'REVIEW_REUSE_KEYS');const row=original.captures[0];
 assert(row.semanticPassed&&row.assetStatus===200&&row.state==='disconnected'&&row.viewport==='desktop'&&row.requestedURL==='https://127.0.0.1:8443/'&&row.finalURL===row.requestedURL,'REVIEW_REUSE_STATE');
 assert(row.socketClosedObserved&&row.storageSafe&&row.dom?.bearerEmpty&&row.dom.promptEmpty&&row.dom.inertDiff&&row.bootstrapDiagnostic?.verdict==='PASS','REVIEW_REUSE_STATE');
 assert.deepEqual(row.manualActions,['authenticate'],'REVIEW_REUSE_ACTIONS');
 for(const health of [row.initialHealth,row.bootstrapDiagnostic.health,row.preAxe?.health,row.health,row.postReconnectHealth])assert(clean(health),'REVIEW_REUSE_HEALTH');
 assert.equal(readVerdict(row.preAxe?.observation),'PASS','REVIEW_REUSE_PRE_AXE_BODY');
 assert(row.preAxe.waitOutcome==='PAIR_TERMINAL'&&row.preAxe.pair?.pendingReads===0&&['session','login'].every(c=>row.preAxe.pair[c]?.count===1&&row.preAxe.pair[c].finished===true&&row.preAxe.pair[c].failed===false),'REVIEW_REUSE_PAIR');
 assertFormalDisconnectedFinal(structuredClone(row),row.postReconnectHealth,row.fixture);
 assertStateCounts('disconnected',row.beforeCleanupFixture);
 assert(row.png?.privatePath==='screenshots/'+key+'.png'&&row.png.sha256===pngSha256&&row.png.width===1440&&row.png.height===1335,'REVIEW_REUSE_PNG');
 assert(original.cleanup?.cancelled===false&&original.cleanup.drainComplete&&original.cleanup.listenerAbsent&&original.cleanup.resources?.length>0&&original.cleanup.resources.every(r=>r.closed===true),'REVIEW_REUSE_CLEANUP');
 assert.deepEqual([original.tools?.node,original.tools?.playwright,original.tools?.chromium],['v24.18.0','1.63.0','153.0.8010.12'],'REVIEW_REUSE_TOOLS');
 for(const name of REUSE_SOURCE_NAMES)assert(typeof currentHashes?.[name]==='string'&&currentHashes[name]===original.sourceHashes?.[name],'REVIEW_REUSE_SOURCE');
 const timeline=original.timeline;assert(timeline?.overflow===false&&timeline.invalid===false&&Array.isArray(timeline.events),'REVIEW_REUSE_TIMELINE');
 const begin=timeline.events.filter(e=>e.event==='AXE_BEGIN'),end=timeline.events.filter(e=>e.event==='AXE_END');assert(begin.length===1&&end.length===1&&end[0].timeMs>begin[0].timeMs,'REVIEW_REUSE_TIMELINE');
 for(const category of ['session','login']){const bodies=timeline.events.filter(e=>e.event==='BODY_END'&&e.category===category);assert(bodies.length===1&&bodies[0].outcome==='FULFILLED'&&bodies[0].timeMs<begin[0].timeMs,'REVIEW_REUSE_ORDERING');}
 return row;
}
export function acceptOrderingReuse({approval,bytes,png,currentHashes}){
 assert(approval?.schemaVersion===1&&approval.decision==='ACCEPT'&&approval.reviewer==='T050'&&approval.key===key,'REVIEW_REUSE_ACCEPTANCE');
 assert(approval.resultSha256===resultSha256&&sha(bytes)===resultSha256,'REVIEW_REUSE_MANIFEST');
 assert(approval.pngSha256===pngSha256&&sha(png)===pngSha256,'REVIEW_REUSE_PNG');
 const original=JSON.parse(bytes);assertOrderingEvidence(original,currentHashes);
 return {key,manifest:resultSha256,png:pngSha256,sourceHashes:original.sourceHashes,reusedFrom:'disconnected-ordering-001',independentReview:approval.reviewer};
}

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {scenarios} from './fixture.mjs';
import {bootstrapVerdict} from './bootstrap-observer.mjs';
import {diagnosticVerdict} from './canceled-observer.mjs';
import {assertMutationCounts} from './canceled-combined.mjs';
const viewports={desktop:{width:1440,height:900},tablet:{width:834,height:1112},mobile:{width:390,height:844}};
export function selectPhase(args){assert(Array.isArray(args)&&args.length===1,'REVIEW_PHASE_ARGUMENTS');const phase=args[0];assert(['desktop-recovery','tablet','mobile'].includes(phase),'REVIEW_PHASE');const viewport=phase==='desktop-recovery'?'desktop':phase;return {phase,viewport,size:viewports[viewport],states:phase==='desktop-recovery'?scenarios.slice(8):[...scenarios]};}
export function assertPreviousPhase(phase,previous,currentHashes){
 if(phase==='desktop-recovery'){assert.equal(previous,null,'REVIEW_UNEXPECTED_PREVIOUS');return;}
 const expectedPhase=phase==='tablet'?'desktop-recovery':phase==='mobile'?'tablet':null;assert(expectedPhase,'REVIEW_PHASE');const selected=selectPhase([expectedPhase]);assert(previous?.passed===true&&previous.mode==='remaining-baseline'&&previous.phase===expectedPhase&&previous.viewport===selected.viewport&&previous.stage==='COMPLETE','REVIEW_PREVIOUS_PHASE');
 assert.deepEqual(previous.captures.map(r=>r.key),selected.states.map(state=>state+'__'+selected.viewport+'__dark'),'REVIEW_PREVIOUS_KEYS');for(const r of previous.captures){assert(r.semanticPassed&&r.assetStatus===200&&r.storageSafe&&r.dom.bearerEmpty&&r.dom.promptEmpty&&r.dom.inertDiff&&r.png?.sha256&&r.health.length>0&&r.health.every(e=>e.expected),'REVIEW_PREVIOUS_ROW');if(r.key.startsWith('disconnected__'))assert(r.reconnectedWithoutMutation&&Array.isArray(r.postReconnectHealth)&&r.postReconnectHealth.length>0&&r.postReconnectHealth.every(e=>e.expected),'REVIEW_PREVIOUS_RECOVERY');}
 for(const[file,hash]of Object.entries(currentHashes))assert.equal(previous.sourceHashes[file],hash,'REVIEW_PREVIOUS_SOURCE');assert.deepEqual([previous.tools.node,previous.tools.playwright,previous.tools.chromium],['v24.18.0','1.63.0','153.0.8010.12'],'REVIEW_PREVIOUS_TOOLS');assert(previous.cleanup.cancelled===false&&previous.cleanup.drainComplete&&previous.cleanup.listenerAbsent&&previous.cleanup.resources.every(r=>r.closed),'REVIEW_PREVIOUS_CLEANUP');
}
export function assertPreviousPNGs(previous,read){for(const row of previous.captures){assert.equal(row.png.privatePath,'screenshots/'+row.key+'.png','REVIEW_PREVIOUS_PNG_PATH');assert.equal(createHash('sha256').update(read(row.png.privatePath)).digest('hex'),row.png.sha256,'REVIEW_PREVIOUS_PNG');}}
export function assertPostReconnect(row,latestHealth,fixture){row.postReconnectHealth=latestHealth;assert(Array.isArray(latestHealth)&&latestHealth.length>0&&latestHealth.every(e=>e.expected),'REVIEW_POST_RECONNECT_HEALTH');assert.equal(fixture.effects,1,'REVIEW_RECONNECT_MUTATION');row.reconnectedWithoutMutation=true;}
export function assertStateCounts(state,fixture){const base='POST /api/p0/v1/',hasTurn=['turn-busy','success-diff','action-rejected','canceled-local'].includes(state),started=hasTurn&&state!=='action-rejected';const expected={...(state!=='bootstrap-empty'?{[base+'operator/session']:1}:{}),...(hasTurn?{[base+'session/turns']:1}:{}),...(state==='device-pending'?{[base+'login/device']:1}:{}),...(state==='canceled-local'?{[base+'session/cancel']:1}:{})};for(const[k,v]of Object.entries(expected))assert.equal(fixture.counts[k],v,'REVIEW_MUTATION_COUNT');for(const[k,v]of Object.entries(fixture.counts))if(!k.startsWith('GET ')&&!k.startsWith('HEAD '))assert.equal(v,expected[k]??0,'REVIEW_EXTRA_MUTATION');assert.equal(fixture.effects,(state==='bootstrap-empty'?0:1)+(started?1:0)+(['device-pending','canceled-local'].includes(state)?1:0),'REVIEW_EFFECT_COUNT');assert.equal(fixture.turnStarts,started?1:0,'REVIEW_TURN_COUNT');}
const plans={
 'bootstrap-empty':[],'authenticated-ready':['authenticate'],'device-pending':['authenticate','start-login'],
 'turn-busy':['authenticate','submit-turn','refresh'],'success-diff':['authenticate','submit-turn','refresh','refresh','show-diff'],
 'action-rejected':['authenticate','submit-turn'],'canceled-local':['authenticate','submit-turn','refresh','cancel-turn'],
 disconnected:['authenticate'],'recovery-required':['authenticate']
};
const clean=d=>Array.isArray(d.health)&&d.health.length>0&&d.health.every(e=>e.expected===true);
export function createActionGuard(state,record){
 assert(Object.hasOwn(plans,state)&&Array.isArray(record)&&record.length===0,'REVIEW_STATE_PLAN');let failed=false,bootstrap=false,turn=false,device=false,rejected=false;
 const check=(condition,code)=>{if(!condition){failed=true;throw Error(code);}};
 return {
  async run(name,action){check(!failed,'REVIEW_FAILED_SEQUENCE');check(plans[state][record.length]===name,'REVIEW_ACTION_ORDER');check(name==='authenticate'||bootstrap,'REVIEW_BOOTSTRAP_GATE');check(!['refresh','cancel-turn','show-diff'].includes(name)||turn,'REVIEW_TURN_GATE');record.push(name);try{return await action();}catch(error){failed=true;throw error;}},
  bootstrap(d){check(!failed&&record.length===1&&record[0]==='authenticate','REVIEW_BOOTSTRAP_ORDER');d.verdict=d.settled?bootstrapVerdict(d):'FAIL';check(d.verdict==='PASS'&&clean(d),d.verdict==='OBSERVER_DISCREPANCY'?'REVIEW_OBSERVER_DISCREPANCY':'REVIEW_BOOTSTRAP_DIAGNOSTIC');bootstrap=true;},
  turn(d){check(!failed&&record.at(-1)==='submit-turn'&&state!=='action-rejected','REVIEW_TURN_ORDER');d.verdict=d.settled?diagnosticVerdict(d):'FAIL';check(d.verdict==='PASS'&&clean(d),d.verdict==='OBSERVER_DISCREPANCY'?'REVIEW_OBSERVER_DISCREPANCY':'REVIEW_TURN_DIAGNOSTIC');assertMutationCounts(d.fixture,2);turn=true;},
  device(d){check(!failed&&state==='device-pending'&&record.at(-1)==='start-login','REVIEW_DEVICE_ORDER');d.verdict=d.settled?diagnosticVerdict(d):'FAIL';check(d.verdict==='PASS'&&d.browserRequests===1&&d.serverResponses===1&&d.browserMutations===2&&d.serverMutations===2&&clean(d),'REVIEW_DEVICE_DIAGNOSTIC');device=true;},
  rejection(d){check(!failed&&state==='action-rejected'&&record.at(-1)==='submit-turn','REVIEW_REJECTION_ORDER');check(d.settled&&d.ui?.idle&&d.ui.pendingSessionReads===0&&d.status===403&&d.requestFinished===true&&d.requestFailed===false&&d.uiError==='ACTION_REJECTED'&&clean(d),'REVIEW_REJECTION_DIAGNOSTIC');rejected=true;},
  complete(){check(!failed,'REVIEW_FAILED_SEQUENCE');assert.deepEqual(record,plans[state],'REVIEW_ACTIONS_INCOMPLETE');check(state==='bootstrap-empty'||bootstrap,'REVIEW_BOOTSTRAP_GATE');check(state!=='device-pending'||device,'REVIEW_DEVICE_GATE');check(state!=='action-rejected'||rejected,'REVIEW_REJECTION_GATE');}
 };
}

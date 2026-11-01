/** Fixed one-journey orchestration. Pure callbacks allow negative sequencing proofs. */
import assert from 'node:assert/strict';
import {bootstrapVerdict} from './bootstrap-observer.mjs';
import {diagnosticVerdict} from './canceled-observer.mjs';
const base='/api/p0/v1/';
export function assertMutationCounts(fixture,stage){
 assert([1,2,3].includes(stage),'REVIEW_STAGE');assert.equal(fixture.effects,stage,'REVIEW_EFFECT_COUNT');assert.equal(fixture.turnStarts,stage>1?1:0,'REVIEW_TURN_COUNT');
 const expected={['POST '+base+'operator/session']:1,...(stage>1?{['POST '+base+'session/turns']:1}:{}),...(stage>2?{['POST '+base+'session/cancel']:1}:{})};
 for(const[key,count]of Object.entries(expected))assert.equal(fixture.counts[key],count,'REVIEW_MUTATION_COUNT');for(const[key,count]of Object.entries(fixture.counts))if(!key.startsWith('GET ')&&!key.startsWith('HEAD '))assert.equal(count,expected[key]??0,'REVIEW_EXTRA_MUTATION');
}
const clean=health=>Array.isArray(health)&&health.length>0&&health.every(e=>e.expected===true);
export async function runCanceledOnly(actions){
 const{record}=actions;assert.deepEqual(record,[],'REVIEW_DUPLICATE_JOURNEY');const perform=async(name,action)=>{record.push(name);return actions[action]();};
 await perform('authenticate','authenticate');const bootstrap=await actions.observeBootstrap();bootstrap.verdict=bootstrap.settled?bootstrapVerdict(bootstrap):'FAIL';
 if(bootstrap.verdict!=='PASS')throw Error(bootstrap.verdict==='OBSERVER_DISCREPANCY'?'REVIEW_OBSERVER_DISCREPANCY':'REVIEW_BOOTSTRAP_DIAGNOSTIC');assert(clean(bootstrap.health),'REVIEW_BOOTSTRAP_HEALTH');assertMutationCounts(bootstrap.fixture,1);
 await perform('submit-turn','submit');const turn=await actions.observeTurn();turn.verdict=turn.settled?diagnosticVerdict(turn):'FAIL';
 if(turn.verdict!=='PASS')throw Error(turn.verdict==='OBSERVER_DISCREPANCY'?'REVIEW_OBSERVER_DISCREPANCY':'REVIEW_TURN_DIAGNOSTIC');assert(clean(turn.health),'REVIEW_TURN_HEALTH');assertMutationCounts(turn.fixture,2);
 await perform('refresh','refresh');await perform('cancel-turn','cancel');const result=await actions.verify();assertMutationCounts(result.fixture,3);assert(result.semanticPassed&&clean(result.health),'REVIEW_CANCELED_FINAL');assert.deepEqual(record,['authenticate','submit-turn','refresh','cancel-turn']);return result;
}

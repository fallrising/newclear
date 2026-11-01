/** New pre-axe ordering gate; original body observer and health verdict are unchanged. */
import assert from 'node:assert/strict';
import {readVerdict} from './disconnected-observer.mjs';
const clean=health=>Array.isArray(health)&&health.length>0&&health.every(event=>event.expected===true);
const bothActual=pair=>pair?.session?.count===1&&pair?.login?.count===1;
const terminal=row=>row?.finished===true||row?.failed===true;
export async function runOrderedAxe({proof,getPair,getHealth,finishObserver,life,axe,now=()=>performance.now(),pause=()=>new Promise(resolve=>setTimeout(resolve,20))}){
 proof.axeStarted=false;proof.axeCompleted=false;proof.waitOutcome='WAITING';proof.waitLimitMs=3500;proof.startedMonotonicMs=now();
 while(true){
  life.check();proof.pair=getPair();proof.health=getHealth();
  if(!clean(proof.health)){proof.waitOutcome='HEALTH_FAILED';break;}
  if(proof.pair?.session?.count>1||proof.pair?.login?.count>1){proof.waitOutcome='AMBIGUOUS_PAIR';break;}
  if(bothActual(proof.pair)&&terminal(proof.pair.session)&&terminal(proof.pair.login)&&proof.pair.pendingReads===0){proof.waitOutcome='PAIR_TERMINAL';break;}
  if(now()-proof.startedMonotonicMs>=3500){proof.waitOutcome='WAIT_TIMEOUT';break;}
  await pause();
 }
 // finish() only awaits the already-started observers; it does not call response.body again.
 proof.observation=await finishObserver();proof.verdict=readVerdict(proof.observation);proof.health=getHealth();proof.pair=getPair();proof.settledMonotonicMs=now();
 assert(clean(proof.health),'REVIEW_PRE_AXE_HEALTH');
 assert(proof.waitOutcome==='PAIR_TERMINAL'&&bothActual(proof.pair)&&terminal(proof.pair.session)&&terminal(proof.pair.login)&&proof.pair.pendingReads===0,'REVIEW_PRE_AXE_PAIR');
 assert(proof.verdict==='PASS','REVIEW_PRE_AXE_OBSERVER');
 proof.axeStarted=true;const result=await axe();proof.axeCompleted=true;return result;
}
export function assertFinalOrdering(proof,health){
 assert(proof?.axeStarted===true&&proof.axeCompleted===true,'REVIEW_ORDERING_AXE');
 assert(clean(health),'REVIEW_ORDERING_FINAL_HEALTH');
}

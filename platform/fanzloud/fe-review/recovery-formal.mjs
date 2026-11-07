/** Formal recovery gate; original observers, strict bootstrap guard and timers unchanged. */
import assert from 'node:assert/strict';
import {selectPhase,assertStateCounts} from './remaining-support.mjs';
import {recoveryReadVerdict,recoveryDiagnosticComplete} from './recovery-bootstrap-observer.mjs';
export function selectRecoveryPhase(args){assert.deepEqual(args,['desktop-recovery'],'REVIEW_RECOVERY_SELECTION');const selected=selectPhase(args);assert.deepEqual(selected.states,['recovery-required'],'REVIEW_RECOVERY_SELECTION');return selected;}
const clean=health=>Array.isArray(health)&&health.length>0&&health.every(e=>e.expected===true);
export async function captureRecoveryProof({row,readObserver,timeline,getHealth,getFixture}){
 try{row.recoveryGetObservation=await readObserver.finish();row.recoveryGetObservation.verdict=recoveryReadVerdict(row.recoveryGetObservation);}
 catch{row.recoveryObserverFinishFailed=true;row.recoveryGetObservation??={verdict:'FAIL',rows:[]};}
 row.recoveryTimeline=timeline.snapshot();row.recoveryHealth=getHealth();row.recoveryFixture=getFixture();row.recoveryDiagnosticComplete=recoveryDiagnosticComplete(row.recoveryGetObservation,row.recoveryTimeline);
}
export function assertRecoveryProof(row){
 assert(row.recoveryObserverFinishFailed!==true,'REVIEW_RECOVERY_OBSERVER_DRAIN');
 assert.equal(recoveryReadVerdict(row.recoveryGetObservation),'PASS','REVIEW_RECOVERY_GET_OBSERVER');
 assert(row.recoveryDiagnosticComplete,'REVIEW_RECOVERY_DIAGNOSTIC_INCOMPLETE');
 assert(row.recoveryGetObservation.rows.every(r=>r.bodyReadOutcome==='FULFILLED'),'REVIEW_RECOVERY_BODY_OUTCOME');
 assert(clean(row.recoveryHealth),'REVIEW_RECOVERY_HEALTH');assertStateCounts('recovery-required',row.recoveryFixture);assert.deepEqual(row.manualActions,['authenticate'],'REVIEW_RECOVERY_ACTIONS');
 for(const category of ['session','login']){const ends=row.recoveryTimeline.events.filter(e=>e.event==='BODY_END'&&e.category===category);assert(ends.length===1&&ends[0].outcome==='FULFILLED','REVIEW_RECOVERY_BODY_TIMELINE');}
}
export async function runRecoveryBootstrap(options){
 const {row,readObserver,authenticate,observeBootstrap,guard,life,timeline}=options;row.recoveryGatePassed=false;let primaryFailure;
 try{readObserver.arm();await authenticate();row.bootstrapDiagnostic=await observeBootstrap();guard.bootstrap(row.bootstrapDiagnostic);life.check();}
 catch(error){primaryFailure=error;}
 // Body proof is captured before rethrowing the original strict bootstrap/health error.
 try{await captureRecoveryProof(options);}catch(error){if(!primaryFailure)primaryFailure=error;}
 if(primaryFailure)throw primaryFailure;
 assertRecoveryProof(row);life.check();row.recoveryGateCompletedTimelineMs=timeline.now();row.recoveryGatePassed=true;
}

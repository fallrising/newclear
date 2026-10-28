/** Passive safe-enum timeline; shares one monotonic clock with the unchanged body bound. */
import {bounded} from './lifecycle.mjs';
const events=new Set(['REQUEST','RESPONSE','BODY_START','BODY_END','REQUEST_FINISHED','REQUEST_FAILED','AXE_BEGIN','AXE_END']);
const outcomes=new Set(['FULFILLED','RESPONSE_REJECTED','OBSERVER_DEADLINE','OTHER_FAILURE']);
const errors=new Set(['ERROR','ABORT_ERROR','TIMEOUT_ERROR','TARGET_CLOSED_ERROR','OTHER']);
export function createTimeline({clock=()=>performance.now(),limit=64}={}){
 if(!Number.isInteger(limit)||limit<1||limit>128)throw Error('REVIEW_TIMELINE_LIMIT');
 const origin=clock(),rows=[];let overflow=false,invalid=false,last=0;
 const now=()=>clock()-origin;
 return Object.freeze({now,record(event,data={}){
  if(rows.length>=limit){overflow=true;return;}
  const timeMs=now();if(!events.has(event)||!Number.isFinite(timeMs)||timeMs<last){invalid=true;return;}
  const row={sequence:rows.length+1,timeMs,event};last=timeMs;
  if(data.category!==undefined){if(!['session','login'].includes(data.category)||!Number.isInteger(data.ordinal)||data.ordinal<1||data.ordinal>8){invalid=true;return;}row.category=data.category;row.ordinal=data.ordinal;}
  if(data.outcome!==undefined){if(!outcomes.has(data.outcome)){invalid=true;return;}row.outcome=data.outcome;}
  if(data.errorClass!==undefined){if(!errors.has(data.errorClass)){invalid=true;return;}row.errorClass=data.errorClass;}
  if(data.elapsedMs!==undefined){if(!Number.isFinite(data.elapsedMs)||data.elapsedMs<0){invalid=true;return;}row.elapsedMs=data.elapsedMs;}
  if(data.requestFailedSeen!==undefined)row.requestFailedSeen=data.requestFailedSeen===true;
  rows.push(row);
 },snapshot:()=>({clock:'performance.now',limit,overflow,invalid,events:rows.map(row=>({...row}))})});
}
const safeError=error=>{const known={Error:'ERROR',AbortError:'ABORT_ERROR',TimeoutError:'TIMEOUT_ERROR',TargetClosedError:'TARGET_CLOSED_ERROR'};return Object.hasOwn(known,error?.name)?known[error.name]:'OTHER';};
export async function observeBodyRead(read,{timeline,category,ordinal,requestFailed}){
 let rejected=false,start=null;
 try{
  const body=await bounded(()=>{start=timeline.now();timeline.record('BODY_START',{category,ordinal,requestFailedSeen:requestFailed()});try{return Promise.resolve(read()).catch(error=>{rejected=true;throw error;});}catch(error){rejected=true;throw error;}},2000,'get-body');
  timeline.record('BODY_END',{category,ordinal,outcome:'FULFILLED',elapsedMs:timeline.now()-start,requestFailedSeen:requestFailed()});return body;
 }catch(error){
  const outcome=rejected?'RESPONSE_REJECTED':error?.message==='REVIEW_TIMEOUT_get-body'?'OBSERVER_DEADLINE':'OTHER_FAILURE';
  timeline.record('BODY_END',{category,ordinal,outcome,errorClass:safeError(error),elapsedMs:start===null?0:timeline.now()-start,requestFailedSeen:requestFailed()});throw error;
 }
}

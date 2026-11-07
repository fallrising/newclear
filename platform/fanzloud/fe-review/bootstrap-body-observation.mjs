/** Safe single-read diagnostics; the original lifecycle bound remains authoritative. */
import {bounded} from './lifecycle.mjs';
export const BODY_NOT_ATTEMPTED=Object.freeze({outcome:'NOT_ATTEMPTED',elapsedMs:null,errorClass:null});
const safeError=error=>{try{const known={Error:'ERROR',AbortError:'ABORT_ERROR',TimeoutError:'TIMEOUT_ERROR',TargetClosedError:'TARGET_CLOSED_ERROR'},name=error?.name;return typeof name==='string'&&Object.hasOwn(known,name)?known[name]:'OTHER';}catch{return 'OTHER';}};
const isDeadline=error=>{try{return error instanceof Error&&error.message==='REVIEW_TIMEOUT_bootstrap-response-body';}catch{return false;}};
export function createBootstrapBodyObservation(){
 let snapshot=BODY_NOT_ATTEMPTED,operation;
 return Object.freeze({snapshot:()=>snapshot,read(read){
  if(operation)return operation;
  operation=(async()=>{
   const start=performance.now(),readRejected=Object.freeze({});let originalError;
   const finish=(outcome,error)=>{const elapsed=performance.now()-start;snapshot=Object.freeze({outcome,elapsedMs:Number.isFinite(elapsed)?Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,elapsed)):0,errorClass:outcome==='FULFILLED'?null:safeError(error)});};
   try{
    const body=await bounded(()=>{try{return Promise.resolve(read()).catch(error=>{originalError=error;throw readRejected;});}catch(error){originalError=error;throw readRejected;}},2000,'bootstrap-response-body');
    finish('FULFILLED');return body;
   }catch(error){
    if(error===readRejected){finish('RESPONSE_REJECTED',originalError);throw originalError;}
    finish(isDeadline(error)?'OBSERVER_DEADLINE':'OTHER_FAILURE',error);throw error;
   }
  })();return operation;
 }});
}

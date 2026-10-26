/** Observer only: no request/response mutation, raw identity stays in RAM. */
import assert from 'node:assert/strict';
import {bounded} from './lifecycle.mjs';
const turnPath='/api/p0/v1/session/turns';
const signature='export function createTransport({origin,fixture,key,cert,WebSocketServer,observeResponse})';
const hook='observeResponse?.({method:req.method,path:req.url,headers,output,res});';
export function originalTransportSource(source){
 assert.equal(source.split(signature).length,2,'REVIEW_OBSERVER_SOURCE');assert.equal(source.split(hook).length,2,'REVIEW_OBSERVER_SOURCE');
 return source.replace(signature,'export function createTransport({origin,fixture,key,cert,WebSocketServer})').replace(hook,'');
}
function validReceipt(bytes){try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return value&&Object.keys(value).sort().join(',')==='high_water_seq,turn_id'&&typeof value.turn_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.turn_id)&&value.turn_id!=='00000000-0000-0000-0000-000000000000'&&Number.isSafeInteger(value.high_water_seq)&&value.high_water_seq>=0;}catch{return false;}}
export function createTurnObserver(){
 const entries=new Map();let duplicate=false;
 return {
  server({method,path,headers,output,res}){if(method!=='POST'||path!==turnPath)return;const key=headers['idempotency-key'];if(typeof key!=='string'||!key||entries.has(key)){duplicate=true;return;}const body=Buffer.from(output.body);const entry={body,status:output.status,finished:false,closed:false,closeBeforeFinish:false,error:'NONE'};entries.set(key,entry);res.once('finish',()=>{entry.finished=true;});res.once('close',()=>{entry.closed=true;entry.closeBeforeFinish=!entry.finished;});res.once('error',error=>{entry.error=['ECONNRESET','EPIPE'].includes(error?.code)?error.code:'OTHER';});},
  summary(){return {requests:entries.size,duplicate};},
  async client(response){
   const result={sameRequest:false,bodyOutcome:'NOT_ATTEMPTED',headers:null,status:response.status(),server:null};let key;
   try{key=(await bounded(()=>response.request().allHeaders(),1000,'turn-request-headers'))['idempotency-key'];}catch{return result;}
   const entry=entries.get(key);if(!entry)return result;result.sameRequest=true;
   try{const h=await bounded(()=>response.allHeaders(),1000,'turn-response-headers');result.headers={json:h['content-type']==='application/json',noStore:h['cache-control']==='no-store',nosniff:h['x-content-type-options']==='nosniff',contentLengthPresent:Object.hasOwn(h,'content-length'),contentLengthMatchesExpected:Object.hasOwn(h,'content-length')?h['content-length']===String(entry.body.length):null,transferChunked:h['transfer-encoding']==='chunked',contentEncodingAbsent:!Object.hasOwn(h,'content-encoding')};}catch{}
   try{const body=await bounded(()=>response.body(),2000,'turn-response-body');result.bodyOutcome=body.length>4096?'BODY_TOO_LARGE':validReceipt(body)&&validReceipt(entry.body)&&body.equals(entry.body)?'EXACT_SCHEMA_AND_FIXTURE_MATCH':'BODY_MISMATCH';}catch{result.bodyOutcome='READ_FAILED';}
   result.server={status:entry.status,finished:entry.finished,closed:entry.closed,closeBeforeFinish:entry.closeBeforeFinish,error:entry.error,requests:entries.size,duplicate};return result;
  }
 };
}
export function diagnosticVerdict(d){
 const complete=d.sameRequest&&d.status===202&&d.server?.status===202&&d.server.finished&&!d.server.closeBeforeFinish&&d.server.error==='NONE'&&d.server.requests===1&&!d.server.duplicate&&d.bodyOutcome==='EXACT_SCHEMA_AND_FIXTURE_MATCH'&&d.headers?.json&&d.headers.noStore&&d.headers.nosniff&&d.headers.contentEncodingAbsent&&(!d.headers.contentLengthPresent||d.headers.contentLengthMatchesExpected)&&d.ui?.idle&&d.ui.errorCode==='EMPTY'&&d.ui.pendingSessionReads===0;
 if(!complete)return 'FAIL';if(d.requestFailed)return 'OBSERVER_DISCREPANCY';return d.requestFinished?'PASS':'FAIL';
}

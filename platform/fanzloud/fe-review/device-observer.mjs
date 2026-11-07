/** One device-login202 response observer; never changes request/response or records secrets. */
import {bounded} from './lifecycle.mjs';
const devicePath='/api/p0/v1/login/device';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
function validDevice(bytes){try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return v&&Object.keys(v).sort().join(',')==='expires_in_seconds,operation_id,verification_code,verification_url'&&v.expires_in_seconds===900&&uuid(v.operation_id)&&v.verification_url==='https://auth.openai.com/codex/device'&&typeof v.verification_code==='string'&&/^[A-Z0-9]{4}-[A-Z0-9]{5}$/.test(v.verification_code);}catch{return false;}}
export function createDeviceObserver(origin){
 const requests=[],responses=[];let browserMutations=0,serverMutations=0;
 return {
  request(request){const method=request.method();if(!['GET','HEAD'].includes(method))browserMutations++;if(method==='POST'&&request.url()===origin+devicePath)requests.push(request);},
  server({method,path,output,res}){if(!['GET','HEAD'].includes(method))serverMutations++;if(method!=='POST'||path!==devicePath)return;const entry={body:Buffer.from(output.body),status:output.status,finished:false,closed:false,closeBeforeFinish:false,error:'NONE'};responses.push(entry);res.once('finish',()=>{entry.finished=true;});res.once('close',()=>{entry.closed=true;entry.closeBeforeFinish=!entry.finished;});res.once('error',error=>{entry.error=['ECONNRESET','EPIPE'].includes(error?.code)?error.code:'OTHER';});},
  counts:()=>({browserRequests:requests.length,serverResponses:responses.length,browserMutations,serverMutations}),
  async client(response){
   const result={sameRequest:false,correlation:'UNPROVEN',browserRequests:requests.length,serverResponses:responses.length,browserMutations,serverMutations,status:response?.status()??null,bodyOutcome:'NOT_ATTEMPTED',headers:null,server:null};
   if(!response||requests.length!==1||responses.length!==1||response.request()!==requests[0])return result;
   const entry=responses[0];result.sameRequest=true;result.correlation='UNIQUE_METHOD_PATH_ORDINAL';
   try{const h=await bounded(()=>response.allHeaders(),1000,'device-response-headers');result.headers={json:h['content-type']==='application/json',noStore:h['cache-control']==='no-store',nosniff:h['x-content-type-options']==='nosniff',contentLengthPresent:Object.hasOwn(h,'content-length'),contentLengthMatchesExpected:Object.hasOwn(h,'content-length')?h['content-length']===String(entry.body.length):null,transferChunked:h['transfer-encoding']==='chunked',contentEncodingAbsent:!Object.hasOwn(h,'content-encoding')};}catch{}
   try{const body=await bounded(()=>response.body(),2000,'device-response-body');result.bodyOutcome=body.length>4096?'BODY_TOO_LARGE':validDevice(body)&&validDevice(entry.body)&&body.equals(entry.body)?'EXACT_SCHEMA_AND_FIXTURE_MATCH':'BODY_MISMATCH';}catch{result.bodyOutcome='READ_FAILED';}
   Object.assign(result,{browserRequests:requests.length,serverResponses:responses.length,browserMutations,serverMutations});result.sameRequest=requests.length===1&&responses.length===1&&response.request()===requests[0];result.correlation=result.sameRequest?'UNIQUE_METHOD_PATH_ORDINAL':'UNPROVEN';result.server={status:entry.status,finished:entry.finished,closed:entry.closed,closeBeforeFinish:entry.closeBeforeFinish,error:entry.error,requests:responses.length,duplicate:responses.length!==1||requests.length!==1};return result;
  }
 };
}

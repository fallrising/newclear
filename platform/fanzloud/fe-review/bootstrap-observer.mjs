/** One bootstrap response observer; never changes request/response or records secrets. */
import {bounded} from './lifecycle.mjs';
const bootstrap='/api/p0/v1/operator/session';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
function validBootstrap(bytes){try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return v&&Object.keys(v).sort().join(',')==='actor,expires_in_seconds,instance_id,p0_session_id'&&v.actor==='operator'&&Number.isInteger(v.expires_in_seconds)&&v.expires_in_seconds>=300&&v.expires_in_seconds<=43200&&uuid(v.instance_id)&&uuid(v.p0_session_id);}catch{return false;}}
export function createBootstrapObserver(origin){
 const requests=[],responses=[];let browserMutations=0,serverMutations=0;
 return {
  request(request){const method=request.method();if(!['GET','HEAD'].includes(method))browserMutations++;if(method==='POST'&&request.url()===origin+bootstrap)requests.push(request);},
  server({method,path,output,res}){if(!['GET','HEAD'].includes(method))serverMutations++;if(method!=='POST'||path!==bootstrap)return;const entry={body:Buffer.from(output.body),status:output.status,finished:false,closed:false,closeBeforeFinish:false,error:'NONE'};responses.push(entry);res.once('finish',()=>{entry.finished=true;});res.once('close',()=>{entry.closed=true;entry.closeBeforeFinish=!entry.finished;});res.once('error',error=>{entry.error=['ECONNRESET','EPIPE'].includes(error?.code)?error.code:'OTHER';});},
  counts:()=>({browserRequests:requests.length,serverResponses:responses.length,browserMutations,serverMutations}),
  async client(response){
   const result={sameRequest:false,correlation:'UNPROVEN',browserRequests:requests.length,serverResponses:responses.length,browserMutations,serverMutations,status:response?.status()??null,bodyOutcome:'NOT_ATTEMPTED',headers:null,server:null};
   if(!response||requests.length!==1||responses.length!==1||response.request()!==requests[0])return result;
   const entry=responses[0];result.sameRequest=true;result.correlation='UNIQUE_METHOD_PATH_ORDINAL';
   try{const h=await bounded(()=>response.allHeaders(),1000,'bootstrap-response-headers');result.headers={json:h['content-type']==='application/json',noStore:h['cache-control']==='no-store',nosniff:h['x-content-type-options']==='nosniff',contentLengthPresent:Object.hasOwn(h,'content-length'),contentLengthMatchesExpected:Object.hasOwn(h,'content-length')?h['content-length']===String(entry.body.length):null,transferChunked:h['transfer-encoding']==='chunked',contentEncodingAbsent:!Object.hasOwn(h,'content-encoding')};}catch{}
   try{const body=await bounded(()=>response.body(),2000,'bootstrap-response-body');result.bodyOutcome=body.length>4096?'BODY_TOO_LARGE':validBootstrap(body)&&validBootstrap(entry.body)&&body.equals(entry.body)?'EXACT_SCHEMA_AND_FIXTURE_MATCH':'BODY_MISMATCH';}catch{result.bodyOutcome='READ_FAILED';}
   Object.assign(result,{browserRequests:requests.length,serverResponses:responses.length,browserMutations,serverMutations});result.sameRequest=requests.length===1&&responses.length===1&&response.request()===requests[0];result.correlation=result.sameRequest?'UNIQUE_METHOD_PATH_ORDINAL':'UNPROVEN';result.server={status:entry.status,finished:entry.finished,closed:entry.closed,closeBeforeFinish:entry.closeBeforeFinish,error:entry.error};return result;
  }
 };
}
export function onlyAuthenticationMutation(fixture,observation){return fixture?.effects===1&&fixture.turnStarts===0&&fixture.counts?.['POST '+bootstrap]===1&&Object.entries(fixture.counts).every(([key,count])=>key==='POST '+bootstrap||key.startsWith('GET ')||key.startsWith('HEAD ')||count===0)&&observation.browserMutations===1&&observation.serverMutations===1;}
export function bootstrapVerdict(d){
 const complete=d.sameRequest&&d.correlation==='UNIQUE_METHOD_PATH_ORDINAL'&&d.browserRequests===1&&d.serverResponses===1&&d.status===201&&d.server?.status===201&&d.server.finished&&!d.server.closeBeforeFinish&&d.server.error==='NONE'&&d.bodyOutcome==='EXACT_SCHEMA_AND_FIXTURE_MATCH'&&d.headers?.json&&d.headers.noStore&&d.headers.nosniff&&d.headers.contentEncodingAbsent&&(!d.headers.contentLengthPresent||d.headers.contentLengthMatchesExpected)&&d.ui?.idle&&d.ui.authenticated&&d.ui.connected&&d.ui.bearerEmpty&&d.ui.promptEmpty&&d.ui.errorCode==='EMPTY'&&d.ui.pendingReads===0&&onlyAuthenticationMutation(d.fixture,d);
 if(!complete)return 'FAIL';if(d.requestFailed)return 'OBSERVER_DISCREPANCY';return d.requestFinished?'PASS':'FAIL';
}

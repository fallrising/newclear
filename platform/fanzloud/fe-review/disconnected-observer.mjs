/** Read-only bounded automatic GET observer; raw identity/body remain only in RAM. */
import {bounded} from './lifecycle.mjs';
const paths={session:'/api/p0/v1/session',login:'/api/p0/v1/login'};
const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
export function validReadBody(category,body){
 if(!Buffer.isBuffer(body)||body.length>65536)return false;
 try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));if(!v||Array.isArray(v))return false;
 if(category==='login')return Object.keys(v).join(',')==='state'&&v.state==='logged_in';
 return category==='session'&&Object.keys(v).sort().join(',')==='current_turn,high_water_seq,identity,state'&&v.state==='ready'&&v.current_turn===null&&v.high_water_seq===0&&v.identity&&Object.keys(v.identity).sort().join(',')==='instance_id,session_id'&&id(v.identity.session_id)&&id(v.identity.instance_id);
 }catch{return false;}
}
export function readVerdict(d){
 if(!d||d.armed!==true||d.observerSettled!==true||d.overflow||d.unmatched||d.extraMutations!==0||!Array.isArray(d.rows)||d.rows.length!==2||!['session','login'].every(c=>d.rows.filter(r=>r.category===c).length===1))return 'FAIL';
 let discrepancy=false;
 for(const r of d.rows){if(!r.sameRequest||r.correlation!=='UNIQUE_METHOD_PATH_ORDINAL'||r.browserCount!==1||r.serverCount!==1||r.status!==200||r.server?.status!==200||!r.server.finished||!r.server.closed||r.server.closeBeforeFinish||r.server.error!=='NONE'||r.bodyOutcome!=='EXACT_SCHEMA_AND_FIXTURE_MATCH'||!r.headers?.json||!r.headers.noStore||!r.headers.nosniff||!r.headers.contentEncodingAbsent||(r.headers.contentLengthPresent&&!r.headers.contentLengthMatchesExpected)||r.terminalCount!==1)return 'FAIL';if(r.requestFailed)discrepancy=true;else if(!r.requestFinished)return 'FAIL';}
 return discrepancy?'OBSERVER_DISCREPANCY':'PASS';
}
export function createReadObserver(origin){
 let armed=false,overflow=false,unmatched=false,extraMutations=0;const requests={session:[],login:[]},servers={session:[],login:[]},pending=[],rows=[];const category=url=>Object.keys(paths).find(k=>url===origin+paths[k]);
 return {
  arm(){if(armed)throw Error('REVIEW_OBSERVER_ALREADY_ARMED');armed=true;},
  request(req){if(!armed)return;if(!['GET','HEAD'].includes(req.method()))extraMutations++;const c=category(req.url());if(req.method()!=='GET'||!c)return;if(rows.length>=8){overflow=true;return;}const row={request:req,category:c,ordinal:requests[c].length+1,response:null,terminalCount:0,requestFinished:false,requestFailed:false,failureCode:null,bodyOutcome:'NOT_ATTEMPTED',headers:null};requests[c].push(row);rows.push(row);},
  server({method,path,output,res}){if(!armed||method!=='GET')return;const c=Object.keys(paths).find(k=>path===paths[k]);if(!c)return;if(servers.session.length+servers.login.length>=8){overflow=true;return;}const entry={body:Buffer.from(output.body),status:output.status,finished:false,closed:false,closeBeforeFinish:false,error:'NONE'};servers[c].push(entry);res.once('finish',()=>{entry.finished=true;});res.once('close',()=>{entry.closed=true;entry.closeBeforeFinish=!entry.finished;});res.once('error',e=>{entry.error=['EPIPE','ECONNRESET'].includes(e?.code)?e.code:'OTHER';});},
  response(response){if(!armed)return;const request=response.request(),c=category(request.url());if(request.method()!=='GET'||!c)return;const row=rows.find(r=>r.request===request);if(!row||row.response){unmatched=true;return;}row.response=response;row.status=response.status();const entry=servers[c][row.ordinal-1];if(!entry){unmatched=true;return;}
   pending.push((async()=>{try{const h=await bounded(()=>response.allHeaders(),1000,'get-headers');row.headers={json:h['content-type']==='application/json',noStore:h['cache-control']==='no-store',nosniff:h['x-content-type-options']==='nosniff',contentEncodingAbsent:!Object.hasOwn(h,'content-encoding'),contentLengthPresent:Object.hasOwn(h,'content-length'),contentLengthMatchesExpected:Object.hasOwn(h,'content-length')?h['content-length']===String(entry.body.length):null,transferChunked:h['transfer-encoding']==='chunked'};}catch{}try{const body=await bounded(()=>response.body(),2000,'get-body');row.bodyOutcome=body.length>65536?'BODY_TOO_LARGE':validReadBody(c,body)&&validReadBody(c,entry.body)&&body.equals(entry.body)?'EXACT_SCHEMA_AND_FIXTURE_MATCH':'BODY_MISMATCH';}catch{row.bodyOutcome='READ_FAILED';}})());
  },
  terminal(request,error){if(!armed)return;const row=rows.find(r=>r.request===request);if(!row)return;row.terminalCount++;if(error){row.requestFailed=true;row.failureCode=['ERR_ABORTED','ERR_FAILED','ERR_CONNECTION_CLOSED'].includes(error)?error:'UNKNOWN';}else row.requestFinished=true;},
  async finish(){let observerSettled=true;try{await bounded(()=>Promise.all(pending),3500,'get-observer-drain');}catch{observerSettled=false;}return {armed,overflow,unmatched,extraMutations,observerSettled,rows:rows.map(row=>{const e=servers[row.category][row.ordinal-1];return {category:row.category,ordinal:row.ordinal,browserCount:requests[row.category].length,serverCount:servers[row.category].length,sameRequest:!!row.response&&row.response.request()===row.request,correlation:e&&row.response?'UNIQUE_METHOD_PATH_ORDINAL':'UNPROVEN',status:row.status??null,bodyOutcome:row.bodyOutcome,headers:row.headers,requestFinished:row.requestFinished,requestFailed:row.requestFailed,terminalCount:row.terminalCount,failureCode:row.failureCode,server:e?{status:e.status,finished:e.finished,closed:e.closed,closeBeforeFinish:e.closeBeforeFinish,error:e.error}:null};})};}
 };
}

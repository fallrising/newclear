/** Source-only v3 diagnostics. Successful CDP finish retains a validated request bound. */
export const EVENTS=Object.freeze(['ROUTE_CONTINUE','ROUTE_ABORT','REQUEST','RESPONSE','REQUEST_FINISHED','REQUEST_FAILED','BODY_EXACT','BODY_MISMATCH','BODY_REJECTED','SERVER_REQUEST','SERVER_END_CALLED','SERVER_FINISH','SERVER_CLOSE','SERVER_REQUEST_ABORTED','SERVER_REQUEST_ERROR','SERVER_RESPONSE_ERROR','CDP_REQUEST','CDP_RESPONSE','CDP_FINISHED','CDP_FAILED','FETCH_BEGIN','FETCH_FULFILLED','FETCH_REJECTED','SIGNAL_ABORT','PAGEHIDE']);
export const REASONS=Object.freeze(['UNKNOWN_REASON','INVALID_CONTEXT','CLOCK_MISSING','CLOCK_TYPE','CLOCK_NONFINITE','CLOCK_NEGATIVE','CLOCK_REGRESSION','CLOCK_SCALE_NONFINITE','CLOCK_READ_THROW','DUPLICATE_TARGET','CORRELATION','EVENT_INVALID','FIELD_INVALID','INPUT_MISSING','INPUT_TYPE','PAGE_DOMAIN','PAGE_INVALID','PAGE_OVERFLOW','PAGE_SEQUENCE','OBSERVATION_EXCEPTION','LISTENER_CLEANUP','DRIVER_SETUP','DRIVER_ACQUIRE','DRIVER_LISTEN','DRIVER_ENABLE','DRIVER_SNAPSHOT','DRIVER_DETACH','DRIVER_CLEANUP','MISSING_PHASE','DUPLICATE_PHASE','OVERFLOW']);
export const STAGES=Object.freeze(['UNKNOWN','ROUTE','REQUEST','RESPONSE','TERMINAL','BODY','SERVER','SERVER_END','CDP','PAGE','RECORD','SNAPSHOT','CLOSE','INIT_SCRIPT','CDP_ACQUIRE','CDP_LISTEN','CDP_ENABLE','PAGE_SNAPSHOT','CDP_DETACH','CDP_CLEANUP','PAGE_INSTALL','PAGE_FETCH','PAGE_STATUS','PAGE_SIGNAL','PAGE_FINISH']);
export const DRIVER_REASONS=Object.freeze({INIT_SCRIPT:'DRIVER_SETUP',CDP_ACQUIRE:'DRIVER_ACQUIRE',CDP_LISTEN:'DRIVER_LISTEN',CDP_ENABLE:'DRIVER_ENABLE',PAGE_SNAPSHOT:'DRIVER_SNAPSHOT',CDP_DETACH:'DRIVER_DETACH',CDP_CLEANUP:'DRIVER_CLEANUP'});
const DOMAINS=['host','page','cdp','unknown'],PATHS=['LOCAL_TIME','HOST_ARRIVAL','CDP_TIMESTAMP','PAGE_TIME','UNKNOWN'];
const safeFailure=value=>['net::ERR_ABORTED','net::ERR_FAILED','net::ERR_CONNECTION_CLOSED'].includes(value)?value.slice(5):'UNKNOWN';
const classify=value=>value===undefined?'MISSING':typeof value!=='number'?'TYPE':!Number.isFinite(value)?'NONFINITE':value<0?'NEGATIVE':null;
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
/** Whitelist-only copying; even a throwing/revoked Proxy is contained. */
function safeIssue(reason,context){
 const row={reason:REASONS.includes(reason)?reason:'UNKNOWN_REASON',origin:'observer',stage:'UNKNOWN',event:'UNKNOWN',domain:'unknown',category:'initial-session',ordinal:1};
 try{if(context!==undefined){if(context===null||typeof context!=='object')throw 0;
  const origin=context.origin,stage=context.stage,event=context.event,domain=context.domain,path=context.clockPath;
  if(['observer','page','driver'].includes(origin))row.origin=origin;
  if(STAGES.includes(stage))row.stage=stage;
  if(EVENTS.includes(event))row.event=event;
  if(DOMAINS.includes(domain))row.domain=domain;
  if(PATHS.includes(path))row.clockPath=path;
  if(row.reason.startsWith('CLOCK_'))for(const key of ['localValue','previousValue']){const value=context[key];if(finite(value))row[key]=value;}
 }}catch{row.reason='INVALID_CONTEXT';}
 return Object.freeze(row);
}
export function createInitialLifecycleObserver(origin,{isPreauth=()=>true,clock=()=>performance.now()}={}){
 const target=origin+'/api/p0/v1/session',rows=[],failures=[],sequence={host:0,page:0,cdp:0},last={host:-1,page:-1,cdp:-1},counts={route:0,request:0,server:0,cdp:0},removers=[];
 let active=true,invalid=false,overflow=false,request=null,serverRequest=null,cdpId=null,pageSeen=false,cdpRequestTime=null;
 const fail=(reason,context)=>{invalid=true;if(failures.length>=32){overflow=true;return;}failures.push(safeIssue(reason,context));if(rows.length+failures.length>128)overflow=true;};
 const context=(stage,event,domain,clockPath)=>({stage,event,domain,clockPath});
 const validTime=(value,previous,meta)=>{const type=classify(value);if(type){fail('CLOCK_'+type,meta);return false;}if(value<previous){fail('CLOCK_REGRESSION',{...meta,localValue:value,previousValue:previous});return false;}return true;};
 const record=(domain,event,data={},localTime)=>{try{
  if(!active)return;if(rows.length>=128){overflow=true;fail('OVERFLOW',context('RECORD',event,domain));return;}
  if(!EVENTS.includes(event)){fail('EVENT_INVALID',context('RECORD',event,domain));return;}
  if(!Object.hasOwn(sequence,domain)){fail('FIELD_INVALID',context('RECORD',event));return;}
  let arrival;try{arrival=clock();}catch{fail('CLOCK_READ_THROW',context('RECORD',event,domain,'HOST_ARRIVAL'));return;}
  if(!validTime(arrival,-1,context('RECORD',event,domain,'HOST_ARRIVAL')))return;
  const timeMs=domain==='host'?arrival:localTime;
  const previous=domain==='cdp'&&event==='CDP_FINISHED'?cdpRequestTime:last[domain];
  if(!validTime(timeMs,previous,context('RECORD',event,domain,domain==='page'?'PAGE_TIME':domain==='cdp'?'CDP_TIMESTAMP':'LOCAL_TIME')))return;
  last[domain]=timeMs;
  const row={domain,sequence:++sequence[domain],timeMs,hostArrivalSequence:rows.length+1,hostArrivalMs:arrival,event,category:'initial-session',ordinal:1};
  for(const [k,v]of Object.entries(data)){
   if(['aborted','signalPresent','closeBeforeFinish'].includes(k)&&typeof v==='boolean')row[k]=v;
   else if(k==='status'&&['200','401','OTHER'].includes(v))row[k]=v;
   else if(k==='failureCode'&&['ERR_ABORTED','ERR_FAILED','ERR_CONNECTION_CLOSED','UNKNOWN'].includes(v))row[k]=v;
   else if(k==='errorClass'&&['Error','AbortError','TimeoutError','TypeError','OTHER'].includes(v))row[k]=v;
   else{fail('FIELD_INVALID',context('RECORD',event,domain));return;}
  }
  rows.push(Object.freeze(row));if(domain==='cdp'&&event==='CDP_REQUEST')cdpRequestTime=timeMs;if(rows.length+failures.length>128)overflow=true;
 }catch{fail('OBSERVATION_EXCEPTION',context('RECORD',event,domain));}};
 const cdpTime=(value,event)=>{const meta=context('CDP',event,'cdp','CDP_TIMESTAMP');if(!validTime(value,-1,meta))return null;const time=value*1000;if(!Number.isFinite(time)){fail('CLOCK_SCALE_NONFINITE',meta);return null;}return time;};
 const cdpRecord=(event,data,value)=>{const time=cdpTime(value,event);if(event==='CDP_FINISHED'&&cdpRequestTime===null){fail('MISSING_PHASE',context('CDP','CDP_REQUEST','cdp','CDP_TIMESTAMP'));return;}if(time!==null)record('cdp',event,data,time);};
 const protect=(stage,event,domain,fn)=>(...args)=>{let name='UNKNOWN';try{if(active){name=typeof event==='function'?event(args[0]):event;fn(...args);}}catch{fail('OBSERVATION_EXCEPTION',context(stage,name,domain));}};
 const matches=r=>r.method()==='GET'&&r.url()===target;
 const listen=(emitter,event,handler)=>{emitter.on(event,handler);removers.push(()=>emitter.off(event,handler));};
 const api={invalidate:fail,
  driverFailure(stage){const known=typeof stage==='string'&&Object.hasOwn(DRIVER_REASONS,stage);fail(known?DRIVER_REASONS[stage]:'UNKNOWN_REASON',{origin:'driver',stage:known?stage:'UNKNOWN',domain:['INIT_SCRIPT','PAGE_SNAPSHOT'].includes(stage)?'page':'cdp'});},
  route:protect('ROUTE','ROUTE_CONTINUE','host',(r,allowed)=>{if(!isPreauth()||!matches(r))return;counts.route++;if(counts.route!==1)fail('DUPLICATE_TARGET',context('ROUTE',allowed?'ROUTE_CONTINUE':'ROUTE_ABORT','host'));record('host',allowed?'ROUTE_CONTINUE':'ROUTE_ABORT');}),
  request:protect('REQUEST','REQUEST','host',r=>{if(!isPreauth()||!matches(r))return;counts.request++;if(counts.request!==1){fail('DUPLICATE_TARGET',context('REQUEST','REQUEST','host'));return;}request=r;record('host','REQUEST');}),
  response:protect('RESPONSE','RESPONSE','host',r=>{if(r.request()!==request)return;if(r.url()!==target){fail('CORRELATION',context('RESPONSE','RESPONSE','host'));return;}const status=r.status();record('host','RESPONSE',{status:[200,401].includes(status)?String(status):'OTHER'});}),
  terminal:protect('TERMINAL','REQUEST_FAILED','host',(r,error)=>{if(r!==request)return;record('host',error===null?'REQUEST_FINISHED':'REQUEST_FAILED',error===null?{}:{failureCode:safeFailure(error)});}),
  body:protect('BODY','UNKNOWN','host',(r,outcome)=>{if(r!==request)return;record('host',({EXACT:'BODY_EXACT',MISMATCH:'BODY_MISMATCH',REJECTED:'BODY_REJECTED'})[outcome]??'INVALID');}),
  server:protect('SERVER','SERVER_REQUEST','host',(req,res)=>{if(!isPreauth()||req.method!=='GET'||req.url!=='/api/p0/v1/session')return;counts.server++;if(counts.server!==1){fail('DUPLICATE_TARGET',context('SERVER','SERVER_REQUEST','host'));return;}serverRequest=req;let finished=false;record('host','SERVER_REQUEST');listen(res,'finish',()=>{finished=true;record('host','SERVER_FINISH');});listen(res,'close',()=>record('host','SERVER_CLOSE',{closeBeforeFinish:!finished}));listen(res,'error',()=>record('host','SERVER_RESPONSE_ERROR'));listen(req,'aborted',()=>record('host','SERVER_REQUEST_ABORTED'));listen(req,'error',()=>record('host','SERVER_REQUEST_ERROR'));}),
  serverEnd:protect('SERVER_END','SERVER_END_CALLED','host',req=>{if(req===serverRequest)record('host','SERVER_END_CALLED');}),
  cdp:protect('CDP',event=>({requestWillBeSent:'CDP_REQUEST',responseReceived:'CDP_RESPONSE',loadingFinished:'CDP_FINISHED',loadingFailed:'CDP_FAILED'})[event],'cdp',(event,data)=>{
   const name=({requestWillBeSent:'CDP_REQUEST',responseReceived:'CDP_RESPONSE',loadingFinished:'CDP_FINISHED',loadingFailed:'CDP_FAILED'})[event];
   if(data===undefined||data===null){fail('INPUT_MISSING',context('CDP',name,'cdp'));return;}if(typeof data!=='object'){fail('INPUT_TYPE',context('CDP',name,'cdp'));return;}
   if(event==='requestWillBeSent'){if(!isPreauth()||data.request?.method!=='GET'||data.request?.url!==target)return;counts.cdp++;if(counts.cdp!==1){fail('DUPLICATE_TARGET',context('CDP','CDP_REQUEST','cdp'));return;}if(typeof data.requestId!=='string'||data.requestId.length===0){fail('CORRELATION',context('CDP','CDP_REQUEST','cdp'));return;}cdpId=data.requestId;cdpRecord('CDP_REQUEST',{},data.timestamp);}
   else if(data.requestId===cdpId&&cdpId!==null){if(event==='responseReceived'){if(data.response?.url!==target){fail('CORRELATION',context('CDP','CDP_RESPONSE','cdp'));return;}const status=data.response.status;cdpRecord('CDP_RESPONSE',{status:[200,401].includes(status)?String(status):'OTHER'},data.timestamp);}else if(event==='loadingFinished')cdpRecord('CDP_FINISHED',{},data.timestamp);else if(event==='loadingFailed')cdpRecord('CDP_FAILED',{failureCode:safeFailure(data.errorText)},data.timestamp);else fail('EVENT_INVALID',context('CDP',name,'cdp'));}
  }),
  page:protect('PAGE','UNKNOWN','page',snapshot=>{
   const meta=context('PAGE','UNKNOWN','page');if(pageSeen){fail('DUPLICATE_TARGET',meta);return;}pageSeen=true;
   if(snapshot===undefined||snapshot===null){fail('INPUT_MISSING',meta);return;}if(typeof snapshot!=='object'){fail('INPUT_TYPE',meta);return;}
   if(snapshot.clockDomain!=='page'){fail('PAGE_DOMAIN',meta);return;}
   if(snapshot.targets!==1){fail('CORRELATION',meta);return;}
   if(snapshot.invalid||snapshot.overflow){if(Array.isArray(snapshot.failures))for(const issue of snapshot.failures.slice(0,32))fail(issue?.reason,{...safeIssue(issue?.reason,issue),origin:'page'});fail(snapshot.overflow?'PAGE_OVERFLOW':'PAGE_INVALID',meta);return;}
   if(!Array.isArray(snapshot.events)||snapshot.events.length>128){fail('FIELD_INVALID',meta);return;}
   let n=0;for(const row of snapshot.events){if(row.sequence!==++n){fail('PAGE_SEQUENCE',meta);return;}if(!['FETCH_BEGIN','FETCH_FULFILLED','FETCH_REJECTED','SIGNAL_ABORT','PAGEHIDE'].includes(row.event)){fail('EVENT_INVALID',meta);return;}const {sequence:ignored,timeMs,event,...data}=row;record('page',event,data,timeMs);}
  }),
  close(){active=false;for(const remove of removers.splice(0)){try{remove();}catch{fail('LISTENER_CLEANUP',context('CLOSE','UNKNOWN','host'));}}},
  snapshot(){
   const count=(...events)=>rows.filter(row=>events.includes(row.event)).length;
   const complete=!invalid&&!overflow&&pageSeen&&Object.values(counts).every(n=>n===1)&&count('RESPONSE')===1&&count('REQUEST_FINISHED','REQUEST_FAILED')===1&&count('BODY_EXACT','BODY_MISMATCH','BODY_REJECTED')===1&&count('SERVER_END_CALLED')===1&&count('SERVER_CLOSE')===1&&count('SERVER_FINISH')<=1&&count('CDP_RESPONSE')===1&&count('CDP_FINISHED','CDP_FAILED')===1&&count('FETCH_BEGIN')===1&&count('FETCH_FULFILLED','FETCH_REJECTED')===1;
   const issues=[...failures];const phase=(n,event,domain)=>{if(n!==1)issues.push(safeIssue(n===0?'MISSING_PHASE':'DUPLICATE_PHASE',context('SNAPSHOT',event,domain)));};
   for(const[key,event,domain]of [['route','ROUTE_CONTINUE','host'],['request','REQUEST','host'],['server','SERVER_REQUEST','host'],['cdp','CDP_REQUEST','cdp']])phase(counts[key],event,domain);
   if(!pageSeen)phase(0,'FETCH_BEGIN','page');
   for(const[domain,events]of [['host',['RESPONSE']],['host',['REQUEST_FINISHED','REQUEST_FAILED']],['host',['BODY_EXACT','BODY_MISMATCH','BODY_REJECTED']],['host',['SERVER_END_CALLED']],['host',['SERVER_CLOSE']],['cdp',['CDP_RESPONSE']],['cdp',['CDP_FINISHED','CDP_FAILED']],['page',['FETCH_BEGIN']],['page',['FETCH_FULFILLED','FETCH_REJECTED']]])phase(count(...events),events[0],domain);
   if(count('SERVER_FINISH')>1)phase(count('SERVER_FINISH'),'SERVER_FINISH','host');
   const capped=overflow||issues.length>32||rows.length+issues.length>128;
   const saved=issues.slice(0,capped?31:32);if(capped)saved.push(safeIssue('OVERFLOW',context('SNAPSHOT','UNKNOWN','unknown')));
   return Object.freeze({clockDomains:Object.freeze(['host','page','cdp']),ordering:'host/page domain-local; CDP callback arrival order, sampled times need not be nondecreasing; CDP_FINISHED >= validated CDP_REQUEST; other CDP samples >= last accepted CDP sample; hostArrival is observation arrival, not cross-clock causality',correlation:'UNIQUE_TARGET_METHOD_ORDINAL_NOT_CDP_IDENTITY_WITH_PLAYWRIGHT',counts:Object.freeze({...counts}),invalid,overflow:capped,complete:complete&&!capped,events:Object.freeze(rows.slice(0,128-saved.length)),failures:Object.freeze(saved)});
  }
 };return Object.freeze(api);
}

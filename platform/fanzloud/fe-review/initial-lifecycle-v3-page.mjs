/** Self-contained v2 context init script: no imports or response-body interception. */
export function installInitialLifecyclePage({origin,key='__reviewInitialLifecycle'}){
 const g=globalThis,target=origin+'/api/p0/v1/session',rows=[],failures=[],removers=[];let original;let active=true,invalid=false,overflow=false,targets=0,last=-1;
 const reasons=['UNKNOWN_REASON','CLOCK_MISSING','CLOCK_TYPE','CLOCK_NONFINITE','CLOCK_NEGATIVE','CLOCK_REGRESSION','CLOCK_READ_THROW','DUPLICATE_TARGET','OBSERVATION_EXCEPTION','FIELD_INVALID','EVENT_INVALID','DRIVER_SETUP','LISTENER_CLEANUP','OVERFLOW'];
 const stages=['PAGE_INSTALL','PAGE_FETCH','PAGE_STATUS','PAGE_SIGNAL','PAGE_FINISH','RECORD'];
 const events=['FETCH_BEGIN','FETCH_FULFILLED','FETCH_REJECTED','SIGNAL_ABORT','PAGEHIDE'];
 const fail=(reason,stage='RECORD',event='UNKNOWN',value,previous)=>{
  invalid=true;if(failures.length>=32){overflow=true;return;}
  const row={reason:reasons.includes(reason)?reason:'UNKNOWN_REASON',origin:'page',stage:stages.includes(stage)?stage:'RECORD',event:events.includes(event)?event:'UNKNOWN',domain:'page',category:'initial-session',ordinal:1};
  if(reason.startsWith('CLOCK_'))row.clockPath='PAGE_TIME';
  if(typeof value==='number'&&Number.isFinite(value)&&value>=0)row.localValue=value;
  if(typeof previous==='number'&&Number.isFinite(previous)&&previous>=0)row.previousValue=previous;
  failures.push(Object.freeze(row));if(rows.length+failures.length>128)overflow=true;
 };
 const record=(event,data={})=>{try{
  if(!active)return;if(rows.length>=128){overflow=true;fail('OVERFLOW','RECORD',event);return;}
  let timeMs;try{timeMs=g.performance.now();}catch{fail('CLOCK_READ_THROW','RECORD',event);return;}
  const bad=timeMs===undefined?'MISSING':typeof timeMs!=='number'?'TYPE':!Number.isFinite(timeMs)?'NONFINITE':timeMs<0?'NEGATIVE':timeMs<last?'REGRESSION':null;
  if(bad){fail('CLOCK_'+bad,'RECORD',event,timeMs,last);return;}last=timeMs;
  if(!events.includes(event)){fail('EVENT_INVALID');return;}
  const row={sequence:rows.length+1,timeMs,event};
  for(const[k,v]of Object.entries(data)){
   if(['signalPresent','aborted'].includes(k)&&typeof v==='boolean')row[k]=v;
   else if(k==='status'&&['200','401','OTHER'].includes(v))row[k]=v;
   else if(k==='errorClass'&&['Error','AbortError','TimeoutError','TypeError','OTHER'].includes(v))row[k]=v;
   else{fail('FIELD_INVALID','RECORD',event);return;}
  }
  rows.push(Object.freeze(row));if(rows.length+failures.length>128)overflow=true;
 }catch{fail('OBSERVATION_EXCEPTION','RECORD',event);}};
 const safeClass=e=>{try{const name=e?.name;return typeof name==='string'&&['Error','AbortError','TimeoutError','TypeError'].includes(name)?name:'OTHER';}catch{return 'OTHER';}};
 const status=r=>{try{const value=r?.status;return [200,401].includes(value)?String(value):'OTHER';}catch{fail('OBSERVATION_EXCEPTION','PAGE_STATUS','FETCH_FULFILLED');return 'OTHER';}};
 const finish=()=>{active=false;for(const remove of removers.splice(0)){try{remove();}catch{fail('LISTENER_CLEANUP','PAGE_FINISH');}}const saved=failures.slice(0,overflow?31:32);if(overflow)saved.push(Object.freeze({reason:'OVERFLOW',origin:'page',stage:'PAGE_FINISH',event:'UNKNOWN',domain:'page',category:'initial-session',ordinal:1}));return Object.freeze({clockDomain:'page',targets,invalid,overflow,events:Object.freeze(rows.slice(0,128-saved.length)),failures:Object.freeze(saved)});};
 try{Object.defineProperty(g,key,{value:Object.freeze({finish}),configurable:true});}catch{fail('DRIVER_SETUP','PAGE_INSTALL');return;}
 try{original=g.fetch;if(typeof original!=='function'){fail('DRIVER_SETUP','PAGE_INSTALL');return;}}catch{fail('DRIVER_SETUP','PAGE_INSTALL');return;}
 const observedFetch=function(...args){
  let selected=false;
  try{if(active){const input=args[0],init=args[1],url=typeof input==='string'?input:input?.url,method=init?.method??input?.method??'GET';if(new URL(url,g.location.href).href===target&&method==='GET'){targets++;if(targets!==1)fail('DUPLICATE_TARGET','PAGE_FETCH','FETCH_BEGIN');else{selected=true;const signal=init?.signal??input?.signal;record('FETCH_BEGIN',{signalPresent:!!signal,aborted:signal?.aborted===true});if(signal){const abort=()=>record('SIGNAL_ABORT');signal.addEventListener('abort',abort,{once:true});removers.push(()=>signal.removeEventListener('abort',abort));}}}}}catch{fail('OBSERVATION_EXCEPTION','PAGE_FETCH','FETCH_BEGIN');}
  let promise;try{promise=Reflect.apply(original,this,args);}catch(error){if(selected)record('FETCH_REJECTED',{errorClass:safeClass(error)});throw error;}
  if(selected){try{promise.then(response=>{record('FETCH_FULFILLED',{status:status(response)});},error=>{record('FETCH_REJECTED',{errorClass:safeClass(error)});});}catch{fail('OBSERVATION_EXCEPTION','PAGE_FETCH');}}
  return promise;
 };
 try{g.fetch=observedFetch;if(g.fetch!==observedFetch)fail('DRIVER_SETUP','PAGE_INSTALL');}catch{fail('DRIVER_SETUP','PAGE_INSTALL');}
 try{const hide=()=>record('PAGEHIDE');g.addEventListener('pagehide',hide);removers.push(()=>g.removeEventListener('pagehide',hide));}catch{fail('DRIVER_SETUP','PAGE_INSTALL');}
}

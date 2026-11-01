/** Self-contained context init script: no imports or response-body interception. */
export function installInitialLifecyclePage({origin,key='__reviewInitialLifecycle'}){
 const g=globalThis,target=origin+'/api/p0/v1/session',rows=[],removers=[];let original;let active=true,invalid=false,overflow=false,targets=0,last=-1;
 const fail=()=>{invalid=true;};
 const record=(event,data={})=>{try{if(!active)return;if(rows.length>=128){overflow=true;return;}const timeMs=g.performance.now();if(!Number.isFinite(timeMs)||timeMs<last){fail();return;}last=timeMs;rows.push(Object.freeze({sequence:rows.length+1,timeMs,event,...data}));}catch{fail();}};
 const safeClass=e=>{try{const name=e?.name;return typeof name==='string'&&['Error','AbortError','TimeoutError','TypeError'].includes(name)?name:'OTHER';}catch{return 'OTHER';}};
 const status=r=>{try{const value=r?.status;return [200,401].includes(value)?String(value):'OTHER';}catch{fail();return 'OTHER';}};
 const finish=()=>{active=false;for(const remove of removers.splice(0)){try{remove();}catch{fail();}}return Object.freeze({clockDomain:'page',targets,invalid,overflow,events:Object.freeze([...rows])});};
 try{Object.defineProperty(g,key,{value:Object.freeze({finish}),configurable:true});}catch{fail();return;}
 try{original=g.fetch;if(typeof original!=='function'){fail();return;}}catch{fail();return;}
 const observedFetch=function(...args){
  let selected=false;
  try{if(active){const input=args[0],init=args[1],url=typeof input==='string'?input:input?.url,method=init?.method??input?.method??'GET';if(new URL(url,g.location.href).href===target&&method==='GET'){targets++;if(targets!==1)fail();else{selected=true;const signal=init?.signal??input?.signal;record('FETCH_BEGIN',{signalPresent:!!signal,aborted:signal?.aborted===true});if(signal){const abort=()=>record('SIGNAL_ABORT');signal.addEventListener('abort',abort,{once:true});removers.push(()=>signal.removeEventListener('abort',abort));}}}}}catch{fail();}
  let promise;try{promise=Reflect.apply(original,this,args);}catch(error){if(selected)record('FETCH_REJECTED',{errorClass:safeClass(error)});throw error;}
  if(selected){try{promise.then(response=>{record('FETCH_FULFILLED',{status:status(response)});},error=>{record('FETCH_REJECTED',{errorClass:safeClass(error)});});}catch{fail();}}
  return promise;
 };
 try{g.fetch=observedFetch;if(g.fetch!==observedFetch)fail();}catch{fail();}
 try{const hide=()=>record('PAGEHIDE');g.addEventListener('pagehide',hide);removers.push(()=>g.removeEventListener('pagehide',hide));}catch{fail();}
}

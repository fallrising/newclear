import test from 'node:test';
import assert from 'node:assert/strict';
const selectedVersion=process.env.TRACE_V3_RED==='1'?'v2':'v3';
const {createInitialLifecycleObserver,EVENTS,REASONS,STAGES,DRIVER_REASONS}=await import('./initial-lifecycle-'+selectedVersion+'-observer.mjs');
const origin='https://synthetic.invalid',url=origin+'/api/p0/v1/session';
test('missing CDP timestamp retains a bounded typed reason with event and clock path',()=>{
 const o=createInitialLifecycleObserver(origin,{clock:()=>1});
 o.cdp('requestWillBeSent',{requestId:'private-id',request:{method:'GET',url}});
 const s=o.snapshot();assert.equal(s.invalid,true);
 assert(s.failures?.some(x=>x.reason==='CLOCK_MISSING'&&x.event==='CDP_REQUEST'&&x.domain==='cdp'&&x.clockPath==='CDP_TIMESTAMP'));
});
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {installInitialLifecyclePage}=await import('./initial-lifecycle-'+selectedVersion+'-page.mjs');
const has=(s,reason,fields={})=>s.failures.some(x=>x.reason===reason&&Object.entries(fields).every(([k,v])=>x[k]===v));
const request=()=>({method:()=> 'GET',url:()=>url});
const pageSnapshot=(times=[100,101])=>({clockDomain:'page',targets:1,invalid:false,overflow:false,events:[{sequence:1,timeMs:times[0],event:'FETCH_BEGIN',signalPresent:true,aborted:false},{sequence:2,timeMs:times[1],event:'FETCH_FULFILLED',status:'401'}]});
function sample({pageTimes=[100,101],cdpTimes=[42,43,44],clock,omit=[],failed=false}={}){
 let now=0;const o=createInitialLifecycleObserver(origin,{clock:clock??(()=>++now)}),r=request(),req=new EventEmitter(),res=new EventEmitter();req.method='GET';req.url='/api/p0/v1/session';
 const run=(name,fn)=>{if(!omit.includes(name))fn();};
 run('ROUTE_CONTINUE',()=>o.route(r,true));run('REQUEST',()=>o.request(r));run('SERVER_REQUEST',()=>o.server(req,res));run('SERVER_END_CALLED',()=>o.serverEnd(req));res.emit('finish');run('SERVER_CLOSE',()=>res.emit('close'));
 run('RESPONSE',()=>o.response({request:()=>r,url:()=>url,status:()=>401}));run('REQUEST_FINISHED',()=>o.terminal(r,null));run('BODY_EXACT',()=>o.body(r,'EXACT'));
 run('CDP_REQUEST',()=>o.cdp('requestWillBeSent',{requestId:'private-id',timestamp:cdpTimes[0],request:{method:'GET',url}}));run('CDP_RESPONSE',()=>o.cdp('responseReceived',{requestId:'private-id',timestamp:cdpTimes[1],response:{url,status:401,headers:{secret:'never'}}}));run('CDP_FINISHED',()=>o.cdp(failed?'loadingFailed':'loadingFinished',{requestId:'private-id',timestamp:cdpTimes[2],errorText:'net::ERR_ABORTED'}));
 run('FETCH_BEGIN',()=>o.page(pageSnapshot(pageTimes)));return {o,r,req,res};
}
test('healthy, explicit-zero and failed terminal traces preserve completion and safe domain clocks',()=>{
 for(const options of [{},{pageTimes:[0,1],cdpTimes:[0,1,2]},{failed:true}]){const {o}=sample(options),s=o.snapshot();assert.equal(s.complete,true);assert.deepEqual(s.failures,[]);assert(Object.isFrozen(s)&&Object.isFrozen(s.events)&&Object.isFrozen(s.failures)&&Object.isFrozen(s.counts));assert(s.events.every(Object.isFrozen));assert(!JSON.stringify(s).includes('private-id'));o.close();assert.deepEqual(o.snapshot(),s);}
 const s=sample().o.snapshot();assert.equal(s.events.find(e=>e.event==='CDP_REQUEST').timeMs,42000);assert.equal(s.events.find(e=>e.event==='FETCH_BEGIN').timeMs,100);
});
for(const[label,value,reason]of [['missing',undefined,'CLOCK_MISSING'],['null',null,'CLOCK_TYPE'],['string','secret','CLOCK_TYPE'],['NaN',NaN,'CLOCK_NONFINITE'],['negative',-1,'CLOCK_NEGATIVE'],['infinite',Infinity,'CLOCK_NONFINITE']]){
 for(const domain of ['host','page','cdp'])test('typed clock rejection '+domain+' '+label,()=>{
  const slots=domain==='cdp'?3:domain==='page'?2:1;
  for(let i=0;i<slots;i++){
   const times=domain==='cdp'?[42,43,44]:[100,101];times[i]=value;
   const s=sample(domain==='host'?{clock:()=>value}:domain==='page'?{pageTimes:times}:{cdpTimes:times}).o.snapshot();
   assert.equal(s.invalid,true);assert.equal(s.complete,false);assert(has(s,reason,{domain,clockPath:domain==='cdp'?'CDP_TIMESTAMP':domain==='page'?'PAGE_TIME':'HOST_ARRIVAL'}));assert(!JSON.stringify(s).includes('secret'));
  }
 });
}
test('clock regressions remain rejected with finite domain-local previous values',()=>{
 for(const[options,domain,event,path]of [[{cdpTimes:[42,41,44]},'cdp','CDP_RESPONSE','CDP_TIMESTAMP'],[{pageTimes:[100,99]},'page','FETCH_FULFILLED','PAGE_TIME']]){const s=sample(options).o.snapshot();assert(has(s,'CLOCK_REGRESSION',{domain,event,clockPath:path}));const issue=s.failures.find(x=>x.reason==='CLOCK_REGRESSION');assert(issue.localValue<issue.previousValue);assert(!s.complete);}
 let n=2;const o=createInitialLifecycleObserver(origin,{clock:()=>n--});o.route(request(),true);o.request(request());assert(has(o.snapshot(),'CLOCK_REGRESSION',{domain:'host',clockPath:'LOCAL_TIME'}));
});
test('clock read exceptions and finite seconds scaling overflow have distinct reasons',()=>{
 const o=createInitialLifecycleObserver(origin,{clock(){throw Error('secret');}});o.route(request(),true);assert(has(o.snapshot(),'CLOCK_READ_THROW',{clockPath:'HOST_ARRIVAL'}));
 const s=sample({cdpTimes:[Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE]}).o.snapshot();assert(has(s,'CLOCK_SCALE_NONFINITE',{clockPath:'CDP_TIMESTAMP'}));assert(!s.complete);
});
test('missing required phases and duplicate phase remain explicit without inventing emission facts',()=>{
 for(const event of ['ROUTE_CONTINUE','REQUEST','SERVER_REQUEST','SERVER_END_CALLED','SERVER_CLOSE','RESPONSE','REQUEST_FINISHED','BODY_EXACT','CDP_REQUEST','CDP_RESPONSE','CDP_FINISHED','FETCH_BEGIN']){const s=sample({omit:[event]}).o.snapshot();assert(!s.complete,event);assert(has(s,'MISSING_PHASE',{event}),event);}
 const x=sample();x.o.terminal(x.r,null);assert(has(x.o.snapshot(),'DUPLICATE_PHASE',{event:'REQUEST_FINISHED'}));assert(!x.o.snapshot().complete);
 const y=createInitialLifecycleObserver(origin,{clock:()=>1});const p=pageSnapshot();p.events.pop();y.page(p);assert(has(y.snapshot(),'MISSING_PHASE',{event:'FETCH_FULFILLED'}));
});
test('duplicate correlation targets and invalid event/field/page metadata fail closed',()=>{
 const cases=[['DUPLICATE_TARGET',x=>x.o.request(x.r)],['DUPLICATE_TARGET',x=>x.o.route(x.r,true)],['DUPLICATE_TARGET',x=>x.o.server(x.req,x.res)],['DUPLICATE_TARGET',x=>x.o.cdp('requestWillBeSent',{requestId:'private-id',timestamp:50,request:{method:'GET',url}})],['DUPLICATE_TARGET',x=>x.o.page(pageSnapshot())],['CORRELATION',x=>x.o.response({request:()=>x.r,url:()=>origin+'/secret',status:()=>401})],['CORRELATION',x=>x.o.cdp('responseReceived',{requestId:'private-id',timestamp:50,response:{url:'secret'}})],['EVENT_INVALID',x=>x.o.body(x.r,'secret')],['EVENT_INVALID',x=>x.o.cdp('secret',{requestId:'private-id'})]];
 for(const[reason,action]of cases){const x=sample();action(x);assert(has(x.o.snapshot(),reason),reason);assert(!JSON.stringify(x.o.snapshot()).includes('secret'));}
 for(const[reason,change]of [['PAGE_DOMAIN',p=>p.clockDomain='secret'],['CORRELATION',p=>p.targets=0],['PAGE_INVALID',p=>p.invalid=true],['PAGE_OVERFLOW',p=>p.overflow=true],['FIELD_INVALID',p=>p.events=null],['PAGE_SEQUENCE',p=>p.events[0].sequence=2],['EVENT_INVALID',p=>p.events[0].event='secret'],['FIELD_INVALID',p=>p.events[0].secret='secret']]){const o=createInitialLifecycleObserver(origin,{clock:()=>1}),p=pageSnapshot();change(p);o.page(p);assert(has(o.snapshot(),reason),reason);assert(!JSON.stringify(o.snapshot()).includes('secret'));}
 for(const input of [null,undefined,2,'secret']){const o=createInitialLifecycleObserver(origin);o.page(input);assert(has(o.snapshot(),input==null?'INPUT_MISSING':'INPUT_TYPE'));}
});
test('missing CDP correlation, input type, hostile callbacks and listener cleanup retain safe reasons',()=>{
 const o=createInitialLifecycleObserver(origin);o.cdp('requestWillBeSent',{timestamp:1,request:{method:'GET',url}});assert(has(o.snapshot(),'CORRELATION'));
 for(const input of [null,undefined,2]){const x=createInitialLifecycleObserver(origin);x.cdp('loadingFinished',input);assert(has(x.snapshot(),input==null?'INPUT_MISSING':'INPUT_TYPE'));}
 const x=createInitialLifecycleObserver(origin);x.request({method(){throw Error('secret');}});assert(has(x.snapshot(),'OBSERVATION_EXCEPTION',{stage:'REQUEST',event:'REQUEST'}));
 const y=sample();y.res.off=()=>{throw Error('secret');};y.o.close();assert(has(y.o.snapshot(),'LISTENER_CLEANUP'));assert.equal(y.req.listenerCount('aborted'),0);assert.equal(y.req.listenerCount('error'),0);
});
test('all driver stages use fixed reason and stage mappings, including after close',()=>{
 for(const[stage,reason]of Object.entries(DRIVER_REASONS)){const o=createInitialLifecycleObserver(origin);o.close();o.driverFailure(stage);assert(has(o.snapshot(),reason,{stage,origin:'driver'}));assert(!o.snapshot().complete);}
 const o=createInitialLifecycleObserver(origin);o.driverFailure('secret');assert(has(o.snapshot(),'UNKNOWN_REASON'));assert(!JSON.stringify(o.snapshot()).includes('secret'));
});
test('hostile safe-recorder contexts, arbitrary reasons and snapshots cannot throw or leak',()=>{
 const o=createInitialLifecycleObserver(origin);const revoked=Proxy.revocable({},{});revoked.revoke();
 for(const reason of ['secret',Symbol('secret'),{},null])assert.doesNotThrow(()=>o.invalidate(reason,{origin:'secret',stage:'secret',event:'secret',domain:'secret',localValue:'secret',arbitrary:'secret'}));
 assert.doesNotThrow(()=>o.invalidate('CORRELATION',revoked.proxy));assert.doesNotThrow(()=>o.page(new Proxy({},{get(){throw Error('secret');}})));
 const s=o.snapshot();assert(has(s,'UNKNOWN_REASON'));assert(has(s,'INVALID_CONTEXT'));assert(has(s,'OBSERVATION_EXCEPTION'));assert(s.failures.every(Object.isFrozen));assert(Object.isFrozen(s.failures));assert(!JSON.stringify(s).includes('secret'));
 for(const f of s.failures){assert(REASONS.includes(f.reason));assert(STAGES.includes(f.stage));assert(EVENTS.includes(f.event)||f.event==='UNKNOWN');assert.equal(f.ordinal,1);assert.equal(f.category,'initial-session');}
});
test('event and failure overflow are bounded together and immutable; late input cannot mutate snapshots',()=>{
 const x=sample();for(let i=0;i<160;i++)x.o.terminal(x.r,null);for(let i=0;i<60;i++)x.o.invalidate('CORRELATION');
 const s=x.o.snapshot();assert(s.overflow&&!s.complete);assert(s.events.length+s.failures.length<=128);assert(s.failures.length<=32);assert(has(s,'OVERFLOW'));const before=JSON.stringify(s);x.o.invalidate('secret');assert.equal(JSON.stringify(s),before);
});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function page(fetch,{clock,readonly=false,throwSetter=false,cleanupThrows=false}={}){
 let n=0;const events=new EventEmitter(),context=vm.createContext({fetch,URL,Reflect,Object,Number,performance:{now:clock??(()=>++n)},location:{href:origin+'/'},addEventListener:(name,fn)=>events.on(name,fn),removeEventListener:(name,fn)=>{if(cleanupThrows)throw Error('secret');events.off(name,fn);}});
 if(readonly)Object.defineProperty(context,'fetch',{value:fetch,writable:false,configurable:true});if(throwSetter)Object.defineProperty(context,'fetch',{get:()=>fetch,set(){throw Error('secret');},configurable:true});
 vm.runInContext('('+installInitialLifecyclePage.toString()+')('+JSON.stringify({origin})+')',context);return {context,events,finish:()=>context.__reviewInitialLifecycle.finish()};
}
test('page records all clock guards without changing exact fetch promise or reading response body',async()=>{
 for(const[value,reason]of [[undefined,'CLOCK_MISSING'],[null,'CLOCK_TYPE'],['secret','CLOCK_TYPE'],[NaN,'CLOCK_NONFINITE'],[Infinity,'CLOCK_NONFINITE'],[-1,'CLOCK_NEGATIVE']]){let calls=0;const promise=Promise.resolve({status:401,get body(){throw Error('body');},clone(){throw Error('clone');}}),p=page(()=>{calls++;return promise;},{clock:()=>value});assert.equal(p.context.fetch(url),promise);await flush();const s=p.finish();assert.equal(calls,1);assert(has(s,reason,{clockPath:'PAGE_TIME',event:'FETCH_BEGIN'}));assert(!JSON.stringify(s).includes('secret'));}
 const p=page(()=>Promise.resolve({status:401}),{clock(){throw Error('secret');}});p.context.fetch(url);await flush();assert(has(p.finish(),'CLOCK_READ_THROW'));
 let n=2;const q=page(()=>Promise.resolve({status:401}),{clock:()=>n--});q.context.fetch(url);await flush();assert(has(q.finish(),'CLOCK_REGRESSION',{event:'FETCH_FULFILLED',localValue:1,previousValue:2}));
});
test('page maintains promise/rejection/synchronous-error identity and records safe rejection class',async()=>{
 const error=Object.assign(Error('secret'),{name:'AbortError'}),promise=Promise.reject(error),p=page(()=>promise);assert.equal(p.context.fetch(url),promise);await assert.rejects(promise,e=>e===error);await flush();assert.equal(p.finish().events.at(-1).errorClass,'AbortError');
 const q=page(()=>{throw error;});assert.throws(()=>q.context.fetch(url),e=>e===error);assert.equal(q.finish().events.at(-1).errorClass,'AbortError');
 const promise2=Promise.resolve({status:401}),r=page(()=>promise2);assert.equal(r.context.fetch(url,{signal:{get aborted(){throw error;}}}),promise2);await flush();assert(has(r.finish(),'OBSERVATION_EXCEPTION',{stage:'PAGE_FETCH'}));
});
test('page single status read, hook setup failure, cleanup failure, post-finish freeze and bounded overflow',async()=>{
 let gets=0,calls=0;const promise=Promise.resolve({get status(){gets++;return 401;}}),p=page(()=>{calls++;return promise;});p.context.fetch(origin+'/unrelated');p.context.fetch(url);await flush();const s=p.finish();assert.equal(gets,1);assert.equal(calls,2);assert(Object.isFrozen(s)&&Object.isFrozen(s.failures)&&Object.isFrozen(s.events));p.context.fetch(url);await flush();assert.equal(s.targets,1);assert.equal(s.invalid,false);
 for(const options of [{readonly:true},{throwSetter:true}]){const original=()=>promise,q=page(original,options);assert.equal(q.context.fetch,original);assert.equal(q.context.fetch(url),promise);assert(has(q.finish(),'DRIVER_SETUP',{stage:'PAGE_INSTALL'}));}
 const q=page(()=>promise,{cleanupThrows:true});q.context.fetch(url);await flush();assert(has(q.finish(),'LISTENER_CLEANUP'));
 const r=page(()=>promise);r.context.fetch(url);await flush();for(let i=0;i<140;i++)r.events.emit('pagehide');const over=r.finish();assert(over.overflow);assert(over.events.length+over.failures.length<=128);assert(over.failures.length<=32);assert(has(over,'OVERFLOW'));
});
test('page status and then accessor failures are safe and propagate typed page reasons to host',async()=>{
 const promise=Promise.resolve({get status(){throw Error('secret');}}),p=page(()=>promise);p.context.fetch(url);await flush();const s=p.finish();assert(has(s,'OBSERVATION_EXCEPTION',{stage:'PAGE_STATUS'}));
 const o=createInitialLifecycleObserver(origin);o.page(s);assert(has(o.snapshot(),'OBSERVATION_EXCEPTION',{origin:'page',stage:'PAGE_STATUS'}));assert(has(o.snapshot(),'PAGE_INVALID'));
 const returned={get then(){throw Error('secret');}},q=page(()=>returned);assert.equal(q.context.fetch(url),returned);assert(has(q.finish(),'OBSERVATION_EXCEPTION'));
});
test('v3 runner reverses byte-exactly to v2 and page remains byte-identical',()=>{
 const read=name=>readFileSync(new URL(name,import.meta.url),'utf8'),old=read('initial-lifecycle-v2-baseline.mjs'),next=read('initial-lifecycle-v3-baseline.mjs');
 let restored=next;for(const part of ['baseline','observer','page'])restored=restored.replaceAll('initial-lifecycle-v3-'+part+'.mjs','initial-lifecycle-v2-'+part+'.mjs');assert.equal(restored,old);
 assert.equal(next.split('r.body()').length,old.split('r.body()').length);assert(!next.includes('Network.getResponseBody'));assert(next.indexOf("throw Error('REVIEW_INITIAL_HEALTH')")<next.indexOf("assert(row.initialTrace.complete"));
 assert.equal(read('initial-lifecycle-v3-page.mjs'),read('initial-lifecycle-v2-page.mjs'));
});
// SPEC-T006R-harness-repair-c2 T02: frozen suite hashes follow the pre-repair transport pin added to the v1 restore test.
test('all v1 and v2 reference files remain at their frozen SHA256 values',()=>{
 const hashes={"initial-lifecycle-v2-baseline.mjs":"85a1e4c897e8be8a7f4e58b6128b4e8f4f0d5c09dd35cb7ab24941b76745ce41","initial-lifecycle.node.mjs":"ab0cbab1600d1d6eacedd0c4fa10bf6a015ebb027c90887d32d346ba844c3ed8","initial-lifecycle-observer.mjs":"21365c05de88390fcec6c031260275d612b46d73e044321c57ade2660cac70a0","initial-lifecycle-v2-page.mjs":"ba2c7d4694049c766b6d48aa7469d6c2a06921751a1f04297bf98c4732a4255f","initial-lifecycle-transport.mjs":"e6e12db41895621285f91185208c088f2a8f7df94994a2d67a16beab5b74c8df","initial-lifecycle-v2-observer.mjs":"f50d527475090004fdbd1e7b05d58fe37a7b36860964c56ee8eea57879e3321c","initial-lifecycle-v2.node.mjs":"14ce3040c62fc89801cd539829ea197b126e443d139c3e3cbec877963fd0cd14","initial-lifecycle-page.mjs":"71f702f2bec732807348f8ccc7fa7704959e57ec1211eb0bae5f6e05466f8c55","initial-lifecycle-baseline.mjs":"3da7aeb4d23bc1405b511004562270baa21ad947e5162bf3520783ef4c8cebea"};
 for(const[name,hash]of Object.entries(hashes))assert.equal(createHash('sha256').update(readFileSync(new URL(name,import.meta.url))).digest('hex'),hash,name);
});

test('failure-only overflow and missing terminal distinguish absent evidence from rejected input',()=>{
 const o=createInitialLifecycleObserver(origin);for(let i=0;i<40;i++)o.invalidate('CORRELATION',{localValue:12345});const capped=o.snapshot();assert(capped.overflow);assert.equal(capped.failures.length,32);assert(has(capped,'OVERFLOW'));assert(capped.events.length+capped.failures.length<=128);assert(!JSON.stringify(capped).includes('12345'));
 const absent=sample({omit:['CDP_FINISHED']}).o.snapshot();assert(has(absent,'MISSING_PHASE',{event:'CDP_FINISHED'}));assert(!has(absent,'CLOCK_MISSING'));
 const rejected=sample({cdpTimes:[42,43,undefined]}).o.snapshot();assert(has(rejected,'CLOCK_MISSING',{event:'CDP_FINISHED',clockPath:'CDP_TIMESTAMP'}));assert(has(rejected,'MISSING_PHASE',{event:'CDP_FINISHED'}));
 const x=sample();x.o.cdp('loadingFinished',{requestId:'private-id',get timestamp(){throw Error('secret');}});assert(has(x.o.snapshot(),'OBSERVATION_EXCEPTION',{event:'CDP_FINISHED',stage:'CDP'}));
});

// C05: actual006 CDP values only; the surrounding fixture is synthetic, never a replay.
const actual006Times=[765538.2013629999,765538.220203,765538.217717];
test('actual006 successful completion retains the exact sampled triple in callback order',()=>{
 const s=sample({cdpTimes:actual006Times}).o.snapshot();
 if(selectedVersion==='v2')console.log(JSON.stringify({evidence:'intended-v2-RED',complete:s.complete,events:s.events.length,failures:s.failures}));
 assert.equal(s.complete,true);assert.equal(s.invalid,false);assert.equal(s.events.length,14);
 const cdp=s.events.filter(e=>e.domain==='cdp');assert.deepEqual(cdp.map(e=>e.event),['CDP_REQUEST','CDP_RESPONSE','CDP_FINISHED']);assert.deepEqual(cdp.map(e=>e.timeMs),actual006Times.map(t=>t*1000));assert.deepEqual(cdp.map(e=>e.sequence),[1,2,3]);
 assert.equal(s.events.filter(e=>['CDP_FINISHED','CDP_FAILED'].includes(e.event)).length,1);assert.deepEqual(s.failures,[]);
 assert.deepEqual(cdp.map(e=>e.hostArrivalSequence),[10,11,12]);assert(cdp[2].timeMs<cdp[1].timeMs&&cdp[2].timeMs>=cdp[0].timeMs);
});

test('successful completion accepts equality, increasing and observed zero request bounds',()=>{
 for(const times of [[42,43,42],[42,43,42.5],[42,43,43],[42,43,44],[0,0,0],[0,1,0],[0,1,0.5]]){
  const s=sample({cdpTimes:times}).o.snapshot();assert(s.complete,JSON.stringify(times));assert.equal(s.events.length,14);assert.deepEqual(s.events.filter(e=>e.domain==='cdp').map(e=>e.timeMs),times.map(t=>t*1000));assert.deepEqual(s.failures,[]);
 }
});
test('finish-before-request, response regression and failed-terminal regression still reject',()=>{
 for(const[options,event,previous]of [[{cdpTimes:[42,43,41.999]},'CDP_FINISHED',42000],[{cdpTimes:[42,41.999,44]},'CDP_RESPONSE',42000],[{cdpTimes:[42,43,42.999],failed:true},'CDP_FAILED',43000]]){
  const s=sample(options).o.snapshot();assert(!s.complete);assert(s.invalid);assert(has(s,'CLOCK_REGRESSION',{event,domain:'cdp',clockPath:'CDP_TIMESTAMP',previousValue:previous}));assert(!s.events.some(e=>e.event===event));
 }
 const x=sample({cdpTimes:[42,43,42.5]});x.o.cdp('loadingFailed',{requestId:'private-id',timestamp:42.4,errorText:'net::ERR_FAILED'});assert(has(x.o.snapshot(),'CLOCK_REGRESSION',{event:'CDP_FAILED',clockPath:'CDP_TIMESTAMP',previousValue:42500}));
});
for(const[label,value,reason]of [['boolean',true,'CLOCK_TYPE'],['object',{},'CLOCK_TYPE'],['symbol',Symbol('secret'),'CLOCK_TYPE'],['bigint',1n,'CLOCK_TYPE'],['negative-infinity',-Infinity,'CLOCK_NONFINITE'],['scale-overflow',Number.MAX_VALUE,'CLOCK_SCALE_NONFINITE']])test('CDP '+label+' is rejected at every slot and failed terminal',()=>{
 for(let slot=0;slot<3;slot++){const times=[42,43,44];times[slot]=value;const s=sample({cdpTimes:times}).o.snapshot();assert(!s.complete);assert(has(s,reason,{event:['CDP_REQUEST','CDP_RESPONSE','CDP_FINISHED'][slot],clockPath:'CDP_TIMESTAMP'}));assert(!s.events.some(e=>e.event===['CDP_REQUEST','CDP_RESPONSE','CDP_FINISHED'][slot]));}
 const failed=sample({cdpTimes:[42,43,value],failed:true}).o.snapshot();assert(!failed.complete);assert(has(failed,reason,{event:'CDP_FAILED',clockPath:'CDP_TIMESTAMP'}));assert(!failed.events.some(e=>e.event==='CDP_FAILED'));
});
test('invalid or missing request timestamps cannot be replaced by a response-created anchor',()=>{
 for(const[value,reason]of [[undefined,'CLOCK_MISSING'],[null,'CLOCK_TYPE'],['42','CLOCK_TYPE'],[NaN,'CLOCK_NONFINITE'],[Infinity,'CLOCK_NONFINITE'],[-1,'CLOCK_NEGATIVE'],[Number.MAX_VALUE,'CLOCK_SCALE_NONFINITE']]){
  const s=sample({cdpTimes:[value,43,44]}).o.snapshot();assert(s.invalid&&!s.complete);assert(has(s,reason,{event:'CDP_REQUEST',clockPath:'CDP_TIMESTAMP'}));assert(has(s,'MISSING_PHASE',{stage:'CDP',event:'CDP_REQUEST',domain:'cdp',clockPath:'CDP_TIMESTAMP'}));assert(s.events.some(e=>e.event==='CDP_RESPONSE'));assert(!s.events.some(e=>['CDP_REQUEST','CDP_FINISHED','CDP_FAILED'].includes(e.event)));
 }
 const missing=sample({omit:['CDP_REQUEST']}).o.snapshot();assert(!missing.complete);assert(!missing.events.some(e=>['CDP_FINISHED','CDP_FAILED'].includes(e.event)));assert(has(missing,'MISSING_PHASE',{event:'CDP_REQUEST'}));
});
test('valid request timestamp without successful row insertion never installs an anchor',()=>{
 for(const mode of ['invalid-arrival','throwing-arrival']){
  let n=0;const s=sample({cdpTimes:[0,1,2],clock:()=>{n++;if(n===10){if(mode==='throwing-arrival')throw Error('secret');return NaN;}return n;}}).o.snapshot();
  assert(!s.complete);assert(has(s,mode==='throwing-arrival'?'CLOCK_READ_THROW':'CLOCK_NONFINITE',{event:'CDP_REQUEST',clockPath:'HOST_ARRIVAL'}));assert(has(s,'MISSING_PHASE',{stage:'CDP',event:'CDP_REQUEST'}));assert(s.events.some(e=>e.event==='CDP_RESPONSE'));assert(!s.events.some(e=>['CDP_REQUEST','CDP_FINISHED'].includes(e.event)));
 }
 const o=createInitialLifecycleObserver(origin,{clock:()=>1}),r=request();o.request(r);for(let i=0;i<127;i++)o.terminal(r,null);
 o.cdp('requestWillBeSent',{requestId:'private-id',timestamp:0,request:{method:'GET',url}});o.cdp('responseReceived',{requestId:'private-id',timestamp:1,response:{url,status:401}});o.cdp('loadingFinished',{requestId:'private-id',timestamp:2});
 const capped=o.snapshot();assert(capped.overflow&&!capped.complete);assert(has(capped,'MISSING_PHASE',{stage:'CDP',event:'CDP_REQUEST'}));assert(!capped.events.some(e=>['CDP_REQUEST','CDP_FINISHED'].includes(e.event)));
});
test('unknown IDs stay ignored, missing and duplicate terminal cardinality stay rejected',()=>{
 const x=sample(),before=x.o.snapshot();x.o.cdp('responseReceived',{requestId:'other-private-id',timestamp:NaN,response:{url:'secret'}});x.o.cdp('loadingFinished',{requestId:'other-private-id',timestamp:-1});assert.deepEqual(x.o.snapshot(),before);
 const missing=sample({omit:['CDP_FINISHED']}).o.snapshot();assert(!missing.complete);assert(has(missing,'MISSING_PHASE',{event:'CDP_FINISHED'}));
 for(const type of ['loadingFinished','loadingFailed']){const y=sample({cdpTimes:[42,43,42.5]});y.o.cdp(type,{requestId:'private-id',timestamp:44,errorText:'net::ERR_FAILED'});const s=y.o.snapshot();assert(!s.complete);assert.equal(s.events.filter(e=>['CDP_FINISHED','CDP_FAILED'].includes(e.event)).length,2);assert(has(s,'DUPLICATE_PHASE',{event:'CDP_FINISHED'}));}
});
test('snapshot describes arrival order and conservative request-bound sampled time policy',()=>{
 const s=sample({cdpTimes:actual006Times}).o.snapshot();assert(s.ordering.includes('callback arrival order'));assert(s.ordering.includes('CDP_FINISHED >= validated CDP_REQUEST'));assert(s.ordering.includes('other CDP samples >= last accepted CDP sample'));assert(s.ordering.includes('not cross-clock causality'));
});

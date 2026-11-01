import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createBootstrapBodyObservation,BODY_NOT_ATTEMPTED} from './bootstrap-body-observation.mjs';
const moduleURL=p=>p?pathToFileURL(p):null;
const observerURL=moduleURL(process.env.OBSERVER_MODULE)??new URL('./bootstrap-body-observer.mjs',import.meta.url);
const originalURL=moduleURL(process.env.ORIGINAL_OBSERVER)??new URL('./bootstrap-observer.mjs',import.meta.url);
const {createBootstrapObserver,bootstrapVerdict}=await import(observerURL);
const original=await import(originalURL);
const origin='https://fixture.invalid',path='/api/p0/v1/operator/session';
const bytes=Buffer.from(JSON.stringify({actor:'operator',expires_in_seconds:300,instance_id:'11111111-1111-4111-8111-111111111111',p0_session_id:'22222222-2222-4222-8222-222222222222'}));
const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','transfer-encoding':'chunked'};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(create=createBootstrapObserver,{body=()=>Promise.resolve(bytes),allHeaders=()=>Promise.resolve(headers),register=true}={}){
 const observer=create(origin),calls={body:0,headers:0},order=[];
 const request={method:()=> 'POST',url:()=>origin+path};
 const response={request:()=>request,status:()=>201,allHeaders:()=>{calls.headers++;order.push('headers');return allHeaders();},body:()=>{calls.body++;order.push('body');return body();}};
 if(register){observer.request(request);const res=new EventEmitter();observer.server({method:'POST',path,output:{status:201,body:bytes},res});res.emit('finish');res.emit('close');}
 return {observer,response,calls,order};
}
function verdict(result){return bootstrapVerdict({...result,requestFinished:true,requestFailed:false,ui:{idle:true,authenticated:true,connected:true,bearerEmpty:true,promptEmpty:true,errorCode:'EMPTY',pendingReads:0},fixture:{effects:1,turnStarts:0,counts:{['POST '+path]:1}}});}
const withoutDiagnostic=({bodyReadObservation,...rest})=>rest;
test('successful exact body has a safe immutable diagnostic and unchanged PASS',async()=>{
 const f=fixture(),r=await f.observer.client(f.response);assert.equal(r.bodyOutcome,'EXACT_SCHEMA_AND_FIXTURE_MATCH');assert.equal(r.bodyReadObservation?.outcome,'FULFILLED');assert(Object.isFrozen(r.bodyReadObservation));assert.equal(r.bodyReadObservation.errorClass,null);assert(Number.isFinite(r.bodyReadObservation.elapsedMs)&&r.bodyReadObservation.elapsedMs>=0);assert.equal(verdict(r),'PASS');assert.equal(f.calls.body,1);
});
test('original observer fields preserved for exact, mismatched, oversized and failed bodies',async()=>{
 for(const options of [{},{body:()=>Promise.resolve(Buffer.from('{}'))},{body:()=>Promise.resolve(Buffer.alloc(4097))},{body:()=>Promise.reject(new Error('synthetic secret'))},{allHeaders:()=>Promise.reject(new Error('headers'))}]){
  const a=fixture(createBootstrapObserver,options),b=fixture(original.createBootstrapObserver,options),actual=await a.observer.client(a.response),expected=await b.observer.client(b.response);
  assert.deepEqual(withoutDiagnostic(actual),expected);assert.equal(a.calls.body,1);assert.equal(b.calls.body,1);assert.equal(verdict(actual),original.bootstrapVerdict({...expected,requestFinished:true,requestFailed:false,ui:{idle:true,authenticated:true,connected:true,bearerEmpty:true,promptEmpty:true,errorCode:'EMPTY',pendingReads:0},fixture:{effects:1,turnStarts:0,counts:{['POST '+path]:1}}}));
 }
});
test('sync and async API errors preserve identity, classify rejection and never leak content',async()=>{
 for(const error of [new Error('private body'),Object.assign(new Error('REVIEW_TIMEOUT_bootstrap-response-body'),{name:'TimeoutError'}),undefined,null,'secret',{name:{toString(){throw Error('name coercion must not run');}}},Object.defineProperty({},'name',{get(){throw Error('secret getter');}})])for(const sync of [true,false]){
  const observation=createBootstrapBodyObservation();let caught=false;
  try{await observation.read(()=>{if(sync)throw error;return Promise.reject(error);});}catch(actual){caught=true;assert.equal(actual,error);}
  assert(caught);const d=observation.snapshot();assert.equal(d.outcome,'RESPONSE_REJECTED');assert(Object.isFrozen(d));assert(['ERROR','ABORT_ERROR','TIMEOUT_ERROR','TARGET_CLOSED_ERROR','OTHER'].includes(d.errorClass));assert(!JSON.stringify(d).includes('secret'));assert.deepEqual(Object.keys(d),['outcome','elapsedMs','errorClass']);
 }
});
test('unattempted correlation failure does not read body or headers',async()=>{
 const f=fixture(createBootstrapObserver,{register:false}),r=await f.observer.client(f.response);assert.deepEqual(r.bodyReadObservation,BODY_NOT_ATTEMPTED);assert.equal(r.bodyOutcome,'NOT_ATTEMPTED');assert.deepEqual(f.calls,{body:0,headers:0});
});
test('headers resolve before body and rejected headers retain original handling',async()=>{
 const waiting=deferred(),f=fixture(createBootstrapObserver,{allHeaders:()=>waiting.promise}),p=f.observer.client(f.response);await flush();assert.deepEqual(f.order,['headers']);waiting.resolve(headers);const r=await p;assert.deepEqual(f.order,['headers','body']);assert.equal(r.bodyReadObservation.outcome,'FULFILLED');
 const rejected=fixture(createBootstrapObserver,{allHeaders:()=>Promise.reject(new Error('header'))}),failure=await rejected.observer.client(rejected.response);assert.equal(failure.headers,null);assert.equal(failure.bodyReadObservation.outcome,'FULFILLED');assert.equal(verdict(failure),'FAIL');
});
test('original2000ms deadline remains authoritative; late resolve cannot rewrite snapshot',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const waiting=deferred(),o=createBootstrapBodyObservation();let reads=0;const p=o.read(()=>{reads++;return waiting.promise;});const caught=p.catch(error=>error);await flush();t.mock.timers.tick(1999);await flush();assert.equal(o.snapshot().outcome,'NOT_ATTEMPTED');t.mock.timers.tick(1);const error=await caught;assert.equal(error.message,'REVIEW_TIMEOUT_bootstrap-response-body');const snapshot=o.snapshot();assert.equal(snapshot.outcome,'OBSERVER_DEADLINE');waiting.resolve(bytes);await flush();assert.equal(o.snapshot(),snapshot);assert.equal(o.read(()=>{reads++;return bytes;}),p);assert.equal(reads,1);
});
test('late reject after deadline is handled and cannot overwrite finalized deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const waiting=deferred(),o=createBootstrapBodyObservation(),p=o.read(()=>waiting.promise);const caught=p.catch(error=>error);await flush();t.mock.timers.tick(2000);await caught;const snapshot=o.snapshot();waiting.reject(new Error('late secret'));await flush();assert.equal(o.snapshot(),snapshot);assert.equal(snapshot.outcome,'OBSERVER_DEADLINE');
});
test('cloned observer deadline still READ_FAILED and strict FAIL with one read',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const waiting=deferred(),f=fixture(createBootstrapObserver,{body:()=>waiting.promise}),p=f.observer.client(f.response);await flush();t.mock.timers.tick(2000);const r=await p;assert.equal(r.bodyOutcome,'READ_FAILED');assert.equal(r.bodyReadObservation.outcome,'OBSERVER_DEADLINE');assert.equal(verdict(r),'FAIL');assert.equal(f.calls.body,1);waiting.resolve(bytes);await flush();assert.equal(r.bodyReadObservation.outcome,'OBSERVER_DEADLINE');
});
test('API rejection keeps original READ_FAILED/strictFAIL even when error spoofs timeout',async()=>{
 const error=Object.assign(Error('REVIEW_TIMEOUT_bootstrap-response-body'),{name:'TimeoutError'}),f=fixture(createBootstrapObserver,{body:()=>Promise.reject(error)}),r=await f.observer.client(f.response);assert.equal(r.bodyOutcome,'READ_FAILED');assert.equal(r.bodyReadObservation.outcome,'RESPONSE_REJECTED');assert.equal(r.bodyReadObservation.errorClass,'TIMEOUT_ERROR');assert.equal(verdict(r),'FAIL');
});

test('deadline origin wins even when a spoofed API rejection races the timeout continuation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const waiting=deferred(),o=createBootstrapBodyObservation(),p=o.read(()=>waiting.promise);const caught=p.catch(error=>error);await flush();t.mock.timers.tick(2000);waiting.reject(Object.assign(Error('REVIEW_TIMEOUT_bootstrap-response-body'),{name:'TimeoutError'}));const error=await caught;assert.equal(error.message,'REVIEW_TIMEOUT_bootstrap-response-body');assert.equal(o.snapshot().outcome,'OBSERVER_DEADLINE');await flush();assert.equal(o.snapshot().outcome,'OBSERVER_DEADLINE');
});
test('runner changes are limited to new observer wiring and source receipt enumeration',()=>{
 const priorURL=moduleURL(process.env.ORIGINAL_RUNNER)??new URL('./recovery-initial-header-baseline.mjs',import.meta.url),candidate=readFileSync(new URL('./recovery-post-body-baseline.mjs',import.meta.url),'utf8');
 const restored=candidate.replace("import {createBootstrapObserver} from './bootstrap-body-observer.mjs';","import {createBootstrapObserver} from './bootstrap-observer.mjs';").replace("['recovery-post-body-baseline.mjs','bootstrap-body-observer.mjs','bootstrap-body-observation.mjs','recovery-formal.mjs'","['recovery-initial-header-baseline.mjs','recovery-formal.mjs'");assert.equal(restored,readFileSync(priorURL,'utf8'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const candidate=process.env.CANDIDATE??fileURLToPath(new URL('./recovery-initial-header-baseline.mjs',import.meta.url));
const original=process.env.ORIGINAL??fileURLToPath(new URL('./recovery-formal-baseline.mjs',import.meta.url));
const source=readFileSync(candidate,'utf8');
const start="page.on('response',",end=");page.on('requestfinished',";
assert.equal(source.split(start).length,2,'one actual response handler');
const callback=source.slice(source.indexOf(start)+start.length,source.indexOf(end,source.indexOf(start)));
assert(callback.startsWith('r=>{')&&callback.endsWith('}'),'extract complete actual callback');
const origin='https://127.0.0.1:8443',api='/api/p0/v1';
const authBody=JSON.stringify({error:{code:'authentication_required',message:'operator authentication is required'}});
function harness({phase='bootstrap',manualActions=[]}={}){
 const events=[],bodyReads=[],bodies=new WeakSet(),recovery=[],disconnected=[];
 const observed={bootstrap:{request:null,response:null},turn:{request:null,response:null},device:{request:null,response:null}};
 const observedKind=(method,url)=>method==='POST'?({'/api/p0/v1/operator/session':'bootstrap','/api/p0/v1/session/turns':'turn','/api/p0/v1/login/device':'device'})[url.startsWith(origin)?url.slice(origin.length):'']:null;
 const deps={recoveryObserver:{response:r=>recovery.push(r)},readObserver:{response:r=>disconnected.push(r)},observedKind,observed,events,bodyReads,bodies,origin,api,phase,row:{manualActions}};
 const onResponse=new Function(...Object.keys(deps),`return (${callback});`)(...Object.values(deps));
 return {onResponse,events,bodyReads,bodies,recovery,disconnected,observed,settle:()=>Promise.all(bodyReads)};
}
function response({method='GET',path='/session',status=401,body=authBody,requestHeaders={},rejectHeaders=false,rejectBody=false}={}){
 const calls={allHeaders:0,headers:0,body:0};
 const request={method:()=>method,allHeaders:()=>{calls.allHeaders++;return rejectHeaders?Promise.reject(new Error('headers unavailable')):Promise.resolve(requestHeaders);}};
 const r={request:()=>request,url:()=>origin+api+path,status:()=>status,headers:()=>{calls.headers++;return {'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};},body:()=>{calls.body++;return rejectBody?Promise.reject(new Error('body unavailable')):Promise.resolve(Buffer.from(body));}};
 return {r,request,calls};
}
test('initial GET401 preserves exact header, credential and body observations',async()=>{
 const h=harness(),x=response();h.onResponse(x.r);await h.settle();
 assert.deepEqual(x.calls,{allHeaders:1,headers:1,body:1});
 assert.deepEqual(h.events[0].initialHeaders,{json:true,noStore:true,nosniff:true,wwwAuthenticatePresent:false});
 assert.deepEqual(h.events[0].initialCredentials,{cookiePresent:false,authorizationPresent:false});
 assert(h.bodies.has(x.request));assert.equal(h.events[0].request,x.request);
});
test('initial credential presence remains observable rather than suppressed',async()=>{
 const h=harness(),x=response({requestHeaders:{cookie:'synthetic',authorization:'synthetic'}});h.onResponse(x.r);await h.settle();
 assert.deepEqual(h.events[0].initialCredentials,{cookiePresent:true,authorizationPresent:true});
});
test('authenticated session and login200 reach observers without initial allHeaders',async()=>{
 const h=harness({manualActions:['authenticate']}),pair=[response({status:200}),response({path:'/login',status:200})];
 for(const x of pair)h.onResponse(x.r);await h.settle();
 assert.deepEqual(h.recovery,pair.map(x=>x.r));assert.deepEqual(h.disconnected,pair.map(x=>x.r));
 assert.equal(h.events.length,2);for(const x of pair)assert.deepEqual(x.calls,{allHeaders:0,headers:0,body:0});
 assert(h.events.every(e=>!Object.hasOwn(e,'initialHeaders')&&!Object.hasOwn(e,'initialCredentials')));
});
test('even preauth session200 is not the initial401 metadata hook',async()=>{
 const h=harness(),x=response({status:200});h.onResponse(x.r);await h.settle();assert.equal(x.calls.allHeaders,0);assert.equal(x.calls.headers,0);
});
test('session401 after Authenticate retains body observation but no initial metadata',async()=>{
 const h=harness({manualActions:['authenticate']}),x=response();h.onResponse(x.r);await h.settle();
 assert.deepEqual(x.calls,{allHeaders:0,headers:0,body:1});assert(h.bodies.has(x.request));assert.equal(h.recovery[0],x.r);
});
test('wrong method, URL and phase cannot trigger initial metadata',async()=>{
 for(const [options,input] of [[{}, {method:'POST'}],[{}, {path:'/login'}],[{phase:'recovery-required'},{}]]){
  const h=harness(options),x=response(input);h.onResponse(x.r);await h.settle();assert.equal(x.calls.allHeaders,0);assert.equal(x.calls.headers,0);
 }
});
test('401 invalid or rejected body remains unaccepted; original failure handling retained',async()=>{
 for(const input of [{body:'{}'},{rejectBody:true}]){const h=harness(),x=response(input);h.onResponse(x.r);await h.settle();assert(!h.bodies.has(x.request));assert.equal(x.calls.body,1);}
 const h=harness(),x=response({rejectHeaders:true});h.onResponse(x.r);await h.settle();assert.equal(h.events[0].initialCredentials,null);assert(h.bodies.has(x.request));
});
test('bootstrap POST response bookkeeping and every observer remain intact',async()=>{
 const h=harness({manualActions:['authenticate']}),x=response({path:'/operator/session',method:'POST',status:201});h.onResponse(x.r);await h.settle();
 assert.equal(h.observed.bootstrap.response,x.r);assert.equal(h.recovery[0],x.r);assert.equal(h.disconnected[0],x.r);assert.equal(h.events[0].status,201);assert.equal(x.calls.allHeaders,0);
});
test('complete runner unchanged outside approved condition and self-source filename',()=>{
 const oldCondition="r.url()===origin+api+'/session'&&phase==='bootstrap'";
 const newCondition=oldCondition+"&&request.method()==='GET'&&r.status()===401&&row.manualActions.length===0";
 const restored=source.replace(newCondition,oldCondition).replace("['recovery-initial-header-baseline.mjs'","['recovery-formal-baseline.mjs'");
 assert.equal(restored,readFileSync(original,'utf8'));
});

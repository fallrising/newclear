import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {request as httpsRequest} from 'node:https';
import {request as httpRequest} from 'node:http';
import {createServer as netServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {createP0Controller} from '../apps/control-plane/web/p0-client.js';
import {createFixture,api} from './fixture.mjs';
import {createTransport} from './transport.mjs';

// SPEC-T006R-conformance-proposal C1-a/C1-b: R03/R04 over the real review HTTPS/WSS transport on loopback.
// REVIEW_MODULES is the directory that contains playwright/package.json (Playwright 1.63.0 tools).
const modules=process.env.REVIEW_MODULES;
const skip=modules?false:'REVIEW_MODULES is unset; it must name the directory containing playwright/package.json';
let WsClient,WsServer;
if(modules){const req=createRequire(join(modules,'playwright','package.json'));assert.equal(req('playwright/package.json').version,'1.63.0');({ws:WsClient,wsServer:WsServer}=req('playwright-core/lib/utilsBundle'));}
const bearer='synthetic-review-bootstrap-canary-0001';
const until=async(check,ms=3000)=>{const end=performance.now()+ms;while(!check()){if(performance.now()>end)throw Error('REVIEW_WAIT_TIMEOUT');await new Promise(r=>setTimeout(r,10));}};

let tls;
test.before(()=>{if(skip)return;const dir=mkdtempSync(join(tmpdir(),'fanz-conformance-'));const o=(...a)=>execFileSync('openssl',a,{cwd:dir,stdio:'ignore',timeout:20000});
 const ca=name=>o('req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',name+'.key','-out',name+'.crt','-days','1','-subj','/CN=Conformance '+name,'-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign');

 ca('ca');ca('other');
 for(const[name,san]of[['good','subjectAltName=IP:127.0.0.1'],['wrong','subjectAltName=DNS:wrong.invalid']]){o('req','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',name+'.key','-out',name+'.csr','-subj','/CN=Conformance '+name);writeFileSync(join(dir,name+'.ext'),san+'\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n',{flag:'wx',mode:0o600});o('x509','-req','-in',name+'.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out',name+'.crt','-days','1','-extfile',name+'.ext');}
 const r=f=>readFileSync(join(dir,f));tls={dir,ca:r('ca.crt'),other:r('other.crt'),key:r('good.key'),cert:r('good.crt'),wrongKey:r('wrong.key'),wrongCert:r('wrong.crt')};
});
test.after(()=>{if(tls)rmSync(tls.dir,{recursive:true,force:true});});

const freePort=()=>new Promise((resolve,reject)=>{const s=netServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});
async function start(scenario,{key=tls.key,cert=tls.cert}={}){
 const port=await freePort(),origin=`https://127.0.0.1:${port}`;let now=1000;
 const fixture=createFixture({origin,scenario,bearer,now:()=>now});
 const transport=createTransport({origin,fixture,key,cert,WebSocketServer:WsServer});await transport.listen();
 return {origin,port,fixture,transport,advance:ms=>{now+=ms;},close:()=>transport.close()};
}
function call(env,{method='GET',path,headers={},body='',ca=tls.ca}){
 return new Promise((resolve,reject)=>{const req=httpsRequest({host:'127.0.0.1',port:env.port,method,path,ca,headers:{...headers,...(body?{'content-length':Buffer.byteLength(body)}:{})}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('REVIEW_HTTP_TIMEOUT')));req.end(body||undefined);});
}
async function authenticate(env){const r=await call(env,{method:'POST',path:api+'/operator/session',headers:{origin:env.origin,authorization:'Bearer '+bearer}});assert.equal(r.status,201);return {cookie:r.headers['set-cookie'][0].split(';')[0],instance:JSON.parse(r.body).instance_id};}
const mutationHeaders=(env,c,extra={})=>({origin:env.origin,cookie:c.cookie,'codebox-instance-id':c.instance,'idempotency-key':randomUUID(),...extra});
function connect(env,{cookie,origin=env.origin,path=api+'/session/stream'}={}){
 return new Promise(resolve=>{const out={frames:[],closed:null,status:null,opened:false,waiters:[]};
  const sock=new WsClient(env.origin.replace('https:','wss:')+path,{ca:tls.ca,perMessageDeflate:false,headers:{origin,...(cookie?{cookie}:{})}});out.sock=sock;
  sock.on('open',()=>{out.opened=true;resolve(out);});sock.on('message',data=>out.frames.push(JSON.parse(data.toString())));
  sock.on('close',(code,reason)=>{out.closed={code,reason:reason.toString(),at:performance.now()};});
  sock.on('unexpected-response',(req,res)=>{out.status=res.statusCode;res.resume();req.destroy();resolve(out);});sock.on('error',()=>{if(!out.opened&&out.status===null){out.status='error';resolve(out);}});});
}
const subscribeFrame=(sessionId,after=0,extra={})=>JSON.stringify({type:'subscribe',protocol_version:1,session_id:sessionId,after_seq:after,...extra});
const sessionId=async(env,c)=>JSON.parse((await call(env,{path:api+'/session',headers:{cookie:c.cookie}})).body).identity.session_id;
const mutations=f=>Object.fromEntries(Object.entries(f.summary().counts).filter(([k])=>!k.startsWith('GET ')));

test('review_tls_node_client_trusts_only_private_ca_and_loopback_name',{skip},async()=>{
 const env=await start('authenticated-ready');
 try{
  assert.equal((await call(env,{path:'/'})).status,200);
  await assert.rejects(call(env,{path:'/',ca:tls.other}),e=>/UNABLE_TO_VERIFY|self.signed|unable to get/i.test(e.code+' '+e.message));
  const plain=await new Promise(resolve=>{const req=httpRequest({host:'127.0.0.1',port:env.port,path:'/'},res=>{res.resume();resolve(res.statusCode);});req.on('error',()=>resolve('refused'));req.setTimeout(3000,()=>{req.destroy();resolve('refused');});req.end();});
  assert.notEqual(plain,200);
 }finally{await env.close();}
 const wrong=await start('authenticated-ready',{key:tls.wrongKey,cert:tls.wrongCert});
 try{await assert.rejects(call(wrong,{path:'/'}),e=>e.code==='ERR_TLS_CERT_ALTNAME_INVALID');}finally{await wrong.close();}
});

test('review_wss_upgrade_requires_cookie_origin_and_fixed_path',{skip},async()=>{
 const env=await start('authenticated-ready');
 try{const c=await authenticate(env);
  assert.equal((await connect(env,{})).status,403);
  assert.equal((await connect(env,{cookie:c.cookie,origin:'https://127.0.0.1:1'})).status,403);
  assert.equal((await connect(env,{cookie:c.cookie,path:api+'/session/streams'})).status,403);
  const good=await connect(env,{cookie:c.cookie});assert.equal(good.opened,true);
  assert.equal(env.transport.summary().rejectedUpgrades,3);good.sock.close(1000);await until(()=>good.closed);
 }finally{await env.close();}
});

test('review_wss_replay_live_order_and_exact_envelopes',{skip},async()=>{
 const env=await start('turn-busy');
 try{const c=await authenticate(env);
  assert.equal((await call(env,{method:'POST',path:api+'/session/turns',headers:mutationHeaders(env,c,{'content-type':'application/json'}),body:'{"prompt":"Synthetic"}'})).status,202);
  const sid=await sessionId(env,c),before=mutations(env.fixture);
  const s=await connect(env,{cookie:c.cookie});s.sock.send(subscribeFrame(sid));await until(()=>s.frames.some(f=>f.type==='replay_end'));
  const types=s.frames.map(f=>f.type),high=s.frames[0].high_water_seq;
  assert.deepEqual(types,['replay_begin',...Array(high).fill('event'),'snapshot','replay_end']);
  for(const[i,f]of s.frames.filter(f=>f.type==='event').entries()){assert.deepEqual(Object.keys(f).sort(),['envelope','type']);assert.deepEqual(Object.keys(f.envelope).sort(),['payload','schema_version','seq','session_id','turn_id']);assert.equal(f.envelope.schema_version,1);assert.equal(f.envelope.seq,i+1);assert.equal(f.envelope.session_id,sid);}
  assert.equal(s.frames.at(-2).high_water_seq,high);assert.equal(s.frames.at(-1).high_water_seq,high);
  env.fixture.complete();await until(()=>s.frames.length>high+3);
  const live=s.frames.at(-1);assert.equal(live.type,'event');assert.equal(live.envelope.seq,high+1);
  assert.deepEqual(mutations(env.fixture),before);s.sock.close(1000);await until(()=>s.closed);
 }finally{await env.close();}
});

test('review_wss_errors_have_exact_fields_and_policy_close',{skip},async()=>{
 const env=await start('turn-busy');
 try{const c=await authenticate(env);const sid=await sessionId(env,c),high=env.fixture.summary().sequence,before=mutations(env.fixture);
  const cases=[
   [subscribeFrame(sid,0,{protocol_version:2}),{code:'unsupported_version',supported_version:1}],
   [subscribeFrame(sid,high+5),{code:'future_cursor',latest_available:high}],
   [subscribeFrame(randomUUID()),{code:'wrong_session'}],
   ['{',{code:'protocol_error'}],
   [JSON.stringify({type:'subscribe',protocol_version:1,session_id:sid,after_seq:0,extra:true}),{code:'protocol_error'}],
  ];
  for(const[input,expected]of cases){const s=await connect(env,{cookie:c.cookie});s.sock.send(input);await until(()=>s.closed);
   assert.equal(s.frames.length,1,expected.code);const frame=s.frames[0];
   assert.deepEqual(Object.keys(frame).sort(),['code','message','type',...Object.keys(expected).filter(k=>k!=='code')].sort(),expected.code);
   assert.equal(frame.type,'error');for(const[k,v]of Object.entries(expected))assert.equal(frame[k],v,expected.code+' '+k);
   assert.equal(s.closed.code,1008,expected.code);assert.equal(s.closed.reason,expected.code);}
  assert.deepEqual(mutations(env.fixture),before);await until(()=>env.transport.summary().clients===0);
 }finally{await env.close();}
});

test('review_wss_invalid_frames_close_without_effects',{skip},async()=>{
 const env=await start('turn-busy');
 try{const c=await authenticate(env);const sid=await sessionId(env,c),before=mutations(env.fixture);
  const binary=await connect(env,{cookie:c.cookie});binary.sock.send(Buffer.from(subscribeFrame(sid)),{binary:true});await until(()=>binary.closed);
  assert.equal(binary.frames[0]?.code,'protocol_error');assert.equal(binary.closed.code,1008);
  const repeated=await connect(env,{cookie:c.cookie});repeated.sock.send(subscribeFrame(sid));await until(()=>repeated.frames.some(f=>f.type==='replay_end'));repeated.sock.send(subscribeFrame(sid));await until(()=>repeated.closed);
  assert.equal(repeated.frames.at(-1).code,'protocol_error');assert.equal(repeated.closed.code,1008);
  // T005C: an oversize frame may be closed by the WebSocket library before an application error; only this connection drops.
  const oversize=await connect(env,{cookie:c.cookie});oversize.sock.send('x'.repeat(1025));await until(()=>oversize.closed);
  assert.equal(oversize.frames.length,0);assert.equal(oversize.closed.code,1009);
  assert.deepEqual(mutations(env.fixture),before);await until(()=>env.transport.summary().clients===0&&env.fixture.summary().subscribers===0);
 }finally{await env.close();}
});

test('review_wss_logout_expiry_and_shutdown_close_promptly',{skip},async()=>{
 const env=await start('authenticated-ready');
 try{
  const subscribed=async()=>{const c=await authenticate(env);const s=await connect(env,{cookie:c.cookie});s.sock.send(subscribeFrame(await sessionId(env,c)));await until(()=>s.frames.some(f=>f.type==='replay_end'));return {c,s};};
  const a=await subscribed();const t0=performance.now();
  assert.equal((await call(env,{method:'DELETE',path:api+'/operator/session',headers:mutationHeaders(env,a.c)})).status,204);
  await until(()=>a.s.closed);assert(a.s.closed.at-t0<750,`logout close took ${Math.round(a.s.closed.at-t0)}ms`);
  assert.equal(a.s.frames.at(-1).code,'authentication_expired');assert.equal(a.s.closed.code,1008);
  const b=await subscribed();const t1=performance.now();env.advance(300001);
  await until(()=>b.s.closed);assert(b.s.closed.at-t1<750,`expiry close took ${Math.round(b.s.closed.at-t1)}ms`);
  assert.equal(b.s.frames.at(-1).code,'authentication_expired');assert.equal(b.s.closed.code,1008);
  env.advance(-300001);const d=await subscribed();env.transport.holdReconnect(10);
  await until(()=>d.s.closed);assert.equal(d.s.closed.code,1012);assert.equal(d.s.closed.reason,'server_shutdown');
  await until(()=>env.transport.summary().clients===0&&env.fixture.summary().subscribers===0);
 }finally{await env.close();}
});

test('review_wss_subscribe_timeout_closes_after_five_seconds',{skip,timeout:15000},async()=>{
 const env=await start('authenticated-ready');
 try{const c=await authenticate(env);const s=await connect(env,{cookie:c.cookie});const t0=performance.now();await until(()=>s.closed,9000);
  const elapsed=s.closed.at-t0;assert(elapsed>=4500&&elapsed<7500,`timeout after ${Math.round(elapsed)}ms`);
  assert.equal(s.frames[0].code,'subscribe_timeout');assert.equal(s.closed.code,1008);assert.equal(s.closed.reason,'subscribe_timeout');
 }finally{await env.close();}
});

// Findings against T005C, recorded as measured harness behavior (SPEC-T006R-conformance-proposal, deviation handling).
test('finding_subscriber_cap_is_http_403_not_subscriber_limit_1013',{skip},async()=>{
 const env=await start('authenticated-ready');
 try{const c=await authenticate(env);const open=[];for(let i=0;i<8;i++){const s=await connect(env,{cookie:c.cookie});assert.equal(s.opened,true);open.push(s);}
  const ninth=await connect(env,{cookie:c.cookie});
  // T005C row "Subscriber cap": subscriber_limit error then close 1013. The review transport refuses the upgrade with HTTP 403.
  assert.equal(ninth.status,403);assert.equal(ninth.opened,false);
  for(const s of open)s.sock.close(1000);await until(()=>env.transport.summary().clients===0);
 }finally{await env.close();}
});

test('review_http_over_https_matches_actual_controller_contract',{skip},async()=>{
 const env=await start('success-diff'),storage=new Map(),seen=[];let state,cookie='';
 const fetch=async(path,init)=>{const headers=Object.fromEntries(new Headers(init.headers));if(cookie)headers.cookie=cookie;if(init.method!=='GET')headers.origin=env.origin;
  const r=await call(env,{method:init.method,path,headers,body:init.body??''});seen.push({method:init.method,path,r});
  if(r.headers['set-cookie'])cookie=r.headers['set-cookie'][0].split(';')[0];
  const out=new Headers();for(const[k,v]of Object.entries(r.headers))if(k!=='set-cookie')out.set(k,Array.isArray(v)?v.join(', '):v);
  return new Response(r.status===204?null:r.body,{status:r.status,headers:out});};
 const createWebSocket=url=>{assert.equal(url,env.origin.replace('https:','wss:')+api+'/session/stream');const shim={};
  const sock=new WsClient(url,{ca:tls.ca,perMessageDeflate:false,headers:{origin:env.origin,cookie}});
  sock.on('open',()=>shim.onopen?.());sock.on('message',data=>shim.onmessage?.({data:data.toString()}));sock.on('error',()=>shim.onerror?.());sock.on('close',(code,reason)=>shim.onclose?.({code,reason:reason.toString()}));
  shim.send=raw=>sock.send(raw);shim.close=(code,reason)=>sock.close(code,reason);return shim;};
 const controller=createP0Controller({location:{origin:env.origin},randomUUID,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout,clearTimeout,AbortController,TextEncoder,TextDecoder,publish:s=>state=s,fetch,createWebSocket});
 try{
  await controller.load();assert.equal(state.authenticated,false);assert.equal(env.fixture.summary().effects,0);
  assert.equal(await controller.authenticate(bearer),true);assert.equal(state.authenticated,true);assert.equal(state.login,'logged_in');
  await until(()=>state.connection==='connected');
  assert.equal(await controller.submitPrompt('Synthetic 中文 prompt'),true);env.fixture.complete();await controller.refresh();
  assert.equal(await controller.showDiff(),true);assert.match(state.diff,/<script>/);
  const before=env.fixture.summary().effects;await controller.refresh();assert.equal(env.fixture.summary().effects,before);
  assert.equal(await controller.logout(),true);assert.equal(state.authenticated,false);assert.equal(storage.size,0);
  for(const{method,path,r}of seen){const label=method+' '+path+' '+r.status;
   assert.equal(r.headers['cache-control'],'no-store',label);assert.equal(r.headers['x-content-type-options'],'nosniff',label);
   if(r.status===204){assert.equal(r.body.length,0,label);continue;}
   assert.equal(Number(r.headers['content-length']),r.body.length,label);assert.equal(r.headers['transfer-encoding'],undefined,label);
   assert.equal(r.headers['content-type'],path===api+'/session/diff'&&r.status===200?'text/plain; charset=utf-8':'application/json',label);}
  assert(seen.length>=8);assert(!seen.some(({r})=>r.body.includes(bearer)));
 }finally{controller.dispose();await env.close();}
});

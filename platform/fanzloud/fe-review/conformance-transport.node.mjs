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
// SPEC-T005C fixed application error messages.
const MESSAGES={authentication_expired:'operator authentication expired',subscribe_timeout:'subscription was not received before its deadline',protocol_error:'WebSocket application frame is invalid',unsupported_version:'WebSocket protocol version is unsupported',wrong_session:'session identity changed; refresh before reconnect',future_cursor:'requested session cursor is in the future'};
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
async function start(scenario,{key=tls.key,cert=tls.cert,historyCapacity,limits}={}){
 const port=await freePort(),origin=`https://127.0.0.1:${port}`;let now=1000;
 const fixture=createFixture({origin,scenario,bearer,now:()=>now,...(historyCapacity?{historyCapacity}:{})});
 const transport=createTransport({origin,fixture,key,cert,WebSocketServer:WsServer,...(limits?{limits}:{})});await transport.listen();
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
  assert(plain==='refused'||plain===400,`plain HTTP got ${plain}`);
 }finally{await env.close();}
 const wrong=await start('authenticated-ready',{key:tls.wrongKey,cert:tls.wrongCert});
 try{await assert.rejects(call(wrong,{path:'/'}),e=>e.code==='ERR_TLS_CERT_ALTNAME_INVALID');}finally{await wrong.close();}
});

test('review_wss_upgrade_requires_exact_origin_and_accepts_valid_cookie',{skip},async()=>{
 const env=await start('authenticated-ready');
 try{const c=await authenticate(env);
  // T005C P-005C-02: Origin mismatch is HTTP 403.
  assert.equal((await connect(env,{cookie:c.cookie,origin:'https://127.0.0.1:1'})).status,403);
  const good=await connect(env,{cookie:c.cookie});assert.equal(good.opened,true);
  assert.equal(env.transport.summary().rejectedUpgrades,1);good.sock.close(1000);await until(()=>good.closed);
 }finally{await env.close();}
});

// SPEC-T006R-harness-repair-c2 H01: upgrade refusals follow the product order with the T005B safe JSON envelope.
const REFUSALS={invalid_request:'request schema is invalid',not_found:'route not found',method_not_allowed:'method not allowed',authentication_required:'operator authentication is required',origin_forbidden:'request origin is not allowed',service_unavailable:'control-plane service is unavailable',websocket_upgrade_required:'a version-13 WebSocket upgrade is required'};
function rawStream(env,{method='GET',path=api+'/session/stream',headers={},upgrade=true}={}){
 const base=upgrade?{connection:'Upgrade',upgrade:'websocket','sec-websocket-version':'13','sec-websocket-key':Buffer.alloc(16,1).toString('base64')}:{};
 const merged=Array.isArray(headers)?[...Object.entries(base).flat(),...headers]:{...base,...headers};
 return new Promise((resolve,reject)=>{const req=httpsRequest({host:'127.0.0.1',port:env.port,method,path,ca:tls.ca,headers:merged});req.on('response',res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('upgrade',(res,socket)=>{socket.destroy();resolve({status:101,headers:res.headers,body:Buffer.alloc(0)});});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('REVIEW_HTTP_TIMEOUT')));req.end();});
}
function assertRefusal(r,status,code,label){
 assert.equal(r.status,status,label);assert.equal(r.headers['content-type'],'application/json',label);assert.equal(r.headers['cache-control'],'no-store',label);assert.equal(r.headers['x-content-type-options'],'nosniff',label);
 assert.equal(Number(r.headers['content-length']),r.body.length,label);assert.deepEqual(JSON.parse(r.body),{error:{code,message:REFUSALS[code]}},label);
}
test('review_wss_upgrade_refusals_are_safe_json_in_product_order',{skip},async()=>{
 const env=await start('authenticated-ready');
 try{const c=await authenticate(env),ok={cookie:c.cookie,origin:env.origin};
  assertRefusal(await rawStream(env,{headers:['cookie',c.cookie,'cookie',c.cookie,'origin',env.origin]}),400,'invalid_request','duplicate cookie');
  assertRefusal(await rawStream(env,{path:api+'/session/streams'}),404,'not_found','unknown path without cookie');
  assertRefusal(await rawStream(env,{method:'POST',headers:ok}),405,'method_not_allowed','POST');
  assertRefusal(await rawStream(env,{headers:{'x-review-pad':'a'.repeat(257)}}),422,'invalid_request','long header without cookie');
  assertRefusal(await rawStream(env,{headers:{origin:env.origin}}),401,'authentication_required','missing cookie');
  assertRefusal(await rawStream(env,{headers:{cookie:'__Host-codebox_p0='+'A'.repeat(43),origin:env.origin}}),401,'authentication_required','unknown cookie');
  assertRefusal(await rawStream(env,{upgrade:false}),401,'authentication_required','plain GET without cookie');
  assertRefusal(await rawStream(env,{headers:{cookie:c.cookie,origin:'https://127.0.0.1:1'}}),403,'origin_forbidden','wrong origin');
  for(const[label,args]of[['version 8',{headers:{...ok,'sec-websocket-version':'8'}}],['short key',{headers:{...ok,'sec-websocket-key':Buffer.alloc(8,1).toString('base64')}}],['plain GET',{upgrade:false,headers:ok}]]){
   const r=await rawStream(env,args);assertRefusal(r,426,'websocket_upgrade_required',label);assert.equal(r.headers.upgrade,'websocket',label);assert.equal(r.headers['sec-websocket-version'],'13',label);}
  assert.equal((await rawStream(env,{headers:ok})).status,101);
  env.advance(300001);assertRefusal(await rawStream(env,{headers:ok}),401,'authentication_required','expired cookie');env.advance(-300001);
  assert.deepEqual(mutations(env.fixture),{'POST /api/p0/v1/operator/session':1});
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
   assert.equal(frame.type,'error');assert.equal(frame.message,MESSAGES[expected.code],expected.code);for(const[k,v]of Object.entries(expected))assert.equal(frame[k],v,expected.code+' '+k);
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
  const exact=subscribeFrame(sid).replace('{','{'+' '.repeat(1024-Buffer.byteLength(subscribeFrame(sid))));assert.equal(Buffer.byteLength(exact),1024);
  const limit=await connect(env,{cookie:c.cookie});limit.sock.send(exact);await until(()=>limit.frames.some(f=>f.type==='replay_end'));assert.equal(limit.frames[0].type,'replay_begin');limit.sock.close(1000);await until(()=>limit.closed);
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
  await until(()=>a.s.closed);assert(a.s.closed.at-t0<400,`logout close took ${Math.round(a.s.closed.at-t0)}ms`);
  assert.equal(a.s.frames.at(-1).code,'authentication_expired');assert.equal(a.s.frames.at(-1).message,MESSAGES.authentication_expired);assert.equal(a.s.closed.code,1008);
  const b=await subscribed();const t1=performance.now();env.advance(300001);
  await until(()=>b.s.closed);assert(b.s.closed.at-t1<400,`expiry close took ${Math.round(b.s.closed.at-t1)}ms`);
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
  assert.equal(s.frames[0].code,'subscribe_timeout');assert.equal(s.frames[0].message,MESSAGES.subscribe_timeout);assert.equal(s.closed.code,1008);assert.equal(s.closed.reason,'subscribe_timeout');
 }finally{await env.close();}
});

// SPEC-T006R-harness-repair-c2 H01 row 6: over 32 open sockets is 503, checked before Origin.
test('review_wss_socket_bound_is_503_before_origin',{skip},async()=>{
 const env=await start('authenticated-ready');
 try{const c=await authenticate(env);const open=[];for(let i=0;i<32;i++){const s=await connect(env,{cookie:c.cookie});assert.equal(s.opened,true);open.push(s);}
  assertRefusal(await rawStream(env,{headers:{cookie:c.cookie,origin:'https://127.0.0.1:1'}}),503,'service_unavailable','33rd socket with a wrong Origin');
  open[0].sock.close(1000);await until(()=>open[0].closed&&env.transport.summary().clients===31);assertRefusal(await rawStream(env,{headers:{cookie:c.cookie,origin:'https://127.0.0.1:1'}}),403,'origin_forbidden','below the bound');
  for(const s of open.slice(1))s.sock.close(1000);await until(()=>env.transport.summary().clients===0);
 }finally{await env.close();}
});

// SPEC-T006R-harness-repair-c2 H05: a live event right after the 1012 shutdown close does not tear the socket down.
test('review_wss_shutdown_close_stays_graceful_under_live_events',{skip},async()=>{
 const env=await start('authenticated-ready');
 try{const c=await authenticate(env),sid=await sessionId(env,c),other=await authenticate(env);const s=await connect(env,{cookie:c.cookie});s.sock.send(subscribeFrame(sid));await until(()=>s.frames.some(f=>f.type==='replay_end'));
  env.transport.holdReconnect(50);await call(env,{method:'POST',path:api+'/session/turns',headers:mutationHeaders(env,other,{'content-type':'application/json'}),body:'{"prompt":"Synthetic"}'});
  await until(()=>s.closed);assert.equal(s.closed.code,1012);assert.equal(env.transport.summary().writeTerminations,0);await until(()=>env.transport.summary().clients===0);
 }finally{await env.close();}
});

// SPEC-T006R-harness-repair-c2 H02: the ninth admitted subscriber is a typed subscriber_limit with close 1013.
test('review_wss_subscriber_limit_is_typed_1013',{skip},async()=>{
 const env=await start('authenticated-ready');
 try{const c=await authenticate(env),sid=await sessionId(env,c);const open=[];
  for(let i=0;i<8;i++){const s=await connect(env,{cookie:c.cookie});s.sock.send(subscribeFrame(sid));await until(()=>s.frames.some(f=>f.type==='replay_end'));open.push(s);}
  const ninth=await connect(env,{cookie:c.cookie});assert.equal(ninth.opened,true);ninth.sock.send(subscribeFrame(sid));await until(()=>ninth.closed);
  assert.deepEqual(ninth.frames,[{type:'error',code:'subscriber_limit',message:'session subscriber limit reached'}]);
  assert.equal(ninth.closed.code,1013);assert.equal(ninth.closed.reason,'subscriber_limit');assert.equal(env.fixture.summary().subscribers,8);
  open[0].sock.close(1000);await until(()=>open[0].closed&&env.fixture.summary().subscribers===7);
  const again=await connect(env,{cookie:c.cookie});again.sock.send(subscribeFrame(sid));await until(()=>again.frames.some(f=>f.type==='replay_end'));open.push(again);
  for(const s of open.slice(1))s.sock.close(1000);await until(()=>env.transport.summary().clients===0&&env.fixture.summary().subscribers===0);
 }finally{await env.close();}
});

// SPEC-T006R-harness-repair-c2 H03/H04: history_gap, subscriber_lagged and stream_unavailable are reachable and typed.
async function cycles(env,c,n,{cancelFirst=false}={}){
 const post=(path,extra={},body='')=>call(env,{method:'POST',path,headers:mutationHeaders(env,c,extra),body});
 if(cancelFirst)assert.equal((await post(api+'/session/cancel')).status,200);
 for(let i=0;i<n;i++){assert.equal((await post(api+'/session/turns',{'content-type':'application/json'},'{"prompt":"Synthetic"}')).status,202);assert.equal((await post(api+'/session/cancel')).status,200);}
}
test('review_wss_history_gap_lag_and_unavailable_are_typed_1013_or_1008',{skip},async()=>{
 const port=await freePort(),origin=`https://127.0.0.1:${port}`,fixture=createFixture({origin,scenario:'authenticated-ready',bearer});
 for(const limits of [{unknown:1},{liveCapacity:7},{liveCapacity:257},{serverMessageBytes:255},{serverMessageBytes:65537},{liveCapacity:8.5}])assert.throws(()=>createTransport({origin,fixture,key:tls.key,cert:tls.cert,WebSocketServer:WsServer,limits}),/REVIEW_LIMITS/,JSON.stringify(limits));
 for(const historyCapacity of [63,1025,64.5,'64'])assert.throws(()=>createFixture({origin,scenario:'authenticated-ready',bearer,historyCapacity}),/REVIEW_LIMITS/,String(historyCapacity));
 createTransport({origin,fixture,key:tls.key,cert:tls.cert,WebSocketServer:WsServer,limits:null});
 fixture.dispose();
 const gap=await start('authenticated-ready',{historyCapacity:64});
 try{const c=await authenticate(gap),sid=await sessionId(gap,c);await cycles(gap,c,17);assert.equal(gap.fixture.summary().sequence,68);const before=mutations(gap.fixture);
  const s=await connect(gap,{cookie:c.cookie});s.sock.send(subscribeFrame(sid,3));await until(()=>s.closed);
  assert.deepEqual(s.frames,[{type:'error',code:'history_gap',message:'requested session history is no longer retained',oldest_available:5,latest_available:68}]);assert.equal(s.closed.code,1008);assert.equal(s.closed.reason,'history_gap');
  const kept=await connect(gap,{cookie:c.cookie});kept.sock.send(subscribeFrame(sid,4));await until(()=>kept.frames.some(f=>f.type==='replay_end'));assert.equal(kept.frames.filter(f=>f.type==='event').length,64);kept.sock.close(1000);
  assert.deepEqual(mutations(gap.fixture),before);await until(()=>gap.transport.summary().clients===0);
 }finally{await gap.close();}
 const lag=await start('authenticated-ready',{limits:{liveCapacity:9}});
 try{const c=await authenticate(lag),sid=await sessionId(lag,c);const s=await connect(lag,{cookie:c.cookie});s.sock.send(subscribeFrame(sid));await until(()=>s.frames.some(f=>f.type==='replay_end'));const replayed=s.frames.length;
  lag.transport.stallLive(true);await cycles(lag,c,2);await new Promise(r=>setTimeout(r,50));assert.equal(s.closed,null,'eight queued frames stay within the live capacity of nine');
  await call(lag,{method:'POST',path:api+'/session/turns',headers:mutationHeaders(lag,c,{'content-type':'application/json'}),body:'{"prompt":"Synthetic"}'});await until(()=>s.closed);
  assert.deepEqual(s.frames.slice(replayed),[{type:'error',code:'subscriber_lagged',message:'session subscriber fell behind'}]);assert.equal(s.closed.code,1013);assert.equal(s.closed.reason,'subscriber_lagged');
  lag.transport.stallLive(false);await until(()=>lag.transport.summary().clients===0&&lag.fixture.summary().subscribers===0);
 }finally{await lag.close();}
 // The ninth queued frame fits (the 9th of 10 from the last POST) and only the tenth trips the lag, so the bound is exact.
 const resume=await start('authenticated-ready');
 try{const c=await authenticate(resume),sid=await sessionId(resume,c);const s=await connect(resume,{cookie:c.cookie});s.sock.send(subscribeFrame(sid));await until(()=>s.frames.some(f=>f.type==='replay_end'));const replayed=s.frames.length;
  resume.transport.stallLive(true);await cycles(resume,c,1);await new Promise(r=>setTimeout(r,100));assert.equal(s.frames.length,replayed,'a stalled queue delivers nothing');
  resume.transport.stallLive(false);await until(()=>s.frames.length===replayed+4);assert.deepEqual(s.frames.slice(replayed).map(f=>f.envelope.seq),[1,2,3,4]);assert.equal(s.closed,null);s.sock.close(1000);await until(()=>resume.transport.summary().clients===0);
 }finally{await resume.close();}
 const live=await start('authenticated-ready',{limits:{serverMessageBytes:256}});
 try{const c=await authenticate(live),sid=await sessionId(live,c);const s=await connect(live,{cookie:c.cookie});s.sock.send(subscribeFrame(sid));await until(()=>s.frames.some(f=>f.type==='replay_end'));const replayed=s.frames.length;
  await call(live,{method:'POST',path:api+'/session/turns',headers:mutationHeaders(live,c,{'content-type':'application/json'}),body:'{"prompt":"Synthetic"}'});await until(()=>s.closed);
  assert.deepEqual(s.frames.slice(replayed).map(f=>f.type==='event'?f.envelope.seq:f.code),[1,'stream_unavailable'],'the 192-byte event goes out; the 301-byte live frame is over the bound');assert.equal(s.closed.code,1013);assert.equal(s.closed.reason,'stream_unavailable');
 }finally{await live.close();}
 const big=await start('turn-busy',{limits:{serverMessageBytes:256}});
 try{const c=await authenticate(big),sid=await sessionId(big,c);assert.equal((await call(big,{method:'POST',path:api+'/session/turns',headers:mutationHeaders(big,c,{'content-type':'application/json'}),body:'{"prompt":"Synthetic"}'})).status,202);
  const s=await connect(big,{cookie:c.cookie});s.sock.send(subscribeFrame(sid));await until(()=>s.closed);
  assert.deepEqual(s.frames,[{type:'error',code:'stream_unavailable',message:'session stream is unavailable'}]);assert.equal(s.closed.code,1013);assert.equal(s.closed.reason,'stream_unavailable');
  await until(()=>big.transport.summary().clients===0&&big.fixture.summary().subscribers===0);
 }finally{await big.close();}
});

// The actual controller over the real HTTPS/WSS transport; frames are reduced to type, code and numeric fields.
function controllerOver(env){const storage=new Map(),seen=[],frames=[];let state,cookie='';
 const fetch=async(path,init)=>{const headers=Object.fromEntries(new Headers(init.headers));if(cookie)headers.cookie=cookie;if(init.method!=='GET')headers.origin=env.origin;
  const r=await call(env,{method:init.method,path,headers,body:init.body??''});seen.push({method:init.method,path,r});
  if(r.headers['set-cookie']){const sc=r.headers['set-cookie'][0];cookie=/;\s*Max-Age=0(;|$)/.test(sc)?'':sc.split(';')[0];}
  const out=new Headers();for(const[k,v]of Object.entries(r.headers))if(k!=='set-cookie')out.set(k,Array.isArray(v)?v.join(', '):v);
  return new Response(r.status===204?null:r.body,{status:r.status,headers:out});};
 const reduce=(dir,text)=>{const f=JSON.parse(text);frames.push({dir,type:f.type,...(f.code?{code:f.code}:{}),...Object.fromEntries(['after_seq','oldest_available','latest_available'].filter(k=>k in f).map(k=>[k,f[k]]))});};
 const createWebSocket=url=>{assert.equal(url,env.origin.replace('https:','wss:')+api+'/session/stream');const shim={};
  const sock=new WsClient(url,{ca:tls.ca,perMessageDeflate:false,headers:{origin:env.origin,cookie}});
  sock.on('open',()=>shim.onopen?.());sock.on('message',data=>{reduce('received',data.toString());shim.onmessage?.({data:data.toString()});});sock.on('error',()=>shim.onerror?.());sock.on('close',(code,reason)=>shim.onclose?.({code,reason:reason.toString()}));
  shim.send=raw=>{reduce('sent',raw);sock.send(raw);};shim.close=(code,reason)=>sock.close(code,reason);return shim;};
 const controller=createP0Controller({location:{origin:env.origin},randomUUID,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout,clearTimeout,AbortController,TextEncoder,TextDecoder,publish:s=>state=s,fetch,createWebSocket});
 return {controller,seen,frames,storage,state:()=>state,cookie:()=>cookie};
}

// SPEC-T006R-harness-repair-c2 C202.2 rehearsed without a browser: the exact R06 schedule against the actual controller.
test('review_r06_gap_after_restart_resubscribes_at_snapshot_without_resend',{skip,timeout:20000},async()=>{
 const env=await start('authenticated-ready',{historyCapacity:64}),client=controllerOver(env);
 try{await client.controller.load();assert.equal(await client.controller.authenticate(bearer),true);await until(()=>client.state().connection==='connected');
  assert.equal(await client.controller.submitPrompt('Synthetic R06 prompt'),true);await until(()=>[...client.storage.values()].some(v=>JSON.parse(v).event_seq===2));
  const mark=client.seen.length,other=await authenticate(env);env.transport.holdReconnect(5000);const t0=performance.now();
  await call(env,{method:'POST',path:api+'/session/cancel',headers:mutationHeaders(env,other)});await cycles(env,other,16);
  assert(performance.now()-t0<4000,'gap setup within the reconnect hold');assert.equal(env.fixture.summary().sequence,68);
  await until(()=>{const i=client.frames.findIndex(f=>f.code==='history_gap');return i>=0&&client.frames.slice(i+1).some(f=>f.type==='replay_end');},12000);await until(()=>client.state().connection==='connected');
  await client.controller.refresh();
  const gaps=client.frames.filter(f=>f.code==='history_gap');assert.deepEqual(gaps,[{dir:'received',type:'error',code:'history_gap',oldest_available:5,latest_available:68}]);
  const i=client.frames.indexOf(gaps[0]);assert.equal(client.frames.slice(0,i).filter(f=>f.type==='subscribe').at(-1).after_seq,2);assert.equal(client.frames.slice(i+1).find(f=>f.type==='subscribe').after_seq,68);
  assert.deepEqual(client.seen.slice(mark).map(x=>x.method).filter(m=>m!=='GET'),[]);assert.equal(client.seen.filter(x=>x.method==='POST'&&x.path===api+'/session/turns').length,1);
  assert.equal(env.fixture.summary().counts['POST '+api+'/session/turns'],17);
 }finally{client.controller.dispose();await env.close();}
});

test('review_http_over_https_matches_actual_controller_contract',{skip},async()=>{
 const env=await start('success-diff'),storage=new Map(),seen=[];let state,cookie='';
 const fetch=async(path,init)=>{const headers=Object.fromEntries(new Headers(init.headers));if(cookie)headers.cookie=cookie;if(init.method!=='GET')headers.origin=env.origin;
  const r=await call(env,{method:init.method,path,headers,body:init.body??''});seen.push({method:init.method,path,r});
  if(r.headers['set-cookie']){const sc=r.headers['set-cookie'][0];cookie=/;\s*Max-Age=0(;|$)/.test(sc)?'':sc.split(';')[0];}
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
  const issued=seen.find(x=>x.method==='POST'&&x.path===api+'/operator/session').r.headers['set-cookie'][0];
  assert.match(issued,/^__Host-codebox_p0=[A-Za-z0-9_-]{43}; Secure; HttpOnly; SameSite=Strict; Path=\/; Max-Age=300$/);
  const cleared=seen.find(x=>x.method==='DELETE'&&x.path===api+'/operator/session').r.headers['set-cookie'][0];
  assert.match(cleared,/^__Host-codebox_p0=; Secure; HttpOnly; SameSite=Strict; Path=\/; Max-Age=0$/);assert.equal(cookie,'');
  const diff=seen.find(x=>x.path===api+'/session/diff'&&x.r.status===200).r.headers;
  assert.equal(diff['content-security-policy'],"default-src 'none'; sandbox");assert.equal(diff['content-disposition'],'inline');
  assert(seen.length>=8);assert(!seen.some(({r})=>r.body.includes(bearer)));
 }finally{controller.dispose();await env.close();}
});

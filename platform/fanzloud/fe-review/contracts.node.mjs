import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createP0Controller} from '../apps/control-plane/web/p0-client.js';
import {createFixture,fixedAssets} from './fixture.mjs';
const origin='https://127.0.0.1:8443', bearer='synthetic-review-bootstrap-canary-0001';
const factory=(scenario='authenticated-ready')=>createFixture({origin,scenario,bearer});
function auth(f){const r=f.request({method:'POST',path:'/api/p0/v1/operator/session',headers:{origin,authorization:'Bearer '+bearer},body:''});assert.equal(r.status,201);return {cookie:r.headers['set-cookie'].split(';')[0], 'codebox-instance-id':JSON.parse(r.body).instance_id};}
const mutation=(credentials,key=randomUUID())=>({...credentials,origin,'idempotency-key':key});
test('review_exact_assets_and_unknown_routes_fail_closed',()=>{
 const f=factory(),assets=fixedAssets();assert.equal(assets.size,4);assert.match(assets.get('/').body.toString(),/<title>Codebox operator/);
 assert.equal(f.request({method:'GET',path:'/unknown',headers:{},body:''}).status,404);
 assert.throws(()=>createFixture({origin:'https://external.invalid',scenario:'authenticated-ready',bearer}),/REVIEW_ORIGIN/);
 assert.throws(()=>createFixture({origin,scenario:'unknown',bearer}),/REVIEW_SCENARIO/);
 assert.equal(f.summary().effects,0);
});
test('review_http_fixtures_match_actual_controller_contract',async()=>{
 const f=factory('success-diff'),storage=new Map(),sockets=[];let state,cookie='';
 const controller=createP0Controller({location:{origin},randomUUID,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout,clearTimeout,AbortController,TextEncoder,TextDecoder,publish:s=>state=s,
 fetch:async(path,init)=>{const headers=Object.fromEntries(new Headers(init.headers));if(cookie)headers.cookie=cookie;if(init.method!=='GET')headers.origin=origin;const r=f.request({method:init.method,path,headers,body:init.body??''});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];return new Response(r.status===204?null:r.body,{status:r.status,headers:r.headers});},
 createWebSocket:url=>{assert.equal(url,origin.replace('https:','wss:')+'/api/p0/v1/session/stream');const sock={close(){},send(raw){for(const frame of f.subscribe(raw))this.onmessage?.({data:JSON.stringify(frame)});}};sockets.push(sock);queueMicrotask(()=>sock.onopen?.());return sock;}});
 try{await controller.load();assert.equal(state.authenticated,false);assert.equal(f.summary().effects,0);assert.equal(await controller.authenticate(bearer),true);assert.equal(state.authenticated,true);assert.equal(state.login,'logged_in');assert.equal(state.connection,'connected');assert.equal(await controller.submitPrompt('Synthetic 中文 prompt'),true);f.complete();await controller.refresh();assert.equal(await controller.showDiff(),true);assert.match(state.diff,/<script>/);const before=f.summary().effects;await controller.refresh();assert.equal(f.summary().effects,before);assert.equal(await controller.logout(),true);assert.equal(state.authenticated,false);assert.equal(storage.size,0);assert(!JSON.stringify(f.summary()).includes(bearer));}finally{controller.dispose();}
});
test('review_explicit_actions_are_the_only_mutations',()=>{
 const f=factory('turn-busy'),c=auth(f),key=randomUUID(),headers={...mutation(c,key),'content-type':'application/json'};
 const req={method:'POST',path:'/api/p0/v1/session/turns',headers,body:JSON.stringify({prompt:'Synthetic'})};
 const first=f.request(req);assert.equal(first.status,202);assert.deepEqual(f.request(req),first);assert.equal(f.summary().turnStarts,1);
 assert.equal(f.request({...req,body:JSON.stringify({prompt:'Different'})}).status,409);assert.equal(f.summary().turnStarts,1);
 assert.equal(f.request({...req,headers:{...headers,origin:'https://evil.invalid','idempotency-key':randomUUID()}}).status,403);
 assert.equal(f.request({...req,headers:{...headers,'codebox-instance-id':randomUUID(),'idempotency-key':randomUUID()}}).status,409);
 assert.equal(f.summary().turnStarts,1);
});
test('review_replay_live_bounds_and_invalid_frames_fail_closed',()=>{
 const f=factory('turn-busy'),c=auth(f);f.request({method:'POST',path:'/api/p0/v1/session/turns',headers:{...mutation(c),'content-type':'application/json'},body:'{"prompt":"Synthetic"}'});
 const snapshot=JSON.parse(f.request({method:'GET',path:'/api/p0/v1/session',headers:c,body:''}).body);
 const base={type:'subscribe',protocol_version:1,session_id:snapshot.identity.session_id,after_seq:0};
 const frames=f.subscribe(JSON.stringify(base));assert.deepEqual(frames.map(x=>x.type),['replay_begin','event','event','snapshot','replay_end']);assert.deepEqual(frames.filter(x=>x.type==='event').map(x=>x.envelope.seq),[1,2]);
 for(const input of [JSON.stringify({...base,extra:true}),JSON.stringify({...base,session_id:randomUUID()}),'{', JSON.stringify(base).replace('{','{"type":"subscribe",'), 'x'.repeat(1025)])assert.equal(f.subscribe(input)[0].type,'error');
 assert.equal(f.subscribe(JSON.stringify({...base,after_seq:999}))[0].code,'future_cursor');assert.equal(f.summary().turnStarts,1);
});
test('review_request_bounds_cookie_and_exact_errors',()=>{
 const f=factory(),c=auth(f),path='/api/p0/v1/session/turns',headers={...mutation(c),'content-type':'application/json'};
 assert.equal(f.request({method:'POST',path,headers,body:'{"prompt":"a","prompt":"b"}'}).status,422);
 assert.equal(f.request({method:'POST',path,headers,body:'{"prompt":"-"}'}).status,422);
 assert.equal(f.request({method:'POST',path,headers,body:JSON.stringify({prompt:'中'.repeat(11000)})}).status,422);
 assert.equal(f.request({method:'POST',path,headers,body:'x'.repeat(40961)}).status,413);
 assert.equal(f.request({method:'GET',path:'/api/p0/v1/session',headers:{cookie:c.cookie+'; '+c.cookie},body:''}).status,401);
 assert.equal(f.summary().turnStarts,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createP0Controller} from '../apps/control-plane/web/p0-client.js';
import {createFixture} from './fixture.mjs';

// SPEC-T006R-conformance-proposal C1-d (R06): gap, restart, timeout and refresh never resend a mutation.
const origin='https://127.0.0.1:8443',bearer='synthetic-review-bootstrap-canary-0001';
const until=async(check,ms=3000)=>{const end=performance.now()+ms;while(!check()){if(performance.now()>end)throw Error('REVIEW_WAIT_TIMEOUT');await new Promise(r=>setTimeout(r,5));}};

function harness(scenario='turn-busy'){
 const f=createFixture({origin,scenario,bearer}),storage=new Map(),log=[],sockets=[];let state,cookie='',holdTurns=false;
 // HTTP timeout (15 s) fires after 20 ms; other timers keep their real delay.
 const fastTimer=(fn,ms)=>setTimeout(fn,ms===15000?20:ms);
 const controller=createP0Controller({location:{origin},randomUUID,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout:fastTimer,clearTimeout,AbortController,TextEncoder,TextDecoder,publish:s=>state=s,
  fetch:(path,init)=>{log.push(init.method+' '+path);
   if(holdTurns&&path==='/api/p0/v1/session/turns')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
   const headers=Object.fromEntries(new Headers(init.headers));if(cookie)headers.cookie=cookie;if(init.method!=='GET')headers.origin=origin;
   const r=f.request({method:init.method,path,headers,body:init.body??''});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'].split(';')[0];
   return Promise.resolve(new Response(r.status===204?null:r.body,{status:r.status,headers:r.headers}));},
  createWebSocket:()=>{const sock={closed:false,close(code=1000,reason=''){if(this.closed)return;this.closed=true;queueMicrotask(()=>this.onclose?.({code,reason}));},send(raw){log.push('WS subscribe');for(const frame of f.subscribe(raw))this.onmessage?.({data:JSON.stringify(frame)});}};sockets.push(sock);queueMicrotask(()=>sock.onopen?.());return sock;}});
 const mutations=()=>log.filter(x=>!x.startsWith('GET ')&&x!=='WS subscribe');
 return {f,controller,log,sockets,mutations,state:()=>state,hold:v=>{holdTurns=v;},inject:frame=>sockets.at(-1).onmessage?.({data:JSON.stringify(frame)})};
}
async function ready(h){await h.controller.load();assert.equal(await h.controller.authenticate(bearer),true);await until(()=>h.state().connection==='connected');}
const onlyReads=entries=>entries.every(x=>x.startsWith('GET ')||x==='WS subscribe');

test('review_gap_restart_timeout_and_refresh_preserve_no_resend',async()=>{
 // Gap: an envelope beyond lastSeq+1 is not shown; the client resyncs with reads only.
 {const h=harness();try{await ready(h);assert.equal(await h.controller.submitPrompt('Synthetic 中文 prompt'),true);await until(()=>h.state().busy===false&&h.state().connection==='connected');
  const sid=h.f.snapshot().identity.session_id,high=h.f.summary().sequence;assert(high>0);
  const real=h.f.subscribe(JSON.stringify({type:'subscribe',protocol_version:1,session_id:sid,after_seq:0})).filter(x=>x.type==='event').at(-1).envelope;
  const mark=h.log.length;
  h.inject({type:'event',envelope:{...real,seq:high+2}});
  await until(()=>h.sockets.length>=3||(h.sockets.length===2&&h.log.slice(mark).includes('WS subscribe')),4000);
  assert(onlyReads(h.log.slice(mark)),h.log.slice(mark).join());assert(!h.state().events.some(e=>e.seq===high+2));
  assert.deepEqual(h.mutations(),['POST /api/p0/v1/operator/session','POST /api/p0/v1/session/turns']);}finally{h.controller.dispose();}}
 // Restart / identity change and retention gap: stream errors resync with reads only.
 for(const frame of[{type:'error',code:'wrong_session',message:'session identity changed; refresh before reconnect'},{type:'error',code:'history_gap',message:'requested session history is no longer retained',oldest_available:2,latest_available:3}]){
  const h=harness();try{await ready(h);const mark=h.log.length;h.inject(frame);await until(()=>h.sockets.length===2,4000);
   assert(onlyReads(h.log.slice(mark)),frame.code+' '+h.log.slice(mark).join());assert.deepEqual(h.mutations(),['POST /api/p0/v1/operator/session'],frame.code);}finally{h.controller.dispose();}}
 // Timeout: a dispatched mutation with no response is ambiguous; it is never resent, and the follow-up is a read-only refresh.
 {const h=harness();try{await ready(h);h.hold(true);const mark=h.log.length;
  assert.equal(await h.controller.submitPrompt('Synthetic 中文 prompt'),false);h.hold(false);await until(()=>h.state().busy===false);
  const after=h.log.slice(mark);assert.equal(after.filter(x=>x==='POST /api/p0/v1/session/turns').length,1,after.join());assert(onlyReads(after.slice(1)),after.join());
  await new Promise(r=>setTimeout(r,300));assert.equal(h.log.filter(x=>x==='POST /api/p0/v1/session/turns').length,1);assert.equal(h.f.summary().turnStarts,0);}finally{h.controller.dispose();}}
 // Refresh: an explicit refresh issues only reads and one subscribe.
 {const h=harness();try{await ready(h);const mark=h.log.length;await h.controller.refresh();await until(()=>h.sockets.length===2);
  assert(onlyReads(h.log.slice(mark)),h.log.slice(mark).join());assert.equal(h.log.slice(mark).filter(x=>x==='WS subscribe').length,1);assert.deepEqual(h.mutations(),['POST /api/p0/v1/operator/session']);}finally{h.controller.dispose();}}
});

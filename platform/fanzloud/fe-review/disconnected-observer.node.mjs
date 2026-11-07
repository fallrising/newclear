import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createReadObserver,readVerdict,validReadBody} from './disconnected-observer.mjs';
const origin='https://127.0.0.1:8443';
const session=Buffer.from(JSON.stringify({identity:{session_id:'11111111-1111-1111-1111-111111111111',instance_id:'22222222-2222-2222-2222-222222222222'},state:'ready',current_turn:null,high_water_seq:0}));
const login=Buffer.from('{"state":"logged_in"}');
const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};
async function sample({abort=false,badBody=false,extraMutation=false}={}){
 const o=createReadObserver(origin);o.arm();
 for(const [category,body] of [['session',session],['login',login]]){
  const req={method:()=> 'GET',url:()=>origin+'/api/p0/v1/'+category};o.request(req);const res=new EventEmitter();o.server({method:'GET',path:'/api/p0/v1/'+category,output:{status:200,body:body.toString()},res});
  o.response({request:()=>req,status:()=>200,allHeaders:async()=>headers,body:async()=>badBody?Buffer.from('{}'):body});res.emit('finish');res.emit('close');o.terminal(req,abort?'ERR_ABORTED':null);
 }
 if(extraMutation)o.request({method:()=> 'POST',url:()=>origin+'/api/p0/v1/session/turns'});
 return o.finish();
}
test('exact GET schemas are bounded and reject unknown/invalid combinations',()=>{assert(validReadBody('session',session));assert(validReadBody('login',login));assert(!validReadBody('login',Buffer.from('{"state":"logged_in","extra":1}')));assert(!validReadBody('session',Buffer.from(session.toString().replace('"current_turn":null','"current_turn":{}'))));assert(!validReadBody('session',Buffer.alloc(65537)));});
test('exact matched reads require clean browser terminal and server finish',async()=>{const d=await sample();assert.equal(readVerdict(d),'PASS');assert(!JSON.stringify(d).includes('11111111'));assert(!JSON.stringify(d).includes('22222222'));});
test('body and server success never rehabilitate browser abort',async()=>{assert.equal(readVerdict(await sample({abort:true})),'OBSERVER_DISCREPANCY');});
test('missing data, body mismatch, extra mutation fail closed',async()=>{assert.equal(readVerdict({}),'FAIL');assert.equal(readVerdict(await sample({badBody:true})),'FAIL');assert.equal(readVerdict(await sample({extraMutation:true})),'FAIL');});
test('no duplicate arm, terminal or unmatched/overflow read acceptance',async()=>{const o=createReadObserver(origin);o.arm();assert.throws(()=>o.arm());for(let i=0;i<9;i++)o.request({method:()=> 'GET',url:()=>origin+'/api/p0/v1/session'});assert.equal(readVerdict(await o.finish()),'FAIL');const d=await sample();d.rows[0].terminalCount=2;assert.equal(readVerdict(d),'FAIL');});

test('duplicate per-route ordinal and unfinished or errored server cannot pass',async()=>{for(const mutate of [d=>{d.rows.push({...d.rows[0]});},d=>{d.rows[0].server.closed=false;},d=>{d.rows[0].server.finished=false;},d=>{d.rows[0].server.error='EPIPE';},d=>{d.rows[0].requestFinished=false;}]){const d=await sample();mutate(d);assert.equal(readVerdict(d),'FAIL');}});

import test from 'node:test';import assert from 'node:assert/strict';
import {runRecoveryBootstrap,selectRecoveryPhase,captureRecoveryProof} from './recovery-formal.mjs';
import {createActionGuard} from './remaining-support.mjs';
const fixture={effects:1,turnStarts:0,counts:{'POST /api/p0/v1/operator/session':1,'GET /api/p0/v1/session':2,'GET /api/p0/v1/login':1}};
const bootstrap={settled:true,sameRequest:true,correlation:'UNIQUE_METHOD_PATH_ORDINAL',browserRequests:1,serverResponses:1,browserMutations:1,serverMutations:1,status:201,server:{status:201,finished:true,closeBeforeFinish:false,error:'NONE'},bodyOutcome:'EXACT_SCHEMA_AND_FIXTURE_MATCH',headers:{json:true,noStore:true,nosniff:true,contentEncodingAbsent:true,contentLengthPresent:false},requestFinished:true,requestFailed:false,ui:{idle:true,authenticated:true,connected:true,bearerEmpty:true,promptEmpty:true,errorCode:'EMPTY',pendingReads:0},fixture,health:[{expected:true}]};
const pair=()=>({armed:true,observerSettled:true,overflow:false,unmatched:false,extraMutations:0,authenticationMutations:1,rows:['session','login'].map(category=>({category,ordinal:1,browserCount:1,serverCount:1,sameRequest:true,correlation:'UNIQUE_METHOD_PATH_ORDINAL',status:200,bodyOutcome:'EXACT_SCHEMA_AND_FIXTURE_MATCH',bodyReadOutcome:'FULFILLED',headers:{json:true,noStore:true,nosniff:true,contentEncodingAbsent:true,contentLengthPresent:false},requestFinished:true,requestFailed:false,terminalCount:1,failureCode:null,server:{status:200,finished:true,closed:true,closeBeforeFinish:false,error:'NONE'}}))});
function setup({proof=pair(),finish,diagnostic=structuredClone(bootstrap),health=[{expected:true}],summary=structuredClone(fixture)}={}){
 const row={manualActions:[]},guard=createActionGuard('recovery-required',row.manualActions);let arms=0,actions=0,drains=0;
 const options={row,guard,readObserver:{arm(){arms++;},async finish(){drains++;return finish?finish():proof;}},timeline:{now:()=>3,snapshot:()=>({invalid:false,overflow:false,events:['session','login'].map((category,i)=>({event:'BODY_END',category,outcome:'FULFILLED',timeMs:i+1}))})},getHealth:()=>health,getFixture:()=>summary,life:{check(){}},authenticate:()=>guard.run('authenticate',async()=>{actions++;assert.equal(arms,1,'observer must be armed before action');}),observeBootstrap:async()=>diagnostic};
 return {row,options,counts:()=>({arms,actions,drains})};
}
test('desktop recovery is the only candidate selection',()=>{assert.deepEqual(selectRecoveryPhase(['desktop-recovery']).states,['recovery-required']);for(const args of [[],['tablet'],['mobile'],['desktop-recovery','--retry']])assert.throws(()=>selectRecoveryPhase(args));});
test('asynchronous exact GET proof must block next stage',async()=>{
 let release;const body=new Promise(r=>release=r),s=setup({finish:()=>body});let advanced=false;const running=runRecoveryBootstrap(s.options).then(()=>{advanced=true;});await new Promise(r=>setImmediate(r));assert.equal(advanced,false);release(pair());await running;assert.equal(advanced,true);assert.equal(s.row.recoveryGatePassed,true);assert.deepEqual(s.counts(),{arms:1,actions:1,drains:1});
});
test('strict original bootstrap health failure preserves pair evidence and original error',async()=>{
 const d=structuredClone(bootstrap);d.health.push({kind:'requestfailed',expected:false});const s=setup({diagnostic:d});await assert.rejects(runRecoveryBootstrap(s.options),{message:'REVIEW_BOOTSTRAP_DIAGNOSTIC'});assert.equal(s.row.recoveryGetObservation.rows.length,2);assert.equal(s.row.recoveryGatePassed,false);assert.equal(s.counts().actions,1);
});
test('missing rejected deadline duplicate and failed GET stop after one action',async()=>{
 for(const change of [p=>p.rows.pop(),p=>{p.rows[0].bodyOutcome='READ_FAILED';p.rows[0].bodyReadOutcome='RESPONSE_REJECTED';},p=>{p.rows[0].bodyOutcome='READ_FAILED';p.rows[0].bodyReadOutcome='OBSERVER_DEADLINE';},p=>p.rows.push(structuredClone(p.rows[0])),p=>p.rows[0].requestFailed=true,p=>p.extraMutations=1,p=>p.authenticationMutations=2]){
  const proof=pair();change(proof);const s=setup({proof});await assert.rejects(runRecoveryBootstrap(s.options));assert.equal(s.row.recoveryGatePassed,false);assert.equal(s.counts().actions,1);assert.equal(s.counts().drains,1);
 }
});
test('late dirty health or extra fixture effect/mutation cannot advance',async()=>{
 for(const patch of [{health:[]},{health:[{expected:false}]},{summary:{...fixture,effects:2}},{summary:{...fixture,turnStarts:1}},{summary:{...fixture,counts:{...fixture.counts,'POST /api/p0/v1/session/turns':1}}}]){const s=setup(patch);await assert.rejects(runRecoveryBootstrap(s.options));assert.equal(s.row.recoveryGatePassed,false);assert.equal(s.counts().actions,1);}
});
test('failed POST or throwing original guard retains first failure despite failed observer drain',async()=>{
 for(const throwObserver of [false,true]){const s=setup({finish:throwObserver?()=>Promise.reject(Error('private observer detail')):undefined});const original=Error('REVIEW_ORIGINAL_POST_FAILURE');s.options.observeBootstrap=async()=>{throw original;};await assert.rejects(runRecoveryBootstrap(s.options),e=>e===original);assert.equal(s.counts().drains,1);assert.equal(s.counts().actions,1);assert.equal(s.row.recoveryGatePassed,false);assert(!JSON.stringify(s.row).includes('private observer detail'));}
 const d=structuredClone(bootstrap);d.status=202;const s=setup({diagnostic:d});await assert.rejects(runRecoveryBootstrap(s.options),{message:'REVIEW_BOOTSTRAP_DIAGNOSTIC'});assert.equal(s.row.recoveryGetObservation.rows.length,2);
});
test('same candidate cannot silently authenticate again after success or failure',async()=>{
 for(const proof of [pair(),{...pair(),extraMutations:1}]){const s=setup({proof});await runRecoveryBootstrap(s.options).catch(()=>{});await assert.rejects(runRecoveryBootstrap(s.options));assert.equal(s.counts().actions,1);}
});
test('body lifecycle evidence rejects timeline gap, duplicate category and ambiguous correlation',async()=>{
 for(const change of [p=>p.rows[1].category='session',p=>p.rows[0].ordinal=2,p=>p.rows[0].sameRequest=false,p=>p.rows[0].server.closed=false,p=>p.rows[0].terminalCount=2,p=>p.rows[0].headers.contentEncodingAbsent=false,p=>p.observerSettled=false]){const proof=pair();change(proof);const s=setup({proof});await assert.rejects(runRecoveryBootstrap(s.options));}
 for(const timeline of [{invalid:true,overflow:false,events:[]},{invalid:false,overflow:true,events:[]},{invalid:false,overflow:false,events:[]}]){const s=setup();s.options.timeline.snapshot=()=>timeline;await assert.rejects(runRecoveryBootstrap(s.options));}
});
test('unchanged observer actually wires one GET read each through the new gate',async()=>{
 const {EventEmitter}=await import('node:events');const {createRecoveryReadObserver,createRecoveryTimeline}=await import('./recovery-bootstrap-observer.mjs');
 const origin='https://127.0.0.1:8443',id='12345678-1234-4234-8234-123456789abc',timeline=createRecoveryTimeline(),observer=createRecoveryReadObserver(origin,timeline),s=setup();let reads=0;
 s.options.readObserver=observer;s.options.timeline=timeline;
 s.options.authenticate=()=>s.options.guard.run('authenticate',async()=>{
  observer.request({method:()=> 'POST',url:()=>origin+'/api/p0/v1/operator/session'});
  for(const category of ['session','login']){
   const request={method:()=> 'GET',url:()=>origin+'/api/p0/v1/'+category},body=Buffer.from(JSON.stringify(category==='login'?{state:'logged_in'}:{identity:{session_id:id,instance_id:id},state:'recovery_required',current_turn:{turn_id:id,projection:{phase:'cloud',lifecycle:{state:'outcome_unknown',operation_id:id},cancel_requested:false}},high_water_seq:0})),res=new EventEmitter();
   observer.request(request);observer.server({method:'GET',path:'/api/p0/v1/'+category,output:{status:200,body},res});res.emit('finish');res.emit('close');observer.response({request:()=>request,status:()=>200,allHeaders:async()=>({'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}),body:async()=>{reads++;return body;}});observer.terminal(request,null);
  }
 });
 await runRecoveryBootstrap(s.options);await captureRecoveryProof(s.options);await captureRecoveryProof(s.options);assert.equal(reads,2);assert.equal(s.row.recoveryGatePassed,true);assert.equal(s.row.recoveryGetObservation.verdict,'PASS');assert(!JSON.stringify(s.row).includes(id));
});

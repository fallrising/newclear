import test from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteD1} from '../tools/sqlite-d1.mjs';
import {handle,scheduled} from '../apps/control/worker/index.mjs';
import {sign} from '../apps/control/worker/protocol.mjs';
import {recipeRef} from '../apps/control/worker/protocol.mjs';
const T=1793059200000, stamp=t=>new Date(t).toISOString().replace('.000Z','Z');
async function fixture(){
 const DB=new SQLiteD1(),ref=await recipeRef(),secret='ab'.repeat(32),env={DB,PUBLIC_ORIGIN:'https://lab.example',AUDIENCE:'test'};
 const common={workspace_id:'ws',resource_ref:{resource_id:'node',generation:1},recipe_ref:ref,not_before:stamp(T-1000),expires_at:stamp(T+86400000),max_timeout_seconds:10,max_output_bytes:16384};
 const caps={reader:['commands:read'],scheduler:['commands:submit','node:health:read'],runner:['dispatch:claim','runs:report','runs:reconcile']};
 const keys={};for(const role of Object.keys(caps)){DB.db.prepare('INSERT INTO grants VALUES(?,1,0,?)').run(role,JSON.stringify({...common,principal_id:role,capabilities:caps[role]}));keys[role]={principal_id:role,grant_id:role,generation:1,secret_hex:secret,expires_at:common.expires_at};}
 env.MACHINE_KEYS=JSON.stringify(keys);DB.db.prepare('INSERT INTO schedules VALUES(?,1,1,?,NULL)').run('health-minute','scheduler');
 const policy={revision:1,interval_minutes:15,not_before:stamp(T),expires_at:stamp(T+3600000)};env.HEALTH_SCHEDULE=JSON.stringify(policy);let n=0;
 async function request(path='/api/health-schedule',role='reader',now=T,body){const method=body===undefined?'GET':'POST',raw=body===undefined?'':JSON.stringify(body),ts=String(now/1000),nonce=(++n).toString(16).padStart(32,'0');const sig=await sign(secret,'test',role,1,method,path,ts,nonce,raw);const r=await handle(new Request('https://lab.example'+path,{method,headers:{'content-type':'application/json','x-lab-key-id':role,'x-lab-time':ts,'x-lab-nonce':nonce,'x-lab-signature':sig},...(body===undefined?{}:{body:raw})}),env,now);return {status:r.status,data:await r.json()};}
 const count=()=>DB.db.prepare('SELECT count(*) n FROM commands').get().n;
 const fire=(due=T,now=due)=>scheduled({scheduledTime:due},env,now);
 return {DB,env,policy,request,count,fire};
}
test('schedule requires explicit valid revision-bound policy; missing/invalid configuration admits nothing',async()=>{
 for(const bad of [undefined,'{}','{"revision":1,"revision":1}',JSON.stringify({revision:1,interval_minutes:1,not_before:stamp(T),expires_at:stamp(T+3600000)}),JSON.stringify({revision:2,interval_minutes:15,not_before:stamp(T),expires_at:stamp(T+3600000)})]){
  const f=await fixture();f.env.HEALTH_SCHEDULE=bad;await f.fire();assert.equal(f.count(),0);
 }
});
test('15-minute aligned slots only, due retries dedupe, off-slot events cause no firing writes',async()=>{
 const f=await fixture();await f.fire(T+60000);assert.equal(f.count(),0);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM firings').get().n,0);
 await f.fire();await f.fire();assert.equal(f.count(),1);
 await f.fire(T+900000);assert.equal(f.count(),1);assert.equal(f.DB.db.prepare('SELECT outcome FROM firings WHERE due=?').get(T+900000).outcome,'skipped_overlap');
});
test('future, expired, overlong and near-cutoff policies cannot create a job beyond the window',async()=>{
 for(const patch of [{not_before:stamp(T+60000)},{expires_at:stamp(T)},{expires_at:stamp(T+8*86400000)},{expires_at:stamp(T+119000)}]){
  const f=await fixture();f.env.HEALTH_SCHEDULE=JSON.stringify({...f.policy,...patch});await f.fire();assert.equal(f.count(),0);
 }
});
test('misfires, revoked grants and storage rollback keep existing guarantees',async()=>{
 const f=await fixture();await f.fire(T-900000,T);assert.equal(f.count(),0);assert.equal(f.DB.db.prepare('SELECT outcome FROM firings').get().outcome,'skipped_misfire');
 const g=await fixture();g.DB.db.exec("UPDATE grants SET revoked=1 WHERE id='scheduler'");await g.fire();assert.equal(g.count(),0);
 const h=await fixture();h.DB.db.exec("CREATE TRIGGER reject_job BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT,'storage fault'); END");await assert.rejects(h.fire());assert.equal(h.DB.db.prepare('SELECT count(*) n FROM firings').get().n,0);
});
test('dispatch refuses removed policy, changed revision or cutoff while keeping reconciliation possible',async()=>{
 for(const change of [f=>delete f.env.HEALTH_SCHEDULE,f=>{f.env.HEALTH_SCHEDULE=JSON.stringify({...f.policy,revision:2});},f=>{f.env.HEALTH_SCHEDULE=JSON.stringify({...f.policy,expires_at:stamp(T+1000)});}]){
  const f=await fixture();await f.fire();change(f);const r=await f.request('/api/runner/claim','runner',T+1000,{});assert.equal(r.status,200);assert.equal(r.data.assignment,null);assert.equal(f.DB.db.prepare('SELECT active FROM commands').get().active,0);
 }
});
test('read snapshot is scoped/read-only and does not claim live Cron or runner verification',async()=>{
 const f=await fixture();const before=['commands','schedules','firings'].map(t=>f.DB.db.prepare('SELECT * FROM '+t).all());const r=await f.request();assert.equal(r.status,200);assert.equal(r.data.cron_verified,false);assert.equal(r.data.schedule.status,'ready');assert.equal(r.data.schedule.interval_minutes,15);assert.equal(r.data.schedule.next_due_at,stamp(T));assert.equal(r.data.schedule.latest_result,null);assert.deepEqual(['commands','schedules','firings'].map(t=>f.DB.db.prepare('SELECT * FROM '+t).all()),before);
 assert.equal((await f.request('/api/health-schedule','runner')).status,403);
 f.DB.db.exec("UPDATE grants SET policy=json_set(policy,'$.workspace_id','other') WHERE id='reader'");assert.equal((await f.request()).status,403);
});
test('snapshot separates skipped trigger from prior result and uses persisted firing relation',async()=>{
 const f=await fixture();await f.fire();let a=(await f.request('/api/runner/claim','runner',T,{})).data.assignment;
 const result={command_id:a.command_id,attempt_id:a.attempt.attempt_id,fence:a.attempt.fence,owner_outcome:'succeeded',started_at:stamp(T),finished_at:stamp(T+1000),artifact:JSON.stringify({status:'healthy',sample_age_seconds:0,checks:{collector:'ok'},metrics:{load_1m_milli:100,cpu_count:4,disk_free_percent:70}})};
 assert.equal((await f.request('/api/runner/report','runner',T+2000,result)).status,200);
 const out=(await f.request('/api/health-schedule','reader',T+3000)).data.schedule;assert.equal(out.last_firing.command_id,a.command_id);assert.equal(out.last_firing.outcome,'submitted');assert.equal(out.latest_result.command_id,a.command_id);assert.equal(out.next_due_at,stamp(T+900000));assert.equal(out.latest_result.artifact,undefined);
 await f.fire(T+900000);await f.fire(T+1800000);const next=(await f.request('/api/health-schedule','reader',T+1800000)).data.schedule;assert.equal(next.last_firing.outcome,'skipped_overlap');assert.equal(next.last_firing.command_id,null);assert.equal(next.latest_result.command_id,a.command_id);
});
test('disabled/expired/grant unavailable status cannot advertise a next trigger',async()=>{
 for(const mode of ['disabled','expired','grant']){
  const f=await fixture();if(mode==='disabled')f.DB.db.exec('UPDATE schedules SET enabled=0');if(mode==='expired')f.env.HEALTH_SCHEDULE=JSON.stringify({...f.policy,expires_at:stamp(T)});if(mode==='grant')f.DB.db.exec("UPDATE grants SET revoked=1 WHERE id='scheduler'");const r=await f.request();assert.equal(r.status,200);assert.equal(r.data.schedule.next_due_at,null);assert.notEqual(r.data.schedule.status,'ready');
 }
});
test('daily/hourly cadence uses UTC start minute, strict policy rejects unknown/fractional fields',async()=>{
 for(const interval of [60,1440]){const f=await fixture();const start=T+60000;f.env.HEALTH_SCHEDULE=JSON.stringify({...f.policy,interval_minutes:interval,not_before:stamp(start),expires_at:stamp(start+2*86400000)});await f.fire(start);assert.equal(f.count(),1);await f.fire(start+15*60000);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM firings').get().n,1);}
 for(const patch of [{extra:true},{interval_minutes:15.5},{not_before:stamp(T+1000)}]){const f=await fixture();f.env.HEALTH_SCHEDULE=JSON.stringify({...f.policy,...patch});await f.fire();assert.equal(f.count(),0);}
});
test('concurrent due callbacks and grant/revision changes at the write boundary cannot double-admit',async()=>{
 const f=await fixture();await Promise.all([f.fire(),f.fire()]);assert.equal(f.count(),1);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM firings').get().n,1);
 for(const sql of ["UPDATE schedules SET revision=2","UPDATE schedules SET enabled=0","UPDATE grants SET revision=2 WHERE id='scheduler'"]){const g=await fixture();const batch=g.DB.batch.bind(g.DB);g.DB.batch=async stmts=>{g.DB.db.exec(sql);return batch(stmts);};await g.fire();assert.equal(g.count(),0);}
});
test('in-flight lease refuses disabled policy but expired lease still reconciles without dispatch',async()=>{
 const f=await fixture();await f.fire();const a=(await f.request('/api/runner/claim','runner',T,{})).data.assignment;assert.equal(a.attempt.mode,'dispatch');delete f.env.HEALTH_SCHEDULE;
 assert.equal((await f.request('/api/runner/claim','runner',T+1000,{})).status,409);
 const b=(await f.request('/api/runner/claim','runner',T+16000,{})).data.assignment;assert.equal(b.command_id,a.command_id);assert.equal(b.attempt.mode,'reconcile_only');
});

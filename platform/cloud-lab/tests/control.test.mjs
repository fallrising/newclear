import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { handle, scheduled } from '../apps/control/worker/index.mjs';
import { strictJSON, digest, sign, recipeRef } from '../apps/control/worker/protocol.mjs';

class D1 {
  constructor(path=':memory:'){ this.db=new DatabaseSync(path); if (!this.db.prepare("SELECT name FROM sqlite_master WHERE name='commands'").get()) for(const name of ['0001.sql','0002.sql'])this.db.exec(readFileSync(new URL('../apps/control/migrations/'+name,import.meta.url),'utf8')); }
  prepare(sql){const db=this.db;return {bind(...params){return {async first(){return db.prepare(sql).get(...params)||null},async all(){return {results:db.prepare(sql).all(...params)}},async run(){const r=db.prepare(sql).run(...params);return {meta:{changes:r.changes}}},sql,params}},async first(){return db.prepare(sql).get()||null},async all(){return {results:db.prepare(sql).all()}},sql,params:[]};}
  async batch(stmts){this.db.exec('BEGIN');try{const out=[];for(const s of stmts){const st=this.db.prepare(s.sql);if(st.columns().length)out.push({results:st.all(...s.params)});else out.push({meta:{changes:st.run(...s.params).changes}});}this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const T=1793059200000, iso=t=>new Date(t).toISOString().replace('.000Z','Z');
const secret='ab'.repeat(32);
async function fixture(path){
 const DB=new D1(path), ref=await recipeRef();
 const env={DB,PUBLIC_ORIGIN:'https://lab.example',AUDIENCE:'lab-test',MACHINE_KEYS:JSON.stringify({bot:{principal_id:'bot',grant_id:'gb',generation:1,secret_hex:secret,expires_at:iso(T+3600000)},runner:{principal_id:'runner',grant_id:'gr',generation:1,secret_hex:'cd'.repeat(32),expires_at:iso(T+3600000)}})};
 for(const [id,principal,caps] of [['gb','bot',['commands:read','commands:submit','commands:cancel-request','node:health:read','artifact:read']],['gr','runner',['dispatch:claim','runs:report','runs:reconcile']]]){
 const g={principal_id:principal,workspace_id:'ws_test',resource_ref:{resource_id:'node_test',generation:1},recipe_ref:ref,capabilities:caps,not_before:iso(T-1000),expires_at:iso(T+3600000),max_timeout_seconds:30,max_output_bytes:16384};
 DB.db.prepare('INSERT INTO grants(id,revision,revoked,policy) VALUES(?,1,0,?)').run(id,JSON.stringify(g)); }
 env.HEALTH_SCHEDULE=JSON.stringify({revision:1,interval_minutes:15,not_before:iso(T),expires_at:iso(T+3600000)});
 let nonce=0;
 async function req(path,body,who='bot',time=T,raw){const method=body===undefined?'GET':'POST', bytes=raw??(body===undefined?'':JSON.stringify(body));const timestamp=String(Math.floor(time/1000));const n=(++nonce).toString(16).padStart(32,'0');const sig=await sign(who==='runner'?'cd'.repeat(32):secret,'lab-test',who,1,method,path,timestamp,n,bytes);const response=await handle(new Request('https://lab.example'+path,{method,headers:{'content-type':'application/json','x-lab-key-id':who,'x-lab-time':timestamp,'x-lab-nonce':n,'x-lab-signature':sig},...(method==='POST'?{body:bytes}:{})}),env,time);return {status:response.status,data:await response.json()}; }
 function command(key='key-1'){return {schema_version:'cloudlab.command.v1',schema_minor:0,workspace_id:'ws_test',resource_ref:{resource_id:'node_test',generation:1},recipe_ref:ref,parameters:{max_sample_age_seconds:30},idempotency_key:key,not_before:iso(T),dispatch_deadline:iso(T+60000),execution_deadline:iso(T+120000),timeout_seconds:10,output_budget_bytes:16384};}
 async function start(){const submit=await req('/api/commands',command());assert.equal(submit.status,202);const c=await req('/api/runner/claim',{},'runner');assert.equal(c.status,200);return c.data.assignment;}
 function result(a){return {command_id:a.command_id,attempt_id:a.attempt.attempt_id,fence:a.attempt.fence,owner_outcome:'succeeded',started_at:iso(T),finished_at:iso(T+1000),artifact:JSON.stringify({status:'healthy',sample_age_seconds:0,checks:{collector:'ok'},metrics:{load_1m_milli:100,cpu_count:4,disk_free_percent:70}})};}
 return {env,DB,req,command,start,result};
}
test('strict parser rejects ambiguity, invalid UTF8, floats, duplicate and extra nesting',()=>{for(const s of ['{"a":1,"a":2}','{"a":1.0}','{"a":NaN}','{"a":9007199254740993}','['.repeat(20)+']'.repeat(20)])assert.throws(()=>strictJSON(new TextEncoder().encode(s)));assert.throws(()=>strictJSON(new Uint8Array([255])));});
test('admission persists and byte-identical retries dedupe, changed bytes conflict',async()=>{const f=await fixture(),c=f.command();const a=await f.req('/api/commands',c);assert.equal(a.status,202);assert.equal((await f.req('/api/commands',c)).data.command.command_id,a.data.command.command_id);assert.equal((await f.req('/api/commands',{...c,parameters:{max_sample_age_seconds:20}})).status,409);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM commands').get().n,1);});
test('unknown fields, scope, bad deadlines and runner submission are rejected',async()=>{const f=await fixture();assert.equal((await f.req('/api/commands',{...f.command(),shell:'id'})).status,422);assert.equal((await f.req('/api/commands',{...f.command(),workspace_id:'other'})).status,403);assert.equal((await f.req('/api/commands',{...f.command(),timeout_seconds:true})).status,422);assert.equal((await f.req('/api/commands',f.command(),'runner')).status,403);assert.equal((await f.req('/api/commands',f.command(),'bot',T+61000)).status,422);});
test('one active command, including unknown, consumes single node capacity',async()=>{const f=await fixture();await f.start();assert.equal((await f.req('/api/commands',f.command('second'))).status,429);const r=await f.req('/api/runner/claim',{},'runner',T+16000);assert.equal(r.data.assignment.attempt.mode,'reconcile_only');assert.equal((await f.req('/api/commands',f.command('third'),'bot',T+16000)).status,429);});
test('revoked submit grant prevents dispatch; current independent reconciler still works',async()=>{const f=await fixture();await f.req('/api/commands',f.command());f.DB.db.exec("UPDATE grants SET revoked=1 WHERE id='gb'");assert.equal((await f.req('/api/runner/claim',{},'runner')).data.assignment,null);const g=await fixture(),a=await g.start();g.DB.db.exec("UPDATE grants SET revoked=1 WHERE id='gb'");const b=(await g.req('/api/runner/claim',{},'runner',T+16000)).data.assignment;assert.equal(b.command_id,a.command_id);assert.equal(b.attempt.mode,'reconcile_only');});
test('cancel before dispatch is never-started; after dispatch remains intent',async()=>{const f=await fixture();const c=(await f.req('/api/commands',f.command())).data.command;const b=await f.req(`/api/commands/${c.command_id}/cancel`,{});assert.equal(b.data.command.delivery,'cancelled_before_dispatch');assert.equal((await f.req('/api/runner/claim',{},'runner')).data.assignment,null);const g=await fixture(),a=await g.start();assert.equal((await g.req(`/api/commands/${a.command_id}/cancel`,{})).data.command.delivery,'dispatching');});
test('result validation, artifact ACL, duplicate result and conflicting terminal',async()=>{const f=await fixture(),a=await f.start(),r=f.result(a);const report=await f.req('/api/runner/report',r,'runner',T+2000);assert.equal(report.status,200);assert.equal(report.data.command.result.validation.status,'passed');assert.equal((await f.req('/api/runner/report',r,'runner',T+3000)).status,200);assert.equal((await f.req(`/api/commands/${a.command_id}/artifact`)).status,200);assert.equal((await f.req(`/api/commands/${a.command_id}/artifact`,undefined,'runner')).status,403);assert.equal((await f.req('/api/runner/report',{...r,finished_at:iso(T+2000)},'runner',T+3000)).status,409);});
test('stale fence cannot write; late terminal from current reconcile retains original times',async()=>{const f=await fixture(),a=await f.start(),old=f.result(a);const b=(await f.req('/api/runner/claim',{},'runner',T+130000)).data.assignment;assert.equal((await f.req('/api/runner/report',old,'runner',T+131000)).status,409);const r={...old,attempt_id:b.attempt.attempt_id,fence:b.attempt.fence};const out=await f.req('/api/runner/report',r,'runner',T+131000);assert.equal(out.data.command.result.late,true);assert.equal(out.data.command.result.validation.status,'incomplete');assert.equal(out.data.command.result.finished_at,old.finished_at);});
test('malformed artifact cannot turn green; validation failed still recorded',async()=>{const f=await fixture(),a=await f.start(),r=f.result(a);assert.equal((await f.req('/api/runner/report',{...r,late:false},'runner')).status,422);const out=await f.req('/api/runner/report',{...r,artifact:'{"shell":"id"}'},'runner',T+2000);assert.equal(out.status,200);assert.equal(out.data.command.result.validation.status,'failed');assert.equal(out.data.command.result.health,'unknown');});
test('unknown snapshot stays reconciling and cannot be dispatched again',async()=>{const f=await fixture(),a=await f.start();const r={...f.result(a),owner_outcome:'unknown',started_at:null,finished_at:null,artifact:null};assert.equal((await f.req('/api/runner/report',r,'runner')).data.command.delivery,'reconciling');const b=(await f.req('/api/runner/claim',{},'runner',T+16000)).data.assignment;assert.equal(b.attempt.mode,'reconcile_only');assert.equal(b.external_ref.external_id,a.external_ref.external_id);});
test('unauthenticated and wrong Origin requests fail; machine requests never serve assets',async()=>{const f=await fixture();let r=await handle(new Request('https://lab.example/api/commands'),f.env,T);assert.equal(r.status,401);assert.equal((await f.req('/')).status,403);r=await handle(new Request('https://other.example/api/commands'),f.env,T);assert.equal(r.status,403);});
test('schedule disabled by default; due retries do not create replacement after finish',async()=>{const f=await fixture();await scheduled({scheduledTime:T},f.env,T);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM commands').get().n,0);f.DB.db.prepare('INSERT INTO schedules(id,revision,enabled,grant_id,last_due) VALUES(?,1,1,?,NULL)').run('health-minute','gb');await scheduled({scheduledTime:T},f.env,T);const a=(await f.req('/api/runner/claim',{},'runner')).data.assignment;assert.ok(a);await f.req('/api/runner/report',f.result(a),'runner',T+2000);await scheduled({scheduledTime:T},f.env,T+3000);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM commands').get().n,1);});

test('valid HMAC nonce is single use; body tamper and wrong generation fail',async()=>{
 const f=await fixture(),path='/api/runner/claim',time=String(T/1000),nonce='fe'.repeat(16),body='{}';
 const signature=await sign('cd'.repeat(32),'lab-test','runner',1,'POST',path,time,nonce,body);
 const request=(bytes=body,sig=signature)=>new Request('https://lab.example'+path,{method:'POST',headers:{'content-type':'application/json','x-lab-key-id':'runner','x-lab-time':time,'x-lab-nonce':nonce,'x-lab-signature':sig},body:bytes});
 assert.equal((await handle(request('{ }'),f.env,T)).status,401);
 assert.equal((await handle(request(),f.env,T)).status,200);
 assert.equal((await handle(request(),f.env,T)).status,401);
 const wrong=await sign('cd'.repeat(32),'lab-test','runner',2,'POST',path,time,'ab'.repeat(16),body);
 assert.equal((await handle(request(body,wrong),f.env,T)).status,401);
});
test('oversized stream rejected, duplicate JSON key rejected before admission',async()=>{
 const f=await fixture();assert.equal((await f.req('/api/commands',{},'bot',T,' '.repeat(32769))).status,413);
 assert.equal((await f.req('/api/commands',{},'bot',T,'{"idempotency_key":"a","idempotency_key":"b"}')).status,422);
 assert.equal(f.DB.db.prepare('SELECT count(*) n FROM commands').get().n,0);
});
test('simultaneous claims use one fence; admission failure leaves no partial outbox',async()=>{
 const f=await fixture();await f.req('/api/commands',f.command());
 const replies=await Promise.all([f.req('/api/runner/claim',{},'runner'),f.req('/api/runner/claim',{},'runner')]);
 assert.ok(replies.some(x=>x.status===200));assert.ok(replies.every(x=>[200,409].includes(x.status)));
 assert.equal(JSON.parse(f.DB.db.prepare('SELECT record FROM commands').get().record).attempt.fence,1);
 const count=f.DB.db.prepare('SELECT count(*) n FROM commands').get().n;
 assert.equal((await f.req('/api/commands',f.command('conflict'))).status,429);
 assert.equal(f.DB.db.prepare('SELECT count(*) n FROM commands').get().n,count);
});
test('grant revision changes, schedule disable and old due time cannot dispatch',async()=>{
 const f=await fixture();f.DB.db.prepare('INSERT INTO schedules VALUES(?,1,1,?,NULL)').run('health-minute','gb');
 await scheduled({scheduledTime:T},f.env,T);f.DB.db.exec('UPDATE schedules SET enabled=0');
 assert.equal((await f.req('/api/runner/claim',{},'runner')).data.assignment,null);
 assert.equal(JSON.parse(f.DB.db.prepare('SELECT record FROM commands').get().record).delivery,'cancelled_before_dispatch');
 const g=await fixture();await g.req('/api/commands',g.command());g.DB.db.exec("UPDATE grants SET revision=2 WHERE id='gb'");assert.equal((await g.req('/api/runner/claim',{},'runner')).data.assignment,null);
 const h=await fixture();h.DB.db.prepare('INSERT INTO schedules VALUES(?,1,1,?,NULL)').run('health-minute','gb');await scheduled({scheduledTime:T-60000},h.env,T);assert.equal(h.DB.db.prepare('SELECT outcome FROM firings').get().outcome,'skipped_misfire');
});
test('schedule transaction rollback leaves neither firing nor command on write failure',async()=>{
 const f=await fixture();f.DB.db.prepare('INSERT INTO schedules VALUES(?,1,1,?,NULL)').run('health-minute','gb');
 f.DB.db.exec("CREATE TRIGGER reject_command BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT,'test storage fault'); END");
 await assert.rejects(scheduled({scheduledTime:T},f.env,T));
 assert.equal(f.DB.db.prepare('SELECT count(*) n FROM firings').get().n,0);
 assert.equal(f.DB.db.prepare('SELECT count(*) n FROM commands').get().n,0);
 f.DB.db.exec('DROP TRIGGER reject_command');await scheduled({scheduledTime:T},f.env,T);
 assert.equal(f.DB.db.prepare('SELECT count(*) n FROM commands').get().n,1);
});
test('Access JWT origin, audience, expiry and signature guards include static assets',async()=>{
 const f=await fixture(),issuer='https://test.cloudflareaccess.com';f.env.ACCESS_CONFIG=JSON.stringify({issuer,audience:'access-aud',subjects:{human:{principal_id:'bot',grant_id:'gb'}}});
 f.env.ASSETS={fetch:async()=>new Response('synthetic page')};
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'key'};
 const fetcher=async (url,options)=>{assert.equal(url,issuer+'/cdn-cgi/access/certs');assert.equal(options.redirect,'manual');return Response.json({keys:[jwk]});};
 const b64=s=>Buffer.from(s).toString('base64url');
 async function token(extra={}){const prefix=b64(JSON.stringify({alg:'RS256',kid:'key'}))+'.'+b64(JSON.stringify({iss:issuer,aud:['access-aud'],sub:'human',iat:T/1000,exp:T/1000+60,...extra}));return prefix+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(prefix)));}
 async function req(tok,path='/',method='GET',origin){return handle(new Request('https://lab.example'+path,{method,headers:{'Cf-Access-Jwt-Assertion':tok,'Content-Type':'application/json','X-Cloud-Lab':'1',...(origin?{Origin:origin}:{})},...(method==='POST'?{body:JSON.stringify(f.command())}:{})}),f.env,T,fetcher);}
 const good=await token();assert.equal((await req(good)).status,200);
 assert.equal((await req(await token({aud:['other']}))).status,401);
 assert.equal((await req(await token({exp:T/1000}))).status,401);
 const parts=good.split('.');parts[2]='a'.repeat(parts[2].length);assert.equal((await req(parts.join('.'))).status,401);
 assert.equal((await req(good,'/api/commands','POST','https://evil.example')).status,403);
 assert.equal((await req(good,'/api/commands','POST','https://lab.example')).status,202);
});
test('existing dispatch lease cannot be replayed by reduced runner or revoked submit authority',async()=>{
 const f=await fixture();await f.start();const g=JSON.parse(f.DB.db.prepare("SELECT policy FROM grants WHERE id='gr'").get().policy);g.capabilities=['runs:reconcile','runs:report'];f.DB.db.prepare("UPDATE grants SET revision=2,policy=? WHERE id='gr'").run(JSON.stringify(g));
 assert.equal((await f.req('/api/runner/claim',{},'runner',T+1000)).status,403);
 assert.equal((await f.req('/api/runner/claim',{},'runner',T+16000)).data.assignment.attempt.mode,'reconcile_only');
 const h=await fixture();await h.start();h.DB.db.exec("UPDATE grants SET revoked=1 WHERE id='gb'");assert.equal((await h.req('/api/runner/claim',{},'runner',T+1000)).status,403);
 assert.equal((await h.req('/api/runner/claim',{},'runner',T+16000)).data.assignment.attempt.mode,'reconcile_only');
});
test('fixed collector profile rejects nonzero sample age instead of dropping freshness information',async()=>{
 const f=await fixture(),a=await f.start(),r=f.result(a),artifact=JSON.parse(r.artifact);artifact.sample_age_seconds=25;r.artifact=JSON.stringify(artifact);
 const response=await f.req('/api/runner/report',r,'runner',T+2000);assert.equal(response.status,200);assert.equal(response.data.command.result.validation.status,'failed');assert.equal(response.data.command.result.health,'unknown');
});

test('self authorization projects only the authenticating machine and leaves business rows unchanged',async()=>{
 const f=await fixture();await f.req('/api/commands',f.command());
 const snapshot=()=>['grants','commands','schedules'].map(t=>f.DB.db.prepare('SELECT * FROM '+t).all());const before=snapshot();
 for(const who of ['bot','runner']){
  const out=await f.req('/api/authorization/self',{},who);assert.equal(out.status,200);
  assert.deepEqual(Object.keys(out.data).sort(),['credential','grant','observed_at','request_id','schema_version','scope']);
  assert.equal(out.data.schema_version,'cloudlab.authorization-self.v1');assert.equal(out.data.observed_at,iso(T));
  assert.deepEqual(out.data.credential,{id:who,generation:1,principal_id:who,grant_id:who==='bot'?'gb':'gr',revoked:false,expires_at:iso(T+3600000)});
  assert.equal(out.data.grant.id,out.data.credential.grant_id);assert.equal(out.data.grant.revision,1);
  assert.deepEqual(out.data.scope,{workspace_id:'ws_test',resource_ref:{resource_id:'node_test',generation:1},recipe_ref:await recipeRef()});
  assert.ok(!JSON.stringify(out.data).includes('secret'));assert.ok(!JSON.stringify(out.data).includes(secret));
 }
 assert.deepEqual(snapshot(),before);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM nonces').get().n,3);
});
test('self authorization cannot select other keys or bypass expiry and revocation',async()=>{
 const f=await fixture();assert.equal((await f.req('/api/authorization/self',{id:'runner'})).status,422);
 assert.equal((await f.req('/api/authorization/self')).status,404);
 assert.equal((await f.req('/api/authorization/self?key=runner',{})).status,403);
 for(const change of [{expires_at:iso(T)},{revoked:true}]){
  const g=await fixture(),keys=JSON.parse(g.env.MACHINE_KEYS);Object.assign(keys.bot,change);g.env.MACHINE_KEYS=JSON.stringify(keys);
  const out=await g.req('/api/authorization/self',{});assert.equal(out.status,401);assert.equal(out.data.credential,undefined);
 }
 for(const sql of ["UPDATE grants SET revoked=1 WHERE id='gb'", "UPDATE grants SET policy=json_set(policy,'$.expires_at',?) WHERE id='gb'"]){
  const g=await fixture();if(sql.includes('?'))g.DB.db.prepare(sql).run(iso(T));else g.DB.db.exec(sql);
  assert.equal((await g.req('/api/authorization/self',{})).status,403);
 }
});
test('self authorization retains signature and nonce replay checks',async()=>{
 const f=await fixture(),path='/api/authorization/self',time=String(T/1000),nonce='af'.repeat(16);
 const signature=await sign(secret,'lab-test','bot',1,'POST',path,time,nonce,'{}');
 const req=(sig=signature)=>new Request('https://lab.example'+path,{method:'POST',headers:{'content-type':'application/json','x-lab-key-id':'bot','x-lab-time':time,'x-lab-nonce':nonce,'x-lab-signature':sig},body:'{}'});
 assert.equal((await handle(req('00'.repeat(32)),f.env,T)).status,401);
 const ok=await handle(req(),f.env,T);assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');
 assert.equal((await handle(req(),f.env,T)).status,401);
});

test('usage reads empty application quotas with unknown provider metrics and no business writes',async()=>{
 const f=await fixture();const before=['grants','commands','schedules','firings'].map(t=>f.DB.db.prepare('SELECT * FROM '+t).all());
 const r=await f.req('/api/usage');assert.equal(r.status,200);assert.equal(r.data.schema_version,'cloudlab.usage.v1');assert.equal(r.data.observed_at,iso(T));
 assert.deepEqual(r.data.scope,{workspace_id:'ws_test',resource_ref:{resource_id:'node_test',generation:1},recipe_ref:await recipeRef()});
 assert.deepEqual(r.data.application,{retained:{used:0,limit:10000,remaining:10000},rolling_24h:{used:0,limit:1440,remaining:1440,window_start_exclusive:iso(T-86400000)},active:{used:0,limit:1,remaining:1}});
 assert.deepEqual(r.data.provider,{status:'not_connected',workers_requests:null,d1_rows_read:null,d1_rows_written:null,d1_storage_bytes:null,billing:null});
 assert.deepEqual(['grants','commands','schedules','firings'].map(t=>f.DB.db.prepare('SELECT * FROM '+t).all()),before);
 assert.equal((await f.req('/api/usage',undefined,'runner')).status,403);assert.equal((await f.req('/api/usage',{})).status,404);
});
test('usage counts terminal history, exact rolling lower bound and active unknown without writes',async()=>{
 const f=await fixture();
 for(const [key,created] of [['old',T-86400000],['recent',T-86400000+1000]]){
  const c=(await f.req('/api/commands',f.command(key))).data.command;await f.req(`/api/commands/${c.command_id}/cancel`,{});
  f.DB.db.prepare('UPDATE commands SET created_at=? WHERE id=?').run(created,c.command_id);
 }
 const a=await f.start();await f.req('/api/runner/report',{...f.result(a),owner_outcome:'unknown',started_at:null,finished_at:null,artifact:null},'runner');
 const before=f.DB.db.prepare('SELECT * FROM commands ORDER BY id').all();const r=await f.req('/api/usage');assert.equal(r.status,200);
 assert.deepEqual(r.data.application.retained,{used:3,limit:10000,remaining:9997});assert.equal(r.data.application.rolling_24h.used,2);assert.deepEqual(r.data.application.active,{used:1,limit:1,remaining:0});
 assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands ORDER BY id').all(),before);assert.equal(JSON.stringify(r.data).includes(a.command_id),false);
});
test('usage refuses mixed global scope for every workspace/resource/recipe identity field',async()=>{
 for(const [path,value] of [['workspace_id','other'],['resource_ref.resource_id','other'],['resource_ref.generation',2],['recipe_ref.recipe_id','other'],['recipe_ref.version','2.0.0'],['recipe_ref.digest','sha256:'+'0'.repeat(64)],['workspace_id',null]]){
  const f=await fixture();await f.req('/api/commands',f.command());
  f.DB.db.prepare('UPDATE commands SET record=json_set(record,?,?)').run('$.command.'+path,value);
  const r=await f.req('/api/usage');assert.equal(r.status,403,path);assert.equal(r.data.code,'SCOPE_DENIED');assert.equal(r.data.application,undefined);
 }
});
test('usage cannot bypass credential expiry or revoked reader grant',async()=>{
 const f=await fixture();f.DB.db.exec("UPDATE grants SET revoked=1 WHERE id='gb'");assert.equal((await f.req('/api/usage')).status,403);
 const g=await fixture();assert.equal((await g.req('/api/usage',undefined,'bot',T+3600000)).status,401);
});
test('usage database errors return unavailable rather than a zero snapshot',async()=>{
 const f=await fixture(),original=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{if(sql.includes('FROM commands'))throw new Error('storage unavailable');return original(sql);};
 const r=await f.req('/api/usage');assert.equal(r.status,503);assert.equal(r.data.code,'TEMPORARILY_UNAVAILABLE');assert.equal(r.data.application,undefined);
});

test('closed unknown rejects late reports and remains terminal on view, cancel and same-id retry',async()=>{
 const f=await fixture(),a=await f.start(),r=f.result(a);
 const row=f.DB.db.prepare('SELECT * FROM commands WHERE id=?').get(a.command_id),v=JSON.parse(row.record);
 v.delivery='closed_unknown';v.revision++;v.resolution={id:'operator-resolution',action:'close_unknown'};
 f.DB.db.prepare('UPDATE commands SET record=?,revision=?,active=0 WHERE id=?').run(JSON.stringify(v),v.revision,a.command_id);
 const before=f.DB.db.prepare('SELECT * FROM commands').get();
 for(const body of [r,{...r,owner_outcome:'unknown',started_at:null,finished_at:null,artifact:null}]){
  const result=await f.req('/api/runner/report',body,'runner',T+2000);assert.equal(result.status,409);assert.equal(result.data.code,'RECONCILIATION_CLOSED');
 }
 assert.equal((await f.req(`/api/commands/${a.command_id}`,undefined,'bot',T+20000)).data.command.delivery,'closed_unknown');
 assert.equal((await f.req(`/api/commands/${a.command_id}/cancel`,{},'bot',T+20000)).data.command.delivery,'closed_unknown');
 assert.equal((await f.req('/api/commands',f.command(),'bot',T+20000)).data.command.delivery,'closed_unknown');
 assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands').get(),before);
 assert.equal((await f.req('/api/runner/claim',{},'runner',T+20000)).data.assignment,null);
 assert.equal((await f.req('/api/commands',f.command('new-after-close'),'bot',T+20000)).status,202);
});

import {spawn} from 'node:child_process';
const ordered = v => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])) : v;
async function resolutionFixture(){
 const f=await fixture(),a=await f.start();
 const unknown={command_id:a.command_id,attempt_id:a.attempt.attempt_id,fence:a.attempt.fence,owner_outcome:'unknown',started_at:null,finished_at:null,artifact:null};
 assert.equal((await f.req('/api/runner/report',unknown,'runner',T+2000)).status,200);
 const current=(await f.req('/api/runner/claim',{},'runner',T+121000)).data.assignment;
 const journal=new DatabaseSync(':memory:');journal.exec('CREATE TABLE executions(command_id TEXT,identity_digest TEXT,state TEXT,result TEXT)');
 const identity=await digest(JSON.stringify(ordered({command:current.command,external_ref:current.external_ref})));
 journal.prepare('INSERT INTO executions VALUES(?,?,?,?)').run(a.command_id,identity,'unknown',JSON.stringify({owner_outcome:'unknown',started_at:null,finished_at:null,artifact:null}));
 const saved=journal.prepare('SELECT * FROM executions').get();
 const snapshot={schema_version:'cloudlab.unknown-resolution.v1',observed_at:iso(T+122000),target:{worker_name:'cloud-lab',database_id:'12345678-1234-4234-8234-123456789abc'},command:f.DB.db.prepare('SELECT * FROM commands WHERE id=?').get(a.command_id),journal:{...saved,result:JSON.parse(saved.result)}};
 const script="import sys,json,importlib.util; s=importlib.util.spec_from_file_location('resolution',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.make_plan(json.load(sys.stdin),operator_id='operator-approved',resolution_id='12345678-1234-4234-8234-123456789abc',now=int(sys.argv[2]))))";
 const output=await new Promise((resolve,reject)=>{
  const child=spawn('python3',['-c',script,new URL('../tools/resolve_unknown.py',import.meta.url).pathname,String((T+122000)/1000)],{stdio:['pipe','pipe','pipe'],timeout:10000});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.once('error',reject);child.once('close',status=>resolve({status,stdout,stderr}));child.stdin.end(JSON.stringify(snapshot));
 });
 assert.equal(output.status,0,output.stderr);const plan=JSON.parse(output.stdout);
 f.DB.db.function('unixepoch',()=>Math.floor((T+122000)/1000));
 return {...f,a:current,journal,saved,plan,unknown:{...unknown,attempt_id:current.attempt.attempt_id,fence:current.attempt.fence}};
}
test('Python resolution SQL releases one slot, preserves journal and admits a fresh real SQLite Cron cycle',async()=>{
 const f=await resolutionFixture();
 assert.equal(f.DB.db.prepare(f.plan.query.sql).run(...f.plan.query.params).changes,1);
 assert.equal(f.DB.db.prepare(f.plan.query.sql).run(...f.plan.query.params).changes,0);
 assert.deepEqual(f.journal.prepare('SELECT * FROM executions').get(),f.saved);
 assert.equal((await f.req('/api/runner/report',f.unknown,'runner',T+123000)).data.code,'RECONCILIATION_CLOSED');
 const usage=(await f.req('/api/usage',undefined,'bot',T+123000)).data;
 assert.equal(usage.application.retained.used,1);assert.equal(usage.application.rolling_24h.used,1);assert.equal(usage.application.active.used,0);
 const retry=await f.req('/api/commands',f.command(),'bot',T+123000);assert.equal(retry.data.command.delivery,'closed_unknown');assert.equal(retry.data.command.command_id,f.a.command_id);
 f.DB.db.prepare('INSERT INTO schedules VALUES(?,1,1,?,NULL)').run('health-minute','gb');
 await scheduled({scheduledTime:T+900000},f.env,T+900000);
 assert.equal(f.DB.db.prepare('SELECT count(*) n FROM commands').get().n,2);
 const next=(await f.req('/api/runner/claim',{},'runner',T+901000)).data.assignment;
 assert.notEqual(next.command_id,f.a.command_id);assert.equal(next.attempt.mode,'dispatch');
 const result={...f.result(next),started_at:iso(T+901000),finished_at:iso(T+902000)};
 const report=await f.req('/api/runner/report',result,'runner',T+903000);assert.equal(report.status,200);assert.equal(report.data.command.result.validation.status,'passed');
 assert.deepEqual(f.journal.prepare('SELECT * FROM executions').get(),f.saved);f.journal.close();
});
test('a genuine result racing before the operator CAS wins without being overwritten',async()=>{
 const f=await resolutionFixture();const result=await f.req('/api/runner/report',f.result(f.a),'runner',T+122000);
 assert.equal(result.status,200);assert.equal(result.data.command.delivery,'result_recorded');
 const saved=f.DB.db.prepare('SELECT * FROM commands').get();
 assert.equal(f.DB.db.prepare(f.plan.query.sql).run(...f.plan.query.params).changes,0);
 assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands').get(),saved);f.journal.close();
});

// FQ: application races and retention boundaries on real local SQLite.
// These tests do not claim remote D1 concurrency or actual host interruption.
for (const cancelFirst of [true, false]) {
 test(`FQ cancellation ${cancelFirst ? 'before' : 'after'} completion preserves the successful evidence`, async t => {
  const f=await fixture();t.after(()=>f.DB.db.close());const a=await f.start(),body=f.result(a);
  const cancel=()=>f.req(`/api/commands/${a.command_id}/cancel`,{},'bot',T+2000);
  if(cancelFirst){
   const intent=await cancel();assert.equal(intent.status,200);assert.equal(intent.data.command.cancel_requested,true);
   assert.equal(intent.data.command.delivery,'dispatching');assert.equal(intent.data.command.result,null);
   assert.equal(f.DB.db.prepare('SELECT active FROM commands').get().active,1);
  }
  const completed=await f.req('/api/runner/report',body,'runner',T+2000);assert.equal(completed.status,200);
  const stored=f.DB.db.prepare('SELECT * FROM commands').get();
  if(!cancelFirst)assert.equal((await cancel()).status,200);
  const after=f.DB.db.prepare('SELECT * FROM commands').get(),record=JSON.parse(after.record),before=JSON.parse(stored.record);
  assert.equal(record.delivery,'result_recorded');assert.equal(record.cancel_requested,true);assert.equal(after.active,0);
  assert.deepEqual(record.result,before.result);assert.equal(record.result.validation.status,'passed');
  for(const key of ['artifact','report_digest','attempt','external_ref','command'])assert.deepEqual(record[key],before[key]);
  for(const key of ['id','body','body_digest','idem_key','created_at','submit_grant','grant_revision'])assert.equal(after[key],stored[key]);
  assert.equal((await f.req('/api/runner/claim',{},'runner',T+3000)).data.assignment,null);
 });
}

test('FQ simultaneous cancel/report read the same revision; loser retries without overwriting evidence',{timeout:5000},async t=>{
 const f=await fixture();t.after(()=>f.DB.db.close());const a=await f.start(),body=f.result(a);
 const original=f.DB.prepare.bind(f.DB);let arrived=0,release;
 const barrier=new Promise(resolve=>{release=resolve;});
 f.DB.prepare=sql=>{
  const statement=original(sql);
  if(sql!=='SELECT * FROM commands WHERE id=?')return statement;
  return {...statement,bind(...args){const bound=statement.bind(...args);return {...bound,async first(){
   const row=await bound.first();if(++arrived<=2){if(arrived===2)release();await barrier;}return row;
  }};}};
 };
 const [cancel,report]=await Promise.all([
  f.req(`/api/commands/${a.command_id}/cancel`,{},'bot',T+2000),
  f.req('/api/runner/report',body,'runner',T+2000),
 ]);
 f.DB.prepare=original;
 assert.equal(arrived,2);assert.deepEqual([cancel.status,report.status].sort(),[200,409]);
 assert.equal((cancel.status===409?cancel:report).data.code,'REVISION_CONFLICT');
 if(report.status===409){
  const pending=JSON.parse(f.DB.db.prepare('SELECT record FROM commands').get().record);
  assert.equal(pending.result,null);assert.equal(pending.cancel_requested,true);
  assert.equal((await f.req('/api/runner/report',body,'runner',T+3000)).status,200);
 }
 if(cancel.status===409)assert.equal((await f.req(`/api/commands/${a.command_id}/cancel`,{},'bot',T+3000)).status,200);
 const saved=f.DB.db.prepare('SELECT * FROM commands').get(),v=JSON.parse(saved.record);
 assert.equal(saved.active,0);assert.equal(v.cancel_requested,true);assert.equal(v.delivery,'result_recorded');
 assert.equal(v.result.validation.status,'passed');assert.equal(v.artifact,body.artifact);
 assert.equal(v.result.artifact_sha256,'sha256:'+createHash('sha256').update(body.artifact).digest('hex'));
 assert.equal((await f.req('/api/runner/report',body,'runner',T+4000)).status,200);
 assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands').get(),saved);
});

test('FQ cancellation of an unknown remains intent after the execution deadline',async t=>{
 const f=await fixture();t.after(()=>f.DB.db.close());const a=await f.start();
 const unknown={...f.result(a),owner_outcome:'unknown',started_at:null,finished_at:null,artifact:null};
 assert.equal((await f.req('/api/runner/report',unknown,'runner',T+1000)).status,200);
 const cancel=await f.req(`/api/commands/${a.command_id}/cancel`,{},'bot',T+2000);
 assert.equal(cancel.data.command.cancel_requested,true);assert.equal(cancel.data.command.delivery,'reconciling');
 assert.equal(cancel.data.command.result,null);assert.equal(f.DB.db.prepare('SELECT active FROM commands').get().active,1);
 const reconciled=(await f.req('/api/runner/claim',{},'runner',T+121000)).data.assignment;
 assert.equal(reconciled.command_id,a.command_id);assert.equal(reconciled.attempt.mode,'reconcile_only');
 assert.deepEqual(reconciled.command,a.command);assert.deepEqual(reconciled.external_ref,a.external_ref);
});

for(const [name,deadline,claimAt] of [['dispatch deadline',120000,60000],['remaining execution budget',20000,11000]]){
 test(`FQ ${name} prevents first dispatch and retains the admission record`,async t=>{
  const f=await fixture();t.after(()=>f.DB.db.close());const command={...f.command(),execution_deadline:iso(T+deadline),dispatch_deadline:iso(T+Math.min(60000,deadline))};
  const accepted=await f.req('/api/commands',command);assert.equal(accepted.status,202);
  const saved=f.DB.db.prepare('SELECT * FROM commands').get();
  assert.equal((await f.req('/api/runner/claim',{},'runner',T+claimAt)).data.assignment,null);
  const after=f.DB.db.prepare('SELECT * FROM commands').get(),v=JSON.parse(after.record);
  assert.equal(v.delivery,'expired_before_dispatch');assert.equal(v.attempt,null);assert.equal(v.external_ref,null);assert.equal(v.result,null);assert.equal(after.active,0);
  assert.equal(after.body,saved.body);assert.equal(after.id,saved.id);
  assert.equal((await f.req('/api/commands',command,'bot',T+121000)).data.command.command_id,after.id);
  assert.equal(f.DB.db.prepare('SELECT count(*) n FROM commands').get().n,1);
 });
}

test('FQ exact lease expiry rejects an old report without mutation; new fence reuses the result',async t=>{
 const f=await fixture();t.after(()=>f.DB.db.close());const a=await f.start(),body=f.result(a),saved=f.DB.db.prepare('SELECT * FROM commands').get();
 const old=await f.req('/api/runner/report',body,'runner',T+15000);
 assert.equal(old.status,409);assert.equal(old.data.code,'STALE_FENCE');assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands').get(),saved);
 const next=(await f.req('/api/runner/claim',{},'runner',T+15000)).data.assignment;
 assert.equal(next.attempt.mode,'reconcile_only');assert.equal(next.attempt.fence,a.attempt.fence+1);
 const report=await f.req('/api/runner/report',{...body,attempt_id:next.attempt.attempt_id,fence:next.attempt.fence},'runner',T+16000);
 assert.equal(report.status,200);assert.equal(report.data.command.result.validation.status,'passed');
 assert.equal(report.data.command.result.finished_at,body.finished_at);assert.equal(report.data.command.result.received_at,iso(T+16000));
});

for(const finish of [120000,121000]){
 test(`FQ late delivery preserves completion at execution deadline ${finish===120000?'boundary':'plus one second'}`,async t=>{
  const f=await fixture();t.after(()=>f.DB.db.close());const a=await f.start();
  const reconcile=(await f.req('/api/runner/claim',{},'runner',T+122000)).data.assignment;
  const body={...f.result(a),attempt_id:reconcile.attempt.attempt_id,fence:reconcile.attempt.fence,started_at:iso(T+finish-1000),finished_at:iso(T+finish)};
  const out=await f.req('/api/runner/report',body,'runner',T+123000);assert.equal(out.status,200);
  const result=out.data.command.result;assert.equal(result.late,true);assert.equal(result.started_at,body.started_at);assert.equal(result.finished_at,body.finished_at);assert.equal(result.received_at,iso(T+123000));
  assert.equal(result.validation.status,finish===120000?'passed':'incomplete');assert.equal(result.health,finish===120000?'healthy':'unknown');
 });
}

test('FQ rejected report payloads leave the original row intact',async t=>{
 const f=await fixture();t.after(()=>f.DB.db.close());const a=await f.start(),body=f.result(a),before=f.DB.db.prepare('SELECT * FROM commands').get();
 for(const [bad,status] of [[{...body,artifact:'x'.repeat(16385)},413],[{...body,late:false},422],[{...body,owner_outcome:'unknown'},422]]){
  assert.equal((await f.req('/api/runner/report',bad,'runner',T+2000)).status,status);
  assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands').get(),before);
 }
 assert.equal((await f.req('/api/runner/report',body,'runner',T+2000)).status,200);
 const saved=f.DB.db.prepare('SELECT * FROM commands').get();
 const conflict=await f.req('/api/runner/report',{...body,artifact:body.artifact+' '},'runner',T+3000);
 assert.equal(conflict.status,409);assert.equal(conflict.data.code,'RESULT_CONFLICT');assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands').get(),saved);
});

test('FQ artifact expiry denies bytes at seven days without deleting history or freeing dedupe',async t=>{
 const f=await fixture();t.after(()=>f.DB.db.close());const day=86400000,until=iso(T+8*day);
 for(const row of f.DB.db.prepare('SELECT * FROM grants').all()){
  const policy={...JSON.parse(row.policy),expires_at:until};f.DB.db.prepare('UPDATE grants SET policy=? WHERE id=?').run(JSON.stringify(policy),row.id);
 }
 const keys=JSON.parse(f.env.MACHINE_KEYS);for(const key of Object.values(keys))key.expires_at=until;f.env.MACHINE_KEYS=JSON.stringify(keys);
 f.DB.db.prepare('INSERT INTO schedules VALUES(?,1,1,?,NULL)').run('health-minute','gb');
 await scheduled({scheduledTime:T},f.env,T);
 const a=(await f.req('/api/runner/claim',{},'runner')).data.assignment,body=f.result(a),firings=f.DB.db.prepare('SELECT * FROM firings').all();
 assert.equal(firings.length,1);assert.equal(firings[0].outcome,a.command_id);
 body.artifact=JSON.stringify(JSON.parse(body.artifact),null,2);
 assert.equal((await f.req('/api/runner/report',body,'runner',T+2000)).status,200);
 const saved=f.DB.db.prepare('SELECT * FROM commands').get(),record=JSON.parse(saved.record),expires=T+2000+7*day;
 assert.equal(record.result.artifact_sha256,'sha256:'+createHash('sha256').update(body.artifact).digest('hex'));assert.equal(record.result.artifact_expires_at,iso(expires));
 async function download(now,nonce){
  const path=`/api/commands/${a.command_id}/artifact`,timestamp=String(now/1000);
  const signature=await sign(secret,'lab-test','bot',1,'GET',path,timestamp,nonce,'');
  return handle(new Request('https://lab.example'+path,{headers:{'x-lab-key-id':'bot','x-lab-time':timestamp,'x-lab-nonce':nonce,'x-lab-signature':signature}}),f.env,now);
 }
 const available=await download(expires-1000,'fc'.repeat(16));assert.equal(available.status,200);assert.equal(await available.text(),body.artifact);
 const expired=await download(expires,'fd'.repeat(16));assert.equal(expired.status,410);assert.equal((await expired.json()).code,'EVIDENCE_EXPIRED');
 assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands').get(),saved);
 assert.equal((await f.req('/api/commands',a.command,'bot',expires)).data.command.command_id,a.command_id);
 assert.equal((await f.req('/api/commands',{...a.command,parameters:{max_sample_age_seconds:20}},'bot',expires)).status,409);
 assert.equal((await f.req('/api/usage',undefined,'bot',expires)).data.application.retained.used,1);
 await scheduled({scheduledTime:T},f.env,expires);
 assert.deepEqual(f.DB.db.prepare('SELECT * FROM firings').all(),firings);
 assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands').get(),saved);
});

test('RA wrong holder and stale fence persist refusal without changing original command',async()=>{
 const f=await fixture(),a=await f.start(),before=f.DB.db.prepare('SELECT * FROM commands').get();
 const keys=JSON.parse(f.env.MACHINE_KEYS);keys.runner.principal_id='other-runner';f.env.MACHINE_KEYS=JSON.stringify(keys);
 const g=JSON.parse(f.DB.db.prepare("SELECT policy FROM grants WHERE id='gr'").get().policy);g.principal_id='other-runner';f.DB.db.prepare("UPDATE grants SET policy=? WHERE id='gr'").run(JSON.stringify(g));
 const wrong=await f.req('/api/runner/report',f.result(a),'runner',T+2000);
 assert.equal(wrong.status,409);assert.equal(wrong.data.code,'STALE_FENCE');
 assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands').get(),before);
 const audit=f.DB.db.prepare('SELECT * FROM rejection_audit WHERE request_id=?').get(wrong.data.request_id);
 assert.equal(audit.authenticated,1);assert.equal(audit.route,'runner-report');assert.equal(audit.code,'STALE_FENCE');assert.equal(JSON.stringify(audit).includes(a.command_id),false);
 keys.runner.principal_id='runner';f.env.MACHINE_KEYS=JSON.stringify(keys);g.principal_id='runner';f.DB.db.prepare("UPDATE grants SET policy=? WHERE id='gr'").run(JSON.stringify(g));
 const stale=await f.req('/api/runner/report',f.result(a),'runner',T+15000);
 assert.equal(stale.status,409);assert.equal(f.DB.db.prepare('SELECT code FROM rejection_audit WHERE request_id=?').get(stale.data.request_id).code,'STALE_FENCE');
 assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands').get(),before);
});

test('RA quota and evidence expiry refusals retain request IDs and business history',async()=>{
 const f=await fixture(),a=await f.start();
 const quota=await f.req('/api/commands',f.command('over-capacity'));
 assert.equal(quota.status,429);assert.equal(quota.data.retryable,true);
 assert.equal(f.DB.db.prepare('SELECT status FROM rejection_audit WHERE request_id=?').get(quota.data.request_id).status,429);
 assert.equal((await f.req('/api/runner/report',f.result(a),'runner',T+2000)).status,200);
 f.DB.db.prepare("UPDATE commands SET record=json_set(record,'$.result.artifact_expires_at',?)").run(iso(T));
 const before=f.DB.db.prepare('SELECT * FROM commands').get();
 const expired=await f.req(`/api/commands/${a.command_id}/artifact`);
 assert.equal(expired.status,410);assert.equal(expired.data.retryable,false);
 const audit=f.DB.db.prepare('SELECT * FROM rejection_audit WHERE request_id=?').get(expired.data.request_id);
 assert.equal(audit.route,'artifact');assert.equal(audit.code,'EVIDENCE_EXPIRED');assert.deepEqual(f.DB.db.prepare('SELECT * FROM commands').get(),before);
});


test('PS durable outbox survives discarded admission ACK and full SQLite reopen without notification',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'polling-outbox-')),path=join(directory,'control.sqlite');
 const f=await fixture(path);t.after(()=>{f.env.DB.db.close();rmSync(directory,{recursive:true});});
 const body=f.command('lost-admission-ack');
 await f.req('/api/commands',body); // The caller discards the response after the real transaction committed.
 const before=f.env.DB.db.prepare('SELECT * FROM commands').get();assert.equal(before.active,1);
 f.env.DB.db.close();f.env.DB=new D1(path);
 assert.deepEqual(f.env.DB.db.prepare('SELECT * FROM commands').get(),before);
 const a=(await f.req('/api/runner/claim',{},'runner',T+1000)).data.assignment;
 assert.equal(a.command_id,before.id);assert.equal(a.attempt.mode,'dispatch');
 const claimRow=f.env.DB.db.prepare('SELECT * FROM commands').get();
 const retry=await f.req('/api/commands',body,'bot',T+2000);
 assert.equal(retry.data.command.command_id,before.id);assert.deepEqual(f.env.DB.db.prepare('SELECT * FROM commands').get(),claimRow);
 const completed=await f.req('/api/runner/report',f.result(a),'runner',T+2000);assert.equal(completed.status,200);
 const final=f.env.DB.db.prepare('SELECT * FROM commands').get();
 f.env.DB.db.close();f.env.DB=new D1(path);
 assert.deepEqual(f.env.DB.db.prepare('SELECT * FROM commands').get(),final);
 assert.equal((await f.req('/api/runner/claim',{},'runner',T+3000)).data.assignment,null);
 assert.equal(f.env.DB.db.prepare('SELECT count(*) n FROM commands').get().n,1);
 assert.equal((await f.req('/api/commands/'+before.id,undefined,'bot',T+3000)).data.command.result.artifact_sha256,completed.data.command.result.artifact_sha256);
});

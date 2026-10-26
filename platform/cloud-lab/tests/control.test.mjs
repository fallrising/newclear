import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handle, scheduled } from '../apps/control/worker/index.mjs';
import { strictJSON, digest, sign, recipeRef } from '../apps/control/worker/protocol.mjs';

class D1 {
  constructor(){ this.db=new DatabaseSync(':memory:'); this.db.exec(readFileSync(new URL('../apps/control/migrations/0001.sql',import.meta.url),'utf8')); }
  prepare(sql){const db=this.db;return {bind(...params){return {async first(){return db.prepare(sql).get(...params)||null},async all(){return {results:db.prepare(sql).all(...params)}},async run(){const r=db.prepare(sql).run(...params);return {meta:{changes:r.changes}}},sql,params}},async first(){return db.prepare(sql).get()||null},async all(){return {results:db.prepare(sql).all()}},sql,params:[]};}
  async batch(stmts){this.db.exec('BEGIN');try{const out=[];for(const s of stmts){const st=this.db.prepare(s.sql);if(st.columns().length)out.push({results:st.all(...s.params)});else out.push({meta:{changes:st.run(...s.params).changes}});}this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const T=1793059200000, iso=t=>new Date(t).toISOString().replace('.000Z','Z');
const secret='ab'.repeat(32);
async function fixture(){
 const DB=new D1(), ref=await recipeRef();
 const env={DB,PUBLIC_ORIGIN:'https://lab.example',AUDIENCE:'lab-test',MACHINE_KEYS:JSON.stringify({bot:{principal_id:'bot',grant_id:'gb',generation:1,secret_hex:secret,expires_at:iso(T+3600000)},runner:{principal_id:'runner',grant_id:'gr',generation:1,secret_hex:'cd'.repeat(32),expires_at:iso(T+3600000)}})};
 for(const [id,principal,caps] of [['gb','bot',['commands:read','commands:submit','commands:cancel-request','node:health:read','artifact:read']],['gr','runner',['dispatch:claim','runs:report','runs:reconcile']]]){
 const g={principal_id:principal,workspace_id:'ws_test',resource_ref:{resource_id:'node_test',generation:1},recipe_ref:ref,capabilities:caps,not_before:iso(T-1000),expires_at:iso(T+3600000),max_timeout_seconds:30,max_output_bytes:16384};
 DB.db.prepare('INSERT INTO grants(id,revision,revoked,policy) VALUES(?,1,0,?)').run(id,JSON.stringify(g)); }
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
 const fetcher=async url=>{assert.equal(url,issuer+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};
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

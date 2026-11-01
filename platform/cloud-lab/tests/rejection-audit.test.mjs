import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {SQLiteD1} from '../tools/sqlite-d1.mjs';
import {handle} from '../apps/control/worker/index.mjs';
import {sign} from '../apps/control/worker/protocol.mjs';

const T=1793059200000;
const auditRows=db=>db.db.prepare('SELECT * FROM rejection_audit ORDER BY request_id').all();
function fixture(t,path){
 const DB=new SQLiteD1(path);t.after(()=>DB.close());
 const policy={principal_id:'trusted',workspace_id:'test',resource_ref:{resource_id:'node',generation:1},recipe_ref:{recipe_id:'health',version:'1',digest:'synthetic'},not_before:'2026-10-26T00:00:00Z',expires_at:'2026-11-05T00:00:00Z',capabilities:[]};
 DB.db.prepare('INSERT OR IGNORE INTO grants VALUES(?,1,0,?)').run('grant',JSON.stringify(policy));
 const env={DB,PUBLIC_ORIGIN:'https://lab.example',AUDIENCE:'audit-test',MACHINE_KEYS:JSON.stringify({key:{principal_id:'trusted',grant_id:'grant',generation:1,secret_hex:'ab'.repeat(32),expires_at:policy.expires_at}})};
 let nonce=0;
 async function req(path='/api/usage',authenticated=false,body){
  const method=body===undefined?'GET':'POST',raw=body??'',headers={'content-type':'application/json'};
  if(authenticated){const n=(++nonce).toString(16).padStart(32,'0'),ts=String(T/1000);Object.assign(headers,{'x-lab-key-id':'key','x-lab-time':ts,'x-lab-nonce':n,'x-lab-signature':await sign('ab'.repeat(32),env.AUDIENCE,'key',1,method,path,ts,n,raw)});}
  const response=await handle(new Request(env.PUBLIC_ORIGIN+path,{method,headers,...(body===undefined?{}:{body})}),env,T);
  return {status:response.status,audit:response.headers.get('X-Cloud-Lab-Audit'),data:await response.json()};
 }
 return {DB,env,req};
}

test('RA records correlated refusals without claimed identity, path parameters or secrets',async t=>{
 const f=fixture(t),sentinel='SECRET_NOT_FOR_AUDIT';
 const request=new Request('https://lab.example/api/commands/'+sentinel+'/artifact?token='+sentinel,{headers:{'X-Lab-Key-Id':sentinel,'Authorization':'Bearer '+sentinel,'Cookie':sentinel}});
 const response=await handle(request,f.env,T),body=await response.json();
 assert.equal(response.status,403);assert.equal(response.headers.get('X-Cloud-Lab-Audit'),'persisted');
 assert.deepEqual({...auditRows(f.DB)[0]},{request_id:body.request_id,observed_at:T,method:'GET',route:'artifact',status:403,code:'SCOPE_DENIED',authenticated:0});
 assert.equal(JSON.stringify(auditRows(f.DB)).includes(sentinel),false);
});
test('RA marks authentication only after credential and grant checks complete',async t=>{
 const f=fixture(t);const authenticated=await f.req('/api/usage',true);
 assert.equal(authenticated.status,403);assert.equal(authenticated.audit,'persisted');
 assert.equal(auditRows(f.DB)[0].authenticated,1);
 f.DB.db.exec("UPDATE grants SET revoked=1 WHERE id='grant'");
 const revoked=await f.req('/api/usage',true);
 assert.equal(revoked.data.code,'GRANT_REVOKED');assert.equal(revoked.audit,'persisted');
 assert.equal(auditRows(f.DB).find(r=>r.request_id===revoked.data.request_id).authenticated,0);
});
test('RA rejects malformed bodies and methods with fixed categories and no body content',async t=>{
 const f=fixture(t);
 const r=await f.req('/api/runner/report',true,'{"SECRET":"hidden","SECRET":"hidden"}');
 assert.equal(r.status,422);assert.equal(r.audit,'persisted');
 const unsupported=await handle(new Request('https://lab.example/private-secret',{method:'DELETE'}),f.env,T);
 assert.equal(unsupported.status,405);assert.equal(unsupported.headers.get('X-Cloud-Lab-Audit'),'persisted');
 const rows=auditRows(f.DB);assert.equal(rows.find(r=>r.status===405).method,'OTHER');assert.equal(rows.find(r=>r.status===405).route,'other');
 assert.equal(JSON.stringify(rows).includes('SECRET'),false);assert.equal(JSON.stringify(rows).includes('hidden'),false);
});
test('RA success and infrastructure errors never masquerade as durable rejections',async t=>{
 const f=fixture(t),ok=await f.req('/api/authorization/self',true,'{}');assert.equal(ok.status,200);assert.equal(ok.audit,null);assert.equal(auditRows(f.DB).length,0);
 const original=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{if(sql.includes('FROM grants'))throw Error('private DB failure');return original(sql);};
 const failure=await f.req('/api/usage',true);assert.equal(failure.status,503);assert.equal(failure.audit,'not_applicable');assert.equal(failure.data.code,'TEMPORARILY_UNAVAILABLE');assert.equal(auditRows(f.DB).length,0);
});
test('RA unavailable audit storage preserves original refusal and never claims persistence',async t=>{
 for(const mode of ['missing','write-failure']){
  const f=fixture(t);if(mode==='missing')f.DB.db.exec('DROP TABLE rejection_audit');
  else{const original=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{if(sql.includes('rejection_audit'))throw Error('SECRET storage failure');return original(sql);};}
  const r=await f.req();assert.equal(r.status,401);assert.equal(r.data.code,'UNAUTHENTICATED');assert.equal(r.data.retryable,false);assert.equal(r.audit,'unavailable');assert.ok(r.data.request_id);assert.equal(JSON.stringify(r).includes('SECRET'),false);
 }
});
test('RA last audit slot is atomic, full retains history and does not block authorized success',async t=>{
 const f=fixture(t);
 f.DB.db.exec("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<9999) INSERT INTO rejection_audit SELECT printf('seed-%05d',x),0,'GET','other',401,'UNAUTHENTICATED',0 FROM n");
 const before=auditRows(f.DB),out=await Promise.all([f.req(),f.req()]);
 assert.deepEqual(out.map(r=>r.audit).sort(),['full','persisted']);assert.ok(out.every(r=>r.status===401));
 assert.equal(auditRows(f.DB).length,10000);assert.deepEqual(auditRows(f.DB).filter(r=>r.request_id.startsWith('seed-')),before);
 const later=await f.req('/api/usage',true);assert.equal(later.status,403);assert.equal(later.audit,'full');
 assert.equal((await f.req('/api/authorization/self',true,'{}')).status,200);
 assert.equal(f.DB.db.prepare('SELECT count(*) n FROM commands').get().n,0);
});
test('RA rejection survives SQLite close/reopen and preserves all original business rows',async t=>{
 const path=join(mkdtempSync(join(process.env.AGENT_EVIDENCE_DIR??tmpdir(),'ra-durable-')),'audit.sqlite');
 const db=new DatabaseSync(path);db.exec(readFileSync(new URL('../apps/control/migrations/0001.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO grants VALUES('old',1,1,'{}'); INSERT INTO schedules VALUES('health-minute',1,0,'old',NULL); INSERT INTO firings VALUES('health-minute',1,123,'skipped_grant')");
 const tables=['grants','commands','schedules','firings','nonces'];const before=tables.map(name=>db.prepare('SELECT * FROM '+name).all());db.close();
 const f=fixture(t,path);const r=await f.req();assert.equal(r.audit,'persisted');
 f.DB.close();f.DB.close=()=>{};
 const reopened=new SQLiteD1(path);t.after(()=>reopened.close());assert.equal(auditRows(reopened)[0].request_id,r.data.request_id);
 assert.deepEqual(tables.map(name=>reopened.db.prepare('SELECT * FROM '+name+(name==='grants'?" WHERE id='old'":'')).all()),before);
});

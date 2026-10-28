import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLocalLab } from '../tools/local.mjs';
import { makeSubmission } from '../apps/control/public/dashboard.mjs';
import { RECIPE_BYTES } from '../apps/control/worker/protocol.mjs';
function runPython(config,mode='--once'){return new Promise((resolve,reject)=>{const p=spawn('python3',[fileURLToPath(new URL('../adapters/node-health/runner.py',import.meta.url)),'--config',config,mode,'--allow-loopback-http'],{stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.once('error',reject);p.once('exit',code=>resolve({code,output}));});}
test('browser submit → real HTTP Python OS collector → D1 SQL → result/artifact → same key retry',async()=>{
 assert.ok(process.env.AGENT_BUILD_DIR,'integration requires shared workspace launcher');
 const directory=await mkdtemp(join(process.env.AGENT_BUILD_DIR,'cloudlab-'));
 const lab=await createLocalLab(directory);
 try{
  const bootstrap=await (await fetch(lab.base_url+'/api/bootstrap')).json();
  const payload=JSON.stringify(makeSubmission(bootstrap,bootstrap.now,'integration-1'));
  const post=body=>fetch(lab.base_url+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json','Origin':lab.base_url,'X-Cloud-Lab':'1'},body});
  const submit=await post(payload);assert.equal(submit.status,202);const command=(await submit.json()).command;
  const run=await runPython(join(directory,'runner.json'));assert.equal(run.code,0,run.output);
  const record=(await (await fetch(lab.base_url+'/api/commands/'+command.command_id)).json()).command;
  assert.equal(record.delivery,'result_recorded');assert.equal(record.result.validation.status,'passed');assert.ok(['healthy','unhealthy'].includes(record.result.health));
  const artifact=await (await fetch(lab.base_url+'/api/commands/'+command.command_id+'/artifact')).json();assert.equal(artifact.checks.collector,'ok');assert.ok(artifact.metrics.cpu_count>0);
  assert.equal((await (await post(payload)).json()).command.command_id,command.command_id);
  assert.equal((await runPython(join(directory,'runner.json'))).code,0);
  assert.equal(lab.DB.db.prepare('SELECT count(*) n FROM commands').get().n,1);
  const html=await fetch(lab.base_url+'/');assert.equal(html.status,200);assert.match(html.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.match(await html.text(),/Cloud Lab/);
  assert.equal((await fetch(lab.base_url+'/dashboard.mjs')).status,200);
 }finally{await lab.close();}
});
test('registry file digest source matches executable exact bytes',async()=>assert.equal(await readFile(new URL('../recipes/node-health.json',import.meta.url),'utf8'),RECIPE_BYTES));

test('self inspection CLI traverses real HTTP HMAC Worker and leaves journal and business state untouched',async()=>{
 assert.ok(process.env.AGENT_BUILD_DIR);const directory=await mkdtemp(join(process.env.AGENT_BUILD_DIR,'self-auth-'));
 const lab=await createLocalLab(directory);
 try{
  const snapshot=()=>['grants','commands','schedules'].map(t=>lab.DB.db.prepare('SELECT * FROM '+t).all());const before=snapshot();
  const run=await runPython(join(directory,'runner.json'),'--authorization-status');assert.equal(run.code,0,run.output);
  const out=JSON.parse(run.output);assert.equal(out.source,'worker_self');assert.equal(out.runner_stop_at,null);assert.equal(out.deadline_complete,false);
  const cfg=JSON.parse(await readFile(join(directory,'runner.json'),'utf8'));
  for(const value of [cfg.secret_hex,cfg.credential_id,cfg.base_url])assert.ok(!run.output.includes(value));
  await assert.rejects(access(join(directory,'runner.sqlite')));await assert.rejects(access(join(directory,'runner.sqlite.lock')));
  assert.deepEqual(snapshot(),before);assert.equal(lab.DB.db.prepare('SELECT count(*) n FROM nonces').get().n,1);
  const human=await fetch(lab.base_url+'/api/authorization/self',{method:'POST',headers:{'Content-Type':'application/json','Origin':lab.base_url,'X-Cloud-Lab':'1'},body:'{}'});assert.equal(human.status,403);
  const keys=JSON.parse(lab.env.MACHINE_KEYS);keys['local-runner'].revoked=true;lab.env.MACHINE_KEYS=JSON.stringify(keys);
  const denied=await runPython(join(directory,'runner.json'),'--authorization-status');assert.equal(denied.code,1);assert.match(denied.output,/authorization inspection unavailable/);
  assert.ok(!denied.output.includes(cfg.secret_hex));assert.deepEqual(snapshot(),before);
 }finally{await lab.close();}
});

test('integrated observation correlates real HTTP self, SQLite grants and kernel resident socket',async()=>{
 assert.ok(process.env.AGENT_BUILD_DIR);const directory=await mkdtemp(join(process.env.AGENT_BUILD_DIR,'integrated-'));
 const lab=await createLocalLab(directory);
 try{
  const cfg=JSON.parse(await readFile(join(directory,'runner.json'),'utf8'));
  const common=JSON.parse(lab.DB.db.prepare('SELECT policy FROM grants WHERE id=?').get('local-runner').policy);
  for(const role of ['human','bot','runner','scheduler']){
   const policy={...common,principal_id:'local-'+role,max_timeout_seconds:10,
    capabilities:role==='runner'?['dispatch:claim','runs:report']:role==='scheduler'?['commands:submit','node:health:read']:['commands:read']};
   lab.DB.db.prepare('INSERT INTO grants VALUES(?,1,0,?) ON CONFLICT(id) DO UPDATE SET policy=excluded.policy').run('local-'+role,JSON.stringify(policy));
  }
  const keys=JSON.parse(lab.env.MACHINE_KEYS);keys['local-bot']={...keys['local-runner'],principal_id:'local-bot',grant_id:'local-bot'};lab.env.MACHINE_KEYS=JSON.stringify(keys);
  // Management settings are synthetic for the loopback transport. The existing
  // harness still presents HTTPS to the unchanged Worker authentication code.
  for(const role of ['bot','runner'])await writeFile(join(directory,role+'.json'),JSON.stringify({...cfg,credential_id:'local-'+role,journal_path:join(directory,role+'.sqlite'),cloudflare_access_client_id:'synthetic-client',cloudflare_access_client_secret:'synthetic-secret'}),{mode:0o600});
  const token='12345678-1234-4234-8234-123456789abd',database='12345678-1234-4234-8234-123456789abc';
  await writeFile(join(directory,'profile.json'),JSON.stringify({schema_version:'cloudlab.authorization-source.v1',account_id:'a'.repeat(32),target:{worker_name:'cloud-lab',database_id:database},grant_ids:Object.fromEntries(['human','bot','runner','scheduler'].map(role=>[role,'local-'+role])),service_token_ids:{bot:token,runner:token}}),{mode:0o600});
  await writeFile(join(directory,'integration.json'),JSON.stringify({bindings:[{name:'DB',type:'d1',id:database},{name:'PUBLIC_ORIGIN',type:'plain_text',text:lab.base_url},{name:'AUDIENCE',type:'plain_text',text:cfg.audience}],token:{id:token,client_id:'synthetic-client',enabled:true,expires_at:common.expires_at}}),{mode:0o600});
  const business=()=>['grants','commands','schedules'].map(t=>lab.DB.db.prepare('SELECT * FROM '+t).all()),before=business();
  const run=await new Promise((resolve,reject)=>{const p=spawn('python3',[fileURLToPath(new URL('./fixtures/integrated_observation.py',import.meta.url)),directory],{stdio:['ignore','pipe','pipe'],timeout:20000});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.once('error',reject);p.once('exit',code=>resolve({code,output}));});
  assert.equal(run.code,0,run.output);const {report,management_requests}=JSON.parse(run.output);
  assert.equal(management_requests,10);assert.deepEqual(report.source_outcomes,{bot:'verified',runner:'verified',resident:'verified'});
  assert.equal(report.collection_integrity_verified,true);assert.equal(report.live_verified,false);
  assert.equal(report.subjects.find(row=>row.role==='runner').deadline_complete,true);
  assert.deepEqual(business(),before);assert.equal(lab.DB.db.prepare('SELECT count(*) n FROM nonces').get().n,2);
  for(const value of [cfg.secret_hex,directory,lab.base_url,'synthetic-secret','synthetic-client','local-runner'])assert.ok(!run.output.includes(value));
 }finally{await lab.close();}
});

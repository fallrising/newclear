import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
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

// Real loopback HTTP, Chrome and dispatcher exec; synthetic failed provider only.
// Usage: node scripts/check_console_retry_grant_browser.mjs private-evidence-directory
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const lab=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true,mode:0o700});
const require=createRequire(path.join(lab,'vendor/agent-office/package.json')),{chromium}=require('playwright-core');
const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'office-retry-grant-'));
const rawParent='pi-work-SYNTHSECRET_0123456789abcdef';
const ref=name=>'r1_'+createHash('sha256').update('agent-office-result-ref\0'+'1\0'+name).digest('hex').slice(0,32);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=text=>assert(!/(?<![A-Za-z0-9])SYNTHSECRET_[0-9a-f]{16}(?![A-Za-z0-9])/.test(text));
const children=new Set(),report={status:'starting',model_requests:0,scenarios:{},harness_root:root};
async function stop(child){
 if(child.exitCode!==null||child.signalCode!==null){children.delete(child);return;}
 const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');
 let timer;await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('harness cleanup timeout')),10000);})]).finally(()=>clearTimeout(timer));
 children.delete(child);
}
async function start(scenario,directory){
 const child=spawn(process.env.PYTHON||'python3',[path.join(lab,'scripts/console_retry_grant_harness.py'),'--directory',directory,'--scenario',scenario],{stdio:['ignore','pipe','pipe']});children.add(child);
 let errors='';child.stderr.on('data',chunk=>errors+=chunk);
 let timer;const url=await new Promise((resolve,reject)=>{
  let text='';child.stdout.on('data',chunk=>{text+=chunk;const end=text.indexOf('\n');if(end>=0)resolve(text.slice(0,end));});
  child.once('exit',code=>reject(Error(`harness startup exit ${code}: ${errors}`)));
  timer=setTimeout(()=>reject(Error('harness startup timeout')),10000);
 }).finally(()=>clearTimeout(timer));
 const entry=new URL(url);assert.equal(entry.hostname,'127.0.0.1');
 return {child,url,origin:entry.origin,token:new URLSearchParams(entry.hash.slice(1)).get('token'),directory};
}
async function api(h,method,route,body){
 const response=await fetch(h.origin+route,{method,headers:{Authorization:'Bearer '+h.token,Origin:h.origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
 const text=await response.text();safe(text);return {status:response.status,data:JSON.parse(text)};
}
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 for(const scenario of ['fresh','wrong','revoked','retry']){
  const directory=path.join(root,scenario);let h=await start(scenario,directory);
  const context=await browser.newContext({serviceWorkers:'block'}),errors=[],external=[];
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===h.origin)return route.continue();external.push(route.request().url());return route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.name));
  await page.goto(h.url);await page.locator('#runs tr').first().waitFor();safe(await page.locator('body').innerText());
  const row=page.locator(`#runs tr[data-ref="${ref(rawParent)}"]`);
  const pending=page.waitForResponse(response=>response.url().endsWith('/api/plan'));
  await row.getByRole('button',{name:/重試計畫/}).click();const plan=await (await pending).json();safe(JSON.stringify(plan));
  await page.locator('#plan-card').waitFor({state:'visible'});
  assert((await page.locator('#plan-fields').innerText()).includes('明確重試 1 / 2'));
  assert((await page.locator('#plan-fields').innerText()).includes('重試來源'));
  if(scenario==='fresh'||scenario==='wrong'){
   assert.equal(plan.executable,false);assert(await page.locator('#execute').isDisabled());
   assert.equal((await api(h,'POST','/api/execute',{plan_id:plan.plan_id})).status,409);
   assert.equal((await api(h,'GET','/api/state')).data.jobs.length,0);
   report.scenarios[scenario]={wrong_scope_blocked:true};
  }else if(scenario==='revoked'){
   const rejected=page.waitForResponse(response=>response.url().endsWith('/api/execute'));
   page.once('dialog',dialog=>dialog.accept());await page.locator('#execute').click();
   assert.equal((await rejected).status(),409);
   await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('授權'));
   assert.equal((await api(h,'GET','/api/state')).data.jobs.length,0);
   report.scenarios[scenario]={revocation_before_execute_blocked:true};
  }else{
   const parent=path.join(directory,'lab/runs',rawParent);
   const original=Object.fromEntries(['result.json','attempt.json','workspace/input.json'].map(name=>[name,digest(fs.readFileSync(path.join(parent,name)))]));
   page.once('dialog',dialog=>dialog.dismiss());await page.locator('#execute').click();
   assert.equal((await api(h,'GET','/api/state')).data.jobs.length,0);
   page.once('dialog',dialog=>dialog.accept());await page.locator('#execute').click();
   await page.waitForFunction(()=>document.querySelector('#jobs .job')?.dataset.phase==='finished');
   let state=(await api(h,'GET','/api/state')).data;
   assert.equal(state.jobs.length,1);assert.equal(state.jobs[0].authorization_consumed,true);
   assert.equal(state.jobs[0].result.status,'failed');assert.equal(state.jobs[0].result.retry.attempt,1);
   assert.equal(state.jobs[0].result.artifact.status,'unavailable');
   assert.equal(state.remote_grants.pending.length,0);
   const childInput=fs.readFileSync(path.join(directory,'lab/runs/pi-work-harness-child/workspace/input.json'),'utf8');
   assert.deepEqual(JSON.parse(childInput),JSON.parse(fs.readFileSync(path.join(parent,'workspace/input.json'),'utf8')));
   for(const [name,sha] of Object.entries(original))assert.equal(digest(fs.readFileSync(path.join(parent,name))),sha);
   assert.equal((await api(h,'POST','/api/execute',{plan_id:plan.plan_id})).status,409);
   await page.reload();await page.locator('#runs tr').first().waitFor();assert.equal((await api(h,'GET','/api/state')).data.jobs.length,1);
   await page.screenshot({path:path.join(out,'retry-result.png'),fullPage:true});
   await stop(h.child);const completed=JSON.parse(fs.readFileSync(path.join(directory,'harness-final.json'),'utf8'));
   assert.equal(completed.spawn_count,1);assert.equal(completed.all_direct_children_exited,true);
   h=await start('retry',directory);await page.goto(h.url);await page.locator('#runs tr').first().waitFor();
   state=(await api(h,'GET','/api/state')).data;assert.equal(state.jobs.length,0);assert.equal(state.remote_grants.pending.length,0);
   assert.equal(state.results.runs.find(r=>r.ref===ref('pi-work-harness-child')).retry.attempt,1);
   await page.locator(`#runs tr[data-ref="${ref('pi-work-harness-child')}"]`).getByRole('button',{name:/重試計畫/}).click();
   await page.locator('#plan-card').waitFor({state:'visible'});assert(await page.locator('#execute').isDisabled());
   report.scenarios.retry={confirmation_cancel_preserves_grant:true,dispatch_exec_once:true,inherited_slot_and_retry_receipt:true,original_evidence_unchanged:true,same_fixture:true,failed_not_inference:true,refresh_and_restart_no_rerun:true};
  }
  safe(await page.locator('body').innerText());assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await context.close();await stop(h.child);
  const final=JSON.parse(fs.readFileSync(path.join(directory,'harness-final.json'),'utf8'));
  assert.equal(final.spawn_count,0);assert.equal(final.all_direct_children_exited,true);assert.equal(final.server_thread_alive,false);
 }
 report.status='passed';report.external_browser_requests=0;report.page_errors=0;
}finally{
 for(const child of children)await stop(child);
 await browser.close();fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report));

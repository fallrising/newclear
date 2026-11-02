// Explicit live browser acceptance. Local Strata inference and Pi loopback faults only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
assert(process.argv.length===5&&process.argv[4]==='--local-acceptance','Usage: node check_office_console_browser.mjs server.log private-output-dir --local-acceptance');
const lab=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(process.argv[3]);
fs.mkdirSync(out,{recursive:true,mode:0o700});
const entry=fs.readFileSync(process.argv[2],'utf8').split('\n')[0],url=new URL(entry),token=new URLSearchParams(url.hash.slice(1)).get('token');
assert(url.hostname==='127.0.0.1'&&token);const origin=url.origin;
const require=createRequire(path.join(lab,'vendor/agent-office/package.json')),{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms)),headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:origin};
const api=async(endpoint,body)=>{const response=await fetch(origin+endpoint,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
const state=async()=>{const r=await api('/api/state');assert.equal(r.status,200);return r.data;};
async function until(check,seconds=120){const deadline=Date.now()+seconds*1000;while(Date.now()<deadline){const s=await state();const value=check(s);if(value)return value;await delay(500);}throw Error('Acceptance timed out');}
const report={status:'starting',remote_model_calls:0,local_model_inference:false,external_browser_requests:0,browser_errors:0};
let localJob;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1100},serviceWorkers:'block'}),allowed=new Set([origin]),external=[],errors=[];
 await context.route('**/*',route=>{if(allowed.has(new URL(route.request().url()).origin))return route.continue();external.push('external_request');return route.abort();});
 context.on('page',page=>page.on('pageerror',e=>errors.push(e.name)));
 const page=await context.newPage();
 await page.goto(entry);await page.locator('#runs tr').first().waitFor();assert(!page.url().includes('token='));
 for(const provider of ['opencode','grok','pi','cursor']){
  await page.locator(`[data-provider="${provider}"]`).click();const response=page.waitForResponse(r=>r.url().endsWith('/api/detect')&&r.request().method()==='POST');
  await page.locator('#detect').click();const r=await response;assert.equal(r.status(),200);assert((await r.json()).cli_compatible);
 }
 report.four_provider_detect=true;
 await page.locator('[data-provider="grok"]').click();
 let planned=page.waitForResponse(r=>r.url().endsWith('/api/plan'));await page.locator('#plan').click();let plan=await (await planned).json();assert.equal(plan.executable,false);assert(await page.locator('#execute').isDisabled());
 assert.equal((await api('/api/execute',{plan_id:plan.plan_id})).status,409);report.remote_execution_blocked=true;
 await page.locator('[data-provider="pi"]').click();await page.selectOption('#mode','http_429');
 planned=page.waitForResponse(r=>r.url().endsWith('/api/plan'));await page.locator('#plan').click();plan=await (await planned).json();assert.equal(plan.executable,true);
 const execute=page.waitForResponse(r=>r.url().endsWith('/api/execute'));await page.locator('#execute').click();const piJob=(await (await execute).json()).job_id;
 assert.equal((await api('/api/execute',{plan_id:plan.plan_id})).status,409);
 await page.reload();await page.locator(`[data-job="${piJob}"]`).waitFor();assert.equal((await state()).jobs.length,1);
 const pi=await until(s=>s.jobs.find(j=>j.id===piJob&&j.phase==='finished'));
 assert.equal(pi.result.status,'failed');assert.equal(pi.result.failure_check_passed,true);assert.equal(pi.result.cleanup_verified,true);
 report.pi_run=pi.run_id;report.refresh_without_rerun=true;report.duplicate_execute_blocked=true;
 console.log(JSON.stringify({phase:'pi_browser_dispatch_passed'}));
 await page.locator('[data-provider="opencode"]').click();await page.selectOption('#mode','terminal');
 planned=page.waitForResponse(r=>r.url().endsWith('/api/plan'));await page.locator('#plan').click();plan=await (await planned).json();assert.equal(plan.plan.keep_open,true);assert.equal(plan.plan.remote,false);
 const localExecute=page.waitForResponse(r=>r.url().endsWith('/api/execute'));await page.locator('#execute').click();localJob=(await (await localExecute).json()).job_id;
 const ready=await until(s=>{const job=s.jobs.find(j=>j.id===localJob);if(job?.phase==='finished')throw Error('Local task ended before terminal readiness: '+job.run_id);return job?.terminal_url?job:null;},300);report.local_run=ready.run_id;
 allowed.add(new URL(ready.terminal_url).origin);await page.locator(`[data-job="${localJob}"] .terminal`).waitFor();
 const native=await Promise.all([context.waitForEvent('page'),page.locator(`[data-job="${localJob}"] .terminal`).click()]).then(r=>r[0]);
 await native.waitForURL('**/lite');
 await native.getByPlaceholder('Your name').waitFor({state:'visible'});
 await native.getByPlaceholder('Your name').fill('Console Lab');await native.getByRole('button',{name:'Come on in'}).click();
 await native.getByRole('button',{name:/open its terminal/}).first().click();await native.locator('.xterm').first().waitFor();
 const local=path.join(lab,'runs',ready.run_id),artifact=fs.readFileSync(path.join(local,'workspace/result.json'));
 await native.reload();await native.getByRole('button',{name:/open its terminal/}).first().waitFor();
 assert.equal(fs.readFileSync(path.join(local,'workspace/result.json')).toString(),artifact.toString());
 report.native_terminal_opened=true;report.native_refresh_preserved_artifact=true;
 await page.reload();await page.locator(`[data-job="${localJob}"] .terminal`).waitFor();
 assert.equal((await state()).jobs.length,2);
 await page.screenshot({path:path.join(out,'console-live.png'),fullPage:true});
 await native.close();
 const reopened=await Promise.all([context.waitForEvent('page'),page.locator(`[data-job="${localJob}"] .terminal`).click()]).then(r=>r[0]);
 await reopened.waitForURL('**/lite');await reopened.getByRole('button',{name:/open its terminal/}).first().waitFor();await reopened.close();report.native_terminal_reopened=true;
 const stopped=page.waitForResponse(r=>r.url().endsWith('/api/stop'));await page.locator(`[data-job="${localJob}"] .stop`).click();assert.equal((await stopped).status(),200);
 const finished=await until(s=>s.jobs.find(j=>j.id===localJob&&j.phase==='finished'),90);
 assert.equal(finished.result.cleanup_verified,true);assert.equal(finished.result.artifact.status,'verified');
 assert.equal((await state()).active_job,null);
 const saved=JSON.parse(fs.readFileSync(path.join(local,'result.json'),'utf8'));
 assert.equal(saved.model_inference_verified,true);assert.deepEqual(saved.cleanup_errors,[]);
 report.local_model_inference=true;report.local_status=finished.result.status;report.artifact_sha256=finished.result.artifact.sha256;
 report.local_runner_elapsed_seconds=saved.elapsed_s;report.stop_and_cleanup_verified=true;
 await page.locator('#refresh').click();await page.selectOption('#filter','opencode');
 await page.locator('#runs tr').filter({hasText:ready.run_id}).getByRole('button',{name:'查看結果'}).click();
 assert((await page.locator('#detail').innerText()).includes(finished.result.artifact.sha256));
 assert.deepEqual(JSON.parse(await page.locator('#detail pre').innerText()),finished.result.artifact.content);
 report.result_detail_verified=true;await page.screenshot({path:path.join(out,'console-result.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.status='passed';report.jobs=2;report.runs=(await state()).results.runs.length;
 fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}catch(error){report.status='failed';report.error=String(error);fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});throw error;
}finally{
 try{const current=await state();if(current.active_job){await api('/api/stop',{job_id:current.active_job});await until(s=>!s.active_job,60);}}catch{}
 await browser.close();fs.writeFileSync(path.join(out,'stop'),'stop\n');
}

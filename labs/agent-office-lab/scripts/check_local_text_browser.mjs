// Explicit local Strata text-task acceptance. Loads a real local model; no paid calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
assert(process.argv.length===5&&process.argv[4]==='--local-acceptance','Usage: node check_local_text_browser.mjs server.log private-output-dir --local-acceptance');
const lab=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(process.argv[3]);
fs.mkdirSync(out,{recursive:true,mode:0o700});
const entry=fs.readFileSync(process.argv[2],'utf8').split('\n')[0],url=new URL(entry),token=new URLSearchParams(url.hash.slice(1)).get('token');
assert(url.hostname==='127.0.0.1'&&token);const origin=url.origin;
const require=createRequire(path.join(lab,'vendor/agent-office/package.json')),{chromium}=require('playwright-core');
let browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms)),headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:origin};
const api=async(endpoint,body)=>{const r=await fetch(origin+endpoint,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
const state=async()=>{const r=await api('/api/state');assert.equal(r.status,200);return r.data;};
async function until(check,seconds=90){const end=Date.now()+seconds*1000;while(Date.now()<end){const value=check(await state());if(value)return value;await delay(200);}throw Error('Local text task acceptance timed out');}
const report={status:'starting',model_inference:false,remote_model_calls:0};
try{
 let context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});const external=[],errors=[];
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push('external');return route.abort();});
 let page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));await page.goto(entry);
 await page.locator('[data-provider="opencode"]').click();await page.selectOption('#mode','text');
 await page.locator('#project option').waitFor({state:'attached'});await page.selectOption('#project','project-1');
 const prompt='Read source/brief.md. Write output.md as a concise launch checklist with the owner, deadline and blocker from the source. Use a heading and three bullets. Do not invent facts.';
 await page.locator('#prompt').fill(prompt);
 const planned=page.waitForResponse(r=>r.url().endsWith('/api/plan'));await page.locator('#plan').click();const plan=await(await planned).json();
 assert(plan.executable&&plan.plan.task==='local_text'&&!plan.plan.remote);assert.deepEqual(plan.plan.source_files,['brief.md']);
 assert.equal(plan.plan.prompt,prompt);report.custom_prompt_and_source_plan=true;
 const executed=page.waitForResponse(r=>r.url().endsWith('/api/execute'));await page.locator('#execute').click();const jobId=(await(await executed).json()).job_id;
 assert.equal((await api('/api/execute',{plan_id:plan.plan_id})).status,409);report.duplicate_execute_blocked=true;
 await page.reload();await page.locator(`[data-job="${jobId}"]`).waitFor();assert.equal((await state()).jobs.length,1);report.refresh_without_rerun=true;
 await browser.close();report.browser_closed_during_inference=true;
 const job=await until(s=>s.jobs.find(j=>j.id===jobId&&j.phase==='finished'),600);
 report.run=job.run_id;assert.equal(job.exit_code,0);assert.equal(job.result.status,'completed');assert.equal(job.result.task_kind,'local_text');
 assert.equal(job.result.content_review_required,true);assert.equal(job.result.cleanup_verified,true);assert.equal(job.result.artifact.kind,'text');
 const saved=JSON.parse(fs.readFileSync(path.join(lab,'runs',job.run_id,'result.json'),'utf8'));
 assert.equal(saved.model_inference_verified,true);assert.equal(saved.source_snapshot_unchanged,true);assert.deepEqual(saved.cleanup_errors,[]);
 for(const term of ['Mira','Friday','docs review'])assert(job.result.artifact.text.toLowerCase().includes(term.toLowerCase()));
 assert(!saved.text_tools.some(e=>!['read','write'].includes(e.tool)));
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push('external');return route.abort();});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));await page.goto(entry);
 await page.locator(`[data-job="${jobId}"] button`).filter({hasText:'查看本次結果'}).click();
 assert.equal((await state()).jobs.length,1);report.browser_reopened_without_rerun=true;
 const detail=await page.locator('#detail').innerText();assert(detail.includes('內容仍需你確認')&&detail.includes(job.result.artifact.sha256));
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下載 output.md'}).click();
 const download=await downloaded;assert.equal(download.suggestedFilename(),'output.md');const downloadedPath=path.join(out,'downloaded.md');await download.saveAs(downloadedPath);
 assert.equal(fs.readFileSync(downloadedPath,'utf8'),job.result.artifact.text);report.download_matches_artifact=true;
 await page.locator('#detail').screenshot({path:path.join(out,'text-result.png')});
 report.status='passed';report.runner_elapsed_seconds=saved.elapsed_s;report.model_inference=true;
 report.artifact_sha256=job.result.artifact.sha256;report.source_snapshot_unchanged=true;report.content_facts_verified=true;
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 report.cleanup_verified=true;report.external_browser_requests=external.length;report.browser_errors=errors.length;report.result_detail_verified=true;
 report.runs=(await state()).results.runs.length;console.log(JSON.stringify(report));
}catch(error){report.status='failed';report.error=String(error);throw error;
}finally{
 try{const s=await state();if(s.active_job){await api('/api/stop',{job_id:s.active_job});await until(x=>!x.active_job,60);}}catch{}
 await browser.close();fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});fs.writeFileSync(path.join(out,'stop'),'stop\n');
}

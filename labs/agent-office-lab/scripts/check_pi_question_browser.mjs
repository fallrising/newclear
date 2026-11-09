// Explicit real Pi native question acceptance; confirm UI only, no model inference.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
assert(process.argv.length===5&&process.argv[4]==='--local-acceptance','Usage: node check_pi_question_browser.mjs server.log private-output-dir --local-acceptance');
const lab=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(process.argv[3]);
fs.mkdirSync(out,{recursive:true,mode:0o700});
const entry=fs.readFileSync(process.argv[2],'utf8').split('\n')[0],url=new URL(entry),token=new URLSearchParams(url.hash.slice(1)).get('token');
assert(url.hostname==='127.0.0.1'&&token);const origin=url.origin;
const require=createRequire(path.join(lab,'vendor/agent-office/package.json')),{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms)),headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:origin};
const api=async(endpoint,body)=>{const r=await fetch(origin+endpoint,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
const state=async()=>{const r=await api('/api/state');assert.equal(r.status,200);return r.data;};
async function until(check,seconds=90){const end=Date.now()+seconds*1000;while(Date.now()<end){const value=check(await state());if(value)return value;await delay(200);}throw Error('Pi question acceptance timed out');}
const report={status:'starting',model_inference:false,remote_model_calls:0};
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),external=[],errors=[];
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push('external');return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));await page.goto(entry);
 await page.locator('[data-provider="pi"]').click();await page.selectOption('#mode','question');
 const planned=page.waitForResponse(r=>r.url().endsWith('/api/plan'));await page.locator('#plan').click();const plan=await(await planned).json();
 assert(plan.executable&&plan.plan.native_question_check&&!plan.plan.remote);assert.equal(plan.plan.limits.provider_request_cap,0);assert.equal(plan.plan.limits.output_tokens_per_request_cap,0);
 const executed=page.waitForResponse(r=>r.url().endsWith('/api/execute'));await page.locator('#execute').click();const jobId=(await(await executed).json()).job_id;
 assert.equal((await api('/api/execute',{plan_id:plan.plan_id})).status,409);report.duplicate_execute_blocked=true;
 await page.reload();await page.locator(`[data-job="${jobId}"]`).waitFor();assert.equal((await state()).jobs.length,1);report.refresh_without_rerun=true;
 const job=await until(s=>s.jobs.find(j=>j.id===jobId&&j.phase==='finished'));
 report.run=job.run_id;assert.equal(job.exit_code,0);assert.equal(job.result.status,'stopped');assert.equal(job.result.question_check_passed,true);
 assert.equal(job.result.cleanup_verified,true);assert.equal(job.result.artifact.status,'unavailable');assert.equal((await state()).active_job,null);
 const saved=JSON.parse(fs.readFileSync(path.join(lab,'runs',job.run_id,'result.json'),'utf8'));
 assert.equal(saved.result_kind,'native_question_check');assert.equal(saved.question_check_passed,true);assert.equal(saved.model_inference_verified,false);
 assert.equal(saved.external_requests,0);assert.equal(saved.client_requests,0);assert.deepEqual(saved.requests,[]);assert.deepEqual(saved.remote_usage,{requests:0,output_tokens:0});
 assert.equal(saved.remaining_owned_processes,0);assert.deepEqual(saved.cleanup_errors,[]);assert(!fs.existsSync(path.join(lab,'runs',job.run_id,'workspace/result.json')));
 assert.equal((await api('/api/plan',{retry_id:job.run_id})).status,409);report.retry_rejected=true;
 await page.locator(`[data-job="${jobId}"] button`).filter({hasText:'查看本次結果'}).waitFor();
 await page.locator(`[data-job="${jobId}"] button`).filter({hasText:'查看本次結果'}).click();
 const detail=await page.locator('#detail').innerText();assert(detail.includes('原生問答確認檢查通過')&&detail.includes('無模型推論'));
 assert(!detail.includes('完成且產物已核對'));await page.screenshot({path:path.join(out,'question-result.png'),fullPage:true});
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 report.status='passed';report.cleanup_verified=true;report.external_browser_requests=external.length;report.browser_errors=errors.length;report.result_detail_verified=true;report.runs=(await state()).results.runs.length;console.log(JSON.stringify(report));
}catch(error){report.status='failed';report.error=String(error);throw error;
}finally{
 try{const s=await state();if(s.active_job){await api('/api/stop',{job_id:s.active_job});await until(x=>!x.active_job,60);}}catch{}
 await browser.close();fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});fs.writeFileSync(path.join(out,'stop'),'stop\n');
}

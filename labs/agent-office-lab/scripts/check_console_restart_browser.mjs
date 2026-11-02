// Real process/HTTP/browser acceptance on a private synthetic lab; no provider or model launch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
assert(process.argv.length===3,'Usage: node check_console_restart_browser.mjs private-output-dir');
const lab=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),scripts=path.join(lab,'scripts'),out=path.resolve(process.argv[2]);
fs.mkdirSync(out,{recursive:true,mode:0o700});
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'office-restart-')),env={...process.env,PYTHONPATH:scripts};delete env.LAB_EXECUTION_SLOT_FD;
const require=createRequire(path.join(lab,'vendor/agent-office/package.json')),{chromium}=require('playwright-core');
const report={status:'starting',provider_launches:0,model_inference:false},children=[];
let server,holder,browser,origin,token;
const serverCode=`import signal,sys\nfrom pathlib import Path\nfrom office_console import Console,serve\na=Console(Path(sys.argv[1]));s=serve(a)\nprint(f'http://127.0.0.1:{s.server_port}/#token={a.token}',flush=True)\ndef stop(*_): raise KeyboardInterrupt()\nsignal.signal(signal.SIGTERM,stop)\ntry: s.serve_forever()\nexcept KeyboardInterrupt: pass\nfinally: a.close();s.server_close()`;
function child(code){const p=spawn('python3',['-c',code,fixture],{env,stdio:['ignore','pipe','pipe']});children.push(p);return p;}
function firstLine(p){return new Promise((resolve,reject)=>{let data='';const timer=setTimeout(()=>{cleanup();reject(Error('Helper readiness timeout'));},10000);const received=chunk=>{data+=chunk;if(data.includes('\n')){cleanup();resolve(data.split('\n')[0]);}};const exited=()=>{cleanup();reject(Error('Helper exited before readiness'));};const cleanup=()=>{clearTimeout(timer);p.stdout.off('data',received);p.off('exit',exited);p.off('error',failed);};const failed=()=>exited();p.stdout.on('data',received);p.once('exit',exited);p.once('error',failed);});}
async function stop(p,signal='SIGTERM'){if(!p||p.exitCode!==null||p.signalCode!==null)return;const exited=once(p,'exit');p.kill(signal);await Promise.race([exited,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Owned helper did not exit')),10000);t.unref();})]);}
async function start(){server=child(serverCode);const entry=await firstLine(server),u=new URL(entry);origin=u.origin;token=new URLSearchParams(u.hash.slice(1)).get('token');assert(token&&u.hostname==='127.0.0.1');return entry;}
const api=async(route,body)=>{const r=await fetch(origin+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
const state=async()=>{const r=await api('/api/state');assert.equal(r.status,200);assert(!JSON.stringify(r.data).includes(fixture));return r.data;};
async function refresh(page,expected){await page.locator('#refresh').click();await page.locator(`#execution-state[data-state="${expected}"]`).waitFor();assert.equal((await state()).shared_execution.status,expected);}
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:950},serviceWorkers:'block'}),errors=[],external=[];
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push('external');return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));await page.goto(await start());
 await page.locator('#execution-state[data-state="available"]').waitFor();assert(!fs.existsSync(path.join(fixture,'state/dispatch')));
 await page.locator('[data-provider="pi"]').click();await page.selectOption('#mode','cancel');
 const planned=page.waitForResponse(r=>r.url().endsWith('/api/plan'));await page.locator('#plan').click();const plan=await(await planned).json();assert(await page.locator('#execute').isEnabled());
 holder=child(`import sys,time\nfrom pathlib import Path\nfrom execution_slot import execution_slot,mark_started\nwith execution_slot(Path(sys.argv[1])):\n mark_started()\n print('ready',flush=True)\n time.sleep(120)`);assert.equal(await firstLine(holder),'ready');
 const journal=path.join(fixture,'state/dispatch/active.json'),bytes=fs.readFileSync(journal),mtime=fs.statSync(journal).mtimeMs;
 await refresh(page,'busy');assert(await page.locator('#execute').isDisabled());
 assert.equal((await api('/api/execute',{plan_id:plan.plan_id})).data.error,'execution_busy');
 assert.equal((await state()).jobs.length,0);assert.equal((await api('/api/stop',{job_id:'foreign'})).status,409);
 assert.deepEqual(fs.readFileSync(journal),bytes);report.external_lock_blocks_stale_plan=true;
 await stop(holder,'SIGKILL');await refresh(page,'cleanup_unconfirmed');
 assert.deepEqual(fs.readFileSync(journal),bytes);report.process_crash_preserves_journal=true;
 const oldToken=token;await stop(server);await page.goto(await start());assert.notEqual(token,oldToken);
 await page.locator('#execution-state[data-state="cleanup_unconfirmed"]').waitFor();await page.reload();
 await page.locator('#execution-state[data-state="cleanup_unconfirmed"]').waitFor();
 assert.equal((await state()).jobs.length,0);assert.deepEqual(fs.readFileSync(journal),bytes);assert.equal(fs.statSync(journal).mtimeMs,mtime);
 assert.equal((await api('/api/acknowledge',{})).status,404);report.restart_and_refresh_do_not_unlock_or_rerun=true;
 const blocked=await api('/api/plan',{provider:'pi',mode:'cancel'});assert.equal((await api('/api/execute',{plan_id:blocked.data.plan_id})).data.error,'cleanup_unconfirmed');
 await page.screenshot({path:path.join(out,'restart-blocked.png'),fullPage:true});
 assert(holder.signalCode==='SIGKILL'); // The only fixture worker is confirmed exited before acknowledgement.
 execFileSync('python3',['-c','import sys\nfrom pathlib import Path\nfrom execution_slot import acknowledge_stopped\nassert acknowledge_stopped(Path(sys.argv[1]))',fixture],{env});
 await refresh(page,'available');assert.equal((await state()).jobs.length,0);assert(!fs.existsSync(journal));
 const archives=fs.readdirSync(path.dirname(journal)).filter(x=>x.startsWith('acknowledged-'));assert.equal(archives.length,1);assert.deepEqual(fs.readFileSync(path.join(path.dirname(journal),archives[0])),bytes);
 report.explicit_ack_preserves_archive_and_does_not_launch=true;
 fs.writeFileSync(journal,'PRIVATE_BROKEN_JOURNAL',{mode:0o600});await refresh(page,'unavailable');
 const bad=await api('/api/plan',{provider:'pi',mode:'cancel'});assert.equal((await api('/api/execute',{plan_id:bad.data.plan_id})).data.error,'execution_state_unavailable');
 assert(!JSON.stringify((await state())).includes('PRIVATE_BROKEN_JOURNAL'));assert.equal(fs.readFileSync(journal,'utf8'),'PRIVATE_BROKEN_JOURNAL');
 report.unreadable_state_blocks_without_exposure=true;await page.screenshot({path:path.join(out,'state-unavailable.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.browser_errors=0;report.external_requests=0;report.status='passed';
}finally{
 await browser?.close();await stop(holder);await stop(server);
 report.remaining_owned_processes=children.filter(p=>p.exitCode===null&&p.signalCode===null).length;
 fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}

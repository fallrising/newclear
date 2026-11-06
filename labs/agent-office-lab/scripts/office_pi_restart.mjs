// Real Pi host SIGKILL, repeated restart, and explicit no-prompt reconnect.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fork,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readPiSession} from './pi_session_evidence.mjs';

const lab=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(process.argv[2]);
assert(out.startsWith(lab+'/runs/'));
const workspace=path.join(out,'workspace'),require=createRequire(path.join(lab,'vendor/agent-office/package.json'));
const WebSocket=require('ws'),config={out,workspace,password:randomBytes(24).toString('base64url'),port:0};
const report={status:'starting',provider:'pi',model:'deepseek/deepseek-flash',model_inference_verified:false,states:[]};
const save=()=>fs.writeFileSync(path.join(out,'office-result.json'),JSON.stringify(report,null,2)+'\n');
const events=()=>fs.existsSync(path.join(out,'pi-events.jsonl'))?fs.readFileSync(path.join(out,'pi-events.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let host,ws,worker,failure,browser,closing,ready;const generations=[],hooks=[];
async function until(check,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(failure)throw failure;if(check())return;await sleep(100);}throw Error('Pi host restart timed out');}
async function rpc(t,extra={}){
 const current=host,request=randomBytes(8).toString('hex');
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{current.off('message',receive);reject(Error('Host IPC timed out'));},5000);
  function receive(msg){if(msg.t===t&&msg.request===request){clearTimeout(timer);current.off('message',receive);resolve(msg);}}
  current.on('message',receive);current.send({t,request,...extra});
 });
}
async function start(){
 ready=undefined;worker=undefined;failure=undefined;
 const file=path.join(out,'pi-host-config.json');fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});
 host=fork(path.join(lab,'scripts/office_pi_host.mjs'),[file],{stdio:['ignore','ignore','pipe','ipc']});generations.push(host.pid);
 host.stderr.on('data',data=>fs.appendFileSync(path.join(out,'host.stderr.log'),data));
 host.on('message',msg=>{if(msg.t==='ready')ready=msg;if(msg.t==='error')failure=Error(msg.error);if(msg.t==='hook')hooks.push(msg.payload);});
 await until(()=>ready);config.port=ready.port;
 const base=`http://127.0.0.1:${ready.port}`,login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:config.password})});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];let welcome=false;
 ws=new WebSocket(base.replace('http','ws')+'/ws?name=Lab&lite=1',{headers:{cookie,origin:base}});
 ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.t==='welcome'){welcome=true;worker=msg.workers?.[0];}if(msg.t==='worker.update')worker=msg.worker;
  if(worker&&['welcome','worker.update'].includes(msg.t))report.states.push({generation:generations.length,status:worker.status,task:worker.labTaskState});});
 await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});await until(()=>welcome,10000);return {base,cookie};
}
async function stop(){
 ws?.close();ws=undefined;
 if(!host||host.exitCode!==null||host.signalCode!==null){host=undefined;return;}
 const current=host;current.send({t:'stop'});await until(()=>current.exitCode!==null||current.signalCode!==null,15000);host=undefined;
}
async function cleanup(){if(closing)return closing;closing=(async()=>{await browser?.close();browser=undefined;await stop();report.cleanup_completed=true;save();})();return closing;}
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{report.status='interrupted';void cleanup().then(()=>process.exit(1));});
save();
try{
 const git=args=>execFileSync('git',args,{cwd:workspace,stdio:'pipe'});git(['init','-b','main']);git(['add','.']);git(['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Lab fixture','-c','user.email=fixture@example.invalid','commit','-m','Synthetic Pi restart fixture']);
 await start();ws.send(JSON.stringify({t:'worker.spawn',deskId:'desk-1',provider:'pi',model:report.model,prompt:'Read input.json and write result.json with the marker and sum of values. Use only read and write.',worktree:false}));
 await until(()=>worker?.status==='needs_input'&&events().some(e=>e.type==='agent_settled')&&hooks.some(e=>e.type==='error'));
 const id=worker.id,session=worker.sessionId,before=readPiSession(workspace,id,session),snap=await rpc('inspect');
 const owners=snap.owners.filter(o=>o.workerId===id&&o.agent&&o.cwd===workspace);assert.equal(owners.length,1);
 report.session_id=session;report.history_prefix_sha256=before.sha256;report.history_entries_before=before.entries;
 const first=host;
 fs.writeFileSync(path.join(out,'.host-target.tmp'),JSON.stringify({pid:first.pid,session,status:worker.status}),{flag:'wx',mode:0o600});
 fs.renameSync(path.join(out,'.host-target.tmp'),path.join(out,'host-crash-target.json'));
 await until(()=>first.signalCode==='SIGKILL',15000);ws.close();host=undefined;
 await start();
 const gone=pid=>{try{process.kill(pid,0);return false;}catch(e){return e.code==='ESRCH';}};
 await until(()=>owners.every(o=>gone(o.pid)),10000);report.old_processes_exited=true;
 async function parked(){
  const state=await rpc('inspect');assert.equal(state.owners.filter(o=>o.pid).length,0);assert.equal(state.workers.length,1);
  const w=state.workers[0];assert.equal(w.id,id);assert.equal(w.sessionId,session);assert.equal(w.status,'offline');assert.equal(w.labTaskState,'interrupted');
  assert(readPiSession(workspace,id,session).bytes.equals(before.bytes));assert.equal(events().filter(e=>e.type==='session_start').length,1);
  assert(!fs.existsSync(path.join(workspace,'result.json')));
 }
 await parked();await sleep(3000);await parked();report.crash_recovery_verified=true;
 await stop();const {base,cookie}=await start();await parked();report.repeated_restart_preserved=true;
 const {chromium}=require('playwright-core');browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),external=[],errors=[];
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===base)return route.continue();external.push('external');return route.abort();});
 const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base}]);
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.name));
 await page.goto(base+'/lite',{waitUntil:'networkidle'});await page.getByPlaceholder('Your name').fill('Local Lab');await page.getByRole('button',{name:'Come on in'}).click();
 await page.getByText(/interrupted ·/).first().waitFor();await page.reload();await page.getByText(/interrupted ·/).first().waitFor();await parked();
 await page.screenshot({path:path.join(out,'pi-host-interrupted.png'),fullPage:true});
 report.browser_interrupted_visible=true;report.browser_refresh_without_replay=true;
 // Clicking before the private one-shot gate is armed cannot launch a worker.
 ws.send(JSON.stringify({t:'worker.resume',workerId:id}));await sleep(500);await parked();
 const armed=await rpc('arm',{workerId:id,sessionId:session});assert.equal(armed.armed,true);
 await page.locator('.lite-card').filter({hasText:'interrupted ·'}).click();
 await until(()=>worker?.status==='idle'&&worker.sessionId===session&&events().filter(e=>e.type==='session_start').length===2);
 ws.send(JSON.stringify({t:'worker.resume',workerId:id}));assert.equal((await rpc('arm',{workerId:id,sessionId:session})).armed,false);
 await sleep(3000);const after=readPiSession(workspace,id,session),recorded=events();
 assert(after.bytes.subarray(0,before.bytes.length).equals(before.bytes));
 assert.equal(recorded.filter(e=>e.type==='session_start').length,2);assert.equal(recorded.filter(e=>e.type==='assistant_end').length,1);
 assert(recorded.every(e=>e.session===session&&e.provider==='deepseek'&&e.model==='deepseek-flash'));assert(hooks.every(e=>e.sessionId===session));
 assert(!recorded.some(e=>e.type==='tool_call'));assert(!report.states.some(e=>e.status==='done'));assert(!fs.existsSync(path.join(workspace,'result.json')));
 const resumed=(await rpc('inspect')).owners.filter(o=>o.workerId===id&&o.agent);assert.equal(resumed.length,1);assert.notEqual(resumed[0].pid,owners[0].pid);
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 report.external_browser_requests=external.length;report.browser_errors=errors.length;report.history_entries_after=after.entries;
 report.session_history_preserved=true;report.native_resume_verified=true;report.new_process_same_session=true;
 report.no_automatic_replay_observation_ms=3000;report.host_generations=generations.length;
 report.distinct_host_processes=new Set(generations).size===3;assert(report.distinct_host_processes);report.status='stopped';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;
}finally{try{await cleanup();}catch(error){report.status='failed';report.cleanup_completed=false;report.cleanup_error=String(error);process.exitCode=1;}save();}
process.exit(process.exitCode||0);

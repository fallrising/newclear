// Optional real-browser/local-workerd qualification. Synthetic identities only.
// Supply existing Chromium and Miniflare toolchain paths; never installs anything.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,appendFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {recipeRef,sign} from '../apps/control/worker/protocol.mjs';

const [chromePath,toolchain,fontDirectory]=process.argv.slice(2);
assert(chromePath&&toolchain&&process.env.AGENT_BUILD_DIR&&process.env.AGENT_EVIDENCE_DIR,'Use shared launcher and existing browser/toolchain');
const root=fileURLToPath(new URL('../',import.meta.url));
const evidence=process.env.AGENT_EVIDENCE_DIR;
const directory=mkdtempSync(join(process.env.AGENT_BUILD_DIR,'dashboard-'));
const browserEnv={...process.env};
if(fontDirectory){
 const xml=resolve(fontDirectory).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 browserEnv.FONTCONFIG_FILE=join(directory,'fonts.conf');
 writeFileSync(browserEnv.FONTCONFIG_FILE,`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include>/etc/fonts/fonts.conf</include><dir>${xml}</dir><cachedir>${directory}/font-cache</cachedir></fontconfig>`,{flag:'wx'});
}
const require=createRequire(resolve(toolchain,'package.json'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const stamp=n=>new Date(n).toISOString().replace(/\.\d{3}Z$/,'Z');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sourceHashes=Object.fromEntries(['index.html','styles.css','dashboard.mjs'].map(name=>[name,createHash('sha256').update(readFileSync(join(root,'apps/control/public',name))).digest('hex')]));
const issuer='https://browser-fixture.cloudflareaccess.com',origin='https://browser.example',audience='browser-fixture';
const now=Date.now(),ref=await recipeRef(),secret='ab'.repeat(32);
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'browser-fixture'};
const b64=x=>Buffer.from(x).toString('base64url');
const prefix=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify({iss:issuer,aud:[audience],sub:'human',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+600}));
const jwt=prefix+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(prefix)));
const common={workspace_id:'browser-lab',resource_ref:{resource_id:'browser-node',generation:1},recipe_ref:ref,not_before:stamp(now-1000),expires_at:stamp(now+3600000),max_timeout_seconds:30,max_output_bytes:16384};
const caps=['commands:read','commands:submit','commands:cancel-request','node:health:read','artifact:read'];
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',cf:false,telemetry:{enabled:false},resourcePersistencePath:join(directory,'state'),resourceTmpPath:join(directory,'tmp'),workers:[{
 name:'browser-qualification',modulesRoot:join(root,'apps/control/worker'),modules:['index.mjs','auth.mjs','protocol.mjs'].map(name=>({type:'ESModule',path:join(root,'apps/control/worker',name)})),compatibilityDate:'2026-10-26',d1Databases:{DB:'browser'},
 assets:{directory:join(root,'apps/control/public'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},
 outboundService:async request=>{assert.equal(request.url,issuer+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});},
 bindings:{HEALTH_SCHEDULE:JSON.stringify({revision:1,interval_minutes:15,not_before:stamp(Math.floor(now/60000)*60000),expires_at:stamp(now+3600000)}),ACCESS_CONFIG:JSON.stringify({issuer,audience,subjects:{human:{principal_id:'human',grant_id:'human'}}}),PUBLIC_ORIGIN:origin,AUDIENCE:audience,MACHINE_KEYS:JSON.stringify({runner:{principal_id:'runner',grant_id:'runner',generation:1,secret_hex:secret,expires_at:common.expires_at}})}
}]}));
let usageCalls=0,usageMode='normal';
let tamperArtifact=false;
let browser,session,server,mode='normal',dropSubmit=false,apiCalls=0,loginHits=0,submitBodies=[],errors=[],checks=[],pending=new Map(),serial=0,holdArtifactStatus=null,heldArtifact=null,downloadsStarted=0;
const children=[];
function send(method,params={},target=session){
 return new Promise((resolve,reject)=>{
  const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP deadline: '+method));},7000);
  pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
  browser.stdio[3].write(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})})+'\0');
 });
}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression){const end=Date.now()+10000;while(Date.now()<end){if(await evaluate(expression))return;await wait(50);}throw new Error('Browser condition timed out: '+expression);}
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function screenshot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(evidence,name+'.png'),Buffer.from(r.data,'base64'),{flag:'wx'});}
async function refresh(){await click('#refresh');await until('!document.querySelector("#refresh").disabled');}
async function python(config){
 const child=spawn('python3',[join(root,'adapters/node-health/runner.py'),'--config',config,'--once','--allow-loopback-http'],{stdio:['ignore','pipe','pipe']});children.push(child);
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);assert.equal(code,0,output);
}
try {
 const db=await mf.getD1Database('DB');
 async function runnerRequest(path,body){
  const raw=JSON.stringify(body),time=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID().replaceAll('-','');
  const signature=await sign(secret,audience,'runner',1,'POST',path,time,nonce,raw);
  const response=await mf.dispatchFetch(origin+path,{method:'POST',body:raw,headers:{'Content-Type':'application/json','X-Lab-Key-Id':'runner','X-Lab-Time':time,'X-Lab-Nonce':nonce,'X-Lab-Signature':signature}});
  assert.equal(response.status,200);return response.json();
 }
 await db.batch(['0001.sql','0002.sql'].map(name=>readFileSync(join(root,'apps/control/migrations',name),'utf8')).join('\n').replace(/^--.*$/gm,'').split(';').filter(x=>x.trim()).map(x=>db.prepare(x)));
 for(const [id,capabilities] of [['human',caps],['runner',['dispatch:claim','runs:report','runs:reconcile']]])await db.prepare('INSERT INTO grants VALUES (?,1,0,?)').bind(id,JSON.stringify({...common,principal_id:id,capabilities})).run();
 await db.prepare('INSERT INTO grants VALUES (?,1,0,?)').bind('scheduler',JSON.stringify({...common,principal_id:'scheduler',capabilities:['commands:submit','node:health:read']})).run();
 await db.prepare('INSERT INTO schedules VALUES (?,1,0,?,NULL)').bind('health-minute','scheduler').run();
 server=http.createServer(async(req,res)=>{
  try{
   if(req.headers.host!==`127.0.0.1:${server.address().port}`){res.writeHead(403);res.end();return;}
   if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
   if(req.url==='/login'){loginHits++;res.writeHead(200,{'Content-Type':'text/html'});res.end('<html>synthetic login</html>');return;}
   assert(['/','/styles.css','/dashboard.mjs','/api/bootstrap','/api/commands','/api/health-schedule','/api/usage','/api/runner/claim','/api/runner/report'].includes(req.url)||/^\/api\/commands\/[a-zA-Z0-9-]+(?:\/artifact|\/cancel)?$/.test(req.url));
   const chunks=[];let length=0;for await(const b of req){length+=b.length;assert(length<=32768);chunks.push(b);}const body=Buffer.concat(chunks);
   if(req.url.startsWith('/api/')){
    apiCalls++;assert(apiCalls<=300);
    if(req.url==='/api/usage'){usageCalls++;if(usageMode==='offline'){res.destroy();return;}}
    if(mode==='offline'){res.destroy();return;}
    if(mode==='html'||mode==='401'||mode==='403'){res.writeHead(mode==='html'?200:Number(mode),{'Content-Type':'text/html'});res.end('<html>'+('synthetic login '.repeat(3000))+'</html>');return;}
    if(mode==='redirect'){res.writeHead(302,{Location:'/login'});res.end();return;}
   }
   const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
   if(headers.has('origin')){assert.equal(headers.get('origin'),`http://127.0.0.1:${server.address().port}`);headers.set('origin',origin);}
   if(!headers.has('x-lab-key-id'))headers.set('Cf-Access-Jwt-Assertion',jwt);
   if(req.method==='POST'&&req.url==='/api/commands')submitBodies.push(body.toString());
   const response=await mf.dispatchFetch(origin+req.url,{method:req.method,headers,...(req.method==='POST'?{body}:{}),redirect:'manual'});
   let data=Buffer.from(await response.arrayBuffer());
   if(tamperArtifact&&req.url.endsWith('/artifact')&&response.status===200)data=Buffer.concat([data,Buffer.from(' ')]);
   if(req.url==='/api/usage'&&usageMode==='stale'&&response.status===200){const value=JSON.parse(data);value.observed_at=stamp(Date.now()-120000);value.application.rolling_24h.window_start_exclusive=stamp(Date.parse(value.observed_at)-86400000);data=Buffer.from(JSON.stringify(value));}
   if(req.url.endsWith('/artifact')&&holdArtifactStatus!==null){
    const status=holdArtifactStatus;holdArtifactStatus=null;
    await new Promise(resolve=>{heldArtifact={release:resolve};});heldArtifact=null;
    if(status===403){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'SCOPE_DENIED'}));return;}
   }
   if(dropSubmit&&req.method==='POST'&&req.url==='/api/commands'){assert.equal(response.status,202);res.destroy();return;}
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(data);
  }catch(error){errors.push('gateway: '+error.message);res.writeHead(500);res.end();}
 });
 server.requestTimeout=10000;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const config=join(directory,'runner.json');writeFileSync(config,JSON.stringify({base_url:base,audience,credential_id:'runner',generation:1,secret_hex:secret,journal_path:join(directory,'journal.sqlite'),workspace_id:common.workspace_id,resource_ref:common.resource_ref,recipe_ref:ref}),{mode:0o600,flag:'wx'});
 mkdirSync(join(directory,'profile'));
 // Synthetic loopback content only. CDP uses inherited pipes, never a network listener.
 browser=spawn(chromePath,['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-pipe','--user-data-dir='+join(directory,'profile'),'about:blank'],{env:browserEnv,stdio:['ignore','pipe','pipe','pipe','pipe']});
 browser.stderr.on('data',b=>appendFileSync(join(evidence,'browser-stderr.log'),b));browser.once('error',e=>errors.push(e.message));
 for(const pipe of [browser.stdio[3],browser.stdio[4]])pipe.on('error',e=>{errors.push('CDP pipe: '+e.message);for(const waiter of pending.values())waiter.reject(e);pending.clear();});
 browser.once('exit',code=>{for(const waiter of pending.values())waiter.reject(new Error('Browser exited: '+code));pending.clear();});
 let buffer='';browser.stdio[4].on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\0'))>=0){const raw=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!raw)continue;const m=JSON.parse(raw);if(m.id){const waiter=pending.get(m.id);pending.delete(m.id);if(waiter)(m.error?waiter.reject(new Error(JSON.stringify(m.error))):waiter.resolve(m.result));}else if(m.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(m.params.exceptionDetails));else if(m.method==='Browser.downloadWillBegin')downloadsStarted++;}});
 const version=await send('Browser.getVersion',{},null);
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base});await until('document.querySelector("#submit") && !document.querySelector("#submit").disabled');
 assert(await evaluate('document.querySelector("#schedule").textContent.includes("已停用") && document.querySelector("#schedule").textContent.includes("15 分鐘")'));
 checks.push('bounded schedule panel shows disabled15minute policy without liveness claim');
 assert.equal(usageCalls,0);await click('#usage-refresh');await until('!document.querySelector("#usage-refresh").disabled');
 assert(await evaluate('document.querySelector("#usage").textContent.includes("0 / 10000") && document.querySelector("#usage").textContent.includes("尚未接入")'));
 const usageBeforePoll=usageCalls;await wait(5200);assert.equal(usageCalls,usageBeforePoll,'five-second poll must not fetch usage');
 usageMode='stale';await click('#usage-refresh');await until('!document.querySelector("#usage-refresh").disabled');assert(await evaluate('document.querySelector("#usage").textContent.includes("過期")'));
 usageMode='offline';await click('#usage-refresh');await until('!document.querySelector("#usage-refresh").disabled');assert(await evaluate('document.querySelector("#usage").textContent.includes("未確認") && document.querySelector("#usage").textContent.includes("0 / 10000")'));
 usageMode='normal';await click('#usage-refresh');await until('!document.querySelector("#usage-refresh").disabled');
 checks.push('manual application usage uses actual Worker/D1, no five-second usage polling; injected old snapshot and lost response stay stale/unconfirmed, provider unknown');

 dropSubmit=true;await click('#submit');await until('!document.querySelector("#retry").hidden && !document.querySelector("#retry").disabled');
 assert(submitBodies.length>=1);assert.equal(new Set(submitBodies).size,1);assert.equal(await db.prepare('SELECT count(*) n FROM commands').first('n'),1);
 mode='401';await refresh();assert(await evaluate('!document.querySelector("#retry").hidden && document.querySelector("#retry").disabled'));
 mode='normal';await refresh();await until('!document.querySelector("#retry").disabled');
 for(const status of ['401','403']){
  mode=status;await click('#retry');
  await until('document.querySelector("#connection").textContent.includes("暫停")');
  assert(await evaluate('!document.querySelector("#retry").hidden && document.querySelector("#retry").disabled'),'retry POST auth failure must retain uncertain original submission');
  mode='normal';await refresh();await until('!document.querySelector("#retry").disabled');
 }
 const attemptsBeforeRetry=submitBodies.length;dropSubmit=false;
 await click('#retry');await until('document.querySelector("#retry").hidden && !document.querySelector("#submit").disabled');
 assert(submitBodies.length>attemptsBeforeRetry);assert.equal(new Set(submitBodies).size,1);assert.equal(await db.prepare('SELECT count(*) n FROM commands').first('n'),1);
 await python(config);await refresh();await until('document.querySelector("#commands").textContent.includes("已保存結果")');
 assert.equal(await db.prepare("SELECT json_extract(record,'$.result.validation.status') s FROM commands").first('s'),'passed');
 const completed=JSON.parse(await db.prepare('SELECT record FROM commands').first('record'));
 const downloads=join(evidence,'downloads');mkdirSync(downloads);
 await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true},null);
 await evaluate('[...document.querySelectorAll(".command-card button")].find(b=>b.textContent==="下載 JSON 成果").click()');
 const download=join(downloads,'node-health.json'),downloadDeadline=Date.now()+5000;
 while(!existsSync(download)&&Date.now()<downloadDeadline)await wait(50);
 assert.deepEqual(readFileSync(download),Buffer.from(completed.artifact));
 assert.equal('sha256:'+createHash('sha256').update(readFileSync(download)).digest('hex'),completed.result.artifact_sha256);
 checks.push('browser verifies SHA-256 and downloads exact original actual-collector artifact bytes');
 const beforeTamper=downloadsStarted;tamperArtifact=true;
 await evaluate('[...document.querySelectorAll(".command-card button")].find(b=>b.textContent==="下載 JSON 成果").click()');
 await until('document.querySelector("#message").textContent.includes("成果完整性核對失敗")');
 assert.equal(downloadsStarted,beforeTamper);assert.deepEqual(readFileSync(download),Buffer.from(completed.artifact));
 assert.equal(await evaluate('document.querySelectorAll(".command-card").length'),1);tamperArtifact=false;
 checks.push('browser rejects whitespace-tampered artifact without downloading or altering saved bytes');
 mode='403';await evaluate('[...document.querySelectorAll(".command-card button")].find(b=>b.textContent==="下載 JSON 成果").click()');
 await until('document.querySelectorAll(".command-card").length===0');
 assert(await evaluate('document.querySelector("#total-count").textContent==="—" && document.querySelector("#submit").disabled'));
 assert(await evaluate('!document.querySelector("#usage").textContent.includes("/ 10000") && document.querySelector("#usage-refresh").disabled'));
 checks.push('action-level revocation also clears application usage snapshot');
 mode='normal';await refresh();await until('!document.querySelector("#submit").disabled');
 assert(await evaluate('document.querySelector("#message").hidden'));
 checks.push('action-level403 clears authorization; uncertain submission survives401 and explicit revalidation with original bytes');
 for(const status of [200,403]){
  holdArtifactStatus=status;
  await evaluate('[...document.querySelectorAll(".command-card button")].find(b=>b.textContent==="下載 JSON 成果").click()');
  const deadline=Date.now()+5000;while(!heldArtifact&&Date.now()<deadline)await wait(20);assert(heldArtifact);
  mode='403';await refresh();mode='normal';await refresh();await until('!document.querySelector("#submit").disabled');
  const before=downloadsStarted;heldArtifact.release();await wait(400);
  assert(await evaluate('document.querySelectorAll(".command-card").length===1 && !document.querySelector("#submit").disabled && document.querySelector("#message").hidden'),'obsolete completion must not clear recovered session or replace messages');
  assert.equal(downloadsStarted,before,'obsolete success must not trigger a download');
 }
 checks.push('retry POST401/403 retains original identity; late artifact200/403 after revalidation is discarded without session/message/download changes');
 await click('#usage-refresh');await until('!document.querySelector("#usage-refresh").disabled');assert(await evaluate('document.querySelector("#usage").textContent.includes("1 / 10000")'));
 await screenshot('desktop-completed');checks.push('browser exact-body retry after stored-submit ACK loss; actual Worker/D1 + Python collector result');
 for(const width of [390,320]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true});
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'),'horizontal overflow at '+width);
  assert(await evaluate('document.querySelector("#refresh").getBoundingClientRect().height <= 48'),'refresh label should not wrap');
  await screenshot('mobile-'+width);
 }
 checks.push('390px and320px Chromium mobile viewport: no horizontal overflow');
 // Actual worker cancellation before dispatch: intention and terminal delivery stay distinct.
 await click('#submit');await until('document.querySelectorAll(".command-card").length===2');
 await evaluate('[...document.querySelectorAll(".command-card button")].find(b=>b.textContent==="要求取消").click()');await until('document.querySelector("#commands").textContent.includes("取消意圖")');
 assert.equal(await db.prepare("SELECT count(*) n FROM commands WHERE json_extract(record,'$.delivery')='cancelled_before_dispatch'").first('n'),1);
 checks.push('browser cancellation reaches actual Worker; no claim of process stopped');
 // Temporarily unavailable requests retain prior data, while auth failures clear it.
 mode='offline';await refresh();assert(await evaluate('document.querySelectorAll(".command-card").length===2 && document.querySelector("#submit").disabled'));
 mode='normal';await refresh();
 for(const failure of ['html','401','403','redirect']){
  mode=failure;await refresh();
  assert(await evaluate('document.querySelectorAll(".command-card").length===0 && document.querySelector("#total-count").textContent==="—" && document.querySelector("#submit").disabled'),'auth failure must clear cards/counts and disable actions: '+failure);
  const before=apiCalls;await wait(5200);assert.equal(apiCalls,before,'auth failure must stop polling');assert.equal(loginHits,0,'API must not follow login redirect');
  await screenshot('auth-'+failure);
  mode='normal';await refresh();await until('!document.querySelector("#submit").disabled');
 }
 checks.push('HTML/401/403/redirect clear all stale data, stop polls and recover only on explicit refresh; offline retains data');
 // Real elapsed time, not a forged browser/server clock: old observations must age offline.
 mode='offline';await refresh();
 await wait(Math.max(0,Date.parse(completed.result.finished_at)+32000-Date.now()));
 await until('document.querySelector("#commands").textContent.includes("觀測已過期")');
 await screenshot('offline-stale');checks.push('cached completed observation becomes stale after real30second budget while disconnected');
 mode='normal';await refresh();
 await click('#submit');await until('document.querySelectorAll(".command-card").length===3');
 const assignment=(await runnerRequest('/api/runner/claim',{})).assignment;
 await runnerRequest('/api/runner/report',{command_id:assignment.command_id,attempt_id:assignment.attempt.attempt_id,fence:assignment.attempt.fence,owner_outcome:'unknown',started_at:null,finished_at:null,artifact:null});
 await refresh();assert(await evaluate('document.querySelector("#unknown-count").textContent==="1" && document.querySelector("#commands").textContent.includes("對帳中，結果未知")'));
 assert.equal(await db.prepare('SELECT count(*) n FROM commands WHERE active=1').first('n'),1);
 await screenshot('unknown');checks.push('synthetic unknown runner report through actual Worker remains active and is visibly unknown');
 await db.prepare("UPDATE grants SET revision=revision+1,policy=? WHERE id='human'").bind(JSON.stringify({...common,principal_id:'human',capabilities:['commands:read']})).run();
 await refresh();assert(await evaluate('document.querySelector("#submit").disabled && document.querySelectorAll(".command-card button").length===0 && document.querySelectorAll(".command-card").length===3'));
 checks.push('read-only capability refresh retains history and removes submit/cancel/artifact controls');
 await db.prepare('UPDATE schedules SET enabled=1 WHERE id=?').bind('health-minute').run();
 const trigger=await (await mf.getWorker()).scheduled({scheduledTime:new Date(Math.floor(now/60000)*60000),cron:'*/15 * * * *'});
 assert.equal(trigger.outcome,'ok');
 await refresh();assert(await evaluate('document.querySelector("#schedule").textContent.includes("最近觸發") && /已有工作|錯過時段/.test(document.querySelector("#schedule").textContent)'));
 assert.equal(await db.prepare('SELECT count(*) n FROM commands').first('n'),3);
 await screenshot('schedule');checks.push('actual scheduled callback records overlap/misfire; read-only browser sees skipped trigger with unchanged unknown command');
 assert.deepEqual(errors,[]);
 writeFileSync(join(evidence,'browser.json'),JSON.stringify({status:'passed',scope:'local actual workerd/D1; synthetic JWT; Chromium viewport, not physical mobile or real Access',version,miniflare:require('miniflare/package.json').version,checks,sourceHashes,apiCalls,errors},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'passed',checks,version:version.product}));
}catch(error){
 if(browser&&session)try{await screenshot('failure');}catch{}
 writeFileSync(join(evidence,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,checks,errors},null,2)+'\n',{flag:'wx'});throw error;
}finally{
 if(heldArtifact)heldArtifact.release();
 for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');
 if(browser){browser.kill('SIGKILL');await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),wait(2000)]);}
 for(const waiter of pending.values())waiter.reject(new Error('Browser closed'));pending.clear();
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 await mf.dispose();
}

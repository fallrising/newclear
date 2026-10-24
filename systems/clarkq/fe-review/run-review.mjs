import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {open, mkdir, readFile, writeFile, readdir} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import net from 'node:net';
import {ORIGIN, childEnvironment, claimState, ownedPID, safeJSON, bounded, failureCode, signalCancellation, acquireOwned, cleanupStages} from './guards.mjs';
import {seed} from './api-fixture.mjs';
import {baseline} from './baseline.mjs';
import {journey} from './journey.mjs';
import {sharedCapture,reuseShared} from './shared-capture.mjs';
import {desktopHealth} from './desktop-health.mjs';

process.umask(0o077);
const here = dirname(fileURLToPath(import.meta.url));
const component = resolve(here,'..');
const id = process.env.FE_REVIEW_RUN_ID;
assert(/^[a-z][a-z0-9-]{1,60}$/.test(id ?? ''), 'REVIEW_RUN_ID');
const output = join(here,'runs',id);
const state = process.env.FE_REVIEW_STATE_DIR;
const key = randomBytes(32).toString('hex');
const mode=process.env.FE_REVIEW_MODE || 'continue';
assert(['baseline','final','continue'].includes(mode),'REVIEW_MODE');
const result = {id,mode,status:'running',startedAt:new Date().toISOString(),sourceHashes:{},cleanup:[]};
let child, browser, log, stage = 'preflight', cancelled = false, running, outputCreated = false;
const owned = new Set();
const captures=[];
const check = () => {assert(!cancelled,'REVIEW_INTERRUPTED');};
const setStage = value => {stage = value;check();};
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
function listenerAbsent() {
  return new Promise((resolve,reject)=>{
    const socket = net.connect({host:'127.0.0.1',port:8080});
    socket.setTimeout(1000);
    socket.once('connect',()=>{socket.destroy();resolve(false);});
    socket.once('error',error=>{socket.destroy();error.code === 'ECONNREFUSED' ? resolve(true) : reject(Error('REVIEW_PORT_UNKNOWN'));});
    socket.once('timeout',()=>{socket.destroy();reject(Error('REVIEW_PORT_TIMEOUT'));});
  });
}
async function stopOwned(target, grace=11000) {
  if (!target) return;
  const pid = ownedPID(target,owned);
  const exited = () => target.exitCode !== null || target.signalCode !== null;
  let forcedKill = false;
  if (!exited()) {try {process.kill(-pid,'SIGTERM');} catch(error) {if(error.code !== 'ESRCH')throw error;}}
  const deadline = Date.now()+grace;
  while(!exited() && Date.now()<deadline)await delay(50);
  if(!exited()) {forcedKill=true;process.kill(-pid,'SIGKILL');await bounded(async()=>{while(!exited())await delay(50);},2000);}
  let groupAbsent = false;
  try {process.kill(-pid,0);} catch(error) {if(error.code === 'ESRCH')groupAbsent=true;else throw error;}
  const exit={code:target.exitCode,signal:target.signalCode,forcedKill,groupAbsent};
  if(target===child)result.serviceExit=exit;
  else (result.captureExits??=[]).push(exit);
  assert(groupAbsent,'REVIEW_PROCESS_REMAINS');
}
async function main() {
  assert(process.getuid() !== 0,'REVIEW_NONROOT_REQUIRED');
  await claimState(state,id);
  await mkdir(output,{mode:0o700});
  outputCreated = true;
  assert(await listenerAbsent(),'REVIEW_PORT_OCCUPIED');
  for(const name of (await readdir(here)).filter(name=>name.endsWith('.mjs'))) result.sourceHashes['fe-review/'+name]=createHash('sha256').update(await readFile(join(here,name))).digest('hex');
  result.sourceHashes['internal/ui/index.html']=createHash('sha256').update(await readFile(join(component,'internal/ui/index.html'))).digest('hex');
  const binary = process.env.CLARKQ_BINARY;
  assert(binary === '/build/clarkq','REVIEW_BINARY_LOCATION');
  result.binarySHA256=createHash('sha256').update(await readFile(binary)).digest('hex');
  log = await open(join(state,'service.log'),'wx',0o600);
  check();
  child = spawn(binary,[],{cwd:state,env:childEnvironment(key,state),detached:true,stdio:['ignore',log.fd,log.fd]});
  owned.add(child);
  let spawnFailed = false;child.on('error',()=>{spawnFailed=true;});
  setStage('service-ready');
  const deadline=Date.now()+15000;let ready=false;
  while(Date.now()<deadline){check();assert(!spawnFailed && child.exitCode === null,'REVIEW_SERVICE_EXIT');try {const r=await fetch(ORIGIN+'/health',{signal:AbortSignal.timeout(1000),redirect:'error'});ready=r.status===200;await r.arrayBuffer();}catch{}if(ready)break;await delay(100);}
  assert(ready,'REVIEW_SERVICE_NOT_READY');
  const listeners=(await readFile('/proc/net/tcp','utf8')).trim().split('\n').slice(1).map(line=>line.trim().split(/\s+/)).filter(row=>row[3]==='0A' && row[1].endsWith(':1F90'));
  assert(listeners.length===1 && listeners[0][1]==='0100007F:1F90','REVIEW_NOT_LOOPBACK');
  result.loopbackListener=true;
  setStage('authenticated-seed');result.fixture=await seed(key,check);
  if(mode==='continue'){setStage('reuse-shared-geometry');await reuseShared(component,result);}
  if(mode==='final') {
    setStage('shared-capture');
    await sharedCapture(key,component,state,output,result,check,target=>{owned.add(target);captures.push(target);});
  }
  setStage('browser-launch');
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
  await acquireOwned(()=>chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,timeout:30000,args:['--no-sandbox','--disable-dev-shm-usage']}),value=>{browser=value;},()=>cancelled);
  check(); result.chromium=browser.version();
  if(mode==='continue'){setStage('desktop-health-diagnostic');await desktopHealth(browser,key,result,check);}
  await baseline(browser,key,output,result,check,setStage,mode!=='baseline');
  if(mode!=='baseline')await journey(browser,key,output,result,check,setStage);
  if(mode==='continue')assert(result.desktopHealth.classification.passed,'REVIEW_DESKTOP_HEALTH_UNRESOLVED');
  result.status='passed';result.scope=mode==='baseline'?'baseline measurements only; layout and focus findings are not acceptance':'original R2 M1–M3 candidate only; independent review, native gates and publication remain separate';
}
await (async()=>{
  const interruption=signalCancellation(process,()=>{cancelled=true;});
  try {
    running=main();await bounded(()=>Promise.race([running,interruption.promise]),165000);
  } catch(error) {
    result.status='failed';result.failure={stage,code:failureCode(error)};
    const site=String(error.stack??'').match(/(?:run-review|baseline|api-fixture|guards)\.mjs:\d+:\d+/);
    if(site)result.failure.site=site[0];
  } finally {
    cancelled=true;
    result.cleanup=await cleanupStages([
      ['settle',()=>running?.catch(()=>{}),35000],
      ['browser',()=>browser?.close(),5000],
      ['capture-processes',async()=>{for(const target of captures)await stopOwned(target,2000);},9000],
      ['service',()=>stopOwned(child),14000],
      ['listener',async()=>assert(await listenerAbsent(),'REVIEW_LISTENER_REMAINS'),1500],
      ['log',()=>log?.close(),1000],
    ]);
    if(result.cleanup.some(item=>!item.passed))result.status='failed';
    result.receivedSignal=interruption.signal();
    if(result.receivedSignal)result.status='failed';
    interruption.dispose();
    result.endedAt=new Date().toISOString();
    if(outputCreated)await writeFile(join(output,'result.json'),safeJSON(result,[key]),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({id,status:result.status,stage,cleanup:result.cleanup}));
    if(result.status!=='passed')process.exitCode=result.receivedSignal === 'SIGTERM' ? 143 : result.receivedSignal === 'SIGINT' ? 130 : 1;
  }
})();

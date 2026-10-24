import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {open,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import net from 'node:net';
import {ORIGIN,UPSTREAM,childEnvironment,claimState,ownedPID,safeJSON,bounded,failureCode,signalCancellation,acquireOwned,cleanupStages} from './guards.mjs';
import {createMock} from './mock-upstream.mjs';
import {authenticate,adminAPI,seed} from './fixture.mjs';
import {capturePages,viewports} from './browser-baseline.mjs';
import {createTUICapture} from './tui-capture.mjs';
import {sharedCapture} from './shared-capture.mjs';
import {reuseWeb} from './reuse-web.mjs';
import {reuseContinuation} from './reuse-continuation.mjs';
import {visualProvenance,desktopContrastPrior} from './visual-provenance.mjs';
import {desktopHealth} from './desktop-health.mjs';
import {journeys} from './journeys.mjs';
import {contrastReview} from './contrast-review.mjs';

process.umask(0o077);
const here=dirname(fileURLToPath(import.meta.url));const component=resolve(here,'..');
const id=process.env.FE_REVIEW_RUN_ID;assert(/^[a-z][a-z0-9-]{1,60}$/.test(id??''),'REVIEW_RUN_ID');
const state=process.env.FE_REVIEW_STATE_DIR;const output=join(here,'runs',id);
const admin=randomBytes(32).toString('hex');const upstreamKey=randomBytes(32).toString('hex');const secrets=[admin,upstreamKey];
const mode=process.env.FE_REVIEW_MODE||'repair';assert(['baseline','presentation','continuation','tui-only','journey-only','repair','visual','contrast-desktop'].includes(mode),'REVIEW_MODE');
const continuing=['continuation','tui-only','journey-only','repair','visual','contrast-desktop'].includes(mode);const runTUI=['presentation','continuation','tui-only','repair'].includes(mode);
const result={id,mode,status:'running',startedAt:new Date().toISOString(),sourceHashes:{},cleanup:[]};
let stage='preflight',cancelled=false,outputOwned=false,child,log,browser,authContext,mock,running,tui;
const captureChildren=[];
const owned=new Set();const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=()=>assert(!cancelled,'REVIEW_INTERRUPTED');const setStage=value=>{stage=value;check();};
function absent(port){return new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',e=>{socket.destroy();e.code==='ECONNREFUSED'?resolve(true):reject(Error('REVIEW_PORT_UNKNOWN'));});socket.once('timeout',()=>{socket.destroy();reject(Error('REVIEW_PORT_TIMEOUT'));});});}
async function stopService(target=child,grace=11000){
  if(!target)return;const pid=ownedPID(target,owned);const exited=()=>target.exitCode!==null||target.signalCode!==null;let forcedKill=false;
  if(!exited()){try{process.kill(-pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}
  const deadline=Date.now()+grace;while(!exited()&&Date.now()<deadline)await delay(50);
  if(!exited()){forcedKill=true;process.kill(-pid,'SIGKILL');await bounded(async()=>{while(!exited())await delay(50);},2000);}
  let groupAbsent=false;try{process.kill(-pid,0);}catch(e){if(e.code==='ESRCH')groupAbsent=true;else throw e;}
  const exit={code:target.exitCode,signal:target.signalCode,forcedKill,groupAbsent};if(target===child)result.serviceExit=exit;else(result.captureExits??=[]).push(exit);assert(groupAbsent,'REVIEW_PROCESS_REMAINS');
}
async function main(){
  assert(process.getuid()!==0,'REVIEW_NONROOT_REQUIRED');await claimState(state,id);
  await mkdir(output,{mode:0o700});outputOwned=true;
  for(const port of [20128,20129])assert(await absent(port),'REVIEW_PORT_OCCUPIED');
  const data=join(state,'synthetic-data');await mkdir(data,{mode:0o700});
  for(const name of (await readdir(here)).filter(name=>name.endsWith('.mjs')))result.sourceHashes['fe-review/'+name]=createHash('sha256').update(await readFile(join(here,name))).digest('hex');
  for(const name of (await readdir(join(component,'templates'))).filter(name=>name.endsWith('.html')||name==='style.css'))result.sourceHashes['templates/'+name]=createHash('sha256').update(await readFile(join(component,'templates',name))).digest('hex');
  result.sourceHashes['src/tui_app.rs']=createHash('sha256').update(await readFile(join(component,'src/tui_app.rs'))).digest('hex');
  const binary=process.env.POKER_BINARY;assert(binary==='/build/thinrouter','REVIEW_BINARY_LOCATION');
  result.binarySHA256=createHash('sha256').update(await readFile(binary)).digest('hex');
  if(['visual','contrast-desktop'].includes(mode)){setStage('visual-provenance');await visualProvenance(component,result);}
  else if(continuing){setStage('reuse-web-provenance');await reuseWeb(component,result);if(['repair','journey-only'].includes(mode))await reuseContinuation(component,result);}
  setStage('mock-listen');mock=createMock(upstreamKey);
  await new Promise((resolve,reject)=>{mock.server.once('error',()=>reject(Error('REVIEW_MOCK_LISTEN')));mock.server.listen(20129,'127.0.0.1',resolve);});check();
  log=await open(join(state,'service.log'),'wx',0o600);
  child=spawn(binary,['serve','--host','127.0.0.1','--port','20128','--data-dir',data,'--provider-base-override','siwc='+UPSTREAM+'/v1'],{cwd:state,env:childEnvironment(admin,state),detached:true,stdio:['ignore',log.fd,log.fd]});owned.add(child);
  let spawnFailed=false;child.on('error',()=>{spawnFailed=true;});
  setStage('service-ready');let ready=false;const deadline=Date.now()+20000;
  while(Date.now()<deadline){check();assert(!spawnFailed&&child.exitCode===null,'REVIEW_SERVICE_EXIT');try{const r=await fetch(ORIGIN+'/health',{signal:AbortSignal.timeout(1000),redirect:'error'});ready=r.status===200;await r.arrayBuffer();}catch{}if(ready)break;await delay(100);}
  assert(ready,'REVIEW_SERVICE_NOT_READY');
  const listeners=(await readFile('/proc/net/tcp','utf8')).trim().split('\n').slice(1).map(line=>line.trim().split(/\s+/)).filter(row=>row[3]==='0A');
  for(const port of [20128,20129]){const hex=port.toString(16).toUpperCase();const matches=listeners.filter(row=>row[1].endsWith(':'+hex));assert(matches.length===1&&matches[0][1]==='0100007F:'+hex,'REVIEW_LOOPBACK_LISTENER');}
  result.listeners={gatewayLoopback:true,mockLoopback:true};
  setStage('default-deny');
  for(const path of ['/admin/api/connections','/v1/models']){const r=await fetch(ORIGIN+path,{signal:AbortSignal.timeout(5000),redirect:'error'});assert(r.status===401,'REVIEW_UNAUTHENTICATED_ACCESS');await r.arrayBuffer();}
  assert(mock.counters.requests===0,'REVIEW_UNAUTHORIZED_UPSTREAM_CALL');result.defaultDeny={adminAPI:401,inferenceModels:401,upstreamRequests:0,bootstrap:false};
  if(runTUI){setStage('tui-empty');tui=createTUICapture(state,id,binary,data,output,secrets,result,check);await tui.capture('empty');}
  setStage('browser-launch');const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
  await acquireOwned(()=>chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,timeout:30000,args:['--no-sandbox','--disable-dev-shm-usage']}),value=>{browser=value;},()=>cancelled);
  result.chromium=browser.version();
  if(mode==='continuation'){setStage('desktop-health-probe');await desktopHealth(browser,result,check);assert(result.desktopHealth.classification.passed,'REVIEW_DESKTOP_HEALTH_UNKNOWN');}
  if(mode==='baseline')await capturePages(browser,null,[{id:'login',path:'/admin/login',heading:'Admin login'}],output,secrets,result,check,setStage);
  setStage('real-admin-login');authContext=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark',locale:'zh-TW',serviceWorkers:'block'});
  const auth=await authenticate(authContext,admin,secrets,check);result.adminSession=auth.sessionFlags;
  for(const kind of ['connections','routes','keys','usage']){const rows=await adminAPI(authContext,auth.csrf,'GET','/admin/api/'+kind,undefined,200,check);assert(rows.data.length===0,'REVIEW_DATABASE_NOT_EMPTY');}
  const storage=await authContext.storageState(); // RAM only during baseline; never receipt/public artifact.
  const emptyPages=[{id:'empty-connections',path:'/admin/connections',heading:'Connections',rows:0,text:'No connections yet.'},{id:'empty-routes',path:'/admin/routes',heading:'Routes',rows:0,text:'No routes yet.'},{id:'empty-usage',path:'/admin/usage',heading:'Usage',rows:0,text:'No requests yet.'},{id:'empty-keys',path:'/admin/keys',heading:'API Keys',rows:0}];
  if(!continuing)await capturePages(browser,storage,mode==='baseline'?emptyPages:emptyPages.filter(page=>page.id==='empty-keys'),output,secrets,result,check,setStage,[viewports[0]],{strict:mode==='presentation'});
  setStage('authenticated-api-seed');const fixture=await seed(authContext,auth.csrf,upstreamKey,secrets,result,check);
  assert(mock.counters.success===1&&mock.counters.errors===1&&mock.counters.rejected===0,'REVIEW_MOCK_COUNTS');result.mock={...mock.counters,kind:'local OpenAI-compatible synthetic API-key upstream; configured SIWC override unused; no provider integration claim'};
  const pages=[{id:'dashboard',path:'/admin',heading:'Dashboard'},{id:'connections',path:'/admin/connections',heading:'Connections',rows:10},{id:'routes',path:'/admin/routes',heading:'Routes',rows:10},{id:'keys',path:'/admin/keys',heading:'API Keys',rows:1},{id:'usage',path:'/admin/usage',heading:'Usage',rows:3},{id:'connection-edit',path:'/admin/connections/'+fixture.connectionID+'/edit',heading:'Edit connection',rows:10},{id:'route-edit',path:'/admin/routes/'+fixture.routeID+'/edit',heading:'Edit route',rows:10}];
  if(runTUI){setStage('tui-populated');await tui.capture('populated');}
  if(!continuing)await capturePages(browser,storage,pages,output,secrets,result,check,setStage,viewports,{strict:mode==='presentation',images:mode==='baseline'});
  if(mode==='visual')await capturePages(browser,storage,pages.filter(page=>page.id!=='dashboard'),output,secrets,result,check,setStage,viewports,{strict:true,images:true,tableReadability:true});
  if(mode==='presentation'){setStage('shared-capture');await sharedCapture(component,state,storage,pages,output,result,check,target=>{owned.add(target);captureChildren.push(target);});}
  if(['continuation','visual'].includes(mode)){setStage('contrast-observations');await contrastReview(browser,storage,pages,result,check);}
  if(mode==='contrast-desktop'){setStage('desktop-contrast-correction');const selected=await desktopContrastPrior(component,result);await contrastReview(browser,storage,pages,result,check,selected);}
  if(['continuation','journey-only','repair','visual'].includes(mode))await journeys(browser,admin,upstreamKey,secrets,output,result,check,setStage);
  result.status='passed';result.scope=continuing?'Only the explicitly recorded continuation phases; immutable prior Web matrix retains original binary and failure. Final independent review remains pending':mode==='baseline'?'baseline measurements only; no layout/accessibility acceptance; final shared capture, keyboard/error journeys and read-only TUI pending':'presentation candidate and TUI measurements only; full actual keyboard/error journeys and final acceptance remain pending';
}
const interruption=signalCancellation(process,()=>{cancelled=true;});
try {running=main();await bounded(()=>Promise.race([running,interruption.promise]),450000);}
catch(error){result.status='failed';result.failure={stage,code:failureCode(error)};const site=String(error.stack??'').match(/(?:run-review|fixture|browser-baseline|guards|mock-upstream|desktop-health|reuse-web|reuse-continuation|visual-provenance|navigation|journeys|contrast-review|tui-capture|shared-capture)\.mjs:\d+:\d+/);if(site)result.failure.site=site[0];}
finally {
  cancelled=true;
  result.cleanup=await cleanupStages([
    ['settle',()=>running?.catch(()=>{}),35000],
    ['auth-context',()=>authContext?.close(),5000],
    ['browser',()=>browser?.close(),5000],
    ['capture-processes',async()=>{for(const target of captureChildren)await stopService(target,2000);},9000],
    ['tui',()=>tui?.closeAll(),12000],
    ['gateway',()=>stopService(),14000],
    ['mock',()=>mock?new Promise((resolve,reject)=>{mock.server.close(error=>error?reject(error):resolve());mock.server.closeAllConnections();}):undefined,3000],
    ['listeners',async()=>{for(const port of [20128,20129])assert(await absent(port),'REVIEW_LISTENER_REMAINS');},2500],
    ['log',()=>log?.close(),1000],
  ]);
  result.receivedSignal=interruption.signal();interruption.dispose();
  if(result.receivedSignal||result.cleanup.some(row=>!row.passed))result.status='failed';
  result.endedAt=new Date().toISOString();if(mock)result.mockFinalCounters=mock.counters;
  if(outputOwned)await writeFile(join(output,'result.json'),safeJSON(result,secrets),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({id,status:result.status,stage,cleanup:result.cleanup}));
  if(result.status!=='passed')process.exitCode=result.receivedSignal==='SIGTERM'?143:result.receivedSignal==='SIGINT'?130:1;
}

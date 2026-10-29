/** T-0433 journeys-001: focused desktop journeys N01-N09 (SPEC-T006R-focused-journeys); evidence only, never canonical cells. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,lstatSync,existsSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {createConnection} from 'node:net';
import {createFixture,fixedAssets,api} from './fixture.mjs';
import {createTransport,allowedRequest} from './transport.mjs';
import {Lifecycle,privateState,bounded} from './lifecycle.mjs';
import {installFreshTrust} from './trust.mjs';
import {selectPhase} from './remaining-support.mjs';
import {tabTo,enter,measureDOM} from './baseline-support.mjs';
import {netError} from './conformance-browser-verdicts.mjs';
import {healthVerdict,canaryScan,journeyFrame,j01Verdict,j01FutureVerdict,j02RestartVerdict,j02InstanceVerdict,j03Verdict,j04Verdict,j05Verdict,j06LogoutVerdict,j06DisposeVerdict} from './journeys-browser-verdicts.mjs';
process.umask(0o077);
const life=new Lifecycle(),origin='https://127.0.0.1:8443',ports=[8443],sha=b=>createHash('sha256').update(b).digest('hex'),desktop=selectPhase(['desktop-recovery']).size;
const receipt={mode:'journeys-001',scope:'focused desktop journeys N01-N09 (J01-J06) on the review harness with its journey seams; not canonical cells; candidate until independent actual review',passed:false,stage:'PRECONDITION',checks:{},sourceHashes:{}};
const handlers=['SIGTERM','SIGINT'].map(name=>[name,()=>life.cancel(name)]);for(const [name,fn]of handlers)process.on(name,fn);const timeout=setTimeout(()=>life.cancel('deadline'),200000);
const safeError=e=>/^REVIEW_[A-Z0-9_]+$/.test(e?.message??'')?e.message:e?.name==='AssertionError'?'ASSERTION_FAILED':e?.name==='TimeoutError'?'BROWSER_TIMEOUT':'UNCLASSIFIED';
const expectedSources={"fixture.mjs":"8c828b21eeb34563ef64c9b81a9bdfca4f9ab0146382c5e43416d560a706e9de","transport.mjs":"9167d04e5b4937ec1aca3a6788b27b6e9b358f738f516bb3861a9877049b988f","lifecycle.mjs":"7f3f1dcda77c0587d57d23a01d8a59567b02ce0bb5e5ef1a366d0783a8d838d9","trust.mjs":"1f5f0f31ad493ccc3866cc18967f237518ed9e798624aafff4344a36ada738f5","baseline-support.mjs":"445a5fcd969654c20fbe5f6e97ce8c52d8cd1343cdbf27be64ef93d7044d0636","remaining-support.mjs":"e77cfd56ad10e6e1fc77e9c20536f0d3024cad9e2ff5a0dc304d76f18be44cf4","conformance-browser-verdicts.mjs":"3c5eec7926d322b92de44fe9af0eb3f9ad9aebf10f7459f7261c7ead382428f9","journeys-browser-verdicts.mjs":"f99cb2c43746a1f80672cdf7f2cc72becd0f3a90301536f38f4f9567a8be4e48","/":"dd5d6c2ebf00ecf46abaf929c2441f388e02ccee1b85135918d47e01a38e0b2f","/assets/p0-app.js":"a0dcb11ef6ca65c53f7010bd3af2e654de360d9f8d380876900393e14f6adab0","/assets/p0-client.js":"a7c0fe338f461175901d1758f6092da2e1a56f3061f538c4341753207aa57e8e","/assets/p0.css":"1d66f393e4adf2af7266a32feac6fbdb74980825ae0293cce0407607ab78ff8a"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const turns=api+'/session/turns',session=api+'/session',cancel=api+'/session/cancel';
let browser,tls,WebSocketServer;const fixtures=[];
async function serve(name,{scenario,now}){
 const bearer=randomBytes(32).toString('base64url'),fixture=createFixture({origin,scenario,bearer,...(now?{now}:{})});fixtures.push(fixture);
 const transport=await life.acquire(name,()=>createTransport({origin,fixture,...tls,WebSocketServer}),t=>t.close());await transport.listen();life.check();return {name,bearer,fixture,transport};
}
const close=name=>life.closeEntry(life.entries.find(e=>e.name===name));
async function openContext(name,state){
 const context=await life.acquire(name,()=>browser.newContext({viewport:desktop,colorScheme:'dark',serviceWorkers:'block'}),c=>c.close());life.check();
 // D02: the C2 route filter; a restart gate may only delay continue(), capped at 5 s.
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(!(u.origin===origin&&!u.search&&!u.hash&&allowedRequest(route.request().method(),u.pathname)))return route.abort().catch(()=>{});
  if(state.gate){const capped=await Promise.race([state.gate.then(()=>false),sleep(5000).then(()=>true)]);if(capped)state.gateExpired=true;}return route.continue().catch(()=>{});});
 await context.routeWebSocket(url=>url.href!==origin.replace('https:','wss:')+api+'/session/stream',ws=>ws.close());
 // D03: the fixed #error-message texts in order, observation only.
 await context.addInitScript(()=>{const log=[];Object.defineProperty(window,'__reviewErrors',{value:log});document.addEventListener('DOMContentLoaded',()=>{const e=document.getElementById('error-message');if(!e)return;new MutationObserver(()=>{const t=e.textContent;if(log.length<64&&log[log.length-1]!==t)log.push(t);}).observe(e,{childList:true,characterData:true,subtree:true});});});
 const page=await context.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(10000);return {context,page};
}
function observe(page,row,state){
 row.requests=[];row.responses=[];row.ws=[];row.wsCloses=[];const health={requestFailed:[],pageErrors:0,console:[]};row.health=health;const records=new Map();
 page.on('request',r=>{let u;try{u=new URL(r.url());}catch{return;}if(u.origin!==origin)return;const rec={method:r.method(),path:u.pathname,phase:state.phase,at:performance.now()};records.set(r,rec);row.requests.push(rec);});
 page.on('response',r=>{const rec=records.get(r.request());if(rec){rec.status=r.status();row.responses.push({method:rec.method,path:rec.path,status:rec.status,phase:rec.phase});const n=state.next;if(n&&n.method===rec.method&&n.path===rec.path){state.phase=n.phase;state.next=null;}}});
 page.on('requestfailed',r=>{const rec=records.get(r);if(rec){rec.failedAt=performance.now();const n=state.nextFail;if(n&&n.method===rec.method&&n.path===rec.path){state.phase=n.phase;state.nextFail=null;}}let path='unknown';try{const u=new URL(r.url());path=u.origin===origin?u.pathname:'other-origin';}catch{}health.requestFailed.push({method:r.method(),path,error:netError(r.failure()?.errorText)});});
 page.on('pageerror',()=>{health.pageErrors++;});page.on('console',m=>{if(['warning','error'].includes(m.type()))health.console.push({type:m.type(),text:m.text().slice(0,200)});});
 page.on('websocket',socket=>{socket.on('close',()=>row.wsCloses.push({phase:state.phase,at:Math.round(performance.now())}));socket.on('framesent',f=>row.ws.push({...journeyFrame('sent',f.payload),phase:state.phase}));socket.on('framereceived',f=>row.ws.push({...journeyFrame('received',f.payload),phase:state.phase}));});
}
const until=async(check,ms,label)=>{const end=performance.now()+ms;while(!(await check())){life.check();if(performance.now()>end)throw Error('REVIEW_WAIT_'+label);await sleep(25);}};
const streamStatus=page=>page.locator('#stream-status').textContent();
const connected=page=>page.waitForFunction(()=>document.querySelector('#stream-status')?.textContent==='connected',{},{timeout:15000});
const errorText=async page=>(await page.locator('#error-message').textContent())??'';
const errorsSeen=page=>page.evaluate(()=>[...(window.__reviewErrors??[])]);
const authHeading=page=>page.getByRole('heading',{name:'Authenticate',exact:true}).isVisible();
const storedSeq=page=>page.evaluate(()=>{for(const v of Object.values(sessionStorage)){try{const x=JSON.parse(v);if(Number.isSafeInteger(x?.event_seq))return x.event_seq;}catch{}}return null;});
const cleared=page=>page.evaluate(()=>({bearerEmpty:document.querySelector('#bootstrap-token').value==='',promptEmpty:document.querySelector('#prompt').value==='',diffEmpty:document.querySelector('#diff-output').textContent==='No diff loaded.',eventsEmpty:document.querySelector('#event-list').textContent==='No retained activity in this tab.',deviceAbsent:document.querySelector('#verification-url').textContent===''&&document.querySelector('#verification-code').textContent===''}));
const sent=(row,method,path)=>row.requests.filter(r=>r.method===method&&r.path===path).length;
const mutationCount=fixture=>{const s=fixture.summary();return {effects:s.effects,turnStarts:s.turnStarts};};
const mutationsSince=(fixture,before)=>{const now=mutationCount(fixture);return now.effects-before.effects+now.turnStarts-before.turnStarts;};
async function authenticate(page,env,row,state){
 await page.getByRole('heading',{name:'Authenticate',exact:true}).waitFor();row.keyboard.push({target:'bootstrap-token',...await tabTo(page,'bootstrap-token')});await page.keyboard.type(env.bearer);await enter(page,'authenticate',row);
 await page.waitForFunction(()=>document.querySelector('#operator-panel')?.hidden===false);assert.equal(await page.locator('#bootstrap-token').inputValue(),'');
 const cookie=(await state.context.cookies()).find(c=>c.name==='__Host-codebox_p0')?.value;assert(cookie,'REVIEW_NO_COOKIE');state.secrets.push(env.bearer,cookie);state.authCounts=mutationCount(env.fixture);
}
async function submit(page,row,state,prompt){state.secrets.push(prompt);await tabTo(page,'prompt');await page.keyboard.type(prompt);state.phase='submit';state.next={method:'POST',path:turns,phase:'after-submit'};await enter(page,'submit-turn',row);await until(()=>state.phase==='after-submit',5000,'SUBMIT');}
// A refused upgrade (after restart, expiry or logout) counts as an upgrade attempt.
const attempts=env=>{const t=env.transport.summary();return t.upgrades+t.rejectedUpgrades;};
async function quiet(page,row,env,ms=6000){const requests=row.requests.length,upgrades=attempts(env);await sleep(ms);life.check();return {requests:row.requests.length-requests,upgrades:attempts(env)-upgrades};}
async function journey(key,scenario,body,{now,statuses=[401],failures=[]}={}){
 receipt.stage=key;const row={keyboard:[]};receipt.checks[key]=row;const state={phase:'load',secrets:[],gate:null};
 const env=await serve('https-'+key,{scenario,now});const {context,page}=await openContext('context-'+key,state);state.context=context;state.env=env;observe(page,row,state);
 // One failed journey keeps its evidence and does not stop the others; cancellation and the deadline stay fatal. Nothing is retried.
 try{
  await page.goto(origin);life.check();const out=await body({env,page,row,state});row.dom=await page.evaluate(measureDOM);
  // D05: canary over DOM, inputs, storage, console and the public row; only the hit sources are recorded.
  const sources=await page.evaluate(()=>({dom:document.body.innerText,inputs:[...document.querySelectorAll('input,textarea')].map(e=>e.value).join('\n'),storage:JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))}));
  sources.console=row.health.console.map(c=>c.text).join('\n');sources.row=JSON.stringify(row);row.canary=canaryScan(sources,state.secrets.filter(Boolean));
  row.healthVerdict=healthVerdict(row.health,{statuses:out?.statuses??statuses,failures:out?.failures??failures});
  row.passed=row.verdict.passed&&row.healthVerdict.passed&&row.canary.length===0;
 }catch(error){if(error?.message==='REVIEW_CANCELLED')throw error;row.failure=safeError(error);row.passed=false;}
 finally{const t=state.env.transport.summary();row.transport={upgrades:t.upgrades,rejectedUpgrades:t.rejectedUpgrades,clients:t.clients};row.fixture=state.env.fixture.summary();await close('context-'+key);await close(state.env.name);}
}
const J={
 // J01a: a stored cursor above the high-water is clamped by refresh(); no future_cursor reaches the browser.
 async j01_stored({env,page,row,state}){state.phase='auth';await authenticate(page,env,row,state);await connected(page);await submit(page,row,state,'Synthetic J01 prompt');await until(async()=>(await storedSeq(page))===2,5000,'CURSOR');
  row.highWater=env.fixture.summary().sequence;await page.evaluate(()=>{for(const[k,v]of Object.entries(sessionStorage)){try{const x=JSON.parse(v);if(Number.isSafeInteger(x?.event_seq))sessionStorage.setItem(k,JSON.stringify({...x,event_seq:50}));}catch{}}});
  state.phase='after-reload';await page.reload();life.check();await connected(page);await sleep(500);row.fixtureTurns=env.fixture.summary().turnStarts;row.verdict=j01Verdict(row);},
 // J01b: the review server answers the next subscribe with future_cursor (H05).
 async j01_future({env,page,row,state}){state.phase='auth';await authenticate(page,env,row,state);await connected(page);await submit(page,row,state,'Synthetic J01 future prompt');await until(async()=>(await storedSeq(page))===2,5000,'CURSOR');
  env.transport.futureNextSubscribe();state.phase='after-refresh';await enter(page,'refresh',row);
  await until(()=>{const i=row.ws.findIndex(f=>f.dir==='received'&&f.code==='future_cursor');return i>=0&&row.ws.slice(i+1).some(f=>f.dir==='received'&&f.type==='replay_end');},15000,'FUTURE_RECOVERY');await connected(page);await sleep(500);
  Object.assign(row,{future:env.transport.summary().future,fixtureTurns:env.fixture.summary().turnStarts,errorsSeen:await errorsSeen(page),errorText:await errorText(page),connected:(await streamStatus(page))==='connected',storedSeq:await storedSeq(page)});row.verdict=j01FutureVerdict(row);},
 // J02a: a restarted control plane on the same port; the old cookie meets 401 and the client returns to bootstrap.
 async j02_restart({env,page,row,state}){state.phase='auth';await authenticate(page,env,row,state);await connected(page);
  let open;state.gate=new Promise(r=>{open=r;});state.phase='after-restart';await close(env.name);
  const next=await serve('https-j02_restart-restarted',{scenario:'authenticated-ready'});state.env=next;state.secrets.push(next.bearer);open();
  await page.getByRole('heading',{name:'Authenticate',exact:true}).waitFor({timeout:15000});if(state.gateExpired)throw Error('REVIEW_RESTART_GATE');state.gate=null;
  const window=await quiet(page,row,next);Object.assign(row,{authHeading:await authHeading(page),errorText:await errorText(page),bearerEmpty:(await cleared(page)).bearerEmpty,storedCursor:(await storedSeq(page))!==null,newFixtureMutations:Object.values(mutationCount(next.fixture)).reduce((a,b)=>a+b,0),upgradesInWindow:window.upgrades});
  row.verdict=j02RestartVerdict(row);return {statuses:[401,401]};},
 // J02b: one stale instance identity on Cancel (H04) after an admitted turn.
 async j02_instance({env,page,row,state}){state.phase='auth';await authenticate(page,env,row,state);await connected(page);await submit(page,row,state,'Synthetic J02 prompt');await until(async()=>(await storedSeq(page))===2,5000,'CURSOR');
  const before=mutationCount(env.fixture);env.transport.overrideNextInstance('POST',cancel);state.phase='cancel';state.next={method:'POST',path:cancel,phase:'after-cancel'};await enter(page,'cancel-turn',row);await until(()=>state.phase==='after-cancel',5000,'CANCEL');
  await until(()=>row.ws.some(f=>f.phase==='after-cancel'&&f.dir==='received'&&f.type==='replay_end'),15000,'RESYNC');await connected(page);await sleep(500);
  Object.assign(row,{override:env.transport.summary().override,cancelStatus:row.responses.find(r=>r.path===cancel)?.status,effectsChanged:JSON.stringify(mutationCount(env.fixture))!==JSON.stringify(before),sessionStatus:await page.locator('#session-status').textContent(),highWater:env.fixture.summary().sequence,errorsSeen:await errorsSeen(page),errorText:await errorText(page),reconnected:(await streamStatus(page))==='connected'});
  state.phase='window';await quiet(page,row,env);row.verdict=j02InstanceVerdict(row);return {statuses:[401,409]};},
 // J03: the client's own 15 s HTTP timer aborts an admitted turn whose 202 the transport holds (H01).
 async j03_timeout({env,page,row,state}){state.phase='auth';await authenticate(page,env,row,state);await connected(page);env.transport.holdNextResponse('POST',turns);
  state.secrets.push('Synthetic J03 prompt');await tabTo(page,'prompt');await page.keyboard.type('Synthetic J03 prompt');await tabTo(page,'submit-turn');state.phase='submit';state.nextFail={method:'POST',path:turns,phase:'after-failure'};const pressed=performance.now();await page.keyboard.press('Enter');row.keyboard.push({target:'submit-turn'});
  await until(()=>state.phase==='after-failure',20000,'TIMEOUT');const rec=row.requests.find(r=>r.method==='POST'&&r.path===turns);
  row.pressToFailMs=Math.round(rec.failedAt-pressed);row.requestToFailMs=Math.round(rec.failedAt-rec.at);await connected(page);await sleep(500);
  Object.assign(row,{held:env.transport.summary().held,fixtureTurns:env.fixture.summary().turnStarts,errorsSeen:await errorsSeen(page),errorText:await errorText(page),connected:(await streamStatus(page))==='connected',sessionStatus:await page.locator('#session-status').textContent()});
  state.phase='window';await quiet(page,row,env);row.verdict=j03Verdict(row);return {failures:[{method:'POST',path:turns}]};},
 // J04: one invalid server-to-client frame of each kind (H02); a protocol error stops reconnect until a manual Refresh.
 async j04(kind,{env,page,row,state}){row.kind=kind;state.phase='auth';await authenticate(page,env,row,state);await connected(page);state.phase='after-auth';
  row.injected=env.transport.injectFrame(kind);await page.waitForFunction(()=>document.querySelector('#error-message')?.textContent==='The session stream returned an invalid frame.');row.errorText=await errorText(page);
  state.phase='window';row.upgradesInWindow=(await quiet(page,row,env)).upgrades;
  // Observed, not judged: whether the client closed its socket after the protocol error (see the spec's J04 finding note).
  row.socketClosedBeforeRefresh=row.wsCloses.length>0;row.transportClientsBeforeRefresh=env.transport.summary().clients;
  const upgrades=env.transport.summary().upgrades;state.phase='after-refresh';await enter(page,'refresh',row);await connected(page);await sleep(500);
  Object.assign(row,{upgradesAfterRefresh:env.transport.summary().upgrades-upgrades,subscribesAfterRefresh:row.ws.filter(f=>f.phase==='after-refresh'&&f.dir==='sent'&&f.type==='subscribe').length,connectedAfterRefresh:(await streamStatus(page))==='connected',fixtureMutations:mutationsSince(env.fixture,state.authCounts)});row.verdict=j04Verdict(row);},
 // J05: the session expires under a skewed fixture clock; the 250 ms validity check closes the stream.
 async j05_expiry({env,page,row,state}){state.phase='auth';await authenticate(page,env,row,state);await connected(page);state.phase='after-auth';const expired=performance.now();state.skew.value=300001;
  await until(()=>row.ws.some(f=>f.dir==='received'&&f.code==='authentication_expired'),2500,'EXPIRY');row.expiryMs=Math.round(performance.now()-expired);await page.getByRole('heading',{name:'Authenticate',exact:true}).waitFor();
  state.phase='window';const window=await quiet(page,row,env);
  Object.assign(row,{authHeading:await authHeading(page),errorText:await errorText(page),bearerEmpty:(await cleared(page)).bearerEmpty,storedCursor:(await storedSeq(page))!==null,requestsInWindow:window.requests,upgradesInWindow:window.upgrades,fixtureMutations:mutationsSince(env.fixture,state.authCounts)});row.verdict=j05Verdict(row);},
 // J06a: logout after a completed turn and a shown diff clears every volatile field.
 async j06_logout({env,page,row,state}){state.phase='auth';await authenticate(page,env,row,state);await connected(page);await submit(page,row,state,'Synthetic J06 prompt');await page.waitForFunction(()=>document.querySelector('#refresh')?.disabled===false);
  await enter(page,'refresh',row);await page.waitForFunction(()=>document.querySelector('#session-status')?.textContent?.startsWith('running'));env.fixture.complete();await enter(page,'refresh',row);await page.waitForFunction(()=>document.querySelector('#session-status')?.textContent?.startsWith('ready'));
  await enter(page,'show-diff',row);await page.waitForFunction(()=>document.querySelector('#diff-output')?.textContent?.includes('<script>globalThis.REVIEW_INJECTED'));
  state.phase='logout';await enter(page,'logout',row);await page.getByRole('heading',{name:'Authenticate',exact:true}).waitFor();await until(()=>env.transport.summary().clients===0,1000,'LOGOUT_STREAM');
  row.openStreams=env.transport.summary().clients;row.authHeading=await authHeading(page);row.dom=await cleared(page);row.storedCursor=(await storedSeq(page))!==null;state.phase='window';const window=await quiet(page,row,env);row.requestsInWindow=window.requests;row.upgradesInWindow=window.upgrades;row.verdict=j06LogoutVerdict(row);},
 // J06b: a synthetic pagehide disposes the controller while its GET is held (H01); a reload then starts cleanly.
 async j06_dispose({env,page,row,state}){state.phase='auth';await authenticate(page,env,row,state);await connected(page);env.transport.holdNextResponse('GET',session);state.phase='refresh';await enter(page,'refresh',row);
  await until(()=>env.transport.summary().held?.outcome===null,5000,'HELD');state.phase='after-pagehide';const hidden=performance.now();await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  const failedHeld=()=>row.health.requestFailed.filter(f=>f.method==='GET'&&f.path===session).length;
  await until(()=>env.transport.summary().held.outcome!==null&&failedHeld()>0,1000,'DISPOSE').catch(e=>{if(!e?.message?.startsWith('REVIEW_WAIT_'))throw e;});row.heldMs=Math.round(performance.now()-hidden);row.held=env.transport.summary().held;row.failedHeld=failedHeld();
  const window=await quiet(page,row,env);Object.assign(row,{openStreams:env.transport.summary().clients,requestsInWindow:window.requests,upgradesInWindow:window.upgrades,cleared:await page.evaluate(()=>({events:document.querySelector('#event-list').textContent==='No retained activity in this tab.',diff:document.querySelector('#diff-output').textContent==='No diff loaded.'}))});
  state.phase='after-reload';const before=row.requests.length;await page.reload();life.check();await connected(page);await sleep(500);
  Object.assign(row,{reloadedSession:row.requests.slice(before).some(r=>r.method==='GET'&&r.path===session&&r.status===200),connected:(await streamStatus(page))==='connected',errorText:await errorText(page)});row.verdict=j06DisposeVerdict(row);return {failures:[{method:'GET',path:session}]};},
};
async function main(){
 assert.equal(process.getuid(),1000);assert.equal(homedir(),'/home/ubuntu');assert(!Object.keys(process.env).some(k=>/^(CODEBOX_|CODEX_|OPENAI_|ANTHROPIC_)/.test(k)),'REVIEW_INHERITED_PROVIDER');await privateState('/state');life.check();const output=lstatSync('/output');assert(output.isDirectory()&&!output.isSymbolicLink()&&output.uid===1000&&(output.mode&0o777)===0o700);assert(!existsSync('/output/result.json'));
 for(const file of Object.keys(expectedSources).filter(p=>!p.startsWith('/')))receipt.sourceHashes[file]=sha(readFileSync(new URL(file,import.meta.url)));for(const[path,asset]of fixedAssets())receipt.sourceHashes[path]=sha(asset.body);for(const[file,hash]of Object.entries(expectedSources))assert.equal(receipt.sourceHashes[file],hash,'REVIEW_SOURCE_DRIFT');receipt.sourceHashes['journeys-browser.mjs']=sha(readFileSync(new URL('journeys-browser.mjs',import.meta.url)));
 const require=createRequire('/review-tools/node_modules/playwright/package.json');assert.equal(require('playwright/package.json').version,'1.63.0');assert.equal(process.version,'v24.18.0');({wsServer:WebSocketServer}=require('playwright-core/lib/utilsBundle'));const {chromium}=await import('/review-tools/node_modules/playwright/index.mjs');life.check();
 tls=installFreshTrust(life,receipt);life.check();
 browser=await life.acquire('browser',()=>chromium.launch({executablePath:'/ms-playwright/chromium-1243/chrome-linux64/chrome',timeout:30000,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}),b=>b.close());life.check();receipt.tools={node:process.version,playwright:'1.63.0',chromium:browser.version()};assert.equal(browser.version(),'153.0.8010.12','REVIEW_BROWSER_DRIFT');
 await journey('j01_stored','authenticated-ready',J.j01_stored);await journey('j01_future','authenticated-ready',J.j01_future);
 await journey('j02_restart','authenticated-ready',J.j02_restart);await journey('j02_instance','authenticated-ready',J.j02_instance);
 await journey('j03_timeout','authenticated-ready',J.j03_timeout);
 for(const kind of ['malformed','binary','unknown-field'])await journey('j04_'+kind,'authenticated-ready',x=>J.j04(kind,x));
 const skew={value:0};await journey('j05_expiry','authenticated-ready',x=>J.j05_expiry({...x,state:Object.assign(x.state,{skew})}),{now:()=>performance.now()+skew.value});
 await journey('j06_logout','success-diff',J.j06_logout);await journey('j06_dispose','authenticated-ready',J.j06_dispose);
 receipt.verdicts=Object.fromEntries(Object.entries(receipt.checks).map(([k,r])=>[k,r.passed===true]));receipt.stage='COMPLETE';receipt.passed=Object.values(receipt.verdicts).every(Boolean);
}
try{await life.run(main);}catch(error){receipt.failure=safeError(error);}finally{
 clearTimeout(timeout);receipt.cleanup=await life.finish();for(const fixture of fixtures)fixture.dispose();
 const absent=port=>bounded(()=>new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});socket.on('connect',()=>{socket.destroy();resolve(false);});socket.on('error',e=>resolve(e.code==='ECONNREFUSED'));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});}),1500,'listener').catch(()=>false);
 receipt.cleanup.listenersAbsent=Object.fromEntries(await Promise.all(ports.map(async p=>[p,await absent(p)])));
 receipt.passed=receipt.passed&&!receipt.cleanup.cancelled&&receipt.cleanup.drainComplete&&receipt.cleanup.resources.every(r=>r.closed)&&Object.values(receipt.cleanup.listenersAbsent).every(Boolean);for(const [name,fn]of handlers)process.off(name,fn);writeFileSync('/output/result.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:receipt.passed,stage:receipt.stage,verdicts:receipt.verdicts??null,failure:receipt.failure??null,cleanup:receipt.cleanup}));process.exit(receipt.passed?0:1);
}

/** SPEC-T006F followup-001: current client in Chromium against a review fixture, not native backend/provider evidence. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,lstatSync,existsSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {createConnection} from 'node:net';
import {createFixture,fixedAssets,api} from './fixture.mjs';
import {createTransport} from './transport.mjs';
import {Lifecycle,privateState,bounded} from './lifecycle.mjs';
import {installFreshTrust} from './trust.mjs';
import {healthVerdict,layoutVerdict,streamVerdict} from './followup-browser-verdicts.mjs';
process.umask(0o077);
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceFiles=['followup-browser.mjs','followup-browser-verdicts.mjs','fixture.mjs','transport.mjs','lifecycle.mjs','trust.mjs'];
const icon=()=>readFileSync(new URL('../apps/control-plane/web/favicon.ico',import.meta.url));
const sourceHashes=()=>({...Object.fromEntries(sourceFiles.map(n=>[n,sha(readFileSync(new URL(n,import.meta.url)))])),...Object.fromEntries([...fixedAssets()].map(([n,a])=>[n,sha(a.body)])),'/favicon.ico':sha(icon())});
// Launcher freezes this JSON before review/runtime; runtime must supply the read-only manifest path.
if(process.argv[2]==='--source-hashes'){console.log(JSON.stringify(sourceHashes(),null,2));process.exit(0);}
const life=new Lifecycle(),origin='https://127.0.0.1:8443',port=8443;
const receipt={mode:'followup-001',scope:'Chromium and review fixture only; not native backend/provider or Cloud evidence',passed:false,stage:'PRECONDITION',sourceHashes:{},captures:[]};
const secrets=[],fixtures=[];let browser,tls,WebSocketServer;
const handlers=['SIGTERM','SIGINT'].map(name=>[name,()=>life.cancel(name)]);for(const[n,f]of handlers)process.on(n,f);
const timeout=setTimeout(()=>life.cancel('deadline'),200000);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check,ms=8000)=>{const end=performance.now()+ms;while(!(await check())){life.check();if(performance.now()>end)throw Error('REVIEW_WAIT_TIMEOUT');await sleep(25);}};
const close=name=>life.closeEntry(life.entries.find(e=>e.name===name));
const mutations=fixture=>Object.entries(fixture.summary().counts).filter(([k])=>!k.startsWith('GET ')).reduce((n,[,v])=>n+v,0);
const pathOnly=url=>{try{const u=new URL(url);return u.origin===origin?u.pathname:'OTHER_ORIGIN';}catch{return 'INVALID_URL';}};
function observe(page){
 const health={pageErrors:0,requestFailed:[],responses:[],console:[]},ws={closes:0,malformed:0,subscribes:0},state={phase:'bootstrap'};
 const phases=new Map();page.on('request',r=>phases.set(r,state.phase));
 page.on('response',r=>health.responses.push({method:r.request().method(),path:pathOnly(r.url()),status:r.status(),phase:phases.get(r.request())??'unknown'}));
 page.on('requestfailed',r=>health.requestFailed.push({method:r.method(),path:pathOnly(r.url())}));page.on('pageerror',()=>health.pageErrors++);
 page.on('console',m=>{if(['warning','error'].includes(m.type())){const text=m.text();health.console.push({type:m.type(),path:pathOnly(m.location().url),text:text==='Failed to load resource: the server responded with a status of 401 (Unauthorized)'?text:'UNEXPECTED_CONSOLE'});}});
 // Observe Playwright's native browser socket events; do not replace window.WebSocket or intercept requests.
 page.on('websocket',socket=>{socket.on('close',()=>ws.closes++);socket.on('framereceived',f=>{if(f.payload==='{')ws.malformed++;});socket.on('framesent',f=>{try{if(JSON.parse(f.payload).type==='subscribe')ws.subscribes++;}catch{}});});return {health,ws,state};
}
async function capture(name,viewport){
 receipt.stage=name;const bearer=randomBytes(32).toString('base64url');secrets.push(bearer);
 const fixture=createFixture({origin,scenario:'authenticated-ready',bearer});fixtures.push(fixture);
 const transport=await life.acquire(name+'-transport',()=>createTransport({origin,fixture,...tls,WebSocketServer,favicon:icon()}),t=>t.close());await transport.listen();life.check();
 const context=await life.acquire(name+'-context',()=>browser.newContext({viewport,colorScheme:'dark',serviceWorkers:'block'}),c=>c.close());const page=await context.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(10000);const obs=observe(page);
 await page.goto(origin);await page.getByRole('heading',{name:'Authenticate',exact:true}).waitFor();
 await until(()=>transport.summary().favicon.gets>=1);await sleep(100);
 const layout=await page.evaluate(()=>{const input=document.querySelector('#bootstrap-token'),button=document.querySelector('#authenticate');return {gap:button.getBoundingClientRect().top-input.getBoundingClientRect().bottom,scrollWidth:document.documentElement.scrollWidth,innerWidth:innerWidth,bearerEmpty:input.value===''};});
 assert.equal(layout.bearerEmpty,true);const png=await page.screenshot({path:'/output/'+name+'-bootstrap.png',animations:'disabled'});
 const row={name,viewport,...layout,screenshotBeforeBearer:true,favicon:transport.summary().favicon,iconSha256:sha(icon()),png:{privatePath:name+'-bootstrap.png',sha256:sha(png)},health:obs.health};receipt.captures.push(row);row.layoutVerdict=layoutVerdict(row);assert(row.layoutVerdict.passed,'REVIEW_LAYOUT');
 if(name==='desktop'){
  obs.state.phase='authenticated';await page.locator('#bootstrap-token').fill(bearer);await page.locator('#authenticate').click();await page.waitForFunction(()=>document.querySelector('#stream-status')?.textContent==='connected');await until(()=>transport.summary().subscribed===1);
  const base=mutations(fixture);const stream={injected:transport.injectFrame('malformed')};receipt.stream=stream;
  await until(async()=>obs.ws.closes===1&&transport.summary().clients===0&&(await page.locator('#stream-status').textContent())==='disconnected');
  Object.assign(stream,{malformedReceived:obs.ws.malformed,closesBeforeRefresh:obs.ws.closes,clientsBeforeRefresh:transport.summary().clients,disconnected:(await page.locator('#stream-status').textContent())==='disconnected',errorText:await page.locator('#error-message').textContent()});
  const start=performance.now(),upgrades=transport.summary().upgrades,before=mutations(fixture);let maxClients=0;
  while(performance.now()-start<1500){await sleep(25);life.check();maxClients=Math.max(maxClients,transport.summary().clients);}
  Object.assign(stream,{quietMs:performance.now()-start,quietUpgrades:transport.summary().upgrades-upgrades,quietMutations:mutations(fixture)-before,quietClients:maxClients});
  const subscribed=obs.ws.subscribes;stream.refreshClicks=1;await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#stream-status')?.textContent==='connected');await until(()=>transport.summary().subscribed===2);await sleep(100);
  Object.assign(stream,{refreshUpgrades:transport.summary().upgrades-upgrades,refreshSubscribes:obs.ws.subscribes-subscribed,connectedAfterRefresh:(await page.locator('#stream-status').textContent())==='connected',mutationsAfterRefresh:mutations(fixture)-base,turnStarts:fixture.summary().turnStarts,cancels:fixture.summary().counts['POST '+api+'/session/cancel']??0});stream.verdict=streamVerdict(stream);assert(stream.verdict.passed,'REVIEW_STREAM');
 }
 row.healthVerdict=healthVerdict(obs.health);assert(row.healthVerdict.passed,'REVIEW_HEALTH');row.transport=transport.summary();await close(name+'-context');await close(name+'-transport');
}
async function main(){
 assert.equal(process.getuid(),1000);assert.equal(homedir(),'/home/ubuntu');assert(!Object.keys(process.env).some(k=>/^(CODEBOX_|CODEX_|OPENAI_|ANTHROPIC_)/.test(k)));
 await privateState('/state');await privateState('/output');const output=lstatSync('/output');assert(output.isDirectory()&&!output.isSymbolicLink()&&output.uid===1000&&(output.mode&0o777)===0o700);assert(!existsSync('/output/result.json'));
 receipt.sourceHashes=sourceHashes();assert.equal(process.env.FOLLOWUP_SOURCE_HASHES,'/frozen/source-hashes.json');assert.deepEqual(receipt.sourceHashes,JSON.parse(readFileSync(process.env.FOLLOWUP_SOURCE_HASHES,'utf8')),'REVIEW_SOURCE_DRIFT');
 const require=createRequire('/review-tools/node_modules/playwright/package.json');assert.equal(require('playwright/package.json').version,'1.63.0');assert.equal(process.version,'v24.18.0');({wsServer:WebSocketServer}=require('playwright-core/lib/utilsBundle'));const {chromium}=await import('/review-tools/node_modules/playwright/index.mjs');
 tls=installFreshTrust(life,receipt);browser=await life.acquire('browser',()=>chromium.launch({executablePath:'/ms-playwright/chromium-1243/chrome-linux64/chrome',timeout:30000,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}),b=>b.close());assert.equal(browser.version(),'153.0.8010.12');receipt.tools={node:process.version,playwright:'1.63.0',chromium:browser.version()};
 await capture('desktop',{width:1440,height:900});await capture('mobile',{width:390,height:844});assert.deepEqual(sourceHashes(),receipt.sourceHashes,'REVIEW_SOURCE_DRIFT');receipt.stage='COMPLETE';receipt.passed=true;
}
try{await life.run(main);}catch(e){receipt.failure=e?.name==='AssertionError'?'ASSERTION_FAILED':/^REVIEW_[A-Z_]+$/.test(e?.message??'')?e.message:'UNCLASSIFIED';}finally{
 clearTimeout(timeout);receipt.cleanup=await life.finish();for(const f of fixtures)f.dispose();
 receipt.cleanup.listenerAbsent=await bounded(()=>new Promise(resolve=>{const s=createConnection({host:'127.0.0.1',port});s.on('connect',()=>{s.destroy();resolve(false);});s.on('error',e=>resolve(e.code==='ECONNREFUSED'));s.setTimeout(1000,()=>{s.destroy();resolve(false);});}),1500,'listener').catch(()=>false);
 receipt.passed=receipt.passed&&!receipt.cleanup.cancelled&&receipt.cleanup.drainComplete&&receipt.cleanup.resources.every(r=>r.closed)&&receipt.cleanup.listenerAbsent;
 // Receipts contain only fixed messages, paths, hashes and counts; check generated bearer values defensively.
 if(secrets.some(s=>JSON.stringify(receipt).includes(s))){receipt.passed=false;receipt.failure='REVIEW_SECRET';receipt.captures=[];delete receipt.stream;}
 for(const[n,f]of handlers)process.off(n,f);writeFileSync('/output/result.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:receipt.passed,stage:receipt.stage,failure:receipt.failure??null,cleanup:receipt.cleanup}));process.exit(receipt.passed?0:1);
}

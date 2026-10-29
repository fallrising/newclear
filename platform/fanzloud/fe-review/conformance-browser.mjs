/** T-0433 C2: one focused browser conformance run (SPEC-T006R-harness-repair-c2 Part C); evidence only, never canonical cells. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,lstatSync,existsSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {createConnection} from 'node:net';
import {request as httpsRequest,Agent} from 'node:https';
import {createFixture,fixedAssets,api} from './fixture.mjs';
import {createTransport,allowedRequest} from './transport.mjs';
import {Lifecycle,privateState,bounded} from './lifecycle.mjs';
import {installFreshTrust} from './trust.mjs';
import {selectPhase} from './remaining-support.mjs';
import {tabTo,enter,measureDOM} from './baseline-support.mjs';
import {netError,tlsVerdict,r06Verdict,traversalVerdict,nameVerdict,scrollVerdict,frameRecord} from './conformance-browser-verdicts.mjs';
process.umask(0o077);
const life=new Lifecycle(),origin='https://127.0.0.1:8443',ports=[8443,8444,8445],sha=b=>createHash('sha256').update(b).digest('hex');
const sizes={desktop:selectPhase(['desktop-recovery']).size,mobile:selectPhase(['mobile']).size};
const receipt={mode:'conformance-c2',scope:'focused C2 conformance evidence (R02 browser TLS, R06 no-resend, R07 keyboard/names/scroll) on the repaired harness; not canonical cells; candidate until independent actual review',passed:false,stage:'PRECONDITION',checks:{},sourceHashes:{},health:{}};
const handlers=['SIGTERM','SIGINT'].map(name=>[name,()=>life.cancel(name)]);for(const [name,fn]of handlers)process.on(name,fn);const timeout=setTimeout(()=>life.cancel('deadline'),200000);
const safeError=e=>/^REVIEW_[A-Z0-9_]+$/.test(e?.message??'')?e.message:e?.name==='AssertionError'?'ASSERTION_FAILED':e?.name==='TimeoutError'?'BROWSER_TIMEOUT':'UNCLASSIFIED';
const expectedSources={"fixture.mjs":"8c828b21eeb34563ef64c9b81a9bdfca4f9ab0146382c5e43416d560a706e9de","transport.mjs":"4fcd35bfc1757f5f8f230102e74299d4e49f343f9e5b40f0bccabfe1a56db09e","lifecycle.mjs":"7f3f1dcda77c0587d57d23a01d8a59567b02ce0bb5e5ef1a366d0783a8d838d9","trust.mjs":"1f5f0f31ad493ccc3866cc18967f237518ed9e798624aafff4344a36ada738f5","baseline-support.mjs":"445a5fcd969654c20fbe5f6e97ce8c52d8cd1343cdbf27be64ef93d7044d0636","remaining-support.mjs":"e77cfd56ad10e6e1fc77e9c20536f0d3024cad9e2ff5a0dc304d76f18be44cf4","conformance-browser-verdicts.mjs":"3c5eec7926d322b92de44fe9af0eb3f9ad9aebf10f7459f7261c7ead382428f9","/":"dd5d6c2ebf00ecf46abaf929c2441f388e02ccee1b85135918d47e01a38e0b2f","/assets/p0-app.js":"a0dcb11ef6ca65c53f7010bd3af2e654de360d9f8d380876900393e14f6adab0","/assets/p0-client.js":"a7c0fe338f461175901d1758f6092da2e1a56f3061f538c4341753207aa57e8e","/assets/p0.css":"1d66f393e4adf2af7266a32feac6fbdb74980825ae0293cce0407607ab78ff8a"};
let browser;const fixtures=[];
const openssl=(...args)=>{life.check();execFileSync('openssl',args,{cwd:'/state',stdio:'ignore',timeout:10000});life.check();};
function extraLeaves(){
 // C202.1: a wrong-name leaf from the trusted CA and a correct-name leaf from a CA that is not trusted.
 const leaf=(name,san,ca)=>{openssl('req','-newkey','rsa:2048','-nodes','-keyout',name+'.key','-out',name+'.csr','-subj','/CN=Review-'+name);writeFileSync('/state/'+name+'.ext',san+'\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',{flag:'wx',mode:0o600});openssl('x509','-req','-in',name+'.csr','-CA',ca+'.crt','-CAkey',ca+'.key','-CAcreateserial','-out',name+'.crt','-days','1','-extfile',name+'.ext');return {key:readFileSync('/state/'+name+'.key'),cert:readFileSync('/state/'+name+'.crt')};};
 openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout','untrusted.key','-out','untrusted.crt','-days','1','-subj','/CN=Review-untrusted','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign');
 return {wrongName:leaf('wrong-name','subjectAltName=DNS:wrong.invalid','trusted'),untrusted:leaf('untrusted-leaf','subjectAltName=IP:127.0.0.1','untrusted')};
}
function track(page,health,{onRequest}={}){
 health.requestFailed=[];health.pageErrors=0;health.console=[];
 page.on('request',r=>onRequest?.(r));page.on('requestfailed',r=>{let path='unknown';try{const u=new URL(r.url());path=u.origin===origin?u.pathname:'other-origin';}catch{}health.requestFailed.push({method:r.method(),path,error:netError(r.failure()?.errorText)});});
 page.on('pageerror',()=>{health.pageErrors++;});page.on('console',m=>{if(['warning','error'].includes(m.type()))health.console.push({type:m.type(),text:m.text().slice(0,200)});});
}
const healthy=h=>h.pageErrors===0&&h.requestFailed.length===0;
async function serve(name,{port=8443,scenario,historyCapacity,key,cert,WebSocketServer}){
 const o=`https://127.0.0.1:${port}`,bearer=randomBytes(32).toString('base64url'),fixture=createFixture({origin:o,scenario,bearer,...(historyCapacity?{historyCapacity}:{})});fixtures.push(fixture);
 const transport=await life.acquire(name,()=>createTransport({origin:o,fixture,key,cert,WebSocketServer}),t=>t.close());await transport.listen();life.check();return {name,origin:o,bearer,fixture,transport};
}
async function openContext(name,size,{routed=true}={}){
 const context=await life.acquire(name,()=>browser.newContext({viewport:size,colorScheme:'dark',serviceWorkers:'block'}),c=>c.close());life.check();
 if(routed){await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin&&!u.search&&!u.hash&&allowedRequest(route.request().method(),u.pathname))return route.continue();return route.abort();});await context.routeWebSocket(url=>url.href!==origin.replace('https:','wss:')+api+'/session/stream',ws=>ws.close());}
 const page=await context.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(10000);return {context,page};
}
const close=name=>life.closeEntry(life.entries.find(e=>e.name===name));
async function authenticate(page,bearer,row){await page.getByRole('heading',{name:'Authenticate',exact:true}).waitFor();row.keyboard.push({target:'bootstrap-token',...await tabTo(page,'bootstrap-token')});await page.keyboard.type(bearer);await enter(page,'authenticate',row);await page.waitForFunction(()=>document.querySelector('#operator-panel')?.hidden===false);assert.equal(await page.locator('#bootstrap-token').inputValue(),'');}
const connected=page=>page.waitForFunction(()=>document.querySelector('#stream-status')?.textContent==='connected',{},{timeout:15000});
function nodeCall(env,ca,agent,{method='GET',path,headers={},body=''}){
 return new Promise((resolve,reject)=>{const req=httpsRequest({host:'127.0.0.1',port:8443,method,path,ca,agent,headers:{...headers,...(body?{'content-length':Buffer.byteLength(body)}:{})}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('REVIEW_NODE_TIMEOUT')));req.end(body||undefined);});
}
async function tlsCheck(tls,leaves,WebSocketServer){
 receipt.stage='R02';const row={keyboard:[]};receipt.checks.r02=row;
 const good=await serve('https-wss-r02',{scenario:'authenticated-ready',...tls,WebSocketServer});const {page}=await openContext('context-r02',sizes.desktop);const health={};receipt.health.r02=health;track(page,health);
 const response=await page.goto(origin);life.check();await authenticate(page,good.bearer,row);await connected(page);row.positive={status:response.status(),streamConnected:true,subscribers:good.fixture.summary().subscribers};await close('context-r02');
 const negative=async(name,url,transport)=>{const {page:p}=await openContext('context-'+name,sizes.desktop,{routed:false});const before=transport.summary().requests;const out={error:null,status:null,finalURL:null};try{const r=await p.goto(url);out.status=r?.status()??null;out.finalURL=p.url();}catch(error){out.error=netError(error?.message);}out.requests=transport.summary().requests-before;await close('context-'+name);return out;};
 const wrong=await serve('https-wrong-name',{port:8444,scenario:'authenticated-ready',...leaves.wrongName,WebSocketServer}),stray=await serve('https-untrusted-ca',{port:8445,scenario:'authenticated-ready',...leaves.untrusted,WebSocketServer});
 row.wrongName=await negative('wrong-name','https://127.0.0.1:8444/',wrong.transport);row.untrusted=await negative('untrusted-ca','https://127.0.0.1:8445/',stray.transport);row.plain=await negative('plain-http','http://127.0.0.1:8443/',good.transport);
 for(const name of ['https-wrong-name','https-untrusted-ca','https-wss-r02'])await close(name);
 row.verdict=tlsVerdict(row);row.health=healthy(health);
}
async function r06Check(tls,WebSocketServer){
 receipt.stage='R06';const row={keyboard:[]};receipt.checks.r06=row;
 const env=await serve('https-wss-r06',{scenario:'authenticated-ready',historyCapacity:64,...tls,WebSocketServer});const {page}=await openContext('context-r06',sizes.desktop);const health={},requests=[],ws=[];let afterSubmit=false;receipt.health.r06=health;
 track(page,health,{onRequest:r=>{const u=new URL(r.url());if(u.origin!==origin)return;requests.push({method:r.method(),path:u.pathname,afterSubmit});if(r.method()==='POST'&&u.pathname===api+'/session/turns')afterSubmit=true;}});
 page.on('websocket',socket=>{socket.on('framesent',f=>ws.push(frameRecord('sent',f.payload)));socket.on('framereceived',f=>ws.push(frameRecord('received',f.payload)));});
 await page.goto(origin);life.check();await authenticate(page,env.bearer,row);await connected(page);
 await tabTo(page,'prompt');await page.keyboard.type('Synthetic R06 prompt');await enter(page,'submit-turn',row);
 await page.waitForFunction(()=>Object.values(sessionStorage).some(v=>{try{return JSON.parse(v).event_seq===2;}catch{return false;}}));row.cursorBeforeGap=2;
 // A second synthetic operator session over Node HTTPS (trusting only the private CA) moves history past the browser cursor while upgrades are held.
 const agent=new Agent({keepAlive:true,maxSockets:1}),ca=readFileSync('/state/trusted.crt');
 try{
  const boot=await nodeCall(env,ca,agent,{method:'POST',path:api+'/operator/session',headers:{origin,authorization:'Bearer '+env.bearer}});assert.equal(boot.status,201);const cookie=boot.headers['set-cookie'][0].split(';')[0],instance=JSON.parse(boot.body).instance_id;
  const post=async(path,expected,extra={},body='')=>assert.equal((await nodeCall(env,ca,agent,{method:'POST',path,headers:{origin,cookie,'codebox-instance-id':instance,'idempotency-key':randomUUID(),...extra},body})).status,expected,'REVIEW_GAP_SETUP');
  env.transport.holdReconnect(5000);const started=performance.now();
  await post(api+'/session/cancel',200);for(let i=0;i<16;i++){await post(api+'/session/turns',202,{'content-type':'application/json'},'{"prompt":"Synthetic gap"}');await post(api+'/session/cancel',200);}
  row.gapSetupMs=Math.round(performance.now()-started);assert(row.gapSetupMs<4000,'REVIEW_GAP_SETUP_SLOW');assert.equal(env.fixture.summary().sequence,68);
 }finally{agent.destroy();}
 const resubscribed=()=>{const i=ws.findIndex(f=>f.dir==='received'&&f.code==='history_gap');return i>=0&&ws.slice(i+1).some(f=>f.dir==='sent'&&f.type==='subscribe');};await bounded(async()=>{while(!resubscribed()){life.check();await new Promise(r=>setTimeout(r,50));}},15000,'gap-resubscribe');await connected(page);row.afterGapConnected=true;
 await page.reload();life.check();await page.waitForFunction(()=>document.querySelector('#operator-panel')?.hidden===false);await connected(page);row.reloaded=true;
 await enter(page,'refresh',row);await page.waitForFunction(()=>document.querySelector('#refresh')?.disabled===false);await new Promise(r=>setTimeout(r,500));
 row.requests=requests;row.ws=ws;row.fixtureTurns=env.fixture.summary().counts['POST '+api+'/session/turns']??0;row.dom=await page.evaluate(measureDOM);row.verdict=r06Verdict(row);row.health=healthy(health);
 await close('context-r06');await close('https-wss-r06');
}
async function r07Check(viewport,tls,WebSocketServer,scrollRequired){
 receipt.stage='R07_'+viewport;const row={viewport,keyboard:[]};receipt.checks['r07_'+viewport]=row;
 const env=await serve('https-wss-r07-'+viewport,{scenario:'success-diff',...tls,WebSocketServer});const {context,page}=await openContext('context-r07-'+viewport,sizes[viewport]);const health={};receipt.health['r07_'+viewport]=health;track(page,health);
 await page.goto(origin);life.check();await authenticate(page,env.bearer,row);await connected(page);
 await tabTo(page,'prompt');await page.keyboard.type('Synthetic R07 prompt');await enter(page,'submit-turn',row);await page.waitForFunction(()=>document.querySelector('#refresh')?.disabled===false);
 await enter(page,'refresh',row);await page.waitForFunction(()=>document.querySelector('#session-status')?.textContent?.startsWith('running'));env.fixture.complete();
 await enter(page,'refresh',row);await page.waitForFunction(()=>document.querySelector('#session-status')?.textContent?.startsWith('ready'));await enter(page,'show-diff',row);await page.waitForFunction(()=>document.querySelector('#diff-output')?.textContent?.includes('<script>globalThis.REVIEW_INJECTED=true</script>'));
 // Traversal from the document start; a viewport screenshot at each region landing goes to the private evidence.
 await page.evaluate(()=>{const b=document.body;b.setAttribute('tabindex','-1');b.focus();b.removeAttribute('tabindex');window.getSelection()?.removeAllRanges();});const steps=[];row.screenshots={};
 for(let i=0;i<60&&!(steps.some(s=>s.id==='event-list')&&steps.some(s=>s.id==='diff-output'));i++){await page.keyboard.press('Tab');const s=await page.evaluate(()=>{const e=document.activeElement,c=e?getComputedStyle(e):null;return {id:e?.id||null,tag:e?.tagName?.toLowerCase()??null,focusVisible:!!e?.matches(':focus-visible'),outlineStyle:c?.outlineStyle??null,outlineWidth:parseFloat(c?.outlineWidth)||0};});steps.push(s);
  if(['event-list','diff-output'].includes(s.id)&&!row.screenshots[s.id]){const file='screenshots/'+viewport+'-'+s.id+'-focus.png',png=await page.screenshot({path:'/output/'+file});row.screenshots[s.id]={privatePath:file,sha256:sha(png)};}}
 row.traversal=steps;row.traversalVerdict=traversalVerdict(steps);
 const regions=[];for(const [id,heading]of [['event-list','activity-heading'],['diff-output','diff-heading']]){const expected=(await page.locator('#'+heading).textContent())?.trim()??'';const playwrightId=expected?await page.getByRole('region',{name:expected,exact:true}).evaluate(e=>e.id).catch(()=>null):null;
  const cdp=await context.newCDPSession(page);let axRole=null,axName=null;try{await cdp.send('Accessibility.enable');const {root}=await cdp.send('DOM.getDocument',{depth:0});const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#'+id});const {nodes}=await cdp.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});axRole=nodes[0]?.role?.value??null;axName=nodes[0]?.name?.value??null;}finally{await cdp.detach().catch(()=>{});}
  regions.push({id,expected,playwrightId,axRole,axName});}
 row.names=regions;row.nameVerdict=nameVerdict(regions);
 row.scroll={};for(const id of ['diff-output','event-list']){const box=page.locator('#'+id);const m=()=>box.evaluate(e=>({overflowing:e.scrollHeight>e.clientHeight,top:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}));const first=await m();const out={overflowing:first.overflowing,scrollHeight:first.scrollHeight,clientHeight:first.clientHeight,before:first.top,afterArrow:first.top,afterPage:first.top};
  if(first.overflowing){await box.focus();const press=async(key,previous)=>{await page.keyboard.press(key);await page.waitForFunction(([sel,prev])=>document.querySelector(sel).scrollTop>prev,['#'+id,previous],{timeout:2000}).catch(()=>{});return (await m()).top;};out.afterArrow=await press('ArrowDown',out.before);out.afterPage=await press('PageDown',out.afterArrow);}
  out.verdict=scrollVerdict(out);row.scroll[id]=out;}
 row.scrollRequired=scrollRequired;row.dom=await page.evaluate(measureDOM);assert(row.dom.bearerEmpty&&row.dom.promptEmpty&&row.dom.inertDiff,'REVIEW_DOM_SAFETY');row.fixture=env.fixture.summary();row.health=healthy(health);
 await close('context-r07-'+viewport);await close('https-wss-r07-'+viewport);
}
async function main(){
 assert.equal(process.getuid(),1000);assert.equal(homedir(),'/home/ubuntu');assert(!Object.keys(process.env).some(k=>/^(CODEBOX_|CODEX_|OPENAI_|ANTHROPIC_)/.test(k)),'REVIEW_INHERITED_PROVIDER');await privateState('/state');life.check();const output=lstatSync('/output');assert(output.isDirectory()&&!output.isSymbolicLink()&&output.uid===1000&&(output.mode&0o777)===0o700);assert(!existsSync('/output/result.json'));mkdirSync('/output/screenshots',{mode:0o700});
 for(const file of Object.keys(expectedSources).filter(p=>!p.startsWith('/')))receipt.sourceHashes[file]=sha(readFileSync(new URL(file,import.meta.url)));for(const[path,asset]of fixedAssets())receipt.sourceHashes[path]=sha(asset.body);for(const[file,hash]of Object.entries(expectedSources))assert.equal(receipt.sourceHashes[file],hash,'REVIEW_SOURCE_DRIFT');receipt.sourceHashes['conformance-browser.mjs']=sha(readFileSync(new URL('conformance-browser.mjs',import.meta.url)));
 const require=createRequire('/review-tools/node_modules/playwright/package.json');assert.equal(require('playwright/package.json').version,'1.63.0');assert.equal(process.version,'v24.18.0');const {wsServer:WebSocketServer}=require('playwright-core/lib/utilsBundle'),{chromium}=await import('/review-tools/node_modules/playwright/index.mjs');life.check();
 const tls=installFreshTrust(life,receipt);life.check();receipt.stage='TRUST_NEGATIVES';const leaves=extraLeaves();
 browser=await life.acquire('browser',()=>chromium.launch({executablePath:'/ms-playwright/chromium-1243/chrome-linux64/chrome',timeout:30000,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}),b=>b.close());life.check();receipt.tools={node:process.version,playwright:'1.63.0',chromium:browser.version()};assert.equal(browser.version(),'153.0.8010.12','REVIEW_BROWSER_DRIFT');
 await tlsCheck(tls,leaves,WebSocketServer);await r06Check(tls,WebSocketServer);await r07Check('desktop',tls,WebSocketServer,false);await r07Check('mobile',tls,WebSocketServer,true);
 const c=receipt.checks;receipt.verdicts={r02:c.r02.verdict.passed&&c.r02.health,r06:c.r06.verdict.passed&&c.r06.health};
 for(const v of ['desktop','mobile']){const r=c['r07_'+v];receipt.verdicts['r07_'+v]=r.traversalVerdict.passed&&r.nameVerdict.passed&&(!r.scrollRequired||r.scroll['diff-output'].verdict.passed)&&r.health;}
 receipt.stage='COMPLETE';receipt.passed=Object.values(receipt.verdicts).every(Boolean);
}
try{await life.run(main);}catch(error){receipt.failure=safeError(error);}finally{
 clearTimeout(timeout);receipt.cleanup=await life.finish();for(const fixture of fixtures)fixture.dispose();
 const absent=port=>bounded(()=>new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});socket.on('connect',()=>{socket.destroy();resolve(false);});socket.on('error',e=>resolve(e.code==='ECONNREFUSED'));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});}),1500,'listener').catch(()=>false);
 receipt.cleanup.listenersAbsent=Object.fromEntries(await Promise.all(ports.map(async p=>[p,await absent(p)])));
 receipt.passed=receipt.passed&&!receipt.cleanup.cancelled&&receipt.cleanup.drainComplete&&receipt.cleanup.resources.every(r=>r.closed)&&Object.values(receipt.cleanup.listenersAbsent).every(Boolean);for(const [name,fn]of handlers)process.off(name,fn);writeFileSync('/output/result.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:receipt.passed,stage:receipt.stage,verdicts:receipt.verdicts??null,failure:receipt.failure??null,cleanup:receipt.cleanup}));process.exit(receipt.passed?0:1);
}

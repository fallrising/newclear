/** Root-run minimum same-assets TLS/UI wiring proof; never a full R2 acceptance. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync,lstatSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {createConnection} from 'node:net';
import {createFixture,fixedAssets} from './fixture.mjs';
import {createTransport,allowedRequest} from './transport.mjs';
import {Lifecycle,privateState,bounded} from './lifecycle.mjs';
process.umask(0o077);
const origin='https://127.0.0.1:8443',life=new Lifecycle(),result={scope:'minimum actual product HTTPS/WSS wiring only; no matrix/negative journey/full R2 claim',passed:false,stage:'PRECONDITION',checks:{},health:{blockedHTTP:0,blockedWS:0,pageErrors:0,failedRequests:0,consoleErrors:0,statuses:{}},sourceHashes:{}};
let browser,transport,fixture;const signals=[];for(const name of ['SIGTERM','SIGINT']){const handler=()=>life.cancel(name);signals.push([name,handler]);process.on(name,handler);}const deadline=setTimeout(()=>life.cancel('deadline'),60000);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixedPath=path=>allowedRequest('GET',path)?'asset-or-read-api':path==='/api/p0/v1/operator/session'?'operator-session':path==='/favicon.ico'?'favicon':'unknown';
const failCode=e=>typeof e?.message==='string'&&/^REVIEW_[A-Z0-9_]+$/.test(e.message)?e.message:e?.name==='AssertionError'?'ASSERTION_FAILED':e?.name==='TimeoutError'?'BROWSER_TIMEOUT':'UNCLASSIFIED';
async function run(){
 assert.equal(process.getuid(),1000);assert.equal(homedir(),'/home/ubuntu');await privateState('/state');life.check();const out=lstatSync('/output');assert(out.isDirectory()&&!out.isSymbolicLink()&&out.uid===1000&&(out.mode&0o777)===0o700);assert(!existsSync('/output/result.json'));
 for(const file of ['fixture.mjs','transport.mjs','lifecycle.mjs','probe.mjs'])result.sourceHashes[file]=sha(readFileSync(new URL(file,import.meta.url)));for(const [route,asset]of fixedAssets())result.sourceHashes[route]=sha(asset.body);
 const require=createRequire('/review-tools/node_modules/playwright/package.json');assert.equal(require('playwright/package.json').version,'1.63.0');const {wsServer:WebSocketServer}=require('playwright-core/lib/utilsBundle');const {chromium}=await import('/review-tools/node_modules/playwright/index.mjs');life.check();
 result.tools={node:process.version,playwright:'1.63.0',image:'fe-review-trust-terminal:20261024',certificateNegativeEvidence:'root trust-001; same NSS/Chromium/trust configuration; not rerun'};
 result.stage='TRUST';const openssl=(...args)=>{life.check();execFileSync('openssl',args,{cwd:'/state',stdio:'ignore',timeout:10000});life.check();};
 openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout','trusted.key','-out','trusted.crt','-days','1','-subj','/CN=Review-trusted','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign');
 openssl('req','-newkey','rsa:2048','-nodes','-keyout','correct.key','-out','correct.csr','-subj','/CN=Review-correct');writeFileSync('/state/correct.ext','subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',{flag:'wx',mode:0o600});
 openssl('x509','-req','-in','correct.csr','-CA','trusted.crt','-CAkey','trusted.key','-CAcreateserial','-out','correct.crt','-days','1','-extfile','correct.ext');
 const nss=homedir()+'/.pki/nssdb';assert(!existsSync(nss));mkdirSync(nss,{recursive:true,mode:0o700});for(const args of [['-N','--empty-password','-d','sql:'+nss],['-A','-d','sql:'+nss,'-n','review-trusted','-t','C,,','-i','/state/trusted.crt']]){life.check();execFileSync('certutil',args,{stdio:'ignore',timeout:5000});}life.check();
 result.stage='LISTEN';const bearer=randomBytes(32).toString('base64url');fixture=createFixture({origin,scenario:'authenticated-ready',bearer});transport=await life.acquire('https-wss',()=>createTransport({origin,fixture,key:readFileSync('/state/correct.key'),cert:readFileSync('/state/correct.crt'),WebSocketServer}),t=>t.close());await transport.listen();life.check();
 result.stage='BROWSER';browser=await life.acquire('browser',()=>chromium.launch({executablePath:'/ms-playwright/chromium-1243/chrome-linux64/chrome',timeout:30000,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}),b=>b.close());life.check();result.tools.chromium=browser.version();const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:900},colorScheme:'dark'});life.check();
 await context.route('**/*',route=>{let allowed=false;try{const u=new URL(route.request().url());allowed=u.origin===origin&&!u.search&&!u.hash&&(allowedRequest(route.request().method(),u.pathname)||u.pathname==='/favicon.ico');}catch{}if(!allowed){result.health.blockedHTTP++;return route.abort();}return route.continue();});life.check();
 await context.routeWebSocket(url=>url.href!==origin.replace('https:','wss:')+'/api/p0/v1/session/stream',ws=>{result.health.blockedWS++;ws.close();});life.check();
 const page=await context.newPage();life.check();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(10000);
 page.on('pageerror',()=>result.health.pageErrors++);page.on('requestfailed',()=>result.health.failedRequests++);page.on('console',m=>{if(m.type()==='error')result.health.consoleErrors++;});page.on('response',r=>{const u=new URL(r.url());const key=fixedPath(u.pathname)+':'+r.status();result.health.statuses[key]=(result.health.statuses[key]??0)+1;});
 result.stage='BOOTSTRAP';const response=await page.goto(origin);life.check();assert.equal(response.status(),200);assert.equal(page.url(),origin+'/');assert.equal(await page.locator('#bootstrap-panel').isVisible(),true);assert.equal(fixture.summary().effects,0);result.checks.sameAssetsHTTPS200=true;
 await page.keyboard.press('Tab');life.check();assert.equal(await page.evaluate(()=>document.activeElement?.id),'bootstrap-token');await page.keyboard.type(bearer);life.check();await page.keyboard.press('Tab');life.check();assert.equal(await page.evaluate(()=>document.activeElement?.id),'authenticate');await page.keyboard.press('Enter');life.check();
 result.stage='AUTHENTICATED';await page.waitForFunction(()=>document.querySelector('#operator-panel')?.hidden===false&&document.querySelector('#stream-status')?.textContent==='connected');life.check();assert.equal(await page.locator('#bootstrap-token').inputValue(),'');const cookies=await context.cookies();life.check();const cookie=cookies.find(c=>c.name==='__Host-codebox_p0');assert(cookie?.secure&&cookie?.httpOnly&&cookie?.sameSite==='Strict'&&cookie?.path==='/');assert.equal(fixture.summary().effects,1);assert.equal(fixture.summary().turnStarts,0);assert.equal(transport.summary().subscribed,1);result.checks={...result.checks,keyboardAuthenticate:true,secretInputCleared:true,secureHttpOnlyStrictCookie:true,actualWSSReplayConnected:true,noImplicitMutation:true};
 assert.equal(result.health.blockedHTTP+result.health.blockedWS+result.health.pageErrors+result.health.failedRequests,0);result.fixture=fixture.summary();result.transport=transport.summary();result.passed=true;result.stage='COMPLETE';
}
try{await life.run(run);}catch(error){result.failure=failCode(error);}finally{
 clearTimeout(deadline);result.cleanup=await life.finish();fixture?.dispose();result.cleanup.listenerAbsent=await bounded(()=>new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port:8443});socket.on('connect',()=>{socket.destroy();resolve(false);});socket.on('error',e=>resolve(e.code==='ECONNREFUSED'));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});}),1500,'listener-proof').catch(()=>false);
 result.passed=result.passed&&!result.cleanup.cancelled&&result.cleanup.drainComplete&&result.cleanup.resources.every(r=>r.closed)&&result.cleanup.listenerAbsent;for(const [name,handler]of signals)process.off(name,handler);writeFileSync('/output/result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));process.exit(result.passed?0:1);
}

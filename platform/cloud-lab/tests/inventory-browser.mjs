// Optional real local workerd/D1 + Chromium qualification. Use installed tool paths.
// All identities and reports are synthetic. No Cloudflare account or login is used.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync,sign as rsaSign} from 'node:crypto';
import {sign,recipeRef} from '../apps/control/worker/protocol.mjs';
import {validateInventory} from '../apps/control/public/inventory.mjs';
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(process.env.MINIFLARE_MODULE));
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const component=resolve('platform/cloud-lab'),out=process.env.AGENT_EVIDENCE_DIR;
assert(out&&process.env.AGENT_BUILD_DIR&&process.env.INVENTORY_REPORT);
const source=await readFile(process.env.INVENTORY_REPORT,'utf8'),report=validateInventory(JSON.parse(source));
const iso=t=>new Date(t).toISOString().replace(/\.\d{3}Z$/,'Z'),now=Date.now();
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'local-test',alg:'RS256',use:'sig'};
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const jwtUnsigned=b64({alg:'RS256',kid:'local-test'})+'.'+b64({iss:'https://test.cloudflareaccess.com',aud:['test'],sub:'synthetic-owner',iat:Math.floor(now/1000)-1,exp:Math.floor(now/1000)+600});
const jwt=jwtUnsigned+'.'+rsaSign('RSA-SHA256',Buffer.from(jwtUnsigned),privateKey).toString('base64url');
const machine={principal_id:'publisher',grant_id:'publisher',generation:1,secret_hex:'ab'.repeat(32),expires_at:iso(now+600000)};
let mf,browser;const checks=[];
try{
 mf=new Miniflare(convertV4MiniflareOptions({cf:false,telemetry:{enabled:false},modules:['worker/index.mjs','worker/auth.mjs','worker/protocol.mjs','worker/inventory.mjs','public/inventory.mjs'].map(path=>({type:'ESModule',path:component+'/apps/control/'+path})),modulesRoot:component+'/apps/control',compatibilityDate:'2026-10-26',
  d1Databases:{DB:'inventory-local'},resourcePersistencePath:process.env.AGENT_BUILD_DIR+'/d1',resourceTmpPath:process.env.TMPDIR,
  bindings:{PUBLIC_ORIGIN:'https://lab.example',AUDIENCE:'inventory-test',MACHINE_KEYS:JSON.stringify({publisher:machine}),ACCESS_CONFIG:JSON.stringify({issuer:'https://test.cloudflareaccess.com',audience:'test',subjects:{'synthetic-owner':{principal_id:'human',grant_id:'human'}}})},
  outboundService:async request=>new Response(JSON.stringify(new URL(request.url).pathname==='/cdn-cgi/access/certs'?{keys:[jwk]}:{error:'unexpected_external_request'}),{status:new URL(request.url).pathname==='/cdn-cgi/access/certs'?200:502,headers:{'Content-Type':'application/json'}}),
  serviceBindings:{ASSETS:async request=>{const path=new URL(request.url).pathname;const name={'/':'index.html','/styles.css':'styles.css','/dashboard.mjs':'dashboard.mjs','/inventory.mjs':'inventory.mjs'}[path];if(!name)return new Response('',{status:404});return new Response(await readFile(component+'/apps/control/public/'+name),{headers:{'Content-Type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'}});}}
 }));
 const {DB:db}=await mf.getBindings();
 for(const name of ['0001.sql','0002.sql','0003.sql'])for(const statement of (await readFile(component+'/apps/control/migrations/'+name,'utf8')).replace(/^--.*$/gm,'').split(';').filter(x=>x.trim()))await db.prepare(statement).run();
 const policy={workspace_id:'ws_inventory',resource_ref:{resource_id:'node_demo',generation:1},recipe_ref:await recipeRef(),not_before:iso(now-1000),expires_at:iso(now+600000),max_timeout_seconds:30,max_output_bytes:16384,capabilities:['commands:read','inventory:read','inventory:publish']};
 for(const id of ['human','publisher'])await db.prepare('INSERT INTO grants VALUES(?,1,0,?)').bind(id,JSON.stringify({...policy,principal_id:id})).run();
 let nonce=0;
 async function machineRequest(body){const method=body===undefined?'GET':'POST',raw=body===undefined?'':JSON.stringify(body),time=String(Math.floor(Date.now()/1000)),n=(++nonce).toString(16).padStart(32,'0');const sig=await sign(machine.secret_hex,'inventory-test','publisher',1,method,'/api/inventory',time,n,raw);return mf.dispatchFetch('https://lab.example/api/inventory',{method,headers:{'Content-Type':'application/json','X-Lab-Key-Id':'publisher','X-Lab-Time':time,'X-Lab-Nonce':n,'X-Lab-Signature':sig},...(body===undefined?{}:{body:raw})});}
 assert.equal((await machineRequest(report)).status,201);const first=await (await machineRequest()).json();assert.deepEqual(first.report,report);checks.push('actual producer JSON -> HMAC -> workerd/D1 -> exact readback');
 assert.equal((await machineRequest(report)).status,200);assert.equal((await (await machineRequest()).json()).received_at,first.received_at);checks.push('semantic retry preserves receipt on real D1');
 const conflict=structuredClone(report);conflict.sections.find(s=>s.resources.length).resources[0].use='conflict';assert.equal((await machineRequest(conflict)).status,409);checks.push('same-time conflict preserves original');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:960}});const errors=[];
 await context.route('**/*',async route=>{
  const req=route.request();assert.equal(new URL(req.url()).origin,'https://lab.example');
  const headers={...req.headers(),'cf-access-jwt-assertion':jwt};const response=await mf.dispatchFetch(req.url(),{method:req.method(),headers,...(req.method()==='POST'?{body:req.postData()}: {})});
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('https://lab.example/');
 await page.locator('#inventory-refresh').waitFor();await page.waitForFunction(()=>!document.getElementById('inventory-refresh').disabled);
 await page.locator('#inventory-refresh').click();await page.waitForFunction(()=>document.getElementById('inventory-message').textContent==='報告已讀取。');
 assert.match(await page.locator('#inventory').innerText(),/HTTP_403/);checks.push('browser reads partial report with explicit unreadable Workers');
 const malicious=structuredClone(report);malicious.observed_at=iso(Date.now());malicious.started_at=malicious.observed_at;malicious.sections.find(s=>s.resources.length).resources[0].name='<img src=x onerror=alert(1)>';
 await page.locator('#inventory-file').setInputFiles({name:'report.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(malicious))});await page.locator('#inventory-upload').click();await page.waitForFunction(()=>document.getElementById('inventory-message').textContent==='報告已保存。');
 assert.match(await page.locator('#inventory').innerText(),/<img src=x/);assert.equal(await page.locator('#inventory img').count(),0);checks.push('explicit browser file upload persists; markup remains text');
 await page.screenshot({path:out+'/inventory.png',fullPage:true});
 await db.prepare('UPDATE grants SET revision=revision+1,policy=? WHERE id=?').bind(JSON.stringify({...policy,principal_id:'human',workspace_id:'ws_stale'}),'human').run();
 await page.reload();await page.waitForFunction(()=>!document.getElementById('inventory-refresh').disabled);
 const stale=structuredClone(report);stale.observed_at=iso(Date.now()-90000000);stale.started_at=iso(Date.now()-90060000);
 await page.locator('#inventory-file').setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(stale))});await page.locator('#inventory-upload').click();await page.waitForFunction(()=>document.getElementById('inventory').textContent.includes('盤點已過期'));checks.push('stale report visible after scoped workspace change');
 await db.prepare("UPDATE grants SET revoked=1 WHERE id='human'").run();await page.locator('#inventory-refresh').click();await page.waitForFunction(()=>document.getElementById('inventory-message').textContent.includes('尚未授予'));assert.doesNotMatch(await page.locator('#inventory').innerText(),/HTTP_403/);checks.push('revoked Access grant clears report');
 assert.deepEqual(errors,[]);await writeFile(out+'/result.json',JSON.stringify({checks,source_revision:report.source.revision,scope:'synthetic producer API + local workerd/D1 + Chromium; no live provider'},null,2));console.log(JSON.stringify({passed:checks.length,errors}));
}finally{await browser?.close();await mf?.dispose();}

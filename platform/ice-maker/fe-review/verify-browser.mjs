import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const component = resolve(root, 'platform/ice-maker');
const state = join(component, 'fe-review/runs/.state');
const id = new Date().toISOString().replaceAll(/[-:.]/g, '');
const out = join(component, 'fe-review/runs', id);
const base = 'http://127.0.0.1:8765';
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const axeModule = await import(pathToFileURL(process.env.AXE_PLAYWRIGHT_MODULE));
const AxeBuilder = axeModule.AxeBuilder || axeModule.default?.default || axeModule.default;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
await mkdir(join(out, 'screenshots'), { recursive: true });
const evidence = { schema: 1, runId: id, status: 'running', versions: {node: process.version}, steps: [], axe: [], captures: [], health: [], cleanup: [], sourceHashes: {} };
for (const name of ['src/ice_maker/document_service.py', 'src/ice_maker/readable_results.py', 'fe-review/serve_fixture.py', 'fe-review/verify-browser.mjs', 'fe-review/targets.json']) evidence.sourceHashes[name] = sha(await readFile(join(component,name)));
function child(command,args,cwd=component,env={}) {
 const proc=spawn(command,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 let text='';proc.stdout.on('data',x=>text+=x);proc.stderr.on('data',x=>text+=x);
 const done=new Promise((res,rej)=>{proc.once('error',rej);proc.once('exit',(code,signal)=>res({code,signal}));});void done.catch(()=>{});
 return {proc,done,get text(){return text;}};
}
async function bounded(p,ms){let t;try{return await Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('owned deadline')),ms);})]);}finally{clearTimeout(t);}}
let server,browser,sharedChild;
async function absent(){for(let n=0;n<100;n++){try{await fetch(base+'/healthz',{signal:AbortSignal.timeout(500)});}catch(error){if(error.cause?.code==='ECONNREFUSED')return;}await sleep(100);}throw Error('fixture listener remains');}
async function stopShared(){
 if(sharedChild && sharedChild.proc.exitCode===null && sharedChild.proc.signalCode===null){sharedChild.proc.kill('SIGTERM');await bounded(sharedChild.done,5000);}
 try{const pid=Number(await readFile(join(state,'fixture.pid'),'utf8'));const cmd=await readFile('/proc/'+pid+'/cmdline','utf8');if(cmd.includes('fe-review/serve_fixture.py'))process.kill(pid,'SIGTERM');}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
 await absent();
 const receipt=JSON.parse(await readFile(join(state,'shutdown.json')));assert.equal(receipt.serviceClosed,true);
 evidence.cleanup.push({name:'shared-fixture',serviceClosed:true,listenerAbsent:true});
}
async function stopServer(){
 if(!server)return;
 if(server.proc.exitCode===null&&server.proc.signalCode===null)server.proc.kill('SIGTERM');
 let exit;
 try{exit=await bounded(server.done,10000);}catch(e){server.proc.kill('SIGKILL');await bounded(server.done,5000);throw e;}
 await writeFile(join(state,`${id}-server.log`),server.text);
 const shutdown=JSON.parse(await readFile(join(state,'shutdown.json')));
 assert.equal(shutdown.serviceClosed,true);
 assert(exit.code===0||exit.signal==='SIGTERM');
 assert(server.text.includes('Application shutdown complete.'));
 await absent();evidence.cleanup.push({name:'fixture',...exit,serviceClosed:true,listenerAbsent:true});server=null;
}
async function ready(){for(let i=0;i<100;i++){try{const r=await fetch(base+'/healthz');if(r.status===200&&JSON.stringify(await r.json())==='{"status":"ok"}')return;}catch{}await sleep(100);}throw Error('fixture not ready');}
async function screenshot(page,name){
 const path=`screenshots/${name}.png`;await page.screenshot({path:join(out,path),fullPage:true});
 const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 assert(metrics.scrollWidth<=metrics.width);evidence.captures.push({name,path,sha256:sha(await readFile(join(out,path))),metrics});
}
const payload=text=>Buffer.from('%PDF-1.4\n%ICE-MAKER-SYNTHETIC-PDF\n%%ICE-PAGE 1\n1 0 obj << /Type /Page >> endobj\nBT ('+text+') Tj ET\ntrailer << /Root 1 0 R >>\n%%EOF\n');
try{
 let seed;
 if(process.env.FE_REVIEW_FLOW_ONLY!=='1'){
 for(const args of [['--dry-run'],['--start','--out',join(out,'shared')]]){
  const run=sharedChild=child(process.execPath,['docs/fe-review/capture.mjs','platform/ice-maker/fe-review/targets.json',...args],root);
  const exit=await bounded(run.done,120000);await writeFile(join(state,`${id}-${args[0].slice(2)}.log`),run.text);assert.equal(exit.code,0);
  if(args[0]==='--dry-run')assert(run.text.includes('(3 pages)'));
 }
 const shared=JSON.parse(await readFile(join(out,'shared/capture.json')));
 assert.equal(shared.results.length,18);
 for(const item of shared.results){assert.equal(item.status,200);assert.deepEqual(item.pageErrors,[]);assert(!item.error);assert.equal(item.horizontalOverflow,false);}
 for(let n=0;n<100;n++){try{const s=JSON.parse(await readFile(join(state,'shutdown.json')));if(s.serviceClosed)break;}catch{}if(n===99)throw Error('shared fixture close unconfirmed');await sleep(100);}
 await stopShared();sharedChild=null;
 seed=JSON.parse(await readFile(join(state,'fixture.json')));
 evidence.steps.push({name:'shared-dryrun-start',records:18,pages:3,serviceClosed:true});
 await unlink(join(state,'shutdown.json'));
 }
 server=child(process.env.PYTHON||join(component,'.venv/bin/python'),['fe-review/serve_fixture.py'],component,{PYTHONPATH:'src'});await ready();
 const currentSeed=JSON.parse(await readFile(join(state,'fixture.json')));
 if(seed){assert.deepEqual(currentSeed,seed);evidence.steps.push({name:'repeat-start-identities',...seed});}else evidence.steps.push({name:'fresh-flow-only-fixture',...currentSeed});
 browser=await pw.chromium.launch({headless:true});evidence.versions.browser=browser.version();
 const targets=JSON.parse(await readFile(join(component,'fe-review/targets.json')));
 if(process.env.FE_REVIEW_FLOW_ONLY!=='1')for(const size of [{name:'desktop',width:1440,height:900},{name:'tablet',width:834,height:1112},{name:'mobile',width:390,height:844}])for(const scheme of ['light','dark']){
  const context=await browser.newContext({viewport:size,colorScheme:scheme,locale:'en-US'});
  try{const page=await context.newPage();for(const target of targets.apps[0].pages){
   const response=await page.goto(base+target.path);assert.equal(response.status(),200);
   const scan=await new AxeBuilder({page}).analyze();
   const record={page:target.id,viewport:size.name,scheme,violations:scan.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),incomplete:scan.incomplete.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}))};
   evidence.axe.push(record);assert(!record.violations.some(v=>['critical','serious'].includes(v.impact)));
   const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert(metrics.scrollWidth<=metrics.width);
  }}finally{await context.close();}
 }
 const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',locale:'en-US'});
 try{
  const page=await context.newPage();let phase='real';
  page.on('pageerror',e=>evidence.health.push({kind:'pageerror',message:e.message,phase}));
  page.on('response',r=>{if(r.status()>=400)evidence.health.push({kind:'http',status:r.status(),path:new URL(r.url()).pathname,phase});});
  page.on('requestfailed',r=>evidence.health.push({kind:'requestfailed',path:new URL(r.url()).pathname,phase}));
  const button=()=>page.getByRole('button',{name:'Upload',exact:true});
  async function upload(content,name='review.pdf'){
   await page.goto(base);await page.locator('#files').setInputFiles({name,mimeType:'application/pdf',buffer:payload(content)});await page.locator('#rights').selectOption('confirmed');await page.locator('#languages').fill(' eng, ,chi_tra, ');
   await button().click();
  }
  let accepted;let polls=0;
  page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/batches'&&r.request().method()==='POST'&&r.status()===202)accepted=(await r.json()).batch_id;});
  page.on('request',r=>{if(r.method()==='GET'&&/^\/api\/batches\/[0-9a-f]{64}$/.test(new URL(r.url()).pathname))polls++;});
  const waitText=async value=>{await page.waitForFunction(value=>document.getElementById('results').textContent.includes(value),value,{timeout:10000});};
  await upload('ICE_REVIEW_HOLD synthetic real upload');await waitText(': running');assert.deepEqual(JSON.parse(await page.locator('#metadata').inputValue())[0].languages,['chi_tra','eng']);assert(await button().isDisabled());assert.equal(await page.locator('#upload').getAttribute('aria-busy'),'true');await screenshot(page,'real-running-busy');
  await writeFile(join(state,'release'),'release\n');await waitText(': completed');await page.waitForFunction(()=>document.querySelector('#upload button').disabled===false);assert(await button().isEnabled());assert.equal(await page.locator('#upload').getAttribute('aria-busy'),'false');
  const batch=accepted;const download=page.getByRole('link',{name:'Download Markdown',exact:true});const downloadPath=await download.getAttribute('href');
  assert.match(await page.locator('#results').textContent(),/completed.*processed: 1, duplicate: 0, failed: 0, rejected: 0/);
  const completedPolls=polls;await sleep(1200);assert.equal(polls,completedPolls);assert(await button().isEnabled());await screenshot(page,'real-completed');
  evidence.steps.push({name:'completed-stays-idle',pollsBefore:completedPolls,pollsAfter:polls,observationMs:1200,counts:{processed:1,duplicate:0,failed:0,rejected:0}});
  const bytes=await (await page.request.get(base+downloadPath)).body();assert(bytes.includes(Buffer.from('ICE_REVIEW_HOLD synthetic real upload')));
  const source=sha(payload('ICE_REVIEW_HOLD synthetic real upload'));await page.getByRole('link',{name:source,exact:true}).click();assert.equal(page.url(),`${base}/batches/${batch}/documents/${source}`);assert.equal(await page.locator('pre').textContent(),bytes.toString('utf8'));await screenshot(page,'real-result');
  evidence.steps.push({name:'real-upload-normalized-language-busy-preview-download',batch,source,markdownSha256:sha(bytes),markdownBytes:bytes.length});
  async function stopped(name){const before=polls;await sleep(1200);assert.equal(polls,before);assert(await button().isEnabled());assert.equal(await page.locator('#upload').getAttribute('aria-busy'),'false');await screenshot(page,name);evidence.steps.push({name,pollsStopped:true});}
  if(process.env.FE_REVIEW_COMPLETED_ONLY!=='1'){
  await upload('ICE_REVIEW_FAIL');await waitText('Processing failed');await stopped('real-failed-batch');
  phase='controlled-response';
  await page.route(base+'/api/batches',route=>route.fulfill({status:400,json:{detail:'<img src=x onerror=alert(1)> synthetic rejection'}}));
  await upload('synthetic rejected');await waitText('Upload failed: <img');assert.equal(await page.locator('#results img').count(),0);await stopped('upload-detail-literal');await page.unrouteAll();
  // Actual service400 from unchanged metadata validation, without bypassing the API.
  await page.goto(base);await page.locator('#files').setInputFiles({name:'actual-invalid.pdf',mimeType:'application/pdf',buffer:payload('real rejection')});phase='actual-invalid-metadata';await page.locator('#rights').selectOption('confirmed');await page.locator('#languages').fill('invalid!');await button().click();await waitText('Upload failed:');await stopped('real-upload-400');
  for(const mode of ['404','409','network','invalid']){
   phase='controlled-poll-'+mode;
   await page.route(/\/api\/batches\/[0-9a-f]{64}$/,route=>mode==='network'?route.abort('failed'):route.fulfill(mode==='invalid'?{json:{status:'unknown'}}:{status:Number(mode),json:{detail:'synthetic_'+mode}}));
   await upload('poll '+mode);await waitText('Status unavailable:');await stopped('poll-'+mode);await page.unrouteAll();
  }
  phase='controlled-clock';await page.clock.install();
  await page.route(/\/api\/batches\/[0-9a-f]{64}$/,route=>route.fulfill({json:{status:'running',counts:{processed:0,duplicate:0,failed:0,rejected:0}}}));
  await upload('clock timeout');await waitText(': running');await page.clock.fastForward(30*60*1000+1);await waitText('Polling timed out after 30 minutes');assert(await button().isEnabled());await screenshot(page,'controlled-timeout');const before=polls;await page.clock.fastForward(2000);assert.equal(polls,before);evidence.steps.push({name:'30min-ui-cap',clock:'controlled-fast-forward',pollsStopped:true});
  await page.unrouteAll();}
  assert(!evidence.health.some(x=>x.kind==='pageerror'));
 }finally{await context.close();}
 await browser.close();browser=null;await stopServer();evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=String(error).replaceAll(component,'<component>');throw error;}
finally{
 for(const [name,action] of [['browser',async()=>{if(browser)await browser.close();}],['fixture',stopServer],['shared-if-owned',async()=>{if(sharedChild)await stopShared();}]]){try{await action();}catch(e){evidence.status='failed';evidence.cleanup.push({name,error:String(e).replaceAll(component,'<component>')});}}
 if(evidence.status==='failed')process.exitCode=1;
 await writeFile(join(out,'result.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({runId:id,status:evidence.status,steps:evidence.steps.length,axe:evidence.axe.length,captures:evidence.captures.length}));
}

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, lstatSync} from 'node:fs';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {createProxy, validateOrigin} from './loopback-proxy.mjs';
import {retakeSecrets} from './retake-secrets.mjs';
import {childFailure} from './child-outcome.mjs';
import {Lifecycle,bounded} from './lifecycle.mjs';
import {observeHealth, sharedHealth} from './health.mjs';
import {login, origin, privateJSON, seed, pause} from './browser-support.mjs';

const root = '/work';
const component = root + '/systems/ojbquay';
const require = createRequire(component + '/console-web/package.json');
const playwrightRequire = createRequire(require.resolve('@playwright/test/package.json'));
const {chromium} = await import('./browser-policy.mjs');
const {createServer} = await import(pathToFileURL(require.resolve('vite')).href);
const out = process.argv[2];
assert(/^\/evidence\/[a-z0-9-]+$/.test(out ?? ''), 'REVIEW_OUTPUT');
validateOrigin(origin);
const stateInfo = lstatSync('/state');
assert(stateInfo.isDirectory() && !stateInfo.isSymbolicLink() && stateInfo.uid === process.getuid() && (stateInfo.mode & 0o777) === 0o700, 'REVIEW_STATE');
process.umask(0o077);
mkdirSync(out, {mode: 0o700});
mkdirSync(out + '/screenshots', {mode: 0o700});
const credentials = privateJSON('browser.json');
assert(/^[a-zA-Z0-9_]+$/.test(credentials.user) && typeof credentials.password === 'string' && /^fe-ojb-[0-9a-f]{16}$/.test(credentials.run), 'REVIEW_CREDENTIAL_INPUT');
const sourceFiles = ['console-web/src/pages/DashboardPage.tsx', 'console-web/src/styles.css', 'console-web/src/test/dashboard.test.tsx', 'console-web/vite.config.ts', ...['run-browser.mjs','browser-support.mjs','states.spec.ts','playwright.config.ts','loopback-proxy.mjs','health.mjs','browser-policy.mjs','resume-plan.mjs','lifecycle.mjs','child-outcome.mjs','negative-state.mjs','png-mask.mjs','retake-secrets.mjs','package.json'].map(p=>'fe-review/'+p)];
const receipt = {run: credentials.run, source: credentials.source, passed: false, stage: 'starting', versions: {node: process.version, playwright: playwrightRequire('playwright/package.json').version}, sourceHashes: Object.fromEntries(sourceFiles.map(p=>[p,createHash('sha256').update(readFileSync(component+'/'+p)).digest('hex')])), cleanup: {}, loaded: [], drawerMeasurements: [], chart: [], health: []};
let browser, vite, proxy, child, childClosed, mainHealth, mainPage;
const lifecycle=new Lifecycle();
const signals=new Map(['SIGTERM','SIGINT'].map(signal=>[signal,()=>lifecycle.cancel(signal)]));
for(const [signal,handler] of signals)process.on(signal,handler);
function portOpen(port) {
  return new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});let done=false;const finish=value=>{if(!done){done=true;socket.destroy();resolve(value);}};socket.setTimeout(500,()=>finish(true));socket.once('connect',()=>finish(true));socket.once('error',error=>finish(error.code!=='ECONNREFUSED'));});
}
async function command(args, label, env = {}) {
  lifecycle.check();
  const chunks=[];
  const outcome={label,timeoutMs:180000,timedOut:false,exitCode:null,signal:null,cleanup:false};
  (receipt.commands??=[]).push(outcome);
  child=spawn(process.execPath,args,{cwd:component+'/console-web',detached:true,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  childClosed=new Promise(resolve=>{child.once('close',(code,signal)=>resolve({code,signal}));child.once('error',()=>resolve({code:-1,signal:null}));});
  child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>chunks.push(b));
  let killTimer;
  const timeout=setTimeout(()=>{outcome.timedOut=true;try{process.kill(-child.pid,'SIGTERM');}catch{}killTimer=setTimeout(()=>{outcome.forcedKill=true;try{process.kill(-child.pid,'SIGKILL');}catch{}},2000);},outcome.timeoutMs);
  try {
    const {code,signal}=await childClosed;outcome.exitCode=code;outcome.signal=signal;
    writeFileSync('/state/'+label+'.log',Buffer.concat(chunks),{flag:'wx',mode:0o600});
  } finally {
    clearTimeout(timeout);clearTimeout(killTimer);
    try{outcome.cleanup=await bounded(cleanupChild,3000,'command-cleanup');}catch{outcome.cleanup=false;}
  }
  const failure=childFailure(outcome);if(failure)throw new Error(failure);
}
async function cleanupChild() {
  if(!child)return true;
  const present=()=>{try{process.kill(-child.pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
  if(present()){try{process.kill(-child.pid,'SIGTERM');}catch{}}
  for(let i=0;i<40&&present();i++)await pause(50);
  if(present()){receipt.childForcedKill=true;try{process.kill(-child.pid,'SIGKILL');}catch{}}
  await childClosed;return !present();
}
async function drawer(page, route, open, viewport, label) {
  receipt.failureSite=label+':navigate';
  await page.setViewportSize(viewport);await page.goto(origin+route);
  receipt.failureSite=label+':open';await open();
  receipt.failureSite=label+':dialog-visible';
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  receipt.failureSite=label+':measure';
  const metrics=await dialog.evaluate(element=>{const wrapper=element.closest('.ant-drawer-content-wrapper');return {viewport:innerWidth,width:wrapper.getBoundingClientRect().width,computedWidth:getComputedStyle(wrapper).width,wrapperClient:wrapper.clientWidth,wrapperScroll:wrapper.scrollWidth,documentWidth:document.documentElement.scrollWidth};});
  receipt.drawerMeasurements.push({label,...metrics});
  const fixture=privateJSON('fixture.json');
  receipt.failureSite=label+':screenshot';
  await page.screenshot({path:out+'/screenshots/baseline-'+label+'.png',fullPage:true,mask:fixture.secrets.filter(Boolean).map(value=>page.getByText(value,{exact:true}))});
  receipt.failureSite=label+':close';
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert(metrics.width<=viewport.width+1&&metrics.documentWidth<=viewport.width+1,'REVIEW_DRAWER_BOUND');
}
let exitCode=0;
try {
  await lifecycle.run(async()=>{
  assert(!(await portOpen(5173))&&!(await portOpen(8080)),'REVIEW_EXISTING_LISTENER');
  proxy=await lifecycle.acquire('proxy',async()=>createProxy(),resource=>resource.close());await new Promise((resolve,reject)=>{proxy.server.once('error',reject);proxy.server.listen(8080,'127.0.0.1',resolve);});
  vite=await lifecycle.acquire('vite',()=>createServer({root:component+'/console-web',configFile:component+'/console-web/vite.config.ts',configLoader:'runner',cacheDir:'/state/vite-cache',server:{host:'127.0.0.1',port:5173,strictPort:true}}),resource=>resource.close());
  await vite.listen();
  assert.equal(vite.httpServer.address().address,'127.0.0.1');assert.equal(proxy.server.address().address,'127.0.0.1');
  receipt.listeners={vite:'127.0.0.1:5173',proxy:'127.0.0.1:8080'};
  browser=await lifecycle.acquire('browser',()=>chromium.launch({headless:true}),resource=>resource.close());receipt.versions.chromium=browser.version();
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:'en-US',colorScheme:'light'});
  const page=await context.newPage();mainPage=page;
  mainHealth=observeHealth(page,()=>receipt.stage==='true-login'?'login':receipt.stage);
  receipt.stage='true-login';await login(page,credentials);receipt.login={trueUI:true,currentUser:true,admin:true};
  receipt.stage='real-seed';await seed(page,credentials,receipt);
  const fixture=privateJSON('fixture.json');
  if(process.env.FE_REVIEW_REDACTION_ONLY==='1'){
    receipt.stage='redaction-retakes';await retakeSecrets(page,fixture,out,receipt);
    receipt.health=mainHealth();assert(!receipt.health.some(item=>item.classification==='unexpected'),'REVIEW_REDACTION_HEALTH');
    receipt.passed=true;return;
  }
  receipt.stage='drawer-baseline';
  if(process.env.FE_REVIEW_SKIP_DRAWERS==='1') {
    const proof=privateJSON('geometry-proof.json');
    assert(proof.run===credentials.run&&proof.source===credentials.source&&proof.sourceHashes['console-web/src/styles.css']===receipt.sourceHashes['console-web/src/styles.css'],'REVIEW_GEOMETRY_PROOF_SOURCE');
    assert.deepEqual(proof.drawerMeasurements.map(item=>item.label),['dlq-834','group-768'],'REVIEW_GEOMETRY_PROOF_KEYS');
    assert(proof.drawerMeasurements.every(item=>item.width<=item.viewport+1&&item.documentWidth<=item.viewport+1),'REVIEW_GEOMETRY_PROOF_BOUNDS');
    receipt.reusedDrawerEvidence={sha256:createHash('sha256').update(readFileSync('/state/geometry-proof.json')).digest('hex'),measurements:proof.drawerMeasurements};
  } else {
    await drawer(page,'/subscriptions',()=>page.getByRole('row').filter({hasText:fixture.groups[1].name}).getByRole('button',{name:/DLQ$/}).click(),{width:834,height:1112},'dlq-834');
    await drawer(page,'/groups',()=>page.getByRole('cell',{name:fixture.groups[0].name,exact:true}).click(),{width:768,height:1112},'group-768');
  }
  if(process.env.FE_REVIEW_FINISH_ONLY==='1') {
    const proof=privateJSON('chart-proof.json');
    assert(proof.run===credentials.run&&proof.source===credentials.source,'REVIEW_PRIOR_CHART_IDENTITY');
    for(const path of ['console-web/src/pages/DashboardPage.tsx','console-web/src/styles.css'])assert.equal(proof.sourceHashes[path],receipt.sourceHashes[path],'REVIEW_PRIOR_PRODUCT_HASH');
    const phases=['before','collapsed','after'].map(phase=>proof.chart.find(item=>item.phase===phase));
    assert(phases.every(item=>item&&item.window===1440&&item.documentWidth<=1441&&Math.abs(item.canvas-item.container)<=1),'REVIEW_PRIOR_CHART_METRICS');
    assert(phases[0].container===phases[2].container&&phases[1].container!==phases[0].container&&phases.every(item=>item.timeOrigin===phases[0].timeOrigin),'REVIEW_PRIOR_CHART_SEQUENCE');
    const states=['desktop','tablet','mobile'].map(size=>privateJSON(size+'-states.json'));
    assert(states[0].passed&&states[1].passed&&!states[2].passed&&states[2].failurePhase==='bad-password','REVIEW_PRIOR_STATES');
    assert.deepEqual(states.map(item=>item.captures.length),[14,14,13],'REVIEW_PRIOR_STATE_COUNTS');
    const keys=states.flatMap(item=>item.captures.map(capture=>capture.name));
    const suffixes=['topic-configuration','topic-sample','group','dlq','wizard-step1','wizard-step2','wizard-step3','wizard-step4','wizard-preview','delay-present','missing-delay','controlled-empty','controlled-500','bad-password'];
    const expectedKeys=['desktop','tablet','mobile'].flatMap(size=>suffixes.filter(suffix=>size!=='mobile'||suffix!=='bad-password').map(suffix=>size+'-'+suffix));
    assert.deepEqual([...keys].sort(),expectedKeys.sort(),'REVIEW_PRIOR_STATE_KEYS');
    receipt.reusedChartEvidence={sha256:createHash('sha256').update(readFileSync('/state/chart-proof.json')).digest('hex'),measurements:phases};
    receipt.reusedStates=states.map(item=>({viewport:item.viewport,captures:item.captures.length,sha256:createHash('sha256').update(readFileSync('/state/'+item.viewport+'-states.json')).digest('hex')}));
  } else {
  receipt.failureSite='chart:baseline';receipt.stage='chart';
  receipt.chartNavigations=[];
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())receipt.chartNavigations.push({stage:receipt.stage,path:new URL(frame.url()).pathname});});
  await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/dashboard');
  await Promise.race([vite.environments.client.waitForRequestsIdle(),pause(10000).then(()=>{throw new Error('REVIEW_OPTIMIZER_IDLE_TIMEOUT');})]);
  await page.waitForLoadState('networkidle');
  const chart=page.getByRole('img',{name:'Active resource chart',exact:true});await chart.waitFor();
  const measure=()=>chart.evaluate(element=>({window:innerWidth,documentWidth:document.documentElement.scrollWidth,container:element.clientWidth,canvas:element.querySelector('canvas')?.getBoundingClientRect().width,sider:document.querySelector('.app-sider')?.getBoundingClientRect().width,toggle:document.querySelector('.app-header button')?.getAttribute('aria-label'),timeOrigin:performance.timeOrigin}));
  const stable=async(sider,label)=>{
    await page.waitForFunction(({sider,label})=>{const e=document.querySelector('.chart'),c=e?.querySelector('canvas'),s=document.querySelector('.app-sider'),b=document.querySelector('.app-header button');return e&&c&&s&&b&&innerWidth===1440&&Math.abs(s.getBoundingClientRect().width-sider)<1&&b.getAttribute('aria-label')===label&&Math.abs(c.getBoundingClientRect().width-e.clientWidth)<=1;},{sider,label});
    const first=await measure();await pause(400);const second=await measure();assert(second.documentWidth<=1441,'REVIEW_CHART_OVERFLOW');assert.deepEqual(second,first,'REVIEW_CHART_STABLE_BASELINE');return second;
  };
  const before=await stable(248,'Collapse navigation');receipt.chart.push({phase:'before',...before});
  await page.screenshot({path:out+'/screenshots/chart-before.png',fullPage:false});
  receipt.chart.push({phase:'after-before-screenshot',...await measure()});
  receipt.failureSite='chart:collapse-click';await page.getByRole('button',{name:'Collapse navigation',exact:true}).click();
  receipt.chart.push({phase:'immediately-after-collapse-click',...await measure()});
  receipt.failureSite='chart:collapsed-stable';const collapsed=await stable(72,'Expand navigation');receipt.chart.push({phase:'collapsed',...collapsed});
  assert(collapsed.container!==before.container&&collapsed.timeOrigin===before.timeOrigin,'REVIEW_CHART_COLLAPSE_SAME_DOCUMENT');
  await page.screenshot({path:out+'/screenshots/chart-collapsed.png',fullPage:false});
  receipt.chart.push({phase:'after-collapsed-screenshot',...await measure()});
  receipt.failureSite='chart:expand-click';await page.getByRole('button',{name:'Expand navigation',exact:true}).click();
  receipt.chart.push({phase:'immediately-after-expand-click',...await measure()});
  receipt.failureSite='chart:expanded-stable';const after=await stable(248,'Collapse navigation');receipt.chart.push({phase:'after',...after});
  assert(after.container===before.container&&after.timeOrigin===before.timeOrigin,'REVIEW_CHART_EXPAND_SAME_DOCUMENT');
  await page.screenshot({path:out+'/screenshots/chart-after.png',fullPage:false});
  receipt.chart.push({phase:'after-expanded-screenshot',...await measure()});
  }
  receipt.failureSite='states';receipt.stage='states';
  await command([require.resolve('@playwright/test/cli'),'test','--config',component+'/fe-review/playwright.config.ts'],'states',{FE_REVIEW_OUTPUT:out,...(process.env.FE_REVIEW_FINISH_ONLY==='1'?{FE_REVIEW_MOBILE_NEGATIVE_ONLY:'1'}:{})});
  receipt.failureSite='loaded';receipt.stage='loaded';
  const pages=JSON.parse(readFileSync(component+'/fe-review/targets.json','utf8')).apps.flatMap(a=>a.pages);
  const headings={login:'Welcome back',dashboard:'System overview',topics:'Topics',groups:'Consumer groups',subscriptions:'Subscriptions',delay:'Delay inspector','admin-clusters':'Kafka clusters','admin-audit':'Audit trail','admin-users':'Users'};
  for(const pg of pages)for(const viewport of [{name:'desktop',width:1440,height:900},{name:'tablet',width:834,height:1112},{name:'mobile',width:390,height:844}]) {
    const ctx=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},locale:'en-US',colorScheme:'light',...(pg.id==='login'?{}:{storageState:'/state/auth.storage.json'})});
    try {
      const p=await ctx.newPage();const loadedHealth=observeHealth(p,()=>pg.id==='login'?'login':'normal');
      const res=await p.goto(origin+pg.path);assert.equal(res.status(),200);assert.equal(p.url(),origin+pg.path);await p.getByRole('heading',{name:headings[pg.id],exact:true}).waitFor();
      if(['topics','groups','subscriptions'].includes(pg.id))await p.getByRole('cell',{name:pg.id==='topics'?fixture.topic.name:fixture.groups[0].name,exact:true}).first().waitFor();
      if(pg.id==='dashboard')await p.locator('.chart canvas').waitFor();
      if(pg.id==='login')await p.getByRole('button',{name:'Sign in',exact:true}).waitFor();
      if(pg.id==='delay'){await p.getByLabel('Delay ID',{exact:true}).waitFor();assert(await p.getByRole('button',{name:/Inspect$/}).isDisabled(),'REVIEW_DELAY_INITIAL');}
      if(pg.id==='admin-clusters')await p.getByText(fixture.cluster.name,{exact:true}).waitFor();
      if(pg.id==='admin-users')await p.getByRole('cell',{name:credentials.user,exact:true}).waitFor();
      if(pg.id==='admin-audit'){await p.locator('.ant-table-tbody tr.ant-table-row').first().waitFor();await p.getByRole('cell',{name:credentials.user,exact:true}).first().waitFor();}
      const health=loadedHealth();assert(!health.some(item=>item.classification==='unexpected'),'REVIEW_LOADED_REQUEST_HEALTH');
      const errors=health.filter(item=>item.kind==='pageerror').length;
      const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert(!overflow&&errors===0,'REVIEW_LOADED_HEALTH');
      receipt.loaded.push({page:pg.id,viewport:viewport.name,status:200,identity:true,finalURL:true,overflow,pageErrors:errors,health,loadedContent:true});
    }finally{await ctx.close();}
  }
  receipt.failureSite='shared-capture';receipt.stage='shared-capture';
  const targets={project:'ojbquay console',locale:'en-US',colorSchemes:['light'],apps:[{name:'login',kind:'spa',cwd:component+'/console-web',baseUrl:origin,pages:pages.filter(p=>p.id==='login')},{name:'console',kind:'spa',cwd:component+'/console-web',baseUrl:origin,storageState:'/state/auth.storage.json',pages:pages.filter(p=>p.id!=='login')}]};
  writeFileSync('/state/capture-targets.json',JSON.stringify(targets),{flag:'wx',mode:0o600});
  const captureEnv={PLAYWRIGHT_MODULE:component+'/fe-review/browser-policy.mjs'};
  await command([root+'/docs/fe-review/capture.mjs','/state/capture-targets.json','--dry-run','--out',out+'/matrix'],'capture-plan',captureEnv);
  await command([root+'/docs/fe-review/capture.mjs','/state/capture-targets.json','--out',out+'/matrix'],'capture',captureEnv);
  const manifest=JSON.parse(readFileSync(out+'/matrix/capture.json','utf8'));assert.equal(manifest.results.length,27);
  receipt.captures=manifest.results.map(r=>{const health=sharedHealth(r);assert(health.passed,'REVIEW_CAPTURE_REQUEST_HEALTH');assert(r.status===200&&!r.error&&!r.horizontalOverflow&&r.pageErrors.length===0,'REVIEW_CAPTURE_GATE');return {page:r.page,viewport:r.viewport,status:r.status,overflow:r.horizontalOverflow,pageErrors:r.pageErrors.length,consoleErrors:r.consoleErrors.length,requestFailures:r.failedRequests.length,health,sha256:createHash('sha256').update(readFileSync(out+'/matrix/'+r.screenshot)).digest('hex')};});
  receipt.health=mainHealth();assert(!receipt.health.some(e=>e.classification==='unexpected'),'REVIEW_MAIN_HEALTH');
  receipt.passed=true;
  });
}catch(error){
  receipt.failure={stage:receipt.stage,site:receipt.failureSite??receipt.stage,category:String(error.message).startsWith('REVIEW_')?String(error.message):error.name};exitCode=1;
  let diagnostic=String(error.stack??error);
  const secrets=[credentials.password];
  try{secrets.push(...privateJSON('fixture.json').secrets);}catch{}
  for(const secret of secrets.filter(Boolean))diagnostic=diagnostic.split(secret).join('[REDACTED]');
  writeFileSync('/state/failure.txt',diagnostic,{flag:'wx',mode:0o600});
  if(mainPage)try{
    const buttons=await bounded(()=>mainPage.getByRole('button').evaluateAll(elements=>elements.map(element=>({text:element.textContent,ariaLabel:element.getAttribute('aria-label'),icons:[...element.querySelectorAll('[role=img]')].map(icon=>icon.getAttribute('aria-label'))}))),500,'failure-diagnostic');
    let text=JSON.stringify({site:receipt.failure.site,buttons});for(const secret of secrets.filter(Boolean))text=text.split(secret).join('[REDACTED]');
    writeFileSync('/state/button-diagnostic.json',text,{flag:'wx',mode:0o600});
  }catch{}
}
finally {
  if(mainHealth)receipt.health=mainHealth();
  try{receipt.cleanup.children=await bounded(cleanupChild,3000,'children');}catch{receipt.cleanup.children=false;}
  receipt.lifecycle=await lifecycle.finish();
  receipt.cleanup.acquisitionsDrained=receipt.lifecycle.drainComplete;
  for(const name of ['browser','vite','proxy'])receipt.cleanup[name]=receipt.lifecycle.resources.find(resource=>resource.name===name)?.closed??true;
  receipt.cleanup.listenersAbsent=!(await portOpen(5173))&&!(await portOpen(8080));
  if(lifecycle.cancelled)receipt.passed=false;
  if(!Object.values(receipt.cleanup).every(Boolean)){receipt.passed=false;exitCode=1;}
  const text=JSON.stringify(receipt,null,2);assert(!text.includes(credentials.password),'REVIEW_SECRET');
  writeFileSync(out+'/result.json',text,{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({passed:receipt.passed,stage:receipt.stage,cleanup:receipt.cleanup})+'\n');
}
for(const [signal,handler] of signals)process.off(signal,handler);
// Receipt is synchronously persisted even when a close/acquisition remains unknown.
// The root launcher then removes only this owned tool container.
process.exit(lifecycle.cancelled?(lifecycle.reason==='SIGINT'?130:143):exitCode);

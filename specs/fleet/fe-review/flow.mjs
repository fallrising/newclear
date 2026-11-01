import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { enabledAction } from './guards.mjs';
import { observed, unwrap } from './pending.mjs';
const require = createRequire('/review-tools/package.json');
const { AxeBuilder } = require('@axe-core/playwright');
const base = 'http://127.0.0.1:18765';
const sizes = [{name:'desktop',width:1440,height:900},{name:'tablet',width:834,height:1112},{name:'mobile',width:390,height:844}];
const check = (ok, code) => { if (!ok) throw new Error('REVIEW_'+code); };
export async function tabTo(page, locator) {
  for (let count=0;count<60;count++) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((element) => element === document.activeElement)) {
      check(await locator.evaluate((element) => { const style=getComputedStyle(element); return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth)>0; }), 'FOCUS_VISIBLE');
      return count+1;
    }
  }
  throw new Error('REVIEW_TAB_LIMIT');
}
let captureChild;
let captureClosed;
function captureGroupPresent() {
  if (!captureChild?.pid) return false;
  try {process.kill(-captureChild.pid,0);return true;} catch(error) {return error.code !== 'ESRCH';}
}
export async function stopCapture() {
  if (!captureChild) return true;
  if(captureGroupPresent()) {try {process.kill(-captureChild.pid,'SIGTERM');} catch {}}
  for(let i=0;i<20&&captureGroupPresent();i++)await new Promise(resolve=>setTimeout(resolve,50));
  if(captureGroupPresent()) {try {process.kill(-captureChild.pid,'SIGKILL');} catch {}}
  await captureClosed;
  for(let i=0;i<20&&captureGroupPresent();i++)await new Promise(resolve=>setTimeout(resolve,50));
  return !captureGroupPresent();
}
export async function runCapture(args, state) {
  const log=[];
  const child=spawn(process.execPath, ['/work/docs/fe-review/capture.mjs',...args], { cwd:'/work', detached:true, stdio:['ignore','pipe','pipe'], env:{PATH:process.env.PATH,PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH,PLAYWRIGHT_MODULE:'/review-tools/node_modules/playwright/index.mjs'} });
  captureChild=child;captureClosed=new Promise(resolve=>{child.once('close',resolve);child.once('error',resolve);});
  child.stdout.on('data',data=>log.push(data));child.stderr.on('data',data=>log.push(data));
  let timer;let killTimer;
  try {
    const code=await new Promise((resolve,reject)=> { child.on('error',()=>reject(new Error('REVIEW_CAPTURE_SPAWN')));child.on('close',resolve);timer=setTimeout(()=>{try {process.kill(-child.pid,'SIGTERM');} catch {} killTimer=setTimeout(()=>{try {process.kill(-child.pid,'SIGKILL');} catch {}},2000);},90000); });
    // Private capture stdout may contain browser diagnostics; never publish verbatim.
    writeFileSync(path.join(state,args.includes('--dry-run')?'capture-plan.log':'capture.log'),Buffer.concat(log),{mode:0o600});
    check(code===0,'CAPTURE_EXIT');
  } finally {clearTimeout(timer);clearTimeout(killTimer);check(await stopCapture(),'CAPTURE_CLEANUP');}
}
export async function finalFlow({page,context,browser,api,operator,bootstrap,older,current,out,state,result,reportHealthy,setStage}) {
  const receipt=(name,extra={})=>result.steps.push({stage:name,passed:true,...extra});
  const navigate=async(route,heading)=> {const response=await page.goto(base+route);check(response?.status()===200&&page.url()===base+route,'LOADED_URL');await page.getByRole('heading',{name:heading,exact:true}).waitFor();};
  const post=async(action,trigger)=> {
    const pending=observed(page.waitForResponse(r=>r.url()===base+'/api/v1/services/hello/'+action&&r.request().method()==='POST',{timeout:10000}));
    await trigger();const response=await unwrap(pending);result.actionResponses??=[];result.actionResponses.push({action,status:response.status()});return response;
  };
  setStage('CATALOG_KEYBOARD');await navigate('/','Catalog');
  let toggle=page.locator('#act-hello-toggle');
  const tabCount=await tabTo(page,toggle);
  setStage('CATALOG_STOP');const stop=await post('stop',()=>page.keyboard.press('Enter'));check(stop.status()===200,'STOP_STATUS');
  await page.locator('#row-hello:not(.htmx-settling)').getByRole('button',{name:'Start hello',exact:true}).waitFor();
  check(await toggle.evaluate(e=>e===document.activeElement),'STOP_FOCUS');
  check((await api('GET','/api/v1/services/hello',operator)).desired_state==='stopped','STOP_STATE');
  setStage('CATALOG_START');const start=await post('start',()=>page.keyboard.press('Enter'));check(start.status()===200,'START_STATUS');
  await page.locator('#row-hello:not(.htmx-settling)').getByRole('button',{name:'Stop hello',exact:true}).waitFor();
  check(await toggle.evaluate(e=>e===document.activeElement),'START_FOCUS');
  check((await api('GET','/api/v1/services/hello',operator)).desired_state==='running','START_STATE');
  await page.screenshot({path:path.join(out,'keyboard-toggle.png'),fullPage:true});receipt('CATALOG_KEYBOARD',{tabCount,stop:200,start:200,stableFocus:true});
  setStage('CATALOG_POLL');const pollStarted=Date.now();const oldTable=await page.locator('#catalog').elementHandle();
  const poll=await page.waitForResponse(r=>r.url()===base+'/'&&r.request().method()==='GET'&&!r.request().isNavigationRequest(),{timeout:22000});
  check(poll.status()===200,'POLL_STATUS');
  await page.waitForFunction(table=>!table.isConnected,oldTable);await oldTable.dispose();
  await page.locator('#catalog:not(.htmx-settling) #act-hello-toggle').waitFor();
  await page.waitForFunction(()=>document.activeElement?.id==='act-hello-toggle'&&document.querySelector('#act-hello-toggle'));
  check(await page.locator('meta[http-equiv="refresh"]').count()===0,'POLL_NO_RELOAD');receipt('CATALOG_POLL',{status:200,elapsedMs:Date.now()-pollStarted,stableFocus:true});
  setStage('BUSY');let release;const gate=new Promise(resolve=>{release=resolve;});const delayDeadline=setTimeout(()=>release(),3000);let entered;
  const enteredPromise=new Promise(resolve=>{entered=resolve;});
  const url=base+'/api/v1/services/hello/redeploy';
  const handler=async route=>{entered();await gate;await route.continue();};
  await page.route(url,handler);
  const pending=observed(page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:10000}));
  try {
    const redeploy=page.locator('#act-hello-redeploy');await tabTo(page,redeploy);await page.keyboard.press('Enter');
    await enteredPromise;check(await redeploy.isDisabled(),'BUSY_DISABLED');await page.screenshot({path:path.join(out,'busy.png'),fullPage:true});
    await tabTo(page,page.locator('header a'));check(await redeploy.isDisabled(),'BUSY_STILL_PENDING');
  } finally {clearTimeout(delayDeadline);release();}
  check((await unwrap(pending)).status()===200,'BUSY_STATUS');await page.unroute(url,handler);
  let recovered=false;
  for(let attempt=0;attempt<100;attempt++) {
    const snapshot=await page.evaluate(()=>{const b=document.querySelector('#act-hello-redeploy');return {present:!!b,id:b?.id,rowId:b?.closest('tr')?.id,disabled:b?.disabled};});
    if(enabledAction(snapshot)){recovered=true;break;}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  check(recovered,'BUSY_RECOVERY');check(await page.locator('header a').evaluate(e=>e===document.activeElement),'BUSY_NO_FOCUS_STEAL');receipt('BUSY',{controlledRequestDelay:true,responseUnmodified:true,disabledDuring:true,enabledAfter:true,userMovedToHeader:true,focusNotStolen:true});
  setStage('SERVICE_ACTIONS');await navigate('/services/hello','hello');
  for(const [action,label,desired] of [['stop','Stop hello','stopped'],['start','Start hello','running'],['redeploy','Redeploy hello','running']]) {
    setStage('SERVICE_'+action.toUpperCase());const button=page.getByRole('button',{name:label,exact:true});await tabTo(page,button);
    const loaded=observed(page.waitForEvent('domcontentloaded',{timeout:10000}));
    const reload=observed(page.waitForResponse(r=>r.url()===base+'/services/hello'&&r.request().isNavigationRequest(),{timeout:10000}));
    const response=await post(action,()=>page.keyboard.press('Enter'));check(response.status()===200,'SERVICE_ACTION_STATUS');
    check((await unwrap(reload)).status()===200,'SERVICE_RELOAD');await unwrap(loaded);await page.getByRole('heading',{name:'hello',exact:true}).waitFor();
    check((await api('GET','/api/v1/services/hello',operator)).desired_state===desired,'SERVICE_DESIRED');
    check(await page.locator('button tr').count()===0,'SERVICE_NO_ROW_SWAP');
  }
  receipt('SERVICE_ACTIONS',{stop:200,start:200,redeploy:200,reloads:3});
  setStage('ROLLBACK');const rollback=page.getByRole('button',{name:'Rollback hello to '+older.id,exact:true});await tabTo(page,rollback);
  const rollbackLoaded=observed(page.waitForEvent('domcontentloaded',{timeout:10000}));
  const reload=observed(page.waitForResponse(r=>r.url()===base+'/services/hello'&&r.request().isNavigationRequest(),{timeout:10000}));
  const response=await post('deploy',()=>page.keyboard.press('Enter'));
  const request=response.request();const sent=JSON.parse(request.postData());
  check(response.status()===202&&sent.release_id===older.id&&Object.keys(sent).length===1&&request.headers()['content-type']?.includes('application/json'),'ROLLBACK_JSON');
  check((await unwrap(reload)).status()===200,'ROLLBACK_RELOAD');await unwrap(rollbackLoaded);await page.getByRole('heading',{name:'hello',exact:true}).waitFor();
  check((await api('GET','/api/v1/services/hello',operator)).release_id===older.id,'ROLLBACK_RELEASE');
  check(await page.getByRole('button',{name:'Rollback hello to '+older.id,exact:true}).count()===0,'ROLLBACK_CURRENT_MARKER');receipt('ROLLBACK',{status:202,jsonBody:true,jsonHeader:true,currentReleaseChanged:true});
  setStage('ERROR_ALERT');
  // Controlled DOM branch: submit the existing real API route for a nonexistent
  // synthetic service. No interception, response fabrication or backend change.
  const errorButton=page.getByRole('button',{name:'Stop hello',exact:true});
  await errorButton.evaluate(e=>{e.setAttribute('hx-post','/api/v1/services/missing-review/stop');htmx.process(e);});
  let reloads=0;const navigation=()=>reloads++;page.on('framenavigated',navigation);
  const failed=observed(page.waitForResponse(r=>r.url()===base+'/api/v1/services/missing-review/stop'&&r.request().method()==='POST',{timeout:10000}));
  await tabTo(page,errorButton);await page.keyboard.press('Enter');const failure=await unwrap(failed);const envelope=await failure.json();
  const flash=page.locator('#flash');await flash.waitFor({state:'visible'});
  check(failure.status()===404&&(await flash.textContent())==='404: '+envelope.error.message,'ERROR_MESSAGE');
  check(await flash.evaluate(e=>[...e.childNodes].every(n=>n.nodeType===Node.TEXT_NODE)),'ERROR_TEXT_ONLY');
  check(reloads===0,'ERROR_NO_RELOAD');page.off('framenavigated',navigation);
  await page.screenshot({path:path.join(out,'error-alert.png'),fullPage:true});receipt('ERROR_ALERT',{status:404,controlledDOMTarget:true,realBackend:true,textOnly:true,reloads});
  setStage('EMPTY_STATES');
  await api('POST','/api/v1/nodes/register',bootstrap,{id:'vps-empty',display_name:'Empty synthetic node',agent_instance_id:'empty-instance'},201);
  await api('POST','/api/v1/services',operator,{apiVersion:'fleet.catalog/v1',kind:'Service',metadata:{name:'empty'},spec:{node:'vps-fe-1',desiredState:'stopped',expose:{mode:'public',hostname:'empty.fleet.invalid',port:8080}}},201);
  await navigate('/nodes/vps-empty','Node vps-empty');await page.getByText('No services on this node.',{exact:true}).waitFor();await page.getByText('No facts reported yet.',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'empty-node.png'),fullPage:true});
  await navigate('/services/empty','empty');await page.getByText('No releases yet.',{exact:true}).waitFor();await page.getByText('No instance reported yet.',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'empty-service.png'),fullPage:true});receipt('EMPTY_STATES',{node:true,releases:true,instance:true,audit:'native-render-test'});
  await reportHealthy();
  setStage('CAPTURE');const authPath=path.join(state,'auth.storage.json');await context.storageState({path:authPath});
  const source=JSON.parse(readFileSync('/work/specs/fleet/fe-review/targets.json','utf8'));
  const pages=source.apps.flatMap(app=>app.pages);
  const targets={project:'fleet',locale:'en-US',colorSchemes:['light'],apps:[{name:'fleet-login',kind:'server',cwd:'/work/specs/fleet',baseUrl:base,pages:pages.filter(p=>p.id==='login')},{name:'fleetd',kind:'server',cwd:'/work/specs/fleet',baseUrl:base,storageState:authPath,pages:pages.filter(p=>p.id!=='login')}]};
  const targetPath=path.join(state,'targets.json');writeFileSync(targetPath,JSON.stringify(targets),{mode:0o600});
  await runCapture([targetPath,'--dry-run','--out',path.join(out,'matrix')],out);
  await runCapture([targetPath,'--no-axe','--out',path.join(out,'matrix')],out);
  const manifest=JSON.parse(readFileSync(path.join(out,'matrix/capture.json'),'utf8'));
  check(manifest.results.length===12,'CAPTURE_COUNT');
  const keys=new Set();result.captures=[];
  for(const record of manifest.results) {
    const key=record.page+'/'+record.viewport+'/'+record.colorScheme;check(!keys.has(key),'CAPTURE_DUPLICATE');keys.add(key);
    check(!record.error&&record.status===200&&record.pageErrors.length===0&&!record.horizontalOverflow,'CAPTURE_ORACLE');
    const bytes=readFileSync(path.join(out,'matrix',record.screenshot));
    result.captures.push({key,status:record.status,pageErrors:record.pageErrors.length,horizontalOverflow:record.horizontalOverflow,sha256:createHash('sha256').update(bytes).digest('hex'),consoleCount:record.consoleErrors.length,requestIssueCount:record.failedRequests.length});
  }
  receipt('CAPTURE',{count:12,sharedUnmodified:true,supervisorStarted:true});
  setStage('LOADED_AXE');result.loaded=[];result.axe=[];
  for(const pg of pages)for(const size of sizes) {
    const ctx=await browser.newContext({viewport:{width:size.width,height:size.height},locale:'en-US',colorScheme:'light',...(pg.id==='login'?{}:{storageState:authPath})});
    try {
      const p=await ctx.newPage();p.on('pageerror',()=>result.pageErrors++);const res=await p.goto(base+pg.path);check(res.status()===200&&p.url()===base+pg.path,'LOADED_URL');
      const heading={login:'Operator token',catalog:'Catalog',node:'Node vps-fe-1',service:'hello'}[pg.id];await p.getByRole('heading',{name:heading,exact:true}).waitFor();
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'LOADED_OVERFLOW');
      result.loaded.push({page:pg.id,viewport:size.name,status:200,finalPathMatches:true,identity:true,overflow:false});
      if(size.name==='desktop') {
        const axe=await new AxeBuilder({page:p}).analyze();
        result.axeVersion=axe.testEngine.version;
        const summarize=list=>list.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length,targets:v.nodes.map(n=>n.target)}));
        result.axe.push({page:pg.id,violations:summarize(axe.violations),incomplete:summarize(axe.incomplete)});
        check(!axe.violations.some(v=>v.id==='color-contrast'&&v.nodes.some(n=>n.target.some(t=>String(t).includes('health-')))),'STATUS_CONTRAST');
        const colors=await p.locator('[class^="health-"]').evaluateAll(elements=>elements.map(e=>({className:e.className,color:getComputedStyle(e).color,before:getComputedStyle(e,'::before').content,text:e.textContent})));
        result.statusStyles??=[];result.statusStyles.push({page:pg.id,colors});
      }
    } finally {await ctx.close();}
  }
  receipt('LOADED_AXE',{loaded:12,scans:4});
}

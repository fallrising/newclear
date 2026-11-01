import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { runCapture } from './flow.mjs';
import { healthCollector } from './health.mjs';
const require=createRequire('/review-tools/package.json');
const { AxeBuilder }=require('@axe-core/playwright');
const base='http://127.0.0.1:18765';
const sizes=[{name:'desktop',width:1440,height:900},{name:'tablet',width:834,height:1112},{name:'mobile',width:390,height:844}];
const check=(ok,code)=>{if(!ok)throw new Error('REVIEW_'+code);};
export async function remainingChecks({context,browser,api,operator,bootstrap,older,state,out,result,reportHealthy,setStage}) {
 result.coverage='single-replacement-and-previously-unrun-checks';
 setStage('REPAIR_FIXTURE');
 // Fresh equivalent synthetic presentation state; IDs/generation/timestamps vary.
 // This setup is not a repeated browser interaction acceptance run.
 await api('POST','/api/v1/services/hello/deploy',operator,{release_id:older.id},202);
 await api('POST','/api/v1/nodes/register',bootstrap,{id:'vps-empty',display_name:'Empty synthetic node',agent_instance_id:'empty-instance'},201);
 await api('POST','/api/v1/services',operator,{apiVersion:'fleet.catalog/v1',kind:'Service',metadata:{name:'empty'},spec:{node:'vps-fe-1',desiredState:'stopped',expose:{mode:'public',hostname:'empty.fleet.invalid',port:8080}}},201);
 await reportHealthy();
 const authPath=path.join(state,'auth.storage.json');await context.storageState({path:authPath});
 const source=JSON.parse(readFileSync('/work/specs/fleet/fe-review/targets.json','utf8'));const pages=source.apps.flatMap(app=>app.pages);
 const targets={project:'fleet',locale:'en-US',colorSchemes:['light'],viewports:[sizes[2]],apps:[{name:'fleetd',kind:'server',cwd:'/work/specs/fleet',baseUrl:base,storageState:authPath,pages:pages.filter(p=>p.id==='service')}]};
 const targetPath=path.join(state,'targets-repair.json');writeFileSync(targetPath,JSON.stringify(targets),{mode:0o600});
 setStage('REPAIR_CAPTURE');
 await runCapture([targetPath,'--dry-run','--out',path.join(out,'matrix')],out);
 await runCapture([targetPath,'--no-axe','--out',path.join(out,'matrix')],out);
 const manifest=JSON.parse(readFileSync(path.join(out,'matrix/capture.json'),'utf8'));
 check(manifest.results.length===1,'REPAIR_COUNT');const record=manifest.results[0];
 check(record.page==='service'&&record.viewport==='mobile'&&record.colorScheme==='light'&&!record.error&&record.status===200&&record.pageErrors.length===0&&!record.horizontalOverflow,'REPAIR_ORACLE');
 result.captures=[{key:'service/mobile/light',replaces:'final-003 service/mobile/light',status:200,pageErrors:0,horizontalOverflow:false,sha256:createHash('sha256').update(readFileSync(path.join(out,'matrix',record.screenshot))).digest('hex'),consoleCount:record.consoleErrors.length,requestIssueCount:record.failedRequests.length}];
 result.steps.push({stage:'REPAIR_CAPTURE',passed:true,count:1});
 setStage('LOADED_AXE');result.loaded=[];result.axe=[];
 for(const pg of pages)for(const size of sizes) {
  const ctx=await browser.newContext({viewport:{width:size.width,height:size.height},locale:'en-US',colorScheme:'light',...(pg.id==='login'?{}:{storageState:authPath})});
  try {
   const p=await ctx.newPage();p.on('pageerror',()=>result.pageErrors++);const health=healthCollector(base);health.attach(p);
   const res=await p.goto(base+pg.path);check(res.status()===200&&p.url()===base+pg.path,'LOADED_URL');
   const heading={login:'Operator token',catalog:'Catalog',node:'Node vps-fe-1',service:'hello'}[pg.id];await p.getByRole('heading',{name:heading,exact:true}).waitFor();
   check(await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'LOADED_OVERFLOW');
   if(pg.id==='service'&&size.name==='mobile') {
    result.repairMetrics=await p.evaluate(()=>{const span=document.querySelector('th .visually-hidden'),wrapper=span.closest('.table-scroll');return {documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,hiddenLabelContained:span.offsetParent===wrapper,wrapperPosition:getComputedStyle(wrapper).position,wrapperClientWidth:wrapper.clientWidth,wrapperScrollWidth:wrapper.scrollWidth,actionsTextRetained:span.textContent==='Actions'};});
    const m=result.repairMetrics;check(m.documentWidth===390&&m.hiddenLabelContained&&m.wrapperPosition==='relative'&&m.wrapperScrollWidth>m.wrapperClientWidth&&m.actionsTextRetained,'REPAIR_CONTAINMENT');
    check(await p.getByRole('columnheader',{name:'Actions',exact:true}).count()===1,'REPAIR_ACCESSIBLE_HEADER');
   }
   if(size.name==='desktop') {
    const axe=await new AxeBuilder({page:p}).analyze();result.axeVersion=axe.testEngine.version;
    const summarize=list=>list.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length,targets:v.nodes.map(n=>n.target)}));
    result.axe.push({page:pg.id,violations:summarize(axe.violations),incomplete:summarize(axe.incomplete)});
    check(!axe.violations.some(v=>v.id==='color-contrast'&&v.nodes.some(n=>/class=["'][^"']*\bhealth-/.test(n.html))),'STATUS_CONTRAST');
    result.statusStyles??=[];result.statusStyles.push({page:pg.id,colors:await p.locator('[class^="health-"]').evaluateAll(elements=>elements.map(e=>({className:e.className,color:getComputedStyle(e).color,before:getComputedStyle(e,'::before').content,text:e.textContent})))});
   }
   result.loaded.push({page:pg.id,viewport:size.name,status:200,finalPathMatches:true,identity:true,overflow:false,health:health.result});
  } finally {await ctx.close();}
 }
 check(result.loaded.length===12&&result.axe.length===4,'REMAINING_COUNTS');
 result.steps.push({stage:'LOADED_AXE',passed:true,loaded:12,scans:4});
}

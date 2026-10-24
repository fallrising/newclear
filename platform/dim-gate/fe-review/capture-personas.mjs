// Capture/navigation only. Workflow correctness remains in the existing e2e suite.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseUrl, buildPlan, reviewUrl, verifiedCaptureKeys } from './capture-plan.mjs';

const plan = buildPlan();
const args = process.argv.slice(2);
const resumeIndex = args.indexOf('--resume');
const resumeName = resumeIndex < 0 ? null : args[resumeIndex + 1];
if (resumeName && !/^[0-9TZ]+$/.test(resumeName)) throw new Error('resume must be an existing run identifier');
if (args.some((arg,i) => arg !== '--dry-run' && arg !== '--resume' && !(resumeIndex >= 0 && i === resumeIndex + 1)) || (resumeIndex >= 0 && !resumeName) || args.filter(arg=>arg==='--resume').length > 1) throw new Error('usage: capture-personas.mjs [--dry-run] [--resume RUN_ID]');
if (args.includes('--dry-run')) {
  console.log(JSON.stringify({baseUrl, combinations: plan.length, captures: plan.reduce((n,p)=>n+p.pages.length,0), plan},null,2));
} else {
  assert.deepEqual(readdirSync('/sys/class/net'), ['lo'], 'requires a dedicated loopback-only namespace');
  const { chromium, expect } = await import('@playwright/test');
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const reviewDir = dirname(fileURLToPath(import.meta.url));
  const driverSha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  const priorResults = [], ancestors = new Set();
  for (let name = resumeName; name;) {
    assert(/^[0-9TZ]+$/.test(name) && !ancestors.has(name), 'invalid resume ancestry');
    ancestors.add(name);
    const prior = JSON.parse(readFileSync(join(reviewDir,'runs',name,'capture.json')));
    priorResults.push(...prior.results);
    name = prior.resumedFrom;
  }
  const completed = verifiedCaptureKeys(priorResults);
  const runId = new Date().toISOString().replace(/[^0-9TZ]/g,'');
  const output = join(reviewDir,'runs',runId);
  mkdirSync(output,{mode:0o700}); mkdirSync(join(output,'screenshots'));
  const browser = await chromium.launch();
  const results = [];
  let context;
  try {
    for (const {persona,theme,viewport,pages} of plan) {
      if (pages.every(entry => completed.has([persona,entry.id,viewport.name,theme].join('|')))) continue;
      context = await browser.newContext({viewport:{width:viewport.width,height:viewport.height},locale:'zh-TW',colorScheme:theme});
      await context.addInitScript(theme => localStorage.setItem('dim-gate.ui.v1',JSON.stringify({theme,density:'normal'})),theme);
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const consoleErrors=[], pageErrors=[], failedRequests=[];
      page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
      page.on('pageerror',e=>pageErrors.push(e.message));
      page.on('requestfailed',r=>failedRequests.push(`${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
      page.on('response',r=>{if(r.status()>=400)failedRequests.push(`${r.request().method()} ${new URL(r.url()).pathname} HTTP${r.status()}`);});
      await page.goto(baseUrl);
      const select = page.getByRole('combobox',{name:'示範身分'});
      await expect(select).toBeEnabled(); await select.selectOption(persona);
      await expect(select).toHaveValue(persona); await expect(select).toBeEnabled();
      for (const entry of pages) {
        if (completed.has([persona,entry.id,viewport.name,theme].join('|'))) continue;
        const url = reviewUrl(entry.path);
        const response = await page.goto(url,{waitUntil:'networkidle'});
        assert.equal(response.status(),200);
        await expect(select).toHaveValue(persona);
        await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
        await expect(page.locator('main h1').first()).toBeVisible();
        await expect(page.locator('main .loading-state')).toHaveCount(0);
        await expect(page.locator('main .error-state')).toHaveCount(0);
        await expect(page.getByText(/目前身分無法進入/)).toHaveCount(0);
        await expect(page.getByText('DATA_MODE_REQUIRED',{exact:true})).toHaveCount(0);
        await expect(page).toHaveURL(url);
        const capture = async (id, status) => {
          const screenshot=`${persona}__${id}__${viewport.name}__${theme}.png`;
          await page.screenshot({path:join(output,'screenshots',screenshot),fullPage:true});
          let axe;
          try { const scan = await new AxeBuilder({page}).analyze(); axe = {violations:scan.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}))}; }
          catch(error) { axe = {error:error instanceof Error?error.message:String(error)}; }
          await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
          await expect(select).toHaveValue(persona);
          await expect(page.locator('main h1').first()).toBeVisible();
          results.push({persona,page:id,viewport:viewport.name,colorScheme:theme,url:page.url(),status,screenshot:`screenshots/${screenshot}`,theme:await page.locator('html').getAttribute('data-theme'),selectedPersona:await select.inputValue(),heading:await page.locator('main h1').first().innerText(),horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),consoleErrors:consoleErrors.splice(0),pageErrors:pageErrors.splice(0),failedRequests:failedRequests.splice(0),axe});
        };
        await capture(entry.id,response.status());
        if (entry.discoverPrefix) {
          const link=page.locator(`main a[href^="/dim-gate${entry.discoverPrefix}"]`).first();
          if(await link.count()) {
            await link.click();
            await expect(page.locator('main h1').first()).toBeVisible();
            await expect(page.locator('main .loading-state')).toHaveCount(0);
            await expect(page.locator('main .error-state')).toHaveCount(0);
            assert(new URL(page.url()).pathname.startsWith('/dim-gate'+entry.discoverPrefix));
            await expect(select).toHaveValue(persona);
            await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
            await expect(page.getByText(/目前身分無法進入/)).toHaveCount(0);
            await capture(entry.id+'-detail',null);
          } else results.push({persona,page:entry.id+'-detail',viewport:viewport.name,colorScheme:theme,status:'not_available',reason:'fresh synthetic list has no detail link; no domain mutation performed',listURL:page.url()});
        }
      }
      await context.close();context=undefined;
    }
  } catch(error) {
    results.push({error:error instanceof Error?error.message:String(error)});process.exitCode=1;
  } finally {
    await context?.close(); await browser.close();
    writeFileSync(join(output,'capture.json'),JSON.stringify({project:'dim-gate',scope:'R2 navigation capture; not workflow or full Round3 acceptance',resumedFrom:resumeName,driverSha256,browser:browser.version(),node:process.version,axe:true,results},null,2)+'\n');
    console.log(JSON.stringify({runId,captures:results.filter(r=>r.screenshot).length,errors:results.filter(r=>r.error).length}));
  }
}

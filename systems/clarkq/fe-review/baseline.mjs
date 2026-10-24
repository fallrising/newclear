import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ORIGIN, allowedURL} from './guards.mjs';
import {longQueue, longBody} from './api-fixture.mjs';

export const viewports = [{name:'desktop', width:1440,height:900},{name:'tablet',width:834,height:1112},{name:'mobile',width:390,height:844}];
export async function baseline(browser, key, output, result, check, setStage, strict = false) {
  const {default:AxeBuilder} = await import(process.env.AXE_MODULE);
  result.baseline = [];
  for (const viewport of viewports) {
    check(); setStage('baseline-' + viewport.name);
    const context = await browser.newContext({viewport:{width:viewport.width,height:viewport.height}, colorScheme:'dark', locale:'en-US', serviceWorkers:'block'});
    const health = {consoleErrors:0, consoleWarnings:0, pageErrors:0, externalRequests:0, websockets:0, httpErrors:[], requestFailures:[]};
    try {
      await context.addInitScript(({key, origin}) => {localStorage.setItem('clarkq.base',origin); localStorage.setItem('clarkq.apiKey',key); localStorage.setItem('clarkq.tenant','');}, {key,origin:ORIGIN});
      await context.route('**/*', route => {
        if (!allowedURL(route.request().url())) {health.externalRequests++; return route.abort('blockedbyclient');}
        return route.continue();
      });
      await context.routeWebSocket('**/*', socket => {health.websockets++; socket.close();});
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('console', msg => {if(msg.type() === 'error')health.consoleErrors++; if(msg.type() === 'warning')health.consoleWarnings++;});
      page.on('pageerror', () => {health.pageErrors++;});
      page.on('response', response => {if(response.status() >= 400)health.httpErrors.push({path:allowedURL(response.url()) ? new URL(response.url()).pathname : '<rejected>', status:response.status()});});
      page.on('requestfailed', request => {health.requestFailures.push({path:allowedURL(request.url()) ? new URL(request.url()).pathname : '<rejected>', code: /^net::ERR_[A-Z_]+$/.test(request.failure()?.errorText ?? '') ? request.failure().errorText : 'UNKNOWN'});});
      const response = await page.goto(ORIGIN + '/ui/', {waitUntil:'networkidle',timeout:15000});
      assert(response.status() === 200 && page.url() === ORIGIN + '/ui/', 'REVIEW_UI_IDENTITY');
      await page.waitForFunction(() => document.querySelectorAll('#queuesWrap tbody tr').length === 14 && document.querySelector('#status').textContent === 'online');
      const row = page.locator('#queuesWrap tbody tr').filter({has:page.locator('code', {hasText:longQueue})});
      assert(await row.count() === 1, 'REVIEW_LONG_QUEUE_IDENTITY');
      assert((await row.locator('td').nth(1).textContent()).trim() === '3', 'REVIEW_LONG_QUEUE_DEPTH');
      await row.locator('[data-act="use"]').click();
      await page.locator('#btnPeek').click();
      await page.waitForFunction(body => document.querySelector('#log').textContent.includes(body), JSON.stringify(longBody).slice(1,-1));
      assert(await page.locator('#log script').count() === 0, 'REVIEW_BODY_NOT_LITERAL');
      await page.evaluate(() => window.scrollTo(0,0));
      const geometry = await page.evaluate(() => ({
        documentWidth:document.documentElement.scrollWidth, viewportWidth:document.documentElement.clientWidth,
        panels:[...document.querySelectorAll('.panel')].map((el,index)=>({index,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})),
        table:{clientWidth:document.querySelector('table').clientWidth,scrollWidth:document.querySelector('table').scrollWidth},
        pre:[...document.querySelectorAll('pre')].map(el=>({id:el.id,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth})),
      }));
      const axe = await new AxeBuilder({page}).analyze();
      const summarize = values => values.map(({id,impact,nodes})=>({id,impact,nodes:nodes.length}));
      const filename = `baseline-${viewport.name}.png`;
      await page.screenshot({path:join(output,filename),fullPage:true});
      const bytes = await readFile(join(output,filename));
      // This is an observation of the inherited five-second refresh, not a passing focus gate.
      const target = row.locator('[data-act="use"]');
      await target.focus();
      const focusBefore = await target.evaluate(el=>document.activeElement === el);
      await page.waitForTimeout(5300);
      const focusAfter = await target.evaluate(el=>document.activeElement === el);
      assert(health.externalRequests === 0 && health.websockets === 0, 'REVIEW_EXTERNAL_REQUEST');
      result.baseline.push({viewport,finalPath:'/ui/',status:200,loadedRows:14,longQueueDepth:3,literalBody:true,geometry,
        focus:{before:focusBefore,afterFiveSecondRefresh:focusAfter},
        axe:{violations:summarize(axe.violations),incomplete:summarize(axe.incomplete)},health,
        screenshot:{file:filename,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}});
      if(strict) {
        assert(geometry.documentWidth<=geometry.viewportWidth+1,'REVIEW_PAGE_OVERFLOW');
        assert(!axe.violations.some(v=>['critical','serious'].includes(v.impact)),'REVIEW_AXE_SERIOUS');
        assert(focusBefore&&focusAfter,'REVIEW_REFRESH_FOCUS_LOST');
        assert(!health.consoleErrors&&!health.consoleWarnings&&!health.pageErrors&&!health.httpErrors.length&&!health.requestFailures.length,'REVIEW_NORMAL_HEALTH');
      }
    } finally {await context.close();}
  }
}

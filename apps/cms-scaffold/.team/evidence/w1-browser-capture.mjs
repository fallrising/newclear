import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const dir = new URL('./w1-browser/ready/', import.meta.url);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const summary = [];
try {
  for (const viewport of [{ width:1440, height:900 }, { width:375, height:812 }]) {
    for (const [name, path, heading] of [
      ['details', '/entries/note/30000000-0000-4000-8000-000000000036', 'Lens notes'],
      ['index', '/entries/note', 'Notes'],
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', e => errors.push({ type:'pageerror', message:e.message }));
      page.on('console', e => { if(e.type()==='error') errors.push({ type:'console', message:e.text() }); });
      page.on('requestfailed', r => errors.push({ type:'requestfailed', url:r.url(), message:r.failure()?.errorText }));
      page.on('response', r => { if(r.status()>=400) errors.push({ type:'http', url:r.url(), status:r.status() }); });
      await page.goto(`http://localhost:5184${path}?mockUser=mock-operator-notes`);
      await page.getByRole('heading', { name:heading, exact:true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="query-loading"], [data-testid="index-row-loading"]').length === 0);
      if(name==='details') await page.getByTestId('ref-value').filter({ hasText:'Buy film' }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const dimensions = await page.evaluate(() => ({ viewport:innerWidth, width:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),title:document.title }));
      const stem = `${name}-${viewport.width}x${viewport.height}`;
      await page.screenshot({ path:new URL(`${stem}.png`,dir).pathname,fullPage:true });
      const result = { name, viewport, dimensions, errors };
      await writeFile(new URL(`${stem}.json`,dir),JSON.stringify(result,null,2)+'\n'); summary.push(result);
      await context.close();
    }
  }
} finally { await browser.close(); }
await writeFile(new URL('summary.json',dir),JSON.stringify(summary,null,2)+'\n');
if(summary.some(r=>r.errors.length || r.dimensions.width>r.dimensions.viewport)) process.exitCode=1;
console.log(JSON.stringify(summary.map(r=>({name:r.name,width:r.viewport.width,errors:r.errors.length,overflow:r.dimensions.width>r.dimensions.viewport}))));

// Bounded visual smoke capture, separate from W4 Appendix A (scheduled for W5).
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const output = '.team/evidence/w4-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const captures = [];
try {
  for (const width of [1440, 390]) {
    for (const [name, route, ready] of [
      ['overview', '/', '[data-testid="overview-audit-row"]'],
      ['type-detail', '/types/owner', '[data-testid="type-field"]'],
      ['permissions', '/roles/member', '[data-testid="matrix-row"]'],
      ['new-principal', '/principals/new', '[data-testid="role-fields"]'],
      ['audit', '/audit', '[data-testid="index-row"]'],
      ['inspector', '/entries/30000000-0000-4000-8000-000000000017', '[data-testid="member-links"]'],
    ]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('requestfailed', request => errors.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
      await page.goto(`http://localhost:5175${route}?mockUser=seed-admin`);
      await page.locator(ready).first().waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-testid="query-loading"],[data-testid="index-row-loading"]'));
      await page.evaluate(() => document.fonts.ready);
      async function capture(label) {
        const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        const file = `${label}-${width}.png`;
        await page.screenshot({ path: path.join(output, file), fullPage: true, animations: 'disabled' });
        captures.push({ name: label, file, viewport: { width, height: 900 }, dimensions, errors: [...errors], overflow: dimensions.scrollWidth > width });
      }
      await capture(name);
      if (name === 'type-detail') {
        await page.getByTestId('type-toggle').click();
        await page.getByTestId('confirm-dialog').waitFor();
        if (!(await page.getByTestId('confirm-submit').isDisabled())) throw new Error('Typed confirmation must start disabled');
        await capture('disable-confirmation');
      }
      await context.close();
    }
  }
} finally { await browser.close(); }
const summary = { captures: captures.length, blocking: captures.filter(c => c.overflow || c.errors.length).length, scope: 'Visual smoke only; Appendix A 25 functional/a11y E2E remain W5', results: captures };
await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ captures: summary.captures, blocking: summary.blocking }));
if (summary.blocking) process.exitCode = 2;

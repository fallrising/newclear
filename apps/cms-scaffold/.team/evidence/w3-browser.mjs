import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Run against the Front mock dev server after the behavioral E2E gate releases its ports.
const out = new URL('./w3-browser/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const records = [];
const scenes = [
  ['selector', '/', null],
  ['album', '/album/albums/coast-light-2026', null],
  ['photo', '/album/photos/coast-sun', null],
  ['clinic', '/clinic', null],
  ['project', '/projects/cms-scaffold', null],
  ['lightbox', '/album/albums/coast-light-2026?photo=coast-sun', 'lightbox'],
];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    for (const [name, path, dialog] of scenes) {
      const page = await context.newPage();
      const errors = [], requests = [];
      page.on('pageerror', e => errors.push({ kind: 'exception', message: e.message }));
      page.on('console', m => { if (m.type() === 'error') errors.push({ kind: 'console', message: m.text() }); });
      page.on('requestfailed', r => errors.push({ kind: 'requestfailed', url: r.url(), error: r.failure() }));
      page.on('response', r => { if (r.status() >= 400) errors.push({ kind: 'http', url: r.url(), status: r.status() }); });
      page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) requests.push(r.url()); });
      await page.goto(`http://localhost:5173${path}`);
      await page.locator('h1').first().waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-testid="query-loading"]'));
      if (dialog) await page.getByTestId(dialog).waitFor();
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); });
      const metrics = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, title: document.title, brokenImages: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src), headingCount: document.querySelectorAll('h1').length }));
      const filename = `${name}-${width}.png`;
      await page.screenshot({ path: new URL(filename, out).pathname, fullPage: !dialog, animations: 'disabled' });
      records.push({ name, path, width, filename, metrics, errors, requests });
      if (width === 390 && name === 'clinic') {
        await page.getByTestId('site-nav-open').click();
        await page.getByTestId('site-nav-sheet').waitFor();
        await page.screenshot({ path: new URL('menu-390.png', out).pathname, fullPage: false, animations: 'disabled' });
      }
      await page.close();
    }
    await context.close();
  }
} finally { await browser.close(); }
const failures = records.filter(r => r.errors.length || r.metrics.documentWidth > r.width || r.metrics.brokenImages.length || r.metrics.headingCount !== 1 || r.requests.some(u => !new URL(u).pathname.startsWith('/api/v1/public/')));
await writeFile(new URL('summary.json', out), JSON.stringify({ captures: records.length + 1, failures: failures.length, records }, null, 2) + '\n');
console.log(JSON.stringify({ captures: records.length + 1, failures: failures.length }));
if (failures.length) process.exitCode = 1;

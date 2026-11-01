// Explicit browser check of an existing offline snapshot; never starts a provider.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

assert([3, 4].includes(process.argv.length), 'Usage: node scripts/check_office_results_browser.mjs snapshot.html [screenshot.png]');
const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = path.resolve(process.argv[2]);
const html = readFileSync(snapshot, 'utf8');
const data = JSON.parse(html.match(/<script id="data" type="application\/json">(.*?)<\/script>/s)[1]);
const require = createRequire(path.join(lab, 'vendor/agent-office/package.json'));
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const external = [], errors = [];
  const url = pathToFileURL(snapshot).href;
  await context.route('**/*', route => {
    if (route.request().url() === url) return route.continue();
    external.push('unexpected_request');return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.name));
  await page.goto(url);
  assert.equal(await page.locator('#runs tr').count(), data.runs.length);
  for (const provider of data.providers) {
    await page.selectOption('#provider', provider);
    await page.selectOption('#status', 'completed');
    const matching = data.runs.filter(r => r.provider === provider && r.status === 'completed');
    assert(matching.length > 0, `Snapshot must include a completed ${provider} run`);
    assert.equal(await page.locator('#runs tr').count(), matching.length);
    await page.locator('#runs button').first().click();
    assert(await page.locator('#detail').isVisible());
    assert((await page.locator('#detail').innerText()).includes(matching[0].artifact.sha256));
    assert.deepEqual(JSON.parse(await page.locator('#detail pre').innerText()), matching[0].artifact.content);
    await page.getByRole('button', {name:'關閉詳細結果'}).click();
    assert(await page.locator('#detail').isHidden());
  }
  await page.selectOption('#provider', 'all');
  for (const status of ['failed', 'cancelled']) {
    await page.selectOption('#status', status);
    const matching = data.runs.filter(r => r.status === status);
    assert.equal(await page.locator('#runs tr').count(), matching.length);
    if (status === 'cancelled' && matching.length) {
      await page.locator('#runs button').first().click();
      assert((await page.locator('#detail').innerText()).includes('已取消'));
    }
  }
  await page.selectOption('#provider', 'pi');
  await page.selectOption('#status', 'failed');
  for (const run of data.runs.filter(r => r.test_scenario && r.status === 'failed')) {
    await page.locator('#runs tr').filter({hasText:run.id}).getByRole('button').click();
    const detail = await page.locator('#detail').innerText();
    assert(detail.includes(run.test_scenario === 'injected_cli_crash' ? '本機注入 CLI crash' : `本機注入 HTTP ${run.test_scenario.slice(-3)}`));
    assert(detail.includes(run.failure_check_passed ? '故障測試通過；任務仍為失敗。' : '故障測試未通過。'));
  }
  await page.selectOption('#status', 'startup_only');
  const startup = data.runs.filter(r => r.provider === 'pi' && r.status === 'startup_only');
  assert.equal(await page.locator('#runs tr').count(), startup.length);
  if (startup.length) {
    await page.locator('#runs button').first().click();
    assert((await page.locator('#detail').innerText()).includes('僅啟動檢查'));
  }
  await page.reload();
  assert.equal(await page.locator('#runs tr').count(), data.runs.length);
  assert.deepEqual(errors, []);assert.deepEqual(external, []);
  if (process.argv[3]) await page.screenshot({path:process.argv[3]});
  console.log(JSON.stringify({status:'passed', providers_checked:data.providers, runs:data.runs.length,
    detail_content_and_hash:true, filters:true, refresh:true, external_requests:external.length, browser_errors:errors.length}));
} finally { await browser.close(); }

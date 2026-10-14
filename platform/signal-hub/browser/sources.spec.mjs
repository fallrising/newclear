import { test, expect } from '@playwright/test';
import { startSourcesFixture } from './sources-fixture.mjs';

test('M6 synthetic source examples appear once with original detail and mobile freshness', async ({ page }, testInfo) => {
  const hub = await startSourcesFixture();
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) failures.push('HTTP ' + response.status() + ' ' + response.url()); });
  page.on('requestfailed', request => failures.push('requestfailed ' + request.url() + ' ' + request.failure()?.errorText));
  try {
    await page.goto(hub.base + '/?range=all');
    await page.getByLabel('存取 token', { exact: true }).fill(hub.tokens.reader);
    await page.getByRole('button', { name: '驗證並連線' }).click();
    await expect(page.locator('.events-table tbody tr')).toHaveCount(3);
    for (const event of hub.events) await expect(page.locator('.events-table')).toContainText(event.source);
    await expect(page.locator('.events-table')).toContainText('urn:signalhub:alertmanager:' + hub.alert.receiver);
    await page.screenshot({ path: testInfo.outputPath('m6-three-sources-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: '查看事件 #' + hub.seqs[0], exact: true }).click();
    const detail = page.getByRole('dialog', { name: '事件詳情' });
    expect(JSON.parse(await detail.locator('.json-block').innerText())).toEqual(hub.events[0]);
    await page.getByRole('button', { name: '關閉事件詳情' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('navigation').getByRole('button', { name: '來源新鮮度' }).click();
    await expect(page.locator('.source-card')).toHaveCount(3);
    for (const name of ['release', 'inspection', 'alertmanager']) {
      const card = page.locator('.source-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
      await expect(card.locator('.source-status')).toHaveText('新鮮');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('m6-three-sources-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
    await page.getByRole('button', { name: '清除 token' }).click();
    await expect(page.locator('.source-card')).toHaveCount(0);
    expect(failures).toEqual([]);
  } finally {
    await hub.stop();
  }
});

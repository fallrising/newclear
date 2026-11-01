import { test, expect } from '@playwright/test';
import { startArchiveFixture } from './archive-fixture.mjs';

test('real archive import preserves provenance and related history on desktop and mobile', async ({ page }, testInfo) => {
  const hub = await startArchiveFixture();
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text() + ' ' + message.location().url); });
  page.on('response', response => { if (response.status() >= 400) failures.push('HTTP ' + response.status() + ' ' + response.url()); });
  page.on('requestfailed', request => failures.push('requestfailed ' + request.url() + ' ' + request.failure()?.errorText));
  try {
    await page.goto(hub.base + '/?range=all&source=' + encodeURIComponent(hub.history[0].source));
    await page.getByLabel('存取 token', { exact: true }).fill(hub.tokens.reader);
    await page.getByRole('button', { name: '驗證並連線' }).click();
    const rows = page.locator('.events-table tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(page.locator('.events-table .restored-badge')).toHaveCount(2);
    const ordinary = rows.filter({ hasText: '目前熱資料 · 未曾封存' });
    await expect(ordinary.locator('.restored-badge')).toHaveCount(0);
    await page.getByRole('button', { name: '查看事件 #' + hub.sequences[0], exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '事件詳情' });
    await expect(dialog.locator('.restored-notice')).toHaveText('已從封存匯回：原始事件內容、序號與接收時間保持不變。');
    await expect(dialog.locator('.detail-meta')).toContainText(hub.original.item.received_at);
    await expect(dialog.locator('.json-block')).toContainText('"id": "archived-first"');
    expect(JSON.parse(await dialog.locator('.json-block').textContent())).toEqual(hub.history[0]);
    await expect(dialog.locator('.related-list .restored-badge')).toHaveCount(1);
    await expect(dialog.locator('.related-list')).toContainText('封存匯回 · 關聯檢查紀錄');
    await expect(dialog.locator('.related-list')).toContainText('目前熱資料 · 未曾封存');
    await expect(dialog.locator('.json-block script')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('desktop-restored-detail.png'), fullPage: false });
    await dialog.locator('.related-list li').filter({ hasText: '封存匯回 · 關聯檢查紀錄' }).getByRole('button').click();
    await expect(dialog.locator('.json-block')).toContainText('"id": "archived-related"');
    await expect(dialog.locator('.restored-notice')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog.locator('.restored-notice')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('mobile-restored-detail.png'), fullPage: false });
    await page.getByRole('button', { name: '關閉事件詳情' }).click();
    await page.getByRole('button', { name: '查看事件 #' + hub.ordinarySeq, exact: true }).click();
    await expect(dialog.locator('.json-block')).toContainText('"id": "ordinary-current"');
    await expect(dialog.locator('.restored-notice')).toHaveCount(0);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie }))).toEqual({ local: [], session: [], cookie: '' });
    expect(page.url()).not.toContain(hub.tokens.reader);
    await page.getByRole('button', { name: '關閉事件詳情' }).click();
    await page.getByRole('button', { name: '清除 token' }).click();
    await expect(page.locator('.restored-badge')).toHaveCount(0);
    expect(failures).toEqual([]);
  } finally { await hub.stop(); }
});

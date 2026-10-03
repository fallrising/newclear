import { test as base, expect } from '@playwright/test';
import { startFixture } from './fixture.mjs';

const test = base.extend({
  hub: async ({}, use) => {
    const fixture = await startFixture();
    try { await use(fixture); } finally { await fixture.stop(); }
  },
});

async function connect(page, hub, role = 'reader') {
  await page.getByLabel('存取 token', { exact: true }).fill(hub.tokens[role]);
  await page.getByRole('button', { name: '驗證並連線' }).click();
  await expect(page.getByRole('button', { name: '清除 token' })).toBeVisible();
}
const rows = page => page.locator('.events-table tbody tr');
const sourceCard = (page, name) => page.locator('.source-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
const query = url => Object.fromEntries(new URL(url).searchParams);

test('invalid and producer credentials cannot enter the read-only board', async ({ page, hub }) => {
  await page.goto(hub.base + '/?range=all');
  await page.getByLabel('存取 token', { exact: true }).fill('invalid-browser-token');
  const invalid = page.waitForResponse(response => response.url().includes('/v1/events?limit=1'));
  await page.getByRole('button', { name: '驗證並連線' }).click();
  expect((await invalid).status()).toBe(401);
  await expect(page.getByRole('alert')).toContainText('401');
  await expect(page.getByLabel('存取 token', { exact: true })).toHaveValue('');
  await page.getByLabel('存取 token', { exact: true }).fill(hub.tokens.source);
  const forbidden = page.waitForResponse(response => response.url().includes('/v1/events?limit=1'));
  await page.getByRole('button', { name: '驗證並連線' }).click();
  expect((await forbidden).status()).toBe(403);
  await expect(page.getByRole('alert')).toContainText('403');
  await expect(page.getByRole('button', { name: '清除 token' })).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
});

test('reader paginates all 105 events, preserves query history, and reauthenticates after reload', async ({ page, hub }, testInfo) => {
  await page.goto(hub.base + '/?range=all');
  await connect(page, hub);
  await expect(rows(page)).toHaveCount(100);
  await expect(rows(page).first()).toContainText('Browser fixture 000');
  await expect(rows(page).last()).toContainText('Browser fixture 099');
  await page.screenshot({ path: testInfo.outputPath('desktop-timeline.png'), fullPage: false });
  await page.getByRole('button', { name: '載入更多事件' }).click();
  await expect(rows(page)).toHaveCount(105);
  await expect(rows(page).last()).toContainText('Browser fixture 104');
  await expect(page.getByRole('button', { name: '載入更多事件' })).toHaveCount(0);
  const summaries = await rows(page).locator('.event-cell p').allTextContents();
  expect(new Set(summaries).size).toBe(105);

  await page.getByLabel('關鍵字搜尋', { exact: true }).fill('Browser fixture 104');
  await page.getByRole('button', { name: '套用篩選' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Browser fixture 104');
  expect(new URL(page.url()).searchParams.get('q')).toBe('Browser fixture 104');
  const filteredURL = page.url();
  await page.getByRole('button', { name: '清除篩選' }).click();
  await expect(rows(page)).toHaveCount(100);
  await page.goBack();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByLabel('關鍵字搜尋', { exact: true })).toHaveValue('Browser fixture 104');
  expect(query(page.url())).toEqual(query(filteredURL));
  await page.goForward();
  await expect(rows(page)).toHaveCount(100);
  await page.goBack();
  await expect(rows(page)).toHaveCount(1);

  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie })))
    .toEqual({ local: 0, session: 0, cookie: '' });
  expect(page.url()).not.toContain(hub.tokens.reader);
  await page.reload();
  await expect(page.getByLabel('存取 token', { exact: true })).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  expect(query(page.url())).toEqual(query(filteredURL));
  await connect(page, hub);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Browser fixture 104');
});

test('detail keeps raw JSON inert, rejects unsafe origins, and navigates related events', async ({ page, hub }) => {
  const dialogs = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.goto(hub.base + '/?range=all');
  await connect(page, hub);
  await rows(page).first().getByRole('button', { name: '查看事件 #1', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '事件詳情' });
  await expect(detail.locator('.detail-summary')).toHaveText('Browser fixture 000');
  expect(new URL(page.url()).searchParams.get('event')).toBe('1');
  await expect(detail.locator('.json-block')).toContainText('<img src=x onerror=alert(1)>');
  await expect(detail.locator('.json-block img')).toHaveCount(0);
  await expect(detail.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(detail.getByRole('link', { name: '開啟原系統' })).toHaveCount(0);
  await expect(detail).toContainText('原系統連結已停用');
  const raw = JSON.parse(await detail.locator('.json-block').innerText());
  expect(raw.id).toBe('browser-0');
  expect(raw.data.content).toBe('<img src=x onerror=alert(1)>');
  await expect(detail.locator('.related-list li')).toHaveCount(2);
  await expect(detail.locator('.related-list li > div > p')).toHaveText(['Browser fixture 002', 'Browser fixture 001']);
  await detail.locator('.related-list li').filter({ hasText: 'Browser fixture 001' }).getByRole('button').click();
  await expect(detail.locator('.detail-summary')).toHaveText('Browser fixture 001');
  expect(new URL(page.url()).searchParams.get('event')).toBe('2');
  await expect(detail.getByRole('link', { name: '開啟原系統' })).toHaveAttribute('href', 'https://example.invalid/run/1');
  await expect(detail.getByRole('link', { name: '開啟原系統' })).toHaveAttribute('rel', 'noopener noreferrer');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('event')).toBe(false);
  expect(dialogs).toEqual([]);
});

test('source UI reflects the real API through never, unchecked, fresh, silent, and recovery', async ({ page, hub }) => {
  await page.goto(hub.base + '/?range=all');
  await connect(page, hub);
  await page.getByRole('navigation').getByRole('button', { name: '來源新鮮度' }).click();
  await expect(sourceCard(page, 'never')).toContainText('尚未收到事件');
  await expect(sourceCard(page, 'never')).toContainText('無法判定來源健康');
  await expect(sourceCard(page, 'demo')).toContainText('未啟用新鮮度檢查');
  const initial = await hub.api('/v1/sources');
  expect(initial.items.find(source => source.name === 'never').status).toBe('never');
  expect(initial.items.find(source => source.name === 'demo').expected_interval).toBeNull();

  async function refreshAndAssert(status, label) {
    const responsePromise = page.waitForResponse(response => response.url().includes('/v1/sources?limit=100'));
    await page.getByRole('button', { name: '重新查詢' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const source = (await response.json()).items.find(item => item.name === 'watch');
    expect(source.status).toBe(status);
    await expect(sourceCard(page, 'watch').locator('.source-status')).toHaveText(label);
    return source;
  }
  await hub.touchWatch();
  const fresh = await refreshAndAssert('fresh', '新鮮');
  await expect.poll(async () => (await hub.api('/v1/sources')).items.find(source => source.name === 'watch').status,
    { timeout: 10_000, intervals: [500] }).toBe('silent');
  expect(Date.now() - Date.parse(fresh.last_received_at)).toBeGreaterThan(4000);
  await refreshAndAssert('silent', '沉默');
  await hub.touchWatch();
  const recovered = await refreshAndAssert('fresh', '新鮮');
  expect(Date.parse(recovered.last_received_at)).toBeGreaterThan(Date.parse(fresh.last_received_at));
  await page.getByRole('button', { name: '清除 token' }).click();
  await expect(page.getByLabel('存取 token', { exact: true })).toBeVisible();
  await expect(page.locator('.source-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '清除 token' })).toHaveCount(0);
});

test('mobile timeline, sources, and detail remain usable without page overflow', async ({ page, hub }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(hub.base + '/?range=all');
  await connect(page, hub);
  await expect(rows(page)).toHaveCount(100);
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await page.screenshot({ path: testInfo.outputPath('mobile-timeline.png'), fullPage: false });
  const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > innerWidth)
      .map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })).slice(0, 12) }));
  expect(await noOverflow(), JSON.stringify(overflow)).toBe(true);
  await rows(page).first().getByRole('button', { name: '查看事件 #1', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.json-block')).toBeVisible();
  expect(await noOverflow()).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-detail.png'), fullPage: false });
  await page.getByRole('button', { name: '關閉事件詳情' }).click();
  await page.getByRole('navigation').getByRole('button', { name: '來源新鮮度' }).click();
  await expect(page.locator('.source-card')).toHaveCount(3);
  expect(await noOverflow()).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-sources.png'), fullPage: true });
});

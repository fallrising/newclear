import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { become, denied, snapshot } from './w3-ui-helpers'

async function alertAction(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog', { name, exact: true })
  await dialog.getByRole('textbox', { name: '決策／操作理由' }).fill(`W5 recipient scope checked before ${name}`)
  await dialog.getByRole('button', { name: '確認操作' }).click()
  await expect(dialog).toHaveCount(0)
}

test('W5 safe notification metadata, recipient subscription and current scope', async ({ page }, info) => {
  test.setTimeout(120_000)
  const health = captureBrowserHealth(page)
  try {
    await page.goto('rd')
    await become(page, 'user-admin')
    await page.goto('admin/notifications')
    await expect(page.getByRole('heading', { name: '安全通知設定' })).toBeVisible()
    const channel = page.getByRole('article', { name: 'RD Demo inbox' })
    await channel.getByRole('combobox', { name: 'Mock 測試結果' }).selectOption('true')
    await channel.getByRole('button', { name: '建立安全測試投遞' }).click()
    await expect(page.getByRole('heading', { name: '安全測試投遞' }).locator('..')).toContainText('MOCK_DELIVERY_FAILURE')
    const tests = (await snapshot(page)).entities.notificationAttempts
    expect(tests).toHaveLength(1)
    expect(tests[0]).toMatchObject({ sourceKind: 'synthetic-test', status: 'failed', recipientId: 'user-admin' })
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme)
        await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題' }).click()
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 950 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width} overflow`).toBe(true)
        expect((await new AxeBuilder({ page }).analyze()).violations.filter(row => ['serious', 'critical'].includes(row.impact ?? '')), `${theme} ${width} axe`).toEqual([])
      }
    }
    await become(page, 'user-rd-commerce')
    await page.goto('rd/apps/app-checkout/alerts?environmentId=env-checkout-dev')
    await expect(page.getByRole('heading', { name: '服務通知訂閱與逐收件者投遞' })).toBeVisible()
    await page.getByRole('button', { name: '訂閱此環境' }).click()
    await expect(page.locator('.alert-records li').first()).toContainText('已訂閱')
    expect((await snapshot(page)).entities.notificationSubscriptions).toMatchObject([
      { recipientId: 'user-rd-commerce', environmentId: 'env-checkout-dev', channelId: 'demo-rd', enabled: true },
    ])
    await page.reload()
    await expect(page.locator('.alert-records li').first()).toContainText('已訂閱')
    await page.getByRole('button', { name: '停止訂閱' }).click()
    await expect(page.locator('.alert-records li').first()).toContainText('已停用')
    await page.goto('admin/notifications')
    await expect(page.getByRole('heading', { name: '目前身分無法進入平台管理' })).toBeVisible()
  } finally { health.expectedStatuses.add(403); await verifyBrowserHealth(page, info, health) }
})

test('W5 RD failed Mock delivery retries as a new attempt and disappears after unsubscribe', async ({ page }, info) => {
  test.setTimeout(180_000)
  const health = captureBrowserHealth(page)
  try {
    await page.goto('rd')
    await become(page, 'user-rd-commerce')
    await page.goto('rd/apps/app-checkout/alerts?environmentId=env-checkout-dev')
    await page.getByRole('button', { name: '訂閱此環境' }).click()
    await expect(page.locator('.alert-records li').first()).toContainText('已訂閱')
    await page.goto('rd/apps/app-checkout/monitoring?environmentId=env-checkout-dev')
    await page.getByRole('button', { name: '新增監控設定' }).click()
    await page.getByRole('textbox', { name: '變更理由', exact: true }).fill('W5 notification service monitor')
    await page.getByRole('button', { name: '儲存監控草稿' }).click()
    for (const name of ['驗證草稿', '提交規則', '啟用規則']) await alertAction(page, name)
    await page.goto('rd/apps/app-checkout/alerts?environmentId=env-checkout-dev')
    await page.getByRole('button', { name: '新增告警規則' }).click()
    await page.getByRole('heading', { name: '新增告警規則' }).locator('..')
      .getByRole('textbox', { name: '變更理由', exact: true }).fill('W5 notification service alert')
    await page.getByRole('button', { name: '儲存告警草稿' }).click()
    for (const name of ['驗證草稿', '提交規則', '啟用規則']) await alertAction(page, name)
    await page.getByRole('button', { name: '模擬下次投遞失敗' }).click()
    await expect.poll(async () => (await snapshot(page)).scenarioFlags.alertDeliveryFailureDeliveryId).toBeTruthy()
    await page.getByRole('button', { name: '下一筆樣本 · 前進 60 秒' }).click()
    await expect.poll(async () => (await snapshot(page)).entities.notificationDeliveries.at(-1)?.status).toBe('failed')
    await page.reload()
    const section = page.getByRole('heading', { name: '服務通知訂閱與逐收件者投遞' }).locator('..')
    await expect(section).toContainText('MOCK_DELIVERY_FAILURE')
    const failed = (await snapshot(page)).entities.notificationAttempts.find(row => row.status === 'failed')!
    expect(failed).toMatchObject({ recipientId: 'user-rd-commerce', sourceKind: 'w4-delivery', attempt: 1 })
    await section.getByRole('button', { name: '重新投遞到目前授權範圍' }).click()
    await expect(section).toContainText('第 2 次')
    expect((await snapshot(page)).entities.notificationAttempts).toMatchObject([
      { id: failed.id, status: 'failed', attempt: 1 }, { status: 'delivered', attempt: 2 },
    ])
    await section.getByRole('button', { name: '停止訂閱' }).click()
    await expect(section).not.toContainText(failed.id)
    health.expectedStatuses.add(404)
    expect((await denied(page, `/notification-attempts/${failed.id}`, undefined, 'GET')).status).toBe(404)
  } finally { await verifyBrowserHealth(page, info, health) }
})

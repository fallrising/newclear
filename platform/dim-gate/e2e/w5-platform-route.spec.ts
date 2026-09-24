import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { become } from './w3-ui-helpers'

test('W5 registered Mock route shows deterministic failure, fallback and recovery', async ({ page }, info) => {
  test.setTimeout(120_000)
  const health = captureBrowserHealth(page)
  try {
    await page.goto('rd')
    await become(page, 'user-admin')
    await page.goto('admin/routes')
    await expect(page.getByRole('heading', { name: '註冊路由與診斷' })).toBeVisible()
    await page.getByRole('combobox', { name: '固定路由' }).selectOption('observation.apm')
    await page.getByRole('combobox', { name: 'Mock adapter' }).first().selectOption('demo-apm-failure')
    await page.getByRole('button', { name: '建立草稿' }).click()
    const card = page.getByRole('article', { name: 'APM 觀測' })
    await expect(card).toContainText('draft r1')
    await card.getByRole('button', { name: '驗證草稿' }).click()
    await card.getByRole('button', { name: '執行本機 Mock 診斷' }).click()
    await expect(card).toContainText('degraded · MOCK_FAILURE_FALLBACK')
    await card.getByRole('button', { name: '啟用路由' }).click()
    await expect(card).toContainText('MOCK_FAILURE_FALLBACK')
    await expect(card).toContainText('fallback · MOCK_FAILURE_FALLBACK')
    const map = page.getByRole('region', { name: '唯讀能力地圖' })
    await expect(map.getByRole('row', { name: /observation-apm/ })).toContainText('MOCK_FAILURE_FALLBACK')
    await expect(map).toContainText('BFF governance')
    await expect(map).toContainText('later')
    await page.reload()
    await expect(page.getByRole('article', { name: 'APM 觀測' })).toContainText('fallback · MOCK_FAILURE_FALLBACK')
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題' }).click()
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 950 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width} overflow`).toBe(true)
        expect((await new AxeBuilder({ page }).analyze()).violations.filter(item => ['serious', 'critical'].includes(item.impact ?? '')), `${theme} ${width} axe`).toEqual([])
      }
    }
    await page.getByRole('article', { name: 'APM 觀測' }).getByRole('button', { name: '停用路由' }).click()
    await expect(page.getByRole('article', { name: 'APM 觀測' })).toContainText('ROUTE_DISABLED_FALLBACK')
    await become(page, 'user-rd-commerce')
    await page.goto('admin/routes')
    await expect(page.getByRole('heading', { name: '目前身分無法進入平台管理' })).toBeVisible()
  } finally { health.expectedStatuses.add(403); await verifyBrowserHealth(page, info, health) }
})

import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { become } from './w3-ui-helpers'

test('W5 feature governance gates current navigation and direct route across refresh', async ({ page }, info) => {
  test.setTimeout(120_000)
  const health = captureBrowserHealth(page)
  try {
    await page.goto('rd')
    await become(page, 'user-admin')
    await page.goto('admin/features')
    await expect(page.getByRole('heading', { name: '功能灰度' })).toBeVisible()
    await page.getByRole('spinbutton', { name: '灰度百分比' }).first().fill('0')
    await page.getByRole('button', { name: '建立草稿' }).click()
    const card = page.getByRole('article', { name: 'RD 服務監控' })
    await expect(card.getByText('draft r1', { exact: false })).toBeVisible()
    await card.getByRole('button', { name: '驗證草稿' }).click()
    await card.getByRole('button', { name: '啟用灰度' }).click()
    await expect(card).toContainText('active · draft r1 · active r1')
    await expect(card.getByRole('row', { name: /user-rd-commerce/ })).toContainText('不可使用')
    await page.reload()
    await expect(page.getByRole('article', { name: 'RD 服務監控' })).toContainText('active r1')
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題' }).click()
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 950 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width} overflow`).toBe(true)
        expect((await new AxeBuilder({ page }).analyze()).violations.filter(item => ['serious', 'critical'].includes(item.impact ?? '')), `${theme} ${width} axe`).toEqual([])
      }
    }
    await become(page, 'user-rd-commerce')
    await page.goto('rd/apps/app-checkout/monitoring')
    await expect(page.getByRole('heading', { name: '目前身分無法進入研發中心' })).toBeVisible()
    await become(page, 'user-admin')
    await page.goto('admin/features')
    const activeCard = page.getByRole('article', { name: 'RD 服務監控' })
    await activeCard.getByRole('spinbutton', { name: '灰度百分比' }).fill('100')
    await activeCard.getByRole('button', { name: '建立新版草稿' }).click()
    await expect(activeCard).toContainText('active r1')
    await activeCard.getByRole('button', { name: '驗證草稿' }).click()
    await activeCard.getByRole('button', { name: '啟用灰度' }).click()
    await expect(activeCard).toContainText('active · draft r2 · active r2')
    await expect(activeCard.getByRole('row', { name: /user-rd-commerce/ })).toContainText('可使用')
    await become(page, 'user-rd-commerce')
    await page.goto('rd/apps/app-checkout/monitoring')
    await expect(page.getByRole('heading', { name: /checkout-api · 監控設定/ })).toBeVisible()
  } finally { health.expectedStatuses.add(403); await verifyBrowserHealth(page, info, health) }
})

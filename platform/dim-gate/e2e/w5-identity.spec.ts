import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { become, snapshot } from './w3-ui-helpers'

test('W5 Demo identity is usable, scoped and refresh-safe without creating a login', async ({ page }, info) => {
  test.setTimeout(120_000)
  const health = captureBrowserHealth(page)
  try {
    await page.goto('rd')
    await become(page, 'user-admin')
    await page.goto('admin/access')
    await page.getByRole('link', { name: '管理 Demo 使用者與團隊' }).click()
    await expect(page.getByRole('heading', { name: '使用者與團隊' })).toBeVisible()
    await page.getByRole('textbox', { name: '團隊名稱', exact: true }).fill('Browser Demo Team')
    await page.getByRole('button', { name: '建立團隊' }).click()
    await expect(page.getByRole('row', { name: /Browser Demo Team/ })).toBeVisible()
    const team = (await snapshot(page)).entities.teams.find(row => row.name === 'Browser Demo Team')!
    expect(team.source).toBe('demo')
    await page.getByRole('textbox', { name: '顯示名稱', exact: true }).fill('Browser Demo User')
    await page.getByLabel('新使用者所屬團隊').selectOption([team.id])
    await page.getByRole('button', { name: '建立使用者' }).click()
    await expect(page.getByRole('row', { name: /Browser Demo User/ })).toBeVisible()
    const user = (await snapshot(page)).entities.users.find(row => row.displayName === 'Browser Demo User')!
    expect(user).toMatchObject({ source: 'demo', teamIds: [team.id] })
    expect((await snapshot(page)).entities.assignments.some(row => row.userId === user.id)).toBe(false)
    await page.reload()
    await expect(page.getByRole('row', { name: new RegExp(user.id) }).getByLabel(`${user.id} 顯示名稱`)).toHaveValue('Browser Demo User')
    expect(await page.getByRole('combobox', { name: '示範身分' }).locator(`option[value="${user.id}"]`).count()).toBe(0)
    const row = page.getByRole('row', { name: new RegExp(user.id) })
    await row.getByLabel(`${user.id} 顯示名稱`).fill('Browser Demo User v2')
    await row.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByRole('row', { name: new RegExp(user.id) }).getByLabel(`${user.id} 顯示名稱`)).toHaveValue('Browser Demo User v2')
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題' }).click()
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 950 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width} document overflow`).toBe(true)
        expect((await new AxeBuilder({ page }).analyze()).violations.filter(item => ['serious', 'critical'].includes(item.impact ?? '')), `${theme} ${width} axe`).toEqual([])
      }
    }
    await become(page, 'user-rd-commerce')
    await page.goto('admin/users')
    await expect(page.getByRole('heading', { name: '目前身分無法進入平台管理' })).toBeVisible()
  } finally { health.expectedStatuses.add(403); await verifyBrowserHealth(page, info, health) }
})

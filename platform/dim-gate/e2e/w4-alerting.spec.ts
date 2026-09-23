import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { captureBrowserHealth, verifyBrowserHealth, type BrowserHealth } from './browser-health'
import { become, denied, snapshot } from './w3-ui-helpers'

const health = new WeakMap<Page, BrowserHealth>()
test.beforeEach(({ page }) => { health.set(page, captureBrowserHealth(page)); test.setTimeout(180_000) })
test.afterEach(async ({ page }, info) => { await verifyBrowserHealth(page, info, health.get(page)!) })

async function action(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog', { name, exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: '決策／操作理由' }).fill(`W4 visible ${name} with current scope and revision reviewed`)
  await dialog.getByRole('button', { name: '確認操作' }).click()
  await expect(dialog).toHaveCount(0)
}

async function createMonitor(page: Page, environmentId: string) {
  await page.goto(`rd/apps/app-checkout/monitoring?environmentId=${environmentId}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('監控設定')
  await page.getByRole('button', { name: '新增監控設定', exact: true }).click()
  await page.getByRole('textbox', { name: '變更理由', exact: true }).fill('W4 service monitor from registered RED source')
  await page.getByRole('button', { name: '儲存監控草稿', exact: true }).click()
  await expect(page.getByRole('button', { name: '驗證草稿', exact: true })).toBeVisible()
  const id = new URL(page.url()).searchParams.get('monitorId')!
  expect(id).toMatch(/^w4-monitorPolicy-/)
  await action(page, '驗證草稿'); await action(page, '提交規則')
  return id
}

async function createRule(page: Page, environmentId: string) {
  await page.goto(`rd/apps/app-checkout/alerts?environmentId=${environmentId}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('告警規則')
  await page.getByRole('button', { name: '新增告警規則', exact: true }).click()
  await page.getByRole('textbox', { name: '變更理由', exact: true }).fill('W4 source-time breach with fixed channel and safe threshold')
  await page.getByRole('button', { name: '儲存告警草稿', exact: true }).click()
  await expect(page.getByRole('button', { name: '驗證草稿', exact: true })).toBeVisible()
  const id = new URL(page.url()).searchParams.get('ruleId')!
  expect(id).toMatch(/^w4-alertRule-/)
  await action(page, '驗證草稿'); await action(page, '提交規則')
  return id
}

async function approve(page: Page, id: string) {
  await become(page, 'user-ops')
  await page.goto('ops/alerting')
  const item = page.locator('article').filter({ has: page.locator('code', { hasText: id }) })
  await expect(item).toBeVisible()
  await item.getByRole('button', { name: '核准規則', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '核准規則', exact: true })
  await dialog.getByRole('textbox', { name: '決策／操作理由' }).fill('Independent Ops approval of production service monitoring')
  await dialog.getByRole('button', { name: '確認操作' }).click()
  await expect(dialog).toHaveCount(0)
}

test('W4 production RD monitor and rule require independent Ops decision; Silence keeps incident/evidence and Mock delivery history', async ({ page }, info) => {
  const monitorId = await createMonitor(page, 'env-checkout-prod')
  health.get(page)!.expectedStatuses.add(403)
  const selfApprove = await denied(page, `/monitor-policies/${monitorId}/approve`, { expectedVersion: (await snapshot(page)).entities.monitorPolicies.find(item => item.id === monitorId)!.version, reason: 'Cannot self approve' })
  expect(selfApprove.status).toBe(403)
  await approve(page, monitorId)
  await become(page, 'user-rd-commerce')
  await page.goto(`rd/apps/app-checkout/monitoring?environmentId=env-checkout-prod&monitorId=${monitorId}`)
  await action(page, '啟用規則')
  await page.reload()
  await expect(page.getByText('生效 rev 1')).toBeVisible()

  const ruleId = await createRule(page, 'env-checkout-prod')
  await approve(page, ruleId)
  await become(page, 'user-rd-commerce')
  await page.goto(`rd/apps/app-checkout/alerts?environmentId=env-checkout-prod&ruleId=${ruleId}`)
  await action(page, '啟用規則')
  await expect(page.getByText('健康狀態 unknown', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '模擬超過門檻', exact: true }).click()
  await expect(page.getByRole('table', { name: '最近規則評估' })).toContainText('超過門檻')
  const first = await snapshot(page)
  const incident = first.entities.incidents.find(item => item.ruleId === ruleId)!
  expect(incident).toMatchObject({ state: 'open', ruleRevision: 1 })
  await expect(page.getByRole('link', { name: `事件 ${incident.id}` })).toBeVisible()
  await page.getByRole('combobox', { name: '抑制分鐘' }).selectOption('5')
  await page.getByRole('textbox', { name: '變更理由', exact: true }).fill('Suppress Mock delivery while preserving incident and evidence')
  await page.getByRole('button', { name: '建立 Silence', exact: true }).click()
  await expect(page.getByText('抑制中', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '模擬超過門檻', exact: true }).click()
  await expect(page.getByRole('table', { name: '可查 Mock 通知投遞' })).toContainText('已抑制')
  await page.getByRole('button', { name: '下一筆樣本 · 前進 60 秒', exact: true }).click()
  const silenced = await snapshot(page)
  expect(silenced.entities.incidents.filter(item => item.ruleId === ruleId)).toHaveLength(1)
  expect(silenced.entities.incidents.find(item => item.id === incident.id)?.evidence.length).toBeGreaterThan(incident.evidence.length)
  expect(silenced.entities.notificationDeliveries.some(item => item.ruleId === ruleId && item.status === 'suppressed')).toBe(true)
  await page.reload()
  await expect(page.getByRole('table', { name: '可查 Mock 通知投遞' })).toContainText('已抑制')
  for (let index = 0; index < 3; index += 1) await page.getByRole('button', { name: '下一筆樣本 · 前進 60 秒', exact: true }).click()
  await expect(page.getByText('已到期', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '模擬下次投遞失敗', exact: true }).click()
  await page.getByRole('button', { name: '下一筆樣本 · 前進 60 秒', exact: true }).click()
  await expect(page.getByRole('table', { name: '可查 Mock 通知投遞' })).toContainText('DEMO_DELIVERY_FAILURE')
  const after = await snapshot(page)
  expect(after.entities.incidents.filter(item => item.ruleId === ruleId)).toHaveLength(1)
  await page.getByRole('link', { name: `事件 ${incident.id}` }).first().click()
  await expect(page).toHaveURL(new RegExp(`/ops/incidents/${incident.id}$`))
  await expect(page.getByRole('heading', { name: '已觀測證據' })).toBeVisible()
  await info.attach('w4-prod-alert-lineage', { body: JSON.stringify({ monitorId, ruleId, incidentId: incident.id, deliveries: after.entities.notificationDeliveries.filter(item => item.ruleId === ruleId) }), contentType: 'application/json' })
})

test('W4 wrong environment and Admin cannot edit; alert pages survive keyboard, themes and responsive widths', async ({ page }, info) => {
  await page.goto('rd/apps/app-checkout/alerts?environmentId=env-other-project')
  await expect(page.getByRole('heading', { name: '找不到此監控範圍' })).toBeVisible()
  await become(page, 'user-admin')
  await page.goto('rd/apps/app-checkout/alerts?environmentId=env-checkout-prod')
  await expect(page.getByRole('heading', { name: '目前身分無法進入研發中心' })).toBeVisible()
  await become(page, 'user-rd-commerce')
  await page.goto('rd/apps/app-checkout/alerts?environmentId=env-checkout-dev')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('告警規則')
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus-visible')).toHaveCount(1)
  for (const theme of ['light', 'dark'] as const) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題' }).click()
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(page.getByRole('heading', { level: 1 })).toContainText('告警規則')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      expect(scan.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([])
      await info.attach(`w4-alerts-${theme}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    }
  }
})

import { test, expect } from '@playwright/test'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { become, visitChange, act, ticks, createResource, readSnapshot } from './w2-resource-helpers'

test('W2 extra browser: canonical Redis delivery and refresh across roles', async ({ page }, info) => {
  test.setTimeout(150_000)
  const health = captureBrowserHealth(page)
  try {
    const id = await createResource(page, 'redis')
    await act(page, '提交審核')
    // Dialog dismissal precedes detail/audit readback; persona changes wait for both.
    await expect(page.locator('.command-notice')).toHaveText('已重新讀取同一工作單的決策與執行狀態。')
    await expect(page.locator('.page-heading')).toContainText('待審核')
    await expect(page.getByRole('heading', { name: '同一 correlation 的稽核', exact: true }).locator('..')).toContainText('change.submit')
    await become(page, 'user-ops')
    await visitChange(page, 'ops', id)
    await act(page, '核准並保留配額')
    await expect(page.locator('.page-heading')).toContainText('已核准，待執行')
    await act(page, '啟動資源執行')
    await ticks(page)
    await expect(page.locator('.page-heading')).toContainText('已成功')
    const binding = (await readSnapshot(page)).entities.resourceBindings.find((item: { requestRef: { sourceId: string } }) => item.requestRef.sourceId === id)
    expect(binding).toBeDefined()
    await become(page, 'user-rd-commerce')
    await page.goto('rd/apps/app-checkout/resources?environmentId=env-checkout-dev')
    await expect(page.getByText(binding.id, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText(binding.id, { exact: true })).toBeVisible()
    await page.getByRole('link', { name: id, exact: true }).click()
    await expect(page.locator('.page-heading')).toContainText('已成功')
    await info.attach('canonical-binding.json', { body: JSON.stringify(binding), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

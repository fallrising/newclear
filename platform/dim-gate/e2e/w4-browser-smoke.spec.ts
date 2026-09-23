import { expect, test } from '@playwright/test'
import { become, snapshot } from './w3-ui-helpers'

test('W4 extra browser RD monitoring to Ops incident evidence', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('rd/apps/app-checkout/monitoring?environmentId=env-checkout-dev')
  await page.getByRole('button', { name: '新增監控設定', exact: true }).click()
  await page.getByRole('textbox', { name: '變更理由' }).fill('Cross-browser W4 registered service monitor')
  await page.getByRole('button', { name: '儲存監控草稿' }).click()
  for (const name of ['驗證草稿', '提交規則', '啟用規則']) {
    await page.getByRole('button', { name, exact: true }).click()
    const dialog = page.getByRole('dialog', { name, exact: true })
    await dialog.getByRole('textbox', { name: '決策／操作理由' }).fill(`Cross-browser ${name}`)
    await dialog.getByRole('button', { name: '確認操作' }).click()
    await expect(dialog).toHaveCount(0)
  }
  await page.goto('rd/apps/app-checkout/alerts?environmentId=env-checkout-dev')
  await page.getByRole('button', { name: '新增告警規則' }).click()
  await page.getByRole('textbox', { name: '變更理由' }).fill('Cross-browser W4 rule')
  await page.getByRole('button', { name: '儲存告警草稿' }).click()
  for (const name of ['驗證草稿', '提交規則', '啟用規則']) {
    await page.getByRole('button', { name, exact: true }).click()
    const dialog = page.getByRole('dialog', { name, exact: true })
    await dialog.getByRole('textbox', { name: '決策／操作理由' }).fill(`Cross-browser ${name}`)
    await dialog.getByRole('button', { name: '確認操作' }).click()
    await expect(dialog).toHaveCount(0)
  }
  const ruleId = new URL(page.url()).searchParams.get('ruleId')!
  await page.getByRole('button', { name: '模擬超過門檻' }).click()
  await expect(page.getByRole('table', { name: '最近規則評估' })).toContainText('超過門檻')
  const incident = (await snapshot(page)).entities.incidents.find(item => item.ruleId === ruleId)!
  expect(incident.ruleRevision).toBe(1)
  await page.reload()
  await expect(page.getByRole('link', { name: `事件 ${incident.id}` })).toBeVisible()
  await become(page, 'user-ops')
  await page.goto('ops/alerting?tab=runtime')
  const opsIncidentLink = page.getByRole('link', { name: incident.id, exact: true }).first()
  await expect(opsIncidentLink).toBeVisible()
  await opsIncidentLink.click()
  await expect(page.getByRole('heading', { name: '已觀測證據' })).toBeVisible()
})

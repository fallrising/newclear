import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { act, become, denied, snapshot, source, visit } from './w3-ui-helpers'

test('W5 feature governance gates new commands while preserving grant-scoped readback across refresh', async ({ page }, info) => {
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
    await expect(card.getByRole('row', { name: /user-rd-commerce/ })).toContainText('可使用')
    await card.getByRole('button', { name: '驗證草稿' }).click()
    await expect(card.getByRole('row', { name: /user-rd-commerce/ })).toContainText('可使用')
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
    await expect(page.getByRole('heading', { name: /checkout-api · 監控設定/ })).toBeVisible()
    await expect(page.getByRole('button', { name: '新增監控設定' })).toHaveCount(0)
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

test('W5 disables new delivery commands while a running definition remains readable after refresh', async ({ page }, info) => {
  test.setTimeout(180_000)
  const health = captureBrowserHealth(page)
  const id = 'w3-definition-checkout-1'
  try {
    await visit(page, 'pipelineDefinition', id)
    await act(page, '驗證草稿')
    await act(page, '啟用交付定義')
    await page.getByRole('button', { name: '依此定義執行', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '依此定義執行' })
    await dialog.getByRole('textbox', { name: '決策／操作理由' }).fill('Keep running work readable after cohort closes')
    await dialog.getByRole('textbox', { name: '來源版本' }).fill('w5-running-proof')
    await dialog.getByRole('button', { name: '確認操作' }).click()
    await expect(page).toHaveURL(/\/rd\/pipelines\/[^/?]+$/)
    const runId = new URL(page.url()).pathname.split('/').at(-1)!
    expect((await snapshot(page)).entities.pipelines.find(row => row.id === runId)?.state).toMatch(/queued|running/)
    await become(page, 'user-admin')
    await page.goto('admin/features')
    await page.getByRole('combobox', { name: '功能', exact: true }).selectOption('rd.delivery')
    await page.getByRole('spinbutton', { name: '灰度百分比' }).first().fill('0')
    await page.getByRole('button', { name: '建立草稿' }).click()
    const card = page.getByRole('article', { name: 'RD 交付定義' })
    await expect(card.getByRole('row', { name: /user-rd-commerce/ })).toContainText('可使用')
    await card.getByRole('button', { name: '驗證草稿' }).click()
    await card.getByRole('button', { name: '啟用灰度' }).click()
    await expect(card.getByRole('row', { name: /user-rd-commerce/ })).toContainText('不可使用')
    await become(page, 'user-rd-commerce')
    await visit(page, 'pipelineDefinition', id)
    await expect(page.getByText('功能灰度目前不允許新指令', { exact: false })).toBeVisible()
    await expect(page.getByRole('link', { name: runId })).toBeVisible()
    await expect(page.getByRole('button', { name: '依此定義執行' })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('link', { name: runId })).toBeVisible()
    expect((await snapshot(page)).entities.pipelines.find(row => row.id === runId)?.state).toMatch(/queued|running/)
    const definition = await source(page, id)
    const environment = (await snapshot(page)).entities.environments.find(row => row.id === 'env-checkout-dev')!
    health.expectedStatuses.add(403)
    expect(await denied(page, `/pipeline-definitions/${id}/runs`, { expectedVersion: definition.version,
      reason: 'Denied new run under closed cohort', environmentId: environment.id,
      environmentVersion: environment.version, sourceRef: 'main', sourceRevision: 'w5-denied-run' }))
      .toMatchObject({ status: 403 })
    await page.getByRole('link', { name: runId }).click()
    await expect(page).toHaveURL(new RegExp(`/rd/pipelines/${runId}$`))
  } finally { await verifyBrowserHealth(page, info, health) }
})

test('W5 service controls follow the selected project cohort', async ({ page }, info) => {
  test.setTimeout(120_000)
  const health = captureBrowserHealth(page)
  try {
    await page.goto('rd')
    await become(page, 'user-admin')
    await page.goto('admin/features')
    const form = page.getByRole('heading', { name: '建立功能政策' }).locator('xpath=ancestor::form')
    for (const [key, label] of [['rd.monitoring', 'RD 服務監控'], ['rd.delivery', 'RD 交付定義']] as const) {
      await form.getByRole('combobox', { name: '功能', exact: true }).selectOption(key)
      await form.getByRole('textbox', { name: '適用專案 ID（逗號分隔）' }).fill('project-store')
      await form.getByRole('button', { name: '建立草稿' }).click()
      const card = page.getByRole('article', { name: label })
      await expect(card).toBeVisible()
      await card.getByRole('button', { name: '驗證草稿' }).click()
      await card.getByRole('button', { name: '啟用灰度' }).click()
      await expect(card).toContainText('active · draft r1 · active r1')
    }
    health.expectedStatuses.add(409)
    await become(page, 'user-rd-commerce')
    await page.goto('rd/apps/app-checkout/monitoring?environmentId=env-checkout-dev')
    await expect(page.getByRole('button', { name: '新增監控設定' })).toBeVisible()
    await page.goto('rd/apps/app-payments/monitoring?environmentId=env-payments-dev')
    await expect(page.getByRole('heading', { name: /payments-api · 監控設定/ })).toBeVisible()
    await expect(page.getByRole('button', { name: '新增監控設定' })).toHaveCount(0)
    await page.goto('rd/apps/app-checkout/delivery?environmentId=env-checkout-dev')
    await expect(page.getByRole('button', { name: '新增交付定義' })).toBeVisible()
    await page.goto('rd/apps/app-payments/delivery?environmentId=env-payments-dev&revisionId=w3-definition-payments-1')
    await expect(page.getByText('功能灰度目前不允許新指令', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: '新增交付定義' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '驗證草稿' })).toHaveCount(0)
    await page.reload()
    await expect(page.getByText('功能灰度目前不允許新指令', { exact: false })).toBeVisible()
  } finally { await verifyBrowserHealth(page, info, health) }
})

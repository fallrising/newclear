import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { act, become, save, snapshot, source, visit } from './w3-ui-helpers'

async function oldAdvance(page: Page, ticks: 1 | 3 | 6) {
  await page.getByRole('combobox', { name: '模擬前進幅度', exact: true }).selectOption(String(ticks))
  await page.getByRole('button', { name: '前進模擬時鐘', exact: true }).click()
  await expect(page.locator('.delivery-demo .command-notice')).toContainText(`模擬時鐘已前進 ${ticks} 個 tick`)
}
async function runDefinition(page: Page, revision: string, environmentId = 'env-checkout-dev') {
  await page.getByRole('button', { name: '依此定義執行', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '依此定義執行', exact: true })
  await dialog.getByRole('combobox', { name: '執行目標環境', exact: true }).selectOption(environmentId)
  await dialog.getByRole('textbox', { name: '來源版本', exact: true }).fill(revision)
  await dialog.getByRole('textbox', { name: '決策／操作理由', exact: true }).fill('Visible definition-backed run using frozen source')
  await dialog.getByRole('button', { name: '確認操作', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/rd\/pipelines\/[^/?]+$/)
  return new URL(page.url()).pathname.split('/').at(-1)!
}

test('W3 definitions: immutable run retry, independently approved production definition and original release approval', async ({ page }, info) => {
  test.setTimeout(180_000)
  const health = captureBrowserHealth(page), id = 'w3-definition-checkout-1'
  try {
    await visit(page, 'pipelineDefinition', id)
    await act(page, '驗證草稿'); await act(page, '啟用交付定義')
    const runId = await runDefinition(page, 'w3-definition-run-first')
    await expect(page.getByRole('heading', { name: '交付定義執行快照', exact: true })).toBeVisible()
    const originalRun = (await snapshot(page)).entities.pipelines.find(item => item.id === runId)!
    expect(originalRun).toMatchObject({ definitionId: id, definitionRevision: 1, sourceRevision: 'w3-definition-run-first' })
    expect(originalRun.artifactDigest).toBeUndefined()
    await page.getByRole('button', { name: '模擬建置失敗', exact: true }).click(); await oldAdvance(page, 1)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('失敗')
    await visit(page, 'pipelineDefinition', id); await act(page, '建立下一版草稿')
    const second = new URL(page.url()).searchParams.get('revisionId')!
    await page.getByRole('button', { name: '編輯草稿', exact: true }).click()
    await page.getByRole('textbox', { name: '定義名稱', exact: true }).fill('Browser independently approved production delivery')
    await page.getByRole('checkbox', { name: /prod/ }).check()
    await page.getByRole('textbox', { name: '變更理由', exact: true }).fill('Add production target with separate definition and deployment approvals')
    await save(page); await act(page, '驗證草稿'); await act(page, '提交獨立審批')
    await become(page, 'user-ops'); await visit(page, 'pipelineDefinition', second, 'env-checkout-dev', 'ops')
    await act(page, '核准變更')
    expect((await source(page, id)).state).toBe('active')
    expect((await source(page, second)).state).toBe('approved')
    await become(page, 'user-rd-commerce'); await visit(page, 'pipelineDefinition', second)
    await act(page, '啟用交付定義')
    expect((await source(page, id)).state).toBe('superseded')
    await page.goto(`rd/pipelines/${runId}`)
    await page.getByRole('button', { name: '重試 Pipeline', exact: true }).click()
    const retry = page.getByRole('dialog', { name: '重試 Pipeline', exact: true })
    await retry.getByLabel('操作理由').fill('Retry keeps original immutable definition version')
    await retry.getByRole('button', { name: '確認重試 Pipeline', exact: true }).click()
    await expect(retry).toHaveCount(0)
    const retryId = new URL(page.url()).pathname.split('/').at(-1)!
    expect(retryId).not.toBe(runId)
    await oldAdvance(page, 6)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${retryId} · 成功`)
    expect((await snapshot(page)).entities.pipelines.find(item => item.id === retryId)?.definitionSnapshot).toEqual(originalRun.definitionSnapshot)
    await visit(page, 'pipelineDefinition', second, 'env-checkout-prod')
    const prodRun = await runDefinition(page, 'w3-separate-prod-deployment', 'env-checkout-prod')
    await oldAdvance(page, 3)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${prodRun} · 等待正式環境核准`)
    const release = (await snapshot(page)).entities.releases.find(item => item.pipelineRunId === prodRun)!
    expect(release.state).toBe('pending_approval'); expect(release.approval).toBeUndefined()
    await become(page, 'user-ops'); await page.goto(`ops/releases/${release.id}`)
    await page.getByRole('button', { name: '核准發布', exact: true }).click()
    const approval = page.getByRole('dialog', { name: '核准發布', exact: true })
    await approval.getByLabel('操作理由').fill('Separate actual production deployment approval after definition approval')
    await approval.getByRole('button', { name: '確認核准發布', exact: true }).click()
    await expect(approval).toHaveCount(0); await oldAdvance(page, 3)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${release.id} · 成功`)
    const complete = await snapshot(page)
    expect(complete.entities.pipelines.find(item => item.id === runId)?.definitionSnapshot).toEqual(originalRun.definitionSnapshot)
    expect(complete.entities.pipelines.find(item => item.id === retryId)?.definitionRevision).toBe(1)
    expect(complete.entities.pipelines.find(item => item.id === prodRun)?.definitionRevision).toBe(2)
    await info.attach('definition-execution-lineage', { body: JSON.stringify({ definition1: await source(page, id), definition2: await source(page, second), originalRun, complete }), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

test('W3 editors and confirmation: real focus containment, Escape return, two themes and three viewports', async ({ page }, info) => {
  test.setTimeout(180_000)
  const health = captureBrowserHealth(page)
  try {
    await visit(page, 'pipelineDefinition', 'w3-definition-checkout-1')
    await page.getByRole('button', { name: '編輯草稿', exact: true }).click()
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題', exact: true }).click()
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await expect(page.getByRole('form', { name: '交付定義編輯器', exact: true })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
        expect(result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([])
        await info.attach(`definition-editor-${theme}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
      }
    }
    await page.getByRole('button', { name: '返回版本詳情', exact: true }).click()
    const trigger = page.getByRole('button', { name: '驗證草稿', exact: true })
    await trigger.focus(); await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: '驗證草稿', exact: true })
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    for (let index = 0; index < 8; index++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true) }
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused()
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題', exact: true }).click()
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 }); await trigger.click(); await expect(dialog).toBeVisible()
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
        expect(result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([])
        await info.attach(`confirmation-${theme}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
        await page.keyboard.press('Escape'); await expect(trigger).toBeFocused()
      }
    }
  } finally { await verifyBrowserHealth(page, info, health) }
})

import { test, expect } from '@playwright/test'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { act, advance, createTraffic, publish, save, snapshot, source, visit } from './w3-ui-helpers'

test('W3 extra browser: typed definition run, config activation and verified traffic survive refresh', async ({ page }, info) => {
  test.setTimeout(180_000)
  const health = captureBrowserHealth(page), definitionId = 'w3-definition-checkout-1', configId = 'w3-config-checkout-dev-1'
  try {
    await visit(page, 'pipelineDefinition', definitionId)
    await act(page, '驗證草稿'); await act(page, '啟用交付定義')
    await page.getByRole('button', { name: '依此定義執行', exact: true }).click()
    const runDialog = page.getByRole('dialog', { name: '依此定義執行', exact: true })
    await runDialog.getByRole('combobox', { name: '執行目標環境', exact: true }).selectOption('env-checkout-dev')
    await runDialog.getByRole('textbox', { name: '來源版本', exact: true }).fill('w3-extra-browser-definition')
    await runDialog.getByRole('textbox', { name: '決策／操作理由', exact: true }).fill('Visible cross-browser frozen definition run')
    await runDialog.getByRole('button', { name: '確認操作', exact: true }).click()
    await expect(runDialog).toHaveCount(0); await expect(page).toHaveURL(/\/rd\/pipelines\/[^/?]+$/)
    const runId = new URL(page.url()).pathname.split('/').at(-1)!
    await page.getByRole('combobox', { name: '模擬前進幅度', exact: true }).selectOption('6')
    await page.getByRole('button', { name: '前進模擬時鐘', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${runId} · 成功`)
    const candidate = (await snapshot(page)).entities.releases.find(item => item.pipelineRunId === runId)!.id
    await visit(page, 'serviceConfig', configId)
    await page.getByRole('button', { name: '編輯草稿', exact: true }).click()
    await page.getByRole('textbox', { name: '設定值 1', exact: true }).fill('warn')
    await page.getByRole('textbox', { name: '變更理由', exact: true }).fill('Refresh current environment guard with typed content')
    await save(page); await act(page, '驗證草稿'); await act(page, '套用配置'); await advance(page, 3)
    expect((await source(page, configId)).state).toBe('active')
    const baseline = await publish(page, 'w3-extra-browser-current')
    const trafficId = await createTraffic(page, baseline, candidate)
    await act(page, '驗證草稿'); await act(page, '開始灰度放量')
    for (const step of [10, 50, 100]) { await advance(page, 60); await expect(page.getByRole('heading', { name: `候選 ${step}% · 已驗證`, exact: true })).toBeVisible() }
    const completed = await snapshot(page)
    expect((await source(page, trafficId)).state).toBe('active')
    expect(completed.entities.pipelines.find(item => item.id === runId)).toMatchObject({ definitionId, definitionRevision: 1, state: 'succeeded' })
    expect(completed.entities.environments.find(item => item.id === 'env-checkout-dev')?.activeReleaseId).toBe(baseline)
    await page.reload(); await expect(page.getByRole('heading', { name: '候選 100% · 已驗證', exact: true })).toBeVisible()
    expect(await snapshot(page)).toEqual(completed)
    await info.attach('w3-extra-browser-closed-loop', { body: JSON.stringify({ definitionId, configId, runId, baseline, candidate, trafficId, completed }), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

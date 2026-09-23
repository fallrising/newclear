import { test, expect, type Page } from '@playwright/test'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { act, advance, become, createTraffic, denied, save, snapshot, source, visit } from './w3-ui-helpers'

async function revoke(page: Page, grantId: string) {
  await become(page, 'user-admin'); await page.goto('admin/access')
  await page.getByRole('textbox', { name: '理由', exact: true }).fill('W3 current scope must supersede historical approval and cached reads')
  const row = page.getByRole('row').filter({ has: page.getByText(grantId, { exact: true }) })
  await row.getByRole('button', { name: '撤銷', exact: true }).click(); await expect(row).toHaveCount(0)
}
async function publishProduction(page: Page, revision: string) {
  await become(page, 'user-rd-commerce'); await page.goto('rd/pipelines')
  await page.getByRole('button', { name: '觸發 Pipeline', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '觸發 Pipeline', exact: true })
  await dialog.getByLabel('發布應用').selectOption('app-checkout'); await dialog.getByLabel('發布環境').selectOption('env-checkout-prod'); await dialog.getByLabel('來源版本').fill(revision)
  await dialog.getByRole('button', { name: '確認觸發', exact: true }).click(); await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/rd\/pipelines\/[^/?]+$/)
  const runId = new URL(page.url()).pathname.split('/').at(-1)!
  await page.getByRole('combobox', { name: '模擬前進幅度', exact: true }).selectOption('3'); await page.getByRole('button', { name: '前進模擬時鐘', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('等待正式環境核准')
  const release = (await snapshot(page)).entities.releases.find(item => item.pipelineRunId === runId)!
  await become(page, 'user-ops'); await page.goto(`ops/releases/${release.id}`)
  await page.getByRole('button', { name: '核准發布', exact: true }).click()
  const approval = page.getByRole('dialog', { name: '核准發布', exact: true })
  await approval.getByLabel('操作理由').fill('Independent production release approval before traffic selection')
  await approval.getByRole('button', { name: '確認核准發布', exact: true }).click(); await expect(approval).toHaveCount(0)
  await page.getByRole('combobox', { name: '模擬前進幅度', exact: true }).selectOption('3'); await page.getByRole('button', { name: '前進模擬時鐘', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${release.id} · 成功`)
  await become(page, 'user-rd-commerce')
  return release.id
}

test('W3 Admin grant changes invalidate approval and remove old deep reads without changing historical source', async ({ page }, info) => {
  test.setTimeout(120_000)
  const health = captureBrowserHealth(page)
  health.expectedStatuses.add(409); health.expectedStatuses.add(404)
  try {
    await visit(page, 'serviceConfig', undefined, 'env-checkout-prod')
    await page.getByRole('button', { name: '新增服務配置', exact: true }).click()
    await page.getByRole('button', { name: '新增設定項目', exact: true }).click()
    await page.getByRole('textbox', { name: '設定名稱 1', exact: true }).fill('SCOPED_CONFIG')
    await page.getByRole('textbox', { name: '設定值 1', exact: true }).fill('private-production-value')
    await page.getByRole('textbox', { name: '變更理由', exact: true }).fill('Require current approver scope at execution')
    const id = await save(page)
    await act(page, '驗證草稿'); await act(page, '提交獨立審批')
    await become(page, 'user-ops'); await visit(page, 'serviceConfig', id, 'env-checkout-prod', 'ops'); await act(page, '核准變更')
    const approved = await source(page, id)
    await revoke(page, 'grant-ops-store')
    await become(page, 'user-rd-commerce'); await visit(page, 'serviceConfig', id, 'env-checkout-prod')
    await expect(page.getByRole('button', { name: '套用配置', exact: true })).toHaveCount(0)
    const before = await snapshot(page)
    expect(await denied(page, `/service-configs/${id}/apply`, { expectedVersion: approved.version, reason: 'Old approval cannot execute after revocation' })).toMatchObject({ status: 409, payload: { error: { code: 'APPROVAL_STALE' } } })
    expect(await snapshot(page)).toEqual(before)
    await act(page, '建立下一版草稿')
    const next = new URL(page.url()).searchParams.get('revisionId')!
    await act(page, '驗證草稿'); await act(page, '提交獨立審批')
    await become(page, 'w2-user-ops-secondary'); await visit(page, 'serviceConfig', next, 'env-checkout-prod', 'ops'); await act(page, '核准變更')
    await become(page, 'user-rd-commerce'); await visit(page, 'serviceConfig', next, 'env-checkout-prod'); await act(page, '套用配置'); await advance(page, 3)
    expect((await source(page, next)).state).toBe('active'); expect(await source(page, id)).toEqual(approved)
    await revoke(page, 'grant-rd-commerce')
    await become(page, 'user-rd-commerce')
    await page.goto(`rd/apps/app-checkout/configuration?environmentId=env-checkout-prod&revisionId=${next}`)
    await expect(page.getByRole('heading', { name: '找不到這個服務配置或版本', exact: true })).toBeVisible()
    await expect(page.locator('main')).not.toContainText('private-production-value')
    await page.reload(); await expect(page.getByRole('heading', { name: '找不到這個服務配置或版本', exact: true })).toBeVisible()
    const hidden = await denied(page, `/service-configs/${next}`, undefined, 'GET')
    expect(hidden.status).toBe(404); expect(JSON.stringify(hidden.payload)).not.toMatch(/SCOPED_CONFIG|private-production-value|w3-secret/)
    await info.attach('current-scope-history', { body: JSON.stringify({ original: approved, retained: await source(page, id), latest: await source(page, next) }), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

test('W3 production traffic: only independently approved release pair can roll through separately approved policy', async ({ page }, info) => {
  test.setTimeout(180_000)
  const health = captureBrowserHealth(page)
  try {
    await page.goto('rd')
    const candidate = await publishProduction(page, 'w3-prod-traffic-candidate'), baseline = await publishProduction(page, 'w3-prod-traffic-baseline')
    const before = await snapshot(page)
    const id = await createTraffic(page, baseline, candidate, 'env-checkout-prod')
    await act(page, '驗證草稿'); await act(page, '提交獨立審批')
    await expect(page.getByRole('button', { name: '開始灰度放量', exact: true })).toHaveCount(0)
    expect((await snapshot(page)).entities.serviceExecutions).toHaveLength(0)
    await become(page, 'user-ops'); await page.goto('ops/requests?source=trafficPolicy')
    await page.getByRole('link', { name: id, exact: true }).click(); await act(page, '核准變更')
    await expect(page.getByRole('button', { name: '開始灰度放量', exact: true })).toHaveCount(0)
    await become(page, 'user-rd-commerce'); await visit(page, 'trafficPolicy', id, 'env-checkout-prod')
    await act(page, '開始灰度放量')
    for (const step of [10, 50, 100]) { await advance(page, 60); await expect(page.getByRole('heading', { name: `候選 ${step}% · 已驗證`, exact: true })).toBeVisible() }
    const complete = await snapshot(page)
    expect((await source(page, id)).state).toBe('active')
    expect(complete.entities.releases).toEqual(before.entities.releases)
    expect(complete.entities.artifacts).toEqual(before.entities.artifacts)
    expect(complete.entities.environments.find(item => item.id === 'env-checkout-prod')?.activeReleaseId).toBe(baseline)
    await info.attach('prod-release-and-traffic-decisions', { body: JSON.stringify({ source: await source(page, id), releases: complete.entities.releases, execution: complete.entities.serviceExecutions.find(item => item.sourceId === id) }), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

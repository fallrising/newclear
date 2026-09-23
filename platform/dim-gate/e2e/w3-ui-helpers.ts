import { expect, type Page } from '@playwright/test'
import type { Snapshot, ServiceSource } from '../src/domain/schemas'

export async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('dim-gate.demo.v1')!).snapshot)
}
export async function become(page: Page, actor: string) {
  await page.waitForLoadState('networkidle')
  const picker = page.getByRole('combobox', { name: '示範身分', exact: true })
  await expect(picker).toBeEnabled()
  if (await picker.inputValue() !== actor) await picker.selectOption(actor)
  await expect(picker).toHaveValue(actor)
  await page.waitForLoadState('networkidle')
}
export async function visit(page: Page, kind: ServiceSource['sourceType'], id?: string, environmentId = 'env-checkout-dev', center: 'rd' | 'ops' = 'rd') {
  const part = { pipelineDefinition: 'delivery', serviceConfig: 'configuration', trafficPolicy: 'traffic' }[kind]
  await page.goto(center === 'ops' ? `ops/service-changes/${kind}/${id}` : `rd/apps/app-checkout/${part}?${new URLSearchParams({ environmentId, ...(id ? { revisionId: id } : {}) })}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(center === 'ops' ? '審批' : { pipelineDefinition: '交付定義', serviceConfig: '服務配置', trafficPolicy: '流量策略' }[kind])
  if (id) await expect(page.locator('.detail-list').filter({ has: page.getByText('來源 ID', { exact: true }) })).toContainText(id)
}
export async function act(page: Page, name: string, reason = 'Visible W3 acceptance: canonical scope and frozen content reviewed') {
  await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog', { name, exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: '決策／操作理由', exact: true }).fill(reason)
  await dialog.getByRole('button', { name: '確認操作', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '示範身分', exact: true })).toBeEnabled()
}
export async function advance(page: Page, seconds: 1 | 3 | 30 | 60) {
  const before = (await snapshot(page)).logicalClock
  await page.getByRole('combobox', { name: '前進秒數', exact: true }).selectOption(String(seconds))
  await page.getByRole('button', { name: '推進示範時鐘', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).logicalClock).toBe(before + seconds)
  await expect(page.getByRole('combobox', { name: '示範身分', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '推進示範時鐘', exact: true })).toBeEnabled()
}
export async function source(page: Page, id: string): Promise<ServiceSource> {
  const s = await snapshot(page)
  const result = [...s.entities.pipelineDefinitions, ...s.entities.serviceConfigs, ...s.entities.trafficPolicies].find(item => item.id === id)
  expect(result, `canonical source ${id}`).toBeDefined()
  return result!
}
export async function save(page: Page) {
  await page.getByRole('button', { name: '儲存版本草稿', exact: true }).click()
  await expect(page.getByRole('button', { name: '儲存版本草稿', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '驗證草稿', exact: true })).toBeVisible()
  return new URL(page.url()).searchParams.get('revisionId')!
}
export async function publish(page: Page, revision: string) {
  await page.goto('rd/pipelines')
  await page.getByRole('button', { name: '觸發 Pipeline', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '觸發 Pipeline', exact: true })
  await dialog.getByLabel('發布應用').selectOption('app-checkout')
  await dialog.getByLabel('發布環境').selectOption('env-checkout-dev')
  await dialog.getByLabel('來源版本').fill(revision)
  await dialog.getByRole('button', { name: '確認觸發', exact: true }).click()
  await expect(page).toHaveURL(/\/rd\/pipelines\/[^/?]+$/)
  const runId = new URL(page.url()).pathname.split('/').at(-1)!
  await page.getByRole('combobox', { name: '模擬前進幅度', exact: true }).selectOption('6')
  await page.getByRole('button', { name: '前進模擬時鐘', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${runId} · 成功`)
  const release = (await snapshot(page)).entities.releases.find(item => item.pipelineRunId === runId)!
  expect(release.state).toBe('succeeded')
  return release.id
}
export async function createTraffic(page: Page, baseline: string, candidate: string, environmentId = 'env-checkout-dev') {
  await visit(page, 'trafficPolicy', undefined, environmentId)
  await page.getByRole('button', { name: '新增流量策略', exact: true }).click()
  await page.getByRole('combobox', { name: '基準版本', exact: true }).selectOption(baseline)
  await page.getByRole('combobox', { name: '候選版本', exact: true }).selectOption(candidate)
  await page.getByRole('textbox', { name: '變更理由', exact: true }).fill('Visible traffic pair with persisted 30-second health samples')
  return save(page)
}
// Raw requests are used only for rejection/contract probes, never successful business setup.
export async function denied(page: Page, path: string, body?: unknown, method = 'POST') {
  return page.evaluate(async ({ path, body, method }) => {
    const saved = JSON.parse(sessionStorage.getItem('dim-gate.demo.v1')!)
    const response = await fetch(`/dim-gate/api/v1${path}`, { method, headers: { 'X-Demo-Session': saved.snapshot.sessionId, 'X-Demo-Persona': saved.personaId, ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }) }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, payload: await response.json() }
  }, { path, body, method })
}

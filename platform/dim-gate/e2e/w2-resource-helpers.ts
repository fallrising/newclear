import { expect, type Page } from '@playwright/test'

export async function become(page: Page, actor: string) {
  await page.waitForLoadState('networkidle')
  const picker = page.getByRole('combobox', { name: '示範身分', exact: true })
  await expect(picker).toBeEnabled()
  if (await picker.inputValue() !== actor) await picker.selectOption(actor)
  await expect(picker).toHaveValue(actor)
  const center = actor === 'user-admin' ? 'admin' : actor.includes('ops') ? 'ops' : 'rd'
  await expect(page.getByRole('region', { name: `${center} 工作首頁` })).toBeVisible()
}
export async function visitChange(page: Page, center: 'rd' | 'ops', id: string) {
  await page.goto(`${center}/changes/${id}`)
  await expect(page.getByRole('heading', { name: '資源變更詳情', exact: true })).toBeVisible()
}
export async function act(page: Page, name: string, reason = 'Browser acceptance: reviewed canonical target and scope') {
  await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog', { name, exact: true })
  await expect(dialog).toBeVisible()
  const field = dialog.getByRole('textbox', { name: '決策／操作理由' })
  if (await field.count()) await field.fill(reason)
  await dialog.getByRole('button', { name: '確認操作', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}
export async function ticks(page: Page, count = 5) {
  for (let tick = 0; tick < count; tick++) {
    const button = page.getByRole('button', { name: '推進示範時鐘 1 tick', exact: true })
    await expect(button).toBeEnabled()
    const before = (await readSnapshot(page)).logicalClock
    await button.click()
    await expect.poll(async () => (await readSnapshot(page)).logicalClock).toBe(before + 1)
    await expect(page.getByRole('button', { name: '正在執行並讀回…', exact: true })).toHaveCount(0)
    if (tick + 1 < count) await expect(button).toBeEnabled()
  }
}
export async function createResource(page: Page, kind: 'redis' | 'kafka', options: { environmentId?: string; ciId?: string; topic?: string; mode?: string; objectId?: string } = {}) {
  await page.goto(`rd/catalog/w2-catalog-${kind}/resource-request`)
  await page.getByRole('combobox', { name: '服務', exact: true }).selectOption('app-checkout')
  await page.getByRole('combobox', { name: '服務環境', exact: true }).selectOption(options.environmentId ?? 'env-checkout-dev')
  if (options.ciId) await page.getByRole('combobox', { name: kind === 'redis' ? 'Redis instance' : 'Kafka cluster', exact: true }).selectOption(options.ciId)
  if (options.mode) await page.getByRole('combobox', { name: '需求類型' }).selectOption(options.mode)
  if (options.objectId) await page.getByRole('combobox', { name: '已有子資源' }).selectOption(options.objectId)
  if (kind === 'kafka' && options.mode !== 'existing') await page.getByRole('textbox', { name: 'Topic 名稱' }).fill(options.topic ?? 'browser-orders')
  await page.getByRole('textbox', { name: '申請理由' }).fill('Visible UI canonical resource journey')
  await page.getByRole('button', { name: '建立資源草稿', exact: true }).click()
  await expect(page.getByRole('heading', { name: '資源變更詳情' })).toBeVisible()
  return new URL(page.url()).pathname.split('/').at(-1)!
}
export async function readSnapshot(page: Page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('dim-gate.demo.v1')!).snapshot)
}
export async function raw(page: Page, path: string, method = 'GET', body?: unknown, key = 'w2-browser-direct') {
  return page.evaluate(async ({ path, method, body, key }) => {
    const saved = JSON.parse(sessionStorage.getItem('dim-gate.demo.v1')!)
    const response = await fetch(`/dim-gate/api/v1${path}`, { method, headers: { 'X-Demo-Session': saved.snapshot.sessionId, 'X-Demo-Persona': saved.personaId, ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }) }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, payload: await response.json() }
  }, { path, method, body, key })
}


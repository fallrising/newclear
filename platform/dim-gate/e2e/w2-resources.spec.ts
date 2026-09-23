import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'

async function become(page: Page, actor: string) {
  await page.waitForLoadState('networkidle')
  const picker = page.getByRole('combobox', { name: '示範身分', exact: true })
  await expect(picker).toBeEnabled()
  if (await picker.inputValue() !== actor) await picker.selectOption(actor)
  await expect(picker).toHaveValue(actor)
  const center = actor === 'user-admin' ? 'admin' : actor.includes('ops') ? 'ops' : 'rd'
  await expect(page.getByRole('region', { name: `${center} 工作首頁` })).toBeVisible()
}
async function visitChange(page: Page, center: 'rd' | 'ops', id: string) {
  await page.goto(`${center}/changes/${id}`)
  await expect(page.getByRole('heading', { name: '資源變更詳情', exact: true })).toBeVisible()
}
async function act(page: Page, name: string, reason = 'Browser acceptance: reviewed canonical target and scope') {
  await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog', { name, exact: true })
  await expect(dialog).toBeVisible()
  const field = dialog.getByRole('textbox', { name: '決策／操作理由' })
  if (await field.count()) await field.fill(reason)
  await dialog.getByRole('button', { name: '確認操作', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}
async function ticks(page: Page, count = 5) {
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
async function createResource(page: Page, kind: 'redis' | 'kafka', options: { environmentId?: string; ciId?: string; topic?: string; mode?: string; objectId?: string } = {}) {
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
async function readSnapshot(page: Page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('dim-gate.demo.v1')!).snapshot)
}
async function raw(page: Page, path: string, method = 'GET', body?: unknown, key = 'w2-browser-direct') {
  return page.evaluate(async ({ path, method, body, key }) => {
    const saved = JSON.parse(sessionStorage.getItem('dim-gate.demo.v1')!)
    const response = await fetch(`/dim-gate/api/v1${path}`, { method, headers: { 'X-Demo-Session': saved.snapshot.sessionId, 'X-Demo-Persona': saved.personaId, ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }) }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, payload: await response.json() }
  }, { path, method, body, key })
}

test('W2 AC-03/04/16: existing staging request → Redis approval → execution → canonical RD/Ops binding survives reload', async ({ page }, info) => {
  test.setTimeout(180_000)
  const health = captureBrowserHealth(page)
  try {
    await page.goto('rd/catalog/catalog-web/request')
    await page.getByRole('combobox', { name: '應用', exact: true }).selectOption('app-checkout')
    await page.getByRole('textbox', { name: '環境名稱', exact: true }).fill('w2-commerce-staging')
    await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('onprem')
    await page.getByRole('textbox', { name: '用途', exact: true }).fill('Staging first through original Request flow')
    await page.getByRole('button', { name: '確認並提交申請' }).click()
    await expect(page.getByRole('heading', { name: /w2-commerce-staging · 待審核/ })).toBeVisible()
    const requestId = new URL(page.url()).pathname.split('/').at(-1)!
    await become(page, 'user-ops')
    await page.goto(`ops/requests/${requestId}`)
    await page.getByRole('button', { name: '核准並保留容量' }).click()
    await expect(page.getByRole('heading', { name: /w2-commerce-staging · 已核准/ })).toBeVisible()
    const environmentId = (await page.locator('dt', { hasText: 'Environment ID' }).locator('..').locator('code').textContent())!
    await page.getByRole('button', { name: '啟動交付', exact: true }).click()
    await expect(page.getByRole('heading', { name: /w2-commerce-staging · 交付中/ })).toBeVisible()
    await page.goto('guide')
    await page.getByLabel('前進幅度').selectOption('5')
    await page.getByRole('button', { name: '前進演示時鐘' }).click()
    await expect(page.locator('.command-notice')).toContainText('演示時鐘已前進 5 個 tick')
    await become(page, 'user-rd-commerce')
    const id = await createResource(page, 'redis', { environmentId })
    await act(page, '提交審核')
    await expect(page.locator('.page-heading')).toContainText('待審核')
    const submitted = await readSnapshot(page)
    const initialCount = submitted.entities.resourceBindings.length
    await become(page, 'user-ops')
    await page.goto('ops/requests?source=change')
    await page.getByRole('link', { name: id, exact: true }).click()
    await act(page, '核准並保留配額')
    await expect(page.locator('.page-heading')).toContainText('已核准，待執行')
    expect((await readSnapshot(page)).entities.resourceBindings).toHaveLength(initialCount)
    await expect(page.getByRole('row', { name: /Redis 配額 MiB/ })).toContainText('512')
    await act(page, '啟動資源執行')
    await ticks(page, 2)
    await page.reload()
    await expect(page.getByRole('heading', { name: '資源變更詳情' })).toBeVisible()
    await expect(page.locator('.page-heading')).toContainText('執行中')
    await ticks(page, 3)
    await expect(page.locator('.page-heading')).toContainText('已成功')
    const final = await readSnapshot(page)
    const binding = final.entities.resourceBindings.find((item: { requestRef: { sourceId: string } }) => item.requestRef.sourceId === id)
    expect(binding.environmentId).toBe(environmentId)
    expect(final.entities.resourceBindings).toHaveLength(initialCount + 1)
    await page.goto('ops/caches/ci-idc-redis-01')
    await expect(page.getByText(binding.id, { exact: true })).toBeVisible()
    await become(page, 'user-rd-commerce')
    await page.goto(`rd/apps/app-checkout/resources?environmentId=${environmentId}`)
    await expect(page.getByText(binding.id, { exact: true })).toBeVisible()
    await expect(page.getByText(binding.resourceObjectId, { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: id, exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText(binding.id, { exact: true })).toBeVisible()
    await info.attach('canonical-readback.json', { body: JSON.stringify({ requestId, environmentId, changeId: id, binding }), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

test('W2 AC-05/07/16: Kafka configure failure, immutable history and independent retry preserve planned identities', async ({ page }, info) => {
  test.setTimeout(150_000)
  const health = captureBrowserHealth(page)
  try {
    await page.goto('rd')
    const id = await createResource(page, 'kafka', { ciId: 'w2-ci-kafka-idc', topic: 'w2-browser-retry' })
    await act(page, '提交審核')
    await become(page, 'user-ops')
    await visitChange(page, 'ops', id)
    await act(page, '核准並保留配額')
    await act(page, '啟動資源執行')
    await page.getByRole('button', { name: '在 configure 注入資源失敗' }).click()
    await expect(page.getByRole('status').filter({ hasText: '已設定這次 attempt' })).toBeVisible()
    await ticks(page, 3)
    await expect(page.locator('.page-heading')).toContainText('執行失敗')
    const failed = await readSnapshot(page)
    const change = failed.entities.changes.find((item: { id: string }) => item.id === id)
    expect(failed.entities.resourceBindings.some((item: { requestRef: { sourceId: string } }) => item.requestRef.sourceId === id)).toBe(false)
    await page.reload()
    await expect(page.locator('.page-heading')).toContainText('執行失敗')
    await become(page, 'user-rd-commerce')
    await visitChange(page, 'rd', id)
    await act(page, '重新送審')
    await expect(page.locator('.page-heading')).toContainText('待審核')
    await become(page, 'w2-user-ops-secondary')
    await visitChange(page, 'ops', id)
    await act(page, '核准並保留配額')
    await act(page, '啟動資源執行')
    await ticks(page)
    await expect(page.locator('.page-heading')).toContainText('已成功')
    await expect(page.locator('.change-history article')).toHaveCount(2)
    const restored = await readSnapshot(page)
    const current = restored.entities.changes.find((item: { id: string }) => item.id === id)
    expect(current.specSnapshot).toEqual(change.specSnapshot)
    expect(current.plannedObjectIds).toEqual(change.plannedObjectIds)
    expect(current.plannedBindingIds).toEqual(change.plannedBindingIds)
    expect(current.decisions).toHaveLength(2)
    expect(restored.entities.resourceBindings.filter((item: { requestRef: { sourceId: string } }) => item.requestRef.sourceId === id)).toHaveLength(1)
    await become(page, 'user-rd-commerce')
    await page.goto('rd/apps/app-checkout/resources?environmentId=env-checkout-dev')
    await expect(page.getByRole('heading', { name: 'w2-browser-retry', exact: true })).toBeVisible()
    await info.attach('retry-lineage.json', { body: JSON.stringify({ before: change, after: current }), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

test('W2 AC-03/08/09/15: scoped shared inventory, readonly K8s and direct Admin denial', async ({ page }, info) => {
  test.setTimeout(120_000)
  const health = captureBrowserHealth(page)
  health.expectedStatuses.add(404); health.expectedStatuses.add(403)
  try {
    await page.goto('rd/apps/app-checkout/resources?environmentId=env-checkout-dev')
    await expect(page.getByText('w2-object-redis-commerce', { exact: true })).toBeVisible()
    await expect(page.locator('body')).not.toContainText('w2-object-redis-data')
    await page.getByRole('link', { name: /ci-idc-redis-01 · 專業唯讀視圖/ }).click()
    await expect(page.getByRole('heading', { name: '影響範圍未完整授權', exact: true })).toBeVisible()
    await expect(page.locator('body')).not.toContainText('w2-object-redis-data')
    const hidden = await raw(page, '/resource-objects/w2-object-redis-data')
    expect(hidden.status).toBe(404)
    expect(JSON.stringify(hidden.payload)).not.toContain('w2-object-redis-data')
    await become(page, 'user-ops')
    await page.goto('ops/cmdb/w2-ci-k8s-aws')
    await page.getByRole('link', { name: '查看專業資源與消費者' }).click()
    await expect(page.getByRole('heading', { name: 'Workload 唯讀樣本' })).toBeVisible()
    await expect(page.locator('body')).toContainText('stale · 樣本過期')
    await expect(page.getByRole('button', { name: /kubectl|scale|exec|擴容/ })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Node 唯讀樣本' })).toBeVisible()
    await become(page, 'user-admin')
    expect((await raw(page, '/resource-inventory/ci-idc-redis-01')).status).toBe(404)
    expect((await raw(page, '/changes', 'POST', { kind: 'resource.bind', mode: 'create', catalogItemId: 'w2-catalog-redis', catalogRevision: 1, reason: 'Direct Admin permission probe', targetCiId: 'ci-idc-redis-01', targetCiVersion: 1, applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1, quotaMiB: 512, purpose: 'runtime', accessProfileRef: 'w2-profile-redis-runtime' })).status).toBe(403)
    await page.goto('ops/caches')
    await expect(page.getByRole('heading', { name: '目前身分無法進入維運中心' })).toBeVisible()
  } finally { await verifyBrowserHealth(page, info, health) }
})

// Accessibility is measured on rendered product routes, including a live draft dialog.
test('W2 AC-17/18: resource routes and keyboard confirmation across themes and viewport sizes', async ({ page }, info) => {
  test.setTimeout(240_000)
  const health = captureBrowserHealth(page), external: string[] = []
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1' && !request.url().startsWith('data:')) external.push(request.url()) })
  try {
    await page.goto('rd')
    const id = await createResource(page, 'redis')
    const trigger = page.getByRole('button', { name: '提交審核', exact: true })
    for (let i = 0; i < 70 && !await trigger.evaluate(el => el === document.activeElement); i++) await page.keyboard.press('Tab')
    await expect(trigger).toBeFocused()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: '提交審核', exact: true })
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    const routes = [`rd/changes/${id}`, 'rd/apps/app-checkout/resources?environmentId=env-checkout-dev', 'rd/requests?source=change', 'rd/catalog/w2-catalog-kafka/resource-request']
    for (const route of routes) {
      await page.goto(route)
      await expect(page.locator('main h1')).toBeVisible()
      for (const theme of ['light', 'dark']) {
        if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題' }).click()
        for (const width of [1440, 768, 390]) {
          await page.setViewportSize({ width, height: 1000 })
          await expect(page.locator('main h1')).toBeVisible()
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          expect((await new AxeBuilder({ page }).analyze()).violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([])
        }
      }
    }
    await visitChange(page, 'rd', id)
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題' }).click()
      await trigger.click()
      expect((await new AxeBuilder({ page }).analyze()).violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([])
      await page.keyboard.press('Escape')
    }
    await become(page, 'user-ops')
    for (const route of ['ops/caches', 'ops/caches/ci-idc-redis-01', 'ops/messaging/w2-ci-kafka-idc', 'ops/clusters/w2-ci-k8s-aws']) {
      await page.goto(route)
      await expect(page.locator('main h1')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect((await new AxeBuilder({ page }).analyze()).violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([])
    }
    expect(external).toEqual([])
  } finally { await verifyBrowserHealth(page, info, health) }
})

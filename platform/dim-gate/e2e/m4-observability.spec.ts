import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

import { captureBrowserHealth, verifyBrowserHealth, type BrowserHealth } from './browser-health'

const health = new WeakMap<Page, BrowserHealth>()

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15_000)
  health.set(page, captureBrowserHealth(page))
})

test.afterEach(async ({ page }, info) => {
  await verifyBrowserHealth(page, info, health.get(page)!)
})

async function become(page: Page, persona: string) {
  const selector = page.getByRole('combobox', { name: '示範身分' })
  await expect(selector).toBeVisible()
  if (await selector.inputValue() !== persona) await selector.selectOption(persona)
  await expect(selector).toHaveValue(persona)
}

async function advance(page: Page, ticks: 1 | 3 | 6 = 6) {
  await page.getByRole('combobox', { name: '模擬前進幅度' }).selectOption(String(ticks))
  await page.getByRole('button', { name: '前進模擬時鐘', exact: true }).click()
  await expect(page.locator('.delivery-demo .command-notice')).toContainText(`模擬時鐘已前進 ${ticks} 個 tick`)
}

async function trigger(page: Page, revision: string, environmentId = 'env-checkout-dev', applicationId = 'app-checkout') {
  await page.goto('rd/pipelines')
  await page.getByRole('button', { name: '觸發 Pipeline', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '觸發 Pipeline' })
  await dialog.getByLabel('發布應用').selectOption(applicationId)
  await dialog.getByLabel('發布環境').selectOption(environmentId)
  await dialog.getByLabel('來源版本').fill(revision)
  await dialog.getByRole('button', { name: '確認觸發' }).click()
  await expect(page).toHaveURL(/\/rd\/pipelines\/[^/?]+$/)
  const id = new URL(page.url()).pathname.split('/').at(-1)!
  await expect(page.getByRole('heading', { level: 1 })).toContainText(id)
  return id
}

async function openRelease(page: Page) {
  const link = page.locator('dt').filter({ hasText: /^候選發布$/ }).locator('..').getByRole('link')
  await expect(link).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(/\/releases\/[^/?]+$/)
  const id = new URL(page.url()).pathname.split('/').at(-1)!
  await expect(page.getByRole('heading', { level: 1 })).toContainText(id)
  return id
}

async function publish(page: Page, revision: string, environmentId = 'env-checkout-dev') {
  const runId = await trigger(page, revision, environmentId)
  await advance(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${runId} · 成功`)
  return { runId, releaseId: await openRelease(page) }
}

async function rollback(page: Page, targetId: string, reason: string) {
  await page.getByRole('button', { name: '回滾版本', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '回滾版本', exact: true })
  await dialog.getByLabel('回滾目標').selectOption(targetId)
  await dialog.getByLabel('回滾理由').fill(reason)
  await dialog.getByRole('button', { name: '確認回滾' }).click()
  await expect(dialog).toBeHidden()
  return new URL(page.url()).pathname.split('/').at(-1)!
}

// The browser reads API results for state evidence. Every successful business
// transition in these journeys is initiated through the visible product UI.
async function browserApi(page: Page, input: { path: string; persona?: string; body?: unknown }) {
  return page.evaluate(async ({ path, persona, body }) => {
    const saved = JSON.parse(sessionStorage.getItem('dim-gate.demo.v1')!) as { snapshot: { sessionId: string; actorId?: string } }
    const response = await fetch(`/dim-gate/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: {
      Accept: 'application/json', 'X-Demo-Session': saved.snapshot.sessionId, 'X-Demo-Persona': persona ?? 'user-rd-commerce',
      ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, payload: await response.json() as unknown }
  }, input)
}

async function createReadyStaging(page: Page, provider: 'aws' | 'aliyun' | 'onprem') {
  await page.goto('guide')
  await page.getByTestId('guide-step-request').getByRole('link').click()
  await page.getByRole('link', { name: '開始申請' }).click()
  await page.getByRole('combobox', { name: '應用', exact: true }).selectOption('app-checkout')
  await page.getByRole('textbox', { name: '環境名稱', exact: true }).fill('e2e-m4-staging')
  await page.getByRole('combobox', { name: '階段', exact: true }).selectOption('staging')
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption(provider)
  await page.getByRole('textbox', { name: '用途', exact: true }).fill('M4 complete observation and recovery story')
  await page.getByRole('button', { name: '確認並提交申請' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('e2e-m4-staging · 待審核')
  const requestId = new URL(page.url()).pathname.split('/').at(-1)!
  await become(page, 'user-ops')
  await page.goto('guide')
  await page.getByTestId('guide-step-provision').getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/ops/requests/${requestId}$`))
  await page.getByRole('button', { name: '核准並保留容量' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('e2e-m4-staging · 已核准')
  const environmentId = (await page.locator('dt').filter({ hasText: /^Environment ID$/ }).locator('..').locator('code').textContent())!
  await page.getByRole('button', { name: '啟動交付' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('e2e-m4-staging · 交付中')
  await page.goto('guide')
  await page.getByLabel('前進幅度').selectOption('5')
  await page.getByRole('button', { name: '前進演示時鐘' }).click()
  await expect(page.locator('.command-notice')).toContainText('演示時鐘已前進 5 個 tick')
  await become(page, 'user-rd-commerce')
  return environmentId
}


async function guideAdvance(page: Page, ticks: 1 | 5 | 60 = 60) {
  await page.goto('guide')
  await page.getByLabel('前進幅度').selectOption(String(ticks))
  await page.getByRole('button', { name: '前進演示時鐘', exact: true }).click()
  await expect(page.locator('.command-notice')).toContainText(`演示時鐘已前進 ${ticks} 個 tick`)
}

async function injectLatency(page: Page, environmentId = 'env-checkout-dev') {
  await page.goto('guide')
  await page.getByRole('combobox', { name: '情境應用' }).selectOption('app-checkout')
  await page.getByRole('combobox', { name: '情境環境' }).selectOption(environmentId)
  await page.getByRole('button', { name: '注入發布後延遲', exact: true }).click()
  await expect(page.getByText('已注入三個一分鐘異常樣本；可前往觀測與事件詳情。')).toBeVisible()
}

async function readIncident(page: Page, id: string, persona = 'user-rd-commerce') {
  const response = await browserApi(page, { path: `/incidents/${id}`, persona })
  expect(response.status).toBe(200)
  return (response.payload as { data: { id: string; state: string; recoverySamples: number; version: number; episode: number; evidence: unknown[] } }).data
}

async function incidentFor(page: Page, environmentId = 'env-checkout-dev') {
  const response = await browserApi(page, { path: `/incidents?environmentId=${environmentId}` })
  expect(response.status).toBe(200)
  const items = (response.payload as { data: { total: number; items: { id: string }[] } }).data
  expect(items.total).toBe(1)
  return items.items[0].id
}

async function incidentAction(page: Page, title: string) {
  await page.getByRole('button', { name: title, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: title, exact: true })
  await dialog.getByLabel('操作理由').fill('以實際觀測與關聯發布確認處理原因')
  await dialog.getByRole('button', { name: `確認${title}`, exact: true }).click()
  await expect(dialog).toBeHidden()
}

for (const provider of ['aws', 'aliyun', 'onprem'] as const) {
  test(`AC-17/18/19/25: ${provider} Guide story preserves correlation through UI diagnosis and three recovery minutes`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await page.goto('guide')
    await become(page, 'user-admin')
    await page.goto('guide')
    await page.getByRole('link', { name: '檢查服務目錄', exact: true }).click()
    await expect(page.getByRole('heading', { name: '服務目錄治理', exact: true })).toBeVisible()
    await page.goto('guide')
    await page.getByRole('link', { name: '檢查角色範圍', exact: true }).click()
    await expect(page.getByRole('table', { name: '固定角色與資源範圍' })).toContainText('project-store')
    await page.goto('guide')
    await page.getByRole('link', { name: '設定導航名稱', exact: true }).click()
    const navigationRow = page.getByRole('row', { name: /admin\.catalog/ })
    await navigationRow.getByLabel('admin.catalog label').fill('故事服務目錄')
    await navigationRow.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByRole('link', { name: '故事服務目錄', exact: true })).toBeVisible()
    await become(page, 'user-ops')
    await page.goto('guide')
    await page.getByRole('link', { name: '檢查三種資源來源', exact: true }).click()
    for (const source of ['aws', 'aliyun', 'onprem']) {
      await page.getByRole('combobox', { name: /Provider/ }).selectOption(source)
      await expect(page.locator('caption')).toContainText('共 20 筆')
    }
    await page.goto('guide')
    await page.getByRole('link', { name: '檢查共享依賴', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('拓撲')
    await become(page, 'user-rd-commerce')
    const environmentId = await createReadyStaging(page, provider)
    const stable = await publish(page, 'demo-stable-001', environmentId)
    const problem = await publish(page, 'demo-latency-002', environmentId)
    await injectLatency(page, environmentId)
    const incidentId = await incidentFor(page, environmentId)
    await page.getByTestId('guide-step-observe').getByRole('link').click()
    await expect(page.getByRole('heading', { name: '應用觀測', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'RED metrics' })).toContainText('3 筆樣本')
    await page.getByText('錯誤率資料表', { exact: true }).click()
    await expect(page.getByRole('table', { name: '錯誤率 · 原始樣本值' })).toContainText(/8\s*%/)
    const traces = page.getByRole('table', { name: '目前環境與時間範圍的 Trace' })
    await traces.getByRole('link', { name: 'GET /checkout · demo', exact: true }).first().click()
    const traceId = new URL(page.url()).searchParams.get('traceId')!
    await expect(page.getByRole('heading', { name: 'Trace waterfall · GET /checkout · demo' })).toBeVisible()
    await expect(page.getByRole('table', { name: /Trace span 耗時表/ })).toContainText('900 ms')
    await page.getByRole('link', { name: '查看此 Trace 的日誌' }).click()
    await expect(page.getByRole('table', { name: 'Trace／Release 關聯日誌' })).toContainText(traceId)
    await expect(page.getByRole('table', { name: 'Trace／Release 關聯日誌' })).toContainText(problem.releaseId)
    await info.attach('correlated-observation', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    await page.getByRole('link', { name: incidentId, exact: true }).click()
    await expect(page.getByRole('heading', { name: '事件詳情' })).toBeVisible()
    await expect(page.getByRole('button', { name: '認領事件', exact: true })).toBeDisabled()
    await expect(page.getByRole('link', { name: `關聯發布 ${problem.releaseId}` })).toBeVisible()
    await become(page, 'user-ops')
    await page.goto('guide')
    await page.getByTestId('guide-step-investigate').getByRole('link').click()
    await incidentAction(page, '認領事件')
    await incidentAction(page, '開始調查')
    await expect(page.locator('dt').filter({ hasText: /^負責人$/ }).locator('..')).toContainText('user-ops')
    await page.getByRole('link', { name: '開啟影響拓撲' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('拓撲')
    await become(page, 'user-rd-commerce')
    await page.goto(`rd/releases/${problem.releaseId}`)
    const rollbackId = await rollback(page, stable.releaseId, '觀測顯示延遲異常，恢復先前成功產物')
    await advance(page, 3)
    expect(await readIncident(page, incidentId)).toMatchObject({ state: 'investigating', recoverySamples: 0 })
    for (let sample = 1; sample <= 3; sample++) {
      await guideAdvance(page)
      expect(await readIncident(page, incidentId)).toMatchObject({ state: sample === 3 ? 'resolved' : 'investigating', recoverySamples: sample })
      await page.goto(`ops/incidents/${incidentId}`)
      await expect(page.locator('dt').filter({ hasText: /^連續健康樣本$/ }).locator('..')).toContainText(`${sample} / 3`)
      if (sample === 1) {
        await page.reload()
        await expect(page).toHaveURL(new RegExp(`/ops/incidents/${incidentId}$`))
        await expect(page.getByRole('heading', { name: '事件詳情', exact: true })).toBeVisible()
        await expect(page.locator('.page-heading code')).toHaveText(incidentId)
        await expect(page.locator('dt').filter({ hasText: /^連續健康樣本$/ }).locator('..')).toContainText('1 / 3')
        expect(await readIncident(page, incidentId)).toMatchObject({ id: incidentId, state: 'investigating', recoverySamples: 1 })
      }
    }
    expect(await browserApi(page, { path: `/environments/${environmentId}` })).toMatchObject({ status: 200, payload: { data: { environment: { activeReleaseId: rollbackId } } } })
    await expect(page.getByRole('heading', { name: '已觀測證據' })).toBeVisible()
    await page.goto('guide')
    const steps = page.locator('[data-testid^="guide-step-"]')
    await expect(steps).toHaveCount(8)
    for (const step of await steps.all()) await expect(step).toHaveAttribute('data-completed', 'true')
    await info.attach('guide-completion', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    await become(page, 'user-admin')
    await page.goto('guide')
    await page.getByRole('link', { name: '查看完整管理稽核', exact: true }).click()
    await expect(page.getByRole('table')).toContainText(incidentId)
    await expect(page.getByRole('table')).toContainText(rollbackId)
    await info.attach('causal-audit', { body: await page.locator('main').innerText(), contentType: 'text/plain' })
    await page.goto('guide')
    await page.getByRole('button', { name: '重置示範', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '確認重置示範', exact: true }).click()
    await expect(page.getByTestId('logical-clock')).toContainText('0ticks')
    await expect(steps).toHaveCount(8)
    for (const step of await steps.all()) await expect(step).toHaveAttribute('data-completed', 'false')
  })
}

test('AC-17/18: empty, strict window, duplicate incident, recovery fallback and reopening remain truthful', async ({ page }, info) => {
  test.setTimeout(90_000)
  await page.goto('rd/observability?applicationId=app-checkout&environmentId=env-checkout-dev')
  await expect(page.getByText('此時間範圍沒有樣本；健康狀態未知。').first()).toBeVisible()
  await page.getByLabel('起始時間（UTC ISO）').fill('2026-09-20T10:00:00Z')
  await page.getByLabel('結束時間（UTC ISO，不含）').fill('2026-09-20T09:00:00Z')
  await page.getByRole('button', { name: '套用時間範圍' }).click()
  await expect(page.getByRole('alert')).toContainText('範圍最多 24 小時')
  const release = await publish(page, 'no-rollback-baseline')
  await expect(page.getByRole('button', { name: '回滾版本', exact: true })).toBeDisabled()
  await injectLatency(page)
  const incidentId = await incidentFor(page)
  const first = await readIncident(page, incidentId)
  await injectLatency(page)
  expect(await incidentFor(page)).toBe(incidentId)
  const repeated = await readIncident(page, incidentId)
  expect(repeated.episode).toBe(1)
  expect(repeated.evidence.length).toBeGreaterThan(first.evidence.length)
  await page.getByRole('button', { name: '注入恢復樣本', exact: true }).click()
  await expect(page.getByText('已注入三個一分鐘健康樣本；事件結果依觀測規則更新。')).toBeVisible()
  expect(await readIncident(page, incidentId)).toMatchObject({ state: 'resolved', recoverySamples: 3 })
  await injectLatency(page)
  expect(await incidentFor(page)).toBe(incidentId)
  expect(await readIncident(page, incidentId)).toMatchObject({ state: 'open', recoverySamples: 0, episode: 2 })
  await info.attach('same-incident-reopened', { body: JSON.stringify({ incidentId, releaseId: release.releaseId, incident: await readIncident(page, incidentId) }), contentType: 'application/json' })
})

test('AC-19/24: failed rollback leaves incident active; reset removes recovery work and old observations', async ({ page }) => {
  test.setTimeout(75_000)
  await page.goto('rd')
  const stable = await publish(page, 'm4-rollback-stable')
  const problem = await publish(page, 'm4-rollback-problem')
  await injectLatency(page)
  const incidentId = await incidentFor(page)
  await page.goto(`rd/releases/${problem.releaseId}`)
  const rollbackId = await rollback(page, stable.releaseId, '模擬回滾失敗不應清除事件')
  await page.getByRole('button', { name: '模擬回滾失敗', exact: true }).click()
  await advance(page, 3)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${rollbackId} · 失敗`)
  await guideAdvance(page)
  expect(await readIncident(page, incidentId)).toMatchObject({ state: 'open', recoverySamples: 0 })
  expect(await browserApi(page, { path: '/environments/env-checkout-dev' })).toMatchObject({ payload: { data: { environment: { activeReleaseId: problem.releaseId } } } })
  await page.getByRole('button', { name: '重置示範', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '確認重置示範', exact: true }).click()
  await expect(page.getByTestId('logical-clock')).toContainText('0ticks')
  await guideAdvance(page)
  expect(await browserApi(page, { path: '/incidents' })).toMatchObject({ payload: { data: { total: 0, items: [] } } })
  await page.goto('rd/observability?applicationId=app-checkout&environmentId=env-checkout-dev')
  await expect(page.getByText('此時間範圍沒有樣本；健康狀態未知。').first()).toBeVisible()
})

test('AC-20/25: persona changes remove raw evidence and scoped notifications; Admin integration test is explicitly simulated', async ({ page }, info) => {
  test.setTimeout(90_000)
  await page.goto('rd')
  await publish(page, 'm4-scope-release')
  await injectLatency(page)
  const incidentId = await incidentFor(page)
  const all = await browserApi(page, { path: '/observability/traces?applicationId=app-checkout&environmentId=env-checkout-dev&from=2026-09-20T09%3A00%3A00Z&to=2026-09-20T10%3A00%3A00Z' })
  const traceId = (all.payload as { data: { items: { id: string }[] } }).data.items[0].id
  await become(page, 'user-admin')
  await page.goto(`ops/incidents/${incidentId}`)
  await expect(page.getByRole('heading', { name: '事件詳情' })).toBeVisible()
  await expect(page.locator('main')).not.toContainText(traceId)
  await page.goto('rd/observability?applicationId=app-checkout&environmentId=env-checkout-dev')
  await expect(page.getByText(/目前身分僅可讀取觀測 metadata/)).toBeVisible()
  await expect(page.getByRole('table', { name: '目前環境與時間範圍的 Trace' })).toHaveCount(0)
  await page.goto('admin/integrations')
  await page.getByRole('button', { name: /^模擬測試 · / }).first().click()
  const dialog = page.getByRole('dialog', { name: '模擬整合測試' })
  await expect(dialog).toContainText('不會建立真實網路連線')
  await dialog.getByRole('button', { name: '確認模擬測試', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(/Demo 測試通過/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Demo 測試通過/)).toBeVisible()
  await become(page, 'user-rd-data')
  await page.getByLabel('事件通知', { exact: true }).click()
  await expect(page.getByRole('region', { name: '目前可見通知' })).not.toContainText(incidentId)
  await page.getByLabel('事件通知', { exact: true }).click()
  await page.goto('guide')
  await expect(page.locator('main')).not.toContainText(incidentId)
  health.get(page)!.expectedStatuses.add(404)
  expect(await browserApi(page, { path: `/incidents/${incidentId}`, persona: 'user-rd-data' })).toMatchObject({ status: 404 })
  expect(await browserApi(page, { path: `/observability/traces/${traceId}`, persona: 'user-rd-data' })).toMatchObject({ status: 404 })
  await info.attach('scope-isolation', { body: JSON.stringify({ incidentId, traceId, visibleDom: await page.locator('main').innerText() }), contentType: 'application/json' })
})

test('M4 observation/incident/Guide/integrations support actual theme changes, viewport layouts, axe and initial dialog focus', async ({ page }, info) => {
  test.setTimeout(240_000)
  await page.goto('rd')
  await publish(page, 'm4-accessibility')
  await injectLatency(page)
  const incidentId = await incidentFor(page)
  await become(page, 'user-ops')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題' }).click()
      for (const route of [`rd/observability?applicationId=app-checkout&environmentId=env-checkout-dev`, `ops/incidents/${incidentId}`, 'guide']) {
        await page.goto(route)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expect(page.getByText(/正在讀取/)).toHaveCount(0)
        if (route.startsWith('rd/observability')) {
          await page.getByLabel('事件通知', { exact: true }).click()
          const panel = page.getByRole('region', { name: '目前可見通知' })
          await expect(panel).toBeVisible()
          const bounds = await panel.boundingBox()
          expect(bounds!.x).toBeGreaterThanOrEqual(0)
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
          await info.attach(`notifications-${theme}-${viewport.width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
          await page.getByLabel('事件通知', { exact: true }).click()
        }
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
        expect(dimensions.content, `${route} ${theme} ${viewport.width}`).toBeLessThanOrEqual(dimensions.viewport)
        const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(issue => ['serious', 'critical'].includes(issue.impact ?? ''))
        expect(violations).toEqual([])
        const name = `${route.split('?')[0].replaceAll('/', '-')}-${theme}-${viewport.width}`
        await info.attach(name, { body: JSON.stringify({ route, theme, viewport, dimensions, violations }), contentType: 'application/json' })
        await info.attach(`${name}-screen`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
      }
    }
    await page.goto(`ops/incidents/${incidentId}`)
    const trigger = page.getByRole('button', { name: '認領事件', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '認領事件' })
    const focused = await page.evaluate(() => ({ html: document.activeElement?.outerHTML, inDialog: !!document.activeElement?.closest('[role="dialog"]') }))
    expect(focused.inDialog).toBe(true)
    await info.attach(`incident-initial-focus-${viewport.width}`, { body: JSON.stringify(focused), contentType: 'application/json' })
    for (let index = 0; index < 8; index++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true) }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  }
  await become(page, 'user-admin')
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('admin/integrations')
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題' }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const trigger = page.getByRole('button', { name: /^模擬測試 · / }).first()
      await expect(trigger).toBeVisible()
      const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(issue => ['serious', 'critical'].includes(issue.impact ?? ''))
      expect(violations).toEqual([])
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
      await info.attach(`integrations-${theme}-${width}`, { body: JSON.stringify({ theme, dimensions, violations }), contentType: 'application/json' })
      await info.attach(`integrations-${theme}-${width}-screen`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: '模擬整合測試' })
      const focused = await page.evaluate(() => ({ html: document.activeElement?.outerHTML, inDialog: !!document.activeElement?.closest('[role="dialog"]') }))
      expect(focused.inDialog).toBe(true)
      for (let index = 0; index < 8; index++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true) }
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(trigger).toBeFocused()
      await info.attach(`integration-focus-${theme}-${width}`, { body: JSON.stringify({ initial: focused, tabContained: 8, escapeClosed: true, focusReturned: true }), contentType: 'application/json' })
    }
  }
})

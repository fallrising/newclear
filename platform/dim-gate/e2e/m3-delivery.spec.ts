import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Snapshot } from '../src/domain/schemas'

type BrowserHealth = { console: { type: string; text: string }[]; network: { method: string; status: number; url: string }[]; consoleErrors: string[]; pageErrors: string[]; failedRequests: string[]; httpErrors: { status: number; url: string }[]; expectedStatuses: Set<number> }
const health = new WeakMap<Page, BrowserHealth>()

test.beforeEach(async ({ page }) => {
  const evidence: BrowserHealth = { console: [], network: [], consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [], expectedStatuses: new Set() }
  health.set(page, evidence)
  page.on('console', (message) => { evidence.console.push({ type: message.type(), text: message.text() }); if (message.type() === 'error') evidence.consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message))
  page.on('requestfailed', (request) => evidence.failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`))
  page.on('response', (response) => { evidence.network.push({ method: response.request().method(), status: response.status(), url: response.url() }); if (response.status() >= 400) evidence.httpErrors.push({ status: response.status(), url: response.url() }) })
})

test.afterEach(async ({ page }, info) => {
  const evidence = health.get(page)!
  await info.attach('browser-health', { body: JSON.stringify({ ...evidence, expectedStatuses: [...evidence.expectedStatuses] }, null, 2), contentType: 'application/json' })
  if (!page.isClosed()) {
    await info.attach('visible-dom', { body: await page.locator('body').innerText(), contentType: 'text/plain' })
    await info.attach('final-screen', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  }
  if (info.status !== info.expectedStatus) return
  expect(evidence.pageErrors).toEqual([])
  expect(evidence.failedRequests).toEqual([])
  expect(evidence.httpErrors.filter((entry) => !evidence.expectedStatuses.has(entry.status))).toEqual([])
  expect(evidence.consoleErrors.filter((message) => ![...evidence.expectedStatuses].some((status) => message.includes(`status of ${status}`)))).toEqual([])
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

async function reasonAction(page: Page, title: string, reason: string) {
  await page.getByRole('button', { name: title, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: title, exact: true })
  await dialog.getByLabel('操作理由').fill(reason)
  await dialog.getByRole('button', { name: `確認${title}`, exact: true }).click()
  await expect(dialog).toBeHidden()
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

async function createReadyStaging(page: Page) {
  await page.goto('rd/catalog/catalog-web/request')
  await page.getByRole('combobox', { name: '應用', exact: true }).selectOption('app-checkout')
  await page.getByRole('textbox', { name: '環境名稱', exact: true }).fill('e2e-m3-staging')
  await page.getByRole('combobox', { name: '階段', exact: true }).selectOption('staging')
  await page.getByRole('textbox', { name: '用途', exact: true }).fill('M3 stable → next → rollback browser journey')
  await page.getByRole('button', { name: '確認並提交申請' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('e2e-m3-staging · 待審核')
  const requestId = new URL(page.url()).pathname.split('/').at(-1)!
  await become(page, 'user-ops')
  await page.goto(`ops/requests/${requestId}`)
  await page.getByRole('button', { name: '核准並保留容量' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('e2e-m3-staging · 已核准')
  const environmentId = (await page.locator('dt').filter({ hasText: /^Environment ID$/ }).locator('..').locator('code').textContent())!
  await page.getByRole('button', { name: '啟動交付' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('e2e-m3-staging · 交付中')
  await page.goto('guide')
  await page.getByLabel('前進幅度').selectOption('5')
  await page.getByRole('button', { name: '前進演示時鐘' }).click()
  await expect(page.locator('.command-notice')).toContainText('演示時鐘已前進 5 個 tick')
  await become(page, 'user-rd-commerce')
  return environmentId
}

test('AC-13: ready staging → stable → next → reasoned rollback preserves stage, artifact, active and audit history', async ({ page }, info) => {
  test.setTimeout(60_000)
  await page.goto('rd')
  const environmentId = await createReadyStaging(page)
  const stableRun = await trigger(page, 'demo-stable-001', environmentId)
  await expect(page.getByRole('list', { name: 'Pipeline 階段' }).getByRole('button')).toHaveCount(5)
  await advance(page, 3)
  await expect(page.locator('dt').filter({ hasText: /^候選發布$/ }).locator('..')).toContainText('等待部署')
  expect(await browserApi(page, { path: `/environments/${environmentId}` })).toMatchObject({ status: 200, payload: { data: { environment: { activeReleaseId: null } } } })
  await page.getByRole('button', { name: /^封裝 package/ }).click()
  await expect(page.getByRole('list', { name: '封裝階段 log' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(stableRun)
  await advance(page, 3)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${stableRun} · 成功`)
  const stableRelease = await openRelease(page)
  const stableDigest = await page.locator('dt').filter({ hasText: /^產物 digest$/ }).locator('..').locator('code').textContent()
  await expect(page.getByRole('button', { name: '回滾版本', exact: true })).toBeDisabled()
  await expect(page.getByText('沒有同環境、不同產物且仍可用的成功歷史版本。')).toBeVisible()

  const next = await publish(page, 'demo-next-002', environmentId)
  await expect(page.getByRole('region', { name: '目前生效版本' })).toContainText(next.releaseId)
  const rollbackId = await rollback(page, stableRelease, '恢復已驗證的穩定版本')
  expect(rollbackId).not.toBe(next.releaseId)
  expect(rollbackId).not.toBe(stableRelease)
  await expect(page.getByRole('region', { name: '目前生效版本' })).toContainText(next.releaseId)
  await advance(page, 3)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${rollbackId} · 成功`)
  await expect(page.getByRole('region', { name: '目前生效版本' })).toContainText(rollbackId)
  await expect(page.locator('dt').filter({ hasText: /^產物 digest$/ }).locator('..')).toContainText(stableDigest!)
  await expect(page.locator('dt').filter({ hasText: /^前一生效版本$/ }).locator('..')).toContainText(next.releaseId)
  await expect(page.locator('dt').filter({ hasText: /^回滾目標$/ }).locator('..')).toContainText(stableRelease)
  await expect(page.locator('.delivery-audit')).toContainText('user-rd-commerce')
  expect(await browserApi(page, { path: `/environments/${environmentId}` })).toMatchObject({ status: 200, payload: { data: { environment: { activeReleaseId: rollbackId } } } })
  await page.reload()
  await expect(page.getByRole('region', { name: '目前生效版本' })).toContainText(rollbackId)
  await page.screenshot({ path: info.outputPath('m3-staging-rollback.png'), fullPage: true })
})

for (const failure of ['build', 'health'] as const) {
  test(`AC-14: ${failure} failure leaves active unchanged and retry creates a new run with retained history`, async ({ page }) => {
    await page.goto('rd')
    const stable = await publish(page, 'failure-baseline')
    const failedRun = await trigger(page, `${failure}-failure-candidate`)
    await page.getByRole('button', { name: failure === 'build' ? '模擬建置失敗' : '模擬健康檢查失敗', exact: true }).click()
    await expect(page.locator('.delivery-demo .command-notice')).toContainText(`${failure}-failure`)
    await advance(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${failedRun} · 失敗`)
    await page.getByRole('button', { name: failure === 'build' ? /^建置 build/ : /^健康檢查 verify/ }).click()
    await expect(page.locator('.delivery-logs .delivery-log-error')).toBeVisible()
    if (failure === 'build') await expect(page.getByText('封裝尚未成功，沒有產物或發布紀錄。')).toBeVisible()
    else {
      await openRelease(page)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('失敗')
      await expect(page.getByRole('region', { name: '目前生效版本' })).toContainText(stable.releaseId)
      await page.goto(`rd/pipelines/${failedRun}`)
    }
    expect(await browserApi(page, { path: '/environments/env-checkout-dev' })).toMatchObject({ status: 200, payload: { data: { environment: { activeReleaseId: stable.releaseId } } } })
    await reasonAction(page, '重試 Pipeline', '故障已排除，重跑相同來源版本')
    const retryId = new URL(page.url()).pathname.split('/').at(-1)!
    expect(retryId).not.toBe(failedRun)
    await expect(page.locator('dt').filter({ hasText: /^重試來源$/ }).locator('..')).toContainText(failedRun)
    await advance(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${retryId} · 成功`)
    await page.goto(`rd/pipelines/${failedRun}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${failedRun} · 失敗`)
  })
}

test('AC-15: prod pauses; dual-role initiator cannot self-approve; another Ops approves with distinct actor evidence', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('rd')
  await become(page, 'user-admin')
  await page.goto('admin/access')
  await page.getByRole('combobox', { name: '使用者', exact: true }).selectOption('user-rd-commerce')
  await page.getByRole('combobox', { name: '角色', exact: true }).selectOption('ops')
  await page.getByLabel('Scope ID').fill('project-store')
  await page.getByLabel('理由', { exact: true }).fill('驗證同一人不能自批正式發布')
  await page.getByRole('button', { name: '新增授權', exact: true }).click()
  await expect(page.getByRole('row', { name: /user-rd-commerce.*Ops.*project.*project-store/ })).toBeVisible()
  health.get(page)!.expectedStatuses.add(403)
  expect(await browserApi(page, { path: '/pipelines', persona: 'user-admin', body: { applicationId: 'app-checkout', environmentId: 'env-checkout-prod', environmentVersion: 1, revision: 'admin-must-not-deploy' } })).toMatchObject({ status: 403 })
  await become(page, 'user-rd-commerce')
  const runId = await trigger(page, 'prod-approved', 'env-checkout-prod')
  await advance(page, 3)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${runId} · 等待正式環境核准`)
  const releaseId = await openRelease(page)
  await expect(page.getByRole('button', { name: '核准發布', exact: true })).toBeDisabled()
  await expect(page.getByText('發起人不能核准自己的正式環境發布，請切換另一位授權 Ops。')).toBeVisible()
  const candidate = await browserApi(page, { path: `/releases/${releaseId}` })
  expect(candidate.status).toBe(200)
  const candidateVersion = (candidate.payload as { data: { release: { version: number } } }).data.release.version
  expect(await browserApi(page, { path: `/releases/${releaseId}/approve`, body: { expectedVersion: candidateVersion, reason: '發起人不能繞過 UI 自批' } })).toMatchObject({ status: 403 })
  await advance(page, 3)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${releaseId} · 待核准`)
  await become(page, 'user-ops')
  await page.goto('ops/releases?state=pending_approval')
  await page.getByRole('link', { name: releaseId, exact: true }).click()
  await reasonAction(page, '核准發布', '已確認正式環境變更與產物')
  await advance(page, 3)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${releaseId} · 成功`)
  await expect(page.locator('dt').filter({ hasText: /^發起人$/ }).locator('..')).toContainText('user-rd-commerce')
  await expect(page.locator('dt').filter({ hasText: /^核准者$/ }).locator('..')).toContainText('user-ops')
  await expect(page.locator('.delivery-audit')).toContainText('user-ops')
})

test('AC-16: environment busy is visible, pre-deploy cancellation releases it, deploying cancellation is disabled', async ({ page }) => {
  await page.goto('rd')
  const runId = await trigger(page, 'busy-holder')
  await page.goto('rd/pipelines')
  await page.getByRole('button', { name: '觸發 Pipeline', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '觸發 Pipeline' })
  await dialog.getByLabel('發布應用').selectOption('app-checkout')
  await dialog.getByLabel('發布環境').selectOption('env-checkout-dev')
  await dialog.getByLabel('來源版本').fill('busy-conflicting-run')
  health.get(page)!.expectedStatuses.add(409)
  await dialog.getByRole('button', { name: '確認觸發' }).click()
  await expect(dialog.getByRole('alert')).toContainText('ENVIRONMENT_BUSY')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.goto(`rd/pipelines/${runId}`)
  await reasonAction(page, '取消 Pipeline', '重新確認版本後再執行')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${runId} · 已取消`)
  await reasonAction(page, '重試 Pipeline', '環境鎖已釋放，重新執行')
  const retried = new URL(page.url()).pathname.split('/').at(-1)!
  await advance(page, 3)
  await advance(page, 1)
  await expect(page.getByRole('button', { name: '取消 Pipeline', exact: true })).toBeDisabled()
  await expect(page.getByText('部署或健康檢查已開始，不能取消。')).toBeVisible()
  await advance(page, 3)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${retried} · 成功`)
})

test('AC-15/16: rejection and cancellation while awaiting prod approval retain no active and unlock the environment', async ({ page }) => {
  await page.goto('rd')
  const rejectedRun = await trigger(page, 'prod-rejected', 'env-checkout-prod')
  await advance(page, 3)
  const rejectedRelease = await openRelease(page)
  await become(page, 'user-ops')
  await page.goto(`ops/releases/${rejectedRelease}`)
  await reasonAction(page, '拒絕發布', '缺少正式環境變更確認')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${rejectedRelease} · 已拒絕`)
  await become(page, 'user-rd-commerce')
  await page.goto(`rd/pipelines/${rejectedRun}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${rejectedRun} · 失敗`)
  const cancelledRun = await trigger(page, 'prod-cancelled', 'env-checkout-prod')
  await advance(page, 3)
  await reasonAction(page, '取消 Pipeline', '發起人撤回待審候選版本')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${cancelledRun} · 已取消`)
  const cancelledRelease = await openRelease(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${cancelledRelease} · 已取消`)
  await advance(page)
  await expect(page.getByRole('region', { name: '目前生效版本' })).toContainText('這個環境尚無生效版本。')
  await trigger(page, 'prod-after-unlock', 'env-checkout-prod')
})

test('AC-24: rollback failure retains current active; recovery creates another rollback release', async ({ page }) => {
  await page.goto('rd')
  const stable = await publish(page, 'rollback-stable')
  const next = await publish(page, 'rollback-next')
  const failedId = await rollback(page, stable.releaseId, '驗證回滾失敗不會切換 active')
  await page.getByRole('button', { name: '模擬回滾失敗', exact: true }).click()
  await expect(page.locator('.delivery-demo .command-notice')).toContainText('rollback-failure')
  await advance(page, 3)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${failedId} · 失敗`)
  await expect(page.getByRole('region', { name: '目前生效版本' })).toContainText(next.releaseId)
  await page.getByRole('region', { name: '目前生效版本' }).getByRole('link', { name: next.releaseId, exact: true }).click()
  const recoveryId = await rollback(page, stable.releaseId, '回滾問題已排除，再次嘗試')
  expect(recoveryId).not.toBe(failedId)
  await advance(page, 3)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${recoveryId} · 成功`)
  await page.goto(`rd/releases/${failedId}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${failedId} · 失敗`)
})

test('AC-20: another project receives empty lists and 404 delivery details without source or artifact disclosure', async ({ page }) => {
  await page.goto('rd')
  const delivered = await publish(page, 'commerce-private-revision')
  await become(page, 'user-rd-data')
  await page.goto('rd/pipelines')
  await expect(page.getByRole('heading', { name: '目前沒有符合條件的 Pipeline' })).toBeVisible()
  await expect(page.locator('main')).not.toContainText('commerce-private-revision')
  health.get(page)!.expectedStatuses.add(404)
  await page.goto(`rd/pipelines/${delivered.runId}`)
  await expect(page.getByRole('heading', { name: '找不到這個Pipeline' })).toBeVisible()
  await expect(page.locator('main')).not.toContainText('commerce-private-revision')
  await page.goto(`rd/releases/${delivered.releaseId}`)
  await expect(page.getByRole('heading', { name: '找不到這個發布' })).toBeVisible()
  await expect(page.locator('main')).not.toContainText('commerce-private-revision')
})

test('M3 delivery pages wrap at 390/768/1440; dialog contains focus, Escape returns it, and axe has no serious/critical findings', async ({ page }, info) => {
  test.setTimeout(60_000)
  await page.goto('rd')
  const delivered = await publish(page, 'responsive-release')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題' }).click()
      }
      for (const route of [`rd/pipelines/${delivered.runId}`, `rd/releases/${delivered.releaseId}`, 'rd/pipelines']) {
        await page.goto(route)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expect(page.locator('.delivery-page')).toBeVisible()
        const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
        expect(size.content, `${route} ${theme} ${viewport.width}`).toBeLessThanOrEqual(size.viewport)
        const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((entry) => ['serious', 'critical'].includes(entry.impact ?? ''))
        expect(violations, `${route} ${theme} ${viewport.width}`).toEqual([])
        const name = `${route.replaceAll('/', '-')}-${theme}-${viewport.width}`
        await info.attach(name, { body: JSON.stringify({ route, theme, viewport, size, violations }), contentType: 'application/json' })
        await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true })
      }
    }
    const opener = page.getByRole('button', { name: '觸發 Pipeline', exact: true })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: '觸發 Pipeline' })
    await expect(dialog.getByLabel('發布應用')).toBeVisible()
    // Observe initial focus before any keyboard input; do not repair it in the test.
    await expect(dialog.getByRole('button', { name: '關閉對話框' })).toBeFocused()
    await info.attach(`initial-focus-${viewport.width}`, { body: await page.evaluate(() => document.activeElement?.outerHTML ?? ''), contentType: 'text/html' })
    for (let index = 0; index < 10; index++) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    }
    const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((entry) => ['serious', 'critical'].includes(entry.impact ?? ''))
    expect(violations).toEqual([])
    await page.screenshot({ path: info.outputPath(`m3-dialog-${viewport.width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  }
  await become(page, 'user-ops')
  await page.goto('ops/releases')
  await expect(page.getByRole('table')).toContainText(delivered.releaseId)
  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((entry) => ['serious', 'critical'].includes(entry.impact ?? ''))
  expect(violations).toEqual([])
})


// Read persisted evidence only. All mutations below use actual product controls.
async function savedSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('dim-gate.demo.v1')!).snapshot as Snapshot)
}

async function expectClockPaused(page: Page) {
  const before = await savedSnapshot(page)
  // A real interval longer than the playback period catches surviving timers.
  await page.waitForTimeout(1700)
  const after = await savedSnapshot(page)
  expect(after.logicalClock).toBe(before.logicalClock)
  expect(after.entities.pipelines).toEqual(before.entities.pipelines)
  expect(after.scheduler).toEqual(before.scheduler)
  return after
}

test('M3 playback: start, pause, manual step, resume and terminal stop persist real one-tick progression', async ({ page }, info) => {
  await page.goto('rd')
  const runId = await trigger(page, 'playback-lifecycle')
  const clocks: { at: number; ticks: unknown }[] = []
  let pending = 0
  let maxPending = 0
  page.on('request', (request) => {
    if (!request.url().endsWith('/clock/advance')) return
    clocks.push({ at: Date.now(), ticks: request.postDataJSON().ticks })
    pending += 1
    maxPending = Math.max(maxPending, pending)
  })
  page.on('requestfinished', (request) => { if (request.url().endsWith('/clock/advance')) pending -= 1 })
  await page.getByRole('button', { name: '啟動模擬播放' }).click()
  await expect(page.getByRole('button', { name: '前進模擬時鐘', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: /^建置 build · 成功$/ })).toBeVisible()
  await page.getByRole('button', { name: '暫停模擬播放' }).click()
  await expect(page.getByRole('button', { name: '啟動模擬播放' })).toBeEnabled()
  const paused = await expectClockPaused(page)
  expect(paused.logicalClock).toBe(1)
  await advance(page, 1)
  expect((await savedSnapshot(page)).logicalClock).toBe(2)
  await page.getByRole('button', { name: '啟動模擬播放' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${runId} · 成功`, { timeout: 15_000 })
  await expect(page.getByRole('button', { name: '啟動模擬播放' })).toBeDisabled()
  const terminal = await expectClockPaused(page)
  expect(terminal.logicalClock).toBe(6)
  expect(clocks.map((entry) => entry.ticks)).toEqual([1, 1, 1, 1, 1, 1])
  expect(maxPending).toBe(1)
  // The last four requests are automatic; their spacing includes the one-second wait.
  for (let index = 3; index < clocks.length; index++) expect(clocks[index].at - clocks[index - 1].at).toBeGreaterThanOrEqual(950)
  await info.attach('playback-timing', { body: JSON.stringify({ clocks, maxPending, clock: terminal.logicalClock }), contentType: 'application/json' })
})

test('M3 playback: reload pauses persisted work without offline catch-up; explicit resume finishes it', async ({ page }) => {
  await page.goto('rd')
  const runId = await trigger(page, 'playback-reload')
  await page.getByRole('button', { name: '啟動模擬播放' }).click()
  await expect(page.getByRole('button', { name: /^建置 build · 成功$/ })).toBeVisible()
  // Allow the first tick's reads to finish before intentionally navigating away.
  await page.waitForTimeout(350)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${runId} · 執行中`)
  await expect(page.getByRole('button', { name: '啟動模擬播放' })).toBeEnabled()
  const paused = await expectClockPaused(page)
  expect(paused.logicalClock).toBe(1)
  expect(paused.scheduler.tasks[0].stepIndex).toBe(1)
  await page.getByRole('button', { name: '啟動模擬播放' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${runId} · 成功`, { timeout: 15_000 })
})

for (const boundary of ['route', 'persona', 'reset'] as const) {
  test(`M3 playback: ${boundary} boundary cleans up pending timers`, async ({ page }) => {
    await page.goto('rd')
    const runId = await trigger(page, `playback-${boundary}`)
    await page.getByRole('button', { name: '啟動模擬播放' }).click()
    if (boundary === 'persona') {
      await become(page, 'user-rd-data')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectClockPaused(page)
      await become(page, 'user-rd-commerce')
    } else if (boundary === 'route') {
      await page.getByRole('link', { name: 'Pipeline 清單', exact: true }).click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pipeline 執行紀錄')
      await expectClockPaused(page)
    } else {
      await page.getByRole('link', { name: 'Session 控制' }).click()
      await page.getByRole('button', { name: '重置示範', exact: true }).click()
      await page.getByRole('button', { name: '確認重置示範', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      const reset = await expectClockPaused(page)
      expect(reset.logicalClock).toBe(0)
      expect(reset.entities.pipelines).toEqual([])
      expect(reset.scheduler.tasks).toEqual([])
      return
    }
    await page.goto(`rd/pipelines/${runId}`)
    await expect(page.getByRole('button', { name: '啟動模擬播放' })).toBeEnabled()
    await expectClockPaused(page)
  })
}

test('M3 playback: prod approval stops automatic ticks until another Ops approves and explicitly resumes', async ({ page }) => {
  await page.goto('rd')
  const runId = await trigger(page, 'playback-prod', 'env-checkout-prod')
  await page.getByRole('button', { name: '啟動模擬播放' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${runId} · 等待正式環境核准`, { timeout: 10_000 })
  await expect(page.getByRole('button', { name: '啟動模擬播放' })).toBeDisabled()
  expect((await expectClockPaused(page)).logicalClock).toBe(3)
  const releaseId = await openRelease(page)
  await become(page, 'user-ops')
  await page.goto(`ops/releases/${releaseId}`)
  await reasonAction(page, '核准發布', '確認播放在人工批准前保持暫停')
  await expectClockPaused(page)
  await page.getByRole('button', { name: '啟動模擬播放' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${releaseId} · 成功`, { timeout: 10_000 })
})

test('AC-20: Commerce clock receipt and audit do not disclose a progressed Data pipeline', async ({ page }, info) => {
  await page.goto('rd')
  await become(page, 'user-rd-data')
  const runId = await trigger(page, 'data-private-clock-revision', 'env-data-dev', 'app-data')
  await become(page, 'user-rd-commerce')
  await page.getByRole('link', { name: 'Session 控制' }).click()
  await page.getByLabel('前進幅度').selectOption('5')
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/clock/advance'))
  await page.getByRole('button', { name: '前進演示時鐘' }).click()
  const response = await responsePromise
  const receipt = await response.json()
  await expect(page.locator('.command-notice')).toContainText('演示時鐘已前進 5 個 tick')
  const snapshot = await savedSnapshot(page)
  const hidden = snapshot.entities.pipelines.find((run) => run.id === runId)!
  expect(hidden.releaseId).toBeTruthy()
  expect(receipt.data.changed).toEqual([{ entityType: 'demoSession', entityId: snapshot.sessionId }])
  const pipelines = await browserApi(page, { path: '/pipelines' })
  const releases = await browserApi(page, { path: '/releases' })
  const audit = await browserApi(page, { path: '/audit?pageSize=100' })
  expect(pipelines).toMatchObject({ status: 200, payload: { data: { items: [], total: 0 } } })
  expect(releases).toMatchObject({ status: 200, payload: { data: { items: [], total: 0 } } })
  const visible = JSON.stringify({ receipt, pipelines, releases, audit, dom: await page.locator('main').innerText() })
  for (const secret of [runId, hidden.releaseId!, hidden.artifactDigest!, hidden.revision]) expect(visible).not.toContain(secret)
  await info.attach('scope-isolation', { body: JSON.stringify({ receipt, pipelines, releases, audit }, null, 2), contentType: 'application/json' })
  await become(page, 'user-rd-data')
  await page.goto(`rd/pipelines/${runId}`)
  await expect(page.locator('dt').filter({ hasText: /^候選發布$/ }).locator('..')).toContainText(hidden.releaseId!)
})

import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function become(page: Page, persona: string) {
  const selector = page.getByRole('combobox', { name: '示範身分' })
  await expect(selector).toBeVisible()
  if (await selector.inputValue() !== persona) await selector.selectOption(persona)
  await expect(selector).toHaveValue(persona)
}

async function createSubmittedRequest(page: Page, name: string, provider: 'aws' | 'aliyun' | 'onprem' = 'aws') {
  await page.goto('rd/catalog')
  await expect(page.getByRole('heading', { name: '服務目錄' })).toBeVisible()
  await page.getByRole('link', { name: '開始申請' }).click()
  await page.getByRole('combobox', { name: '應用', exact: true }).selectOption('app-checkout')
  await page.getByRole('textbox', { name: '環境名稱', exact: true }).fill(name)
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption(provider)
  await page.getByRole('textbox', { name: '用途', exact: true }).fill(`Playwright ${provider} self-service validation`)
  await page.getByRole('button', { name: '確認並提交申請' }).click()
  await expect(page.getByRole('heading', { name: new RegExp(`${name} · 待審核`) })).toBeVisible()
  return new URL(page.url()).pathname.split('/').at(-1)!
}

async function advance(page: Page, ticks: '5') {
  await page.goto('guide')
  await page.getByLabel('前進幅度').selectOption(ticks)
  await page.getByRole('button', { name: '前進演示時鐘' }).click()
  await expect(page.locator('.command-notice')).toContainText(`演示時鐘已前進 ${ticks} 個 tick`)
}

async function browserApi(page: Page, input: { persona: string; path: string; method?: string; body?: unknown; key?: string }) {
  return page.evaluate(async ({ persona, path, method = 'GET', body, key }) => {
    const saved = JSON.parse(sessionStorage.getItem('dim-gate.demo.v1')!) as { snapshot: { sessionId: string } }
    const response = await fetch(`/dim-gate/api/v1${path}`, { method, headers: {
      Accept: 'application/json', 'X-Demo-Session': saved.snapshot.sessionId, 'X-Demo-Persona': persona,
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key! }),
    }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, payload: await response.json() }
  }, input)
}

test('AC-09: RD submit → Ops approve/provision → ready environment, canonical CI, job logs, and capacity used', async ({ page }) => {
  const consoleErrors: string[] = [], pageErrors: string[] = [], failedRequests: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`))

  await page.goto('rd')
  const requestId = await createSubmittedRequest(page, 'e2e-aws-staging')
  const correlation = await page.locator('dt', { hasText: 'Correlation' }).locator('..').locator('code').textContent()

  await become(page, 'user-ops')
  await page.goto(`ops/requests/${requestId}`)
  await page.getByRole('button', { name: '核准並保留容量' }).click()
  await expect(page.getByRole('heading', { name: /e2e-aws-staging · 已核准/ })).toBeVisible()
  const environmentId = (await page.locator('dt', { hasText: 'Environment ID' }).locator('..').locator('code').textContent())!

  await page.goto('ops/capacity')
  const awsPool = page.locator('article', { hasText: 'pool-aws-sg' })
  await expect(awsPool).toContainText('2 reserved')
  await expect(awsPool).toContainText('2048 reserved')

  await page.goto(`ops/requests/${requestId}`)
  await page.getByRole('button', { name: '啟動交付' }).click()
  await expect(page.getByRole('heading', { name: /e2e-aws-staging · 交付中/ })).toBeVisible()
  const jobLink = page.getByRole('link', { name: /job-/ }).last()
  const jobId = (await jobLink.textContent())!
  const plannedCi = (await page.getByRole('row', { name: new RegExp(jobId) }).locator('code').textContent())!

  await advance(page, '5')
  await page.goto(`ops/requests/${requestId}`)
  await expect(page.getByRole('heading', { name: /e2e-aws-staging · 已完成/ })).toBeVisible()
  await expect(page.locator('dt', { hasText: 'Correlation' }).locator('..')).toContainText(correlation!)
  await page.goto(`ops/jobs/${jobId}`)
  await expect(page.getByRole('heading', { name: new RegExp(`${jobId} · 成功`) })).toBeVisible()
  await expect(page.locator('.job-logs')).toContainText('verify')

  await page.goto('ops/capacity')
  await expect(awsPool).toContainText('0 reserved')
  await become(page, 'user-rd-commerce')
  await page.goto(`rd/apps/app-checkout/environments/${environmentId}`)
  await expect(page.getByRole('heading', { name: 'e2e-aws-staging 環境' })).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(plannedCi) })).toContainText(plannedCi)

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
  expect(failedRequests).toEqual([])
})

test('AC-12: configure failure releases capacity and retry preserves environment/CI identity with attempt + 1', async ({ page }) => {
  await page.goto('rd')
  const requestId = await createSubmittedRequest(page, 'e2e-aliyun-retry', 'aliyun')
  await become(page, 'user-ops')
  await page.goto(`ops/requests/${requestId}`)
  await page.getByRole('button', { name: '核准並保留容量' }).click()
  const environmentId = (await page.locator('dt', { hasText: 'Environment ID' }).locator('..').locator('code').textContent())!
  await page.getByRole('button', { name: '啟動交付' }).click()
  await expect(page.getByRole('heading', { name: /e2e-aliyun-retry · 交付中/ })).toBeVisible()
  const firstJob = (await page.getByRole('link', { name: /job-/ }).last().textContent())!
  const firstCi = (await page.getByRole('row', { name: new RegExp(firstJob) }).locator('code').textContent())!

  await page.goto(`ops/jobs/${firstJob}`)
  await page.getByRole('button', { name: '在 configure 階段注入失敗' }).click()
  await expect(page.locator('.command-notice')).toContainText('已為這次 job 設定 configure 階段失敗')
  await advance(page, '5')
  await page.goto(`ops/requests/${requestId}`)
  await expect(page.getByRole('heading', { name: /e2e-aliyun-retry · 交付失敗/ })).toBeVisible()
  await page.goto('ops/capacity')
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('aliyun')
  await expect(page.locator('article', { hasText: 'pool-aliyun-sg' })).toContainText('0 reserved')

  await become(page, 'user-rd-commerce')
  await page.goto(`rd/requests/${requestId}`)
  await page.getByLabel('操作理由').fill('failure diagnosed; retry same identities')
  await page.getByRole('button', { name: '建立重試作業' }).click()
  await expect(page.getByRole('heading', { name: /e2e-aliyun-retry · 已核准/ })).toBeVisible()
  await expect(page.locator('dt', { hasText: 'Environment ID' }).locator('..')).toContainText(environmentId)

  await become(page, 'user-ops')
  await page.goto(`ops/requests/${requestId}`)
  const rows = page.getByRole('table').getByRole('row')
  await expect(rows).toHaveCount(3)
  const secondJobRow = rows.nth(2)
  await expect(secondJobRow).toContainText('2')
  await expect(secondJobRow).toContainText(firstCi)
  const secondJob = (await secondJobRow.getByRole('link', { name: /job-/ }).textContent())!
  expect(secondJob).not.toBe(firstJob)
  await page.getByRole('button', { name: '啟動交付' }).click()
  await expect(page.getByRole('heading', { name: /e2e-aliyun-retry · 交付中/ })).toBeVisible()
  await advance(page, '5')
  await page.goto(`ops/requests/${requestId}`)
  await expect(page.getByRole('heading', { name: /e2e-aliyun-retry · 已完成/ })).toBeVisible()
  await expect(page.getByRole('table')).toContainText(firstCi)
})

test('AC-09: on-prem request completes through the visible product flow', async ({ page }) => {
  await page.goto('rd')
  const requestId = await createSubmittedRequest(page, 'e2e-onprem-ready', 'onprem')
  await become(page, 'user-ops')
  await page.goto(`ops/requests/${requestId}`)
  await expect(page.locator('dt', { hasText: 'Provider / pool' }).locator('..')).toContainText('On-prem IDC')
  await page.getByRole('button', { name: '核准並保留容量' }).click()
  const environmentId = (await page.locator('dt', { hasText: 'Environment ID' }).locator('..').locator('code').textContent())!
  await page.getByRole('button', { name: '啟動交付' }).click()
  await expect(page.getByRole('heading', { name: /e2e-onprem-ready · 交付中/ })).toBeVisible()
  await advance(page, '5')
  await page.goto(`ops/requests/${requestId}`)
  await expect(page.getByRole('heading', { name: /e2e-onprem-ready · 已完成/ })).toBeVisible()
  await become(page, 'user-rd-commerce')
  await page.goto(`rd/apps/app-checkout/environments/${environmentId}`)
  await expect(page.getByRole('heading', { name: 'e2e-onprem-ready 環境' })).toBeVisible()
  const plannedCi = (await page.getByRole('table').locator('code').textContent())!
  await expect(page.getByRole('table')).toContainText(plannedCi)
  await become(page, 'user-ops')
  await page.goto(`ops/cmdb/${plannedCi}`)
  await expect(page.locator('dt', { hasText: 'Provider' }).locator('..')).toContainText('On-premises')
  await expect(page.locator('dt', { hasText: 'Account' }).locator('..')).toContainText('不適用（on-prem）')
})

test('AC-10: reject creates no environment; approved cancel releases capacity; invalid transition is atomic', async ({ page }) => {
  await page.goto('rd')
  const rejectedId = await createSubmittedRequest(page, 'e2e-rejected')
  await become(page, 'user-ops')
  await page.goto(`ops/requests/${rejectedId}`)
  await page.getByLabel('操作理由').fill('Rejected by browser acceptance journey')
  await page.getByRole('button', { name: '拒絕申請' }).click()
  await expect(page.getByRole('heading', { name: /e2e-rejected · 已拒絕/ })).toBeVisible()
  await expect(page.locator('dt', { hasText: 'Environment ID' }).locator('..')).toContainText('尚未配置')
  await become(page, 'user-rd-commerce')
  await page.goto(`rd/requests/${rejectedId}`)
  await expect(page.getByRole('heading', { name: /e2e-rejected · 已拒絕/ })).toBeVisible()

  const cancelledId = await createSubmittedRequest(page, 'e2e-approved-cancel')
  await become(page, 'user-ops')
  await page.goto(`ops/requests/${cancelledId}`)
  await page.getByRole('button', { name: '核准並保留容量' }).click()
  await expect(page.getByRole('heading', { name: /e2e-approved-cancel · 已核准/ })).toBeVisible()
  await page.goto('ops/capacity')
  await expect(page.locator('article', { hasText: 'pool-aws-sg' })).toContainText('2 reserved')
  await become(page, 'user-rd-commerce')
  await page.goto(`rd/requests/${cancelledId}`)
  await page.getByLabel('操作理由').fill('Requester cancelled after approval')
  await page.getByRole('button', { name: '撤回申請' }).click()
  await expect(page.getByRole('heading', { name: /e2e-approved-cancel · 已撤回/ })).toBeVisible()
  const invalid = await browserApi(page, { persona: 'user-rd-commerce', path: `/requests/${cancelledId}/cancel`, method: 'POST',
    body: { expectedVersion: 4, reason: 'Must remain cancelled' }, key: 'e2e-invalid-cancel-transition' })
  expect(invalid).toMatchObject({ status: 409, payload: { error: { code: 'INVALID_STATE' } } })
  await page.reload()
  await expect(page.getByRole('heading', { name: /e2e-approved-cancel · 已撤回/ })).toBeVisible()
  await become(page, 'user-ops')
  await page.goto('ops/capacity')
  await expect(page.locator('article', { hasText: 'pool-aws-sg' })).toContainText('0 reserved')
})

test('AC-09 security boundary: Admin cannot list or read provisioning job logs', async ({ page }) => {
  await page.goto('rd')
  const requestId = await createSubmittedRequest(page, 'e2e-job-log-scope')
  await become(page, 'user-ops')
  await page.goto(`ops/requests/${requestId}`)
  await page.getByRole('button', { name: '核准並保留容量' }).click()
  await expect(page.getByRole('heading', { name: /e2e-job-log-scope · 已核准/ })).toBeVisible()
  const jobId = (await page.getByRole('link', { name: /job-/ }).last().textContent())!
  await become(page, 'user-admin')
  const list = await browserApi(page, { persona: 'user-admin', path: '/jobs' })
  expect(list).toMatchObject({ status: 200, payload: { data: { total: 0, items: [] } } })
  const detail = await browserApi(page, { persona: 'user-admin', path: `/jobs/${jobId}` })
  expect(detail).toMatchObject({ status: 404, payload: { error: { code: 'NOT_FOUND' } } })
  await become(page, 'user-ops')
  await page.goto(`ops/jobs/${jobId}`)
  await expect(page.getByRole('heading', { name: new RegExp(jobId) })).toBeVisible()
})

test('AC-09: planned canonical CI identity cannot be taken by manual onboarding', async ({ page }) => {
  await page.goto('rd')
  const requestId = await createSubmittedRequest(page, 'e2e-reserved-identity')
  await become(page, 'user-ops')
  await page.goto(`ops/requests/${requestId}`)
  await page.getByRole('button', { name: '核准並保留容量' }).click()
  await expect(page.getByRole('heading', { name: /e2e-reserved-identity · 已核准/ })).toBeVisible()
  const plannedCi = (await page.getByRole('table').locator('code').last().textContent())!

  await page.goto('ops/cmdb')
  await page.getByRole('button', { name: '手動納管 CI' }).click()
  const dialog = page.getByRole('dialog', { name: '手動納管配置項' })
  await dialog.getByLabel('名稱').fill('attempted planned identity takeover')
  await dialog.getByLabel('外部識別碼').fill(plannedCi)
  await dialog.getByRole('button', { name: '確認納管' }).click()
  await expect(dialog.getByRole('alert')).toContainText('相同 canonical identity 的 CI 已存在或已由交付作業保留。')
  await expect(dialog.getByRole('alert')).toContainText('DUPLICATE_RESOURCE')
  await dialog.getByRole('button', { name: '取消' }).click()

  await page.goto(`ops/requests/${requestId}`)
  await page.getByRole('button', { name: '啟動交付' }).click()
  await expect(page.getByRole('heading', { name: /e2e-reserved-identity · 交付中/ })).toBeVisible()
  await advance(page, '5')
  await page.goto(`ops/requests/${requestId}`)
  await expect(page.getByRole('heading', { name: /e2e-reserved-identity · 已完成/ })).toBeVisible()
  await expect(page.getByRole('table')).toContainText(plannedCi)
})

test('M2 self-service routes are responsive and have no serious/critical axe findings', async ({ page }, info) => {
  await page.goto('rd/catalog')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await expect(page.getByRole('heading', { name: '服務目錄' })).toBeVisible()
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width)
    const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))
    expect(violations).toEqual([])
    await page.screenshot({ path: info.outputPath(`m2-catalog-${viewport.width}.png`), fullPage: true })
  }
  await become(page, 'user-ops')
  for (const route of ['ops/requests', 'ops/jobs', 'ops/capacity']) {
    await page.goto(route)
    const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))
    expect(violations, route).toEqual([])
  }
})

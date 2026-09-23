import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function become(page: Page, id: string) {
  const picker = page.getByRole('combobox', { name: '示範身分', exact: true })
  await expect(picker).toBeEnabled()
  if (await picker.inputValue() !== id) await picker.selectOption(id)
  await expect(picker).toHaveValue(id)
  const center = id === 'user-admin' ? 'admin' : id === 'user-ops' ? 'ops' : 'rd'
  await expect(page.getByRole('region', { name: `${center} 工作首頁` })).toBeVisible()
}
async function grantOps(page: Page) {
  await become(page, 'user-admin')
  await page.goto('admin/access')
  await page.getByRole('combobox', { name: '使用者', exact: true }).selectOption('user-rd-commerce')
  for (const scope of ['pool-aws-sg', 'project-store']) {
    await page.getByRole('combobox', { name: '角色', exact: true }).selectOption('ops')
    await page.getByLabel('Scope ID', { exact: true }).fill(scope)
    await page.getByRole('button', { name: '新增授權', exact: true }).click()
    await expect(page.getByRole('row', { name: new RegExp(`user-rd-commerce.*Ops.*${scope}`) })).toBeVisible()
  }
  await page.goto('admin')
  await become(page, 'user-rd-commerce')
}
const snapshot = (page: Page) => page.evaluate(() => sessionStorage.getItem('dim-gate.demo.v1'))

// Success setup uses the visible Admin UI; snapshots are only observed, never written.
test('AC-WS-01: same user switches granted workspaces without changing domain or identity', async ({ page }, info) => {
  await page.goto('rd')
  const selector = page.getByRole('combobox', { name: '工作區', exact: true })
  await expect(selector).toBeVisible()
  await expect(selector.locator('option')).toHaveCount(1)
  await grantOps(page)
  await expect(selector.locator('option')).toHaveCount(2)
  await page.getByRole('combobox', { name: '首頁專案' }).selectOption('project-store')
  const before = await snapshot(page)
  await selector.selectOption('ops')
  await expect(page).toHaveURL(/ops\?projectId=project-store$/)
  await expect(page.getByRole('region', { name: 'ops 工作首頁' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '示範身分' })).toHaveValue('user-rd-commerce')
  await expect(page.getByRole('link', { name: '應用與環境', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'CMDB', exact: true })).toBeVisible()
  expect(await snapshot(page)).toBe(before)
  await page.reload()
  await expect(selector).toHaveValue('ops')
  await expect(page.getByRole('combobox', { name: '首頁專案' })).toHaveValue('project-store')
  expect(await snapshot(page)).toBe(before)
  await selector.selectOption('rd')
  await expect(page.getByRole('link', { name: 'CMDB', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toBeVisible()
  expect(await snapshot(page)).toBe(before)
  await info.attach('workspace-switch-snapshot-invariant.json', { contentType: 'application/json', body: JSON.stringify({ sameSerializedDomainAndIdentity: true, before, after: await snapshot(page) }) })
})

test('AC-WS-01/02: no-grant recovery and illegal workspace deep link do not grant access', async ({ page }) => {
  await page.goto('rd')
  await become(page, 'user-admin')
  await page.goto('admin/access')
  for (const scope of ['project-data', 'project-insights']) {
    const row = page.getByRole('row', { name: new RegExp(`user-rd-data.*RD.*${scope}`) })
    await row.getByRole('button', { name: '撤銷', exact: true }).click()
    await expect(row).toHaveCount(0)
  }
  await page.getByRole('combobox', { name: '示範身分' }).selectOption('user-rd-data')
  await expect(page.getByRole('heading', { name: '目前沒有已授權工作區' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '工作區', exact: true })).toBeDisabled()
  await expect(page.getByRole('link', { name: '示範控制台', exact: true })).toBeVisible()
  await page.goto('ops')
  await expect(page.getByRole('heading', { name: '目前身分無法進入維運中心' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'ops 工作首頁' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: '目前沒有已授權工作區' })).toBeVisible()
  await page.getByRole('combobox', { name: '示範身分' }).selectOption('user-rd-commerce')
  await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toBeVisible()
})

test('AC-WS-02: scope survives canonical drilldown, back and refresh; role projections stay distinct', async ({ page }, info) => {
  await page.goto('rd')
  await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toBeVisible()
  await page.getByRole('combobox', { name: '首頁專案' }).selectOption('project-store')
  await page.getByRole('combobox', { name: '首頁環境' }).selectOption('env-checkout-dev')
  const home = page.getByRole('region', { name: 'rd 工作首頁' })
  await expect(home.getByText('env-checkout-dev', { exact: true })).toBeVisible()
  await expect(home.getByText('env-data-dev', { exact: true })).toHaveCount(0)
  const target = home.getByRole('link').filter({ hasText: /checkout/ }).first()
  await target.click()
  await expect(page).toHaveURL(/rd\/apps\/app-checkout\/environments\/env-checkout-dev/)
  await page.goBack()
  await expect(page.getByRole('combobox', { name: '首頁環境' })).toHaveValue('env-checkout-dev')
  await page.reload()
  await expect(page.getByRole('combobox', { name: '首頁環境' })).toHaveValue('env-checkout-dev')
  await expect(home).toContainText('尚無觀測樣本')
  await become(page, 'user-ops')
  await page.getByRole('combobox', { name: '首頁來源' }).selectOption('aws')
  await page.getByRole('combobox', { name: '首頁資源池' }).selectOption('pool-aws-sg')
  await expect(page.getByRole('region', { name: 'ops 工作首頁' })).toContainText('pool-aws-sg')
  await become(page, 'user-admin')
  await expect(page.getByRole('region', { name: 'admin 工作首頁' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'admin 工作首頁' })).toContainText('目前沒有待發布的目錄草稿')
  await expect(page.getByRole('button', { name: /啟動交付|批准發布/ })).toHaveCount(0)
  await info.attach('scope-and-roles.txt', { body: 'RD canonical env → browser Back → deep refresh; Ops AWS pool; Admin actual config/metadata; no store writes.' })
})

test('AC-WS-17/18: new homes work by keyboard and across themes and viewport sizes', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = [], external: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1' && !request.url().startsWith('data:')) external.push(request.url()) })
  await page.goto('rd')
  await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toBeVisible()
  // Tab from document entry; never programmatically focus or click to bypass keyboard navigation.
  for (let i = 0; i < 45 && !await page.getByRole('combobox', { name: '工作區', exact: true }).evaluate(el => el === document.activeElement); i++) await page.keyboard.press('Tab')
  await expect(page.getByRole('combobox', { name: '工作區', exact: true })).toBeFocused()
  for (let i = 0; i < 25 && !await page.getByRole('combobox', { name: '示範身分' }).evaluate(el => el === document.activeElement); i++) await page.keyboard.press('Tab')
  await expect(page.getByRole('combobox', { name: '示範身分' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: '示範身分' })).toHaveValue('user-rd-data')
  for (const [id, center] of [['user-rd-commerce', 'rd'], ['user-ops', 'ops'], ['user-admin', 'admin']]) {
    await become(page, id)
    for (const theme of ['light', 'dark']) {
      const current = await page.locator('html').getAttribute('data-theme')
      if (current !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切換深色主題' : '切換淺色主題' }).click()
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
        await expect(page.getByRole('combobox', { name: '工作區', exact: true })).toBeVisible()
        await expect(page.getByRole('region', { name: `${center} 工作首頁` })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''))
        expect(violations).toEqual([])
        await page.screenshot({ path: info.outputPath(`${center}-${theme}-${width}.png`), fullPage: true })
      }
    }
  }
  expect(errors).toEqual([])
  expect(external).toEqual([])
  await info.attach('browser-health.json', { contentType: 'application/json', body: JSON.stringify({ errors, external }) })
})


test('AC-WS-01/17: W1 extra browser workspace switching and deep refresh', async ({ page }) => {
  await page.goto('rd')
  await grantOps(page)
  const before = await snapshot(page)
  await page.getByRole('combobox', { name: '工作區', exact: true }).selectOption('ops')
  await expect(page.getByRole('region', { name: 'ops 工作首頁' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('combobox', { name: '工作區', exact: true })).toHaveValue('ops')
  expect(await snapshot(page)).toBe(before)
  await page.getByRole('combobox', { name: '工作區', exact: true }).selectOption('rd')
  await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toBeVisible()
  await become(page, 'user-admin')
  await page.reload()
  await expect(page.getByRole('region', { name: 'admin 工作首頁' })).toBeVisible()
})

test('AC-WS-02/15: a real old dashboard response never enters the new persona home', async ({ page }, info) => {
  await page.goto('rd')
  await become(page, 'user-rd-data')
  await page.evaluate(() => {
    const state = { ready: false, status: 0, containsData: false, retired: false, leaks: [] as string[] }
    const original = window.fetch.bind(window)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    Object.assign(window, { w1OldHome: state, w1ReleaseHome: release })
    window.fetch = async (...args) => {
      const response = await original(...args)
      if (new URL(String(args[0])).pathname.endsWith('/api/v1/dashboard') && new Headers(args[1]?.headers).get('X-Demo-Persona') === 'user-rd-data') {
        state.status = response.status
        state.containsData = (await response.clone().text()).includes('env-data-dev')
        state.ready = true
        await gate
      }
      return response
    }
    document.addEventListener('change', event => {
      if (event.target instanceof HTMLSelectElement && event.target.getAttribute('aria-label') === '示範身分' && event.target.value === 'user-rd-commerce') state.retired = true
    }, { capture: true })
    new MutationObserver(() => {
      if (state.retired && document.querySelector('[aria-label="rd 工作首頁"]')?.textContent?.includes('env-data-dev')) state.leaks.push('env-data-dev')
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
  await page.getByRole('button', { name: '重新整理工作首頁' }).click()
  await page.waitForFunction(() => (window as unknown as { w1OldHome: { ready: boolean } }).w1OldHome.ready)
  await page.getByRole('combobox', { name: '示範身分' }).selectOption('user-rd-commerce')
  await expect(page.getByRole('combobox', { name: '示範身分' })).toHaveValue('user-rd-commerce')
  await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toBeVisible()
  await page.evaluate(() => { const target = window as unknown as { w1ReleaseHome: () => void; w1OldHome: { retired: boolean } }; target.w1OldHome.retired = true; target.w1ReleaseHome() })
  await page.getByRole('combobox', { name: '首頁專案' }).selectOption('project-store')
  await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toContainText('env-checkout-dev')
  await expect(page.getByRole('region', { name: 'rd 工作首頁' })).not.toContainText('env-data-dev')
  const evidence = await page.evaluate(() => (window as unknown as { w1OldHome: unknown }).w1OldHome)
  expect(evidence).toEqual({ ready: true, status: 200, containsData: true, retired: true, leaks: [] })
  await info.attach('real-retired-dashboard.json', { body: JSON.stringify(evidence), contentType: 'application/json' })
})


test('AC-WS-02: failed home read exposes error and manual retry without fabricating counters', async ({ page }) => {
  await page.goto('rd')
  await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toBeVisible()
  const before = await snapshot(page)
  await page.evaluate(() => {
    const original = window.fetch.bind(window)
    Object.assign(window, { w1RestoreFetch: () => { window.fetch = original } })
    window.fetch = async (...args) => new URL(String(args[0])).pathname.endsWith('/api/v1/dashboard')
      ? new Response(JSON.stringify({ error: { code: 'SIMULATED_UNAVAILABLE', message: '首頁資料暫時無法讀取。', retryable: true }, meta: { requestId: 'w1-read-failure' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      : original(...args)
  })
  await page.getByRole('button', { name: '重新整理工作首頁' }).click()
  await expect(page.getByRole('alert')).toContainText('首頁資料暫時無法讀取')
  await expect(page.getByText('w1-read-failure', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toHaveCount(0)
  expect(await snapshot(page)).toBe(before)
  await page.evaluate(() => (window as unknown as { w1RestoreFetch: () => void }).w1RestoreFetch())
  await page.getByRole('button', { name: '重新讀取' }).click()
  await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toBeVisible()
  expect(await snapshot(page)).toBe(before)
})

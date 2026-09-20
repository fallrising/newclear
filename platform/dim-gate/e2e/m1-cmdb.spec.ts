import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function become(page: Page, persona: string) {
  await page.goto('./')
  const selector = page.getByRole('combobox', { name: '示範身分' })
  await expect(selector).toBeVisible()
  await selector.selectOption(persona)
  await expect(selector).toHaveValue(persona)
}

async function becomeOps(page: Page) {
  await become(page, 'user-ops')
  await expect(page.getByRole('link', { name: 'CMDB', exact: true })).toBeVisible()
}

test('AC-04/05: Ops sees 60 CIs, filters providers, onboards once, rejects duplicates, and edits metadata only', async ({ page }) => {
  await becomeOps(page)
  await page.getByRole('link', { name: 'CMDB', exact: true }).click()
  await expect(page.getByRole('heading', { name: '配置項資源清單' })).toBeVisible()
  const counts = page.getByRole('region', { name: 'Provider 可見數量' })
  await expect(counts).toContainText('60筆')
  await expect(counts).toContainText('AWS20筆')
  await expect(counts).toContainText('Aliyun20筆')
  await expect(counts).toContainText('On-premises20筆')

  await page.getByRole('combobox', { name: /Provider/ }).selectOption('aws')
  await expect(page.locator('caption')).toContainText('共 20 筆')
  await page.getByRole('button', { name: '清除篩選' }).click()

  await page.getByRole('button', { name: '手動納管 CI' }).click()
  let dialog = page.getByRole('dialog', { name: '手動納管配置項' })
  await dialog.getByLabel('名稱').fill('e2e-managed-compute')
  await dialog.getByLabel('外部識別碼').fill('e2e-managed-001')
  await dialog.getByRole('button', { name: '確認納管' }).click()
  await expect(dialog).toHaveCount(0)
  const created = page.getByRole('link', { name: /ci-manual-/ })
  await expect(created).toBeVisible()
  await expect(counts).toContainText('61筆')
  await expect(counts).toContainText('AWS21筆')

  const createdHref = await created.getAttribute('href')
  await created.click()
  await expect(page.getByRole('heading', { name: 'e2e-managed-compute' })).toBeVisible()
  await expect(page.getByText('account-aws-demo', { exact: true })).toBeVisible()
  await expect(page.getByText('location-aws-sg', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '編輯 metadata' }).click()
  dialog = page.getByRole('dialog', { name: '編輯 CI metadata' })
  await expect(dialog.getByText('Canonical identity 已鎖定')).toBeVisible()
  await dialog.getByLabel('名稱').fill('e2e-managed-renamed')
  await dialog.getByRole('button', { name: '儲存 metadata' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'e2e-managed-renamed' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(createdHref)

  await page.getByRole('link', { name: /返回 CMDB/ }).click()
  await page.getByRole('button', { name: '手動納管 CI' }).click()
  dialog = page.getByRole('dialog', { name: '手動納管配置項' })
  await dialog.getByLabel('名稱').fill('duplicate-attempt')
  await dialog.getByLabel('外部識別碼').fill('e2e-managed-001')
  await dialog.getByRole('button', { name: '確認納管' }).click()
  await expect(dialog.getByText('無法納管：canonical identity 衝突')).toBeVisible()
  await dialog.getByRole("button", { name: "關閉對話框" }).click()
  await page.getByRole("button", { name: "手動納管 CI" }).click()
  dialog = page.getByRole("dialog", { name: "手動納管配置項" })
  await dialog.getByLabel("名稱").fill("invalid-provider-location")
  await dialog.getByLabel("外部識別碼").fill("e2e-invalid-location")
  await dialog.getByLabel("Region location ID").fill("location-aliyun-sg")
  await dialog.getByRole("button", { name: "確認納管" }).click()
  await expect(dialog.getByText("請修正無法納管的欄位")).toBeVisible()
  await dialog.getByRole("button", { name: "關閉對話框" }).click()
  await expect(counts).toContainText('61筆')
})

test('AC-06/20: RD uses canonical shared CI link, hides Data scope, and never flashes an in-flight old response', async ({ page }) => {
  await page.goto('rd/apps')
  await expect(page.getByRole('heading', { name: '應用與環境' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'checkout-api' })).toBeVisible()
  await expect(page.getByText('data-worker')).toHaveCount(0)
  await page.getByRole('link', { name: 'checkout-api' }).click()
  await page.getByRole('link', { name: 'dev', exact: true }).click()
  const sharedRow = page.getByRole('row').filter({ hasText: 'ci-idc-redis-01' })
  await expect(sharedRow).toContainText('ci-idc-redis-01')
  await expect(sharedRow.getByRole('link', { name: '在 Ops 查看' })).toHaveAttribute('href', '/dim-gate/ops/cmdb/ci-idc-redis-01')
  await sharedRow.getByRole('link', { name: '在 Ops 查看' }).click()
  await expect(page.getByText(/目前身分無法進入維運中心/)).toBeVisible()

  await page.getByRole('combobox', { name: '示範身分' }).selectOption('user-rd-data')
  await page.evaluate(() => {
    const state = { leaks: [] as string[], switching: false, pendingAtSwitch: false }
    Object.assign(window, { __scopeTransition: state })
    document.addEventListener('change', (event) => {
      const target = event.target
      if (target instanceof HTMLSelectElement && target.getAttribute('aria-label') === '示範身分'
        && target.value === 'user-rd-commerce') {
        state.switching = true
        state.pendingAtSwitch = document.body.innerText.includes('正在搜尋目前授權範圍…')
      }
    }, { capture: true })
    new MutationObserver(() => {
      if (state.switching && document.body.innerText.includes('data-worker')) state.leaks.push('data-worker')
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  await page.getByRole('search', { name: '全域搜尋' }).getByRole('searchbox').fill('data')
  await page.getByRole('search', { name: '全域搜尋' }).getByRole('button', { name: '搜尋', exact: true }).click()
  await expect(page.getByText('正在搜尋目前授權範圍…')).toBeVisible()
  await page.getByRole('combobox', { name: '示範身分' }).selectOption('user-rd-commerce')
  await expect(page.getByRole('combobox', { name: '示範身分' })).toHaveValue('user-rd-commerce')
  expect(await page.evaluate(() => (window as unknown as {
    __scopeTransition: { leaks: string[]; pendingAtSwitch: boolean }
  }).__scopeTransition)).toEqual({ leaks: [], pendingAtSwitch: true, switching: true })
  await page.goto('rd/apps/app-data')
  await expect(page.getByRole('heading', { name: '找不到這個應用' })).toBeVisible()

  await page.getByRole('search', { name: '全域搜尋' }).getByRole('searchbox').fill('data-worker')
  await page.getByRole('search', { name: '全域搜尋' }).getByRole('button', { name: '搜尋', exact: true }).click()
  await expect(page.getByText('目前授權範圍沒有符合結果。')).toBeVisible()
})

test('AC-07/08: topology terminates on a cycle and CI state distinguishes zero, stale, unknown, and empty', async ({ page }) => {
  await becomeOps(page)
  await page.getByRole('link', { name: '依賴拓撲', exact: true }).click()
  await page.getByLabel('Canonical ID').fill('ci-aws-checkout-01')
  await page.getByLabel('最大深度').selectOption('3')
  await page.getByRole('button', { name: '探索拓撲' }).click()
  await expect(page.getByRole('heading', { name: '依賴圖' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '表格替代視圖' })).toBeVisible()
  await expect(page.getByRole('table')).toContainText('ci-idc-redis-01')
  await expect(page.getByRole('list', { name: '可見拓撲節點' }).getByText('ci-aws-checkout-01', { exact: true })).toHaveCount(1)

  await page.goto('ops/cmdb/ci-aws-02')
  await expect(page.getByRole('heading', { name: 'aws-compute-02' })).toBeVisible()
  await expect(page.getByText('過期', { exact: false }).first()).toBeVisible()
  const attributes = page.getByRole('heading', { name: 'Provider attributes' }).locator('..')
  await expect(attributes.getByText('0', { exact: true })).toHaveCount(2)

  await page.goto('ops/cmdb')
  await page.getByLabel('資料新鮮度').selectOption('unknown')
  await expect(page.getByText('未知 · 尚未觀測').first()).toBeVisible()
  await page.getByRole('searchbox', { name: '搜尋', exact: true }).fill('does-not-exist')
  await expect(page.getByRole('heading', { name: '目前 scope 沒有符合條件的配置項' })).toBeVisible()
})

test('M1 responsive light/dark pages have no serious axe or document overflow findings', async ({ page }, info) => {
  await page.goto('rd/apps')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await expect(page.getByRole('heading', { name: '應用與環境' })).toBeVisible()
    if (await page.getByRole('button', { name: '切換淺色主題' }).count()) await page.getByRole('button', { name: '切換淺色主題' }).click()
    const layout = await page.evaluate(() => ({ viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 8).map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })) }))
    expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport)
    let violations = (await new AxeBuilder({ page }).analyze()).violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))
    expect(violations).toEqual([])
    await page.screenshot({ path: info.outputPath(`m1-rd-light-${viewport.width}.png`), fullPage: true })
    await page.getByRole('button', { name: '切換深色主題' }).click()
    violations = (await new AxeBuilder({ page }).analyze()).violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))
    expect(violations).toEqual([])
    await page.screenshot({ path: info.outputPath(`m1-rd-dark-${viewport.width}.png`), fullPage: true })
  }
})

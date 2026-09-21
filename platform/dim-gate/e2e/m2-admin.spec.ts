import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function become(page: Page, persona: string) {
  const selector = page.getByRole('combobox', { name: '示範身分' })
  await expect(selector).toBeVisible()
  if (await selector.inputValue() !== persona) await selector.selectOption(persona)
  await expect(selector).toHaveValue(persona)
}

function captureRuntimeFailures(page: Page) {
  const consoleErrors: string[] = [], pageErrors: string[] = [], failedRequests: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`))
  return { consoleErrors, pageErrors, failedRequests }
}

test('AC-21: Admin access commands and registered navigation metadata work without weakening route guards', async ({ page }) => {
  const failures = captureRuntimeFailures(page)
  await page.goto('rd')
  await become(page, 'user-admin')
  await page.goto('admin/navigation')
  await expect(page.getByRole('heading', { name: '導航目錄' })).toBeVisible()

  const catalogRow = page.getByRole('row', { name: /admin\.catalog/ })
  await catalogRow.getByLabel('admin.catalog label').fill('服務藍圖')
  await catalogRow.getByRole('button', { name: '儲存' }).click()
  await expect(page.getByRole('link', { name: '服務藍圖', exact: true })).toBeVisible()

  const accessRow = page.getByRole('row', { name: /admin\.access/ })
  await accessRow.getByLabel('admin.access enabled').uncheck()
  await accessRow.getByRole('button', { name: '儲存' }).click()
  await expect(accessRow).toContainText('必要的管理或 recovery 導航不可停用')
  await expect(page.getByRole('link', { name: '角色與範圍', exact: true })).toBeVisible()

  await page.goto('admin/access')
  const userTable = page.getByRole('table', { name: '企業使用者與啟用狀態' })
  const selfRow = userTable.getByRole('row').filter({ has: page.getByText('user-admin', { exact: true }) })
  await selfRow.getByRole('button', { name: '停用使用者' }).click()
  await expect(page.getByRole('heading', { name: '操作未完成' })).toBeVisible()
  await expect(page.getByText('不能停用自己的帳號。')).toBeVisible()

  await page.getByRole('combobox', { name: '使用者' }).selectOption('user-rd-data')
  await page.getByRole('combobox', { name: '角色' }).selectOption('admin')
  await page.getByRole('button', { name: '新增授權' }).click()
  await expect(page.getByRole('row', { name: /user-rd-data.*Admin.*org.*org-demo/ })).toBeVisible()

  const dataUserRow = userTable.getByRole('row').filter({ has: page.getByText('user-rd-data', { exact: true }) })
  await dataUserRow.getByRole('button', { name: '停用使用者' }).click()
  await expect(dataUserRow.getByRole('button', { name: '重新啟用' })).toBeVisible()
  await dataUserRow.getByRole('button', { name: '重新啟用' }).click()
  await expect(dataUserRow.getByRole('button', { name: '停用使用者' })).toBeVisible()

  await become(page, 'user-rd-commerce')
  await page.goto('admin/catalog')
  await expect(page.getByRole('heading', { name: '目前身分無法進入平台管理' })).toBeVisible()
  expect(failures.consoleErrors).toHaveLength(2)
  expect(failures.consoleErrors.every((message) => message.includes('Failed to load resource'))).toBe(true)
  expect(failures.pageErrors).toEqual([])
  expect(failures.failedRequests).toEqual([])
})

test('AC-22/23: catalog revision, optional CMDB metadata, and safe filtered audit work end to end', async ({ page }) => {
  const failures = captureRuntimeFailures(page)
  await page.goto('rd')
  await become(page, 'user-admin')
  await page.goto('admin/catalog')

  await page.getByRole('button', { name: '建立下一版草稿' }).click()
  await expect(page.getByText('rev 2 · 草稿')).toBeVisible()
  await page.getByRole('textbox', { name: 'Draft name' }).fill('Web Runtime v2')
  await page.getByRole('textbox', { name: 'Description' }).fill('Governed revision edited through the Admin workspace.')
  await page.getByRole('button', { name: '儲存草稿內容' }).click()
  await expect(page.getByRole('heading', { name: 'Web Runtime v2' })).toBeVisible()
  await page.getByRole('button', { name: '發布 revision' }).click()
  await expect(page.getByText('rev 2 · 已發布')).toBeVisible()
  await page.getByRole('button', { name: '停用新申請' }).click()
  await expect(page.getByText('rev 2 · 已停用')).toBeVisible()

  await page.goto('admin/cmdb-models')
  await page.getByRole('textbox', { name: 'Key' }).fill('name')
  await page.getByRole('textbox', { name: 'Label' }).fill('Forbidden identity override')
  await page.getByRole('button', { name: '新增欄位' }).click()
  await expect(page.getByText('自訂欄位不可覆蓋核心身分欄位。')).toBeVisible()
  await page.getByRole('textbox', { name: 'Key' }).fill('costCenter')
  await page.getByRole('textbox', { name: 'Label' }).fill('Cost center')
  await page.getByRole('button', { name: '新增欄位' }).click()
  const fieldRow = page.getByRole('row', { name: /compute.*costCenter/ })
  await expect(fieldRow).toContainText('否')
  await fieldRow.getByLabel('costCenter label').fill('Billing cost center')
  await fieldRow.getByRole('button', { name: '儲存名稱' }).click()
  await expect(page.getByRole('row', { name: /compute.*costCenter.*Billing cost center/ })).toBeVisible()
  await page.getByRole('row', { name: /compute.*costCenter/ }).getByRole('button', { name: '隱藏' }).click()
  await expect(page.getByRole('row', { name: /compute.*costCenter/ })).toContainText('隱藏')

  await page.goto('admin/audit')
  await page.getByRole('textbox', { name: 'Actor ID' }).fill('user-admin')
  await page.getByRole('textbox', { name: 'Entity type' }).fill('catalogItem')
  const auditTable = page.getByRole('table')
  await expect(auditTable).toContainText('catalog.publish')
  await expect(auditTable).toContainText('catalog.disable')
  await expect(auditTable).not.toContainText(/password|authorization|bearer/i)

  await become(page, 'user-rd-commerce')
  await page.goto('rd/catalog')
  await expect(page.getByRole('heading', { name: '目前沒有可申請的服務' })).toBeVisible()
  expect(failures.consoleErrors).toEqual(['Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)'])
  expect(failures.pageErrors).toEqual([])
  expect(failures.failedRequests).toEqual([])
})

test('Admin governance routes are responsive in both themes with zero serious/critical axe findings', async ({ page }, info) => {
  await page.goto('rd')
  await become(page, 'user-admin')
  const routes = ['admin/access', 'admin/navigation', 'admin/catalog', 'admin/cmdb-models', 'admin/audit']
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const route of routes) {
      await page.goto(route)
      await expect(page.locator('main h1')).toBeVisible()
      const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
      expect(layout.scrollWidth, `${route} at ${viewport.width}px`).toBeLessThanOrEqual(layout.width)
      const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))
      expect(violations, `${route} at ${viewport.width}px`).toEqual([])
    }
    await page.getByRole('button', { name: '切換深色主題' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const darkViolations = (await new AxeBuilder({ page }).analyze()).violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))
    expect(darkViolations, `dark audit at ${viewport.width}px`).toEqual([])
    await page.screenshot({ path: info.outputPath(`m2-admin-dark-${viewport.width}.png`), fullPage: true })
    await page.getByRole('button', { name: '切換淺色主題' }).click()
  }
})

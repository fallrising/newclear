import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function guide(page: Page) {
  await page.goto('guide')
  await expect(page.getByRole('heading', { name: '示範導覽', exact: true })).toBeVisible()
  await expect(page.getByTestId('logical-clock')).toHaveText(/^0\s*ticks$/)
}

test('AC-01: production demo shell guards three centers and keeps its banner', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  await expect(page.getByRole('combobox', { name: '示範身分' })).toBeVisible()
  await expect(page.getByRole('link', { name: '研發概覽', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '維運概覽', exact: true })).toHaveCount(0)
  for (const [persona, center, path] of [
    ['user-ops', '維運概覽', '/ops'],
    ['user-admin', '平台概覽', '/admin'],
    ['user-rd-data', '研發概覽', '/rd'],
  ]) {
    await page.getByRole('combobox', { name: '示範身分' }).selectOption(persona)
    await expect(page.getByRole('link', { name: center, exact: true })).toBeVisible()
    await page.getByRole('link', { name: center, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByText('示範資料', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: '可見資源', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`center-${persona}.png`), fullPage: true })
  }
  await page.goto('admin')
  await expect(page.getByText(/目前身分無法進入/).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('AC-02: domain clock survives center/persona/reload and reset restores seed', async ({ page }) => {
  await guide(page)
  await page.getByRole('combobox', { name: '前進幅度' }).selectOption('5')
  await page.getByRole('button', { name: '前進演示時鐘' }).click()
  await expect(page.getByTestId('logical-clock')).toHaveText(/^5\s*ticks$/)
  await page.getByRole('combobox', { name: '示範身分' }).selectOption('user-ops')
  await page.getByRole('link', { name: '維運概覽', exact: true }).click()
  await page.getByRole('link', { name: '示範控制台', exact: true }).click()
  await expect(page.getByTestId('logical-clock')).toHaveText(/^5\s*ticks$/)
  await page.reload()
  await expect(page.getByTestId('logical-clock')).toHaveText(/^5\s*ticks$/)
  await expect(page.getByRole('combobox', { name: '示範身分' })).toHaveValue('user-ops')
  await page.getByRole('button', { name: '重置示範', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('logical-clock')).toHaveText(/^5\s*ticks$/)
  await page.getByRole('button', { name: '重置示範', exact: true }).click()
  await page.getByRole('button', { name: '確認重置示範' }).click()
  await expect(page.getByTestId('logical-clock')).toHaveText(/^0\s*ticks$/)
  await page.reload()
  await expect(page.getByTestId('logical-clock')).toHaveText(/^0\s*ticks$/)
})

test('responsive shell and focus have no serious accessibility or document overflow findings', async ({ page }, info) => {
  await guide(page)
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await expect(page.getByRole('button', { name: '前進演示時鐘' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`guide-${viewport.width}.png`), fullPage: true })
    const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))
    expect(violations).toEqual([])
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '切換深色主題' }).click()
  const darkViolations = (await new AxeBuilder({ page }).analyze()).violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))
  expect(darkViolations).toEqual([])
  await page.screenshot({ path: info.outputPath('guide-dark-1440.png'), fullPage: true })
  await page.getByRole('button', { name: '重置示範', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '重置示範', exact: true })).toBeFocused()
})

for (const afterReset of [false, true]) test(`AC-02: opener-cloned tab is independent${afterReset ? ' after reset' : ''}`, async ({ page, context }) => {
  await guide(page)
  if (afterReset) {
    await page.getByRole('button', { name: '重置示範', exact: true }).click()
    await page.getByRole('button', { name: '確認重置示範' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('logical-clock')).toHaveText(/^0\s*ticks$/)
  }
  await page.getByRole('button', { name: '前進演示時鐘' }).click()
  await expect(page.getByTestId('logical-clock')).toHaveText(/^1\s*ticks$/)
  const sessionId = () => page.getByText('Session ID', { exact: true }).locator('..').locator('dd').innerText()
  const originalId = await sessionId()
  const popupPromise = context.waitForEvent('page')
  await page.evaluate(() => window.open(window.location.href, '_blank'))
  const other = await popupPromise
  await expect(other.getByTestId('logical-clock')).toBeVisible()
  const otherId = await other.getByText('Session ID', { exact: true }).locator('..').locator('dd').innerText()
  expect(otherId).not.toEqual(originalId)
  await other.getByRole('combobox', { name: '前進幅度' }).selectOption('5')
  await other.getByRole('button', { name: '前進演示時鐘' }).click()
  await expect(other.getByTestId('logical-clock')).toHaveText(/^6\s*ticks$/)
  await page.reload()
  await expect(page.getByTestId('logical-clock')).toHaveText(/^1\s*ticks$/)
  expect(await sessionId()).toEqual(originalId)
})

test('production subpath refresh scopes the service worker and leaves another app API alone', async ({ page }) => {
  await guide(page)
  await page.reload()
  await expect(page.getByTestId('logical-clock')).toBeVisible()
  const result = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    const unrelated = await fetch('/other-app/api/v1/session')
    return { scope: registration?.scope, type: unrelated.headers.get('content-type'), body: await unrelated.text() }
  })
  expect(result.scope).toBe(`${new URL(page.url()).origin}/dim-gate/`)
  expect(result.type).not.toContain('application/json')
  expect(result.body).not.toContain('"sessionId"')
})

test('damaged saved data offers explicit recovery without silently erasing it', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('dim-gate.demo.v1', '{broken'))
  await page.goto('./')
  await expect(page.getByRole('button', { name: '使用暫存記憶體繼續' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('dim-gate.demo.v1'))).toBe('{broken')
  await page.getByRole('button', { name: '使用暫存記憶體繼續' }).click()
  await expect(page.getByText(/目前使用暫存記憶體模式/)).toBeVisible()
  await expect(page.getByRole('combobox', { name: '示範身分' })).toBeVisible()
})

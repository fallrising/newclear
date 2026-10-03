import { test, expect } from '@playwright/test'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'

type Transition = { ready: boolean; status: number; containedPrivateObject: boolean; switching: boolean; delivered: boolean; leaks: string[] }
test('W2 AC-15: held successful resource response never flashes after persona switch; search stays scoped', async ({ page }, info) => {
  const health = captureBrowserHealth(page)
  try {
    await page.goto('rd/apps/app-checkout')
    await expect(page.getByRole('heading', { name: 'checkout-api', exact: true })).toBeVisible()
    await page.evaluate(() => {
      const state = { ready: false, status: 0, containedPrivateObject: false, switching: false, delivered: false, leaks: [] as string[] }
      const original = window.fetch.bind(window)
      let release!: () => void
      const held = new Promise<void>(resolve => { release = resolve })
      Object.assign(window, { __w2ResourceTransition: state, __releaseW2Resource: release })
      window.fetch = async (...args) => {
        const response = await original(...args)
        if (new URL(String(args[0])).pathname.endsWith('/applications/app-checkout/resources')
          && new Headers(args[1]?.headers).get('X-Demo-Persona') === 'user-rd-commerce') {
          state.status = response.status
          state.containedPrivateObject = (await response.clone().text()).includes('w2-object-redis-commerce')
          state.ready = true
          await held
          state.delivered = true
        }
        return response
      }
      document.addEventListener('change', event => {
        const target = event.target
        if (target instanceof HTMLSelectElement && target.getAttribute('aria-label') === '示範身分' && target.value === 'user-rd-data') state.switching = true
      }, { capture: true })
      new MutationObserver(() => {
        if (state.switching && document.body.innerText.includes('w2-object-redis-commerce')) state.leaks.push('private resource payload')
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    await page.getByRole('link', { name: '查看服務資源', exact: true }).click()
    await page.getByRole('combobox', { name: '服務環境', exact: true }).selectOption('env-checkout-dev')
    await expect(page.getByText('正在讀取服務資源…', { exact: true })).toBeVisible()
    await page.waitForFunction(() => (window as unknown as { __w2ResourceTransition: Transition }).__w2ResourceTransition.ready)
    await page.getByRole('combobox', { name: '示範身分', exact: true }).selectOption('user-rd-data')
    await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '示範身分', exact: true })).toHaveValue('user-rd-data')
    await page.evaluate(() => (window as unknown as { __releaseW2Resource: () => void }).__releaseW2Resource())
    await page.waitForFunction(() => (window as unknown as { __w2ResourceTransition: Transition }).__w2ResourceTransition.delivered)
    await page.getByRole('search', { name: '全域搜尋' }).getByRole('searchbox').fill('w2-object-redis-commerce')
    await page.getByRole('search', { name: '全域搜尋' }).getByRole('button', { name: '搜尋', exact: true }).click()
    await expect(page.getByText('目前授權範圍沒有符合結果。')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('commerce-cache')
    const transition = await page.evaluate(() => (window as unknown as { __w2ResourceTransition: Transition }).__w2ResourceTransition)
    expect(transition).toEqual({ ready: true, status: 200, containedPrivateObject: true, switching: true, delivered: true, leaks: [] })
    await info.attach('held-resource-isolation.json', { body: JSON.stringify(transition), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

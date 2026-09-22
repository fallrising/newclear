import { test, expect } from '@playwright/test'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'

test('AC-29: production deep refresh, app worker scope and actual sibling document/API isolation', async ({ page, context }, info) => {
  const health = captureBrowserHealth(page)
  try {
    await page.goto('rd/apps/app-checkout/environments/env-checkout-dev')
    await expect(page.getByRole('heading', { name: /環境$/ }).first()).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: /環境$/ }).first()).toBeVisible()
    const app = await page.evaluate(async () => ({
      controlled: navigator.serviceWorker.controller?.scriptURL,
      registrations: (await navigator.serviceWorker.getRegistrations()).map(registration => ({ scope: registration.scope, script: registration.active?.scriptURL })),
      sibling: await fetch('/sibling/api/v1/session').then(async response => ({ status: response.status, marker: response.headers.get('X-Isolation-Fixture'), data: await response.json() })),
    }))
    expect(app.controlled).toBe('http://127.0.0.1:4176/dim-gate/mockServiceWorker.js')
    expect(app.registrations).toEqual([{ scope: 'http://127.0.0.1:4176/dim-gate/', script: app.controlled }])
    expect(app.sibling).toEqual({ status: 200, marker: 'sibling-server', data: { application: 'sibling', source: 'real-local-server' } })
    const sibling = await context.newPage()
    const siblingHealth = captureBrowserHealth(sibling)
    try {
      await sibling.goto('http://127.0.0.1:4176/sibling/')
      await expect(sibling.getByRole('heading', { name: 'Sibling application' })).toBeVisible()
      await expect(sibling.locator('output')).toContainText('real-local-server')
      await sibling.reload()
      await expect(sibling.locator('output')).toContainText('real-local-server')
      const isolation = await sibling.evaluate(async () => ({
        controlled: navigator.serviceWorker.controller?.scriptURL ?? null,
        registration: (await navigator.serviceWorker.getRegistration())?.scope ?? null,
        response: await fetch('/sibling/api/v1/session').then(async response => ({ status: response.status, marker: response.headers.get('X-Isolation-Fixture'), data: await response.json() })),
      }))
      expect(isolation.controlled).toBeNull()
      expect(isolation.registration).toBeNull()
      expect(isolation.response).toEqual(app.sibling)
      await info.attach('isolation-evidence', { body: JSON.stringify({ app, sibling: isolation }, null, 2), contentType: 'application/json' })
    } finally { await verifyBrowserHealth(sibling, info, siblingHealth); await sibling.close() }
  } finally { await verifyBrowserHealth(page, info, health) }
})

test('AC-29: production live mode is visibly unavailable and never registers demo fallback', async ({ page }, info) => {
  const health = captureBrowserHealth(page)
  try {
    await page.goto('http://127.0.0.1:4177/dim-gate/rd')
    await expect(page.getByRole('heading', { name: '目前無法啟動工作台' })).toBeVisible()
    await expect(page.getByText('LIVE_MODE_UNAVAILABLE', { exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '示範身分' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '使用暫存記憶體繼續' })).toHaveCount(0)
    const live = await page.evaluate(async () => ({
      registrations: (await navigator.serviceWorker.getRegistrations()).map(registration => registration.scope),
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      snapshot: sessionStorage.getItem('dim-gate.demo.v1'),
      demoRequests: performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /mockServiceWorker|\/__demo\/|\/api\/v1\//.test(name)),
    }))
    expect(live).toEqual({ registrations: [], controller: null, snapshot: null, demoRequests: [] })
    await info.attach('live-unavailable-evidence', { body: JSON.stringify(live, null, 2), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

import { test, expect } from '@playwright/test'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { snapshot, source, visit } from './w3-ui-helpers'

type Held = { commandReady: boolean; readReady: boolean; commands: number; releaseCommand: () => void; releaseRead: () => void }
test('W3 command ownership holds persona/clock/dialog through command and readback; failed revision read retries once', async ({ page }, info) => {
  test.setTimeout(90_000)
  const health = captureBrowserHealth(page), id = 'w3-config-checkout-dev-1'
  try {
    await visit(page, 'serviceConfig', id)
    const before = await snapshot(page)
    await page.evaluate(sourceId => {
      const original = window.fetch.bind(window)
      const state = { commandReady: false, readReady: false, commands: 0, releaseCommand: () => {}, releaseRead: () => {} }
      const commandGate = new Promise<void>(resolve => { state.releaseCommand = resolve }), readGate = new Promise<void>(resolve => { state.releaseRead = resolve })
      let heldRead = false
      Object.assign(window, { __w3Held: state })
      window.fetch = async (...args) => {
        const response = await original(...args), path = new URL(String(args[0])).pathname, method = args[1]?.method ?? 'GET'
        if (path.endsWith(`/service-configs/${sourceId}/validate`) && method === 'POST') { state.commands++; state.commandReady = true; await commandGate }
        if (state.commandReady && !heldRead && path.endsWith(`/service-configs/${sourceId}`) && method === 'GET') { heldRead = true; state.readReady = true; await readGate }
        return response
      }
    }, id)
    await page.getByRole('button', { name: '驗證草稿', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '驗證草稿', exact: true })
    await dialog.getByRole('textbox', { name: '決策／操作理由', exact: true }).fill('Hold until exact readback completes')
    await dialog.getByRole('button', { name: '確認操作', exact: true }).click()
    await page.waitForFunction(() => (window as unknown as { __w3Held: Held }).__w3Held.commandReady)
    await expect(page.locator('select[aria-label="示範身分"]')).toBeDisabled()
    await expect(page.getByRole('button', { name: '推進示範時鐘', exact: true, includeHidden: true })).toBeDisabled()
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible()
    await page.evaluate(() => (window as unknown as { __w3Held: Held }).__w3Held.releaseCommand())
    await page.waitForFunction(() => (window as unknown as { __w3Held: Held }).__w3Held.readReady)
    await expect(page.locator('select[aria-label="示範身分"]')).toBeDisabled()
    await expect(dialog.getByRole('button', { name: '正在提交並讀回…', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible()
    await page.evaluate(() => (window as unknown as { __w3Held: Held }).__w3Held.releaseRead())
    await expect(dialog).toHaveCount(0); await expect(page.getByRole('combobox', { name: '示範身分', exact: true })).toBeEnabled()
    expect((await snapshot(page)).commandCount).toBe(before.commandCount + 1)
    expect((await source(page, id)).state).toBe('validated')
    expect(await page.evaluate(() => (window as unknown as { __w3Held: Held }).__w3Held.commands)).toBe(1)

    await page.evaluate(sourceId => {
      const original = window.fetch.bind(window), state = { revisionCommands: 0, failNextDetail: false, failures: 0, targetId: '' }
      Object.assign(window, { __w3ReadFailure: state })
      window.fetch = async (...args) => {
        const response = await original(...args), path = new URL(String(args[0])).pathname, method = args[1]?.method ?? 'GET'
        if (path.endsWith(`/service-configs/${sourceId}/revisions`) && method === 'POST') { state.revisionCommands++; state.targetId = (await response.clone().json()).data.entityId; state.failNextDetail = true }
        else if (state.failNextDetail && path.endsWith(`/service-configs/${state.targetId}`) && method === 'GET') { state.failNextDetail = false; state.failures++; throw new TypeError('Deterministic browser readback interruption') }
        return response
      }
    }, id)
    const prior = await snapshot(page)
    await page.getByRole('button', { name: '建立下一版草稿', exact: true }).click()
    const revise = page.getByRole('dialog', { name: '建立下一版草稿', exact: true })
    await revise.getByRole('textbox', { name: '決策／操作理由', exact: true }).fill('Receipt survives detail read failure')
    await revise.getByRole('button', { name: '確認操作', exact: true }).click()
    await expect(revise.getByRole('alert')).toContainText('結果尚未讀回')
    await expect(revise.getByRole('button', { name: '重新讀取結果', exact: true })).toBeEnabled()
    expect((await snapshot(page)).entities.serviceConfigs).toHaveLength(prior.entities.serviceConfigs.length + 1)
    await revise.getByRole('button', { name: '重新讀取結果', exact: true }).click()
    await expect(revise).toHaveCount(0)
    expect(new URL(page.url()).searchParams.get('revisionId')).not.toBe(id)
    const state = await page.evaluate(() => (window as unknown as { __w3ReadFailure: { revisionCommands: number; failures: number } }).__w3ReadFailure)
    expect(state).toMatchObject({ revisionCommands: 1, failures: 1 })
    expect((await snapshot(page)).commandCount).toBe(prior.commandCount + 1)
    await info.attach('command-readback-counts', { body: JSON.stringify(state), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

type Transition = { ready: boolean; status: number; containsConfig: boolean; switching: boolean; delivered: boolean; leaks: string[] }
test('W3 held successful configuration response never appears after persona switch or scoped search', async ({ page }, info) => {
  const health = captureBrowserHealth(page)
  try {
    await visit(page, 'pipelineDefinition', 'w3-definition-checkout-1')
    await page.evaluate(() => {
      const original = window.fetch.bind(window), state = { ready: false, status: 0, containsConfig: false, switching: false, delivered: false, leaks: [] as string[] }
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      Object.assign(window, { __w3Transition: state, __w3Release: release })
      window.fetch = async (...args) => {
        const response = await original(...args)
        if (new URL(String(args[0])).pathname.endsWith('/service-configs/w3-config-checkout-dev-1') && new Headers(args[1]?.headers).get('X-Demo-Persona') === 'user-rd-commerce') {
          state.status = response.status; state.containsConfig = (await response.clone().text()).includes('w3-secret-checkout'); state.ready = true; await gate; state.delivered = true
        }
        return response
      }
      document.addEventListener('change', event => { const target = event.target; if (target instanceof HTMLSelectElement && target.getAttribute('aria-label') === '示範身分' && target.value === 'user-rd-data') state.switching = true }, { capture: true })
      new MutationObserver(() => { if (state.switching && /w3-secret-checkout|RUNTIME_SECRET/.test(document.body.innerText)) state.leaks.push('retired configuration') }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    await page.getByRole('link', { name: '服務配置', exact: true }).click()
    await page.waitForFunction(() => (window as unknown as { __w3Transition: Transition }).__w3Transition.ready)
    await page.getByRole('combobox', { name: '示範身分', exact: true }).selectOption('user-rd-data')
    await expect(page.getByRole('region', { name: 'rd 工作首頁' })).toBeVisible()
    await page.evaluate(() => (window as unknown as { __w3Release: () => void }).__w3Release())
    await page.waitForFunction(() => (window as unknown as { __w3Transition: Transition }).__w3Transition.delivered)
    await page.getByRole('search', { name: '全域搜尋' }).getByRole('searchbox').fill('w3-config-checkout-dev-1')
    await page.getByRole('search', { name: '全域搜尋' }).getByRole('button', { name: '搜尋', exact: true }).click()
    await expect(page.getByText('目前授權範圍沒有符合結果。')).toBeVisible()
    const transition = await page.evaluate(() => (window as unknown as { __w3Transition: Transition }).__w3Transition)
    expect(transition).toEqual({ ready: true, status: 200, containsConfig: true, switching: true, delivered: true, leaks: [] })
    await info.attach('held-configuration-isolation', { body: JSON.stringify(transition), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

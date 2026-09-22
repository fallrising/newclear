import { test, expect, type Page } from '@playwright/test'
import type { Snapshot } from '../src/domain/schemas'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'

const key = 'dim-gate.demo.v1'
const rawSnapshot = (page: Page) => page.evaluate(storageKey => sessionStorage.getItem(storageKey)!, key)
async function saved(page: Page) {
  return JSON.parse(await rawSnapshot(page)) as { snapshot: Snapshot; personaId: string; generation: number; personaCommands: unknown[] }
}
async function guide(page: Page) {
  await page.goto('guide')
  await expect(page.getByTestId('logical-clock')).toBeVisible()
}
async function advance(page: Page, ticks: '1' | '5' | '60' = '1') {
  const before = (await saved(page)).snapshot.logicalClock
  await page.getByRole('combobox', { name: '前進幅度' }).selectOption(ticks)
  await page.getByRole('button', { name: '前進演示時鐘' }).click()
  await expect(page.getByTestId('logical-clock')).toHaveText(new RegExp('^' + (before + Number(ticks)) + '\\s*ticks$'))
  await expect(page.getByRole('button', { name: '前進演示時鐘' })).toBeEnabled()
}
async function reset(page: Page) {
  await page.getByRole('button', { name: '重置示範', exact: true }).click()
  await page.getByRole('button', { name: '確認重置示範' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('logical-clock')).toHaveText(/^0\s*ticks$/)
}
async function approveRequest(page: Page, name: string) {
  await page.goto('rd/catalog')
  await page.getByRole('link', { name: '開始申請' }).click()
  await page.getByRole('combobox', { name: '應用', exact: true }).selectOption('app-checkout')
  await page.getByRole('textbox', { name: '環境名稱', exact: true }).fill(name)
  await page.getByRole('textbox', { name: '用途', exact: true }).fill('M5 persistence verification through the visible request workflow')
  await page.getByRole('button', { name: '確認並提交申請' }).click()
  await expect(page.getByRole('heading', { name: name + ' · 待審核' })).toBeVisible()
  const requestId = new URL(page.url()).pathname.split('/').at(-1)!
  await page.getByRole('combobox', { name: '示範身分' }).selectOption('user-ops')
  await expect(page.getByRole('link', { name: '維運概覽', exact: true })).toBeVisible()
  await page.goto('ops/requests/' + requestId)
  await page.getByRole('button', { name: '核准並保留容量' }).click()
  await expect(page.getByRole('heading', { name: name + ' · 已核准' })).toBeVisible()
  const job = (await saved(page)).snapshot.jobs.find(item => item.requestId === requestId)!
  expect(job.state).toBe('queued')
  return { requestId, jobId: job.id }
}

test('AC-28: queued and running jobs reload at the exact saved step; quota failure is atomic', async ({ page }, info) => {
  const health = captureBrowserHealth(page)
  health.expectedStatuses.add(507)
  try {
    const { requestId, jobId } = await approveRequest(page, 'm5-resume')
    const queued = await rawSnapshot(page)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'm5-resume · 已核准' })).toBeVisible()
    expect(await rawSnapshot(page)).toBe(queued)
    await page.getByRole('button', { name: '啟動交付' }).click()
    await expect(page.getByRole('heading', { name: 'm5-resume · 交付中' })).toBeVisible()
    await guide(page)
    await advance(page)
    const running = await saved(page)
    expect(running.snapshot.scheduler.tasks.find(task => task.operationId === jobId)?.stepIndex).toBe(1)
    const before = await rawSnapshot(page)
    await page.reload()
    await expect(page.getByTestId('logical-clock')).toHaveText(/^1\s*ticks$/)
    expect(await rawSnapshot(page)).toBe(before)
    // Only adversarial storage failure is injected. Successful business setup uses visible UI.
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      Object.defineProperty(window, '__restoreM5Storage', { configurable: true, value: () => { Storage.prototype.setItem = original } })
      Storage.prototype.setItem = function (storageKey, value) {
        if (storageKey === 'dim-gate.demo.v1') throw new DOMException('M5 injected quota exhaustion', 'QuotaExceededError')
        original.call(this, storageKey, value)
      }
    })
    await page.getByRole('button', { name: '前進演示時鐘' }).click()
    await expect(page.getByRole('alert')).toContainText('DEMO_STORAGE_FULL')
    await info.attach('quota-error-screen', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    await expect(page.getByTestId('logical-clock')).toHaveText(/^1\s*ticks$/)
    expect(await rawSnapshot(page)).toBe(before)
    await expect(page.getByRole('button', { name: '重置示範', exact: true })).toBeEnabled()
    await page.evaluate(() => { (window as unknown as { __restoreM5Storage(): void }).__restoreM5Storage() })
    await advance(page)
    const resumed = (await saved(page)).snapshot
    expect(resumed.scheduler.tasks.find(task => task.operationId === jobId)?.stepIndex).toBe(2)
    expect(resumed.commandCount).toBe(running.snapshot.commandCount + 1)
    expect(resumed.audit).toHaveLength(running.snapshot.audit.length + 1)
    expect(resumed.events).toHaveLength(running.snapshot.events.length + 1)
    expect(resumed.idempotency).toHaveLength(running.snapshot.idempotency.length + 1)
    await advance(page, '5')
    await page.goto('ops/requests/' + requestId)
    await expect(page.getByRole('heading', { name: 'm5-resume · 已完成' })).toBeVisible()
    const complete = (await saved(page)).snapshot
    expect(complete.jobs.find(job => job.id === jobId)?.state).toBe('succeeded')
    expect(complete.scheduler.tasks).toEqual([])
    await info.attach('reload-quota-atomicity', { body: JSON.stringify({ queued: JSON.parse(queued).snapshot.jobs, running: running.snapshot.scheduler, resumed: resumed.scheduler, completed: complete.jobs, rejectedWritePreservedBytes: true }, null, 2), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

test('AC-28: explicit reset clears running work and reload/clock advancement cannot revive it', async ({ page }, info) => {
  const health = captureBrowserHealth(page)
  try {
    const { jobId } = await approveRequest(page, 'm5-reset-running')
    await page.getByRole('button', { name: '啟動交付' }).click()
    await expect(page.getByRole('heading', { name: 'm5-reset-running · 交付中' })).toBeVisible()
    await guide(page)
    await advance(page)
    const old = await saved(page)
    expect(old.snapshot.scheduler.tasks.some(task => task.operationId === jobId)).toBe(true)
    await reset(page)
    await page.reload()
    await expect(page.getByTestId('logical-clock')).toHaveText(/^0\s*ticks$/)
    await advance(page, '60')
    const current = await saved(page)
    expect(current.generation).toBe(old.generation + 1)
    expect(current.snapshot.sessionId).not.toBe(old.snapshot.sessionId)
    expect(current.snapshot.jobs).toEqual([])
    expect(current.snapshot.scheduler.tasks).toEqual([])
    expect(current.snapshot.entities.requests).toEqual([])
    expect(current.snapshot.entities.cis).toHaveLength(60)
    expect(current.snapshot.audit).toHaveLength(1)
    expect(current.snapshot.audit[0].action).not.toContain('provision')
    await info.attach('reset-generation', { body: JSON.stringify({ oldSession: old.snapshot.sessionId, session: current.snapshot.sessionId, generation: current.generation, jobs: current.snapshot.jobs, scheduler: current.snapshot.scheduler }, null, 2), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

test('AC-28: corrupt bytes survive memory recovery and reload until an explicit confirmed reset', async ({ page }, info) => {
  const health = captureBrowserHealth(page)
  try {
    await guide(page)
    const corrupt = '{"formatVersion":1,"snapshot":broken-m5-original-bytes'
    await page.evaluate(({ storageKey, bytes }) => sessionStorage.setItem(storageKey, bytes), { storageKey: key, bytes: corrupt })
    await page.reload()
    await expect(page.getByRole('heading', { name: '示範資料需要恢復' })).toBeVisible()
    expect(await rawSnapshot(page)).toBe(corrupt)
    await page.getByRole('button', { name: '使用暫存記憶體繼續' }).click()
    await expect(page.getByText(/目前使用暫存記憶體模式/)).toBeVisible()
    await page.getByRole('button', { name: '前進演示時鐘' }).click()
    await expect(page.getByTestId('logical-clock')).toHaveText(/^1\s*ticks$/)
    expect(await rawSnapshot(page)).toBe(corrupt)
    await page.reload()
    await expect(page.getByRole('heading', { name: '示範資料需要恢復' })).toBeVisible()
    expect(await rawSnapshot(page)).toBe(corrupt)
    await page.getByRole('button', { name: '重置保存的示範資料' }).click()
    await page.keyboard.press('Escape')
    expect(await rawSnapshot(page)).toBe(corrupt)
    await page.getByRole('button', { name: '重置保存的示範資料' }).click()
    await page.getByRole('button', { name: '確認重置保存資料' }).click()
    await expect(page.getByTestId('logical-clock')).toHaveText(/^0\s*ticks$/)
    const restored = await saved(page)
    expect(restored.snapshot.jobs).toEqual([])
    expect(restored.snapshot.scheduler.tasks).toEqual([])
    expect(restored.snapshot.commandCount).toBe(0)
    await info.attach('corrupt-byte-recovery', { body: JSON.stringify({ corrupt, preservedAcrossMemoryAndReload: true, restoredSeed: restored.snapshot.seedVersion }), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

test('AC-28: 1000 actual UI commands persist; command 1001 fails atomically and reset remains available', async ({ page }, info) => {
  test.setTimeout(15 * 60_000)
  const health = captureBrowserHealth(page)
  health.expectedStatuses.add(429)
  try {
    await guide(page)
    for (let count = 1; count <= 1000; count++) {
      await page.getByRole('button', { name: '前進演示時鐘' }).click()
      await expect.poll(() => page.getByTestId('logical-clock').innerText(), { intervals: [25] })
        .toMatch(new RegExp('^' + count + '\\s*ticks$'))
      if (count % 250 === 0) console.info('Verified ' + count + ' genuine visible UI commands')
    }
    const before = await rawSnapshot(page)
    const full = (await saved(page)).snapshot
    expect(full.commandCount).toBe(1000)
    expect(full.audit).toHaveLength(1000)
    expect(full.events).toHaveLength(1000)
    expect(full.idempotency).toHaveLength(1000)
    await page.getByRole('button', { name: '前進演示時鐘' }).click()
    await expect(page.getByRole('alert')).toContainText('DEMO_COMMAND_LIMIT')
    await info.attach('command-limit-screen', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    await expect(page.getByTestId('logical-clock')).toHaveText(/^1000\s*ticks$/)
    expect(await rawSnapshot(page)).toBe(before)
    await page.reload()
    await expect(page.getByTestId('logical-clock')).toHaveText(/^1000\s*ticks$/)
    expect(await rawSnapshot(page)).toBe(before)
    await info.attach('command-limit', { body: JSON.stringify({ successfulVisibleCommands: full.commandCount, audit: full.audit.length, events: full.events.length, receipts: full.idempotency.length, bytes: Buffer.byteLength(before), rejectedWritePreservedBytes: true }), contentType: 'application/json' })
    await reset(page)
    await advance(page)
    expect((await saved(page)).snapshot.commandCount).toBe(1)
  } finally { await verifyBrowserHealth(page, info, health) }
})

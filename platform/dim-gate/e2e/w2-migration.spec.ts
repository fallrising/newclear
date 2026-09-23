import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { readSnapshot } from './w2-resource-helpers'

// Only this upgrade-boundary test installs the exact serialized W1 fixture.
// It was captured by W1 controller commands; business success below uses visible UI clock controls.
const legacyBytes = readFileSync(new URL('../src/demo/seed/fixtures/w1-active-session.json', import.meta.url), 'utf8')
const legacy = JSON.parse(legacyBytes)
test('W2 AC-16: genuine W1 active Release and ProvisionJob migrate, reload and complete once through visible clock', async ({ page }, info) => {
  test.setTimeout(90_000)
  const health = captureBrowserHealth(page)
  try {
    expect(createHash('sha256').update(legacyBytes).digest('hex')).toBe('55c21bb325f3d8f5f45a4cc53326125420c90e08b884129b54de6b6d82f1abc6')
    await page.addInitScript(raw => {
      if (!sessionStorage.getItem('dim-gate.demo.v1')) sessionStorage.setItem('dim-gate.demo.v1', raw)
    }, legacyBytes)
    await page.goto('ops/requests/req-0014')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('交付中')
    const migrated = await readSnapshot(page)
    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.seedVersion).toBe('dim-gate-w4-v1')
    expect(migrated.logicalClock).toBe(10)
    for (const field of ['sessionId', 'commandCount', 'storeRevision', 'sequence', 'policyVersion', 'audit', 'events', 'idempotency', 'jobs', 'scheduler']) expect(migrated[field]).toEqual(legacy.snapshot[field])
    for (const field of ['users', 'assignments', 'applications', 'environments', 'placements', 'requests', 'releases', 'pipelineRuns']) expect(migrated.entities[field]).toEqual(legacy.snapshot.entities[field])
    expect(migrated.entities.resourceBindings).toEqual([])
    expect(migrated.entities.resourceObjects).toEqual([])
    for (const collection of ['monitorPolicies', 'alertRules', 'sloPolicies', 'silences', 'alertEvaluations', 'notificationDeliveries', 'infrastructureIncidents']) expect(migrated.entities[collection]).toEqual([])
    await expect(page.getByRole('combobox', { name: '示範身分', exact: true }).locator('option')).toHaveCount(4)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('交付中')
    expect(await readSnapshot(page)).toEqual(migrated)
    await page.goto('ops/releases/release-0012')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.goto('guide')
    await page.getByLabel('前進幅度').selectOption('5')
    await page.getByRole('button', { name: '前進演示時鐘', exact: true }).click()
    await expect(page.locator('.command-notice')).toContainText('演示時鐘已前進 5 個 tick')
    const completed = await readSnapshot(page)
    expect(completed.jobs).toHaveLength(1)
    expect(completed.jobs[0]).toMatchObject({ id: 'job-0016', state: 'succeeded' })
    expect(completed.entities.requests[0]).toMatchObject({ id: 'req-0014', state: 'fulfilled', environmentId: 'env-0014' })
    expect(completed.entities.releases.find((item: { id: string }) => item.id === 'release-0012').state).toBe('succeeded')
    expect(completed.scheduler.tasks).toEqual([])
    await page.reload()
    await expect(page.getByTestId('logical-clock')).toContainText('15')
    expect(await readSnapshot(page)).toEqual(completed)
    await page.goto('ops/requests/req-0014')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('已完成')
    await info.attach('migration-lineage.json', { body: JSON.stringify({ fixtureSha256: createHash('sha256').update(legacyBytes).digest('hex'), migrated, completed }), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'
import { snapshot } from './w3-ui-helpers'

const bytes = readFileSync(new URL('../src/demo/seed/fixtures/w2-active-session.json', import.meta.url), 'utf8')
const legacy = JSON.parse(bytes)
test('W3 genuine W2 upgrade: Release, ProvisionJob and Kafka Change resume exactly once via visible clock', async ({ page }, info) => {
  test.setTimeout(90_000)
  const health = captureBrowserHealth(page)
  try {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('2180e098e84bdcccaa35c6573d623577985b2480b780e30a1302965078e6607b')
    // Sole historical upgrade boundary: exact captured W2 bytes, no synthetic business setup.
    await page.addInitScript(raw => { if (!sessionStorage.getItem('dim-gate.demo.v1')) sessionStorage.setItem('dim-gate.demo.v1', raw) }, bytes)
    await page.goto('ops/changes/change-0016')
    await expect(page.getByRole('heading', { name: '資源變更詳情', exact: true })).toBeVisible()
    const migrated = await snapshot(page)
    expect(migrated.schemaVersion).toBe(5); expect(migrated.seedVersion).toBe('dim-gate-w5-v1')
    for (const field of ['sessionId', 'logicalClock', 'commandCount', 'storeRevision', 'sequence', 'policyVersion', 'audit', 'events', 'idempotency', 'jobs', 'scheduler'] as const) expect(migrated[field]).toEqual(legacy.snapshot[field])
    for (const [key, value] of Object.entries(legacy.snapshot.entities)) {
      if (key === 'navigation') {
        expect(migrated.entities.navigation.slice(0, (value as unknown[]).length)).toEqual(value)
      } else if (key === 'users' || key === 'teams') {
        expect(migrated.entities[key]).toEqual((value as object[]).map(row => ({ ...row, source: 'seed' })))
      } else expect(migrated.entities[key as keyof typeof migrated.entities]).toEqual(value)
    }
    expect(migrated.entities.navigation.slice(legacy.snapshot.entities.navigation.length).map(item => item.routeKey))
      .toEqual(['rd.monitoring', 'rd.alerts', 'ops.alerting'])
    expect(migrated.entities.pipelineDefinitions).toEqual([]); expect(migrated.entities.serviceConfigs).toEqual([]); expect(migrated.entities.trafficPolicies).toEqual([]); expect(migrated.entities.serviceExecutions).toEqual([])
    for (const collection of ['monitorPolicies', 'alertRules', 'sloPolicies', 'silences', 'alertEvaluations', 'notificationDeliveries', 'infrastructureIncidents'] as const) expect(migrated.entities[collection]).toEqual([])
    for (const collection of ['platformFeatures', 'platformRoutes', 'notificationSubscriptions', 'notificationAttempts'] as const) expect(migrated.entities[collection]).toEqual([])
    expect(migrated.entities.channels.map(row => row.id)).toEqual(['demo-rd', 'demo-ops'])
    expect(migrated.entities.notificationTemplates).toHaveLength(1)
    expect(migrated.entities.notificationPolicies).toHaveLength(1)
    await page.reload(); await expect(page.getByRole('heading', { name: '資源變更詳情', exact: true })).toBeVisible(); expect(await snapshot(page)).toEqual(migrated)
    await page.goto('guide'); await page.getByLabel('前進幅度').selectOption('5'); await page.getByRole('button', { name: '前進演示時鐘', exact: true }).click()
    await expect(page.locator('.command-notice')).toContainText('演示時鐘已前進 5 個 tick')
    const complete = await snapshot(page)
    expect(complete.logicalClock).toBe(15); expect(complete.scheduler.tasks).toEqual([])
    expect(complete.jobs.find(item => item.id === 'job-0018')?.state).toBe('succeeded')
    expect(complete.entities.requests.find(item => item.id === 'req-0014')?.state).toBe('fulfilled')
    expect(complete.entities.releases.find(item => item.id === 'release-0012')?.state).toBe('succeeded')
    expect(complete.entities.changes.find(item => item.id === 'change-0016')?.state).toBe('succeeded')
    expect(complete.entities.resourceObjects.filter(item => item.name === 'migration-w2-events')).toHaveLength(1)
    await page.reload(); await expect(page.getByTestId('logical-clock')).toContainText('15'); expect(await snapshot(page)).toEqual(complete)
    await page.goto('ops/requests/req-0014'); await expect(page.getByRole('heading', { level: 1 })).toContainText('已完成')
    await page.goto('ops/releases/release-0012'); await expect(page.getByRole('heading', { level: 1 })).toContainText('成功')
    await info.attach('w2-upgrade-lineage', { body: JSON.stringify({ fixtureSha256: createHash('sha256').update(bytes).digest('hex'), migrated, complete }), contentType: 'application/json' })
  } finally { await verifyBrowserHealth(page, info, health) }
})

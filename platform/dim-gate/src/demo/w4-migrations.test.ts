import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { legacySnapshotV3Schema, type LegacySnapshotV3 } from '../domain/schema-models'
import { createController, SNAPSHOT_KEY, type DemoController, type StorageLike } from './controller'
import { createSeed } from './seed'

const fixture = readFileSync(new URL('./seed/fixtures/w3-active-session.json', import.meta.url), 'utf8')
const originalBytes = fixture.trimEnd()
const original = JSON.parse(originalBytes) as {
  snapshot: LegacySnapshotV3; personaId: string; tabOwnershipId: string; identityEpoch: number; generation: number;
}
function harness(bytes = originalBytes, maxBytes?: number) {
  let raw = bytes, writes = 0, fail = false
  const storage: StorageLike = { getItem: key => { expect(key).toBe(SNAPSHOT_KEY); return raw },
    setItem: (key, value) => { expect(key).toBe(SNAPSHOT_KEY); if (fail) throw new Error('QuotaExceededError'); raw = value; writes++ } }
  return { start: () => createController({ storage, maxBytes, createSessionId: () => 'w4-migration-reset' }),
    fail: () => { fail = true }, restore: () => { fail = false }, get raw() { return raw }, get writes() { return writes } }
}
const identity = (c: DemoController) => { const session = c.getSession(); return c.authenticate(session.sessionId, session.user.id) }
const corrupt = (mutate: (value: typeof original) => void) => { const value = structuredClone(original); mutate(value); return JSON.stringify(value) }
const newCollections = ['monitorPolicies', 'alertRules', 'sloPolicies', 'silences', 'alertEvaluations', 'notificationDeliveries', 'infrastructureIncidents'] as const

describe('W4 strict atomic migration of accepted W3 bytes', () => {
  it('preserves every old row, execution, receipt and envelope identity while adding safe W4 routes and empty collections', () => {
    expect(createHash('sha256').update(fixture).digest('hex')).toBe('8d8271b06a5a114d4e218cdae2dae8315d6d8988cdebbe3091bb29ad1583c0a8')
    expect(legacySnapshotV3Schema.parse(original.snapshot)).toEqual(original.snapshot)
    const h = harness(), c = h.start(), migrated = c.getSnapshot()
    expect(migrated).toMatchObject({ schemaVersion: 4, seedVersion: 'dim-gate-w4-v1' })
    expect(h.writes).toBe(1)
    for (const [key, value] of Object.entries(original.snapshot)) {
      if (!['schemaVersion', 'seedVersion', 'entities', 'observations'].includes(key)) expect(migrated[key as keyof typeof migrated]).toEqual(value)
    }
    for (const [key, value] of Object.entries(original.snapshot.entities)) {
      const result = migrated.entities[key as keyof typeof original.snapshot.entities]
      if (key === 'navigation') expect(result.slice(0, value.length)).toEqual(value)
      else expect(result).toEqual(value)
    }
    expect(migrated.entities.navigation).toHaveLength(original.snapshot.entities.navigation.length + 3)
    expect(migrated.observations).toEqual({ ...original.snapshot.observations, infrastructureMetrics: [] })
    for (const key of newCollections) expect(migrated.entities[key]).toEqual([])
    expect(migrated.scheduler.tasks).toEqual(original.snapshot.scheduler.tasks)
    expect(migrated.entities.serviceExecutions).toEqual(original.snapshot.entities.serviceExecutions)
    expect({ ...JSON.parse(h.raw), snapshot: null }).toEqual({ ...original, snapshot: null })
    expect(c.getTabOwnershipId()).toBe(original.tabOwnershipId)
    expect(c.getSession()).toMatchObject({ user: { id: original.personaId }, identityEpoch: original.identityEpoch, generation: original.generation })
    const firstBytes = h.raw
    expect(h.start().getSnapshot()).toEqual(migrated)
    expect(h.raw).toBe(firstBytes); expect(h.writes).toBe(2)
  })

  it('resumes an in-flight W3 config exactly once, then replays the persisted receipt after refresh', async () => {
    const h = harness(), c = h.start(), running = original.snapshot.entities.serviceExecutions[0]
    expect(running.state).toBe('running')
    expect(c.getSnapshot().scheduler.tasks.some(row => row.operationId === running.id)).toBe(true)
    const receipt = await c.command('POST', '/clock/advance', { ticks: 3 }, 'w4-resume-old-execution', identity(c))
    const finished = c.getSnapshot()
    expect(finished.entities.serviceExecutions).toHaveLength(1)
    expect(finished.entities.serviceExecutions[0]).toMatchObject({ id: running.id, state: 'succeeded' })
    expect(finished.entities.serviceConfigs.find(row => row.id === running.sourceId)?.state).toBe('active')
    expect(finished.scheduler.tasks.some(row => row.operationId === running.id)).toBe(false)
    const reload = h.start(), bytes = h.raw
    expect(await reload.command('POST', '/clock/advance', { ticks: 3 }, 'w4-resume-old-execution', identity(reload))).toEqual(receipt)
    expect(reload.getSnapshot()).toEqual(finished); expect(h.raw).toBe(bytes)
  })

  it.each([
    ['v4 rows disguised as W3', (s: typeof original) => { Object.assign(s.snapshot.entities, { alertRules: [] }) }],
    ['v4 observations disguised as W3', (s: typeof original) => { Object.assign(s.snapshot.observations, { infrastructureMetrics: [] }) }],
    ['v4 route disguised as W3', (s: typeof original) => { s.snapshot.entities.navigation[0].routeKey = 'ops.alerting' as never }],
    ['wrong seed marker', (s: typeof original) => { Object.assign(s.snapshot, { seedVersion: 'dim-gate-w4-v1' }) }],
    ['invalid scheduler position', (s: typeof original) => { s.snapshot.scheduler.tasks[0].stepIndex = 99 }],
    ['dangling config requester', (s: typeof original) => { s.snapshot.entities.serviceConfigs[0].requesterId = 'missing-user' }],
    ['forged W4 field in an old revision', (s: typeof original) => { Object.assign(s.snapshot.entities.serviceConfigs[0], { ruleRevision: 9 }) }],
    ['reserved W4 navigation ID collision', (s: typeof original) => { s.snapshot.entities.navigation[0].id = 'nav-rd-monitoring' }],
  ] as const)('rejects %s with original bytes intact', (_name, mutate) => {
    const bytes = corrupt(mutate), h = harness(bytes)
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_INCOMPATIBLE' }))
    expect(h.raw).toBe(bytes); expect(h.writes).toBe(0)
  })

  it('preserves bytes on storage quota failure and later performs one valid upgrade', () => {
    const h = harness(); h.fail()
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_STORAGE_UNAVAILABLE' }))
    expect(h.raw).toBe(originalBytes); expect(h.writes).toBe(0)
    h.restore(); expect(h.start().getSnapshot().schemaVersion).toBe(4); expect(h.writes).toBe(1)
    const bounded = harness(originalBytes, new TextEncoder().encode(originalBytes).byteLength + 1)
    expect(bounded.start).toThrow(expect.objectContaining({ code: 'DEMO_STORAGE_UNAVAILABLE' }))
    expect(bounded.raw).toBe(originalBytes); expect(bounded.writes).toBe(0)
  })

  it('starts a fresh v4 session with no fabricated alerts, incidents, approvals or deliveries', () => {
    const seed = createSeed('w4-fresh-seed')
    expect(seed).toMatchObject({ schemaVersion: 4, seedVersion: 'dim-gate-w4-v1' })
    for (const key of newCollections) expect(seed.entities[key]).toEqual([])
    expect(seed.observations.infrastructureMetrics).toEqual([])
    expect(seed.entities.incidents).toEqual([])
    expect(seed.entities.navigation.filter(row => ['rd.monitoring', 'rd.alerts', 'ops.alerting'].includes(row.routeKey)).map(row => row.routeKey)).toEqual(['rd.monitoring', 'rd.alerts', 'ops.alerting'])
  })
})

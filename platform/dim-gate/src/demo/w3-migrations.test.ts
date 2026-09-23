import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { legacySnapshotV2Schema, type LegacySnapshotV2 } from '../domain/schemas'
import { createController, SNAPSHOT_KEY, type DemoController, type StorageLike } from './controller'

const file = readFileSync(new URL('./seed/fixtures/w2-active-session.json', import.meta.url), 'utf8')
const originalBytes = file.trimEnd()
const original = JSON.parse(originalBytes) as {
  snapshot: LegacySnapshotV2; personaId: string; tabOwnershipId: string; identityEpoch: number; generation: number;
  personaCommands: Array<{ sessionId: string; actorId: string; key: string; body: string; session: unknown }>;
  resetTombstone: { sessionId: string; actorId: string; key: string; session: unknown };
}
function harness(bytes = originalBytes, maxBytes?: number) {
  let raw = bytes, writes = 0, fail = false
  const storage: StorageLike = { getItem: key => { expect(key).toBe(SNAPSHOT_KEY); return raw },
    setItem: (key, value) => { expect(key).toBe(SNAPSHOT_KEY); if (fail) throw new Error('QuotaExceededError'); raw = value; writes++ } }
  return { start: () => createController({ storage, maxBytes, createSessionId: () => 'w3-migration-reset' }), storage,
    fail: () => { fail = true }, restore: () => { fail = false }, get raw() { return raw }, get writes() { return writes } }
}
const identity = (c: DemoController) => { const s = c.getSession(); return c.authenticate(s.sessionId, s.user.id) }
function altered(mutate: (value: typeof original) => void) { const value = structuredClone(original); mutate(value); return JSON.stringify(value) }

describe('W3 atomic migration of genuine accepted W2 bytes', () => {
  it('proves fixture provenance and preserves all W2 rows, work, decisions, IDs and envelope identity', () => {
    expect(createHash('sha256').update(file).digest('hex')).toBe('2180e098e84bdcccaa35c6573d623577985b2480b780e30a1302965078e6607b')
    expect(legacySnapshotV2Schema.parse(original.snapshot)).toEqual(original.snapshot)
    const h = harness(), c = h.start(), migrated = c.getSnapshot()
    expect(migrated).toMatchObject({ schemaVersion: 3, seedVersion: 'dim-gate-w3-v1' })
    expect(h.writes).toBe(1)
    for (const [key, value] of Object.entries(original.snapshot)) {
      if (!['schemaVersion', 'seedVersion', 'entities'].includes(key)) expect(migrated[key as keyof typeof migrated]).toEqual(value)
    }
    for (const [key, value] of Object.entries(original.snapshot.entities)) expect(migrated.entities[key as keyof typeof original.snapshot.entities]).toEqual(value)
    for (const key of ['pipelineDefinitions', 'serviceConfigs', 'trafficPolicies', 'serviceExecutions'] as const) expect(migrated.entities[key]).toEqual([])
    expect({ ...JSON.parse(h.raw), snapshot: null }).toEqual({ ...original, snapshot: null })
    expect(c.getTabOwnershipId()).toBe(original.tabOwnershipId)
    expect(c.getSession()).toMatchObject({ user: { id: original.personaId }, identityEpoch: original.identityEpoch, generation: original.generation })
    const firstBytes = h.raw
    expect(h.start().getSnapshot()).toEqual(migrated)
    expect(h.raw).toBe(firstBytes)
  })

  it('resumes resource execution, Release and ProvisionJob once with retained reservations and planned IDs', async () => {
    const h = harness(), c = h.start()
    const change = original.snapshot.entities.changes[0], execution = original.snapshot.entities.changeExecutions[0]
    const candidate = original.snapshot.entities.releases.find(row => row.state === 'deploying')!, job = original.snapshot.jobs[0]
    expect(c.getSnapshot().scheduler.tasks).toHaveLength(3)
    const receipt = await c.command('POST', '/clock/advance', { ticks: 4 }, 'w3-migration-resume', identity(c))
    const finished = c.getSnapshot()
    expect(finished.entities.changes.find(row => row.id === change.id)).toMatchObject({ state: 'succeeded', latestExecutionId: execution.id })
    expect(finished.entities.changeExecutions).toHaveLength(1)
    expect(finished.entities.resourceObjects).toHaveLength(original.snapshot.entities.resourceObjects.length + 1)
    expect(finished.entities.resourceBindings).toHaveLength(original.snapshot.entities.resourceBindings.length + 1)
    expect(finished.entities.releases.find(row => row.id === candidate.id)?.state).toBe('succeeded')
    expect(finished.jobs.find(row => row.id === job.id)).toMatchObject({ state: 'succeeded', plannedCiIds: job.plannedCiIds })
    expect(finished.entities.cis.filter(row => job.plannedCiIds.includes(row.id))).toHaveLength(job.plannedCiIds.length)
    expect(finished.scheduler.tasks).toEqual([])
    const reload = h.start(), before = h.raw
    expect(await reload.command('POST', '/clock/advance', { ticks: 4 }, 'w3-migration-resume', identity(reload))).toEqual(receipt)
    expect(h.raw).toBe(before)
    expect(reload.getSnapshot()).toEqual(finished)
  })

  it('preserves original replay receipts across atomic migration without duplicate work', async () => {
    const h = harness(), c = h.start(), before = h.raw
    const receipt = original.snapshot.idempotency.find(row => row.key === 'w2-active-step')!
    expect(await c.command(receipt.method, receipt.path, JSON.parse(receipt.canonicalBody), receipt.key, identity(c))).toEqual(receipt.receipt)
    const persona = original.personaCommands.find(row => row.key === 'w2-to-ops')!
    expect(await c.setPersona(JSON.parse(persona.body).personaId, persona.key, c.authenticate(persona.sessionId, persona.actorId))).toEqual({ session: persona.session })
    const reset = original.resetTombstone
    expect(await c.reset(reset.key, c.authenticate(reset.sessionId, reset.actorId, true))).toEqual({ session: reset.session })
    expect(h.raw).toBe(before)
    expect(h.writes).toBe(1)
  })

  it.each([
    ['new collections hidden under V2', (s: typeof original) => { Object.assign(s.snapshot.entities, { serviceConfigs: [] }) }],
    ['new pipeline metadata hidden under V2', (s: typeof original) => { Object.assign(s.snapshot.entities.pipelines[0], { definitionId: 'forged' }) }],
    ['new route hidden under V2', (s: typeof original) => { Object.assign(s.snapshot.entities.navigation[0], { routeKey: 'rd.configuration' }) }],
    ['wrong seed version', (s: typeof original) => { Object.assign(s.snapshot, { seedVersion: 'dim-gate-w3-v1' }) }],
    ['invalid scheduler position', (s: typeof original) => { s.snapshot.scheduler.tasks[0].stepIndex = 99 }],
    ['dangling binding', (s: typeof original) => { s.snapshot.entities.resourceBindings[0].resourceObjectId = 'missing-resource' }],
    ['dangling requester', (s: typeof original) => { s.snapshot.entities.changes[0].requesterId = 'missing-user' }],
  ] as const)('refuses %s without any write or byte loss', (_name, mutate) => {
    const bytes = altered(mutate), h = harness(bytes)
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_INCOMPATIBLE' }))
    expect(h.raw).toBe(bytes); expect(h.writes).toBe(0)
  })

  it('retains original bytes on quota failure and succeeds only after a later atomic write', () => {
    const h = harness(); h.fail()
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_STORAGE_UNAVAILABLE' }))
    expect(h.raw).toBe(originalBytes); expect(h.writes).toBe(0)
    h.restore(); expect(h.start().getSnapshot().schemaVersion).toBe(3); expect(h.writes).toBe(1)
  })

  it('keeps corrupt bytes during explicit memory recovery and resets only when requested', () => {
    const h = harness('{broken')
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_CORRUPT' }))
    const memory = createController({ storage: h.storage, createSessionId: () => 'w3-memory', mode: 'memory' })
    expect(memory.getSnapshot().schemaVersion).toBe(3); expect(h.raw).toBe('{broken'); expect(h.writes).toBe(0)
    const reset = createController({ storage: h.storage, createSessionId: () => 'w3-reset', recovery: 'reset' })
    expect(reset.getSnapshot().entities.cis).toHaveLength(63); expect(h.writes).toBe(1)
    expect(reset.getSnapshot().scheduler.tasks).toEqual([])
  })
})

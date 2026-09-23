import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createController, SNAPSHOT_KEY, type DemoController, type StorageLike } from './controller'
import { legacySnapshotSchema, type LegacySnapshot } from '../domain/schemas'

// Actual W1 storage captured by canonical commands; recipe and fixed-source SHA
// live beside the fixture. No direct store mutation fabricates successful work.
const legacyBytes = readFileSync(new URL('./seed/fixtures/w1-active-session.json', import.meta.url), 'utf8').trimEnd()
const original = JSON.parse(legacyBytes) as {
  formatVersion: number; snapshot: LegacySnapshot; tabOwnershipId: string; personaId: string;
  identityEpoch: number; generation: number; personaCommands: Array<{
    sessionId: string; actorId: string; key: string; body: string; session: unknown;
  }>; resetTombstone: { sessionId: string; actorId: string; key: string; session: unknown };
}
function harness(initial = legacyBytes, maxBytes?: number) {
  let raw = initial, writes = 0, failWrite = false, nextSession = 0
  const storage: StorageLike = {
    getItem: key => { expect(key).toBe(SNAPSHOT_KEY); return raw },
    setItem: (key, value) => { expect(key).toBe(SNAPSHOT_KEY); if (failWrite) throw new Error('QuotaExceededError'); raw = value; writes++ },
  }
  const start = () => createController({ storage, createSessionId: () => `migration-new-${++nextSession}`, maxBytes })
  return { storage, start, fail: () => { failWrite = true }, restore: () => { failWrite = false }, get raw() { return raw }, get writes() { return writes } }
}
const identity = (c: DemoController) => { const s = c.getSession(); return c.authenticate(s.sessionId, s.user.id) }

function altered(mutate: (saved: typeof original) => void): string {
  const copy = structuredClone(original); mutate(copy); return JSON.stringify(copy)
}

describe('W2 validated atomic W1 migration', () => {
  it('preserves exact original IDs/history/clock/identity and adds only metadata in one write', () => {
    expect(legacySnapshotSchema.parse(original.snapshot)).toEqual(original.snapshot)
    const h = harness(), c = h.start(), migrated = c.getSnapshot()
    expect(h.writes).toBe(1)
    expect(migrated).toMatchObject({ schemaVersion: 4, seedVersion: 'dim-gate-w4-v1' })
    for (const [key, value] of Object.entries(original.snapshot)) {
      if (!['schemaVersion', 'seedVersion', 'entities', 'observations'].includes(key)) expect(migrated[key as keyof typeof migrated]).toEqual(value)
    }
    expect(migrated.observations).toEqual({ ...original.snapshot.observations, infrastructureMetrics: [] })
    for (const [key, collection] of Object.entries(original.snapshot.entities)) {
      const result = migrated.entities[key as keyof typeof original.snapshot.entities]
      if (['cis', 'catalogs', 'navigation'].includes(key)) expect(result.slice(0, collection.length)).toEqual(collection)
      else expect(result).toEqual(collection)
    }
    expect(migrated.entities.cis).toHaveLength(original.snapshot.entities.cis.length + 3)
    expect(migrated.entities.catalogs).toHaveLength(original.snapshot.entities.catalogs.length + 2)
    expect(migrated.entities.navigation).toHaveLength(original.snapshot.entities.navigation.length + 6)
    expect(migrated.entities.resourceQuotas).toHaveLength(3)
    expect(migrated.entities.resourceObjects).toEqual([])
    expect(migrated.entities.resourceBindings).toEqual([])
    expect(migrated.entities.changes).toEqual([])
    expect(migrated.entities.changeExecutions).toEqual([])
    for (const key of ['monitorPolicies', 'alertRules', 'sloPolicies', 'silences', 'alertEvaluations', 'notificationDeliveries', 'infrastructureIncidents'] as const) expect(migrated.entities[key]).toEqual([])
    const envelope = JSON.parse(h.raw)
    expect({ ...envelope, snapshot: null }).toEqual({ ...original, snapshot: null })
    expect(c.getSession()).toMatchObject({ user: { id: original.personaId }, identityEpoch: original.identityEpoch,
      generation: original.generation, logicalClock: original.snapshot.logicalClock })
    expect(c.getTabOwnershipId()).toBe(original.tabOwnershipId)
    expect(c.getPersonas().map(p => p.id)).toEqual(['user-rd-commerce', 'user-rd-data', 'user-ops', 'user-admin'])
    const committedBytes = h.raw
    expect(h.start().getSnapshot()).toEqual(migrated)
    expect(h.raw).toBe(committedBytes)
    expect(h.writes).toBe(2)
  })

  it('resumes active Release and ProvisionJob with their original IDs and completes each only once', async () => {
    const h = harness(), c = h.start()
    const candidate = original.snapshot.entities.releases.find(r => r.state === 'deploying')!
    const request = original.snapshot.entities.requests[0], job = original.snapshot.jobs[0]
    const receipt = await c.command('POST', '/clock/advance', { ticks: 4 }, 'migration-resume', identity(c))
    const finished = c.getSnapshot()
    expect(finished.entities.releases.find(r => r.id === candidate.id)?.state).toBe('succeeded')
    expect(finished.entities.environments.find(e => e.id === candidate.environmentId)?.activeReleaseId).toBe(candidate.id)
    expect(finished.entities.requests.find(r => r.id === request.id)?.state).toBe('fulfilled')
    expect(finished.jobs).toHaveLength(original.snapshot.jobs.length)
    expect(finished.jobs.find(j => j.id === job.id)).toMatchObject({ state: 'succeeded', plannedCiIds: job.plannedCiIds })
    expect(finished.entities.cis.filter(ci => job.plannedCiIds.includes(ci.id))).toHaveLength(job.plannedCiIds.length)
    expect(finished.scheduler.tasks).toEqual([])
    expect(finished.entities.resourceBindings).toEqual([])
    const reloaded = h.start(), beforeReplay = h.raw
    expect(await reloaded.command('POST', '/clock/advance', { ticks: 4 }, 'migration-resume', identity(reloaded))).toEqual(receipt)
    expect(h.raw).toBe(beforeReplay)
    expect(reloaded.getSnapshot()).toEqual(finished)
  })

  it('replays original domain/persona/reset receipts without changing migrated state', async () => {
    const h = harness(), c = h.start(), before = h.raw
    const domainReceipt = original.snapshot.idempotency.find(r => r.key === 'legacy-active-step')!
    expect(await c.command(domainReceipt.method, domainReceipt.path, JSON.parse(domainReceipt.canonicalBody), domainReceipt.key, identity(c))).toEqual(domainReceipt.receipt)
    const personaReceipt = original.personaCommands.find(r => r.key === 'legacy-to-ops')!
    const oldPersonaIdentity = c.authenticate(personaReceipt.sessionId, personaReceipt.actorId)
    expect(await c.setPersona(JSON.parse(personaReceipt.body).personaId, personaReceipt.key, oldPersonaIdentity)).toEqual({ session: personaReceipt.session })
    const tombstone = original.resetTombstone
    expect(await c.reset(tombstone.key, c.authenticate(tombstone.sessionId, tombstone.actorId, true))).toEqual({ session: tombstone.session })
    expect(h.raw).toBe(before)
    expect(h.writes).toBe(1)
  })

  it.each([
    ['unknown schema', (s: typeof original) => { Object.assign(s.snapshot, { schemaVersion: 999 }) }],
    ['old M1 seed', (s: typeof original) => { Object.assign(s.snapshot, { seedVersion: 'dim-gate-m1-v1' }) }],
    ['old M2 seed', (s: typeof original) => { Object.assign(s.snapshot, { seedVersion: 'dim-gate-m2-v1' }) }],
    ['old M3 seed', (s: typeof original) => { Object.assign(s.snapshot, { seedVersion: 'dim-gate-m3-v1' }) }],
    ['new collections under v1', (s: typeof original) => { Object.assign(s.snapshot.entities, { resourceObjects: [] }) }],
    ['new catalog under v1', (s: typeof original) => { Object.assign(s.snapshot.entities.catalogs[0].template, { resourceKind: 'redis' }) }],
    ['new route under v1', (s: typeof original) => { Object.assign(s.snapshot.entities.navigation[0], { routeKey: 'ops.caches' }) }],
    ['broken original relationship', (s: typeof original) => { s.snapshot.entities.applications[0].ownerTeamId = 'missing-team' }],
    ['new metadata would rescue corrupt relation', (s: typeof original) => { s.snapshot.entities.placements[0].ciId = 'w2-ci-kafka-idc' }],
    ['invalid active work position', (s: typeof original) => { s.snapshot.scheduler.tasks.find(t => t.operationId.startsWith('release-'))!.stepIndex = 99 }],
    ['reserved ID collision', (s: typeof original) => { s.snapshot.entities.cis.find(ci => ci.id === 'ci-aws-20')!.id = 'w2-ci-kafka-idc' }],
    ['incompatible legacy Redis engine', (s: typeof original) => { s.snapshot.entities.cis.find(ci => ci.id === 'ci-idc-redis-01')!.attributes.engine = 'memcached' }],
    ['canonical metadata identity collision', (s: typeof original) => {
      const ci = s.snapshot.entities.cis.find(ci => ci.id === 'ci-aws-20')!
      ci.kind = 'queue'; ci.externalId = 'w2-kafka-aws-demo'
      ci.attributes = { engine: 'kafka', versionLabel: '3-demo', endpointLabel: 'legacy.example.invalid' }
    }],
    ['invalid persona', (s: typeof original) => { s.personaId = 'missing-persona' }],
    ['disabled persona', (s: typeof original) => { s.snapshot.entities.users.find(u => u.id === s.personaId)!.enabled = false }],
  ] as const)('retains all original bytes and performs no write for %s', (_name, mutate) => {
    const raw = altered(mutate), h = harness(raw)
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_INCOMPATIBLE' }))
    expect(h.raw).toBe(raw)
    expect(h.writes).toBe(0)
  })

  it('preserves old bytes on quota failure and migrates only after a later successful atomic write', () => {
    const h = harness(); h.fail()
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_STORAGE_UNAVAILABLE' }))
    expect(h.raw).toBe(legacyBytes)
    expect(h.writes).toBe(0)
    h.restore()
    expect(h.start().getSnapshot().schemaVersion).toBe(4)
    expect(h.writes).toBe(1)
  })

  it('retains original bytes when additive migration exceeds the total envelope budget', () => {
    const h = harness(legacyBytes, new TextEncoder().encode(legacyBytes).byteLength + 1)
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_STORAGE_UNAVAILABLE' }))
    expect(h.raw).toBe(legacyBytes)
    expect(h.writes).toBe(0)
  })

  it('keeps corrupt bytes in explicit memory recovery and replaces only on explicit reset', () => {
    const h = harness('{broken')
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_CORRUPT' }))
    expect(h.raw).toBe('{broken')
    const memory = createController({ storage: h.storage, createSessionId: () => 'migration-memory', mode: 'memory' })
    expect(memory.getSnapshot().entities.cis).toHaveLength(63)
    expect(memory.getSession().storageMode).toBe('memory')
    expect(h.raw).toBe('{broken')
    expect(h.writes).toBe(0)
    const reset = createController({ storage: h.storage, createSessionId: () => 'migration-reset', recovery: 'reset' })
    expect(reset.getSnapshot().schemaVersion).toBe(4)
    expect(reset.getSnapshot().scheduler.tasks).toEqual([])
    expect(h.writes).toBe(1)
  })
})

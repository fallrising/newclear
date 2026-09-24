import { describe, expect, it } from 'vitest'
import { legacySnapshotV4Schema } from '../domain/schema-models'
import { legacyV4IntegrityErrors } from '../domain/integrity'
import { createController, SNAPSHOT_KEY, type StorageLike } from './controller'
import { createSeed } from './seed'
import { readStoredSnapshot } from './migrations'

function legacyBytes() {
  const current = createSeed('w5-migrate-session')
  const { platformFeatures: _platformFeatures, platformRoutes: _platformRoutes, channels: _channels,
    notificationTemplates: _notificationTemplates, notificationPolicies: _notificationPolicies,
    notificationSubscriptions: _notificationSubscriptions, notificationAttempts: _notificationAttempts, ...oldEntities } = current.entities
  void _platformFeatures; void _platformRoutes; void _channels; void _notificationTemplates; void _notificationPolicies
  void _notificationSubscriptions; void _notificationAttempts
  const snapshot = legacySnapshotV4Schema.parse({ ...current, schemaVersion: 4, seedVersion: 'dim-gate-w4-v1',
    entities: { ...oldEntities,
      users: current.entities.users.map(({ source: _source, ...user }) => { void _source; return user }),
      teams: current.entities.teams.map(({ source: _source, ...team }) => { void _source; return team }),
    } })
  return JSON.stringify({ formatVersion: 1, snapshot, tabOwnershipId: snapshot.sessionId,
    personaId: 'user-admin', identityEpoch: 0, generation: 0, personaCommands: [], resetTombstone: null })
}

function harness(bytes = legacyBytes()) {
  let raw = bytes, writes = 0, failWrite = false
  const storage: StorageLike = {
    getItem: key => { expect(key).toBe(SNAPSHOT_KEY); return raw },
    setItem: (key, value) => { expect(key).toBe(SNAPSHOT_KEY); if (failWrite) throw new Error('QuotaExceededError'); raw = value; writes++ },
  }
  return { start: () => createController({ storage, createSessionId: () => 'w5-reset' }),
    fail: () => { failWrite = true }, restore: () => { failWrite = false }, get raw() { return raw }, get writes() { return writes } }
}

describe('W5 strict atomic W4 snapshot migration', () => {
  it('checks the original W4 snapshot before W5 defaults and preserves additional legacy identities', () => {
    const original = JSON.parse(legacyBytes()).snapshot
    original.entities.organizations.unshift({ ...original.entities.organizations[0], id: 'org-another', name: 'Another enterprise' })
    original.entities.teams.push({ ...original.entities.teams[0], id: 'team-legacy-extra', name: 'Legacy team' })
    original.entities.users.push({ ...original.entities.users[0], id: 'user-legacy-extra', displayName: 'Legacy user', teamIds: ['team-legacy-extra'] })
    const parsed = legacySnapshotV4Schema.parse(original)
    expect(legacyV4IntegrityErrors(parsed)).toEqual([])
    const migrated = readStoredSnapshot(parsed)
    expect(migrated.entities.channels.find(row => row.id === 'demo-rd')).toMatchObject({ orgId: 'org-demo' })
    expect(migrated.entities.teams.find(row => row.id === 'team-legacy-extra')).toMatchObject({ source: 'demo' })
    expect(migrated.entities.users.find(row => row.id === 'user-legacy-extra')).toMatchObject({ source: 'demo' })
  })

  it('preserves all old rows and receipts while adding only source metadata', () => {
    const original = JSON.parse(legacyBytes()), h = harness(), controller = h.start()
    const migrated = controller.getSnapshot()
    expect(migrated).toMatchObject({ schemaVersion: 5, seedVersion: 'dim-gate-w5-v1',
      sequence: original.snapshot.sequence, policyVersion: original.snapshot.policyVersion })
    expect(migrated.entities.users).toEqual(original.snapshot.entities.users.map((user: object) => ({ ...user, source: 'seed' })))
    expect(migrated.entities.teams).toEqual(original.snapshot.entities.teams.map((team: object) => ({ ...team, source: 'seed' })))
    for (const [key, rows] of Object.entries(original.snapshot.entities)) {
      if (key !== 'users' && key !== 'teams') expect(migrated.entities[key as keyof typeof migrated.entities]).toEqual(rows)
    }
    expect(migrated.entities.platformFeatures).toEqual([])
    expect(migrated.entities.platformRoutes).toEqual([])
    expect(migrated.entities.channels.map(row => row.id)).toEqual(['demo-rd', 'demo-ops'])
    expect(migrated.entities.notificationTemplates).toHaveLength(1)
    expect(migrated.entities.notificationPolicies).toHaveLength(1)
    expect(migrated.entities.notificationSubscriptions).toEqual([])
    expect(migrated.entities.notificationAttempts).toEqual([])
    expect(migrated.audit).toEqual(original.snapshot.audit)
    expect(migrated.idempotency).toEqual(original.snapshot.idempotency)
    expect(h.writes).toBe(1)
    const savedBytes = h.raw
    expect(h.start().getSnapshot()).toEqual(migrated)
    expect(h.raw).toBe(savedBytes)
  })

  it('rejects corrupt references and reserved Demo identity collisions before writing', () => {
    for (const mutate of [
      (value: ReturnType<typeof JSON.parse>) => { value.snapshot.entities.users[0].teamIds = ['missing-team'] },
      (value: ReturnType<typeof JSON.parse>) => { value.snapshot.entities.users.push({ ...value.snapshot.entities.users[0] }) },
      (value: ReturnType<typeof JSON.parse>) => { value.snapshot.entities.users[0].source = 'seed' },
      (value: ReturnType<typeof JSON.parse>) => { value.snapshot.entities.navigation[0].id = 'demo-rd' },
    ]) {
      const value = JSON.parse(legacyBytes()); mutate(value)
      const bytes = JSON.stringify(value), h = harness(bytes)
      expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_INCOMPATIBLE' }))
      expect(h.raw).toBe(bytes)
      expect(h.writes).toBe(0)
    }
  })

  it('rejects a reserved W5 notification ID even when its W4 navigation row is otherwise valid', () => {
    const value = JSON.parse(legacyBytes())
    value.snapshot.entities.navigation[0].id = 'demo-rd'
    expect(() => readStoredSnapshot(value.snapshot)).toThrow('reserved W5 notification identities')
  })

  it('keeps original bytes when the single upgrade write exceeds quota', () => {
    const bytes = legacyBytes(), h = harness(bytes)
    h.fail()
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_STORAGE_UNAVAILABLE' }))
    expect(h.raw).toBe(bytes)
    expect(h.writes).toBe(0)
    h.restore()
    expect(h.start().getSnapshot().schemaVersion).toBe(5)
    expect(h.writes).toBe(1)
  })
})

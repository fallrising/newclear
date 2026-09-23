import { describe, expect, it } from 'vitest'
import { legacySnapshotV4Schema } from '../domain/schema-models'
import { createController, SNAPSHOT_KEY, type StorageLike } from './controller'
import { createSeed } from './seed'

function legacyBytes() {
  const current = createSeed('w5-migrate-session')
  const snapshot = legacySnapshotV4Schema.parse({ ...current, schemaVersion: 4, seedVersion: 'dim-gate-w4-v1',
    entities: { ...current.entities,
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
      (value: ReturnType<typeof JSON.parse>) => { value.snapshot.entities.users.push({ ...value.snapshot.entities.users[0], id: 'user-demo-0001' }) },
      (value: ReturnType<typeof JSON.parse>) => { value.snapshot.entities.users[0].source = 'seed' },
    ]) {
      const value = JSON.parse(legacyBytes()); mutate(value)
      const bytes = JSON.stringify(value), h = harness(bytes)
      expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_INCOMPATIBLE' }))
      expect(h.raw).toBe(bytes)
      expect(h.writes).toBe(0)
    }
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

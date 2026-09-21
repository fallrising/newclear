import { afterEach, describe, expect, it, vi } from 'vitest'
import { createController, DemoStorageError, SNAPSHOT_KEY } from './controller'
import type { DemoController, StorageLike } from './controller'

function harness(raw?: string) {
  let stored = raw ?? null
  let failWrite = false
  let sequence = 0
  const storage: StorageLike = {
    getItem: () => stored,
    setItem: (_key, value) => { if (failWrite) throw new Error('QuotaExceededError'); stored = value },
  }
  const createSessionId = () => `test-session-${++sequence}`
  const start = () => createController({ storage, createSessionId })
  return { storage, start, createSessionId, get raw() { return stored }, fail() { failWrite = true }, restore() { failWrite = false } }
}
const identity = (controller: DemoController) => {
  const session = controller.getSession()
  return controller.authenticate(session.sessionId, session.user.id)
}
afterEach(() => vi.useRealTimers())

describe('persisted controller identity and transactions', () => {
  it('reload preserves domain state, selected persona, identity epoch and command replay', async () => {
    const h = harness()
    const first = h.start()
    const receipt = await first.command('POST', '/clock/advance', { ticks: 3 }, 'tick-one', identity(first))
    await first.setPersona('user-ops', 'switch-one', identity(first))
    const session = first.getSession()
    const reloaded = h.start()
    expect(reloaded.getSession()).toEqual(session)
    expect(reloaded.getSnapshot()).toEqual(first.getSnapshot())
    await reloaded.setPersona('user-rd-commerce', 'switch-back', identity(reloaded))
    expect(await reloaded.command('POST', '/clock/advance', { ticks: 3 }, 'tick-one', identity(reloaded))).toEqual(receipt)
    expect(reloaded.getSession().logicalClock).toBe(3)
  })

  it('failed command persistence preserves counters, entities, audit and serialized state', async () => {
    const h = harness()
    const controller = h.start()
    const snapshot = controller.getSnapshot()
    const raw = h.raw
    h.fail()
    await expect(controller.command('POST', '/clock/advance', { ticks: 2 }, 'quota-tick', identity(controller)))
      .rejects.toMatchObject({ status: 507, code: 'DEMO_STORAGE_FULL' })
    expect(controller.getSnapshot()).toEqual(snapshot)
    expect(h.raw).toBe(raw)
    h.restore()
    await controller.command('POST', '/clock/advance', { ticks: 2 }, 'quota-tick', identity(controller))
    expect(controller.getSession().logicalClock).toBe(2)
  })

  it('failed persona/reset persistence retains the active identity, data and timers', async () => {
    vi.useFakeTimers()
    const h = harness()
    const controller = h.start()
    await controller.command('POST', '/clock/advance', { ticks: 2 }, 'before-reset', identity(controller))
    const before = controller.getSession()
    const tick = vi.fn()
    controller.schedule(tick, 20)
    h.fail()
    await expect(controller.setPersona('user-ops', 'failed-switch', identity(controller))).rejects.toMatchObject({ status: 507 })
    await expect(controller.reset('failed-reset', identity(controller))).rejects.toMatchObject({ status: 507 })
    expect(controller.getSession()).toEqual(before)
    vi.advanceTimersByTime(20)
    expect(tick).toHaveBeenCalledOnce()
  })

  it('reset clears timers, changes generation, rejects old work and preserves reset replay after reload', async () => {
    vi.useFakeTimers()
    const h = harness()
    const controller = h.start()
    const before = identity(controller)
    const ownership = controller.getTabOwnershipId()
    const ghost = vi.fn()
    controller.schedule(ghost, 20)
    await controller.command('POST', '/clock/advance', { ticks: 6 }, 'pre-reset', before)
    const reset = await controller.reset('reset-key', identity(controller))
    vi.advanceTimersByTime(100)
    expect(ghost).not.toHaveBeenCalled()
    expect(reset.session).toMatchObject({ generation: 1, identityEpoch: 1, logicalClock: 0 })
    expect(reset.session.sessionId).not.toBe(before.sessionId)
    expect(controller.getTabOwnershipId()).toBe(ownership)
    await expect(controller.command('POST', '/clock/advance', { ticks: 6 }, 'ghost', before))
      .rejects.toMatchObject({ code: 'STALE_IDENTITY' })
    await controller.command('POST', '/clock/advance', { ticks: 4 }, 'new-work', identity(controller))
    const reloaded = h.start()
    expect(reloaded.getTabOwnershipId()).toBe(ownership)
    const replay = await reloaded.reset('reset-key', reloaded.authenticate(before.sessionId, before.actorId, true))
    expect(replay).toEqual(reset)
    expect(reloaded.getSession().logicalClock).toBe(4)
  })

  it('persona replay is immutable, mismatched body conflicts, old requests cannot mutate', async () => {
    const controller = harness().start()
    const old = identity(controller)
    const result = await controller.setPersona('user-ops', 'switch', old)
    expect(await controller.setPersona('user-ops', 'switch', old)).toEqual(result)
    await expect(controller.setPersona('user-admin', 'switch', old)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await expect(controller.command('POST', '/clock/advance', { ticks: 1 }, 'old-request', old)).rejects.toMatchObject({ code: 'STALE_IDENTITY' })
    expect(controller.getSession().identityEpoch).toBe(1)
  })

  it('corrupt/incompatible storage remains intact until explicit reset or memory choice', () => {
    for (const raw of ['{broken', '{"formatVersion":99}']) {
      const h = harness(raw)
      expect(h.start).toThrow(DemoStorageError)
      expect(h.raw).toBe(raw)
      const memory = createController({ storage: h.storage, createSessionId: h.createSessionId, mode: 'memory' })
      expect(memory.getSession().storageMode).toBe('memory')
      expect(h.raw).toBe(raw)
      const reset = createController({ storage: h.storage, createSessionId: h.createSessionId, recovery: 'reset' })
      expect(reset.getSession().logicalClock).toBe(0)
      expect(JSON.parse(h.raw!).formatVersion).toBe(1)
    }
  })

  it('rejects an older seed snapshot without altering it until explicit recovery', () => {
    const current = harness()
    current.start()
    const legacy = JSON.parse(current.raw!)
    legacy.snapshot.seedVersion = 'dim-gate-m1-v1'
    delete legacy.snapshot.entities.catalogs
    delete legacy.snapshot.entities.catalogHistory
    delete legacy.snapshot.entities.requests
    const raw = JSON.stringify(legacy)
    const old = harness(raw)
    expect(old.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_INCOMPATIBLE' }))
    expect(old.raw).toBe(raw)
    const recovered = createController({ storage: old.storage, createSessionId: old.createSessionId, recovery: 'reset' })
    expect(recovered.getSnapshot()).toMatchObject({ seedVersion: 'dim-gate-m2-v1' })
    expect(recovered.getSnapshot().entities.cis).toHaveLength(60)
  })

  it('read-only/unavailable storage never silently selects memory', () => {
    expect(() => createController({ storage: null, createSessionId: () => 'session-one' }))
      .toThrow(expect.objectContaining({ code: 'DEMO_STORAGE_UNAVAILABLE' }))
    const controller = createController({ storage: null, createSessionId: () => 'session-one', mode: 'memory' })
    expect(controller.getSession().storageMode).toBe('memory')
  })

  it('copied storage forks identity and state becomes independent while original remains intact', async () => {
    const h = harness()
    const original = h.start()
    await original.command('POST', '/clock/advance', { ticks: 5 }, 'original', identity(original))
    const copied = harness(h.raw!)
    const fork = createController({ storage: copied.storage, createSessionId: () => 'forked-session', forked: true })
    expect(fork.getSession().sessionId).not.toBe(original.getSession().sessionId)
    expect(fork.getTabOwnershipId()).not.toBe(original.getTabOwnershipId())
    expect(fork.getSession().logicalClock).toBe(5)
    await fork.command('POST', '/clock/advance', { ticks: 1 }, 'fork-work', identity(fork))
    expect(original.getSession().logicalClock).toBe(5)
    expect(fork.getSession().logicalClock).toBe(6)
    expect(JSON.parse(h.raw!).snapshot.sessionId).toBe(original.getSession().sessionId)
  })

  it('caps the full persisted envelope in UTF-8 bytes', () => {
    expect(() => createController({ storage: harness().storage, createSessionId: () => 'small-budget', maxBytes: 20 }))
      .toThrow(expect.objectContaining({ code: 'DEMO_STORAGE_UNAVAILABLE' }))
    expect(SNAPSHOT_KEY).toBe('dim-gate.demo.v1')
  })

  it('retains tab ownership across reset so a copy after reset still requires a fork', async () => {
    const h = harness()
    const controller = h.start()
    const claimedOwnership = controller.getTabOwnershipId()
    await controller.reset('reset-before-copy', identity(controller))
    const copy = harness(h.raw!)
    const duplicate = createController({ storage: copy.storage, createSessionId: () => 'copy-after-reset-session' })
    expect(duplicate.getTabOwnershipId()).toBe(claimedOwnership)
    expect(duplicate.getSession().sessionId).toBe(controller.getSession().sessionId)
    // Browser Web Locks reject the copied lineage; the controller then forks it.
    duplicate.forkSession()
    expect(duplicate.getTabOwnershipId()).not.toBe(claimedOwnership)
    expect(duplicate.getSession().sessionId).not.toBe(controller.getSession().sessionId)
  })
})

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
  it('preserves impossible delivery scheduler bytes until explicit recovery reset', async () => {
    const h = harness(), controller = h.start()
    await controller.command('POST', '/pipelines', { applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1, revision: 'corrupt-resume' }, 'trigger', identity(controller))
    const saved = JSON.parse(h.raw!) as { snapshot: ReturnType<typeof controller.getSnapshot> }
    saved.snapshot.scheduler.tasks[0].stepIndex = 99
    const raw = JSON.stringify(saved)
    h.storage.setItem(SNAPSHOT_KEY, raw)
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_INCOMPATIBLE' }))
    expect(h.raw).toBe(raw)
    const recovered = createController({ storage: h.storage, createSessionId: h.createSessionId, recovery: 'reset' })
    expect(recovered.getSnapshot().entities.cis).toHaveLength(60)
    expect(recovered.getSnapshot().scheduler.tasks).toEqual([])
    expect(h.raw).not.toBe(raw)
  })
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

  it.each(['dim-gate-m1-v1', 'dim-gate-m2-v1', 'dim-gate-m3-v1'])('rejects older %s bytes until explicit recovery', (seedVersion) => {
    const current = harness()
    current.start()
    const legacy = JSON.parse(current.raw!)
    legacy.snapshot.seedVersion = seedVersion
    delete legacy.snapshot.entities.catalogs
    delete legacy.snapshot.entities.catalogHistory
    delete legacy.snapshot.entities.requests
    const raw = JSON.stringify(legacy)
    const old = harness(raw)
    expect(old.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_INCOMPATIBLE' }))
    expect(old.raw).toBe(raw)
    const recovered = createController({ storage: old.storage, createSessionId: old.createSessionId, recovery: 'reset' })
    expect(recovered.getSnapshot()).toMatchObject({ seedVersion: 'dim-gate-m4-v1' })
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

  it('preserves corrupt M4 recovery bytes, resumes valid minute work, and reset removes future observations', async () => {
    const h = harness(), controller = h.start()
    let sequence = 0
    const command = (path: string, body: unknown) => controller.command('POST', path, body, `m4-${++sequence}`, identity(controller))
    const env = () => controller.getSnapshot().entities.environments.find(e => e.id === 'env-checkout-dev')!
    const deploy = async (revision: string) => {
      await command('/pipelines', { applicationId: env().applicationId, environmentId: env().id, environmentVersion: env().version, revision })
      await command('/clock/advance', { ticks: 6 })
      return controller.getSnapshot().entities.releases.find(r => r.id === env().activeReleaseId)!
    }
    const stable = await deploy('stable'), candidate = await deploy('candidate')
    await command('/scenarios', { scenarioKey: 'post-release-latency', environmentId: env().id })
    await command(`/releases/${candidate.id}/rollback`, { expectedVersion: candidate.version, environmentVersion: env().version, targetReleaseId: stable.id, reason: 'Recover service' })
    await command('/clock/advance', { ticks: 3 }); await command('/clock/advance', { ticks: 60 })
    expect(controller.getSnapshot().entities.incidents[0].recoverySamples).toBe(1)
    const reloaded = h.start()
    expect(reloaded.getSnapshot()).toEqual(controller.getSnapshot())
    await reloaded.command('POST', '/clock/advance', { ticks: 60 }, 'm4-resume', identity(reloaded))
    expect(reloaded.getSnapshot().entities.incidents[0]).toMatchObject({ state: 'open', recoverySamples: 2 })
    const saved = JSON.parse(h.raw!) as { snapshot: ReturnType<typeof controller.getSnapshot> }
    saved.snapshot.observations.recoveries[0].dueTick += 1
    const raw = JSON.stringify(saved); h.storage.setItem(SNAPSHOT_KEY, raw)
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_INCOMPATIBLE' }))
    expect(h.raw).toBe(raw)
    const memory = createController({ storage: h.storage, createSessionId: h.createSessionId, mode: 'memory' })
    expect(memory.getSnapshot().observations.recoveries).toEqual([]); expect(h.raw).toBe(raw)
    const reset = createController({ storage: h.storage, createSessionId: h.createSessionId, recovery: 'reset' })
    expect(reset.getSnapshot().observations).toEqual({ buckets: [], traces: [], logs: [], recoveries: [] })
    await reset.command('POST', '/clock/advance', { ticks: 60 }, 'after-recovery-reset', identity(reset))
    expect(reset.getSnapshot().entities.incidents).toEqual([])
    expect(reset.getSnapshot().observations.buckets).toEqual([])
  })

  it('serialization failure leaves running scheduler, receipts and all domain state unchanged', async () => {
    const h = harness(), controller = h.start()
    await controller.command('POST', '/pipelines', { applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1, revision: 'serialize-resume' }, 'serialize-trigger', identity(controller))
    await controller.command('POST', '/clock/advance', { ticks: 1 }, 'serialize-step', identity(controller))
    const before = controller.getSnapshot(), raw = h.raw
    const stringify = JSON.stringify
    const failure = vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
      if (value && typeof value === 'object' && 'formatVersion' in value) throw new TypeError('Injected serialization failure')
      return stringify(value, replacer as Parameters<typeof stringify>[1], space)
    })
    try {
      await expect(controller.command('POST', '/clock/advance', { ticks: 1 }, 'serialize-retry', identity(controller)))
        .rejects.toMatchObject({ status: 507, code: 'DEMO_STORAGE_FULL' })
      expect(controller.getSnapshot()).toEqual(before)
      expect(h.raw).toBe(raw)
    } finally { failure.mockRestore() }
    await controller.command('POST', '/clock/advance', { ticks: 1 }, 'serialize-retry', identity(controller))
    expect(controller.getSnapshot().logicalClock).toBe(before.logicalClock + 1)
    expect(controller.getSnapshot().idempotency).toHaveLength(before.idempotency.length + 1)
  })

  it('enforces the real 3 MiB UTF-8 budget atomically without dropping audit or receipt history', async () => {
    const h = harness(), controller = h.start()
    await controller.command('POST', '/pipelines', { applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1, revision: 'size-resume' }, 'size-trigger', identity(controller))
    await controller.setPersona('user-ops', 'budget-persona', identity(controller))
    const tags = Object.fromEntries(Array.from({ length: 20 }, (_, index) => ['tag-' + index, '容'.repeat(256)]))
    let rejected = false
    for (let index = 0; index < 250; index++) {
      const before = controller.getSnapshot(), raw = h.raw
      const ci = before.entities.cis.find(item => item.provider === 'aws')!
      try {
        await controller.command('PATCH', '/cis/' + ci.id, { expectedVersion: ci.version, tags }, 'large-' + index, identity(controller))
      } catch (error) {
        expect(error).toMatchObject({ status: 507, code: 'DEMO_STORAGE_FULL' })
        expect(controller.getSnapshot()).toEqual(before)
        expect(h.raw).toBe(raw)
        expect(new TextEncoder().encode(raw!).byteLength).toBeLessThanOrEqual(3 * 1024 * 1024)
        expect(before.commandCount).toBeLessThan(1000)
        expect(before.scheduler.tasks).toHaveLength(1)
        rejected = true
        break
      }
    }
    expect(rejected).toBe(true)
  }, 30_000)

  it('counts persona and domain commands together while preserving idempotent replay at the limit', async () => {
    const h = harness(), controller = h.start()
    for (let index = 0; index < 999; index++) await controller.setPersona('user-rd-commerce', 'persona-' + index, identity(controller))
    const receipt = await controller.command('POST', '/clock/advance', { ticks: 1 }, 'last-command', identity(controller))
    const before = controller.getSnapshot(), raw = h.raw, session = controller.getSession()
    expect(await controller.command('POST', '/clock/advance', { ticks: 1 }, 'last-command', identity(controller))).toEqual(receipt)
    await expect(controller.command('POST', '/clock/advance', { ticks: 1 }, 'over-limit', identity(controller)))
      .rejects.toMatchObject({ status: 429, code: 'DEMO_COMMAND_LIMIT' })
    await expect(controller.setPersona('user-ops', 'over-limit-persona', identity(controller)))
      .rejects.toMatchObject({ status: 429, code: 'DEMO_COMMAND_LIMIT' })
    expect(controller.getSnapshot()).toEqual(before)
    expect(controller.getSession()).toEqual(session)
    expect(h.raw).toBe(raw)
    await controller.reset('reset-full-session', identity(controller))
    expect(controller.getSnapshot().commandCount).toBe(0)
  }, 30_000)


})

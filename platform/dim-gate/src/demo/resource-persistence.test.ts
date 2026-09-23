import { describe, expect, it } from 'vitest'
import { createController, SNAPSHOT_KEY, type DemoController } from './controller'
import type { ChangeRequest, ResourceInventory } from '../domain/schemas'

function harness() {
  let raw: string | null = null, failWrite = false, nextSession = 0
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => {
    if (failWrite) throw new Error('QuotaExceededError')
    raw = value
  } }
  const start = () => createController({ storage, createSessionId: () => `w2-persistence-${++nextSession}` })
  return { start, storage, fail: () => { failWrite = true }, restore: () => { failWrite = false }, get raw() { return raw! } }
}
const identity = (c: DemoController) => { const s = c.getSession(); return c.authenticate(s.sessionId, s.user.id) }
const command = (c: DemoController, path: string, body: unknown, key: string) => c.command('POST', path, body, key, identity(c))
const change = (c: DemoController, id: string): ChangeRequest => c.getSnapshot().entities.changes.find(item => item.id === id)!
async function execute(c: DemoController, kind: 'redis' | 'kafka') {
  const input = {
    catalogItemId: kind === 'redis' ? 'w2-catalog-redis' : 'w2-catalog-kafka', catalogRevision: 1,
    reason: 'Persisted resource execution resume', targetCiId: kind === 'redis' ? 'ci-idc-redis-01' : 'w2-ci-kafka-idc', targetCiVersion: 1,
    applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1,
    ...(kind === 'redis' ? { kind: 'resource.bind', mode: 'create', quotaMiB: 512, purpose: 'runtime', accessProfileRef: 'w2-profile-redis-runtime' }
      : { kind: 'kafka.topic.create', topicName: 'persistence-events', partitions: 3, retentionHours: 72, throughputKiBPerSecond: 512, purpose: 'producer', accessProfileRef: 'w2-profile-kafka-producer' }),
  }
  const created = await command(c, '/changes', input, 'resource-create')
  await command(c, `/changes/${created.entityId}/submit`, { expectedVersion: created.entityVersion }, 'resource-submit')
  await c.setPersona('user-ops', 'resource-to-ops', identity(c))
  await command(c, `/changes/${created.entityId}/approve`, { expectedVersion: change(c, created.entityId).version, reason: 'Independent scope and quota verified' }, 'resource-approve')
  const receipt = await command(c, `/changes/${created.entityId}/execute`, { expectedVersion: change(c, created.entityId).version }, 'resource-execute')
  return { changeId: created.entityId, receipt }
}

describe('W2 resource execution persistence boundary', () => {
  it.each(['redis', 'kafka'] as const)('resumes %s execution with original planned IDs, reservation and one terminal result', async kind => {
    const h = harness(), first = h.start(), initial = first.getSnapshot()
    const { changeId, receipt } = await execute(first, kind)
    await command(first, '/clock/advance', { ticks: 2 }, 'resource-midpoint')
    const active = first.getSnapshot(), planned = change(first, changeId)
    const inventory = first.read(`/resource-inventory/${planned.spec.targetCiId}`, new URLSearchParams(), identity(first)) as ResourceInventory
    expect(inventory.capacity?.dimensions).toEqual(expect.arrayContaining(kind === 'redis'
      ? [expect.objectContaining({ name: 'quotaMiB', used: 3072, reserved: 512, observed: null })]
      : [expect.objectContaining({ name: 'topics', used: 1, reserved: 1, observed: null }), expect.objectContaining({ name: 'partitions', used: 3, reserved: 3, observed: null })]))
    expect(planned.state).toBe('executing')
    expect(active.entities.resourceObjects).toEqual(initial.entities.resourceObjects)
    expect(active.entities.resourceBindings).toEqual(initial.entities.resourceBindings)
    const reloaded = h.start()
    expect(reloaded.getSnapshot()).toEqual(active)
    expect(reloaded.getSession()).toEqual(first.getSession())
    await command(reloaded, '/clock/advance', { ticks: 3 }, 'resource-complete')
    const final = reloaded.getSnapshot()
    expect(change(reloaded, changeId)).toMatchObject({ state: 'succeeded', latestExecutionId: receipt.operationId,
      plannedObjectIds: planned.plannedObjectIds, plannedBindingIds: planned.plannedBindingIds })
    expect(final.entities.changeExecutions).toHaveLength(1)
    expect(final.entities.changeExecutions[0]).toMatchObject({ id: receipt.operationId, state: 'succeeded', attempt: 1 })
    expect(final.entities.resourceObjects.filter(o => planned.plannedObjectIds.includes(o.id))).toHaveLength(1)
    expect(final.entities.resourceBindings.filter(b => planned.plannedBindingIds.includes(b.id))).toHaveLength(1)
    expect(final.scheduler.tasks).toEqual([])
    const finalInventory = reloaded.read(`/resource-inventory/${planned.spec.targetCiId}`, new URLSearchParams(), identity(reloaded)) as ResourceInventory
    expect(finalInventory.capacity?.dimensions.every(d => d.reserved === 0 && d.observed === null)).toBe(true)
    expect(finalInventory.capacity?.dimensions.find(d => d.name === (kind === 'redis' ? 'quotaMiB' : 'topics'))?.used).toBe(kind === 'redis' ? 3584 : 2)
    const completeBytes = h.raw, once = h.start()
    expect(await command(once, `/changes/${changeId}/execute`, { expectedVersion: receipt.entityVersion - 1 }, 'resource-execute')).toEqual(receipt)
    expect(h.raw).toBe(completeBytes)
    expect(once.getSnapshot()).toEqual(final)
  })

  it.each(['redis', 'kafka'] as const)('keeps %s execution and quota unchanged when its terminal storage write fails', async kind => {
    const h = harness(), c = h.start(), { changeId } = await execute(c, kind)
    await command(c, '/clock/advance', { ticks: 2 }, 'resource-midpoint')
    const active = c.getSnapshot(), raw = h.raw
    h.fail()
    await expect(command(c, '/clock/advance', { ticks: 3 }, 'resource-atomic-complete')).rejects.toMatchObject({ status: 507, code: 'DEMO_STORAGE_FULL' })
    expect(c.getSnapshot()).toEqual(active)
    expect(h.raw).toBe(raw)
    expect(change(c, changeId).state).toBe('executing')
    h.restore()
    await command(c, '/clock/advance', { ticks: 3 }, 'resource-atomic-complete')
    expect(change(c, changeId).state).toBe('succeeded')
    expect(h.start().getSnapshot()).toEqual(c.getSnapshot())
    expect(c.getSnapshot().entities.changeExecutions).toHaveLength(1)
  })

  it('preserves failure history across reload and requires a new decision before retry execution', async () => {
    const h = harness(), c = h.start(), before = c.getSnapshot(), { changeId, receipt } = await execute(c, 'kafka')
    await command(c, '/scenarios', { scenarioKey: 'resource-failure', executionId: receipt.operationId }, 'resource-fault')
    await command(c, '/clock/advance', { ticks: 3 }, 'resource-fail')
    expect(change(c, changeId).state).toBe('failed')
    const released = c.read('/resource-inventory/w2-ci-kafka-idc', new URLSearchParams(), identity(c)) as ResourceInventory
    expect(released.capacity?.dimensions.every(d => d.reserved === 0)).toBe(true)
    expect(c.getSnapshot().entities.resourceObjects).toEqual(before.entities.resourceObjects)
    expect(c.getSnapshot().entities.resourceBindings).toEqual(before.entities.resourceBindings)
    const failed = c.getSnapshot(), reloaded = h.start()
    expect(reloaded.getSnapshot()).toEqual(failed)
    await reloaded.setPersona('user-rd-commerce', 'retry-to-rd', identity(reloaded))
    await command(reloaded, `/changes/${changeId}/retry`, { expectedVersion: change(reloaded, changeId).version, reason: 'Retry after persisted simulated failure' }, 'resource-retry')
    expect(change(reloaded, changeId).state).toBe('submitted')
    await reloaded.setPersona('user-ops', 'retry-to-ops', identity(reloaded))
    await expect(command(reloaded, `/changes/${changeId}/execute`, { expectedVersion: change(reloaded, changeId).version }, 'retry-without-decision')).rejects.toMatchObject({ status: 409 })
    await command(reloaded, `/changes/${changeId}/approve`, { expectedVersion: change(reloaded, changeId).version, reason: 'Independent second decision after failure' }, 'retry-approve')
    await command(reloaded, `/changes/${changeId}/execute`, { expectedVersion: change(reloaded, changeId).version }, 'retry-execute')
    await command(reloaded, '/clock/advance', { ticks: 5 }, 'retry-complete')
    const finished = reloaded.getSnapshot(), request = change(reloaded, changeId)
    expect(request).toMatchObject({ state: 'succeeded', plannedObjectIds: failed.entities.changes[0].plannedObjectIds, plannedBindingIds: failed.entities.changes[0].plannedBindingIds })
    expect(request.decisions).toHaveLength(2)
    expect(finished.entities.changeExecutions.map(e => [e.attempt, e.state])).toEqual([[1, 'failed'], [2, 'succeeded']])
    expect(finished.entities.changeExecutions[0]).toEqual(failed.entities.changeExecutions[0])
    expect(h.start().getSnapshot()).toEqual(finished)
  })

  it.each(['missing-task', 'wrong-step'] as const)('retains corrupt current execution bytes for %s without partial repair', async corruption => {
    const h = harness(), c = h.start()
    await execute(c, 'redis')
    await command(c, '/clock/advance', { ticks: 2 }, 'resource-midpoint')
    const decoded = JSON.parse(h.raw) as { snapshot: ReturnType<typeof c.getSnapshot> }
    if (corruption === 'missing-task') decoded.snapshot.scheduler.tasks = []
    else decoded.snapshot.scheduler.tasks[0].stepIndex += 1
    const invalidBytes = JSON.stringify(decoded)
    h.storage.setItem(SNAPSHOT_KEY, invalidBytes)
    expect(h.start).toThrow(expect.objectContaining({ code: 'DEMO_SNAPSHOT_INCOMPATIBLE' }))
    expect(h.raw).toBe(invalidBytes)
  })

  it('reset ends the active generation and leaves no ghost binding or scheduled resource execution', async () => {
    const h = harness(), c = h.start(), { changeId } = await execute(c, 'redis')
    await command(c, '/clock/advance', { ticks: 2 }, 'resource-midpoint')
    const planned = change(c, changeId), old = identity(c)
    await c.reset('reset-resource-generation', old)
    await expect(c.command('POST', '/clock/advance', { ticks: 3 }, 'old-generation-complete', old)).rejects.toMatchObject({ code: 'STALE_IDENTITY' })
    await command(c, '/clock/advance', { ticks: 5 }, 'fresh-generation-clock')
    const clean = c.getSnapshot()
    expect(clean.entities.changes).toEqual([])
    expect(clean.entities.changeExecutions).toEqual([])
    expect(clean.entities.resourceBindings.some(b => planned.plannedBindingIds.includes(b.id))).toBe(false)
    expect(clean.entities.resourceObjects.some(o => planned.plannedObjectIds.includes(o.id))).toBe(false)
    expect(clean.scheduler.tasks).toEqual([])
    expect(h.start().getSnapshot()).toEqual(clean)
  })
})

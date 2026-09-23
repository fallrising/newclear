import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSeed } from '../demo/seed'
import type { CommandInput, Snapshot } from './schemas'

async function coldEngine() {
  vi.resetModules()
  let release!: () => void, entered!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  const load = vi.fn(async () => {
    entered()
    await waiting
    return vi.importActual<typeof import('./engine-commands')>('./engine-commands')
  })
  vi.doMock('./engine-commands', load)
  const { createEngine } = await import('./engine')
  return { createEngine, load, release, started }
}
const input = (path: string, body: unknown, actorId = 'user-ops', method = 'POST', key = path): CommandInput => ({
  sessionId: 'cold-engine', actorId, method, path, body, key,
})

afterEach(() => { vi.doUnmock('./engine-commands'); vi.resetModules() })

describe('lazy engine commands preserve startup and transaction boundaries', () => {
  it('validates and reads synchronously without loading commands, then authorizes queued work against current state', async () => {
    const cold = await coldEngine(), seed = createSeed('cold-engine')
    const corrupt = structuredClone(seed)
    corrupt.entities.resourceObjects.push({ ...corrupt.entities.resourceObjects[0], id: 'duplicate-identity' })
    expect(() => cold.createEngine(corrupt, () => undefined)).toThrow(expect.objectContaining({ code: 'INVALID_SNAPSHOT' }))
    const engine = cold.createEngine(seed, () => undefined)
    expect(engine.read('/cis', new URLSearchParams(), 'user-ops')).toMatchObject({ total: 63 })
    expect(cold.load).not.toHaveBeenCalled()
    const grant = seed.entities.assignments.find(a => a.userId === 'user-rd-commerce' && a.scopeId === 'project-store')!
    const revoke = engine.command(input(`/admin/assignments/${grant.id}`, { expectedVersion: grant.version, reason: 'Revoke before queued proposal' }, 'user-admin', 'DELETE'))
    const proposal = engine.command(input('/changes', {
      kind: 'resource.bind', mode: 'create', catalogItemId: 'w2-catalog-redis', catalogRevision: 1, reason: 'Queued before revoke completes',
      targetCiId: 'ci-idc-redis-01', targetCiVersion: 1, applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1,
      quotaMiB: 512, purpose: 'runtime', accessProfileRef: 'w2-profile-redis-runtime',
    }, 'user-rd-commerce'))
    const results = Promise.allSettled([revoke, proposal])
    await cold.started
    expect(engine.getSnapshot()).toEqual(seed)
    cold.release()
    expect(await results).toMatchObject([{ status: 'fulfilled' }, { status: 'rejected', reason: { status: 403 } }])
    expect(cold.load).toHaveBeenCalledTimes(1)
    expect(engine.getSnapshot().entities.changes).toEqual([])
    expect(engine.getSnapshot().commandCount).toBe(1)
  })

  it('copies input before module loading and continues the queue without publishing a failed persist', async () => {
    const cold = await coldEngine(), seed = createSeed('cold-engine'), saved: Snapshot[] = []
    let fail = true
    const engine = cold.createEngine(seed, next => {
      if (fail) { fail = false; throw new Error('storage full') }
      saved.push(next)
    })
    const path = '/cis/ci-aws-checkout-01'
    const first = engine.command(input(path, { expectedVersion: 1, name: 'failed name' }, 'user-ops', 'PATCH', 'failed'))
    const body = { expectedVersion: 1, name: 'copied name' }
    const second = engine.command(input(path, body, 'user-ops', 'PATCH', 'succeeded'))
    body.name = 'caller mutation after enqueue'
    const results = Promise.allSettled([first, second])
    await cold.started
    expect(engine.getSnapshot()).toEqual(seed)
    cold.release()
    expect(await results).toMatchObject([{ status: 'rejected', reason: { status: 507 } }, { status: 'fulfilled' }])
    expect(saved).toHaveLength(1)
    expect(engine.read(path, new URLSearchParams(), 'user-ops')).toMatchObject({ version: 2, name: 'copied name' })
    expect(engine.getSnapshot()).toMatchObject({ commandCount: 1, storeRevision: 1 })
    expect(engine.getSnapshot().idempotency.map(r => r.key)).toEqual(['succeeded'])
  })
})

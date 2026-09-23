import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { createEngine } from './engine'

function harness() {
  const engine = createEngine(createSeed('w5-route-session'), () => {})
  let sequence = 0
  const command = (actorId: string, path: string, body: unknown) => engine.command({ sessionId: 'w5-route-session',
    actorId, method: 'POST', path, body, key: `w5-route-${++sequence}` })
  return { engine, command }
}
const spec = (adapterRef: 'demo-apm' | 'demo-apm-failure' = 'demo-apm') => ({ routeKey: 'observation.apm',
  capabilityId: 'observation-apm', integrationId: 'integration-observation', adapterRef, timeoutMs: 1000 })

describe('W5 registered Mock PlatformRoute', () => {
  it('retains immutable active revision, shows safe failure fallback and allows recovery', async () => {
    const { engine, command } = harness()
    const registry = engine.read('/admin/platform-route-registry', new URLSearchParams(), 'user-admin') as { routeKey: string }[]
    expect(registry.map(row => row.routeKey)).toEqual(['inventory.aws', 'inventory.aliyun', 'inventory.idc', 'observation.apm', 'notification.in_app'])
    const created = await command('user-admin', '/admin/platform-routes', { spec: spec(), reason: 'Register Mock route' })
    const current = () => engine.getSnapshot().entities.platformRoutes.find(row => row.id === created.entityId)!
    const action = (name: string, reason = name) => command('user-admin', `/admin/platform-routes/${created.entityId}/${name}`,
      { expectedVersion: current().version, reason })
    await action('validate')
    await action('activate')
    expect(engine.read(`/admin/platform-routes/${created.entityId}/diagnostic`, new URLSearchParams(), 'user-admin'))
      .toMatchObject({ status: 'active', code: 'ACTIVE_DEMO_ADAPTER', adapterRef: 'demo-apm', activeRevision: 1 })
    await action('test')
    expect(current().health).toMatchObject({ status: 'healthy', code: 'MOCK_OK', testedRevision: 1 })
    await command('user-admin', `/admin/platform-routes/${created.entityId}/revisions`, { expectedVersion: current().version,
      spec: spec('demo-apm-failure'), reason: 'Stage deterministic failure' })
    expect(current()).toMatchObject({ status: 'draft', revision: 2, activeRevision: 1 })
    expect(engine.read(`/admin/platform-routes/${created.entityId}/diagnostic`, new URLSearchParams(), 'user-admin'))
      .toMatchObject({ status: 'active', adapterRef: 'demo-apm' })
    await action('validate')
    await action('test')
    expect(current().health).toMatchObject({ status: 'degraded', code: 'MOCK_FAILURE_FALLBACK', testedRevision: 2 })
    await action('activate')
    expect(engine.read(`/admin/platform-routes/${created.entityId}/diagnostic`, new URLSearchParams(), 'user-admin'))
      .toMatchObject({ status: 'fallback', code: 'MOCK_FAILURE_FALLBACK', adapterRef: 'demo-apm', activeRevision: 2 })
    await action('disable')
    expect(engine.read(`/admin/platform-routes/${created.entityId}/diagnostic`, new URLSearchParams(), 'user-admin'))
      .toMatchObject({ status: 'fallback', code: 'ROUTE_DISABLED_FALLBACK', adapterRef: 'demo-apm' })
    await command('user-admin', `/admin/platform-routes/${created.entityId}/restore`, { expectedVersion: current().version,
      revision: 1, reason: 'Recover good Mock adapter' })
    expect(current()).toMatchObject({ status: 'draft', revision: 3, activeRevision: null })
    expect(current().revisions.map(row => row.revision)).toEqual([1, 2, 3])
    expect(current().revisions[2].spec).toEqual(current().revisions[0].spec)
  })

  it('rejects arbitrary destinations, mismatched dependencies, duplicates and revoked Admin', async () => {
    const { engine, command } = harness()
    const before = engine.getSnapshot()
    await expect(command('user-admin', '/admin/platform-routes', { spec: { ...spec(), routeKey: '/admin/access' }, reason: 'Override recovery' }))
      .rejects.toMatchObject({ status: 422 })
    await expect(command('user-admin', '/admin/platform-routes', { spec: { ...spec(), adapterRef: 'https://example.com' }, reason: 'External destination' }))
      .rejects.toMatchObject({ status: 422 })
    await expect(command('user-admin', '/admin/platform-routes', { spec: { ...spec(), timeoutMs: 50 }, reason: 'Unbounded timeout' }))
      .rejects.toMatchObject({ status: 422 })
    await expect(command('user-admin', '/admin/platform-routes', { spec: { ...spec(), integrationId: 'integration-aws' }, reason: 'Wrong dependency' }))
      .rejects.toMatchObject({ status: 422 })
    await expect(command('user-rd-commerce', '/admin/platform-routes', { spec: spec(), reason: 'No admin role' }))
      .rejects.toMatchObject({ status: 403 })
    expect(engine.getSnapshot()).toEqual(before)
    await command('user-admin', '/admin/platform-routes', { spec: spec(), reason: 'Good route' })
    await expect(command('user-admin', '/admin/platform-routes', { spec: spec(), reason: 'Duplicate route' }))
      .rejects.toMatchObject({ status: 409, code: 'DUPLICATE_RESOURCE' })
    expect(engine.read('/audit', new URLSearchParams('entityType=platformRoute'), 'user-rd-commerce')).toMatchObject({ total: 0 })
  })
})

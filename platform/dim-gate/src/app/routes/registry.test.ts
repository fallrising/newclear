import { describe, expect, it } from 'vitest'
import type { SessionView } from '../../domain/schemas'
import { canAccessRoute, routeForPath, routeRegistry, visibleNavigation } from './registry'

const session = (overrides: Partial<SessionView> = {}): SessionView => ({
  user: { id: 'user-test', displayName: 'Test' }, assignments: [], effectiveActions: ['app.read', 'environment.read', 'ci.read'],
  centers: ['rd'], demo: true, sessionId: 'session-test', policyVersion: 1, storeRevision: 1,
  logicalClock: 0, identityEpoch: 1, generation: 1, storageMode: 'session', ...overrides,
})

describe('M1 route registry', () => {
  it('matches only real static and dynamic routes', () => {
    expect(routeForPath('/rd/apps')?.key).toBe('rd.apps')
    expect(routeForPath('/rd/apps/app-checkout')?.key).toBe('rd.app-detail')
    expect(routeForPath('/rd/apps/app-checkout/environments/env-checkout-dev')?.key).toBe('rd.environment-detail')
    expect(routeForPath('/ops/cmdb/ci-idc-redis-01')?.key).toBe('ops.ci-detail')
    expect(routeForPath('/ops/does-not-exist')).toBeUndefined()
  })

  it('keeps navigation visibility separate from route existence and required actions', () => {
    const rd = session()
    expect(visibleNavigation(rd).map((route) => route.key)).toEqual(['rd.overview', 'rd.apps', 'guide'])
    const detail = routeRegistry.find((route) => route.key === 'rd.app-detail')!
    expect(detail.navigation.visible).toBe(false)
    expect(canAccessRoute(rd, detail)).toBe(true)
    expect(canAccessRoute(session({ effectiveActions: [] }), detail)).toBe(false)
    expect(canAccessRoute(rd, routeRegistry.find((route) => route.key === 'ops.cmdb')!)).toBe(false)
  })
})

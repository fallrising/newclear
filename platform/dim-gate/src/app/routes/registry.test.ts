import { describe, expect, it } from 'vitest'
import type { SessionView } from '../../domain/schemas'
import { canAccessRoute, routeForPath, routeRegistry, visibleNavigation } from './registry'

const session = (overrides: Partial<SessionView> = {}): SessionView => ({
  user: { id: 'user-test', displayName: 'Test' }, assignments: [], effectiveActions: ['app.read', 'environment.read', 'ci.read'],
  centers: ['rd'], demo: true, sessionId: 'session-test', policyVersion: 1, storeRevision: 1,
  logicalClock: 0, identityEpoch: 1, generation: 1, storageMode: 'session', ...overrides,
})

describe('registered route permissions', () => {
  it('matches only real static and dynamic routes', () => {
    expect(routeForPath('/rd/apps')?.key).toBe('rd.apps')
    expect(routeForPath('/rd/apps/app-checkout')?.key).toBe('rd.app-detail')
    expect(routeForPath('/rd/apps/app-checkout/environments/env-checkout-dev')?.key).toBe('rd.environment-detail')
    expect(routeForPath('/rd/catalog/catalog-web/request')?.key).toBe('rd.catalog-request')
    expect(routeForPath('/rd/requests/req-0001')?.key).toBe('rd.request-detail')
    expect(routeForPath('/ops/cmdb/ci-idc-redis-01')?.key).toBe('ops.ci-detail')
    expect(routeForPath('/ops/requests/req-0001')?.key).toBe('ops.request-detail')
    expect(routeForPath('/ops/jobs/job-0003')?.key).toBe('ops.job-detail')
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
    const selfService = session({ effectiveActions: [...rd.effectiveActions, 'catalog.read', 'request.create', 'request.read'] })
    expect(visibleNavigation(selfService).map((route) => route.key)).toEqual(['rd.overview', 'rd.apps', 'rd.catalog', 'rd.requests', 'guide'])
  })

  it('permits M3 read-only deep links by action while keeping center lists and writes separate', () => {
    const reader = session({ centers: ['ops'], effectiveActions: ['pipeline.read', 'release.read'] })
    expect(canAccessRoute(reader, routeForPath('/rd/pipelines/run-0001')!)).toBe(true)
    expect(canAccessRoute(reader, routeForPath('/rd/releases/release-0001')!)).toBe(true)
    expect(canAccessRoute(reader, routeForPath('/rd/pipelines')!)).toBe(false)
    const admin = session({ centers: ['admin'], effectiveActions: ['release.read'] })
    expect(canAccessRoute(admin, routeForPath('/rd/releases/release-0001')!)).toBe(true)
    expect(canAccessRoute(admin, routeForPath('/rd/pipelines/run-0001')!)).toBe(false)
  })
})

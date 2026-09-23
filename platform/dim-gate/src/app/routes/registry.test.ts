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


it('keeps M4 diagnostic deep links action-guarded without adding another center to navigation', () => {
  const rd = session({ effectiveActions: ['ci.read', 'incident.read', 'observation.read', 'app.read', 'environment.read'] })
  expect(canAccessRoute(rd, routeForPath('/ops/incidents/incident-1')!)).toBe(true)
  expect(canAccessRoute(rd, routeForPath('/ops/cmdb/ci-1')!)).toBe(true)
  expect(canAccessRoute(rd, routeForPath('/ops/topology')!)).toBe(true)
  expect(canAccessRoute(rd, routeForPath('/ops/incidents')!)).toBe(false)
  expect(visibleNavigation(rd).some(route => route.center === 'ops')).toBe(false)
  expect(canAccessRoute(session({ effectiveActions: [] }), routeForPath('/ops/incidents/incident-1')!)).toBe(false)
})


it('registers W3 source routes with business read actions independent of workspace navigation', () => {
  const ops = session({ centers: ['ops'], effectiveActions: ['pipelineDefinition.read', 'serviceConfig.read', 'trafficPolicy.read', 'serviceChange.read'] })
  const paths = ['/rd/apps/app-checkout/delivery?revisionId=definition-1', '/rd/apps/app-checkout/configuration?environmentId=env-checkout-dev', '/rd/apps/app-checkout/traffic', '/ops/service-changes/serviceConfig/config-1']
  expect(paths.map(path => routeForPath(path)?.key)).toEqual(['rd.delivery', 'rd.configuration', 'rd.traffic', 'ops.service-change'])
  for (const path of paths) {
    const route = routeForPath(path)!
    expect(route.navigation.visible).toBe(false)
    expect(canAccessRoute(ops, route)).toBe(true)
    expect(canAccessRoute(session({ centers: ['admin'], effectiveActions: ['access.write', 'app.read'] }), route)).toBe(false)
  }
})

it('registers W4 service and Ops alerting routes without granting cross-role writes', () => {
  const rd = session({ centers: ['rd'], effectiveActions: ['monitorPolicy.read', 'alertRule.read'] })
  const ops = session({ centers: ['ops'], effectiveActions: ['monitorPolicy.read', 'alertRule.read'] })
  expect(routeForPath('/rd/apps/app-checkout/monitoring?environmentId=env-checkout-prod')?.key).toBe('rd.monitoring')
  expect(routeForPath('/rd/apps/app-checkout/alerts?environmentId=env-checkout-prod')?.key).toBe('rd.alerts')
  expect(routeForPath('/ops/alerting')?.key).toBe('ops.alerting')
  expect(visibleNavigation(rd).some(route => route.key === 'rd.alerts' || route.key === 'rd.monitoring' || route.key === 'ops.alerting')).toBe(false)
  expect(visibleNavigation(ops).some(route => route.key === 'ops.alerting')).toBe(true)
  expect(canAccessRoute(rd, routeForPath('/ops/alerting')!)).toBe(false)
  expect(canAccessRoute(ops, routeForPath('/rd/apps/app-checkout/alerts')!)).toBe(true)
  expect(canAccessRoute(session({ centers: ['admin'], effectiveActions: ['access.write'] }), routeForPath('/rd/apps/app-checkout/alerts')!)).toBe(false)
})

it('uses current W5 cohort entitlement for direct feature routes and protects Admin governance', () => {
  const rd = session({ centers: ['rd'], effectiveActions: ['monitorPolicy.read', 'pipelineDefinition.read'], featureKeys: ['rd.delivery'] })
  expect(canAccessRoute(rd, routeForPath('/rd/apps/app-checkout/monitoring')!)).toBe(false)
  expect(canAccessRoute(rd, routeForPath('/rd/apps/app-checkout/delivery')!)).toBe(true)
  expect(canAccessRoute(rd, routeForPath('/rd/apps/app-checkout')!)).toBe(false)
  const admin = session({ centers: ['admin'], effectiveActions: ['access.write', 'feature.write'], featureKeys: [] })
  expect(canAccessRoute(admin, routeForPath('/admin/features')!)).toBe(true)
  expect(canAccessRoute(session({ centers: ['admin'], effectiveActions: ['route.write'] }), routeForPath('/admin/routes')!)).toBe(true)
  expect(canAccessRoute(session({ centers: ['admin'], effectiveActions: ['access.write'] }), routeForPath('/admin/features')!)).toBe(false)
  expect(canAccessRoute(session({ centers: ['admin'], effectiveActions: ['access.write'] }), routeForPath('/admin/routes')!)).toBe(false)
})

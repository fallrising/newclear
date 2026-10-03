import { z } from 'zod'
import type { CommandInput } from './command-input-schemas'
import type { Snapshot } from './schema-models'
import type { Policy } from './policy'
import type { PlatformRoute, PlatformRouteSpec } from './platform-route-models'
import { routeSpecSupported } from './platform-route-registry'
import { createPlatformRouteInputSchema, platformRouteActionInputSchema, restorePlatformRouteInputSchema,
  revisePlatformRouteInputSchema } from './platform-route-input-schemas'
import { clockIso, fail, forbidden, notFound, parse } from './engine-shared'

function validateSpec(snapshot: Snapshot, spec: PlatformRouteSpec, orgId: string) {
  if (!routeSpecSupported(spec)) fail(422, 'VALIDATION_ERROR', '路由、能力、整合與 Mock adapter 不相容。')
  if (!snapshot.entities.integrations.some(row => row.id === spec.integrationId && row.orgId === orgId))
    fail(422, 'VALIDATION_ERROR', '整合來源不存在。')
}

function changedSpecFields(previous: PlatformRouteSpec, next: PlatformRouteSpec) {
  return (['adapterRef', 'timeoutMs'] as const).filter(key => previous[key] !== next[key]).map(key => `spec.${key}`)
}

export function preparePlatformRoute(snapshot: Snapshot, policy: Policy, input: CommandInput) {
  if (input.method.toUpperCase() !== 'POST') return undefined
  const create = input.path === '/admin/platform-routes'
  const match = /^\/admin\/platform-routes\/([^/]+)\/(revisions|validate|activate|disable|restore|test)$/.exec(input.path)
  if (!create && !match) return undefined
  const action = match?.[2]
  const body = parse(create ? createPlatformRouteInputSchema : action === 'revisions' ? revisePlatformRouteInputSchema
    : action === 'restore' ? restorePlatformRouteInputSchema : platformRouteActionInputSchema, input.body)
  if (!policy.admin) forbidden()
  const old = match ? snapshot.entities.platformRoutes.find(row => row.id === match[1] && row.orgId === policy.user!.orgId) ?? notFound() : undefined
  return { body, apply(next: Snapshot) {
    const now = clockIso(next.logicalClock)
    let route: PlatformRoute
    let fields: string[]
    let reasonText: string
    if (create) {
      const createBody = body as z.infer<typeof createPlatformRouteInputSchema>
      validateSpec(next, createBody.spec, policy.user!.orgId)
      if (next.entities.platformRoutes.some(row => row.orgId === policy.user!.orgId && row.spec.routeKey === createBody.spec.routeKey))
        fail(409, 'DUPLICATE_RESOURCE', '此註冊路由已有治理政策。')
      const id = `w5-route-${String(next.sequence + 1).padStart(4, '0')}`
      if (next.entities.platformRoutes.some(row => row.id === id)) fail(409, 'DUPLICATE_RESOURCE', '註冊路由 ID 已存在。')
      route = { id, orgId: policy.user!.orgId, version: 1, createdAt: now, updatedAt: now, revision: 1,
        activeRevision: null, status: 'draft', requesterId: input.actorId, spec: createBody.spec,
        revisions: [{ revision: 1, spec: createBody.spec, reason: createBody.reason, actorId: input.actorId, occurredAt: now }],
        health: { status: 'unknown', code: 'NOT_TESTED', testedRevision: null, testedAt: null } }
      next.entities.platformRoutes.push(route)
      fields = ['draft created']; reasonText = createBody.reason
    } else {
      route = next.entities.platformRoutes.find(row => row.id === old!.id)!
      const guarded = body as z.infer<typeof platformRouteActionInputSchema>
      if (guarded.expectedVersion !== route.version) fail(409, 'VERSION_CONFLICT', '註冊路由版本已變更。')
      reasonText = guarded.reason
      if (action === 'revisions') {
        const revision = body as z.infer<typeof revisePlatformRouteInputSchema>
        validateSpec(next, revision.spec, policy.user!.orgId)
        if (revision.spec.routeKey !== route.spec.routeKey) fail(422, 'VALIDATION_ERROR', '路由 key 不可改變。')
        if (route.status === 'draft') fail(409, 'INVALID_STATE', '已有待驗證的草稿。')
        fields = ['revision created', ...changedSpecFields(route.spec, revision.spec)]
        route.revision += 1; route.spec = revision.spec; route.status = 'draft'; route.requesterId = input.actorId
        route.revisions.push({ revision: route.revision, spec: revision.spec, reason: revision.reason, actorId: input.actorId, occurredAt: now })
      } else if (action === 'restore') {
        const restore = body as z.infer<typeof restorePlatformRouteInputSchema>
        const source = route.revisions.find(row => row.revision === restore.revision) ?? notFound()
        if (route.status === 'draft') fail(409, 'INVALID_STATE', '已有待驗證的草稿。')
        fields = ['restored as new revision', ...changedSpecFields(route.spec, source.spec)]
        route.revision += 1; route.spec = structuredClone(source.spec); route.status = 'draft'; route.requesterId = input.actorId
        route.revisions.push({ revision: route.revision, spec: route.spec, reason: restore.reason, actorId: input.actorId, occurredAt: now })
      } else if (action === 'validate') {
        if (route.status !== 'draft') fail(409, 'INVALID_STATE', '只有草稿可驗證。')
        validateSpec(next, route.spec, policy.user!.orgId)
        route.status = 'validated'; fields = ['validated']
      } else if (action === 'activate') {
        if (route.status !== 'validated') fail(409, 'INVALID_STATE', '只有已驗證的路由可啟用。')
        validateSpec(next, route.spec, policy.user!.orgId)
        route.status = 'active'; route.activeRevision = route.revision
        if (route.health.testedRevision !== route.revision)
          route.health = { status: 'unknown', code: 'NOT_TESTED', testedRevision: null, testedAt: null }
        fields = ['activeRevision', 'status']
      } else if (action === 'disable') {
        if (route.activeRevision === null || route.status === 'disabled') fail(409, 'INVALID_STATE', '目前沒有可停用的啟用版本。')
        route.status = 'disabled'; route.activeRevision = null
        route.health = { status: 'disabled', code: 'ROUTE_DISABLED', testedRevision: null, testedAt: now }
        fields = ['status', 'activeRevision', 'health']
      } else {
        if (route.status !== 'validated' && route.status !== 'active') fail(409, 'INVALID_STATE', '請先驗證草稿。')
        const failed = route.spec.adapterRef.endsWith('-failure')
        route.health = { status: failed ? 'degraded' : 'healthy', code: failed ? 'MOCK_FAILURE_FALLBACK' : 'MOCK_OK',
          testedRevision: route.revision, testedAt: now }
        fields = ['health']
      }
      route.version += 1; route.updatedAt = now
    }
    return { entityType: 'platformRoute', entityId: route.id, entityVersion: route.version,
      correlationId: `corr-${route.id}`, changed: [{ entityType: 'platformRoute', entityId: route.id }],
      operationId: undefined as string | undefined,
      action: `platformRoute.${create ? 'create' : action}`, fields, reason: reasonText,
      projectIds: [], poolIds: [], stages: [] as ('dev' | 'staging' | 'prod')[] }
  } }
}

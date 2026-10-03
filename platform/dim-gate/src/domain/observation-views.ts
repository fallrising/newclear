import { serviceRoute } from './service-delivery-policy'
import { z } from 'zod'
import { DomainError } from './errors'
import type { Policy } from './policy'
import { canReadDelivery } from './delivery'
import { resourceRoute } from './resource-views'
import { canReadObservation, incidentView } from './observation'
import { idSchema, incidentSchema, observationLogSchema, timestampSchema, type GuideView, type MetricSeries, type Notification, type Snapshot } from './schema-models'

const fail = (status: number, code: string, message: string): never => { throw new DomainError(status, code, message) }
function queryValues<T extends z.ZodType>(schema: T, query: URLSearchParams): z.infer<T> {
  for (const [key, value] of query) if (query.getAll(key).length !== 1 || !value && key !== 'q') fail(422, 'VALIDATION_ERROR', '不接受重複或空白查詢欄位。')
  const result = schema.safeParse(Object.fromEntries(query))
  if (!result.success) fail(422, 'VALIDATION_ERROR', '查詢欄位不符合契約。')
  return result.data!
}
const pageFields = { q: z.string().max(100).optional(), page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25), order: z.enum(['asc', 'desc']).default('asc') }
const windowFields = { applicationId: idSchema, environmentId: idSchema, from: timestampSchema, to: timestampSchema }
type ObservationWindow = { applicationId: string; environmentId: string; from: string; to: string }
const windowQuery = (extra: z.ZodRawShape) => z.strictObject({ ...windowFields, ...extra }).refine(input => {
  const duration = Date.parse(input.to) - Date.parse(input.from)
  return duration > 0 && duration <= 86_400_000
})
function page<T extends { id: string }>(items: T[], values: { page: number; pageSize: number; order: string; sort: string }) {
  const sorted = items.toSorted((a, b) => {
    const av = a[values.sort as keyof T], bv = b[values.sort as keyof T]
    const compare = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
    return (values.order === 'desc' ? -compare : compare) || a.id.localeCompare(b.id)
  })
  return { items: sorted.slice((values.page - 1) * values.pageSize, values.page * values.pageSize), total: sorted.length, page: values.page, pageSize: values.pageSize }
}
export function visibleIntegrations(s: Snapshot, policy: Policy) {
  return s.entities.integrations.filter(i => i.orgId === policy.user?.orgId && (policy.admin || i.poolIds.some(id => policy.poolIds.includes(id))))
    .map(i => ({ ...structuredClone(i), poolIds: i.poolIds.filter(id => policy.admin || policy.poolIds.includes(id)) })).toSorted((a, b) => a.id.localeCompare(b.id))
}
export function readObservation(s: Snapshot, policy: Policy, path: string, query: URLSearchParams): unknown {
  if (path === '/notifications') {
    queryValues(z.strictObject({}), query)
    return { items: notifications(s, policy) }
  }
  if (path === '/integrations') {
    queryValues(z.strictObject({}), query)
    if (!policy.effectiveActions.includes('integration.read')) fail(403, 'FORBIDDEN', '目前身分沒有此操作的授權。')
    return visibleIntegrations(s, policy)
  }
  const incidentId = /^\/incidents\/([^/]+)$/.exec(path)?.[1]
  if (incidentId) {
    queryValues(z.strictObject({}), query)
    const incident = s.entities.incidents.find(i => i.id === incidentId && canReadObservation(s, policy, i.environmentId))
    if (incident) return incidentView(s, policy, incident)
    const infra = s.entities.infrastructureIncidents.find(i => i.id === incidentId && s.entities.cis.some(ci => ci.id === i.ciId && ci.orgId === policy.user?.orgId && policy.poolIds.includes(ci.poolId)))
    if (!infra) fail(404, 'NOT_FOUND', '此資源不存在或不在目前授權範圍。')
    return structuredClone(infra)
  }
  if (path === '/incidents') {
    const values = queryValues(z.strictObject({ ...pageFields, environmentId: idSchema.optional(), state: incidentSchema.shape.state.optional(),
      ciId: idSchema.optional(), severity: incidentSchema.shape.severity.optional(), sort: z.enum(['id', 'updatedAt']).default('id') }), query)
    const visible = s.entities.incidents.filter(i => canReadObservation(s, policy, i.environmentId))
    const service = visible.filter(i => !values.ciId && (!values.environmentId || i.environmentId === values.environmentId) && (!values.state || i.state === values.state)
      && (!values.severity || i.severity === values.severity) && (!values.q || `${i.id} ${i.ruleKey}`.toLowerCase().includes(values.q.toLowerCase())))
      .map(i => incidentView(s, policy, i))
    const infrastructure = s.entities.infrastructureIncidents.filter(i => !values.environmentId && (!values.ciId || i.ciId === values.ciId)
      && (!values.state || i.state === values.state) && (!values.severity || i.severity === values.severity)
      && (!values.q || `${i.id} ${i.ruleId}`.toLowerCase().includes(values.q.toLowerCase()))
      && s.entities.cis.some(ci => ci.id === i.ciId && ci.orgId === policy.user?.orgId && policy.poolIds.includes(ci.poolId)))
    return page([...service, ...infrastructure], values)
  }
  const traceId = /^\/observability\/traces\/([^/]+)$/.exec(path)?.[1]
  if (traceId) {
    queryValues(z.strictObject({}), query)
    const trace = s.observations.traces.find(t => t.id === traceId && canReadObservation(s, policy, t.environmentId, true))
    if (!trace) fail(404, 'NOT_FOUND', '此資源不存在或不在目前授權範圍。')
    const view = structuredClone(trace!)
    for (const span of view.spans) if (span.ciId && !s.entities.cis.some(ci => ci.id === span.ciId && policy.canReadCi(ci))) delete span.ciId
    return view
  }
  if (!['/observability/metrics', '/observability/traces', '/observability/logs'].includes(path)) return undefined
  const metrics = path.endsWith('/metrics'), traces = path.endsWith('/traces')
  const values = queryValues(windowQuery(metrics ? { step: z.literal('60s').default('60s') } : traces
    ? { ...pageFields, status: z.enum(['ok', 'error']).optional(), sort: z.enum(['id', 'start', 'durationMs']).default('start') }
    : { ...pageFields, traceId: idSchema.optional(), releaseId: idSchema.optional(), level: observationLogSchema.shape.level.optional(), sort: z.enum(['id', 'occurredAt']).default('occurredAt') }), query) as ObservationWindow & { q?: string; status?: string; traceId?: string; releaseId?: string; level?: string; page?: number; pageSize?: number; sort?: string; order?: string }
  const target = s.entities.environments.find(e => e.id === values.environmentId && e.applicationId === values.applicationId)
  if (!target || !canReadObservation(s, policy, target.id, !metrics)) fail(404, 'NOT_FOUND', '此資源不存在或不在目前授權範圍。')
  const matches = (entry: { applicationId: string; environmentId: string }) => entry.applicationId === values.applicationId
    && entry.environmentId === values.environmentId && canReadObservation(s, policy, entry.environmentId, !metrics)
  const inWindow = (time: string) => Date.parse(time) >= Date.parse(values.from) && Date.parse(time) < Date.parse(values.to)
  if (metrics) {
    const buckets = s.observations.buckets.filter(b => matches(b) && inWindow(b.from)).toSorted((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id))
    return { series: (['rate', 'errorRate', 'p95Latency'] as const).map(metric => ({ metric,
      unit: { rate: 'requests/second', errorRate: 'fraction', p95Latency: 'ms' }[metric],
      points: buckets.map(bucket => ({ t: bucket.from, value: bucket[metric] })), sampleCount: buckets.filter(bucket => bucket[metric] !== null).length } as MetricSeries)) }
  }
  const q = values.q?.toLowerCase()
  const pagination = values as typeof values & { page: number; pageSize: number; sort: string; order: string }
  if (traces) return page(s.observations.traces.filter(t => matches(t) && inWindow(t.start) && (!values.status || t.status === values.status)
    && (!q || `${t.id} ${t.name}`.toLowerCase().includes(q))).map(t => { const { spans: _spans, ...summary } = t; void _spans; return structuredClone(summary) }), pagination)
  return page(s.observations.logs.filter(l => matches(l) && inWindow(l.occurredAt) && (!values.traceId || l.traceId === values.traceId)
    && (!values.releaseId || l.releaseId === values.releaseId) && (!values.level || l.level === values.level) && (!q || `${l.id} ${l.message}`.toLowerCase().includes(q)))
    .map(log => { const view = structuredClone(log); if (view.ciId && !s.entities.cis.some(ci => ci.id === view.ciId && policy.canReadCi(ci))) delete view.ciId; return view }), pagination)
}

/** Accessible links are recomputed from current grants for every projection. */
export function notificationRoute(s: Snapshot, policy: Policy, entityType: string, entityId: string): string | undefined {
  if (['pipelineDefinition', 'serviceConfig', 'trafficPolicy', 'serviceExecution'].includes(entityType)) return serviceRoute(s, policy, entityType, entityId)
  if (['resourceObject', 'resourceBinding', 'change', 'changeExecution'].includes(entityType)) return resourceRoute(s, policy, entityType, entityId)
  if (entityType === 'incident') {
    const i = s.entities.incidents.find(i => i.id === entityId)
    if (i && canReadObservation(s, policy, i.environmentId)) return `/ops/incidents/${i.id}`
  }
  if (entityType === 'pipeline' || entityType === 'release') {
    const entity = (entityType === 'pipeline' ? s.entities.pipelines : s.entities.releases).find(e => e.id === entityId)
    if (entity && canReadDelivery(s, policy, entity.environmentId, entityType === 'pipeline')) return `/rd/${entityType === 'pipeline' ? 'pipelines' : 'releases'}/${entity.id}`
  }
  if (entityType === 'request' || entityType === 'job') {
    const request = entityType === 'request' ? s.entities.requests.find(r => r.id === entityId) : s.entities.requests.find(r => r.latestJobId === entityId)
    if (request && policy.canReadRequest(request)) {
      const app = s.entities.applications.find(a => a.id === request.applicationId)!
      const rd = policy.hasProject(app.projectId, request.stage, 'rd')
      const ops = policy.hasProject(app.projectId, request.stage, 'ops') && policy.poolIds.includes(request.poolId)
      if (entityType === 'job') return ops ? `/ops/jobs/${entityId}` : rd ? `/rd/requests/${request.id}` : undefined
      return ops && !rd ? `/ops/requests/${entityId}` : `/rd/requests/${entityId}`
    }
  }
  if (entityType === 'environment') {
    const env = s.entities.environments.find(e => e.id === entityId && policy.canReadEnvironment(e))
    if (env) return `/rd/apps/${env.applicationId}/environments/${env.id}`
  }
  if (entityType === 'ci' && s.entities.cis.some(ci => ci.id === entityId && policy.canReadCi(ci))) return `/ops/cmdb/${entityId}`
  return undefined
}
export function notifications(s: Snapshot, policy: Policy, limit = 20): Notification[] {
  return s.events.toReversed().flatMap(event => {
    const target = event.entities.find(entity => notificationRoute(s, policy, entity.entityType, entity.entityId))
    if (!target) return []
    return [{ id: event.eventId, title: event.type.slice(0, 200), ...target,
      route: notificationRoute(s, policy, target.entityType, target.entityId)!, occurredAt: event.occurredAt }]
  }).slice(0, limit)
}
export function guideProjection(s: Snapshot, policy: Policy): GuideView {
  const visibleRequests = s.entities.requests.filter(policy.canReadRequest).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const request = visibleRequests.find(r => !['cancelled', 'rejected'].includes(r.state))
  const app = request ? s.entities.applications.find(a => a.id === request.applicationId)! : s.entities.applications.filter(a => a.orgId === policy.user?.orgId && policy.hasProject(a.projectId))
    .toSorted((a, b) => Number(b.id === 'app-checkout') - Number(a.id === 'app-checkout') || a.id.localeCompare(b.id))[0]
  const environments = s.entities.environments.filter(e => e.applicationId === app?.id && policy.canReadEnvironment(e))
  const env = request ? environments.find(e => e.id === request.environmentId) : environments.toSorted((a, b) => Number(!!b.activeReleaseId) - Number(!!a.activeReleaseId) || a.id.localeCompare(b.id))[0]
  const releases = s.entities.releases.filter(r => r.environmentId === env?.id && canReadDelivery(s, policy, r.environmentId))
  const successful = releases.filter(r => r.kind === 'deploy' && r.state === 'succeeded').toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const incident = s.entities.incidents.find(i => i.environmentId === env?.id && canReadObservation(s, policy, i.environmentId))
  const rollback = releases.find(r => r.kind === 'rollback' && r.state === 'succeeded' && r.previousReleaseId === incident?.relatedReleaseId)
  const envRoute = env ? notificationRoute(s, policy, 'environment', env.id)! : app ? `/rd/apps/${app.id}` : null
  const releaseRoute = (id: string | undefined) => id ? notificationRoute(s, policy, 'release', id) ?? null : envRoute
  const incidentRoute = incident ? notificationRoute(s, policy, 'incident', incident.id)! : envRoute
  const episodeStart = incident && s.events.toReversed().find(event => ['incident.opened', 'incident.reopened'].includes(event.type) && event.entities.some(entity => entity.entityType === 'incident' && entity.entityId === incident.id))?.occurredAt
  const steps: GuideView['steps'] = [
    { id: 'request', title: '提交環境申請', description: '選擇 provider 與資源池，提交同一應用的環境申請。', persona: 'rd', completed: !!request && !['draft', 'cancelled', 'rejected'].includes(request.state), route: request ? notificationRoute(s, policy, 'request', request.id) ?? null : policy.centers.includes('rd') ? '/rd/catalog' : envRoute },
    { id: 'provision', title: '批准並交付', description: 'Ops 批准並完成模擬交付，環境達到 ready。', persona: 'ops', completed: request?.state === 'fulfilled' && env?.status === 'ready', route: request ? notificationRoute(s, policy, 'request', request.id) ?? null : envRoute },
    { id: 'stable-release', title: '發布穩定版本', description: '建立第一個通過健康檢查的成功發布。', persona: 'rd', completed: successful.length >= 1, route: releaseRoute(successful[0]?.id) },
    { id: 'next-release', title: '發布下一版本', description: '同一環境發布另一個 artifact，留下可回滾歷史。', persona: 'rd', completed: successful.some(r => r.artifactDigest !== successful[0]?.artifactDigest), route: releaseRoute(successful.at(-1)?.id) },
    { id: 'observe', title: '注入發布後異常', description: '明確注入三個一分鐘模擬觀測視窗，查看 metrics、trace、log 與 incident。', persona: 'any', completed: !!incident, route: env && canReadObservation(s, policy, env.id, true) ? `/rd/observability?applicationId=${env.applicationId}&environmentId=${env.id}` : incidentRoute },
    { id: 'investigate', title: '認領並診斷告警', description: 'Ops 認領與調查此環境的告警，檢查影響與最近發布。', persona: 'ops', completed: !!incident?.assigneeId && !!episodeStart && s.audit.some(a => a.entityType === 'incident' && a.entityId === incident.id && a.action === 'incident.investigate' && Date.parse(a.occurredAt) >= Date.parse(episodeStart)), route: incidentRoute },
    { id: 'rollback', title: '回滾並通過健康檢查', description: 'RD 使用不同 artifact 的成功歷史版本建立新 rollback release。', persona: 'rd', completed: !!rollback, route: releaseRoute(rollback?.id ?? env?.activeReleaseId ?? undefined) },
    { id: 'recover', title: '三筆連續健康觀測', description: '每 60 個 demo ticks 產生一筆一分鐘健康視窗；第三筆才解除告警。', persona: 'any', completed: incident?.state === 'resolved' && incident.recoverySamples === 3, route: incidentRoute },
  ]
  const visibleTask = (operationId: string) => {
    if (s.entities.serviceExecutions.some(e => e.id === operationId)) return !!serviceRoute(s, policy, 'serviceExecution', operationId)
    if (s.entities.changeExecutions.some(e => e.id === operationId)) return !!resourceRoute(s, policy, 'changeExecution', operationId)
    const job = s.jobs.find(j => j.id === operationId)
    if (job) return s.entities.requests.some(r => r.id === job.requestId && policy.canReadJob(r))
    const operation = [...s.entities.pipelines, ...s.entities.releases].find(r => r.id === operationId)
    return !!operation && canReadDelivery(s, policy, operation.environmentId)
  }
  return { applicationId: app?.id ?? null, environmentId: env?.id ?? null, steps, logicalClock: s.logicalClock, storeRevision: s.storeRevision,
    sessionId: s.sessionId, seedVersion: s.seedVersion, schemaVersion: s.schemaVersion, commandCount: s.commandCount,
    pendingTasks: s.scheduler.tasks.filter(t => visibleTask(t.operationId)).length + s.observations.recoveries.filter(r => canReadObservation(s, policy, r.environmentId)).length }
}

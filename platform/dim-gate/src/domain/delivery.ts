import { z } from 'zod'
import { DomainError } from './errors'
import type { Policy } from './policy'
import {
  pipelineRunSchema, releaseSchema, type Environment,
  type Release, type Snapshot,
} from './schema-models'

const fail = (status: number, code: string, message: string): never => { throw new DomainError(status, code, message) }
const missing = (): never => fail(404, 'NOT_FOUND', '此資源不存在或不在目前授權範圍。')
function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw new DomainError(422, 'VALIDATION_ERROR', '輸入欄位不符合契約。', {
    body: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
  })
  return result.data
}
function environment(s: Snapshot, id: string): Environment {
  return s.entities.environments.find(e => e.id === id) ?? missing()
}
export function canReadDelivery(s: Snapshot, policy: Policy, environmentId: string, logs = false) {
  const env = s.entities.environments.find(e => e.id === environmentId)
  const app = env && s.entities.applications.find(a => a.id === env.applicationId && a.orgId === env.orgId)
  return !!env && !!app && env.orgId === policy.user?.orgId && (logs
    ? policy.hasProject(app.projectId, env.stage, 'rd') || policy.hasProject(app.projectId, env.stage, 'ops')
    : policy.canReadEnvironment(env))
}
export function rollbackTargets(s: Snapshot, current: Release) {
  const env = environment(s, current.environmentId)
  if (env.activeReleaseId !== current.id) return []
  return s.entities.releases.filter(r => r.environmentId === current.environmentId && r.orgId === current.orgId
    && r.state === 'succeeded' && r.artifactDigest !== current.artifactDigest
    && s.entities.artifacts.some(a => a.digest === r.artifactDigest && a.applicationId === r.applicationId && a.orgId === r.orgId))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

export function readDelivery(s: Snapshot, policy: Policy, path: string, query: URLSearchParams): unknown {
  const match = /^\/(pipelines|releases)(?:\/([^/]+))?$/.exec(path)
  if (!match) return undefined
  const pipelines = match[1] === 'pipelines'
  const collection = pipelines ? s.entities.pipelines : s.entities.releases
  const visible = collection.filter(r => canReadDelivery(s, policy, r.environmentId, pipelines))
  if (match[2]) {
    if (query.size) fail(422, 'VALIDATION_ERROR', '詳情不接受查詢欄位。')
    const entity = visible.find(r => r.id === match[2]) ?? missing()
    if (pipelines) return structuredClone({ run: entity, logs: s.deliveryLogs.filter(l => l.operationId === entity.id).slice(-500) })
    const release = entity as Release
    const artifact = s.entities.artifacts.find(a => a.digest === release.artifactDigest && a.applicationId === release.applicationId && a.orgId === release.orgId) ?? missing()
    return structuredClone({ release, artifact, rollbackTargets: rollbackTargets(s, release) })
  }
  const listSchema = z.strictObject({
    q: z.string().max(100).optional(), page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(['id', 'updatedAt']).default('id'), order: z.enum(['asc', 'desc']).default('asc'),
    environmentId: z.string().min(1).optional(),
    ...(pipelines ? { applicationId: z.string().min(1).optional(), state: pipelineRunSchema.shape.state.optional() }
      : { state: releaseSchema.shape.state.optional(), kind: releaseSchema.shape.kind.optional() }),
  })
  for (const key of query.keys()) if (query.getAll(key).length !== 1) fail(422, 'VALIDATION_ERROR', '不接受重複 query。')
  const values = parse(listSchema, Object.fromEntries(query))
  const applicationId = 'applicationId' in values ? values.applicationId : undefined
  const kind = 'kind' in values ? values.kind : undefined
  const filtered = visible.filter(r => (!values.environmentId || r.environmentId === values.environmentId)
    && (!applicationId || r.applicationId === applicationId) && (!values.state || r.state === values.state)
    && (!kind || 'kind' in r && r.kind === kind)
    && (!values.q || `${r.id} ${'revision' in r ? r.revision : r.artifactDigest}`.toLowerCase().includes(values.q.toLowerCase())))
    .toSorted((a, b) => (values.order === 'asc' ? 1 : -1) * a[values.sort].localeCompare(b[values.sort]) || a.id.localeCompare(b.id))
  return structuredClone({ items: filtered.slice((values.page - 1) * values.pageSize, values.page * values.pageSize), total: filtered.length, page: values.page, pageSize: values.pageSize })
}

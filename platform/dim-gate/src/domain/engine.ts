import { z } from 'zod'
import {
  advanceClockSchema, centerSchema, ciKindSchema, commandInputSchema, createCiInputSchema,
  createRelationInputSchema, deleteRelationInputSchema, healthSchema, patchCiSchema, providerSchema,
  revokeAssignmentSchema, snapshotSchema, type AuditEvent, type CI, type CommandInput,
  type CommandReceipt, type DashboardView, type GuideView, type Page, type Relation, type Snapshot,
} from './schemas'
import { integrityErrors } from './integrity'
import { policyFor, type Policy } from './policy'

export class DomainError extends Error {
  status: number
  code: string
  fieldErrors?: Record<string, string[]>
  constructor(status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) {
    super(message)
    this.name = 'DomainError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

export interface Engine {
  getSnapshot(): Snapshot
  read(path: string, query: URLSearchParams, actorId: string): unknown
  command(input: CommandInput): Promise<CommandReceipt>
}

const clockIso = (ticks: number) => new Date(Date.parse('2026-09-20T09:00:00Z') + ticks * 1000).toISOString()
const clone = <T>(value: T): T => structuredClone(value)
const fail = (status: number, code: string, message: string): never => { throw new DomainError(status, code, message) }
const notFound = (): never => fail(404, 'NOT_FOUND', '此資源不存在或不在目前授權範圍。')
const forbidden = (): never => fail(403, 'FORBIDDEN', '目前身分沒有此操作的授權。')

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const fields: Record<string, string[]> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'body'
    ;(fields[key] ??= []).push(issue.message)
  }
  throw new DomainError(422, 'VALIDATION_ERROR', '輸入欄位不符合契約。', fields)
}

function assertIntegrity(snapshot: Snapshot): void {
  const errors = integrityErrors(snapshot)
  if (errors.length) throw new DomainError(422, 'INVALID_SNAPSHOT', '示範資料的實體關係不一致。', { snapshot: errors })
}

function validateQuery(query: URLSearchParams, allowed: string[]): void {
  const seen = new Set<string>()
  for (const key of query.keys()) {
    if (!allowed.includes(key) || seen.has(key)) throw new DomainError(422, 'VALIDATION_ERROR', '不支援的查詢欄位或重複欄位。', { [key]: ['Unknown or duplicate query parameter'] })
    seen.add(key)
    if (key !== 'q' && query.get(key) === '') throw new DomainError(422, 'VALIDATION_ERROR', '查詢欄位不可為空。', { [key]: ['Empty query parameter'] })
  }
  if ((query.get('q')?.length ?? 0) > 100) fail(422, 'VALIDATION_ERROR', '搜尋字串最多 100 字元。')
}

function pageValues(query: URLSearchParams): { page: number; pageSize: number } {
  const integer = (key: string, fallback: number, max: number) => {
    const value = query.get(key)
    if (value === null) return fallback
    if (!/^[1-9]\d*$/.test(value) || Number(value) > max) fail(422, 'VALIDATION_ERROR', `${key} 超出允許範圍。`)
    return Number(value)
  }
  return { page: integer('page', 1, Number.MAX_SAFE_INTEGER), pageSize: integer('pageSize', 25, 100) }
}

function basicPage<T>(items: T[], query: URLSearchParams): Page<T> {
  const { page, pageSize } = pageValues(query)
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }
}

function paged<T extends { id: string; name: string; updatedAt: string }>(items: T[], query: URLSearchParams, sortFields: string[]): Page<T> {
  const { page, pageSize } = pageValues(query)
  const sort = query.get('sort') ?? 'name'
  const order = query.get('order') ?? 'asc'
  if (!sortFields.includes(sort) || !['asc', 'desc'].includes(order)) fail(422, 'VALIDATION_ERROR', '不支援此排序。')
  const q = query.get('q')?.trim().toLowerCase()
  const filtered = items.filter((item) => !q || item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q))
  const sorted = filtered.toSorted((a, b) => {
    const av = String(a[sort as keyof T]), bv = String(b[sort as keyof T])
    const comparison = av < bv ? -1 : av > bv ? 1 : 0
    return (order === 'desc' ? -comparison : comparison) || a.id.localeCompare(b.id)
  })
  return { items: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, page, pageSize }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function checksum(value: string): string {
  let hash = 2166136261
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

function freshnessOf(ci: CI, logicalClock: number): 'fresh' | 'stale' | 'unknown' {
  if (ci.observedAt === null) return 'unknown'
  return Date.parse(clockIso(logicalClock)) - Date.parse(ci.observedAt) > 86_400_000 ? 'stale' : 'fresh'
}

function projectCis(snapshot: Snapshot, policy: Policy, query: URLSearchParams): CI[] {
  const provider = query.get('provider'), kind = query.get('kind'), health = query.get('health'), freshness = query.get('freshness')
  if (provider !== null) parse(providerSchema, provider)
  if (kind !== null) parse(ciKindSchema, kind)
  if (health !== null) parse(healthSchema, health)
  if (freshness !== null && !['fresh', 'stale', 'unknown'].includes(freshness)) fail(422, 'VALIDATION_ERROR', '不支援的 freshness。')
  const projectId = query.get('projectId'), environmentId = query.get('environmentId')
  const visibleEnvironments = new Set(snapshot.entities.environments.filter(policy.canReadEnvironment).map((env) => env.id))
  return snapshot.entities.cis.filter((ci) =>
    policy.canReadCi(ci) && (!provider || ci.provider === provider) && (!kind || ci.kind === kind) &&
    (!health || ci.health === health) && (!freshness || freshnessOf(ci, snapshot.logicalClock) === freshness) &&
    (!projectId || policy.hasProject(projectId) && ci.visibilityProjectIds.includes(projectId)) &&
    (!environmentId || visibleEnvironments.has(environmentId) && snapshot.entities.placements.some((placement) => placement.ciId === ci.id && placement.environmentId === environmentId)))
}

function ciView(ci: CI, policy: Policy): CI {
  const view = clone(ci)
  view.visibilityProjectIds = view.visibilityProjectIds.filter((id) => policy.hasProject(id))
  if (!policy.admin && !policy.poolIds.includes(ci.poolId)) {
    delete view.attributes.managementIp
    delete view.attributes.native
    delete view.attributes.hostCiId
  }
  return view
}

function canonicalCiKey(snapshot: Snapshot, ci: Pick<CI, 'orgId' | 'provider' | 'accountId' | 'locationId' | 'kind' | 'externalId'>): string {
  const location = snapshot.entities.locations.find((entry) => entry.id === ci.locationId && entry.orgId === ci.orgId)
  const locationKey = location && ('region' in location ? location.region : location.site)
  return canonical([ci.orgId, ci.provider, ci.accountId ?? null, locationKey, ci.kind, ci.externalId])
}

function visibleAudit(snapshot: Snapshot, policy: Policy, audit: AuditEvent): boolean {
  if (policy.admin) return audit.orgId === policy.user?.orgId
  if (audit.entityType === 'ci') {
    const ci = snapshot.entities.cis.find((entry) => entry.id === audit.entityId)
    return !!ci && policy.canReadCi(ci)
  }
  if (audit.entityType === 'application') {
    const app = snapshot.entities.applications.find((entry) => entry.id === audit.entityId)
    return !!app && policy.hasProject(app.projectId)
  }
  if (audit.entityType === 'environment') {
    const environment = snapshot.entities.environments.find((entry) => entry.id === audit.entityId)
    return !!environment && policy.canReadEnvironment(environment)
  }
  if (audit.entityType === 'relation') {
    const relation = snapshot.entities.relations.find((entry) => entry.id === audit.entityId)
    if (!relation) return audit.scopeSnapshot.projectIds.some((id) => policy.hasProject(id)) || audit.scopeSnapshot.poolIds.some((id) => policy.poolIds.includes(id))
    const source = snapshot.entities.cis.find((entry) => entry.id === relation.sourceCiId)
    const target = snapshot.entities.cis.find((entry) => entry.id === relation.targetCiId)
    return !!source && !!target && policy.canReadCi(source) && policy.canReadCi(target)
  }
  return audit.scopeSnapshot.projectIds.some((id) => policy.hasProject(id)) || audit.scopeSnapshot.poolIds.some((id) => policy.poolIds.includes(id))
}

function topology(snapshot: Snapshot, policy: Policy, query: URLSearchParams) {
  const ciId = query.get('ciId'), environmentId = query.get('environmentId')
  if (Boolean(ciId) === Boolean(environmentId)) fail(422, 'VALIDATION_ERROR', '請指定一個且僅一個拓撲根節點。')
  const mode = query.get('mode')
  if (mode !== 'dependencies' && mode !== 'impact') fail(422, 'VALIDATION_ERROR', '不支援的拓撲模式。')
  const depthValue = query.get('depth') ?? '1'
  if (!/^[1-3]$/.test(depthValue)) fail(422, 'VALIDATION_ERROR', '拓撲深度必須為 1 到 3。')
  const maxDepth = Number(depthValue)
  const visible = new Map(snapshot.entities.cis.filter(policy.canReadCi).map((ci) => [ci.id, ci]))
  let roots: string[]
  if (ciId) {
    if (!visible.has(ciId)) notFound()
    roots = [ciId]
  } else {
    const environment = snapshot.entities.environments.find((entry) => entry.id === environmentId && policy.canReadEnvironment(entry))
    if (!environment) notFound()
    roots = snapshot.entities.placements.filter((entry) => entry.environmentId === environmentId && visible.has(entry.ciId)).map((entry) => entry.ciId)
  }
  const visibleRelations = snapshot.entities.relations.filter((relation) => visible.has(relation.sourceCiId) && visible.has(relation.targetCiId))
  const nodeIds = new Set(roots.slice(0, 100))
  const edgeIds = new Set<string>()
  const queue = [...nodeIds].map((id) => ({ id, depth: 0 }))
  let depthReached = 0
  let truncated = roots.length > 100
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    const candidates = visibleRelations.filter((relation) => mode === 'dependencies'
      ? relation.sourceCiId === current.id
      : relation.type !== 'connects_to' && relation.targetCiId === current.id)
    if (current.depth >= maxDepth) {
      if (candidates.some((relation) => !nodeIds.has(mode === 'dependencies' ? relation.targetCiId : relation.sourceCiId))) truncated = true
      continue
    }
    for (const relation of candidates.toSorted((a, b) => a.id.localeCompare(b.id))) {
      const neighbor = mode === 'dependencies' ? relation.targetCiId : relation.sourceCiId
      if (!nodeIds.has(neighbor)) {
        if (nodeIds.size >= 100) { truncated = true; continue }
        nodeIds.add(neighbor)
        queue.push({ id: neighbor, depth: current.depth + 1 })
        depthReached = Math.max(depthReached, current.depth + 1)
      }
      if (!edgeIds.has(relation.id)) {
        if (edgeIds.size >= 200) { truncated = true; continue }
        edgeIds.add(relation.id)
      }
    }
  }
  return {
    nodes: [...nodeIds].map((id) => ciView(visible.get(id)!, policy)),
    edges: visibleRelations.filter((relation) => edgeIds.has(relation.id)).map(clone),
    truncated, depthReached,
  }
}

export function createEngine(initial: Snapshot, persist: (next: Snapshot) => void): Engine {
  let state = parse(snapshotSchema, initial)
  assertIntegrity(state)
  let queue: Promise<unknown> = Promise.resolve()

  function context(actorId: string): Policy {
    const policy = policyFor(state, actorId)
    if (!policy.user) fail(401, 'UNAUTHENTICATED', '請選擇有效的示範身分。')
    return policy
  }

  function read(path: string, query: URLSearchParams, actorId: string): unknown {
    const policy = context(actorId)
    const entities = state.entities
    if (path === '/session') {
      validateQuery(query, [])
      return clone({ user: { id: policy.user!.id, displayName: policy.user!.displayName }, assignments: policy.assignments,
        effectiveActions: policy.effectiveActions, centers: policy.centers, demo: true, sessionId: state.sessionId,
        policyVersion: state.policyVersion, storeRevision: state.storeRevision, logicalClock: state.logicalClock })
    }
    if (path === '/guide') {
      validateQuery(query, [])
      return { logicalClock: state.logicalClock, storeRevision: state.storeRevision, sessionId: state.sessionId,
        seedVersion: state.seedVersion, schemaVersion: state.schemaVersion, pendingTasks: state.scheduler.tasks.length, commandCount: state.commandCount } satisfies GuideView
    }
    if (path === '/dashboard' || path === '/navigation') {
      validateQuery(query, path === '/dashboard' ? ['center', 'projectId', 'environmentId'] : ['center'])
      const center = parse(centerSchema, query.get('center'))
      if (!policy.centers.includes(center)) forbidden()
      if (path === '/navigation') return clone(entities.navigation.filter((item) => item.orgId === policy.user!.orgId && item.enabled && (item.routeKey === 'guide' || item.routeKey === `${center}.overview`)).toSorted((a, b) => a.order - b.order || a.id.localeCompare(b.id)))
      const projectId = query.get('projectId'), environmentId = query.get('environmentId')
      const visibleEnvironments = entities.environments.filter((env) => policy.canReadEnvironment(env) && (!environmentId || env.id === environmentId))
      const applications = entities.applications.filter((app) => app.orgId === policy.user!.orgId && policy.hasProject(app.projectId) && (!projectId || app.projectId === projectId) && (!environmentId || visibleEnvironments.some((env) => env.applicationId === app.id)))
      const appIds = new Set(applications.map((app) => app.id))
      const cis = projectCis(state, policy, query)
      return {
        center, title: { rd: '研發中心', ops: '維運中心', admin: '平台管理' }[center], applicationCount: applications.length,
        environmentCount: visibleEnvironments.filter((env) => appIds.has(env.applicationId)).length, ciCount: cis.length,
        providers: (['aws', 'aliyun', 'onprem'] as const).map((provider) => ({ provider, count: cis.filter((ci) => ci.provider === provider).length })),
        dataAsOf: clockIso(state.logicalClock),
      } satisfies DashboardView
    }
    if (path === '/organization') {
      validateQuery(query, [])
      const projects = entities.projects.filter((project) => project.orgId === policy.user!.orgId && policy.hasProject(project.id))
      const teamIds = new Set([...projects.map((project) => project.teamId), ...policy.user!.teamIds])
      const teams = entities.teams.filter((team) => team.orgId === policy.user!.orgId && (policy.admin || teamIds.has(team.id)))
      return clone({ organizations: entities.organizations.filter((org) => org.id === policy.user!.orgId),
        businessUnits: entities.businessUnits.filter((unit) => unit.orgId === policy.user!.orgId && (policy.admin || teams.some((team) => team.businessUnitId === unit.id))), teams, projects,
        users: entities.users.filter((user) => user.orgId === policy.user!.orgId && (policy.admin || user.id === actorId)) })
    }
    if (path === '/applications') {
      validateQuery(query, ['projectId', 'q', 'page', 'pageSize', 'sort', 'order'])
      const projectId = query.get('projectId')
      return clone(paged(entities.applications.filter((app) => app.orgId === policy.user!.orgId && policy.hasProject(app.projectId) && (!projectId || app.projectId === projectId)), query, ['id', 'name', 'updatedAt']))
    }
    const applicationId = /^\/applications\/([^/]+)$/.exec(path)?.[1]
    if (applicationId) {
      validateQuery(query, [])
      const application = entities.applications.find((entry) => entry.id === applicationId && entry.orgId === policy.user!.orgId && policy.hasProject(entry.projectId))
      if (!application) notFound()
      return clone({ application, environments: entities.environments.filter((entry) => entry.applicationId === applicationId && policy.canReadEnvironment(entry)) })
    }
    const environmentId = /^\/environments\/([^/]+)$/.exec(path)?.[1]
    if (environmentId) {
      validateQuery(query, [])
      const environment = entities.environments.find((entry) => entry.id === environmentId && policy.canReadEnvironment(entry))
      if (!environment) notFound()
      return clone({ environment, placements: entities.placements.filter((entry) => entry.environmentId === environmentId && entities.cis.some((ci) => ci.id === entry.ciId && policy.canReadCi(ci))), activeRelease: null })
    }
    if (path === '/cis') {
      validateQuery(query, ['provider', 'kind', 'projectId', 'environmentId', 'health', 'freshness', 'q', 'page', 'pageSize', 'sort', 'order'])
      const page = paged(projectCis(state, policy, query), query, ['id', 'name', 'updatedAt', 'provider', 'kind', 'health'])
      return { ...page, items: page.items.map((ci) => ciView(ci, policy)) }
    }
    const ciId = /^\/cis\/([^/]+)$/.exec(path)?.[1]
    if (ciId) {
      validateQuery(query, [])
      const ci = entities.cis.find((entry) => entry.id === ciId && policy.canReadCi(entry))
      if (!ci) notFound()
      return ciView(ci!, policy)
    }
    if (path === '/search') {
      validateQuery(query, ['q', 'limit'])
      const q = query.get('q')?.trim().toLowerCase()
      if (!q) fail(422, 'VALIDATION_ERROR', '搜尋字串不可為空。')
      const limitValue = query.get('limit') ?? '10'
      if (!/^([1-9]|1\d|20)$/.test(limitValue)) fail(422, 'VALIDATION_ERROR', '搜尋上限必須為 1 到 20。')
      const hits = [
        ...entities.applications.filter((entry) => policy.hasProject(entry.projectId)).map((entry) => ({ type: 'application', id: entry.id, title: entry.name, route: `/rd/apps/${entry.id}` })),
        ...entities.environments.filter(policy.canReadEnvironment).map((entry) => {
          const app = entities.applications.find((candidate) => candidate.id === entry.applicationId)!
          return { type: 'environment', id: entry.id, title: `${app.name} · ${entry.name}`, route: `/rd/apps/${app.id}/environments/${entry.id}` }
        }),
        ...entities.cis.filter(policy.canReadCi).map((entry) => ({ type: 'ci', id: entry.id, title: entry.name, route: `/ops/cmdb/${entry.id}` })),
      ].filter((entry) => entry.title.toLowerCase().includes(q!) || entry.id.toLowerCase().includes(q!))
        .toSorted((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
        .slice(0, Number(limitValue))
      return { items: clone(hits) }
    }
    if (path === '/relations') {
      validateQuery(query, ['ciId', 'direction', 'page', 'pageSize', 'sort', 'order'])
      const rootId = query.get('ciId')
      if (!rootId) fail(422, 'VALIDATION_ERROR', 'ciId 為必填。')
      const direction = query.get('direction') ?? 'both'
      if (!['in', 'out', 'both'].includes(direction)) fail(422, 'VALIDATION_ERROR', '不支援的關係方向。')
      if (!entities.cis.some((entry) => entry.id === rootId && policy.canReadCi(entry))) notFound()
      const visibleIds = new Set(entities.cis.filter(policy.canReadCi).map((entry) => entry.id))
      const relations = entities.relations.filter((entry) => visibleIds.has(entry.sourceCiId) && visibleIds.has(entry.targetCiId) &&
        (direction === 'both' || direction === 'in' && entry.targetCiId === rootId || direction === 'out' && entry.sourceCiId === rootId) &&
        (entry.sourceCiId === rootId || entry.targetCiId === rootId)).toSorted((a, b) => a.id.localeCompare(b.id))
      return clone(basicPage(relations, query))
    }
    if (path === '/topology') {
      validateQuery(query, ['ciId', 'environmentId', 'mode', 'depth'])
      return clone(topology(state, policy, query))
    }
    if (path === '/capacity') {
      validateQuery(query, ['provider', 'projectId'])
      const provider = query.get('provider')
      if (provider) parse(providerSchema, provider)
      const projectId = query.get('projectId')
      if (projectId && !policy.hasProject(projectId)) return []
      const visibleCis = entities.cis.filter((entry) => policy.canReadCi(entry) && (!projectId || entry.visibilityProjectIds.includes(projectId)))
      const pools = entities.pools.filter((pool) => pool.orgId === policy.user!.orgId && (!provider || pool.provider === provider) &&
        (policy.admin || policy.poolIds.includes(pool.id) || pool.scopeProjectIds.some((id) => policy.hasProject(id))) &&
        (!projectId || pool.scopeProjectIds.includes(projectId)))
      return pools.map((pool) => {
        const compute = visibleCis.filter((ci) => ci.poolId === pool.id && ci.kind === 'compute' && ci.lifecycle === 'active')
        const cpuUsed = compute.reduce((sum, ci) => sum + Number(ci.attributes.cpu), 0)
        const memoryUsed = compute.reduce((sum, ci) => sum + Number(ci.attributes.memoryMiB), 0)
        return { poolId: pool.id, cpu: { used: cpuUsed, reserved: 0, available: Math.max(0, pool.cpuCapacity - cpuUsed) },
          memoryMiB: { used: memoryUsed, reserved: 0, available: Math.max(0, pool.memoryCapacityMiB - memoryUsed) } }
      })
    }
    if (path === '/audit') {
      validateQuery(query, ['entityType', 'entityId', 'correlationId', 'actorId', 'from', 'to', 'q', 'page', 'pageSize', 'sort', 'order'])
      const filters = Object.fromEntries(['entityType', 'entityId', 'correlationId', 'actorId'].map((key) => [key, query.get(key)]))
      const items = state.audit.filter((entry) => visibleAudit(state, policy, entry) &&
        Object.entries(filters).every(([key, value]) => !value || String(entry[key as keyof AuditEvent]) === value))
        .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))
      return clone(basicPage(items, query))
    }
    return notFound()
  }

  function execute(raw: CommandInput): CommandReceipt {
    const input = parse(commandInputSchema, raw)
    if (input.sessionId !== state.sessionId) fail(401, 'UNAUTHENTICATED', '示範 session 已變更，請重新讀取。')
    const policy = context(input.actorId)
    const method = input.method.toUpperCase()
    const patchCiId = method === 'PATCH' ? /^\/cis\/([^/]+)$/.exec(input.path)?.[1] : undefined
    const createCi = method === 'POST' && input.path === '/cis'
    const createRelation = method === 'POST' && input.path === '/relations'
    const deleteRelationId = method === 'DELETE' ? /^\/relations\/([^/]+)$/.exec(input.path)?.[1] : undefined
    const assignmentId = method === 'DELETE' ? /^\/admin\/assignments\/([^/]+)$/.exec(input.path)?.[1] : undefined
    const clock = method === 'POST' && input.path === '/clock/advance'
    if (!patchCiId && !createCi && !createRelation && !deleteRelationId && !assignmentId && !clock) fail(501, 'NOT_IMPLEMENTED', '此操作尚未在目前里程碑提供。')

    const body = patchCiId ? parse(patchCiSchema, input.body)
      : createCi ? parse(createCiInputSchema, input.body)
        : createRelation ? parse(createRelationInputSchema, input.body)
          : deleteRelationId ? parse(deleteRelationInputSchema, input.body)
            : assignmentId ? parse(revokeAssignmentSchema, input.body)
              : parse(advanceClockSchema, input.body)
    const bodyString = canonical(input.body)
    const replay = state.idempotency.find((record) => record.sessionId === input.sessionId && record.actorId === input.actorId && record.method === method && record.path === input.path && record.key === input.key)

    let ci: CI | undefined
    let relation: Relation | undefined
    if (patchCiId) {
      ci = state.entities.cis.find((entry) => entry.id === patchCiId && policy.canReadCi(entry))
      if (!ci) notFound()
      if (!policy.canWriteCi(ci!)) forbidden()
      const patch = body as z.infer<typeof patchCiSchema>
      if (patch.visibilityProjectIds && !patch.visibilityProjectIds.every((id) => policy.hasProject(id, undefined, 'ops'))) forbidden()
      if (patch.ownerTeamId && !ci!.visibilityProjectIds.every((id) => policy.hasProject(id, undefined, 'ops'))) forbidden()
    } else if (createCi) {
      const create = body as z.infer<typeof createCiInputSchema>
      if (!policy.centers.includes('ops') || !policy.poolIds.includes(create.poolId) || !create.visibilityProjectIds.every((id) => policy.hasProject(id, undefined, 'ops'))) forbidden()
    } else if (createRelation) {
      const create = body as z.infer<typeof createRelationInputSchema>
      const endpoints = [create.sourceCiId, create.targetCiId].map((id) => state.entities.cis.find((entry) => entry.id === id && policy.canReadCi(entry)))
      if (endpoints.some((entry) => !entry)) notFound()
      if (endpoints.some((entry) => !policy.canWriteCi(entry!))) forbidden()
    } else if (deleteRelationId) {
      relation = state.entities.relations.find((entry) => entry.id === deleteRelationId)
      const replayEndpointIds = replay?.receipt.changed.filter((entry) => entry.entityType === 'ci').map((entry) => entry.entityId) ?? []
      const endpointIds = relation ? [relation.sourceCiId, relation.targetCiId] : replayEndpointIds
      const endpoints = endpointIds.map((id) => state.entities.cis.find((entry) => entry.id === id && policy.canReadCi(entry)))
      if (endpoints.length !== 2 || endpoints.some((entry) => !entry)) notFound()
      if (endpoints.some((entry) => !policy.canWriteCi(entry!))) forbidden()
    } else if (assignmentId) {
      if (!policy.admin) forbidden()
      const assignment = state.entities.assignments.find((entry) => entry.id === assignmentId)
      if (assignment && !policy.canManageAssignment(assignment)) notFound()
    }
    if (replay) {
      if (replay.canonicalBody !== bodyString) fail(409, 'IDEMPOTENCY_CONFLICT', '同一冪等 key 已用於不同內容。')
      return clone(replay.receipt)
    }
    if (state.commandCount >= 1000) fail(429, 'DEMO_COMMAND_LIMIT', '此 session 已達 1,000 筆指令上限，請重置示範。')

    const next = clone(state)
    let entityType: string, entityId: string, entityVersion: number, action: string
    let reason: string | undefined
    let fields: string[]
    let changed: CommandReceipt['changed']

    if (patchCiId) {
      const patch = body as z.infer<typeof patchCiSchema>
      if (patch.expectedVersion !== ci!.version) fail(409, 'VERSION_CONFLICT', '資源版本已變更，請重新讀取後再確認。')
      if (patch.visibilityProjectIds) {
        for (const id of patch.visibilityProjectIds) {
          if (!state.entities.projects.some((project) => project.id === id && project.orgId === policy.user!.orgId)) fail(422, 'VALIDATION_ERROR', '可見專案不存在。')
        }
        for (const placement of state.entities.placements.filter((entry) => entry.ciId === patchCiId)) {
          const app = state.entities.applications.find((entry) => entry.id === placement.applicationId)!
          if (!patch.visibilityProjectIds.includes(app.projectId)) fail(409, 'INVALID_STATE', '不能移除既有 placement 所屬專案的可見性。')
        }
      }
      if (patch.ownerTeamId && !state.entities.teams.some((team) => team.id === patch.ownerTeamId && team.orgId === policy.user!.orgId)) fail(422, 'VALIDATION_ERROR', '責任團隊不存在。')
      if (patch.customFields) validateCustomFields(state, ci!, patch.customFields)
      const updated = next.entities.cis.find((entry) => entry.id === patchCiId)!
      const { expectedVersion: _expectedVersion, ...metadata } = patch
      void _expectedVersion
      Object.assign(updated, metadata, { version: updated.version + 1, updatedAt: clockIso(next.logicalClock) })
      entityType = 'ci'; entityId = patchCiId; entityVersion = updated.version; action = 'ci.update'; fields = Object.keys(metadata)
      changed = [{ entityType, entityId }]
    } else if (createCi) {
      const create = body as z.infer<typeof createCiInputSchema>
      const pool = state.entities.pools.find((entry) => entry.id === create.poolId && entry.orgId === policy.user!.orgId)
      const location = state.entities.locations.find((entry) => entry.id === create.locationId && entry.orgId === policy.user!.orgId)
      const account = state.entities.accounts.find((entry) => entry.id === create.accountId && entry.orgId === policy.user!.orgId)
      if (!pool || !location || pool.provider !== create.provider || location.provider !== create.provider ||
        pool.locationId !== create.locationId || pool.accountId !== create.accountId ||
        create.provider !== 'onprem' && (!account || account.provider !== create.provider)) {
        throw new DomainError(422, 'VALIDATION_ERROR', 'provider、account、location 與 pool 必須相容。', { provider: ['Incompatible provider identity'] })
      }
      if (!state.entities.teams.some((entry) => entry.id === create.ownerTeamId && entry.orgId === policy.user!.orgId) ||
        !create.visibilityProjectIds.every((id) => state.entities.projects.some((entry) => entry.id === id && entry.orgId === policy.user!.orgId) && pool.scopeProjectIds.includes(id))) {
        throw new DomainError(422, 'VALIDATION_ERROR', '責任團隊或可見專案不存在。')
      }
      const candidate: CI = { ...create, id: `ci-manual-${String(state.sequence + 1).padStart(4, '0')}`, orgId: policy.user!.orgId,
        version: 1, createdAt: clockIso(state.logicalClock), updatedAt: clockIso(state.logicalClock),
        health: 'unknown', source: 'manual', observedAt: null }
      if (state.entities.cis.some((entry) => canonicalCiKey(state, entry) === canonicalCiKey(state, candidate))) fail(409, 'DUPLICATE_RESOURCE', '相同 canonical identity 的 CI 已存在。')
      if (candidate.kind === 'compute') {
        const active = state.entities.cis.filter((entry) => entry.poolId === pool.id && entry.kind === 'compute' && entry.lifecycle === 'active')
        const cpu = active.reduce((sum, entry) => sum + Number(entry.attributes.cpu), 0) + Number(candidate.attributes.cpu)
        const memory = active.reduce((sum, entry) => sum + Number(entry.attributes.memoryMiB), 0) + Number(candidate.attributes.memoryMiB)
        if (cpu > pool.cpuCapacity || memory > pool.memoryCapacityMiB) fail(409, 'CAPACITY_EXCEEDED', '資源池容量不足。')
      }
      next.entities.cis.push(candidate)
      entityType = 'ci'; entityId = candidate.id; entityVersion = 1; action = 'ci.create'; fields = Object.keys(create)
      changed = [{ entityType, entityId }]
    } else if (createRelation) {
      const create = body as z.infer<typeof createRelationInputSchema>
      const source = state.entities.cis.find((entry) => entry.id === create.sourceCiId)!
      const target = state.entities.cis.find((entry) => entry.id === create.targetCiId)!
      if (source.version !== create.sourceExpectedVersion || target.version !== create.targetExpectedVersion) fail(409, 'VERSION_CONFLICT', '關係端點版本已變更。')
      if (state.entities.relations.some((entry) => entry.sourceCiId === source.id && entry.targetCiId === target.id && entry.type === create.type)) fail(409, 'DUPLICATE_RESOURCE', '相同關係已存在。')
      const created: Relation = { id: `relation-manual-${String(state.sequence + 1).padStart(4, '0')}`, orgId: policy.user!.orgId,
        version: 1, createdAt: clockIso(state.logicalClock), updatedAt: clockIso(state.logicalClock),
        sourceCiId: source.id, targetCiId: target.id, type: create.type, source: 'manual', confidence: 'verified' }
      next.entities.relations.push(created)
      if (create.type === 'runs_on' && hasRunsOnCycle(next, source.id)) fail(409, 'INVALID_STATE', 'runs_on 關係不可形成 cycle。')
      entityType = 'relation'; entityId = created.id; entityVersion = 1; action = 'relation.create'; fields = ['sourceCiId', 'targetCiId', 'type']; reason = create.reason
      changed = [{ entityType, entityId }, { entityType: 'ci', entityId: source.id }, { entityType: 'ci', entityId: target.id }]
    } else if (deleteRelationId) {
      const deletion = body as z.infer<typeof deleteRelationInputSchema>
      if (!relation) notFound()
      if (relation!.source !== 'manual') fail(409, 'INVALID_STATE', '只能刪除手動關係。')
      if (deletion.expectedVersion !== relation!.version) fail(409, 'VERSION_CONFLICT', '關係版本已變更。')
      next.entities.relations = next.entities.relations.filter((entry) => entry.id !== relation!.id)
      entityType = 'relation'; entityId = relation!.id; entityVersion = relation!.version + 1; action = 'relation.delete'; fields = ['relation deleted']; reason = deletion.reason
      changed = [{ entityType, entityId }, { entityType: 'ci', entityId: relation!.sourceCiId }, { entityType: 'ci', entityId: relation!.targetCiId }]
    } else if (assignmentId) {
      const patch = body as z.infer<typeof revokeAssignmentSchema>
      const assignment = state.entities.assignments.find((entry) => entry.id === assignmentId)
      if (!assignment) notFound()
      if (assignment!.userId === input.actorId) fail(403, 'SELF_MODIFICATION_DENIED', '不能修改自己的角色授權。')
      if (assignment!.role === 'admin' && !state.entities.assignments.some((entry) => entry.id !== assignment!.id && entry.role === 'admin' && entry.orgId === assignment!.orgId && state.entities.users.some((user) => user.id === entry.userId && user.enabled))) fail(409, 'LAST_ADMIN_REQUIRED', '必須保留一位啟用中的平台管理者。')
      if (patch.expectedVersion !== assignment!.version) fail(409, 'VERSION_CONFLICT', '授權版本已變更。')
      next.entities.assignments = next.entities.assignments.filter((entry) => entry.id !== assignmentId)
      next.policyVersion += 1
      entityType = 'roleAssignment'; entityId = assignmentId; entityVersion = assignment!.version + 1; action = 'access.write'; fields = ['assignment revoked']; reason = patch.reason
      changed = [{ entityType, entityId }]
    } else {
      next.logicalClock += (body as z.infer<typeof advanceClockSchema>).ticks
      entityType = 'demoSession'; entityId = next.sessionId; entityVersion = next.storeRevision + 1; action = 'demo.clock.advance'; fields = ['logicalClock']
      changed = [{ entityType, entityId }]
    }

    next.sequence += 1
    next.storeRevision += 1
    next.commandCount += 1
    const serial = String(next.sequence).padStart(4, '0')
    const correlationId = `corr-command-${serial}`
    const receipt: CommandReceipt = { entityType, entityId, entityVersion, correlationId, changed }
    next.events.push({ eventId: `event-${serial}`, entities: changed, type: action, occurredAt: clockIso(next.logicalClock), correlationId })
    const changedCis = changed.filter((entry) => entry.entityType === 'ci')
      .map((entry) => state.entities.cis.find((ci) => ci.id === entry.entityId) ?? next.entities.cis.find((ci) => ci.id === entry.entityId))
      .filter((entry): entry is CI => Boolean(entry))
    const auditProjectIds = changedCis.length ? [...new Set(changedCis.flatMap((entry) => entry.visibilityProjectIds))] : policy.projectIds
    const auditPoolIds = changedCis.length ? [...new Set(changedCis.map((entry) => entry.poolId))] : policy.poolIds
    next.audit.push({ id: `audit-${serial}`, orgId: policy.user!.orgId, actorId: input.actorId, action, entityType, entityId,
      scopeSnapshot: { projectIds: auditProjectIds, poolIds: auditPoolIds, stages: [...new Set(policy.assignments.filter((assignment) => assignment.scopeType === 'project').flatMap((assignment) => assignment.stages ?? ['dev', 'staging', 'prod'] as const))] },
      outcome: 'succeeded', diffSummary: fields, ...(reason ? { reason } : {}), requestId: `command-${serial}`, correlationId, occurredAt: clockIso(next.logicalClock) })
    next.idempotency.push({ sessionId: input.sessionId, actorId: input.actorId, method, path: input.path, key: input.key, bodyHash: checksum(bodyString), canonicalBody: bodyString, receipt })
    const validated = parse(snapshotSchema, next)
    assertIntegrity(validated)
    if (serializedBytes(validated) > 3 * 1024 * 1024) fail(507, 'DEMO_STORAGE_FULL', '示範資料超出 3 MiB 儲存上限；本次未保存。')
    try { persist(clone(validated)) } catch (error) {
      if (error instanceof DomainError) throw error
      fail(507, 'DEMO_STORAGE_FULL', '無法保存示範資料；本次變更未提交，可稍後重試。')
    }
    state = validated
    return clone(receipt)
  }

  return {
    getSnapshot: () => clone(state), read,
    command: (input) => {
      const copied = clone(input)
      const result = queue.then(() => execute(copied))
      queue = result.catch(() => undefined)
      return result
    },
  }
}

function hasRunsOnCycle(snapshot: Snapshot, startId: string): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const relation of snapshot.entities.relations.filter((entry) => entry.type === 'runs_on' && entry.sourceCiId === id)) {
      if (visit(relation.targetCiId)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return visit(startId)
}

function validateCustomFields(snapshot: Snapshot, ci: CI, values: CI['customFields']): void {
  for (const [key, value] of Object.entries(values)) {
    const field = snapshot.entities.modelFields.find((entry) => entry.orgId === ci.orgId && entry.kind === ci.kind && entry.key === key)
    if (!field || typeof value !== field.valueType) throw new DomainError(422, 'VALIDATION_ERROR', '自訂欄位不存在或型別不符。', { [`customFields.${key}`]: ['Unknown field or invalid type'] })
    const constraints = field.constraints
    if (typeof value === 'string' && ((constraints.maxLength !== undefined && value.length > constraints.maxLength) || (constraints.enum && !constraints.enum.includes(value)))) fail(422, 'VALIDATION_ERROR', '自訂欄位不符合字串限制。')
    if (typeof value === 'number' && ((constraints.min !== undefined && value < constraints.min) || (constraints.max !== undefined && value > constraints.max))) fail(422, 'VALIDATION_ERROR', '自訂欄位不符合數值限制。')
  }
}

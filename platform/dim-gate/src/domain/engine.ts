import { z } from 'zod'
import {
  advanceClockSchema, centerSchema, ciKindSchema, commandInputSchema, healthSchema, patchCiSchema, providerSchema,
  revokeAssignmentSchema, snapshotSchema, type CI, type CommandInput, type CommandReceipt,
  type DashboardView, type GuideView, type Page, type Snapshot,
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

function paged<T extends { id: string; name: string; updatedAt: string }>(items: T[], query: URLSearchParams, sortFields: string[]): Page<T> {
  const integer = (key: string, fallback: number, max: number) => {
    const value = query.get(key)
    if (value === null) return fallback
    if (!/^[1-9]\d*$/.test(value) || Number(value) > max) fail(422, 'VALIDATION_ERROR', `${key} 超出允許範圍。`)
    return Number(value)
  }
  const page = integer('page', 1, Number.MAX_SAFE_INTEGER)
  const pageSize = integer('pageSize', 25, 100)
  const sort = query.get('sort') ?? 'name'
  const order = query.get('order') ?? 'asc'
  if (!sortFields.includes(sort) || !['asc', 'desc'].includes(order)) fail(422, 'VALIDATION_ERROR', '不支援此排序。')
  const q = query.get('q')?.trim().toLowerCase()
  const filtered = items.filter((item) => !q || item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q))
  const sorted = filtered.toSorted((a, b) => {
    const av = String(a[sort as keyof T]), bv = String(b[sort as keyof T])
    const comparison = av < bv ? -1 : av > bv ? 1 : 0
    return (order === 'desc' ? -comparison : comparison) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
  return { items: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, page, pageSize }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

// The canonical body is also retained and compared, so this compact checksum cannot introduce a collision-based replay.
function checksum(value: string): string {
  let hash = 2166136261
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`
}

function serializedBytes(value: unknown): number {
  let bytes = 0
  for (const char of JSON.stringify(value)) {
    const code = char.codePointAt(0)!
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}

function projectCis(snapshot: Snapshot, policy: Policy, query: URLSearchParams): CI[] {
  const provider = query.get('provider'), kind = query.get('kind'), health = query.get('health'), freshness = query.get('freshness')
  if (provider !== null) parse(providerSchema, provider)
  if (kind !== null) parse(ciKindSchema, kind)
  if (health !== null) parse(healthSchema, health)
  if (freshness !== null && !['fresh', 'stale'].includes(freshness)) fail(422, 'VALIDATION_ERROR', '不支援的 freshness。')
  const projectId = query.get('projectId'), environmentId = query.get('environmentId')
  const visibleEnvironments = new Set(snapshot.entities.environments.filter(policy.canReadEnvironment).map((env) => env.id))
  return snapshot.entities.cis.filter((ci) => {
    const isStale = ci.observedAt === null || Date.parse(clockIso(snapshot.logicalClock)) - Date.parse(ci.observedAt) > 86400000
    return policy.canReadCi(ci) && (!provider || ci.provider === provider) && (!kind || ci.kind === kind) && (!health || ci.health === health) &&
      (!freshness || (freshness === 'stale') === isStale) &&
      (!projectId || policy.hasProject(projectId) && ci.visibilityProjectIds.includes(projectId)) &&
      (!environmentId || visibleEnvironments.has(environmentId) && snapshot.entities.placements.some((placement) => placement.ciId === ci.id && placement.environmentId === environmentId))
  })
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
    if (path === '/cis') {
      validateQuery(query, ['provider', 'kind', 'projectId', 'environmentId', 'health', 'freshness', 'q', 'page', 'pageSize', 'sort', 'order'])
      const page = paged(projectCis(state, policy, query), query, ['id', 'name', 'updatedAt', 'provider', 'kind', 'health'])
      return { ...page, items: page.items.map((ci) => ciView(ci, policy)) }
    }
    const ciId = /^\/cis\/([^/]+)$/.exec(path)?.[1]
    if (ciId) {
      validateQuery(query, [])
      const ci = entities.cis.find((entry) => entry.id === ciId && policy.canReadCi(entry))
      if (!ci) return notFound()
      return ciView(ci, policy)
    }
    return notFound()
  }

  function execute(raw: CommandInput): CommandReceipt {
    const input = parse(commandInputSchema, raw)
    if (input.sessionId !== state.sessionId) fail(401, 'UNAUTHENTICATED', '示範 session 已變更，請重新讀取。')
    const policy = context(input.actorId)
    const method = input.method.toUpperCase()
    const ciId = method === 'PATCH' ? /^\/cis\/([^/]+)$/.exec(input.path)?.[1] : undefined
    const assignmentId = method === 'DELETE' ? /^\/admin\/assignments\/([^/]+)$/.exec(input.path)?.[1] : undefined
    const clock = method === 'POST' && input.path === '/clock/advance'
    let ci: CI | undefined
    if (ciId) {
      ci = state.entities.cis.find((entry) => entry.id === ciId && policy.canReadCi(entry))
      if (!ci) notFound()
      if (!policy.canWriteCi(ci!)) forbidden()
    } else if (assignmentId) {
      if (!policy.admin) forbidden()
      const assignment = state.entities.assignments.find((entry) => entry.id === assignmentId)
      if (assignment && !policy.canManageAssignment(assignment)) notFound()
    } else if (!clock) fail(501, 'NOT_IMPLEMENTED', '此操作尚未在目前里程碑提供。')

    // Validation precedes replay. Authorization, including revoked pool grants, is always evaluated first.
    const body = ciId ? parse(patchCiSchema, input.body) : assignmentId ? parse(revokeAssignmentSchema, input.body) : parse(advanceClockSchema, input.body)
    if (ciId) {
      const patch = body as z.infer<typeof patchCiSchema>
      if (patch.visibilityProjectIds && !patch.visibilityProjectIds.every((id) => policy.hasProject(id, undefined, 'ops'))) forbidden()
      if (patch.ownerTeamId && !ci!.visibilityProjectIds.every((id) => policy.hasProject(id, undefined, 'ops'))) forbidden()
    }
    const bodyString = canonical(input.body)
    const replay = state.idempotency.find((record) => record.sessionId === input.sessionId && record.actorId === input.actorId && record.method === method && record.path === input.path && record.key === input.key)
    if (replay) {
      if (replay.canonicalBody !== bodyString) fail(409, 'IDEMPOTENCY_CONFLICT', '同一冪等 key 已用於不同內容。')
      return clone(replay.receipt)
    }
    if (state.commandCount >= 1000) fail(429, 'DEMO_COMMAND_LIMIT', '此 session 已達 1,000 筆指令上限，請重置示範。')
    const next = clone(state)
    let entityType: string, entityId: string, entityVersion: number, action: string
    let reason: string | undefined
    let fields: string[]
    if (ciId) {
      const patch = body as z.infer<typeof patchCiSchema>
      if (patch.expectedVersion !== ci!.version) fail(409, 'VERSION_CONFLICT', '資源版本已變更，請重新讀取後再確認。')
      if (patch.visibilityProjectIds) {
        for (const id of patch.visibilityProjectIds) {
          if (!state.entities.projects.some((project) => project.id === id && project.orgId === policy.user!.orgId)) fail(422, 'VALIDATION_ERROR', '可見專案不存在。')
          if (!policy.hasProject(id, undefined, 'ops')) forbidden()
        }
        for (const placement of state.entities.placements.filter((entry) => entry.ciId === ciId)) {
          const app = state.entities.applications.find((entry) => entry.id === placement.applicationId)!
          if (!patch.visibilityProjectIds.includes(app.projectId)) fail(409, 'INVALID_STATE', '不能移除既有 placement 所屬專案的可見性。')
        }
      }
      if (patch.ownerTeamId) {
        if (!state.entities.teams.some((team) => team.id === patch.ownerTeamId && team.orgId === policy.user!.orgId)) fail(422, 'VALIDATION_ERROR', '責任團隊不存在。')
        if (!ci!.visibilityProjectIds.every((id) => policy.hasProject(id, undefined, 'ops'))) forbidden()
      }
      if (patch.customFields) validateCustomFields(state, ci!, patch.customFields)
      const updated = next.entities.cis.find((entry) => entry.id === ciId)!
      const { expectedVersion: _expectedVersion, ...metadata } = patch
      void _expectedVersion
      Object.assign(updated, metadata, { version: updated.version + 1, updatedAt: clockIso(next.logicalClock) })
      entityType = 'ci'; entityId = ciId; entityVersion = updated.version; action = 'ci.update'; fields = Object.keys(metadata)
    } else if (assignmentId) {
      const patch = body as z.infer<typeof revokeAssignmentSchema>
      const assignment = state.entities.assignments.find((entry) => entry.id === assignmentId)
      if (!assignment) return notFound()
      if (assignment.userId === input.actorId) fail(403, 'SELF_MODIFICATION_DENIED', '不能修改自己的角色授權。')
      if (assignment.role === 'admin' && !state.entities.assignments.some((entry) => entry.id !== assignment.id && entry.role === 'admin' && entry.orgId === assignment.orgId && state.entities.users.some((user) => user.id === entry.userId && user.enabled))) fail(409, 'LAST_ADMIN_REQUIRED', '必須保留一位啟用中的平台管理者。')
      if (patch.expectedVersion !== assignment.version) fail(409, 'VERSION_CONFLICT', '授權版本已變更。')
      next.entities.assignments = next.entities.assignments.filter((entry) => entry.id !== assignmentId)
      next.policyVersion += 1
      entityType = 'roleAssignment'; entityId = assignmentId; entityVersion = assignment.version + 1; action = 'access.write'; fields = ['assignment revoked']; reason = patch.reason
    } else {
      next.logicalClock += (body as z.infer<typeof advanceClockSchema>).ticks
      entityType = 'demoSession'; entityId = next.sessionId; entityVersion = next.storeRevision + 1; action = 'demo.clock.advance'; fields = ['logicalClock']
    }
    next.sequence += 1
    next.storeRevision += 1
    next.commandCount += 1
    const serial = String(next.sequence).padStart(4, '0')
    const correlationId = `corr-command-${serial}`
    const changed = [{ entityType, entityId }]
    const receipt: CommandReceipt = { entityType, entityId, entityVersion, correlationId, changed }
    next.events.push({ eventId: `event-${serial}`, entities: changed, type: action, occurredAt: clockIso(next.logicalClock), correlationId })
    next.audit.push({ id: `audit-${serial}`, orgId: policy.user!.orgId, actorId: input.actorId, action, entityType, entityId,
      scopeSnapshot: { projectIds: policy.projectIds, poolIds: policy.poolIds, stages: [...new Set(policy.assignments.filter((assignment) => assignment.scopeType === 'project').flatMap((assignment) => assignment.stages ?? ['dev', 'staging', 'prod'] as const))] },
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

function validateCustomFields(snapshot: Snapshot, ci: CI, values: CI['customFields']): void {
  for (const [key, value] of Object.entries(values)) {
    const field = snapshot.entities.modelFields.find((entry) => entry.orgId === ci.orgId && entry.kind === ci.kind && entry.key === key)
    if (!field || typeof value !== field.valueType) throw new DomainError(422, 'VALIDATION_ERROR', '自訂欄位不存在或型別不符。', { [`customFields.${key}`]: ['Unknown field or invalid type'] })
    const constraints = field.constraints
    if (typeof value === 'string' && ((constraints.maxLength !== undefined && value.length > constraints.maxLength) || (constraints.enum && !constraints.enum.includes(value)))) fail(422, 'VALIDATION_ERROR', '自訂欄位不符合字串限制。')
    if (typeof value === 'number' && ((constraints.min !== undefined && value < constraints.min) || (constraints.max !== undefined && value > constraints.max))) fail(422, 'VALIDATION_ERROR', '自訂欄位不符合數值限制。')
  }
}

import type { CommandInput } from './command-input-schemas'
import { advanceClockSchema, commandInputSchema, createAssignmentInputSchema, createCatalogRevisionInputSchema, createCiInputSchema, createModelFieldInputSchema, createRelationInputSchema, createRequestInputSchema, createTeamInputSchema, createUserInputSchema, deleteRelationInputSchema, patchCatalogInputSchema, patchCiSchema, patchModelFieldInputSchema, patchNavigationInputSchema, patchRequestInputSchema, patchTeamInputSchema, patchUserInputSchema, publishCatalogInputSchema, reasonCommandSchema, revokeAssignmentSchema, versionCommandSchema } from './command-input-schemas'
import { prepareServiceDelivery, advanceServiceDelivery } from './service-delivery-commands'
import type { z } from 'zod'
import { scenarioInputSchema, roleAssignmentSchema, snapshotSchema, teamSchema, userSchema, type CI, type CommandReceipt, type ComputeCatalogItem, type ProvisionJob, type Relation, type Request as DomainRequest, type Snapshot } from './schema-models'
import { clockIso, clone, fail, notFound, forbidden, parse, assertIntegrity, requestableCatalog, requestPoolUsage } from './engine-shared'
import { policyFor, type Policy } from './policy'
import { DomainError } from './errors'
import { advanceResources, prepareResource } from './resources'
import { advanceObservation, prepareObservation } from './observation-commands'
import { advanceDelivery, prepareDelivery } from './delivery-commands'
import { prepareMonitoring } from './monitoring-commands'
import { advanceMonitoring } from './monitoring-evaluation'
import { prepareFeature } from './feature-commands'

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

function canonicalCiKey(snapshot: Snapshot, ci: Pick<CI, 'orgId' | 'provider' | 'accountId' | 'locationId' | 'kind' | 'externalId'>): string {
  const location = snapshot.entities.locations.find((entry) => entry.id === ci.locationId && entry.orgId === ci.orgId)
  const locationKey = location && ('region' in location ? location.region : location.site)
  return canonical([ci.orgId, ci.provider, ci.accountId ?? null, locationKey, ci.kind, ci.externalId])
}

function validateRequestShape(snapshot: Snapshot, input: {
  applicationId: string; stage: DomainRequest['stage']; catalogItemId: string; catalogRevision: number;
  provider: DomainRequest['provider']; poolId: string; cpu: number; memoryMiB: number;
}, policy: Policy) {
  const application = snapshot.entities.applications.find((entry) => entry.id === input.applicationId && entry.orgId === policy.user!.orgId)
  if (!application) return notFound()
  if (!policy.hasProject(application.projectId, input.stage, 'rd')) return notFound()
  const catalog = requestableCatalog(snapshot, input.catalogItemId)
  if (!catalog || catalog.template.resourceKind !== 'compute' || catalog.revision !== input.catalogRevision || !catalog.allowedProjectIds.includes(application.projectId)) return notFound()
  const pool = snapshot.entities.pools.find((entry) => entry.id === input.poolId && entry.orgId === policy.user!.orgId)
  if (!pool || pool.provider !== input.provider || !pool.scopeProjectIds.includes(application.projectId)
    || !catalog.template.allowedProviders.includes(input.provider)
    || !catalog.template.allowedStages.includes(input.stage)
    || !catalog.template.allowedPoolIds.includes(input.poolId)) {
    throw new DomainError(422, 'VALIDATION_ERROR', '服務目錄、provider、stage 與資源池不相容。')
  }
  if (input.cpu > catalog.template.limits.maxCpu || input.memoryMiB > catalog.template.limits.maxMemoryMiB) {
    throw new DomainError(422, 'VALIDATION_ERROR', '申請規格超過服務目錄限制。', {
      cpu: ['Exceeds catalog limit'], memoryMiB: ['Exceeds catalog limit'],
    })
  }
  return { application, catalog: catalog as ComputeCatalogItem, pool }
}

function provisionedCi(snapshot: Snapshot, request: DomainRequest, job: ProvisionJob): CI {
  const pool = snapshot.entities.pools.find((entry) => entry.id === request.poolId)!
  const id = job.plannedCiIds[0]
  const attributes = pool.provider === 'aws'
    ? { ...pool.provisionDefaults, cpu: request.cpu, memoryMiB: request.memoryMiB }
    : pool.provider === 'aliyun'
      ? { ...pool.provisionDefaults, cpu: request.cpu, memoryMiB: request.memoryMiB }
      : { ...pool.provisionDefaults, assetTag: id, serialRef: `serial-${id}`, cpu: request.cpu, memoryMiB: request.memoryMiB }
  const application = snapshot.entities.applications.find((entry) => entry.id === request.applicationId)!
  return {
    id, orgId: request.orgId, version: 1, createdAt: clockIso(snapshot.logicalClock), updatedAt: clockIso(snapshot.logicalClock),
    name: `${application.slug}-${request.environmentName}`, kind: 'compute', provider: request.provider,
    externalId: id, ...(pool.accountId ? { accountId: pool.accountId } : {}),
    locationId: pool.locationId, poolId: pool.id, ownerTeamId: application.ownerTeamId,
    visibilityProjectIds: [application.projectId], lifecycle: 'active', health: 'unknown',
    tags: { mode: 'demo', requestId: request.id }, attributes, customFields: {},
    source: 'provisioned', observedAt: null,
  }
}

function advanceProvisioning(snapshot: Snapshot, ticks: number): CommandReceipt['changed'] {
  const changed = new Map<string, CommandReceipt['changed'][number]>()
  const mark = (entityType: string, entityId: string) => changed.set(`${entityType}:${entityId}`, { entityType, entityId })
  for (let tick = 0; tick < ticks; tick += 1) {
    snapshot.logicalClock += 1
    for (const item of advanceMonitoring(snapshot)) mark(item.entityType, item.entityId)
    for (const item of advanceServiceDelivery(snapshot)) mark(item.entityType, item.entityId)
    for (const item of advanceDelivery(snapshot)) mark(item.entityType, item.entityId)
    for (const item of advanceObservation(snapshot)) mark(item.entityType, item.entityId)
    for (const item of advanceResources(snapshot)) mark(item.entityType, item.entityId)
    const due = snapshot.scheduler.tasks.filter((task) => task.dueTick <= snapshot.logicalClock && snapshot.jobs.some(job => job.id === task.operationId))
      .toSorted((left, right) => left.id.localeCompare(right.id))
    for (const task of due) {
      const job = snapshot.jobs.find((entry) => entry.id === task.operationId && entry.state === 'running')
      const request = job && snapshot.entities.requests.find((entry) => entry.id === job.requestId)
      if (!job || !request) {
        snapshot.scheduler.tasks = snapshot.scheduler.tasks.filter((entry) => entry.id !== task.id)
        continue
      }
      const environment = snapshot.entities.environments.find((entry) => entry.id === request.environmentId)!
      const failThisJob = task.stepIndex === 2 && snapshot.scenarioFlags.provisionFailureJobId === job.id
      if (failThisJob) {
        Object.assign(job, { state: 'failed', failureCode: 'SIMULATED_CONFIGURE_FAILURE',
          completedAt: clockIso(snapshot.logicalClock), updatedAt: clockIso(snapshot.logicalClock), version: job.version + 1 })
        Object.assign(request, { state: 'failed', updatedAt: clockIso(snapshot.logicalClock), version: request.version + 1 })
        Object.assign(environment, { status: 'failed', updatedAt: clockIso(snapshot.logicalClock), version: environment.version + 1 })
        delete snapshot.scenarioFlags.provisionFailureJobId
        snapshot.scheduler.tasks = snapshot.scheduler.tasks.filter((entry) => entry.id !== task.id)
        mark('job', job.id); mark('request', request.id); mark('environment', environment.id)
        continue
      }
      task.stepIndex += 1
      task.dueTick = snapshot.logicalClock + 1
      job.version += 1
      job.updatedAt = clockIso(snapshot.logicalClock)
      mark('job', job.id)
      if (task.stepIndex < 5) continue
      if (!snapshot.entities.cis.some((entry) => entry.id === job.plannedCiIds[0])) {
        const ci = provisionedCi(snapshot, request, job)
        snapshot.entities.cis.push(ci)
        snapshot.entities.placements.push({
          id: `placement-${ci.id}`, orgId: request.orgId, version: 1,
          createdAt: clockIso(snapshot.logicalClock), updatedAt: clockIso(snapshot.logicalClock),
          applicationId: request.applicationId, environmentId: environment.id, ciId: ci.id, role: 'workload',
        })
        mark('ci', ci.id); mark('placement', `placement-${ci.id}`)
      }
      Object.assign(job, { state: 'succeeded', completedAt: clockIso(snapshot.logicalClock),
        updatedAt: clockIso(snapshot.logicalClock) })
      Object.assign(request, { state: 'fulfilled', updatedAt: clockIso(snapshot.logicalClock), version: request.version + 1 })
      Object.assign(environment, { status: 'ready', updatedAt: clockIso(snapshot.logicalClock), version: environment.version + 1 })
      snapshot.scheduler.tasks = snapshot.scheduler.tasks.filter((entry) => entry.id !== task.id)
      mark('request', request.id); mark('environment', environment.id)
    }
  }
  return [...changed.values()]
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

export function executeCommand(state: Snapshot, raw: CommandInput, persist: (next: Snapshot) => void): { state: Snapshot; receipt: CommandReceipt } {
  const input = parse(commandInputSchema, raw)
  if (input.sessionId !== state.sessionId) fail(401, 'UNAUTHENTICATED', '示範 session 已變更，請重新讀取。')
  const policy = policyFor(state, input.actorId)
  if (!policy.user) fail(401, 'UNAUTHENTICATED', '請選擇有效的示範身分。')
  const method = input.method.toUpperCase()
  const service = prepareServiceDelivery(state, policy, input)
  const resource = prepareResource(state, policy, input)
  const delivery = prepareDelivery(state, policy, input)
  const observation = prepareObservation(state, policy, input, advanceProvisioning)
  const monitoring = prepareMonitoring(state, policy, input, advanceProvisioning)
  const feature = prepareFeature(state, policy, input)
  const patchCiId = method === 'PATCH' ? /^\/cis\/([^/]+)$/.exec(input.path)?.[1] : undefined
  const createCi = method === 'POST' && input.path === '/cis'
  const createRelation = method === 'POST' && input.path === '/relations'
  const deleteRelationId = method === 'DELETE' ? /^\/relations\/([^/]+)$/.exec(input.path)?.[1] : undefined
  const assignmentId = method === 'DELETE' ? /^\/admin\/assignments\/([^/]+)$/.exec(input.path)?.[1] : undefined
  const createRequest = method === 'POST' && input.path === '/requests'
  const patchRequestId = method === 'PATCH' ? /^\/requests\/([^/]+)$/.exec(input.path)?.[1] : undefined
  const requestActionMatch = method === 'POST' ? /^\/requests\/([^/]+)\/(submit|approve|reject|cancel|provision|retry)$/.exec(input.path) : undefined
  const createAssignment = method === 'POST' && input.path === '/admin/assignments'
  const createUser = method === 'POST' && input.path === '/admin/users'
  const patchUserId = method === 'PATCH' ? /^\/admin\/users\/([^/]+)$/.exec(input.path)?.[1] : undefined
  const createTeam = method === 'POST' && input.path === '/admin/teams'
  const patchTeamId = method === 'PATCH' ? /^\/admin\/teams\/([^/]+)$/.exec(input.path)?.[1] : undefined
  const patchNavigationId = method === 'PATCH' ? /^\/admin\/navigation\/([^/]+)$/.exec(input.path)?.[1] : undefined
  const catalogRevisionId = method === 'POST' ? /^\/admin\/catalog\/([^/]+)\/revisions$/.exec(input.path)?.[1] : undefined
  const patchCatalogId = method === 'PATCH' ? /^\/admin\/catalog\/([^/]+)$/.exec(input.path)?.[1] : undefined
  const catalogActionMatch = method === 'POST' ? /^\/admin\/catalog\/([^/]+)\/(publish|disable)$/.exec(input.path) : undefined
  const createModelField = method === 'POST' && input.path === '/admin/cmdb-fields'
  const patchModelFieldId = method === 'PATCH' ? /^\/admin\/cmdb-fields\/([^/]+)$/.exec(input.path)?.[1] : undefined
  const scenario = method === 'POST' && input.path === '/scenarios'
  const clock = method === 'POST' && input.path === '/clock/advance'
  if (!patchCiId && !createCi && !createRelation && !deleteRelationId && !assignmentId && !createRequest
    && !patchRequestId && !requestActionMatch && !createAssignment && !createUser && !patchUserId && !createTeam && !patchTeamId && !patchNavigationId
    && !catalogRevisionId && !patchCatalogId && !catalogActionMatch && !createModelField && !patchModelFieldId
    && !scenario && !clock && !delivery && !observation && !resource && !service && !monitoring && !feature) fail(501, 'NOT_IMPLEMENTED', '此操作尚未在目前里程碑提供。')

  let body: unknown
  if (delivery || observation || resource || service || monitoring || feature) body = input.body
  else if (patchCiId) body = parse(patchCiSchema, input.body)
  else if (createCi) body = parse(createCiInputSchema, input.body)
  else if (createRelation) body = parse(createRelationInputSchema, input.body)
  else if (deleteRelationId) body = parse(deleteRelationInputSchema, input.body)
  else if (assignmentId) body = parse(revokeAssignmentSchema, input.body)
  else if (createRequest) body = parse(createRequestInputSchema, input.body)
  else if (patchRequestId) body = parse(patchRequestInputSchema, input.body)
  else if (requestActionMatch) body = parse(['submit', 'provision'].includes(requestActionMatch[2]) ? versionCommandSchema : reasonCommandSchema, input.body)
  else if (createAssignment) body = parse(createAssignmentInputSchema, input.body)
  else if (createUser) body = parse(createUserInputSchema, input.body)
  else if (patchUserId) body = parse(patchUserInputSchema, input.body)
  else if (createTeam) body = parse(createTeamInputSchema, input.body)
  else if (patchTeamId) body = parse(patchTeamInputSchema, input.body)
  else if (patchNavigationId) body = parse(patchNavigationInputSchema, input.body)
  else if (catalogRevisionId) body = parse(createCatalogRevisionInputSchema, input.body)
  else if (patchCatalogId) body = parse(patchCatalogInputSchema, input.body)
  else if (catalogActionMatch) body = parse(catalogActionMatch[2] === 'publish' ? publishCatalogInputSchema : reasonCommandSchema, input.body)
  else if (createModelField) body = parse(createModelFieldInputSchema, input.body)
  else if (patchModelFieldId) body = parse(patchModelFieldInputSchema, input.body)
  else if (scenario) body = parse(scenarioInputSchema, input.body)
  else body = parse(advanceClockSchema, input.body)
  const bodyString = canonical(input.body)
  const replay = state.idempotency.find((record) => record.sessionId === input.sessionId && record.actorId === input.actorId && record.method === method && record.path === input.path && record.key === input.key)

  let ci: CI | undefined
  let relation: Relation | undefined
  let environmentRequest: DomainRequest | undefined
  if (delivery || observation || resource || service || monitoring || feature) {
    // prepareDelivery / prepareObservation already checked the current role, resource and stage before replay.
  } else if (patchCiId) {
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
  } else if (createRequest) {
    const create = body as z.infer<typeof createRequestInputSchema>
    const application = state.entities.applications.find((entry) => entry.id === create.applicationId && entry.orgId === policy.user!.orgId)
    if (!application || !policy.hasProject(application.projectId, create.stage, 'rd')) notFound()
  } else if (patchRequestId || requestActionMatch) {
    const id = patchRequestId ?? requestActionMatch![1]
    environmentRequest = state.entities.requests.find((entry) => entry.id === id && policy.canReadRequest(entry))
    if (!environmentRequest) notFound()
    const action = requestActionMatch?.[2]
    const requesterAction = !action || ['submit', 'cancel', 'retry'].includes(action)
    if (requesterAction && !policy.canEditRequest(environmentRequest!)) forbidden()
    if (!requesterAction && !policy.canOperateRequest(environmentRequest!)) forbidden()
  } else if (createAssignment || createUser || patchUserId || createTeam || patchTeamId || patchNavigationId || catalogRevisionId || patchCatalogId
    || catalogActionMatch || createModelField || patchModelFieldId) {
    if (!policy.admin) forbidden()
  } else if (scenario) {
    const scenarioBody = body as z.infer<typeof scenarioInputSchema>
    if (scenarioBody.environmentId || scenarioBody.runId || scenarioBody.releaseId || scenarioBody.scenarioKey === 'provision-failure' && (!scenarioBody.jobId || scenarioBody.poolId)
      || scenarioBody.scenarioKey !== 'provision-failure' && (!scenarioBody.poolId || scenarioBody.jobId)) fail(422, 'VALIDATION_ERROR', '故障目標與情境不相容。')
    if (scenarioBody.jobId) {
      const job = state.jobs.find((entry) => entry.id === scenarioBody.jobId)
      const request = job && state.entities.requests.find((entry) => entry.id === job.requestId)
      if (!job || !request || !policy.canOperateRequest(request)) notFound()
    } else if (!scenarioBody.poolId || !policy.poolIds.includes(scenarioBody.poolId)) forbidden()
  }
  if (replay) {
    if (replay.canonicalBody !== bodyString) fail(409, 'IDEMPOTENCY_CONFLICT', '同一冪等 key 已用於不同內容。')
    return { state, receipt: clone(replay.receipt) }
  }
  if (state.commandCount >= 1000) fail(429, 'DEMO_COMMAND_LIMIT', '此 session 已達 1,000 筆指令上限，請重置示範。')

  const next = clone(state)
  let entityType: string, entityId: string, entityVersion: number, action: string
  let reason: string | undefined
  let fields: string[]
  let changed: CommandReceipt['changed']
  let operationId: string | undefined
  let correlationOverride: string | undefined
  let auditProjectIdsOverride: string[] | undefined
  let auditPoolIdsOverride: string[] | undefined
  let auditStagesOverride: ('dev' | 'staging' | 'prod')[] | undefined

  if (delivery || observation || resource || service || monitoring || feature) {
    const result = feature ? feature.apply(next) : monitoring ? monitoring.apply(next) : service ? service.apply(next) : resource ? resource.apply(next) : delivery ? { ...delivery.apply(next), poolIds: [] } : observation!.apply(next)
    ;({ entityType, entityId, entityVersion, action, reason, fields, changed, operationId } = result)
    correlationOverride = result.correlationId; auditProjectIdsOverride = result.projectIds; auditPoolIdsOverride = result.poolIds; auditStagesOverride = result.stages
  } else if (patchCiId) {
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
    const candidateIdentity = canonicalCiKey(state, candidate)
    const collidesWithPlannedIdentity = state.jobs.some((job) => {
      if (!['queued', 'running', 'failed'].includes(job.state)) return false
      const request = state.entities.requests.find((entry) => entry.id === job.requestId)
      return !!request && canonicalCiKey(state, provisionedCi(state, request, job)) === candidateIdentity
    })
    if (state.entities.cis.some((entry) => canonicalCiKey(state, entry) === candidateIdentity) || collidesWithPlannedIdentity) {
      fail(409, 'DUPLICATE_RESOURCE', '相同 canonical identity 的 CI 已存在或已由交付作業保留。')
    }
    if (candidate.kind === 'compute') {
      const usage = requestPoolUsage(state, pool.id)
      if (Number(candidate.attributes.cpu) > usage.cpu.available
        || Number(candidate.attributes.memoryMiB) > usage.memoryMiB.available) {
        fail(409, 'CAPACITY_EXCEEDED', '資源池容量不足。')
      }
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
  } else if (createRequest) {
    const create = body as z.infer<typeof createRequestInputSchema>
    const { catalog, application } = validateRequestShape(state, create, policy)
    const serial = String(next.sequence + 1).padStart(4, '0')
    const created: DomainRequest = {
      id: `req-${serial}`, orgId: policy.user!.orgId, version: 1,
      createdAt: clockIso(next.logicalClock), updatedAt: clockIso(next.logicalClock),
      requesterId: input.actorId, ...create, templateSnapshot: clone(catalog.template), state: 'draft',
      correlationId: `corr-request-${serial}`,
    }
    if (!catalog.allowedProjectIds.includes(application.projectId)) notFound()
    next.entities.requests.push(created)
    entityType = 'request'; entityId = created.id; entityVersion = 1; action = 'request.create'
    fields = ['applicationId', 'environmentName', 'stage', 'catalogRevision', 'provider', 'poolId', 'cpu', 'memoryMiB', 'purpose']
    changed = [{ entityType, entityId }]; correlationOverride = created.correlationId
    auditProjectIdsOverride = [application.projectId]; auditPoolIdsOverride = [created.poolId]
  } else if (patchRequestId) {
    const patch = body as z.infer<typeof patchRequestInputSchema>
    if (environmentRequest!.state !== 'draft') fail(409, 'INVALID_STATE', '只有草稿可以修改。')
    if (patch.expectedVersion !== environmentRequest!.version) fail(409, 'VERSION_CONFLICT', '申請版本已變更。')
    const candidate = { ...environmentRequest!, ...patch }
    validateRequestShape(state, candidate, policy)
    const updated = next.entities.requests.find((entry) => entry.id === patchRequestId)!
    const { expectedVersion: _expectedVersion, ...fieldsToUpdate } = patch
    void _expectedVersion
    Object.assign(updated, fieldsToUpdate, { version: updated.version + 1, updatedAt: clockIso(next.logicalClock) })
    entityType = 'request'; entityId = updated.id; entityVersion = updated.version; action = 'request.update'
    fields = Object.keys(fieldsToUpdate); changed = [{ entityType, entityId }]; correlationOverride = updated.correlationId
    const application = state.entities.applications.find((entry) => entry.id === updated.applicationId)!
    auditProjectIdsOverride = [application.projectId]; auditPoolIdsOverride = [updated.poolId]
  } else if (requestActionMatch) {
    const request = next.entities.requests.find((entry) => entry.id === environmentRequest!.id)!
    const actionName = requestActionMatch[2]
    const command = body as z.infer<typeof reasonCommandSchema>
    if (command.expectedVersion !== environmentRequest!.version) fail(409, 'VERSION_CONFLICT', '申請版本已變更。')
    const application = state.entities.applications.find((entry) => entry.id === request.applicationId)!
    auditProjectIdsOverride = [application.projectId]; auditPoolIdsOverride = [request.poolId]
    correlationOverride = request.correlationId
    reason = 'reason' in command ? command.reason : undefined
    changed = [{ entityType: 'request', entityId: request.id }]
    if (actionName === 'submit') {
      if (request.state !== 'draft') fail(409, 'INVALID_STATE', '只有草稿可以提交。')
      if (!requestableCatalog(next, request.catalogItemId)) fail(409, 'INVALID_STATE', '服務目錄項目已停用，請等待重新發布。')
      const normalized = request.environmentName.trim().toLowerCase()
      if (next.entities.environments.some((entry) => entry.applicationId === request.applicationId && entry.name.trim().toLowerCase() === normalized)
        || next.entities.requests.some((entry) => entry.id !== request.id && entry.applicationId === request.applicationId
          && entry.environmentName.trim().toLowerCase() === normalized && !['rejected', 'cancelled'].includes(entry.state))) {
        fail(409, 'DUPLICATE_RESOURCE', '此應用的環境名稱已被使用或保留。')
      }
      Object.assign(request, { state: 'submitted', version: request.version + 1, updatedAt: clockIso(next.logicalClock) })
      entityType = 'request'; entityId = request.id; entityVersion = request.version; action = 'request.submit'; fields = ['state']
    } else if (actionName === 'approve') {
      if (request.state !== 'submitted') fail(409, 'INVALID_STATE', '只有已提交申請可以核准。')
      const usage = requestPoolUsage(next, request.poolId)
      if (request.cpu > usage.cpu.available || request.memoryMiB > usage.memoryMiB.available) {
        fail(409, 'CAPACITY_EXCEEDED', '資源池容量不足，無法核准。')
      }
      const serial = String(next.sequence + 1).padStart(4, '0')
      const environmentId = request.environmentId ?? `env-${request.id.slice(4)}`
      const jobId = `job-${serial}`
      const job: ProvisionJob = {
        id: jobId, orgId: request.orgId, version: 1, createdAt: clockIso(next.logicalClock), updatedAt: clockIso(next.logicalClock),
        requestId: request.id, attempt: 1, state: 'queued', plannedCiIds: [`ci-provisioned-${request.id.slice(4)}`],
        correlationId: request.correlationId,
      }
      next.jobs.push(job)
      Object.assign(request, {
        state: 'approved', environmentId, latestJobId: job.id,
        approval: { actorId: input.actorId, occurredAt: clockIso(next.logicalClock), reason: command.reason },
        version: request.version + 1, updatedAt: clockIso(next.logicalClock),
      })
      operationId = job.id
      changed.push({ entityType: 'job', entityId: job.id })
      entityType = 'request'; entityId = request.id; entityVersion = request.version; action = 'request.approve'; fields = ['state', 'approval', 'environmentId', 'latestJobId']
    } else if (actionName === 'reject') {
      if (request.state !== 'submitted') fail(409, 'INVALID_STATE', '只有已提交申請可以拒絕。')
      Object.assign(request, { state: 'rejected', version: request.version + 1, updatedAt: clockIso(next.logicalClock) })
      entityType = 'request'; entityId = request.id; entityVersion = request.version; action = 'request.reject'; fields = ['state']
    } else if (actionName === 'cancel') {
      if (!['draft', 'submitted', 'approved'].includes(request.state)) fail(409, 'INVALID_STATE', '目前狀態不能撤回。')
      if (request.latestJobId) {
        const job = next.jobs.find((entry) => entry.id === request.latestJobId)
        if (job?.state === 'running') fail(409, 'INVALID_STATE', '進行中的交付不能撤回。')
        if (job?.state === 'queued') {
          Object.assign(job, { state: 'cancelled', version: job.version + 1,
            completedAt: clockIso(next.logicalClock), updatedAt: clockIso(next.logicalClock) })
          changed.push({ entityType: 'job', entityId: job.id })
        }
      }
      Object.assign(request, { state: 'cancelled', version: request.version + 1, updatedAt: clockIso(next.logicalClock) })
      entityType = 'request'; entityId = request.id; entityVersion = request.version; action = 'request.cancel'; fields = ['state']
    } else if (actionName === 'provision') {
      if (request.state !== 'approved' || !request.latestJobId || !request.environmentId) return fail(409, 'INVALID_STATE', '只有已核准且已保留容量的申請可以啟動交付。')
      const jobId = request.latestJobId
      const environmentId = request.environmentId
      const job = next.jobs.find((entry) => entry.id === jobId)
      if (!job || job.state !== 'queued') return fail(409, 'INVALID_STATE', '沒有可啟動的 queued job。')
      let environment = next.entities.environments.find((entry) => entry.id === environmentId)
      if (!environment) {
        environment = {
          id: environmentId, orgId: request.orgId, version: 1,
          createdAt: clockIso(next.logicalClock), updatedAt: clockIso(next.logicalClock),
          applicationId: request.applicationId, name: request.environmentName, stage: request.stage,
          status: 'provisioning', activeReleaseId: null,
        }
        next.entities.environments.push(environment)
      } else {
        Object.assign(environment, { status: 'provisioning', version: environment.version + 1, updatedAt: clockIso(next.logicalClock) })
      }
      const currentEnvironment = environment
      Object.assign(job, { state: 'running', startedAt: clockIso(next.logicalClock), version: job.version + 1, updatedAt: clockIso(next.logicalClock) })
      Object.assign(request, { state: 'provisioning', version: request.version + 1, updatedAt: clockIso(next.logicalClock) })
      next.scheduler.tasks.push({ id: `task-${job.id}`, operationId: job.id, stepIndex: 0, dueTick: next.logicalClock + 1 })
      operationId = job.id
      changed.push({ entityType: 'job', entityId: job.id }, { entityType: 'environment', entityId: currentEnvironment.id })
      entityType = 'request'; entityId = request.id; entityVersion = request.version; action = 'request.provision'; fields = ['state', 'job.state', 'environment.status']
    } else {
      if (request.state !== 'failed' || !request.latestJobId || !request.environmentId) fail(409, 'INVALID_STATE', '只有失敗的申請可以重試。')
      const usage = requestPoolUsage(next, request.poolId)
      if (request.cpu > usage.cpu.available || request.memoryMiB > usage.memoryMiB.available) fail(409, 'CAPACITY_EXCEEDED', '容量不足，無法建立重試。')
      const previous = next.jobs.find((entry) => entry.id === request.latestJobId)!
      const serial = String(next.sequence + 1).padStart(4, '0')
      const job: ProvisionJob = {
        id: `job-${serial}`, orgId: request.orgId, version: 1, createdAt: clockIso(next.logicalClock), updatedAt: clockIso(next.logicalClock),
        requestId: request.id, attempt: previous.attempt + 1, state: 'queued',
        plannedCiIds: [...previous.plannedCiIds], correlationId: request.correlationId,
      }
      next.jobs.push(job)
      Object.assign(request, { state: 'approved', latestJobId: job.id, version: request.version + 1, updatedAt: clockIso(next.logicalClock) })
      operationId = job.id
      changed.push({ entityType: 'job', entityId: job.id })
      entityType = 'request'; entityId = request.id; entityVersion = request.version; action = 'request.retry'; fields = ['state', 'latestJobId', 'attempt']
    }
  } else if (createUser) {
    const create = body as z.infer<typeof createUserInputSchema>
    if (!create.teamIds.every(id => next.entities.teams.some(team => team.id === id && team.orgId === policy.user!.orgId))) fail(422, 'VALIDATION_ERROR', '團隊不存在。')
    const serial = String(next.sequence + 1).padStart(4, '0')
    const candidate = parse(userSchema, { id: `user-demo-${serial}`, orgId: policy.user!.orgId,
      version: 1, createdAt: clockIso(next.logicalClock), updatedAt: clockIso(next.logicalClock),
      displayName: create.displayName, teamIds: create.teamIds, enabled: create.enabled, source: 'demo' })
    if (next.entities.users.some(user => user.id === candidate.id)) fail(409, 'DUPLICATE_RESOURCE', '使用者 ID 已存在。')
    next.entities.users.push(candidate)
    next.policyVersion += 1
    entityType = 'user'; entityId = candidate.id; entityVersion = 1; action = 'access.write'
    fields = ['user created', 'no role grant or Demo persona']; reason = create.reason; changed = [{ entityType, entityId }]
  } else if (createTeam) {
    const create = body as z.infer<typeof createTeamInputSchema>
    if (!next.entities.businessUnits.some(unit => unit.id === create.businessUnitId && unit.orgId === policy.user!.orgId)) fail(422, 'VALIDATION_ERROR', '業務單位不存在。')
    const serial = String(next.sequence + 1).padStart(4, '0')
    const candidate = parse(teamSchema, { id: `team-demo-${serial}`, orgId: policy.user!.orgId,
      version: 1, createdAt: clockIso(next.logicalClock), updatedAt: clockIso(next.logicalClock),
      businessUnitId: create.businessUnitId, name: create.name, source: 'demo' })
    if (next.entities.teams.some(team => team.id === candidate.id)) fail(409, 'DUPLICATE_RESOURCE', '團隊 ID 已存在。')
    next.entities.teams.push(candidate)
    next.policyVersion += 1
    entityType = 'team'; entityId = candidate.id; entityVersion = 1; action = 'access.write'
    fields = ['team created']; reason = create.reason; changed = [{ entityType, entityId }]
  } else if (patchTeamId) {
    const patch = body as z.infer<typeof patchTeamInputSchema>
    const team = next.entities.teams.find(entry => entry.id === patchTeamId && entry.orgId === policy.user!.orgId)
    if (!team) notFound()
    if (team!.version !== patch.expectedVersion) fail(409, 'VERSION_CONFLICT', '團隊版本已變更。')
    Object.assign(team!, { name: patch.name, version: team!.version + 1, updatedAt: clockIso(next.logicalClock) })
    next.policyVersion += 1
    entityType = 'team'; entityId = team!.id; entityVersion = team!.version; action = 'access.write'
    fields = ['name']; reason = patch.reason; changed = [{ entityType, entityId }]
  } else if (createAssignment) {
    const create = body as z.infer<typeof createAssignmentInputSchema>
    if (create.userId === input.actorId) fail(403, 'SELF_MODIFICATION_DENIED', '不能修改自己的角色授權。')
    if (next.entities.assignments.some((entry) => entry.userId === create.userId && entry.role === create.role
      && entry.scopeType === create.scopeType && entry.scopeId === create.scopeId
      && JSON.stringify(entry.stages ?? []) === JSON.stringify(create.stages ?? []))) fail(409, 'DUPLICATE_RESOURCE', '相同角色授權已存在。')
    if (!next.entities.users.some((entry) => entry.id === create.userId && entry.orgId === policy.user!.orgId)) notFound()
    const serial = String(next.sequence + 1).padStart(4, '0')
    const candidate = parse(roleAssignmentSchema, {
      id: `grant-${serial}`, orgId: policy.user!.orgId, version: 1,
      createdAt: clockIso(next.logicalClock), updatedAt: clockIso(next.logicalClock),
      userId: create.userId, role: create.role, scopeType: create.scopeType, scopeId: create.scopeId,
      ...(create.stages ? { stages: create.stages } : {}),
    })
    next.entities.assignments.push(candidate)
    next.policyVersion += 1
    entityType = 'roleAssignment'; entityId = candidate.id; entityVersion = 1; action = 'access.write'
    fields = ['assignment created']; reason = create.reason; changed = [{ entityType, entityId }]
  } else if (patchUserId) {
    const patch = body as z.infer<typeof patchUserInputSchema>
    const user = next.entities.users.find((entry) => entry.id === patchUserId && entry.orgId === policy.user!.orgId)
    if (!user) notFound()
    if (user!.id === input.actorId && patch.enabled === false) fail(403, 'SELF_MODIFICATION_DENIED', '不能停用自己的帳號。')
    if (patch.expectedVersion !== user!.version) fail(409, 'VERSION_CONFLICT', '使用者版本已變更。')
    if (patch.teamIds && !patch.teamIds.every(id => next.entities.teams.some(team => team.id === id && team.orgId === user!.orgId))) fail(422, 'VALIDATION_ERROR', '團隊不存在。')
    if (patch.enabled === false) {
      const isAdmin = next.entities.assignments.some((entry) => entry.userId === user!.id && entry.role === 'admin')
      const anotherAdmin = next.entities.users.some((entry) => entry.id !== user!.id && entry.enabled
        && next.entities.assignments.some((assignment) => assignment.userId === entry.id && assignment.role === 'admin'))
      if (isAdmin && !anotherAdmin) fail(409, 'LAST_ADMIN_REQUIRED', '必須保留一位啟用中的平台管理者。')
    }
    const { expectedVersion: _expectedVersion, reason: _reason, ...updates } = patch
    void _expectedVersion; void _reason
    Object.assign(user!, updates, { version: user!.version + 1, updatedAt: clockIso(next.logicalClock) })
    next.policyVersion += 1
    entityType = 'user'; entityId = user!.id; entityVersion = user!.version; action = 'access.write'
    fields = Object.keys(updates); reason = patch.reason; changed = [{ entityType, entityId }]
  } else if (patchNavigationId) {
    const patch = body as z.infer<typeof patchNavigationInputSchema>
    const item = next.entities.navigation.find((entry) => entry.id === patchNavigationId && entry.orgId === policy.user!.orgId)
    if (!item) notFound()
    if (patch.expectedVersion !== item!.version) fail(409, 'VERSION_CONFLICT', '導航版本已變更。')
    if (patch.enabled === false && ['admin.access', 'admin.navigation', 'guide'].includes(item!.routeKey)) {
      fail(422, 'VALIDATION_ERROR', '必要的管理或 recovery 導航不可停用。')
    }
    const { expectedVersion: _expectedVersion, ...navigation } = patch
    void _expectedVersion
    Object.assign(item!, navigation, { version: item!.version + 1, updatedAt: clockIso(next.logicalClock) })
    entityType = 'navigationItem'; entityId = item!.id; entityVersion = item!.version; action = 'navigation.write'
    fields = Object.keys(navigation); changed = [{ entityType, entityId }]
  } else if (catalogRevisionId) {
    const create = body as z.infer<typeof createCatalogRevisionInputSchema>
    const catalog = next.entities.catalogs.find((entry) => entry.id === catalogRevisionId && entry.orgId === policy.user!.orgId)
    if (!catalog) notFound()
    if (catalog!.status === 'draft') fail(409, 'INVALID_STATE', '已有尚未發布的草稿 revision。')
    if (create.expectedVersion !== catalog!.version || create.baseRevision !== catalog!.revision) fail(409, 'VERSION_CONFLICT', '服務目錄 revision 已變更。')
    next.entities.catalogHistory.push(clone(catalog!))
    const { expectedVersion: _expectedVersion, baseRevision: _baseRevision, reason: catalogReason, ...revision } = create
    void _expectedVersion; void _baseRevision
    Object.assign(catalog!, revision, { revision: catalog!.revision + 1, status: 'draft',
      version: catalog!.version + 1, updatedAt: clockIso(next.logicalClock) })
    entityType = 'catalogItem'; entityId = catalog!.id; entityVersion = catalog!.version; action = 'catalog.write'
    fields = ['revision', 'status', 'template', 'allowedProjectIds']; reason = catalogReason; changed = [{ entityType, entityId }]
  } else if (patchCatalogId) {
    const patch = body as z.infer<typeof patchCatalogInputSchema>
    const catalog = next.entities.catalogs.find((entry) => entry.id === patchCatalogId && entry.orgId === policy.user!.orgId)
    if (!catalog) notFound()
    if (catalog!.status !== 'draft') fail(409, 'INVALID_STATE', '只有 draft revision 可以修改。')
    if (patch.expectedVersion !== catalog!.version || patch.revision !== catalog!.revision) fail(409, 'VERSION_CONFLICT', '服務目錄 revision 已變更。')
    const { expectedVersion: _expectedVersion, revision: _revision, ...catalogPatch } = patch
    void _expectedVersion; void _revision
    Object.assign(catalog!, catalogPatch, { version: catalog!.version + 1, updatedAt: clockIso(next.logicalClock) })
    entityType = 'catalogItem'; entityId = catalog!.id; entityVersion = catalog!.version; action = 'catalog.write'
    fields = Object.keys(catalogPatch); changed = [{ entityType, entityId }]
  } else if (catalogActionMatch) {
    const command = body as z.infer<typeof reasonCommandSchema>
    const catalog = next.entities.catalogs.find((entry) => entry.id === catalogActionMatch[1] && entry.orgId === policy.user!.orgId)
    if (!catalog) notFound()
    if (command.expectedVersion !== catalog!.version) fail(409, 'VERSION_CONFLICT', '服務目錄版本已變更。')
    if (catalogActionMatch[2] === 'publish') {
      const publish = body as z.infer<typeof publishCatalogInputSchema>
      if (catalog!.status !== 'draft' || publish.revision !== catalog!.revision) fail(409, 'INVALID_STATE', '只有目前 draft revision 可以發布。')
      catalog!.status = 'published'
    } else {
      if (catalog!.status !== 'published') fail(409, 'INVALID_STATE', '只有已發布目錄可以停用。')
      catalog!.status = 'disabled'
    }
    catalog!.version += 1; catalog!.updatedAt = clockIso(next.logicalClock)
    entityType = 'catalogItem'; entityId = catalog!.id; entityVersion = catalog!.version
    action = catalogActionMatch[2] === 'publish' ? 'catalog.publish' : 'catalog.disable'
    fields = ['status']; reason = command.reason; changed = [{ entityType, entityId }]
  } else if (createModelField) {
    const create = body as z.infer<typeof createModelFieldInputSchema>
    const reserved = new Set(['id', 'orgId', 'version', 'createdAt', 'updatedAt', 'name', 'kind', 'provider', 'externalId', 'accountId', 'locationId', 'poolId', 'ownerTeamId', 'visibilityProjectIds', 'lifecycle', 'health', 'tags', 'attributes', 'customFields', 'source', 'observedAt'])
    if (reserved.has(create.key)) fail(422, 'VALIDATION_ERROR', '自訂欄位不可覆蓋核心身分欄位。')
    if (next.entities.modelFields.some((entry) => entry.kind === create.kind && entry.key === create.key)) fail(409, 'DUPLICATE_RESOURCE', '相同 kind/key 的自訂欄位已存在。')
    if (create.valueType === 'string' && (create.constraints.min !== undefined || create.constraints.max !== undefined)
      || create.valueType === 'number' && (create.constraints.maxLength !== undefined || create.constraints.enum !== undefined)
      || create.valueType === 'boolean' && Object.keys(create.constraints).length > 0) fail(422, 'VALIDATION_ERROR', 'constraints 與欄位型別不相容。')
    const serial = String(next.sequence + 1).padStart(4, '0')
    const field = { ...create, id: `field-${serial}`, orgId: policy.user!.orgId, version: 1,
      createdAt: clockIso(next.logicalClock), updatedAt: clockIso(next.logicalClock), required: false as const, hidden: false }
    next.entities.modelFields.push(field)
    entityType = 'modelField'; entityId = field.id; entityVersion = 1; action = 'model.write'
    fields = ['kind', 'key', 'label', 'valueType', 'constraints']; changed = [{ entityType, entityId }]
  } else if (patchModelFieldId) {
    const patch = body as z.infer<typeof patchModelFieldInputSchema>
    const field = next.entities.modelFields.find((entry) => entry.id === patchModelFieldId && entry.orgId === policy.user!.orgId)
    if (!field) notFound()
    if (patch.expectedVersion !== field!.version) fail(409, 'VERSION_CONFLICT', '欄位版本已變更。')
    const { expectedVersion: _expectedVersion, ...metadata } = patch
    void _expectedVersion
    Object.assign(field!, metadata, { version: field!.version + 1, updatedAt: clockIso(next.logicalClock) })
    entityType = 'modelField'; entityId = field!.id; entityVersion = field!.version; action = 'model.write'
    fields = Object.keys(metadata); changed = [{ entityType, entityId }]
  } else if (scenario) {
    const scenarioBody = body as z.infer<typeof scenarioInputSchema>
    if (scenarioBody.scenarioKey === 'provision-failure') {
      const job = next.jobs.find((entry) => entry.id === scenarioBody.jobId && ['queued', 'running'].includes(entry.state))
      if (!job) fail(422, 'VALIDATION_ERROR', '請指定 queued 或 running job。')
      next.scenarioFlags.provisionFailureJobId = job!.id
      entityId = job!.id
    } else {
      const poolId = scenarioBody.poolId!
      if (!next.entities.pools.some((entry) => entry.id === poolId)) notFound()
      if (scenarioBody.scenarioKey === 'capacity-exhausted') {
        const usage = requestPoolUsage(next, poolId)
        next.scenarioFlags[`capacity:${poolId}`] = { cpu: usage.cpu.available, memoryMiB: usage.memoryMiB.available }
      } else delete next.scenarioFlags[`capacity:${poolId}`]
      entityId = poolId
    }
    entityType = 'demoScenario'; entityVersion = next.storeRevision + 1; action = `demo.scenario.${scenarioBody.scenarioKey}`
    fields = ['scenarioFlags']; changed = [{ entityType, entityId }]
  } else {
    const progressed = advanceProvisioning(next, (body as z.infer<typeof advanceClockSchema>).ticks)
    const progressedRequests = progressed.filter((entry) => entry.entityType === 'request')
      .map((entry) => next.entities.requests.find((request) => request.id === entry.entityId))
      .filter((entry): entry is DomainRequest => Boolean(entry))
    if (progressedRequests.length) {
      auditProjectIdsOverride = [...new Set(progressedRequests.map((request) =>
        next.entities.applications.find((application) => application.id === request.applicationId)!.projectId))]
      auditPoolIdsOverride = [...new Set(progressedRequests.map((request) => request.poolId))]
    }
    entityType = 'demoSession'; entityId = next.sessionId; entityVersion = next.storeRevision + 1
    action = progressed.length ? 'provision.scheduler.advance' : 'demo.clock.advance'; fields = ['logicalClock']
    // The demo clock advances the whole session, including hidden operations.
    // Its public receipt/replay and summary event must not enumerate those IDs.
    // Store-revision subscribers refetch scoped queries; operation audits remain separate.
    changed = [{ entityType, entityId }]
  }

  next.sequence += 1
  next.storeRevision += 1
  next.commandCount += 1
  const serial = String(next.sequence).padStart(4, '0')
  const correlationId = correlationOverride ?? `corr-command-${serial}`
  const receipt: CommandReceipt = { entityType, entityId, entityVersion, correlationId, changed, ...(operationId ? { operationId } : {}) }
  next.events.push({ eventId: `event-${serial}`, entities: changed, type: action, occurredAt: clockIso(next.logicalClock), correlationId })
  const changedCis = changed.filter((entry) => entry.entityType === 'ci')
    .map((entry) => state.entities.cis.find((ci) => ci.id === entry.entityId) ?? next.entities.cis.find((ci) => ci.id === entry.entityId))
    .filter((entry): entry is CI => Boolean(entry))
  const auditProjectIds = auditProjectIdsOverride ?? (changedCis.length ? [...new Set(changedCis.flatMap((entry) => entry.visibilityProjectIds))] : policy.projectIds)
  const auditPoolIds = auditPoolIdsOverride ?? (changedCis.length ? [...new Set(changedCis.map((entry) => entry.poolId))] : policy.poolIds)
  const relationEndpointCiIds = entityType === 'relation' && changedCis.length === 2
    ? [changedCis[0].id, changedCis[1].id] as [string, string] : undefined
  next.audit.push({ id: `audit-${serial}`, orgId: policy.user!.orgId, actorId: input.actorId, action, entityType, entityId,
    scopeSnapshot: { projectIds: auditProjectIds, poolIds: auditPoolIds, stages: auditStagesOverride ?? [...new Set(policy.assignments.filter((assignment) => assignment.scopeType === 'project').flatMap((assignment) => assignment.stages ?? ['dev', 'staging', 'prod'] as const))],
      ...(relationEndpointCiIds ? { relationEndpointCiIds } : {}) },
    outcome: 'succeeded', diffSummary: fields, ...(reason ? { reason } : {}), requestId: `command-${serial}`, correlationId, occurredAt: clockIso(next.logicalClock) })
  next.idempotency.push({ sessionId: input.sessionId, actorId: input.actorId, method, path: input.path, key: input.key, bodyHash: checksum(bodyString), canonicalBody: bodyString, receipt })
  const validated = parse(snapshotSchema, next)
  assertIntegrity(validated)
  try {
    if (serializedBytes(validated) > 3 * 1024 * 1024) fail(507, 'DEMO_STORAGE_FULL', '示範資料超出 3 MiB 儲存上限；本次未保存。')
    persist(clone(validated))
  } catch (error) {
    if (error instanceof DomainError) throw error
    fail(507, 'DEMO_STORAGE_FULL', '無法保存示範資料；本次變更未提交，可稍後重試。')
  }
  return { state: validated, receipt: clone(receipt) }
}

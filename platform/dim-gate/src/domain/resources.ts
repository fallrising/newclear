import { z } from 'zod'
import { DomainError } from './errors'
import { observationTime } from './observation'
import { resourcePolicy } from './resource-policy'
import { resourceDemand, resourceUsage } from './resource-capacity'
import type { Policy } from './policy'
import {
  createChangeInputSchema, patchChangeInputSchema, reasonCommandSchema, versionCommandSchema, scenarioInputSchema, resourceAccessProfiles,
  type CatalogItem, type ChangeInput, type ChangeRequest, type ChangeExecution, type CommandInput, type CommandReceipt,
  type ResourceObject, type Snapshot,
} from './schemas'
const fail = (status: number, code: string, message: string): never => { throw new DomainError(status, code, message) }
const denied = (): never => fail(403, 'FORBIDDEN', '目前身分沒有此資源變更的授權。')
const conflict = (code = 'VERSION_CONFLICT', message = '資源版本或影響範圍已變更，請建立新的草稿。'): never => fail(409, code, message)
const invalid = () => conflict('INVALID_STATE', '目前狀態不能執行此操作。')
const time = (s: Snapshot) => observationTime(s.logicalClock)
const stamp = (s: Snapshot, orgId: string, id: string) => ({ id, orgId, version: 1, createdAt: time(s), updatedAt: time(s) })
const touch = (s: Snapshot, entity: { version: number; updatedAt: string }) => { entity.version += 1; entity.updatedAt = time(s) }
const ref = (entityType: string, entityId: string) => ({ entityType, entityId })
function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw new DomainError(422, 'VALIDATION_ERROR', '輸入欄位不符合資源變更契約。', { body: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) })
  return result.data
}
export function publishedResourceCatalog(s: Snapshot, id: string): CatalogItem {
  const current = s.entities.catalogs.find(c => c.id === id)
  if (!current) return fail(404, 'NOT_FOUND', '服務目錄不存在或不可使用。')
  if (current.status === 'disabled') return conflict('CATALOG_DISABLED', '服務目錄已停用。')
  if (current.status === 'published') return current
  const previous = s.entities.catalogHistory.find(c => c.id === id && c.revision === current.revision - 1 && c.status === 'published')
  return previous ?? conflict('CATALOG_CHANGED', '沒有可使用的已發布目錄版本。')
}
export function changeTargets(s: Snapshot, input: ChangeInput): ChangeRequest['targetVersions'] {
  const targets: ChangeRequest['targetVersions'] = [{ entityType: 'ci', entityId: input.targetCiId, version: input.targetCiVersion }]
  if ('resourceObjectId' in input && input.resourceObjectId) targets.push({ entityType: 'resourceObject', entityId: input.resourceObjectId, version: input.resourceObjectVersion! })
  const envIds = new Set<string>(input.environmentId ? [input.environmentId] : [])
  if (input.kind === 'resource.resize') for (const binding of s.entities.resourceBindings.filter(b => b.resourceObjectId === input.resourceObjectId && b.state === 'active')) envIds.add(binding.environmentId)
  for (const id of [...envIds].sort()) {
    const env = s.entities.environments.find(e => e.id === id)
    if (env) targets.push({ entityType: 'environment', entityId: id, version: id === input.environmentId ? input.environmentVersion! : env.version })
  }
  return targets
}
function checkTargets(s: Snapshot, change: ChangeRequest) {
  const actual = changeTargets(s, change.specSnapshot ?? change.spec)
  if (JSON.stringify(actual) !== JSON.stringify(change.targetVersions)) conflict()
  for (const target of change.targetVersions) {
    const collection = target.entityType === 'ci' ? s.entities.cis : target.entityType === 'resourceObject' ? s.entities.resourceObjects : s.entities.environments
    if (collection.find(e => e.id === target.entityId)?.version !== target.version) conflict()
  }
}
function validateSpec(s: Snapshot, input: ChangeInput): CatalogItem {
  const catalog = publishedResourceCatalog(s, input.catalogItemId)
  if (catalog.revision !== input.catalogRevision) conflict('CATALOG_CHANGED', '目錄版本已變更；不會自動改寫已提交內容。')
  const ci = s.entities.cis.find(c => c.id === input.targetCiId && c.orgId === catalog.orgId && c.lifecycle === 'active')
  const t = catalog.template
  if (!ci || t.resourceKind === 'compute' || !t.allowedParentCiIds.includes(ci.id) || !t.allowedPoolIds.includes(ci.poolId) || !t.allowedProviders.includes(ci.provider)) return fail(422, 'VALIDATION_ERROR', '目錄與 parent CI、provider、pool 不相容。')
  if (ci.version !== input.targetCiVersion) conflict()
  const env = input.environmentId && s.entities.environments.find(e => e.id === input.environmentId && e.applicationId === input.applicationId && e.orgId === ci.orgId)
  const app = env && s.entities.applications.find(a => a.id === env.applicationId && a.orgId === ci.orgId)
  if (input.environmentId && (!env || !app || env.status !== 'ready' || !catalog.allowedProjectIds.includes(app.projectId) || !t.allowedStages.includes(env.stage)
    || !ci.visibilityProjectIds.includes(app.projectId))) return fail(422, 'VALIDATION_ERROR', '服務、環境階段與目錄範圍不相容。')
  if (input.kind === 'resource.resize') for (const binding of s.entities.resourceBindings.filter(b => b.resourceObjectId === input.resourceObjectId && b.state === 'active')) {
    const consumer = s.entities.environments.find(e => e.id === binding.environmentId)!
    const application = s.entities.applications.find(a => a.id === consumer.applicationId)!
    if (!catalog.allowedProjectIds.includes(application.projectId) || !t.allowedStages.includes(consumer.stage)
      || !ci.visibilityProjectIds.includes(application.projectId)) return fail(422, 'VALIDATION_ERROR', '共享資源的使用環境超出目錄範圍。')
  }
  if (env && env.version !== input.environmentVersion) conflict()
  const object = 'resourceObjectId' in input && input.resourceObjectId ? s.entities.resourceObjects.find(o => o.id === input.resourceObjectId && o.parentCiId === ci.id && o.orgId === ci.orgId && o.lifecycle === 'active') : undefined
  if ('resourceObjectId' in input && input.resourceObjectId && (!object || object.version !== input.resourceObjectVersion)) conflict()
  if (input.kind === 'resource.resize' || input.kind === 'resource.bind' && input.mode === 'create') {
    if (t.resourceKind !== 'redis' || ci.kind !== 'cache' || ci.attributes.engine !== 'redis'
      || input.kind === 'resource.resize' && object?.kind !== 'cache_allocation') return fail(422, 'VALIDATION_ERROR', '此變更僅支援已註冊 Redis allocation。')
    const quota = input.quotaMiB!
    if (quota < t.limits.minQuotaMiB || quota > t.limits.maxQuotaMiB) return fail(422, 'VALIDATION_ERROR', 'quotaMiB 超出目錄限制。')
  } else if (input.kind === 'kafka.topic.create') {
    if (t.resourceKind !== 'kafka' || ci.kind !== 'queue' || ci.attributes.engine !== 'kafka') return fail(422, 'VALIDATION_ERROR', '此 parent 不支援 Kafka topic。')
    if (input.partitions < t.limits.minPartitions || input.partitions > t.limits.maxPartitions || input.retentionHours < t.limits.minRetentionHours || input.retentionHours > t.limits.maxRetentionHours
      || input.throughputKiBPerSecond < t.limits.minThroughputKiBPerSecond || input.throughputKiBPerSecond > t.limits.maxThroughputKiBPerSecond) return fail(422, 'VALIDATION_ERROR', 'Kafka spec 超出目錄限制。')
  } else if (!object || !(t.resourceKind === 'redis' && object.kind === 'cache_allocation' || t.resourceKind === 'kafka' && object.kind === 'kafka_topic')) return fail(422, 'VALIDATION_ERROR', '綁定物件與目錄種類不相容。')
  if (input.kind !== 'resource.resize') {
    const profile = t.accessProfiles.find(p => p.id === input.accessProfileRef)
    const registered = resourceAccessProfiles.find(p => p.id === input.accessProfileRef)
    if (!profile || !registered || registered.resourceKind !== t.resourceKind || !profile.purposes.includes(input.purpose)
      || !(registered.purposes as readonly string[]).includes(input.purpose)) return fail(422, 'VALIDATION_ERROR', '安全存取 profile 與用途不相容。')
  }
  if (!s.entities.resourceQuotas.some(q => q.parentCiId === ci.id)) return fail(422, 'VALIDATION_ERROR', 'parent 尚未設定資源配額。')
  return catalog
}
export function resourceConflictKey(input: ChangeInput) {
  if (input.kind === 'kafka.topic.create') return JSON.stringify([input.targetCiId, 'kafka_topic', input.namespace ?? '', input.topicName.toLowerCase()])
  if (input.kind === 'resource.resize') return `object:${input.resourceObjectId}`
  return input.mode === 'existing' ? JSON.stringify([input.environmentId, input.resourceObjectId, input.purpose]) : undefined
}
function checkDuplicates(s: Snapshot, change: ChangeRequest) {
  const input = change.specSnapshot ?? change.spec
  if (input.kind === 'kafka.topic.create' && s.entities.resourceObjects.some(o => o.parentCiId === input.targetCiId && o.kind === 'kafka_topic' && (o.namespace ?? '') === (input.namespace ?? '') && o.externalRef === input.topicName.toLowerCase())) conflict('DUPLICATE_RESOURCE', '此 parent 與 namespace 已有相同 topic identity。')
  if (input.kind === 'resource.bind' && input.mode === 'existing' && s.entities.resourceBindings.some(b => b.environmentId === input.environmentId && b.ciId === input.targetCiId && b.resourceObjectId === input.resourceObjectId && b.purpose === input.purpose)) conflict('DUPLICATE_BINDING', '相同環境、物件與用途的綁定已存在。')
  const key = resourceConflictKey(input)
  if (key && s.entities.changes.some(c => c.id !== change.id && ['approved', 'executing'].includes(c.state) && resourceConflictKey(c.specSnapshot ?? c.spec) === key)) conflict('TARGET_BUSY', '此資源已有已核准或執行中的變更。')
}
function checkQuota(s: Snapshot, change: ChangeRequest) {
  const quota = s.entities.resourceQuotas.find(q => q.parentCiId === change.spec.targetCiId)!
  const demand = resourceDemand(s, change.specSnapshot ?? change.spec)
  for (const dimension of resourceUsage(s, quota, change.id)) if ((demand[dimension.name] ?? 0) > dimension.available) conflict('QUOTA_EXCEEDED', '可用配額不足，尚未核准或執行。')
}
export type ResourceEffect = CommandReceipt & { action: string; fields: string[]; reason?: string; projectIds: string[]; poolIds: string[]; stages: ('dev' | 'staging' | 'prod')[] }
function effect(s: Snapshot, change: ChangeRequest, action: string, reason?: string, execution?: ChangeExecution): ResourceEffect {
  const envs = change.targetVersions.filter(t => t.entityType === 'environment').flatMap(t => s.entities.environments.filter(e => e.id === t.entityId))
  return { entityType: 'change', entityId: change.id, entityVersion: change.version, correlationId: change.correlationId,
    changed: [ref('change', change.id), ...(execution ? [ref('changeExecution', execution.id)] : [])], ...(execution ? { operationId: execution.id } : {}), action,
    fields: ['state', 'version', ...(execution ? ['latestExecutionId'] : [])], reason,
    projectIds: [...new Set(envs.flatMap(e => s.entities.applications.filter(a => a.id === e.applicationId).map(a => a.projectId)))], poolIds: [change.poolId], stages: [...new Set(envs.map(e => e.stage))] }
}
export function prepareResource(s: Snapshot, policy: Policy, input: CommandInput): { apply: (next: Snapshot) => ResourceEffect } | undefined {
  const create = input.method === 'POST' && input.path === '/changes'
  const patchId = input.method === 'PATCH' && /^\/changes\/([^/]+)$/.exec(input.path)?.[1]
  const match = input.method === 'POST' && /^\/changes\/([^/]+)\/(submit|approve|reject|cancel|execute|retry)$/.exec(input.path)
  const scenario = input.method === 'POST' && input.path === '/scenarios' && (input.body as { scenarioKey?: unknown })?.scenarioKey === 'resource-failure'
  if (!create && !patchId && !match && !scenario) return undefined
  const rp = resourcePolicy(s, policy)
  if (scenario) {
    const body = parse(scenarioInputSchema, input.body)
    if (!body.executionId || body.environmentId || body.jobId || body.poolId || body.runId || body.releaseId) fail(422, 'VALIDATION_ERROR', '請指定 resource execution。')
    const execution = s.entities.changeExecutions.find(e => e.id === body.executionId)
    const change = execution && s.entities.changes.find(c => c.id === execution.changeId)
    if (!change || !rp.manages(change.spec)) denied()
    return { apply(next) {
      const current = next.entities.changeExecutions.find(e => e.id === body.executionId)!
      const task = next.scheduler.tasks.find(t => t.operationId === current.id)
      if (!['queued', 'running'].includes(current.state) || !task || task.stepIndex > 2) invalid()
      next.scenarioFlags[`resourceFailure:${current.id}`] = true
      return { ...effect(next, next.entities.changes.find(c => c.id === current.changeId)!, 'demo.scenario.resource-failure'), fields: ['scenarioFlags'] }
    } }
  }
  const body = create ? parse(createChangeInputSchema, input.body) : patchId ? parse(patchChangeInputSchema, input.body)
    : parse(match && ['submit', 'execute'].includes(match[2]) ? versionCommandSchema : reasonCommandSchema, input.body)
  const current = create ? undefined : s.entities.changes.find(c => c.id === (patchId || match && match[1]))
  const action = create ? 'create' : patchId ? 'edit' : match ? match[2] : ''
  // Authorization is deliberately checked before the engine's idempotency replay boundary.
  if (create) { if (!rp.proposes(body as ChangeInput)) denied() }
  else {
    if (!current) denied()
    if (['approve', 'reject'].includes(action)) {
      if (current!.requesterId === policy.user?.id) fail(403, 'SELF_APPROVAL_DENIED', '變更發起者不能審批自己的變更。')
      if (!rp.operate(current!)) denied()
    } else if (action === 'execute') { if (!rp.canExecute(current!)) denied() }
    else if (!rp.requester(current!)) denied()
    if (patchId && !rp.proposes(body as ChangeInput)) denied()
  }
  return { apply(next) {
    const serial = String(next.sequence + 1).padStart(4, '0')
    if (create) {
      const spec = structuredClone(body as ChangeInput)
      if (spec.kind === 'kafka.topic.create') spec.topicName = spec.topicName.toLowerCase()
      validateSpec(next, spec)
      const targets = changeTargets(next, spec), ci = next.entities.cis.find(c => c.id === spec.targetCiId)!
      const change: ChangeRequest = { ...stamp(next, policy.user!.orgId, `change-${serial}`), requesterId: policy.user!.id, kind: spec.kind, poolId: ci.poolId,
        spec, targetRefs: targets.map(({ entityType, entityId }) => ({ entityType, entityId })), targetVersions: targets,
        riskClass: resourcePolicy(next, policy).affected(spec).length > 1 ? 'shared' : 'standard', state: 'draft', correlationId: `corr-change-${serial}`, decisions: [],
        plannedObjectIds: spec.kind === 'kafka.topic.create' || spec.kind === 'resource.bind' && spec.mode === 'create' ? [`resource-${serial}`] : [],
        plannedBindingIds: spec.kind !== 'resource.resize' ? [`binding-${serial}`] : [] }
      checkDuplicates(next, change); next.entities.changes.push(change)
      return effect(next, change, 'change.create', spec.reason)
    }
    const change = next.entities.changes.find(c => c.id === current!.id)!
    if ((body as { expectedVersion: number }).expectedVersion !== change.version) conflict()
    if (action === 'edit') {
      if (change.state !== 'draft') invalid()
      const { expectedVersion: _version, ...spec } = body as z.infer<typeof patchChangeInputSchema>; void _version
      if (spec.kind !== change.kind) fail(422, 'VALIDATION_ERROR', '改變 kind 必須建立新的草稿。')
      if (spec.kind === 'kafka.topic.create') spec.topicName = spec.topicName.toLowerCase()
      validateSpec(next, spec); change.spec = spec; change.poolId = next.entities.cis.find(c => c.id === spec.targetCiId)!.poolId
      change.targetVersions = changeTargets(next, spec); change.targetRefs = change.targetVersions.map(({ entityType, entityId }) => ({ entityType, entityId }))
      change.riskClass = resourcePolicy(next, policy).affected(spec).length > 1 ? 'shared' : 'standard'
      // A draft may switch bind mode; its original stable ID reservation remains deterministic.
      change.plannedObjectIds = spec.kind === 'kafka.topic.create' || spec.kind === 'resource.bind' && spec.mode === 'create' ? [`resource-${change.id.slice(7)}`] : []
      checkDuplicates(next, change); touch(next, change); return effect(next, change, 'change.edit', spec.reason)
    }
    const reason = 'reason' in body ? String(body.reason) : undefined
    if (action === 'cancel') {
      if (!['draft', 'submitted', 'approved'].includes(change.state)) invalid()
      change.state = 'cancelled'; touch(next, change); return effect(next, change, 'change.cancel', reason)
    }
    if (action === 'reject') {
      if (change.state !== 'submitted') invalid()
      change.decisions.push({ actorId: input.actorId, decision: 'rejected', reason: reason!, occurredAt: time(next) })
      change.state = 'rejected'; touch(next, change); return effect(next, change, 'change.reject', reason)
    }
    const catalog = validateSpec(next, change.specSnapshot ?? change.spec)
    checkTargets(next, change); checkDuplicates(next, change)
    if (action === 'submit' || action === 'retry') {
      if (change.state !== (action === 'submit' ? 'draft' : 'failed')) invalid()
      if (action === 'submit') { change.specSnapshot = structuredClone(change.spec); change.catalogSnapshot = structuredClone(catalog) }
      change.state = 'submitted'; touch(next, change); return effect(next, change, `change.${action}`, reason ?? change.spec.reason)
    }
    if (action === 'approve') {
      if (change.state !== 'submitted') invalid()
      checkQuota(next, change)
      change.decisions.push({ actorId: input.actorId, decision: 'approved', reason: reason!, occurredAt: time(next) })
      change.state = 'approved'; touch(next, change); return effect(next, change, 'change.approve', reason)
    }
    if (change.state !== 'approved') invalid()
    checkQuota(next, change)
    // A parent lock serializes object creation, bind and resize registration on the shared parent.
    if (next.entities.changes.some(c => c.id !== change.id && c.state === 'executing' && c.spec.targetCiId === change.spec.targetCiId)) conflict('TARGET_LOCKED', 'parent 已有進行中的執行。')
    const execution: ChangeExecution = { ...stamp(next, change.orgId, `execution-${serial}`), changeId: change.id,
      attempt: next.entities.changeExecutions.filter(e => e.changeId === change.id).length + 1, state: 'queued', targetRefs: structuredClone(change.targetRefs),
      plannedObjectIds: [...change.plannedObjectIds], plannedBindingIds: [...change.plannedBindingIds], correlationId: change.correlationId,
      stepResults: (['validate', 'reserve', 'configure', 'register', 'verify'] as const).map(name => ({ name, state: 'queued' })) }
    next.entities.changeExecutions.push(execution); change.latestExecutionId = execution.id; change.state = 'executing'; touch(next, change)
    next.scheduler.tasks.push({ id: `task-${execution.id}`, operationId: execution.id, stepIndex: 0, dueTick: next.logicalClock + 1 })
    return effect(next, change, 'change.execute', reason, execution)
  } }
}
function materialize(s: Snapshot, change: ChangeRequest) {
  const input = change.specSnapshot!, changed: CommandReceipt['changed'] = []
  let objectId = 'resourceObjectId' in input ? input.resourceObjectId : undefined
  if (input.kind === 'resource.resize') {
    const object = s.entities.resourceObjects.find(o => o.id === input.resourceObjectId)!
    if (object.kind !== 'cache_allocation') invalid()
    object.spec = { quotaMiB: input.quotaMiB }; touch(s, object); changed.push(ref('resourceObject', object.id))
    return changed
  }
  if (input.kind === 'kafka.topic.create' || input.mode === 'create') {
    objectId = change.plannedObjectIds[0]
    const common = { ...stamp(s, change.orgId, objectId), parentCiId: input.targetCiId, lifecycle: 'active' as const, observedAt: null }
    const object: ResourceObject = input.kind === 'kafka.topic.create'
      ? { ...common, kind: 'kafka_topic', name: input.topicName, externalRef: input.topicName, ...(input.namespace ? { namespace: input.namespace } : {}),
        spec: { partitions: input.partitions, retentionHours: input.retentionHours, throughputKiBPerSecond: input.throughputKiBPerSecond } }
      : { ...common, kind: 'cache_allocation', name: `allocation-${objectId}`, externalRef: objectId, spec: { quotaMiB: input.quotaMiB! } }
    s.entities.resourceObjects.push(object); changed.push(ref('resourceObject', object.id))
  }
  let placement = s.entities.placements.find(p => p.applicationId === input.applicationId && p.environmentId === input.environmentId && p.ciId === input.targetCiId)
  if (!placement) {
    placement = { ...stamp(s, change.orgId, `placement-${change.id}`), applicationId: input.applicationId, environmentId: input.environmentId, ciId: input.targetCiId, role: 'dependency' }
    s.entities.placements.push(placement); changed.push(ref('placement', placement.id))
  }
  const binding = { ...stamp(s, change.orgId, change.plannedBindingIds[0]), applicationId: input.applicationId, environmentId: input.environmentId,
    ciId: input.targetCiId, resourceObjectId: objectId, placementId: placement.id, purpose: input.purpose, accessProfileRef: input.accessProfileRef,
    state: 'active' as const, requestRef: { sourceType: 'change' as const, sourceId: change.id } }
  s.entities.resourceBindings.push(binding); changed.push(ref('resourceBinding', binding.id))
  return changed
}
export function advanceResources(s: Snapshot): CommandReceipt['changed'] {
  const changed: CommandReceipt['changed'] = []
  for (const task of s.scheduler.tasks.filter(t => t.dueTick <= s.logicalClock && s.entities.changeExecutions.some(e => e.id === t.operationId)).toSorted((a, b) => a.id.localeCompare(b.id))) {
    const execution = s.entities.changeExecutions.find(e => e.id === task.operationId)!, change = s.entities.changes.find(c => c.id === execution.changeId)!
    const step = execution.stepResults[task.stepIndex]
    execution.state = 'running'; execution.startedAt ??= time(s)
    const failure = task.stepIndex === 2 && s.scenarioFlags[`resourceFailure:${execution.id}`] === true
    step.state = failure ? 'failed' : 'succeeded'; step.occurredAt = time(s); touch(s, execution)
    if (failure || task.stepIndex === 4) {
      execution.state = failure ? 'failed' : 'succeeded'; execution.completedAt = time(s)
      if (failure) {
        execution.failureCode = 'SIMULATED_RESOURCE_CONFIGURE_FAILURE'
        execution.stepResults.slice(task.stepIndex + 1).forEach(step => { step.state = 'skipped' })
      } else changed.push(...materialize(s, change))
      change.state = failure ? 'failed' : 'succeeded'; touch(s, change)
      delete s.scenarioFlags[`resourceFailure:${execution.id}`]
      s.scheduler.tasks = s.scheduler.tasks.filter(t => t.id !== task.id)
      const suffix = `${execution.id}-${s.logicalClock}`
      s.events.push({ eventId: `event-resource-${suffix}`, entities: [ref('change', change.id), ref('changeExecution', execution.id)], type: `change.${change.state}`, occurredAt: time(s), correlationId: change.correlationId })
      const envs = change.targetVersions.filter(t => t.entityType === 'environment').flatMap(t => s.entities.environments.filter(e => e.id === t.entityId))
      s.audit.push({ id: `audit-resource-${suffix}`, orgId: change.orgId, actorId: 'system', action: `change.${change.state}`, entityType: 'change', entityId: change.id,
        scopeSnapshot: { projectIds: [...new Set(envs.flatMap(e => s.entities.applications.filter(a => a.id === e.applicationId).map(a => a.projectId)))], poolIds: [change.poolId], stages: [...new Set(envs.map(e => e.stage))] },
        outcome: 'succeeded', diffSummary: ['state', failure ? 'execution failed; active resource unchanged' : 'canonical resource registration'], requestId: `scheduler-${suffix}`, correlationId: change.correlationId, occurredAt: time(s) })
      changed.push(ref('change', change.id))
    } else { task.stepIndex += 1; task.dueTick = s.logicalClock + 1; execution.stepResults[task.stepIndex].state = 'running' }
    changed.push(ref('changeExecution', execution.id))
  }
  return changed
}

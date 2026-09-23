import { z } from 'zod'
import { DomainError } from './errors'
import { observationTime } from './observation'
import { resourceCapacity } from './resource-capacity'
import { resourcePolicy } from './resource-policy'
import type { Policy } from './policy'
import {
  resourceObjectListQuerySchema, resourceBindingListQuerySchema, resourceInventoryQuerySchema, serviceResourcesQuerySchema,
  changeListQuerySchema, workItemListQuerySchema,
  type ChangeDetail, type ChangeRequest, type ResourceInventory, type ServiceResources, type Snapshot, type WorkItem,
} from './schemas'
const fail = (status: number, code: string, message: string): never => { throw new DomainError(status, code, message) }
const missing = (): never => fail(404, 'NOT_FOUND', '此資源不存在或不在目前授權範圍。')
function queryValues<T extends z.ZodType>(schema: T, query: URLSearchParams): z.infer<T> {
  for (const [key, value] of query) if (query.getAll(key).length !== 1 || !value && key !== 'q') fail(422, 'VALIDATION_ERROR', '查詢欄位不可重複或為空。')
  const result = schema.safeParse(Object.fromEntries(query))
  if (!result.success) fail(422, 'VALIDATION_ERROR', '查詢欄位不符合契約。')
  return result.data!
}
function page<T>(items: T[], values: { q?: string; page: number; pageSize: number; sort: string; order: string }, label: (item: T) => string) {
  const filtered = items.filter(i => !values.q || label(i).toLowerCase().includes(values.q.toLowerCase()))
  const sorted = filtered.toSorted((a, b) => {
    const key = values.sort as keyof T
    return (values.order === 'desc' ? -1 : 1) * String(a[key]).localeCompare(String(b[key])) || label(a).localeCompare(label(b))
  })
  return { items: sorted.slice((values.page - 1) * values.pageSize, values.page * values.pageSize), total: filtered.length, page: values.page, pageSize: values.pageSize }
}
export function resourceConsumer(s: Snapshot, environmentId: string) {
  const env = s.entities.environments.find(e => e.id === environmentId)!, app = s.entities.applications.find(a => a.id === env.applicationId)!
  return { applicationId: app.id, applicationName: app.name, environmentId: env.id, environmentName: env.name, stage: env.stage }
}
export function resourceInventory(s: Snapshot, policy: Policy, ciId: string, environmentId?: string): ResourceInventory {
  const rp = resourcePolicy(s, policy), ci = s.entities.cis.find(c => c.id === ciId && c.orgId === policy.user?.orgId && policy.canReadCi(c)) ?? missing()
  const allBindings = s.entities.resourceBindings.filter(b => b.ciId === ci.id && b.state === 'active')
  const bindings = allBindings.filter(b => rp.bindingVisible(b) && (!environmentId || b.environmentId === environmentId))
  const objects = s.entities.resourceObjects.filter(o => o.parentCiId === ci.id && rp.objectVisible(o)
    && (!environmentId || bindings.some(b => b.resourceObjectId === o.id)))
  const consumers = [...new Set(bindings.map(b => b.environmentId))].sort().map(id => resourceConsumer(s, id))
  const objectImpacts = objects.toSorted((a, b) => a.id.localeCompare(b.id)).map(object => ({
    resourceObjectId: object.id,
    consumers: [...new Set(bindings.filter(b => b.resourceObjectId === object.id).map(b => b.environmentId))].sort().map(id => resourceConsumer(s, id)),
    impactIncomplete: rp.objectBindings(object.id).some(b => !rp.bindingVisible(b)),
    canResize: object.kind === 'cache_allocation' && object.lifecycle === 'active' && policy.effectiveActions.includes('resource.manage') && rp.managesObject(object),
  }))
  const capacity = resourceCapacity(s, policy, ci.id)
  const incomplete = allBindings.some(b => !rp.bindingVisible(b)) || s.entities.resourceObjects.some(o => o.parentCiId === ci.id && o.lifecycle === 'active' && !rp.objectVisible(o))
  const legacyAssociations = s.entities.placements.filter(p => p.ciId === ci.id && (!environmentId || p.environmentId === environmentId)
    && (rp.environmentAccess(p.environmentId, 'rd') || rp.poolAccess(ci.id) && rp.environmentAccess(p.environmentId, 'ops'))
    && !s.entities.resourceBindings.some(b => b.placementId === p.id)).map(p => ({ placementId: p.id, applicationId: p.applicationId, environmentId: p.environmentId }))
  return { ci: { id: ci.id, name: ci.name, kind: ci.kind, provider: ci.provider, poolId: ci.poolId, version: ci.version, health: ci.health, observedAt: ci.observedAt },
    objects: structuredClone(objects.toSorted((a, b) => a.id.localeCompare(b.id))), bindings: structuredClone(bindings.toSorted((a, b) => a.id.localeCompare(b.id))),
    consumers, objectImpacts, capacity, impactIncomplete: incomplete || !!capacity?.impactIncomplete, readOnly: ci.kind === 'cluster', dataAsOf: observationTime(s.logicalClock), legacyAssociations }
}
function changeSummary(s: Snapshot, change: ChangeRequest): WorkItem['summary'] {
  const spec = change.specSnapshot ?? change.spec
  const dimension = (name: WorkItem['summary']['dimensions'][number]['name'], desired: number, current: number | null = 0) => ({ name, current, desired, delta: current === null ? null : desired - current })
  if (spec.kind === 'resource.resize') {
    const object = s.entities.resourceObjects.find(o => o.id === spec.resourceObjectId && o.parentCiId === spec.targetCiId && o.orgId === change.orgId)
    const current = object?.kind === 'cache_allocation' && object.version === spec.resourceObjectVersion ? object.spec.quotaMiB : null
    return { kind: spec.kind, riskClass: change.riskClass, basis: current === null ? 'unavailable' : 'matched-target', dimensions: [dimension('quotaMiB', spec.quotaMiB, current)] }
  }
  if (spec.kind === 'kafka.topic.create') return { kind: spec.kind, riskClass: change.riskClass, basis: 'new',
    dimensions: [dimension('topics', 1), dimension('partitions', spec.partitions), dimension('throughputKiBPerSecond', spec.throughputKiBPerSecond)] }
  return { kind: spec.kind, riskClass: change.riskClass, basis: spec.mode === 'existing' ? 'existing' : 'new',
    dimensions: spec.mode === 'existing' ? [] : [dimension('quotaMiB', spec.quotaMiB!)] }
}
export function changeDetail(s: Snapshot, policy: Policy, change: ChangeRequest): ChangeDetail {
  const rp = resourcePolicy(s, policy), ids = rp.affected(change.spec)
  const visible = ids.filter(id => rp.environmentAccess(id, 'rd') || rp.poolAccess(change.spec.targetCiId) && rp.environmentAccess(id, 'ops'))
  const availableActions: ChangeDetail['availableActions'] = []
  if (rp.requester(change)) {
    if (change.state === 'draft') availableActions.push('edit', 'submit')
    if (['draft', 'submitted', 'approved'].includes(change.state)) availableActions.push('cancel')
    if (change.state === 'failed') availableActions.push('retry')
  }
  if (rp.operate(change)) {
    if (change.state === 'submitted') availableActions.push('approve', 'reject')
  }
  if (change.state === 'approved' && rp.canExecute(change)) availableActions.push('execute')
  return { change: structuredClone(change), summary: changeSummary(s, change), executions: structuredClone(s.entities.changeExecutions.filter(e => e.changeId === change.id).toSorted((a, b) => a.attempt - b.attempt)),
    impact: { consumers: visible.map(id => resourceConsumer(s, id)), incomplete: visible.length !== ids.length },
    capacity: resourceCapacity(s, policy, change.spec.targetCiId), availableActions, dataAsOf: observationTime(s.logicalClock) }
}
export function resourceRoute(s: Snapshot, policy: Policy, type: string, id: string): string | undefined {
  const rp = resourcePolicy(s, policy)
  if (type === 'change' || type === 'changeExecution') {
    const change = s.entities.changes.find(c => c.id === (type === 'change' ? id : s.entities.changeExecutions.find(e => e.id === id)?.changeId))
    if (!change || !rp.changeVisible(change)) return undefined
    return `/${policy.centers.includes('rd') && change.spec.environmentId && rp.environmentAccess(change.spec.environmentId, 'rd') ? 'rd' : 'ops'}/changes/${encodeURIComponent(change.id)}`
  }
  const binding = type === 'resourceBinding' ? s.entities.resourceBindings.find(b => b.id === id && rp.bindingVisible(b))
    : s.entities.resourceBindings.find(b => b.resourceObjectId === id && b.state === 'active' && rp.bindingVisible(b))
  if (!binding) return undefined
  return `/rd/apps/${encodeURIComponent(binding.applicationId)}/resources?environmentId=${encodeURIComponent(binding.environmentId)}`
}
export function workItems(s: Snapshot, policy: Policy, center: 'rd' | 'ops'): WorkItem[] {
  const rp = resourcePolicy(s, policy), now = observationTime(s.logicalClock)
  const actor = (id: string) => ({ id, displayName: s.entities.users.find(u => u.id === id && u.orgId === policy.user?.orgId)?.displayName ?? id })
  const rows: WorkItem[] = []
  for (const request of s.entities.requests.filter(policy.canReadRequest)) {
    const required = center === 'rd' ? policy.canEditRequest(request) && ['draft', 'failed'].includes(request.state) : policy.canOperateRequest(request) && ['submitted', 'approved'].includes(request.state)
    rows.push({ summary: { kind: 'environment.create', riskClass: null, basis: 'new', dimensions: [
      { name: 'cpu', current: 0, desired: request.cpu, delta: request.cpu }, { name: 'memoryMiB', current: 0, desired: request.memoryMiB, delta: request.memoryMiB },
    ] }, sourceType: 'request', sourceId: request.id, rawState: request.state, stateLabel: request.state, actionRequired: required,
      targetRefs: [{ entityType: 'application', entityId: request.applicationId }, ...(request.environmentId ? [{ entityType: 'environment', entityId: request.environmentId }] : [])],
      requester: actor(request.requesterId), approver: request.approval ? actor(request.approval.actorId) : null, createdAt: request.createdAt, updatedAt: request.updatedAt, dataAsOf: now,
      route: `/${center}/requests/${encodeURIComponent(request.id)}` })
  }
  for (const release of s.entities.releases.filter(r => { const env = s.entities.environments.find(e => e.id === r.environmentId); return !!env && policy.canReadEnvironment(env) })) {
    rows.push({ summary: { kind: release.kind === 'rollback' ? 'release.rollback' : 'release.deploy', riskClass: null, basis: 'not-applicable', dimensions: [] }, sourceType: 'release', sourceId: release.id, rawState: release.state, stateLabel: release.state,
      actionRequired: center === 'ops' && release.state === 'pending_approval' && release.createdBy !== policy.user?.id && rp.environmentAccess(release.environmentId, 'ops'),
      targetRefs: [{ entityType: 'application', entityId: release.applicationId }, { entityType: 'environment', entityId: release.environmentId }], requester: actor(release.createdBy), approver: release.approval ? actor(release.approval.actorId) : null,
      createdAt: release.createdAt, updatedAt: release.updatedAt, dataAsOf: now, route: `/${center}/releases/${encodeURIComponent(release.id)}` })
  }
  for (const change of s.entities.changes.filter(rp.changeVisible)) {
    const decision = change.decisions.at(-1)
    rows.push({ summary: changeSummary(s, change), sourceType: 'change', sourceId: change.id, rawState: change.state, stateLabel: change.state,
      actionRequired: center === 'rd' ? rp.requester(change) && ['draft', 'failed'].includes(change.state) : change.state === 'submitted' && rp.operate(change) || change.state === 'approved' && rp.canExecute(change),
      targetRefs: structuredClone(change.targetRefs), requester: actor(change.requesterId), approver: decision ? actor(decision.actorId) : null,
      createdAt: change.createdAt, updatedAt: change.updatedAt, dataAsOf: now, route: `/${center}/changes/${encodeURIComponent(change.id)}` })
  }
  return rows
}
export function readResources(s: Snapshot, policy: Policy, path: string, query: URLSearchParams): unknown {
  if (!/^\/(resource-objects|bindings|resource-inventory|changes|work-items)(\/|$)/.test(path) && !/^\/applications\/[^/]+\/resources$/.test(path)) return undefined
  if (!policy.effectiveActions.includes('resourceObject.read')) {
    if (/^\/(resource-objects|bindings|resource-inventory|changes)\//.test(path) || /^\/applications\//.test(path)) missing()
    fail(403, 'FORBIDDEN', '目前身分沒有資源工作區的授權。')
  }
  const rp = resourcePolicy(s, policy)
  const scoped = (values: { applicationId?: string; environmentId?: string; ciId?: string; provider?: string; poolId?: string }, ciId: string, envIds: string[]) => {
    const ci = s.entities.cis.find(c => c.id === ciId)
    return !!ci && (!values.ciId || ci.id === values.ciId) && (!values.provider || ci.provider === values.provider) && (!values.poolId || ci.poolId === values.poolId)
      && (!values.environmentId || envIds.includes(values.environmentId)) && (!values.applicationId || envIds.some(id => s.entities.environments.some(e => e.id === id && e.applicationId === values.applicationId)))
  }
  if (path === '/resource-objects') {
    const values = queryValues(resourceObjectListQuerySchema, query)
    const objects = s.entities.resourceObjects.filter(o => rp.objectVisible(o) && (!values.kind || o.kind === values.kind)
      && scoped(values, o.parentCiId, rp.objectBindings(o.id).filter(rp.bindingVisible).map(b => b.environmentId)))
    return page(structuredClone(objects), values, o => `${o.name} ${o.id}`)
  }
  if (path === '/bindings') {
    const values = queryValues(resourceBindingListQuerySchema, query)
    const bindings = s.entities.resourceBindings.filter(b => rp.bindingVisible(b) && (!values.state || b.state === values.state) && (!values.resourceObjectId || b.resourceObjectId === values.resourceObjectId)
      && scoped(values, b.ciId, [b.environmentId]))
    return page(structuredClone(bindings), values, b => b.id)
  }
  if (path === '/resource-inventory') {
    const values = queryValues(resourceInventoryQuerySchema, query)
    const cis = s.entities.cis.filter(ci => ['cache', 'queue', 'cluster'].includes(ci.kind) && policy.canReadCi(ci) && (!values.kind || ci.kind === values.kind)
      && scoped(values, ci.id, s.entities.placements.filter(p => p.ciId === ci.id && (rp.environmentAccess(p.environmentId, 'rd') || rp.poolAccess(ci.id) && rp.environmentAccess(p.environmentId, 'ops'))).map(p => p.environmentId)))
    const result = page(cis, values, ci => `${ci.name} ${ci.id}`)
    return { ...result, items: result.items.map(ci => resourceInventory(s, policy, ci.id, values.environmentId)) }
  }
  const service = /^\/applications\/([^/]+)\/resources$/.exec(path)
  if (service) {
    const values = queryValues(serviceResourcesQuerySchema, query), env = rp.environment(values.environmentId)
    if (!env || env.applicationId !== service[1] || !(rp.environmentAccess(env.id, 'rd') || rp.environmentAccess(env.id, 'ops'))) missing()
    const ciIds = new Set(s.entities.placements.filter(p => p.applicationId === service[1] && p.environmentId === values.environmentId && s.entities.cis.some(ci => ci.id === p.ciId && policy.canReadCi(ci))).map(p => p.ciId))
    return { applicationId: service[1], environmentId: values.environmentId, resources: [...ciIds].sort().map(id => resourceInventory(s, policy, id, values.environmentId)), dataAsOf: observationTime(s.logicalClock) } satisfies ServiceResources
  }
  if (path === '/changes') {
    const values = queryValues(changeListQuerySchema, query)
    const changes = s.entities.changes.filter(c => rp.changeVisible(c) && (!values.kind || c.kind === values.kind) && (!values.state || c.state === values.state)
      && (values.owner !== 'mine' || c.requesterId === policy.user?.id) && scoped(values, c.spec.targetCiId, rp.affected(c.spec)))
    return page(structuredClone(changes), values, c => `${c.id} ${c.kind}`)
  }
  if (path === '/work-items') {
    const values = queryValues(workItemListQuerySchema, query)
    if (!policy.centers.includes(values.center)) fail(403, 'FORBIDDEN', '目前身分沒有此工作區的授權。')
    if (values.center === 'rd' && values.view !== undefined || values.center === 'ops' && values.owner !== undefined) fail(422, 'VALIDATION_ERROR', '工作區不支援此篩選欄位。')
    const phases = (state: string) => state === 'approved' ? ['decided', 'execution'] : ['draft', 'submitted', 'pending_approval'].includes(state) ? ['pending'] : ['rejected', 'cancelled'].includes(state) ? ['decided']
      : ['provisioning', 'executing', 'queued', 'deploying', 'verifying'].includes(state) ? ['execution'] : state === 'failed' ? ['failed'] : ['completed']
    const all = workItems(s, policy, values.center).filter(w => (!values.source || w.sourceType === values.source) && (!values.state || w.rawState === values.state)
      && (!values.phase || phases(w.rawState).includes(values.phase)) && (values.center !== 'rd' || (values.owner ?? 'mine') === 'team' || w.requester.id === policy.user?.id)
      && (values.center !== 'ops' || (values.view ?? 'pending') === 'all' || w.actionRequired)
      && (() => {
        if (w.sourceType === 'change') { const c = s.entities.changes.find(c => c.id === w.sourceId)!; return scoped(values, c.spec.targetCiId, rp.affected(c.spec)) }
        const entity = w.sourceType === 'request' ? s.entities.requests.find(r => r.id === w.sourceId)! : s.entities.releases.find(r => r.id === w.sourceId)!
        if (values.applicationId && entity.applicationId !== values.applicationId || values.environmentId && entity.environmentId !== values.environmentId) return false
        if ('poolId' in entity) return (!values.poolId || entity.poolId === values.poolId) && (!values.provider || entity.provider === values.provider) && (!values.ciId || !!entity.environmentId && s.entities.placements.some(p => p.environmentId === entity.environmentId && p.ciId === values.ciId))
        return !(values.ciId || values.provider || values.poolId) || s.entities.placements.some(p => p.environmentId === entity.environmentId && scoped(values, p.ciId, [entity.environmentId]))
      })())
    return page(all, values, w => `${w.sourceId} ${w.sourceType} ${w.rawState}`)
  }
  queryValues(z.strictObject({}), query)
  const objectId = /^\/resource-objects\/([^/]+)$/.exec(path)?.[1]
  if (objectId) return structuredClone(s.entities.resourceObjects.find(o => o.id === objectId && rp.objectVisible(o)) ?? missing())
  const bindingId = /^\/bindings\/([^/]+)$/.exec(path)?.[1]
  if (bindingId) return structuredClone(s.entities.resourceBindings.find(b => b.id === bindingId && rp.bindingVisible(b)) ?? missing())
  const ciId = /^\/resource-inventory\/([^/]+)$/.exec(path)?.[1]
  if (ciId) return resourceInventory(s, policy, ciId)
  const changeId = /^\/changes\/([^/]+)$/.exec(path)?.[1]
  if (changeId) return changeDetail(s, policy, s.entities.changes.find(c => c.id === changeId && rp.changeVisible(c)) ?? missing())
  return missing()
}

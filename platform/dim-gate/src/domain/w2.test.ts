import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { createEngine } from './engine'
import { integrityErrors } from './integrity'
import { policyFor } from './policy'
import { resourcePolicy } from './resource-policy'
import { resourceUsage } from './resource-capacity'
import { changeDetailSchema, resourceInventorySchema, serviceResourcesSchema, workItemSchema, pageSchema,
  type ChangeInput, type Snapshot, type ResourceInventory, type Page, type ResourceObject, type WorkItem } from './schemas'
const rd = 'user-rd-commerce', ops = 'user-ops', otherOps = 'w2-user-ops-secondary', admin = 'user-admin'
const redis = 'ci-idc-redis-01', commerceObject = 'w2-object-redis-commerce'
function harness(initial = createSeed('w2-test'), persist: (next: Snapshot) => void = () => undefined) {
  const engine = createEngine(initial, persist); let sequence = 0
  const command = (path: string, body: unknown, actorId = rd, method = 'POST', key = `w2-test-${++sequence}`) => engine.command({ sessionId: initial.sessionId, actorId, method, path, body, key })
  const read = <T>(path: string, actorId = rd, query = '') => engine.read(path, new URLSearchParams(query), actorId) as T
  const change = (id: string) => engine.getSnapshot().entities.changes.find(c => c.id === id)!
  const advance = (ticks = 5) => command('/clock/advance', { ticks }, ops)
  const action = (id: string, action: string, actor = ['approve', 'reject', 'execute'].includes(action) ? ops : rd, key?: string) => command(`/changes/${id}/${action}`,
    { expectedVersion: change(id).version, ...(['submit', 'execute'].includes(action) ? {} : { reason: `W2 ${action}` }) }, actor, 'POST', key)
  const create = async (input: ChangeInput, actor = rd) => (await command('/changes', input, actor)).entityId
  const ready = async (input: ChangeInput, actor = rd, approver = ops) => { const id = await create(input, actor); await action(id, 'submit', actor); await action(id, 'approve', approver); return id }
  return { engine, command, read, change, advance, action, create, ready }
}
const bind = (overrides: Partial<Extract<ChangeInput, { kind: 'resource.bind' }>> = {}): ChangeInput => ({
  kind: 'resource.bind', mode: 'create', catalogItemId: 'w2-catalog-redis', catalogRevision: 1, reason: 'New safe allocation',
  targetCiId: redis, targetCiVersion: 1, applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1,
  quotaMiB: 512, purpose: 'runtime', accessProfileRef: 'w2-profile-redis-runtime', ...overrides,
})
const topic = (overrides: Partial<Extract<ChangeInput, { kind: 'kafka.topic.create' }>> = {}): ChangeInput => ({
  kind: 'kafka.topic.create', catalogItemId: 'w2-catalog-kafka', catalogRevision: 1, reason: 'Create bounded topic',
  targetCiId: 'w2-ci-kafka-idc', targetCiVersion: 1, applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1,
  topicName: 'new-events', partitions: 3, retentionHours: 72, throughputKiBPerSecond: 512, purpose: 'producer', accessProfileRef: 'w2-profile-kafka-producer', ...overrides,
})
const resize = (overrides: Partial<Extract<ChangeInput, { kind: 'resource.resize' }>> = {}): ChangeInput => ({
  kind: 'resource.resize', catalogItemId: 'w2-catalog-redis', catalogRevision: 1, reason: 'Resize shared allocation', targetCiId: redis, targetCiVersion: 1,
  resourceObjectId: commerceObject, resourceObjectVersion: 1, quotaMiB: 3072, ...overrides,
})
const quota = (s: Snapshot, id = redis) => resourceUsage(s, s.entities.resourceQuotas.find(q => q.parentCiId === id)!)

describe('W2 canonical resources and projection isolation', () => {
  it('preserves all60 original CIs and supports only explicit registered resources and readonly K8s', () => {
    const h = harness(), s = h.engine.getSnapshot()
    expect(s.entities.cis).toHaveLength(63); expect(s.entities.cis.filter(ci => !ci.id.startsWith('w2-'))).toHaveLength(60)
    expect(s.entities.applications).toHaveLength(6); expect(s.entities.environments).toHaveLength(12)
    expect(integrityErrors(s)).toEqual([])
    const topics = s.entities.resourceObjects.filter(o => o.kind === 'kafka_topic')
    expect(topics).toHaveLength(2); expect(topics[0].externalRef).toBe(topics[1].externalRef); expect(topics[0].parentCiId).not.toBe(topics[1].parentCiId)
    const k8s = resourceInventorySchema.parse(h.read('/resource-inventory/w2-ci-k8s-aws'))
    expect(k8s.readOnly).toBe(true); expect(k8s.objects[0].kind).toBe('kubernetes_namespace')
    expect(k8s.capacity).toBeNull()
  })
  it('requires explicit bindings; parent visibility never exposes a foreign allocation or consumer', () => {
    const h = harness(), view = resourceInventorySchema.parse(h.read(`/resource-inventory/${redis}`))
    expect(view.objects.map(o => o.id)).toEqual([commerceObject]); expect(view.bindings).toHaveLength(2)
    expect(view.impactIncomplete).toBe(true); expect(view.capacity?.dimensions[0]).toMatchObject({ used: null, reserved: null, available: null, observed: null })
    expect(JSON.stringify(view)).not.toContain('w2-object-redis-data'); expect(JSON.stringify(view)).not.toContain('app-data')
    expect(() => h.read('/resource-objects/w2-object-redis-data')).toThrow(expect.objectContaining({ status: 404 }))
    expect(() => h.read('/resource-objects/w2-object-redis-commerce', admin)).toThrow(expect.objectContaining({ status: 404 }))
    const service = serviceResourcesSchema.parse(h.read('/applications/app-checkout/resources', rd, 'environmentId=env-checkout-dev'))
    expect(service.resources.some(r => r.legacyAssociations.length)).toBe(true)
    expect(() => h.read('/applications/app-data/resources', rd, 'environmentId=env-checkout-dev')).toThrow(expect.objectContaining({ status: 404 }))
    const full = resourceInventorySchema.parse(h.read(`/resource-inventory/${redis}`, ops))
    expect(full.capacity?.dimensions[0]).toMatchObject({ capacity: 8192, used: 3072, reserved: 0, observed: null })
    expect(full.objects).toHaveLength(2)
  })
  it('keeps pool-only physical metadata while hiding all consumer payloads and private totals', async () => {
    const h = harness()
    for (const grant of h.engine.getSnapshot().entities.assignments.filter(a => a.userId === ops && a.scopeType === 'project')) await h.command(`/admin/assignments/${grant.id}`, { expectedVersion: grant.version, reason: 'Pool only' }, admin, 'DELETE')
    const view = h.read<ResourceInventory>(`/resource-inventory/${redis}`, ops)
    expect(view).toMatchObject({ objects: [], bindings: [], consumers: [], impactIncomplete: true })
    expect(view.capacity?.dimensions[0]).toMatchObject({ used: null, reserved: null, observed: null })
    expect(h.read<Page<ResourceObject>>('/resource-objects', ops).total).toBe(0)
    expect(() => h.read(`/resource-objects/${commerceObject}`, ops)).toThrow(expect.objectContaining({ status: 404 }))
    await expect(h.command('/changes', resize(), ops)).rejects.toMatchObject({ status: 403 })
  })
  it('allows maintenance of a fully authorized object while hiding unrelated parent allocations', async () => {
    const h = harness(), actor = 'w2-user-multi'
    const view = resourceInventorySchema.parse(h.read(`/resource-inventory/${redis}`, actor))
    expect(view.impactIncomplete).toBe(true)
    expect(view.capacity?.dimensions[0]).toMatchObject({ used: null, reserved: null, available: null })
    expect(view.objectImpacts).toHaveLength(1)
    expect(view.objectImpacts[0]).toMatchObject({ resourceObjectId: commerceObject, impactIncomplete: false, canResize: true })
    expect(view.objectImpacts[0].consumers.map(c => c.environmentId)).toEqual(['env-checkout-dev', 'env-storefront-dev'])
    expect(JSON.stringify(view)).not.toContain('w2-object-redis-data')
    expect(JSON.stringify(view)).not.toContain('env-data-dev')
    const id = await h.create(resize(), actor)
    expect(h.change(id).requesterId).toBe(actor)
    const own = serviceResourcesSchema.parse(h.read('/applications/app-checkout/resources', actor, 'environmentId=env-checkout-dev'))
    expect(own.resources.find(r => r.ci.id === redis)!.objectImpacts[0].consumers.map(c => c.environmentId)).toEqual(['env-checkout-dev'])
  })
  it('disables per-object maintenance with a hidden affected consumer and never exposes its identity', async () => {
    const s = createSeed('w2-test'), original = s.entities.resourceBindings.find(b => b.resourceObjectId === commerceObject)!
    s.entities.resourceBindings.push({ ...original, id: 'negative-partial-maintenance', applicationId: 'app-data', environmentId: 'env-data-dev', placementId: 'placement-data-redis' })
    const h = harness(s), view = resourceInventorySchema.parse(h.read(`/resource-inventory/${redis}`, 'w2-user-multi'))
    expect(view.objectImpacts[0]).toMatchObject({ resourceObjectId: commerceObject, impactIncomplete: true, canResize: false })
    expect(JSON.stringify(view.objectImpacts)).not.toContain('data')
    const before = h.engine.getSnapshot()
    await expect(h.create(resize(), 'w2-user-multi')).rejects.toMatchObject({ status: 403 })
    expect(h.engine.getSnapshot()).toEqual(before)
  })
  it('rechecks revoked pool authority even when an RD grant keeps the object visible', async () => {
    const h = harness(), actor = 'w2-user-multi'
    expect(h.read<ResourceInventory>(`/resource-inventory/${redis}`, actor).objectImpacts[0].canResize).toBe(true)
    await h.command('/admin/assignments/w2-grant-multi-pool-idc-sg', { expectedVersion: 1, reason: 'Revoke target pool after old dialog read' }, admin, 'DELETE')
    const view = resourceInventorySchema.parse(h.read(`/resource-inventory/${redis}`, actor))
    expect(view.objects[0].id).toBe(commerceObject)
    expect(view.objectImpacts[0].canResize).toBe(false)
    const before = h.engine.getSnapshot()
    await expect(h.create(resize(), actor)).rejects.toMatchObject({ status: 403 })
    expect(h.engine.getSnapshot()).toEqual(before)
  })
  it('validates strict filters and returns scoped totals before paging', () => {
    const h = harness()
    const visible = h.read<Page<ResourceObject>>('/resource-objects', rd, 'pageSize=1')
    expect(visible.items).toHaveLength(1); expect(visible.total).toBeGreaterThan(1)
    expect(h.read<Page<ResourceObject>>('/resource-objects', rd, 'applicationId=app-data').total).toBe(0)
    for (const query of ['unknown=x', 'kind=database', 'pageSize=101', 'ciId=a&ciId=b', 'provider=']) expect(() => h.read('/resource-objects', rd, query)).toThrow(expect.objectContaining({ status: 422 }))
    expect(() => h.read('/work-items', rd, 'center=rd&view=all')).toThrow(expect.objectContaining({ status: 422 }))
  })
})

describe('W2 queued changes and quota transactions', () => {
  it('freezes a proposal, reserves on approval and creates one canonical allocation/binding only after all5steps', async () => {
    const h = harness(), before = h.engine.getSnapshot(), id = await h.create(bind())
    const created = h.change(id); expect(created.state).toBe('draft'); expect(created.specSnapshot).toBeUndefined()
    await h.action(id, 'submit'); expect(h.change(id).specSnapshot).toEqual(created.spec)
    await h.action(id, 'approve'); expect(quota(h.engine.getSnapshot())[0].reserved).toBe(512)
    expect(h.engine.getSnapshot().entities.resourceObjects).toHaveLength(before.entities.resourceObjects.length)
    const executed = await h.action(id, 'execute'); expect(executed.operationId).toBe(h.change(id).latestExecutionId)
    await h.advance(4); expect(h.change(id).state).toBe('executing'); expect(h.engine.getSnapshot().entities.resourceBindings).toHaveLength(before.entities.resourceBindings.length)
    await h.advance(1); expect(h.change(id).state).toBe('succeeded')
    const after = h.engine.getSnapshot(), binding = after.entities.resourceBindings.find(b => b.requestRef.sourceId === id)!
    expect(binding).toMatchObject({ id: created.plannedBindingIds[0], resourceObjectId: created.plannedObjectIds[0], state: 'active' })
    expect(after.entities.placements).toHaveLength(before.entities.placements.length)
    expect(quota(after)[0]).toMatchObject({ used: 3584, reserved: 0 })
    const detail = changeDetailSchema.parse(h.read(`/changes/${id}`)); expect(detail.executions[0]).toMatchObject({ state: 'succeeded', attempt: 1 })
    expect(integrityErrors(after)).toEqual([])
  })
  it('serializes concurrent last-quota approvals and releases a cancelled reservation', async () => {
    const s = createSeed('w2-test'), q = s.entities.resourceQuotas.find(q => q.parentCiId === redis)!
    if (q.resourceKind === 'redis') q.capacity.quotaMiB = 3584
    const h = harness(s), one = await h.create(bind()), two = await h.create(bind())
    await h.action(one, 'submit'); await h.action(two, 'submit')
    const results = await Promise.allSettled([h.action(one, 'approve'), h.action(two, 'approve')])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected'])
    expect(results[1]).toMatchObject({ reason: { code: 'QUOTA_EXCEEDED' } })
    expect(quota(h.engine.getSnapshot())[0].reserved).toBe(512)
    await h.action(one, 'cancel'); expect(quota(h.engine.getSnapshot())[0].reserved).toBe(0)
    await h.action(two, 'approve'); expect(h.change(two).state).toBe('approved')
  })
  it('preserves failed history/planned IDs and retries only with a new decision, without a partial object', async () => {
    const h = harness(), id = await h.ready(topic()), first = await h.action(id, 'execute'), planned = h.change(id).plannedObjectIds
    const before = h.engine.getSnapshot().entities.resourceObjects.length
    await h.command('/scenarios', { scenarioKey: 'resource-failure', executionId: first.operationId }, ops); await h.advance(3)
    expect(h.change(id).state).toBe('failed'); expect(h.engine.getSnapshot().entities.resourceObjects).toHaveLength(before)
    expect(quota(h.engine.getSnapshot(), 'w2-ci-kafka-idc').every(d => d.reserved === 0)).toBe(true)
    await expect(h.action(id, 'execute')).rejects.toMatchObject({ status: 409 })
    await h.action(id, 'retry'); await h.action(id, 'approve', otherOps); const second = await h.action(id, 'execute', otherOps)
    expect(second.operationId).not.toBe(first.operationId); await h.advance()
    expect(h.change(id).plannedObjectIds).toEqual(planned)
    const history = h.engine.getSnapshot().entities.changeExecutions.filter(e => e.changeId === id)
    expect(history.map(e => [e.attempt, e.state])).toEqual([[1, 'failed'], [2, 'succeeded']])
    expect(h.change(id).decisions).toHaveLength(2); expect(integrityErrors(h.engine.getSnapshot())).toEqual([])
  })
  it('normalizes topic identity and allows same name only in another parent', async () => {
    const h = harness(), one = await h.ready(topic({ topicName: 'Orders-New' })); await h.action(one, 'execute'); await h.advance()
    expect(h.engine.getSnapshot().entities.resourceObjects.find(o => o.id === h.change(one).plannedObjectIds[0])?.externalRef).toBe('orders-new')
    await expect(h.create(topic({ topicName: 'orders-new' }))).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_RESOURCE' })
    const two = await h.ready(topic({ topicName: 'Orders-New', targetCiId: 'w2-ci-kafka-aws' })); await h.action(two, 'execute'); await h.advance()
    expect(h.change(one).plannedObjectIds).not.toEqual(h.change(two).plannedObjectIds)
  })
  it('binds an existing topic without extra quota or placement and blocks duplicate purpose', async () => {
    const h = harness(), object = h.engine.getSnapshot().entities.resourceObjects.find(o => o.id === 'w2-object-kafka-idc-orders')!
    const input = { ...bind(), mode: 'existing', catalogItemId: 'w2-catalog-kafka', targetCiId: object.parentCiId,
      resourceObjectId: object.id, resourceObjectVersion: object.version, purpose: 'consumer', accessProfileRef: 'w2-profile-kafka-consumer' } as Record<string, unknown>
    delete input.quotaMiB
    const before = h.engine.getSnapshot(), id = await h.create(input as ChangeInput); await h.action(id, 'submit'); await h.action(id, 'approve')
    expect(quota(h.engine.getSnapshot(), object.parentCiId).every(d => d.reserved === 0)).toBe(true)
    await h.action(id, 'execute'); await h.advance()
    expect(h.engine.getSnapshot().entities.placements).toHaveLength(before.entities.placements.length)
    expect(h.engine.getSnapshot().entities.resourceObjects).toHaveLength(before.entities.resourceObjects.length)
    await expect(h.create(input as ChangeInput)).rejects.toMatchObject({ code: 'DUPLICATE_BINDING' })
  })
  it('supports RD shared resize without an Ops pool and Ops maintenance with an independent reviewer', async () => {
    const h = harness(), before = quota(h.engine.getSnapshot())[0].used
    const id = await h.ready(resize({ applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1 }))
    expect(h.change(id).riskClass).toBe('shared'); expect(quota(h.engine.getSnapshot())[0].reserved).toBe(2048)
    await h.action(id, 'execute'); await h.advance(); expect(quota(h.engine.getSnapshot())[0].used).toBe(before + 2048)
    const maintenance = await h.create(resize({ resourceObjectVersion: 2, quotaMiB: 1024 }), ops)
    await h.action(maintenance, 'submit', ops)
    await expect(h.action(maintenance, 'approve', ops)).rejects.toMatchObject({ status: 403, code: 'SELF_APPROVAL_DENIED' })
    await h.action(maintenance, 'approve', otherOps); expect(quota(h.engine.getSnapshot())[0].reserved).toBe(0)
    expect(changeDetailSchema.parse(h.read(`/changes/${maintenance}`, ops)).availableActions).toContain('execute')
    expect(h.read<Page<WorkItem>>('/work-items', ops, 'center=ops').items.some(w => w.sourceId === maintenance)).toBe(true)
    await h.action(maintenance, 'execute', ops); await h.advance(); expect(quota(h.engine.getSnapshot())[0].used).toBe(3072)
  })
  it('enforces parent execution locks and resumes exactly the saved execution after reload', async () => {
    const h = harness(), one = await h.ready(bind()), two = await h.ready(bind())
    await h.action(one, 'execute'); await expect(h.action(two, 'execute')).rejects.toMatchObject({ code: 'TARGET_LOCKED' })
    await h.advance(2)
    const saved = h.engine.getSnapshot(), restored = harness(saved)
    expect(restored.engine.getSnapshot()).toEqual(saved)
    await restored.advance(3); expect(restored.change(one).state).toBe('succeeded')
    await restored.action(two, 'execute'); await restored.advance()
    expect(restored.change(two).state).toBe('succeeded')
    expect(restored.engine.getSnapshot().entities.changeExecutions.filter(e => e.changeId === one)).toHaveLength(1)
  })
})


describe('W2 rejection, replay and immutable history boundaries', () => {
  it('rechecks current scope before replay and removes all shared-change projections after a consumer grant is revoked', async () => {
    const s = createSeed('w2-test'), original = s.entities.resourceBindings.find(b => b.resourceObjectId === commerceObject)!
    s.entities.resourceBindings.push({ ...original, id: 'negative-cross-project-binding', applicationId: 'app-data', environmentId: 'env-data-dev', placementId: 'placement-data-redis' })
    const h = harness(s), input = resize({ applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1 })
    await expect(h.command('/changes', input)).rejects.toMatchObject({ status: 403 })
    const grant = await h.command('/admin/assignments', { userId: rd, role: 'rd', scopeType: 'project', scopeId: 'project-data', reason: 'Authorize complete shared impact' }, admin)
    const receipt = await h.command('/changes', input, rd, 'POST', 'shared-replay'), id = receipt.entityId
    await h.action(id, 'submit')
    expect(h.read(`/changes/${id}`)).toBeDefined()
    await h.command(`/admin/assignments/${grant.entityId}`, { expectedVersion: 1, reason: 'Revoke consumer scope' }, admin, 'DELETE')
    const before = JSON.stringify(h.engine.getSnapshot())
    await expect(h.command('/changes', input, rd, 'POST', 'shared-replay')).rejects.toMatchObject({ status: 403 })
    await expect(h.action(id, 'cancel')).rejects.toMatchObject({ status: 403 })
    expect(() => h.read(`/changes/${id}`)).toThrow(expect.objectContaining({ status: 404 }))
    for (const [path, query] of [['/changes', ''], ['/work-items', 'center=rd&owner=team'], ['/search', `q=${id}`], ['/notifications', ''], ['/audit', `entityType=change&entityId=${id}`], ['/dashboard', 'center=rd']] as const) {
      expect(JSON.stringify(h.read(path, rd, query)), path).not.toContain(id)
    }
    expect(JSON.stringify(h.engine.getSnapshot())).toBe(before)
    expect(resourcePolicy(h.engine.getSnapshot(), policyFor(h.engine.getSnapshot(), rd)).objectVisible(h.engine.getSnapshot().entities.resourceObjects.find(o => o.id === commerceObject)!)).toBe(true)
  })
  it('keeps existing-bind frozen refs limited to its own affected consumer, despite unrelated object consumers', async () => {
    const s = createSeed('w2-test'), original = s.entities.resourceBindings.find(b => b.resourceObjectId === commerceObject)!
    s.entities.resourceBindings.push({ ...original, id: 'negative-other-consumer', applicationId: 'app-data', environmentId: 'env-data-dev', placementId: 'placement-data-redis' })
    const h = harness(s), proposal = { ...bind(), mode: 'existing', environmentId: 'env-checkout-prod', resourceObjectId: commerceObject, resourceObjectVersion: 1 } as Record<string, unknown>
    delete proposal.quotaMiB
    const id = await h.create(proposal as ChangeInput), change = h.change(id)
    expect(change.targetVersions.filter(t => t.entityType === 'environment').map(t => t.entityId)).toEqual(['env-checkout-prod'])
    expect(JSON.stringify(h.read(`/changes/${id}`))).not.toContain('env-data-dev')
  })
  it('returns legal WorkItems for all3 sources, mine/team and Ops pending/all phases without copying business state', async () => {
    const h = harness()
    const request = await h.command('/requests', { applicationId: 'app-checkout', environmentName: 'workitem-staging', stage: 'staging',
      catalogItemId: 'catalog-web', catalogRevision: 1, provider: 'aws', poolId: 'pool-aws-sg', cpu: 2, memoryMiB: 2048, purpose: 'Original Request projection' })
    await h.command('/pipelines', { applicationId: 'app-checkout', environmentId: 'env-checkout-dev', revision: 'workitem-release', environmentVersion: 1 })
    await h.advance(6)
    const environmentVersion = h.engine.getSnapshot().entities.environments.find(e => e.id === 'env-checkout-dev')!.version
    const id = await h.create(bind({ environmentVersion })), teammate = await h.create(bind({ environmentVersion }), 'w2-user-multi')
    const before = JSON.stringify(h.engine.getSnapshot())
    const mine = pageSchema(workItemSchema).parse(h.read('/work-items', rd, 'center=rd'))
    expect(new Set(mine.items.map(w => w.sourceType))).toEqual(new Set(['request', 'release', 'change']))
    expect(mine.items.find(w => w.sourceId === request.entityId)).toMatchObject({ sourceType: 'request', rawState: 'draft', route: `/rd/requests/${request.entityId}` })
    expect(mine.items.find(w => w.sourceType === 'release')).toMatchObject({ rawState: 'succeeded' })
    expect(mine.items.some(w => w.sourceId === teammate)).toBe(false)
    expect(h.read<Page<WorkItem>>('/work-items', rd, 'center=rd&owner=team').items.some(w => w.sourceId === teammate)).toBe(true)
    expect(mine.items.find(w => w.sourceId === id)).toMatchObject({ sourceType: 'change', rawState: 'draft', actionRequired: true, route: `/rd/changes/${id}` })
    expect(h.read<Page<WorkItem>>('/work-items', ops, 'center=ops').total).toBe(0)
    expect(h.read<Page<WorkItem>>('/work-items', ops, 'center=ops&view=all&phase=pending').items.some(w => w.sourceId === id)).toBe(true)
    expect(JSON.stringify(h.engine.getSnapshot())).toBe(before)
    await h.action(id, 'submit')
    expect(h.read<Page<WorkItem>>('/work-items', ops, 'center=ops').items.find(w => w.sourceId === id)).toMatchObject({ actionRequired: true, rawState: 'submitted' })
    await h.action(id, 'reject')
    expect(h.read<Page<WorkItem>>('/work-items', ops, 'center=ops&view=all&phase=decided').items.find(w => w.sourceId === id)?.rawState).toBe('rejected')
  })
  it('includes approved Request and Change in both decided and awaiting-execution phases without changing source states', async () => {
    const h = harness(), changeId = await h.ready(bind())
    const request = await h.command('/requests', { applicationId: 'app-checkout', environmentName: 'awaiting-execution', stage: 'staging',
      catalogItemId: 'catalog-web', catalogRevision: 1, provider: 'aws', poolId: 'pool-aws-sg', cpu: 2, memoryMiB: 2048, purpose: 'Phase source validation' })
    await h.command(`/requests/${request.entityId}/submit`, { expectedVersion: request.entityVersion })
    await h.command(`/requests/${request.entityId}/approve`, { expectedVersion: 2, reason: 'Independent original request approval' }, ops)
    const before = h.engine.getSnapshot()
    for (const phase of ['decided', 'execution']) {
      const rows = h.read<Page<WorkItem>>('/work-items', ops, `center=ops&view=all&phase=${phase}`)
      for (const id of [request.entityId, changeId]) expect(rows.items.find(w => w.sourceId === id)).toMatchObject({ rawState: 'approved', actionRequired: true })
    }
    expect(h.engine.getSnapshot()).toEqual(before)
  })
  it('projects the same typed shared risk and exact object delta into triage and approval without reading parent-private totals', async () => {
    const h = harness(), actor = 'w2-user-multi', id = await h.create(resize(), actor)
    await h.action(id, 'submit', actor)
    const detail = changeDetailSchema.parse(h.read(`/changes/${id}`, actor))
    expect(detail.summary).toEqual({ kind: 'resource.resize', riskClass: 'shared', basis: 'matched-target', dimensions: [{ name: 'quotaMiB', current: 1024, desired: 3072, delta: 2048 }] })
    expect(detail.capacity?.dimensions[0].used).toBeNull()
    const row = h.read<Page<WorkItem>>('/work-items', actor, 'center=ops&view=all').items.find(w => w.sourceId === id)!
    expect(row.summary).toEqual(detail.summary)
    await h.action(id, 'approve', otherOps); await h.action(id, 'execute', actor); await h.advance()
    expect(changeDetailSchema.parse(h.read(`/changes/${id}`, actor)).summary).toMatchObject({ basis: 'unavailable', dimensions: [{ current: null, desired: 3072, delta: null }] })
    expect(h.change(id).specSnapshot).toEqual(detail.change.specSnapshot)
  })
  it('uses signed unit differences, zero-demand existing binding and typed multi-dimensional Kafka demand', async () => {
    const h = harness()
    const shrink = await h.create(resize({ quotaMiB: 512 }), ops)
    expect(changeDetailSchema.parse(h.read(`/changes/${shrink}`, ops)).summary.dimensions).toEqual([{ name: 'quotaMiB', current: 1024, desired: 512, delta: -512 }])
    const existing = await h.create({ kind: 'resource.bind', mode: 'existing', catalogItemId: 'w2-catalog-redis', catalogRevision: 1, targetCiId: redis, targetCiVersion: 1,
      applicationId: 'app-checkout', environmentId: 'env-checkout-prod', environmentVersion: 1, resourceObjectId: commerceObject, resourceObjectVersion: 1,
      purpose: 'runtime', accessProfileRef: 'w2-profile-redis-runtime', reason: 'No added allocation quota' })
    expect(changeDetailSchema.parse(h.read(`/changes/${existing}`)).summary).toMatchObject({ basis: 'existing', dimensions: [] })
    const kafka = await h.create(topic())
    expect(changeDetailSchema.parse(h.read(`/changes/${kafka}`)).summary.dimensions).toEqual([
      { name: 'topics', current: 0, desired: 1, delta: 1 }, { name: 'partitions', current: 0, desired: 3, delta: 3 }, { name: 'throughputKiBPerSecond', current: 0, desired: 512, delta: 512 },
    ])
  })
  it('rejects stale versions and disabled/replaced catalogs but executing work retains its approved snapshot', async () => {
    const h = harness(), id = await h.ready(bind())
    await expect(h.command(`/changes/${id}/execute`, { expectedVersion: 1 }, ops)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    const catalog = h.engine.getSnapshot().entities.catalogs.find(c => c.id === 'w2-catalog-redis')!
    await h.command(`/admin/catalog/${catalog.id}/disable`, { expectedVersion: catalog.version, reason: 'Stop new changes' }, admin)
    await expect(h.action(id, 'execute')).rejects.toMatchObject({ code: 'CATALOG_DISABLED' })
    await h.action(id, 'cancel'); expect(quota(h.engine.getSnapshot())[0].reserved).toBe(0)
    const other = harness(), executing = await other.ready(bind()); await other.action(executing, 'execute')
    const current = other.engine.getSnapshot().entities.catalogs.find(c => c.id === 'w2-catalog-redis')!
    await other.command(`/admin/catalog/${current.id}/disable`, { expectedVersion: current.version, reason: 'Disable while running' }, admin)
    await other.advance(); expect(other.change(executing).state).toBe('succeeded')
    const changed = harness(), draft = await changed.create(bind()), c = changed.engine.getSnapshot().entities.catalogs.find(c => c.id === 'w2-catalog-redis')!
    await changed.command(`/admin/catalog/${c.id}/revisions`, { expectedVersion: c.version, baseRevision: c.revision, reason: 'New catalog revision', name: c.name, description: c.description, allowedProjectIds: c.allowedProjectIds, template: c.template }, admin)
    const revision = changed.engine.getSnapshot().entities.catalogs.find(c => c.id === 'w2-catalog-redis')!
    await changed.command(`/admin/catalog/${c.id}/publish`, { expectedVersion: revision.version, revision: revision.revision, reason: 'Publish replacement' }, admin)
    await expect(changed.action(draft, 'submit')).rejects.toMatchObject({ code: 'CATALOG_CHANGED' })
  })
  it('keeps snapshot/reservation/receipt atomic when persistence fails and supports same-key manual retry', async () => {
    let failWrite = false
    const h = harness(createSeed('w2-test'), () => { if (failWrite) throw new Error('quota exceeded') })
    const id = await h.create(bind()); await h.action(id, 'submit')
    const before = h.engine.getSnapshot(), body = { expectedVersion: h.change(id).version, reason: 'Atomic approve' }
    failWrite = true
    await expect(h.command(`/changes/${id}/approve`, body, ops, 'POST', 'atomic-approve')).rejects.toMatchObject({ status: 507 })
    expect(h.engine.getSnapshot()).toEqual(before)
    failWrite = false
    const receipt = await h.command(`/changes/${id}/approve`, body, ops, 'POST', 'atomic-approve')
    expect(await h.command(`/changes/${id}/approve`, body, ops, 'POST', 'atomic-approve')).toEqual(receipt)
    expect(quota(h.engine.getSnapshot())[0].reserved).toBe(512)
    expect(h.engine.getSnapshot().entities.changes).toHaveLength(1)
  })
  it('rejects unsafe/unregistered inputs and Admin, project-only or self approval without partial writes', async () => {
    const h = harness(), before = JSON.stringify(h.engine.getSnapshot())
    await expect(h.command('/changes', { ...bind(), state: 'approved' })).rejects.toMatchObject({ status: 422 })
    await expect(h.command('/changes', { ...bind(), mode: 'existing' })).rejects.toMatchObject({ status: 422 })
    await expect(h.create(bind({ accessProfileRef: 'root-admin-password' }))).rejects.toMatchObject({ status: 422 })
    await expect(h.create(bind({ purpose: 'producer' }))).rejects.toMatchObject({ status: 422 })
    await expect(h.create(bind({ targetCiId: 'w2-ci-k8s-aws' }))).rejects.toMatchObject({ status: 422 })
    await expect(h.command('/changes', bind(), admin)).rejects.toMatchObject({ status: 403 })
    expect(JSON.stringify(h.engine.getSnapshot())).toBe(before)
    const id = await h.create(bind()); await h.action(id, 'submit')
    for (const grant of h.engine.getSnapshot().entities.assignments.filter(a => a.userId === ops && a.scopeType === 'pool')) await h.command(`/admin/assignments/${grant.id}`, { expectedVersion: grant.version, reason: 'Project only' }, admin, 'DELETE')
    await expect(h.action(id, 'approve', ops)).rejects.toMatchObject({ status: 403 })
    await expect(h.action(id, 'approve', rd)).rejects.toMatchObject({ status: 403 })
  })
  it('offers resource catalogs to qualified Ops without granting compute catalog or payload scope', () => {
    const full = harness()
    expect(full.read<Page<{ id: string }>>('/catalog', ops).items.map(c => c.id)).toEqual(['w2-catalog-kafka', 'w2-catalog-redis'])
    expect(full.read<{ id: string }>('/catalog/w2-catalog-redis', ops).id).toBe('w2-catalog-redis')
    expect(() => full.read('/catalog/catalog-web', ops)).toThrow(expect.objectContaining({ status: 404 }))
    for (const remove of ['pool', 'project'] as const) {
      const s = createSeed('w2-test'); s.entities.assignments = s.entities.assignments.filter(a => a.userId !== ops || a.scopeType !== remove)
      const h = harness(s)
      expect(h.read<Page<unknown>>('/catalog', ops).total).toBe(0)
      expect(() => h.read('/catalog/w2-catalog-redis', ops)).toThrow(expect.objectContaining({ status: 404 }))
    }
    const s = createSeed('w2-test')
    for (const assignment of s.entities.assignments.filter(a => a.userId === ops && a.scopeType === 'project')) assignment.stages = ['staging']
    for (const catalog of s.entities.catalogs) catalog.template.allowedStages = ['dev']
    expect(harness(s).read<Page<unknown>>('/catalog', ops).total).toBe(0)
  })
  it('rejects maintenance when any consumer is outside the published catalog stage scope', async () => {
    const s = createSeed('w2-test'), catalog = s.entities.catalogs.find(c => c.id === 'w2-catalog-redis')!
    catalog.template.allowedStages = ['prod']
    const h = harness(s), before = h.engine.getSnapshot()
    await expect(h.create(resize(), ops)).rejects.toMatchObject({ status: 422 })
    expect(h.engine.getSnapshot()).toEqual(before)
  })
  it('rejects unknown WorkItem states and includes only authorized resource tasks in the shared guide', async () => {
    const h = harness(), id = await h.ready(bind()); await h.action(id, 'execute')
    expect(() => h.read('/work-items', rd, 'center=rd&state=unknown')).toThrow(expect.objectContaining({ status: 422 }))
    expect(h.read<{ pendingTasks: number }>('/guide').pendingTasks).toBe(1)
    expect(h.read<{ pendingTasks: number }>('/guide', 'user-rd-data').pendingTasks).toBe(0)
    await h.advance(); expect(h.read<{ pendingTasks: number }>('/guide').pendingTasks).toBe(0)
  })
  it('detects object/binding identity, invalid profile, quota overcommit and ghost scheduler corruption', async () => {
    const h = harness(), id = await h.ready(bind()); await h.action(id, 'execute')
    const original = h.engine.getSnapshot()
    const corruptions: Array<(s: Snapshot) => void> = [
      s => { s.entities.resourceObjects.push({ ...s.entities.resourceObjects[0], id: 'duplicate-object' }) },
      s => { s.entities.resourceBindings.push({ ...s.entities.resourceBindings[0], id: 'duplicate-binding' }) },
      s => { s.entities.resourceBindings[0].accessProfileRef = 'unknown-profile' },
      s => { const q = s.entities.resourceQuotas.find(q => q.parentCiId === redis)!; if (q.resourceKind === 'redis') q.capacity.quotaMiB = 1 },
      s => { s.entities.changes[0].targetRefs = []; s.entities.changes[0].targetVersions = [] },
      s => { s.entities.changes[0].plannedBindingIds = [] },
      s => { const template = s.entities.changes[0].catalogSnapshot!.template; if (template.resourceKind !== 'compute') template.accessProfiles[0].id = 'unregistered' },
      s => { s.scheduler.tasks = [] },
      s => { s.scheduler.tasks[0].stepIndex = 4 },
      s => { s.scheduler.tasks.push({ id: 'ghost', operationId: 'unknown', stepIndex: 0, dueTick: s.logicalClock + 1 }) },
    ]
    for (const corrupt of corruptions) { const copy = structuredClone(original); corrupt(copy); expect(integrityErrors(copy).length).toBeGreaterThan(0); expect(() => harness(copy)).toThrow() }
  })
})

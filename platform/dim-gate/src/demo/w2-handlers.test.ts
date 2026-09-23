import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../api/client'
import { operations } from '../api/contracts'
import { apiErrorSchema, apiResultSchema, commandReceiptSchema, type ChangeInput } from '../domain/schemas'
import { createController, type DemoController } from './controller'
import { createHandlers } from './handlers'

const baseUrl = 'http://localhost/dim-gate/'
const server = setupServer()
let controller: DemoController
let client: ReturnType<typeof createApiClient>
let serial: number
let seen: Set<string>
let unsubscribe: () => void
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => { unsubscribe(); controller.dispose() })

/** Validate the actual MSW status and wire envelope before the typed client consumes it. */
const validatedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init)
  const url = new URL(String(input)), demo = url.pathname.includes('/__demo/')
  const path = url.pathname.replace(/^\/dim-gate\/(?:api|__demo)\/v1/, '')
  const operation = operations.find(op => op.demo === demo && op.method === (init?.method ?? 'GET').toLowerCase()
    && new RegExp(`^${op.path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path))
  const payload: unknown = await response.clone().json()
  if (response.ok) {
    expect(operation, `${init?.method ?? 'GET'} ${path}`).toBeDefined()
    expect(response.status, operation!.id).toBe(operation!.status)
    expect(apiResultSchema(operation!.data).safeParse(payload).success, operation!.id).toBe(true)
    seen.add(operation!.id)
  } else expect(apiErrorSchema.safeParse(payload).success).toBe(true)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  return response
}
beforeEach(() => {
  serial = 0; seen = new Set()
  controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'w2-http' })
  server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
  client = createApiClient()
  client.configureClient({ session: controller.getSession(), baseUrl, createKey: () => `w2-client-${++serial}`, fetch: validatedFetch })
  unsubscribe = controller.subscribe(() => client.updateClientSession(controller.getSession()))
})
function raw(path: string, options: { method?: string; body?: unknown; key?: string; headers?: Record<string, string> } = {}) {
  const session = controller.getSession(), method = options.method ?? 'GET'
  return validatedFetch(new URL(`api/v1${path}`, baseUrl), {
    method, headers: { 'X-Demo-Session': session.sessionId, 'X-Demo-Persona': session.user.id,
      ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'Idempotency-Key': options.key ?? `w2-raw-${++serial}` } : {}), ...options.headers },
    ...(method !== 'GET' ? { body: JSON.stringify(options.body) } : {}),
  })
}
async function error(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status)
  const payload = apiErrorSchema.parse(await response.json())
  if (code) expect(payload.error.code).toBe(code)
  expect(payload.error.retryable).toBe(false)
  return payload
}
const redis = (): Extract<ChangeInput, { kind: 'resource.bind' }> => ({ kind: 'resource.bind', mode: 'create', catalogItemId: 'w2-catalog-redis', catalogRevision: 1,
  reason: 'HTTP Redis allocation', targetCiId: 'ci-idc-redis-01', targetCiVersion: 1,
  applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1,
  quotaMiB: 512, purpose: 'runtime', accessProfileRef: 'w2-profile-redis-runtime' })
const kafka = (topicName = 'http-contract-events', targetCiId = 'w2-ci-kafka-idc'): Extract<ChangeInput, { kind: 'kafka.topic.create' }> => ({ kind: 'kafka.topic.create',
  catalogItemId: 'w2-catalog-kafka', catalogRevision: 1, reason: 'HTTP Kafka topic', targetCiId, targetCiVersion: 1,
  applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1,
  topicName, partitions: 3, retentionHours: 72, throughputKiBPerSecond: 512, purpose: 'producer', accessProfileRef: 'w2-profile-kafka-producer' })
const action = async (id: string, name: Parameters<typeof client.api.changeAction>[1], reason = 'HTTP independent scope verified') =>
  client.api.changeAction(id, name, (await client.api.getChange(id)).change.version, reason)
async function submitted(input: ChangeInput = redis()) {
  const created = await client.api.createChange(input)
  await action(created.entityId, 'submit')
  return created.entityId
}
async function deliver(id: string) {
  await client.api.setPersona('user-ops')
  await action(id, 'approve')
  const receipt = await action(id, 'execute')
  await client.api.advanceClock(5)
  expect((await client.api.getChange(id)).change.state).toBe('succeeded')
  return receipt
}

describe('W2 real HTTP and typed resource client', () => {
  it('serves strict per-object maintenance capabilities and refuses an old proposal after pool revocation', async () => {
    await client.api.setPersona('w2-user-multi')
    const inventory = await client.api.getResourceInventory('ci-idc-redis-01')
    expect(inventory.impactIncomplete).toBe(true)
    expect(inventory.objectImpacts).toHaveLength(1)
    expect(inventory.objectImpacts[0]).toMatchObject({ resourceObjectId: 'w2-object-redis-commerce', canResize: true, impactIncomplete: false })
    expect(JSON.stringify(inventory)).not.toContain('w2-object-redis-data')
    const object = inventory.objects[0]
    const proposal: ChangeInput = { kind: 'resource.resize', catalogItemId: 'w2-catalog-redis', catalogRevision: 1, targetCiId: inventory.ci.id,
      targetCiVersion: inventory.ci.version, resourceObjectId: object.id, resourceObjectVersion: object.version, quotaMiB: 2048, reason: 'Proposal captured from authorized dialog' }
    await client.api.setPersona('user-admin')
    await client.api.revokeAssignment('w2-grant-multi-pool-idc-sg', 1, 'Revoke old dialog target pool')
    await client.api.setPersona('w2-user-multi')
    const current = await client.api.getResourceInventory(inventory.ci.id)
    expect(current.objects[0].id).toBe(object.id)
    expect(current.objectImpacts[0].canResize).toBe(false)
    const before = controller.getSnapshot()
    await error(await raw('/changes', { method: 'POST', body: proposal }), 403)
    expect(controller.getSnapshot()).toEqual(before)
  })

  it('executes all 18 W2 operations with strict wire/status contracts and preserves failed attempt history', async () => {
    expect(operations.filter(op => op.milestone !== 'W3')).toHaveLength(91)
    const w2 = operations.filter(op => op.milestone === 'W2')
    expect(w2).toHaveLength(18)
    const initial = await client.api.getServiceResources('app-checkout', 'env-checkout-dev')
    await client.api.listResourceObjects({ ciId: 'ci-idc-redis-01' })
    await client.api.listBindings({ environmentId: 'env-checkout-dev' })
    await client.api.listResourceInventory({ kind: 'cache' })
    await client.api.getResourceObject('w2-object-redis-commerce')
    await client.api.getBinding('w2-binding-checkout-redis')
    await client.api.getResourceInventory('ci-idc-redis-01')
    await client.api.listWorkItems({ center: 'rd', owner: 'mine' })
    await client.api.listChanges({ owner: 'mine' })
    const created = await client.api.createChange(redis())
    const draft = (await client.api.getChange(created.entityId)).change
    await client.api.patchChange(draft.id, { ...draft.spec, expectedVersion: draft.version, reason: 'Edited HTTP proposal before submit' })
    await action(draft.id, 'submit')
    const frozen = (await client.api.getChange(draft.id)).change
    expect(frozen.specSnapshot?.reason).toBe('Edited HTTP proposal before submit')
    expect(frozen.catalogSnapshot?.template.resourceKind).toBe('redis')
    await client.api.setPersona('user-ops')
    await action(draft.id, 'approve')
    const approved = await client.api.getChange(draft.id)
    expect(approved.change.state).toBe('approved')
    expect(approved.executions).toEqual([])
    await expect(client.api.getBinding(approved.change.plannedBindingIds[0])).rejects.toMatchObject({ status: 404 })
    const executing = await action(draft.id, 'execute')
    expect(executing.operationId).toBeDefined()
    await client.api.setScenario('resource-failure', { executionId: executing.operationId })
    await client.api.advanceClock(3)
    const failed = await client.api.getChange(draft.id)
    expect(failed.change.state).toBe('failed')
    expect(failed.executions[0]).toMatchObject({ state: 'failed', failureCode: 'SIMULATED_RESOURCE_CONFIGURE_FAILURE' })
    expect(failed.executions[0].stepResults.find(step => step.name === 'configure')?.state).toBe('failed')
    await expect(client.api.getBinding(frozen.plannedBindingIds[0])).rejects.toMatchObject({ status: 404 })
    await client.api.setPersona('user-rd-commerce')
    await action(draft.id, 'retry', 'Retry failed immutable proposal')
    await deliver(draft.id)
    const final = await client.api.getChange(draft.id)
    expect(final.change.specSnapshot).toEqual(frozen.specSnapshot)
    expect(final.change.plannedBindingIds).toEqual(frozen.plannedBindingIds)
    expect(final.executions.map(e => [e.attempt, e.state])).toEqual([[1, 'failed'], [2, 'succeeded']])
    expect(final.executions[0]).toEqual(failed.executions[0])
    const binding = await client.api.getBinding(final.change.plannedBindingIds[0])
    const object = await client.api.getResourceObject(final.change.plannedObjectIds[0])
    expect(binding).toMatchObject({ resourceObjectId: object.id, requestRef: { sourceType: 'change', sourceId: draft.id } })
    await client.api.setPersona('user-rd-commerce')
    expect(await client.api.getBinding(binding.id)).toEqual(binding)
    const service = await client.api.getServiceResources('app-checkout', 'env-checkout-dev')
    expect(service.resources.flatMap(r => r.bindings).map(b => b.id)).toContain(binding.id)
    expect(service.resources).toHaveLength(initial.resources.length)
    const cancel = await client.api.createChange(redis())
    await action(cancel.entityId, 'cancel', 'Cancel before execution')
    const reject = await submitted(kafka('http-rejected-events'))
    await client.api.setPersona('user-ops')
    await action(reject, 'reject', 'Independent rejection retains the proposal')
    expect((await client.api.getChange(reject)).executions).toEqual([])
    expect([...seen].filter(id => w2.some(op => op.id === id)).sort()).toEqual(w2.map(op => op.id).sort())
  })

  it('creates same-name Kafka topics in different clusters, rejects same-cluster duplicates, and binds existing objects once', async () => {
    const first = await submitted(kafka('http-same-name'))
    await deliver(first)
    const firstDetail = await client.api.getChange(first)
    await client.api.setPersona('user-rd-commerce')
    await expect(client.api.createChange(kafka('HTTP-SAME-NAME'))).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_RESOURCE' })
    const second = await submitted(kafka('http-same-name', 'w2-ci-kafka-aws'))
    await deliver(second)
    const secondDetail = await client.api.getChange(second)
    const firstObject = await client.api.getResourceObject(firstDetail.change.plannedObjectIds[0])
    const secondObject = await client.api.getResourceObject(secondDetail.change.plannedObjectIds[0])
    expect(firstObject.externalRef).toBe(secondObject.externalRef)
    expect(firstObject.id).not.toBe(secondObject.id)
    expect(firstObject.parentCiId).not.toBe(secondObject.parentCiId)
    await client.api.setPersona('user-rd-commerce')
    const bind: ChangeInput = { kind: 'resource.bind', mode: 'existing', catalogItemId: 'w2-catalog-kafka', catalogRevision: 1,
      reason: 'Consume existing topic', targetCiId: firstObject.parentCiId, targetCiVersion: 1,
      applicationId: 'app-storefront', environmentId: 'env-storefront-dev', environmentVersion: 1,
      resourceObjectId: firstObject.id, resourceObjectVersion: firstObject.version, purpose: 'consumer', accessProfileRef: 'w2-profile-kafka-consumer' }
    const bindingChange = await submitted(bind)
    await deliver(bindingChange)
    const inventory = await client.api.getResourceInventory(firstObject.parentCiId)
    expect(inventory.objects.filter(o => o.id === firstObject.id)).toHaveLength(1)
    expect(inventory.bindings.filter(b => b.resourceObjectId === firstObject.id)).toHaveLength(2)
    expect(new Set(inventory.bindings.filter(b => b.environmentId === 'env-storefront-dev').map(b => b.placementId)).size).toBe(1)
    expect(inventory.capacity?.dimensions.find(d => d.name === 'topics')).toMatchObject({ used: 2, reserved: 0, observed: null })
    await client.api.setPersona('user-rd-commerce')
    await expect(client.api.createChange(bind)).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_BINDING' })
  })

  it('serializes competing HTTP quota approvals and releases the reservation before another request can proceed', async () => {
    const input: ChangeInput = { ...redis(), quotaMiB: 4096 }
    const first = await submitted(input), second = await submitted(input)
    await client.api.setPersona('user-ops')
    const results = await Promise.allSettled([
      client.api.changeAction(first, 'approve', 2, 'First competing approval'),
      client.api.changeAction(second, 'approve', 2, 'Second competing approval'),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409, code: 'QUOTA_EXCEEDED' } })
    const approved = (await client.api.listChanges({ state: 'approved' })).items[0]
    const waiting = approved.id === first ? second : first
    const capacity = await client.api.getResourceInventory('ci-idc-redis-01')
    expect(capacity.capacity?.dimensions).toEqual([expect.objectContaining({ name: 'quotaMiB', used: 3072, reserved: 4096, available: 1024, observed: null })])
    expect((await client.api.getChange(approved.id)).executions).toEqual([])
    await client.api.setPersona('user-rd-commerce')
    await action(approved.id, 'cancel', 'Release quota before execution')
    await client.api.setPersona('user-ops')
    expect((await client.api.getResourceInventory('ci-idc-redis-01')).capacity?.dimensions[0].reserved).toBe(0)
    await action(waiting, 'approve')
    await action(waiting, 'execute')
    await client.api.advanceClock(5)
    expect((await client.api.getResourceInventory('ci-idc-redis-01')).capacity?.dimensions[0]).toMatchObject({ used: 7168, reserved: 0, available: 1024, observed: null })
  })

  it('reads the same K8s CI and namespace through service/resource/CMDB projections with stale samples and no foreign payload', async () => {
    const cluster = await client.api.getResourceInventory('w2-ci-k8s-aws')
    const cmdb = await client.api.getCi('w2-ci-k8s-aws')
    expect(cluster).toMatchObject({ readOnly: true, capacity: null, ci: { id: cmdb.id, observedAt: cmdb.observedAt } })
    expect(cluster.ci.observedAt).toBe('2026-09-18T08:00:00Z')
    expect(cluster.objects[0]).toMatchObject({ id: 'w2-object-k8s-checkout', kind: 'kubernetes_namespace', spec: { workloads: [{ name: 'checkout-api', replicas: 2 }] } })
    expect((await client.api.getServiceResources('app-checkout', 'env-checkout-dev')).resources.find(r => r.ci.id === cmdb.id)?.objects).toEqual(cluster.objects)
    expect(JSON.stringify(cmdb.attributes)).not.toContain('checkout-api')
    await client.api.setPersona('user-rd-data')
    await expect(client.api.getResourceInventory(cmdb.id)).rejects.toMatchObject({ status: 404 })
    await expect(client.api.getResourceObject('w2-object-k8s-checkout')).rejects.toMatchObject({ status: 404 })
  })

  it('rejects unknown/duplicate queries, invalid discriminants, arbitrary payload and missing action reasons with no domain writes', async () => {
    const draft = await client.api.createChange(redis()), baseline = JSON.stringify(controller.getSnapshot())
    for (const path of [
      '/resource-objects?unknown=1', '/resource-objects?ciId=a&ciId=b', '/resource-objects?page=0', '/resource-objects?pageSize=101',
      '/resource-objects?kind=database', '/bindings?state=ready', '/resource-inventory?kind=database', '/changes?owner=all',
      '/work-items?center=rd&view=all', '/work-items?center=rd&source=job', '/work-items?center=rd&state=invented',
      '/applications/app-checkout/resources?environmentId=', `/changes/${draft.entityId}?unknown=1`,
    ]) await error(await raw(path), 422, 'VALIDATION_ERROR')
    for (const body of [
      { ...redis(), requesterId: 'user-admin' }, { ...redis(), kind: 'sql.execute' }, { ...redis(), quotaMiB: 0 },
      { ...redis(), resourceObjectId: 'w2-object-redis-commerce' }, { ...redis(), mode: 'existing' },
      { ...redis(), environmentVersion: 0 }, { ...redis(), reason: '' }, { ...redis(), accessProfileRef: 'arbitrary-credential' },
      { ...kafka(), purpose: 'runtime' }, { ...kafka(), partitions: 0 }, { ...kafka(), script: 'arbitrary' },
    ]) await error(await raw('/changes', { method: 'POST', body }), 422, 'VALIDATION_ERROR')
    await error(await raw(`/changes/${draft.entityId}`, { method: 'PATCH', body: { ...kafka(), expectedVersion: draft.entityVersion } }), 422, 'VALIDATION_ERROR')
    expect(JSON.stringify(controller.getSnapshot())).toBe(baseline)
    await action(draft.entityId, 'submit')
    await client.api.setPersona('user-ops')
    const submittedState = JSON.stringify(controller.getSnapshot())
    await error(await raw(`/changes/${draft.entityId}/approve`, { method: 'POST', body: { expectedVersion: 2 } }), 422, 'VALIDATION_ERROR')
    expect(JSON.stringify(controller.getSnapshot())).toBe(submittedState)
  })

  it('checks current scope before idempotency replay and never returns revoked object/change payload', async () => {
    const body = redis(), response = await raw('/changes', { method: 'POST', body, key: 'revoked-create' })
    const receipt = apiResultSchema(commandReceiptSchema).parse(await response.json()).data
    await client.api.setPersona('user-admin')
    const access = await client.api.getAccess(), grant = access.assignments.find(a => a.id === 'grant-rd-commerce')!
    await client.api.revokeAssignment(grant.id, grant.version, 'Withdraw Store authorization')
    await client.api.setPersona('user-rd-commerce')
    const before = JSON.stringify(controller.getSnapshot())
    await error(await raw('/changes', { method: 'POST', body, key: 'revoked-create' }), 403, 'FORBIDDEN')
    await expect(client.api.getChange(receipt.entityId)).rejects.toMatchObject({ status: 404 })
    await expect(client.api.getResourceObject('w2-object-redis-commerce')).rejects.toMatchObject({ status: 404 })
    await expect(client.api.getBinding('w2-binding-checkout-redis')).rejects.toMatchObject({ status: 404 })
    await expect(client.api.getServiceResources('app-checkout', 'env-checkout-dev')).rejects.toMatchObject({ status: 404 })
    expect((await client.api.listChanges()).total).toBe(0)
    expect((await client.api.listResourceObjects()).total).toBe(0)
    expect((await client.api.search(receipt.entityId)).items).toEqual([])
    expect((await client.api.listAudit({ entityType: 'change', entityId: receipt.entityId })).total).toBe(0)
    expect(JSON.stringify(await client.api.getNotifications())).not.toContain(receipt.entityId)
    expect(JSON.stringify(controller.getSnapshot())).toBe(before)
  })

  it('isolates Data object payload and hides resource totals for pool-only Ops while denying project-only Ops and Admin actions', async () => {
    const id = await submitted()
    await expect(client.api.getResourceObject('w2-object-redis-data')).rejects.toMatchObject({ status: 404 })
    const scoped = await client.api.getResourceInventory('ci-idc-redis-01')
    expect(JSON.stringify(scoped)).not.toContain('w2-object-redis-data')
    expect(scoped.impactIncomplete).toBe(true)
    expect(scoped.capacity?.dimensions.every(d => d.used === null && d.reserved === null)).toBe(true)
    await expect(client.api.getServiceResources('app-checkout', 'env-storefront-dev')).rejects.toMatchObject({ status: 404 })
    await client.api.setPersona('user-admin')
    const pool = await client.api.createAssignment({ userId: 'w2-user-no-grant', role: 'ops', scopeType: 'pool', scopeId: 'pool-idc-sg', reason: 'Pool-only negative HTTP case' })
    await client.api.setPersona('w2-user-no-grant')
    const physical = await client.api.getResourceInventory('ci-idc-redis-01')
    expect(physical).toMatchObject({ objects: [], bindings: [], consumers: [], impactIncomplete: true })
    expect(physical.capacity?.dimensions.every(d => d.used === null && d.reserved === null && d.available === null)).toBe(true)
    expect((await client.api.listResourceObjects()).total).toBe(0)
    await expect(client.api.getResourceObject('w2-object-redis-commerce')).rejects.toMatchObject({ status: 404 })
    await error(await raw(`/changes/${id}/approve`, { method: 'POST', body: { expectedVersion: 2, reason: 'Pool alone is insufficient' } }), 403, 'FORBIDDEN')
    await client.api.setPersona('user-admin')
    await client.api.revokeAssignment(pool.entityId, pool.entityVersion, 'Replace with project-only negative case')
    await client.api.createAssignment({ userId: 'w2-user-no-grant', role: 'ops', scopeType: 'project', scopeId: 'project-store', reason: 'Project alone is insufficient' })
    await client.api.setPersona('w2-user-no-grant')
    await expect(client.api.getResourceObject('w2-object-redis-commerce')).rejects.toMatchObject({ status: 404 })
    await error(await raw(`/changes/${id}/approve`, { method: 'POST', body: { expectedVersion: 2, reason: 'Missing pool grant' } }), 403, 'FORBIDDEN')
    await client.api.setPersona('user-admin')
    await expect(client.api.getChange(id)).rejects.toMatchObject({ status: 404 })
    await expect(client.api.getResourceObject('w2-object-redis-commerce')).rejects.toMatchObject({ status: 404 })
    await expect(client.api.createChange(redis())).rejects.toMatchObject({ status: 403 })
    await error(await raw(`/changes/${id}/execute`, { method: 'POST', body: { expectedVersion: 2 } }), 403, 'FORBIDDEN')
    expect((await client.api.getCatalog('w2-catalog-redis')).template.resourceKind).toBe('redis')
  })

  it('denies multi-role self-approval and permits qualified requester execution after an independent Ops decision', async () => {
    await client.api.setPersona('w2-user-multi')
    const id = await submitted()
    await error(await raw(`/changes/${id}/approve`, { method: 'POST', body: { expectedVersion: 2, reason: 'Self approval must fail' } }), 403, 'SELF_APPROVAL_DENIED')
    await client.api.setPersona('w2-user-ops-secondary')
    await action(id, 'approve')
    await client.api.setPersona('w2-user-multi')
    const execute = await action(id, 'execute')
    await client.api.advanceClock(5)
    expect((await client.api.getChange(id)).change).toMatchObject({ state: 'succeeded', requesterId: 'w2-user-multi', latestExecutionId: execute.operationId })
  })

  it('returns one receipt for same-key replay, rejects body/version conflicts, and retries an uncertain typed command without duplication', async () => {
    const input = redis(), first = await raw('/changes', { method: 'POST', body: input, key: 'same-key' })
    const receipt = apiResultSchema(commandReceiptSchema).parse(await first.json()).data
    const before = JSON.stringify(controller.getSnapshot())
    const replay = await raw('/changes', { method: 'POST', body: input, key: 'same-key' })
    expect(apiResultSchema(commandReceiptSchema).parse(await replay.json()).data).toEqual(receipt)
    await error(await raw('/changes', { method: 'POST', body: { ...input, reason: 'Different body' }, key: 'same-key' }), 409, 'IDEMPOTENCY_CONFLICT')
    await error(await raw(`/changes/${receipt.entityId}`, { method: 'PATCH', body: { ...input, expectedVersion: 99 } }), 409, 'VERSION_CONFLICT')
    expect(JSON.stringify(controller.getSnapshot())).toBe(before)
    let drop = true
    const keys: string[] = []
    client.configureClient({ session: controller.getSession(), fetch: async (url, init) => {
      const response = await validatedFetch(url, init)
      if (String(url).endsWith('/changes') && init?.method === 'POST') {
        keys.push(new Headers(init.headers).get('Idempotency-Key')!)
        if (drop) { drop = false; throw new TypeError('Injected response loss after committed HTTP command') }
      }
      return response
    } })
    await expect(client.api.createChange(kafka())).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    const retry = await client.api.createChange(kafka())
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
    expect((await client.api.listChanges()).items.map(c => c.id).sort()).toEqual([receipt.entityId, retry.entityId].sort())
  })

  it.each(['identity', 'policy'] as const)('discards a held successful service response after %s changes', async boundary => {
    if (boundary === 'policy') {
      await client.api.setPersona('user-admin')
      await client.api.createAssignment({ userId: 'w2-user-multi', role: 'admin', scopeType: 'org', scopeId: 'org-demo', reason: 'Explicit multi-role policy response test' })
      await client.api.setPersona('w2-user-multi')
    }
    let release = () => undefined as void, ready = () => undefined as void, holdNext = true
    const held = new Promise<void>(resolve => { release = resolve }), responseReady = new Promise<void>(resolve => { ready = resolve })
    client.configureClient({ session: controller.getSession(), fetch: async (...args) => {
      const response = await validatedFetch(...args)
      if (holdNext && String(args[0]).includes('/applications/app-checkout/resources')) { holdNext = false; ready(); await held }
      return response
    } })
    const priorIdentity = client.getClientIdentity()
    const pending = client.api.getServiceResources('app-checkout', 'env-checkout-dev')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'STALE_RESPONSE' })
    await responseReady
    if (boundary === 'identity') await client.api.setPersona('user-rd-data')
    else {
      const user = (await client.api.getAccess()).users.find(u => u.id === 'user-rd-data')!
      await client.api.patchUser(user.id, user.version, false, 'Policy update while resource response is held')
      expect(client.getClientIdentity()?.actorId).toBe(priorIdentity?.actorId)
      expect(client.getClientIdentity()?.policyVersion).toBeGreaterThan(priorIdentity!.policyVersion)
    }
    release(); await rejected
    if (boundary === 'identity') {
      const current = await client.api.getServiceResources('app-data', 'env-data-dev')
      expect(JSON.stringify(current)).not.toContain('w2-object-redis-commerce')
    } else expect((await client.api.getServiceResources('app-checkout', 'env-checkout-dev')).applicationId).toBe('app-checkout')
    expect(client.queryKey('service-resources', 'app-checkout', { environmentId: 'env-checkout-dev' }).slice(0, 3)).toEqual([
      client.getClientIdentity()!.sessionId, client.getClientIdentity()!.identityEpoch, client.getClientIdentity()!.policyVersion,
    ])
  })

  it('keeps immutable catalog snapshots when Admin changes or disables a template and rejects stale submit/approval', async () => {
    const draft = await client.api.createChange(redis()), submittedId = await submitted()
    const frozen = (await client.api.getChange(submittedId)).change.catalogSnapshot
    await client.api.setPersona('user-admin')
    const original = await client.api.getCatalog('w2-catalog-redis')
    await client.api.createCatalogRevision(original, 'Change typed limits through governance HTTP')
    const revision = await client.api.getCatalog(original.id)
    if (revision.template.resourceKind !== 'redis') throw new Error('Expected Redis catalog')
    await client.api.patchCatalog(revision, { template: { ...revision.template, defaults: { quotaMiB: 768 } } })
    await client.api.publishCatalog(await client.api.getCatalog(original.id), 'Publish validated Redis revision')
    await client.api.setPersona('user-rd-commerce')
    await expect(action(draft.entityId, 'submit')).rejects.toMatchObject({ status: 409, code: 'CATALOG_CHANGED' })
    expect((await client.api.getChange(submittedId)).change.catalogSnapshot).toEqual(frozen)
    await client.api.setPersona('user-ops')
    await expect(action(submittedId, 'approve')).rejects.toMatchObject({ status: 409, code: 'CATALOG_CHANGED' })
    await client.api.setPersona('user-rd-commerce')
    const newId = await submitted({ ...redis(), catalogRevision: 2 })
    await client.api.setPersona('user-admin')
    await client.api.disableCatalog(await client.api.getCatalog(original.id), 'Disable new approvals')
    await client.api.setPersona('user-ops')
    await expect(action(newId, 'approve')).rejects.toMatchObject({ status: 409, code: 'CATALOG_DISABLED' })
    expect((await client.api.getChange(newId)).executions).toEqual([])
    expect((await client.api.getChange(submittedId)).change.catalogSnapshot).toEqual(frozen)
  })

  it('projects existing Request and Release sources without copying or renaming their state machines', async () => {
    const request = await client.api.createRequest({ applicationId: 'app-checkout', environmentName: 'http-staging', stage: 'staging',
      catalogItemId: 'catalog-web', catalogRevision: 1, provider: 'aws', poolId: 'pool-aws-sg', cpu: 2, memoryMiB: 2048, purpose: 'Original compute source projection' })
    await client.api.submitRequest(request.entityId, request.entityVersion)
    const pipeline = await client.api.createPipeline({ applicationId: 'app-checkout', environmentId: 'env-checkout-prod', environmentVersion: 1, revision: 'http-prod' })
    await client.api.advanceClock(3)
    const releaseId = (await client.api.getPipeline(pipeline.entityId)).run.releaseId!
    const resource = await submitted()
    const rd = await client.api.listWorkItems({ center: 'rd', owner: 'mine', applicationId: 'app-checkout' })
    expect(rd.items.map(w => [w.sourceType, w.sourceId, w.rawState])).toEqual(expect.arrayContaining([
      ['request', request.entityId, 'submitted'], ['release', releaseId, 'pending_approval'], ['change', resource, 'submitted'],
    ]))
    await client.api.setPersona('user-ops')
    const ops = await client.api.listWorkItems({ center: 'ops', view: 'pending' })
    expect(ops.items.filter(w => [request.entityId, releaseId, resource].includes(w.sourceId)).every(w => w.actionRequired)).toBe(true)
    const originalRequest = (await client.api.getRequest(request.entityId)).request
    await client.api.approveRequest(request.entityId, originalRequest.version, 'Original Request approval remains authoritative')
    const originalRelease = (await client.api.getRelease(releaseId)).release
    await client.api.approveRelease(releaseId, originalRelease.version, 'Original Release approval remains authoritative')
    const all = await client.api.listWorkItems({ center: 'ops', view: 'all' })
    expect(all.items.find(w => w.sourceId === request.entityId)).toMatchObject({ sourceType: 'request', rawState: 'approved', route: `/ops/requests/${request.entityId}` })
    expect(all.items.find(w => w.sourceId === releaseId)).toMatchObject({ sourceType: 'release', rawState: 'queued', route: `/ops/releases/${releaseId}` })
    expect(all.items.find(w => w.sourceId === request.entityId)?.summary).toEqual({ kind: 'environment.create', riskClass: null, basis: 'new', dimensions: [
      { name: 'cpu', current: 0, desired: 2, delta: 2 }, { name: 'memoryMiB', current: 0, desired: 2048, delta: 2048 },
    ] })
    expect(all.items.find(w => w.sourceId === releaseId)?.summary).toEqual({ kind: 'release.deploy', riskClass: null, basis: 'not-applicable', dimensions: [] })
    const changeDetail = await client.api.getChange(resource)
    expect(all.items.find(w => w.sourceId === resource)?.summary).toEqual(changeDetail.summary)
    expect(changeDetail.summary.dimensions).toEqual([{ name: 'quotaMiB', current: 0, desired: 512, delta: 512 }])
    expect((await client.api.getChange(resource)).change.state).toBe('submitted')
    await action(resource, 'approve')
    for (const phase of ['execution', 'decided'] as const) {
      const phaseRows = await client.api.listWorkItems({ center: 'ops', view: 'all', phase })
      for (const id of [request.entityId, resource]) expect(phaseRows.items.find(w => w.sourceId === id)).toMatchObject({ rawState: 'approved', actionRequired: true })
    }
    expect((await client.api.listWorkItems({ center: 'ops', view: 'all', phase: 'execution' })).items.find(w => w.sourceId === releaseId)?.rawState).toBe('queued')
    await client.api.setPersona('user-rd-data')
    expect((await client.api.listWorkItems({ center: 'rd', owner: 'team' })).total).toBe(0)
  })
})

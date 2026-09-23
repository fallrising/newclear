import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../api/client'
import { operations } from '../api/contracts'
import { apiErrorSchema, apiResultSchema, type CreatePipelineDefinitionInput, type CreateServiceConfigInput, type CreateTrafficPolicyInput } from '../domain/schemas'
import { createController, type DemoController } from './controller'
import { createHandlers } from './handlers'

const baseUrl = 'http://localhost/dim-gate/'
const server = setupServer()
let controller: DemoController
let client: ReturnType<typeof createApiClient>
let serial: number
let unsubscribe: () => void
const seen = new Set<string>()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => { unsubscribe(); controller.dispose() })
const checkedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init), url = new URL(String(input))
  const demo = url.pathname.includes('/__demo/'), path = url.pathname.replace(/^\/dim-gate\/(?:api|__demo)\/v1/, '')
  const operation = operations.find(op => op.demo === demo && op.method === (init?.method ?? 'GET').toLowerCase()
    && new RegExp(`^${op.path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path))
  const payload: unknown = await response.clone().json()
  if (response.ok) {
    expect(operation, `${init?.method ?? 'GET'} ${path}`).toBeDefined()
    expect(response.status, operation!.id).toBe(operation!.status)
    const checked = apiResultSchema(operation!.data).safeParse(payload)
    expect(checked.success, `${operation!.id}: ${checked.error?.message}`).toBe(true)
    seen.add(operation!.id)
  } else expect(apiErrorSchema.safeParse(payload).success).toBe(true)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  return response
}
beforeEach(() => {
  serial = 0
  controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'w3-http' })
  server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
  client = createApiClient()
  client.configureClient({ session: controller.getSession(), baseUrl, fetch: checkedFetch, createKey: () => `w3-client-${++serial}` })
  unsubscribe = controller.subscribe(() => client.updateClientSession(controller.getSession()))
})
const raw = (path: string, method = 'GET', body?: unknown, key = `w3-raw-${++serial}`) => {
  const s = controller.getSession()
  return checkedFetch(new URL(`api/v1${path}`, baseUrl), { method,
    headers: { 'X-Demo-Session': s.sessionId, 'X-Demo-Persona': s.user.id, ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
}
async function error(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status)
  const data = apiErrorSchema.parse(await response.json())
  if (code) expect(data.error.code).toBe(code)
  return data
}
const definition = (stage = 'dev'): CreatePipelineDefinitionInput => ({ applicationId: 'app-checkout', name: 'HTTP deployment definition', reason: 'Typed HTTP definition',
  spec: { repositoryRef: 'w3-repository-checkout', refPattern: 'main', recipeRef: 'demo-web-v1', artifactRepositoryRef: 'w3-artifact-checkout',
    targetEnvironmentIds: [`env-checkout-${stage}`], approvalPolicyRef: 'independent-ops-prod-v1' } })
const actionBody = (version: number) => ({ expectedVersion: version, reason: 'HTTP current scope and independent decision verified' })
async function definitionAction(id: string, action: Parameters<typeof client.api.pipelineDefinitionAction>[1]) {
  return client.api.pipelineDefinitionAction(id, action, actionBody((await client.api.getPipelineDefinition(id)).source.version))
}
async function configInput(stage = 'dev'): Promise<CreateServiceConfigInput> {
  const env = (await client.api.getEnvironment(`env-checkout-${stage}`)).environment
  return { applicationId: 'app-checkout', environmentId: env.id, environmentVersion: env.version, reason: 'HTTP typed service configuration',
    spec: { entries: [{ key: 'LOG_LEVEL', description: 'Typed string', valueType: 'string', value: 'debug' },
      { key: 'RETRY_LIMIT', description: 'Typed bounded number', valueType: 'number', value: 3 },
      { key: 'CACHE_ENABLED', description: 'Typed flag', valueType: 'boolean', value: true },
      { key: 'SECRET_REF', description: 'Fictional registered secret only', valueType: 'secretRef', value: 'w3-secret-checkout' }] } }
}
async function configAction(id: string, action: Parameters<typeof client.api.serviceConfigAction>[1]) {
  return client.api.serviceConfigAction(id, action, actionBody((await client.api.getServiceConfig(id)).source.version))
}
async function revisionBody(id: string, family: 'config' | 'traffic') {
  const source = family === 'config' ? (await client.api.getServiceConfig(id)).source : (await client.api.getTrafficPolicy(id)).source
  return { ...actionBody(source.version), environmentVersion: (await client.api.getEnvironment(source.environmentId)).environment.version }
}
async function successfulRelease(revision: string, stage = 'dev') {
  const env = (await client.api.getEnvironment(`env-checkout-${stage}`)).environment
  const receipt = await client.api.createPipeline({ applicationId: 'app-checkout', environmentId: env.id, environmentVersion: env.version, revision })
  if (stage === 'prod') {
    await client.api.advanceClock(3)
    const candidate = (await client.api.getPipeline(receipt.entityId)).run
    await client.api.setPersona('user-ops')
    const release = (await client.api.getRelease(candidate.releaseId!)).release
    await client.api.approveRelease(release.id, release.version, 'Independent HTTP prod release approval')
    await client.api.advanceClock(3)
    await client.api.setPersona('user-rd-commerce')
  } else await client.api.advanceClock(6)
  const run = (await client.api.getPipeline(receipt.entityId)).run
  expect(run.state).toBe('succeeded')
  return run.releaseId!
}
async function trafficInput(stage = 'dev'): Promise<CreateTrafficPolicyInput> {
  const baseline = await successfulRelease('http-traffic-baseline', stage), candidate = await successfulRelease('http-traffic-candidate', stage)
  const env = (await client.api.getEnvironment(`env-checkout-${stage}`)).environment
  return { applicationId: 'app-checkout', environmentId: env.id, environmentVersion: env.version, reason: 'HTTP bounded traffic rollout',
    spec: { endpointRef: 'w3-endpoint-checkout', matchRef: 'demo-path-api-v1', targets: [{ releaseId: baseline, weight: 0 }, { releaseId: candidate, weight: 100 }],
      healthWindowSeconds: 60, timeoutSeconds: 120, thresholds: { p95LatencyMs: 500, errorRate: 0.05 } } }
}
async function trafficAction(id: string, action: Parameters<typeof client.api.trafficPolicyAction>[1]) {
  return client.api.trafficPolicyAction(id, action, actionBody((await client.api.getTrafficPolicy(id)).source.version))
}

describe('W3 actual HTTP contracts, persisted service revisions and current authority', () => {
  it('executes definitions through typed HTTP and preserves the old run snapshot after revision activation', async () => {
    await client.api.getDeliveryOptions('app-checkout', 'env-checkout-dev')
    await client.api.listPipelineDefinitions({ applicationId: 'app-checkout', environmentId: 'env-checkout-dev', pageSize: 100 })
    const create = await client.api.createPipelineDefinition(definition()), id = create.entityId
    let row = (await client.api.getPipelineDefinition(id)).source
    await client.api.patchPipelineDefinition(id, { expectedVersion: row.version, name: 'Edited definition', reason: 'Edit before freezing', spec: row.spec })
    await definitionAction(id, 'validate'); await definitionAction(id, 'activate')
    row = (await client.api.getPipelineDefinition(id)).source
    const runReceipt = await client.api.runPipelineDefinition(id, { ...actionBody(row.version), environmentId: 'env-checkout-dev', environmentVersion: 1, sourceRef: 'main', sourceRevision: 'commit-demo-a' })
    const initial = (await client.api.getPipeline(runReceipt.entityId)).run
    expect(initial).toMatchObject({ definitionId: id, definitionRevision: row.revision, sourceRevision: 'commit-demo-a', revision: 'commit-demo-a' })
    expect(initial.artifactDigest).toBeUndefined()
    expect(JSON.stringify(initial.definitionSnapshot)).not.toContain('targetEnvironmentIds')
    await client.api.advanceClock(6)
    const revised = await definitionAction(id, 'revisions'), next = (await client.api.getPipelineDefinition(revised.entityId)).source
    await client.api.patchPipelineDefinition(next.id, { expectedVersion: next.version, name: next.name, reason: 'New ref pattern', spec: { ...next.spec, refPattern: 'release/*' } })
    await definitionAction(next.id, 'validate'); await definitionAction(next.id, 'activate')
    expect((await client.api.getPipeline(runReceipt.entityId)).run.definitionSnapshot).toEqual(initial.definitionSnapshot)
    expect((await client.api.getPipelineDefinition(id)).source.state).toBe('superseded')
    const env = (await client.api.getEnvironment('env-checkout-dev')).environment
    await error(await raw(`/pipeline-definitions/${next.id}/runs`, 'POST', { ...actionBody((await client.api.getPipelineDefinition(next.id)).source.version), environmentId: env.id, environmentVersion: env.version, sourceRef: 'main', sourceRevision: 'wrong-ref' }), 409, 'SOURCE_REF_CONFLICT')
  })

  it('requires distinct prod definition and original prod Release approvals and preserves rejected/cancelled revisions', async () => {
    const id = (await client.api.createPipelineDefinition(definition('prod'))).entityId
    await definitionAction(id, 'validate'); await definitionAction(id, 'submit')
    const pending = (await client.api.getPipelineDefinition(id)).source
    await error(await raw(`/pipeline-definitions/${id}/approve`, 'POST', actionBody(pending.version)), 403)
    await client.api.setPersona('user-ops'); await definitionAction(id, 'approve')
    expect((await client.api.getPipelineDefinition(id)).source.state).toBe('approved')
    await client.api.setPersona('user-rd-commerce'); await definitionAction(id, 'activate')
    const active = (await client.api.getPipelineDefinition(id)).source
    const receipt = await client.api.runPipelineDefinition(id, { ...actionBody(active.version), environmentId: 'env-checkout-prod', environmentVersion: 1, sourceRef: 'main', sourceRevision: 'http-prod' })
    await client.api.advanceClock(3)
    const run = (await client.api.getPipeline(receipt.entityId)).run
    expect(run.state).toBe('awaiting_approval')
    await client.api.setPersona('user-ops')
    const release = (await client.api.getRelease(run.releaseId!)).release
    await client.api.approveRelease(release.id, release.version, 'Independent deployment approval after definition approval')
    await client.api.advanceClock(3)
    expect((await client.api.getRelease(release.id)).release.state).toBe('succeeded')
    await client.api.setPersona('user-rd-commerce')
    const rejectedId = (await definitionAction(id, 'revisions')).entityId
    await definitionAction(rejectedId, 'validate'); await definitionAction(rejectedId, 'submit')
    await client.api.setPersona('user-ops'); await definitionAction(rejectedId, 'reject')
    await client.api.setPersona('user-rd-commerce')
    const cancelId = (await definitionAction(id, 'revisions')).entityId
    await definitionAction(cancelId, 'cancel')
    expect((await client.api.getPipelineDefinition(rejectedId)).source.state).toBe('rejected')
    expect((await client.api.getPipelineDefinition(cancelId)).source.state).toBe('cancelled')
  })

  it('applies typed configuration, keeps active config on failure and restores through a new revision', async () => {
    await client.api.listServiceConfigs({ applicationId: 'app-checkout' })
    const input = await configInput(), id = (await client.api.createServiceConfig(input)).entityId
    await client.api.patchServiceConfig(id, { expectedVersion: 1, environmentVersion: input.environmentVersion, reason: 'Typed patch', spec: input.spec })
    await configAction(id, 'validate')
    expect((await client.api.getServiceConfig(id)).diff).toHaveLength(4)
    await configAction(id, 'apply'); await client.api.advanceClock(3)
    const first = (await client.api.getServiceConfig(id)).source
    expect(first.state).toBe('active')
    const nextId = (await client.api.reviseServiceConfig(id, await revisionBody(id, 'config'))).entityId
    await configAction(nextId, 'validate')
    const attempt = await configAction(nextId, 'apply')
    await client.api.setScenario('config-failure', { executionId: attempt.operationId })
    await client.api.advanceClock(3)
    const failed = await client.api.getServiceConfig(nextId)
    expect(failed.source.state).toBe('failed'); expect(failed.active?.id).toBe(id)
    expect(failed.executions[0].state).toBe('failed')
    const restoreId = (await client.api.restoreServiceConfig(id, await revisionBody(id, 'config'))).entityId
    expect(restoreId).not.toBe(id)
    expect((await client.api.getServiceConfig(restoreId)).source).toMatchObject({ state: 'draft', restoredFromId: id, spec: first.spec })
    await configAction(restoreId, 'validate'); await configAction(restoreId, 'apply'); await client.api.advanceClock(3)
    expect((await client.api.getServiceConfig(restoreId)).active?.id).toBe(restoreId)
    expect((await client.api.getEnvironment('env-checkout-dev')).environment.activeReleaseId).toBeNull()
  })

  it('requires current independent prod config approval and retains decision-only state until explicit RD apply', async () => {
    const id = (await client.api.createServiceConfig(await configInput('prod'))).entityId
    await configAction(id, 'validate'); await configAction(id, 'submit')
    await client.api.setPersona('user-ops'); await configAction(id, 'approve')
    const approved = await client.api.getServiceConfig(id)
    expect(approved.source.state).toBe('approved'); expect(approved.active).toBeNull(); expect(approved.executions).toEqual([])
    await error(await raw(`/service-configs/${id}/apply`, 'POST', actionBody(approved.source.version)), 403)
    await client.api.setPersona('user-rd-commerce'); await configAction(id, 'apply'); await client.api.advanceClock(3)
    const rejected = (await client.api.reviseServiceConfig(id, await revisionBody(id, 'config'))).entityId
    await configAction(rejected, 'validate'); await configAction(rejected, 'submit')
    await client.api.setPersona('user-ops'); await configAction(rejected, 'reject')
    await client.api.setPersona('user-rd-commerce')
    const cancelled = (await client.api.reviseServiceConfig(id, await revisionBody(id, 'config'))).entityId
    await configAction(cancelled, 'cancel')
    expect((await client.api.getServiceConfig(rejected)).source.state).toBe('rejected')
    expect((await client.api.getServiceConfig(cancelled)).source.state).toBe('cancelled')
  })

  it('rolls out only after real windows, locks release/config starts and retains verified10 after anomaly at50', async () => {
    const input = await trafficInput(), activeRelease = (await client.api.getEnvironment(input.environmentId)).environment.activeReleaseId
    await client.api.listTrafficPolicies({ applicationId: input.applicationId })
    const id = (await client.api.createTrafficPolicy(input)).entityId
    await client.api.patchTrafficPolicy(id, { expectedVersion: 1, environmentVersion: input.environmentVersion, reason: 'Explicit bounded rollout', spec: input.spec })
    await trafficAction(id, 'validate'); await trafficAction(id, 'start')
    await error(await raw('/pipelines', 'POST', { applicationId: input.applicationId, environmentId: input.environmentId, environmentVersion: input.environmentVersion, revision: 'busy' }), 409, 'ENVIRONMENT_BUSY')
    const configId = (await client.api.createServiceConfig(await configInput())).entityId
    await configAction(configId, 'validate')
    await error(await raw(`/service-configs/${configId}/apply`, 'POST', actionBody((await client.api.getServiceConfig(configId)).source.version)), 409, 'ENVIRONMENT_BUSY')
    await client.api.advanceClock(30)
    expect((await client.api.getTrafficPolicy(id)).executions[0].kind).toBe('traffic')
    expect((await client.api.getTrafficPolicy(id)).executions[0].checkpoints).toHaveLength(0)
    await client.api.advanceClock(30)
    const ten = await client.api.getTrafficPolicy(id)
    expect(ten.effective.weights.map(row => row.weight)).toEqual([90, 10])
    expect(ten.executions[0].checkpoints[0].sampleIds).toHaveLength(2)
    await client.api.setScenario('traffic-abnormal', { executionId: ten.executions[0].id })
    await client.api.advanceClock(30)
    const failed = await client.api.getTrafficPolicy(id)
    expect(failed.source.state).toBe('failed'); expect(failed.effective.weights).toEqual(ten.effective.weights)
    expect((await client.api.getEnvironment(input.environmentId)).environment.activeReleaseId).toBe(activeRelease)
    const retryId = (await client.api.reviseTrafficPolicy(id, await revisionBody(id, 'traffic'))).entityId
    await trafficAction(retryId, 'validate'); await trafficAction(retryId, 'start')
    for (let i = 0; i < 3; i++) await client.api.advanceClock(60)
    const done = await client.api.getTrafficPolicy(retryId)
    expect(done.source.state).toBe('active'); expect(done.effective.weights.map(row => row.weight)).toEqual([0, 100])
    expect(done.executions[0].checkpoints.map(row => row.step)).toEqual([10, 50, 100])
    expect((await client.api.getTrafficPolicy(id)).executions[0].state).toBe('failed')
    const cancelledId = (await client.api.reviseTrafficPolicy(retryId, await revisionBody(retryId, 'traffic'))).entityId
    await trafficAction(cancelledId, 'cancel')
    expect((await client.api.getTrafficPolicy(cancelledId)).source.state).toBe('cancelled')
  })

  it('treats missing traffic probes as unknown until timeout and never invents a checkpoint', async () => {
    const id = (await client.api.createTrafficPolicy(await trafficInput())).entityId
    await trafficAction(id, 'validate')
    const receipt = await trafficAction(id, 'start'), before = (await client.api.getTrafficPolicy(id)).effective
    await client.api.setScenario('traffic-missing', { executionId: receipt.operationId })
    await client.api.advanceClock(60)
    let detail = await client.api.getTrafficPolicy(id)
    expect(detail.source.state).toBe('rolling_out'); expect(detail.executions[0].checkpoints).toEqual([])
    expect(detail.executions[0].samples.every(row => row.p95LatencyMs === null && row.errorRate === null)).toBe(true)
    await client.api.advanceClock(60)
    detail = await client.api.getTrafficPolicy(id)
    expect(detail.source.state).toBe('failed'); expect(detail.effective.weights).toEqual(before.weights)
    expect(detail.executions[0].checkpoints).toEqual([])
  })

  it('rejects unsafe fields, mismatched scope and unknown/duplicate queries atomically', async () => {
    for (const input of [
      { ...definition(), script: 'arbitrary' },
      { ...definition(), spec: { ...definition().spec, repositoryRef: 'https://example.invalid' } },
    ]) { const before = controller.getSnapshot(); await error(await raw('/pipeline-definitions', 'POST', input), 422); expect(controller.getSnapshot()).toEqual(before) }
    const config = await configInput()
    await error(await raw('/service-configs', 'POST', { ...config, spec: { entries: [{ key: 'TOKEN', valueType: 'secretRef', value: 'not-registered', description: 'unsafe' }] } }), 422)
    await error(await raw('/service-configs?environmentId=env-checkout-dev&environmentId=env-data-dev'), 422)
    await error(await raw('/service-configs?unexpected=true'), 422)
    await error(await raw('/applications/app-checkout/delivery-options?environmentId=env-data-dev'), 404)
    await client.api.setPersona('user-rd-data')
    await error(await raw('/pipeline-definitions/w3-definition-checkout-1'), 404)
    await error(await raw('/service-configs/w3-config-checkout-dev-1'), 404)
    await error(await raw('/service-configs/w3-config-checkout-dev-1/validate', 'POST', actionBody(1)), 403)
    const list = await client.api.listServiceConfigs()
    expect(JSON.stringify(list)).not.toContain('checkout')
    await client.api.setPersona('user-admin')
    await error(await raw('/service-configs/w3-config-checkout-dev-1'), 404)
    await error(await raw('/pipeline-definitions', 'POST', definition()), 403)
  })

  it('keeps prod traffic approved but unexecuted until requester start, with rejection and independent new revision', async () => {
    const id = (await client.api.createTrafficPolicy(await trafficInput('prod'))).entityId
    await trafficAction(id, 'validate'); await trafficAction(id, 'submit')
    const waiting = (await client.api.getTrafficPolicy(id)).source
    await error(await raw(`/traffic-policies/${id}/approve`, 'POST', actionBody(waiting.version)), 403)
    await client.api.setPersona('user-ops'); await trafficAction(id, 'approve')
    const approved = await client.api.getTrafficPolicy(id)
    expect(approved.source.state).toBe('approved'); expect(approved.executions).toEqual([])
    await error(await raw(`/traffic-policies/${id}/start`, 'POST', actionBody(approved.source.version)), 403)
    await client.api.setPersona('user-rd-commerce'); await trafficAction(id, 'start')
    for (let i = 0; i < 3; i++) await client.api.advanceClock(60)
    expect((await client.api.getTrafficPolicy(id)).source.state).toBe('active')
    const nextId = (await client.api.reviseTrafficPolicy(id, await revisionBody(id, 'traffic'))).entityId
    await trafficAction(nextId, 'validate'); await trafficAction(nextId, 'submit')
    await client.api.setPersona('user-ops'); await trafficAction(nextId, 'reject')
    expect((await client.api.getTrafficPolicy(nextId)).source.state).toBe('rejected')
    expect((await client.api.getTrafficPolicy(id)).source.state).toBe('active')
  })

  it('rechecks the approver current project grant at config apply and refuses replay after requester revocation', async () => {
    const input = await configInput('prod')
    const response = await raw('/service-configs', 'POST', input, 'w3-creation-replay')
    expect(response.status).toBe(201)
    const id = (await response.json()).data.entityId as string
    await configAction(id, 'validate'); await configAction(id, 'submit')
    await client.api.setPersona('user-ops'); await configAction(id, 'approve')
    await client.api.setPersona('user-admin')
    await client.api.revokeAssignment('grant-ops-store', 1, 'Revoke current prod approver scope')
    await client.api.setPersona('user-rd-commerce')
    const source = (await client.api.getServiceConfig(id)).source, before = controller.getSnapshot()
    await error(await raw(`/service-configs/${id}/apply`, 'POST', actionBody(source.version)), 409)
    expect(controller.getSnapshot()).toEqual(before)
    await client.api.setPersona('user-admin')
    await client.api.revokeAssignment('grant-rd-commerce', 1, 'Revoke requester scope before same-key replay')
    await client.api.setPersona('user-rd-commerce')
    const revoked = controller.getSnapshot()
    await error(await raw('/service-configs', 'POST', input, 'w3-creation-replay'), 403)
    expect(controller.getSnapshot()).toEqual(revoked)
    await error(await raw(`/service-configs/${id}`), 404)
  })

  it('serializes parallel config starts into one environment execution without partial state', async () => {
    const input = await configInput()
    const a = (await client.api.createServiceConfig(input)).entityId, b = (await client.api.createServiceConfig(input)).entityId
    await configAction(a, 'validate'); await configAction(b, 'validate')
    const av = (await client.api.getServiceConfig(a)).source.version, bv = (await client.api.getServiceConfig(b)).source.version
    const results = await Promise.all([raw(`/service-configs/${a}/apply`, 'POST', actionBody(av)), raw(`/service-configs/${b}/apply`, 'POST', actionBody(bv))])
    expect(results.map(response => response.status).sort()).toEqual([202, 409])
    await error(results.find(response => response.status === 409)!, 409, 'ENVIRONMENT_BUSY')
    expect(controller.getSnapshot().entities.serviceExecutions).toHaveLength(1)
    expect(controller.getSnapshot().entities.serviceConfigs.filter(row => row.state === 'applying')).toHaveLength(1)
  })

  it('has real HTTP evidence for every published W3 operation', () => {
    const expected = operations.filter(operation => operation.milestone === 'W3').map(operation => operation.id)
    expect(expected).toHaveLength(36)
    expect(expected.filter(id => !seen.has(id))).toEqual([])
  })

})

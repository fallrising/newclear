import { afterAll, beforeAll, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { apiResultSchema } from '../domain/schemas'
import { createController } from '../demo/controller'
import { createHandlers } from '../demo/handlers'
import { createSeed } from '../demo/seed'
import { operations, wireSchemas } from './contracts'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

it('every implemented read returns its published Zod DTO through the real shared handler', async () => {
  const controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'contract-session' })
  const baseUrl = 'http://localhost/dim-gate/'
  server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
  for (const personaId of ['user-rd-commerce', 'user-rd-data', 'user-ops', 'user-admin']) {
    const previous = controller.getSession()
    await controller.setPersona(personaId, `persona-${personaId}`, controller.authenticate(previous.sessionId, previous.user.id))
    const session = controller.getSession()
    for (const operation of operations.filter(item => item.milestone === 'M0' && item.method === 'get')) {
      const ciId = personaId === 'user-rd-data' ? 'ci-aliyun-worker-01' : 'ci-aws-checkout-01'
      const url = new URL(`${operation.demo ? '__demo' : 'api'}/v1${operation.path.replace('{id}', ciId)}`, baseUrl)
      if (operation.query?.shape.center) url.searchParams.set('center', session.centers[0])
      const response = await fetch(url, { headers: { 'X-Demo-Session': session.sessionId, 'X-Demo-Persona': personaId } })
      expect(response.status, `${personaId}: ${operation.id}`).toBe(200)
      const checked = apiResultSchema(operation.data).safeParse(await response.json())
      expect(checked.success, `${personaId}: ${operation.id}: ${checked.error?.message}`).toBe(true)
    }
  }
})

it('wire creation refuses derived identity and validates provider-specific attributes before any implementation exists', () => {
  const { name, kind, provider, externalId, accountId, locationId, poolId, ownerTeamId, visibilityProjectIds, lifecycle, tags, attributes, customFields } = createSeed('wire-test').entities.cis[0]
  const input = { name, kind, provider, externalId, accountId, locationId, poolId, ownerTeamId, visibilityProjectIds, lifecycle, tags, attributes, customFields }
  expect(wireSchemas.CreateCI.safeParse(input).success).toBe(true)
  expect(wireSchemas.CreateCI.safeParse({ ...input, id: 'caller-owned', health: 'healthy' }).success).toBe(false)
  expect(wireSchemas.CreateCI.safeParse({ ...input, accountId: undefined }).success).toBe(false)
  expect(wireSchemas.CreateCI.safeParse({ ...input, provider: 'onprem' }).success).toBe(false)
  expect(wireSchemas.CreateCI.safeParse({ ...input, visibilityProjectIds: [] }).success).toBe(false)
})

it('omitted M0 list sorting equals the published default across the shared inventory', async () => {
  const controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'sort-contract' })
  const initial = controller.getSession()
  await controller.setPersona('user-ops', 'sort-persona', controller.authenticate(initial.sessionId, initial.user.id))
  const session = controller.getSession()
  const identity = controller.authenticate(session.sessionId, session.user.id)
  for (const operationId of ['listCIs', 'listApplications']) {
    const operation = operations.find(item => item.id === operationId)!
    const defaults = operation.query!.parse({})
    const implicit = controller.read(operation.path, new URLSearchParams(), identity)
    const explicit = controller.read(operation.path, new URLSearchParams({ sort: String(defaults.sort) }), identity)
    expect(implicit).toEqual(explicit)
  }
})

it('planned observability/topology contracts reject unbounded windows and ambiguous roots', () => {
  const metrics = operations.find(item => item.id === 'getMetrics')!.query!
  const window = { applicationId: 'app-1', environmentId: 'env-1', from: '2026-09-20T09:00:00Z', to: '2026-09-20T10:00:00Z' }
  expect(metrics.safeParse(window).success).toBe(true)
  expect(metrics.safeParse({ ...window, to: window.from }).success).toBe(false)
  expect(metrics.safeParse({ ...window, to: '2026-09-22T10:00:00Z' }).success).toBe(false)
  expect(metrics.safeParse({ ...window, unexpected: true }).success).toBe(false)
  const topology = operations.find(item => item.id === 'getTopology')!.query!
  expect(topology.safeParse({ ciId: 'ci-1', mode: 'impact', depth: '3' }).success).toBe(true)
  expect(topology.safeParse({ ciId: 'ci-1', environmentId: 'env-1', mode: 'impact' }).success).toBe(false)
  expect(topology.safeParse({ ciId: 'ci-1', mode: 'impact', depth: '4' }).success).toBe(false)
})


it('publishes M1 identity guards, explicit unknown freshness, topology caps, capacity and audit', () => {
  const createRelation = wireSchemas.CreateRelation
  expect(createRelation.safeParse({
    sourceCiId: 'ci-a', targetCiId: 'ci-b', sourceExpectedVersion: 1, targetExpectedVersion: 2,
    type: 'depends_on', reason: 'verified relation',
  }).success).toBe(true)
  expect(createRelation.safeParse({
    sourceCiId: 'ci-a', targetCiId: 'ci-b', type: 'depends_on', reason: 'missing guards',
  }).success).toBe(false)
  expect(wireSchemas.TopologyView.safeParse({
    nodes: [], edges: [], truncated: false, depthReached: 0,
  }).success).toBe(true)
  const ciQuery = operations.find((item) => item.id === 'listCIs')!.query!
  expect(ciQuery.safeParse({ freshness: 'unknown' }).success).toBe(true)
  expect(operations.find((item) => item.id === 'getCapacity')?.milestone).toBe('M1')
  expect(operations.find((item) => item.id === 'listAudit')?.milestone).toBe('M1')
})

it('publishes executable M2 request and governance contracts with correct async status', () => {
  expect(wireSchemas.CreateRequest.safeParse({
    applicationId: 'app-checkout', environmentName: 'staging', stage: 'staging',
    catalogItemId: 'catalog-web', catalogRevision: 1, provider: 'aws', poolId: 'pool-aws-sg',
    cpu: 2, memoryMiB: 2048, purpose: 'Contract request',
  }).success).toBe(true)
  expect(wireSchemas.CreateRequest.safeParse({
    applicationId: 'app-checkout', environmentName: 'staging', stage: 'staging',
    catalogItemId: 'catalog-web', catalogRevision: 1, provider: 'aws', poolId: 'pool-aws-sg',
    cpu: 2, memoryMiB: 2000, purpose: 'Invalid memory multiple',
  }).success).toBe(false)
  expect(operations.find((item) => item.id === 'createRequest')).toMatchObject({ milestone: 'M2', status: 201 })
  expect(operations.find((item) => item.id === 'provisionRequest')).toMatchObject({ milestone: 'M2', status: 202 })
  expect(operations.find((item) => item.id === 'createPipeline')).toMatchObject({ milestone: 'M3', status: 202 })
})

import { afterAll, beforeAll, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createController } from './controller'
import { createHandlers } from './handlers'
import { apiResultSchema } from '../domain/schemas'
import { operations } from '../api/contracts'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

function harness() {
  const controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'm4-http' })
  server.resetHandlers(...createHandlers(controller, { delayMs: 0 }))
  let sequence = 0
  const call = async (path: string, body?: unknown, demo = false, key?: string) => {
    const session = controller.getSession()
    const response = await fetch(`http://localhost/dim-gate/${demo ? '__demo' : 'api'}/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: {
        'X-Demo-Session': session.sessionId, 'X-Demo-Persona': session.user.id,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key ?? `m4-http-${++sequence}` }),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const payload = await response.json()
    if (response.ok) {
      const operation = operations.find(op => !!op.demo === demo && op.method === (body === undefined ? 'get' : 'post') && new RegExp(`^${op.path.replace('{id}', '[^/]+')}$`).test(path.split('?')[0]))!
      expect(operation, path).toBeDefined()
      const parsed = apiResultSchema(operation.data).safeParse(payload)
      expect(parsed.success, `${operation.id}: ${parsed.error?.message}`).toBe(true)
      expect(response.status).toBe(operation.status)
    }
    return { status: response.status, ...payload }
  }
  const become = (personaId: string) => call('/persona', { personaId }, true)
  const clock = (ticks: number) => call('/clock/advance', { ticks }, true)
  const environment = () => controller.getSnapshot().entities.environments.find(env => env.id === 'env-checkout-dev')!
  const publish = async (revision: string) => {
    expect((await call('/pipelines', { applicationId: 'app-checkout', environmentId: environment().id, environmentVersion: environment().version, revision })).status).toBe(202)
    expect((await clock(6)).status).toBe(200)
    return controller.getSnapshot().entities.releases.find(release => release.id === environment().activeReleaseId)!
  }
  const window = () => new URLSearchParams({ applicationId: 'app-checkout', environmentId: environment().id, from: '2026-09-20T09:00:00Z', to: new Date(Date.parse('2026-09-20T09:00:00Z') + (controller.getSnapshot().logicalClock + 1) * 1000).toISOString() })
  return { controller, call, become, clock, environment, publish, window }
}

it('serves correlated M4 wire DTOs and resolves only on the third post-rollback minute while retaining evidence', async () => {
  const h = harness()
  const empty = await h.call(`/observability/metrics?${h.window()}`)
  expect(empty.status).toBe(200)
  expect(empty.data.series).toHaveLength(3)
  for (const series of empty.data.series) expect(series).toMatchObject({ points: [], sampleCount: 0 })
  const stable = await h.publish('m4-http-stable')
  const problem = await h.publish('m4-http-latency')
  expect((await h.call('/scenarios', { scenarioKey: 'post-release-latency', environmentId: h.environment().id }, true)).status).toBe(200)
  const metrics = await h.call(`/observability/metrics?${h.window()}`)
  expect(metrics.data.series).toEqual(expect.arrayContaining([
    expect.objectContaining({ metric: 'errorRate', unit: 'fraction', sampleCount: 3, points: expect.arrayContaining([expect.objectContaining({ value: 0.08 })]) }),
    expect.objectContaining({ metric: 'p95Latency', unit: 'ms', sampleCount: 3 }),
  ]))
  const traces = await h.call(`/observability/traces?${h.window()}&status=error`)
  expect(traces.status).toBe(200)
  expect(traces.data.total).toBe(3)
  const trace = (await h.call(`/observability/traces/${traces.data.items[0].id}`)).data
  expect(trace).toMatchObject({ applicationId: 'app-checkout', environmentId: h.environment().id, releaseId: problem.id })
  const logs = await h.call(`/observability/logs?${h.window()}&traceId=${trace.id}&releaseId=${problem.id}`)
  expect(logs.status).toBe(200)
  expect(logs.data.total).toBeGreaterThan(0)
  for (const log of logs.data.items) expect(log).toMatchObject({ traceId: trace.id, releaseId: problem.id, environmentId: h.environment().id })
  let incident = (await h.call('/incidents')).data.items[0]
  expect(incident).toMatchObject({ state: 'open', relatedReleaseId: problem.id, recoverySamples: 0 })
  expect((await h.call(`/incidents/${incident.id}/acknowledge`, { expectedVersion: incident.version })).status).toBe(403)
  await h.become('user-ops')
  const acknowledgment = await h.call(`/incidents/${incident.id}/acknowledge`, { expectedVersion: incident.version }, false, 'same-ack')
  expect(acknowledgment.status).toBe(200)
  expect((await h.call(`/incidents/${incident.id}/acknowledge`, { expectedVersion: incident.version }, false, 'same-ack')).data).toEqual(acknowledgment.data)
  incident = (await h.call(`/incidents/${incident.id}`)).data
  expect(incident).toMatchObject({ state: 'acknowledged', assigneeId: 'user-ops' })
  expect((await h.call(`/incidents/${incident.id}/investigate`, { expectedVersion: incident.version, reason: 'Inspect correlated release and observed samples' })).status).toBe(200)
  const before = (await h.call(`/incidents/${incident.id}`)).data.evidence
  await h.become('user-rd-commerce')
  const rollback = await h.call(`/releases/${problem.id}/rollback`, { expectedVersion: problem.version, environmentVersion: h.environment().version, targetReleaseId: stable.id, reason: 'Recover from observed latency' })
  expect(rollback.status).toBe(202)
  await h.clock(3)
  expect(h.environment().activeReleaseId).toBe(rollback.data.entityId)
  for (let count = 1; count <= 3; count++) {
    await h.clock(60)
    incident = (await h.call(`/incidents/${incident.id}`)).data
    expect(incident.recoverySamples).toBe(count)
    expect(incident.state).toBe(count === 3 ? 'resolved' : 'investigating')
    expect(incident.evidence).toEqual(expect.arrayContaining(before))
  }
  expect((await h.call(`/audit?entityType=incident&entityId=${incident.id}`)).data.total).toBeGreaterThan(0)
  expect((await h.call('/notifications')).data.items.length).toBeGreaterThan(0)
  expect((await h.call('/guide', undefined, true)).data.steps.length).toBeGreaterThan(0)
})

it('rejects invalid M4 windows/filters and hides raw evidence from Admin and cross-project readers', async () => {
  const h = harness()
  await h.publish('m4-sensitive')
  await h.call('/scenarios', { scenarioKey: 'post-release-latency', environmentId: h.environment().id }, true)
  const incident = h.controller.getSnapshot().entities.incidents[0]
  const trace = h.controller.getSnapshot().observations.traces[0]
  const window = h.window()
  expect((await h.call(`/observability/metrics?${window}&step=1s`)).status).toBe(422)
  expect((await h.call(`/observability/logs?${window}&level=critical`)).status).toBe(422)
  expect((await h.call(`/observability/traces?${window}&pageSize=101`)).status).toBe(422)
  expect((await h.call(`/observability/metrics?${window}&environmentId=other`)).status).toBe(422)
  const invalid = new URLSearchParams(window); invalid.set('to', invalid.get('from')!)
  expect((await h.call(`/observability/metrics?${invalid}`)).status).toBe(422)
  await h.become('user-admin')
  const metadata = await h.call(`/incidents/${incident.id}`)
  expect(metadata.status).toBe(200)
  expect(JSON.stringify(metadata.data)).not.toContain(trace.id)
  expect((await h.call(`/observability/traces/${trace.id}`)).status).toBe(404)
  const rawList = await h.call(`/observability/traces?${window}`)
  expect([403, 404]).toContain(rawList.status)
  const rawLogs = await h.call(`/observability/logs?${window}`)
  expect([403, 404]).toContain(rawLogs.status)
  await h.become('user-rd-data')
  expect((await h.call(`/incidents/${incident.id}`)).status).toBe(404)
  expect((await h.call(`/observability/traces/${trace.id}`)).status).toBe(404)
  expect((await h.call(`/observability/metrics?${window}`)).status).toBe(404)
  expect((await h.call('/incidents')).data.total).toBe(0)
  expect(JSON.stringify((await h.call('/notifications')).data)).not.toContain(incident.id)
  expect(JSON.stringify((await h.call('/guide', undefined, true)).data)).not.toContain(incident.id)
})

it('only Admin can run a versioned simulated integration test, with safe persisted result and audit', async () => {
  const h = harness()
  expect((await h.call('/integrations')).status).toBe(403)
  await h.become('user-ops')
  const scoped = await h.call('/integrations')
  expect(scoped.status).toBe(200)
  expect(scoped.data.length).toBeGreaterThan(0)
  const id = scoped.data[0].id
  expect((await h.call(`/integrations/${id}/test`, { expectedVersion: scoped.data[0].version })).status).toBe(403)
  await h.become('user-admin')
  const integration = (await h.call('/integrations')).data.find((value: { id: string }) => value.id === id)
  expect((await h.call(`/integrations/${id}/test`, { expectedVersion: integration.version })).status).toBe(200)
  const tested = (await h.call('/integrations')).data.find((value: { id: string }) => value.id === id)
  expect(tested.lastTestResult).toMatchObject({ demo: true, succeeded: true })
  expect(tested.version).toBe(integration.version + 1)
  expect((await h.call(`/integrations/${id}/test`, { expectedVersion: integration.version })).status).toBe(409)
  expect((await h.call(`/audit?entityType=integration&entityId=${id}`)).data.total).toBeGreaterThan(0)
})

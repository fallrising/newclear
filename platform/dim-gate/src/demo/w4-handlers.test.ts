import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../api/client'
import { operations } from '../api/contracts'
import { runtimeOperations } from '../api/runtime-operations'
import { apiErrorSchema, apiResultSchema } from '../domain/schemas'
import { createController, type DemoController } from './controller'
import { createHandlers } from './handlers'

const baseUrl = 'http://localhost/dim-gate/'
const server = setupServer()
let controller: DemoController
let client: ReturnType<typeof createApiClient>
let serial = 0
let unsubscribe: () => void
const seen = new Set<string>()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => { unsubscribe?.(); controller?.dispose() })
const checkedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init), url = new URL(String(input))
  const demo = url.pathname.includes('/__demo/'), path = url.pathname.replace(/^\/dim-gate\/(?:api|__demo)\/v1/, '')
  const operation = operations.find(op => op.demo === demo && op.method === (init?.method ?? 'GET').toLowerCase()
    && new RegExp(`^${op.path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path))
  const payload: unknown = await response.clone().json()
  if (response.ok) {
    expect(operation, `${init?.method ?? 'GET'} ${path}`).toBeDefined()
    expect(response.status, operation!.id).toBe(operation!.status)
    const parsed = apiResultSchema(operation!.data).safeParse(payload)
    expect(parsed.success, `${operation!.id}: ${parsed.error?.message}`).toBe(true)
    seen.add(operation!.id)
  } else expect(apiErrorSchema.safeParse(payload).success).toBe(true)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  return response
}
beforeEach(() => {
  serial = 0; seen.clear()
  controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'w4-http' })
  server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
  client = createApiClient()
  client.configureClient({ session: controller.getSession(), baseUrl, fetch: checkedFetch, createKey: () => `w4-client-${++serial}` })
  unsubscribe = controller.subscribe(() => client.updateClientSession(controller.getSession()))
})
function raw(path: string, method = 'GET', body?: unknown, key = `w4-raw-${++serial}`) {
  const session = controller.getSession()
  return checkedFetch(new URL(`api/v1${path}`, baseUrl), { method,
    headers: { 'X-Demo-Session': session.sessionId, 'X-Demo-Persona': session.user.id,
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
}
async function denied(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status)
  const payload = apiErrorSchema.parse(await response.json())
  if (code) expect(payload.error.code).toBe(code)
}
const actionBody = (expectedVersion: number) => ({ expectedVersion, reason: 'Current scoped HTTP action' })
const monitorSpec = (environmentId = 'env-checkout-dev') => ({ target: { kind: 'service' as const, applicationId: 'app-checkout', environmentId },
  source: 'demo-red' as const, metrics: ['errorRate' as const], sampleIntervalSeconds: 60, freshnessSeconds: 120, enabled: true })
const ruleSpec = (monitorPolicyId: string) => ({ monitorPolicyId, metric: 'errorRate' as const, aggregation: 'last' as const,
  windowSeconds: 60, comparator: 'gt' as const, threshold: 0.05, unit: 'fraction' as const,
  requiredConsecutiveSamples: 1, severity: 'critical' as const, channelRef: 'demo-rd' as const, enabled: true })
async function monitorAction(id: string, name: Parameters<typeof client.api.monitorPolicyAction>[1]) {
  return client.api.monitorPolicyAction(id, name, actionBody((await client.api.getMonitorPolicy(id)).version))
}
async function ruleAction(id: string, name: Parameters<typeof client.api.alertRuleAction>[1]) {
  return client.api.alertRuleAction(id, name, actionBody((await client.api.getAlertRule(id)).version))
}
async function sloAction(id: string, name: Parameters<typeof client.api.sloPolicyAction>[1]) {
  return client.api.sloPolicyAction(id, name, actionBody((await client.api.getSloPolicy(id)).version))
}
async function activeServiceMonitor(environmentId = 'env-checkout-dev') {
  const id = (await client.api.createMonitorPolicy({ spec: monitorSpec(environmentId), reason: 'Typed HTTP monitor' })).entityId
  await monitorAction(id, 'validate'); await monitorAction(id, 'submit'); await monitorAction(id, 'activate')
  return id
}
async function activeServiceRule(monitorId: string) {
  const id = (await client.api.createAlertRule({ spec: ruleSpec(monitorId), reason: 'Typed HTTP rule' })).entityId
  await ruleAction(id, 'validate'); await ruleAction(id, 'submit'); await ruleAction(id, 'activate')
  return id
}

describe('W4 actual HTTP, typed API and registered monitoring operations', () => {
  it('runs service monitor, rule, SLO, silence and source-time evaluation through the same HTTP adapter', async () => {
    expect((await client.api.getNavigation('rd')).map(item => item.routeKey)).toContain('rd.monitoring')
    for (const list of [client.api.listMonitorPolicies, client.api.listAlertRules, client.api.listSloPolicies,
      client.api.listSilences, client.api.listAlertEvaluations, client.api.listNotificationDeliveries]) {
      expect((await list({ applicationId: 'app-checkout' })).items).toEqual([])
    }
    const monitorId = await activeServiceMonitor(), ruleId = await activeServiceRule(monitorId)
    const sloId = (await client.api.createSloPolicy({ spec: { monitorPolicyId: monitorId, indicator: 'availability',
      targetFraction: 0.99, windowSeconds: 86_400, unit: 'fraction' }, reason: 'HTTP availability target' })).entityId
    await sloAction(sloId, 'validate'); await sloAction(sloId, 'submit'); await sloAction(sloId, 'activate')
    expect((await client.api.getSloPolicy(sloId)).activeRevision).toBe(1)
    const now = Date.parse('2026-09-20T09:00:00Z') + controller.getSnapshot().logicalClock * 1000
    const silenceId = (await client.api.createSilence({ ruleId, startAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 120_000).toISOString(), reason: 'HTTP planned maintenance' })).entityId
    expect((await client.api.getSilence(silenceId)).ruleRevision).toBe(1)
    await client.api.setScenario('alert-breach', { ruleId })
    const evaluation = (await client.api.listAlertEvaluations({ ruleId, status: 'fresh' })).items[0]
    expect(evaluation).toMatchObject({ ruleId, ruleRevision: 1, breached: true, consecutive: 1 })
    expect((await client.api.getAlertEvaluation(evaluation.id)).sampleId).toBe(evaluation.sampleId)
    const delivery = (await client.api.listNotificationDeliveries({ ruleId, status: 'suppressed' })).items[0]
    expect(delivery).toMatchObject({ ruleId, ruleRevision: 1, status: 'suppressed' })
    expect((await client.api.getNotificationDelivery(delivery.id)).incidentId).toBe(evaluation.incidentId)
    expect((await client.api.listSilences({ status: 'active' })).items.map(item => item.id)).toContain(silenceId)
    await client.api.advanceClock(60)
    await client.api.advanceClock(60)
    expect((await client.api.listSilences({ status: 'expired' })).items.map(item => item.id)).toContain(silenceId)
    expect((await client.api.getIncident(delivery.incidentId)).id).toBe(delivery.incidentId)
  })

  it('enforces independent production approval and current scope, DTO, version and status validation', async () => {
    const id = (await client.api.createMonitorPolicy({ spec: monitorSpec('env-checkout-prod'), reason: 'Prod monitor review' })).entityId
    await monitorAction(id, 'validate'); await monitorAction(id, 'submit')
    const pending = await client.api.getMonitorPolicy(id)
    await denied(await raw(`/monitor-policies/${id}/approve`, 'POST', actionBody(pending.version)), 403)
    await client.api.setPersona('user-ops'); await monitorAction(id, 'approve')
    await denied(await raw(`/monitor-policies/${id}/activate`, 'POST', actionBody((await client.api.getMonitorPolicy(id)).version)), 403)
    await client.api.setPersona('user-rd-commerce'); await monitorAction(id, 'activate')
    const active = await client.api.getMonitorPolicy(id)
    expect(active.revisions[0].decision?.actorId).toBe('user-ops')
    await denied(await raw(`/monitor-policies/${id}/revise`, 'POST', { expectedVersion: 1, spec: active.spec, reason: 'Stale HTTP revision' }), 409)
    const revised = await client.api.reviseMonitorPolicy(id, { expectedVersion: active.version, spec: active.spec, reason: 'Preserve old active revision' })
    expect(revised.entityId).toBe(id)
    expect(await client.api.getMonitorPolicy(id)).toMatchObject({ revision: 2, activeRevision: 1, status: 'draft' })
    await denied(await raw('/monitor-policies', 'POST', { spec: monitorSpec(), reason: 'Bad DTO', webhookUrl: 'https://example.invalid' }), 422)
    await denied(await raw('/monitor-policies?status=surprise'), 422)
    await denied(await raw('/monitor-policies?applicationId=app-checkout&applicationId=app-data'), 422)
    await client.api.setPersona('user-rd-data')
    await denied(await raw(`/monitor-policies/${id}`), 404)
    expect((await client.api.listMonitorPolicies()).total).toBe(0)
    await denied(await raw(`/monitor-policies/${id}/validate`, 'POST', actionBody(1)), 403)
    await client.api.setPersona('user-admin')
    await denied(await raw('/monitor-policies', 'POST', { spec: monitorSpec(), reason: 'Admin has no business write' }), 403)
  })

  it('routes a physical Ops rule into a CI-only incident and typed incident readback', async () => {
    await client.api.setPersona('user-ops')
    const monitorId = (await client.api.createMonitorPolicy({ spec: { target: { kind: 'infrastructure', ciId: 'ci-aws-checkout-01' },
      source: 'demo-ci', metrics: ['cpuUtilization'], sampleIntervalSeconds: 60, freshnessSeconds: 120, enabled: true }, reason: 'Ops physical monitor' })).entityId
    await monitorAction(monitorId, 'validate'); await monitorAction(monitorId, 'submit'); await monitorAction(monitorId, 'activate')
    const ruleId = (await client.api.createAlertRule({ spec: { monitorPolicyId: monitorId, metric: 'cpuUtilization', aggregation: 'last',
      windowSeconds: 60, comparator: 'gt', threshold: 0.8, unit: 'fraction', requiredConsecutiveSamples: 1,
      severity: 'warning', channelRef: 'demo-ops', enabled: true }, reason: 'Ops physical CPU rule' })).entityId
    await ruleAction(ruleId, 'validate'); await ruleAction(ruleId, 'submit'); await ruleAction(ruleId, 'activate')
    await client.api.setScenario('alert-breach', { ruleId })
    const incidents = await client.api.listIncidents({ ciId: 'ci-aws-checkout-01' })
    const incident = incidents.items.find(row => row.id.startsWith('w4-infra-incident-'))
    expect(incident).toMatchObject({ ciId: 'ci-aws-checkout-01', ruleId, ruleRevision: 1, state: 'open' })
    expect(await client.api.getIncident(incident!.id)).toEqual(incident)
    const delivery = (await client.api.listNotificationDeliveries({ ruleId })).items[0]
    expect(delivery).toMatchObject({ incidentId: incident!.id, channelRef: 'demo-ops', status: 'queued' })
    await client.api.advanceClock(1)
    expect((await client.api.getNotificationDelivery(delivery.id)).status).toBe('delivered')
    await client.api.setPersona('user-rd-commerce')
    await denied(await raw(`/incidents/${incident!.id}`), 404)
    await denied(await raw(`/alert-rules/${ruleId}`), 404)
  })

  it('keeps W4 runtime manifest aligned with every published operation descriptor', () => {
    const expected = operations.filter(operation => operation.milestone === 'W4').map(({ method, path, status, demo, milestone }) => ({ method, path, status, demo: Boolean(demo), milestone }))
    expect(runtimeOperations.filter(operation => operation.milestone === 'W4')).toEqual(expected)
    expect(expected).toHaveLength(34)
  })
})

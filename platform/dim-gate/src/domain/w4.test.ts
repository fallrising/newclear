import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { createEngine } from './engine'
import { integrityErrors, legacyV3IntegrityErrors } from './integrity'
import { legacySnapshotV3Schema, type Snapshot } from './schemas'
import { monitoringNow } from './monitoring'

function seed(): Snapshot {
  return createSeed('w4-domain-test')
}
function harness(initial = seed()) {
  let sequence = 0
  const engine = createEngine(initial, () => undefined)
  const command = (path: string, body: unknown, actorId = 'user-ops') => engine.command({ sessionId: initial.sessionId, actorId,
    method: 'POST', path, body, key: `w4-${++sequence}` })
  const action = (collection: string, id: string, actionName: string, actorId = 'user-ops') => command(`/${collection}/${id}/${actionName}`,
    { expectedVersion: (engine.read(`/${collection}/${id}`, new URLSearchParams(), actorId) as { version: number }).version,
      reason: 'Verify W4 canonical monitoring' }, actorId)
  const read = <T>(path: string, actorId = 'user-ops', query = '') => engine.read(path, new URLSearchParams(query), actorId) as T
  return { engine, command, action, read }
}
const infraMonitor = { target: { kind: 'infrastructure' as const, ciId: 'ci-idc-redis-01' }, source: 'demo-ci' as const,
  metrics: ['cpuUtilization' as const], sampleIntervalSeconds: 60, freshnessSeconds: 120, enabled: true }
const infraRule = (monitorPolicyId: string) => ({ monitorPolicyId, metric: 'cpuUtilization' as const, aggregation: 'last' as const,
  windowSeconds: 120, comparator: 'gt' as const, threshold: 0.8, unit: 'fraction' as const,
  requiredConsecutiveSamples: 2, severity: 'warning' as const, channelRef: 'demo-ops' as const, enabled: true })
async function activeInfra(h: ReturnType<typeof harness>) {
  const monitor = await h.command('/monitor-policies', { spec: infraMonitor, reason: 'Monitor CI' })
  await h.action('monitor-policies', monitor.entityId, 'validate')
  await h.action('monitor-policies', monitor.entityId, 'submit')
  await h.action('monitor-policies', monitor.entityId, 'activate')
  const rule = await h.command('/alert-rules', { spec: infraRule(monitor.entityId), reason: 'Alert CI' })
  await h.action('alert-rules', rule.entityId, 'validate')
  await h.action('alert-rules', rule.entityId, 'submit')
  await h.action('alert-rules', rule.entityId, 'activate')
  return { monitorId: monitor.entityId, ruleId: rule.entityId }
}

describe('W4 monitoring canonical domain', () => {
  it('keeps strict legacy v3 proof before additive migration and rejects corrupt v4 revision lineage', () => {
    const s = seed()
    const legacy = legacySnapshotV3Schema.parse({ ...s, schemaVersion: 3, seedVersion: 'dim-gate-w3-v1',
      entities: { ...Object.fromEntries(Object.entries(s.entities).filter(([name]) => !['infrastructureIncidents', 'monitorPolicies', 'alertRules', 'sloPolicies', 'silences', 'alertEvaluations', 'notificationDeliveries'].includes(name))),
        navigation: s.entities.navigation.filter(row => !['rd.monitoring', 'rd.alerts', 'ops.alerting'].includes(row.routeKey)) },
      observations: { buckets: s.observations.buckets, traces: s.observations.traces, logs: s.observations.logs, recoveries: s.observations.recoveries } })
    expect(legacyV3IntegrityErrors(legacy)).toEqual([])
    legacy.entities.placements[0].ciId = 'missing-ci'
    expect(legacyV3IntegrityErrors(legacy)).toContain('placement: invalid or invisible reference')
  })

  it('separates service RD threshold ownership from independent current Ops production approval', async () => {
    const h = harness()
    const spec = { target: { kind: 'service' as const, applicationId: 'app-checkout', environmentId: 'env-checkout-prod' },
      source: 'demo-red' as const, metrics: ['errorRate' as const], sampleIntervalSeconds: 60, freshnessSeconds: 120, enabled: true }
    await expect(h.command('/monitor-policies', { spec, reason: 'Ops cannot edit service threshold' })).rejects.toMatchObject({ status: 403 })
    const receipt = await h.command('/monitor-policies', { spec, reason: 'RD production monitoring' }, 'user-rd-commerce')
    await h.action('monitor-policies', receipt.entityId, 'validate', 'user-rd-commerce')
    await h.action('monitor-policies', receipt.entityId, 'submit', 'user-rd-commerce')
    await expect(h.action('monitor-policies', receipt.entityId, 'approve', 'user-rd-commerce')).rejects.toMatchObject({ status: 403 })
    await expect(h.action('monitor-policies', receipt.entityId, 'activate', 'user-rd-commerce')).rejects.toMatchObject({ status: 409 })
    await h.action('monitor-policies', receipt.entityId, 'approve')
    const approved = h.engine.getSnapshot()
    approved.entities.assignments = approved.entities.assignments.filter(a => !(a.userId === 'user-ops' && a.scopeId === 'project-store'))
    const revoked = harness(approved)
    await expect(revoked.action('monitor-policies', receipt.entityId, 'activate', 'user-rd-commerce')).rejects.toMatchObject({ status: 409 })
    await h.action('monitor-policies', receipt.entityId, 'activate', 'user-rd-commerce')
    expect(h.read<{ activeRevision: number }>(`/monitor-policies/${receipt.entityId}`, 'user-rd-commerce').activeRevision).toBe(1)
  })

  it('evaluates source-time CI samples into one scoped incident, durable evidence and observable queued/delivered statuses', async () => {
    const h = harness(), { ruleId } = await activeInfra(h)
    await h.command('/scenarios', { scenarioKey: 'alert-breach', ruleId })
    const snap = h.engine.getSnapshot()
    expect(snap.entities.alertEvaluations.map(x => x.id)).toEqual(['w4-evaluation-0001', 'w4-evaluation-0002'])
    expect(snap.entities.infrastructureIncidents).toHaveLength(1)
    const incident = snap.entities.infrastructureIncidents[0]
    expect(incident).toMatchObject({ ruleId, ruleRevision: 1, state: 'open', evidenceEvaluationIds: snap.entities.alertEvaluations.map(x => x.id) })
    expect(h.read<{ items: { id: string }[] }>('/incidents', 'user-ops', `ciId=${incident.ciId}`).items.map(x => x.id)).toContain(incident.id)
    expect(h.read<{ id: string }>(`/incidents/${incident.id}`).id).toBe(incident.id)
    expect(h.read<{ items: { entityId: string; action: string }[] }>('/audit', 'user-ops', `entityType=incident&entityId=${incident.id}`)
      .items.some(entry => entry.action === 'incident.opened')).toBe(true)
    expect(h.read<{ items: unknown[] }>('/audit', 'user-rd-commerce', `entityType=incident&entityId=${incident.id}`).items).toEqual([])
    await expect(h.command(`/incidents/${incident.id}/acknowledge`, { expectedVersion: incident.version }, 'user-rd-commerce')).rejects.toMatchObject({ status: 403 })
    await h.command(`/incidents/${incident.id}/acknowledge`, { expectedVersion: incident.version })
    expect(h.read<{ assigneeId: string }>(`/incidents/${incident.id}`).assigneeId).toBe('user-ops')
    expect(snap.entities.notificationDeliveries).toMatchObject([{ status: 'queued' }])
    await h.command('/clock/advance', { ticks: 1 })
    expect(h.engine.getSnapshot().entities.notificationDeliveries[0].status).toBe('delivered')
    expect(integrityErrors(h.engine.getSnapshot())).toEqual([])
    expect(() => createEngine(h.engine.getSnapshot(), () => undefined)).not.toThrow()
  })

  it('suppresses queued dispatch without changing incident/evidence, then restores future notification after expiry', async () => {
    const h = harness(), { ruleId } = await activeInfra(h)
    await h.command('/scenarios', { scenarioKey: 'alert-breach', ruleId })
    const before = h.engine.getSnapshot(), now = monitoringNow(before), until = new Date(Date.parse(now) + 120_000).toISOString()
    await h.command('/silences', { ruleId, startAt: now, expiresAt: until, reason: 'Bounded maintenance' })
    await h.command('/clock/advance', { ticks: 1 })
    let snap = h.engine.getSnapshot()
    expect(snap.entities.notificationDeliveries[0].status).toBe('suppressed')
    expect(snap.entities.infrastructureIncidents[0].evidenceEvaluationIds).toEqual(before.entities.infrastructureIncidents[0].evidenceEvaluationIds)
    await h.command('/clock/advance', { ticks: 60 })
    await h.command('/clock/advance', { ticks: 60 })
    await h.command('/scenarios', { scenarioKey: 'alert-breach', ruleId })
    snap = h.engine.getSnapshot()
    expect(snap.entities.infrastructureIncidents).toHaveLength(1)
    expect(snap.entities.notificationDeliveries.at(-1)?.status).toBe('queued')
    expect(integrityErrors(snap)).toEqual([])
  })

  it('pins evaluation to the active monitor revision and records deterministic failed delivery', async () => {
    const h = harness(), { monitorId, ruleId } = await activeInfra(h)
    const monitor = h.read<{ version: number }>(`/monitor-policies/${monitorId}`)
    await h.command(`/monitor-policies/${monitorId}/revise`, { expectedVersion: monitor.version, reason: 'Prepare a new freshness window',
      spec: { ...infraMonitor, freshnessSeconds: 600 } })
    await h.command('/scenarios', { scenarioKey: 'alert-delivery-failure', ruleId })
    const snapshot = h.engine.getSnapshot()
    expect(snapshot.entities.alertEvaluations.map(e => e.monitorRevision)).toEqual([1, 1])
    expect(snapshot.entities.notificationDeliveries).toMatchObject([{ status: 'queued' }])
    await h.command('/clock/advance', { ticks: 1 })
    expect(h.engine.getSnapshot().entities.notificationDeliveries).toMatchObject([{ status: 'failed', safeFailureCode: 'DEMO_DELIVERY_FAILURE' }])
    expect(integrityErrors(h.engine.getSnapshot())).toEqual([])
  })
})

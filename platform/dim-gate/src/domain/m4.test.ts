import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { createEngine } from './engine'
import { integrityErrors } from './integrity'
import { ingestObservationBucket, observationTime } from './observation'
import { guideViewSchema, metricsViewSchema, type DashboardView, type GuideView, type Incident, type Integration, type Notification, type ObservationBucket, type ObservationLog, type Page, type Release, type Snapshot, type Trace } from './schemas'

const rd = 'user-rd-commerce', ops = 'user-ops', admin = 'user-admin', data = 'user-rd-data'
function harness(initial = createSeed('m4-test'), persist: (s: Snapshot) => void = () => undefined) {
  let sequence = initial.sequence
  const engine = createEngine(initial, persist)
  const command = (path: string, body: unknown, actorId = rd, key = `m4-${++sequence}`, method = 'POST') => engine.command({ sessionId: initial.sessionId, actorId, path, body, key, method })
  const read = <T>(path: string, actorId = rd, query = '') => engine.read(path, new URLSearchParams(query), actorId) as T
  const env = (id = 'env-checkout-dev') => engine.getSnapshot().entities.environments.find(e => e.id === id)!
  const release = (id: string) => engine.getSnapshot().entities.releases.find(r => r.id === id)!
  const advance = (ticks = 6) => command('/clock/advance', { ticks }, ops)
  const trigger = (revision: string, id = 'env-checkout-dev', actor = rd) => command('/pipelines', { applicationId: env(id).applicationId, environmentId: id, revision, environmentVersion: env(id).version }, actor)
  const success = async (revision: string, id = 'env-checkout-dev', actor = rd) => {
    const result = await trigger(revision, id, actor); await advance(); return release(engine.getSnapshot().entities.pipelines.find(r => r.id === result.entityId)!.releaseId!)
  }
  const scenario = (scenarioKey = 'post-release-latency', environmentId = 'env-checkout-dev', actor = rd, key?: string) => command('/scenarios', { scenarioKey, environmentId }, actor, key)
  const incident = (id = 'env-checkout-dev') => engine.getSnapshot().entities.incidents.find(i => i.environmentId === id)!
  const rollback = (current: Release, target: Release) => command(`/releases/${current.id}/rollback`, { expectedVersion: current.version, targetReleaseId: target.id, environmentVersion: env(current.environmentId).version, reason: 'Restore a tested stable artifact' })
  const window = (id = 'env-checkout-dev', extra = '') => `applicationId=${env(id).applicationId}&environmentId=${id}&from=2026-09-20T09:00:00Z&to=2026-09-20T10:00:00Z${extra ? `&${extra}` : ''}`
  return { engine, command, read, env, release, advance, trigger, success, scenario, incident, rollback, window }
}
const sample = (s: Snapshot, values: Partial<Pick<ObservationBucket, 'p95Latency' | 'errorRate' | 'rate'>> = {}, gap = 0) => {
  const from = s.logicalClock + gap; s.logicalClock = from + 60
  return ingestObservationBucket(s, { id: `test-${from}`, applicationId: 'app-checkout', environmentId: 'env-checkout-dev',
    releaseId: s.entities.environments.find(e => e.id === 'env-checkout-dev')!.activeReleaseId ?? undefined,
    from: observationTime(from), to: observationTime(s.logicalClock), rate: 80, p95Latency: 900, errorRate: 0.08, source: 'demo', ...values })
}

describe('M4 observation, incident and recovery domain', () => {
  it('seed has no telemetry, releases or incidents; unknown observations do not become zero', () => {
    const h = harness(), empty = h.read('/observability/metrics', rd, h.window())
    expect(metricsViewSchema.parse(empty).series.map(s => [s.metric, s.unit, s.points, s.sampleCount])).toEqual([
      ['rate', 'requests/second', [], 0], ['errorRate', 'fraction', [], 0], ['p95Latency', 'ms', [], 0],
    ])
    expect(h.engine.getSnapshot().entities.releases).toEqual([])
    expect(h.read<Page<Incident>>('/incidents').total).toBe(0)
    const s = h.engine.getSnapshot(); sample(s, { p95Latency: null, errorRate: null, rate: null })
    const unknown = metricsViewSchema.parse(harness(s).read('/observability/metrics', rd, h.window()))
    expect(unknown.series.every(series => series.sampleCount === 0 && series.points[0].value === null)).toBe(true)
    expect(h.read<Integration[]>('/integrations', admin)).toHaveLength(5)
    expect(guideViewSchema.safeParse(h.read('/guide')).success).toBe(true)
  })

  it.each(['null', 'gap', 'threshold'] as const)('requires three adjacent breached minutes across %s interruption', kind => {
    const s = createSeed('m4-test'); sample(s); sample(s)
    if (kind === 'null') sample(s, { p95Latency: null, errorRate: null })
    if (kind === 'threshold') sample(s, { p95Latency: 500, errorRate: 0.05 })
    sample(s, { p95Latency: 501, errorRate: 0.01 }, kind === 'gap' ? 1 : 0)
    expect(s.entities.incidents).toEqual([])
    sample(s, { p95Latency: 100, errorRate: 0.051 }); expect(s.entities.incidents).toEqual([])
    sample(s, { p95Latency: 900, errorRate: null })
    expect(s.entities.incidents).toHaveLength(1)
    expect(s.entities.incidents[0].evidence.map(e => e.metric)).toEqual(['p95Latency', 'errorRate', 'p95Latency'])
    expect(integrityErrors(s)).toEqual([])
  })

  it('scenario uses actual consecutive windows and advances other work atomically without exposing hidden IDs', async () => {
    const h = harness(); const active = await h.success('stable')
    const hidden = await h.trigger('private-data-build', 'env-data-dev', data)
    const beforeClock = h.engine.getSnapshot().logicalClock
    const receipt = await h.scenario(undefined, undefined, rd, 'one-anomaly')
    const s = h.engine.getSnapshot()
    expect(s.logicalClock).toBe(beforeClock + 180)
    expect(s.entities.pipelines.find(r => r.id === hidden.entityId)?.state).toBe('succeeded')
    expect(JSON.stringify(receipt)).not.toContain(hidden.entityId)
    expect(receipt.changed).toEqual([{ entityType: 'environment', entityId: 'env-checkout-dev' }])
    expect(s.observations.buckets.map(b => [b.from, b.to])).toEqual([0, 60, 120].map(offset => [observationTime(beforeClock + offset), observationTime(beforeClock + offset + 60)]))
    const incident = h.incident()
    expect(incident).toMatchObject({ state: 'open', episode: 1, relatedReleaseId: active.id, recoverySamples: 0 })
    expect(incident.evidence).toHaveLength(6)
    const trace = h.read<Trace>(`/observability/traces/${incident.evidence[0].traceIds[0]}`)
    expect(trace).toMatchObject({ applicationId: active.applicationId, environmentId: active.environmentId, releaseId: active.id })
    const logs = h.read<Page<ObservationLog>>('/observability/logs', rd, h.window(undefined, `traceId=${trace.id}`))
    expect(logs.items).toHaveLength(1); expect(logs.items[0].releaseId).toBe(active.id)
    const again = await h.scenario(undefined, undefined, rd, 'one-anomaly')
    expect(again).toEqual(receipt); expect(h.engine.getSnapshot()).toEqual(s)
    await h.scenario()
    expect(h.incident().id).toBe(incident.id); expect(h.incident().evidence).toHaveLength(12)
    expect(h.engine.getSnapshot().entities.incidents).toHaveLength(1)
  })

  it('Ops acknowledge/investigate/takeover are versioned, reasoned, audited and reauthorize replays', async () => {
    const h = harness(); await h.success('stable'); await h.scenario()
    const original = h.incident(), path = `/incidents/${original.id}`
    await expect(h.command(`${path}/acknowledge`, { expectedVersion: original.version }, rd)).rejects.toMatchObject({ status: 403 })
    await expect(h.command(`${path}/acknowledge`, { expectedVersion: original.version }, admin)).rejects.toMatchObject({ status: 403 })
    await expect(h.command(`${path}/investigate`, { expectedVersion: original.version, reason: 'Start early' }, ops)).rejects.toMatchObject({ code: 'INVALID_STATE' })
    const body = { expectedVersion: original.version, reason: 'Own response' }
    const receipt = await h.command(`${path}/acknowledge`, body, ops, 'ack-retry')
    expect(h.incident()).toMatchObject({ state: 'acknowledged', assigneeId: ops })
    await expect(h.command(`${path}/investigate`, { expectedVersion: original.version, reason: 'Stale' }, ops)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    await expect(h.command(`${path}/investigate`, { expectedVersion: h.incident().version, reason: ' ' }, ops)).rejects.toMatchObject({ status: 422 })
    await h.command(`${path}/investigate`, { expectedVersion: h.incident().version, reason: 'Check correlation' }, ops)
    expect(await h.command(`${path}/acknowledge`, body, ops, 'ack-retry')).toEqual(receipt)
    const s = h.engine.getSnapshot()
    s.entities.assignments.push({ ...s.entities.assignments.find(a => a.id === 'grant-ops-store')!, id: 'other-ops', userId: data })
    const other = harness(s)
    await other.command(`${path}/investigate`, { expectedVersion: other.incident().version, reason: 'Take over response' }, data)
    expect(other.incident().assigneeId).toBe(data)
    expect(other.read<Page<{ reason: string }>>('/audit', data, `entityId=${original.id}`).items.some(a => a.reason === 'Take over response')).toBe(true)
    await h.command('/admin/assignments/grant-ops-store', { expectedVersion: 1, reason: 'Revoke scope' }, admin, 'revoke', 'DELETE')
    await expect(h.command(`${path}/acknowledge`, body, ops, 'ack-retry')).rejects.toMatchObject({ status: 404 })
  })

  it('successful rollback emits one future minute sample at60/120/180ticks and restores across reload', async () => {
    const h = harness(), stable = await h.success('stable'), bad = await h.success('candidate')
    await h.scenario(); const evidence = h.incident().evidence
    const rollback = await h.rollback(bad, stable); await h.advance(3)
    expect(h.env().activeReleaseId).toBe(rollback.entityId)
    expect(h.incident()).toMatchObject({ state: 'open', recoverySamples: 0 })
    expect(h.engine.getSnapshot().observations.recoveries).toMatchObject([{ remaining: 3, dueTick: h.engine.getSnapshot().logicalClock + 60 }])
    await h.advance(59); expect(h.incident().recoverySamples).toBe(0)
    await h.advance(1); expect(h.incident()).toMatchObject({ state: 'open', recoverySamples: 1 })
    const restored = harness(h.engine.getSnapshot()); await restored.advance(60)
    expect(restored.incident()).toMatchObject({ state: 'open', recoverySamples: 2 })
    await restored.advance(60)
    expect(restored.incident()).toMatchObject({ state: 'resolved', recoverySamples: 3 })
    expect(restored.incident().evidence).toEqual(evidence)
    expect(restored.engine.getSnapshot().observations.recoveries).toEqual([])
    expect(integrityErrors(restored.engine.getSnapshot())).toEqual([])
    await restored.scenario()
    expect(restored.incident()).toMatchObject({ id: h.incident().id, state: 'open', episode: 2, recoverySamples: 0, relatedReleaseId: rollback.entityId })
    expect(restored.incident().evidence).toHaveLength(12)
  })

  it.each([1, 2])('new successful release cancels obsolete rollback recovery after %i samples', async count => {
    const h = harness(), stable = await h.success('stable'), bad = await h.success('candidate')
    await h.scenario(); await h.rollback(bad, stable); await h.advance(3)
    for (let index = 0; index < count; index += 1) await h.advance(60)
    expect(h.incident().recoverySamples).toBe(count)
    const latest = await h.success('superseding-release')
    expect(h.env().activeReleaseId).toBe(latest.id)
    expect(h.incident()).toMatchObject({ state: 'open', recoverySamples: 0 })
    expect(h.engine.getSnapshot().observations.recoveries).toEqual([])
    const restored = harness(h.engine.getSnapshot()); await restored.advance(60); await restored.advance(60); await restored.advance(60)
    expect(restored.incident().state).toBe('open')
    expect(restored.engine.getSnapshot().observations.buckets).toHaveLength(3 + count)
  })

  it('new abnormal scenario cancels recovery and failed rollback never schedules healthy evidence', async () => {
    const h = harness(), stable = await h.success('stable'), bad = await h.success('candidate')
    await h.scenario(); const failed = await h.rollback(bad, stable)
    await h.command('/scenarios', { scenarioKey: 'rollback-failure', releaseId: failed.entityId }); await h.advance(3)
    expect(h.env().activeReleaseId).toBe(bad.id)
    expect(h.engine.getSnapshot().observations.recoveries).toEqual([])
    await h.advance(60); expect(h.incident().recoverySamples).toBe(0)
    await h.rollback(bad, stable); await h.advance(3); await h.advance(60)
    await h.scenario()
    expect(h.incident()).toMatchObject({ state: 'open', recoverySamples: 0, episode: 1 })
    expect(h.engine.getSnapshot().observations.recoveries).toEqual([])
    await h.advance(60); expect(h.incident().state).toBe('open')
  })

  it('explicit fallback passes through three healthy minute windows and cannot recover from gaps or nulls', async () => {
    const h = harness(); await h.success('only-version'); await h.scenario()
    const original = h.incident(); const before = h.engine.getSnapshot().logicalClock
    await h.scenario('recovery-samples')
    expect(h.engine.getSnapshot().logicalClock).toBe(before + 180)
    expect(h.incident()).toMatchObject({ id: original.id, state: 'resolved', recoverySamples: 3 })
    expect(h.incident().evidence).toEqual(original.evidence)
    const resolved = h.engine.getSnapshot(); sample(resolved)
    expect(resolved.entities.incidents[0].state).toBe('resolved')
    expect(integrityErrors(resolved)).toEqual([])
    sample(resolved); expect(integrityErrors(resolved)).toEqual([])
    sample(resolved); expect(resolved.entities.incidents[0].episode).toBe(2)
    const normal = { p95Latency: 120, errorRate: 0.002 }
    sample(resolved, normal); sample(resolved, normal)
    sample(resolved, { p95Latency: null, errorRate: 0.002 }); expect(resolved.entities.incidents[0].recoverySamples).toBe(0)
    sample(resolved, normal); sample(resolved, normal, 1); expect(resolved.entities.incidents[0].recoverySamples).toBe(1)
    expect(integrityErrors(resolved)).toEqual([])
  })

  it('current scope, stage and raw-data grants protect detail/list/audit/search/Guide/notification/dashboard projections', async () => {
    const h = harness(); await h.success('private-data-build', 'env-data-dev', data); await h.scenario(undefined, 'env-data-dev', data)
    const hidden = h.incident('env-data-dev')
    expect(h.read<Page<Incident>>('/incidents').total).toBe(0)
    expect(() => h.read(`/incidents/${hidden.id}`)).toThrow(expect.objectContaining({ status: 404 }))
    expect(() => h.read('/observability/metrics', rd, h.window('env-data-dev'))).toThrow(expect.objectContaining({ status: 404 }))
    expect(h.read<{ items: unknown[] }>('/search', rd, `q=${hidden.id}`).items).toEqual([])
    expect(h.read<Page<unknown>>('/audit', rd, `entityId=${hidden.id}`).total).toBe(0)
    expect(h.read<{ items: Notification[] }>('/notifications').items).toEqual([])
    expect(h.read<DashboardView>('/dashboard', rd, 'center=rd').activeIncidentCount).toBe(0)
    expect(h.read<GuideView>('/guide').steps.every(s => !s.completed)).toBe(true)
    await h.success('visible'); await h.scenario()
    const visible = h.incident(), safe = h.read<Incident>(`/incidents/${visible.id}`, admin)
    expect(safe.evidence.every(e => !e.traceIds.length && !e.logIds.length)).toBe(true)
    expect(() => h.read(`/observability/traces/${visible.evidence[0].traceIds[0]}`, admin)).toThrow(expect.objectContaining({ status: 404 }))
    for (const endpoint of ['traces', 'logs']) expect(() => h.read(`/observability/${endpoint}`, admin, h.window())).toThrow(expect.objectContaining({ status: 404 }))
    expect(metricsViewSchema.parse(h.read('/observability/metrics', admin, h.window())).series[0].sampleCount).toBe(3)
    const s = h.engine.getSnapshot(); s.entities.assignments.filter(g => g.userId === rd).forEach(g => { g.stages = ['prod'] })
    const restricted = harness(s)
    expect(restricted.read<Page<Incident>>('/incidents').total).toBe(0)
    expect(restricted.read<{ items: Notification[] }>('/notifications').items).toEqual([])
    expect(restricted.read<DashboardView>('/dashboard', rd, 'center=rd').activeIncidentCount).toBe(0)
    expect(restricted.read<GuideView>('/guide').steps.every(step => !step.completed)).toBe(true)
    expect(JSON.stringify(restricted.read('/audit'))).not.toContain(visible.id)
    expect(restricted.read<Page<Incident>>('/incidents', rd, 'environmentId=env-checkout-dev').total).toBe(0)
  })

  it('integration visibility uses pool scopes; demo test is admin-only, versioned and replay-safe', async () => {
    const h = harness()
    expect(() => h.read('/integrations')).toThrow(expect.objectContaining({ status: 403 }))
    const integration = h.read<Integration[]>('/integrations', admin)[0]
    await expect(h.command(`/integrations/${integration.id}/test`, { expectedVersion: 1 }, ops)).rejects.toMatchObject({ status: 403 })
    const result = await h.command(`/integrations/${integration.id}/test`, { expectedVersion: 1 }, admin, 'integration-retry')
    expect(h.read<Integration[]>('/integrations', admin).find(i => i.id === integration.id)?.lastTestResult).toMatchObject({ demo: true, succeeded: true })
    expect(await h.command(`/integrations/${integration.id}/test`, { expectedVersion: 1 }, admin, 'integration-retry')).toEqual(result)
    await expect(h.command(`/integrations/${integration.id}/test`, { expectedVersion: 1 }, admin)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    const s = h.engine.getSnapshot(); s.entities.assignments = s.entities.assignments.filter(g => g.userId !== ops || g.scopeType !== 'pool' || g.scopeId === 'pool-aws-sg')
    const scopedHarness = harness(s), scoped = scopedHarness.read<Integration[]>('/integrations', ops)
    expect(scoped).toHaveLength(3); expect(scoped.every(i => i.poolIds.join() === 'pool-aws-sg')).toBe(true)
    await scopedHarness.command('/integrations/integration-delivery/test', { expectedVersion: 1 }, admin)
    const audit = scopedHarness.read<Page<{ scopeSnapshot: { poolIds: string[] } }>>('/audit', ops, 'entityType=integration')
    expect(audit.items.every(entry => entry.scopeSnapshot.poolIds.every(id => id === 'pool-aws-sg'))).toBe(true)
  })

  it('strict query and target validation reject invalid/duplicate/unrelated fields without mutation', async () => {
    const h = harness(), before = h.engine.getSnapshot()
    await expect(h.scenario()).rejects.toMatchObject({ code: 'INVALID_STATE' })
    for (const body of [ { scenarioKey: 'post-release-latency' }, { scenarioKey: 'post-release-latency', environmentId: 'env-checkout-dev', releaseId: 'anything' },
      { scenarioKey: 'capacity-exhausted', poolId: 'pool-aws-sg', environmentId: 'env-checkout-dev' } ]) await expect(h.command('/scenarios', body, ops)).rejects.toMatchObject({ status: 422 })
    expect(h.engine.getSnapshot()).toEqual(before)
    await h.success('stable')
    await expect(h.scenario('recovery-samples')).rejects.toMatchObject({ code: 'INVALID_STATE' })
    const busy = await h.trigger('busy'); await expect(h.scenario()).rejects.toMatchObject({ code: 'ENVIRONMENT_BUSY' })
    await expect(h.command('/scenarios', { scenarioKey: 'build-failure', runId: busy.entityId, environmentId: 'env-checkout-dev' })).rejects.toMatchObject({ status: 422 })
    const base = h.window()
    for (const query of [base + '&step=1s', base + '&step=60s&step=60s', base + '&unexpected=1', base.replace('10:00:00Z', '09:00:00Z'), base.replace('2026-09-20T10', '2026-09-22T10')]) {
      expect(() => h.read('/observability/metrics', rd, query)).toThrow(expect.objectContaining({ status: 422 }))
    }
    for (const query of ['state=unknown', 'page=0', 'pageSize=101', 'q=a&q=b', 'sort=name']) expect(() => h.read('/incidents', rd, query)).toThrow(expect.objectContaining({ status: 422 }))
    expect(() => h.read('/observability/metrics', rd, base.replace('app-checkout', 'app-data'))).toThrow(expect.objectContaining({ status: 404 }))
  })

  it('persistence failures roll back telemetry, parallel operations, sequence, clocks, audit and replay together', async () => {
    let reject = false
    const h = harness(createSeed('m4-test'), () => { if (reject) throw new Error('quota') })
    await h.success('stable'); await h.trigger('private', 'env-data-dev', data)
    const before = h.engine.getSnapshot(); reject = true
    await expect(h.scenario(undefined, undefined, rd, 'persist-retry')).rejects.toMatchObject({ status: 507 })
    expect(h.engine.getSnapshot()).toEqual(before)
    reject = false; await h.scenario(undefined, undefined, rd, 'persist-retry')
    expect(h.engine.getSnapshot().entities.incidents).toHaveLength(1)
    const stable = h.release(h.env().activeReleaseId!), candidate = await h.success('candidate')
    await h.scenario(); await h.rollback(candidate, stable); await h.advance(3); await h.advance(59)
    const beforeRecovery = h.engine.getSnapshot(); reject = true
    await expect(h.advance(1)).rejects.toMatchObject({ status: 507 }); expect(h.engine.getSnapshot()).toEqual(beforeRecovery)
    reject = false; await h.advance(1); expect(h.incident().recoverySamples).toBe(1)
  })

  it('rejects corrupt observation references, evidence, windows, trace parents and recovery tasks on restore', async () => {
    const h = harness(), stable = await h.success('stable'), bad = await h.success('candidate')
    await h.scenario(); await h.rollback(bad, stable); await h.advance(3); await h.advance(60)
    const corruptions: ((s: Snapshot) => void)[] = [
      s => { s.observations.buckets[0].to = s.observations.buckets[0].from },
      s => { s.observations.buckets[0].applicationId = 'app-data' },
      s => { s.observations.traces[0].spans[1].parentId = 'absent' },
      s => { s.observations.logs[0].traceId = 'absent' },
      s => { s.entities.incidents[0].evidence[0].traceIds = ['absent'] },
      s => { s.entities.incidents[0].evidence[0].threshold = 9999 },
      s => { s.entities.incidents[0].recoverySamples = 3; s.entities.incidents[0].state = 'resolved' },
      s => { s.observations.recoveries[0].dueTick += 1 },
      s => { s.observations.recoveries = [] },
      s => { s.observations.recoveries[0].remaining = 3 },
      s => { s.observations.recoveries[0].releaseId = bad.id },
      s => { s.observations.recoveries.push({ ...s.observations.recoveries[0] }) },
      s => { s.entities.integrations[0].poolIds = ['missing'] },
    ]
    for (const corrupt of corruptions) {
      const s = h.engine.getSnapshot(); corrupt(s)
      expect(() => harness(s)).toThrow(expect.objectContaining({ code: 'INVALID_SNAPSHOT' }))
    }
    expect(integrityErrors(h.engine.getSnapshot())).toEqual([])
  })

  it('filters CI references independently from visible trace/log/incident scope and supports explicit Admin raw grants', async () => {
    const h = harness(); await h.success('stable'); await h.scenario()
    const s = h.engine.getSnapshot(), hiddenCi = s.entities.cis.find(ci => ci.visibilityProjectIds.includes('project-data') && !ci.visibilityProjectIds.includes('project-store'))!
    s.observations.traces[0].spans[0].ciId = hiddenCi.id
    s.observations.logs[0].ciId = hiddenCi.id
    s.entities.incidents[0].affectedCiIds.push(hiddenCi.id)
    const scoped = harness(s), incident = scoped.incident()
    expect(scoped.read<Incident>(`/incidents/${incident.id}`).affectedCiIds).not.toContain(hiddenCi.id)
    expect(scoped.read<Trace>(`/observability/traces/${s.observations.traces[0].id}`).spans[0].ciId).toBeUndefined()
    expect(scoped.read<Page<ObservationLog>>('/observability/logs', rd, scoped.window()).items[0].ciId).toBeUndefined()
    s.entities.assignments.push({ ...s.entities.assignments.find(g => g.id === 'grant-rd-commerce')!, id: 'admin-explicit-rd', userId: admin })
    const dual = harness(s)
    expect(dual.read<Trace>(`/observability/traces/${s.observations.traces[0].id}`, admin).spans).toHaveLength(2)
    expect(dual.read<Incident>(`/incidents/${incident.id}`, admin).evidence[0].traceIds).not.toEqual([])
  })

  it('keeps Guide completion on one visible request/environment chain and notifications resolve in current role', async () => {
    const h = harness(); await h.success('unrelated-stable'); await h.success('unrelated-second'); await h.scenario()
    const request = await h.command('/requests', { applicationId: 'app-storefront', environmentName: 'guided-staging', stage: 'staging', catalogItemId: 'catalog-web', catalogRevision: 1,
      provider: 'aliyun', poolId: 'pool-aliyun-sg', cpu: 2, memoryMiB: 2048, purpose: 'Provider-selectable guide' })
    const getRequest = () => h.engine.getSnapshot().entities.requests.find(r => r.id === request.entityId)!
    await h.command(`/requests/${request.entityId}/submit`, { expectedVersion: getRequest().version })
    let guide = h.read<GuideView>('/guide')
    expect(guide.applicationId).toBe('app-storefront'); expect(guide.environmentId).toBeNull()
    expect(guide.steps.filter(step => step.completed).map(step => step.id)).toEqual(['request'])
    expect(h.read<{ items: Notification[] }>('/notifications', ops).items.some(n => n.route === `/ops/requests/${request.entityId}`)).toBe(true)
    await h.command(`/requests/${request.entityId}/approve`, { expectedVersion: getRequest().version, reason: 'Approve guide' }, ops)
    await h.command(`/requests/${request.entityId}/provision`, { expectedVersion: getRequest().version }, ops); await h.advance(5)
    guide = h.read<GuideView>('/guide')
    expect(guide.environmentId).toBe(getRequest().environmentId)
    expect(guide.steps.filter(step => step.completed).map(step => step.id)).toEqual(['request', 'provision'])
    expect(h.read<{ items: Notification[] }>('/notifications', rd).items.some(n => n.entityType === 'request' && n.route === `/rd/requests/${request.entityId}`)).toBe(true)
    const envId = getRequest().environmentId!, stable = await h.success('guided-stable', envId), bad = await h.success('guided-bad', envId)
    await h.scenario(undefined, envId)
    const incident = () => h.incident(envId)
    await h.command(`/incidents/${incident().id}/acknowledge`, { expectedVersion: incident().version }, ops)
    await h.command(`/incidents/${incident().id}/investigate`, { expectedVersion: incident().version, reason: 'Investigate same chain' }, ops)
    await h.rollback(bad, stable); await h.advance(3); await h.advance(60); await h.advance(60); await h.advance(60)
    guide = h.read<GuideView>('/guide')
    expect(guide.steps.every(step => step.completed)).toBe(true)
    expect(guide.steps.every(step => !step.route?.includes('env-checkout-dev'))).toBe(true)
    expect(h.read<{ items: Notification[] }>('/notifications').items.length).toBeLessThanOrEqual(20)
    expect(h.read<DashboardView>('/dashboard', rd, `center=rd&environmentId=${envId}`).activeIncidentCount).toBe(0)
    expect(h.read<DashboardView>('/dashboard', rd, 'center=rd&environmentId=env-checkout-dev').activeIncidentCount).toBe(1)
  })

  it('stable time sorting, filtering and pagination preserve totals and never duplicate adjacent pages', async () => {
    const h = harness(); await h.success('stable'); await h.scenario(); await h.scenario('recovery-samples')
    const first = h.read<Page<Trace>>('/observability/traces', rd, h.window(undefined, 'sort=durationMs&order=desc&pageSize=2&page=1'))
    const second = h.read<Page<Trace>>('/observability/traces', rd, h.window(undefined, 'sort=durationMs&order=desc&pageSize=2&page=2'))
    expect(first.total).toBe(6); expect(second.total).toBe(6)
    expect(new Set([...first.items, ...second.items].map(t => t.id)).size).toBe(4)
    expect(first.items.every(t => t.durationMs === 900)).toBe(true)
    const errors = h.read<Page<ObservationLog>>('/observability/logs', rd, h.window(undefined, 'level=error'))
    expect(errors.total).toBe(3)
    const empty = h.read<Page<ObservationLog>>('/observability/logs', rd, h.window(undefined, 'page=999'))
    expect(empty.total).toBe(6); expect(empty.items).toEqual([])
    expect(h.read<Page<Incident>>('/incidents', rd, 'state=resolved&pageSize=1').total).toBe(1)
  })

})

import type { AlertRule, AlertEvaluation, CommandReceipt, InfrastructureMetric, MonitorPolicy, MonitoringTarget, ObservationBucket, Snapshot } from './schema-models'
import { activeSpec, monitoringNow, targetScope } from './monitoring'
import { fail } from './engine-shared'
import { ingestObservationBucket } from './observation-commands'
import { dispatchNotification } from './notification-dispatch'

const ref = (entityType: string, entityId: string) => ({ entityType, entityId })
const sameTarget = (left: MonitoringTarget, right: MonitoringTarget) => JSON.stringify(left) === JSON.stringify(right)
const compare = (value: number, threshold: number, op: AlertRule['spec']['comparator']) =>
  op === 'gt' ? value > threshold : op === 'gte' ? value >= threshold : op === 'lt' ? value < threshold : value <= threshold
function source(rule: AlertRule, s: Snapshot): { monitor: MonitorPolicy; monitorSpec: MonitorPolicy['spec']; spec: AlertRule['spec']; target: MonitoringTarget } | undefined {
  const spec = activeSpec(rule)
  const monitor = s.entities.monitorPolicies.find(m => m.id === spec?.monitorPolicyId && m.orgId === rule.orgId)
  const monitorSpec = monitor && activeSpec(monitor)
  if (!spec?.enabled || !monitorSpec?.enabled) return undefined
  return { monitor: monitor!, monitorSpec, spec, target: monitorSpec.target }
}
function recordEvent(s: Snapshot, type: string, entityType: string, entityId: string, correlationId: string, target: MonitoringTarget) {
  const scope = targetScope(s, target)!
  s.sequence += 1
  const serial = String(s.sequence).padStart(4, '0'), now = monitoringNow(s)
  s.events.push({ eventId: `event-${serial}`, type, entities: [ref(entityType, entityId)], occurredAt: now, correlationId })
  s.audit.push({ id: `audit-${serial}`, orgId: scope.orgId, actorId: 'demo-scheduler', action: type, entityType, entityId,
    scopeSnapshot: { projectIds: scope.projectId ? [scope.projectId] : [], poolIds: scope.poolId ? [scope.poolId] : [], stages: scope.stage ? [scope.stage] : [] },
    outcome: 'succeeded', diffSummary: [type], requestId: `scheduler-${serial}`, correlationId, occurredAt: now })
}
type Sample = { id: string; target: MonitoringTarget; source: 'demo-red' | 'demo-ci'; metric: AlertRule['spec']['metric']; sourceTime: string; from: string; to: string; value: number | null }
function latestEvaluation(s: Snapshot, ruleId: string, revision: number) {
  return s.entities.alertEvaluations.filter(e => e.ruleId === ruleId && e.ruleRevision === revision)
    .toSorted((a, b) => a.sourceTime.localeCompare(b.sourceTime) || a.id.localeCompare(b.id)).at(-1)
}
function evidenceFor(s: Snapshot, evaluation: AlertEvaluation, rule: AlertRule, spec: AlertRule['spec']) {
  const bucket = s.observations.buckets.find(b => b.id === evaluation.sampleId)
  if (!bucket) return undefined
  const inWindow = (value: string) => Date.parse(value) >= Date.parse(bucket.from) && Date.parse(value) < Date.parse(bucket.to)
  return { ruleKey: rule.id, ruleRevision: evaluation.ruleRevision, sampleId: evaluation.sampleId, value: evaluation.value!,
    metric: spec.metric as 'rate' | 'errorRate' | 'p95Latency', threshold: spec.threshold, sampleWindow: { from: bucket.from, to: bucket.to },
    traceIds: s.observations.traces.filter(t => t.environmentId === bucket.environmentId && inWindow(t.start)).map(t => t.id),
    logIds: s.observations.logs.filter(l => l.environmentId === bucket.environmentId && inWindow(l.occurredAt)).map(l => l.id) }
}
function incidentFor(s: Snapshot, rule: AlertRule, target: MonitoringTarget, revision: number) {
  if (target.kind === 'service') {
    const environmentId = target.environmentId
    return s.entities.incidents.find(i => i.ruleId === rule.id && i.ruleRevision === revision && i.environmentId === environmentId)
  }
  const ciId = target.ciId
  return s.entities.infrastructureIncidents.find(i => i.ruleId === rule.id && i.ruleRevision === revision && i.ciId === ciId)
}
function notify(s: Snapshot, rule: AlertRule, spec: AlertRule['spec'], target: MonitoringTarget, incidentId: string, evaluation: AlertEvaluation) {
  const now = monitoringNow(s), activeSilence = s.entities.silences.some(x => x.ruleId === rule.id && x.ruleRevision === evaluation.ruleRevision
    && sameTarget(x.target, target) && x.startAt <= now && now < x.expiresAt)
  const id = `w4-delivery-${String(s.sequence + 1).padStart(4, '0')}`
  const status = activeSilence ? 'suppressed' as const : 'queued' as const
  s.entities.notificationDeliveries.push({ id, orgId: rule.orgId, version: 1, createdAt: now, updatedAt: now,
    ruleId: rule.id, ruleRevision: evaluation.ruleRevision, incidentId, target, channelRef: spec.channelRef,
    recipientType: target.kind === 'service' ? 'rd' : 'ops', status, occurredAt: now, correlationId: evaluation.correlationId })
  recordEvent(s, `notification.${status}`, 'notificationDelivery', id, evaluation.correlationId, target)
  if (status === 'suppressed') dispatchNotification(s, s.entities.notificationDeliveries.at(-1)!)
}
/** Persisted source-time evaluation. Unknown/stale/gaps reset the streak; only a qualifying fresh breach opens an episode. */
export function ingestMonitoringSample(s: Snapshot, sample: Sample): CommandReceipt['changed'] {
  const changed: CommandReceipt['changed'] = []
  for (const rule of s.entities.alertRules) {
    const active = source(rule, s)
    if (!active || !sameTarget(active.target, sample.target) || active.spec.metric !== sample.metric || active.monitorSpec.source !== sample.source) continue
    const prior = latestEvaluation(s, rule.id, rule.activeRevision!)
    if (prior && sample.sourceTime <= prior.sourceTime) fail(422, 'VALIDATION_ERROR', '監控樣本 source-time 不可倒退或重複。')
    const now = Date.parse(monitoringNow(s)), sourceTime = Date.parse(sample.sourceTime)
    const fresh = sourceTime <= now && now - sourceTime <= active.monitorSpec.freshnessSeconds * 1000
    const contiguous = !prior || prior.monitorRevision === active.monitor.activeRevision
      && sourceTime - Date.parse(prior.sourceTime) === active.monitorSpec.sampleIntervalSeconds * 1000
    const known = sample.value !== null && fresh && contiguous
    const candidates = s.entities.alertEvaluations.filter(e => e.ruleId === rule.id && e.ruleRevision === rule.activeRevision
      && e.monitorRevision === active.monitor.activeRevision
      && Date.parse(e.sourceTime) >= sourceTime - active.spec.windowSeconds * 1000)
      .toSorted((a, b) => b.sourceTime.localeCompare(a.sourceTime) || b.id.localeCompare(a.id))
    const suffix: number[] = []
    let expectedTime = sourceTime - active.monitorSpec.sampleIntervalSeconds * 1000
    for (const previous of candidates) {
      if (Date.parse(previous.sourceTime) !== expectedTime || previous.freshness !== 'fresh' || previous.sampleValue === null) break
      suffix.unshift(previous.sampleValue)
      expectedTime -= active.monitorSpec.sampleIntervalSeconds * 1000
    }
    const values = known ? [...suffix, sample.value!] : []
    const aggregated = values.length ? active.spec.aggregation === 'avg' ? values.reduce((a, b) => a + b, 0) / values.length
      : active.spec.aggregation === 'max' ? Math.max(...values) : values.at(-1)! : null
    const breached = known && aggregated !== null ? compare(aggregated, active.spec.threshold, active.spec.comparator) : null
    const consecutive = breached ? (prior?.breached && contiguous ? prior.consecutive : 0) + 1 : 0
    const id = `w4-evaluation-${String(s.entities.alertEvaluations.length + 1).padStart(4, '0')}`
    const nowIso = monitoringNow(s)
    const evaluation: AlertEvaluation = { id, orgId: rule.orgId, version: 1, createdAt: nowIso, updatedAt: nowIso,
      ruleId: rule.id, ruleRevision: rule.activeRevision!, monitorRevision: active.monitor.activeRevision!, target: sample.target, source: sample.source, metric: sample.metric,
      sampleId: sample.id, sourceTime: sample.sourceTime, evaluatedAt: nowIso, sampleValue: sample.value, value: known ? aggregated : null,
      freshness: sample.value === null || sourceTime > now ? 'unknown' : fresh && contiguous ? 'fresh' : 'stale', breached,
      consecutive, correlationId: `corr-${id}` }
    s.entities.alertEvaluations.push(evaluation)
    changed.push(ref('alertEvaluation', id))
    const incident = incidentFor(s, rule, sample.target, rule.activeRevision!)
    if (breached && consecutive >= active.spec.requiredConsecutiveSamples) {
      if (sample.target.kind === 'service') {
        const environmentId = sample.target.environmentId
        const env = s.entities.environments.find(e => e.id === environmentId)!
        if (!incident || incident.state === 'resolved') {
          const incidentId = `w4-incident-${String(s.sequence + 1).padStart(4, '0')}-${rule.id}`
          const streak = s.entities.alertEvaluations.filter(e => e.ruleId === rule.id && e.ruleRevision === rule.activeRevision && e.breached)
            .slice(-active.spec.requiredConsecutiveSamples)
          const evidence = streak.map(e => evidenceFor(s, e, rule, active.spec)).filter((e): e is NonNullable<typeof e> => !!e)
          if (incident) {
            const current = s.entities.incidents.find(i => i.id === incident.id)!
            current.state = 'open'; current.episode += 1; current.version += 1; current.updatedAt = nowIso
            current.evidence.push(...evidence); current.recoverySamples = 0; delete current.assigneeId
            evaluation.incidentId = current.id; recordEvent(s, 'incident.reopened', 'incident', current.id, current.correlationId, sample.target)
            notify(s, rule, active.spec, sample.target, current.id, evaluation); changed.push(ref('incident', current.id))
          } else {
            s.entities.incidents.push({ id: incidentId, orgId: rule.orgId, version: 1, createdAt: nowIso, updatedAt: nowIso,
              applicationId: env.applicationId, environmentId: env.id, affectedCiIds: s.entities.placements.filter(p => p.environmentId === env.id).map(p => p.ciId),
              severity: active.spec.severity, state: 'open', episode: 1, ruleKey: rule.id, ruleId: rule.id, ruleRevision: rule.activeRevision!,
              evidence, recoverySamples: 0, correlationId: `corr-${incidentId}` })
            evaluation.incidentId = incidentId; recordEvent(s, 'incident.opened', 'incident', incidentId, `corr-${incidentId}`, sample.target)
            notify(s, rule, active.spec, sample.target, incidentId, evaluation); changed.push(ref('incident', incidentId))
          }
        } else {
          const current = s.entities.incidents.find(i => i.id === incident.id)!
          const evidence = evidenceFor(s, evaluation, rule, active.spec)
          if (evidence) current.evidence.push(evidence)
          current.version += 1; current.updatedAt = nowIso; current.recoverySamples = 0
          evaluation.incidentId = current.id; notify(s, rule, active.spec, sample.target, current.id, evaluation); changed.push(ref('incident', current.id))
        }
      } else {
        if (!incident || incident.state === 'resolved') {
          const incidentId = `w4-infra-incident-${String(s.sequence + 1).padStart(4, '0')}-${rule.id}`
          const streak = s.entities.alertEvaluations.filter(e => e.ruleId === rule.id && e.ruleRevision === rule.activeRevision && e.breached)
            .slice(-active.spec.requiredConsecutiveSamples)
          if (incident) {
            const current = s.entities.infrastructureIncidents.find(i => i.id === incident.id)!
            current.state = 'open'; current.episode += 1; current.version += 1; current.updatedAt = nowIso
            current.evidenceEvaluationIds.push(...streak.map(e => e.id)); current.recoverySamples = 0
            evaluation.incidentId = current.id; recordEvent(s, 'incident.reopened', 'incident', current.id, current.correlationId, sample.target)
            notify(s, rule, active.spec, sample.target, current.id, evaluation); changed.push(ref('incident', current.id))
          } else {
            s.entities.infrastructureIncidents.push({ id: incidentId, orgId: rule.orgId, version: 1, createdAt: nowIso, updatedAt: nowIso,
              ciId: sample.target.ciId, ruleId: rule.id, ruleRevision: rule.activeRevision!, severity: active.spec.severity,
              state: 'open', episode: 1, evidenceEvaluationIds: streak.map(e => e.id), recoverySamples: 0, correlationId: `corr-${incidentId}` })
            evaluation.incidentId = incidentId; recordEvent(s, 'incident.opened', 'incident', incidentId, `corr-${incidentId}`, sample.target)
            notify(s, rule, active.spec, sample.target, incidentId, evaluation); changed.push(ref('incident', incidentId))
          }
        } else {
          const current = s.entities.infrastructureIncidents.find(i => i.id === incident.id)!
          current.evidenceEvaluationIds.push(evaluation.id); current.version += 1; current.updatedAt = nowIso; current.recoverySamples = 0
          evaluation.incidentId = current.id; notify(s, rule, active.spec, sample.target, current.id, evaluation); changed.push(ref('incident', current.id))
        }
      }
    } else if (incident && breached === false) {
      const recovery = Math.min(3, (incident.recoverySamples ?? 0) + 1)
      incident.recoverySamples = recovery; incident.version += 1; incident.updatedAt = nowIso
      if (recovery === 3) incident.state = 'resolved'
      evaluation.incidentId = incident.id; changed.push(ref('incident', incident.id))
      if (recovery === 3) recordEvent(s, 'incident.resolved', 'incident', incident.id, incident.correlationId, sample.target)
    }
  }
  return changed
}
export function ingestMonitoringServiceBucket(s: Snapshot, bucket: ObservationBucket) {
  const target: MonitoringTarget = { kind: 'service', applicationId: bucket.applicationId, environmentId: bucket.environmentId }
  const changed: CommandReceipt['changed'] = []
  for (const metric of ['rate', 'errorRate', 'p95Latency'] as const) changed.push(...ingestMonitoringSample(s, { id: bucket.id, target,
    source: 'demo-red', metric, sourceTime: bucket.to, from: bucket.from, to: bucket.to, value: bucket[metric] }))
  return changed
}
export function ingestInfrastructureMetric(s: Snapshot, sample: InfrastructureMetric) {
  const ci = s.entities.cis.find(c => c.id === sample.ciId)
  if (!ci || sample.source !== 'demo-ci' || Date.parse(sample.to) - Date.parse(sample.from) !== 60_000
    || Date.parse(sample.to) > Date.parse(monitoringNow(s)) || s.observations.infrastructureMetrics.some(x => x.id === sample.id || x.ciId === sample.ciId && x.metric === sample.metric && Date.parse(x.to) > Date.parse(sample.from)))
    fail(422, 'VALIDATION_ERROR', '基礎設施樣本目標、時間或來源無效。')
  s.observations.infrastructureMetrics.push(sample)
  return ingestMonitoringSample(s, { id: sample.id, target: { kind: 'infrastructure', ciId: sample.ciId }, source: 'demo-ci',
    metric: sample.metric, sourceTime: sample.to, from: sample.from, to: sample.to, value: sample.value })
}
export function advanceMonitoring(s: Snapshot): CommandReceipt['changed'] {
  const now = monitoringNow(s), changed: CommandReceipt['changed'] = []
  for (const delivery of s.entities.notificationDeliveries.filter(d => d.status === 'queued' && d.occurredAt < now)) {
    const silenced = s.entities.silences.some(x => x.ruleId === delivery.ruleId && x.ruleRevision === delivery.ruleRevision
      && sameTarget(x.target, delivery.target) && x.startAt <= now && now < x.expiresAt)
    const failed = s.scenarioFlags.alertDeliveryFailureDeliveryId === delivery.id
    delivery.status = silenced ? 'suppressed' : failed ? 'failed' : 'delivered'; delivery.updatedAt = now; delivery.version += 1
    if (failed && !silenced) { delivery.safeFailureCode = 'DEMO_DELIVERY_FAILURE'; delete s.scenarioFlags.alertDeliveryFailureDeliveryId }
    recordEvent(s, `notification.${delivery.status}`, 'notificationDelivery', delivery.id, delivery.correlationId, delivery.target)
    changed.push(ref('notificationDelivery', delivery.id))
    changed.push(...dispatchNotification(s, delivery).map(attempt => ref('notificationAttempt', attempt.id)))
  }
  return changed
}
function scenarioValue(rule: AlertRule, breach: boolean) {
  const spec = activeSpec(rule)!, above = ['gt', 'gte'].includes(spec.comparator)
  const makeAbove = breach ? above : !above
  const delta = spec.metric === 'errorRate' || spec.metric.endsWith('Utilization') ? 0.1 : Math.max(1, spec.threshold * 0.2)
  return makeAbove ? Math.min(spec.metric === 'errorRate' || spec.metric.endsWith('Utilization') ? 1 : Infinity, spec.threshold + delta)
    : Math.max(0, spec.threshold - delta)
}
export function runAlertScenario(s: Snapshot, rule: AlertRule, key: 'alert-breach' | 'alert-recovery' | 'alert-unknown' | 'alert-delivery-failure',
  advance: (next: Snapshot, ticks: number) => CommandReceipt['changed']): CommandReceipt['changed'] {
  const active = source(rule, s) ?? fail(409, 'INVALID_STATE', '規則或監控來源尚未啟用。')
  const prior = latestEvaluation(s, rule.id, rule.activeRevision!)
  const gap = prior && Date.parse(monitoringNow(s)) - Date.parse(prior.sourceTime) > 0 ? 1 : 0
  const count = key === 'alert-unknown' ? 1 : (key === 'alert-recovery' ? 3 : active.spec.requiredConsecutiveSamples) + gap
  const oldDeliveryCount = s.entities.notificationDeliveries.length
  const changed: CommandReceipt['changed'] = []
  for (let index = 0; index < count; index += 1) {
    const from = monitoringNow(s)
    advance(s, active.monitorSpec.sampleIntervalSeconds)
    const to = monitoringNow(s), id = `w4-sample-${rule.id}-${s.logicalClock}-${index}`
    const value = key === 'alert-unknown' ? null : scenarioValue(rule, key !== 'alert-recovery')
    if (active.target.kind === 'service') {
      const environmentId = active.target.environmentId
      const env = s.entities.environments.find(e => e.id === environmentId)!
      const bucket: ObservationBucket = { id, applicationId: env.applicationId, environmentId: env.id,
        ...(env.activeReleaseId ? { releaseId: env.activeReleaseId } : {}), from, to, rate: active.spec.metric === 'rate' ? value : 80,
        errorRate: active.spec.metric === 'errorRate' ? value : 0.002, p95Latency: active.spec.metric === 'p95Latency' ? value : 120, source: 'demo' }
      changed.push(...ingestObservationBucket(s, bucket))
    } else {
      changed.push(...ingestInfrastructureMetric(s, { id, ciId: active.target.ciId, source: 'demo-ci', metric: active.spec.metric as 'cpuUtilization' | 'memoryUtilization', from, to, value }))
    }
  }
  if (key === 'alert-delivery-failure') {
    const generated = s.entities.notificationDeliveries.slice(oldDeliveryCount).findLast(d => d.ruleId === rule.id && d.status === 'queued')
      ?? fail(409, 'INVALID_STATE', '故障情境需要新增且未被 Silence 抑制的通知。')
    s.scenarioFlags.alertDeliveryFailureDeliveryId = generated.id
  }
  return changed
}

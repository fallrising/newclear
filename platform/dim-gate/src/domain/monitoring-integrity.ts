import type { AlertEvaluation, AlertRule, Snapshot } from './schema-models'
import { monitoringNow, monitoringUnit, targetScope } from './monitoring'
import { activeSpec } from './monitoring'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const compare = (value: number, threshold: number, op: AlertRule['spec']['comparator']) =>
  op === 'gt' ? value > threshold : op === 'gte' ? value >= threshold : op === 'lt' ? value < threshold : value <= threshold
function sourceSample(s: Snapshot, evaluation: AlertEvaluation) {
  if (evaluation.target.kind === 'service') {
    const { applicationId, environmentId } = evaluation.target
    return s.observations.buckets.find(b => b.id === evaluation.sampleId && b.applicationId === applicationId && b.environmentId === environmentId)
  }
  const { ciId } = evaluation.target
  return s.observations.infrastructureMetrics.find(b => b.id === evaluation.sampleId && b.ciId === ciId && b.metric === evaluation.metric)
}
function sourceValue(s: Snapshot, evaluation: AlertEvaluation) {
  const sample = sourceSample(s, evaluation)
  if (!sample) return undefined
  return evaluation.target.kind === 'service' && 'rate' in sample ? sample[evaluation.metric as 'rate' | 'errorRate' | 'p95Latency']
    : 'value' in sample ? sample.value : undefined
}
export function monitoringIntegrityErrors(s: Snapshot): string[] {
  const errors: string[] = [], e = s.entities
  const monitorById = (id: string) => e.monitorPolicies.find(m => m.id === id)
  const ruleById = (id: string) => e.alertRules.find(r => r.id === id)
  const now = monitoringNow(s)
  for (const monitor of e.monitorPolicies) {
    if (!targetScope(s, monitor.spec.target) || targetScope(s, monitor.spec.target)?.orgId !== monitor.orgId
      || monitor.spec.source !== (monitor.spec.target.kind === 'service' ? 'demo-red' : 'demo-ci')
      || monitor.spec.sampleIntervalSeconds !== 60 || monitor.spec.freshnessSeconds < 60
      || monitor.spec.metrics.some(metric => monitor.spec.target.kind === 'service'
        ? !['rate', 'errorRate', 'p95Latency'].includes(metric) : !['cpuUtilization', 'memoryUtilization'].includes(metric))) errors.push('monitorPolicy: invalid target/source/metric')
    if (monitor.revisions.length !== monitor.revision || monitor.revisions.some((r, i) => r.revision !== i + 1
      || !same(r.spec.target, monitor.revisions[0].spec.target)) || !same(monitor.spec, monitor.revisions.at(-1)?.spec)
      || monitor.activeRevision !== null && !monitor.revisions.some(r => r.revision === monitor.activeRevision && r.submittedAt)) errors.push('monitorPolicy: invalid revision lineage')
    if (monitor.status === 'active' && monitor.activeRevision !== monitor.revision) errors.push('monitorPolicy: invalid active revision')
  }
  for (const rule of e.alertRules) {
    const monitor = monitorById(rule.spec.monitorPolicyId)
    const currentMonitor = monitor && (activeSpec(monitor) ?? monitor.spec)
    if (!monitor || !currentMonitor || monitor.orgId !== rule.orgId || !currentMonitor.metrics.includes((activeSpec(rule) ?? rule.spec).metric)
      || rule.spec.unit !== monitoringUnit[rule.spec.metric]
      || rule.spec.channelRef !== (monitor.spec.target.kind === 'service' ? 'demo-rd' : 'demo-ops')
      || rule.spec.requiredConsecutiveSamples * 60 > rule.spec.windowSeconds) errors.push('alertRule: invalid monitor/metric/unit/channel')
    if (rule.revisions.length !== rule.revision || rule.revisions.some((r, i) => r.revision !== i + 1 || r.spec.monitorPolicyId !== rule.revisions[0].spec.monitorPolicyId)
      || !same(rule.spec, rule.revisions.at(-1)?.spec)
      || rule.activeRevision !== null && !rule.revisions.some(r => r.revision === rule.activeRevision && r.submittedAt)) errors.push('alertRule: invalid revision lineage')
    if (rule.status === 'active' && rule.activeRevision !== rule.revision) errors.push('alertRule: invalid active revision')
    if (rule.activeRevision !== null && (!monitor || !activeSpec(monitor)?.enabled
      || !activeSpec(monitor)?.metrics.includes(activeSpec(rule)?.metric ?? rule.spec.metric))) errors.push('alertRule: active monitor incompatibility')
  }
  for (const slo of e.sloPolicies) {
    const monitor = monitorById(slo.spec.monitorPolicyId)
    if (!monitor || monitor.orgId !== slo.orgId || monitor.spec.target.kind !== 'service'
      || slo.spec.indicator === 'availability' && (slo.spec.unit !== 'fraction' || slo.spec.thresholdMs !== undefined)
      || slo.spec.indicator === 'latency' && (slo.spec.unit !== 'ms' || slo.spec.thresholdMs === undefined)) errors.push('sloPolicy: invalid indicator/monitor')
    if (slo.revisions.length !== slo.revision || slo.revisions.some((r, i) => r.revision !== i + 1 || r.spec.monitorPolicyId !== slo.revisions[0].spec.monitorPolicyId)
      || !same(slo.spec, slo.revisions.at(-1)?.spec)
      || slo.activeRevision !== null && !slo.revisions.some(r => r.revision === slo.activeRevision && r.submittedAt)) errors.push('sloPolicy: invalid revision lineage')
    if (slo.activeRevision !== null && (!monitor || !activeSpec(monitor)?.enabled
      || !(activeSpec(slo)?.indicator === 'availability' ? activeSpec(monitor)?.metrics.includes('errorRate') : activeSpec(monitor)?.metrics.includes('p95Latency'))))
      errors.push('sloPolicy: active monitor incompatibility')
  }
  const sampleIds = new Set<string>()
  for (const sample of e.alertEvaluations) {
    const rule = ruleById(sample.ruleId), monitor = rule && monitorById(rule.spec.monitorPolicyId)
    const revision = rule?.revisions.find(r => r.revision === sample.ruleRevision)
    const monitorRevision = monitor?.revisions.find(r => r.revision === sample.monitorRevision)
    const value = sourceValue(s, sample)
    if (!rule || !monitor || !revision || !monitorRevision || sample.orgId !== rule.orgId || !same(sample.target, monitorRevision.spec.target)
      || sample.metric !== revision.spec.metric || sample.source !== monitorRevision.spec.source || sample.sourceTime !== sourceSample(s, sample)?.to
      || value === undefined || sample.sampleValue !== value || sample.evaluatedAt < sample.sourceTime)
      errors.push('alertEvaluation: invalid rule/sample lineage')
    const key = `${sample.ruleId}:${sample.ruleRevision}:${sample.sampleId}`
    if (sampleIds.has(key)) errors.push('alertEvaluation: duplicate source sample')
    sampleIds.add(key)
  }
  for (const rule of e.alertRules) for (const revision of rule.revisions) {
    const samples = e.alertEvaluations.filter(x => x.ruleId === rule.id && x.ruleRevision === revision.revision)
      .toSorted((a, b) => a.sourceTime.localeCompare(b.sourceTime) || a.id.localeCompare(b.id))
    let previous: AlertEvaluation | undefined
    for (const evaluation of samples) {
      const monitor = monitorById(revision.spec.monitorPolicyId)
      const monitorSpec = monitor?.revisions.find(r => r.revision === evaluation.monitorRevision)?.spec
      const step = monitorSpec?.sampleIntervalSeconds ?? 60
      const contiguous = !previous || previous.monitorRevision === evaluation.monitorRevision
        && Date.parse(evaluation.sourceTime) - Date.parse(previous.sourceTime) === step * 1000
      const age = Date.parse(evaluation.evaluatedAt) - Date.parse(evaluation.sourceTime)
      const fresh = evaluation.sampleValue !== null && age >= 0 && age <= (monitorSpec?.freshnessSeconds ?? 0) * 1000 && contiguous
      const expectedFreshness = evaluation.sampleValue === null ? 'unknown' : fresh ? 'fresh' : 'stale'
      if (evaluation.freshness !== expectedFreshness) errors.push('alertEvaluation: invalid freshness')
      const candidates: number[] = []
      if (fresh) {
        let expected = Date.parse(evaluation.sourceTime) - step * 1000
        for (const prior of samples.filter(x => x.sourceTime < evaluation.sourceTime).toReversed()) {
          if (Date.parse(prior.sourceTime) !== expected || prior.monitorRevision !== evaluation.monitorRevision || prior.freshness !== 'fresh' || prior.sampleValue === null
            || Date.parse(prior.sourceTime) < Date.parse(evaluation.sourceTime) - revision.spec.windowSeconds * 1000) break
          candidates.unshift(prior.sampleValue); expected -= step * 1000
        }
        candidates.push(evaluation.sampleValue!)
      }
      const aggregate = !candidates.length ? null : revision.spec.aggregation === 'avg'
        ? candidates.reduce((a, b) => a + b, 0) / candidates.length : revision.spec.aggregation === 'max' ? Math.max(...candidates) : candidates.at(-1)!
      const breach = aggregate === null ? null : compare(aggregate, revision.spec.threshold, revision.spec.comparator)
      const consecutive = breach ? (previous?.breached && contiguous ? previous.consecutive : 0) + 1 : 0
      if (evaluation.value !== aggregate || evaluation.breached !== breach || evaluation.consecutive !== consecutive) errors.push('alertEvaluation: invalid evaluation proof')
      previous = evaluation
    }
  }
  for (const silence of e.silences) {
    const rule = ruleById(silence.ruleId), monitor = rule && monitorById(rule.spec.monitorPolicyId)
    if (!rule || !monitor || silence.orgId !== rule.orgId || !rule.revisions.some(r => r.revision === silence.ruleRevision)
      || !same(silence.target, monitor.spec.target) || !e.users.some(u => u.id === silence.actorId && u.orgId === silence.orgId)
      || Date.parse(silence.expiresAt) <= Date.parse(silence.startAt) || Date.parse(silence.expiresAt) - Date.parse(silence.startAt) > 86_400_000)
      errors.push('silence: invalid bounded target/revision')
  }
  const incidentKey = new Set<string>()
  for (const incident of e.incidents.filter(i => i.ruleId)) {
    const rule = ruleById(incident.ruleId!), monitor = rule && monitorById(rule.spec.monitorPolicyId)
    const target = monitor?.spec.target
    const key = `${incident.ruleId}:${incident.ruleRevision}:${incident.environmentId}`
    if (incidentKey.has(key)) errors.push('monitoring incident: duplicate episode')
    incidentKey.add(key)
    if (!rule || !target || target.kind !== 'service' || target.environmentId !== incident.environmentId || target.applicationId !== incident.applicationId
      || incident.ruleKey !== rule.id || !incident.ruleRevision || !rule.revisions.some(r => r.revision === incident.ruleRevision)
      || incident.evidence.length < (rule.revisions.find(r => r.revision === incident.ruleRevision)?.spec.requiredConsecutiveSamples ?? Infinity)) errors.push('monitoring incident: invalid service rule/target')
    if (incident.assigneeId && !e.users.some(u => u.id === incident.assigneeId && u.orgId === incident.orgId)
      || ['acknowledged', 'investigating'].includes(incident.state) && !incident.assigneeId) errors.push('monitoring incident: invalid assignee')
    for (const evidence of incident.evidence) {
      const evaluation = e.alertEvaluations.find(x => x.sampleId === evidence.sampleId && x.ruleId === incident.ruleId && x.ruleRevision === incident.ruleRevision)
      if (!evaluation || !evaluation.breached || evidence.ruleRevision !== incident.ruleRevision || evidence.ruleKey !== rule?.id
        || evidence.metric !== evaluation.metric || evidence.sampleWindow.to !== evaluation.sourceTime || evidence.value !== evaluation.value
        || evidence.threshold !== rule?.revisions.find(r => r.revision === incident.ruleRevision)?.spec.threshold) errors.push('monitoring incident: unsupported service evidence')
    }
  }
  for (const incident of e.infrastructureIncidents) {
    const rule = ruleById(incident.ruleId), monitor = rule && monitorById(rule.spec.monitorPolicyId), target = monitor?.spec.target
    const key = `${incident.ruleId}:${incident.ruleRevision}:${incident.ciId}`
    if (incidentKey.has(key)) errors.push('monitoring incident: duplicate episode')
    incidentKey.add(key)
    if (!rule || !target || target.kind !== 'infrastructure' || target.ciId !== incident.ciId || incident.orgId !== rule.orgId
      || incident.evidenceEvaluationIds.length < (rule.revisions.find(r => r.revision === incident.ruleRevision)?.spec.requiredConsecutiveSamples ?? Infinity)) errors.push('monitoring incident: invalid infrastructure rule/target')
    if (incident.assigneeId && !e.users.some(u => u.id === incident.assigneeId && u.orgId === incident.orgId)
      || ['acknowledged', 'investigating'].includes(incident.state) && !incident.assigneeId) errors.push('monitoring incident: invalid assignee')
    for (const id of incident.evidenceEvaluationIds) if (!e.alertEvaluations.some(x => x.id === id && x.ruleId === incident.ruleId && x.ruleRevision === incident.ruleRevision && x.breached))
      errors.push('monitoring incident: unsupported infrastructure evidence')
  }
  for (const delivery of e.notificationDeliveries) {
    const rule = ruleById(delivery.ruleId), monitor = rule && monitorById(rule.spec.monitorPolicyId)
    const incident = e.incidents.find(i => i.id === delivery.incidentId) ?? e.infrastructureIncidents.find(i => i.id === delivery.incidentId)
    const when = delivery.status === 'suppressed' ? [delivery.occurredAt, delivery.updatedAt] : [delivery.updatedAt]
    const silenced = e.silences.some(x => x.ruleId === delivery.ruleId && x.ruleRevision === delivery.ruleRevision
      && same(x.target, delivery.target) && when.some(time => x.startAt <= time && time < x.expiresAt))
    if (!rule || !monitor || !incident || delivery.orgId !== rule.orgId || !same(delivery.target, monitor.spec.target)
      || delivery.channelRef !== rule.revisions.find(r => r.revision === delivery.ruleRevision)?.spec.channelRef
      || delivery.status !== 'queued' && (delivery.status === 'suppressed') !== silenced
      || delivery.status === 'failed' !== !!delivery.safeFailureCode
      || delivery.occurredAt > now) errors.push('notificationDelivery: invalid incident/channel/status')
  }
  const infraKeys = new Set<string>()
  for (const sample of s.observations.infrastructureMetrics) {
    const ci = e.cis.find(x => x.id === sample.ciId)
    const key = `${sample.ciId}:${sample.metric}:${sample.from}`
    if (!ci || Date.parse(sample.to) - Date.parse(sample.from) !== 60_000 || sample.to > now || infraKeys.has(key)) errors.push('infrastructureMetric: invalid source window')
    infraKeys.add(key)
  }
  return errors
}

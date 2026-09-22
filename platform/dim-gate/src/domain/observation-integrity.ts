import type { ObservationBucket, Snapshot } from './schemas'
import { breached, healthy, observationStreak, observationTime } from './observation'

/** Restore-time validation never repairs or discards persisted telemetry or recovery work. */
export function observationIntegrityErrors(s: Snapshot): string[] {
  const errors: string[] = [], now = Date.parse(observationTime(s.logicalClock))
  const { buckets, traces, logs, recoveries } = s.observations
  const scoped = (record: { environmentId: string; applicationId: string; releaseId?: string }) => {
    const env = s.entities.environments.find(e => e.id === record.environmentId && e.applicationId === record.applicationId)
    return !!env && (!record.releaseId || s.entities.releases.some(r => r.id === record.releaseId && r.environmentId === env.id && r.applicationId === env.applicationId && r.state === 'succeeded'))
  }
  for (const [name, collection] of [['buckets', buckets], ['traces', traces], ['logs', logs]] as const) {
    if (new Set(collection.map(e => e.id)).size !== collection.length) errors.push(`observations.${name}: duplicate ID`)
    for (const record of collection) if (!scoped(record)) errors.push(`observations.${name}: invalid application/environment/release`)
  }
  for (const bucket of buckets) {
    if (Date.parse(bucket.to) - Date.parse(bucket.from) !== 60_000 || Date.parse(bucket.to) > now) errors.push('observation: invalid minute window')
  }
  for (const env of s.entities.environments) {
    const samples = buckets.filter(b => b.environmentId === env.id).toSorted((a, b) => Date.parse(a.from) - Date.parse(b.from))
    if (samples.some((sample, index) => index > 0 && Date.parse(sample.from) < Date.parse(samples[index - 1].to))) errors.push('observation: overlapping window')
  }
  const matchesBucket = (record: { applicationId: string; environmentId: string; releaseId?: string }, at: string) => buckets.some(b => b.applicationId === record.applicationId
    && b.environmentId === record.environmentId && b.releaseId === record.releaseId && Date.parse(at) >= Date.parse(b.from) && Date.parse(at) < Date.parse(b.to))
  const validCi = (id: string, environmentId: string) => {
    const env = s.entities.environments.find(e => e.id === environmentId)
    return s.entities.cis.some(ci => ci.id === id && ci.orgId === env?.orgId)
  }
  for (const trace of traces) {
    if (!matchesBucket(trace, trace.start) || Date.parse(trace.start) + trace.durationMs > now) errors.push('trace: invalid observation window')
    if (!trace.spans.length || new Set(trace.spans.map(span => span.id)).size !== trace.spans.length || trace.spans.filter(span => span.parentId === null).length !== 1) errors.push('trace: invalid span identity/root')
    for (const span of trace.spans) {
      const parent = span.parentId === null ? undefined : trace.spans.find(candidate => candidate.id === span.parentId)
      if (span.parentId !== null && !parent || span.ciId && !validCi(span.ciId, trace.environmentId)) errors.push('trace: invalid span reference')
      if (Date.parse(span.start) < Date.parse(trace.start) || Date.parse(span.start) + span.durationMs > Date.parse(trace.start) + trace.durationMs
        || parent && (Date.parse(span.start) < Date.parse(parent.start) || Date.parse(span.start) + span.durationMs > Date.parse(parent.start) + parent.durationMs)) errors.push('trace: invalid span timing')
      const seen = new Set([span.id]); let ancestor = parent
      while (ancestor) {
        if (seen.has(ancestor.id)) { errors.push('trace: cyclic spans'); break }
        seen.add(ancestor.id); ancestor = trace.spans.find(candidate => candidate.id === ancestor!.parentId)
      }
    }
  }
  for (const log of logs) {
    if (!matchesBucket(log, log.occurredAt)) errors.push('observation log: invalid window')
    if (log.traceId && !traces.some(t => t.id === log.traceId && t.applicationId === log.applicationId && t.environmentId === log.environmentId && t.releaseId === log.releaseId)
      || log.ciId && !validCi(log.ciId, log.environmentId)) errors.push('observation log: invalid correlation reference')
  }
  const keys = new Set<string>()
  for (const incident of s.entities.incidents) {
    const env = s.entities.environments.find(e => e.id === incident.environmentId && e.applicationId === incident.applicationId && e.orgId === incident.orgId)
    if (!env || !scoped({ ...incident, releaseId: incident.relatedReleaseId })) errors.push('incident: invalid scope/release')
    const key = `${incident.environmentId}:${incident.ruleKey}`
    if (keys.has(key)) errors.push('incident: duplicate environment/rule')
    keys.add(key)
    if (incident.ruleKey !== 'red-degradation' || !incident.evidence.length) errors.push('incident: invalid rule/evidence')
    if (incident.assigneeId && !s.entities.users.some(u => u.id === incident.assigneeId && u.orgId === incident.orgId)
      || ['acknowledged', 'investigating'].includes(incident.state) && !incident.assigneeId) errors.push('incident: invalid assignee')
    for (const ciId of incident.affectedCiIds) if (!validCi(ciId, incident.environmentId)) errors.push('incident: invalid affected CI')
    const evidenceKeys = new Set<string>(), evidenceBuckets: ObservationBucket[] = []
    let previousFrom = -Infinity
    for (const evidence of incident.evidence) {
      const bucket = buckets.find(b => b.environmentId === incident.environmentId && b.from === evidence.sampleWindow.from && b.to === evidence.sampleWindow.to)
      const threshold = evidence.metric === 'p95Latency' ? 500 : 0.05
      const evidenceKey = `${evidence.metric}:${evidence.sampleWindow.from}`
      if (evidenceKeys.has(evidenceKey)) errors.push('incident: duplicate evidence')
      evidenceKeys.add(evidenceKey)
      if (Date.parse(evidence.sampleWindow.from) < previousFrom) errors.push('incident: unordered evidence')
      previousFrom = Date.parse(evidence.sampleWindow.from)
      if (!bucket || evidence.ruleKey !== incident.ruleKey || evidence.threshold !== threshold || bucket[evidence.metric] === null || bucket[evidence.metric]! <= threshold) errors.push('incident: unsupported breach evidence')
      else if (!evidenceBuckets.includes(bucket)) evidenceBuckets.push(bucket)
      const inWindow = (value: string) => Date.parse(value) >= Date.parse(evidence.sampleWindow.from) && Date.parse(value) < Date.parse(evidence.sampleWindow.to)
      if (evidence.traceIds.some(id => !traces.some(t => t.id === id && t.environmentId === incident.environmentId && inWindow(t.start)))
        || evidence.logIds.some(id => !logs.some(l => l.id === id && l.environmentId === incident.environmentId && inWindow(l.occurredAt)))) errors.push('incident: invalid evidence references')
    }
    if (evidenceBuckets.length < 3 || !evidenceBuckets.some((b, index) => index >= 2 && b.from === evidenceBuckets[index - 1].to && evidenceBuckets[index - 1].from === evidenceBuckets[index - 2].to)) errors.push('incident: missing sustained breach')
    const latestEvidence = incident.evidence.at(-1)?.sampleWindow.to
    const recoveryBuckets = buckets.filter(b => b.environmentId === incident.environmentId && latestEvidence && Date.parse(b.to) > Date.parse(latestEvidence)
      && Date.parse(b.to) <= Date.parse(incident.updatedAt))
    // For a resolved episode, preserve its historical proof even when the active release later changes.
    const recoveryRelease = incident.state === 'resolved' ? recoveryBuckets.at(-1)?.releaseId : env?.activeReleaseId
    const count = Math.min(3, observationStreak(recoveryBuckets, b => healthy(b) && !!recoveryRelease && b.releaseId === recoveryRelease).length)
    if (incident.recoverySamples !== count || incident.state === 'resolved' && count !== 3 || incident.state !== 'resolved' && count >= 3) errors.push('incident: invalid recovery proof')
  }
  if (new Set(recoveries.map(r => r.environmentId)).size !== recoveries.length) errors.push('recovery: duplicate task')
  for (const task of recoveries) {
    const env = s.entities.environments.find(e => e.id === task.environmentId && e.activeReleaseId === task.releaseId)
    const release = s.entities.releases.find(r => r.id === task.releaseId && r.environmentId === task.environmentId && r.kind === 'rollback' && r.state === 'succeeded' && r.health === 'healthy')
    const completedTick = release?.completedAt ? (Date.parse(release.completedAt) - Date.parse(observationTime(0))) / 1000 : NaN
    if (!env || !release || task.dueTick !== completedTick + (4 - task.remaining) * 60 || task.dueTick <= s.logicalClock || task.dueTick > s.logicalClock + 60) errors.push('recovery: invalid release/due tick')
    const afterHealth = buckets.filter(b => b.environmentId === task.environmentId && Date.parse(b.from) >= Date.parse(release?.completedAt ?? ''))
    if (afterHealth.some(breached)) errors.push('recovery: superseded by abnormal observation')
    for (let index = 0; index < 3 - task.remaining; index += 1) {
      if (!afterHealth.some(b => b.releaseId === task.releaseId && b.from === observationTime(completedTick + index * 60) && healthy(b))) errors.push('recovery: missing completed sample')
    }
  }
  for (const env of s.entities.environments) {
    const release = s.entities.releases.find(r => r.id === env.activeReleaseId && r.kind === 'rollback' && r.state === 'succeeded')
    if (!release?.completedAt) continue
    const samples = buckets.filter(b => b.environmentId === env.id && Date.parse(b.from) >= Date.parse(release.completedAt!))
    const replaced = samples.some(breached) || samples.filter(b => b.releaseId === release.id && healthy(b)).length >= 3
    if (!replaced && !recoveries.some(r => r.environmentId === env.id && r.releaseId === release.id)) errors.push('recovery: missing scheduled samples')
  }
  for (const integration of s.entities.integrations) {
    if (!integration.poolIds.length || new Set(integration.poolIds).size !== integration.poolIds.length
      || integration.poolIds.some(id => !s.entities.pools.some(p => p.id === id && p.orgId === integration.orgId))) errors.push('integration: invalid pools')
  }
  return errors
}

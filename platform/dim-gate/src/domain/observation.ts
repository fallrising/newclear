import type { Policy } from './policy'
import { canReadDelivery } from './delivery'
import type { Incident, ObservationBucket, Snapshot } from './schema-models'

export const observationTime = (tick: number) => new Date(Date.parse('2026-09-20T09:00:00Z') + tick * 1000).toISOString()
export const breached = (bucket: ObservationBucket) => bucket.p95Latency !== null && bucket.p95Latency > 500 || bucket.errorRate !== null && bucket.errorRate > 0.05
export const healthy = (bucket: ObservationBucket) => bucket.p95Latency !== null && bucket.errorRate !== null && bucket.p95Latency <= 500 && bucket.errorRate <= 0.05
export function canReadObservation(s: Snapshot, policy: Policy, environmentId: string, raw = false) {
  return canReadDelivery(s, policy, environmentId, raw)
}
export function incidentView(s: Snapshot, policy: Policy, incident: Incident): Incident {
  const raw = canReadObservation(s, policy, incident.environmentId, true)
  return { ...structuredClone(incident), affectedCiIds: incident.affectedCiIds.filter(id => s.entities.cis.some(ci => ci.id === id && policy.canReadCi(ci))),
    evidence: incident.evidence.map(evidence => ({ ...structuredClone(evidence), traceIds: raw ? [...evidence.traceIds] : [], logIds: raw ? [...evidence.logIds] : [] })) }
}
/** A streak is made only of adjacent, known minute windows; gaps and unknowns reset it. */
export function observationStreak(buckets: ObservationBucket[], predicate: (b: ObservationBucket) => boolean): ObservationBucket[] {
  const streak: ObservationBucket[] = []
  for (const bucket of buckets.toSorted((a, b) => Date.parse(a.from) - Date.parse(b.from) || a.id.localeCompare(b.id))) {
    if (!predicate(bucket)) { streak.length = 0; continue }
    if (streak.length && Date.parse(streak.at(-1)!.to) !== Date.parse(bucket.from)) streak.length = 0
    streak.push(bucket)
  }
  return streak
}

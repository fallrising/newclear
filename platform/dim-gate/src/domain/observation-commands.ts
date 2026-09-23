import type { CommandInput } from './command-input-schemas'
import { acknowledgeIncidentInputSchema, reasonCommandSchema, versionCommandSchema } from './command-input-schemas'
import type { z } from 'zod'
import { DomainError } from './errors'
import type { Policy } from './policy'
import { observationTime, breached, healthy, observationStreak, canReadObservation } from './observation'
import { scenarioInputSchema, type CommandReceipt, type Environment, type Incident, type ObservationBucket, type Snapshot } from './schema-models'

const ruleKey = 'red-degradation'
const thresholds = { p95Latency: 500, errorRate: 0.05 } as const
const fail = (status: number, code: string, message: string): never => { throw new DomainError(status, code, message) }
const missing = (): never => fail(404, 'NOT_FOUND', '此資源不存在或不在目前授權範圍。')
const denied = (): never => fail(403, 'FORBIDDEN', '目前身分沒有此操作的授權。')
const invalid = (): never => fail(409, 'INVALID_STATE', '目前狀態無法執行此操作。')
const ref = (entityType: string, entityId: string) => ({ entityType, entityId })
const touch = (s: Snapshot, entity: { version: number; updatedAt: string }) => { entity.version += 1; entity.updatedAt = observationTime(s.logicalClock) }
function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw new DomainError(422, 'VALIDATION_ERROR', '輸入欄位不符合契約。', { body: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) })
  return result.data
}
function recordIncident(s: Snapshot, incident: Incident, action: string) {
  const env = s.entities.environments.find(e => e.id === incident.environmentId)!
  const app = s.entities.applications.find(a => a.id === incident.applicationId)!
  s.sequence += 1
  const serial = String(s.sequence).padStart(4, '0'), occurredAt = observationTime(s.logicalClock)
  s.events.push({ eventId: `event-${serial}`, type: action, entities: [ref('incident', incident.id)], occurredAt, correlationId: incident.correlationId })
  s.audit.push({ id: `audit-${serial}`, orgId: incident.orgId, actorId: 'demo-scheduler', action, entityType: 'incident', entityId: incident.id,
    scopeSnapshot: { projectIds: [app.projectId], poolIds: [], stages: [env.stage] }, outcome: 'succeeded',
    diffSummary: [`state: ${incident.state}`, `episode: ${incident.episode}`, `recoverySamples: ${incident.recoverySamples}`],
    requestId: `scheduler-${serial}`, correlationId: incident.correlationId, occurredAt })
}
function evidenceFor(s: Snapshot, bucket: ObservationBucket): Incident['evidence'] {
  const inWindow = (value: string) => Date.parse(value) >= Date.parse(bucket.from) && Date.parse(value) < Date.parse(bucket.to)
  const traceIds = s.observations.traces.filter(t => t.environmentId === bucket.environmentId && inWindow(t.start)).map(t => t.id)
  const logIds = s.observations.logs.filter(l => l.environmentId === bucket.environmentId && inWindow(l.occurredAt)).map(l => l.id)
  return (Object.keys(thresholds) as (keyof typeof thresholds)[]).filter(metric => bucket[metric] !== null && bucket[metric]! > thresholds[metric])
    .map(metric => ({ ruleKey, metric, threshold: thresholds[metric], sampleWindow: { from: bucket.from, to: bucket.to }, traceIds, logIds }))
}
/** Mutates only the transaction draft; exported to test incomplete telemetry without bypassing the evaluator. */
export function ingestObservationBucket(s: Snapshot, bucket: ObservationBucket): CommandReceipt['changed'] {
  const env = s.entities.environments.find(e => e.id === bucket.environmentId && e.applicationId === bucket.applicationId)
  if (!env || Date.parse(bucket.to) - Date.parse(bucket.from) !== 60_000 || Date.parse(bucket.to) > Date.parse(observationTime(s.logicalClock))) fail(422, 'VALIDATION_ERROR', '觀測資料必須屬於有效環境和已完成的一分鐘視窗。')
  const existing = s.observations.buckets.filter(b => b.environmentId === bucket.environmentId)
  if (s.observations.buckets.some(b => b.id === bucket.id) || existing.some(b => Date.parse(b.to) > Date.parse(bucket.from))) fail(422, 'VALIDATION_ERROR', '觀測視窗不可重複、倒退或重疊。')
  s.observations.buckets.push(bucket)
  let incident = s.entities.incidents.find(i => i.environmentId === env!.id && i.ruleKey === ruleKey)
  let action = 'incident.evidence.updated'
  const abnormal = breached(bucket)
  if (abnormal) s.observations.recoveries = s.observations.recoveries.filter(r => r.environmentId !== env!.id)
  if (abnormal && (!incident || incident.state === 'resolved')) {
    const candidateBuckets = [...existing, bucket].filter(b => !incident || Date.parse(b.from) >= Date.parse(incident.updatedAt))
    const streak = observationStreak(candidateBuckets, breached)
    if (streak.length < 3) return []
    if (!incident) {
      const id = `incident-${String(s.sequence + 1).padStart(4, '0')}`, now = observationTime(s.logicalClock)
      incident = { id, orgId: env!.orgId, version: 1, createdAt: now, updatedAt: now,
        applicationId: env!.applicationId, environmentId: env!.id, affectedCiIds: [], severity: 'warning', state: 'open',
        episode: 1, ruleKey, evidence: [], recoverySamples: 0, correlationId: `corr-${id}` }
      s.entities.incidents.push(incident); action = 'incident.opened'
    } else {
      incident.state = 'open'; incident.episode += 1; delete incident.assigneeId; touch(s, incident); action = 'incident.reopened'
    }
    incident.relatedReleaseId = bucket.releaseId
    incident.affectedCiIds = [...new Set(s.entities.placements.filter(p => p.environmentId === env!.id).map(p => p.ciId))]
    incident.recoverySamples = 0
    incident.evidence.push(...streak.slice(-3).flatMap(b => evidenceFor(s, b)))
  } else if (incident && incident.state !== 'resolved') {
    if (abnormal) {
      incident.evidence.push(...evidenceFor(s, bucket)); incident.recoverySamples = 0; incident.relatedReleaseId = bucket.releaseId
    } else {
      // A healthy bucket for an obsolete release cannot close the current incident.
      const streak = observationStreak([...existing, bucket].filter(b => Date.parse(b.to) > Date.parse(incident!.evidence.at(-1)!.sampleWindow.to)),
        b => healthy(b) && !!env!.activeReleaseId && b.releaseId === env!.activeReleaseId)
      incident.recoverySamples = Math.min(3, streak.length)
      action = 'incident.recovery.observed'
      if (incident.recoverySamples === 3) { incident.state = 'resolved'; action = 'incident.resolved' }
    }
    touch(s, incident)
  } else return []
  recordIncident(s, incident, action)
  return [ref('incident', incident.id)]
}
export function appendSyntheticObservation(s: Snapshot, environmentId: string, fromTick: number, abnormal: boolean) {
  const env = s.entities.environments.find(e => e.id === environmentId)!
  const id = `sample-${environmentId}-${fromTick}`, start = observationTime(fromTick), end = observationTime(fromTick + 60)
  const durationMs = abnormal ? 900 : 120
  const refs = { applicationId: env.applicationId, environmentId, ...(env.activeReleaseId ? { releaseId: env.activeReleaseId } : {}) }
  const ciId = s.entities.placements.find(p => p.environmentId === env.id)?.ciId
  const traceId = `trace-${id}`
  s.observations.traces.push({ id: traceId, ...refs, name: 'GET /checkout · demo', start, durationMs, status: abnormal ? 'error' : 'ok', spans: [
    { id: `span-${id}-root`, parentId: null, name: 'checkout request', start, durationMs, status: abnormal ? 'error' : 'ok', ...(ciId ? { ciId } : {}) },
    { id: `span-${id}-dependency`, parentId: `span-${id}-root`, name: 'synthetic dependency', start: observationTime(fromTick + 0.01), durationMs: abnormal ? 780 : 60, status: abnormal ? 'error' : 'ok', ...(ciId ? { ciId } : {}) },
  ] })
  s.observations.logs.push({ id: `log-${id}`, ...refs, occurredAt: start, level: abnormal ? 'error' : 'info',
    message: abnormal ? 'Demo observation: elevated latency and error fraction in synthetic request.' : 'Demo observation: synthetic request completed within healthy thresholds.', traceId, ...(ciId ? { ciId } : {}) })
  return ingestObservationBucket(s, { id, ...refs, from: start, to: end, rate: 80, errorRate: abnormal ? 0.08 : 0.002, p95Latency: durationMs, source: 'demo' })
}
export function advanceObservation(s: Snapshot): CommandReceipt['changed'] {
  const changed: CommandReceipt['changed'] = []
  s.observations.recoveries = s.observations.recoveries.filter(task => s.entities.environments.some(e => e.id === task.environmentId && e.activeReleaseId === task.releaseId))
  for (const task of [...s.observations.recoveries]) {
    if (task.dueTick > s.logicalClock) continue
    changed.push(...appendSyntheticObservation(s, task.environmentId, task.dueTick - 60, false))
    task.remaining -= 1
    if (task.remaining === 0) s.observations.recoveries = s.observations.recoveries.filter(r => r !== task)
    else task.dueTick += 60
  }
  return changed
}
export type ObservationEffect = CommandReceipt & { action: string; fields: string[]; reason?: string; projectIds: string[]; poolIds: string[]; stages: Environment['stage'][] }
/** Scope is rechecked before receipt replay, while state/version checks apply only to fresh work. */
export function prepareObservation(s: Snapshot, policy: Policy, input: CommandInput,
  advance: (next: Snapshot, ticks: number) => CommandReceipt['changed']): { apply(next: Snapshot): ObservationEffect } | undefined {
  if (input.method.toUpperCase() !== 'POST') return undefined
  const incidentMatch = /^\/incidents\/([^/]+)\/(acknowledge|investigate)$/.exec(input.path)
  if (incidentMatch) {
    if (!policy.effectiveActions.includes(`incident.${incidentMatch[2]}`)) denied()
    const original = s.entities.incidents.find(i => i.id === incidentMatch[1]) ?? missing()
    const env = s.entities.environments.find(e => e.id === original.environmentId)!
    const app = s.entities.applications.find(a => a.id === original.applicationId)!
    if (!canReadObservation(s, policy, env.id) || !policy.hasProject(app.projectId, env.stage, 'ops')) missing()
    const body = parse(incidentMatch[2] === 'acknowledge' ? acknowledgeIncidentInputSchema : reasonCommandSchema, input.body)
    return { apply(next) {
      const incident = next.entities.incidents.find(i => i.id === original.id)!
      if (incident.version !== body.expectedVersion) fail(409, 'VERSION_CONFLICT', '告警版本已變更，請重新讀取。')
      if (incidentMatch[2] === 'acknowledge' ? incident.state !== 'open' : !['acknowledged', 'investigating'].includes(incident.state)) invalid()
      incident.state = incidentMatch[2] === 'acknowledge' ? 'acknowledged' : 'investigating'
      incident.assigneeId = input.actorId; touch(next, incident)
      return { ...ref('incident', incident.id), entityVersion: incident.version, correlationId: incident.correlationId, changed: [ref('incident', incident.id)],
        action: `incident.${incidentMatch[2]}`, fields: ['state', 'assigneeId'], reason: body.reason, projectIds: [app.projectId], poolIds: [], stages: [env.stage] }
    } }
  }
  const integrationId = /^\/integrations\/([^/]+)\/test$/.exec(input.path)?.[1]
  if (integrationId) {
    if (!policy.admin) denied()
    const integration = s.entities.integrations.find(i => i.id === integrationId && i.orgId === policy.user!.orgId) ?? missing()
    const body = parse(versionCommandSchema, input.body)
    return { apply(next) {
      const target = next.entities.integrations.find(i => i.id === integration.id)!
      if (target.version !== body.expectedVersion) fail(409, 'VERSION_CONFLICT', '整合版本已變更。')
      target.lastTestResult = { demo: true, succeeded: true, summary: '模擬測試成功；固定示範結果，未連線外部系統。', occurredAt: observationTime(next.logicalClock) }
      target.lastSyncAt = observationTime(next.logicalClock); target.state = 'demo'; touch(next, target)
      return { ...ref('integration', target.id), entityVersion: target.version, correlationId: `corr-integration-${next.sequence + 1}`,
        changed: [ref('integration', target.id)], action: 'integration.test', fields: ['lastTestResult', 'lastSyncAt'], projectIds: [], poolIds: target.poolIds, stages: [] }
    } }
  }
  if (input.path !== '/scenarios' || !['post-release-latency', 'recovery-samples'].includes(String((input.body as { scenarioKey?: string })?.scenarioKey))) return undefined
  const body = parse(scenarioInputSchema, input.body)
  if (!body.environmentId || body.jobId || body.runId || body.releaseId || body.poolId) fail(422, 'VALIDATION_ERROR', '觀測情境只能指定 environmentId。')
  const env = s.entities.environments.find(e => e.id === body.environmentId) ?? missing()
  if (!canReadObservation(s, policy, env.id, true)) missing()
  const app = s.entities.applications.find(a => a.id === env.applicationId)!
  return { apply(next) {
    const target = next.entities.environments.find(e => e.id === env.id)!
    if (target.status !== 'ready' || !target.activeReleaseId || !next.entities.releases.some(r => r.id === target.activeReleaseId && r.state === 'succeeded')) invalid()
    if (next.entities.pipelines.some(r => r.environmentId === target.id && !['succeeded', 'failed', 'cancelled'].includes(r.state))
      || next.entities.releases.some(r => r.environmentId === target.id && !['succeeded', 'failed', 'rejected', 'cancelled'].includes(r.state))) fail(409, 'ENVIRONMENT_BUSY', '觀測情境需要沒有進行中發布的環境。')
    const abnormal = body.scenarioKey === 'post-release-latency'
    if (!abnormal && !next.entities.incidents.some(i => i.environmentId === target.id && i.state !== 'resolved')) invalid()
    next.observations.recoveries = next.observations.recoveries.filter(r => r.environmentId !== target.id)
    for (let index = 0; index < 3; index += 1) {
      const fromTick = next.logicalClock; advance(next, 60); appendSyntheticObservation(next, target.id, fromTick, abnormal)
    }
    return { ...ref('environment', target.id), entityVersion: target.version, correlationId: `corr-observation-${next.sequence + 1}`,
      changed: [ref('environment', target.id)], action: `demo.scenario.${body.scenarioKey}`, fields: ['observations: 3 synthetic one-minute windows; simulated observation time'], projectIds: [app.projectId], poolIds: [], stages: [target.stage] }
  } }
}

import type { Environment, Snapshot, ServiceSource, TrafficDistribution } from './schemas'
import { DomainError } from './errors'
const fail = (status: number, code: string, message: string): never => { throw new DomainError(status, code, message) }

export const serviceSources = (s: Snapshot): ServiceSource[] => [...s.entities.pipelineDefinitions, ...s.entities.serviceConfigs, ...s.entities.trafficPolicies]
export const serviceSource = (s: Snapshot, id: string) => serviceSources(s).find(row => row.id === id)
export const serviceTime = (s: Snapshot) => new Date(Date.parse('2026-09-20T09:00:00Z') + s.logicalClock * 1000).toISOString()
export const serviceTouch = (s: Snapshot, row: {version: number; updatedAt: string}) => { row.version++; row.updatedAt = serviceTime(s) }
export const serviceProduction = (s: Snapshot, row: ServiceSource) => row.affectedEnvironmentIds.some(id => s.entities.environments.some(e => e.id === id && e.stage === 'prod'))
export function serviceActive(s: Snapshot, row: ServiceSource): ServiceSource | undefined {
  return serviceSources(s).find(other => other.sourceType === row.sourceType && other.state === 'active'
    && (row.sourceType === 'pipelineDefinition' ? other.sourceType === 'pipelineDefinition' && other.familyId === row.familyId
      : other.sourceType !== 'pipelineDefinition' && other.environmentId === row.environmentId))
}
export function executionLocks(s: Snapshot, environmentId: string): string[] {
  const runs = s.entities.pipelines.filter(r => r.environmentId === environmentId && !['succeeded', 'failed', 'cancelled'].includes(r.state))
  const releases = s.entities.releases.filter(r => r.environmentId === environmentId && !['succeeded', 'failed', 'rejected', 'cancelled'].includes(r.state))
  return [...new Set([...runs.map(r => r.releaseId ?? r.id), ...releases.map(r => r.id),
    ...s.entities.serviceExecutions.filter(e => e.environmentId === environmentId && ['queued', 'running'].includes(e.state)).map(e => e.id)])]
}
export function assertEnvironmentAvailable(s: Snapshot, env: Environment) {
  if (env.status !== 'ready') fail(409, 'INVALID_STATE', '只有就緒的環境可以執行。')
  if (executionLocks(s, env.id).length) fail(409, 'ENVIRONMENT_BUSY', '此環境已有進行中的執行，請等待終態。')
}
export function effectiveTraffic(s: Snapshot, environmentId: string): TrafficDistribution {
  const executions = s.entities.serviceExecutions.filter(e => e.kind === 'traffic' && e.environmentId === environmentId)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const latest = executions[0]
  if (latest?.kind === 'traffic') {
    const checkpoint = latest.checkpoints.at(-1)
    return checkpoint ? { origin: 'checkpoint', policyId: latest.sourceId, executionId: latest.id, checkpointId: checkpoint.id,
      weights: structuredClone(checkpoint.weights), verifiedAt: checkpoint.verifiedAt } : structuredClone(latest.priorDistribution)
  }
  const env = s.entities.environments.find(e => e.id === environmentId)
  const release = s.entities.releases.find(r => r.id === env?.activeReleaseId && r.environmentId === environmentId && r.state === 'succeeded' && r.health === 'healthy')
  return { origin: release ? 'activeReleaseFallback' : 'unknown', policyId: null, executionId: null, checkpointId: null,
    weights: release ? [{ releaseId: release.id, weight: 100 }] : [], verifiedAt: null }
}
export function configDiff(before: Snapshot['entities']['serviceConfigs'][number] | undefined, after: Snapshot['entities']['serviceConfigs'][number]) {
  const left = before?.spec.entries ?? [], right = after.spec.entries
  return [...new Set([...left, ...right].map(e => e.key))].sort().flatMap(key => {
    const a = left.find(e => e.key === key) ?? null, b = right.find(e => e.key === key) ?? null
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ key, change: !a ? 'added' as const : !b ? 'removed' as const : 'changed' as const, before: a, after: b }]
  })
}

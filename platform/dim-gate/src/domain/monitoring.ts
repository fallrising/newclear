import type { Policy } from './policy'
import type { AlertRule, MonitorPolicy, MonitoringTarget, SLOPolicy, Snapshot } from './schema-models'
import { fail, notFound, forbidden } from './engine-shared'

export const monitoringNow = (s: Snapshot) => new Date(Date.parse('2026-09-20T09:00:00Z') + s.logicalClock * 1000).toISOString()
export const monitoringUnit = { rate: 'requests/second', errorRate: 'fraction', p95Latency: 'ms', cpuUtilization: 'fraction', memoryUtilization: 'fraction' } as const
export function monitorTarget(s: Snapshot, monitor: MonitorPolicy): MonitoringTarget { return monitor.spec.target }
export function ruleTarget(s: Snapshot, rule: AlertRule): MonitoringTarget {
  return s.entities.monitorPolicies.find(item => item.id === rule.spec.monitorPolicyId && item.orgId === rule.orgId)?.spec.target ?? notFound()
}
export function targetScope(s: Snapshot, target: MonitoringTarget) {
  if (target.kind === 'service') {
    const env = s.entities.environments.find(e => e.id === target.environmentId && e.applicationId === target.applicationId)
    const app = env && s.entities.applications.find(a => a.id === env.applicationId && a.orgId === env.orgId)
    if (!env || !app) return undefined
    return { orgId: env.orgId, projectId: app.projectId, stage: env.stage, poolId: undefined, target }
  }
  const ci = s.entities.cis.find(c => c.id === target.ciId)
  return ci ? { orgId: ci.orgId, projectId: undefined, stage: undefined, poolId: ci.poolId, target } : undefined
}
export function canReadTarget(s: Snapshot, p: Policy, target: MonitoringTarget): boolean {
  const scope = targetScope(s, target)
  if (!scope || scope.orgId !== p.user?.orgId) return false
  if (target.kind === 'service') return p.hasProject(scope.projectId!, scope.stage, 'rd') || p.hasProject(scope.projectId!, scope.stage, 'ops')
  return p.poolIds.includes(scope.poolId!)
}
export function canWriteTarget(s: Snapshot, p: Policy, target: MonitoringTarget): boolean {
  const scope = targetScope(s, target)
  if (!scope || scope.orgId !== p.user?.orgId) return false
  return target.kind === 'service' ? p.hasProject(scope.projectId!, scope.stage, 'rd') : p.poolIds.includes(scope.poolId!)
}
export function canApproveTarget(s: Snapshot, p: Policy, target: MonitoringTarget): boolean {
  const scope = targetScope(s, target)
  return !!scope && scope.orgId === p.user?.orgId && target.kind === 'service' && scope.stage === 'prod'
    && p.hasProject(scope.projectId!, scope.stage, 'ops')
}
export function requireTarget(s: Snapshot, p: Policy, target: MonitoringTarget, mode: 'read' | 'write' | 'approve'): ReturnType<typeof targetScope> {
  const scope = targetScope(s, target)
  if (!scope || scope.orgId !== p.user?.orgId || mode === 'read' && !canReadTarget(s, p, target)) notFound()
  if (mode === 'write' && !canWriteTarget(s, p, target) || mode === 'approve' && !canApproveTarget(s, p, target)) forbidden()
  return scope!
}
export function validateMonitorSpec(s: Snapshot, spec: MonitorPolicy['spec']) {
  const service = spec.target.kind === 'service'
  if (spec.source !== (service ? 'demo-red' : 'demo-ci') || spec.sampleIntervalSeconds !== 60
    || spec.freshnessSeconds < spec.sampleIntervalSeconds
    || spec.metrics.some(metric => service ? !['rate', 'errorRate', 'p95Latency'].includes(metric) : !['cpuUtilization', 'memoryUtilization'].includes(metric)))
    fail(422, 'VALIDATION_ERROR', '監控來源、目標、指標或採樣間隔不相容。')
  if (!targetScope(s, spec.target)) notFound()
}
export function validateRuleSpec(s: Snapshot, spec: AlertRule['spec']) {
  const monitor = s.entities.monitorPolicies.find(m => m.id === spec.monitorPolicyId) ?? notFound()
  validateMonitorSpec(s, monitor.spec)
  if (!monitor.spec.metrics.includes(spec.metric) || spec.unit !== monitoringUnit[spec.metric]
    || spec.windowSeconds < monitor.spec.sampleIntervalSeconds || spec.windowSeconds % monitor.spec.sampleIntervalSeconds !== 0
    || spec.windowSeconds > 3600 || spec.requiredConsecutiveSamples * monitor.spec.sampleIntervalSeconds > spec.windowSeconds
    || spec.metric === 'errorRate' && spec.threshold > 1 || spec.metric.endsWith('Utilization') && spec.threshold > 1
    || spec.channelRef !== (monitor.spec.target.kind === 'service' ? 'demo-rd' : 'demo-ops'))
    fail(422, 'VALIDATION_ERROR', '告警規則與監控來源、指標、單位或固定通知渠道不相容。')
  return monitor
}
export function activeSpec(item: MonitorPolicy): MonitorPolicy['spec'] | undefined
export function activeSpec(item: AlertRule): AlertRule['spec'] | undefined
export function activeSpec(item: SLOPolicy): SLOPolicy['spec'] | undefined
export function activeSpec(item: MonitorPolicy | AlertRule | SLOPolicy) {
  return item.activeRevision === null ? undefined : item.revisions.find(r => r.revision === item.activeRevision)?.spec
}

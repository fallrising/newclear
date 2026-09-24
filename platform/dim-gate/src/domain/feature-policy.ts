import type { SessionView, Snapshot } from './schema-models'
import type { Policy } from './policy'
import type { FeatureSpec } from './feature-models'
import type { CommandInput } from './command-input-schemas'

export const featureRegistry = {
  'rd.monitoring': { center: 'rd', action: 'monitorPolicy.read', route: '/rd/apps/:appId/monitoring', capabilityId: 'service-monitoring', schemaId: 'MonitorPolicy' },
  'ops.alerting': { center: 'ops', action: 'alertRule.read', route: '/ops/alerting', capabilityId: 'alert-operation', schemaId: 'AlertRule' },
  'rd.delivery': { center: 'rd', action: 'pipelineDefinition.read', route: '/rd/apps/:appId/delivery', capabilityId: 'service-delivery', schemaId: 'PipelineDefinition' },
  'rd.traffic': { center: 'rd', action: 'trafficPolicy.read', route: '/rd/apps/:appId/traffic', capabilityId: 'traffic-policy', schemaId: 'TrafficPolicy' },
} as const

export type FeatureKey = keyof typeof featureRegistry

/** Domain preparation still checks current actor and resource scope before an old receipt can replay. */
export function existingCommandReceipt(snapshot: Snapshot, input: CommandInput): boolean {
  return snapshot.idempotency.some(row => row.sessionId === input.sessionId && row.actorId === input.actorId
    && row.method === input.method.toUpperCase() && row.path === input.path && row.key === input.key)
}

/** FNV-1a over code points is deterministic across refresh, rendering and list order. */
export function cohortBucket(userId: string, featureKey: FeatureKey, saltVersion: number): number {
  let hash = 2166136261
  for (const char of `${userId}:${featureKey}:${saltVersion}`) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0
  return hash % 100
}

export function featureEligibility(snapshot: Snapshot, policy: Policy, key: FeatureKey, projectId?: string) {
  const registry = featureRegistry[key]
  if (!policy.user || !policy.effectiveActions.includes(registry.action))
    return { eligible: false, reason: 'underlying-grant' as const }
  if (projectId && !policy.hasProject(projectId, undefined, registry.center)) return { eligible: false, reason: 'project-grant' as const }
  const feature = snapshot.entities.platformFeatures.find(row => row.orgId === policy.user!.orgId && row.spec.featureKey === key)
  if (!feature) return { eligible: true, reason: 'default-available' as const }
  if (feature.status === 'disabled') return { eligible: false, reason: 'inactive-policy' as const }
  if (feature.activeRevision === null) return feature.everActivated
    ? { eligible: false, reason: 'inactive-policy' as const }
    : { eligible: true, reason: 'default-available' as const }
  const active = feature.revisions.find(row => row.revision === feature.activeRevision)?.spec
  if (!active) return { eligible: false, reason: 'missing-active-revision' as const }
  if (active.eligibleProjectIds.length && (projectId
    ? !active.eligibleProjectIds.includes(projectId)
    : !active.eligibleProjectIds.some(id => policy.hasProject(id, undefined, registry.center))))
    return { eligible: false, reason: 'project-cohort' as const }
  if (active.eligibleTeamIds.length && !active.eligibleTeamIds.some(id => policy.user!.teamIds.includes(id)))
    return { eligible: false, reason: 'team-cohort' as const }
  if (cohortBucket(policy.user.id, key, active.saltVersion) >= active.rolloutPercent)
    return { eligible: false, reason: 'percentage-cohort' as const }
  return { eligible: true, reason: 'active-cohort' as const }
}

/** UI preview of the same current project cohort used by domain commands. */
export function sessionFeatureAvailable(session: Pick<SessionView, 'featureKeys' | 'featureKeysByProject'>, key: FeatureKey, projectId?: string): boolean {
  if (projectId && session.featureKeysByProject) return session.featureKeysByProject[projectId]?.includes(key) ?? false
  return !session.featureKeys || session.featureKeys.includes(key)
}

export function featureSpecSupported(spec: FeatureSpec): boolean {
  return featureRegistry[spec.featureKey].center === spec.targetCenter
}

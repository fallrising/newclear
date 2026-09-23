import type { Snapshot } from './schema-models'
import type { Policy } from './policy'
import type { FeatureSpec } from './feature-models'

export const featureRegistry = {
  'rd.monitoring': { center: 'rd', action: 'monitorPolicy.read', route: '/rd/apps/:appId/monitoring', capabilityId: 'service-monitoring' },
  'ops.alerting': { center: 'ops', action: 'alertRule.read', route: '/ops/alerting', capabilityId: 'alert-operation' },
  'rd.delivery': { center: 'rd', action: 'pipelineDefinition.read', route: '/rd/apps/:appId/delivery', capabilityId: 'service-delivery' },
  'rd.traffic': { center: 'rd', action: 'trafficPolicy.read', route: '/rd/apps/:appId/traffic', capabilityId: 'traffic-policy' },
} as const

export type FeatureKey = keyof typeof featureRegistry

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
  if (feature.status === 'disabled' || feature.activeRevision === null) return { eligible: false, reason: 'inactive-policy' as const }
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

export function featureSpecSupported(spec: FeatureSpec): boolean {
  return featureRegistry[spec.featureKey].center === spec.targetCenter
}

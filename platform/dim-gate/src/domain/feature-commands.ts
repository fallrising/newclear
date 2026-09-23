import { z } from 'zod'
import type { CommandInput } from './command-input-schemas'
import type { FeatureSpec, PlatformFeature } from './feature-models'
import { featureSpecSupported } from './feature-policy'
import { createFeatureInputSchema, reviseFeatureInputSchema, featureActionInputSchema, restoreFeatureInputSchema } from './feature-input-schemas'
import type { Snapshot } from './schema-models'
import type { Policy } from './policy'
import { clockIso, fail, forbidden, notFound, parse } from './engine-shared'

function validateSpec(snapshot: Snapshot, spec: FeatureSpec, orgId: string) {
  if (!featureSpecSupported(spec)) fail(422, 'VALIDATION_ERROR', '功能與目標工作區不相容。')
  if (!spec.eligibleProjectIds.every(id => snapshot.entities.projects.some(row => row.id === id && row.orgId === orgId))
    || !spec.eligibleTeamIds.every(id => snapshot.entities.teams.some(row => row.id === id && row.orgId === orgId)))
    fail(422, 'VALIDATION_ERROR', 'cohort 包含不存在的專案或團隊。')
}

function changedSpecFields(previous: FeatureSpec, next: FeatureSpec) {
  return (['eligibleProjectIds', 'eligibleTeamIds', 'rolloutPercent', 'saltVersion'] as const)
    .filter(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
    .map(key => `spec.${key}`)
}

export function prepareFeature(snapshot: Snapshot, policy: Policy, input: CommandInput) {
  if (input.method.toUpperCase() !== 'POST') return undefined
  const create = input.path === '/admin/platform-features'
  const match = /^\/admin\/platform-features\/([^/]+)\/(revisions|validate|activate|disable|restore)$/.exec(input.path)
  if (!create && !match) return undefined
  const action = match?.[2]
  const body = parse(create ? createFeatureInputSchema : action === 'revisions' ? reviseFeatureInputSchema
    : action === 'restore' ? restoreFeatureInputSchema : featureActionInputSchema, input.body)
  if (!policy.admin) forbidden()
  const old = match ? snapshot.entities.platformFeatures.find(row => row.id === match[1] && row.orgId === policy.user!.orgId) ?? notFound() : undefined
  return { body, apply(next: Snapshot) {
    const now = clockIso(next.logicalClock)
    let feature: PlatformFeature
    let fields: string[]
    let reasonText: string
    if (create) {
      const inputBody = body as z.infer<typeof createFeatureInputSchema>
      validateSpec(next, inputBody.spec, policy.user!.orgId)
      if (next.entities.platformFeatures.some(row => row.orgId === policy.user!.orgId && row.spec.featureKey === inputBody.spec.featureKey))
        fail(409, 'DUPLICATE_RESOURCE', '此功能已有治理政策。')
      const id = `w5-feature-${String(next.sequence + 1).padStart(4, '0')}`
      if (next.entities.platformFeatures.some(row => row.id === id)) fail(409, 'DUPLICATE_RESOURCE', '功能政策 ID 已存在。')
      feature = { id, orgId: policy.user!.orgId, version: 1, createdAt: now, updatedAt: now,
        revision: 1, activeRevision: null, status: 'draft', requesterId: input.actorId, spec: inputBody.spec,
        revisions: [{ revision: 1, spec: inputBody.spec, reason: inputBody.reason, actorId: input.actorId, occurredAt: now }] }
      next.entities.platformFeatures.push(feature)
      fields = ['draft created']; reasonText = inputBody.reason
    } else {
      feature = next.entities.platformFeatures.find(row => row.id === old!.id)!
      const guarded = body as z.infer<typeof featureActionInputSchema>
      if (guarded.expectedVersion !== feature.version) fail(409, 'VERSION_CONFLICT', '功能政策版本已變更。')
      reasonText = guarded.reason
      if (action === 'revisions') {
        const revision = body as z.infer<typeof reviseFeatureInputSchema>
        validateSpec(next, revision.spec, policy.user!.orgId)
        if (revision.spec.featureKey !== feature.spec.featureKey) fail(422, 'VALIDATION_ERROR', '功能 key 不可改變。')
        if (feature.status === 'draft') fail(409, 'INVALID_STATE', '已有待驗證的草稿。')
        fields = ['revision created', ...changedSpecFields(feature.spec, revision.spec)]
        feature.revision += 1; feature.spec = revision.spec; feature.status = 'draft'; feature.requesterId = input.actorId
        feature.revisions.push({ revision: feature.revision, spec: revision.spec, reason: revision.reason, actorId: input.actorId, occurredAt: now })
      } else if (action === 'restore') {
        const restore = body as z.infer<typeof restoreFeatureInputSchema>
        const source = feature.revisions.find(row => row.revision === restore.revision) ?? notFound()
        if (feature.status === 'draft') fail(409, 'INVALID_STATE', '已有待驗證的草稿。')
        fields = ['restored as new revision', ...changedSpecFields(feature.spec, source.spec)]
        feature.revision += 1; feature.spec = structuredClone(source.spec); feature.status = 'draft'; feature.requesterId = input.actorId
        feature.revisions.push({ revision: feature.revision, spec: feature.spec, reason: restore.reason, actorId: input.actorId, occurredAt: now })
      } else if (action === 'validate') {
        if (feature.status !== 'draft') fail(409, 'INVALID_STATE', '只有草稿可驗證。')
        validateSpec(next, feature.spec, policy.user!.orgId)
        feature.status = 'validated'; fields = ['validated']
      } else if (action === 'activate') {
        if (feature.status !== 'validated') fail(409, 'INVALID_STATE', '只有已驗證的功能可啟用。')
        validateSpec(next, feature.spec, policy.user!.orgId)
        feature.status = 'active'; feature.activeRevision = feature.revision; next.policyVersion += 1
        fields = ['activeRevision', 'status']
      } else {
        if (feature.activeRevision === null || feature.status === 'disabled') fail(409, 'INVALID_STATE', '目前沒有可停用的啟用版本。')
        feature.status = 'disabled'; feature.activeRevision = null; next.policyVersion += 1
        fields = ['status', 'activeRevision']
      }
      feature.version += 1; feature.updatedAt = now
    }
    return { entityType: 'platformFeature', entityId: feature.id, entityVersion: feature.version,
      correlationId: `corr-${feature.id}`, changed: [{ entityType: 'platformFeature', entityId: feature.id }],
      operationId: undefined as string | undefined,
      action: `platformFeature.${create ? 'create' : action}`, fields, reason: reasonText,
      projectIds: feature.spec.eligibleProjectIds, poolIds: [], stages: [] as ('dev' | 'staging' | 'prod')[] }
  } }
}

import { z } from 'zod'
import { idSchema, timestampSchema, versionSchema } from './schema-primitives.ts'

const ids = z.array(idSchema).refine(values => new Set(values).size === values.length, 'IDs must be unique')
export const featureKeySchema = z.enum(['rd.monitoring', 'ops.alerting', 'rd.delivery', 'rd.traffic'])
export const featureSpecSchema = z.strictObject({
  featureKey: featureKeySchema, targetCenter: z.enum(['rd', 'ops']),
  eligibleProjectIds: ids, eligibleTeamIds: ids,
  rolloutPercent: z.number().int().min(0).max(100), saltVersion: versionSchema,
})
export const featureRevisionSchema = z.strictObject({ revision: versionSchema, spec: featureSpecSchema,
  reason: z.string().trim().min(1).max(500), actorId: idSchema, occurredAt: timestampSchema })
export const platformFeatureSchema = z.strictObject({
  id: idSchema, orgId: idSchema, version: versionSchema, createdAt: timestampSchema, updatedAt: timestampSchema,
  revision: versionSchema, activeRevision: versionSchema.nullable(), status: z.enum(['draft', 'validated', 'active', 'disabled']),
  requesterId: idSchema, spec: featureSpecSchema, revisions: z.array(featureRevisionSchema).min(1),
})
export const featurePreviewSchema = z.strictObject({ policyVersion: versionSchema, featureId: idSchema,
  items: z.array(z.strictObject({ userId: idSchema, eligible: z.boolean(), reason: z.enum([
    'underlying-grant', 'project-grant', 'default-available', 'inactive-policy', 'missing-active-revision',
    'project-cohort', 'team-cohort', 'percentage-cohort', 'active-cohort',
  ]) })) })
export const capabilityRegistryEntrySchema = z.strictObject({ featureKey: featureKeySchema,
  center: z.enum(['rd', 'ops']), action: idSchema, route: z.string().startsWith('/'), capabilityId: idSchema,
  schemaId: idSchema, status: z.literal('mock') })

export type PlatformFeature = z.infer<typeof platformFeatureSchema>
export type FeatureSpec = z.infer<typeof featureSpecSchema>

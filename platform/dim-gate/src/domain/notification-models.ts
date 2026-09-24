import { z } from 'zod'
import { idSchema, nameSchema, timestampSchema, versionSchema } from './schema-primitives.ts'

const ids = z.array(idSchema).refine(values => new Set(values).size === values.length, 'IDs must be unique')
const base = { id: idSchema, orgId: idSchema, version: versionSchema, createdAt: timestampSchema, updatedAt: timestampSchema }
export const channelKindSchema = z.enum(['in_app', 'demo_email', 'demo_webhook'])
/** Metadata labels are never interpreted as an address or endpoint. */
export const safeDestinationLabelSchema = nameSchema.max(80).regex(/^[\p{L}\p{N} ._·-]+$/u)
export const channelSchema = z.strictObject({ ...base, kind: channelKindSchema, destinationLabel: safeDestinationLabelSchema,
  allowedProjectIds: ids, enabled: z.boolean() })
export const templateTextSchema = z.string().trim().min(1).max(200).refine(value => {
  const stripped = value.replace(/\{\{(?:severity|source|time)\}\}/g, '')
  return !/[<>{}]/.test(stripped) && !/javascript:|https?:\/\/|@/i.test(stripped)
}, 'Only severity, source and time placeholders are supported')
export const notificationTemplateRevisionSchema = z.strictObject({ revision: versionSchema,
  subject: templateTextSchema, body: templateTextSchema, reason: z.string().trim().min(1).max(500),
  actorId: idSchema, occurredAt: timestampSchema })
export const notificationTemplateSchema = z.strictObject({ ...base, revision: versionSchema,
  activeRevision: versionSchema.nullable(), status: z.enum(['draft', 'active', 'disabled']),
  subject: templateTextSchema, body: templateTextSchema, revisions: z.array(notificationTemplateRevisionSchema).min(1) })
export const notificationPolicySchema = z.strictObject({ ...base,
  severityChannels: z.array(z.strictObject({ severity: z.enum(['critical', 'warning']), channelIds: ids })).length(2)
    .refine(rows => new Set(rows.map(row => row.severity)).size === rows.length, 'Severity routes must be unique'),
  retentionDays: z.number().int().min(1).max(30), dedupeSeconds: z.number().int().min(60).max(86400),
  maxSilenceHours: z.number().int().min(1).max(24) })
export const notificationSubscriptionSchema = z.strictObject({ ...base, recipientId: idSchema,
  applicationId: idSchema, environmentId: idSchema, channelId: idSchema, enabled: z.boolean() })
export const notificationAttemptSchema = z.strictObject({ ...base, sourceEventId: idSchema,
  sourceKind: z.enum(['w4-delivery', 'synthetic-test']), deliveryId: idSchema.optional(),
  recipientId: idSchema, channelId: idSchema, templateId: idSchema, templateRevision: versionSchema,
  status: z.enum(['queued', 'suppressed', 'delivered', 'failed']), attempt: versionSchema,
  occurredAt: timestampSchema, safeFailureCode: z.enum(['MOCK_DELIVERY_FAILURE', 'SILENCED', 'CHANNEL_REVOKED', 'RECIPIENT_REVOKED']).optional() })
export const notificationAttemptViewSchema = z.strictObject({ attempt: notificationAttemptSchema,
  sourceLabel: z.string().max(120), sourceTime: timestampSchema, mock: z.literal(true) })

export type Channel = z.infer<typeof channelSchema>
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>
export type NotificationPolicy = z.infer<typeof notificationPolicySchema>
export type NotificationSubscription = z.infer<typeof notificationSubscriptionSchema>
export type NotificationAttempt = z.infer<typeof notificationAttemptSchema>

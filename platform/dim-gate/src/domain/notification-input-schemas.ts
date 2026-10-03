import { z } from 'zod'
import { idSchema, versionSchema } from './schema-primitives.ts'
import { channelKindSchema, safeDestinationLabelSchema, templateTextSchema, notificationPolicySchema } from './notification-models.ts'

const reason = z.string().trim().min(1).max(500)
const ids = z.array(idSchema).refine(values => new Set(values).size === values.length, 'IDs must be unique')
export const createChannelInputSchema = z.strictObject({ kind: channelKindSchema, destinationLabel: safeDestinationLabelSchema,
  allowedProjectIds: ids, enabled: z.boolean(), reason })
export const patchChannelInputSchema = createChannelInputSchema.extend({ expectedVersion: versionSchema })
export const testChannelInputSchema = z.strictObject({ expectedVersion: versionSchema, simulateFailure: z.boolean(), reason })
export const createNotificationTemplateInputSchema = z.strictObject({ subject: templateTextSchema, body: templateTextSchema, reason })
export const reviseNotificationTemplateInputSchema = createNotificationTemplateInputSchema.extend({ expectedVersion: versionSchema })
export const notificationTemplateActionInputSchema = z.strictObject({ expectedVersion: versionSchema, reason })
export const patchNotificationPolicyInputSchema = notificationPolicySchema.pick({ severityChannels: true, retentionDays: true,
  dedupeSeconds: true, maxSilenceHours: true }).extend({ expectedVersion: versionSchema, reason })
export const createNotificationSubscriptionInputSchema = z.strictObject({ environmentId: idSchema, channelId: idSchema, reason })
export const patchNotificationSubscriptionInputSchema = z.strictObject({ expectedVersion: versionSchema,
  channelId: idSchema, enabled: z.boolean(), reason })
export const retryNotificationAttemptInputSchema = z.strictObject({ expectedVersion: versionSchema, reason })

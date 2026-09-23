import type { Snapshot } from './schema-models'

export function notificationIntegrityErrors(snapshot: Snapshot): string[] {
  const errors: string[] = [], e = snapshot.entities
  const linked = <T extends { id: string; orgId: string }>(rows: readonly T[], id: string, orgId: string) =>
    rows.find(row => row.id === id && row.orgId === orgId)
  for (const channel of e.channels) for (const projectId of channel.allowedProjectIds)
    if (!linked(e.projects, projectId, channel.orgId)) errors.push('channel: invalid project scope')
  for (const template of e.notificationTemplates) {
    if (template.revisions.length !== template.revision || template.revisions.some((row, index) => row.revision !== index + 1))
      errors.push('notificationTemplate: invalid revision lineage')
    const latest = template.revisions.at(-1)
    if (!latest || latest.subject !== template.subject || latest.body !== template.body) errors.push('notificationTemplate: mutable content mismatch')
    if (template.activeRevision !== null && template.activeRevision > template.revision
      || template.status === 'active' && template.activeRevision === null) errors.push('notificationTemplate: invalid active revision')
  }
  if (new Set(e.notificationPolicies.map(row => row.orgId)).size !== e.notificationPolicies.length)
    errors.push('notificationPolicy: duplicate organization policy')
  for (const policy of e.notificationPolicies) for (const route of policy.severityChannels)
    for (const channelId of route.channelIds) if (!linked(e.channels, channelId, policy.orgId)) errors.push('notificationPolicy: invalid channel')
  if (new Set(e.notificationSubscriptions.map(row => `${row.orgId}:${row.recipientId}:${row.environmentId}:${row.channelId}`)).size !== e.notificationSubscriptions.length)
    errors.push('notificationSubscription: duplicate recipient/target/channel')
  for (const subscription of e.notificationSubscriptions) {
    const app = linked(e.applications, subscription.applicationId, subscription.orgId)
    const env = linked(e.environments, subscription.environmentId, subscription.orgId)
    if (!app || !env || !('applicationId' in env) || env.applicationId !== app.id
      || !linked(e.users, subscription.recipientId, subscription.orgId)
      || !linked(e.channels, subscription.channelId, subscription.orgId)) errors.push('notificationSubscription: invalid target or recipient')
  }
  const attempts = new Set<string>()
  for (const attempt of e.notificationAttempts) {
    if (!linked(e.users, attempt.recipientId, attempt.orgId) || !linked(e.channels, attempt.channelId, attempt.orgId)
      || !linked(e.notificationTemplates, attempt.templateId, attempt.orgId)) errors.push('notificationAttempt: invalid recipient/channel/template')
    const template = linked(e.notificationTemplates, attempt.templateId, attempt.orgId)
    if (template && attempt.templateRevision > template.revision) errors.push('notificationAttempt: invalid template revision')
    const delivery = attempt.deliveryId && linked(e.notificationDeliveries, attempt.deliveryId, attempt.orgId)
    if (attempt.sourceKind === 'w4-delivery' ? !delivery || attempt.sourceEventId !== attempt.deliveryId
      : attempt.deliveryId !== undefined) errors.push('notificationAttempt: invalid source')
    if (attempt.status === 'failed' && attempt.safeFailureCode !== 'MOCK_DELIVERY_FAILURE'
      || attempt.status === 'delivered' && attempt.safeFailureCode !== undefined
      || attempt.status === 'suppressed' && attempt.safeFailureCode !== 'SILENCED') errors.push('notificationAttempt: invalid status code')
    const key = `${attempt.sourceEventId}:${attempt.recipientId}:${attempt.channelId}:${attempt.templateRevision}:${attempt.attempt}`
    if (attempts.has(key)) errors.push('notificationAttempt: duplicate logical attempt')
    attempts.add(key)
  }
  return errors
}

import type { NotificationAttempt, NotificationDelivery, Snapshot } from './schema-models'
import { demoPersonaIds, policyFor } from './policy'
import { targetScope } from './monitoring'
import { allowedChannel } from './notification-eligibility'

function activeTemplate(snapshot: Snapshot, orgId: string) {
  return snapshot.entities.notificationTemplates.find(row => row.orgId === orgId && row.status !== 'disabled' && row.activeRevision !== null)
}

export function recordNotificationAttempt(snapshot: Snapshot, input: Omit<NotificationAttempt, 'id' | 'version' | 'createdAt' | 'updatedAt'>) {
  snapshot.sequence += 1
  const serial = String(snapshot.sequence).padStart(4, '0'), id = `w5-attempt-${serial}`
  const attempt: NotificationAttempt = { ...input, id, version: 1, createdAt: input.occurredAt, updatedAt: input.occurredAt }
  snapshot.entities.notificationAttempts.push(attempt)
  return attempt
}

/** Dispatch derives recipients and scope at this tick and persists references only, never an old payload. */
export function dispatchNotification(snapshot: Snapshot, delivery: NotificationDelivery): NotificationAttempt[] {
  if (delivery.status === 'queued') return []
  const template = activeTemplate(snapshot, delivery.orgId)
  const scope = targetScope(snapshot, delivery.target)
  if (!template || !scope) return []
  const serviceTarget = delivery.target.kind === 'service' ? delivery.target : undefined
  const dedupeSeconds = snapshot.entities.notificationPolicies.find(row => row.orgId === delivery.orgId)?.dedupeSeconds ?? 0
  const candidates = serviceTarget
    ? snapshot.entities.notificationSubscriptions.filter(row => row.orgId === delivery.orgId && row.enabled
      && row.applicationId === serviceTarget.applicationId && row.environmentId === serviceTarget.environmentId)
      .map(row => ({ recipientId: row.recipientId, channelId: row.channelId }))
    : [...demoPersonaIds].filter(id => {
      const policy = policyFor(snapshot, id)
      return policy.user?.orgId === delivery.orgId && policy.centers.includes('ops') && policy.poolIds.includes(scope.poolId!)
    }).map(recipientId => ({ recipientId, channelId: delivery.channelRef }))
  const added: NotificationAttempt[] = []
  for (const candidate of candidates) {
    if (!allowedChannel(snapshot, delivery, candidate.channelId)) continue
    const recipient = policyFor(snapshot, candidate.recipientId)
    const eligible = delivery.target.kind === 'service'
      ? recipient.hasProject(scope.projectId!, scope.stage, 'rd')
      : recipient.centers.includes('ops') && recipient.poolIds.includes(scope.poolId!)
    if (!recipient.user || !eligible) continue
    const tuple = (row: NotificationAttempt) => row.sourceEventId === delivery.id && row.recipientId === candidate.recipientId
      && row.channelId === candidate.channelId && row.templateRevision === template.activeRevision
    if (snapshot.entities.notificationAttempts.some(tuple)) continue
    // A new W4 delivery for the same incident can be coalesced only within the configured window.
    if (snapshot.entities.notificationAttempts.some(row => row.sourceKind === 'w4-delivery' && row.attempt === 1
      && row.recipientId === candidate.recipientId && row.channelId === candidate.channelId
      && row.templateRevision === template.activeRevision
      && snapshot.entities.notificationDeliveries.some(prior => prior.id === row.deliveryId && prior.incidentId === delivery.incidentId)
      && Date.parse(delivery.updatedAt) >= Date.parse(row.occurredAt)
      && Date.parse(delivery.updatedAt) - Date.parse(row.occurredAt) < dedupeSeconds * 1000)) continue
    const status = delivery.status
    const safeFailureCode = status === 'failed' ? 'MOCK_DELIVERY_FAILURE' as const
      : status === 'suppressed' ? 'SILENCED' as const : undefined
    const attempt = recordNotificationAttempt(snapshot, { orgId: delivery.orgId, sourceEventId: delivery.id,
      sourceKind: 'w4-delivery', deliveryId: delivery.id, recipientId: candidate.recipientId,
      channelId: candidate.channelId, templateId: template.id, templateRevision: template.activeRevision!,
      status, attempt: 1, occurredAt: delivery.updatedAt, ...(safeFailureCode ? { safeFailureCode } : {}) })
    const serial = attempt.id.slice('w5-attempt-'.length)
    snapshot.events.push({ eventId: `event-${serial}`, type: `notificationAttempt.${status}`,
      entities: [{ entityType: 'notificationAttempt', entityId: attempt.id }], occurredAt: attempt.occurredAt,
      correlationId: delivery.correlationId })
    snapshot.audit.push({ id: `audit-${serial}`, orgId: delivery.orgId, actorId: 'demo-scheduler',
      action: `notificationAttempt.${status}`, entityType: 'notificationAttempt', entityId: attempt.id,
      scopeSnapshot: { projectIds: scope.projectId ? [scope.projectId] : [], poolIds: scope.poolId ? [scope.poolId] : [],
        stages: scope.stage ? [scope.stage] : [] }, outcome: 'succeeded', diffSummary: ['status'],
      requestId: `scheduler-${serial}`, correlationId: delivery.correlationId, occurredAt: attempt.occurredAt })
    added.push(attempt)
  }
  return added
}

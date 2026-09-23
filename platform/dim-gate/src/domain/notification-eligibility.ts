import type { NotificationAttempt, NotificationDelivery, Snapshot } from './schema-models'
import { policyFor } from './policy'
import { targetScope } from './monitoring'

export function allowedChannel(snapshot: Snapshot, delivery: NotificationDelivery, channelId: string) {
  const incident = snapshot.entities.incidents.find(row => row.id === delivery.incidentId)
    ?? snapshot.entities.infrastructureIncidents.find(row => row.id === delivery.incidentId)
  const policy = snapshot.entities.notificationPolicies.find(row => row.orgId === delivery.orgId)
  const channel = snapshot.entities.channels.find(row => row.id === channelId && row.orgId === delivery.orgId)
  const scope = targetScope(snapshot, delivery.target)
  if (!incident || !policy || !channel?.enabled || !scope) return undefined
  if (!policy.severityChannels.find(row => row.severity === incident.severity)?.channelIds.includes(channelId)) return undefined
  if (delivery.target.kind === 'service' && !channel.allowedProjectIds.includes(scope.projectId!)) return undefined
  return channel
}

export function currentlyDeliverable(snapshot: Snapshot, attempt: NotificationAttempt) {
  if (attempt.sourceKind === 'synthetic-test') {
    const policy = policyFor(snapshot, attempt.recipientId)
    return !!policy.admin && !!snapshot.entities.channels.find(row => row.id === attempt.channelId && row.enabled)
  }
  const delivery = snapshot.entities.notificationDeliveries.find(row => row.id === attempt.deliveryId)
  if (!delivery || !allowedChannel(snapshot, delivery, attempt.channelId)) return false
  const scope = targetScope(snapshot, delivery.target)
  const recipient = policyFor(snapshot, attempt.recipientId)
  if (!scope || !recipient.user) return false
  if (delivery.target.kind === 'service') {
    const environmentId = delivery.target.environmentId
    return recipient.hasProject(scope.projectId!, scope.stage, 'rd')
    && snapshot.entities.notificationSubscriptions.some(row => row.recipientId === attempt.recipientId
      && row.environmentId === environmentId && row.channelId === attempt.channelId && row.enabled)
  }
  return recipient.centers.includes('ops') && recipient.poolIds.includes(scope.poolId!)
}

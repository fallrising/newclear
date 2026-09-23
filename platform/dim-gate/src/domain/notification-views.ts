import type { NotificationAttempt, Snapshot } from './schema-models'
import type { Policy } from './policy'
import { targetScope } from './monitoring'
import { clockIso, fail, forbidden, notFound } from './engine-shared'
import { currentlyDeliverable } from './notification-eligibility'
import { basicPage, validateQuery } from './read-query'

export function canReadAttempt(snapshot: Snapshot, policy: Policy, attempt: NotificationAttempt): boolean {
  if (!policy.user || attempt.orgId !== policy.user.orgId) return false
  const retentionDays = snapshot.entities.notificationPolicies.find(row => row.orgId === attempt.orgId)?.retentionDays ?? 0
  if (Date.parse(clockIso(snapshot.logicalClock)) - Date.parse(attempt.occurredAt) > retentionDays * 86_400_000) return false
  if (attempt.sourceKind === 'synthetic-test') return policy.admin && attempt.recipientId === policy.user.id
  if (!currentlyDeliverable(snapshot, attempt)) return false
  const delivery = snapshot.entities.notificationDeliveries.find(row => row.id === attempt.deliveryId && row.orgId === policy.user!.orgId)
  if (!delivery) return false
  const scope = targetScope(snapshot, delivery.target)
  if (!scope) return false
  if (delivery.target.kind === 'service') return attempt.recipientId === policy.user.id
    && policy.hasProject(scope.projectId!, scope.stage, 'rd')
  return policy.centers.includes('ops') && policy.poolIds.includes(scope.poolId!)
}

export function attemptView(snapshot: Snapshot, attempt: NotificationAttempt) {
  if (attempt.sourceKind === 'synthetic-test') return { attempt, sourceLabel: 'Safe Demo test event', sourceTime: attempt.occurredAt, mock: true as const }
  const delivery = snapshot.entities.notificationDeliveries.find(row => row.id === attempt.deliveryId)!
  const target = delivery.target
  const sourceLabel = target.kind === 'service'
    ? snapshot.entities.applications.find(row => row.id === target.applicationId)?.name ?? 'Demo service'
    : snapshot.entities.cis.find(row => row.id === target.ciId)?.name ?? 'Demo infrastructure'
  return { attempt, sourceLabel, sourceTime: delivery.occurredAt, mock: true as const }
}

export function readNotifications(snapshot: Snapshot, policy: Policy, path: string, query: URLSearchParams): unknown {
  const e = snapshot.entities
  if (path === '/admin/channels') {
    validateQuery(query, [])
    if (!policy.admin) forbidden()
    return e.channels.filter(row => row.orgId === policy.user!.orgId)
  }
  if (path === '/admin/notification-templates') {
    validateQuery(query, [])
    if (!policy.admin) forbidden()
    return e.notificationTemplates.filter(row => row.orgId === policy.user!.orgId)
  }
  if (path === '/admin/notification-policies') {
    validateQuery(query, [])
    if (!policy.admin) forbidden()
    return e.notificationPolicies.filter(row => row.orgId === policy.user!.orgId)
  }
  if (path === '/notification-channels') {
    validateQuery(query, ['environmentId'])
    const environmentId = query.get('environmentId')
    if (!environmentId) fail(422, 'VALIDATION_ERROR', '請指定服務環境。')
    const env = e.environments.find(row => row.id === environmentId && row.orgId === policy.user!.orgId)
    const app = env && e.applications.find(row => row.id === env.applicationId && row.orgId === env.orgId)
    if (!env || !app || !policy.hasProject(app.projectId, env.stage, 'rd')) notFound()
    return e.channels.filter(row => row.orgId === policy.user!.orgId && row.enabled && row.allowedProjectIds.includes(app!.projectId))
      .map(row => ({ ...row, allowedProjectIds: [app!.projectId] }))
  }
  if (path === '/notification-subscriptions') {
    validateQuery(query, ['environmentId', 'page', 'pageSize'])
    const items = e.notificationSubscriptions.filter(row => row.orgId === policy.user!.orgId && row.recipientId === policy.user!.id
      && (!query.get('environmentId') || row.environmentId === query.get('environmentId'))
      && (() => { const env = e.environments.find(item => item.id === row.environmentId)
        const app = env && e.applications.find(item => item.id === env.applicationId)
        return !!env && !!app && policy.hasProject(app.projectId, env.stage, 'rd') })())
      .toSorted((a, b) => a.id.localeCompare(b.id))
    return basicPage(items, query)
  }
  if (path === '/notification-attempts') {
    validateQuery(query, ['status', 'environmentId', 'page', 'pageSize'])
    const status = query.get('status')
    if (status && !['queued', 'suppressed', 'delivered', 'failed'].includes(status)) fail(422, 'VALIDATION_ERROR', '不支援的通知狀態。')
    const items = e.notificationAttempts.filter(row => canReadAttempt(snapshot, policy, row)
      && (!status || row.status === status)
      && (!query.get('environmentId') || row.deliveryId && e.notificationDeliveries.some(delivery => delivery.id === row.deliveryId
        && delivery.target.kind === 'service' && delivery.target.environmentId === query.get('environmentId'))))
      .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id))
    return basicPage(items.map(row => attemptView(snapshot, row)), query)
  }
  const attemptId = /^\/notification-attempts\/([^/]+)$/.exec(path)?.[1]
  if (attemptId) {
    validateQuery(query, [])
    const attempt = e.notificationAttempts.find(row => row.id === attemptId && canReadAttempt(snapshot, policy, row))
    return attempt ? attemptView(snapshot, attempt) : notFound()
  }
  return undefined
}

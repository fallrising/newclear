import { z } from 'zod'
import type { CommandInput } from './command-input-schemas'
import type { Snapshot } from './schema-models'
import type { Policy } from './policy'
import { clockIso, fail, forbidden, notFound, parse } from './engine-shared'
import { targetScope } from './monitoring'
import { canReadAttempt } from './notification-views'
import { currentlyDeliverable } from './notification-eligibility'
import { recordNotificationAttempt } from './notification-dispatch'
import { createChannelInputSchema, patchChannelInputSchema, testChannelInputSchema,
  createNotificationTemplateInputSchema, reviseNotificationTemplateInputSchema, notificationTemplateActionInputSchema,
  patchNotificationPolicyInputSchema, createNotificationSubscriptionInputSchema,
  patchNotificationSubscriptionInputSchema, retryNotificationAttemptInputSchema } from './notification-input-schemas'

type Effect = { entityType: string; entityId: string; entityVersion: number; correlationId: string;
  changed: { entityType: string; entityId: string }[]; operationId: string | undefined;
  action: string; fields: string[]; reason: string; projectIds: string[]; poolIds: string[]; stages: ('dev' | 'staging' | 'prod')[] }
const result = (entityType: string, entityId: string, entityVersion: number, action: string, fields: string[], reason: string,
  projectIds: string[] = [], poolIds: string[] = [], stages: ('dev' | 'staging' | 'prod')[] = []): Effect => ({
  entityType, entityId, entityVersion, correlationId: `corr-${entityId}`, changed: [{ entityType, entityId }],
  operationId: undefined, action, fields, reason, projectIds, poolIds, stages })
function validProjects(snapshot: Snapshot, ids: string[], orgId: string) {
  if (!ids.every(id => snapshot.entities.projects.some(row => row.id === id && row.orgId === orgId)))
    fail(422, 'VALIDATION_ERROR', '通知 channel 包含未知專案。')
}
function validPolicy(snapshot: Snapshot, routes: z.infer<typeof patchNotificationPolicyInputSchema>['severityChannels'], orgId: string) {
  if (!routes.every(route => route.channelIds.every(id => snapshot.entities.channels.some(row => row.id === id && row.orgId === orgId))))
    fail(422, 'VALIDATION_ERROR', '通知政策引用未知 channel。')
}
function availableChannel(snapshot: Snapshot, channelId: string, orgId: string, projectId: string) {
  return snapshot.entities.channels.find(row => row.id === channelId && row.orgId === orgId && row.enabled
    && row.allowedProjectIds.includes(projectId))
}

export function prepareNotification(snapshot: Snapshot, policy: Policy, input: CommandInput) {
  const method = input.method.toUpperCase(), path = input.path
  const createChannel = method === 'POST' && path === '/admin/channels'
  const channelId = method === 'PATCH' ? /^\/admin\/channels\/([^/]+)$/.exec(path)?.[1] : undefined
  const channelTestId = method === 'POST' ? /^\/admin\/channels\/([^/]+)\/test$/.exec(path)?.[1] : undefined
  const createTemplate = method === 'POST' && path === '/admin/notification-templates'
  const templateMatch = method === 'POST' ? /^\/admin\/notification-templates\/([^/]+)\/(revisions|activate|disable)$/.exec(path) : null
  const policyId = method === 'PATCH' ? /^\/admin\/notification-policies\/([^/]+)$/.exec(path)?.[1] : undefined
  const createSubscription = method === 'POST' && path === '/notification-subscriptions'
  const subscriptionId = method === 'PATCH' ? /^\/notification-subscriptions\/([^/]+)$/.exec(path)?.[1] : undefined
  const retryId = method === 'POST' ? /^\/notification-attempts\/([^/]+)\/retry$/.exec(path)?.[1] : undefined
  if (!createChannel && !channelId && !channelTestId && !createTemplate && !templateMatch && !policyId
    && !createSubscription && !subscriptionId && !retryId) return undefined

  if (createChannel || channelId || channelTestId || createTemplate || templateMatch || policyId) {
    const schema = createChannel ? createChannelInputSchema : channelId ? patchChannelInputSchema : channelTestId ? testChannelInputSchema
      : createTemplate ? createNotificationTemplateInputSchema : templateMatch?.[2] === 'revisions'
        ? reviseNotificationTemplateInputSchema : templateMatch ? notificationTemplateActionInputSchema : patchNotificationPolicyInputSchema
    const body = parse(schema, input.body)
    if (!policy.admin) forbidden()
    const orgId = policy.user!.orgId
    if (createChannel) return { body, apply(next: Snapshot) {
      const value = body as z.infer<typeof createChannelInputSchema>
      validProjects(next, value.allowedProjectIds, orgId)
      const now = clockIso(next.logicalClock), id = `w5-channel-${String(next.sequence + 1).padStart(4, '0')}`
      next.entities.channels.push({ id, orgId, version: 1, createdAt: now, updatedAt: now,
        kind: value.kind, destinationLabel: value.destinationLabel, allowedProjectIds: value.allowedProjectIds, enabled: value.enabled })
      return result('channel', id, 1, 'notification.channel.create', ['kind', 'scope', 'enabled'], value.reason)
    } }
    if (channelId) {
      const original = snapshot.entities.channels.find(row => row.id === channelId && row.orgId === orgId) ?? notFound()
      return { body, apply(next: Snapshot) {
        const value = body as z.infer<typeof patchChannelInputSchema>
        const channel = next.entities.channels.find(row => row.id === original.id)!
        if (channel.version !== value.expectedVersion) fail(409, 'VERSION_CONFLICT', 'Channel 版本已變更。')
        validProjects(next, value.allowedProjectIds, orgId)
        Object.assign(channel, { kind: value.kind, destinationLabel: value.destinationLabel, allowedProjectIds: value.allowedProjectIds,
          enabled: value.enabled, version: channel.version + 1, updatedAt: clockIso(next.logicalClock) })
        return result('channel', channel.id, channel.version, 'notification.channel.update', ['kind', 'destinationLabel', 'scope', 'enabled'], value.reason)
      } }
    }
    if (channelTestId) {
      const original = snapshot.entities.channels.find(row => row.id === channelTestId && row.orgId === orgId) ?? notFound()
      return { body, apply(next: Snapshot) {
        const value = body as z.infer<typeof testChannelInputSchema>
        const channel = next.entities.channels.find(row => row.id === original.id)!
        if (channel.version !== value.expectedVersion) fail(409, 'VERSION_CONFLICT', 'Channel 版本已變更。')
        if (!channel.enabled) fail(409, 'INVALID_STATE', '停用的 channel 無法測試。')
        const template = next.entities.notificationTemplates.find(row => row.orgId === orgId && row.activeRevision !== null && row.status !== 'disabled')
          ?? fail(409, 'INVALID_STATE', '目前沒有啟用的安全模板。')
        const now = clockIso(next.logicalClock), sourceEventId = `w5-test-${String(next.sequence + 1).padStart(4, '0')}`
        const attempt = recordNotificationAttempt(next, { orgId, sourceEventId, sourceKind: 'synthetic-test', recipientId: input.actorId,
          channelId: channel.id, templateId: template.id, templateRevision: template.activeRevision!,
          status: value.simulateFailure ? 'failed' : 'delivered', attempt: 1, occurredAt: now,
          ...(value.simulateFailure ? { safeFailureCode: 'MOCK_DELIVERY_FAILURE' as const } : {}) })
        return result('notificationAttempt', attempt.id, attempt.version, 'notification.channel.test', ['status'], value.reason)
      } }
    }
    if (createTemplate) return { body, apply(next: Snapshot) {
      const value = body as z.infer<typeof createNotificationTemplateInputSchema>
      const now = clockIso(next.logicalClock), id = `w5-template-${String(next.sequence + 1).padStart(4, '0')}`
      next.entities.notificationTemplates.push({ id, orgId, version: 1, createdAt: now, updatedAt: now,
        revision: 1, activeRevision: null, status: 'draft', subject: value.subject, body: value.body,
        revisions: [{ revision: 1, subject: value.subject, body: value.body, reason: value.reason, actorId: input.actorId, occurredAt: now }] })
      return result('notificationTemplate', id, 1, 'notification.template.create', ['draft created'], value.reason)
    } }
    if (templateMatch) {
      const old = snapshot.entities.notificationTemplates.find(row => row.id === templateMatch[1] && row.orgId === orgId) ?? notFound()
      const action = templateMatch[2]
      return { body, apply(next: Snapshot) {
        const value = body as z.infer<typeof notificationTemplateActionInputSchema>
        const template = next.entities.notificationTemplates.find(row => row.id === old.id)!
        if (template.version !== value.expectedVersion) fail(409, 'VERSION_CONFLICT', '模板版本已變更。')
        const now = clockIso(next.logicalClock)
        let fields: string[]
        const replaced: string[] = []
        if (action === 'revisions') {
          const revision = body as z.infer<typeof reviseNotificationTemplateInputSchema>
          if (template.status === 'draft') fail(409, 'INVALID_STATE', '已有待啟用草稿。')
          template.revision += 1; template.status = 'draft'; template.subject = revision.subject; template.body = revision.body
          template.revisions.push({ revision: template.revision, subject: revision.subject, body: revision.body,
            reason: revision.reason, actorId: input.actorId, occurredAt: now })
          fields = ['revision', 'subject', 'body']
        } else if (action === 'activate') {
          if (template.status !== 'draft') fail(409, 'INVALID_STATE', '只有草稿可啟用。')
          for (const other of next.entities.notificationTemplates.filter(row => row.orgId === orgId && row.id !== template.id && row.activeRevision !== null)) {
            other.status = 'disabled'; other.activeRevision = null; other.version += 1; other.updatedAt = now
            replaced.push(other.id)
          }
          template.status = 'active'; template.activeRevision = template.revision; fields = ['activeRevision', 'status']
        } else {
          if (template.activeRevision === null || template.status === 'disabled') fail(409, 'INVALID_STATE', '沒有啟用版本。')
          template.status = 'disabled'; template.activeRevision = null; fields = ['status', 'activeRevision']
        }
        template.version += 1; template.updatedAt = now
        const effect = result('notificationTemplate', template.id, template.version, `notification.template.${action}`, fields, value.reason)
        effect.changed.push(...replaced.map(entityId => ({ entityType: 'notificationTemplate', entityId })))
        return effect
      } }
    }
    const old = snapshot.entities.notificationPolicies.find(row => row.id === policyId && row.orgId === orgId) ?? notFound()
    return { body, apply(next: Snapshot) {
      const value = body as z.infer<typeof patchNotificationPolicyInputSchema>
      const entry = next.entities.notificationPolicies.find(row => row.id === old.id)!
      if (entry.version !== value.expectedVersion) fail(409, 'VERSION_CONFLICT', '通知政策版本已變更。')
      validPolicy(next, value.severityChannels, orgId)
      Object.assign(entry, { severityChannels: value.severityChannels, retentionDays: value.retentionDays,
        dedupeSeconds: value.dedupeSeconds, maxSilenceHours: value.maxSilenceHours,
        version: entry.version + 1, updatedAt: clockIso(next.logicalClock) })
      return result('notificationPolicy', entry.id, entry.version, 'notification.policy.update',
        ['severityChannels', 'retentionDays', 'dedupeSeconds', 'maxSilenceHours'], value.reason)
    } }
  }

  if (createSubscription) {
    const body = parse(createNotificationSubscriptionInputSchema, input.body)
    const env = snapshot.entities.environments.find(row => row.id === body.environmentId && row.orgId === policy.user!.orgId)
    const app = env && snapshot.entities.applications.find(row => row.id === env.applicationId && row.orgId === env.orgId)
    if (!env || !app) notFound()
    if (!policy.hasProject(app!.projectId, env!.stage, 'rd')) forbidden()
    if (!availableChannel(snapshot, body.channelId, policy.user!.orgId, app!.projectId)) fail(422, 'VALIDATION_ERROR', 'Channel 不可用於此專案。')
    return { body, apply(next: Snapshot) {
      if (next.entities.notificationSubscriptions.some(row => row.recipientId === input.actorId && row.environmentId === env!.id && row.channelId === body.channelId))
        fail(409, 'DUPLICATE_RESOURCE', '已有相同通知訂閱。')
      const now = clockIso(next.logicalClock), id = `w5-subscription-${String(next.sequence + 1).padStart(4, '0')}`
      next.entities.notificationSubscriptions.push({ id, orgId: policy.user!.orgId, version: 1, createdAt: now, updatedAt: now,
        recipientId: input.actorId, applicationId: app!.id, environmentId: env!.id, channelId: body.channelId, enabled: true })
      return result('notificationSubscription', id, 1, 'notification.subscription.create', ['enabled', 'channelId'],
        body.reason, [app!.projectId], [], [env!.stage])
    } }
  }
  if (subscriptionId) {
    const body = parse(patchNotificationSubscriptionInputSchema, input.body)
    const old = snapshot.entities.notificationSubscriptions.find(row => row.id === subscriptionId && row.orgId === policy.user!.orgId) ?? notFound()
    const env = snapshot.entities.environments.find(row => row.id === old.environmentId)!
    const app = snapshot.entities.applications.find(row => row.id === old.applicationId)!
    if (old.recipientId !== input.actorId || !policy.hasProject(app.projectId, env.stage, 'rd')) forbidden()
    if (body.enabled && !availableChannel(snapshot, body.channelId, old.orgId, app.projectId))
      fail(422, 'VALIDATION_ERROR', 'Channel 不可用於此專案。')
    return { body, apply(next: Snapshot) {
      const row = next.entities.notificationSubscriptions.find(item => item.id === old.id)!
      if (row.version !== body.expectedVersion) fail(409, 'VERSION_CONFLICT', '訂閱版本已變更。')
      if (next.entities.notificationSubscriptions.some(item => item.id !== row.id && item.recipientId === row.recipientId
        && item.environmentId === row.environmentId && item.channelId === body.channelId)) fail(409, 'DUPLICATE_RESOURCE', '已有相同通知訂閱。')
      row.channelId = body.channelId; row.enabled = body.enabled; row.version += 1; row.updatedAt = clockIso(next.logicalClock)
      return result('notificationSubscription', row.id, row.version, 'notification.subscription.update', ['channelId', 'enabled'],
        body.reason, [app.projectId], [], [env.stage])
    } }
  }
  const body = parse(retryNotificationAttemptInputSchema, input.body)
  const old = snapshot.entities.notificationAttempts.find(row => row.id === retryId && row.orgId === policy.user!.orgId)
  if (!old || !canReadAttempt(snapshot, policy, old)) notFound()
  if (old!.recipientId !== input.actorId) forbidden()
  if (!currentlyDeliverable(snapshot, old!)) forbidden()
  return { body, apply(next: Snapshot) {
    const prior = next.entities.notificationAttempts.find(row => row.id === old!.id)!
    if (prior.version !== body.expectedVersion) fail(409, 'VERSION_CONFLICT', '投遞版本已變更。')
    if (prior.status !== 'failed') fail(409, 'INVALID_STATE', '只有失敗的投遞可以重試。')
    const template = next.entities.notificationTemplates.find(row => row.orgId === prior.orgId && row.activeRevision !== null && row.status !== 'disabled')
      ?? fail(409, 'INVALID_STATE', '目前沒有啟用的安全模板。')
    const sequence = Math.max(...next.entities.notificationAttempts.filter(row => row.sourceEventId === prior.sourceEventId
      && row.recipientId === prior.recipientId && row.channelId === prior.channelId).map(row => row.attempt)) + 1
    const attempt = recordNotificationAttempt(next, { orgId: prior.orgId, sourceEventId: prior.sourceEventId,
      sourceKind: prior.sourceKind, ...(prior.deliveryId ? { deliveryId: prior.deliveryId } : {}),
      recipientId: prior.recipientId, channelId: prior.channelId, templateId: template.id,
      templateRevision: template.activeRevision!, status: 'delivered', attempt: sequence, occurredAt: clockIso(next.logicalClock) })
    const scope = prior.deliveryId ? targetScope(next, next.entities.notificationDeliveries.find(row => row.id === prior.deliveryId)!.target) : undefined
    return result('notificationAttempt', attempt.id, attempt.version, 'notification.attempt.retry', ['attempt', 'status'], body.reason,
      scope?.projectId ? [scope.projectId] : [], scope?.poolId ? [scope.poolId] : [], scope?.stage ? [scope.stage] : [])
  } }
}

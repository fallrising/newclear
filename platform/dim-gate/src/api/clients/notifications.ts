import { z } from 'zod'
import { commandReceiptSchema, pageSchema } from '../../domain/schema-models'
import { channelSchema, notificationTemplateSchema, notificationPolicySchema,
  notificationSubscriptionSchema, notificationAttemptViewSchema } from '../../domain/notification-models'
import type { ApiRequest } from '../core/request'
import type { createChannelInputSchema, patchChannelInputSchema, testChannelInputSchema,
  createNotificationTemplateInputSchema, reviseNotificationTemplateInputSchema,
  patchNotificationPolicyInputSchema, createNotificationSubscriptionInputSchema,
  patchNotificationSubscriptionInputSchema } from '../../domain/notification-input-schemas'

const idPath = (collection: string, id: string) => `/${collection}/${encodeURIComponent(id)}`
function withQuery(path: string, values: Record<string, unknown>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') query.set(key, String(value))
  return query.size ? `${path}?${query}` : path
}

export function createNotificationClient(request: ApiRequest) {
  return {
    listAdminChannels: () => request('/admin/channels', z.array(channelSchema)),
    createChannel: (body: z.input<typeof createChannelInputSchema>) => request('/admin/channels', commandReceiptSchema, { method: 'POST', body }),
    patchChannel: (id: string, body: z.input<typeof patchChannelInputSchema>) =>
      request(idPath('admin/channels', id), commandReceiptSchema, { method: 'PATCH', body }),
    testChannel: (id: string, body: z.input<typeof testChannelInputSchema>) =>
      request(`${idPath('admin/channels', id)}/test`, commandReceiptSchema, { method: 'POST', body }),
    listAdminNotificationTemplates: () => request('/admin/notification-templates', z.array(notificationTemplateSchema)),
    createNotificationTemplate: (body: z.input<typeof createNotificationTemplateInputSchema>) =>
      request('/admin/notification-templates', commandReceiptSchema, { method: 'POST', body }),
    reviseNotificationTemplate: (id: string, body: z.input<typeof reviseNotificationTemplateInputSchema>) =>
      request(`${idPath('admin/notification-templates', id)}/revisions`, commandReceiptSchema, { method: 'POST', body }),
    notificationTemplateAction: (id: string, action: 'activate' | 'disable', expectedVersion: number, reason: string) =>
      request(`${idPath('admin/notification-templates', id)}/${action}`, commandReceiptSchema,
        { method: 'POST', body: { expectedVersion, reason } }),
    listAdminNotificationPolicies: () => request('/admin/notification-policies', z.array(notificationPolicySchema)),
    patchNotificationPolicy: (id: string, body: z.input<typeof patchNotificationPolicyInputSchema>) =>
      request(idPath('admin/notification-policies', id), commandReceiptSchema, { method: 'PATCH', body }),
    listNotificationChannels: (environmentId: string) => request(withQuery('/notification-channels', { environmentId }), z.array(channelSchema)),
    listNotificationSubscriptions: (input: { environmentId?: string; page?: number; pageSize?: number } = {}) =>
      request(withQuery('/notification-subscriptions', input), pageSchema(notificationSubscriptionSchema)),
    createNotificationSubscription: (body: z.input<typeof createNotificationSubscriptionInputSchema>) =>
      request('/notification-subscriptions', commandReceiptSchema, { method: 'POST', body }),
    patchNotificationSubscription: (id: string, body: z.input<typeof patchNotificationSubscriptionInputSchema>) =>
      request(idPath('notification-subscriptions', id), commandReceiptSchema, { method: 'PATCH', body }),
    listNotificationAttempts: (input: { environmentId?: string; status?: 'queued' | 'suppressed' | 'delivered' | 'failed';
      page?: number; pageSize?: number } = {}) => request(withQuery('/notification-attempts', input), pageSchema(notificationAttemptViewSchema)),
    getNotificationAttempt: (id: string) => request(idPath('notification-attempts', id), notificationAttemptViewSchema),
    retryNotificationAttempt: (id: string, expectedVersion: number, reason: string) =>
      request(`${idPath('notification-attempts', id)}/retry`, commandReceiptSchema, { method: 'POST', body: { expectedVersion, reason } }),
  }
}

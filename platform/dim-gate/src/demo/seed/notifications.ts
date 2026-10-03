import type { Channel, NotificationPolicy, NotificationTemplate } from '../../domain/notification-models'

/** Safe W5 metadata for accepted W4 demo-rd/demo-ops refs; no address or outbound endpoint. */
export function buildNotificationSeed(orgId = 'org-demo', availableProjectIds?: readonly string[]) {
  const now = '2026-09-20T09:00:00Z'
  const common = { orgId, version: 1, createdAt: now, updatedAt: now }
  const channels: Channel[] = [
    { ...common, id: 'demo-rd', kind: 'in_app', destinationLabel: 'RD Demo inbox',
      allowedProjectIds: ['project-store', 'project-payments', 'project-data', 'project-insights']
        .filter(id => !availableProjectIds || availableProjectIds.includes(id)), enabled: true },
    { ...common, id: 'demo-ops', kind: 'in_app', destinationLabel: 'Ops Demo inbox', allowedProjectIds: [], enabled: true },
  ]
  const templates: NotificationTemplate[] = [{ ...common, id: 'w5-template-default', revision: 1, activeRevision: 1,
    status: 'active', subject: 'Demo {{severity}} alert', body: '{{source}} at {{time}}',
    revisions: [{ revision: 1, subject: 'Demo {{severity}} alert', body: '{{source}} at {{time}}',
      reason: 'Safe seeded template', actorId: 'user-admin', occurredAt: now }] }]
  const policies: NotificationPolicy[] = [{ ...common, id: 'w5-notification-policy', severityChannels: [
    { severity: 'critical', channelIds: ['demo-rd', 'demo-ops'] },
    { severity: 'warning', channelIds: ['demo-rd', 'demo-ops'] },
  ], retentionDays: 30, dedupeSeconds: 300, maxSilenceHours: 24 }]
  return { channels, notificationTemplates: templates, notificationPolicies: policies,
    notificationSubscriptions: [], notificationAttempts: [] }
}

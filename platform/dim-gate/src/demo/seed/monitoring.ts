import { monitoringNavigationItemSchema } from '../../domain/schema-models'

/** Safe additive route metadata; navigation still passes current role and scope checks. */
export function buildW4Navigation(orgId: string) {
  const stamp = { orgId, version: 1, createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T09:00:00Z' }
  return [
    { ...stamp, id: 'nav-rd-monitoring', routeKey: 'rd.monitoring', label: '監控設定', group: '研發中心', order: 18, enabled: true },
    { ...stamp, id: 'nav-rd-alerts', routeKey: 'rd.alerts', label: '告警規則', group: '研發中心', order: 19, enabled: true },
    { ...stamp, id: 'nav-ops-alerting', routeKey: 'ops.alerting', label: '告警運行', group: '維運中心', order: 28, enabled: true },
  ].map(value => monitoringNavigationItemSchema.parse(value))
}

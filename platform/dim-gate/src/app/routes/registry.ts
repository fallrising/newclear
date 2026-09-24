import { matchPath } from 'react-router-dom'
import type { Center, SessionView } from '../../domain/schemas'

export type RouteKey = 'rd.overview' | 'rd.apps' | 'rd.app-detail' | 'rd.environment-detail'
  | 'rd.catalog' | 'rd.catalog-request' | 'rd.requests' | 'rd.request-detail'
  | 'rd.pipelines' | 'rd.pipeline-detail' | 'rd.release-detail' | 'ops.releases' | 'ops.release-detail'
  | 'ops.overview' | 'ops.cmdb' | 'ops.ci-detail' | 'ops.topology' | 'ops.requests' | 'ops.request-detail'
  | 'ops.jobs' | 'ops.job-detail' | 'ops.capacity' | 'admin.overview' | 'admin.access' | 'admin.users' | 'admin.features' | 'admin.routes' | 'admin.notifications' | 'admin.navigation'
  | 'admin.catalog' | 'admin.cmdb-models' | 'admin.audit' | 'guide'
  | 'rd.delivery' | 'rd.configuration' | 'rd.traffic' | 'ops.service-change'
  | 'rd.resources' | 'rd.resource-request' | 'rd.change-detail' | 'ops.change-detail'
  | 'ops.caches' | 'ops.cache-detail' | 'ops.messaging' | 'ops.messaging-detail' | 'ops.clusters' | 'ops.cluster-detail'
  | 'rd.observability' | 'ops.incidents' | 'ops.incident-detail' | 'admin.integrations'
  | 'rd.monitoring' | 'rd.alerts' | 'ops.alerting'
export type RegisteredRoute = {
  key: RouteKey
  path: string
  center?: Center
  requiredAction?: string
  crossCenterRead?: boolean
  navigation: { label: string; group: string; order: number; visible: boolean }
}

/** Only routes with real components belong here. Navigation metadata never creates routes or grants permission. */
export const routeRegistry: readonly RegisteredRoute[] = [
  { key: 'rd.overview', path: '/rd', center: 'rd', requiredAction: 'app.read', navigation: { label: '研發中心', group: '工作空間', order: 10, visible: true } },
  { key: 'rd.apps', path: '/rd/apps', center: 'rd', requiredAction: 'app.read', navigation: { label: '應用與環境', group: '研發中心', order: 11, visible: true } },
  { key: 'rd.app-detail', path: '/rd/apps/:appId', center: 'rd', requiredAction: 'app.read', crossCenterRead: true, navigation: { label: '應用詳細資料', group: '研發中心', order: 12, visible: false } },
  { key: 'rd.environment-detail', path: '/rd/apps/:appId/environments/:environmentId', center: 'rd', requiredAction: 'environment.read', crossCenterRead: true, navigation: { label: '環境詳細資料', group: '研發中心', order: 13, visible: false } },
  { key: 'rd.catalog', path: '/rd/catalog', center: 'rd', requiredAction: 'catalog.read', navigation: { label: '服務目錄', group: '研發中心', order: 14, visible: true } },
  { key: 'rd.catalog-request', path: '/rd/catalog/:itemId/request', center: 'rd', requiredAction: 'request.create', navigation: { label: '環境申請精靈', group: '研發中心', order: 15, visible: false } },
  { key: 'rd.requests', path: '/rd/requests', center: 'rd', requiredAction: 'request.read', navigation: { label: '環境申請', group: '研發中心', order: 16, visible: true } },
  { key: 'rd.request-detail', path: '/rd/requests/:requestId', center: 'rd', requiredAction: 'request.read', crossCenterRead: true, navigation: { label: '申請詳細資料', group: '研發中心', order: 17, visible: false } },
  { key: 'rd.pipelines', path: '/rd/pipelines', center: 'rd', requiredAction: 'pipeline.read', navigation: { label: 'Pipeline 發布', group: '研發中心', order: 18, visible: true } },
  { key: 'rd.pipeline-detail', path: '/rd/pipelines/:runId', center: 'rd', requiredAction: 'pipeline.read', crossCenterRead: true, navigation: { label: 'Pipeline 詳情', group: '研發中心', order: 19, visible: false } },
  { key: 'rd.release-detail', path: '/rd/releases/:releaseId', center: 'rd', requiredAction: 'release.read', crossCenterRead: true, navigation: { label: '發布詳情', group: '研發中心', order: 19, visible: false } },
  { key: 'ops.overview', path: '/ops', center: 'ops', requiredAction: 'ci.read', navigation: { label: '維運中心', group: '工作空間', order: 20, visible: true } },
  { key: 'ops.cmdb', path: '/ops/cmdb', center: 'ops', requiredAction: 'ci.read', navigation: { label: 'CMDB', group: '維運中心', order: 21, visible: true } },
  { key: 'ops.ci-detail', path: '/ops/cmdb/:ciId', center: 'ops', requiredAction: 'ci.read', crossCenterRead: true, navigation: { label: 'CI 詳細資料', group: '維運中心', order: 22, visible: false } },
  { key: 'ops.topology', path: '/ops/topology', center: 'ops', requiredAction: 'ci.read', crossCenterRead: true, navigation: { label: '依賴拓撲', group: '維運中心', order: 23, visible: true } },
  { key: 'ops.requests', path: '/ops/requests', center: 'ops', requiredAction: 'request.read', navigation: { label: '交付審批', group: '維運中心', order: 24, visible: true } },
  { key: 'ops.request-detail', path: '/ops/requests/:requestId', center: 'ops', requiredAction: 'request.read', navigation: { label: '申請詳細資料', group: '維運中心', order: 25, visible: false } },
  { key: 'ops.jobs', path: '/ops/jobs', center: 'ops', requiredAction: 'job.read', navigation: { label: '交付作業', group: '維運中心', order: 26, visible: true } },
  { key: 'ops.job-detail', path: '/ops/jobs/:jobId', center: 'ops', requiredAction: 'job.read', navigation: { label: '交付作業詳細資料', group: '維運中心', order: 27, visible: false } },
  { key: 'ops.capacity', path: '/ops/capacity', center: 'ops', requiredAction: 'capacity.read', navigation: { label: '資源池容量', group: '維運中心', order: 28, visible: true } },
  { key: 'ops.releases', path: '/ops/releases', center: 'ops', requiredAction: 'release.read', navigation: { label: '發布審批', group: '維運中心', order: 29, visible: true } },
  { key: 'ops.release-detail', path: '/ops/releases/:releaseId', center: 'ops', requiredAction: 'release.read', crossCenterRead: true, navigation: { label: '發布詳情', group: '維運中心', order: 29, visible: false } },
  { key: 'admin.overview', path: '/admin', center: 'admin', requiredAction: 'access.write', navigation: { label: '平台管理', group: '工作空間', order: 30, visible: true } },
  { key: 'admin.access', path: '/admin/access', center: 'admin', requiredAction: 'access.write', navigation: { label: '角色與範圍', group: '治理', order: 31, visible: true } },
  { key: 'admin.users', path: '/admin/users', center: 'admin', requiredAction: 'access.write', navigation: { label: '使用者與團隊', group: '治理', order: 31, visible: false } },
  { key: 'admin.features', path: '/admin/features', center: 'admin', requiredAction: 'platformFeature.write', navigation: { label: '功能灰度', group: '治理', order: 31, visible: false } },
  { key: 'admin.routes', path: '/admin/routes', center: 'admin', requiredAction: 'platformRoute.write', navigation: { label: '註冊路由', group: '治理', order: 31, visible: false } },
  { key: 'admin.notifications', path: '/admin/notifications', center: 'admin', requiredAction: 'notificationPolicy.write', navigation: { label: '通知政策', group: '治理', order: 31, visible: false } },
  { key: 'admin.navigation', path: '/admin/navigation', center: 'admin', requiredAction: 'navigation.write', navigation: { label: '導航目錄', group: '治理', order: 32, visible: true } },
  { key: 'admin.catalog', path: '/admin/catalog', center: 'admin', requiredAction: 'catalog.write', navigation: { label: '服務目錄', group: '治理', order: 33, visible: true } },
  { key: 'admin.cmdb-models', path: '/admin/cmdb-models', center: 'admin', requiredAction: 'model.write', navigation: { label: 'CMDB 欄位', group: '治理', order: 34, visible: true } },
  { key: 'admin.audit', path: '/admin/audit', center: 'admin', requiredAction: 'audit.read', navigation: { label: '管理稽核', group: '治理', order: 35, visible: true } },
  { key: 'rd.observability', path: '/rd/observability', center: 'rd', requiredAction: 'observation.read', crossCenterRead: true, navigation: { label: '應用觀測', group: '研發中心', order: 19, visible: true } },
  { key: 'ops.incidents', path: '/ops/incidents', center: 'ops', requiredAction: 'incident.read', navigation: { label: '事件中心', group: '維運中心', order: 29, visible: true } },
  { key: 'ops.incident-detail', path: '/ops/incidents/:incidentId', center: 'ops', requiredAction: 'incident.read', crossCenterRead: true, navigation: { label: '事件詳情', group: '維運中心', order: 29, visible: false } },
  { key: 'admin.integrations', path: '/admin/integrations', center: 'admin', requiredAction: 'integration.read', navigation: { label: '整合狀態', group: '治理', order: 36, visible: true } },
  { key: 'rd.monitoring', path: '/rd/apps/:appId/monitoring', center: 'rd', requiredAction: 'monitorPolicy.read', crossCenterRead: true, navigation: { label: '服務監控設定', group: '運行狀況', order: 19, visible: false } },
  { key: 'rd.alerts', path: '/rd/apps/:appId/alerts', center: 'rd', requiredAction: 'alertRule.read', crossCenterRead: true, navigation: { label: '服務告警規則', group: '運行狀況', order: 19, visible: false } },
  { key: 'ops.alerting', path: '/ops/alerting', center: 'ops', requiredAction: 'alertRule.read', navigation: { label: '告警控制', group: '維運中心', order: 29, visible: true } },
  { key: 'rd.resources', path: '/rd/apps/:appId/resources', center: 'rd', requiredAction: 'binding.read', crossCenterRead: true, navigation: { label: '服務資源', group: '資源', order: 28, visible: false } },
  { key: 'rd.resource-request', path: '/rd/catalog/:itemId/resource-request', center: 'rd', requiredAction: 'change.create', navigation: { label: '資源申請', group: '資源', order: 28, visible: false } },
  { key: 'rd.change-detail', path: '/rd/changes/:changeId', center: 'rd', requiredAction: 'change.read', crossCenterRead: true, navigation: { label: '資源變更工作單', group: '資源', order: 28, visible: false } },
  { key: 'ops.change-detail', path: '/ops/changes/:changeId', center: 'ops', requiredAction: 'change.read', navigation: { label: '資源變更工作單', group: '資源', order: 28, visible: false } },
  { key: 'ops.caches', path: '/ops/caches', center: 'ops', requiredAction: 'ci.read', navigation: { label: '快取服務', group: '資源', order: 28, visible: true } },
  { key: 'ops.cache-detail', path: '/ops/caches/:ciId', center: 'ops', requiredAction: 'ci.read', crossCenterRead: true, navigation: { label: '快取服務詳情', group: '資源', order: 28, visible: false } },
  { key: 'ops.messaging', path: '/ops/messaging', center: 'ops', requiredAction: 'ci.read', navigation: { label: '訊息佇列', group: '資源', order: 28, visible: true } },
  { key: 'ops.messaging-detail', path: '/ops/messaging/:ciId', center: 'ops', requiredAction: 'ci.read', crossCenterRead: true, navigation: { label: '訊息佇列詳情', group: '資源', order: 28, visible: false } },
  { key: 'ops.clusters', path: '/ops/clusters', center: 'ops', requiredAction: 'ci.read', navigation: { label: 'Kubernetes 叢集', group: '資源', order: 28, visible: true } },
  { key: 'ops.cluster-detail', path: '/ops/clusters/:ciId', center: 'ops', requiredAction: 'ci.read', crossCenterRead: true, navigation: { label: 'Kubernetes 叢集詳情', group: '資源', order: 28, visible: false } },
  { key: 'rd.delivery', path: '/rd/apps/:appId/delivery', center: 'rd', requiredAction: 'pipelineDefinition.read', crossCenterRead: true, navigation: { label: '交付定義', group: '交付', order: 19, visible: false } },
  { key: 'rd.configuration', path: '/rd/apps/:appId/configuration', center: 'rd', requiredAction: 'serviceConfig.read', crossCenterRead: true, navigation: { label: '服務配置', group: '交付', order: 19, visible: false } },
  { key: 'rd.traffic', path: '/rd/apps/:appId/traffic', center: 'rd', requiredAction: 'trafficPolicy.read', crossCenterRead: true, navigation: { label: '業務流量灰度', group: '交付', order: 19, visible: false } },
  { key: 'ops.service-change', path: '/ops/service-changes/:sourceType/:sourceId', center: 'ops', requiredAction: 'serviceChange.read', crossCenterRead: true, navigation: { label: '服務變更詳情', group: '審批與變更', order: 29, visible: false } },
  { key: 'guide', path: '/guide', navigation: { label: '示範導覽', group: '示範', order: 40, visible: true } },
]

export function routeForPath(pathname: string) {
  return routeRegistry.find((route) => matchPath({ path: route.path, end: true }, pathname.split(/[?#]/, 1)[0]!))
}

export function canAccessRoute(session: SessionView, route: RegisteredRoute) {
  return (!route.center || route.crossCenterRead || session.centers.includes(route.center))
    && (!route.requiredAction || session.effectiveActions.includes(route.requiredAction))
}

export function visibleNavigation(session: SessionView) {
  return routeRegistry.filter((route) => route.navigation.visible && (!route.center || session.centers.includes(route.center))
    && canAccessRoute(session, route)
    && (!session.featureKeys || !['rd.monitoring', 'ops.alerting', 'rd.delivery', 'rd.traffic'].includes(route.key)
      || session.featureKeys.includes(route.key as NonNullable<SessionView['featureKeys']>[number])))
    .sort((left, right) => left.navigation.order - right.navigation.order)
}

/** Legacy seed grouping is a display default; customized Admin metadata wins. */
export function workspaceGroup(route: RegisteredRoute, configured?: string) {
  if (configured) return configured
  if (!route.center) return '示範'
  const key = route.key
  if (key.endsWith('.overview')) return { rd: '我的工作', ops: '值勤工作', admin: '平台總覽' }[route.center]
  if (key.startsWith('rd.')) {
    if (key === 'rd.apps') return '服務'
    if (key === 'rd.pipelines') return '交付'
    if (key === 'rd.observability') return '運行狀況'
    return '自助資源'
  }
  if (key.startsWith('ops.')) {
    if (key === 'ops.incidents' || key === 'ops.alerting') return '值勤工作'
    return ['ops.requests', 'ops.jobs', 'ops.releases'].includes(key) ? '審批與變更' : '資源'
  }
  if (key === 'admin.access') return '身分與授權'
  return ['admin.integrations', 'admin.audit'].includes(key) ? '整合與稽核' : '入口與能力'
}

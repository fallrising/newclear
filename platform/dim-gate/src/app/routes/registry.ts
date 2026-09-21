import { matchPath } from 'react-router-dom'
import type { Center, SessionView } from '../../domain/schemas'

export type RouteKey = 'rd.overview' | 'rd.apps' | 'rd.app-detail' | 'rd.environment-detail'
  | 'rd.catalog' | 'rd.catalog-request' | 'rd.requests' | 'rd.request-detail'
  | 'rd.pipelines' | 'rd.pipeline-detail' | 'rd.release-detail' | 'ops.releases' | 'ops.release-detail'
  | 'ops.overview' | 'ops.cmdb' | 'ops.ci-detail' | 'ops.topology' | 'ops.requests' | 'ops.request-detail'
  | 'ops.jobs' | 'ops.job-detail' | 'ops.capacity' | 'admin.overview' | 'admin.access' | 'admin.navigation'
  | 'admin.catalog' | 'admin.cmdb-models' | 'admin.audit' | 'guide'
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
  { key: 'rd.app-detail', path: '/rd/apps/:appId', center: 'rd', requiredAction: 'app.read', navigation: { label: '應用詳細資料', group: '研發中心', order: 12, visible: false } },
  { key: 'rd.environment-detail', path: '/rd/apps/:appId/environments/:environmentId', center: 'rd', requiredAction: 'environment.read', navigation: { label: '環境詳細資料', group: '研發中心', order: 13, visible: false } },
  { key: 'rd.catalog', path: '/rd/catalog', center: 'rd', requiredAction: 'catalog.read', navigation: { label: '服務目錄', group: '研發中心', order: 14, visible: true } },
  { key: 'rd.catalog-request', path: '/rd/catalog/:itemId/request', center: 'rd', requiredAction: 'request.create', navigation: { label: '環境申請精靈', group: '研發中心', order: 15, visible: false } },
  { key: 'rd.requests', path: '/rd/requests', center: 'rd', requiredAction: 'request.read', navigation: { label: '環境申請', group: '研發中心', order: 16, visible: true } },
  { key: 'rd.request-detail', path: '/rd/requests/:requestId', center: 'rd', requiredAction: 'request.read', navigation: { label: '申請詳細資料', group: '研發中心', order: 17, visible: false } },
  { key: 'rd.pipelines', path: '/rd/pipelines', center: 'rd', requiredAction: 'pipeline.read', navigation: { label: 'Pipeline 發布', group: '研發中心', order: 18, visible: true } },
  { key: 'rd.pipeline-detail', path: '/rd/pipelines/:runId', center: 'rd', requiredAction: 'pipeline.read', crossCenterRead: true, navigation: { label: 'Pipeline 詳情', group: '研發中心', order: 19, visible: false } },
  { key: 'rd.release-detail', path: '/rd/releases/:releaseId', center: 'rd', requiredAction: 'release.read', crossCenterRead: true, navigation: { label: '發布詳情', group: '研發中心', order: 19, visible: false } },
  { key: 'ops.overview', path: '/ops', center: 'ops', requiredAction: 'ci.read', navigation: { label: '維運中心', group: '工作空間', order: 20, visible: true } },
  { key: 'ops.cmdb', path: '/ops/cmdb', center: 'ops', requiredAction: 'ci.read', navigation: { label: 'CMDB', group: '維運中心', order: 21, visible: true } },
  { key: 'ops.ci-detail', path: '/ops/cmdb/:ciId', center: 'ops', requiredAction: 'ci.read', navigation: { label: 'CI 詳細資料', group: '維運中心', order: 22, visible: false } },
  { key: 'ops.topology', path: '/ops/topology', center: 'ops', requiredAction: 'ci.read', navigation: { label: '依賴拓撲', group: '維運中心', order: 23, visible: true } },
  { key: 'ops.requests', path: '/ops/requests', center: 'ops', requiredAction: 'request.read', navigation: { label: '交付審批', group: '維運中心', order: 24, visible: true } },
  { key: 'ops.request-detail', path: '/ops/requests/:requestId', center: 'ops', requiredAction: 'request.read', navigation: { label: '申請詳細資料', group: '維運中心', order: 25, visible: false } },
  { key: 'ops.jobs', path: '/ops/jobs', center: 'ops', requiredAction: 'job.read', navigation: { label: '交付作業', group: '維運中心', order: 26, visible: true } },
  { key: 'ops.job-detail', path: '/ops/jobs/:jobId', center: 'ops', requiredAction: 'job.read', navigation: { label: '交付作業詳細資料', group: '維運中心', order: 27, visible: false } },
  { key: 'ops.capacity', path: '/ops/capacity', center: 'ops', requiredAction: 'capacity.read', navigation: { label: '資源池容量', group: '維運中心', order: 28, visible: true } },
  { key: 'ops.releases', path: '/ops/releases', center: 'ops', requiredAction: 'release.read', navigation: { label: '發布審批', group: '維運中心', order: 29, visible: true } },
  { key: 'ops.release-detail', path: '/ops/releases/:releaseId', center: 'ops', requiredAction: 'release.read', crossCenterRead: true, navigation: { label: '發布詳情', group: '維運中心', order: 29, visible: false } },
  { key: 'admin.overview', path: '/admin', center: 'admin', requiredAction: 'access.write', navigation: { label: '平台管理', group: '工作空間', order: 30, visible: true } },
  { key: 'admin.access', path: '/admin/access', center: 'admin', requiredAction: 'access.write', navigation: { label: '角色與範圍', group: '治理', order: 31, visible: true } },
  { key: 'admin.navigation', path: '/admin/navigation', center: 'admin', requiredAction: 'navigation.write', navigation: { label: '導航目錄', group: '治理', order: 32, visible: true } },
  { key: 'admin.catalog', path: '/admin/catalog', center: 'admin', requiredAction: 'catalog.write', navigation: { label: '服務目錄', group: '治理', order: 33, visible: true } },
  { key: 'admin.cmdb-models', path: '/admin/cmdb-models', center: 'admin', requiredAction: 'model.write', navigation: { label: 'CMDB 欄位', group: '治理', order: 34, visible: true } },
  { key: 'admin.audit', path: '/admin/audit', center: 'admin', requiredAction: 'audit.read', navigation: { label: '管理稽核', group: '治理', order: 35, visible: true } },
  { key: 'guide', path: '/guide', navigation: { label: '示範導覽', group: '示範', order: 40, visible: true } },
]

export function routeForPath(pathname: string) {
  return routeRegistry.find((route) => matchPath({ path: route.path, end: true }, pathname))
}

export function canAccessRoute(session: SessionView, route: RegisteredRoute) {
  return (!route.center || route.crossCenterRead || session.centers.includes(route.center))
    && (!route.requiredAction || session.effectiveActions.includes(route.requiredAction))
}

export function visibleNavigation(session: SessionView) {
  return routeRegistry.filter((route) => route.navigation.visible && canAccessRoute(session, route))
    .sort((left, right) => left.navigation.order - right.navigation.order)
}

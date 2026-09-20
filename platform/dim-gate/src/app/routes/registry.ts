import { matchPath } from 'react-router-dom'
import type { Center, SessionView } from '../../domain/schemas'

export type RouteKey = 'rd.overview' | 'rd.apps' | 'rd.app-detail' | 'rd.environment-detail'
  | 'ops.overview' | 'ops.cmdb' | 'ops.ci-detail' | 'ops.topology' | 'admin.overview' | 'guide'
export type RegisteredRoute = {
  key: RouteKey
  path: string
  center?: Center
  requiredAction?: string
  navigation: { label: string; group: string; order: number; visible: boolean }
}

/** Only routes with real components belong here. Navigation metadata never creates routes or grants permission. */
export const routeRegistry: readonly RegisteredRoute[] = [
  { key: 'rd.overview', path: '/rd', center: 'rd', requiredAction: 'app.read', navigation: { label: '研發中心', group: '工作空間', order: 10, visible: true } },
  { key: 'rd.apps', path: '/rd/apps', center: 'rd', requiredAction: 'app.read', navigation: { label: '應用與環境', group: '研發中心', order: 11, visible: true } },
  { key: 'rd.app-detail', path: '/rd/apps/:appId', center: 'rd', requiredAction: 'app.read', navigation: { label: '應用詳細資料', group: '研發中心', order: 12, visible: false } },
  { key: 'rd.environment-detail', path: '/rd/apps/:appId/environments/:environmentId', center: 'rd', requiredAction: 'environment.read', navigation: { label: '環境詳細資料', group: '研發中心', order: 13, visible: false } },
  { key: 'ops.overview', path: '/ops', center: 'ops', requiredAction: 'ci.read', navigation: { label: '維運中心', group: '工作空間', order: 20, visible: true } },
  { key: 'ops.cmdb', path: '/ops/cmdb', center: 'ops', requiredAction: 'ci.read', navigation: { label: 'CMDB', group: '維運中心', order: 21, visible: true } },
  { key: 'ops.ci-detail', path: '/ops/cmdb/:ciId', center: 'ops', requiredAction: 'ci.read', navigation: { label: 'CI 詳細資料', group: '維運中心', order: 22, visible: false } },
  { key: 'ops.topology', path: '/ops/topology', center: 'ops', requiredAction: 'ci.read', navigation: { label: '依賴拓撲', group: '維運中心', order: 23, visible: true } },
  { key: 'admin.overview', path: '/admin', center: 'admin', requiredAction: 'access.write', navigation: { label: '平台管理', group: '工作空間', order: 30, visible: true } },
  { key: 'guide', path: '/guide', navigation: { label: '示範導覽', group: '示範', order: 40, visible: true } },
]

export function routeForPath(pathname: string) {
  return routeRegistry.find((route) => matchPath({ path: route.path, end: true }, pathname))
}

export function canAccessRoute(session: SessionView, route: RegisteredRoute) {
  return (!route.center || session.centers.includes(route.center))
    && (!route.requiredAction || session.effectiveActions.includes(route.requiredAction))
}

export function visibleNavigation(session: SessionView) {
  return routeRegistry.filter((route) => route.navigation.visible && canAccessRoute(session, route))
    .sort((left, right) => left.navigation.order - right.navigation.order)
}

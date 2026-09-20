import type { Center, SessionView } from '../../domain/schemas'

export type RouteKey = 'rd.overview' | 'ops.overview' | 'admin.overview' | 'guide'
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
  { key: 'ops.overview', path: '/ops', center: 'ops', requiredAction: 'ci.read', navigation: { label: '維運中心', group: '工作空間', order: 20, visible: true } },
  { key: 'admin.overview', path: '/admin', center: 'admin', requiredAction: 'access.write', navigation: { label: '平台管理', group: '工作空間', order: 30, visible: true } },
  { key: 'guide', path: '/guide', navigation: { label: '示範導覽', group: '示範', order: 40, visible: true } },
]

export function routeForPath(pathname: string) {
  return routeRegistry.find((route) => route.path === pathname)
}

export function visibleNavigation(session: SessionView) {
  return routeRegistry.filter((route) => route.navigation.visible
    && (!route.center || session.centers.includes(route.center)))
    .sort((left, right) => left.navigation.order - right.navigation.order)
}

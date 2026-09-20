import type { ReactNode } from 'react'
import type { Center, SessionView } from '../../domain/schemas'
import { ForbiddenCenter } from '../../features/foundation'
import { canAccessRoute, routeRegistry, type RouteKey } from '../routes/registry'

export function CenterLayout({ routeKey, center, session, children }: { routeKey: RouteKey; center: Center; session: SessionView; children: ReactNode }) {
  const route = routeRegistry.find((entry) => entry.key === routeKey)
  const allowed = route && route.center === center && canAccessRoute(session, route)
  return allowed ? children : <ForbiddenCenter center={center} />
}

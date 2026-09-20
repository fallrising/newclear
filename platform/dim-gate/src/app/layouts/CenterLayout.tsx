import type { ReactNode } from 'react'
import type { Center, SessionView } from '../../domain/schemas'
import { ForbiddenCenter } from '../../features/foundation'
import { routeRegistry, type RouteKey } from '../routes/registry'

export function CenterLayout({ routeKey, center, session, children }: { routeKey: RouteKey; center: Center; session: SessionView; children: ReactNode }) {
  const route = routeRegistry.find((entry) => entry.key === routeKey)
  const allowed = route && session.centers.includes(center)
  return allowed ? children : <ForbiddenCenter center={center} />
}

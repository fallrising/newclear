import type { Snapshot } from './schema-models'
import type { PlatformAdapterRef, PlatformRouteKey, PlatformRouteSpec } from './platform-route-models'

/** All adapters are local deterministic Mock functions. These labels never become URLs or executable paths. */
export const platformRouteRegistry = {
  'inventory.aws': { capabilityId: 'inventory-aws', action: 'ci.read', schemaId: 'CI', integrationId: 'integration-aws',
    supportedAdapters: ['demo-aws-inventory'], fallbackAdapterRef: 'demo-aws-inventory' },
  'inventory.aliyun': { capabilityId: 'inventory-aliyun', action: 'ci.read', schemaId: 'CI', integrationId: 'integration-aliyun',
    supportedAdapters: ['demo-aliyun-inventory'], fallbackAdapterRef: 'demo-aliyun-inventory' },
  'inventory.idc': { capabilityId: 'inventory-idc', action: 'ci.read', schemaId: 'CI', integrationId: 'integration-idc',
    supportedAdapters: ['demo-idc-inventory'], fallbackAdapterRef: 'demo-idc-inventory' },
  'observation.apm': { capabilityId: 'observation-apm', action: 'observation.read', schemaId: 'ObservationBucket', integrationId: 'integration-observation',
    supportedAdapters: ['demo-apm', 'demo-apm-failure'], fallbackAdapterRef: 'demo-apm' },
  'notification.in_app': { capabilityId: 'notification-dispatch', action: 'notification.read', schemaId: 'NotificationAttempt', integrationId: 'integration-observation',
    supportedAdapters: ['demo-in-app', 'demo-in-app-failure'], fallbackAdapterRef: 'demo-in-app' },
} as const satisfies Record<PlatformRouteKey, { capabilityId: string; action: string; schemaId: string; integrationId: string;
  supportedAdapters: readonly PlatformAdapterRef[]; fallbackAdapterRef: PlatformAdapterRef }>

export function routeSpecSupported(spec: PlatformRouteSpec): boolean {
  const entry = platformRouteRegistry[spec.routeKey]
  return entry.capabilityId === spec.capabilityId && entry.integrationId === spec.integrationId
    && entry.supportedAdapters.some(ref => ref === spec.adapterRef)
}

export function routeDiagnostic(snapshot: Snapshot, orgId: string, key: PlatformRouteKey) {
  const entry = platformRouteRegistry[key]
  const route = snapshot.entities.platformRoutes.find(row => row.orgId === orgId && row.spec.routeKey === key)
  const active = route?.revisions.find(row => row.revision === route.activeRevision)
  if (!active || route?.status === 'disabled') return {
    routeKey: key, capabilityId: entry.capabilityId, integrationId: entry.integrationId,
    adapterRef: entry.fallbackAdapterRef, activeRevision: null,
    status: route?.status === 'disabled' ? 'fallback' as const : 'default' as const,
    code: route?.status === 'disabled' ? 'ROUTE_DISABLED_FALLBACK' as const : 'DEFAULT_DEMO_ADAPTER' as const,
    fallbackAdapterRef: entry.fallbackAdapterRef,
  }
  const failed = active.spec.adapterRef.endsWith('-failure')
  return { routeKey: key, capabilityId: entry.capabilityId, integrationId: entry.integrationId,
    adapterRef: failed ? entry.fallbackAdapterRef : active.spec.adapterRef, activeRevision: route!.activeRevision,
    status: failed ? 'fallback' as const : 'active' as const,
    code: failed ? 'MOCK_FAILURE_FALLBACK' as const : 'ACTIVE_DEMO_ADAPTER' as const,
    fallbackAdapterRef: entry.fallbackAdapterRef }
}

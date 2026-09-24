import { z } from 'zod'
import { idSchema, timestampSchema, versionSchema } from './schema-primitives.ts'

export const platformRouteKeySchema = z.enum(['inventory.aws', 'inventory.aliyun', 'inventory.idc', 'observation.apm', 'notification.in_app'])
export const platformAdapterRefSchema = z.enum(['demo-aws-inventory', 'demo-aliyun-inventory', 'demo-idc-inventory',
  'demo-apm', 'demo-apm-failure', 'demo-in-app', 'demo-in-app-failure'])
export const platformRouteSpecSchema = z.strictObject({
  routeKey: platformRouteKeySchema, capabilityId: idSchema, integrationId: idSchema,
  adapterRef: platformAdapterRefSchema, timeoutMs: z.number().int().min(100).max(5000),
})
export const platformRouteRevisionSchema = z.strictObject({ revision: versionSchema, spec: platformRouteSpecSchema,
  reason: z.string().trim().min(1).max(500), actorId: idSchema, occurredAt: timestampSchema })
export const platformRouteHealthSchema = z.strictObject({ status: z.enum(['unknown', 'healthy', 'degraded', 'disabled']),
  code: z.enum(['NOT_TESTED', 'MOCK_OK', 'MOCK_FAILURE_FALLBACK', 'ROUTE_DISABLED']), testedRevision: versionSchema.nullable(),
  testedAt: timestampSchema.nullable() })
export const platformRouteSchema = z.strictObject({
  id: idSchema, orgId: idSchema, version: versionSchema, createdAt: timestampSchema, updatedAt: timestampSchema,
  revision: versionSchema, activeRevision: versionSchema.nullable(), status: z.enum(['draft', 'validated', 'active', 'disabled']),
  requesterId: idSchema, spec: platformRouteSpecSchema, revisions: z.array(platformRouteRevisionSchema).min(1),
  health: platformRouteHealthSchema,
})
export const platformRouteDiagnosticSchema = z.strictObject({ routeKey: platformRouteKeySchema, capabilityId: idSchema,
  integrationId: idSchema, adapterRef: platformAdapterRefSchema, activeRevision: versionSchema.nullable(),
  status: z.enum(['default', 'active', 'fallback']), code: z.enum(['DEFAULT_DEMO_ADAPTER', 'ACTIVE_DEMO_ADAPTER',
    'MOCK_FAILURE_FALLBACK', 'ROUTE_DISABLED_FALLBACK']), fallbackAdapterRef: platformAdapterRefSchema })
export const platformRouteRegistryEntrySchema = z.strictObject({ routeKey: platformRouteKeySchema, capabilityId: idSchema,
  action: idSchema, schemaId: idSchema, integrationId: idSchema, supportedAdapters: z.array(platformAdapterRefSchema),
  fallbackAdapterRef: platformAdapterRefSchema, status: z.literal('mock') })

export type PlatformRoute = z.infer<typeof platformRouteSchema>
export type PlatformRouteSpec = z.infer<typeof platformRouteSpecSchema>
export type PlatformAdapterRef = z.infer<typeof platformAdapterRefSchema>
export type PlatformRouteKey = z.infer<typeof platformRouteKeySchema>

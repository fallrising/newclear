import { z } from 'zod'
import { platformRouteSpecSchema } from './platform-route-models.ts'
import { versionSchema } from './schema-primitives.ts'

const reason = z.string().trim().min(1).max(500)
export const createPlatformRouteInputSchema = z.strictObject({ spec: platformRouteSpecSchema, reason })
export const revisePlatformRouteInputSchema = z.strictObject({ expectedVersion: versionSchema, spec: platformRouteSpecSchema, reason })
export const platformRouteActionInputSchema = z.strictObject({ expectedVersion: versionSchema, reason })
export const restorePlatformRouteInputSchema = z.strictObject({ expectedVersion: versionSchema, revision: versionSchema, reason })

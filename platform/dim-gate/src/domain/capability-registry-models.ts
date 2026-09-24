import { z } from 'zod'
import { idSchema } from './schema-primitives.ts'
import { capabilityRegistryEntrySchema } from './feature-models.ts'
import { platformRouteDiagnosticSchema, platformRouteRegistryEntrySchema } from './platform-route-models.ts'

/** Read-only mapping; the later rows intentionally have no executable route or adapter. */
export const capabilityRegistrySchema = z.strictObject({
  features: z.array(capabilityRegistryEntrySchema),
  routes: z.array(platformRouteRegistryEntrySchema.extend({ diagnostic: platformRouteDiagnosticSchema })),
  later: z.array(z.strictObject({ capabilityId: idSchema, label: idSchema, status: z.literal('later') })),
})

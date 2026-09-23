/** Runtime view validators shared with the build-time OpenAPI registry. */
import { z } from 'zod'
import { applicationSchema, environmentSchema, placementSchema, releaseSchema, organizationSchema, businessUnitSchema, teamSchema, projectSchema, userSchema, ciViewSchema, relationSchema, idSchema, incidentVariantSchema } from '../domain/schema-models.ts'

export const organizationViewSchema = z.strictObject({ organizations: z.array(organizationSchema), businessUnits: z.array(businessUnitSchema),
    teams: z.array(teamSchema), projects: z.array(projectSchema), users: z.array(userSchema) })
export const applicationDetailSchema = z.strictObject({ application: applicationSchema, environments: z.array(environmentSchema) })
export const environmentDetailSchema = z.strictObject({ environment: environmentSchema, placements: z.array(placementSchema), activeRelease: releaseSchema.nullable() })
/** Service and CI-only episodes share the incident route without fabricating an application for physical alerts. */
export const incidentViewSchema = incidentVariantSchema
export const entitySearchHitSchema = z.strictObject({ type: z.enum(['application', 'environment', 'ci', 'request', 'release', 'incident', 'resourceObject', 'resourceBinding', 'change']), id: idSchema, title: z.string().min(1).max(500), route: z.string().startsWith('/') })
export const topologyViewSchema = z.strictObject({ nodes: z.array(ciViewSchema).max(100), edges: z.array(relationSchema).max(200), truncated: z.boolean(), depthReached: z.number().int().min(0).max(3) })
export const capacitySchema = z.strictObject({ poolId: idSchema, cpu: z.strictObject({ used: z.number().nonnegative(), reserved: z.number().nonnegative(), available: z.number().nonnegative() }),
    memoryMiB: z.strictObject({ used: z.number().nonnegative(), reserved: z.number().nonnegative(), available: z.number().nonnegative() }) })

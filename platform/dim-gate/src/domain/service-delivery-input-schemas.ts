import { z } from 'zod'
import { idSchema, nameSchema, versionSchema } from './schema-primitives.ts'
import { pipelineDefinitionSpecSchema, serviceConfigSpecSchema, trafficPolicySpecSchema } from './service-delivery-models.ts'
const reason = z.string().trim().min(1).max(500)
export const createPipelineDefinitionInputSchema = z.strictObject({ applicationId: idSchema, name: nameSchema, reason, spec: pipelineDefinitionSpecSchema })
export const patchPipelineDefinitionInputSchema = createPipelineDefinitionInputSchema.omit({ applicationId: true }).extend({ expectedVersion: versionSchema })
export const createServiceConfigInputSchema = z.strictObject({ applicationId: idSchema, environmentId: idSchema, environmentVersion: versionSchema, reason, spec: serviceConfigSpecSchema })
export const patchServiceConfigInputSchema = createServiceConfigInputSchema.omit({ applicationId: true, environmentId: true }).extend({ expectedVersion: versionSchema })
export const createTrafficPolicyInputSchema = z.strictObject({ applicationId: idSchema, environmentId: idSchema, environmentVersion: versionSchema, reason, spec: trafficPolicySpecSchema })
export const patchTrafficPolicyInputSchema = createTrafficPolicyInputSchema.omit({ applicationId: true, environmentId: true }).extend({ expectedVersion: versionSchema })
export const serviceActionInputSchema = z.strictObject({ expectedVersion: versionSchema, reason })
export const serviceRevisionInputSchema = serviceActionInputSchema.extend({ environmentVersion: versionSchema })
export const runPipelineDefinitionInputSchema = serviceRevisionInputSchema.extend({ environmentId: idSchema,
  sourceRef: z.string().min(1).max(80).regex(/^(main|release\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})$/),
  sourceRevision: z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/) })

export type CreatePipelineDefinitionInput = z.infer<typeof createPipelineDefinitionInputSchema>
export type CreateServiceConfigInput = z.infer<typeof createServiceConfigInputSchema>
export type CreateTrafficPolicyInput = z.infer<typeof createTrafficPolicyInputSchema>

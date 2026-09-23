import { z } from 'zod'
import { idSchema, nameSchema, versionSchema, stageSchema } from './schema-primitives.ts'
import { tagsSchema, ciKindSchema, providerSchema, ciSchema, relationSchema, centerSchema, catalogTemplateSchema, modelFieldSchema } from './schema-models.ts'
const ids = /* @__PURE__ */ (() => (z.array(idSchema).refine((items) => new Set(items).size === items.length, 'IDs must be unique')))()

// Reuse the canonical recursive JSON validator identity for stable OpenAPI references.
const jsonFields = ciSchema.shape.customFields

export const acknowledgeIncidentInputSchema = /* @__PURE__ */ (() => (z.strictObject({ expectedVersion: versionSchema, reason: z.string().trim().min(1).max(500).optional() })))()

export const commandInputSchema = /* @__PURE__ */ (() => (z.strictObject({ sessionId: idSchema, actorId: idSchema, method: z.string().min(1), path: z.string().min(1), key: idSchema, body: z.unknown() })))()

export const patchCiSchema = /* @__PURE__ */ (() => (z.strictObject({
  expectedVersion: versionSchema, name: nameSchema.optional(), ownerTeamId: idSchema.optional(), tags: tagsSchema.optional(),
  visibilityProjectIds: ids.refine((value) => value.length > 0, 'At least one project is required').optional(), customFields: jsonFields.optional(),
}).refine((body) => Object.keys(body).length > 1, 'At least one metadata field is required')))()

export const createCiInputSchema = /* @__PURE__ */ (() => (z.strictObject({
  name: nameSchema, kind: ciKindSchema, provider: providerSchema, externalId: idSchema,
  accountId: idSchema.optional(), locationId: idSchema, poolId: idSchema, ownerTeamId: idSchema,
  visibilityProjectIds: ids.refine((value) => value.length > 0, 'At least one project is required'),
  lifecycle: z.literal('active'), tags: tagsSchema, attributes: jsonFields, customFields: jsonFields,
}).superRefine((body, ctx) => {
  const result = ciSchema.safeParse({ ...body, id: 'validation-only', orgId: 'session-scope', version: 1,
    createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T09:00:00Z', health: 'unknown', source: 'manual', observedAt: null })
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})))()

export const createRelationInputSchema = /* @__PURE__ */ (() => (z.strictObject({
  sourceCiId: idSchema, targetCiId: idSchema, sourceExpectedVersion: versionSchema,
  targetExpectedVersion: versionSchema, type: relationSchema.shape.type, reason: z.string().trim().min(1).max(500),
}).refine((body) => body.sourceCiId !== body.targetCiId, { path: ['targetCiId'], message: 'A relation cannot reference itself' })))()

export const deleteRelationInputSchema = /* @__PURE__ */ (() => (z.strictObject({ expectedVersion: versionSchema, reason: z.string().trim().min(1).max(500) })))()

export const revokeAssignmentSchema = /* @__PURE__ */ (() => (z.strictObject({ expectedVersion: versionSchema, reason: z.string().trim().min(1).max(500) })))()

export const advanceClockSchema = /* @__PURE__ */ (() => (z.strictObject({ ticks: z.number().int().min(1).max(60) })))()

export const reasonSchema = /* @__PURE__ */ (() => (z.string().trim().min(1).max(500)))()

export const versionCommandSchema = /* @__PURE__ */ (() => (z.strictObject({ expectedVersion: versionSchema })))()

export const reasonCommandSchema = /* @__PURE__ */ (() => (z.strictObject({ expectedVersion: versionSchema, reason: reasonSchema })))()

export const createRequestInputSchema = /* @__PURE__ */ (() => (z.strictObject({
  applicationId: idSchema, environmentName: nameSchema, stage: stageSchema, catalogItemId: idSchema,
  catalogRevision: versionSchema, provider: providerSchema, poolId: idSchema,
  cpu: z.number().int().min(1).max(64), memoryMiB: z.number().int().min(128).max(262144).multipleOf(128),
  purpose: reasonSchema,
})))()

export const patchRequestInputSchema = /* @__PURE__ */ (() => (z.strictObject({
  expectedVersion: versionSchema, environmentName: nameSchema.optional(), provider: providerSchema.optional(),
  poolId: idSchema.optional(), cpu: z.number().int().min(1).max(64).optional(),
  memoryMiB: z.number().int().min(128).max(262144).multipleOf(128).optional(), purpose: reasonSchema.optional(),
}).refine((body) => Object.keys(body).length > 1, 'At least one request field is required')))()

export const createAssignmentInputSchema = /* @__PURE__ */ (() => (z.strictObject({
  userId: idSchema, role: centerSchema, scopeType: z.enum(['org', 'project', 'pool']), scopeId: idSchema,
  stages: z.array(stageSchema).min(1).optional(), reason: reasonSchema,
})))()

export const patchUserInputSchema = /* @__PURE__ */ (() => (z.strictObject({ expectedVersion: versionSchema, enabled: z.boolean(), reason: reasonSchema })))()

export const patchNavigationInputSchema = /* @__PURE__ */ (() => (z.strictObject({
  expectedVersion: versionSchema, label: nameSchema.optional(), group: nameSchema.optional(),
  order: z.number().int().optional(), enabled: z.boolean().optional(),
}).refine((body) => Object.keys(body).length > 1, 'At least one navigation field is required')))()

const catalogMutableFields = /* @__PURE__ */ (() => ({
  template: catalogTemplateSchema, name: nameSchema, description: z.string().max(2000),
  allowedProjectIds: ids,
}))()

export const createCatalogRevisionInputSchema = /* @__PURE__ */ (() => (z.strictObject({
  expectedVersion: versionSchema, reason: reasonSchema, baseRevision: versionSchema, ...catalogMutableFields,
})))()

export const patchCatalogInputSchema = /* @__PURE__ */ (() => (z.strictObject({
  expectedVersion: versionSchema, revision: versionSchema,
  ...Object.fromEntries(Object.entries(catalogMutableFields).map(([key, value]) => [key, value.optional()])),
}).refine((body) => Object.keys(body).length > 2, 'At least one catalog field is required')))()

export const publishCatalogInputSchema = /* @__PURE__ */ (() => (z.strictObject({
  expectedVersion: versionSchema, reason: reasonSchema, revision: versionSchema,
})))()

export const createModelFieldInputSchema = /* @__PURE__ */ (() => (modelFieldSchema.omit({
  id: true, version: true, createdAt: true, updatedAt: true, orgId: true, required: true, hidden: true,
})))()

export const patchModelFieldInputSchema = /* @__PURE__ */ (() => (z.strictObject({
  expectedVersion: versionSchema, label: nameSchema.optional(), hidden: z.boolean().optional(),
}).refine((body) => Object.keys(body).length > 1, 'At least one model field property is required')))()

export const createPipelineInputSchema = /* @__PURE__ */ (() => (z.strictObject({
  applicationId: idSchema, environmentId: idSchema, revision: idSchema.trim().min(1), environmentVersion: versionSchema,
})))()

export const rollbackReleaseInputSchema = /* @__PURE__ */ (() => (reasonCommandSchema.extend({ targetReleaseId: idSchema, environmentVersion: versionSchema })))()

export type CommandInput = z.infer<typeof commandInputSchema>

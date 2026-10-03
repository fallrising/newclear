import { z } from 'zod'
import { idSchema, nameSchema, timestampSchema, versionSchema, stageSchema, scopedBase } from './schema-primitives.ts'

const applications = ['checkout', 'storefront', 'payments', 'data', 'analytics', 'recommendations'] as const
const appOptions = (kind: string) => applications.map(app => ({ id: `w3-${kind}-${app}`, applicationId: `app-${app}`, label: `Demo ${app} ${kind}` }))
export const serviceDeliveryRegistry = {
  repositories: appOptions('repository'), artifactRepositories: appOptions('artifact'), secretRefs: appOptions('secret'), endpoints: appOptions('endpoint'),
  refPatterns: ['main', 'release/*'] as const, recipes: ['demo-web-v1'] as const, approvalPolicies: ['independent-ops-prod-v1'] as const,
  matches: [{ id: 'demo-path-api-v1', label: 'Demo path /api/*', kind: 'path' as const, value: '/api/*' },
    { id: 'demo-host-service-v1', label: 'Demo host service.demo.invalid', kind: 'host' as const, value: 'service.demo.invalid' }],
  windows: [60, 120, 180] as const, progression: [10, 50, 100] as const,
  defaultThresholds: { p95LatencyMs: 500, errorRate: 0.05 },
} as const
const reason = z.string().trim().min(1).max(500)
const repositoryRef = z.enum(serviceDeliveryRegistry.repositories.map(r => r.id))
const artifactRepositoryRef = z.enum(serviceDeliveryRegistry.artifactRepositories.map(r => r.id))
const secretRef = z.enum(serviceDeliveryRegistry.secretRefs.map(r => r.id))
const endpointRef = z.enum(serviceDeliveryRegistry.endpoints.map(r => r.id))
const matchRef = z.enum(serviceDeliveryRegistry.matches.map(r => r.id))
export const serviceSourceTypeSchema = z.enum(['pipelineDefinition', 'serviceConfig', 'trafficPolicy'])
export const serviceValidationSchema = z.strictObject({ valid: z.boolean(), checkedAt: timestampSchema,
  errors: z.array(z.strictObject({ field: z.string().min(1).max(100), message: z.string().min(1).max(300) })).max(40) })
export const serviceDecisionSchema = z.strictObject({ actorId: idSchema, decision: z.enum(['approved', 'rejected']), reason,
  occurredAt: timestampSchema, grantIds: z.array(idSchema).min(1).max(100) })
export const pipelineDefinitionSpecSchema = z.strictObject({ repositoryRef, refPattern: z.enum(serviceDeliveryRegistry.refPatterns),
  recipeRef: z.literal('demo-web-v1'), artifactRepositoryRef, targetEnvironmentIds: z.array(idSchema).min(1).max(20),
  approvalPolicyRef: z.literal('independent-ops-prod-v1') })
export const pipelineDefinitionRunSnapshotSchema = pipelineDefinitionSpecSchema.omit({ targetEnvironmentIds: true }).extend({ environmentId: idSchema, sourceRef: z.string().min(1).max(80) })
const entry = { key: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), description: z.string().max(160) }
export const serviceConfigEntrySchema = z.discriminatedUnion('valueType', [
  z.strictObject({ ...entry, valueType: z.literal('string'), value: z.string().max(256) }),
  z.strictObject({ ...entry, valueType: z.literal('number'), value: z.number().finite().min(-1_000_000).max(1_000_000) }),
  z.strictObject({ ...entry, valueType: z.literal('boolean'), value: z.boolean() }),
  z.strictObject({ ...entry, valueType: z.literal('secretRef'), value: secretRef }),
])
export const serviceConfigSpecSchema = z.strictObject({ entries: z.array(serviceConfigEntrySchema).max(30) })
export const trafficWeightSchema = z.strictObject({ releaseId: idSchema, weight: z.number().int().min(0).max(100) })
export const trafficPolicySpecSchema = z.strictObject({ endpointRef, matchRef,
  targets: z.tuple([trafficWeightSchema, trafficWeightSchema]), healthWindowSeconds: z.union([z.literal(60), z.literal(120), z.literal(180)]),
  timeoutSeconds: z.union([z.literal(120), z.literal(240), z.literal(360)]),
  thresholds: z.strictObject({ p95LatencyMs: z.number().min(50).max(800), errorRate: z.number().min(0).max(0.05) }),
}).superRefine((value, ctx) => {
  if (value.targets[0].releaseId === value.targets[1].releaseId) ctx.addIssue({ code: 'custom', path: ['targets'], message: 'Two distinct releases are required' })
  if (value.targets[0].weight !== 0 || value.targets[1].weight !== 100) ctx.addIssue({ code: 'custom', path: ['targets'], message: 'W3 supports baseline 0 / candidate 100 via verified 10, 50, 100 steps only' })
  if (value.timeoutSeconds !== value.healthWindowSeconds * 2) ctx.addIssue({ code: 'custom', path: ['timeoutSeconds'], message: 'Timeout must be twice the health window' })
})
export const trafficDistributionSchema = z.strictObject({ origin: z.enum(['unknown', 'activeReleaseFallback', 'checkpoint']),
  policyId: idSchema.nullable(), executionId: idSchema.nullable(), checkpointId: idSchema.nullable(),
  weights: z.array(trafficWeightSchema).max(2), verifiedAt: timestampSchema.nullable() })
const revisionFields = { ...scopedBase, applicationId: idSchema, revision: versionSchema, requesterId: idSchema, reason,
  previousRevisionId: idSchema.optional(), restoredFromId: idSchema.optional(), baseActiveRevisionId: idSchema.nullable(),
  affectedEnvironmentIds: z.array(idSchema).min(1).max(40), validationResult: serviceValidationSchema.nullable(),
  decisions: z.array(serviceDecisionSchema), correlationId: idSchema }
export const pipelineDefinitionStateSchema = z.enum(['draft', 'validated', 'pending_approval', 'approved', 'rejected', 'cancelled', 'active', 'superseded'])
export const serviceConfigStateSchema = z.enum(['draft', 'validated', 'pending_approval', 'approved', 'rejected', 'cancelled', 'applying', 'active', 'failed', 'superseded'])
export const trafficPolicyStateSchema = z.enum(['draft', 'validated', 'pending_approval', 'approved', 'rejected', 'cancelled', 'rolling_out', 'active', 'failed', 'superseded'])
export const pipelineDefinitionSchema = z.strictObject({ ...revisionFields, sourceType: z.literal('pipelineDefinition'), familyId: idSchema, name: nameSchema,
  state: pipelineDefinitionStateSchema, spec: pipelineDefinitionSpecSchema, specSnapshot: pipelineDefinitionSpecSchema.optional() })
export const serviceConfigSchema = z.strictObject({ ...revisionFields, sourceType: z.literal('serviceConfig'), environmentId: idSchema, targetEnvironmentVersion: versionSchema,
  state: serviceConfigStateSchema, spec: serviceConfigSpecSchema, specSnapshot: serviceConfigSpecSchema.optional(), latestExecutionId: idSchema.optional() })
export const trafficPolicySchema = z.strictObject({ ...revisionFields, sourceType: z.literal('trafficPolicy'), environmentId: idSchema, targetEnvironmentVersion: versionSchema,
  baseEffectiveTraffic: trafficDistributionSchema, state: trafficPolicyStateSchema, spec: trafficPolicySpecSchema,
  specSnapshot: trafficPolicySpecSchema.optional(), latestExecutionId: idSchema.optional() })
export const serviceSourceSchema = z.discriminatedUnion('sourceType', [pipelineDefinitionSchema, serviceConfigSchema, trafficPolicySchema])
const executionFields = { ...scopedBase, sourceId: idSchema, applicationId: idSchema, environmentId: idSchema,
  state: z.enum(['queued', 'running', 'succeeded', 'failed']), startedAt: timestampSchema.optional(), completedAt: timestampSchema.optional(),
  failureCode: idSchema.optional(), correlationId: idSchema }
const step = { state: z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped']), startedAt: timestampSchema.optional(), completedAt: timestampSchema.optional() }
export const trafficSampleSchema = z.strictObject({ id: idSchema, policyId: idSchema, executionId: idSchema,
  step: z.union([z.literal(10), z.literal(50), z.literal(100)]), candidateReleaseId: idSchema,
  from: timestampSchema, to: timestampSchema, p95LatencyMs: z.number().nonnegative().nullable(), errorRate: z.number().min(0).max(1).nullable(), source: z.literal('demo') })
export const trafficCheckpointSchema = z.strictObject({ id: idSchema, step: z.union([z.literal(10), z.literal(50), z.literal(100)]),
  weights: z.tuple([trafficWeightSchema, trafficWeightSchema]), windowStart: timestampSchema, verifiedAt: timestampSchema, sampleIds: z.array(idSchema).min(2).max(6) })
export const configExecutionSchema = z.strictObject({ ...executionFields, kind: z.literal('config'),
  stepResults: z.array(z.strictObject({ ...step, name: z.enum(['validate', 'render', 'activate']) })).length(3) })
export const trafficExecutionSchema = z.strictObject({ ...executionFields, kind: z.literal('traffic'), priorDistribution: trafficDistributionSchema,
  stepResults: z.array(z.strictObject({ ...step, weight: z.union([z.literal(10), z.literal(50), z.literal(100)]) })).length(3),
  samples: z.array(trafficSampleSchema).max(36), checkpoints: z.array(trafficCheckpointSchema).max(3) })
export const serviceExecutionSchema = z.discriminatedUnion('kind', [configExecutionSchema, trafficExecutionSchema])
export const configDiffEntrySchema = z.strictObject({ key: entry.key, change: z.enum(['added', 'removed', 'changed']), before: serviceConfigEntrySchema.nullable(), after: serviceConfigEntrySchema.nullable() })
export const serviceActionSchema = z.enum(['edit', 'validate', 'submit', 'approve', 'reject', 'cancel', 'activate', 'apply', 'start', 'revisions', 'restore', 'runs'])
const detailFields = { availableActions: z.array(serviceActionSchema), dataAsOf: timestampSchema, productionRisk: z.boolean() }
export const definitionRunSummarySchema = z.strictObject({ id: idSchema, environmentId: idSchema, definitionId: idSchema, definitionRevision: versionSchema,
  sourceRevision: idSchema, state: z.enum(['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled']), artifactDigest: idSchema.optional() })
export const pipelineDefinitionDetailSchema = z.strictObject({ ...detailFields, source: pipelineDefinitionSchema, active: pipelineDefinitionSchema.nullable(), history: z.array(pipelineDefinitionSchema), runs: z.array(definitionRunSummarySchema) })
export const serviceConfigDetailSchema = z.strictObject({ ...detailFields, source: serviceConfigSchema, active: serviceConfigSchema.nullable(), history: z.array(serviceConfigSchema),
  diff: z.array(configDiffEntrySchema), executions: z.array(configExecutionSchema) })
export const trafficPolicyDetailSchema = z.strictObject({ ...detailFields, source: trafficPolicySchema, effective: trafficDistributionSchema, history: z.array(trafficPolicySchema),
  currentStep: z.union([z.literal(10), z.literal(50), z.literal(100)]).nullable(), executions: z.array(trafficExecutionSchema) })
const listFields = { applicationId: idSchema.optional(), environmentId: idSchema.optional(), q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['id', 'revision', 'updatedAt']).default('updatedAt'), order: z.enum(['asc', 'desc']).default('desc') }
export const pipelineDefinitionListQuerySchema = z.strictObject({ ...listFields, state: pipelineDefinitionStateSchema.optional() })
export const serviceConfigListQuerySchema = z.strictObject({ ...listFields, state: serviceConfigStateSchema.optional() })
export const trafficPolicyListQuerySchema = z.strictObject({ ...listFields, state: trafficPolicyStateSchema.optional() })
export const deliveryOptionsQuerySchema = z.strictObject({ environmentId: idSchema })
const option = z.strictObject({ id: idSchema, label: nameSchema })
const envOption = z.strictObject({ id: idSchema, name: nameSchema, stage: stageSchema, version: versionSchema, status: z.enum(['provisioning', 'ready', 'failed', 'retired']) })
export const deliveryOptionsSchema = z.strictObject({ application: z.strictObject({ id: idSchema, name: nameSchema, projectId: idSchema }), environment: envOption,
  environments: z.array(envOption), repositories: z.array(option), refPatterns: z.array(z.enum(serviceDeliveryRegistry.refPatterns)), recipes: z.array(option),
  artifactRepositories: z.array(option), approvalPolicies: z.array(option), secretRefs: z.array(option), endpoints: z.array(option),
  matches: z.array(option.extend({ kind: z.enum(['path', 'host']), value: z.string().max(80) })),
  eligibleReleases: z.array(z.strictObject({ id: idSchema, artifactDigest: idSchema, revision: idSchema, createdAt: timestampSchema })),
  network: z.strictObject({ status: z.enum(['known', 'unknown']), refs: z.array(z.strictObject({ ciId: idSchema, name: nameSchema, kind: z.enum(['load_balancer', 'network']), relationId: idSchema, workloadCiId: idSchema })) }),
  dataAsOf: timestampSchema })
export const serviceWorkSummarySchema = z.strictObject({ kind: z.enum(['pipelineDefinition.activate', 'serviceConfig.apply', 'trafficPolicy.rollout']),
  revision: versionSchema, productionRisk: z.boolean(), riskClass: z.null(), basis: z.literal('not-applicable'), dimensions: z.array(z.never()).length(0),
  diff: z.array(configDiffEntrySchema), weights: z.array(trafficWeightSchema).max(2) })
export type PipelineDefinition = z.infer<typeof pipelineDefinitionSchema>
export type ServiceConfig = z.infer<typeof serviceConfigSchema>
export type TrafficPolicy = z.infer<typeof trafficPolicySchema>
export type ServiceSource = z.infer<typeof serviceSourceSchema>
export type ServiceExecution = z.infer<typeof serviceExecutionSchema>
export type ConfigExecution = z.infer<typeof configExecutionSchema>
export type TrafficExecution = z.infer<typeof trafficExecutionSchema>
export type TrafficDistribution = z.infer<typeof trafficDistributionSchema>
export type PipelineDefinitionDetail = z.infer<typeof pipelineDefinitionDetailSchema>
export type ServiceConfigDetail = z.infer<typeof serviceConfigDetailSchema>
export type TrafficPolicyDetail = z.infer<typeof trafficPolicyDetailSchema>
export type DeliveryOptions = z.infer<typeof deliveryOptionsSchema>
export type { createPipelineDefinitionInputSchema, patchPipelineDefinitionInputSchema, createServiceConfigInputSchema, patchServiceConfigInputSchema, createTrafficPolicyInputSchema, patchTrafficPolicyInputSchema, serviceActionInputSchema, serviceRevisionInputSchema, runPipelineDefinitionInputSchema, CreatePipelineDefinitionInput, CreateServiceConfigInput, CreateTrafficPolicyInput } from './service-delivery-input-schemas.ts'

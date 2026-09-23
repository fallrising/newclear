import { z } from 'zod'
import { idSchema, nameSchema, timestampSchema, versionSchema, stageSchema } from './schema-primitives.ts'
import { pipelineDefinitionSchema, serviceConfigSchema, trafficPolicySchema, serviceExecutionSchema,
  pipelineDefinitionRunSnapshotSchema, serviceWorkSummarySchema } from './service-delivery-models.ts'
import { monitorPolicySchema, alertRuleSchema, sloPolicySchema, silenceSchema, alertEvaluationSchema,
  notificationDeliverySchema, infrastructureMetricSchema, infrastructureIncidentSchema } from './monitoring-models.ts'
import { featureKeySchema, platformFeatureSchema } from './feature-models.ts'
import { platformRouteSchema } from './platform-route-models.ts'
export { idSchema, nameSchema, timestampSchema, versionSchema, stageSchema } from './schema-primitives.ts'
export * from './service-delivery-models.ts'
export * from './monitoring-models.ts'
export * from './feature-models.ts'
export * from './platform-route-models.ts'

export const centerSchema = z.enum(['rd', 'ops', 'admin'])
export const providerSchema = z.enum(['aws', 'aliyun', 'onprem'])
export const ciKindSchema = z.enum(['compute', 'cluster', 'database', 'cache', 'queue', 'load_balancer', 'network', 'storage'])
export const healthSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown'])
const ids = z.array(idSchema).refine((items) => new Set(items).size === items.length, 'IDs must be unique')
const base = { id: idSchema, version: versionSchema, createdAt: timestampSchema, updatedAt: timestampSchema }
const scopedBase = { ...base, orgId: idSchema }
const jsonFields = z.record(z.string().min(1).max(80), z.json())
export const tagsSchema = z.record(z.string().min(1).max(64), z.string().max(256)).refine((tags) => Object.keys(tags).length <= 20, 'At most 20 tags')

export const organizationSchema = z.strictObject({ ...base, name: nameSchema })
export const businessUnitSchema = z.strictObject({ ...scopedBase, name: nameSchema })
export const legacyTeamSchema = z.strictObject({ ...scopedBase, businessUnitId: idSchema, name: nameSchema })
export const teamSchema = legacyTeamSchema.extend({ source: z.enum(['seed', 'demo']) })
export const projectSchema = z.strictObject({ ...scopedBase, teamId: idSchema, name: nameSchema, slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) })
export const legacyUserSchema = z.strictObject({ ...scopedBase, displayName: nameSchema, teamIds: ids, enabled: z.boolean() })
export const userSchema = legacyUserSchema.extend({ source: z.enum(['seed', 'demo']) })
export const applicationSchema = z.strictObject({
  ...scopedBase, projectId: idSchema, ownerTeamId: idSchema, name: nameSchema,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), tier: z.enum(['critical', 'standard']),
  description: z.string().max(2000), repositoryUrl: z.url().optional(),
})
export const environmentSchema = z.strictObject({
  ...scopedBase, applicationId: idSchema, name: nameSchema, stage: stageSchema,
  status: z.enum(['provisioning', 'ready', 'failed', 'retired']), activeReleaseId: idSchema.nullable(),
})
export const providerAccountSchema = z.strictObject({
  ...scopedBase, provider: z.enum(['aws', 'aliyun']), displayName: nameSchema,
  externalAccountRef: idSchema, connectionState: z.enum(['demo', 'connected', 'error']),
})
export const locationSchema = z.discriminatedUnion('provider', [
  z.strictObject({ ...scopedBase, provider: z.literal('aws'), region: idSchema, zone: idSchema.optional() }),
  z.strictObject({ ...scopedBase, provider: z.literal('aliyun'), region: idSchema, zone: idSchema.optional() }),
  z.strictObject({ ...scopedBase, provider: z.literal('onprem'), site: idSchema, rack: idSchema.optional() }),
])
const native = { native: jsonFields.optional() }
const computeCapacity = { cpu: z.number().int().min(0), memoryMiB: z.number().int().min(0) }
export const awsComputeAttributesSchema = z.strictObject({
  ...native, ...computeCapacity, instanceType: idSchema, vpcId: idSchema, subnetId: idSchema,
  privateIp: z.ipv4().optional(), imageId: idSchema.optional(),
})
export const aliyunComputeAttributesSchema = z.strictObject({
  ...native, ...computeCapacity, instanceType: idSchema, vpcId: idSchema, vSwitchId: idSchema,
  privateIp: z.ipv4().optional(), imageId: idSchema.optional(),
})
export const onpremComputeAttributesSchema = z.strictObject({
  ...native, ...computeCapacity, assetTag: idSchema, serialRef: idSchema,
  hypervisor: z.enum(['baremetal', 'kvm', 'vmware']), hostCiId: idSchema.optional(), managementIp: z.ipv4().optional(),
})
export const ciAttributesSchemas = {
  cluster: z.strictObject({ ...native, orchestrator: z.literal('kubernetes'), versionLabel: idSchema }),
  database: z.strictObject({ ...native, engine: idSchema, versionLabel: idSchema, endpointLabel: idSchema }),
  cache: z.strictObject({ ...native, engine: idSchema, versionLabel: idSchema, endpointLabel: idSchema }),
  queue: z.strictObject({ ...native, engine: idSchema, versionLabel: idSchema, endpointLabel: idSchema }),
  network: z.strictObject({ ...native, cidr: z.cidrv4() }),
  load_balancer: z.strictObject({ ...native, scheme: z.enum(['internal', 'public']), endpointLabel: idSchema }),
  storage: z.strictObject({ ...native, storageClass: idSchema, capacityGiB: z.number().nonnegative() }),
}
const computeSchemas = { aws: awsComputeAttributesSchema, aliyun: aliyunComputeAttributesSchema, onprem: onpremComputeAttributesSchema }
export const ciSchema = z.strictObject({
  ...scopedBase, name: nameSchema, kind: ciKindSchema, provider: providerSchema, externalId: idSchema,
  accountId: idSchema.optional(), locationId: idSchema, poolId: idSchema, ownerTeamId: idSchema,
  visibilityProjectIds: ids.refine((value) => value.length > 0, 'At least one project is required'),
  lifecycle: z.enum(['planned', 'active', 'retired']), health: healthSchema, tags: tagsSchema,
  attributes: jsonFields, customFields: jsonFields,
  source: z.enum(['manual', 'discovered', 'provisioned']), observedAt: timestampSchema.nullable(),
}).superRefine((ci, ctx) => {
  if ((ci.provider === 'onprem') === (ci.accountId !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['accountId'], message: 'Cloud CI requires an account; on-prem CI must omit it' })
  }
  const schema = ci.kind === 'compute' ? computeSchemas[ci.provider] : ciAttributesSchemas[ci.kind]
  const result = schema.safeParse(ci.attributes)
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', path: ['attributes', ...issue.path], message: issue.message })
})
// A pool-scoped Ops reader can see the CI while seeing none of its associated projects.
// This response projection never weakens the persisted CI visibility invariant.
export const ciViewSchema = ciSchema.safeExtend({ visibilityProjectIds: ids })
export const poolSchema = z.strictObject({
  ...scopedBase, name: nameSchema, provider: providerSchema, locationId: idSchema, accountId: idSchema.optional(),
  scopeProjectIds: ids, cpuCapacity: z.number().int().nonnegative(), memoryCapacityMiB: z.number().int().nonnegative(),
  provisionDefaults: jsonFields,
}).superRefine((pool, ctx) => {
  if ((pool.provider === 'onprem') === (pool.accountId !== undefined)) ctx.addIssue({ code: 'custom', path: ['accountId'], message: 'Account does not match provider' })
})
export const placementSchema = z.strictObject({ ...scopedBase, applicationId: idSchema, environmentId: idSchema, ciId: idSchema, role: z.enum(['workload', 'dependency']) })
export const relationSchema = z.strictObject({
  ...scopedBase, sourceCiId: idSchema, targetCiId: idSchema, type: z.enum(['runs_on', 'depends_on', 'connects_to']),
  source: z.enum(['manual', 'discovered', 'template']), confidence: z.enum(['verified', 'inferred']),
}).refine((relation) => relation.sourceCiId !== relation.targetCiId, 'A relation cannot reference itself')
export const roleAssignmentSchema = z.strictObject({
  ...scopedBase, userId: idSchema, role: centerSchema, scopeType: z.enum(['org', 'project', 'pool']),
  scopeId: idSchema, stages: z.array(stageSchema).min(1).optional(),
}).superRefine((assignment, ctx) => {
  if ((assignment.role === 'rd' && assignment.scopeType !== 'project') ||
    (assignment.role === 'admin' && assignment.scopeType !== 'org') ||
    (assignment.role === 'ops' && assignment.scopeType === 'org')) ctx.addIssue({ code: 'custom', path: ['scopeType'], message: 'Role and scope type do not match' })
  if (assignment.stages && assignment.scopeType !== 'project') ctx.addIssue({ code: 'custom', path: ['stages'], message: 'Stages apply only to project scope' })
})
export const legacyNavigationItemV2Schema = z.strictObject({
  ...scopedBase, routeKey: z.enum([
    'rd.overview', 'rd.apps', 'rd.catalog', 'rd.requests', 'rd.pipelines', 'rd.observability',
    'ops.overview', 'ops.cmdb', 'ops.topology', 'ops.requests', 'ops.jobs', 'ops.capacity', 'ops.releases', 'ops.incidents', 'ops.caches', 'ops.messaging', 'ops.clusters',
    'admin.overview', 'admin.access', 'admin.navigation', 'admin.catalog', 'admin.cmdb-models', 'admin.audit', 'admin.integrations',
    'guide',
  ]),
  label: nameSchema, group: nameSchema, order: z.number().int(), enabled: z.boolean(),
})
export const navigationItemSchema = legacyNavigationItemV2Schema.extend({ routeKey: z.enum([...legacyNavigationItemV2Schema.shape.routeKey.options, 'rd.delivery', 'rd.configuration', 'rd.traffic', 'ops.service-change']) })
export const monitoringNavigationItemSchema = navigationItemSchema.extend({ routeKey: z.enum([...navigationItemSchema.shape.routeKey.options, 'rd.monitoring', 'rd.alerts', 'ops.alerting']) })
export const modelFieldSchema = z.strictObject({
  ...scopedBase, kind: ciKindSchema, key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/), label: nameSchema,
  valueType: z.enum(['string', 'number', 'boolean']), required: z.literal(false), hidden: z.boolean(),
  constraints: z.strictObject({ maxLength: z.number().int().nonnegative().optional(), enum: z.array(z.string()).optional(), min: z.number().optional(), max: z.number().optional() }),
})
export const provisionJobSchema = z.strictObject({
  ...scopedBase, requestId: idSchema, attempt: z.number().int().min(1), state: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  plannedCiIds: ids, failureCode: idSchema.optional(), startedAt: timestampSchema.optional(), completedAt: timestampSchema.optional(), correlationId: idSchema,
})
// Forward contracts are declared in M0; their business commands remain unavailable until the corresponding milestone.
export const computeCatalogTemplateSchema = z.strictObject({
  allowedProviders: z.array(providerSchema).min(1), allowedStages: z.array(stageSchema).min(1), allowedPoolIds: ids,
  defaults: z.strictObject({ cpu: z.number().int().min(1).max(64), memoryMiB: z.number().int().min(128).max(262144).multipleOf(128) }),
  limits: z.strictObject({ maxCpu: z.number().int().min(1).max(64), maxMemoryMiB: z.number().int().min(128).max(262144).multipleOf(128) }),
  requiresApproval: z.literal(true), resourceKind: z.literal('compute'), bootstrapProfile: z.literal('web-service'),
})
export const bindingPurposeSchema = z.enum(['runtime', 'producer', 'consumer'])
export const resourceAccessProfiles = [
  { id: 'w2-profile-redis-runtime', label: 'Redis runtime', resourceKind: 'redis', purposes: ['runtime'] },
  { id: 'w2-profile-kafka-producer', label: 'Kafka producer', resourceKind: 'kafka', purposes: ['producer'] },
  { id: 'w2-profile-kafka-consumer', label: 'Kafka consumer', resourceKind: 'kafka', purposes: ['consumer'] },
  { id: 'w2-profile-k8s-reader', label: 'Kubernetes readonly', resourceKind: 'kubernetes', purposes: ['runtime'] },
] as const
export const resourceAccessProfileSchema = z.strictObject({ id: idSchema, label: nameSchema, purposes: z.array(bindingPurposeSchema).min(1) })
const resourceTemplateFields = {
  allowedProviders: z.array(providerSchema).min(1), allowedStages: z.array(stageSchema).min(1), allowedPoolIds: ids,
  allowedParentCiIds: ids, accessProfiles: z.array(resourceAccessProfileSchema).min(1), requiresApproval: z.literal(true),
}
export const redisCatalogTemplateSchema = z.strictObject({ ...resourceTemplateFields, resourceKind: z.literal('redis'),
  defaults: z.strictObject({ quotaMiB: z.number().int().positive() }),
  limits: z.strictObject({ minQuotaMiB: z.number().int().positive(), maxQuotaMiB: z.number().int().positive() }),
})
export const kafkaCatalogTemplateSchema = z.strictObject({ ...resourceTemplateFields, resourceKind: z.literal('kafka'),
  defaults: z.strictObject({ partitions: z.number().int().positive(), retentionHours: z.number().int().positive(), throughputKiBPerSecond: z.number().int().positive() }),
  limits: z.strictObject({ minPartitions: z.number().int().positive(), maxPartitions: z.number().int().positive(),
    minRetentionHours: z.number().int().positive(), maxRetentionHours: z.number().int().positive(),
    minThroughputKiBPerSecond: z.number().int().positive(), maxThroughputKiBPerSecond: z.number().int().positive() }),
})
export const catalogTemplateSchema = z.discriminatedUnion('resourceKind', [computeCatalogTemplateSchema, redisCatalogTemplateSchema, kafkaCatalogTemplateSchema])
export const catalogItemSchema = z.strictObject({
  ...scopedBase, name: nameSchema, description: z.string().max(2000), revision: versionSchema,
  status: z.enum(['draft', 'published', 'disabled']), allowedProjectIds: ids, template: catalogTemplateSchema,
})
export const computeCatalogItemSchema = catalogItemSchema.extend({ template: computeCatalogTemplateSchema })
export const resourceObjectKindSchema = z.enum(['cache_allocation', 'kafka_topic', 'kubernetes_namespace'])
const resourceObjectFields = { ...scopedBase, parentCiId: idSchema, externalRef: idSchema, name: nameSchema,
  namespace: nameSchema.optional(), lifecycle: z.enum(['active', 'retired']), observedAt: timestampSchema.nullable() }
const cpuMemorySchema = z.strictObject({ cpuMilli: z.number().int().nonnegative(), memoryMiB: z.number().int().nonnegative() })
export const resourceObjectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...resourceObjectFields, kind: z.literal('cache_allocation'), spec: z.strictObject({ quotaMiB: z.number().int().positive() }) }),
  z.strictObject({ ...resourceObjectFields, kind: z.literal('kafka_topic'), spec: z.strictObject({ partitions: z.number().int().positive(), retentionHours: z.number().int().positive(), throughputKiBPerSecond: z.number().int().positive() }) }),
  z.strictObject({ ...resourceObjectFields, kind: z.literal('kubernetes_namespace'), spec: z.strictObject({
    workloads: z.array(z.strictObject({ name: nameSchema, kind: z.enum(['Deployment', 'StatefulSet', 'DaemonSet']), replicas: z.number().int().nonnegative(), requests: cpuMemorySchema, limits: cpuMemorySchema })).max(20),
    nodes: z.array(z.strictObject({ name: nameSchema, allocatable: cpuMemorySchema, requested: cpuMemorySchema })).max(20),
  }) }),
])
export const resourceBindingSchema = z.strictObject({ ...scopedBase, applicationId: idSchema, environmentId: idSchema,
  ciId: idSchema, resourceObjectId: idSchema.optional(), placementId: idSchema, purpose: bindingPurposeSchema,
  accessProfileRef: idSchema, state: z.enum(['active', 'released']),
  requestRef: z.strictObject({ sourceType: z.enum(['seed', 'change', 'request']), sourceId: idSchema }),
})
export const resourceQuotaSchema = z.discriminatedUnion('resourceKind', [
  z.strictObject({ ...scopedBase, parentCiId: idSchema, resourceKind: z.literal('redis'), capacity: z.strictObject({ quotaMiB: z.number().int().positive() }),
    observedAt: timestampSchema.nullable(), observedUsage: z.strictObject({ quotaMiB: z.number().nonnegative().nullable() }) }),
  z.strictObject({ ...scopedBase, parentCiId: idSchema, resourceKind: z.literal('kafka'), capacity: z.strictObject({ topics: z.number().int().positive(), partitions: z.number().int().positive(), throughputKiBPerSecond: z.number().int().positive() }),
    observedAt: timestampSchema.nullable(), observedUsage: z.strictObject({ topics: z.number().nonnegative().nullable(), partitions: z.number().nonnegative().nullable(), throughputKiBPerSecond: z.number().nonnegative().nullable() }) }),
])
const changeInputFields = { catalogItemId: idSchema, catalogRevision: versionSchema, reason: z.string().trim().min(1).max(500), targetCiId: idSchema, targetCiVersion: versionSchema }
const appTargetFields = { applicationId: idSchema, environmentId: idSchema, environmentVersion: versionSchema }
const bindInputSchema = z.strictObject({ ...changeInputFields, ...appTargetFields, kind: z.literal('resource.bind'), mode: z.enum(['create', 'existing']),
  resourceObjectId: idSchema.optional(), resourceObjectVersion: versionSchema.optional(), quotaMiB: z.number().int().positive().optional(),
  purpose: bindingPurposeSchema, accessProfileRef: idSchema,
})
const resizeInputSchema = z.strictObject({ ...changeInputFields, kind: z.literal('resource.resize'), applicationId: idSchema.optional(), environmentId: idSchema.optional(), environmentVersion: versionSchema.optional(),
  resourceObjectId: idSchema, resourceObjectVersion: versionSchema, quotaMiB: z.number().int().positive(),
})
const topicInputSchema = z.strictObject({ ...changeInputFields, ...appTargetFields, kind: z.literal('kafka.topic.create'),
  topicName: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/), namespace: nameSchema.optional(),
  partitions: z.number().int().positive(), retentionHours: z.number().int().positive(), throughputKiBPerSecond: z.number().int().positive(),
  purpose: bindingPurposeSchema, accessProfileRef: idSchema,
})
function refineChangeInput(value: { kind: string; mode?: string; quotaMiB?: number; resourceObjectId?: string; resourceObjectVersion?: number; applicationId?: string; environmentId?: string; environmentVersion?: number }, ctx: z.RefinementCtx) {
  if (value.kind === 'resource.bind' && (value.mode === 'create'
    ? value.quotaMiB === undefined || value.resourceObjectId !== undefined || value.resourceObjectVersion !== undefined
    : value.resourceObjectId === undefined || value.resourceObjectVersion === undefined || value.quotaMiB !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['mode'], message: 'Create requires quota only; existing requires object ID/version only' })
  }
  if (value.kind === 'resource.resize' && [value.applicationId, value.environmentId, value.environmentVersion].filter(v => v !== undefined).length % 3 !== 0) {
    ctx.addIssue({ code: 'custom', path: ['applicationId'], message: 'Application, environment and version must be supplied together' })
  }
}
export const createChangeInputSchema = z.discriminatedUnion('kind', [bindInputSchema, resizeInputSchema, topicInputSchema]).superRefine(refineChangeInput)
export const patchChangeInputSchema = z.discriminatedUnion('kind', [bindInputSchema.extend({ expectedVersion: versionSchema }), resizeInputSchema.extend({ expectedVersion: versionSchema }), topicInputSchema.extend({ expectedVersion: versionSchema })]).superRefine(refineChangeInput)
export const changeStateSchema = z.enum(['draft', 'submitted', 'approved', 'rejected', 'cancelled', 'executing', 'succeeded', 'failed'])
export const resourceReferenceSchema = z.strictObject({ entityType: z.enum(['ci', 'resourceObject', 'resourceBinding', 'application', 'environment']), entityId: idSchema })
export const changeRequestSchema = z.strictObject({ ...scopedBase, requesterId: idSchema, kind: z.enum(['resource.bind', 'resource.resize', 'kafka.topic.create']), poolId: idSchema,
  spec: createChangeInputSchema, specSnapshot: createChangeInputSchema.optional(), catalogSnapshot: catalogItemSchema.optional(),
  targetRefs: z.array(resourceReferenceSchema), targetVersions: z.array(resourceReferenceSchema.extend({ version: versionSchema })),
  riskClass: z.enum(['standard', 'shared']), state: changeStateSchema, correlationId: idSchema,
  decisions: z.array(z.strictObject({ actorId: idSchema, decision: z.enum(['approved', 'rejected']), reason: z.string().trim().min(1).max(500), occurredAt: timestampSchema })),
  latestExecutionId: idSchema.optional(), plannedObjectIds: ids, plannedBindingIds: ids,
})
export const changeExecutionSchema = z.strictObject({ ...scopedBase, changeId: idSchema, attempt: versionSchema, state: z.enum(['queued', 'running', 'succeeded', 'failed']),
  targetRefs: z.array(resourceReferenceSchema), plannedObjectIds: ids, plannedBindingIds: ids,
  stepResults: z.array(z.strictObject({ name: z.enum(['validate', 'reserve', 'configure', 'register', 'verify']), state: z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped']), occurredAt: timestampSchema.optional() })).length(5),
  failureCode: idSchema.optional(), startedAt: timestampSchema.optional(), completedAt: timestampSchema.optional(), correlationId: idSchema,
})
export const resourceCapacitySchema = z.strictObject({ ciId: idSchema, impactIncomplete: z.boolean(), dataAsOf: timestampSchema,
  dimensions: z.array(z.strictObject({ name: z.enum(['quotaMiB', 'topics', 'partitions', 'throughputKiBPerSecond']), capacity: z.number().nonnegative(),
    used: z.number().nonnegative().nullable(), reserved: z.number().nonnegative().nullable(), available: z.number().nonnegative().nullable(), observed: z.number().nonnegative().nullable() })),
})
export const resourceConsumerSchema = z.strictObject({ applicationId: idSchema, applicationName: nameSchema, environmentId: idSchema, environmentName: nameSchema, stage: stageSchema })
export const resourceInventorySchema = z.strictObject({
  ci: z.strictObject({ id: idSchema, name: nameSchema, kind: ciKindSchema, provider: providerSchema, poolId: idSchema, version: versionSchema, health: healthSchema, observedAt: timestampSchema.nullable() }),
  objects: z.array(resourceObjectSchema), bindings: z.array(resourceBindingSchema), consumers: z.array(resourceConsumerSchema),
  objectImpacts: z.array(z.strictObject({ resourceObjectId: idSchema, consumers: z.array(resourceConsumerSchema), impactIncomplete: z.boolean(), canResize: z.boolean() })),
  capacity: resourceCapacitySchema.nullable(), impactIncomplete: z.boolean(), readOnly: z.boolean(), dataAsOf: timestampSchema,
  legacyAssociations: z.array(z.strictObject({ placementId: idSchema, applicationId: idSchema, environmentId: idSchema })),
})
export const serviceResourcesSchema = z.strictObject({ applicationId: idSchema, environmentId: idSchema, resources: z.array(resourceInventorySchema), dataAsOf: timestampSchema })
export const resourceWorkItemSummarySchema = z.strictObject({
  kind: z.enum(['environment.create', 'release.deploy', 'release.rollback', 'resource.bind', 'resource.resize', 'kafka.topic.create']),
  riskClass: z.enum(['standard', 'shared']).nullable(), basis: z.enum(['new', 'existing', 'matched-target', 'unavailable', 'not-applicable']),
  dimensions: z.array(z.strictObject({ name: z.enum(['cpu', 'memoryMiB', 'quotaMiB', 'topics', 'partitions', 'throughputKiBPerSecond']),
    current: z.number().nonnegative().nullable(), desired: z.number().nonnegative(), delta: z.number().nullable() })),
})
export const workItemSummarySchema = z.union([resourceWorkItemSummarySchema, serviceWorkSummarySchema])
export const changeDetailSchema = z.strictObject({ change: changeRequestSchema, summary: workItemSummarySchema, executions: z.array(changeExecutionSchema),
  impact: z.strictObject({ consumers: z.array(resourceConsumerSchema), incomplete: z.boolean() }), capacity: resourceCapacitySchema.nullable(),
  availableActions: z.array(z.enum(['edit', 'submit', 'approve', 'reject', 'cancel', 'execute', 'retry'])), dataAsOf: timestampSchema,
})
export const workItemSchema = z.strictObject({ summary: workItemSummarySchema, sourceType: z.enum(['request', 'release', 'change', 'pipelineDefinition', 'serviceConfig', 'trafficPolicy']), sourceId: idSchema, rawState: z.string(), stateLabel: z.string(),
  actionRequired: z.boolean(), targetRefs: z.array(z.strictObject({ entityType: idSchema, entityId: idSchema })),
  requester: z.strictObject({ id: idSchema, displayName: nameSchema }), approver: z.strictObject({ id: idSchema, displayName: nameSchema }).nullable(),
  createdAt: timestampSchema, updatedAt: timestampSchema, dataAsOf: timestampSchema, route: z.string().startsWith('/'),
})
const resourcePageFields = { q: z.string().max(100).optional(), page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25), order: z.enum(['asc', 'desc']).default('asc') }
const resourceScopeFields = { applicationId: idSchema.optional(), environmentId: idSchema.optional(), ciId: idSchema.optional(), provider: providerSchema.optional(), poolId: idSchema.optional() }
export const resourceObjectListQuerySchema = z.strictObject({ ...resourcePageFields, ...resourceScopeFields, kind: resourceObjectKindSchema.optional(), sort: z.enum(['id', 'name', 'updatedAt']).default('name') })
export const resourceBindingListQuerySchema = z.strictObject({ ...resourcePageFields, ...resourceScopeFields, resourceObjectId: idSchema.optional(), state: resourceBindingSchema.shape.state.optional(), sort: z.enum(['id', 'updatedAt']).default('id') })
export const resourceInventoryQuerySchema = z.strictObject({ ...resourcePageFields, ...resourceScopeFields, kind: z.enum(['cache', 'queue', 'cluster']).optional(), sort: z.enum(['id', 'name', 'updatedAt']).default('name') })
export const serviceResourcesQuerySchema = z.strictObject({ environmentId: idSchema })
export const changeListQuerySchema = z.strictObject({ ...resourcePageFields, ...resourceScopeFields, kind: changeRequestSchema.shape.kind.optional(), state: changeStateSchema.optional(), owner: z.enum(['mine', 'team']).optional(), sort: z.enum(['id', 'updatedAt', 'createdAt']).default('updatedAt') })
export const workItemListQuerySchema = z.strictObject({ ...resourcePageFields, ...resourceScopeFields, center: z.enum(['rd', 'ops']), source: workItemSchema.shape.sourceType.optional(),
  owner: z.enum(['mine', 'team']).optional(), view: z.enum(['pending', 'all']).optional(), phase: z.enum(['pending', 'decided', 'execution', 'failed', 'completed']).optional(),
  state: z.enum(['draft', 'submitted', 'approved', 'rejected', 'cancelled', 'provisioning', 'fulfilled', 'failed', 'pending_approval', 'queued', 'deploying', 'verifying', 'executing', 'succeeded', 'validated', 'applying', 'rolling_out', 'active', 'superseded']).optional(), sort: z.enum(['sourceId', 'updatedAt', 'createdAt']).default('updatedAt') })
export const requestSchema = z.strictObject({
  ...scopedBase, requesterId: idSchema, applicationId: idSchema, environmentName: nameSchema, stage: stageSchema,
  catalogItemId: idSchema, catalogRevision: versionSchema, templateSnapshot: computeCatalogTemplateSchema, provider: providerSchema,
  poolId: idSchema, cpu: z.number().int().min(1).max(64), memoryMiB: z.number().int().min(128).max(262144).multipleOf(128),
  purpose: z.string().trim().min(1).max(500), state: z.enum(['draft', 'submitted', 'approved', 'rejected', 'cancelled', 'provisioning', 'fulfilled', 'failed']),
  approval: z.strictObject({ actorId: idSchema, occurredAt: timestampSchema, reason: z.string().min(1).max(500) }).optional(),
  environmentId: idSchema.optional(), latestJobId: idSchema.optional(), correlationId: idSchema,
})
export const pipelineStageSchema = z.strictObject({
  name: z.enum(['build', 'test', 'package', 'deploy', 'verify']), state: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped']),
  startedAt: timestampSchema.optional(), completedAt: timestampSchema.optional(),
})
export const legacyPipelineRunV2Schema = z.strictObject({
  ...scopedBase, applicationId: idSchema, environmentId: idSchema, revision: idSchema, artifactDigest: idSchema.optional(),
  stages: z.array(pipelineStageSchema), state: z.enum(['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled']),
  releaseId: idSchema.optional(), triggeredBy: idSchema, retryOfRunId: idSchema.optional(), correlationId: idSchema,
  failureCode: idSchema.optional(),
})
export const pipelineRunSchema = legacyPipelineRunV2Schema.extend({ definitionId: idSchema.optional(), definitionRevision: versionSchema.optional(),
  sourceRevision: idSchema.optional(), definitionSnapshot: pipelineDefinitionRunSnapshotSchema.optional(),
}).superRefine((run, ctx) => {
  const fields = [run.definitionId, run.definitionRevision, run.sourceRevision, run.definitionSnapshot]
  if (fields.some(v => v !== undefined) && fields.some(v => v === undefined)) ctx.addIssue({ code: 'custom', path: ['definitionId'], message: 'Definition run metadata must be complete' })
  if (run.sourceRevision !== undefined && run.sourceRevision !== run.revision) ctx.addIssue({ code: 'custom', path: ['sourceRevision'], message: 'Source revision must match the pipeline revision' })
})
export const releaseSchema = z.strictObject({
  ...scopedBase, applicationId: idSchema, environmentId: idSchema, artifactDigest: idSchema, kind: z.enum(['deploy', 'rollback']),
  state: z.enum(['pending_approval', 'queued', 'deploying', 'verifying', 'succeeded', 'failed', 'rejected', 'cancelled']),
  previousReleaseId: idSchema.nullable(), targetReleaseId: idSchema.optional(), pipelineRunId: idSchema.optional(), createdBy: idSchema, correlationId: idSchema,
  health: z.enum(['pending', 'healthy', 'unhealthy']), reason: z.string().trim().min(1).max(500).optional(),
  approval: z.strictObject({ actorId: idSchema, occurredAt: timestampSchema, reason: z.string().min(1).max(500) }).optional(),
  failureCode: idSchema.optional(), startedAt: timestampSchema.optional(), completedAt: timestampSchema.optional(),
})
export const artifactSchema = z.strictObject({
  ...scopedBase, applicationId: idSchema, digest: idSchema, revision: idSchema,
  recipe: z.literal('demo-web-v1'), filename: nameSchema,
})
export const deliveryLogSchema = z.strictObject({
  id: idSchema, operationId: idSchema, applicationId: idSchema, environmentId: idSchema,
  occurredAt: timestampSchema, stage: pipelineStageSchema.shape.name,
  level: z.enum(['info', 'error']), message: z.string().max(500),
})
export const releaseDetailSchema = z.strictObject({
  release: releaseSchema, artifact: artifactSchema, rollbackTargets: z.array(releaseSchema),
})
export const incidentEvidenceSchema = z.strictObject({
  ruleKey: idSchema, metric: z.enum(['p95Latency', 'errorRate']), threshold: z.number().nonnegative(),
  sampleWindow: z.strictObject({ from: timestampSchema, to: timestampSchema }), traceIds: ids, logIds: ids,
})
export const incidentSchema = z.strictObject({
  ...scopedBase, applicationId: idSchema, environmentId: idSchema, affectedCiIds: ids, severity: z.enum(['critical', 'warning']),
  state: z.enum(['open', 'acknowledged', 'investigating', 'resolved']), assigneeId: idSchema.optional(), relatedReleaseId: idSchema.optional(),
  episode: versionSchema, ruleKey: idSchema, evidence: z.array(incidentEvidenceSchema), recoverySamples: z.number().int().nonnegative(), correlationId: idSchema,
})
export const integrationSchema = z.strictObject({
  ...scopedBase, kind: z.enum(['inventory', 'delivery', 'observation']), displayName: nameSchema,
  poolIds: ids, endpointLabel: z.string().max(200), state: z.enum(['demo', 'connected', 'error']), lastSyncAt: timestampSchema.nullable(),
  fieldMappings: z.record(z.string(), z.string()), lastTestResult: z.strictObject({ demo: z.literal(true), succeeded: z.boolean(), summary: z.string(), occurredAt: timestampSchema }).optional(),
})
export const observationBucketSchema = z.strictObject({
  id: idSchema, applicationId: idSchema, environmentId: idSchema, from: timestampSchema, to: timestampSchema,
  releaseId: idSchema.optional(), rate: z.number().nonnegative().nullable(), errorRate: z.number().min(0).max(1).nullable(),
  p95Latency: z.number().nonnegative().nullable(), source: z.literal('demo'),
})
export const observationLogSchema = z.strictObject({
  id: idSchema, applicationId: idSchema, environmentId: idSchema, occurredAt: timestampSchema,
  level: z.enum(['debug', 'info', 'warn', 'error']), message: z.string().refine(value => new TextEncoder().encode(value).length <= 2048),
  traceId: idSchema.optional(), releaseId: idSchema.optional(), ciId: idSchema.optional(),
})
export const traceSummarySchema = z.strictObject({
  id: idSchema, applicationId: idSchema, environmentId: idSchema, name: nameSchema, start: timestampSchema,
  durationMs: z.number().nonnegative(), status: z.enum(['ok', 'error']), releaseId: idSchema.optional(),
})
export const traceSpanSchema = z.strictObject({ id: idSchema, parentId: idSchema.nullable(), name: nameSchema,
  start: timestampSchema, durationMs: z.number().nonnegative(), status: z.enum(['ok', 'error']), ciId: idSchema.optional() })
export const traceSchema = traceSummarySchema.extend({ spans: z.array(traceSpanSchema) })
export const metricSeriesSchema = z.strictObject({ metric: z.enum(['rate', 'errorRate', 'p95Latency']),
  unit: z.enum(['ms', 'requests/second', 'fraction']), points: z.array(z.strictObject({ t: timestampSchema, value: z.number().nullable() })),
  sampleCount: z.number().int().nonnegative() })
export const metricsViewSchema = z.strictObject({ series: z.array(metricSeriesSchema) })
export const notificationSchema = z.strictObject({ id: idSchema, title: z.string().max(200), entityType: idSchema,
  entityId: idSchema, route: z.string().startsWith('/'), occurredAt: timestampSchema })
export const guideStepSchema = z.strictObject({ id: idSchema, title: z.string(), description: z.string(),
  persona: z.enum(['rd', 'ops', 'admin', 'any']), completed: z.boolean(), route: z.string().startsWith('/').nullable() })
export const entityReferenceSchema = z.strictObject({ entityType: idSchema, entityId: idSchema })
export const commandReceiptSchema = z.strictObject({
  entityType: idSchema, entityId: idSchema, entityVersion: versionSchema, correlationId: idSchema,
  changed: z.array(entityReferenceSchema), operationId: idSchema.optional(),
})
export const eventSchema = z.strictObject({
  eventId: idSchema, entities: z.array(entityReferenceSchema), type: idSchema, occurredAt: timestampSchema, correlationId: idSchema,
})
export const auditEventSchema = z.strictObject({
  id: idSchema, orgId: idSchema, actorId: idSchema, action: idSchema, entityType: idSchema, entityId: idSchema,
  scopeSnapshot: z.strictObject({ projectIds: ids, poolIds: ids, stages: z.array(stageSchema), relationEndpointCiIds: z.tuple([idSchema, idSchema]).optional() }),
  outcome: z.enum(['succeeded', 'denied', 'conflict']), diffSummary: z.array(z.string().max(200)), reason: z.string().min(1).max(500).optional(),
  requestId: idSchema, correlationId: idSchema, occurredAt: timestampSchema,
})
export const idempotencyRecordSchema = z.strictObject({
  sessionId: idSchema, actorId: idSchema, method: idSchema, path: z.string().min(1), key: idSchema,
  bodyHash: z.string(), canonicalBody: z.string(), receipt: commandReceiptSchema,
})
export const legacySnapshotV2Schema = z.strictObject({
  schemaVersion: z.literal(2), seedVersion: z.literal('dim-gate-w2-v1'), sessionId: idSchema,
  logicalClock: z.number().int().nonnegative(), sequence: z.number().int().nonnegative(),
  storeRevision: z.number().int().nonnegative(), policyVersion: versionSchema, commandCount: z.number().int().min(0).max(1000),
  entities: z.strictObject({
    organizations: z.array(organizationSchema), businessUnits: z.array(businessUnitSchema), teams: z.array(legacyTeamSchema),
    projects: z.array(projectSchema), users: z.array(legacyUserSchema), applications: z.array(applicationSchema),
    environments: z.array(environmentSchema), accounts: z.array(providerAccountSchema), locations: z.array(locationSchema),
    pools: z.array(poolSchema), cis: z.array(ciSchema), placements: z.array(placementSchema), relations: z.array(relationSchema),
    assignments: z.array(roleAssignmentSchema), navigation: z.array(legacyNavigationItemV2Schema), modelFields: z.array(modelFieldSchema),
    catalogs: z.array(catalogItemSchema), catalogHistory: z.array(catalogItemSchema), requests: z.array(requestSchema),
    pipelines: z.array(legacyPipelineRunV2Schema), releases: z.array(releaseSchema), artifacts: z.array(artifactSchema),
    incidents: z.array(incidentSchema), integrations: z.array(integrationSchema),
    resourceObjects: z.array(resourceObjectSchema), resourceBindings: z.array(resourceBindingSchema), resourceQuotas: z.array(resourceQuotaSchema),
    changes: z.array(changeRequestSchema), changeExecutions: z.array(changeExecutionSchema),
  }),
  observations: z.strictObject({ buckets: z.array(observationBucketSchema), traces: z.array(traceSchema), logs: z.array(observationLogSchema),
    recoveries: z.array(z.strictObject({ environmentId: idSchema, releaseId: idSchema, remaining: z.number().int().min(1).max(3), dueTick: z.number().int().nonnegative() })) }),
  deliveryLogs: z.array(deliveryLogSchema),
  jobs: z.array(provisionJobSchema), events: z.array(eventSchema), audit: z.array(auditEventSchema),
  idempotency: z.array(idempotencyRecordSchema), scenarioFlags: jsonFields,
  scheduler: z.strictObject({ tasks: z.array(z.strictObject({ id: idSchema, operationId: idSchema, stepIndex: z.number().int().nonnegative(), dueTick: z.number().int().nonnegative() })) }),
})

export const legacySnapshotSchema = legacySnapshotV2Schema.extend({ schemaVersion: z.literal(1), seedVersion: z.literal('dim-gate-m4-v1'),
  entities: legacySnapshotV2Schema.shape.entities.omit({ resourceObjects: true, resourceBindings: true, resourceQuotas: true, changes: true, changeExecutions: true })
    .extend({ catalogs: z.array(computeCatalogItemSchema), catalogHistory: z.array(computeCatalogItemSchema),
      navigation: z.array(legacyNavigationItemV2Schema.extend({ routeKey: legacyNavigationItemV2Schema.shape.routeKey.exclude(['ops.caches', 'ops.messaging', 'ops.clusters']) })),
    }),
})

export const legacySnapshotV3Schema = legacySnapshotV2Schema.extend({ schemaVersion: z.literal(3), seedVersion: z.literal('dim-gate-w3-v1'),
  entities: legacySnapshotV2Schema.shape.entities.extend({ navigation: z.array(navigationItemSchema), pipelines: z.array(pipelineRunSchema),
    pipelineDefinitions: z.array(pipelineDefinitionSchema), serviceConfigs: z.array(serviceConfigSchema), trafficPolicies: z.array(trafficPolicySchema), serviceExecutions: z.array(serviceExecutionSchema),
  }),
})
export const monitoringIncidentEvidenceSchema = incidentEvidenceSchema.extend({
  metric: z.enum(['rate', 'errorRate', 'p95Latency']), ruleRevision: versionSchema.optional(), sampleId: idSchema.optional(), value: z.number().optional(),
})
export const monitoringIncidentSchema = incidentSchema.extend({ ruleId: idSchema.optional(), ruleRevision: versionSchema.optional(),
  evidence: z.array(monitoringIncidentEvidenceSchema) })
export const incidentVariantSchema = z.union([monitoringIncidentSchema, infrastructureIncidentSchema])
export const legacySnapshotV4Schema = legacySnapshotV3Schema.extend({ schemaVersion: z.literal(4), seedVersion: z.literal('dim-gate-w4-v1'),
  entities: legacySnapshotV3Schema.shape.entities.extend({ navigation: z.array(monitoringNavigationItemSchema),
    incidents: z.array(monitoringIncidentSchema), infrastructureIncidents: z.array(infrastructureIncidentSchema),
    monitorPolicies: z.array(monitorPolicySchema), alertRules: z.array(alertRuleSchema), sloPolicies: z.array(sloPolicySchema),
    silences: z.array(silenceSchema), alertEvaluations: z.array(alertEvaluationSchema), notificationDeliveries: z.array(notificationDeliverySchema),
  }),
  observations: legacySnapshotV3Schema.shape.observations.extend({ infrastructureMetrics: z.array(infrastructureMetricSchema) }),
})
export const snapshotSchema = legacySnapshotV4Schema.extend({ schemaVersion: z.literal(5), seedVersion: z.literal('dim-gate-w5-v1'),
  entities: legacySnapshotV4Schema.shape.entities.extend({ users: z.array(userSchema), teams: z.array(teamSchema),
    platformFeatures: z.array(platformFeatureSchema), platformRoutes: z.array(platformRouteSchema) }),
})

export const personaSchema = z.strictObject({ id: idSchema, displayName: nameSchema, description: z.string(), centers: z.array(centerSchema) })
export const sessionDomainSchema = z.strictObject({
  user: z.strictObject({ id: idSchema, displayName: nameSchema }), assignments: z.array(roleAssignmentSchema), effectiveActions: z.array(z.string()),
  centers: z.array(centerSchema), demo: z.literal(true), sessionId: idSchema, policyVersion: versionSchema,
  featureKeys: z.array(featureKeySchema).optional(),
  storeRevision: z.number().int().nonnegative(), logicalClock: z.number().int().nonnegative(),
})
export const sessionViewSchema = sessionDomainSchema.extend({
  identityEpoch: z.number().int().nonnegative(), generation: z.number().int().nonnegative(), storageMode: z.enum(['session', 'memory']),
})
export const dashboardFiltersSchema = z.strictObject({
  projectId: idSchema.optional(), environmentId: idSchema.optional(), provider: providerSchema.optional(), poolId: idSchema.optional(),
  workOwner: z.enum(['all', 'mine']).optional(),
})
export const dashboardQuerySchema = dashboardFiltersSchema.extend({ center: centerSchema }).refine(
  value => value.center === 'ops' || value.provider === undefined && value.poolId === undefined,
  { message: 'Provider and pool filters are only supported in Ops', path: ['center'] },
).refine(value => value.center === 'rd' || value.workOwner === undefined,
  { message: 'Work owner filter is only supported in RD', path: ['workOwner'] })
export const workspaceHomeItemSchema = z.strictObject({
  sourceType: z.enum(['application', 'environment', 'request', 'release', 'job', 'incident', 'pool', 'ci', 'catalogItem', 'integration', 'auditEvent', 'change', 'changeExecution', 'pipelineDefinition', 'serviceConfig', 'trafficPolicy', 'serviceExecution']),
  sourceId: idSchema, title: z.string(), state: z.string(), route: z.string().startsWith('/'), dataAsOf: timestampSchema, detail: z.string(),
})
export const workspaceHomeSectionSchema = z.strictObject({ title: z.string(), total: z.number().int().nonnegative(), items: z.array(workspaceHomeItemSchema).max(20) })
export const workspaceHomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rd'), services: workspaceHomeSectionSchema, work: workspaceHomeSectionSchema, deliveries: workspaceHomeSectionSchema }),
  z.strictObject({ kind: z.literal('ops'), incidents: workspaceHomeSectionSchema, failures: workspaceHomeSectionSchema,
    approvals: workspaceHomeSectionSchema, capacity: workspaceHomeSectionSchema, staleness: workspaceHomeSectionSchema }),
  z.strictObject({ kind: z.literal('admin'), drafts: workspaceHomeSectionSchema, integrations: workspaceHomeSectionSchema, accessChanges: workspaceHomeSectionSchema }),
])
export const dashboardScopeSchema = z.strictObject({
  projects: z.array(z.strictObject({ id: idSchema, name: nameSchema })),
  environments: z.array(z.strictObject({ id: idSchema, name: nameSchema, applicationId: idSchema })),
  pools: z.array(z.strictObject({ id: idSchema, name: nameSchema, provider: providerSchema })), filters: dashboardFiltersSchema,
})
export const dashboardViewSchema = z.strictObject({
  center: centerSchema, title: z.string(), applicationCount: z.number().int().nonnegative(), environmentCount: z.number().int().nonnegative(),
  activeIncidentCount: z.number().int().nonnegative(), pendingItems: z.array(notificationSchema),
  scope: dashboardScopeSchema, workspace: workspaceHomeSchema,
  ciCount: z.number().int().nonnegative(), providers: z.array(z.strictObject({ provider: providerSchema, count: z.number().int().nonnegative() })), dataAsOf: timestampSchema,
})
export const guideViewSchema = z.strictObject({
  applicationId: idSchema.nullable(), environmentId: idSchema.nullable(), steps: z.array(guideStepSchema),
  logicalClock: z.number().int().nonnegative(), storeRevision: z.number().int().nonnegative(), sessionId: idSchema,
  seedVersion: z.literal('dim-gate-w5-v1'), schemaVersion: z.literal(5), pendingTasks: z.number().int().nonnegative(), commandCount: z.number().int().nonnegative(),
})
export const apiMetaSchema = z.strictObject({ requestId: idSchema, storeRevision: z.number().int().nonnegative(), policyVersion: versionSchema })
export const apiErrorSchema = z.strictObject({
  error: z.strictObject({ code: idSchema, message: z.string(), fieldErrors: z.record(z.string(), z.array(z.string())).optional(), retryable: z.boolean() }),
  meta: z.strictObject({ requestId: idSchema }),
})
export function apiResultSchema<T extends z.ZodType>(data: T) { return z.strictObject({ data, meta: apiMetaSchema }) }
export function pageSchema<T extends z.ZodType>(item: T) { return z.strictObject({ items: z.array(item), total: z.number().int().nonnegative(), page: z.number().int().min(1), pageSize: z.number().int().min(1).max(100) }) }
export const scenarioInputSchema = z.strictObject({
  scenarioKey: z.enum(['provision-failure', 'capacity-exhausted', 'clear-capacity-fault', 'build-failure', 'health-failure', 'rollback-failure', 'post-release-latency', 'recovery-samples', 'resource-failure', 'config-failure', 'traffic-abnormal', 'traffic-missing', 'alert-breach', 'alert-recovery', 'alert-unknown', 'alert-delivery-failure']),
  environmentId: idSchema.optional(), executionId: idSchema.optional(), jobId: idSchema.optional(), poolId: idSchema.optional(), runId: idSchema.optional(), releaseId: idSchema.optional(),
  ruleId: idSchema.optional(),
}).superRefine((value, ctx) => {
  const alert = value.scenarioKey.startsWith('alert-')
  if (alert && (!value.ruleId || value.environmentId || value.executionId || value.jobId || value.poolId || value.runId || value.releaseId)
    || !alert && value.ruleId) ctx.addIssue({ code: 'custom', path: ['ruleId'], message: 'Alert scenario requires only a rule target' })
  const service = ['config-failure', 'traffic-abnormal', 'traffic-missing'].includes(value.scenarioKey)
  if (service && (!value.executionId || value.environmentId || value.jobId || value.poolId || value.runId || value.releaseId)
    || value.executionId && !service && value.scenarioKey !== 'resource-failure') ctx.addIssue({ code: 'custom', path: ['executionId'], message: 'Execution target must match the registered scenario' })
})
export type Center = z.infer<typeof centerSchema>
export type Provider = z.infer<typeof providerSchema>
export type CI = z.infer<typeof ciSchema>
export type CIView = z.infer<typeof ciViewSchema>
export type Application = z.infer<typeof applicationSchema>
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>
export type User = z.infer<typeof userSchema>
export type Team = z.infer<typeof teamSchema>
export type Snapshot = z.infer<typeof snapshotSchema>
export type LegacySnapshotV4 = z.infer<typeof legacySnapshotV4Schema>
export type LegacySnapshotV3 = z.infer<typeof legacySnapshotV3Schema>
export type LegacySnapshotV2 = z.infer<typeof legacySnapshotV2Schema>
export type LegacySnapshot = z.infer<typeof legacySnapshotSchema>
export type ComputeCatalogItem = z.infer<typeof computeCatalogItemSchema>
export type ResourceObject = z.infer<typeof resourceObjectSchema>
export type ResourceBinding = z.infer<typeof resourceBindingSchema>
export type ResourceQuota = z.infer<typeof resourceQuotaSchema>
export type ChangeInput = z.infer<typeof createChangeInputSchema>
export type ChangeRequest = z.infer<typeof changeRequestSchema>
export type ChangeExecution = z.infer<typeof changeExecutionSchema>
export type ChangeDetail = z.infer<typeof changeDetailSchema>
export type ResourceCapacity = z.infer<typeof resourceCapacitySchema>
export type ResourceInventory = z.infer<typeof resourceInventorySchema>
export type ServiceResources = z.infer<typeof serviceResourcesSchema>
export type WorkItem = z.infer<typeof workItemSchema>
export type Persona = z.infer<typeof personaSchema>
export type SessionView = z.infer<typeof sessionViewSchema>
export type SessionDomain = z.infer<typeof sessionDomainSchema>
export type DashboardView = z.infer<typeof dashboardViewSchema>
export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>
export type WorkspaceHome = z.infer<typeof workspaceHomeSchema>
export type WorkspaceHomeItem = z.infer<typeof workspaceHomeItemSchema>
export type WorkspaceHomeSection = z.infer<typeof workspaceHomeSectionSchema>
export type GuideView = z.infer<typeof guideViewSchema>
export type CommandReceipt = z.infer<typeof commandReceiptSchema>
export type Environment = z.infer<typeof environmentSchema>
export type Placement = z.infer<typeof placementSchema>
export type Relation = z.infer<typeof relationSchema>
export type AuditEvent = z.infer<typeof auditEventSchema>
export type CatalogItem = z.infer<typeof catalogItemSchema>
export type Request = z.infer<typeof requestSchema>
export type ProvisionJob = z.infer<typeof provisionJobSchema>
export type PipelineRun = z.infer<typeof pipelineRunSchema>
export type Release = z.infer<typeof releaseSchema>
export type Artifact = z.infer<typeof artifactSchema>
export type Incident = z.infer<typeof monitoringIncidentSchema>
export type Integration = z.infer<typeof integrationSchema>
export type ObservationBucket = z.infer<typeof observationBucketSchema>
export type ObservationLog = z.infer<typeof observationLogSchema>
export type Trace = z.infer<typeof traceSchema>
export type TraceSummary = z.infer<typeof traceSummarySchema>
export type MetricSeries = z.infer<typeof metricSeriesSchema>
export type Notification = z.infer<typeof notificationSchema>
export type DeliveryLog = z.infer<typeof deliveryLogSchema>
export type NavigationItem = z.infer<typeof monitoringNavigationItemSchema>
export type ModelField = z.infer<typeof modelFieldSchema>
export type ApiError = z.infer<typeof apiErrorSchema>
export type ApiResult<T> = { data: T; meta: z.infer<typeof apiMetaSchema> }
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }

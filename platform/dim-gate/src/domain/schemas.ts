import { z } from 'zod'

export const idSchema = z.string().min(1).max(160)
export const nameSchema = z.string().trim().min(1).max(80)
export const timestampSchema = z.iso.datetime({ offset: false })
export const versionSchema = z.number().int().min(1)
export const centerSchema = z.enum(['rd', 'ops', 'admin'])
export const providerSchema = z.enum(['aws', 'aliyun', 'onprem'])
export const stageSchema = z.enum(['dev', 'staging', 'prod'])
export const ciKindSchema = z.enum(['compute', 'cluster', 'database', 'cache', 'queue', 'load_balancer', 'network', 'storage'])
export const healthSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown'])
const ids = z.array(idSchema).refine((items) => new Set(items).size === items.length, 'IDs must be unique')
const base = { id: idSchema, version: versionSchema, createdAt: timestampSchema, updatedAt: timestampSchema }
const scopedBase = { ...base, orgId: idSchema }
const jsonFields = z.record(z.string().min(1).max(80), z.json())
export const tagsSchema = z.record(z.string().min(1).max(64), z.string().max(256)).refine((tags) => Object.keys(tags).length <= 20, 'At most 20 tags')

export const organizationSchema = z.strictObject({ ...base, name: nameSchema })
export const businessUnitSchema = z.strictObject({ ...scopedBase, name: nameSchema })
export const teamSchema = z.strictObject({ ...scopedBase, businessUnitId: idSchema, name: nameSchema })
export const projectSchema = z.strictObject({ ...scopedBase, teamId: idSchema, name: nameSchema, slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) })
export const userSchema = z.strictObject({ ...scopedBase, displayName: nameSchema, teamIds: ids, enabled: z.boolean() })
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
export const navigationItemSchema = z.strictObject({
  ...scopedBase, routeKey: z.enum([
    'rd.overview', 'rd.apps', 'rd.catalog', 'rd.requests', 'rd.pipelines', 'rd.observability',
    'ops.overview', 'ops.cmdb', 'ops.topology', 'ops.requests', 'ops.jobs', 'ops.capacity', 'ops.releases', 'ops.incidents',
    'admin.overview', 'admin.access', 'admin.navigation', 'admin.catalog', 'admin.cmdb-models', 'admin.audit', 'admin.integrations',
    'guide',
  ]),
  label: nameSchema, group: nameSchema, order: z.number().int(), enabled: z.boolean(),
})
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
export const catalogTemplateSchema = z.strictObject({
  allowedProviders: z.array(providerSchema).min(1), allowedStages: z.array(stageSchema).min(1), allowedPoolIds: ids,
  defaults: z.strictObject({ cpu: z.number().int().min(1).max(64), memoryMiB: z.number().int().min(128).max(262144).multipleOf(128) }),
  limits: z.strictObject({ maxCpu: z.number().int().min(1).max(64), maxMemoryMiB: z.number().int().min(128).max(262144).multipleOf(128) }),
  requiresApproval: z.literal(true), resourceKind: z.literal('compute'), bootstrapProfile: z.literal('web-service'),
})
export const catalogItemSchema = z.strictObject({
  ...scopedBase, name: nameSchema, description: z.string().max(2000), revision: versionSchema,
  status: z.enum(['draft', 'published', 'disabled']), allowedProjectIds: ids, template: catalogTemplateSchema,
})
export const requestSchema = z.strictObject({
  ...scopedBase, requesterId: idSchema, applicationId: idSchema, environmentName: nameSchema, stage: stageSchema,
  catalogItemId: idSchema, catalogRevision: versionSchema, templateSnapshot: catalogTemplateSchema, provider: providerSchema,
  poolId: idSchema, cpu: z.number().int().min(1).max(64), memoryMiB: z.number().int().min(128).max(262144).multipleOf(128),
  purpose: z.string().trim().min(1).max(500), state: z.enum(['draft', 'submitted', 'approved', 'rejected', 'cancelled', 'provisioning', 'fulfilled', 'failed']),
  approval: z.strictObject({ actorId: idSchema, occurredAt: timestampSchema, reason: z.string().min(1).max(500) }).optional(),
  environmentId: idSchema.optional(), latestJobId: idSchema.optional(), correlationId: idSchema,
})
export const pipelineStageSchema = z.strictObject({
  name: z.enum(['build', 'test', 'package', 'deploy', 'verify']), state: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped']),
  startedAt: timestampSchema.optional(), completedAt: timestampSchema.optional(),
})
export const pipelineRunSchema = z.strictObject({
  ...scopedBase, applicationId: idSchema, environmentId: idSchema, revision: idSchema, artifactDigest: idSchema.optional(),
  stages: z.array(pipelineStageSchema), state: z.enum(['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled']),
  releaseId: idSchema.optional(), triggeredBy: idSchema, retryOfRunId: idSchema.optional(), correlationId: idSchema,
  failureCode: idSchema.optional(),
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
export const acknowledgeIncidentInputSchema = z.strictObject({ expectedVersion: versionSchema, reason: z.string().trim().min(1).max(500).optional() })
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
export const snapshotSchema = z.strictObject({
  schemaVersion: z.literal(1), seedVersion: z.literal('dim-gate-m4-v1'), sessionId: idSchema,
  logicalClock: z.number().int().nonnegative(), sequence: z.number().int().nonnegative(),
  storeRevision: z.number().int().nonnegative(), policyVersion: versionSchema, commandCount: z.number().int().min(0).max(1000),
  entities: z.strictObject({
    organizations: z.array(organizationSchema), businessUnits: z.array(businessUnitSchema), teams: z.array(teamSchema),
    projects: z.array(projectSchema), users: z.array(userSchema), applications: z.array(applicationSchema),
    environments: z.array(environmentSchema), accounts: z.array(providerAccountSchema), locations: z.array(locationSchema),
    pools: z.array(poolSchema), cis: z.array(ciSchema), placements: z.array(placementSchema), relations: z.array(relationSchema),
    assignments: z.array(roleAssignmentSchema), navigation: z.array(navigationItemSchema), modelFields: z.array(modelFieldSchema),
    catalogs: z.array(catalogItemSchema), catalogHistory: z.array(catalogItemSchema), requests: z.array(requestSchema),
    pipelines: z.array(pipelineRunSchema), releases: z.array(releaseSchema), artifacts: z.array(artifactSchema),
    incidents: z.array(incidentSchema), integrations: z.array(integrationSchema),
  }),
  observations: z.strictObject({ buckets: z.array(observationBucketSchema), traces: z.array(traceSchema), logs: z.array(observationLogSchema),
    recoveries: z.array(z.strictObject({ environmentId: idSchema, releaseId: idSchema, remaining: z.number().int().min(1).max(3), dueTick: z.number().int().nonnegative() })) }),
  deliveryLogs: z.array(deliveryLogSchema),
  jobs: z.array(provisionJobSchema), events: z.array(eventSchema), audit: z.array(auditEventSchema),
  idempotency: z.array(idempotencyRecordSchema), scenarioFlags: jsonFields,
  scheduler: z.strictObject({ tasks: z.array(z.strictObject({ id: idSchema, operationId: idSchema, stepIndex: z.number().int().nonnegative(), dueTick: z.number().int().nonnegative() })) }),
})

export const personaSchema = z.strictObject({ id: idSchema, displayName: nameSchema, description: z.string(), centers: z.array(centerSchema) })
export const sessionDomainSchema = z.strictObject({
  user: z.strictObject({ id: idSchema, displayName: nameSchema }), assignments: z.array(roleAssignmentSchema), effectiveActions: z.array(z.string()),
  centers: z.array(centerSchema), demo: z.literal(true), sessionId: idSchema, policyVersion: versionSchema,
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
  sourceType: z.enum(['application', 'environment', 'request', 'release', 'job', 'incident', 'pool', 'ci', 'catalogItem', 'integration', 'auditEvent']),
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
  seedVersion: z.literal('dim-gate-m4-v1'), schemaVersion: z.literal(1), pendingTasks: z.number().int().nonnegative(), commandCount: z.number().int().nonnegative(),
})
export const apiMetaSchema = z.strictObject({ requestId: idSchema, storeRevision: z.number().int().nonnegative(), policyVersion: versionSchema })
export const apiErrorSchema = z.strictObject({
  error: z.strictObject({ code: idSchema, message: z.string(), fieldErrors: z.record(z.string(), z.array(z.string())).optional(), retryable: z.boolean() }),
  meta: z.strictObject({ requestId: idSchema }),
})
export function apiResultSchema<T extends z.ZodType>(data: T) { return z.strictObject({ data, meta: apiMetaSchema }) }
export function pageSchema<T extends z.ZodType>(item: T) { return z.strictObject({ items: z.array(item), total: z.number().int().nonnegative(), page: z.number().int().min(1), pageSize: z.number().int().min(1).max(100) }) }
export const commandInputSchema = z.strictObject({ sessionId: idSchema, actorId: idSchema, method: z.string().min(1), path: z.string().min(1), key: idSchema, body: z.unknown() })
export const patchCiSchema = z.strictObject({
  expectedVersion: versionSchema, name: nameSchema.optional(), ownerTeamId: idSchema.optional(), tags: tagsSchema.optional(),
  visibilityProjectIds: ids.refine((value) => value.length > 0, 'At least one project is required').optional(), customFields: jsonFields.optional(),
}).refine((body) => Object.keys(body).length > 1, 'At least one metadata field is required')
export const createCiInputSchema = z.strictObject({
  name: nameSchema, kind: ciKindSchema, provider: providerSchema, externalId: idSchema,
  accountId: idSchema.optional(), locationId: idSchema, poolId: idSchema, ownerTeamId: idSchema,
  visibilityProjectIds: ids.refine((value) => value.length > 0, 'At least one project is required'),
  lifecycle: z.literal('active'), tags: tagsSchema, attributes: jsonFields, customFields: jsonFields,
}).superRefine((body, ctx) => {
  const result = ciSchema.safeParse({ ...body, id: 'validation-only', orgId: 'session-scope', version: 1,
    createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T09:00:00Z', health: 'unknown', source: 'manual', observedAt: null })
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})
export const createRelationInputSchema = z.strictObject({
  sourceCiId: idSchema, targetCiId: idSchema, sourceExpectedVersion: versionSchema,
  targetExpectedVersion: versionSchema, type: relationSchema.shape.type, reason: z.string().trim().min(1).max(500),
}).refine((body) => body.sourceCiId !== body.targetCiId, { path: ['targetCiId'], message: 'A relation cannot reference itself' })
export const deleteRelationInputSchema = z.strictObject({ expectedVersion: versionSchema, reason: z.string().trim().min(1).max(500) })
export const revokeAssignmentSchema = z.strictObject({ expectedVersion: versionSchema, reason: z.string().trim().min(1).max(500) })
export const advanceClockSchema = z.strictObject({ ticks: z.number().int().min(1).max(60) })
export const reasonSchema = z.string().trim().min(1).max(500)
export const versionCommandSchema = z.strictObject({ expectedVersion: versionSchema })
export const reasonCommandSchema = z.strictObject({ expectedVersion: versionSchema, reason: reasonSchema })
export const createRequestInputSchema = z.strictObject({
  applicationId: idSchema, environmentName: nameSchema, stage: stageSchema, catalogItemId: idSchema,
  catalogRevision: versionSchema, provider: providerSchema, poolId: idSchema,
  cpu: z.number().int().min(1).max(64), memoryMiB: z.number().int().min(128).max(262144).multipleOf(128),
  purpose: reasonSchema,
})
export const patchRequestInputSchema = z.strictObject({
  expectedVersion: versionSchema, environmentName: nameSchema.optional(), provider: providerSchema.optional(),
  poolId: idSchema.optional(), cpu: z.number().int().min(1).max(64).optional(),
  memoryMiB: z.number().int().min(128).max(262144).multipleOf(128).optional(), purpose: reasonSchema.optional(),
}).refine((body) => Object.keys(body).length > 1, 'At least one request field is required')
export const createAssignmentInputSchema = z.strictObject({
  userId: idSchema, role: centerSchema, scopeType: z.enum(['org', 'project', 'pool']), scopeId: idSchema,
  stages: z.array(stageSchema).min(1).optional(), reason: reasonSchema,
})
export const patchUserInputSchema = z.strictObject({ expectedVersion: versionSchema, enabled: z.boolean(), reason: reasonSchema })
export const patchNavigationInputSchema = z.strictObject({
  expectedVersion: versionSchema, label: nameSchema.optional(), group: nameSchema.optional(),
  order: z.number().int().optional(), enabled: z.boolean().optional(),
}).refine((body) => Object.keys(body).length > 1, 'At least one navigation field is required')
const catalogMutableFields = {
  template: catalogTemplateSchema, name: nameSchema, description: z.string().max(2000),
  allowedProjectIds: ids,
}
export const createCatalogRevisionInputSchema = z.strictObject({
  expectedVersion: versionSchema, reason: reasonSchema, baseRevision: versionSchema, ...catalogMutableFields,
})
export const patchCatalogInputSchema = z.strictObject({
  expectedVersion: versionSchema, revision: versionSchema,
  ...Object.fromEntries(Object.entries(catalogMutableFields).map(([key, value]) => [key, value.optional()])),
}).refine((body) => Object.keys(body).length > 2, 'At least one catalog field is required')
export const publishCatalogInputSchema = z.strictObject({
  expectedVersion: versionSchema, reason: reasonSchema, revision: versionSchema,
})
export const createModelFieldInputSchema = modelFieldSchema.omit({
  id: true, version: true, createdAt: true, updatedAt: true, orgId: true, required: true, hidden: true,
})
export const patchModelFieldInputSchema = z.strictObject({
  expectedVersion: versionSchema, label: nameSchema.optional(), hidden: z.boolean().optional(),
}).refine((body) => Object.keys(body).length > 1, 'At least one model field property is required')
export const scenarioInputSchema = z.strictObject({
  scenarioKey: z.enum(['provision-failure', 'capacity-exhausted', 'clear-capacity-fault', 'build-failure', 'health-failure', 'rollback-failure', 'post-release-latency', 'recovery-samples']),
  environmentId: idSchema.optional(), jobId: idSchema.optional(), poolId: idSchema.optional(), runId: idSchema.optional(), releaseId: idSchema.optional(),
})
export const createPipelineInputSchema = z.strictObject({
  applicationId: idSchema, environmentId: idSchema, revision: idSchema.trim().min(1), environmentVersion: versionSchema,
})
export const rollbackReleaseInputSchema = reasonCommandSchema.extend({ targetReleaseId: idSchema, environmentVersion: versionSchema })

export type Center = z.infer<typeof centerSchema>
export type Provider = z.infer<typeof providerSchema>
export type CI = z.infer<typeof ciSchema>
export type CIView = z.infer<typeof ciViewSchema>
export type Application = z.infer<typeof applicationSchema>
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>
export type Snapshot = z.infer<typeof snapshotSchema>
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
export type CommandInput = z.infer<typeof commandInputSchema>
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
export type Incident = z.infer<typeof incidentSchema>
export type Integration = z.infer<typeof integrationSchema>
export type ObservationBucket = z.infer<typeof observationBucketSchema>
export type ObservationLog = z.infer<typeof observationLogSchema>
export type Trace = z.infer<typeof traceSchema>
export type TraceSummary = z.infer<typeof traceSummarySchema>
export type MetricSeries = z.infer<typeof metricSeriesSchema>
export type Notification = z.infer<typeof notificationSchema>
export type DeliveryLog = z.infer<typeof deliveryLogSchema>
export type NavigationItem = z.infer<typeof navigationItemSchema>
export type ModelField = z.infer<typeof modelFieldSchema>
export type ApiError = z.infer<typeof apiErrorSchema>
export type ApiResult<T> = { data: T; meta: z.infer<typeof apiMetaSchema> }
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }

export const contractSchemas = {
  Organization: organizationSchema, BusinessUnit: businessUnitSchema, Team: teamSchema, Project: projectSchema,
  User: userSchema, Application: applicationSchema, Environment: environmentSchema, ProviderAccount: providerAccountSchema,
  Location: locationSchema, ResourcePool: poolSchema, CI: ciSchema, CIView: ciViewSchema, AWSComputeAttributes: awsComputeAttributesSchema,
  AliyunComputeAttributes: aliyunComputeAttributesSchema, OnpremComputeAttributes: onpremComputeAttributesSchema,
  Placement: placementSchema, Relation: relationSchema, RoleAssignment: roleAssignmentSchema,
  NavigationItem: navigationItemSchema, ModelField: modelFieldSchema, CatalogTemplate: catalogTemplateSchema,
  CatalogItem: catalogItemSchema, Request: requestSchema, ProvisionJob: provisionJobSchema, PipelineRun: pipelineRunSchema,
  Release: releaseSchema, Artifact: artifactSchema, DeliveryLog: deliveryLogSchema, ReleaseDetail: releaseDetailSchema,
  ObservationBucket: observationBucketSchema, LogEntry: observationLogSchema, TraceSummary: traceSummarySchema,
  Trace: traceSchema, MetricSeries: metricSeriesSchema, MetricsView: metricsViewSchema, Notification: notificationSchema,
  AcknowledgeIncident: acknowledgeIncidentInputSchema,
  Incident: incidentSchema, Integration: integrationSchema, AuditEvent: auditEventSchema,
  DomainEvent: eventSchema, Snapshot: snapshotSchema, Persona: personaSchema, SessionView: sessionViewSchema,
  DashboardView: dashboardViewSchema, GuideView: guideViewSchema, CommandReceipt: commandReceiptSchema,
  ApiError: apiErrorSchema, CreateCI: createCiInputSchema, PatchCI: patchCiSchema,
  CreateRelation: createRelationInputSchema, DeleteRelation: deleteRelationInputSchema,
  RevokeAssignment: revokeAssignmentSchema, AdvanceClock: advanceClockSchema,
  VersionCommand: versionCommandSchema, ReasonCommand: reasonCommandSchema,
  CreateRequest: createRequestInputSchema, PatchRequest: patchRequestInputSchema,
  CreateAssignment: createAssignmentInputSchema, PatchUser: patchUserInputSchema,
  PatchNavigation: patchNavigationInputSchema, CreateCatalogRevision: createCatalogRevisionInputSchema,
  PatchCatalog: patchCatalogInputSchema, PublishCatalog: publishCatalogInputSchema,
  CreateModelField: createModelFieldInputSchema, PatchModelField: patchModelFieldInputSchema,
  ScenarioInput: scenarioInputSchema,
  CreatePipeline: createPipelineInputSchema, RollbackRelease: rollbackReleaseInputSchema,
}

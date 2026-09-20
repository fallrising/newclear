/** Wire contract registry. Planned operations are contracts, not implemented handlers. */
import { z } from 'zod'
import * as d from '../domain/schemas.ts'
import { controlResultSchema, personaBodySchema, resetBodySchema } from './control-dto.ts'

const id = d.idSchema
const reason = z.string().trim().min(1).max(500)
const version = d.versionSchema
const expected = { expectedVersion: version }
const withReason = { ...expected, reason }
const ids = z.array(id).refine(values => new Set(values).size === values.length, 'IDs must be unique')
const cpu = z.number().int().min(1).max(64)
const memoryMiB = z.number().int().min(128).max(262144).multipleOf(128)
const fields = z.record(z.string().min(1).max(80), z.json())
const scope = { applicationId: id, environmentId: id }
const windowFields = { ...scope, from: d.timestampSchema, to: d.timestampSchema }
const pageFields = {
  q: z.string().max(100).optional(), page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25), order: z.enum(['asc', 'desc']).default('asc'),
}
const listQuery = (extra: z.ZodRawShape = {}, sort = ['id', 'name', 'updatedAt']) => z.strictObject({
  ...pageFields, sort: z.enum(sort as [string, ...string[]]).default(sort.includes('name') ? 'name' : sort[0]), ...extra,
})
const windowQuery = (extra: z.ZodRawShape = {}) => z.strictObject({ ...windowFields, ...extra }).refine(input => {
  const duration = Date.parse(input.to) - Date.parse(input.from)
  return duration > 0 && duration <= 86_400_000
}, 'Window must be positive and at most 24 hours')
const logEntry = z.strictObject({ id, ...scope, occurredAt: d.timestampSchema, level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string().refine(message => new TextEncoder().encode(message).length <= 2048, 'Message exceeds 2 KiB'),
  traceId: id.optional(), releaseId: id.optional() })
const traceSummary = z.strictObject({ id, ...scope, name: d.nameSchema, start: d.timestampSchema,
  durationMs: z.number().nonnegative(), status: z.enum(['ok', 'error']), releaseId: id.optional() })
const traceSpan = z.strictObject({ id, parentId: id.nullable(), name: d.nameSchema, start: d.timestampSchema,
  durationMs: z.number().nonnegative(), status: z.enum(['ok', 'error']) })
const metricSeries = z.strictObject({ metric: id, unit: z.enum(['ms', 'requests/second', 'fraction']),
  points: z.array(z.strictObject({ t: d.timestampSchema, value: z.number().nullable() })), sampleCount: z.number().int().nonnegative() })
const requestFields = {
  environmentName: d.nameSchema, provider: d.providerSchema, poolId: id, cpu, memoryMiB, purpose: reason,
}
const catalogFields = { template: d.catalogTemplateSchema, name: d.nameSchema,
  description: z.string().max(2000), allowedProjectIds: ids }

// Entity refinements and graph/scope invariants still run in the domain engine.
export const createCiSchema = z.strictObject({
  name: d.nameSchema, kind: d.ciKindSchema, provider: d.providerSchema, externalId: id,
  accountId: id.optional(), locationId: id, poolId: id, ownerTeamId: id,
  visibilityProjectIds: ids.min(1), lifecycle: d.ciSchema.shape.lifecycle,
  tags: d.tagsSchema, attributes: fields, customFields: fields,
}).superRefine((body, context) => {
  const checked = d.ciSchema.safeParse({ ...body, id: 'validation-only', orgId: 'session-scope', version: 1,
    createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T09:00:00Z', health: 'unknown', source: 'manual', observedAt: null })
  if (!checked.success) for (const issue of checked.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})
export const wireSchemas = {
  ...d.contractSchemas,
  OrganizationView: z.strictObject({ organizations: z.array(d.organizationSchema), businessUnits: z.array(d.businessUnitSchema),
    teams: z.array(d.teamSchema), projects: z.array(d.projectSchema), users: z.array(d.userSchema) }),
  ApplicationDetail: z.strictObject({ application: d.applicationSchema, environments: z.array(d.environmentSchema) }),
  EnvironmentDetail: z.strictObject({ environment: d.environmentSchema, placements: z.array(d.placementSchema), activeRelease: d.releaseSchema.nullable() }),
  EntitySearchHit: z.strictObject({ type: z.enum(['application', 'environment', 'ci', 'request', 'incident']), id, title: d.nameSchema, route: z.string().startsWith('/') }),
  TopologyView: z.strictObject({ nodes: z.array(d.ciViewSchema).max(100), edges: z.array(d.relationSchema).max(200), truncated: z.boolean(), depthReached: z.number().int().min(0).max(3) }),
  Capacity: z.strictObject({ poolId: id, cpu: z.strictObject({ used: z.number().nonnegative(), reserved: z.number().nonnegative(), available: z.number().nonnegative() }),
    memoryMiB: z.strictObject({ used: z.number().nonnegative(), reserved: z.number().nonnegative(), available: z.number().nonnegative() }) }),
  LogEntry: logEntry, TraceSummary: traceSummary, Trace: traceSummary.extend({ spans: z.array(traceSpan) }), MetricSeries: metricSeries,
  CreateCI: createCiSchema,
  CreateRelation: z.strictObject({ sourceCiId: id, targetCiId: id, type: z.enum(['runs_on', 'depends_on', 'connects_to']), reason }),
  VersionCommand: z.strictObject(expected), ReasonCommand: z.strictObject(withReason),
  CreateRequest: z.strictObject({ applicationId: id, stage: d.stageSchema, catalogItemId: id, catalogRevision: version, ...requestFields }),
  PatchRequest: z.strictObject({ ...expected, ...Object.fromEntries(Object.entries(requestFields).map(([key, value]) => [key, value.optional()])) }),
  CreatePipeline: z.strictObject({ ...scope, revision: id, environmentVersion: version }),
  RollbackRelease: z.strictObject({ ...withReason, targetReleaseId: id, environmentVersion: version }),
  AcknowledgeIncident: z.strictObject({ ...expected, reason: reason.optional() }),
  CreateAssignment: z.strictObject({ userId: id, role: d.centerSchema, scopeType: z.enum(['org', 'project', 'pool']), scopeId: id, stages: z.array(d.stageSchema).min(1).optional(), reason }),
  PatchUser: z.strictObject({ ...withReason, enabled: z.boolean() }),
  PatchNavigation: z.strictObject({ ...expected, label: d.nameSchema.optional(), group: d.nameSchema.optional(), order: z.number().int().optional(), enabled: z.boolean().optional() }),
  CreateCatalogRevision: z.strictObject({ ...withReason, baseRevision: version, ...catalogFields }),
  PatchCatalog: z.strictObject({ ...expected, revision: version, ...Object.fromEntries(Object.entries(catalogFields).map(([key, value]) => [key, value.optional()])) }),
  PublishCatalog: z.strictObject({ ...withReason, revision: version }),
  CreateModelField: d.modelFieldSchema.omit({ id: true, version: true, createdAt: true, updatedAt: true, orgId: true, required: true, hidden: true }),
  PatchModelField: z.strictObject({ ...expected, label: d.nameSchema.optional(), hidden: z.boolean().optional() }),
  PersonaBody: personaBodySchema, ResetBody: resetBodySchema, ControlResult: controlResultSchema,
  ScenarioBody: z.strictObject({ scenarioKey: z.enum(['slow-network', 'api-unavailable', 'capacity-exhausted', 'clear-capacity-fault',
    'provision-failure', 'build-failure', 'health-failure', 'rollback-failure', 'post-release-latency', 'recovery-samples']),
    environmentId: id.optional(), runId: id.optional(), jobId: id.optional(), releaseId: id.optional(), poolId: id.optional() }),
}

export type Operation = {
  method: 'get' | 'post' | 'patch' | 'delete'; path: string; id: string; milestone: 'M0' | 'M1' | 'M2' | 'M3' | 'M4';
  query?: z.ZodObject; body?: z.ZodType; data: z.ZodType; status: 200 | 201 | 202; demo?: boolean;
}
export const operations: Operation[] = []
const read = (path: string, operationId: string, data: z.ZodType, milestone: Operation['milestone'], query?: z.ZodObject, demo = false) => {
  operations.push({ method: 'get', path, id: operationId, data, milestone, status: 200, query, demo })
}
const command = (method: Operation['method'], path: string, operationId: string, body: z.ZodType,
  milestone: Operation['milestone'], status: 200 | 201 | 202 = 200, demo = false, data: z.ZodType = d.commandReceiptSchema) => {
  operations.push({ method, path, id: operationId, body, milestone, status, demo, data })
}
const w = wireSchemas
const s = d.contractSchemas
read('/session', 'getSession', s.SessionView, 'M0')
read('/organization', 'getOrganization', w.OrganizationView, 'M0')
read('/navigation', 'getNavigation', z.array(s.NavigationItem), 'M0', z.strictObject({ center: d.centerSchema }))
read('/dashboard', 'getDashboard', s.DashboardView, 'M0', z.strictObject({ center: d.centerSchema, projectId: id.optional(), environmentId: id.optional() }))
read('/applications', 'listApplications', d.pageSchema(s.Application), 'M0', listQuery({ projectId: id.optional() }))
read('/cis', 'listCIs', d.pageSchema(s.CIView), 'M0', listQuery({ provider: d.providerSchema.optional(), kind: d.ciKindSchema.optional(), projectId: id.optional(), environmentId: id.optional(), health: d.healthSchema.optional(), freshness: z.enum(['fresh', 'stale']).optional() }, ['id', 'name', 'updatedAt', 'provider', 'kind', 'health']))
read('/cis/{id}', 'getCI', s.CIView, 'M0')
read('/search', 'search', z.strictObject({ items: z.array(w.EntitySearchHit).max(20) }), 'M1', z.strictObject({ q: z.string().min(1).max(100), limit: z.coerce.number().int().min(1).max(20).default(10) }))
read('/applications/{id}', 'getApplication', w.ApplicationDetail, 'M1')
read('/environments/{id}', 'getEnvironment', w.EnvironmentDetail, 'M1')
read('/relations', 'listRelations', d.pageSchema(s.Relation), 'M1', listQuery({ ciId: id, direction: z.enum(['in', 'out', 'both']).default('both') }, ['id', 'updatedAt']))
read('/topology', 'getTopology', w.TopologyView, 'M1', z.strictObject({ ciId: id.optional(), environmentId: id.optional(), mode: z.enum(['dependencies', 'impact']), depth: z.coerce.number().int().min(1).max(3).default(1) }).refine(value => Boolean(value.ciId) !== Boolean(value.environmentId), 'Choose exactly one root'))
read('/pools', 'listPools', z.array(s.ResourcePool), 'M2', z.strictObject({ provider: d.providerSchema.optional(), projectId: id.optional() }))
read('/capacity', 'getCapacity', z.array(w.Capacity), 'M2', z.strictObject({ provider: d.providerSchema.optional(), projectId: id.optional() }))
read('/catalog', 'listCatalog', d.pageSchema(s.CatalogItem), 'M2', listQuery({ revision: version.optional() }))
read('/catalog/{id}', 'getCatalog', s.CatalogItem, 'M2', z.strictObject({ revision: version.optional() }))
read('/requests', 'listRequests', d.pageSchema(s.Request), 'M2', listQuery({ state: d.requestSchema.shape.state.optional(), applicationId: id.optional(), requesterId: id.optional() }, ['id', 'updatedAt']))
read('/requests/{id}', 'getRequest', z.strictObject({ request: s.Request, jobs: z.array(s.ProvisionJob) }), 'M2')
read('/jobs', 'listJobs', d.pageSchema(s.ProvisionJob), 'M2', listQuery({ requestId: id.optional(), state: d.provisionJobSchema.shape.state.optional() }, ['id', 'updatedAt']))
read('/jobs/{id}', 'getJob', z.strictObject({ job: s.ProvisionJob, logs: z.array(logEntry).max(500) }), 'M2')
read('/pipelines', 'listPipelines', d.pageSchema(s.PipelineRun), 'M3', listQuery({ applicationId: id.optional(), environmentId: id.optional(), state: d.pipelineRunSchema.shape.state.optional() }, ['id', 'updatedAt']))
read('/pipelines/{id}', 'getPipeline', z.strictObject({ run: s.PipelineRun, logs: z.array(logEntry).max(500) }), 'M3')
read('/releases', 'listReleases', d.pageSchema(s.Release), 'M3', listQuery({ environmentId: id.optional(), state: d.releaseSchema.shape.state.optional(), kind: d.releaseSchema.shape.kind.optional() }, ['id', 'updatedAt']))
read('/releases/{id}', 'getRelease', s.Release, 'M3')
read('/observability/metrics', 'getMetrics', z.strictObject({ series: z.array(metricSeries) }), 'M4', windowQuery({ step: z.literal('60s').default('60s') }))
read('/observability/traces', 'listTraces', d.pageSchema(traceSummary), 'M4', windowQuery({ ...pageFields, status: z.enum(['ok', 'error']).optional(), sort: z.enum(['id', 'start', 'durationMs']).default('start') }))
read('/observability/traces/{id}', 'getTrace', w.Trace, 'M4')
read('/observability/logs', 'listLogs', d.pageSchema(logEntry), 'M4', windowQuery({ ...pageFields, traceId: id.optional(), releaseId: id.optional(), level: logEntry.shape.level.optional(), sort: z.enum(['id', 'occurredAt']).default('occurredAt') }))
read('/incidents', 'listIncidents', d.pageSchema(s.Incident), 'M4', listQuery({ environmentId: id.optional(), state: d.incidentSchema.shape.state.optional(), severity: d.incidentSchema.shape.severity.optional() }, ['id', 'updatedAt']))
read('/incidents/{id}', 'getIncident', s.Incident, 'M4')
read('/audit', 'listAudit', d.pageSchema(s.AuditEvent), 'M2', listQuery({ entityType: id.optional(), entityId: id.optional(), correlationId: id.optional(), actorId: id.optional(), from: d.timestampSchema.optional(), to: d.timestampSchema.optional() }, ['id', 'occurredAt']))
read('/admin/access', 'getAccess', z.strictObject({ organizations: z.array(s.Organization), users: z.array(s.User), assignments: z.array(s.RoleAssignment), policyVersion: version }), 'M2')
read('/admin/navigation', 'getAdminNavigation', z.array(s.NavigationItem), 'M2', z.strictObject({ center: d.centerSchema.optional() }))
read('/admin/cmdb-models', 'getModels', z.strictObject({ kinds: z.array(d.ciKindSchema), fields: z.array(s.ModelField) }), 'M2')
read('/integrations', 'listIntegrations', z.array(s.Integration), 'M4')

command('post', '/cis', 'createCI', w.CreateCI, 'M1', 201)
command('patch', '/cis/{id}', 'patchCI', s.PatchCI, 'M0')
command('post', '/relations', 'createRelation', w.CreateRelation, 'M1', 201)
command('delete', '/relations/{id}', 'deleteRelation', w.ReasonCommand, 'M1')
command('post', '/requests', 'createRequest', w.CreateRequest, 'M2', 201)
command('patch', '/requests/{id}', 'patchRequest', w.PatchRequest, 'M2')
for (const action of ['submit', 'approve', 'reject', 'cancel', 'provision', 'retry']) command('post', `/requests/{id}/${action}`, `${action}Request`, ['submit', 'provision'].includes(action) ? w.VersionCommand : w.ReasonCommand, 'M2', action === 'provision' ? 202 : 200)
command('post', '/pipelines', 'createPipeline', w.CreatePipeline, 'M3', 202)
command('post', '/pipelines/{id}/cancel', 'cancelPipeline', w.ReasonCommand, 'M3')
command('post', '/pipelines/{id}/retry', 'retryPipeline', w.ReasonCommand, 'M3', 202)
command('post', '/releases/{id}/approve', 'approveRelease', w.ReasonCommand, 'M3', 202)
command('post', '/releases/{id}/reject', 'rejectRelease', w.ReasonCommand, 'M3')
command('post', '/releases/{id}/rollback', 'rollbackRelease', w.RollbackRelease, 'M3', 202)
command('post', '/incidents/{id}/acknowledge', 'acknowledgeIncident', w.AcknowledgeIncident, 'M4')
command('post', '/incidents/{id}/investigate', 'investigateIncident', w.ReasonCommand, 'M4')
command('post', '/admin/assignments', 'createAssignment', w.CreateAssignment, 'M2', 201)
command('delete', '/admin/assignments/{id}', 'revokeAssignment', s.RevokeAssignment, 'M0')
command('patch', '/admin/users/{id}', 'patchUser', w.PatchUser, 'M2')
command('patch', '/admin/navigation/{id}', 'patchNavigation', w.PatchNavigation, 'M2')
command('post', '/admin/catalog/{id}/revisions', 'createCatalogRevision', w.CreateCatalogRevision, 'M2', 201)
command('patch', '/admin/catalog/{id}', 'patchCatalog', w.PatchCatalog, 'M2')
command('post', '/admin/catalog/{id}/publish', 'publishCatalog', w.PublishCatalog, 'M2')
command('post', '/admin/catalog/{id}/disable', 'disableCatalog', w.ReasonCommand, 'M2')
command('post', '/admin/cmdb-fields', 'createModelField', w.CreateModelField, 'M2', 201)
command('patch', '/admin/cmdb-fields/{id}', 'patchModelField', w.PatchModelField, 'M2')
command('post', '/integrations/{id}/test', 'testIntegration', w.VersionCommand, 'M4')
read('/personas', 'getPersonas', z.array(s.Persona), 'M0', undefined, true)
read('/guide', 'getGuide', s.GuideView, 'M0', undefined, true)
command('post', '/persona', 'setPersona', w.PersonaBody, 'M0', 200, true, w.ControlResult)
command('post', '/reset', 'resetDemo', w.ResetBody, 'M0', 200, true, w.ControlResult)
command('post', '/clock/advance', 'advanceClock', s.AdvanceClock, 'M0', 200, true)
command('post', '/scenarios', 'setScenario', w.ScenarioBody, 'M4', 200, true)

/** Wire contract registry. Planned operations are contracts, not implemented handlers. */
import { z } from 'zod'
import * as d from '../domain/schemas.ts'
import { controlResultSchema, personaBodySchema, resetBodySchema } from './control-dto.ts'
import { registerCmdbContracts } from './contracts/cmdb-application-environment.ts'
import { registerCoreSessionContracts } from './contracts/core-session.ts'
import { registerFutureContracts } from './contracts/future.ts'
import { registerTopologyContracts } from './contracts/topology-relation-search.ts'

const id = d.idSchema
const reason = z.string().trim().min(1).max(500)
const version = d.versionSchema
const expected = { expectedVersion: version }
const withReason = { ...expected, reason }
const ids = z.array(id).refine(values => new Set(values).size === values.length, 'IDs must be unique')
const cpu = z.number().int().min(1).max(64)
const memoryMiB = z.number().int().min(128).max(262144).multipleOf(128)
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
export const createCiSchema = d.createCiInputSchema
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
  CreateRelation: d.createRelationInputSchema,
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

export type ContractContext = {
  z: typeof z; d: typeof d; w: typeof wireSchemas; s: typeof d.contractSchemas; id: typeof id; version: typeof version;
  listQuery: typeof listQuery; windowQuery: typeof windowQuery; pageFields: typeof pageFields; logEntry: typeof logEntry;
  metricSeries: typeof metricSeries; traceSummary: typeof traceSummary; read: typeof read; command: typeof command;
}

const context: ContractContext = { z, d, w, s, id, version, listQuery, windowQuery, pageFields, logEntry, metricSeries, traceSummary, read, command }
registerCoreSessionContracts(context)
registerCmdbContracts(context)
registerTopologyContracts(context)
registerFutureContracts(context)

const publishedOperationOrder = 'getSession,getOrganization,getNavigation,getDashboard,listApplications,listCIs,getCI,search,getApplication,getEnvironment,listRelations,getTopology,listPools,getCapacity,listCatalog,getCatalog,listRequests,getRequest,listJobs,getJob,listPipelines,getPipeline,listReleases,getRelease,getMetrics,listTraces,getTrace,listLogs,listIncidents,getIncident,listAudit,getAccess,getAdminNavigation,getModels,listIntegrations,createCI,patchCI,createRelation,deleteRelation,createRequest,patchRequest,submitRequest,approveRequest,rejectRequest,cancelRequest,provisionRequest,retryRequest,createPipeline,cancelPipeline,retryPipeline,approveRelease,rejectRelease,rollbackRelease,acknowledgeIncident,investigateIncident,createAssignment,revokeAssignment,patchUser,patchNavigation,createCatalogRevision,patchCatalog,publishCatalog,disableCatalog,createModelField,patchModelField,testIntegration,getPersonas,getGuide,setPersona,resetDemo,advanceClock,setScenario'.split(',')
const operationRank = new Map(publishedOperationOrder.map((operationId, rank) => [operationId, rank]))
operations.sort((left, right) => (operationRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (operationRank.get(right.id) ?? Number.MAX_SAFE_INTEGER))

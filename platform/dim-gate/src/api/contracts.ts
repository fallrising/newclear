/** Wire contract registry. Planned operations are contracts, not implemented handlers. */
import { z } from 'zod'
import * as d from '../domain/schemas.ts'
import { organizationViewSchema, applicationDetailSchema, environmentDetailSchema, entitySearchHitSchema, topologyViewSchema, capacitySchema } from './wire-views.ts'
import { controlResultSchema, personaBodySchema, resetBodySchema } from './control-dto.ts'
import { registerCmdbContracts } from './contracts/cmdb-application-environment.ts'
import { registerCoreSessionContracts } from './contracts/core-session.ts'
import { registerFutureContracts } from './contracts/future.ts'
import { registerServiceDeliveryContracts } from './contracts/service-delivery.ts'
import { registerResourceContracts } from './contracts/resources.ts'
import { registerTopologyContracts } from './contracts/topology-relation-search.ts'

const id = d.idSchema
const version = d.versionSchema
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
const logEntry = d.observationLogSchema
const traceSummary = d.traceSummarySchema
const metricSeries = d.metricSeriesSchema
// Entity refinements and graph/scope invariants still run in the domain engine.
export const createCiSchema = d.createCiInputSchema
export const wireSchemas = {
  ...d.contractSchemas,
  OrganizationView: organizationViewSchema,
  ApplicationDetail: applicationDetailSchema,
  EnvironmentDetail: environmentDetailSchema,
  EntitySearchHit: entitySearchHitSchema,
  TopologyView: topologyViewSchema,
  Capacity: capacitySchema,
  LogEntry: logEntry, TraceSummary: traceSummary, Trace: d.traceSchema, MetricSeries: metricSeries,
  CreateCI: createCiSchema,
  CreateRelation: d.createRelationInputSchema,
  VersionCommand: d.versionCommandSchema, ReasonCommand: d.reasonCommandSchema,
  CreateRequest: d.createRequestInputSchema,
  PatchRequest: d.patchRequestInputSchema,
  CreatePipeline: d.createPipelineInputSchema,
  RollbackRelease: d.rollbackReleaseInputSchema,
  AcknowledgeIncident: d.acknowledgeIncidentInputSchema,
  CreateAssignment: d.createAssignmentInputSchema,
  PatchUser: d.patchUserInputSchema,
  PatchNavigation: d.patchNavigationInputSchema,
  CreateCatalogRevision: d.createCatalogRevisionInputSchema,
  PatchCatalog: d.patchCatalogInputSchema,
  PublishCatalog: d.publishCatalogInputSchema,
  CreateModelField: d.createModelFieldInputSchema,
  PatchModelField: d.patchModelFieldInputSchema,
  PersonaBody: personaBodySchema, ResetBody: resetBodySchema, ControlResult: controlResultSchema,
  ScenarioBody: d.scenarioInputSchema,
}

export type Operation = {
  method: 'get' | 'post' | 'patch' | 'delete'; path: string; id: string; milestone: 'M0' | 'M1' | 'M2' | 'M3' | 'M4' | 'W2' | 'W3';
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

// Passing the full namespace retains every Zod locale and conversion helper.
// Registry modules only need these constructors; wire validation is unchanged.
const contractZ = { array: z.array, strictObject: z.strictObject, enum: z.enum,
  string: z.string, literal: z.literal, coerce: { number: z.coerce.number } }

export type ContractContext = {
  z: typeof contractZ; d: typeof d; w: typeof wireSchemas; s: typeof d.contractSchemas; id: typeof id; version: typeof version;
  listQuery: typeof listQuery; windowQuery: typeof windowQuery; pageFields: typeof pageFields; logEntry: typeof logEntry;
  metricSeries: typeof metricSeries; traceSummary: typeof traceSummary; read: typeof read; command: typeof command;
}

const context: ContractContext = { z: contractZ, d, w, s, id, version, listQuery, windowQuery, pageFields, logEntry, metricSeries, traceSummary, read, command }
registerCoreSessionContracts(context)
registerCmdbContracts(context)
registerTopologyContracts(context)
registerFutureContracts(context)
registerResourceContracts(context)
registerServiceDeliveryContracts(context)

const publishedOperationOrder = 'getSession,getOrganization,getNavigation,getDashboard,listApplications,listCIs,getCI,search,getApplication,getEnvironment,listRelations,getTopology,listPools,getCapacity,listCatalog,getCatalog,listRequests,getRequest,listJobs,getJob,listPipelines,getPipeline,listReleases,getRelease,getMetrics,listTraces,getTrace,listLogs,listIncidents,getIncident,listAudit,getAccess,getAdminNavigation,getModels,listIntegrations,createCI,patchCI,createRelation,deleteRelation,createRequest,patchRequest,submitRequest,approveRequest,rejectRequest,cancelRequest,provisionRequest,retryRequest,createPipeline,cancelPipeline,retryPipeline,approveRelease,rejectRelease,rollbackRelease,acknowledgeIncident,investigateIncident,createAssignment,revokeAssignment,patchUser,patchNavigation,createCatalogRevision,patchCatalog,publishCatalog,disableCatalog,createModelField,patchModelField,testIntegration,getPersonas,getGuide,setPersona,resetDemo,advanceClock,setScenario'.split(',')
const operationRank = new Map(publishedOperationOrder.map((operationId, rank) => [operationId, rank]))
operations.sort((left, right) => (operationRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (operationRank.get(right.id) ?? Number.MAX_SAFE_INTEGER))

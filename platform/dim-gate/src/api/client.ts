import { z } from 'zod'
import { apiErrorSchema, apiResultSchema } from '../domain/schema-models'
import type { SessionView } from '../domain/schemas'
import { createCmdbClient } from './clients/cmdb'
import { createSessionClient } from './clients/session'
import { createShellClient } from './clients/shell'
import { ApiRequestError } from './core/errors'
import { deferredClient } from './core/deferred-client'
import { identityOf, sameIdentity, type ClientConfiguration, type ClientIdentity } from './core/identity'
import type { ApiRequest, RequestOptions } from './core/request'
import { scopedQueryKey } from './query-definitions'

export { ApiRequestError } from './core/errors'
export type { ClientConfiguration, ClientIdentity } from './core/identity'

export function createApiClient() {
  let session: SessionView | null = null
  let baseUrl = 'http://localhost/dim-gate/'
  let fetcher: typeof fetch = (...args) => globalThis.fetch(...args)
  let createKey: () => string = () => crypto.randomUUID()
  const listeners = new Set<() => void>()
  const uncertainCommands = new Map<string, { key: string; identity: ClientIdentity }>()
  const notify = () => { for (const listener of listeners) listener() }
  const getClientIdentity = (): ClientIdentity | null => session ? identityOf(session) : null
  const updateClientSession = (next: SessionView) => {
    const changed = !session || !sameIdentity(identityOf(session), identityOf(next)) || session.storeRevision !== next.storeRevision
    session = structuredClone(next)
    if (changed) notify()
  }
  const configureClient = (configuration: ClientConfiguration) => {
    baseUrl = (configuration.baseUrl ?? baseUrl).replace(/\/?$/, '/')
    fetcher = configuration.fetch ?? fetcher
    createKey = configuration.createKey ?? createKey
    updateClientSession(configuration.session)
  }
  const stale = () => new ApiRequestError('STALE_RESPONSE', '身分或權限已變更，已忽略舊回應。', 'client-stale', false, 409)
  const request: ApiRequest = async <T>(path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> => {
    const identity = getClientIdentity()
    if (!identity) throw new ApiRequestError('NOT_INITIALIZED', '示範 session 尚未初始化。', 'client-startup', false, 401)
    const method = options.method ?? 'GET'
    const commandSignature = JSON.stringify([method, path, options.body])
    const previous = uncertainCommands.get(commandSignature)
    const replay = previous && (options.identityControl || sameIdentity(previous.identity, identity)) ? previous : undefined
    const requestIdentity = replay?.identity ?? identity
    const key = method === 'GET' ? undefined : (replay?.key ?? createKey())
    const headers: Record<string, string> = { Accept: 'application/json',
      'X-Demo-Persona': requestIdentity.actorId, 'X-Demo-Session': requestIdentity.sessionId }
    if (key) { headers['Idempotency-Key'] = key; headers['Content-Type'] = 'application/json' }
    let response: Response
    try {
      response = await fetcher(new URL(`${options.demo ? '__demo' : 'api'}/v1${path}`, baseUrl), {
        method, headers, cache: 'no-store', ...(key ? { body: JSON.stringify(options.body) } : {}),
      })
    } catch {
      if (key) uncertainCommands.set(commandSignature, { key, identity: requestIdentity })
      throw new ApiRequestError('NETWORK_ERROR', '無法取得 API 回應；再次執行相同操作會沿用原操作 key。', 'client-network', true, 0)
    }
    let payload: unknown
    try { payload = await response.json() } catch {
      if (key) uncertainCommands.set(commandSignature, { key, identity: requestIdentity })
      throw new ApiRequestError('INVALID_RESPONSE', 'API 回應不是有效 JSON。', 'client-response', false, response.status)
    }
    if (!response.ok) {
      uncertainCommands.delete(commandSignature)
      const error = apiErrorSchema.safeParse(payload)
      if (!error.success) throw new ApiRequestError('INVALID_RESPONSE', 'API 錯誤回應格式無效。', 'client-response', false, response.status)
      throw new ApiRequestError(error.data.error.code, error.data.error.message, error.data.meta.requestId,
        error.data.error.retryable, response.status, error.data.error.fieldErrors)
    }
    const parsed = apiResultSchema(schema).safeParse(payload)
    if (!parsed.success) {
      if (key) uncertainCommands.set(commandSignature, { key, identity: requestIdentity })
      throw new ApiRequestError('INVALID_RESPONSE', 'API 回應未符合資料契約。', 'client-response', false, response.status)
    }
    uncertainCommands.delete(commandSignature)
    const current = getClientIdentity()!
    // A policy-changing command updates the subscribed session before its own
    // receipt reaches this client. Accept only that exact committed policy
    // transition; produced reads and unrelated/older command receipts remain
    // stale and are never allowed to cross an identity boundary.
    const acceptsCommittedPolicyCommand = method !== 'GET'
      && identity.sessionId === current.sessionId
      && identity.actorId === current.actorId
      && identity.generation === current.generation
      && current.policyVersion === parsed.data.meta.policyVersion
      && current.policyVersion > identity.policyVersion
      && current.identityEpoch > identity.identityEpoch
    if (!options.identityControl && !sameIdentity(identity, current) && !acceptsCommittedPolicyCommand) throw stale()
    if (session && parsed.data.meta.storeRevision < session.storeRevision) throw stale()
    if (options.identityControl) {
      const next = (parsed.data.data as { session: SessionView }).session
      // A retry retains its original request identity. Its call-time identity may
      // already belong to a later persona, which an obsolete receipt cannot replace.
      // Bootstrap notifications may also have installed this exact returned identity.
      if (!sameIdentity(requestIdentity, current) && !sameIdentity(identityOf(next), current)) throw stale()
      if (session && sameIdentity(identityOf(next), current) && next.storeRevision < session.storeRevision) {
        // An idempotent control receipt may predate subsequent work in this session.
        parsed.data.data = { session: structuredClone(session) } as T
      } else updateClientSession(next)
    } else if (path === '/session') {
      const next = parsed.data.data as SessionView
      if (next.sessionId !== current.sessionId || next.user.id !== current.actorId
        || next.identityEpoch < current.identityEpoch || next.policyVersion < current.policyVersion) throw stale()
      updateClientSession(next)
    } else {
      if (parsed.data.meta.policyVersion !== current.policyVersion) {
        // Refetch the session before caching any result under a changed policy.
        if (session && parsed.data.meta.policyVersion > session.policyVersion) {
          session = { ...session, policyVersion: parsed.data.meta.policyVersion, identityEpoch: session.identityEpoch + 1 }
          notify()
        }
        throw stale()
      }
      if (session && parsed.data.meta.storeRevision > session.storeRevision) {
        session = { ...session, storeRevision: parsed.data.meta.storeRevision }
        notify()
      }
    }
    return parsed.data.data
  }
  const api = {
    ...createSessionClient(request),
    ...createShellClient(request),
    ...deferredClient(() => import('./clients/application').then(module => module.createApplicationClient(request)), {
      listApplications: true, getApplication: true, getEnvironment: true
    }, getClientIdentity),
    ...createCmdbClient(request),
    ...deferredClient(() => import('./clients/topology').then(module => module.createTopologyClient(request)), {
      search: true, getTopology: true, listRelations: true, createRelation: true, deleteRelation: true
    }, getClientIdentity),
    ...deferredClient(() => import('./clients/self-service').then(module => module.createSelfServiceClient(request)), {
      listPools: true, getCapacity: true, listCatalog: true, getCatalog: true, createRequest: true, listRequests: true, getRequest: true, submitRequest: true, approveRequest: true, rejectRequest: true, cancelRequest: true, provisionRequest: true, retryRequest: true, listJobs: true, getJob: true
    }, getClientIdentity),
    ...deferredClient<Omit<ReturnType<typeof import('./clients/admin').createAdminClient>, 'getNavigation'>>(() => import('./clients/admin').then(module => module.createAdminClient(request)), {
      getAccess: true, listAdminUsers: true, getAdminUser: true, createAdminUser: true, updateAdminUser: true,
      listAdminTeams: true, getAdminTeam: true, createAdminTeam: true, patchAdminTeam: true,
      listPlatformFeatures: true, getPlatformFeature: true, previewPlatformFeature: true, getCapabilityRegistry: true,
      createPlatformFeature: true, revisePlatformFeature: true, platformFeatureAction: true, restorePlatformFeature: true,
      listPlatformRoutes: true, getPlatformRoute: true, getPlatformRouteDiagnostic: true, getPlatformRouteRegistry: true,
      createPlatformRoute: true, revisePlatformRoute: true, platformRouteAction: true, restorePlatformRoute: true,
      createAssignment: true, revokeAssignment: true, patchUser: true, getAdminNavigation: true, patchNavigation: true, createCatalogRevision: true, patchCatalog: true, publishCatalog: true, disableCatalog: true, getModels: true, createModelField: true, patchModelField: true, listAudit: true
    }, getClientIdentity),
    ...deferredClient(() => import('./clients/delivery').then(module => module.createDeliveryClient(request)), {
      listPipelines: true, getPipeline: true, createPipeline: true, cancelPipeline: true, retryPipeline: true, listReleases: true, getRelease: true, approveRelease: true, rejectRelease: true, rollbackRelease: true
    }, getClientIdentity),
    ...deferredClient<Omit<ReturnType<typeof import('./clients/observability').createObservabilityClient>, 'getNotifications'>>(() => import('./clients/observability').then(module => module.createObservabilityClient(request)), {
      getMetrics: true, listTraces: true, getTrace: true, listLogs: true, listIncidents: true, getIncident: true, acknowledgeIncident: true, investigateIncident: true, listIntegrations: true, testIntegration: true
    }, getClientIdentity),
    ...deferredClient(() => import('./clients/resources').then(module => module.createResourcesClient(request)), {
      listResourceObjects: true, getResourceObject: true, listBindings: true, getBinding: true, listResourceInventory: true, getResourceInventory: true, getServiceResources: true, listWorkItems: true, listChanges: true, getChange: true, createChange: true, patchChange: true, changeAction: true
    }, getClientIdentity),
    ...deferredClient(() => import('./clients/service-delivery').then(module => module.createServiceDeliveryClient(request)), {
      getDeliveryOptions: true, listPipelineDefinitions: true, getPipelineDefinition: true, createPipelineDefinition: true, patchPipelineDefinition: true, pipelineDefinitionAction: true, runPipelineDefinition: true, listServiceConfigs: true, getServiceConfig: true, createServiceConfig: true, patchServiceConfig: true, serviceConfigAction: true, reviseServiceConfig: true, restoreServiceConfig: true, listTrafficPolicies: true, getTrafficPolicy: true, createTrafficPolicy: true, patchTrafficPolicy: true, trafficPolicyAction: true, reviseTrafficPolicy: true
    }, getClientIdentity),
    ...deferredClient(() => import('./clients/alerting').then(module => module.createAlertingClient(request)), {
      listMonitorPolicies: true, getMonitorPolicy: true, createMonitorPolicy: true, reviseMonitorPolicy: true, monitorPolicyAction: true,
      listAlertRules: true, getAlertRule: true, createAlertRule: true, reviseAlertRule: true, alertRuleAction: true,
      listSloPolicies: true, getSloPolicy: true, createSloPolicy: true, reviseSloPolicy: true, sloPolicyAction: true,
      listSilences: true, getSilence: true, createSilence: true, listAlertEvaluations: true, getAlertEvaluation: true,
      listNotificationDeliveries: true, getNotificationDelivery: true,
    }, getClientIdentity),
    ...deferredClient(() => import('./clients/notifications').then(module => module.createNotificationClient(request)), {
      listAdminChannels: true, createChannel: true, patchChannel: true, testChannel: true,
      listAdminNotificationTemplates: true, createNotificationTemplate: true, reviseNotificationTemplate: true, notificationTemplateAction: true,
      listAdminNotificationPolicies: true, patchNotificationPolicy: true, listNotificationChannels: true,
      listNotificationSubscriptions: true, createNotificationSubscription: true, patchNotificationSubscription: true,
      listNotificationAttempts: true, getNotificationAttempt: true, retryNotificationAttempt: true,
    }, getClientIdentity),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const queryKey = (resourceFamily: string, scope: unknown = null, filters: unknown = null) =>
    scopedQueryKey(getClientIdentity(), resourceFamily, scope, filters)
  return { api, configureClient, getClientIdentity, updateClientSession, queryKey }
}

const shared = createApiClient()
export const api = shared.api
export const configureClient = shared.configureClient
export const getClientIdentity = shared.getClientIdentity
export const updateClientSession = shared.updateClientSession
export const queryKey = shared.queryKey

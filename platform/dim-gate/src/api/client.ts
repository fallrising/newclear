import { z } from 'zod'
import { apiErrorSchema, apiResultSchema } from '../domain/schemas'
import type { SessionView } from '../domain/schemas'
import { createAdminClient } from './clients/admin'
import { createApplicationClient } from './clients/application'
import { createCmdbClient } from './clients/cmdb'
import { createDeliveryClient } from './clients/delivery'
import { createSessionClient } from './clients/session'
import { createSelfServiceClient } from './clients/self-service'
import { createTopologyClient } from './clients/topology'
import { ApiRequestError } from './core/errors'
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
    ...createApplicationClient(request),
    ...createCmdbClient(request),
    ...createTopologyClient(request),
    ...createSelfServiceClient(request),
    ...createAdminClient(request),
    ...createDeliveryClient(request),
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

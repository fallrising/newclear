import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../api/client'
import { operations } from '../api/contracts'
import { apiResultSchema, dashboardViewSchema } from '../domain/schemas'
import { createController, type DemoController } from './controller'
import { createHandlers } from './handlers'

const baseUrl = 'http://localhost/dim-gate/'
const server = setupServer()
let controller: DemoController
let client: ReturnType<typeof createApiClient>
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  let serial = 0
  controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'w1-http' })
  server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
  client = createApiClient()
  client.configureClient({ session: controller.getSession(), baseUrl, createKey: () => `w1-http-${++serial}` })
  controller.subscribe(() => client.updateClientSession(controller.getSession()))
})
async function raw(query: string) {
  const session = controller.getSession()
  return fetch(`${baseUrl}api/v1/dashboard?${query}`, { headers: { 'X-Demo-Session': session.sessionId, 'X-Demo-Persona': session.user.id } })
}

describe('W1 dashboard HTTP contract and typed client', () => {
  it('serves the existing operation with distinct strict role DTOs and leaves the snapshot unchanged', async () => {
    const operation = operations.find(op => op.id === 'getDashboard')!
    for (const [center, actor] of [['rd', 'user-rd-commerce'], ['ops', 'user-ops'], ['admin', 'user-admin']] as const) {
      await client.api.setPersona(actor)
      const before = JSON.stringify(controller.getSnapshot()), response = await raw(`center=${center}`)
      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(apiResultSchema(operation.data).safeParse(payload).success).toBe(true)
      expect(dashboardViewSchema.parse(payload.data).workspace.kind).toBe(center)
      expect(JSON.stringify(controller.getSnapshot())).toBe(before)
    }
  })

  it('serializes every typed filter and keys queries by the full scope and identity/policy', async () => {
    await client.api.setPersona('user-ops')
    const filters = { projectId: 'project-store', environmentId: 'env-checkout-dev', provider: 'onprem' as const, poolId: 'pool-idc-sg' }
    const result = await client.api.getDashboard('ops', filters)
    expect(result.scope.filters).toEqual(filters)
    expect(result).toMatchObject({ applicationCount: 1, environmentCount: 1, ciCount: 1 })
    expect(result.workspace.kind === 'ops' && result.workspace.capacity.items.map(i => i.sourceId)).toEqual(['pool-idc-sg'])
    const session = controller.getSession(), key = client.queryKey('dashboard', 'ops', filters)
    expect(key).toEqual([session.sessionId, session.identityEpoch, session.policyVersion, 'dashboard', 'ops', filters])
    expect(client.queryKey('dashboard', 'ops', { ...filters, provider: 'aws' })).not.toEqual(key)
    const escaped = await client.api.getDashboard('ops', { projectId: 'foreign&provider=aws' })
    expect(escaped.scope.filters).toEqual({ projectId: 'foreign&provider=aws' })
    expect(escaped.applicationCount).toBe(0)
  })

  it('returns 422 for unsupported filters, 403 for ungranted workspaces, and empty foreign data', async () => {
    for (const query of ['center=rd&unknown=1', 'center=rd&provider=aws', 'center=rd&projectId=', 'center=rd&environmentId=a&environmentId=b']) {
      const response = await raw(query); expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR', retryable: false } })
    }
    expect((await raw('center=admin')).status).toBe(403)
    const hidden = await client.api.getDashboard('rd', { projectId: 'project-data', environmentId: 'env-data-dev' })
    expect(hidden).toMatchObject({ applicationCount: 0, environmentCount: 0, ciCount: 0, activeIncidentCount: 0, pendingItems: [] })
    expect(JSON.stringify(hidden.workspace)).not.toContain('data-worker')
    await client.api.setPersona('user-ops')
    expect((await raw('center=ops&provider=invalid')).status).toBe(422)
    const mismatch = await client.api.getDashboard('ops', { provider: 'aws', poolId: 'pool-idc-sg' })
    expect(mismatch.workspace.kind === 'ops' && mismatch.workspace.capacity.total).toBe(0)
  })

  it('discards a held successful scoped home response after an identity switch', async () => {
    let release = () => undefined as void, ready = () => undefined as void
    const held = new Promise<void>(resolve => { release = resolve })
    const responseReady = new Promise<void>(resolve => { ready = resolve })
    client.configureClient({ session: controller.getSession(), fetch: async (...args) => {
      const response = await fetch(...args)
      if (String(args[0]).includes('/dashboard')) { ready(); await held }
      return response
    } })
    const previous = client.api.getDashboard('rd', { projectId: 'project-store', environmentId: 'env-checkout-dev' })
    const rejected = expect(previous).rejects.toMatchObject({ code: 'STALE_RESPONSE' })
    await responseReady
    await client.api.setPersona('user-rd-data')
    release(); await rejected
    const current = await client.api.getDashboard('rd', { projectId: 'project-data' })
    expect(current.workspace.kind === 'rd' && current.workspace.services.items.every(i => !i.title.includes('checkout-api'))).toBe(true)
  })
})

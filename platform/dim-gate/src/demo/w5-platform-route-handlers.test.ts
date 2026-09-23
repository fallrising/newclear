import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../api/client'
import { createController } from './controller'
import { createHandlers } from './handlers'

const baseUrl = 'http://localhost/dim-gate/'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

describe('W5 PlatformRoute typed HTTP API', () => {
  it('keeps deterministic diagnostics and Admin access across the Mock boundary', async () => {
    const controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'w5-route-http' })
    server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
    const client = createApiClient()
    let serial = 0
    client.configureClient({ session: controller.getSession(), baseUrl, createKey: () => `w5-route-http-${++serial}` })
    const unsubscribe = controller.subscribe(() => client.updateClientSession(controller.getSession()))
    try {
      await client.api.setPersona('user-admin')
      const registry = await client.api.getPlatformRouteRegistry()
      expect(registry).toHaveLength(5)
      expect(registry.every(row => row.status === 'mock' && row.supportedAdapters.length > 0)).toBe(true)
      const id = (await client.api.createPlatformRoute({ routeKey: 'observation.apm', capabilityId: 'observation-apm',
        integrationId: 'integration-observation', adapterRef: 'demo-apm-failure', timeoutMs: 1000 }, 'Simulate failure')).entityId
      expect(await client.api.getPlatformRoute(id)).toMatchObject({ status: 'draft', activeRevision: null })
      await client.api.platformRouteAction(id, 'validate', 1, 'Validate')
      await client.api.platformRouteAction(id, 'activate', 2, 'Activate')
      await client.api.platformRouteAction(id, 'test', 3, 'Test deterministic failure')
      expect(await client.api.getPlatformRoute(id)).toMatchObject({ health: { status: 'degraded', code: 'MOCK_FAILURE_FALLBACK' } })
      expect(await client.api.getPlatformRouteDiagnostic(id)).toMatchObject({ status: 'fallback', adapterRef: 'demo-apm' })
      expect((await client.api.listPlatformRoutes()).items).toHaveLength(1)
      await client.api.setPersona('user-rd-commerce')
      await expect(client.api.getPlatformRouteRegistry()).rejects.toMatchObject({ status: 403 })
      await expect(client.api.getPlatformRoute(id)).rejects.toMatchObject({ status: 403 })
    } finally { unsubscribe(); controller.dispose() }
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../api/client'
import { createController } from './controller'
import { createHandlers } from './handlers'

const baseUrl = 'http://localhost/dim-gate/'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

describe('W5 scoped notification HTTP contract', () => {
  it('serves safe Admin metadata and RD-owned subscription without external destinations', async () => {
    const controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'w5-notification-http' })
    server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
    const client = createApiClient()
    let serial = 0
    client.configureClient({ session: controller.getSession(), baseUrl, createKey: () => `w5-notification-http-${++serial}` })
    const unsubscribe = controller.subscribe(() => client.updateClientSession(controller.getSession()))
    try {
      await client.api.setPersona('user-admin')
      expect((await client.api.listAdminChannels()).map(row => row.id)).toEqual(['demo-rd', 'demo-ops'])
      expect(await client.api.listAdminNotificationTemplates()).toHaveLength(1)
      expect(await client.api.listAdminNotificationPolicies()).toHaveLength(1)
      const channelId = (await client.api.createChannel({ kind: 'demo_email', destinationLabel: 'Safe Mock inbox',
        allowedProjectIds: ['project-store'], enabled: true, reason: 'Demo metadata' })).entityId
      const testId = (await client.api.testChannel(channelId, { expectedVersion: 1, simulateFailure: true,
        reason: 'Known Mock failure' })).entityId
      expect(await client.api.getNotificationAttempt(testId)).toMatchObject({ sourceLabel: 'Safe Demo test event',
        attempt: { status: 'failed', sourceKind: 'synthetic-test' } })
      await client.api.retryNotificationAttempt(testId, 1, 'Safe retry')
      await client.api.setPersona('user-rd-commerce')
      const visibleChannels = await client.api.listNotificationChannels('env-checkout-dev')
      expect(visibleChannels.map(row => row.id)).toEqual(['demo-rd', channelId])
      expect(visibleChannels.every(row => row.allowedProjectIds.join(',') === 'project-store')).toBe(true)
      await client.api.createNotificationSubscription({ environmentId: 'env-checkout-dev', channelId,
        reason: 'Own service inbox' })
      expect((await client.api.listNotificationSubscriptions({ environmentId: 'env-checkout-dev' })).items).toHaveLength(1)
      expect((await client.api.listNotificationAttempts()).total).toBe(0)
      await expect(client.api.getNotificationAttempt(testId)).rejects.toMatchObject({ status: 404 })
      await expect(client.api.listAdminChannels()).rejects.toMatchObject({ status: 403 })
    } finally { unsubscribe(); controller.dispose() }
  })
})

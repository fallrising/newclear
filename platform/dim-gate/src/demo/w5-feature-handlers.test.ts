import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../api/client'
import { createController } from './controller'
import { createHandlers } from './handlers'

const baseUrl = 'http://localhost/dim-gate/'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

describe('W5 registered feature HTTP contract', () => {
  it('publishes only fixed capabilities and current-scope deterministic preview', async () => {
    const controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'w5-feature-http' })
    server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
    const client = createApiClient()
    let key = 0
    client.configureClient({ session: controller.getSession(), baseUrl, createKey: () => `w5-feature-http-${++key}` })
    const unsubscribe = controller.subscribe(() => client.updateClientSession(controller.getSession()))
    try {
      await client.api.setPersona('user-admin')
      const registry = await client.api.getCapabilityRegistry()
      expect(registry.features.map(row => row.featureKey)).toEqual(['rd.monitoring', 'ops.alerting', 'rd.delivery', 'rd.traffic'])
      expect(registry.features.every(row => row.status === 'mock' && row.route.startsWith('/') && row.schemaId)).toBe(true)
      expect(registry.routes).toHaveLength(5)
      expect(registry.routes.every(row => row.status === 'mock' && row.diagnostic.status === 'default')).toBe(true)
      expect(registry.later.map(row => row.status)).toEqual(['later', 'later', 'later'])
      const spec = { featureKey: 'rd.monitoring' as const, targetCenter: 'rd' as const,
        eligibleProjectIds: ['project-store'], eligibleTeamIds: ['team-commerce'], rolloutPercent: 0, saltVersion: 1 }
      const id = (await client.api.createPlatformFeature(spec, 'Register cohort')).entityId
      expect(await client.api.getPlatformFeature(id)).toMatchObject({ id, status: 'draft', revision: 1, everActivated: false })
      expect((await client.api.previewPlatformFeature(id)).items.find(row => row.userId === 'user-rd-commerce'))
        .toMatchObject({ eligible: true, reason: 'default-available' })
      await client.api.platformFeatureAction(id, 'validate', 1, 'Validate')
      expect((await client.api.previewPlatformFeature(id)).items.find(row => row.userId === 'user-rd-commerce'))
        .toMatchObject({ eligible: true, reason: 'default-available' })
      await client.api.platformFeatureAction(id, 'activate', 2, 'Activate')
      const preview = await client.api.previewPlatformFeature(id)
      expect(preview.items.find(row => row.userId === 'user-rd-commerce')).toMatchObject({ eligible: false, reason: 'percentage-cohort' })
      expect(preview.items.find(row => row.userId === 'user-rd-data')).toMatchObject({ eligible: false, reason: 'project-cohort' })
      expect(preview.items).toHaveLength(controller.getSnapshot().entities.users.filter(row => row.source === 'seed').length)
      expect((await client.api.listPlatformFeatures()).items).toHaveLength(1)
      await expect(client.api.createPlatformFeature({ ...spec, featureKey: 'admin.access' as never }, 'Recovery override'))
        .rejects.toMatchObject({ status: 422 })
      await client.api.setPersona('user-rd-commerce')
      await expect(client.api.getCapabilityRegistry()).rejects.toMatchObject({ status: 403 })
      await expect(client.api.previewPlatformFeature(id)).rejects.toMatchObject({ status: 403 })
    } finally { unsubscribe(); controller.dispose() }
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../api/client'
import { apiErrorSchema } from '../domain/schemas'
import { createController } from './controller'
import { createHandlers } from './handlers'

const baseUrl = 'http://localhost/dim-gate/'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

describe('W5 typed Admin identity HTTP', () => {
  it('reads back scoped Demo users and teams while keeping role grants separate', async () => {
    const controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'w5-http' })
    server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
    const client = createApiClient()
    let key = 0
    client.configureClient({ session: controller.getSession(), baseUrl, createKey: () => `w5-http-${++key}` })
    const unsubscribe = controller.subscribe(() => client.updateClientSession(controller.getSession()))
    try {
      await client.api.setPersona('user-admin')
      const teamId = (await client.api.createAdminTeam({ businessUnitId: 'bu-technology', name: 'HTTP Demo Team', reason: 'Manage scoped team' })).entityId
      expect(await client.api.getAdminTeam(teamId)).toMatchObject({ id: teamId, source: 'demo', version: 1 })
      const userId = (await client.api.createAdminUser({ displayName: 'HTTP Demo User', teamIds: [teamId], enabled: true, reason: 'Manage scoped user' })).entityId
      const user = await client.api.getAdminUser(userId)
      expect(user).toMatchObject({ id: userId, source: 'demo', teamIds: [teamId], version: 1 })
      expect((await client.api.listAdminUsers()).items.map(row => row.id)).toContain(userId)
      expect((await client.api.listAdminTeams()).items.map(row => row.id)).toContain(teamId)
      expect((await client.api.getAccess()).assignments.some(row => row.userId === userId)).toBe(false)
      await client.api.updateAdminUser(userId, { expectedVersion: user.version, displayName: 'Updated Demo User', reason: 'Display name update' })
      expect(await client.api.getAdminUser(userId)).toMatchObject({ displayName: 'Updated Demo User', version: 2 })
      await expect(client.api.updateAdminUser(userId, { expectedVersion: user.version, enabled: false, reason: 'Old dialog' }))
        .rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
      await expect(client.api.setPersona(userId)).rejects.toMatchObject({ status: 401 })
      expect(controller.getSession().user.id).toBe('user-admin')
    } finally { unsubscribe(); controller.dispose() }
  })

  it('denies Admin API after persona changes and rejects unexpected DTO fields', async () => {
    const controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'w5-http-deny' })
    server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
    const client = createApiClient()
    let key = 0
    client.configureClient({ session: controller.getSession(), baseUrl, createKey: () => `w5-http-deny-${++key}` })
    const unsubscribe = controller.subscribe(() => client.updateClientSession(controller.getSession()))
    try {
      await client.api.setPersona('user-admin')
      const session = controller.getSession()
      const response = await fetch(new URL('api/v1/admin/users', baseUrl), { method: 'POST',
        headers: { 'X-Demo-Session': session.sessionId, 'X-Demo-Persona': session.user.id,
          'Content-Type': 'application/json', 'Idempotency-Key': 'w5-invalid-dto' },
        body: JSON.stringify({ displayName: 'Invalid', teamIds: [], enabled: true, reason: 'Reject arbitrary field', email: 'private@example.invalid' }) })
      expect(response.status).toBe(422)
      expect(apiErrorSchema.safeParse(await response.json()).success).toBe(true)
      await client.api.setPersona('user-rd-commerce')
      await expect(client.api.listAdminUsers()).rejects.toMatchObject({ status: 403 })
      await expect(client.api.createAdminTeam({ businessUnitId: 'bu-commerce', name: 'Denied', reason: 'No Admin grant' }))
        .rejects.toMatchObject({ status: 403 })
    } finally { unsubscribe(); controller.dispose() }
  })
})

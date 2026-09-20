import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from './client'
import { createController } from '../demo/controller'
import type { DemoController } from '../demo/controller'
import { createHandlers } from '../demo/handlers'

const server = setupServer()
const baseUrl = 'http://localhost/dim-gate/'
let controller: DemoController
let client: ReturnType<typeof createApiClient>
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  let serial = 0
  controller = createController({ storage: null, mode: 'memory', createSessionId: () => `client-session-${++serial}` })
  server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
  client = createApiClient()
  client.configureClient({ session: controller.getSession(), baseUrl, createKey: () => `key-${++serial}` })
  controller.subscribe(() => client.updateClientSession(controller.getSession()))
})

describe('typed API client and cache identity', () => {
  it('implements the UI methods with shared transport and notifies after context changes', async () => {
    expect((await client.api.getPersonas()).map((persona) => persona.id)).toContain('user-ops')
    expect((await client.api.getDashboard('rd')).center).toBe('rd')
    const notifications: unknown[] = []
    client.api.subscribe(() => notifications.push(client.getClientIdentity()))
    const initial = client.getClientIdentity()
    await client.api.advanceClock(3)
    expect((await client.api.getGuide()).logicalClock).toBe(3)
    expect(client.getClientIdentity()).toEqual(initial)
    const ops = await client.api.setPersona('user-ops')
    expect(client.getClientIdentity()).toMatchObject({ actorId: 'user-ops', identityEpoch: ops.identityEpoch })
    expect(notifications.at(-1)).toEqual(client.getClientIdentity())
    expect((await client.api.getSession()).user.id).toBe('user-ops')
    const key = client.queryKey('dashboard', 'ops', { page: 1 })
    expect(key).toEqual([ops.sessionId, ops.identityEpoch, ops.policyVersion, 'dashboard', 'ops', { page: 1 }])
    const reset = await client.api.reset()
    expect(reset.generation).toBe(1)
    expect(reset.logicalClock).toBe(0)
  })

  it('throws structured non-retryable forbidden and validation errors', async () => {
    await expect(client.api.getDashboard('admin')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, retryable: false, requestId: expect.stringMatching(/^http-/) })
    await expect(client.api.advanceClock(61)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 422, retryable: false })
  })

  it('discards an already-produced response that arrives after persona switch', async () => {
    let release: () => void = () => undefined
    let responseReady: () => void = () => undefined
    const ready = new Promise<void>((resolve) => { responseReady = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    client.configureClient({ session: controller.getSession(), fetch: async (...args) => {
      const response = await fetch(...args)
      if (String(args[0]).includes('/dashboard')) { responseReady(); await held }
      return response
    } })
    const old = client.api.getDashboard('rd')
    const rejected = expect(old).rejects.toMatchObject({ code: 'STALE_RESPONSE' })
    await ready
    await client.api.setPersona('user-ops')
    release()
    await rejected
    expect(client.getClientIdentity()?.actorId).toBe('user-ops')
  })

  it('reuses a lost-response command key so manual retry never advances the clock twice', async () => {
    let loseResponse = true
    client.configureClient({ session: controller.getSession(), fetch: async (...args) => {
      const response = await fetch(...args)
      if (loseResponse && args[1]?.method === 'POST') { loseResponse = false; throw new TypeError('Connection lost after commit') }
      return response
    } })
    await expect(client.api.advanceClock(2)).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true })
    await client.api.advanceClock(2)
    const guide = await client.api.getGuide()
    expect(guide.logicalClock).toBe(2)
    expect(guide.commandCount).toBe(1)
  })

  it('rejects a stale response after reset even when the selected persona is unchanged', async () => {
    let release: () => void = () => undefined
    let ready: () => void = () => undefined
    const responseReady = new Promise<void>((resolve) => { ready = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    client.configureClient({ session: controller.getSession(), fetch: async (...args) => {
      const response = await fetch(...args)
      if (String(args[0]).endsWith('/guide')) { ready(); await held }
      return response
    } })
    const old = client.api.getGuide()
    const rejected = expect(old).rejects.toMatchObject({ code: 'STALE_RESPONSE' })
    await responseReady
    await client.api.reset()
    release()
    await rejected
  })

  it('retries a lost reset response under its original session and preserves subsequent work', async () => {
    let loseResponse = true
    client.configureClient({ session: controller.getSession(), fetch: async (...args) => {
      const response = await fetch(...args)
      if (loseResponse && String(args[0]).endsWith('/reset')) { loseResponse = false; throw new TypeError('Reset committed, response lost') }
      return response
    } })
    await expect(client.api.reset()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    const resetIdentity = client.getClientIdentity()
    await client.api.advanceClock(3)
    const replay = await client.api.reset()
    expect(client.getClientIdentity()).toEqual(resetIdentity)
    expect(replay.logicalClock).toBe(3)
    expect((await client.api.getGuide()).logicalClock).toBe(3)
  })

  it('retries a lost persona response without another epoch change', async () => {
    let loseResponse = true
    client.configureClient({ session: controller.getSession(), fetch: async (...args) => {
      const response = await fetch(...args)
      if (loseResponse && String(args[0]).endsWith('/persona')) { loseResponse = false; throw new TypeError('Persona response lost') }
      return response
    } })
    await expect(client.api.setPersona('user-ops')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    const changed = client.getClientIdentity()
    expect((await client.api.setPersona('user-ops')).user.id).toBe('user-ops')
    expect(client.getClientIdentity()).toEqual(changed)
  })

  it('drops a produced response after an authorization policy change', async () => {
    await client.api.setPersona('user-admin')
    let release: () => void = () => undefined
    let ready: () => void = () => undefined
    const responseReady = new Promise<void>((resolve) => { ready = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    client.configureClient({ session: controller.getSession(), fetch: async (...args) => {
      const response = await fetch(...args)
      if (String(args[0]).includes('/dashboard')) { ready(); await held }
      return response
    } })
    const old = client.api.getDashboard('admin')
    const rejected = expect(old).rejects.toMatchObject({ code: 'STALE_RESPONSE' })
    await responseReady
    const session = controller.getSession()
    const grant = controller.getSnapshot().entities.assignments.find((item) => item.userId === 'user-ops')!
    await controller.command('DELETE', `/admin/assignments/${grant.id}`, { expectedVersion: grant.version, reason: 'Revoke for stale-response verification' },
      'revoke-policy', controller.authenticate(session.sessionId, session.user.id))
    release()
    await rejected
    expect(client.getClientIdentity()?.policyVersion).toBe(session.policyVersion + 1)
  })
})

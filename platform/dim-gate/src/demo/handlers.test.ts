import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createController } from './controller'
import type { DemoController } from './controller'
import { createHandlers } from './handlers'
import { apiErrorSchema, apiResultSchema, commandReceiptSchema, sessionViewSchema } from '../domain/schemas'

const baseUrl = 'http://localhost/dim-gate/'
const server = setupServer()
let controller: DemoController
let storageBlocked = false
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  let raw: string | null = null
  let sequence = 0
  storageBlocked = false
  controller = createController({
    storage: { getItem: () => raw, setItem: (_key, value) => { if (storageBlocked) throw new Error('Quota'); raw = value } },
    createSessionId: () => `http-session-${++sequence}`,
  })
  server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
})
interface RequestOptions { method?: string; body?: unknown; key?: string; headers?: Record<string, string> }
function request(path: string, options: RequestOptions = {}) {
  const session = controller.getSession()
  return fetch(new URL(path, baseUrl), {
    method: options.method ?? 'GET',
    headers: { 'X-Demo-Session': session.sessionId, 'X-Demo-Persona': session.user.id,
      ...(options.method ? { 'Content-Type': 'application/json', 'Idempotency-Key': options.key ?? 'command-one' } : {}),
      ...options.headers },
    ...(options.method ? { body: JSON.stringify(options.body) } : {}),
  })
}
async function persona(personaId: string, key: string) {
  const response = await request('__demo/v1/persona', { method: 'POST', body: { personaId }, key })
  expect(response.status).toBe(200)
}

describe('shared browser/Node HTTP handlers', () => {
  it('validates the session response against the shared schema and scopes aggregate data', async () => {
    const response = await request('api/v1/session')
    expect(apiResultSchema(sessionViewSchema).safeParse(await response.json()).success).toBe(true)
    const rd = await (await request('api/v1/dashboard?center=rd')).json()
    expect(rd.data.applicationCount).toBe(3)
    const forbidden = await request('api/v1/dashboard?center=admin')
    expect(forbidden.status).toBe(403)
    await persona('user-admin', 'to-admin')
    const admin = await (await request('api/v1/dashboard?center=admin')).json()
    expect(admin.data.applicationCount).toBeGreaterThan(rd.data.applicationCount)
  })

  it('rejects missing/unknown sessions and persons, unknown/duplicate queries and exact JSON bodies', async () => {
    const invalidHeaders: Record<string, string>[] = [{ 'X-Demo-Session': '' }, { 'X-Demo-Persona': 'unknown-user' }]
    for (const headers of invalidHeaders) {
      const response = await request('api/v1/session', { headers })
      expect(response.status).toBe(401)
      expect(apiErrorSchema.safeParse(await response.json()).success).toBe(true)
    }
    for (const path of ['api/v1/session?surprise=1', 'api/v1/dashboard?center=rd&center=ops', '__demo/v1/personas?surprise=1']) {
      expect((await request(path)).status).toBe(422)
    }
    const invalidCommands: RequestOptions[] = [
      { body: { ticks: 1 }, headers: { 'Idempotency-Key': '' } },
      { body: { ticks: 1 }, headers: { 'Content-Type': 'text/plain' } },
      { body: { ticks: 1, role: 'admin' } },
      { body: { ticks: 0 } },
    ]
    for (const options of invalidCommands) {
      const response = await request('__demo/v1/clock/advance', { method: 'POST', ...options })
      expect([415, 422]).toContain(response.status)
    }
    expect(controller.getSnapshot().commandCount).toBe(0)
    expect((await request('__demo/v1/reset', { method: 'POST', body: { confirm: true, extra: true } })).status).toBe(422)
  })

  it('replays an authorized CI command once, conflicts on changed body and rejects replay after scope revocation', async () => {
    await persona('user-ops', 'to-ops')
    const path = 'api/v1/cis/ci-aws-checkout-01'
    const command = { method: 'PATCH', key: 'same-ci-command', body: { expectedVersion: 1, name: 'Renamed demo compute' } }
    const first = await request(path, command)
    expect(first.status).toBe(200)
    const initial = await first.json()
    expect(apiResultSchema(commandReceiptSchema).safeParse(initial).success).toBe(true)
    const replay = await (await request(path, command)).json()
    expect(replay.data).toEqual(initial.data)
    expect(controller.getSnapshot().commandCount).toBe(1)
    expect((await request(path, { ...command, body: { ...command.body, name: 'Another name' } })).status).toBe(409)
    const old = controller.getSnapshot()
    await persona('user-admin', 'to-admin')
    const poolGrant = controller.getSnapshot().entities.assignments.find((assignment) => assignment.userId === 'user-ops'
      && assignment.scopeType === 'pool' && assignment.scopeId === 'pool-aws-sg')!
    const revoke = await request(`api/v1/admin/assignments/${poolGrant.id}`, {
      method: 'DELETE', key: 'revoke-ops', body: { expectedVersion: poolGrant.version, reason: 'Contract test revoke' },
    })
    expect(revoke.status).toBe(200)
    await persona('user-ops', 'back-to-ops')
    const denied = await request(path, command)
    expect([403, 404]).toContain(denied.status)
    expect(controller.getSnapshot().entities.cis).toEqual(old.entities.cis)
    expect(controller.getSnapshot().commandCount).toBe(2)
  })

  it('leaves every state field unchanged on storage rejection and refuses unavailable business APIs', async () => {
    const before = controller.getSnapshot()
    storageBlocked = true
    const response = await request('__demo/v1/clock/advance', { method: 'POST', body: { ticks: 4 }, key: 'failed-write' })
    expect(response.status).toBe(507)
    expect((await response.json()).error.code).toBe('DEMO_STORAGE_FULL')
    expect(controller.getSnapshot()).toEqual(before)
    expect((await request('api/v1/pipelines', { method: 'POST', body: {} })).status).toBe(501)
  })

  it('recognizes an old-session reset replay after new work without clearing it', async () => {
    const original = controller.getSession()
    const first = await request('__demo/v1/reset', { method: 'POST', body: { confirm: true }, key: 'reset-once' })
    expect(first.status).toBe(200)
    const receipt = await first.json()
    await request('__demo/v1/clock/advance', { method: 'POST', body: { ticks: 3 }, key: 'fresh-work' })
    const replay = await request('__demo/v1/reset', { method: 'POST', body: { confirm: true }, key: 'reset-once',
      headers: { 'X-Demo-Session': original.sessionId, 'X-Demo-Persona': original.user.id } })
    expect(replay.status).toBe(200)
    expect((await replay.json()).data).toEqual(receipt.data)
    expect(controller.getSession().logicalClock).toBe(3)
  })

  it('rejects a delayed old-persona request and never handles another application API', async () => {
    server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 30 }),
      http.get('http://localhost/another-app/api/v1/session', () => HttpResponse.json({ owner: 'another-app' })))
    const old = request('api/v1/dashboard?center=rd')
    const session = controller.getSession()
    await controller.setPersona('user-ops', 'direct-switch', controller.authenticate(session.sessionId, session.user.id))
    expect((await old).status).toBe(409)
    const other = await fetch('http://localhost/another-app/api/v1/session')
    expect(await other.json()).toEqual({ owner: 'another-app' })
  })
})

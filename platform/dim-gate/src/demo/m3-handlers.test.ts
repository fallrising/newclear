import { afterAll, beforeAll, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createController } from './controller'
import { createHandlers } from './handlers'
import { apiResultSchema } from '../domain/schemas'
import { operations } from '../api/contracts'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

it('serves executable M3 contracts, async statuses, scoped logs and rollback through the shared HTTP handler', async () => {
  const controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'm3-http' })
  server.resetHandlers(...createHandlers(controller, { delayMs: 0 }))
  let key = 0
  const call = async (path: string, body?: unknown, demo = false) => {
    const session = controller.getSession()
    const response = await fetch(`http://localhost/dim-gate/${demo ? '__demo' : 'api'}/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: {
        'X-Demo-Session': session.sessionId, 'X-Demo-Persona': session.user.id,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': `http-${++key}` }),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const payload = await response.json()
    if (response.ok && !demo) {
      const op = operations.find(o => o.method === (body === undefined ? 'get' : 'post') &&
        new RegExp(`^${o.path.replace('{id}', '[^/]+')}$`).test(path.split('?')[0]))!
      expect(apiResultSchema(op.data).safeParse(payload).success, op.id).toBe(true)
      expect(response.status).toBe(op.status)
    }
    return { status: response.status, ...payload }
  }
  const create = (revision: string) => call('/pipelines', { applicationId: 'app-checkout', environmentId: 'env-checkout-dev',
    revision, environmentVersion: controller.getSnapshot().entities.environments.find(e => e.id === 'env-checkout-dev')!.version })
  const first = await create('http-stable')
  expect(first.status).toBe(202)
  await call('/clock/advance', { ticks: 6 }, true)
  const run = (await call(`/pipelines/${first.data.entityId}`)).data.run
  const stable = (await call(`/releases/${run.releaseId}`)).data.release
  const second = await create('http-next'); await call('/clock/advance', { ticks: 6 }, true)
  const secondRun = (await call(`/pipelines/${second.data.entityId}`)).data.run
  const current = (await call(`/releases/${secondRun.releaseId}`)).data.release
  await call('/pipelines'); await call('/releases')
  const env = (await call('/environments/env-checkout-dev')).data
  expect(env.activeRelease.id).toBe(current.id)
  const rollback = await call(`/releases/${current.id}/rollback`, { expectedVersion: current.version,
    environmentVersion: env.environment.version, targetReleaseId: stable.id, reason: 'HTTP rollback flow' })
  expect(rollback.status).toBe(202)
  await call('/clock/advance', { ticks: 3 }, true)
  expect((await call('/environments/env-checkout-dev')).data.activeRelease.id).toBe(rollback.data.entityId)
  await call('/persona', { personaId: 'user-rd-data' }, true)
  expect((await call(`/releases/${rollback.data.entityId}`)).status).toBe(404)
  expect((await call('/pipelines')).data.total).toBe(0)
  expect((await call('/releases')).data.total).toBe(0)
  await call('/persona', { personaId: 'user-admin' }, true)
  expect((await call(`/pipelines/${run.id}`)).status).toBe(404)
  expect((await call('/pipelines')).data.total).toBe(0)
  expect((await create('admin-denied')).status).toBe(403)
  expect((await call(`/releases/${stable.id}`)).status).toBe(200)
})

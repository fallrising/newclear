import { describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import type { ApiRequest } from '../core/request'
import { createApplicationClient } from './application'

describe('application feature client', () => {
  it('builds stable scoped list parameters and validates the application page', async () => {
    const payload = { items: [], total: 0, page: 1, pageSize: 25 }
    const request = vi.fn(async <T>(_path: string, schema: z.ZodType<T>) => schema.parse(payload)) as ApiRequest
    const client = createApplicationClient(request)

    await expect(client.listApplications({ projectId: 'project-store', q: 'checkout api', page: 1, pageSize: 25, sort: 'name', order: 'asc' })).resolves.toEqual(payload)
    expect(request).toHaveBeenCalledWith('/applications?projectId=project-store&q=checkout+api&page=1&pageSize=25&sort=name&order=asc', expect.anything())
  })

  it('encodes canonical application and environment identifiers in detail paths', async () => {
    const responses = [
      { application: { id: 'app/a', orgId: 'org-demo', projectId: 'project-store', ownerTeamId: 'team-commerce', name: 'checkout-api', slug: 'checkout-api', tier: 'critical', description: 'Checkout', version: 1, createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T09:00:00Z' }, environments: [] },
      { environment: { id: 'env/a', orgId: 'org-demo', applicationId: 'app/a', name: 'dev', stage: 'dev', status: 'ready', activeReleaseId: null, version: 1, createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T09:00:00Z' }, placements: [], activeRelease: null },
    ]
    let index = 0
    const requestSpy = vi.fn(async <T>(_path: string, schema: z.ZodType<T>) => schema.parse(responses[index++]))
    const request = requestSpy as ApiRequest
    const client = createApplicationClient(request)

    await client.getApplication('app/a')
    await client.getEnvironment('env/a')

    expect(requestSpy.mock.calls.map((call) => call[0])).toEqual(['/applications/app%2Fa', '/environments/env%2Fa'])
  })
})

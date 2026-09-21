import { describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import type { ApiRequest } from '../core/request'
import { createSelfServiceClient } from './self-service'

const timestamp = '2026-09-20T09:00:00Z'
const receipt = { entityType: 'request', entityId: 'req/a', entityVersion: 2, correlationId: 'corr-1', changed: [] }

describe('self-service feature client', () => {
  it('serializes scoped list filters and validates pages', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 }
    const request = vi.fn(async <T>(_path: string, schema: z.ZodType<T>) => schema.parse(page)) as ApiRequest
    const client = createSelfServiceClient(request)

    await client.listRequests({ state: 'submitted', applicationId: 'app/store', page: 1, pageSize: 25, sort: 'updatedAt', order: 'desc' })

    expect(request).toHaveBeenCalledWith('/requests?state=submitted&applicationId=app%2Fstore&page=1&pageSize=25&sort=updatedAt&order=desc', expect.anything())
  })

  it('encodes detail identifiers and keeps exact command versions and reasons', async () => {
    const requestSpy = vi.fn(async <T>(_path: string, schema: z.ZodType<T>, options?: unknown) => {
      void options
      return schema.parse(receipt)
    })
    const client = createSelfServiceClient(requestSpy as ApiRequest)

    await client.approveRequest('req/a', 2, 'capacity verified')
    await client.provisionRequest('req/a', 3)
    await client.retryRequest('req/a', 7, 'retry after diagnosis')

    expect(requestSpy.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ['/requests/req%2Fa/approve', { method: 'POST', body: { expectedVersion: 2, reason: 'capacity verified' } }],
      ['/requests/req%2Fa/provision', { method: 'POST', body: { expectedVersion: 3 } }],
      ['/requests/req%2Fa/retry', { method: 'POST', body: { expectedVersion: 7, reason: 'retry after diagnosis' } }],
    ])
  })

  it('validates canonical request/job detail projections', async () => {
    const requestEntity = {
      id: 'req-0001', orgId: 'org-demo', requesterId: 'user-rd-commerce', applicationId: 'app-checkout', environmentName: 'e2e', stage: 'staging',
      catalogItemId: 'catalog-web', catalogRevision: 1, templateSnapshot: { allowedProviders: ['aws'], allowedStages: ['staging'], allowedPoolIds: ['pool-aws-sg'], defaults: { cpu: 2, memoryMiB: 2048 }, limits: { maxCpu: 8, maxMemoryMiB: 16384 }, requiresApproval: true, resourceKind: 'compute', bootstrapProfile: 'web-service' },
      provider: 'aws', poolId: 'pool-aws-sg', cpu: 2, memoryMiB: 2048, purpose: 'test', state: 'submitted', correlationId: 'corr-1',
      version: 2, createdAt: timestamp, updatedAt: timestamp,
    }
    const payload = { request: requestEntity, jobs: [] }
    const request = vi.fn(async <T>(_path: string, schema: z.ZodType<T>) => schema.parse(payload)) as ApiRequest

    await expect(createSelfServiceClient(request).getRequest('req-0001')).resolves.toEqual(payload)
  })
})

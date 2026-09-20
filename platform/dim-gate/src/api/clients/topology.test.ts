import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { ApiRequest, RequestOptions } from '../core/request'
import type { CIView, CommandReceipt, Relation } from '../../domain/schemas'
import { createTopologyClient } from './topology'

const timestamp = '2026-09-20T09:00:00Z'

function ci(id: string, name: string): CIView {
  return {
    id, name, orgId: 'org-demo', version: 1, createdAt: timestamp, updatedAt: timestamp,
    kind: 'cache', provider: 'onprem', externalId: id, locationId: 'location-idc-sg', poolId: 'pool-idc-sg',
    ownerTeamId: 'team-platform', visibilityProjectIds: ['project-store'], lifecycle: 'active', health: 'healthy',
    tags: {}, attributes: { engine: 'redis', versionLabel: '7', endpointLabel: `${id}.example.invalid` },
    customFields: {}, source: 'discovered', observedAt: timestamp,
  }
}

function relation(id: string, sourceCiId: string, targetCiId: string): Relation {
  return {
    id, sourceCiId, targetCiId, orgId: 'org-demo', version: 1, createdAt: timestamp, updatedAt: timestamp,
    type: 'depends_on', source: 'manual', confidence: 'verified',
  }
}

function receipt(entityId: string): CommandReceipt {
  return { entityType: 'relation', entityId, entityVersion: 1, correlationId: 'corr-test', changed: [{ entityType: 'relation', entityId }] }
}

describe('topology client', () => {
  it('requests a bounded CI-root graph and validates a finite cycle fixture', async () => {
    const calls: Array<{ path: string; options?: RequestOptions }> = []
    const cycle = {
      nodes: [ci('ci-cycle-a', 'Cycle A'), ci('ci-cycle-b', 'Cycle B')],
      edges: [relation('relation-cycle-a-b', 'ci-cycle-a', 'ci-cycle-b'), relation('relation-cycle-b-a', 'ci-cycle-b', 'ci-cycle-a')],
      truncated: true, depthReached: 3,
    }
    const request: ApiRequest = async <T>(path: string, schema: z.ZodType<T>, options?: RequestOptions) => {
      calls.push({ path, options }); return schema.parse(cycle)
    }
    const client = createTopologyClient(request)

    await expect(client.getTopology({ ciId: 'ci-cycle-a', mode: 'dependencies', depth: 3 })).resolves.toEqual(cycle)
    expect(calls).toEqual([{ path: '/topology?mode=dependencies&depth=3&ciId=ci-cycle-a', options: undefined }])
  })

  it('supports environment roots, scoped search and relation reads', async () => {
    const calls: string[] = []
    const request: ApiRequest = async <T>(path: string, schema: z.ZodType<T>) => {
      calls.push(path)
      const payload = path.startsWith('/topology') ? { nodes: [], edges: [], truncated: false, depthReached: 0 }
        : path.startsWith('/search') ? { items: [{ type: 'ci', id: 'ci-idc-redis-01', title: 'shared redis', route: '/ops/cmdb/ci-idc-redis-01' }] }
          : { items: [relation('relation-1', 'ci-a', 'ci-b')], total: 1, page: 1, pageSize: 100 }
      return schema.parse(payload)
    }
    const client = createTopologyClient(request)

    await client.getTopology({ environmentId: 'env-checkout-prod', mode: 'impact', depth: 2 })
    await client.search('shared redis', 7)
    await client.listRelations('ci-idc-redis-01', 'in')

    expect(calls).toEqual([
      '/topology?mode=impact&depth=2&environmentId=env-checkout-prod',
      '/search?q=shared+redis&limit=7',
      '/relations?ciId=ci-idc-redis-01&direction=in&page=1&pageSize=100&sort=id&order=asc',
    ])
  })

  it('preserves version guards and reasons for relation commands', async () => {
    const calls: Array<{ path: string; options?: RequestOptions }> = []
    const request: ApiRequest = async <T>(path: string, schema: z.ZodType<T>, options?: RequestOptions) => {
      calls.push({ path, options }); return schema.parse(receipt(path.includes('relation-existing') ? 'relation-existing' : 'relation-new'))
    }
    const client = createTopologyClient(request)
    const input = { sourceCiId: 'ci-a', targetCiId: 'ci-b', sourceExpectedVersion: 2, targetExpectedVersion: 4, type: 'depends_on' as const, reason: 'verified dependency' }

    await client.createRelation(input)
    await client.deleteRelation('relation-existing', { expectedVersion: 3, reason: 'incorrect mapping' })

    expect(calls).toEqual([
      { path: '/relations', options: { method: 'POST', body: input } },
      { path: '/relations/relation-existing', options: { method: 'DELETE', body: { expectedVersion: 3, reason: 'incorrect mapping' } } },
    ])
  })
})

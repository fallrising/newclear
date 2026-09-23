import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { createEngine, type Engine } from './engine'
import type { CI, CommandInput, Page, Relation } from './schemas'

const seed = () => createSeed('m1-session')
const makeEngine = (snapshot = seed()) => createEngine(snapshot, () => undefined)
const read = <T>(subject: Engine, path: string, actorId = 'user-ops', query = '') =>
  subject.read(path, new URLSearchParams(query), actorId) as T
const command = (overrides: Partial<CommandInput>): CommandInput => ({
  sessionId: 'm1-session', actorId: 'user-ops', method: 'POST', path: '/cis',
  key: 'm1-command', body: {}, ...overrides,
})
const awsCreate = {
  name: 'manual-aws', kind: 'compute' as const, provider: 'aws' as const, externalId: 'i-manual-001',
  accountId: 'account-aws-demo', locationId: 'location-aws-sg', poolId: 'pool-aws-sg',
  ownerTeamId: 'team-commerce', visibilityProjectIds: ['project-store'], lifecycle: 'active' as const,
  tags: { mode: 'demo' }, attributes: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', subnetId: 'subnet-demo', cpu: 1, memoryMiB: 1024 },
  customFields: {},
}

describe('M1 inventory and scoped projections (AC-04, AC-06, AC-08, AC-20)', () => {
  it('preserves the original 20 CIs per provider and adds three canonical W2 parents', () => {
    const snapshot = seed()
    expect(snapshot.entities.cis).toHaveLength(63)
    for (const provider of ['aws', 'aliyun', 'onprem']) {
      expect(snapshot.entities.cis.filter((ci) => ci.provider === provider && !ci.id.startsWith('w2-'))).toHaveLength(20)
    }
    expect(snapshot.entities.applications).toHaveLength(6)
    expect(snapshot.entities.environments).toHaveLength(12)
    const shared = snapshot.entities.placements.filter((entry) => entry.ciId === 'ci-idc-redis-01')
    expect(shared.map((entry) => entry.environmentId).sort()).toEqual(['env-checkout-dev', 'env-data-dev', 'env-storefront-dev'])
    expect(new Set(shared.map((entry) => entry.ciId))).toEqual(new Set(['ci-idc-redis-01']))
  })

  it('filters providers and preserves legal provider-specific detail fields', () => {
    const subject = makeEngine()
    for (const provider of ['aws', 'aliyun', 'onprem']) {
      const page = read<Page<CI>>(subject, '/cis', 'user-ops', 'provider=' + provider + '&pageSize=100')
      expect(page.total).toBe({ aws: 22, aliyun: 20, onprem: 21 }[provider])
    }
    expect(read<CI>(subject, '/cis/ci-aws-checkout-01').attributes).toMatchObject({ subnetId: 'subnet-demo' })
    expect(read<CI>(subject, '/cis/ci-aliyun-worker-01').attributes).toMatchObject({ vSwitchId: 'vsw-demo' })
    expect(read<CI>(subject, '/cis/ci-onprem-02').attributes).toMatchObject({ assetTag: 'asset-02', hypervisor: 'kvm' })
  })

  it('keeps stale, observation-unknown, health-unknown, empty and numeric zero distinct', () => {
    const subject = makeEngine()
    const unknown = read<Page<CI>>(subject, '/cis', 'user-ops', 'freshness=unknown&pageSize=100')
    const stale = read<Page<CI>>(subject, '/cis', 'user-ops', 'freshness=stale&pageSize=100')
    expect(unknown.items.every((ci) => ci.observedAt === null)).toBe(true)
    expect(unknown.items.some((ci) => ci.health === 'unknown')).toBe(true)
    expect(stale.items.every((ci) => ci.observedAt !== null)).toBe(true)
    expect(read<Page<CI>>(subject, '/cis', 'user-ops', 'q=does-not-exist')).toMatchObject({ items: [], total: 0 })
    expect(read<CI>(subject, '/cis/ci-aws-02').attributes).toMatchObject({ cpu: 0, memoryMiB: 0 })
  })

  it('counts capacity from distinct CIs rather than placements', () => {
    const snapshot = seed()
    const before = read<unknown[]>(makeEngine(snapshot), '/capacity')
    snapshot.entities.placements.push({
      ...snapshot.entities.placements[0], id: 'placement-extra-shared', applicationId: 'app-storefront',
      environmentId: 'env-storefront-prod', ciId: 'ci-idc-redis-01', role: 'dependency',
    })
    expect(read<unknown[]>(makeEngine(snapshot), '/capacity')).toEqual(before)
  })

  it('conceals Data-only list, detail, search, graph, aggregate and audit from RD Commerce', async () => {
    const subject = makeEngine()
    expect(read<Page<CI>>(subject, '/cis', 'user-rd-commerce', 'projectId=project-data')).toMatchObject({ items: [], total: 0 })
    expect(read<Page<{ id: string }>>(subject, '/applications', 'user-rd-commerce', 'projectId=project-data')).toMatchObject({ items: [], total: 0 })
    expect(read<{ items: unknown[] }>(subject, '/search', 'user-rd-commerce', 'q=data')).toEqual({ items: [] })
    expect(read<unknown[]>(subject, '/capacity', 'user-rd-commerce', 'projectId=project-data')).toEqual([])
    for (const path of ['/applications/app-data', '/cis/ci-aliyun-worker-01']) {
      expect(() => read(subject, path, 'user-rd-commerce')).toThrowError(expect.objectContaining({ status: 404 }))
    }
    expect(() => read(subject, '/topology', 'user-rd-commerce', 'ciId=ci-aliyun-worker-01&mode=dependencies&depth=3')).toThrowError(expect.objectContaining({ status: 404 }))
    await subject.command(command({ method: 'PATCH', path: '/cis/ci-aliyun-worker-01', key: 'update-data',
      body: { expectedVersion: 1, name: 'data-only-updated' } }))
    expect(read<Page<unknown>>(subject, '/audit', 'user-rd-commerce')).toMatchObject({ items: [], total: 0 })
  })

  it('does not disclose a deleted cross-scope relation through audit history', async () => {
    const subject = makeEngine()
    const created = await subject.command(command({ path: '/relations', key: 'cross-scope-create', body: {
      sourceCiId: 'ci-idc-redis-01', targetCiId: 'ci-aliyun-worker-01',
      sourceExpectedVersion: 1, targetExpectedVersion: 1, type: 'depends_on', reason: 'scope regression',
    } }))
    expect(read<Page<unknown>>(subject, '/audit', 'user-rd-commerce')).toMatchObject({ items: [], total: 0 })
    await subject.command(command({ method: 'DELETE', path: '/relations/' + created.entityId,
      key: 'cross-scope-delete', body: { expectedVersion: 1, reason: 'scope regression cleanup' } }))
    expect(read<Page<unknown>>(subject, '/audit', 'user-rd-commerce')).toMatchObject({ items: [], total: 0 })
    expect(read<Page<unknown>>(subject, '/audit', 'user-ops')).toMatchObject({ total: 2 })
  })
})

describe('M1 CI and relation commands (AC-04, AC-05, AC-06)', () => {
  it('onboards one CI atomically and increases only its provider total', async () => {
    const subject = makeEngine()
    const receipt = await subject.command(command({ body: awsCreate }))
    expect(receipt).toMatchObject({ entityType: 'ci', entityVersion: 1 })
    expect(read<Page<CI>>(subject, '/cis', 'user-ops', 'pageSize=100').total).toBe(64)
    expect(read<Page<CI>>(subject, '/cis', 'user-ops', 'provider=aws&pageSize=100').total).toBe(23)
    expect(read<CI>(subject, '/cis/' + receipt.entityId)).toMatchObject({ source: 'manual', health: 'unknown', observedAt: null })
    expect(subject.getSnapshot()).toMatchObject({ commandCount: 1, storeRevision: 1 })
    expect(subject.getSnapshot().audit).toHaveLength(1)
  })

  it('returns 409 for canonical duplicates and 422 for missing/incompatible provider identity', async () => {
    await expect(makeEngine().command(command({ body: { ...awsCreate, name: 'renamed', externalId: 'i-demo-checkout-01' } })))
      .rejects.toMatchObject({ status: 409, code: 'DUPLICATE_RESOURCE' })
    const { accountId: _account, ...missingAccount } = awsCreate
    void _account
    await expect(makeEngine().command(command({ body: missingAccount }))).rejects.toMatchObject({ status: 422 })
    await expect(makeEngine().command(command({ body: { ...awsCreate, provider: 'aliyun' } }))).rejects.toMatchObject({ status: 422 })
  })

  it('allows metadata edits without changing identity and rejects identity fields', async () => {
    const subject = makeEngine()
    const before = read<CI>(subject, '/cis/ci-aws-checkout-01')
    const identity = { provider: before.provider, accountId: before.accountId, locationId: before.locationId,
      poolId: before.poolId, kind: before.kind, externalId: before.externalId }
    await subject.command(command({ method: 'PATCH', path: '/cis/' + before.id, key: 'metadata',
      body: { expectedVersion: 1, name: 'renamed-ci', tags: { edited: 'true' } } }))
    expect(read<CI>(subject, '/cis/' + before.id)).toMatchObject(identity)
    await expect(subject.command(command({ method: 'PATCH', path: '/cis/' + before.id, key: 'identity',
      body: { expectedVersion: 2, accountId: 'other' } }))).rejects.toMatchObject({ status: 422 })
  })

  it('creates/deletes relations with version guards, replay, changed refs and audit', async () => {
    const subject = makeEngine()
    const body = { sourceCiId: 'ci-aws-05', targetCiId: 'ci-aws-07', sourceExpectedVersion: 1,
      targetExpectedVersion: 1, type: 'depends_on', reason: 'M1 relation test' }
    const input = command({ path: '/relations', key: 'relation-create', body })
    const receipt = await subject.command(input)
    expect(await subject.command(input)).toEqual(receipt)
    expect(receipt.changed.map((entry) => entry.entityId)).toEqual([receipt.entityId, 'ci-aws-05', 'ci-aws-07'])
    await expect(makeEngine().command(command({ path: '/relations', key: 'stale',
      body: { ...body, sourceExpectedVersion: 2 } }))).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    const deletion = command({ method: 'DELETE', path: '/relations/' + receipt.entityId, key: 'relation-delete',
      body: { expectedVersion: 1, reason: 'remove test edge' } })
    const deleted = await subject.command(deletion)
    expect(await subject.command(deletion)).toEqual(deleted)
    expect(subject.getSnapshot().audit.map((entry) => entry.action)).toEqual(['relation.create', 'relation.delete'])
  })
})

describe('M1 bounded scope-safe topology (AC-07)', () => {
  it('terminates cycles and traverses reverse edges for impact', () => {
    const subject = makeEngine()
    const dependencies = read<{ nodes: CI[]; depthReached: number }>(subject, '/topology', 'user-ops',
      'ciId=ci-aws-checkout-01&mode=dependencies&depth=3')
    expect(new Set(dependencies.nodes.map((entry) => entry.id))).toEqual(new Set(['ci-aws-checkout-01', 'ci-aws-02', 'ci-aws-03', 'ci-idc-redis-01']))
    expect(dependencies.depthReached).toBeLessThanOrEqual(3)
    const impact = read<{ nodes: CI[] }>(subject, '/topology', 'user-ops', 'ciId=ci-idc-redis-01&mode=impact&depth=3')
    expect(impact.nodes.map((entry) => entry.id)).toEqual(expect.arrayContaining(['ci-aws-checkout-01', 'ci-aliyun-worker-01']))
  })

  it('removes hidden nodes and incident edges before counts/truncation', () => {
    const result = read<{ nodes: CI[]; edges: Relation[]; truncated: boolean }>(makeEngine(), '/topology',
      'user-rd-commerce', 'ciId=ci-idc-redis-01&mode=impact&depth=3')
    expect(result.nodes.map((entry) => entry.id)).toContain('ci-aws-checkout-01')
    expect(result.nodes.map((entry) => entry.id)).not.toContain('ci-aliyun-worker-01')
    expect(result.edges.map((entry) => entry.id)).not.toContain('relation-data-redis')
    expect(result.truncated).toBe(false)
  })

  it('caps visible nodes at 100 and marks truncation', () => {
    const snapshot = seed()
    const root = snapshot.entities.cis.find((entry) => entry.id === 'ci-aws-checkout-01')!
    for (let index = 0; index < 105; index += 1) {
      const id = 'ci-cap-' + String(index).padStart(3, '0')
      snapshot.entities.cis.push({ ...structuredClone(root), id, name: id, externalId: id, lifecycle: 'retired' })
      snapshot.entities.relations.push({
        id: 'relation-cap-' + String(index).padStart(3, '0'), orgId: 'org-demo', version: 1,
        createdAt: root.createdAt, updatedAt: root.updatedAt, sourceCiId: root.id, targetCiId: id,
        type: 'depends_on', source: 'manual', confidence: 'verified',
      })
    }
    const result = read<{ nodes: CI[]; edges: Relation[]; truncated: boolean }>(makeEngine(snapshot), '/topology',
      'user-ops', 'ciId=ci-aws-checkout-01&mode=dependencies&depth=3')
    expect(result.nodes).toHaveLength(100)
    expect(result.edges.length).toBeLessThanOrEqual(200)
    expect(result.truncated).toBe(true)
  })

  it('caps dense visible edges at 200', () => {
    const snapshot = seed()
    const ids = snapshot.entities.cis.filter((ci) => ci.visibilityProjectIds.includes('project-store')).slice(0, 18).map((ci) => ci.id)
    snapshot.entities.relations = []
    let sequence = 0
    for (const sourceCiId of ids) for (const targetCiId of ids) if (sourceCiId !== targetCiId) {
      sequence += 1
      snapshot.entities.relations.push({
        id: 'relation-dense-' + sequence, orgId: 'org-demo', version: 1,
        createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T09:00:00Z',
        sourceCiId, targetCiId, type: 'depends_on', source: 'manual', confidence: 'verified',
      })
    }
    const result = read<{ edges: unknown[]; truncated: boolean }>(makeEngine(snapshot), '/topology',
      'user-ops', 'ciId=' + ids[0] + '&mode=dependencies&depth=3')
    expect(result.edges).toHaveLength(200)
    expect(result.truncated).toBe(true)
  })
})

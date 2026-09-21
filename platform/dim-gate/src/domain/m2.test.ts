import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { createEngine, type Engine } from './engine'
import type { Request, Snapshot } from './schemas'

const sessionId = 'session-m2-test'
const create = (snapshot = createSeed(sessionId)) => createEngine(snapshot, () => undefined)
const command = (engine: Engine, actorId: string, path: string, body: unknown, key: string, method = 'POST') =>
  engine.command({ sessionId, actorId, method, path, body, key })
const detail = (engine: Engine, id: string, actor = 'user-rd-commerce') =>
  engine.read(`/requests/${id}`, new URLSearchParams(), actor) as { request: Request; jobs: Snapshot['jobs'] }
const requestBody = (overrides: Partial<{
  environmentName: string; provider: 'aws' | 'aliyun' | 'onprem'; poolId: string; cpu: number; memoryMiB: number;
  catalogRevision: number;
}> = {}) => ({
  applicationId: 'app-checkout', environmentName: 'staging', stage: 'staging' as const,
  catalogItemId: 'catalog-web', catalogRevision: 1, provider: 'aws' as const, poolId: 'pool-aws-sg',
  cpu: 2, memoryMiB: 2048, purpose: 'M2 acceptance environment',
  ...overrides,
})

async function submitted(engine: Engine, suffix: string, overrides = {}) {
  const created = await command(engine, 'user-rd-commerce', '/requests', requestBody({ environmentName: suffix, ...overrides }), `create-${suffix}`)
  await command(engine, 'user-rd-commerce', `/requests/${created.entityId}/submit`, { expectedVersion: 1 }, `submit-${suffix}`)
  return created.entityId
}

describe('M2 request delivery state machine', () => {
  it.each([
    ['aws', 'pool-aws-sg'],
    ['aliyun', 'pool-aliyun-sg'],
    ['onprem', 'pool-idc-sg'],
  ] as const)('delivers one %s environment with reservation converted to used capacity', async (provider, poolId) => {
    const engine = create()
    const before = (engine.read('/capacity', new URLSearchParams(`provider=${provider}`), 'user-ops') as Array<{ poolId: string; cpu: { used: number; reserved: number } }>)
      .find((entry) => entry.poolId === poolId)!
    const id = await submitted(engine, `staging-${provider}`, { provider, poolId })
    const approved = await command(engine, 'user-ops', `/requests/${id}/approve`, { expectedVersion: 2, reason: 'Capacity and scope verified' }, `approve-${provider}`)
    const reserved = (engine.read('/capacity', new URLSearchParams(`provider=${provider}`), 'user-ops') as Array<{ poolId: string; cpu: { used: number; reserved: number } }>)
      .find((entry) => entry.poolId === poolId)!
    expect(reserved.cpu).toEqual({ used: before.cpu.used, reserved: before.cpu.reserved + 2, available: expect.any(Number) })
    expect(approved.operationId).toMatch(/^job-/)
    await command(engine, 'user-ops', `/requests/${id}/provision`, { expectedVersion: 3 }, `provision-${provider}`)
    await command(engine, 'user-ops', '/clock/advance', { ticks: 5 }, `ticks-${provider}`)
    const result = detail(engine, id)
    expect(result.request).toMatchObject({ state: 'fulfilled', environmentId: expect.stringMatching(/^env-/) })
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0]).toMatchObject({ state: 'succeeded', attempt: 1, plannedCiIds: [expect.stringMatching(/^ci-provisioned-/)] })
    const snapshot = engine.getSnapshot()
    expect(snapshot.entities.environments.find((entry) => entry.id === result.request.environmentId)).toMatchObject({ status: 'ready' })
    expect(snapshot.entities.cis.filter((entry) => result.jobs[0].plannedCiIds.includes(entry.id))).toHaveLength(1)
    expect(snapshot.entities.placements.filter((entry) => entry.environmentId === result.request.environmentId)).toHaveLength(1)
    const after = (engine.read('/capacity', new URLSearchParams(`provider=${provider}`), 'user-ops') as Array<{ poolId: string; cpu: { used: number; reserved: number } }>)
      .find((entry) => entry.poolId === poolId)!
    expect(after.cpu).toMatchObject({ used: before.cpu.used + 2, reserved: before.cpu.reserved })
  })

  it('terminates configure failure, releases reservation and retries with the same environment and CI identity', async () => {
    const engine = create()
    const id = await submitted(engine, 'failure-staging')
    const approved = await command(engine, 'user-ops', `/requests/${id}/approve`, { expectedVersion: 2, reason: 'Approve failure exercise' }, 'failure-approve')
    await command(engine, 'user-ops', '/scenarios', { scenarioKey: 'provision-failure', jobId: approved.operationId }, 'failure-scenario')
    await command(engine, 'user-ops', `/requests/${id}/provision`, { expectedVersion: 3 }, 'failure-provision')
    const failedTick = await command(engine, 'user-ops', '/clock/advance', { ticks: 3 }, 'failure-ticks')
    const failed = detail(engine, id)
    expect(failed.request.state).toBe('failed')
    expect(failed.jobs[0]).toMatchObject({ state: 'failed', failureCode: 'SIMULATED_CONFIGURE_FAILURE', attempt: 1 })
    expect((engine.read('/audit', new URLSearchParams(`correlationId=${failedTick.correlationId}`), 'user-rd-data') as { total: number }).total).toBe(0)
    expect((engine.read('/audit', new URLSearchParams(`correlationId=${failedTick.correlationId}`), 'user-rd-commerce') as { total: number }).total).toBe(1)
    const originalEnvironmentId = failed.request.environmentId
    const originalCiIds = failed.jobs[0].plannedCiIds
    await expect(command(engine, 'user-ops', '/cis', {
      name: 'attempted failed-job identity takeover', kind: 'compute', provider: 'aws', externalId: originalCiIds[0],
      accountId: 'account-aws-demo', locationId: 'location-aws-sg', poolId: 'pool-aws-sg', ownerTeamId: 'team-commerce',
      visibilityProjectIds: ['project-store'], lifecycle: 'active', tags: { mode: 'demo' }, attributes: {
        instanceType: 'demo.compute.small', vpcId: 'vpc-demo', subnetId: 'subnet-demo', cpu: 1, memoryMiB: 1024,
      }, customFields: {},
    }, 'failed-identity-takeover')).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_RESOURCE' })
    const retried = await command(engine, 'user-rd-commerce', `/requests/${id}/retry`, { expectedVersion: failed.request.version, reason: 'Retry same identities' }, 'failure-retry')
    expect(retried.operationId).not.toBe(failed.jobs[0].id)
    const queued = detail(engine, id)
    expect(queued.jobs[1]).toMatchObject({ attempt: 2, plannedCiIds: originalCiIds })
    await command(engine, 'user-ops', `/requests/${id}/provision`, { expectedVersion: queued.request.version }, 'retry-provision')
    await command(engine, 'user-ops', '/clock/advance', { ticks: 5 }, 'retry-ticks')
    const fulfilled = detail(engine, id)
    expect(fulfilled.request).toMatchObject({ state: 'fulfilled', environmentId: originalEnvironmentId })
    expect(fulfilled.jobs[1]).toMatchObject({ state: 'succeeded', attempt: 2, plannedCiIds: originalCiIds })
    expect(engine.getSnapshot().entities.cis.filter((entry) => originalCiIds.includes(entry.id))).toHaveLength(1)
  })

  it('serializes competing approvals so capacity never becomes negative', async () => {
    const snapshot = createSeed(sessionId)
    const pool = snapshot.entities.pools.find((entry) => entry.id === 'pool-aws-sg')!
    const usedCpu = snapshot.entities.cis.filter((entry) => entry.poolId === pool.id && entry.kind === 'compute')
      .reduce((sum, entry) => sum + Number(entry.attributes.cpu), 0)
    const usedMemory = snapshot.entities.cis.filter((entry) => entry.poolId === pool.id && entry.kind === 'compute')
      .reduce((sum, entry) => sum + Number(entry.attributes.memoryMiB), 0)
    pool.cpuCapacity = usedCpu + 8
    pool.memoryCapacityMiB = usedMemory + 8192
    const engine = create(snapshot)
    const first = await submitted(engine, 'race-one', { cpu: 8, memoryMiB: 8192 })
    const second = await submitted(engine, 'race-two', { cpu: 8, memoryMiB: 8192 })
    const outcomes = await Promise.allSettled([
      command(engine, 'user-ops', `/requests/${first}/approve`, { expectedVersion: 2, reason: 'First atomic approval' }, 'race-approve-1'),
      command(engine, 'user-ops', `/requests/${second}/approve`, { expectedVersion: 2, reason: 'Second atomic approval' }, 'race-approve-2'),
    ])
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((entry) => entry.status === 'rejected')).toHaveLength(1)
    expect((outcomes.find((entry) => entry.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ status: 409, code: 'CAPACITY_EXCEEDED' })
    const capacity = (engine.read('/capacity', new URLSearchParams('provider=aws'), 'user-ops') as Array<{ cpu: { available: number } }>)[0]
    expect(capacity.cpu.available).toBe(0)
    await expect(command(engine, 'user-ops', '/cis', {
      name: 'would-overbook-reservation', kind: 'compute', provider: 'aws', externalId: 'i-overbook-reservation',
      accountId: 'account-aws-demo', locationId: 'location-aws-sg', poolId: 'pool-aws-sg',
      ownerTeamId: 'team-commerce', visibilityProjectIds: ['project-store'], lifecycle: 'active',
      tags: { mode: 'demo' }, attributes: {
        instanceType: 'demo.compute.small', vpcId: 'vpc-demo', subnetId: 'subnet-demo', cpu: 1, memoryMiB: 1024,
      }, customFields: {},
    }, 'manual-overbook')).rejects.toMatchObject({ status: 409, code: 'CAPACITY_EXCEEDED' })
  })

  it('keeps Commerce request list/detail hidden from Data and releases reservation on approved cancellation', async () => {
    const engine = create()
    const id = await submitted(engine, 'cancelled-staging')
    await command(engine, 'user-ops', `/requests/${id}/approve`, { expectedVersion: 2, reason: 'Approve before requester cancellation' }, 'cancel-approve')
    expect((engine.read('/requests', new URLSearchParams(), 'user-rd-data') as { total: number }).total).toBe(0)
    expect(() => engine.read(`/requests/${id}`, new URLSearchParams(), 'user-rd-data')).toThrow(expect.objectContaining({ status: 404 }))
    await command(engine, 'user-rd-commerce', `/requests/${id}/cancel`, { expectedVersion: 3, reason: 'Requester changed plans' }, 'cancel-approved')
    expect(detail(engine, id).request.state).toBe('cancelled')
    const capacity = (engine.read('/capacity', new URLSearchParams('provider=aws'), 'user-ops') as Array<{ cpu: { reserved: number } }>)[0]
    expect(capacity.cpu.reserved).toBe(0)
  })

  it('limits job reads to scoped RD/Ops even when an Admin can read the request', async () => {
    const engine = create()
    const id = await submitted(engine, 'job-log-scope')
    const approved = await command(engine, 'user-ops', `/requests/${id}/approve`, { expectedVersion: 2, reason: 'Create scoped job' }, 'job-scope-approve')
    expect(detail(engine, id, 'user-admin').jobs).toHaveLength(1)
    expect(engine.read('/jobs', new URLSearchParams(), 'user-admin')).toMatchObject({ total: 0, items: [] })
    expect(() => engine.read(`/jobs/${approved.operationId}`, new URLSearchParams(), 'user-admin'))
      .toThrow(expect.objectContaining({ status: 404, code: 'NOT_FOUND' }))
    expect(engine.read(`/jobs/${approved.operationId}`, new URLSearchParams(), 'user-rd-commerce')).toMatchObject({
      job: { id: approved.operationId }, logs: [],
    })
  })

  it('reserves the planned canonical CI identity before provisioning completes', async () => {
    const engine = create()
    const id = await submitted(engine, 'reserved-identity')
    const approved = await command(engine, 'user-ops', `/requests/${id}/approve`, { expectedVersion: 2, reason: 'Reserve planned identity' }, 'identity-approve')
    const plannedId = detail(engine, id).jobs[0].plannedCiIds[0]
    await expect(command(engine, 'user-ops', '/cis', {
      name: 'attempted planned identity takeover', kind: 'compute', provider: 'aws', externalId: plannedId,
      accountId: 'account-aws-demo', locationId: 'location-aws-sg', poolId: 'pool-aws-sg',
      ownerTeamId: 'team-commerce', visibilityProjectIds: ['project-store'], lifecycle: 'active', tags: { mode: 'demo' },
      attributes: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', subnetId: 'subnet-demo', cpu: 1, memoryMiB: 1024 }, customFields: {},
    }, 'identity-takeover')).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_RESOURCE' })
    await command(engine, 'user-ops', `/requests/${id}/provision`, { expectedVersion: approved.entityVersion }, 'identity-provision')
    await command(engine, 'user-ops', '/clock/advance', { ticks: 5 }, 'identity-ticks')
    expect(detail(engine, id).request.state).toBe('fulfilled')
    expect(engine.getSnapshot().entities.cis.filter((entry) => entry.externalId === plannedId)).toHaveLength(1)
  })
})

describe('M2 governance', () => {
  it('increments policyVersion and rejects self grants plus disabling recovery navigation', async () => {
    const engine = create()
    const before = engine.getSnapshot().policyVersion
    const grant = await command(engine, 'user-admin', '/admin/assignments', {
      userId: 'user-ops', role: 'rd', scopeType: 'project', scopeId: 'project-store',
      stages: ['dev'], reason: 'Temporary read-only demo grant',
    }, 'admin-grant')
    expect(engine.getSnapshot().policyVersion).toBe(before + 1)
    expect((engine.read('/audit', new URLSearchParams(`correlationId=${grant.correlationId}`), 'user-rd-commerce') as { total: number }).total).toBe(0)
    const clock = await command(engine, 'user-ops', '/clock/advance', { ticks: 1 }, 'plain-clock')
    expect((engine.read('/audit', new URLSearchParams(`correlationId=${clock.correlationId}`), 'user-rd-commerce') as { total: number }).total).toBe(0)
    await expect(command(engine, 'user-admin', '/admin/assignments', {
      userId: 'user-admin', role: 'admin', scopeType: 'org', scopeId: 'org-demo', reason: 'Must be rejected',
    }, 'self-grant')).rejects.toMatchObject({ status: 403, code: 'SELF_MODIFICATION_DENIED' })
    const recovery = engine.getSnapshot().entities.navigation.find((entry) => entry.routeKey === 'admin.navigation')!
    await expect(command(engine, 'user-admin', `/admin/navigation/${recovery.id}`, {
      expectedVersion: recovery.version, enabled: false,
    }, 'disable-recovery', 'PATCH')).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
  })

  it('preserves request template snapshots across catalog publish/disable and protects core model identity', async () => {
    const engine = create()
    const oldDraft = (await command(engine, 'user-rd-commerce', '/requests', requestBody({ environmentName: 'revision-one' }), 'revision-old')).entityId
    const current = engine.getSnapshot().entities.catalogs[0]
    const template = structuredClone(current.template)
    template.defaults.cpu = 4
    template.limits.maxCpu = 12
    await command(engine, 'user-admin', '/admin/catalog/catalog-web/revisions', {
      expectedVersion: current.version, baseRevision: current.revision, reason: 'Publish larger demo profile',
      template, name: current.name, description: current.description, allowedProjectIds: current.allowedProjectIds,
    }, 'catalog-revision')
    expect(engine.read('/catalog/catalog-web', new URLSearchParams(), 'user-rd-commerce')).toMatchObject({ revision: 1, status: 'published' })
    const draft = engine.getSnapshot().entities.catalogs[0]
    await command(engine, 'user-admin', '/admin/catalog/catalog-web/publish', {
      expectedVersion: draft.version, revision: draft.revision, reason: 'Activate revision two',
    }, 'catalog-publish')
    expect(detail(engine, oldDraft).request.templateSnapshot.defaults.cpu).toBe(2)
    const revisionTwo = (await command(engine, 'user-rd-commerce', '/requests', requestBody({
      environmentName: 'revision-two', catalogRevision: 2, cpu: 4,
    }), 'revision-new')).entityId
    expect(detail(engine, revisionTwo).request.templateSnapshot.defaults.cpu).toBe(4)
    await command(engine, 'user-rd-commerce', `/requests/${oldDraft}/submit`, { expectedVersion: 1 }, 'old-submit')
    const published = engine.getSnapshot().entities.catalogs[0]
    await command(engine, 'user-admin', '/admin/catalog/catalog-web/disable', {
      expectedVersion: published.version, reason: 'Disable new requests only',
    }, 'catalog-disable')
    expect(detail(engine, oldDraft).request.state).toBe('submitted')
    await expect(command(engine, 'user-rd-commerce', '/requests', requestBody({
      environmentName: 'disabled-new', catalogRevision: 2, cpu: 4,
    }), 'disabled-create')).rejects.toMatchObject({ status: 404 })
    const disabled = engine.getSnapshot().entities.catalogs[0]
    await command(engine, 'user-admin', '/admin/catalog/catalog-web/revisions', {
      expectedVersion: disabled.version, baseRevision: disabled.revision, reason: 'Prepare replacement while still disabled',
      template, name: disabled.name, description: disabled.description, allowedProjectIds: disabled.allowedProjectIds,
    }, 'catalog-disabled-revision')
    expect(engine.read('/catalog', new URLSearchParams(), 'user-rd-commerce')).toMatchObject({ items: [], total: 0 })
    expect(() => engine.read('/catalog/catalog-web', new URLSearchParams(), 'user-rd-commerce'))
      .toThrow(expect.objectContaining({ status: 404 }))
    await expect(command(engine, 'user-rd-commerce', `/requests/${revisionTwo}/submit`, {
      expectedVersion: 1,
    }, 'disabled-submit')).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' })
    await expect(command(engine, 'user-admin', '/admin/cmdb-fields', {
      kind: 'compute', key: 'provider', label: 'Forbidden identity override', valueType: 'string', constraints: {},
    }, 'reserved-field')).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
  })
})

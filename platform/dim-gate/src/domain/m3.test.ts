import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { createEngine } from './engine'
import { integrityErrors } from './integrity'
import { releaseDetailSchema, type PipelineRun, type Release, type Snapshot } from './schemas'

const commerce = 'user-rd-commerce', ops = 'user-ops', admin = 'user-admin', data = 'user-rd-data'
function harness(initial = createSeed('m3-test'), persist: (s: Snapshot) => void = () => undefined) {
  let sequence = initial.sequence
  const engine = createEngine(initial, persist)
  const command = (path: string, body: unknown, actorId = commerce, key = `m3-${++sequence}`, method = 'POST') => engine.command({
    sessionId: initial.sessionId, actorId, path, body, key, method,
  })
  const read = <T>(path: string, actorId = commerce, query = '') => engine.read(path, new URLSearchParams(query), actorId) as T
  const env = (id = 'env-checkout-dev') => engine.getSnapshot().entities.environments.find(e => e.id === id)!
  const run = (id: string) => engine.getSnapshot().entities.pipelines.find(r => r.id === id)!
  const release = (id: string) => engine.getSnapshot().entities.releases.find(r => r.id === id)!
  const trigger = async (revision = 'stable-001', id = 'env-checkout-dev', actor = commerce) => {
    const environment = env(id)
    const result = await command('/pipelines', { applicationId: environment.applicationId, environmentId: id, revision, environmentVersion: environment.version }, actor)
    return result.entityId
  }
  const advance = (ticks = 6) => command('/clock/advance', { ticks }, ops)
  const success = async (revision: string, id = 'env-checkout-dev', actor = commerce) => {
    const runId = await trigger(revision, id, actor); await advance(); return release(run(runId).releaseId!)
  }
  const rollback = (current: Release, target: Release) => command(`/releases/${current.id}/rollback`, {
    expectedVersion: current.version, targetReleaseId: target.id, environmentVersion: env(current.environmentId).version, reason: 'Restore tested stable artifact',
  })
  return { engine, command, read, env, run, release, trigger, advance, success, rollback }
}

describe('M3 delivery invariants', () => {
  it('build/test/package is not deployment; only successful health changes active, and history/logs survive reload', async () => {
    const h = harness()
    const id = await h.trigger()
    await h.advance(2)
    expect(h.run(id).stages.slice(0, 2).map(s => s.state)).toEqual(['succeeded', 'succeeded'])
    expect(h.engine.getSnapshot().entities.releases).toHaveLength(0)
    await h.advance(1)
    const candidate = h.release(h.run(id).releaseId!)
    expect(candidate).toMatchObject({ state: 'queued', health: 'pending', previousReleaseId: null })
    expect(h.env().activeReleaseId).toBeNull()
    const restored = harness(h.engine.getSnapshot())
    await restored.advance(2)
    expect(restored.release(candidate.id).state).toBe('verifying')
    expect(restored.env().activeReleaseId).toBeNull()
    await restored.advance(1)
    expect(restored.env().activeReleaseId).toBe(candidate.id)
    expect(restored.run(id).stages.every(s => s.state === 'succeeded')).toBe(true)
    const detail = restored.read<{ run: PipelineRun; logs: unknown[] }>(`/pipelines/${id}`)
    expect(detail.logs).toHaveLength(6)
    expect(releaseDetailSchema.safeParse(restored.read(`/releases/${candidate.id}`)).success).toBe(true)
    expect(restored.engine.getSnapshot().scheduler.tasks).toEqual([])
    expect(integrityErrors(restored.engine.getSnapshot())).toEqual([])
  })

  it('stable → next → rollback creates a new release and recovery event without rewriting history', async () => {
    const h = harness()
    const stable = await h.success('stable-001'), next = await h.success('next-002')
    expect(next.previousReleaseId).toBe(stable.id)
    const result = await h.rollback(next, stable)
    expect(h.env().activeReleaseId).toBe(next.id)
    await h.advance(3)
    const restored = h.release(result.entityId)
    expect(restored).toMatchObject({ kind: 'rollback', targetReleaseId: stable.id, previousReleaseId: next.id, artifactDigest: stable.artifactDigest, state: 'succeeded' })
    expect(h.env().activeReleaseId).toBe(restored.id)
    expect(h.release(stable.id)).toEqual(stable)
    expect(h.release(next.id)).toEqual(next)
    expect(h.engine.getSnapshot().events.some(e => e.type === 'observation.recovery-requested' && e.correlationId === restored.correlationId)).toBe(true)
    expect(h.read<{ total: number }>('/audit', commerce, `correlationId=${restored.correlationId}`).total).toBe(5)
  })

  it('build failure has no artifact/release; retry creates a fresh run and correlation', async () => {
    const h = harness(), id = await h.trigger()
    await h.command('/scenarios', { scenarioKey: 'build-failure', runId: id })
    await h.advance(1)
    expect(h.run(id)).toMatchObject({ state: 'failed', failureCode: 'SIMULATED_BUILD_FAILURE' })
    expect(h.engine.getSnapshot().entities.releases).toEqual([])
    expect(h.engine.getSnapshot().entities.artifacts).toEqual([])
    const failed = h.run(id)
    const retry = await h.command(`/pipelines/${id}/retry`, { expectedVersion: failed.version, reason: 'Retry build' })
    expect(retry.entityId).not.toBe(id)
    expect(retry.correlationId).not.toBe(failed.correlationId)
    expect(h.run(retry.entityId).retryOfRunId).toBe(id)
    await h.advance()
    expect(h.run(retry.entityId).state).toBe('succeeded')
    expect(h.run(id)).toEqual(failed)
  })

  it('health and rollback failure preserve active; retry deduplicates the deterministic artifact', async () => {
    const h = harness(), stable = await h.success('stable')
    const id = await h.trigger('candidate')
    await h.command('/scenarios', { scenarioKey: 'health-failure', runId: id })
    await h.advance()
    const failed = h.release(h.run(id).releaseId!)
    expect(failed).toMatchObject({ state: 'failed', health: 'unhealthy' })
    expect(h.env().activeReleaseId).toBe(stable.id)
    const retry = await h.command(`/pipelines/${id}/retry`, { expectedVersion: h.run(id).version, reason: 'Retry candidate' })
    await h.advance()
    const next = h.release(h.run(retry.entityId).releaseId!)
    expect(next.artifactDigest).toBe(failed.artifactDigest)
    expect(h.engine.getSnapshot().entities.artifacts).toHaveLength(2)
    const rollback = await h.rollback(next, stable)
    await h.command('/scenarios', { scenarioKey: 'rollback-failure', releaseId: rollback.entityId })
    await h.advance(3)
    expect(h.release(rollback.entityId)).toMatchObject({ state: 'failed', failureCode: 'SIMULATED_ROLLBACK_FAILURE' })
    expect(h.env().activeReleaseId).toBe(next.id)
    expect(h.engine.getSnapshot().events.filter(e => e.type === 'observation.recovery-requested')).toEqual([])
    const again = await h.rollback(next, stable)
    await h.advance(3)
    expect(h.env().activeReleaseId).toBe(again.entityId)
  })

  it('serializes competing triggers; busy rollback fails without side effects and terminal cancel releases lock', async () => {
    const h = harness(), stable = await h.success('stable'), next = await h.success('next')
    const result = await Promise.allSettled([h.trigger('one'), h.trigger('two')])
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect((result.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'ENVIRONMENT_BUSY' })
    const before = h.engine.getSnapshot()
    await expect(h.rollback(next, stable)).rejects.toMatchObject({ code: 'ENVIRONMENT_BUSY' })
    expect(h.engine.getSnapshot()).toEqual(before)
    const id = (result.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<string>).value
    await h.command(`/pipelines/${id}/cancel`, { expectedVersion: h.run(id).version, reason: 'Cancel queued build' })
    expect(h.run(id).stages.every(s => s.state === 'skipped')).toBe(true)
    await expect(h.trigger('after-cancel')).resolves.toMatch(/^run-/)
  })

  it.each([0, 2, 3])('allows pre-deploy cancellation at tick %i and never leaves ghost tasks', async ticks => {
    const h = harness(), id = await h.trigger()
    if (ticks) await h.advance(ticks)
    await h.command(`/pipelines/${id}/cancel`, { expectedVersion: h.run(id).version, reason: 'Cancel before candidate execution' })
    await h.advance()
    expect(h.run(id).state).toBe('cancelled')
    expect(h.env().activeReleaseId).toBeNull()
    expect(h.engine.getSnapshot().scheduler.tasks).toEqual([])
    if (ticks === 3) expect(h.release(h.run(id).releaseId!).state).toBe('cancelled')
  })

  it.each([4, 5])('refuses cancel during rollout/verify at tick %i', async ticks => {
    const h = harness(), id = await h.trigger()
    await h.advance(ticks)
    const before = h.engine.getSnapshot()
    await expect(h.command(`/pipelines/${id}/cancel`, { expectedVersion: h.run(id).version, reason: 'Too late' })).rejects.toMatchObject({ code: 'INVALID_STATE' })
    expect(h.engine.getSnapshot()).toEqual(before)
  })

  it('requires non-self scoped Ops prod approval, including rollback, and persists both actors', async () => {
    const snapshot = createSeed('m3-test')
    snapshot.entities.assignments.push({ ...snapshot.entities.assignments.find(g => g.id === 'grant-ops-store')!, id: 'dual-role', userId: commerce })
    const h = harness(snapshot), id = await h.trigger('prod-stable', 'env-checkout-prod')
    await h.advance(6)
    const candidate = h.release(h.run(id).releaseId!)
    expect(h.run(id).state).toBe('awaiting_approval')
    expect(candidate.state).toBe('pending_approval')
    expect(h.env('env-checkout-prod').activeReleaseId).toBeNull()
    const body = { expectedVersion: candidate.version, reason: 'Approve prod' }
    await expect(h.command(`/releases/${candidate.id}/approve`, body)).rejects.toMatchObject({ status: 403, code: 'SELF_APPROVAL_DENIED' })
    await expect(h.command(`/releases/${candidate.id}/approve`, body, admin)).rejects.toMatchObject({ status: 403 })
    await h.command(`/releases/${candidate.id}/approve`, body, ops)
    await h.advance(3)
    expect(h.release(candidate.id)).toMatchObject({ createdBy: commerce, approval: { actorId: ops }, state: 'succeeded' })
    const second = await h.trigger('prod-next', 'env-checkout-prod'); await h.advance(3)
    const next = h.release(h.run(second).releaseId!)
    await h.command(`/releases/${next.id}/approve`, { expectedVersion: next.version, reason: 'Approve next' }, ops); await h.advance(3)
    const rollback = await h.rollback(h.release(next.id), h.release(candidate.id))
    expect(h.release(rollback.entityId).state).toBe('pending_approval')
    await h.command(`/releases/${rollback.entityId}/approve`, { expectedVersion: 1, reason: 'Approve rollback' }, ops); await h.advance(3)
    expect(h.env('env-checkout-prod').activeReleaseId).toBe(rollback.entityId)
  })

  it.each(['reject', 'cancel'] as const)('prod %s releases lock and leaves active unchanged', async action => {
    const h = harness(), id = await h.trigger('prod', 'env-checkout-prod'); await h.advance(3)
    const candidate = h.release(h.run(id).releaseId!)
    await h.command(action === 'reject' ? `/releases/${candidate.id}/reject` : `/pipelines/${id}/cancel`, {
      expectedVersion: action === 'reject' ? candidate.version : h.run(id).version, reason: 'Do not promote',
    }, action === 'reject' ? ops : commerce)
    expect(h.env('env-checkout-prod').activeReleaseId).toBeNull()
    expect(h.release(candidate.id).state).toBe(action === 'reject' ? 'rejected' : 'cancelled')
    await expect(h.trigger('another-prod', 'env-checkout-prod')).resolves.toMatch(/^run-/)
  })

  it('rejects absent/same-artifact/cross-environment rollback targets and stale active versions', async () => {
    const h = harness(), stable = await h.success('stable')
    expect(h.read<{ rollbackTargets: Release[] }>(`/releases/${stable.id}`).rollbackTargets).toEqual([])
    await expect(h.rollback(stable, stable)).rejects.toMatchObject({ status: 409 })
    const another = await h.success('elsewhere', 'env-storefront-dev')
    await expect(h.rollback(stable, another)).rejects.toMatchObject({ status: 404 })
    const next = await h.success('next')
    await expect(h.rollback(stable, next)).rejects.toMatchObject({ status: 409 })
    const version = h.env().version
    await expect(h.command(`/releases/${next.id}/rollback`, { expectedVersion: next.version, environmentVersion: version - 1, targetReleaseId: stable.id, reason: 'Stale dialog' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('reads and audit filter by current environment stage; Data and Admin cannot read scoped raw pipeline logs', async () => {
    const h = harness()
    const dataId = await h.trigger('data-secret', 'env-data-dev', data)
    const commerceId = await h.trigger('commerce-public'); await h.advance()
    const dataRelease = h.release(h.run(dataId).releaseId!)
    expect(h.read<{ total: number }>('/pipelines', commerce, 'environmentId=env-data-dev').total).toBe(0)
    expect(h.read<{ total: number }>('/releases', commerce, 'environmentId=env-data-dev').total).toBe(0)
    expect(() => h.read(`/pipelines/${dataId}`)).toThrow(expect.objectContaining({ status: 404 }))
    expect(() => h.read(`/releases/${dataRelease.id}`)).toThrow(expect.objectContaining({ status: 404 }))
    expect(h.read<{ items: unknown[] }>('/search', commerce, 'q=data-secret').items).toEqual([])
    expect(h.read<{ total: number }>('/audit', commerce, `correlationId=${dataRelease.correlationId}`).total).toBe(0)
    expect(JSON.stringify(h.read('/audit'))).not.toContain(dataId)
    expect(h.read<{ total: number }>('/pipelines', admin).total).toBe(0)
    expect(() => h.read(`/pipelines/${commerceId}`, admin)).toThrow(expect.objectContaining({ status: 404 }))
    expect(h.read<{ release: Release }>(`/releases/${h.run(commerceId).releaseId}`, admin).release.state).toBe('succeeded')
    const scoped = h.engine.getSnapshot(); scoped.entities.assignments.filter(g => g.userId === commerce).forEach(g => { g.stages = ['prod'] })
    const restricted = harness(scoped)
    expect(restricted.read<{ total: number }>('/releases').total).toBe(0)
    expect(restricted.read<{ total: number }>('/audit', commerce, `correlationId=${h.run(commerceId).correlationId}`).total).toBe(0)
  })

  it('replay is idempotent but reauthorizes after revoke, and stale/different-body commands never partially commit', async () => {
    const h = harness()
    const body = { applicationId: 'app-checkout', environmentId: 'env-checkout-dev', environmentVersion: 1, revision: 'stable' }
    const first = await h.command('/pipelines', body, commerce, 'same-key')
    await h.advance()
    const before = h.engine.getSnapshot()
    expect(await h.command('/pipelines', body, commerce, 'same-key')).toEqual(first)
    expect(h.engine.getSnapshot()).toEqual(before)
    await expect(h.command('/pipelines', { ...body, revision: 'changed' }, commerce, 'same-key')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await h.command('/admin/assignments/grant-rd-commerce', { expectedVersion: 1, reason: 'Revoke delivery scope' }, admin, 'revoke', 'DELETE')
    await expect(h.command('/pipelines', body, commerce, 'same-key')).rejects.toMatchObject({ status: 404 })
    await expect(h.command('/pipelines', body, admin)).rejects.toMatchObject({ status: 403 })
  })

  it('persistence failure leaves scheduled step, artifact, active, logs and audit unchanged', async () => {
    let reject = false
    const h = harness(createSeed('m3-test'), () => { if (reject) throw new Error('quota') })
    const id = await h.trigger(); await h.advance(2)
    const before = h.engine.getSnapshot(); reject = true
    await expect(h.advance(1)).rejects.toMatchObject({ status: 507 })
    expect(h.engine.getSnapshot()).toEqual(before)
    reject = false; await h.advance(4)
    expect(h.run(id).state).toBe('succeeded')
    expect(h.engine.getSnapshot().entities.releases).toHaveLength(1)
  })

  it('strictly validates fault targets, late injection and list query enums', async () => {
    const h = harness(), id = await h.trigger()
    for (const body of [
      { scenarioKey: 'build-failure' }, { scenarioKey: 'build-failure', runId: id, poolId: 'pool-aws-sg' },
      { scenarioKey: 'rollback-failure', runId: id }, { scenarioKey: 'capacity-exhausted', runId: id },
    ]) await expect(h.command('/scenarios', body)).rejects.toMatchObject({ status: 422 })
    await h.advance(1)
    await expect(h.command('/scenarios', { scenarioKey: 'build-failure', runId: id })).rejects.toMatchObject({ status: 422 })
    for (const query of ['state=impossible', 'sort=name', 'page=0', 'environmentId=', 'kind=rollback', 'q=a&q=b']) expect(() => h.read('/pipelines', commerce, query)).toThrow(expect.objectContaining({ status: 422 }))
  })

  it('detects corrupt active release, dangling artifacts and conflicting scheduler state on restoration', async () => {
    const h = harness(); await h.success('stable')
    const corrupt = h.engine.getSnapshot(); corrupt.entities.environments[0].activeReleaseId = 'missing'
    expect(() => createEngine(corrupt, () => undefined)).toThrow(expect.objectContaining({ code: 'INVALID_SNAPSHOT' }))
    const missingArtifact = h.engine.getSnapshot(); missingArtifact.entities.artifacts = []
    expect(() => createEngine(missingArtifact, () => undefined)).toThrow(expect.objectContaining({ code: 'INVALID_SNAPSHOT' }))
    await h.trigger('next')
    const missingTask = h.engine.getSnapshot(); missingTask.scheduler.tasks = []
    expect(() => createEngine(missingTask, () => undefined)).toThrow(expect.objectContaining({ code: 'INVALID_SNAPSHOT' }))
  })
})

import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { createEngine } from './engine'
import { cohortBucket, featureEligibility } from './feature-policy'
import { policyFor } from './policy'

function harness() {
  const engine = createEngine(createSeed('w5-feature-session'), () => {})
  let sequence = 0
  const command = (actorId: string, path: string, body: unknown, key = `w5-feature-${++sequence}`) =>
    engine.command({ sessionId: 'w5-feature-session', actorId, method: 'POST', path, body, key })
  return { engine, command }
}
const spec = (rolloutPercent = 100) => ({ featureKey: 'rd.monitoring', targetCenter: 'rd',
  eligibleProjectIds: ['project-store'], eligibleTeamIds: ['team-commerce'], rolloutPercent, saltVersion: 1 })

describe('W5 registered feature cohort', () => {
  it('intersects current grant, team and deterministic cohort on domain commands', async () => {
    const { engine, command } = harness()
    expect(engine.read('/session', new URLSearchParams(), 'user-ops')).toMatchObject({ featureKeys: expect.arrayContaining(['rd.delivery']) })
    const originalBody = { spec: {
      target: { kind: 'service', applicationId: 'app-checkout', environmentId: 'env-checkout-dev' },
      source: 'demo-red', metrics: ['errorRate'], sampleIntervalSeconds: 60, freshnessSeconds: 120, enabled: true,
    }, reason: 'Existing accepted monitor remains readable' }
    const monitor = await command('user-rd-commerce', '/monitor-policies', originalBody, 'w5-monitor-original')
    const first = await command('user-admin', '/admin/platform-features', { spec: spec(0), reason: 'Zero cohort test' })
    const current = () => engine.getSnapshot().entities.platformFeatures.find(row => row.id === first.entityId)!
    await command('user-admin', `/admin/platform-features/${first.entityId}/validate`, { expectedVersion: current().version, reason: 'Validate registry' })
    await command('user-admin', `/admin/platform-features/${first.entityId}/activate`, { expectedVersion: current().version, reason: 'Disable new cohort work' })
    expect(featureEligibility(engine.getSnapshot(), policyFor(engine.getSnapshot(), 'user-rd-commerce'), 'rd.monitoring', 'project-store'))
      .toMatchObject({ eligible: false, reason: 'percentage-cohort' })
    expect(engine.read('/session', new URLSearchParams(), 'user-rd-commerce')).toMatchObject({ featureKeys: expect.not.arrayContaining(['rd.monitoring']) })
    expect(cohortBucket('user-rd-commerce', 'rd.monitoring', 1)).toBe(cohortBucket('user-rd-commerce', 'rd.monitoring', 1))
    expect(featureEligibility(engine.getSnapshot(), policyFor(engine.getSnapshot(), 'user-rd-data'), 'rd.monitoring', 'project-store'))
      .toMatchObject({ eligible: false, reason: 'project-grant' })
    await expect(command('user-rd-commerce', '/monitor-policies', { spec: {
      target: { kind: 'service', applicationId: 'app-checkout', environmentId: 'env-checkout-dev' },
      source: 'demo-red', metrics: ['errorRate'], sampleIntervalSeconds: 60, freshnessSeconds: 120, enabled: true,
    }, reason: 'Denied new feature command' })).rejects.toMatchObject({ status: 403, code: 'FEATURE_UNAVAILABLE' })
    expect(await command('user-rd-commerce', '/monitor-policies', originalBody, 'w5-monitor-original')).toEqual(monitor)
    await expect(command('user-rd-commerce', '/monitor-policies', { ...originalBody, reason: 'Changed old key' }, 'w5-monitor-original'))
      .rejects.toMatchObject({ status: 409 })
    expect(engine.read(`/monitor-policies/${monitor.entityId}`, new URLSearchParams(), 'user-rd-commerce')).toMatchObject({ id: monitor.entityId })
  })

  it('keeps active revision through draft, disables safely and restores as new immutable revision', async () => {
    const { engine, command } = harness()
    const created = await command('user-admin', '/admin/platform-features', { spec: spec(), reason: 'Initial cohort' })
    expect(engine.read('/audit', new URLSearchParams('entityType=platformFeature'), 'user-rd-commerce'))
      .toMatchObject({ total: 0 })
    const current = () => engine.getSnapshot().entities.platformFeatures.find(row => row.id === created.entityId)!
    await command('user-admin', `/admin/platform-features/${created.entityId}/validate`, { expectedVersion: current().version, reason: 'Validate' })
    await command('user-admin', `/admin/platform-features/${created.entityId}/activate`, { expectedVersion: current().version, reason: 'Activate' })
    expect(featureEligibility(engine.getSnapshot(), policyFor(engine.getSnapshot(), 'user-rd-commerce'), 'rd.monitoring', 'project-store').eligible).toBe(true)
    const version = current().version
    await command('user-admin', `/admin/platform-features/${created.entityId}/revisions`, { expectedVersion: version, spec: spec(0), reason: 'Stage smaller cohort' })
    expect(current()).toMatchObject({ revision: 2, activeRevision: 1, status: 'draft' })
    expect(featureEligibility(engine.getSnapshot(), policyFor(engine.getSnapshot(), 'user-rd-commerce'), 'rd.monitoring', 'project-store').eligible).toBe(true)
    await expect(command('user-admin', `/admin/platform-features/${created.entityId}/activate`, { expectedVersion: version, reason: 'Stale dialog' }))
      .rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    await command('user-admin', `/admin/platform-features/${created.entityId}/validate`, { expectedVersion: current().version, reason: 'Validate next' })
    await command('user-admin', `/admin/platform-features/${created.entityId}/activate`, { expectedVersion: current().version, reason: 'Activate next' })
    expect(featureEligibility(engine.getSnapshot(), policyFor(engine.getSnapshot(), 'user-rd-commerce'), 'rd.monitoring', 'project-store').eligible).toBe(false)
    await command('user-admin', `/admin/platform-features/${created.entityId}/disable`, { expectedVersion: current().version, reason: 'Stop new work' })
    expect(current()).toMatchObject({ status: 'disabled', activeRevision: null })
    expect(engine.read('/session', new URLSearchParams(), 'user-rd-commerce')).toMatchObject({ featureKeys: expect.not.arrayContaining(['rd.monitoring']) })
    await command('user-admin', `/admin/platform-features/${created.entityId}/restore`, { expectedVersion: current().version, revision: 1, reason: 'Restore safe cohort' })
    expect(current()).toMatchObject({ status: 'draft', revision: 3, activeRevision: null })
    expect(current().revisions.map(row => row.revision)).toEqual([1, 2, 3])
    expect(current().revisions[2].spec).toEqual(current().revisions[0].spec)
  })

  it('rejects unsupported keys, center mismatches, hidden refs and non-Admin changes', async () => {
    const { engine, command } = harness()
    const before = engine.getSnapshot()
    await expect(command('user-admin', '/admin/platform-features', { spec: { ...spec(), featureKey: 'admin.access' }, reason: 'Recovery override' }))
      .rejects.toMatchObject({ status: 422 })
    await expect(command('user-admin', '/admin/platform-features', { spec: { ...spec(), targetCenter: 'ops' }, reason: 'Wrong center' }))
      .rejects.toMatchObject({ status: 422 })
    await expect(command('user-admin', '/admin/platform-features', { spec: { ...spec(), eligibleProjectIds: ['missing-project'] }, reason: 'Hidden reference' }))
      .rejects.toMatchObject({ status: 422 })
    await expect(command('user-rd-commerce', '/admin/platform-features', { spec: spec(), reason: 'No Admin grant' }))
      .rejects.toMatchObject({ status: 403 })
    expect(engine.getSnapshot()).toEqual(before)
  })
})

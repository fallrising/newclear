import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { createEngine, DomainError } from './engine'
import { policyFor } from './policy'

const query = new URLSearchParams()
function harness() {
  const engine = createEngine(createSeed('w5-identity-session'), () => {})
  let serial = 0
  const command = (actorId: string, method: string, path: string, body: unknown, key = `w5-command-${++serial}`) =>
    engine.command({ sessionId: 'w5-identity-session', actorId, method, path, body, key })
  return { engine, command }
}

describe('W5 Demo identity governance', () => {
  it('creates users and teams without granting access or registering a persona', async () => {
    const { engine, command } = harness()
    const teamReceipt = await command('user-admin', 'POST', '/admin/teams',
      { businessUnitId: 'bu-technology', name: 'Demo Team', reason: 'Scoped governance test' })
    const team = engine.getSnapshot().entities.teams.find(row => row.id === teamReceipt.entityId)!
    expect(team).toMatchObject({ source: 'demo', version: 1, businessUnitId: 'bu-technology' })
    const userReceipt = await command('user-admin', 'POST', '/admin/users',
      { displayName: 'Demo User', teamIds: [team.id], enabled: true, reason: 'Scoped governance test' })
    const snapshot = engine.getSnapshot()
    expect(snapshot.entities.users.find(row => row.id === userReceipt.entityId)).toMatchObject({ source: 'demo', teamIds: [team.id] })
    expect(snapshot.entities.assignments.some(row => row.userId === userReceipt.entityId)).toBe(false)
    expect(() => engine.read('/session', query, userReceipt.entityId)).toThrowError(DomainError)
    expect(policyFor(snapshot, userReceipt.entityId).effectiveActions).toEqual([])
  })

  it('does not turn team membership into a project grant', async () => {
    const { engine, command } = harness()
    const before = policyFor(engine.getSnapshot(), 'w2-user-no-grant')
    expect(before.effectiveActions).toEqual([])
    const user = engine.getSnapshot().entities.users.find(row => row.id === 'w2-user-no-grant')!
    await command('user-admin', 'PATCH', `/admin/users/${user.id}`,
      { expectedVersion: user.version, teamIds: ['team-commerce'], reason: 'Membership is not a grant' })
    const after = policyFor(engine.getSnapshot(), user.id)
    expect(after.projectIds).toEqual([])
    expect(after.effectiveActions).toEqual([])
  })

  it('enforces current authorization before idempotent replay', async () => {
    const { engine, command } = harness()
    const body = { displayName: 'Demo User', teamIds: [], enabled: true, reason: 'Replay test' }
    const first = await command('user-admin', 'POST', '/admin/users', body, 'w5-replay')
    expect(await command('user-admin', 'POST', '/admin/users', body, 'w5-replay')).toEqual(first)
    expect(engine.getSnapshot().entities.users.filter(row => row.id === first.entityId)).toHaveLength(1)
    await expect(command('user-admin', 'POST', '/admin/users', { ...body, displayName: 'Other' }, 'w5-replay'))
      .rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    const admin = engine.getSnapshot().entities.users.find(row => row.id === 'user-admin')!
    await expect(command('user-admin', 'PATCH', `/admin/users/${admin.id}`,
      { expectedVersion: admin.version, enabled: false, reason: 'Self disable' }))
      .rejects.toMatchObject({ status: 403, code: 'SELF_MODIFICATION_DENIED' })
  })

  it('rejects stale versions, missing team references and unauthorized writes atomically', async () => {
    const { engine, command } = harness()
    const before = engine.getSnapshot()
    await expect(command('w2-user-no-grant', 'POST', '/admin/teams',
      { businessUnitId: 'bu-technology', name: 'Denied', reason: 'No grant' }))
      .rejects.toMatchObject({ status: 403 })
    await expect(command('user-admin', 'POST', '/admin/users',
      { displayName: 'Invalid', teamIds: ['missing-team'], enabled: true, reason: 'Invalid membership' }))
      .rejects.toMatchObject({ status: 422 })
    const team = before.entities.teams[0]
    await expect(command('user-admin', 'PATCH', `/admin/teams/${team.id}`,
      { expectedVersion: team.version + 1, name: 'Stale', reason: 'Stale dialog' }))
      .rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    expect(engine.getSnapshot()).toEqual(before)
  })
})

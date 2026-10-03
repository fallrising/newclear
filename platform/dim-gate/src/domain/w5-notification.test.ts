import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { createEngine } from './engine'
import { dispatchNotification } from './notification-dispatch'
import { integrityErrors } from './integrity'

function harness() {
  const engine = createEngine(createSeed('w5-notification-session'), () => {})
  let serial = 0
  const command = (actorId: string, method: string, path: string, body: unknown, key = `w5-notification-${++serial}`) =>
    engine.command({ sessionId: 'w5-notification-session', actorId, method, path, body, key })
  const read = <T>(actorId: string, path: string, query = '') => engine.read(path, new URLSearchParams(query), actorId) as T
  const action = (actorId: string, collection: string, id: string, name: string) => command(actorId, 'POST',
    `/${collection}/${id}/${name}`, { expectedVersion: read<{ version: number }>(actorId, `/${collection}/${id}`).version,
      reason: 'Validate W5 notification source' })
  return { engine, command, read, action }
}

async function activeServiceRule(h: ReturnType<typeof harness>) {
  const rd = 'user-rd-commerce'
  const monitor = await h.command(rd, 'POST', '/monitor-policies', { spec: {
    target: { kind: 'service', applicationId: 'app-checkout', environmentId: 'env-checkout-dev' },
    source: 'demo-red', metrics: ['errorRate'], sampleIntervalSeconds: 60, freshnessSeconds: 120, enabled: true,
  }, reason: 'Monitor subscribed service' })
  await h.action(rd, 'monitor-policies', monitor.entityId, 'validate')
  await h.action(rd, 'monitor-policies', monitor.entityId, 'submit')
  await h.action(rd, 'monitor-policies', monitor.entityId, 'activate')
  const rule = await h.command(rd, 'POST', '/alert-rules', { spec: {
    monitorPolicyId: monitor.entityId, metric: 'errorRate', aggregation: 'last', windowSeconds: 120,
    comparator: 'gt', threshold: 0.1, unit: 'fraction', requiredConsecutiveSamples: 2,
    severity: 'warning', channelRef: 'demo-rd', enabled: true,
  }, reason: 'Alert subscribed service' })
  await h.action(rd, 'alert-rules', rule.entityId, 'validate')
  await h.action(rd, 'alert-rules', rule.entityId, 'submit')
  await h.action(rd, 'alert-rules', rule.entityId, 'activate')
  return rule.entityId
}

describe('W5 recipient-specific notification attempts', () => {
  it('deduplicates a failed W4 event, retries with fresh scope, and hides old content after revoke', async () => {
    const h = harness(), rd = 'user-rd-commerce', admin = 'user-admin'
    const subscription = await h.command(rd, 'POST', '/notification-subscriptions', {
      environmentId: 'env-checkout-dev', channelId: 'demo-rd', reason: 'Subscribe to own service' })
    expect(h.read<{ total: number }>(rd, '/notification-subscriptions', 'environmentId=env-checkout-dev').total).toBe(1)
    const ruleId = await activeServiceRule(h)
    await h.command(rd, 'POST', '/scenarios', { scenarioKey: 'alert-delivery-failure', ruleId })
    expect(h.engine.getSnapshot().entities.notificationAttempts).toEqual([])
    await h.command(rd, 'POST', '/clock/advance', { ticks: 1 })
    const snapshot = h.engine.getSnapshot(), delivery = snapshot.entities.notificationDeliveries[0]
    expect(delivery).toMatchObject({ status: 'failed', safeFailureCode: 'DEMO_DELIVERY_FAILURE' })
    expect(snapshot.entities.notificationAttempts).toMatchObject([{ sourceEventId: delivery.id,
      recipientId: rd, channelId: 'demo-rd', templateRevision: 1, status: 'failed', attempt: 1,
      safeFailureCode: 'MOCK_DELIVERY_FAILURE' }])
    expect(dispatchNotification(snapshot, delivery)).toEqual([])
    const old = snapshot.entities.notificationAttempts[0]
    expect(h.read<{ items: { sourceLabel: string }[] }>(rd, '/notification-attempts').items[0].sourceLabel).toBe('checkout-api')
    const otherOrgTemplate = structuredClone(snapshot)
    otherOrgTemplate.entities.organizations.push({ ...otherOrgTemplate.entities.organizations[0]!, id: 'org-other', name: 'Other Demo organization' })
    otherOrgTemplate.entities.notificationAttempts = []
    const template = otherOrgTemplate.entities.notificationTemplates[0]!
    template.status = 'disabled'; template.activeRevision = null
    otherOrgTemplate.entities.notificationTemplates.push({ ...structuredClone(template), id: 'other-org-template', orgId: 'org-other',
      status: 'active', activeRevision: 1 })
    expect(dispatchNotification(otherOrgTemplate, delivery)).toEqual([])
    expect(otherOrgTemplate.entities.notificationAttempts).toEqual([])
    const retry = await h.command(rd, 'POST', `/notification-attempts/${old.id}/retry`, { expectedVersion: old.version,
      reason: 'Retry current recipient projection' })
    expect(h.engine.getSnapshot().entities.notificationAttempts).toMatchObject([
      { id: old.id, status: 'failed', attempt: 1 }, { id: retry.entityId, status: 'delivered', attempt: 2 },
    ])
    expect(integrityErrors(h.engine.getSnapshot())).toEqual([])
    const dedupeProbe = structuredClone(h.engine.getSnapshot())
    const nextDelivery = { ...delivery, id: 'w4-delivery-dedupe-probe', version: 1,
      occurredAt: new Date(Date.parse(delivery.updatedAt) + 120_000).toISOString(),
      updatedAt: new Date(Date.parse(delivery.updatedAt) + 120_000).toISOString() }
    dedupeProbe.entities.notificationDeliveries.push(nextDelivery)
    expect(dispatchNotification(dedupeProbe, nextDelivery)).toEqual([])
    nextDelivery.occurredAt = new Date(Date.parse(delivery.updatedAt) + 301_000).toISOString()
    nextDelivery.updatedAt = nextDelivery.occurredAt
    expect(dispatchNotification(dedupeProbe, nextDelivery)).toHaveLength(1)
    const aged = structuredClone(h.engine.getSnapshot())
    aged.logicalClock += 31 * 86_400
    const expired = createEngine(aged, () => {})
    expect((expired.read('/notification-attempts', new URLSearchParams(), rd) as { total: number }).total).toBe(0)
    expect(() => expired.read(`/notification-attempts/${old.id}`, new URLSearchParams(), rd)).toThrow()
    const channel = h.engine.getSnapshot().entities.channels.find(row => row.id === 'demo-rd')!
    await h.command(admin, 'PATCH', '/admin/channels/demo-rd', { expectedVersion: channel.version, kind: channel.kind,
      destinationLabel: channel.destinationLabel, allowedProjectIds: [], enabled: true, reason: 'Remove Store channel scope' })
    expect(h.read<{ total: number }>(rd, '/notification-attempts').total).toBe(0)
    await expect(h.command(rd, 'POST', `/notification-attempts/${old.id}/retry`, { expectedVersion: 1,
      reason: 'Revoked channel cannot replay' })).rejects.toMatchObject({ status: 404 })
    await h.command(admin, 'PATCH', '/admin/channels/demo-rd', { expectedVersion: channel.version + 1, kind: channel.kind,
      destinationLabel: channel.destinationLabel, allowedProjectIds: ['project-store', 'project-payments', 'project-data', 'project-insights'],
      enabled: true, reason: 'Restore Store channel scope' })
    await h.command(rd, 'PATCH', `/notification-subscriptions/${subscription.entityId}`, {
      expectedVersion: 1, channelId: 'demo-rd', enabled: false, reason: 'Stop own subscription' })
    await expect(h.command(rd, 'POST', `/notification-attempts/${old.id}/retry`, { expectedVersion: 1,
      reason: 'Old subscription cannot replay' })).rejects.toMatchObject({ status: 404 })
    const grant = h.engine.getSnapshot().entities.assignments.find(row => row.userId === rd && row.scopeId === 'project-store')!
    await h.command(admin, 'DELETE', `/admin/assignments/${grant.id}`, { expectedVersion: grant.version,
      reason: 'Revoke current service scope' })
    expect(h.read<{ total: number }>(rd, '/notification-attempts').total).toBe(0)
    expect(h.read<{ total: number }>(rd, '/notification-subscriptions').total).toBe(0)
    await expect(() => h.read(rd, `/notification-attempts/${old.id}`)).toThrow()
    await expect(h.command(rd, 'POST', `/notification-attempts/${old.id}/retry`, { expectedVersion: 1,
      reason: 'Captured old dialog' })).rejects.toMatchObject({ status: 404 })
    expect(h.read<{ total: number }>(admin, '/notification-attempts').total).toBe(0)
  })

  it('keeps channels as safe metadata and synthetic Admin tests free of private targets', async () => {
    const h = harness(), admin = 'user-admin'
    await expect(h.command(admin, 'POST', '/admin/channels', { kind: 'demo_webhook', destinationLabel: 'https://example.com',
      allowedProjectIds: ['project-store'], enabled: true, reason: 'Reject endpoint' })).rejects.toMatchObject({ status: 422 })
    await expect(h.command('user-rd-data', 'POST', '/notification-subscriptions', { environmentId: 'env-checkout-dev',
      channelId: 'demo-rd', reason: 'Wrong project' })).rejects.toMatchObject({ status: 403 })
    const channel = await h.command(admin, 'POST', '/admin/channels', { kind: 'demo_email', destinationLabel: 'Mock email inbox',
      allowedProjectIds: ['project-store'], enabled: true, reason: 'Safe local metadata' })
    const test = await h.command(admin, 'POST', `/admin/channels/${channel.entityId}/test`, { expectedVersion: 1,
      simulateFailure: true, reason: 'Deterministic failure' })
    expect(h.read<{ sourceLabel: string }>(admin, `/notification-attempts/${test.entityId}`).sourceLabel).toBe('Safe Demo test event')
    const retry = await h.command(admin, 'POST', `/notification-attempts/${test.entityId}/retry`, { expectedVersion: 1,
      reason: 'Retry safe test' })
    expect(h.engine.getSnapshot().entities.notificationAttempts.find(row => row.id === retry.entityId))
      .toMatchObject({ sourceKind: 'synthetic-test', status: 'delivered', attempt: 2 })
    expect(h.read<{ total: number }>('user-rd-commerce', '/notification-attempts').total).toBe(0)
  })

  it('derives infrastructure recipients from current Ops pool grants and hides them after revoke', async () => {
    const h = harness(), ops = 'user-ops', admin = 'user-admin'
    const monitor = await h.command(ops, 'POST', '/monitor-policies', { spec: {
      target: { kind: 'infrastructure', ciId: 'ci-idc-redis-01' }, source: 'demo-ci',
      metrics: ['cpuUtilization'], sampleIntervalSeconds: 60, freshnessSeconds: 120, enabled: true,
    }, reason: 'Ops pool-scoped monitor' })
    for (const name of ['validate', 'submit', 'activate']) await h.action(ops, 'monitor-policies', monitor.entityId, name)
    const rule = await h.command(ops, 'POST', '/alert-rules', { spec: {
      monitorPolicyId: monitor.entityId, metric: 'cpuUtilization', aggregation: 'last', windowSeconds: 120,
      comparator: 'gt', threshold: 0.8, unit: 'fraction', requiredConsecutiveSamples: 2,
      severity: 'critical', channelRef: 'demo-ops', enabled: true,
    }, reason: 'Ops recipient delivery rule' })
    for (const name of ['validate', 'submit', 'activate']) await h.action(ops, 'alert-rules', rule.entityId, name)
    await h.command(ops, 'POST', '/scenarios', { scenarioKey: 'alert-delivery-failure', ruleId: rule.entityId })
    await h.command(ops, 'POST', '/clock/advance', { ticks: 1 })
    const attempts = h.engine.getSnapshot().entities.notificationAttempts
    expect(attempts.some(row => row.recipientId === ops && row.channelId === 'demo-ops' && row.status === 'failed')).toBe(true)
    const own = attempts.find(row => row.recipientId === ops)!
    const secondOps = 'w2-user-ops-secondary'
    const peer = attempts.find(row => row.recipientId === secondOps)!
    expect(peer).toBeDefined()
    expect(h.read<{ total: number; items: { attempt: { id: string } }[] }>(ops, '/notification-attempts'))
      .toMatchObject({ total: 1, items: [{ attempt: { id: own.id } }] })
    expect(h.read<{ total: number; items: { attempt: { id: string } }[] }>(secondOps, '/notification-attempts'))
      .toMatchObject({ total: 1, items: [{ attempt: { id: peer.id } }] })
    expect(() => h.read(ops, `/notification-attempts/${peer.id}`)).toThrow()
    expect(() => h.read(secondOps, `/notification-attempts/${own.id}`)).toThrow()
    expect(h.read<{ total: number }>(ops, '/audit', `entityType=notificationAttempt&entityId=${own.id}`).total).toBe(1)
    expect(h.read<{ total: number }>(ops, '/audit', `entityType=notificationAttempt&entityId=${peer.id}`).total).toBe(0)
    expect(h.read<{ total: number }>(secondOps, '/audit', `entityType=notificationAttempt&entityId=${peer.id}`).total).toBe(1)
    expect(h.read<{ total: number }>(secondOps, '/audit', `entityType=notificationAttempt&entityId=${own.id}`).total).toBe(0)
    expect(h.read<{ total: number }>(admin, '/notification-attempts').total).toBe(0)
    const grant = h.engine.getSnapshot().entities.assignments.find(row => row.userId === ops && row.scopeId === 'pool-idc-sg')!
    await h.command(admin, 'DELETE', `/admin/assignments/${grant.id}`, { expectedVersion: grant.version,
      reason: 'Remove current Ops pool scope' })
    expect(h.read<{ total: number }>(ops, '/notification-attempts').total).toBe(0)
    await expect(h.command(ops, 'POST', `/notification-attempts/${own.id}/retry`, { expectedVersion: own.version,
      reason: 'Captured revoked pool retry' })).rejects.toMatchObject({ status: 404 })
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../api/client'
import { createController } from './controller'
import { createHandlers } from './handlers'

const baseUrl = 'http://localhost/dim-gate/'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

describe('W5 scoped notification HTTP contract', () => {
  it('serves safe Admin metadata and RD-owned subscription without external destinations', async () => {
    const controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'w5-notification-http' })
    server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
    const client = createApiClient()
    let serial = 0
    client.configureClient({ session: controller.getSession(), baseUrl, createKey: () => `w5-notification-http-${++serial}` })
    const unsubscribe = controller.subscribe(() => client.updateClientSession(controller.getSession()))
    try {
      await client.api.setPersona('user-admin')
      expect((await client.api.listAdminChannels()).map(row => row.id)).toEqual(['demo-rd', 'demo-ops'])
      expect(await client.api.listAdminNotificationTemplates()).toHaveLength(1)
      expect(await client.api.listAdminNotificationPolicies()).toHaveLength(1)
      const channelId = (await client.api.createChannel({ kind: 'demo_email', destinationLabel: 'Safe Mock inbox',
        allowedProjectIds: ['project-store'], enabled: true, reason: 'Demo metadata' })).entityId
      const testId = (await client.api.testChannel(channelId, { expectedVersion: 1, simulateFailure: true,
        reason: 'Known Mock failure' })).entityId
      expect(await client.api.getNotificationAttempt(testId)).toMatchObject({ sourceLabel: 'Safe Demo test event',
        attempt: { status: 'failed', sourceKind: 'synthetic-test' } })
      await client.api.retryNotificationAttempt(testId, 1, 'Safe retry')
      await client.api.setPersona('user-rd-commerce')
      const visibleChannels = await client.api.listNotificationChannels('env-checkout-dev')
      expect(visibleChannels.map(row => row.id)).toEqual(['demo-rd', channelId])
      expect(visibleChannels.every(row => row.allowedProjectIds.join(',') === 'project-store')).toBe(true)
      await client.api.createNotificationSubscription({ environmentId: 'env-checkout-dev', channelId,
        reason: 'Own service inbox' })
      expect((await client.api.listNotificationSubscriptions({ environmentId: 'env-checkout-dev' })).items).toHaveLength(1)
      expect((await client.api.listNotificationAttempts()).total).toBe(0)
      await expect(client.api.getNotificationAttempt(testId)).rejects.toMatchObject({ status: 404 })
      await expect(client.api.listAdminChannels()).rejects.toMatchObject({ status: 403 })
    } finally { unsubscribe(); controller.dispose() }
  })

  it('isolates two Ops recipients over HTTP and redacts failed retry history after pool revoke', async () => {
    const controller = createController({ storage: null, mode: 'memory', createSessionId: () => 'w5-ops-notification-http' })
    server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
    const client = createApiClient()
    let serial = 0
    client.configureClient({ session: controller.getSession(), baseUrl, createKey: () => `w5-ops-notification-${++serial}` })
    const unsubscribe = controller.subscribe(() => client.updateClientSession(controller.getSession()))
    try {
      await client.api.setPersona('user-ops')
      const monitorId = (await client.api.createMonitorPolicy({ spec: {
        target: { kind: 'infrastructure', ciId: 'ci-idc-redis-01' }, source: 'demo-ci',
        metrics: ['cpuUtilization'], sampleIntervalSeconds: 60, freshnessSeconds: 120, enabled: true,
      }, reason: 'HTTP Ops recipient scope' })).entityId
      for (const action of ['validate', 'submit', 'activate'] as const) await client.api.monitorPolicyAction(monitorId, action,
        { expectedVersion: (await client.api.getMonitorPolicy(monitorId)).version, reason: 'Activate scoped monitor' })
      const ruleId = (await client.api.createAlertRule({ spec: {
        monitorPolicyId: monitorId, metric: 'cpuUtilization', aggregation: 'last', windowSeconds: 120,
        comparator: 'gt', threshold: 0.8, unit: 'fraction', requiredConsecutiveSamples: 2,
        severity: 'critical', channelRef: 'demo-ops', enabled: true,
      }, reason: 'HTTP Ops recipient rule' })).entityId
      for (const action of ['validate', 'submit', 'activate'] as const) await client.api.alertRuleAction(ruleId, action,
        { expectedVersion: (await client.api.getAlertRule(ruleId)).version, reason: 'Activate scoped rule' })
      await client.api.setScenario('alert-delivery-failure', { ruleId })
      await client.api.advanceClock(1)
      const attempts = controller.getSnapshot().entities.notificationAttempts
      const own = attempts.find(row => row.recipientId === 'user-ops')!
      const peer = attempts.find(row => row.recipientId === 'w2-user-ops-secondary')!
      expect(own).toMatchObject({ status: 'failed', attempt: 1 })
      expect(peer).toMatchObject({ status: 'failed', attempt: 1 })
      expect((await client.api.listNotificationAttempts()).items.map(row => row.attempt.id)).toEqual([own.id])
      await expect(client.api.getNotificationAttempt(peer.id)).rejects.toMatchObject({ status: 404 })
      expect((await client.api.listAudit({ entityType: 'notificationAttempt', entityId: peer.id })).total).toBe(0)
      expect((await client.api.listAudit({ entityType: 'notificationAttempt', entityId: own.id })).total).toBe(1)
      const retried = await client.api.retryNotificationAttempt(own.id, own.version, 'New recipient-safe attempt')
      expect(await client.api.getNotificationAttempt(retried.entityId)).toMatchObject({ attempt: { attempt: 2, status: 'delivered' } })
      await client.api.setPersona('w2-user-ops-secondary')
      expect((await client.api.listNotificationAttempts()).items.map(row => row.attempt.id)).toEqual([peer.id])
      await expect(client.api.getNotificationAttempt(own.id)).rejects.toMatchObject({ status: 404 })
      expect((await client.api.listAudit({ entityType: 'notificationAttempt', entityId: own.id })).total).toBe(0)
      await client.api.setPersona('user-admin')
      const grant = controller.getSnapshot().entities.assignments.find(row => row.userId === 'user-ops' && row.scopeId === 'pool-idc-sg')!
      await client.api.revokeAssignment(grant.id, grant.version, 'Revoke old recipient pool scope')
      await client.api.setPersona('user-ops')
      expect((await client.api.listNotificationAttempts()).total).toBe(0)
      await expect(client.api.getNotificationAttempt(own.id)).rejects.toMatchObject({ status: 404 })
      await expect(client.api.retryNotificationAttempt(own.id, own.version, 'Do not replay private data'))
        .rejects.toMatchObject({ status: 404 })
      expect((await client.api.listAudit({ entityType: 'notificationAttempt', entityId: own.id })).total).toBe(0)
    } finally { unsubscribe(); controller.dispose() }
  })
})

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../client'
import { createController } from '../../demo/controller'
import type { DemoController } from '../../demo/controller'
import { createHandlers } from '../../demo/handlers'

const baseUrl = 'http://localhost/dim-gate/'
const server = setupServer()
let controller: DemoController
let client: ReturnType<typeof createApiClient>
let sequence = 0

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(async () => {
  sequence = 0
  controller = createController({ storage: null, mode: 'memory', createSessionId: () => `cmdb-session-${++sequence}` })
  server.resetHandlers(...createHandlers(controller, { baseUrl, delayMs: 0 }))
  client = createApiClient()
  client.configureClient({ session: controller.getSession(), baseUrl, createKey: () => `cmdb-key-${++sequence}` })
  controller.subscribe(() => client.updateClientSession(controller.getSession()))
  await client.api.setPersona('user-ops')
})

const awsInput = {
  name: 'manual-aws-ui', kind: 'compute' as const, provider: 'aws' as const, externalId: 'i-manual-ui-001',
  accountId: 'account-aws-demo', locationId: 'location-aws-sg', poolId: 'pool-aws-sg', ownerTeamId: 'team-commerce',
  visibilityProjectIds: ['project-store'], lifecycle: 'active' as const, tags: { mode: 'demo' }, customFields: {},
  attributes: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', subnetId: 'subnet-demo', cpu: 1, memoryMiB: 1024 },
}

describe('Ops CMDB typed client (T-009)', () => {
  it('lists baseline and additive W2 CIs per provider and validates provider-specific detail fields', async () => {
    expect((await client.api.listCis({ pageSize: 100 })).total).toBe(63)
    expect((await client.api.listCis({ provider: 'aws', pageSize: 100 })).total).toBe(22)
    expect((await client.api.listCis({ provider: 'aliyun', pageSize: 100 })).total).toBe(20)
    expect((await client.api.listCis({ provider: 'onprem', pageSize: 100 })).total).toBe(21)
    expect((await client.api.getCi('ci-aws-checkout-01')).attributes).toMatchObject({ subnetId: 'subnet-demo' })
    expect((await client.api.getCi('ci-aliyun-worker-01')).attributes).toMatchObject({ vSwitchId: 'vsw-demo' })
    expect((await client.api.getCi('ci-onprem-02')).attributes).toMatchObject({ assetTag: 'asset-02', hypervisor: 'kvm' })
  })

  it('commits onboarding, increases only the selected source, and returns actionable 409/422 errors', async () => {
    const receipt = await client.api.createCi(awsInput)
    expect(receipt).toMatchObject({ entityType: 'ci', entityVersion: 1 })
    expect((await client.api.listCis({ pageSize: 100 })).total).toBe(64)
    expect((await client.api.listCis({ provider: 'aws', pageSize: 100 })).total).toBe(23)
    expect((await client.api.listCis({ provider: 'aliyun', pageSize: 100 })).total).toBe(20)
    await expect(client.api.createCi({ ...awsInput, name: 'duplicate' })).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_RESOURCE' })
    const { accountId: _accountId, ...withoutAccount } = awsInput
    void _accountId
    await expect(client.api.createCi(withoutAccount)).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR', fieldErrors: expect.any(Object) })
    await expect(client.api.createCi({ ...awsInput, externalId: 'mismatch', provider: 'aliyun', attributes: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', vSwitchId: 'vsw-demo', cpu: 1, memoryMiB: 1024 } })).rejects.toMatchObject({
      status: 422, code: 'VALIDATION_ERROR', fieldErrors: { provider: expect.any(Array) },
    })
  })

  it('updates metadata with expectedVersion while preserving canonical identity and rejects stale versions', async () => {
    const before = await client.api.getCi('ci-aws-checkout-01')
    const identity = { provider: before.provider, accountId: before.accountId, locationId: before.locationId,
      poolId: before.poolId, kind: before.kind, externalId: before.externalId }
    await client.api.patchCi(before.id, { expectedVersion: before.version, name: 'renamed-through-client', tags: { edited: 'true' } })
    expect(await client.api.getCi(before.id)).toMatchObject({ ...identity, name: 'renamed-through-client', tags: { edited: 'true' }, version: 2 })
    await expect(client.api.patchCi(before.id, { expectedVersion: before.version, name: 'stale-write' }))
      .rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
  })
})

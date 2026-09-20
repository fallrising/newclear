import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createSeed } from '../demo/seed'
import { createEngine, DomainError, type Engine } from './engine'
import { ciSchema, ciViewSchema, contractSchemas, roleAssignmentSchema, snapshotSchema, type CI, type CommandInput, type DashboardView, type Page, type Snapshot } from './schemas'

const seed = () => createSeed('test-session')
const command = (overrides: Partial<CommandInput> = {}): CommandInput => ({
  sessionId: 'test-session', actorId: 'user-ops', method: 'PATCH', path: '/cis/ci-aws-checkout-01',
  key: 'command-one', body: { expectedVersion: 1, name: 'updated-demo' }, ...overrides,
})
const read = (engine: Engine, path: string, actorId = 'user-rd-commerce', query = '') => engine.read(path, new URLSearchParams(query), actorId)
const revoke = (engine: Engine, id: string, key = `revoke-${id}`) => engine.command(command({ actorId: 'user-admin', method: 'DELETE', path: `/admin/assignments/${id}`, key, body: { expectedVersion: 1, reason: '驗證授權撤銷' } }))

describe('M0 schema and seed contracts', () => {
  it('builds the same valid seed for a supplied identity and never seeds completed workflows', () => {
    const snapshot = seed()
    expect(snapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(seed()).toEqual(snapshot)
    expect(snapshot.entities.cis.map((ci) => ci.provider).sort()).toEqual(['aliyun', 'aws', 'onprem'])
    expect(snapshot.entities.applications).toHaveLength(2)
    expect(snapshot.entities.environments).toHaveLength(4)
    expect(snapshot.entities.environments.some((env) => env.applicationId === 'app-checkout' && env.stage === 'staging')).toBe(false)
    expect(snapshot.entities.environments.every((env) => env.activeReleaseId === null)).toBe(true)
    expect(snapshot.jobs).toEqual([])
    expect(snapshot.events).toEqual([])
    expect(snapshot.audit).toEqual([])
    expect(() => createEngine(snapshot, () => undefined)).not.toThrow()
  })

  it('exports JSON-convertible contracts without an unrepresentable fallback', () => {
    for (const schema of Object.values(contractSchemas)) expect(() => z.toJSONSchema(schema)).not.toThrow()
  })

  it('rejects missing provider identity and wrong provider attributes', () => {
    const aws = seed().entities.cis[0]
    expect(ciSchema.safeParse({ ...aws, accountId: undefined }).success).toBe(false)
    expect(ciSchema.safeParse({ ...aws, attributes: { ...aws.attributes, vSwitchId: 'wrong-cloud', subnetId: undefined } }).success).toBe(false)
    expect(ciSchema.safeParse({ ...aws, health: 'green' }).success).toBe(false)
    const onprem = seed().entities.cis[2]
    expect(ciSchema.safeParse({ ...onprem, accountId: 'account-aws-demo' }).success).toBe(false)
  })

  it('validates all compute providers and fixed attribute kinds', () => {
    const base = seed().entities.cis[2]
    expect(ciSchema.safeParse({ ...base, kind: 'compute', attributes: { assetTag: 'demo', serialRef: 'demo', hypervisor: 'kvm', cpu: 2, memoryMiB: 4096 } }).success).toBe(true)
    expect(ciSchema.safeParse({ ...base, kind: 'compute', attributes: { cpu: 2, memoryMiB: 4096 } }).success).toBe(false)
    expect(ciSchema.safeParse({ ...base, kind: 'network', attributes: { cidr: '192.0.2.0/24' } }).success).toBe(true)
    expect(ciSchema.safeParse({ ...base, kind: 'network', attributes: { cidr: 'not-a-network' } }).success).toBe(false)
  })

  it('rejects cross-provider and missing references without changing supplied state', () => {
    const initial = seed()
    initial.entities.cis[0].locationId = 'location-idc-sg'
    const before = structuredClone(initial)
    expect(() => createEngine(initial, () => undefined)).toThrowError(DomainError)
    expect(initial).toEqual(before)
    initial.entities.cis[0].locationId = 'location-aws-sg'
    initial.entities.applications[0].ownerTeamId = 'team-data'
    expect(() => createEngine(initial, () => undefined)).toThrowError(DomainError)
  })

  it('rejects invalid role/scope/stage combinations', () => {
    const rd = seed().entities.assignments[0]
    expect(roleAssignmentSchema.safeParse({ ...rd, scopeType: 'org', scopeId: 'org-demo' }).success).toBe(false)
    expect(roleAssignmentSchema.safeParse({ ...rd, role: 'ops', scopeType: 'pool', stages: ['prod'] }).success).toBe(false)
  })
})

describe('scope-aware read projections', () => {
  it('filters before counting, searching and pagination; detail conceals existence', () => {
    const engine = createEngine(seed(), () => undefined)
    const commerce = read(engine, '/dashboard', 'user-rd-commerce', 'center=rd') as DashboardView
    expect(commerce.applicationCount).toBe(1)
    expect(commerce.environmentCount).toBe(2)
    expect(commerce.ciCount).toBe(2)
    expect(commerce.providers).toEqual([{ provider: 'aws', count: 1 }, { provider: 'aliyun', count: 0 }, { provider: 'onprem', count: 1 }])
    const page = read(engine, '/cis', 'user-rd-commerce', 'page=2&pageSize=1') as Page<CI>
    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(1)
    expect((read(engine, '/cis', 'user-rd-commerce', 'q=data-demo') as Page<CI>).total).toBe(0)
    expect((read(engine, '/cis', 'user-rd-commerce', 'projectId=project-data') as Page<CI>).total).toBe(0)
    expect((read(engine, '/dashboard', 'user-rd-commerce', 'center=rd&environmentId=env-data-dev') as DashboardView).ciCount).toBe(0)
    for (const path of ['/cis/ci-aliyun-worker-01', '/cis/nonexistent']) {
      try { read(engine, path); throw new Error('Unexpected success') } catch (error) { expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' }) }
    }
  })

  it('hides cross-project organization metadata and shared-resource visibility', () => {
    const engine = createEngine(seed(), () => undefined)
    const organization = read(engine, '/organization') as { projects: { id: string }[]; users: { id: string }[] }
    expect(organization.projects.map((project) => project.id)).toEqual(['project-store'])
    expect(organization.users.map((user) => user.id)).toEqual(['user-rd-commerce'])
    expect((read(engine, '/cis/ci-idc-redis-01') as CI).visibilityProjectIds).toEqual(['project-store'])
    expect((read(engine, '/dashboard', 'user-admin', 'center=admin') as DashboardView).ciCount).toBe(3)
  })

  it('scrubs operations-only attributes from a project-only view', () => {
    const initial = seed()
    initial.entities.cis[0].attributes.native = { externalAccountRef: 'demo-private' }
    const engine = createEngine(initial, () => undefined)
    expect((read(engine, '/cis/ci-aws-checkout-01') as CI).attributes.native).toBeUndefined()
    expect((read(engine, '/cis/ci-aws-checkout-01', 'user-ops') as CI).attributes.native).toBeDefined()
  })

  it('honors project stage scope and denies unauthorized centers', () => {
    const initial = seed()
    initial.entities.assignments[0].stages = ['dev']
    const engine = createEngine(initial, () => undefined)
    expect((read(engine, '/dashboard', 'user-rd-commerce', 'center=rd') as DashboardView).environmentCount).toBe(1)
    expect(() => read(engine, '/dashboard', 'user-rd-commerce', 'center=ops')).toThrowError(DomainError)
    expect(() => read(engine, '/session', 'missing-user')).toThrowError(DomainError)
  })

  it('returns a valid response projection for a pool-only Ops assignment', () => {
    const initial = seed()
    initial.entities.assignments = initial.entities.assignments.filter((assignment) => assignment.userId !== 'user-ops' || assignment.scopeType === 'pool')
    const engine = createEngine(initial, () => undefined)
    const view = read(engine, '/cis/ci-aws-checkout-01', 'user-ops') as CI
    expect(view.visibilityProjectIds).toEqual([])
    expect(ciViewSchema.safeParse(view).success).toBe(true)
    expect(ciSchema.safeParse(view).success).toBe(false)
  })

  it.each(['unknown=true', 'pageSize=101', 'page=0', 'page=1&page=2', 'provider=azure', 'sort=secret', 'order=random', 'projectId='])('rejects unsupported query: %s', (query) => {
    const engine = createEngine(seed(), () => undefined)
    expect(() => read(engine, '/cis', 'user-ops', query)).toThrowError(DomainError)
  })
})

describe('atomic command substrate (AC-02, AC-03)', () => {
  it('commits domain, event, audit, idempotency and counters once and replays identical receipt', async () => {
    const persist = vi.fn()
    const engine = createEngine(seed(), persist)
    const receipt = await engine.command(command())
    expect(await engine.command(command({ body: { name: 'updated-demo', expectedVersion: 1 } }))).toEqual(receipt)
    expect(persist).toHaveBeenCalledTimes(1)
    const state = engine.getSnapshot()
    expect(state.entities.cis[0]).toMatchObject({ name: 'updated-demo', version: 2, externalId: 'i-demo-checkout-01' })
    expect(state).toMatchObject({ commandCount: 1, sequence: 1, storeRevision: 1 })
    expect(state.audit).toHaveLength(1)
    expect(state.events).toHaveLength(1)
    expect(state.idempotency).toHaveLength(1)
    expect(state.audit[0].correlationId).toBe(receipt.correlationId)
    expect(state.audit[0].diffSummary).toEqual(['name'])
  })

  it('rejects altered bodies under the same key and leaves every part unchanged', async () => {
    const engine = createEngine(seed(), () => undefined)
    await engine.command(command())
    const before = engine.getSnapshot()
    await expect(engine.command(command({ body: { expectedVersion: 1, name: 'different' } }))).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    expect(engine.getSnapshot()).toEqual(before)
  })

  it('rejects normalized-but-different input under the same key', async () => {
    const engine = createEngine(seed(), () => undefined)
    await engine.command(command())
    await expect(engine.command(command({ body: { expectedVersion: 1, name: ' updated-demo ' } }))).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('serializes a stale-version race and does not partially audit the loser', async () => {
    const engine = createEngine(seed(), () => undefined)
    const outcomes = await Promise.allSettled([engine.command(command()), engine.command(command({ key: 'another-command', body: { expectedVersion: 1, name: 'racing' } }))])
    expect(outcomes[0].status).toBe('fulfilled')
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { status: 409, code: 'VERSION_CONFLICT' } })
    expect(engine.getSnapshot().commandCount).toBe(1)
    expect(engine.getSnapshot().audit).toHaveLength(1)
  })

  it('coalesces a concurrent double submission by the same key', async () => {
    const persist = vi.fn()
    const engine = createEngine(seed(), persist)
    const outcomes = await Promise.all([engine.command(command()), engine.command(command())])
    expect(outcomes[0]).toEqual(outcomes[1])
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('checks present authorization before replay after a pool grant is revoked', async () => {
    const engine = createEngine(seed(), () => undefined)
    await engine.command(command())
    await revoke(engine, 'grant-ops-aws')
    const before = engine.getSnapshot()
    expect(before.policyVersion).toBe(2)
    await expect(engine.command(command())).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    expect(engine.getSnapshot()).toEqual(before)
  })

  it('rechecks payload scope before replay even while the pool grant remains', async () => {
    const engine = createEngine(seed(), () => undefined)
    const patch = command({ body: { expectedVersion: 1, visibilityProjectIds: ['project-store'] } })
    await engine.command(patch)
    await revoke(engine, 'grant-ops-store')
    await expect(engine.command(patch)).rejects.toMatchObject({ status: 403 })
  })

  it('retains revocation replay while rejecting self-revocation', async () => {
    const engine = createEngine(seed(), () => undefined)
    const receipt = await revoke(engine, 'grant-rd-data')
    expect(await revoke(engine, 'grant-rd-data')).toEqual(receipt)
    await expect(revoke(engine, 'grant-admin')).rejects.toMatchObject({ status: 403, code: 'SELF_MODIFICATION_DENIED' })
    expect((read(engine, '/cis', 'user-rd-data') as Page<CI>).total).toBe(0)
    expect(engine.getSnapshot().commandCount).toBe(1)
  })

  it('preserves every counter/entity when persistence fails and allows the same key retry', async () => {
    let failPersistence = true
    const writes: Snapshot[] = []
    const engine = createEngine(seed(), (next) => { if (failPersistence) throw new Error('quota'); writes.push(next) })
    const before = engine.getSnapshot()
    await expect(engine.command(command())).rejects.toMatchObject({ status: 507, code: 'DEMO_STORAGE_FULL' })
    expect(engine.getSnapshot()).toEqual(before)
    failPersistence = false
    const result = await engine.command(command())
    expect(result.entityVersion).toBe(2)
    expect(writes).toHaveLength(1)
    expect(engine.getSnapshot().sequence).toBe(1)
  })

  it.each([[409, 'STALE_GENERATION'], [429, 'DEMO_COMMAND_LIMIT']] as const)('preserves a controller guard rejection (%i) without committing domain state', async (status, code) => {
    const initial = seed()
    const engine = createEngine(initial, () => { throw new DomainError(status, code, 'Controller guard') })
    await expect(engine.command(command())).rejects.toMatchObject({ status, code })
    expect(engine.getSnapshot()).toEqual(initial)
  })

  it('does not share mutable state with initial inputs, read outputs, persistence or command callers', async () => {
    const initial = seed()
    const engine = createEngine(initial, (next) => { next.logicalClock = 500 })
    initial.entities.cis[0].name = 'outside-mutation'
    const view = read(engine, '/cis/ci-aws-checkout-01', 'user-ops') as CI
    view.name = 'outside-read'
    const copy = engine.getSnapshot()
    copy.entities.cis[0].version = 100
    const input = command()
    const result = engine.command(input)
    input.body = { expectedVersion: 1, name: 'outside-command' }
    await result
    expect(engine.getSnapshot().entities.cis[0]).toMatchObject({ version: 2, name: 'updated-demo' })
    expect(engine.getSnapshot().logicalClock).toBe(0)
  })

  it('advances deterministic logical time without invented workflow jobs', async () => {
    const engine = createEngine(seed(), () => undefined)
    await engine.command(command({ actorId: 'user-rd-commerce', method: 'POST', path: '/clock/advance', body: { ticks: 10 } }))
    expect(read(engine, '/guide')).toMatchObject({ logicalClock: 10, commandCount: 1, pendingTasks: 0 })
    expect((read(engine, '/dashboard', 'user-rd-commerce', 'center=rd') as DashboardView).dataAsOf).toBe('2026-09-20T09:00:10.000Z')
    expect(engine.getSnapshot().jobs).toEqual([])
  })

  it.each([
    [{ actorId: 'user-rd-commerce' }, 403],
    [{ actorId: 'user-admin' }, 403],
    [{ sessionId: 'another-session' }, 401],
    [{ body: { expectedVersion: 1, health: 'healthy' } }, 422],
    [{ body: { expectedVersion: 1, accountId: 'another-account' } }, 422],
    [{ body: { expectedVersion: 1, customFields: { shell: 'not-a-field' } } }, 422],
    [{ method: 'POST', path: '/pipelines', body: {} }, 501],
    [{ method: 'POST', path: '/clock/advance', body: { ticks: 61 } }, 422],
  ] as [Partial<CommandInput>, number][])('rejects unauthorized/invalid/unavailable commands atomically: %j', async (overrides, status) => {
    const engine = createEngine(seed(), () => undefined)
    const before = engine.getSnapshot()
    await expect(engine.command(command(overrides))).rejects.toMatchObject({ status })
    expect(engine.getSnapshot()).toEqual(before)
  })

  it('does not remove visibility required by an existing shared placement', async () => {
    const engine = createEngine(seed(), () => undefined)
    await expect(engine.command(command({ path: '/cis/ci-idc-redis-01', body: { expectedVersion: 1, visibilityProjectIds: ['project-store'] } }))).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' })
    expect(engine.getSnapshot().commandCount).toBe(0)
  })

  it('validates custom-field definitions and constraints without changing core identity', async () => {
    const initial = seed()
    initial.entities.modelFields.push({ id: 'field-label', orgId: 'org-demo', version: 1, createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T09:00:00Z', kind: 'compute', key: 'costLabel', label: 'Cost label', valueType: 'string', required: false, hidden: false, constraints: { maxLength: 12, enum: ['demo', 'internal'] } })
    const engine = createEngine(initial, () => undefined)
    await expect(engine.command(command({ body: { expectedVersion: 1, customFields: { costLabel: 'invalid' } } }))).rejects.toMatchObject({ status: 422 })
    expect(engine.getSnapshot().commandCount).toBe(0)
    await engine.command(command({ body: { expectedVersion: 1, customFields: { costLabel: 'demo' } } }))
    expect(engine.getSnapshot().entities.cis[0]).toMatchObject({ externalId: 'i-demo-checkout-01', customFields: { costLabel: 'demo' } })
  })

  it('enforces command and serialized-byte limits without dropping old evidence', async () => {
    const full = seed()
    full.commandCount = 1000
    const capped = createEngine(full, () => undefined)
    await expect(capped.command(command())).rejects.toMatchObject({ status: 429, code: 'DEMO_COMMAND_LIMIT' })
    expect(capped.getSnapshot()).toEqual(full)
    const large = seed()
    large.scenarioFlags.padding = '測'.repeat(1024 * 1024)
    const persist = vi.fn()
    const tooLarge = createEngine(large, persist)
    await expect(tooLarge.command(command())).rejects.toMatchObject({ status: 507, code: 'DEMO_STORAGE_FULL' })
    expect(persist).not.toHaveBeenCalled()
    expect(tooLarge.getSnapshot()).toEqual(large)
  })

  it('allows authorized replay at the command limit', async () => {
    const first = createEngine(seed(), () => undefined)
    const receipt = await first.command(command())
    const full = first.getSnapshot()
    full.commandCount = 1000
    const resumed = createEngine(full, () => undefined)
    expect(await resumed.command(command())).toEqual(receipt)
    expect(resumed.getSnapshot().commandCount).toBe(1000)
  })

  it('a failed validation does not poison the command queue', async () => {
    const engine = createEngine(seed(), () => undefined)
    await expect(engine.command(command({ body: { expectedVersion: 0, name: 'invalid' } }))).rejects.toMatchObject({ status: 422 })
    expect((await engine.command(command())).entityVersion).toBe(2)
  })
})

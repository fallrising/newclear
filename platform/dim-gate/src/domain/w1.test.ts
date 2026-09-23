import { describe, expect, it } from 'vitest'
import { createSeed } from '../demo/seed'
import { canAccessRoute, routeForPath } from '../app/routes/registry'
import { createEngine } from './engine'
import { dashboardViewSchema, snapshotSchema, type Center, type Snapshot, type WorkspaceHome, type WorkspaceHomeSection } from './schemas'
import { observationTime } from './observation'

const rd = 'user-rd-commerce', ops = 'user-ops', admin = 'user-admin'
function harness(initial = createSeed('w1-domain')) {
  const engine = createEngine(initial, () => undefined)
  let sequence = 0
  const command = (path: string, body: unknown, actorId = rd, method = 'POST') => engine.command({
    sessionId: initial.sessionId, actorId, method, path, body, key: `w1-${++sequence}`,
  })
  const dashboard = (center: Center = 'rd', actorId = rd, filters = '') => dashboardViewSchema.parse(engine.read('/dashboard', new URLSearchParams(`center=${center}${filters ? `&${filters}` : ''}`), actorId))
  const home = <K extends Center>(kind: K, actor = kind === 'rd' ? rd : kind === 'ops' ? ops : admin, filters = '') => dashboard(kind, actor, filters).workspace as Extract<WorkspaceHome, { kind: K }>
  const advance = (ticks = 6) => command('/clock/advance', { ticks }, ops)
  const request = (name: string, extra = {}, actor = rd) => command('/requests', {
    applicationId: 'app-checkout', environmentName: name, stage: 'staging', catalogItemId: 'catalog-web', catalogRevision: 1,
    provider: 'aws', poolId: 'pool-aws-sg', cpu: 2, memoryMiB: 2048, purpose: 'W1 projection verification', ...extra,
  }, actor)
  const pipeline = (environmentId = 'env-checkout-dev', actor = rd) => {
    const env = engine.getSnapshot().entities.environments.find(e => e.id === environmentId)!
    return command('/pipelines', { applicationId: env.applicationId, environmentId, environmentVersion: env.version, revision: `revision-${sequence}` }, actor)
  }
  return { engine, command, dashboard, home, advance, request, pipeline }
}
const sections = (workspace: WorkspaceHome) => Object.values(workspace).filter((value): value is WorkspaceHomeSection => typeof value !== 'string')
const emptyData = (value: ReturnType<ReturnType<typeof harness>['dashboard']>) => {
  expect(value).toMatchObject({ applicationCount: 0, environmentCount: 0, ciCount: 0, activeIncidentCount: 0, pendingItems: [] })
  expect(value.providers.every(p => p.count === 0)).toBe(true)
  for (const part of sections(value.workspace)) expect(part).toMatchObject({ total: 0, items: [] })
}

describe('W1 canonical workspace home projections', () => {
  it('loads the unchanged v0.1 snapshot and projects distinct authorized homes without writes', () => {
    const initial = createSeed('w1-domain'), bytes = JSON.stringify(initial), h = harness(initial)
    const rdHome = h.home('rd'), opsHome = h.home('ops'), adminHome = h.home('admin')
    expect(rdHome.services.total).toBe(6)
    expect(rdHome.services.items.every(item => item.state === 'unknown')).toBe(true)
    expect(rdHome.work.total).toBe(6); expect(rdHome.deliveries.total).toBe(0)
    expect(opsHome.capacity.total).toBe(3); expect(opsHome.approvals.total).toBe(0)
    expect(adminHome.drafts.total).toBe(0); expect(adminHome.integrations.total).toBe(5); expect(adminHome.accessChanges.total).toBe(0)
    expect(JSON.stringify(h.dashboard())).not.toContain('data-worker')
    expect(JSON.stringify(h.dashboard())).not.toContain('env-data-dev')
    expect(JSON.stringify(h.engine.getSnapshot())).toBe(bytes)
    expect(JSON.stringify(snapshotSchema.parse(JSON.parse(bytes)))).toBe(bytes)
  })

  it.each([
    ['rd', rd, 'projectId=project-data'], ['rd', rd, 'environmentId=env-data-dev'],
    ['rd', rd, 'projectId=project-store&environmentId=env-payments-dev'],
    ['ops', ops, 'provider=aws&poolId=pool-idc-sg'], ['ops', ops, 'poolId=not-visible'],
    ['admin', admin, 'projectId=does-not-exist'],
  ] as const)('empties every data section/count for %s foreign or mismatched scope %s %s', (center, actor, query) => {
    emptyData(harness().dashboard(center, actor, query))
  })

  it.each(['unknown=x', 'provider=gcp', 'poolId=', 'projectId=one&projectId=two', 'center=other', 'environmentId='])('rejects unknown, duplicate or invalid query %s', query => {
    const h = harness()
    expect(() => h.engine.read('/dashboard', new URLSearchParams(`center=ops&${query}`), ops)).toThrow(expect.objectContaining({ status: 422 }))
  })

  it('rejects unsupported non-Ops filters and unauthorized workspaces', () => {
    const h = harness()
    expect(() => h.dashboard('rd', rd, 'provider=aws')).toThrow(expect.objectContaining({ status: 422 }))
    expect(() => h.dashboard('admin', admin, 'poolId=pool-aws-sg')).toThrow(expect.objectContaining({ status: 422 }))
    expect(() => h.dashboard('ops', rd)).toThrow(expect.objectContaining({ status: 403 }))
    expect(() => h.dashboard('rd', admin)).toThrow(expect.objectContaining({ status: 403 }))
  })

  it('filters options and existing resources by project, environment, provider and pool before counting', () => {
    const h = harness(), result = h.dashboard('ops', ops, 'projectId=project-store&environmentId=env-checkout-dev&provider=onprem&poolId=pool-idc-sg')
    expect(result.scope.filters).toEqual({ projectId: 'project-store', environmentId: 'env-checkout-dev', provider: 'onprem', poolId: 'pool-idc-sg' })
    expect(result.scope.environments).toHaveLength(4)
    expect(result.scope.environments.every(e => ['app-checkout', 'app-storefront'].includes(e.applicationId))).toBe(true)
    expect(result.scope.pools.map(p => p.id)).toEqual(['pool-idc-sg'])
    expect(result).toMatchObject({ applicationCount: 1, environmentCount: 1, ciCount: 2 })
    expect(h.home('ops', ops, 'environmentId=env-checkout-dev&provider=aliyun').capacity.total).toBe(0)
    emptyData(h.dashboard('ops', ops, 'environmentId=env-checkout-dev&provider=aliyun'))
  })

  it('uses latest actual observation samples, treats nulls as unknown and stale samples never healthy', () => {
    const s = createSeed('w1-domain'); s.logicalClock = 120
    s.observations.buckets = [
      { id: 'old', applicationId: 'app-checkout', environmentId: 'env-checkout-dev', from: observationTime(0), to: observationTime(60), rate: 10, errorRate: 0.1, p95Latency: 900, source: 'demo' },
      { id: 'latest', applicationId: 'app-checkout', environmentId: 'env-checkout-dev', from: observationTime(60), to: observationTime(120), rate: 10, errorRate: 0.01, p95Latency: 100, source: 'demo' },
    ]
    const service = (snapshot: Snapshot) => harness(snapshot).home('rd').services.items.find(i => i.sourceId === 'env-checkout-dev')!
    expect(service(s)).toMatchObject({ state: 'healthy', dataAsOf: observationTime(120) })
    s.observations.buckets[1].errorRate = null
    expect(service(s).state).toBe('unknown')
    s.observations.buckets[1].errorRate = 0.01; s.logicalClock = 421
    expect(service(s).state).toBe('stale')
  })

  it('projects request targets before provisioning and removes unlinked requests under an environment filter', async () => {
    const h = harness(), created = await h.request('new-staging')
    expect(h.home('rd').work.items).toContainEqual(expect.objectContaining({ sourceId: created.entityId, state: 'draft' }))
    expect(h.home('ops').approvals.total).toBe(0)
    await h.command(`/requests/${created.entityId}/submit`, { expectedVersion: 1 })
    expect(h.home('ops', ops, 'provider=aws&poolId=pool-aws-sg').approvals.items).toContainEqual(expect.objectContaining({ sourceId: created.entityId, state: 'submitted' }))
    expect(h.home('ops', ops, 'provider=aliyun').approvals.total).toBe(0)
    expect(h.home('ops', ops, 'environmentId=env-checkout-dev').approvals.total).toBe(0)
    const approved = await h.command(`/requests/${created.entityId}/approve`, { expectedVersion: 2, reason: 'Approve target' }, ops)
    expect(h.home('ops').approvals.items).toContainEqual(expect.objectContaining({ sourceId: created.entityId, state: 'approved' }))
    await h.command('/scenarios', { scenarioKey: 'provision-failure', jobId: approved.operationId }, ops)
    await h.command(`/requests/${created.entityId}/provision`, { expectedVersion: 3 }, ops); await h.advance(3)
    expect(h.home('ops').failures.items).toContainEqual(expect.objectContaining({ sourceType: 'job', sourceId: approved.operationId, state: 'failed' }))
    expect(h.home('rd').work.items).toContainEqual(expect.objectContaining({ sourceId: created.entityId, state: 'failed' }))
  })

  it('filters mine across different authorized requesters and release creators without changing services or snapshot', async () => {
    const h = harness(), other = 'user-rd-data'
    await h.command('/admin/assignments', { userId: other, role: 'rd', scopeType: 'project', scopeId: 'project-store', reason: 'Shared project requester' }, admin)
    const mine = await h.request('own-work'), theirs = await h.request('team-work', {}, other)
    await h.pipeline('env-checkout-dev', other); await h.advance()
    await h.pipeline(); await h.advance()
    await h.pipeline('env-checkout-prod', other); await h.advance(3)
    const before = JSON.stringify(h.engine.getSnapshot())
    const all = h.home('rd', rd, 'projectId=project-store'), own = h.home('rd', rd, 'projectId=project-store&workOwner=mine')
    expect(all.work.items.map(i => i.sourceId)).toEqual(expect.arrayContaining([mine.entityId, theirs.entityId]))
    expect(own.work.items.filter(i => i.sourceType === 'request').map(i => i.sourceId)).toEqual([mine.entityId])
    expect(own.work.items.filter(i => ['pipelineDefinition','serviceConfig'].includes(i.sourceType))).toHaveLength(4)
    expect(all.deliveries.total).toBe(2); expect(own.deliveries.total).toBe(1)
    const ownRelease = h.engine.getSnapshot().entities.releases.find(r => r.id === own.deliveries.items[0].sourceId)!
    expect(ownRelease.createdBy).toBe(rd)
    expect(own.services).toEqual(all.services)
    expect(h.home('rd', rd, 'projectId=project-store&workOwner=all')).toEqual(all)
    const otherHome = h.home('rd', other, 'projectId=project-store&workOwner=mine')
    expect(otherHome.work.items.map(i => i.sourceId)).toContain(theirs.entityId)
    expect(otherHome.work.items.some(i => i.sourceType === 'release' && i.state === 'pending_approval')).toBe(true)
    expect(otherHome.work.items.map(i => i.sourceId)).not.toContain(mine.entityId)
    expect(JSON.stringify(h.engine.getSnapshot())).toBe(before)
  })

  it.each([['rd', rd, 'workOwner=someone'], ['ops', ops, 'workOwner=mine'], ['admin', admin, 'workOwner=all']] as const)('rejects invalid or unsupported work-owner scope %s %s %s', (center, actor, query) => {
    expect(() => harness().dashboard(center, actor, query)).toThrow(expect.objectContaining({ status: 422 }))
  })

  it('uses actual pending/terminal releases and shows incidents without logs or trace payloads', async () => {
    const h = harness(); await h.pipeline(); await h.advance()
    const release = h.engine.getSnapshot().entities.releases[0]
    expect(h.home('rd').deliveries.items).toContainEqual(expect.objectContaining({ sourceId: release.id, state: 'succeeded' }))
    expect(h.home('rd').services.items.find(i => i.sourceId === 'env-checkout-dev')?.detail).toContain(release.id)
    await h.command('/scenarios', { scenarioKey: 'post-release-latency', environmentId: 'env-checkout-dev' })
    const incident = h.engine.getSnapshot().entities.incidents[0]
    expect(h.home('ops').incidents.items[0]).toMatchObject({ sourceId: incident.id, state: 'open' })
    expect(h.home('ops', ops, 'provider=aliyun').incidents.total).toBe(0)
    const serialized = JSON.stringify(h.home('ops'))
    expect(serialized).not.toContain(incident.evidence[0].traceIds[0])
    expect(serialized).not.toContain(h.engine.getSnapshot().observations.logs[0].message)
    await h.pipeline('env-checkout-prod'); await h.advance(3)
    expect(h.home('ops').approvals.items.some(i => i.sourceType === 'release' && i.state === 'pending_approval')).toBe(true)
    expect(h.home('rd').work.items.some(i => i.sourceType === 'release' && i.state === 'pending_approval')).toBe(true)
  })

  it('requires project/stage plus pool and non-self scope for actionable approvals, even with multiple workspace grants', async () => {
    const h = harness()
    await h.command('/admin/assignments', { userId: rd, role: 'ops', scopeType: 'project', scopeId: 'project-store', reason: 'W1 multiple workspaces' }, admin)
    await h.command('/admin/assignments', { userId: rd, role: 'ops', scopeType: 'pool', scopeId: 'pool-aws-sg', reason: 'W1 pool access' }, admin)
    const created = await h.request('self-created'); await h.command(`/requests/${created.entityId}/submit`, { expectedVersion: 1 })
    await h.pipeline('env-checkout-prod'); await h.advance(3)
    expect(h.home('ops', rd).approvals.total).toBe(0)
    expect(h.home('ops').approvals.total).toBe(2)
    await h.command('/admin/assignments/grant-ops-aws', { expectedVersion: 1, reason: 'Remove pool access' }, admin, 'DELETE')
    expect(h.home('ops').approvals.items.some(i => i.sourceType === 'request')).toBe(false)
    await h.command('/admin/assignments/grant-ops-store', { expectedVersion: 1, reason: 'Remove project access' }, admin, 'DELETE')
    expect(h.home('ops').approvals.total).toBe(0)
  })

  it('keeps incident and release work visible to project-only Ops while requests still require a pool grant', async () => {
    const h = harness(), request = await h.request('pool-required')
    await h.command(`/requests/${request.entityId}/submit`, { expectedVersion: 1 })
    await h.pipeline(); await h.advance()
    await h.command('/scenarios', { scenarioKey: 'post-release-latency', environmentId: 'env-checkout-dev' })
    await h.pipeline('env-checkout-prod'); await h.advance(3)
    for (const grant of h.engine.getSnapshot().entities.assignments.filter(a => a.userId === ops && a.scopeType === 'pool')) {
      await h.command(`/admin/assignments/${grant.id}`, { expectedVersion: grant.version, reason: 'Project-only operations' }, admin, 'DELETE')
    }
    const home = h.home('ops')
    expect(home.incidents.total).toBe(1)
    expect(home.approvals.items.map(i => i.sourceType)).toEqual(['release'])
    expect(home.capacity.total).toBe(0)
    expect(h.home('ops', ops, 'provider=aws').incidents.total).toBe(1)
    expect(h.home('ops', ops, 'provider=aliyun').incidents.total).toBe(0)
    expect(h.home('ops', ops, 'provider=aliyun').approvals.total).toBe(0)
  })

  it('shows physical capacity once while withholding every hidden consumer name and count from pool-only Ops', async () => {
    const h = harness(); await h.pipeline('env-data-dev', 'user-rd-data'); await h.advance()
    await h.command('/scenarios', { scenarioKey: 'post-release-latency', environmentId: 'env-data-dev' }, 'user-rd-data')
    for (const grant of h.engine.getSnapshot().entities.assignments.filter(a => a.userId === ops && a.scopeType === 'project')) {
      await h.command(`/admin/assignments/${grant.id}`, { expectedVersion: grant.version, reason: 'Pool-only review' }, admin, 'DELETE')
    }
    const value = h.dashboard('ops', ops, 'provider=onprem&poolId=pool-idc-sg'), home = h.home('ops', ops, 'poolId=pool-idc-sg')
    expect(value).toMatchObject({ applicationCount: 0, environmentCount: 0, activeIncidentCount: 0, pendingItems: [] })
    expect(value.scope.projects).toEqual([]); expect(value.scope.environments).toEqual([])
    expect(home.capacity.total).toBe(1); expect(home.incidents.total).toBe(0); expect(home.approvals.total).toBe(0)
    expect(JSON.stringify(value)).not.toContain('data-worker'); expect(JSON.stringify(value)).not.toContain('env-data-dev')
    const usage = h.engine.read('/capacity', new URLSearchParams('provider=onprem'), ops) as Array<{ cpu: { used: number } }>
    expect(home.capacity.items[0].detail).toContain(`CPU ${usage[0].cpu.used} used`)
  })

  it('projects only real Admin drafts/access events and safe integration metadata, with scoped attribution', async () => {
    const h = harness(), catalog = h.engine.getSnapshot().entities.catalogs[0]
    await h.command('/admin/catalog/catalog-web/revisions', { expectedVersion: catalog.version, baseRevision: catalog.revision,
      reason: 'Draft for Store', name: catalog.name, description: catalog.description, allowedProjectIds: ['project-store'], template: catalog.template }, admin)
    const assignment = await h.command('/admin/assignments', { userId: rd, role: 'ops', scopeType: 'project', scopeId: 'project-store', stages: ['dev'], reason: 'Private reason never projected' }, admin)
    const home = h.home('admin')
    expect(home.drafts.items[0]).toMatchObject({ sourceType: 'catalogItem', sourceId: catalog.id, state: 'draft', detail: 'revision: 2' })
    expect(home.accessChanges.total).toBe(1)
    expect(home.accessChanges.items[0].detail).toContain(assignment.entityId)
    expect(JSON.stringify(home)).not.toContain('Private reason never projected')
    expect(JSON.stringify(home)).not.toContain('fieldMappings')
    expect(h.home('admin', admin, 'projectId=project-data').drafts.total).toBe(0)
    expect(h.home('admin', admin, 'projectId=project-data').accessChanges.total).toBe(0)
    expect(h.home('admin', admin, 'environmentId=env-checkout-dev').accessChanges.total).toBe(1)
    expect(h.home('admin', admin, 'environmentId=env-checkout-prod').accessChanges.total).toBe(0)
    await expect(h.pipeline('env-checkout-dev', admin)).rejects.toMatchObject({ status: 403 })
  })

  it('returns bounded deterministic items, exact totals and only registered permitted drilldowns', () => {
    const initial = createSeed('w1-domain'); initial.entities.cis.forEach(ci => { ci.observedAt = null })
    const h = harness(initial), home = h.home('ops')
    expect(home.staleness.total).toBe(63); expect(home.staleness.items).toHaveLength(20)
    expect(home.staleness.items.map(i => i.sourceId)).toEqual(initial.entities.cis.map(ci => ci.id).sort().slice(0, 20))
    for (const [center, actor] of [['rd', rd], ['ops', ops], ['admin', admin]] as const) {
      const session = h.engine.read('/session', new URLSearchParams(), actor) as Parameters<typeof canAccessRoute>[0]
      for (const part of sections(h.home(center, actor))) for (const item of part.items) {
        const route = routeForPath(item.route.split('?')[0]); expect(route).toBeDefined(); expect(canAccessRoute(session, route!)).toBe(true)
      }
    }
    expect(h.home('ops')).toEqual(home)
  })

  it('reloads active jobs, receipts and audit unchanged while deriving all homes', async () => {
    const h = harness(), created = await h.request('reload-running')
    await h.command(`/requests/${created.entityId}/submit`, { expectedVersion: 1 })
    await h.command(`/requests/${created.entityId}/approve`, { expectedVersion: 2, reason: 'Approve reload' }, ops)
    await h.command(`/requests/${created.entityId}/provision`, { expectedVersion: 3 }, ops)
    const saved = h.engine.getSnapshot(), bytes = JSON.stringify(saved), restored = harness(JSON.parse(bytes))
    expect(saved.jobs[0].state).toBe('running')
    for (const center of ['rd', 'ops', 'admin'] as const) restored.home(center)
    expect(JSON.stringify(restored.engine.getSnapshot())).toBe(bytes)
    expect(restored.engine.getSnapshot().idempotency).toHaveLength(4)
    expect(restored.engine.getSnapshot().audit).toHaveLength(4)
  })

  it('revokes the last workspace via Admin commands without mutating the stored data on denied reads', async () => {
    const h = harness()
    for (const grant of h.engine.getSnapshot().entities.assignments.filter(a => a.userId === rd)) {
      await h.command(`/admin/assignments/${grant.id}`, { expectedVersion: grant.version, reason: 'Zero workspace scenario' }, admin, 'DELETE')
    }
    const before = JSON.stringify(h.engine.getSnapshot())
    for (const center of ['rd', 'ops', 'admin'] as const) expect(() => h.dashboard(center)).toThrow(expect.objectContaining({ status: 403 }))
    expect(JSON.stringify(h.engine.getSnapshot())).toBe(before)
  })
})

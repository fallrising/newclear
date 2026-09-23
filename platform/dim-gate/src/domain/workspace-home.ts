import { breached, healthy, observationTime } from './observation'
import { notifications, visibleIntegrations } from './observation-views'
import type { Policy } from './policy'
import type { Center, DashboardFilters, DashboardView, Request, Release, Snapshot, WorkspaceHome, WorkspaceHomeItem, WorkspaceHomeSection } from './schemas'

type Capacity = { cpu: { used: number; reserved: number; available: number }; memoryMiB: { used: number; reserved: number; available: number } }
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id)
const recent = (a: WorkspaceHomeItem, b: WorkspaceHomeItem) => b.dataAsOf.localeCompare(a.dataAsOf) || a.sourceId.localeCompare(b.sourceId)
const section = (title: string, items: WorkspaceHomeItem[]): WorkspaceHomeSection => ({ title, total: items.length, items: items.slice(0, 20) })
const encoded = encodeURIComponent

/** Read-only projections of the canonical store; no workspace state enters the snapshot. */
export function workspaceDashboard(s: Snapshot, policy: Policy, center: Center, filters: DashboardFilters,
  capacityFor: (poolId: string) => Capacity): DashboardView {
  const { projectId, environmentId, provider, poolId } = filters
  const now = observationTime(s.logicalClock), nowMs = Date.parse(now)
  const freshness = (observedAt: string | null, maxAge = 86_400_000) => !observedAt ? 'unknown'
    : nowMs - Date.parse(observedAt) > maxAge ? 'stale' : 'fresh'
  const allApps = s.entities.applications.filter(a => a.orgId === policy.user?.orgId && policy.hasProject(a.projectId))
  const appById = new Map(allApps.map(a => [a.id, a]))
  const projects = s.entities.projects.filter(p => p.orgId === policy.user?.orgId && policy.hasProject(p.id)).toSorted(byId)
  const environments = s.entities.environments.filter(e => policy.canReadEnvironment(e) && appById.has(e.applicationId)
    && (!projectId || appById.get(e.applicationId)!.projectId === projectId)).toSorted(byId)
  const authorizedPools = s.entities.pools.filter(p => p.orgId === policy.user?.orgId && (policy.admin || policy.poolIds.includes(p.id))).toSorted(byId)
  const poolOptions = center === 'ops' ? authorizedPools.filter(p => !provider || p.provider === provider) : []
  const valid = (!projectId || projects.some(p => p.id === projectId)) && (!environmentId || environments.some(e => e.id === environmentId))
    && (!poolId || poolOptions.some(p => p.id === poolId))
  const resourceMatch = (ci: Snapshot['entities']['cis'][number]) => policy.canReadCi(ci) && (!provider || ci.provider === provider) && (!poolId || ci.poolId === poolId)
  const selectedCiIds = new Set(s.entities.cis.filter(resourceMatch).map(ci => ci.id))
  const linkedToSelection = (id: string) => s.entities.placements.some(p => p.environmentId === id && selectedCiIds.has(p.ciId))
  const scopedEnvs = environments.filter(e => valid && (!environmentId || e.id === environmentId) && (!(provider || poolId) || linkedToSelection(e.id)))
  const envIds = new Set(scopedEnvs.map(e => e.id))
  const apps = allApps.filter(a => valid && (!projectId || a.projectId === projectId)
    && (!(environmentId || provider || poolId) || scopedEnvs.some(e => e.applicationId === a.id)))
  const appIds = new Set(apps.map(a => a.id))
  const cis = s.entities.cis.filter(ci => valid && resourceMatch(ci) && (!projectId || ci.visibilityProjectIds.includes(projectId))
    && (!environmentId || envIds.has(environmentId) && s.entities.placements.some(p => p.environmentId === environmentId && p.ciId === ci.id)))
  const requests = s.entities.requests.filter(r => valid && policy.canReadRequest(r) && appById.has(r.applicationId)
    && (!projectId || appById.get(r.applicationId)!.projectId === projectId)
    && (!environmentId || r.environmentId === environmentId && envIds.has(environmentId))
    && (!provider || r.provider === provider) && (!poolId || r.poolId === poolId))
  const releases = s.entities.releases.filter(r => envIds.has(r.environmentId))
  const incidents = s.entities.incidents.filter(i => envIds.has(i.environmentId) && i.state !== 'resolved')
  const envLabel = (id: string) => {
    const env = scopedEnvs.find(e => e.id === id)!
    return `${appById.get(env.applicationId)!.name} · ${env.name}`
  }
  const requestItem = (r: Request): WorkspaceHomeItem => ({ sourceType: 'request', sourceId: r.id,
    title: `${appById.get(r.applicationId)!.name} · ${r.environmentName}`, state: r.state,
    route: `/${center === 'ops' ? 'ops' : 'rd'}/requests/${encoded(r.id)}`, dataAsOf: r.updatedAt,
    detail: `${r.stage} · ${r.provider} · ${r.cpu} CPU / ${r.memoryMiB} MiB` })
  const releaseItem = (r: Release): WorkspaceHomeItem => ({ sourceType: 'release', sourceId: r.id, title: envLabel(r.environmentId),
    state: r.state, route: `/${center === 'ops' ? 'ops' : 'rd'}/releases/${encoded(r.id)}`, dataAsOf: r.updatedAt,
    detail: `${r.kind} · ${r.id} · health: ${r.health}` })
  let workspace: WorkspaceHome
  if (center === 'rd') {
    const ownRequests = requests.filter(r => filters.workOwner !== 'mine' || r.requesterId === policy.user?.id)
    const ownReleases = releases.filter(r => filters.workOwner !== 'mine' || r.createdBy === policy.user?.id)
    workspace = {
      kind: 'rd', services: section('服務健康與環境', scopedEnvs.map(env => {
        const latest = s.observations.buckets.filter(b => b.environmentId === env.id && b.applicationId === env.applicationId && Date.parse(b.to) <= nowMs)
          .toSorted((a, b) => b.to.localeCompare(a.to) || a.id.localeCompare(b.id))[0]
        const age = freshness(latest?.to ?? null, 300_000)
        const state = age === 'stale' ? 'stale' : !latest || age === 'unknown' ? 'unknown' : breached(latest) ? 'unhealthy' : healthy(latest) && latest.rate !== null ? 'healthy' : 'unknown'
        const active = releases.find(r => r.id === env.activeReleaseId)
        return { sourceType: 'environment', sourceId: env.id, title: envLabel(env.id), state,
          route: `/rd/apps/${encoded(env.applicationId)}/environments/${encoded(env.id)}`, dataAsOf: latest?.to ?? now,
          detail: `${env.applicationId} · ${env.stage} · ${env.status} · ${active ? `${active.id}: ${active.state}` : '尚無已部署版本'} · observation: ${age}` }
      })),
      work: section('待處理申請與發布', [...ownRequests.filter(r => ['draft', 'submitted', 'approved', 'failed'].includes(r.state)).map(requestItem),
        ...ownReleases.filter(r => ['pending_approval', 'queued', 'deploying', 'verifying'].includes(r.state)).map(releaseItem)].toSorted(recent)),
      deliveries: section('近期交付', ownReleases.filter(r => ['succeeded', 'failed', 'rejected', 'cancelled'].includes(r.state)).map(releaseItem).toSorted(recent)),
    }
  } else if (center === 'ops') {
    const opsEnvironment = (id: string) => {
      const env = scopedEnvs.find(e => e.id === id)
      return !!env && policy.hasProject(appById.get(env.applicationId)!.projectId, env.stage, 'ops')
    }
    const actionableRequests = requests.filter(r => policy.canOperateRequest(r) && ['submitted', 'approved'].includes(r.state))
    const actionableReleases = releases.filter(r => r.state === 'pending_approval' && r.createdBy !== policy.user?.id && opsEnvironment(r.environmentId))
    const failures = s.jobs.flatMap(job => {
      const request = requests.find(r => r.id === job.requestId && policy.canReadJob(r))
      if (job.state !== 'failed' || !request || !policy.poolIds.includes(request.poolId)) return []
      return [{ sourceType: 'job' as const, sourceId: job.id, title: requestItem(request).title, state: job.state,
        route: `/ops/jobs/${encoded(job.id)}`, dataAsOf: job.updatedAt, detail: `attempt: ${job.attempt} · ${job.failureCode ?? 'failed'}` }]
    })
    const pools = authorizedPools.filter(p => valid && (!provider || p.provider === provider) && (!poolId || p.id === poolId)
      && (!projectId || p.scopeProjectIds.includes(projectId)) && (!environmentId || cis.some(ci => ci.poolId === p.id)))
    workspace = {
      kind: 'ops', incidents: section('優先事件', incidents.filter(i => opsEnvironment(i.environmentId))
        .toSorted((a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical') || Number(b.state === 'open') - Number(a.state === 'open') || a.updatedAt.localeCompare(b.updatedAt) || byId(a, b))
        .map(i => ({ sourceType: 'incident', sourceId: i.id, title: envLabel(i.environmentId), state: i.state,
          route: `/ops/incidents/${encoded(i.id)}`, dataAsOf: i.updatedAt, detail: `${i.severity} · ${i.ruleKey}` }))),
      failures: section('失敗作業與發布', [...failures, ...releases.filter(r => r.state === 'failed' && opsEnvironment(r.environmentId)).map(releaseItem)].toSorted(recent)),
      approvals: section('待審批與交付', [...actionableRequests.map(requestItem), ...actionableReleases.map(releaseItem)].toSorted(recent)),
      capacity: section('實體資源池容量', pools.map(p => {
        const usage = capacityFor(p.id)
        return { sourceType: 'pool', sourceId: p.id, title: p.name, state: usage.cpu.available === 0 || usage.memoryMiB.available === 0 ? 'exhausted' : 'available',
          route: `/ops/capacity?provider=${p.provider}&poolId=${encoded(p.id)}`, dataAsOf: now,
          detail: `${p.provider} · CPU ${usage.cpu.used} used / ${usage.cpu.reserved} reserved / ${usage.cpu.available} available · MiB ${usage.memoryMiB.used} used / ${usage.memoryMiB.reserved} reserved / ${usage.memoryMiB.available} available` }
      })),
      staleness: section('資料過期或未知的 CI', cis.filter(ci => freshness(ci.observedAt) !== 'fresh').toSorted(byId).map(ci => ({
        sourceType: 'ci', sourceId: ci.id, title: ci.name, state: freshness(ci.observedAt), route: `/ops/cmdb/${encoded(ci.id)}`,
        dataAsOf: ci.observedAt ?? now, detail: `${ci.provider} · ${ci.kind} · ${ci.observedAt ? '觀測資料已過期' : '尚無觀測資料'}`,
      }))),
    }
  } else {
    const selectedProjects = new Set(apps.map(a => a.projectId))
    if (projectId && valid) selectedProjects.add(projectId)
    const scoped = !!(projectId || environmentId)
    const linkedPools = new Set(cis.map(ci => ci.poolId))
    const accessMatches = (event: Snapshot['audit'][number]) => {
      if (!scoped) return true
      // Legacy audit scope records the actor's grants, not the changed grant's target.
      // Attribute filtered rows only through a surviving canonical target assignment.
      return s.entities.assignments.some(a => (event.entityType === 'roleAssignment' ? a.id === event.entityId : a.userId === event.entityId)
        && a.scopeType === 'project' && selectedProjects.has(a.scopeId)
        && (!environmentId || !a.stages || a.stages.includes(scopedEnvs[0]!.stage)))
    }
    workspace = {
      kind: 'admin', drafts: section('待發布目錄草稿', s.entities.catalogs.filter(c => valid && c.orgId === policy.user?.orgId && c.status === 'draft'
        && (!scoped || c.allowedProjectIds.some(id => selectedProjects.has(id)))
        && (!environmentId || c.template.allowedStages.includes(scopedEnvs[0]!.stage))).toSorted(byId).map(c => ({
        sourceType: 'catalogItem', sourceId: c.id, title: c.name, state: c.status, route: `/admin/catalog?itemId=${encoded(c.id)}&revision=${c.revision}`,
        dataAsOf: c.updatedAt, detail: `revision: ${c.revision}`,
      }))),
      integrations: section('整合狀態', visibleIntegrations(s, policy).filter(i => valid && (!scoped || i.poolIds.some(id => linkedPools.has(id))))
        .map(i => ({ sourceType: 'integration' as const, sourceId: i.id, title: i.displayName,
          state: i.state === 'error' || i.lastTestResult?.succeeded === false ? 'error' : freshness(i.lastSyncAt),
          route: `/admin/integrations?integrationId=${encoded(i.id)}`, dataAsOf: i.lastSyncAt ?? i.updatedAt,
          detail: `${i.kind} · ${i.state} · sync: ${i.lastSyncAt ?? 'unknown'}${i.lastTestResult ? ` · demo test: ${i.lastTestResult.succeeded ? 'succeeded' : 'failed'}` : ''}` }))
        .toSorted((a, b) => Number(b.state === 'error') - Number(a.state === 'error') || a.sourceId.localeCompare(b.sourceId))),
      accessChanges: section('近期權限變更', s.audit.filter(a => valid && a.orgId === policy.user?.orgId && ['roleAssignment', 'user'].includes(a.entityType)
        && accessMatches(a))
        .map(a => ({ sourceType: 'auditEvent' as const, sourceId: a.id, title: a.action, state: a.outcome,
          route: `/admin/audit?entityType=${encoded(a.entityType)}&entityId=${encoded(a.entityId)}`, dataAsOf: a.occurredAt,
          detail: `${a.entityType} · ${a.entityId} · actor: ${a.actorId}` })).toSorted(recent)),
    }
  }
  const pendingIds = new Set([
    ...requests.filter(r => ['submitted', 'approved', 'failed'].includes(r.state)).map(r => `request:${r.id}`),
    ...releases.filter(r => r.state === 'pending_approval').map(r => `release:${r.id}`), ...incidents.map(i => `incident:${i.id}`),
  ])
  return {
    center, title: { rd: '研發中心', ops: '維運中心', admin: '平台管理' }[center], applicationCount: appIds.size,
    environmentCount: scopedEnvs.length, ciCount: cis.length, activeIncidentCount: incidents.length,
    providers: (['aws', 'aliyun', 'onprem'] as const).map(provider => ({ provider, count: cis.filter(ci => ci.provider === provider).length })),
    pendingItems: notifications(s, policy, s.events.length).filter(n => pendingIds.has(`${n.entityType}:${n.entityId}`))
      .filter((n, index, items) => items.findIndex(other => other.entityType === n.entityType && other.entityId === n.entityId) === index).slice(0, 20),
    dataAsOf: now, scope: { projects: projects.map(({ id, name }) => ({ id, name })),
      environments: environments.map(({ id, name, applicationId }) => ({ id, name, applicationId })),
      pools: poolOptions.map(({ id, name, provider }) => ({ id, name, provider })), filters: { ...filters } }, workspace,
  }
}

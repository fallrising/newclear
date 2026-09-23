import { centerSchema, dashboardQuerySchema, ciKindSchema, healthSchema, providerSchema, snapshotSchema,
  type AuditEvent, type CI, type CommandInput, type CommandReceipt, type GuideView, type Page, type ProvisionJob, type Snapshot,
} from './schemas'
import { clockIso, clone, fail, notFound, forbidden, parse, assertIntegrity, requestableCatalog, requestPoolUsage } from './engine-shared'
import { workspaceDashboard } from './workspace-home'
import { readResources, resourceRoute } from './resource-views'
import { resourcePolicy } from './resource-policy'
import { canReadObservation } from './observation'
import { guideProjection, readObservation, visibleIntegrations } from './observation-views'
import { policyFor, type Policy } from './policy'
import { DomainError } from './errors'
import { readDelivery, canReadDelivery } from './delivery'
export { DomainError } from './errors'

export interface Engine {
  getSnapshot(): Snapshot
  read(path: string, query: URLSearchParams, actorId: string): unknown
  command(input: CommandInput): Promise<CommandReceipt>
}

function validateQuery(query: URLSearchParams, allowed: string[]): void {
  const seen = new Set<string>()
  for (const key of query.keys()) {
    if (!allowed.includes(key) || seen.has(key)) throw new DomainError(422, 'VALIDATION_ERROR', '不支援的查詢欄位或重複欄位。', { [key]: ['Unknown or duplicate query parameter'] })
    seen.add(key)
    if (key !== 'q' && query.get(key) === '') throw new DomainError(422, 'VALIDATION_ERROR', '查詢欄位不可為空。', { [key]: ['Empty query parameter'] })
  }
  if ((query.get('q')?.length ?? 0) > 100) fail(422, 'VALIDATION_ERROR', '搜尋字串最多 100 字元。')
}

function pageValues(query: URLSearchParams): { page: number; pageSize: number } {
  const integer = (key: string, fallback: number, max: number) => {
    const value = query.get(key)
    if (value === null) return fallback
    if (!/^[1-9]\d*$/.test(value) || Number(value) > max) fail(422, 'VALIDATION_ERROR', `${key} 超出允許範圍。`)
    return Number(value)
  }
  return { page: integer('page', 1, Number.MAX_SAFE_INTEGER), pageSize: integer('pageSize', 25, 100) }
}

function basicPage<T>(items: T[], query: URLSearchParams): Page<T> {
  const { page, pageSize } = pageValues(query)
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }
}

function paged<T extends { id: string; name: string; updatedAt: string }>(items: T[], query: URLSearchParams, sortFields: string[]): Page<T> {
  const { page, pageSize } = pageValues(query)
  const sort = query.get('sort') ?? 'name'
  const order = query.get('order') ?? 'asc'
  if (!sortFields.includes(sort) || !['asc', 'desc'].includes(order)) fail(422, 'VALIDATION_ERROR', '不支援此排序。')
  const q = query.get('q')?.trim().toLowerCase()
  const filtered = items.filter((item) => !q || item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q))
  const sorted = filtered.toSorted((a, b) => {
    const av = String(a[sort as keyof T]), bv = String(b[sort as keyof T])
    const comparison = av < bv ? -1 : av > bv ? 1 : 0
    return (order === 'desc' ? -comparison : comparison) || a.id.localeCompare(b.id)
  })
  return { items: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, page, pageSize }
}

function freshnessOf(ci: CI, logicalClock: number): 'fresh' | 'stale' | 'unknown' {
  if (ci.observedAt === null) return 'unknown'
  return Date.parse(clockIso(logicalClock)) - Date.parse(ci.observedAt) > 86_400_000 ? 'stale' : 'fresh'
}

function projectCis(snapshot: Snapshot, policy: Policy, query: URLSearchParams): CI[] {
  const provider = query.get('provider'), kind = query.get('kind'), health = query.get('health'), freshness = query.get('freshness')
  if (provider !== null) parse(providerSchema, provider)
  if (kind !== null) parse(ciKindSchema, kind)
  if (health !== null) parse(healthSchema, health)
  if (freshness !== null && !['fresh', 'stale', 'unknown'].includes(freshness)) fail(422, 'VALIDATION_ERROR', '不支援的 freshness。')
  const projectId = query.get('projectId'), environmentId = query.get('environmentId')
  const visibleEnvironments = new Set(snapshot.entities.environments.filter(policy.canReadEnvironment).map((env) => env.id))
  return snapshot.entities.cis.filter((ci) =>
    policy.canReadCi(ci) && (!provider || ci.provider === provider) && (!kind || ci.kind === kind) &&
    (!health || ci.health === health) && (!freshness || freshnessOf(ci, snapshot.logicalClock) === freshness) &&
    (!projectId || policy.hasProject(projectId) && ci.visibilityProjectIds.includes(projectId)) &&
    (!environmentId || visibleEnvironments.has(environmentId) && snapshot.entities.placements.some((placement) => placement.ciId === ci.id && placement.environmentId === environmentId)))
}

function ciView(ci: CI, policy: Policy): CI {
  const view = clone(ci)
  view.visibilityProjectIds = view.visibilityProjectIds.filter((id) => policy.hasProject(id))
  if (!policy.admin && !policy.poolIds.includes(ci.poolId)) {
    delete view.attributes.managementIp
    delete view.attributes.native
    delete view.attributes.hostCiId
  }
  return view
}

function visibleAudit(snapshot: Snapshot, policy: Policy, audit: AuditEvent): boolean {
  if (['resourceObject', 'resourceBinding', 'change', 'changeExecution'].includes(audit.entityType)) return !!resourceRoute(snapshot, policy, audit.entityType, audit.entityId)
  if (policy.admin) return audit.orgId === policy.user?.orgId
  if (audit.entityType === 'ci') {
    const ci = snapshot.entities.cis.find((entry) => entry.id === audit.entityId)
    return !!ci && policy.canReadCi(ci)
  }
  if (audit.entityType === 'application') {
    const app = snapshot.entities.applications.find((entry) => entry.id === audit.entityId)
    return !!app && policy.hasProject(app.projectId)
  }
  if (audit.entityType === 'environment') {
    const environment = snapshot.entities.environments.find((entry) => entry.id === audit.entityId)
    return !!environment && policy.canReadEnvironment(environment)
  }
  if (audit.entityType === 'request') {
    const request = snapshot.entities.requests.find((entry) => entry.id === audit.entityId)
    return !!request && policy.canReadRequest(request)
  }
  if (audit.entityType === 'job') {
    const job = snapshot.jobs.find((entry) => entry.id === audit.entityId)
    const request = job && snapshot.entities.requests.find((entry) => entry.id === job.requestId)
    return !!request && policy.canReadRequest(request)
  }
  if (audit.entityType === 'pipeline' || audit.entityType === 'release') {
    const collection = audit.entityType === 'pipeline' ? snapshot.entities.pipelines : snapshot.entities.releases
    const entity = collection.find(entry => entry.id === audit.entityId)
    return !!entity && canReadDelivery(snapshot, policy, entity.environmentId)
  }
  if (audit.entityType === 'incident') {
    const incident = snapshot.entities.incidents.find(entry => entry.id === audit.entityId)
    return !!incident && canReadObservation(snapshot, policy, incident.environmentId)
  }
  if (audit.entityType === 'integration') return visibleIntegrations(snapshot, policy).some(entry => entry.id === audit.entityId)
  if (audit.entityType === 'relation') {
    const relation = snapshot.entities.relations.find((entry) => entry.id === audit.entityId)
    if (!relation) {
      const endpoints = audit.scopeSnapshot.relationEndpointCiIds
      return !!endpoints && endpoints.every((id) => {
        const endpoint = snapshot.entities.cis.find((entry) => entry.id === id)
        return !!endpoint && policy.canReadCi(endpoint)
      })
    }
    const source = snapshot.entities.cis.find((entry) => entry.id === relation.sourceCiId)
    const target = snapshot.entities.cis.find((entry) => entry.id === relation.targetCiId)
    return !!source && !!target && policy.canReadCi(source) && policy.canReadCi(target)
  }
  if (audit.entityType === 'demoSession' && audit.action !== 'provision.scheduler.advance') return false
  if (['roleAssignment', 'user', 'navigationItem', 'catalogItem', 'modelField', 'demoScenario'].includes(audit.entityType)) return false
  return audit.scopeSnapshot.projectIds.some((id) => policy.hasProject(id)) || audit.scopeSnapshot.poolIds.some((id) => policy.poolIds.includes(id))
}

function effectiveCatalog(snapshot: Snapshot, id: string, revision?: number) {
  const revisions = [...snapshot.entities.catalogHistory, ...snapshot.entities.catalogs]
    .filter((item) => item.id === id && (revision === undefined || item.revision === revision))
    .toSorted((left, right) => right.revision - left.revision)
  return revisions[0]
}

function jobLogs(snapshot: Snapshot, job: ProvisionJob) {
  const task = snapshot.scheduler.tasks.find((entry) => entry.operationId === job.id)
  const completed = job.state === 'succeeded' ? 5 : job.state === 'failed' ? 3 : task?.stepIndex ?? 0
  const steps = ['validate', 'allocate', 'configure', 'register', 'verify']
  return steps.slice(0, completed).map((step, index) => ({
    id: `${job.id}-log-${index + 1}`, applicationId: snapshot.entities.requests.find((entry) => entry.id === job.requestId)!.applicationId,
    environmentId: snapshot.entities.requests.find((entry) => entry.id === job.requestId)!.environmentId!,
    occurredAt: clockIso((job.startedAt ? Math.max(0, (Date.parse(job.startedAt) - Date.parse('2026-09-20T09:00:00Z')) / 1000) : snapshot.logicalClock) + index + 1),
    level: job.state === 'failed' && index === completed - 1 ? 'error' as const : 'info' as const,
    message: job.state === 'failed' && index === completed - 1 ? `${step}: simulated provision failure` : `${step}: completed`,
  }))
}

function topology(snapshot: Snapshot, policy: Policy, query: URLSearchParams) {
  const ciId = query.get('ciId'), environmentId = query.get('environmentId')
  if (Boolean(ciId) === Boolean(environmentId)) fail(422, 'VALIDATION_ERROR', '請指定一個且僅一個拓撲根節點。')
  const mode = query.get('mode')
  if (mode !== 'dependencies' && mode !== 'impact') fail(422, 'VALIDATION_ERROR', '不支援的拓撲模式。')
  const depthValue = query.get('depth') ?? '1'
  if (!/^[1-3]$/.test(depthValue)) fail(422, 'VALIDATION_ERROR', '拓撲深度必須為 1 到 3。')
  const maxDepth = Number(depthValue)
  const visible = new Map(snapshot.entities.cis.filter(policy.canReadCi).map((ci) => [ci.id, ci]))
  let roots: string[]
  if (ciId) {
    if (!visible.has(ciId)) notFound()
    roots = [ciId]
  } else {
    const environment = snapshot.entities.environments.find((entry) => entry.id === environmentId && policy.canReadEnvironment(entry))
    if (!environment) notFound()
    roots = snapshot.entities.placements.filter((entry) => entry.environmentId === environmentId && visible.has(entry.ciId)).map((entry) => entry.ciId)
  }
  const visibleRelations = snapshot.entities.relations.filter((relation) => visible.has(relation.sourceCiId) && visible.has(relation.targetCiId))
  const nodeIds = new Set(roots.slice(0, 100))
  const edgeIds = new Set<string>()
  const queue = [...nodeIds].map((id) => ({ id, depth: 0 }))
  let depthReached = 0
  let truncated = roots.length > 100
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    const candidates = visibleRelations.filter((relation) => mode === 'dependencies'
      ? relation.sourceCiId === current.id
      : relation.type !== 'connects_to' && relation.targetCiId === current.id)
    if (current.depth >= maxDepth) {
      if (candidates.some((relation) => !nodeIds.has(mode === 'dependencies' ? relation.targetCiId : relation.sourceCiId))) truncated = true
      continue
    }
    for (const relation of candidates.toSorted((a, b) => a.id.localeCompare(b.id))) {
      const neighbor = mode === 'dependencies' ? relation.targetCiId : relation.sourceCiId
      if (!nodeIds.has(neighbor)) {
        if (nodeIds.size >= 100) { truncated = true; continue }
        nodeIds.add(neighbor)
        queue.push({ id: neighbor, depth: current.depth + 1 })
        depthReached = Math.max(depthReached, current.depth + 1)
      }
      if (!edgeIds.has(relation.id)) {
        if (edgeIds.size >= 200) { truncated = true; continue }
        edgeIds.add(relation.id)
      }
    }
  }
  return {
    nodes: [...nodeIds].map((id) => ciView(visible.get(id)!, policy)),
    edges: visibleRelations.filter((relation) => edgeIds.has(relation.id)).map(clone),
    truncated, depthReached,
  }
}

export function createEngine(initial: Snapshot, persist: (next: Snapshot) => void): Engine {
  let state = parse(snapshotSchema, initial)
  assertIntegrity(state)
  let queue: Promise<unknown> = Promise.resolve()

  function context(actorId: string): Policy {
    const policy = policyFor(state, actorId)
    if (!policy.user) fail(401, 'UNAUTHENTICATED', '請選擇有效的示範身分。')
    return policy
  }

  function read(path: string, query: URLSearchParams, actorId: string): unknown {
    const policy = context(actorId)
    const entities = state.entities
    const resource = readResources(state, policy, path, query)
    if (resource !== undefined) return resource
    const observation = readObservation(state, policy, path, query)
    if (observation !== undefined) return observation
    const delivery = readDelivery(state, policy, path, query)
    if (delivery !== undefined) return delivery
    if (path === '/session') {
      validateQuery(query, [])
      return clone({ user: { id: policy.user!.id, displayName: policy.user!.displayName }, assignments: policy.assignments,
        effectiveActions: policy.effectiveActions, centers: policy.centers, demo: true, sessionId: state.sessionId,
        policyVersion: state.policyVersion, storeRevision: state.storeRevision, logicalClock: state.logicalClock })
    }
    if (path === '/guide') {
      validateQuery(query, [])
      return guideProjection(state, policy) satisfies GuideView
    }
    if (path === '/dashboard' || path === '/navigation') {
      validateQuery(query, path === '/dashboard' ? ['center', 'projectId', 'environmentId', 'provider', 'poolId', 'workOwner'] : ['center'])
      const center = parse(centerSchema, query.get('center'))
      if (!policy.centers.includes(center)) forbidden()
      if (path === '/navigation') return clone(entities.navigation.filter((item) => item.orgId === policy.user!.orgId && item.enabled
        && (item.routeKey === 'guide' || item.routeKey.startsWith(`${center}.`))
        && (item.routeKey === 'guide' || item.routeKey.startsWith('rd.') && policy.effectiveActions.includes(item.routeKey === 'rd.catalog' ? 'catalog.read' : item.routeKey === 'rd.requests' ? 'request.read' : 'app.read')
          || item.routeKey.startsWith('ops.') && policy.effectiveActions.includes(item.routeKey === 'ops.requests' ? 'request.read' : item.routeKey === 'ops.jobs' ? 'job.read' : item.routeKey === 'ops.capacity' ? 'capacity.read' : 'ci.read')
          || item.routeKey.startsWith('admin.') && policy.admin))
        .toSorted((a, b) => a.order - b.order || a.id.localeCompare(b.id)))
      const { center: _center, ...filters } = parse(dashboardQuerySchema, Object.fromEntries(query))
      void _center
      return workspaceDashboard(state, policy, center, filters, poolId => requestPoolUsage(state, poolId))
    }
    if (path === '/organization') {
      validateQuery(query, [])
      const projects = entities.projects.filter((project) => project.orgId === policy.user!.orgId && policy.hasProject(project.id))
      const teamIds = new Set([...projects.map((project) => project.teamId), ...policy.user!.teamIds])
      const teams = entities.teams.filter((team) => team.orgId === policy.user!.orgId && (policy.admin || teamIds.has(team.id)))
      return clone({ organizations: entities.organizations.filter((org) => org.id === policy.user!.orgId),
        businessUnits: entities.businessUnits.filter((unit) => unit.orgId === policy.user!.orgId && (policy.admin || teams.some((team) => team.businessUnitId === unit.id))), teams, projects,
        users: entities.users.filter((user) => user.orgId === policy.user!.orgId && (policy.admin || user.id === actorId)) })
    }
    if (path === '/applications') {
      validateQuery(query, ['projectId', 'q', 'page', 'pageSize', 'sort', 'order'])
      const projectId = query.get('projectId')
      return clone(paged(entities.applications.filter((app) => app.orgId === policy.user!.orgId && policy.hasProject(app.projectId) && (!projectId || app.projectId === projectId)), query, ['id', 'name', 'updatedAt']))
    }
    const applicationId = /^\/applications\/([^/]+)$/.exec(path)?.[1]
    if (applicationId) {
      validateQuery(query, [])
      const application = entities.applications.find((entry) => entry.id === applicationId && entry.orgId === policy.user!.orgId && policy.hasProject(entry.projectId))
      if (!application) notFound()
      return clone({ application, environments: entities.environments.filter((entry) => entry.applicationId === applicationId && policy.canReadEnvironment(entry)) })
    }
    const environmentId = /^\/environments\/([^/]+)$/.exec(path)?.[1]
    if (environmentId) {
      validateQuery(query, [])
      const environment = entities.environments.find((entry) => entry.id === environmentId && policy.canReadEnvironment(entry))
      if (!environment) notFound()
      return clone({ environment, placements: entities.placements.filter((entry) => entry.environmentId === environmentId && entities.cis.some((ci) => ci.id === entry.ciId && policy.canReadCi(ci))), activeRelease: entities.releases.find(release => release.id === environment!.activeReleaseId) ?? null })
    }
    if (path === '/cis') {
      validateQuery(query, ['provider', 'kind', 'projectId', 'environmentId', 'health', 'freshness', 'q', 'page', 'pageSize', 'sort', 'order'])
      const page = paged(projectCis(state, policy, query), query, ['id', 'name', 'updatedAt', 'provider', 'kind', 'health'])
      return { ...page, items: page.items.map((ci) => ciView(ci, policy)) }
    }
    const ciId = /^\/cis\/([^/]+)$/.exec(path)?.[1]
    if (ciId) {
      validateQuery(query, [])
      const ci = entities.cis.find((entry) => entry.id === ciId && policy.canReadCi(entry))
      if (!ci) notFound()
      return ciView(ci!, policy)
    }
    if (path === '/search') {
      validateQuery(query, ['q', 'limit'])
      const q = query.get('q')?.trim().toLowerCase()
      if (!q) fail(422, 'VALIDATION_ERROR', '搜尋字串不可為空。')
      const limitValue = query.get('limit') ?? '10'
      if (!/^([1-9]|1\d|20)$/.test(limitValue)) fail(422, 'VALIDATION_ERROR', '搜尋上限必須為 1 到 20。')
      const rp = resourcePolicy(state, policy)
      const hits = [
        ...entities.resourceObjects.filter(rp.objectVisible).map(o => ({ type: 'resourceObject', id: o.id, title: o.name, route: resourceRoute(state, policy, 'resourceObject', o.id)! })),
        ...entities.resourceBindings.filter(rp.bindingVisible).map(b => ({ type: 'resourceBinding', id: b.id, title: `${b.id} · ${b.purpose}`, route: resourceRoute(state, policy, 'resourceBinding', b.id)! })),
        ...entities.changes.filter(rp.changeVisible).map(c => ({ type: 'change', id: c.id, title: `${c.id} · ${c.kind}`, route: resourceRoute(state, policy, 'change', c.id)! })),
        ...entities.applications.filter((entry) => policy.hasProject(entry.projectId)).map((entry) => ({ type: 'application', id: entry.id, title: entry.name, route: `/rd/apps/${entry.id}` })),
        ...entities.environments.filter(policy.canReadEnvironment).map((entry) => {
          const app = entities.applications.find((candidate) => candidate.id === entry.applicationId)!
          return { type: 'environment', id: entry.id, title: `${app.name} · ${entry.name}`, route: `/rd/apps/${app.id}/environments/${entry.id}` }
        }),
        ...entities.cis.filter(policy.canReadCi).map((entry) => ({ type: 'ci', id: entry.id, title: entry.name, route: `/ops/cmdb/${entry.id}` })),
        ...entities.incidents.filter(entry => canReadObservation(state, policy, entry.environmentId)).map(entry => ({ type: 'incident', id: entry.id, title: `${entry.id} · ${entry.ruleKey}`, route: `/ops/incidents/${entry.id}` })),
        ...entities.releases.filter(entry => canReadDelivery(state, policy, entry.environmentId)).map(entry => ({
          type: 'release', id: entry.id,
          title: `${entry.id} · ${entities.artifacts.find(artifact => artifact.digest === entry.artifactDigest)?.revision ?? entry.artifactDigest}`,
          route: `/rd/releases/${entry.id}`,
        })),
      ].filter((entry) => entry.title.toLowerCase().includes(q!) || entry.id.toLowerCase().includes(q!))
        .toSorted((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
        .slice(0, Number(limitValue))
      return { items: clone(hits) }
    }
    if (path === '/relations') {
      validateQuery(query, ['ciId', 'direction', 'page', 'pageSize', 'sort', 'order'])
      const rootId = query.get('ciId')
      if (!rootId) fail(422, 'VALIDATION_ERROR', 'ciId 為必填。')
      const direction = query.get('direction') ?? 'both'
      if (!['in', 'out', 'both'].includes(direction)) fail(422, 'VALIDATION_ERROR', '不支援的關係方向。')
      if (!entities.cis.some((entry) => entry.id === rootId && policy.canReadCi(entry))) notFound()
      const visibleIds = new Set(entities.cis.filter(policy.canReadCi).map((entry) => entry.id))
      const relations = entities.relations.filter((entry) => visibleIds.has(entry.sourceCiId) && visibleIds.has(entry.targetCiId) &&
        (direction === 'both' || direction === 'in' && entry.targetCiId === rootId || direction === 'out' && entry.sourceCiId === rootId) &&
        (entry.sourceCiId === rootId || entry.targetCiId === rootId)).toSorted((a, b) => a.id.localeCompare(b.id))
      return clone(basicPage(relations, query))
    }
    if (path === '/topology') {
      validateQuery(query, ['ciId', 'environmentId', 'mode', 'depth'])
      return clone(topology(state, policy, query))
    }
    if (path === '/pools') {
      validateQuery(query, ['provider', 'projectId'])
      const provider = query.get('provider')
      if (provider) parse(providerSchema, provider)
      const projectId = query.get('projectId')
      if (projectId && !policy.hasProject(projectId)) return []
      return clone(entities.pools.filter((pool) => pool.orgId === policy.user!.orgId
        && (!provider || pool.provider === provider) && (!projectId || pool.scopeProjectIds.includes(projectId))
        && (policy.admin || policy.poolIds.includes(pool.id) || pool.scopeProjectIds.some((id) => policy.hasProject(id)))))
    }
    if (path === '/capacity') {
      validateQuery(query, ['provider', 'projectId'])
      const provider = query.get('provider')
      if (provider) parse(providerSchema, provider)
      const projectId = query.get('projectId')
      if (projectId && !policy.hasProject(projectId)) return []
      const pools = entities.pools.filter((pool) => pool.orgId === policy.user!.orgId && (!provider || pool.provider === provider) &&
        (policy.admin || policy.poolIds.includes(pool.id) || pool.scopeProjectIds.some((id) => policy.hasProject(id))) &&
        (!projectId || pool.scopeProjectIds.includes(projectId)))
      return pools.map((pool) => {
        const usage = requestPoolUsage(state, pool.id)
        return { poolId: pool.id, cpu: usage.cpu, memoryMiB: usage.memoryMiB }
      })
    }
    if (path === '/catalog') {
      validateQuery(query, ['revision', 'q', 'page', 'pageSize', 'sort', 'order'])
      const revision = query.get('revision')
      if (revision && (!/^\d+$/.test(revision) || Number(revision) < 1)) fail(422, 'VALIDATION_ERROR', 'revision 必須是正整數。')
      if (revision && !policy.admin) forbidden()
      const all = policy.admin && revision
        ? [...entities.catalogHistory, ...entities.catalogs].filter((entry) => entry.revision === Number(revision))
        : entities.catalogs.map((current) => policy.admin ? current : requestableCatalog(state, current.id))
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      const visible = all.filter((entry) => entry.orgId === policy.user!.orgId && (policy.admin
        || entry.status === 'published' && (entry.allowedProjectIds.some((id) => policy.hasProject(id, undefined, 'rd')) || resourcePolicy(state, policy).catalogVisible(entry))))
      return clone(paged(visible, query, ['id', 'name', 'updatedAt']))
    }
    const catalogId = /^\/catalog\/([^/]+)$/.exec(path)?.[1]
    if (catalogId) {
      validateQuery(query, ['revision'])
      const revision = query.get('revision')
      if (revision && !policy.admin) forbidden()
      const catalog = policy.admin
        ? effectiveCatalog(state, catalogId, revision ? Number(revision) : undefined)
        : requestableCatalog(state, catalogId)
      if (!catalog || catalog.orgId !== policy.user!.orgId || !policy.admin
        && (catalog.status !== 'published' || !(catalog.allowedProjectIds.some((id) => policy.hasProject(id, undefined, 'rd')) || resourcePolicy(state, policy).catalogVisible(catalog)))) notFound()
      return clone(catalog)
    }
    if (path === '/requests') {
      validateQuery(query, ['state', 'applicationId', 'requesterId', 'q', 'page', 'pageSize', 'sort', 'order'])
      const requestState = query.get('state')
      const applicationIdFilter = query.get('applicationId'), requesterId = query.get('requesterId')
      const items = entities.requests.filter((request) => policy.canReadRequest(request)
        && (!requestState || request.state === requestState)
        && (!applicationIdFilter || request.applicationId === applicationIdFilter)
        && (!requesterId || request.requesterId === requesterId))
        .map((request) => ({ ...request, name: request.environmentName }))
      const page = paged(items, query, ['id', 'name', 'updatedAt'])
      return clone({ ...page, items: page.items.map(({ name, ...request }) => { void name; return request }) })
    }
    const requestId = /^\/requests\/([^/]+)$/.exec(path)?.[1]
    if (requestId) {
      validateQuery(query, [])
      const request = entities.requests.find((entry) => entry.id === requestId && policy.canReadRequest(entry))
      if (!request) return notFound()
      return clone({ request, jobs: state.jobs.filter((job) => job.requestId === request.id).toSorted((a, b) => a.attempt - b.attempt) })
    }
    if (path === '/jobs') {
      validateQuery(query, ['requestId', 'state', 'q', 'page', 'pageSize', 'sort', 'order'])
      const requestIdFilter = query.get('requestId'), jobState = query.get('state')
      const items = state.jobs.filter((job) => {
        const request = entities.requests.find((entry) => entry.id === job.requestId)
        return !!request && policy.canReadJob(request) && (!requestIdFilter || job.requestId === requestIdFilter) && (!jobState || job.state === jobState)
      }).map((job) => ({ ...job, name: `Attempt ${job.attempt}` }))
      const page = paged(items, query, ['id', 'name', 'updatedAt'])
      return clone({ ...page, items: page.items.map(({ name, ...job }) => { void name; return job }) })
    }
    const jobId = /^\/jobs\/([^/]+)$/.exec(path)?.[1]
    if (jobId) {
      validateQuery(query, [])
      const job = state.jobs.find((entry) => entry.id === jobId)
      const request = job && entities.requests.find((entry) => entry.id === job.requestId && policy.canReadJob(entry))
      if (!job || !request) return notFound()
      return clone({ job, logs: jobLogs(state, job) })
    }
    if (path === '/admin/access') {
      validateQuery(query, [])
      if (!policy.admin) forbidden()
      return clone({ organizations: entities.organizations.filter((entry) => entry.id === policy.user!.orgId),
        users: entities.users.filter((entry) => entry.orgId === policy.user!.orgId),
        assignments: entities.assignments.filter((entry) => entry.orgId === policy.user!.orgId), policyVersion: state.policyVersion })
    }
    if (path === '/admin/navigation') {
      validateQuery(query, ['center'])
      if (!policy.admin) forbidden()
      const center = query.get('center')
      if (center) parse(centerSchema, center)
      return clone(entities.navigation.filter((entry) => entry.orgId === policy.user!.orgId
        && (!center || entry.routeKey === 'guide' || entry.routeKey.startsWith(`${center}.`)))
        .toSorted((a, b) => a.order - b.order || a.id.localeCompare(b.id)))
    }
    if (path === '/admin/cmdb-models') {
      validateQuery(query, [])
      if (!policy.admin) forbidden()
      return clone({ kinds: ciKindSchema.options, fields: entities.modelFields.filter((entry) => entry.orgId === policy.user!.orgId) })
    }
    if (path === '/audit') {
      validateQuery(query, ['entityType', 'entityId', 'correlationId', 'actorId', 'from', 'to', 'q', 'page', 'pageSize', 'sort', 'order'])
      const filters = Object.fromEntries(['entityType', 'entityId', 'correlationId', 'actorId'].map((key) => [key, query.get(key)]))
      const items = state.audit.filter((entry) => visibleAudit(state, policy, entry) &&
        Object.entries(filters).every(([key, value]) => !value || String(entry[key as keyof AuditEvent]) === value))
        .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))
      return clone(basicPage(items.map(entry => entry.entityType === 'integration' && !policy.admin
        ? { ...entry, scopeSnapshot: { ...entry.scopeSnapshot, poolIds: entry.scopeSnapshot.poolIds.filter(id => policy.poolIds.includes(id)) } } : entry), query))
    }
    return notFound()
  }


  return {
    getSnapshot: () => clone(state), read,
    command: (input) => {
      const copied = clone(input)
      const result = queue.then(async () => {
        // Load inside the queue; authorization and replay inspect the state at execution time.
        const { executeCommand } = await import('./engine-commands')
        const committed = executeCommand(state, copied, persist)
        state = committed.state
        return committed.receipt
      })
      queue = result.catch(() => undefined)
      return result
    },
  }
}

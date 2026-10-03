import type { z } from 'zod'
import { deliveryOptionsQuerySchema, pipelineDefinitionListQuerySchema, serviceConfigListQuerySchema, trafficPolicyListQuerySchema,
  serviceDeliveryRegistry as registry, type Snapshot, type ServiceSource, type WorkItem, type DeliveryOptions,
  type PipelineDefinitionDetail, type ServiceConfigDetail, type TrafficPolicyDetail } from './schema-models'
import type { Policy } from './policy'
import { clone, parse, fail, notFound } from './engine-shared'
import { serviceVisible, serviceScope, serviceActions, serviceRoute } from './service-delivery-policy'
import { serviceSources, serviceActive, serviceTime, serviceProduction, configDiff, effectiveTraffic } from './service-delivery-shared'
function values<T extends z.ZodType>(schema: T, query: URLSearchParams): z.infer<T> {
  for (const [key, value] of query) if (query.getAll(key).length !== 1 || !value && key !== 'q') fail(422, 'VALIDATION_ERROR', '不接受重複或空白查詢欄位。')
  return parse(schema, Object.fromEntries(query))
}
export function serviceDetail(s: Snapshot, p: Policy, source: ServiceSource): PipelineDefinitionDetail | ServiceConfigDetail | TrafficPolicyDetail {
  const common = { source, availableActions: serviceActions(s, p, source), productionRisk: serviceProduction(s, source), dataAsOf: serviceTime(s) }
  const active = serviceActive(s, source)
  if (source.sourceType === 'pipelineDefinition') return clone({ ...common, source,
    active: active?.sourceType === 'pipelineDefinition' && serviceVisible(s, p, active) ? active : null,
    history: s.entities.pipelineDefinitions.filter(row => row.familyId === source.familyId && serviceVisible(s, p, row)).toSorted((a, b) => b.revision - a.revision),
    runs: s.entities.pipelines.filter(r => r.definitionId === source.id).map(r => ({ id: r.id, environmentId: r.environmentId,
      definitionId: r.definitionId!, definitionRevision: r.definitionRevision!, sourceRevision: r.sourceRevision!, state: r.state,
      ...(r.artifactDigest ? { artifactDigest: r.artifactDigest } : {}) })) })
  if (source.sourceType === 'serviceConfig') {
    const current = active?.sourceType === 'serviceConfig' ? active : undefined
    return clone({ ...common, source, active: current ?? null, diff: configDiff(current, source),
      history: s.entities.serviceConfigs.filter(row => row.environmentId === source.environmentId && serviceVisible(s, p, row)).toSorted((a, b) => b.revision - a.revision),
      executions: s.entities.serviceExecutions.filter(e => e.kind === 'config').filter(e => e.sourceId === source.id) })
  }
  const executions = s.entities.serviceExecutions.filter(e => e.kind === 'traffic').filter(e => e.sourceId === source.id)
  return clone({ ...common, source, effective: effectiveTraffic(s, source.environmentId), executions,
    currentStep: executions.at(-1)?.stepResults.find(step => step.state === 'running')?.weight ?? null,
    history: s.entities.trafficPolicies.filter(row => row.environmentId === source.environmentId && serviceVisible(s, p, row)).toSorted((a, b) => b.revision - a.revision) })
}
export function readServiceDelivery(s: Snapshot, p: Policy, path: string, query: URLSearchParams): unknown {
  const options = /^\/applications\/([^/]+)\/delivery-options$/.exec(path)
  if (options) {
    const { environmentId } = values(deliveryOptionsQuerySchema, query)
    const app = s.entities.applications.find(a => a.id === options[1] && a.orgId === p.user?.orgId) ?? notFound()
    const allowed = (id: string) => serviceScope(s, p, app.id, [id], 'rd') || serviceScope(s, p, app.id, [id], 'ops')
    const env = s.entities.environments.find(e => e.id === environmentId && e.applicationId === app.id && allowed(e.id)) ?? notFound()
    const envView = (e: typeof env) => ({ id: e.id, name: e.name, stage: e.stage, version: e.version, status: e.status })
    const appOptions = (entries: readonly { id: string; label: string; applicationId: string }[]) => entries.filter(e => e.applicationId === app.id).map(({id,label}) => ({id,label}))
    const workloads = new Set(s.entities.placements.filter(row => row.environmentId === env.id && row.role === 'workload'
      && s.entities.cis.some(ci => ci.id === row.ciId && p.canReadCi(ci))).map(row => row.ciId))
    const refs: DeliveryOptions['network']['refs'] = []
    for (const relation of s.entities.relations) {
      const workloadCiId = workloads.has(relation.sourceCiId) ? relation.sourceCiId : workloads.has(relation.targetCiId) ? relation.targetCiId : undefined
      const ci = workloadCiId && s.entities.cis.find(ci => ci.id === (relation.sourceCiId === workloadCiId ? relation.targetCiId : relation.sourceCiId) && p.canReadCi(ci))
      if (ci && (ci.kind === 'network' || ci.kind === 'load_balancer')) refs.push({ ciId: ci.id, name: ci.name, kind: ci.kind, relationId: relation.id, workloadCiId: workloadCiId! })
    }
    const result: DeliveryOptions = { application: { id: app.id, name: app.name, projectId: app.projectId }, environment: envView(env),
      environments: s.entities.environments.filter(e => e.applicationId === app.id && allowed(e.id)).map(envView),
      repositories: appOptions(registry.repositories), artifactRepositories: appOptions(registry.artifactRepositories), secretRefs: appOptions(registry.secretRefs), endpoints: appOptions(registry.endpoints),
      refPatterns: [...registry.refPatterns], recipes: registry.recipes.map(id => ({id,label:id})), approvalPolicies: registry.approvalPolicies.map(id => ({id,label:id})), matches: [...registry.matches],
      eligibleReleases: s.entities.releases.filter(r => r.environmentId === env.id && r.state === 'succeeded' && r.health === 'healthy'
        && s.entities.artifacts.some(a => a.digest === r.artifactDigest && a.applicationId === app.id)).map(r => ({ id: r.id, artifactDigest: r.artifactDigest,
        revision: s.entities.artifacts.find(a => a.digest === r.artifactDigest)!.revision, createdAt: r.createdAt })),
      network: { status: refs.length ? 'known' : 'unknown', refs }, dataAsOf: serviceTime(s) }
    return clone(result)
  }
  const match = /^\/(pipeline-definitions|service-configs|traffic-policies)(?:\/([^/]+))?$/.exec(path)
  if (!match) return undefined
  const type = match[1] === 'pipeline-definitions' ? 'pipelineDefinition' : match[1] === 'service-configs' ? 'serviceConfig' : 'trafficPolicy'
  const visible = serviceSources(s).filter(row => row.sourceType === type && serviceVisible(s, p, row))
  if (match[2]) {
    if (query.size) fail(422, 'VALIDATION_ERROR', '詳情不接受查詢欄位。')
    return serviceDetail(s, p, visible.find(row => row.id === match[2]) ?? notFound())
  }
  const v = values(type === 'pipelineDefinition' ? pipelineDefinitionListQuerySchema : type === 'serviceConfig' ? serviceConfigListQuerySchema : trafficPolicyListQuerySchema, query)
  if (v.environmentId) {
    const env = s.entities.environments.find(e => e.id === v.environmentId && (!v.applicationId || e.applicationId === v.applicationId))
    if (!env || !(serviceScope(s, p, env.applicationId, [env.id], 'rd') || serviceScope(s, p, env.applicationId, [env.id], 'ops'))) notFound()
  }
  if (v.applicationId && !s.entities.environments.some(e => e.applicationId === v.applicationId && (serviceScope(s, p, e.applicationId, [e.id], 'rd') || serviceScope(s, p, e.applicationId, [e.id], 'ops')))) notFound()
  const rows = visible.filter(row => (!v.applicationId || row.applicationId === v.applicationId) && (!v.environmentId || row.affectedEnvironmentIds.includes(v.environmentId))
    && (!v.state || row.state === v.state) && (!v.q || `${row.id} ${'name' in row ? row.name : row.reason}`.toLowerCase().includes(v.q.toLowerCase())))
    .toSorted((a, b) => (v.order === 'asc' ? 1 : -1) * (v.sort === 'revision' ? a.revision - b.revision : a[v.sort].localeCompare(b[v.sort])) || a.id.localeCompare(b.id))
  return clone({ items: rows.slice((v.page - 1) * v.pageSize, v.page * v.pageSize), total: rows.length, page: v.page, pageSize: v.pageSize })
}
export function serviceWorkItems(s: Snapshot, p: Policy, center: 'rd' | 'ops'): WorkItem[] {
  return serviceSources(s).filter(row => serviceVisible(s, p, row) && serviceScope(s, p, row.applicationId, row.affectedEnvironmentIds, center)).map(row => {
    const app = s.entities.applications.find(a => a.id === row.applicationId)!
    const active = serviceActive(s, row)
    return { sourceType: row.sourceType, sourceId: row.id, rawState: row.state, stateLabel: row.state,
      requester: { id: row.requesterId, displayName: s.entities.users.find(u => u.id === row.requesterId)!.displayName },
      approver: row.decisions.at(-1) ? {id: row.decisions.at(-1)!.actorId, displayName: s.entities.users.find(u => u.id === row.decisions.at(-1)!.actorId)!.displayName} : null,
      targetRefs: [{entityType: 'application',entityId: app.id}, ...row.affectedEnvironmentIds.map(id => ({entityType:'environment',entityId:id}))],
      actionRequired: center === 'ops' ? serviceActions(s,p,row).includes('approve') : row.requesterId === p.user?.id && serviceActions(s,p,row).some(action => ['edit','submit','activate','apply','start'].includes(action)),
      createdAt: row.createdAt, updatedAt: row.updatedAt, dataAsOf: serviceTime(s), route: serviceRoute(s, p, row.sourceType, row.id)!,
      summary: { kind: row.sourceType === 'pipelineDefinition' ? 'pipelineDefinition.activate' : row.sourceType === 'serviceConfig' ? 'serviceConfig.apply' : 'trafficPolicy.rollout',
        revision: row.revision, productionRisk: serviceProduction(s, row), riskClass: null, basis: 'not-applicable', dimensions: [],
        diff: row.sourceType === 'serviceConfig' ? configDiff(active?.sourceType === 'serviceConfig' ? active : undefined, row) : [],
        weights: row.sourceType === 'trafficPolicy' ? row.spec.targets : [] } }
  })
}

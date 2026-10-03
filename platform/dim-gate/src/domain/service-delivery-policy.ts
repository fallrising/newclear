import type { Snapshot, ServiceSource } from './schemas'
import { policyFor, type Policy } from './policy'
import { serviceProduction } from './service-delivery-shared'

export function serviceScope(s: Snapshot, p: Policy, applicationId: string, environmentIds: string[], role: 'rd' | 'ops'): boolean {
  const app = s.entities.applications.find(a => a.id === applicationId && a.orgId === p.user?.orgId)
  return !!app && environmentIds.length > 0 && environmentIds.every(id => {
    const env = s.entities.environments.find(e => e.id === id && e.applicationId === app.id && e.orgId === app.orgId)
    return !!env && p.hasProject(app.projectId, env.stage, role)
  })
}
export function serviceVisible(s: Snapshot, p: Policy, source: ServiceSource) {
  return source.orgId === p.user?.orgId && (serviceScope(s, p, source.applicationId, source.affectedEnvironmentIds, 'rd')
    || serviceScope(s, p, source.applicationId, source.affectedEnvironmentIds, 'ops'))
}
export function serviceApprovalGrants(s: Snapshot, p: Policy, source: ServiceSource) {
  const app = s.entities.applications.find(a => a.id === source.applicationId)!
  return p.assignments.filter(g => g.role === 'ops' && g.scopeType === 'project' && g.scopeId === app.projectId
    && source.affectedEnvironmentIds.some(id => s.entities.environments.some(e => e.id === id && (!g.stages || g.stages.includes(e.stage))))).map(g => g.id).sort()
}
export function serviceApprovalCurrent(s: Snapshot, source: ServiceSource): boolean {
  const decision = source.decisions.at(-1)
  if (!decision || decision.decision !== 'approved' || decision.actorId === source.requesterId) return false
  const p = policyFor(s, decision.actorId)
  return serviceScope(s, p, source.applicationId, source.affectedEnvironmentIds, 'ops')
    && decision.grantIds.every(id => p.assignments.some(g => g.id === id))
}
export function serviceActions(s: Snapshot, p: Policy, source: ServiceSource) {
  const result: ('edit' | 'validate' | 'submit' | 'approve' | 'reject' | 'cancel' | 'activate' | 'apply' | 'start' | 'revisions' | 'restore' | 'runs')[] = []
  if (!serviceVisible(s, p, source)) return result
  const rd = serviceScope(s, p, source.applicationId, source.affectedEnvironmentIds, 'rd')
  const owner = rd && source.requesterId === p.user?.id
  if (rd) { result.push('revisions'); if (source.sourceType === 'serviceConfig') result.push('restore') }
  if (source.state === 'pending_approval' && source.requesterId !== p.user?.id && serviceScope(s, p, source.applicationId, source.affectedEnvironmentIds, 'ops')) result.push('approve', 'reject')
  if (owner) {
    if (['draft', 'validated'].includes(source.state)) result.push('edit', 'validate')
    if (source.state === 'validated' && serviceProduction(s, source)) result.push('submit')
    if (['draft', 'validated', 'pending_approval', 'approved'].includes(source.state)) result.push('cancel')
    if (source.state === 'validated' && !serviceProduction(s, source) || source.state === 'approved' && serviceApprovalCurrent(s, source))
      result.push(source.sourceType === 'pipelineDefinition' ? 'activate' : source.sourceType === 'serviceConfig' ? 'apply' : 'start')
  }
  if (rd && source.sourceType === 'pipelineDefinition' && source.state === 'active' && p.effectiveActions.includes('pipeline.trigger')) result.push('runs')
  return result
}
export function serviceRoute(s: Snapshot, p: Policy, type: string, id: string): string | undefined {
  const execution = type === 'serviceExecution' ? s.entities.serviceExecutions.find(e => e.id === id) : undefined
  const source = [...s.entities.pipelineDefinitions, ...s.entities.serviceConfigs, ...s.entities.trafficPolicies].find(row => row.id === (execution?.sourceId ?? id))
  if (!source || !serviceVisible(s, p, source)) return undefined
  if (!serviceScope(s, p, source.applicationId, source.affectedEnvironmentIds, 'rd')) return `/ops/service-changes/${source.sourceType}/${source.id}`
  const feature = source.sourceType === 'pipelineDefinition' ? 'delivery' : source.sourceType === 'serviceConfig' ? 'configuration' : 'traffic'
  const envId = source.sourceType === 'pipelineDefinition' ? source.spec.targetEnvironmentIds[0] : source.environmentId
  return `/rd/apps/${source.applicationId}/${feature}?environmentId=${encodeURIComponent(envId)}&revisionId=${encodeURIComponent(source.id)}`
}

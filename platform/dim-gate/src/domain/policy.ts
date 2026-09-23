import type { CI, Center, RoleAssignment, SessionView, Snapshot } from './schemas'

const resourceRead = ['binding.read', 'resourceObject.read', 'change.read']
const serviceReads = ['pipelineDefinition.read', 'serviceConfig.read', 'trafficPolicy.read', 'serviceChange.read']
const monitoringReads = ['monitorPolicy.read', 'alertRule.read', 'sloPolicy.read', 'silence.read', 'alertEvaluation.read', 'notificationDelivery.read']
const monitoringWrites = ['monitorPolicy.write', 'alertRule.write', 'sloPolicy.write', 'silence.create']
const monitoringApprovals = ['monitorPolicy.approve', 'alertRule.approve', 'sloPolicy.approve']
const requesterActions = ['change.create', 'change.submit', 'change.cancel', 'change.retry']
// Persisted Demo users are not authentication identities. Only fixed personas may act.
export const demoPersonaIds = new Set(['user-rd-commerce', 'user-rd-data', 'user-ops', 'user-admin',
  'w2-user-ops-secondary', 'w2-user-multi', 'w2-user-no-grant'])
const actions: Record<Center, readonly string[]> = {
  rd: [...serviceReads, ...monitoringReads, ...monitoringWrites, 'pipelineDefinition.write', 'serviceConfig.write', 'trafficPolicy.write', ...resourceRead, ...requesterActions, 'app.read', 'environment.read', 'ci.read', 'release.read', 'observation.read', 'request.create', 'request.edit', 'request.submit', 'request.cancel', 'request.retry', 'request.read', 'pipeline.read', 'pipeline.trigger', 'pipeline.retry', 'pipeline.cancel', 'release.rollback', 'incident.read', 'catalog.read', 'audit.read', 'job.read', 'capacity.read'],
  ops: [...serviceReads, ...monitoringReads, ...monitoringWrites, ...monitoringApprovals, 'serviceChange.approve', ...resourceRead, ...requesterActions, 'change.approve', 'change.reject', 'change.execute', 'resource.manage', 'app.read', 'environment.read', 'ci.read', 'ci.create', 'ci.update', 'relation.write', 'release.read', 'observation.read', 'request.read', 'request.approve', 'request.reject', 'request.provision', 'pipeline.read', 'release.approve', 'release.reject', 'incident.read', 'incident.acknowledge', 'incident.investigate', 'catalog.read', 'audit.read', 'integration.read', 'job.read', 'capacity.read'],
  admin: ['app.read', 'environment.read', 'ci.read', 'release.read', 'observation.read', 'request.read', 'incident.read', 'catalog.read', 'catalog.write', 'catalog.publish', 'navigation.write', 'model.write', 'access.write', 'feature.write', 'route.write', 'audit.read', 'integration.read', 'integration.test', 'capacity.read'],
}

export function policyFor(snapshot: Snapshot, actorId: string) {
  const user = demoPersonaIds.has(actorId) ? snapshot.entities.users.find((entry) => entry.id === actorId && entry.source === 'seed' && entry.enabled) : undefined
  const assignments = user ? snapshot.entities.assignments.filter((entry) => entry.userId === actorId && entry.orgId === user.orgId) : []
  const admin = !!user && assignments.some((entry) => entry.role === 'admin' && entry.scopeType === 'org' && entry.scopeId === user.orgId)
  const projectGrants = assignments.filter((entry) => entry.scopeType === 'project')
  const poolGrants = assignments.filter((entry) => entry.role === 'ops' && entry.scopeType === 'pool')
  const centers = (['rd', 'ops', 'admin'] as const).filter((center) => assignments.some((entry) => entry.role === center))
  const hasProject = (projectId: string, stage?: string, role?: Center) => admin && !role || projectGrants.some((entry) =>
    entry.scopeId === projectId && (!role || entry.role === role) && (!stage || !entry.stages || entry.stages.includes(stage as 'dev' | 'staging' | 'prod')))
  const canReadCi = (ci: CI) => ci.orgId === user?.orgId && (admin || poolGrants.some((entry) => entry.scopeId === ci.poolId) || ci.visibilityProjectIds.some((id) => hasProject(id)))
  const requestScope = (request: Snapshot['entities']['requests'][number]) => {
    const app = snapshot.entities.applications.find((entry) => entry.id === request.applicationId && entry.orgId === request.orgId)
    return app ? { app, rd: hasProject(app.projectId, request.stage, 'rd'), ops: hasProject(app.projectId, request.stage, 'ops') && poolGrants.some((entry) => entry.scopeId === request.poolId) } : undefined
  }
  return {
    user, assignments, admin, centers, hasProject, canReadCi,
    effectiveActions: [...new Set(assignments.flatMap((assignment) => actions[assignment.role]))].sort(),
    projectIds: snapshot.entities.projects.filter((project) => project.orgId === user?.orgId && hasProject(project.id)).map((project) => project.id),
    poolIds: poolGrants.map((entry) => entry.scopeId),
    canWriteCi: (ci: CI) => ci.orgId === user?.orgId && poolGrants.some((entry) => entry.scopeId === ci.poolId),
    canReadEnvironment: (environment: Snapshot['entities']['environments'][number]) => {
      const app = snapshot.entities.applications.find((entry) => entry.id === environment.applicationId)
      return !!app && app.orgId === user?.orgId && hasProject(app.projectId, environment.stage)
    },
    canManageAssignment: (assignment: RoleAssignment) => admin && assignment.orgId === user?.orgId,
    canReadRequest: (request: Snapshot['entities']['requests'][number]) => {
      const scope = requestScope(request)
      return request.orgId === user?.orgId && !!scope && (admin || scope.rd || scope.ops)
    },
    canReadJob: (request: Snapshot['entities']['requests'][number]) => {
      const scope = requestScope(request)
      return request.orgId === user?.orgId && !!scope && (scope.rd || scope.ops)
    },
    canEditRequest: (request: Snapshot['entities']['requests'][number]) => {
      const scope = requestScope(request)
      return request.orgId === user?.orgId && request.requesterId === user?.id && !!scope?.rd
    },
    canOperateRequest: (request: Snapshot['entities']['requests'][number]) => {
      const scope = requestScope(request)
      return request.orgId === user?.orgId && request.requesterId !== user?.id && !!scope?.ops
    },
  }
}

export type Policy = ReturnType<typeof policyFor>

/** UI action preview; commands always repeat the authoritative snapshot policy check. */
export function canPerformProjectAction(session: Pick<SessionView, 'assignments' | 'effectiveActions'>,
  action: string, projectId: string, stage?: string) {
  return session.effectiveActions.includes(action) && session.assignments.some(grant =>
    grant.scopeType === 'project' && grant.scopeId === projectId && actions[grant.role].includes(action)
    && (!stage || !grant.stages || grant.stages.some(value => value === stage)))
}

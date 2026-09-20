import type { CI, Center, RoleAssignment, Snapshot } from './schemas'

const actions: Record<Center, readonly string[]> = {
  rd: ['app.read', 'environment.read', 'ci.read', 'release.read', 'observation.read', 'request.create', 'request.edit', 'request.submit', 'request.cancel', 'request.retry', 'request.read', 'pipeline.read', 'pipeline.trigger', 'pipeline.retry', 'pipeline.cancel', 'release.rollback', 'incident.read', 'catalog.read', 'audit.read', 'job.read', 'capacity.read'],
  ops: ['app.read', 'environment.read', 'ci.read', 'ci.create', 'ci.update', 'relation.write', 'release.read', 'observation.read', 'request.read', 'request.approve', 'request.reject', 'request.provision', 'pipeline.read', 'release.approve', 'release.reject', 'incident.read', 'incident.acknowledge', 'incident.investigate', 'catalog.read', 'audit.read', 'integration.read', 'job.read', 'capacity.read'],
  admin: ['app.read', 'environment.read', 'ci.read', 'release.read', 'observation.read', 'request.read', 'incident.read', 'catalog.read', 'catalog.write', 'catalog.publish', 'navigation.write', 'model.write', 'access.write', 'audit.read', 'integration.read', 'integration.test', 'capacity.read'],
}

export function policyFor(snapshot: Snapshot, actorId: string) {
  const user = snapshot.entities.users.find((entry) => entry.id === actorId && entry.enabled)
  const assignments = user ? snapshot.entities.assignments.filter((entry) => entry.userId === actorId && entry.orgId === user.orgId) : []
  const admin = !!user && assignments.some((entry) => entry.role === 'admin' && entry.scopeType === 'org' && entry.scopeId === user.orgId)
  const projectGrants = assignments.filter((entry) => entry.scopeType === 'project')
  const poolGrants = assignments.filter((entry) => entry.role === 'ops' && entry.scopeType === 'pool')
  const centers = (['rd', 'ops', 'admin'] as const).filter((center) => assignments.some((entry) => entry.role === center))
  const hasProject = (projectId: string, stage?: string, role?: Center) => admin && !role || projectGrants.some((entry) =>
    entry.scopeId === projectId && (!role || entry.role === role) && (!stage || !entry.stages || entry.stages.includes(stage as 'dev' | 'staging' | 'prod')))
  const canReadCi = (ci: CI) => ci.orgId === user?.orgId && (admin || poolGrants.some((entry) => entry.scopeId === ci.poolId) || ci.visibilityProjectIds.some((id) => hasProject(id)))
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
  }
}

export type Policy = ReturnType<typeof policyFor>

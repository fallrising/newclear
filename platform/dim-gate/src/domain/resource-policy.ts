import type { Policy } from './policy'
import type { CatalogItem, ChangeInput, ChangeRequest, ResourceBinding, ResourceObject, Snapshot } from './schemas'

/** Resource payload authority always requires explicit business grants; Admin is not an implicit consumer. */
export function resourcePolicy(s: Snapshot, policy: Policy) {
  const environment = (id: string) => s.entities.environments.find(e => e.id === id && e.orgId === policy.user?.orgId)
  const environmentAccess = (id: string, role: 'rd' | 'ops') => {
    const env = environment(id), app = env && s.entities.applications.find(a => a.id === env.applicationId && a.orgId === env.orgId)
    return !!env && !!app && policy.hasProject(app.projectId, env.stage, role)
  }
  const parent = (id: string) => s.entities.cis.find(ci => ci.id === id && ci.orgId === policy.user?.orgId)
  const poolAccess = (id: string) => { const ci = parent(id); return !!ci && policy.poolIds.includes(ci.poolId) }
  const bindingVisible = (b: ResourceBinding) => b.orgId === policy.user?.orgId && !!parent(b.ciId)
    && (environmentAccess(b.environmentId, 'rd') || poolAccess(b.ciId) && environmentAccess(b.environmentId, 'ops'))
  const objectBindings = (id: string) => s.entities.resourceBindings.filter(b => b.resourceObjectId === id && b.state === 'active')
  const objectVisible = (o: ResourceObject) => o.orgId === policy.user?.orgId && objectBindings(o.id).some(bindingVisible)
  const affected = (input: ChangeInput) => {
    const result = new Set<string>()
    if (input.kind === 'resource.resize') for (const b of objectBindings(input.resourceObjectId)) result.add(b.environmentId)
    if (input.environmentId) result.add(input.environmentId)
    return [...result].sort()
  }
  const manages = (input: ChangeInput) => poolAccess(input.targetCiId) && affected(input).length > 0 && affected(input).every(id => environmentAccess(id, 'ops'))
  const proposes = (input: ChangeInput) => {
    if (!parent(input.targetCiId)) return false
    if ('resourceObjectId' in input && input.resourceObjectId) {
      const object = s.entities.resourceObjects.find(o => o.id === input.resourceObjectId)
      if (!object || !objectVisible(object)) return false
    }
    if (input.kind === 'resource.resize') return input.environmentId
      ? affected(input).every(id => environmentAccess(id, 'rd')) : manages(input)
    return !!input.environmentId && environmentAccess(input.environmentId, 'rd')
  }
  const changeVisible = (change: ChangeRequest) => change.orgId === policy.user?.orgId && (
    change.spec.environmentId ? (change.kind === 'resource.resize' ? affected(change.spec).every(id => environmentAccess(id, 'rd')) : environmentAccess(change.spec.environmentId, 'rd'))
      || poolAccess(change.spec.targetCiId) && affected(change.spec).every(id => environmentAccess(id, 'ops'))
      : manages(change.spec))
  const requester = (change: ChangeRequest) => change.requesterId === policy.user?.id && proposes(change.spec)
  const canExecute = (change: ChangeRequest) => change.orgId === policy.user?.orgId && manages(change.spec)
  const operate = (change: ChangeRequest) => change.requesterId !== policy.user?.id && canExecute(change)
  const catalogVisible = (catalog: CatalogItem) => {
    const template = catalog.template
    return catalog.orgId === policy.user?.orgId && template.resourceKind !== 'compute' && template.allowedParentCiIds.some(id => {
      const ci = parent(id)
      return ci && poolAccess(id) && catalog.allowedProjectIds.some(projectId => ci.visibilityProjectIds.includes(projectId)
        && template.allowedStages.some(stage => policy.hasProject(projectId, stage, 'ops')))
    })
  }
  return { environment, environmentAccess, parent, poolAccess, bindingVisible, objectBindings, objectVisible, affected, manages, proposes, changeVisible, requester, operate, canExecute, catalogVisible }
}

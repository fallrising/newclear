import { resourceAccessProfiles, type Snapshot } from './schemas'
import { resourceConflictKey } from './resources'
import { resourceUsage } from './resource-capacity'

/** Cross-entity validation covers persisted resources, frozen proposals and the shared scheduler. */
export function resourceIntegrityErrors(s: Snapshot): string[] {
  const e = s.entities, errors: string[] = []
  const sameOrg = (left: { orgId: string }, right: { orgId: string } | undefined) => !!right && left.orgId === right.orgId
  const objectKey = (o: typeof e.resourceObjects[number]) => JSON.stringify([o.parentCiId, o.kind, o.namespace ?? '', o.externalRef])
  if (new Set(e.resourceObjects.map(objectKey)).size !== e.resourceObjects.length) errors.push('resource object: duplicate canonical identity')
  for (const object of e.resourceObjects) {
    const ci = e.cis.find(ci => ci.id === object.parentCiId)
    if (!sameOrg(object, ci) || !(object.kind === 'cache_allocation' && ci?.kind === 'cache' && ci.attributes.engine === 'redis'
      || object.kind === 'kafka_topic' && ci?.kind === 'queue' && ci.attributes.engine === 'kafka'
      || object.kind === 'kubernetes_namespace' && ci?.kind === 'cluster' && ci.attributes.orchestrator === 'kubernetes')) errors.push('resource object: incompatible parent')
    if (object.kind === 'kafka_topic' && (!/^[a-z0-9][a-z0-9._-]*$/.test(object.externalRef) || object.externalRef !== object.name.toLowerCase())) errors.push('resource object: noncanonical topic identity')
    if (object.kind !== 'kubernetes_namespace' && !e.resourceQuotas.some(q => q.parentCiId === object.parentCiId)) errors.push('resource object: missing parent quota')
  }
  const bindingKey = (b: typeof e.resourceBindings[number]) => JSON.stringify([b.environmentId, b.ciId, b.resourceObjectId ?? '', b.purpose])
  if (new Set(e.resourceBindings.map(bindingKey)).size !== e.resourceBindings.length) errors.push('resource binding: duplicate consumer purpose')
  for (const binding of e.resourceBindings) {
    const app = e.applications.find(a => a.id === binding.applicationId), env = e.environments.find(env => env.id === binding.environmentId)
    const ci = e.cis.find(ci => ci.id === binding.ciId), object = e.resourceObjects.find(o => o.id === binding.resourceObjectId)
    const placement = e.placements.find(p => p.id === binding.placementId), profile = resourceAccessProfiles.find(p => p.id === binding.accessProfileRef)
    if (!sameOrg(binding, app) || !sameOrg(binding, env) || !sameOrg(binding, ci) || !sameOrg(binding, placement)
      || env?.applicationId !== app?.id || placement?.applicationId !== app?.id || placement?.environmentId !== env?.id || placement?.ciId !== ci?.id
      || binding.resourceObjectId && (!sameOrg(binding, object) || object?.parentCiId !== ci?.id || binding.state === 'active' && object?.lifecycle !== 'active')) errors.push('resource binding: inconsistent references')
    const resourceKind = object?.kind === 'cache_allocation' ? 'redis' : object?.kind === 'kafka_topic' ? 'kafka' : object?.kind === 'kubernetes_namespace' ? 'kubernetes' : undefined
    if (!profile || !(profile.purposes as readonly string[]).includes(binding.purpose) || resourceKind && profile.resourceKind !== resourceKind) errors.push('resource binding: incompatible registered access profile')
    if (object?.kind === 'kubernetes_namespace' && binding.requestRef.sourceType !== 'seed') errors.push('resource binding: Kubernetes must remain readonly')
    if (binding.requestRef.sourceType === 'change' && !e.changes.some(c => c.id === binding.requestRef.sourceId && c.orgId === binding.orgId && c.state === 'succeeded' && c.plannedBindingIds.includes(binding.id))) errors.push('resource binding: invalid source change')
    if (binding.requestRef.sourceType === 'request' && !e.requests.some(r => r.id === binding.requestRef.sourceId && r.orgId === binding.orgId)) errors.push('resource binding: invalid request source')
    if (binding.requestRef.sourceType === 'seed' && binding.requestRef.sourceId !== 'w2-seed-explicit-bindings') errors.push('resource binding: unregistered seed reference')
  }
  if (new Set(e.resourceQuotas.map(q => q.parentCiId)).size !== e.resourceQuotas.length) errors.push('resource quota: duplicate parent')
  for (const quota of e.resourceQuotas) {
    const ci = e.cis.find(ci => ci.id === quota.parentCiId)
    if (!sameOrg(quota, ci) || !(quota.resourceKind === 'redis' && ci?.kind === 'cache' && ci.attributes.engine === 'redis' || quota.resourceKind === 'kafka' && ci?.kind === 'queue' && ci.attributes.engine === 'kafka')) errors.push('resource quota: incompatible parent')
    for (const d of resourceUsage(s, quota)) if (d.used + d.reserved > d.capacity) errors.push('resource quota: committed and reserved capacity exceeded')
  }
  for (const catalog of [...e.catalogs, ...e.catalogHistory, ...e.changes.flatMap(c => c.catalogSnapshot ? [c.catalogSnapshot] : [])]) {
    const t = catalog.template
    if (t.resourceKind === 'compute') continue
    if (!t.allowedParentCiIds.length || new Set(t.accessProfiles.map(p => p.id)).size !== t.accessProfiles.length) errors.push('resource catalog: empty parents or duplicate profiles')
    for (const id of t.allowedParentCiIds) {
      const ci = e.cis.find(ci => ci.id === id)
      if (!sameOrg(catalog, ci) || !ci || !t.allowedProviders.includes(ci.provider) || !t.allowedPoolIds.includes(ci.poolId)
        || !(t.resourceKind === 'redis' && ci.kind === 'cache' && ci.attributes.engine === 'redis' || t.resourceKind === 'kafka' && ci.kind === 'queue' && ci.attributes.engine === 'kafka')) errors.push('resource catalog: incompatible allowed parent')
    }
    for (const profile of t.accessProfiles) {
      const registered = resourceAccessProfiles.find(p => p.id === profile.id)
      if (!registered || registered.resourceKind !== t.resourceKind || profile.purposes.some(p => !(registered.purposes as readonly string[]).includes(p))
        || new Set(profile.purposes).size !== profile.purposes.length) errors.push('resource catalog: incompatible registered profile')
    }
    const within = (value: number, min: number, max: number) => min <= value && value <= max
    if (t.resourceKind === 'redis' ? !within(t.defaults.quotaMiB, t.limits.minQuotaMiB, t.limits.maxQuotaMiB)
      : !within(t.defaults.partitions, t.limits.minPartitions, t.limits.maxPartitions) || !within(t.defaults.retentionHours, t.limits.minRetentionHours, t.limits.maxRetentionHours)
        || !within(t.defaults.throughputKiBPerSecond, t.limits.minThroughputKiBPerSecond, t.limits.maxThroughputKiBPerSecond)) errors.push('resource catalog: defaults outside limits')
  }
  const running = e.changes.filter(c => c.state === 'executing')
  if (new Set(running.map(c => c.spec.targetCiId)).size !== running.length) errors.push('resource execution: conflicting parent locks')
  const reserving = e.changes.filter(c => ['approved', 'executing'].includes(c.state)).map(c => resourceConflictKey(c.specSnapshot ?? c.spec)).filter(Boolean)
  if (new Set(reserving).size !== reserving.length) errors.push('resource change: conflicting reservation targets')
  const plannedObjects = new Map<string, string>(), plannedBindings = new Map<string, string>()
  for (const change of e.changes) {
    const ci = e.cis.find(ci => ci.id === change.spec.targetCiId), requester = e.users.find(u => u.id === change.requesterId)
    if (!sameOrg(change, ci) || !sameOrg(change, requester) || change.kind !== change.spec.kind || ci?.poolId !== change.poolId) errors.push('resource change: inconsistent identity')
    if (!['draft', 'cancelled'].includes(change.state) && (!change.specSnapshot || !change.catalogSnapshot)) errors.push('resource change: missing frozen proposal')
    if (change.specSnapshot && JSON.stringify(change.specSnapshot) !== JSON.stringify(change.spec)) errors.push('resource change: proposal differs from frozen spec')
    if (change.catalogSnapshot && (change.catalogSnapshot.id !== change.spec.catalogItemId || change.catalogSnapshot.revision !== change.spec.catalogRevision)) errors.push('resource change: catalog snapshot mismatch')
    if (change.decisions.some(d => d.actorId === change.requesterId || !e.users.some(u => u.id === d.actorId && u.orgId === change.orgId))) errors.push('resource change: invalid or self decision')
    if (['approved', 'executing', 'succeeded', 'failed'].includes(change.state) && change.decisions.at(-1)?.decision !== 'approved') errors.push('resource change: missing approval')
    if (change.state === 'rejected' && change.decisions.at(-1)?.decision !== 'rejected') errors.push('resource change: missing rejection')
    const spec = change.spec
    const required = [{ entityType: 'ci', entityId: spec.targetCiId, version: spec.targetCiVersion },
      ...('resourceObjectId' in spec && spec.resourceObjectId ? [{ entityType: 'resourceObject', entityId: spec.resourceObjectId, version: spec.resourceObjectVersion }] : []),
      ...(spec.environmentId ? [{ entityType: 'environment', entityId: spec.environmentId, version: spec.environmentVersion }] : [])]
    if (required.some(r => !change.targetVersions.some(t => t.entityType === r.entityType && t.entityId === r.entityId && t.version === r.version))
      || new Set(change.targetVersions.map(t => `${t.entityType}:${t.entityId}`)).size !== change.targetVersions.length
      || change.targetVersions.some(t => !['ci', 'resourceObject', 'environment'].includes(t.entityType))) errors.push('resource change: incomplete or duplicate target snapshot')
    const createsObject = spec.kind === 'kafka.topic.create' || spec.kind === 'resource.bind' && spec.mode === 'create'
    if (change.plannedObjectIds.length !== Number(createsObject) || change.plannedBindingIds.length !== Number(spec.kind !== 'resource.resize')) errors.push('resource change: invalid planned outputs')
    if (change.catalogSnapshot && (change.catalogSnapshot.orgId !== change.orgId || change.catalogSnapshot.template.resourceKind === 'compute'
      || !change.catalogSnapshot.template.allowedParentCiIds.includes(spec.targetCiId))) errors.push('resource change: incompatible frozen catalog')
    if (change.targetRefs.length !== change.targetVersions.length || change.targetRefs.some((r, i) => r.entityType !== change.targetVersions[i].entityType || r.entityId !== change.targetVersions[i].entityId)) errors.push('resource change: inconsistent target snapshot')
    for (const target of change.targetVersions) {
      const collection = target.entityType === 'ci' ? e.cis : target.entityType === 'resourceObject' ? e.resourceObjects : target.entityType === 'environment' ? e.environments : target.entityType === 'application' ? e.applications : e.resourceBindings
      if (!sameOrg(change, collection.find(entity => entity.id === target.entityId))) errors.push('resource change: invalid target reference')
    }
    for (const [ids, map, objects] of [[change.plannedObjectIds, plannedObjects, e.resourceObjects], [change.plannedBindingIds, plannedBindings, e.resourceBindings]] as const) for (const id of ids) {
      if (map.has(id)) errors.push('resource change: duplicate planned identity')
      map.set(id, change.id)
      if (change.state === 'succeeded' ? !objects.some(o => o.id === id) : objects.some(o => o.id === id)) errors.push('resource change: missing or premature canonical output')
    }
    const executions = e.changeExecutions.filter(x => x.changeId === change.id).toSorted((a, b) => a.attempt - b.attempt)
    if (executions.some((x, i) => x.attempt !== i + 1) || change.latestExecutionId !== executions.at(-1)?.id) errors.push('resource execution: invalid attempt history/latest reference')
    if (['executing', 'succeeded', 'failed'].includes(change.state) && !executions.length) errors.push('resource execution: missing attempt')
    if (['succeeded', 'failed'].includes(change.state) && executions.at(-1)?.state !== change.state) errors.push('resource execution: terminal state mismatch')
    if (change.state === 'executing' && !['queued', 'running'].includes(executions.at(-1)?.state ?? '')) errors.push('resource execution: active change without active attempt')
  }
  for (const execution of e.changeExecutions) {
    const change = e.changes.find(c => c.id === execution.changeId), tasks = s.scheduler.tasks.filter(t => t.operationId === execution.id)
    if (!sameOrg(execution, change) || execution.correlationId !== change?.correlationId || JSON.stringify(execution.targetRefs) !== JSON.stringify(change?.targetRefs)
      || JSON.stringify(execution.plannedObjectIds) !== JSON.stringify(change?.plannedObjectIds) || JSON.stringify(execution.plannedBindingIds) !== JSON.stringify(change?.plannedBindingIds)) errors.push('resource execution: inconsistent change references')
    if (execution.stepResults.some((step, i) => step.name !== ['validate', 'reserve', 'configure', 'register', 'verify'][i])) errors.push('resource execution: invalid step order')
    const active = ['queued', 'running'].includes(execution.state)
    if (active ? tasks.length !== 1 || change?.state !== 'executing' || change.latestExecutionId !== execution.id : tasks.length !== 0 || !execution.completedAt) errors.push('resource execution: ghost or missing task')
    if (active && tasks[0]) {
      const task = tasks[0]
      if (task.dueTick !== s.logicalClock + 1 || task.stepIndex > 4 || execution.state !== (task.stepIndex === 0 ? 'queued' : 'running')
        || execution.stepResults.some((step, i) => step.name !== ['validate', 'reserve', 'configure', 'register', 'verify'][i]
          || step.state !== (i < task.stepIndex ? 'succeeded' : i === task.stepIndex && task.stepIndex > 0 ? 'running' : 'queued'))) errors.push('resource execution: invalid step position')
    }
    if (execution.state === 'succeeded' && execution.stepResults.some(step => step.state !== 'succeeded')) errors.push('resource execution: incomplete success')
    if (execution.state === 'failed' && (!execution.failureCode || !execution.stepResults.some(step => step.state === 'failed'))) errors.push('resource execution: missing failure evidence')
  }
  if (new Set(s.scheduler.tasks.map(t => t.id)).size !== s.scheduler.tasks.length || new Set(s.scheduler.tasks.map(t => t.operationId)).size !== s.scheduler.tasks.length) errors.push('scheduler: duplicate task')
  for (const task of s.scheduler.tasks) if (![...s.jobs, ...e.pipelines, ...e.releases, ...e.changeExecutions].some(entity => entity.id === task.operationId)) errors.push('scheduler: unknown operation')
  return errors
}

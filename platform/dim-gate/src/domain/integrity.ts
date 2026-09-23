import type { LegacySnapshot, Snapshot } from './schemas'
import { deliveryIntegrityErrors } from './delivery-integrity'
import { observationIntegrityErrors } from './observation-integrity'
import { resourceIntegrityErrors } from './resource-integrity'

/** Cross-entity invariants supplement the serializable per-entity Zod schemas. */
export function integrityErrors(snapshot: Snapshot): string[] {
  const errors: string[] = []
  const entities = snapshot.entities
  const scopedCollections = Object.entries(entities).filter(([key]) => key !== 'organizations')
  for (const [name, collection] of Object.entries(entities)) {
    if (name === 'catalogHistory') continue
    if (new Set(collection.map((entity) => entity.id)).size !== collection.length) errors.push(`${name}: duplicate ID`)
  }
  if (new Set(entities.catalogHistory.map((item) => `${item.id}:${item.revision}`)).size !== entities.catalogHistory.length) errors.push('catalogHistory: duplicate revision')
  const orgs = new Set(entities.organizations.map((org) => org.id))
  for (const [name, collection] of scopedCollections) {
    for (const entity of collection) if ('orgId' in entity && !orgs.has(entity.orgId)) errors.push(`${name}: unknown organization`)
  }
  function linked(collection: readonly { id: string; orgId: string }[], id: string, orgId: string) {
    return collection.find((entity) => entity.id === id && entity.orgId === orgId)
  }
  for (const team of entities.teams) if (!linked(entities.businessUnits, team.businessUnitId, team.orgId)) errors.push('team: invalid business unit')
  for (const project of entities.projects) if (!linked(entities.teams, project.teamId, project.orgId)) errors.push('project: invalid team')
  if (new Set(entities.projects.map((project) => `${project.orgId}:${project.slug.toLowerCase()}`)).size !== entities.projects.length) errors.push('project: duplicate normalized slug')
  for (const user of entities.users) for (const teamId of user.teamIds) if (!linked(entities.teams, teamId, user.orgId)) errors.push('user: invalid team')
  for (const app of entities.applications) {
    const project = linked(entities.projects, app.projectId, app.orgId)
    if (!project || !('teamId' in project) || project.teamId !== app.ownerTeamId) errors.push('application: owner must match project team')
  }
  for (const env of entities.environments) if (!linked(entities.applications, env.applicationId, env.orgId)) errors.push('environment: invalid application')
  if (new Set(entities.environments.map((env) => `${env.applicationId}:${env.name.trim().toLowerCase()}`)).size !== entities.environments.length) errors.push('environment: duplicate normalized name')
  for (const pool of entities.pools) {
    const location = entities.locations.find((entry) => entry.id === pool.locationId && entry.orgId === pool.orgId)
    const account = entities.accounts.find((entry) => entry.id === pool.accountId && entry.orgId === pool.orgId)
    if (!location || location.provider !== pool.provider || (pool.provider !== 'onprem' && (!account || account.provider !== pool.provider))) errors.push('pool: inconsistent provider identity')
    for (const projectId of pool.scopeProjectIds) if (!linked(entities.projects, projectId, pool.orgId)) errors.push('pool: invalid project')
  }
  const canonicalKeys = new Set<string>()
  for (const ci of entities.cis) {
    const location = entities.locations.find((entry) => entry.id === ci.locationId && entry.orgId === ci.orgId)
    const pool = entities.pools.find((entry) => entry.id === ci.poolId && entry.orgId === ci.orgId)
    const account = entities.accounts.find((entry) => entry.id === ci.accountId && entry.orgId === ci.orgId)
    if (!location || location.provider !== ci.provider || !pool || pool.provider !== ci.provider || pool.locationId !== ci.locationId || pool.accountId !== ci.accountId || (ci.provider !== 'onprem' && (!account || account.provider !== ci.provider))) errors.push('CI: inconsistent provider, location, account or pool')
    if (!linked(entities.teams, ci.ownerTeamId, ci.orgId)) errors.push('CI: invalid owner')
    for (const projectId of ci.visibilityProjectIds) if (!linked(entities.projects, projectId, ci.orgId) || !pool?.scopeProjectIds.includes(projectId)) errors.push('CI: invalid visibility project')
    const locationKey = location && ('region' in location ? location.region : location.site)
    const key = JSON.stringify([ci.orgId, ci.provider, ci.accountId ?? null, locationKey, ci.kind, ci.externalId])
    if (canonicalKeys.has(key)) errors.push('CI: duplicate canonical identity')
    canonicalKeys.add(key)
    if (typeof ci.attributes.hostCiId === 'string' && !linked(entities.cis, ci.attributes.hostCiId, ci.orgId)) errors.push('CI: invalid host reference')
  }
  for (const placement of entities.placements) {
    const app = entities.applications.find((entry) => entry.id === placement.applicationId && entry.orgId === placement.orgId)
    const env = entities.environments.find((entry) => entry.id === placement.environmentId && entry.orgId === placement.orgId)
    const ci = entities.cis.find((entry) => entry.id === placement.ciId && entry.orgId === placement.orgId)
    if (!app || !env || env.applicationId !== app.id || !ci || !ci.visibilityProjectIds.includes(app.projectId)) errors.push('placement: invalid or invisible reference')
  }
  if (new Set(entities.placements.map((entry) => JSON.stringify([entry.applicationId, entry.environmentId, entry.ciId]))).size !== entities.placements.length) errors.push('placement: duplicate link')
  for (const assignment of entities.assignments) {
    if (!linked(entities.users, assignment.userId, assignment.orgId)) errors.push('assignment: invalid user')
    if (assignment.scopeType === 'org' ? assignment.scopeId !== assignment.orgId : !linked(assignment.scopeType === 'project' ? entities.projects : entities.pools, assignment.scopeId, assignment.orgId)) errors.push('assignment: invalid scope')
  }
  for (const relation of entities.relations) if (!linked(entities.cis, relation.sourceCiId, relation.orgId) || !linked(entities.cis, relation.targetCiId, relation.orgId)) errors.push('relation: invalid endpoint')
  for (const catalog of [...entities.catalogs, ...entities.catalogHistory]) {
    for (const projectId of catalog.allowedProjectIds) if (!linked(entities.projects, projectId, catalog.orgId)) errors.push('catalog: invalid project')
    for (const poolId of catalog.template.allowedPoolIds) if (!linked(entities.pools, poolId, catalog.orgId)) errors.push('catalog: invalid pool')
  }
  for (const request of entities.requests) {
    const app = entities.applications.find((entry) => entry.id === request.applicationId && entry.orgId === request.orgId)
    const pool = entities.pools.find((entry) => entry.id === request.poolId && entry.orgId === request.orgId)
    const requester = linked(entities.users, request.requesterId, request.orgId)
    if (!app || !pool || !requester || pool.provider !== request.provider) errors.push('request: invalid app, requester, provider or pool')
    if (request.latestJobId && !snapshot.jobs.some((job) => job.id === request.latestJobId && job.requestId === request.id)) errors.push('request: invalid latest job')
    if (request.environmentId) {
      const environment = entities.environments.find((entry) => entry.id === request.environmentId && entry.orgId === request.orgId)
      if (environment && environment.applicationId !== request.applicationId) errors.push('request: invalid environment')
    }
  }
  for (const job of snapshot.jobs) if (!linked(entities.requests, job.requestId, job.orgId)) errors.push('job: invalid request')
  for (const pool of entities.pools) {
    const compute = entities.cis.filter((ci) => ci.poolId === pool.id && ci.kind === 'compute' && ci.lifecycle === 'active')
    if (compute.reduce((sum, ci) => sum + Number(ci.attributes.cpu), 0) > pool.cpuCapacity || compute.reduce((sum, ci) => sum + Number(ci.attributes.memoryMiB), 0) > pool.memoryCapacityMiB) errors.push('pool: capacity exceeded')
  }
  return [...errors, ...deliveryIntegrityErrors(snapshot), ...observationIntegrityErrors(snapshot), ...resourceIntegrityErrors(snapshot)]
}

/** Validate original relationships before any additive W2 migration metadata is applied. */
export function legacyIntegrityErrors(snapshot: LegacySnapshot): string[] {
  return integrityErrors({ ...snapshot, schemaVersion: 2, seedVersion: 'dim-gate-w2-v1', entities: { ...snapshot.entities,
    resourceObjects: [], resourceBindings: [], resourceQuotas: [], changes: [], changeExecutions: [],
  } })
}

import { pipelineDefinitionSchema, serviceConfigSchema, type Snapshot } from '../../domain/schemas'

const BASELINE = '2026-09-20T09:00:00Z'
const scoped = { version: 1, createdAt: BASELINE, updatedAt: BASELINE, orgId: 'org-demo' }

/** Drafts only: no invented active config, successful execution or definition-backed legacy run. */
export function buildW3BusinessSeed(applications: Snapshot['entities']['applications']):
  Pick<Snapshot['entities'], 'pipelineDefinitions' | 'serviceConfigs' | 'trafficPolicies' | 'serviceExecutions'> {
  return {
    pipelineDefinitions: applications.map(app => {
      const suffix = app.id.slice(4), environmentId = `env-${suffix}-dev`
      return pipelineDefinitionSchema.parse({ ...scoped, id: `w3-definition-${suffix}-1`, sourceType: 'pipelineDefinition',
        applicationId: app.id, familyId: `w3-definition-family-${suffix}`, name: `Demo ${suffix} delivery`, revision: 1,
        requesterId: app.ownerTeamId === 'team-data' ? 'user-rd-data' : 'user-rd-commerce',
        reason: 'Demo draft definition; explicit validation and activation required', state: 'draft',
        baseActiveRevisionId: null, affectedEnvironmentIds: [environmentId], validationResult: null, decisions: [],
        correlationId: `w3-seed-definition-${suffix}`, spec: { repositoryRef: `w3-repository-${suffix}`, refPattern: 'main',
          recipeRef: 'demo-web-v1', artifactRepositoryRef: `w3-artifact-${suffix}`, targetEnvironmentIds: [environmentId],
          approvalPolicyRef: 'independent-ops-prod-v1' } })
    }),
    serviceConfigs: applications.map(app => {
      const suffix = app.id.slice(4), environmentId = `env-${suffix}-dev`
      return serviceConfigSchema.parse({ ...scoped, id: `w3-config-${suffix}-dev-1`, sourceType: 'serviceConfig',
        applicationId: app.id, environmentId, revision: 1, targetEnvironmentVersion: 1,
        requesterId: app.ownerTeamId === 'team-data' ? 'user-rd-data' : 'user-rd-commerce',
        reason: 'Demo draft configuration; nothing is active until successful execution', state: 'draft',
        baseActiveRevisionId: null, affectedEnvironmentIds: [environmentId], validationResult: null, decisions: [],
        correlationId: `w3-seed-config-${suffix}`, spec: { entries: [
          { key: 'LOG_LEVEL', description: 'Demo log verbosity', valueType: 'string', value: 'info' },
          { key: 'REQUEST_TIMEOUT_MS', description: 'Demo request timeout', valueType: 'number', value: 1500 },
          { key: 'CACHE_ENABLED', description: 'Demo cache setting', valueType: 'boolean', value: true },
          { key: 'RUNTIME_SECRET', description: 'Registered fictional reference only', valueType: 'secretRef', value: `w3-secret-${suffix}` },
        ] } })
    }),
    trafficPolicies: [], serviceExecutions: [],
  }
}

import { serviceDeliveryRegistry as registry, type Snapshot, type ServiceSource } from './schemas'
export function serviceValidationErrors(s: Snapshot, row: ServiceSource) {
  const errors: {field: string; message: string}[] = []
  const error = (field: string, message: string) => errors.push({field, message})
  const compatible = (refs: readonly {id: string; applicationId: string}[], id: string) => refs.some(r => r.id === id && r.applicationId === row.applicationId)
  if (row.sourceType === 'pipelineDefinition') {
    if (!compatible(registry.repositories, row.spec.repositoryRef)) error('spec.repositoryRef', 'Repository must belong to this application')
    if (!compatible(registry.artifactRepositories, row.spec.artifactRepositoryRef)) error('spec.artifactRepositoryRef', 'Artifact repository must belong to this application')
    if (new Set(row.spec.targetEnvironmentIds).size !== row.spec.targetEnvironmentIds.length) error('spec.targetEnvironmentIds', 'Target environments must be unique')
    if (row.spec.targetEnvironmentIds.some(id => !s.entities.environments.some(e => e.id === id && e.applicationId === row.applicationId && e.orgId === row.orgId))) error('spec.targetEnvironmentIds', 'Target environment is incompatible')
  } else if (row.sourceType === 'serviceConfig') {
    const seen = new Set<string>()
    row.spec.entries.forEach((entry, i) => {
      if (seen.has(entry.key)) error(`spec.entries.${i}.key`, 'Keys must be unique')
      seen.add(entry.key)
      if (entry.valueType === 'secretRef' && !compatible(registry.secretRefs, entry.value)) error(`spec.entries.${i}.value`, 'Secret reference must belong to this application')
    })
  } else {
    if (!compatible(registry.endpoints, row.spec.endpointRef)) error('spec.endpointRef', 'Endpoint must belong to this application')
    row.spec.targets.forEach((target, i) => {
      const release = s.entities.releases.find(r => r.id === target.releaseId && r.applicationId === row.applicationId && r.environmentId === row.environmentId && r.orgId === row.orgId)
      if (!release || release.state !== 'succeeded' || release.health !== 'healthy'
        || !s.entities.artifacts.some(a => a.digest === release.artifactDigest && a.applicationId === row.applicationId && a.orgId === row.orgId)) error(`spec.targets.${i}.releaseId`, 'Target requires a retained healthy release in this environment')
    })
  }
  return errors.slice(0, 40)
}

import type { Integration } from '../../domain/schemas'

/** Synthetic labels only: these fixtures contain no network endpoints or credentials. */
export function buildObservationSeed(): { integrations: Integration[] } {
  const stamp = { version: 1, createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T09:00:00Z', orgId: 'org-demo' }
  const sources = [
    { id: 'integration-aws', kind: 'inventory', displayName: 'AWS inventory · demo', poolIds: ['pool-aws-sg'] },
    { id: 'integration-aliyun', kind: 'inventory', displayName: 'Aliyun inventory · demo', poolIds: ['pool-aliyun-sg'] },
    { id: 'integration-idc', kind: 'inventory', displayName: 'IDC inventory · demo', poolIds: ['pool-idc-sg'] },
    { id: 'integration-delivery', kind: 'delivery', displayName: 'CI/CD · demo', poolIds: ['pool-aws-sg', 'pool-aliyun-sg', 'pool-idc-sg'] },
    { id: 'integration-observation', kind: 'observation', displayName: 'APM · demo', poolIds: ['pool-aws-sg', 'pool-aliyun-sg', 'pool-idc-sg'] },
  ] as const
  return { integrations: sources.map(source => ({ ...stamp, ...source, poolIds: [...source.poolIds], endpointLabel: `Synthetic ${source.kind} adapter`,
    state: 'demo', lastSyncAt: null, fieldMappings: (source.kind === 'inventory' ? { nativeId: 'externalId', sourceRegion: 'locationId' }
      : source.kind === 'delivery' ? { buildRevision: 'revision', artifact: 'artifactDigest' } : { service: 'applicationId', deployment: 'environmentId' }) as Record<string, string> })) }
}

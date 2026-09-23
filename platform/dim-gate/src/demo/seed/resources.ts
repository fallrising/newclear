import type { Snapshot } from '../../domain/schemas'

const BASELINE = '2026-09-20T09:00:00Z'
const STALE = '2026-09-18T08:00:00Z'
const scoped = { version: 1, createdAt: BASELINE, updatedAt: BASELINE, orgId: 'org-demo' }
const projectIds = ['project-store', 'project-payments', 'project-data', 'project-insights']

/** Safe additive metadata is shared by fresh seeds and validated W1 migrations. */
export function buildW2Metadata(): Pick<Snapshot['entities'], 'cis' | 'catalogs' | 'navigation' | 'resourceQuotas'> {
  return {
    cis: [
      { ...scoped, id: 'w2-ci-kafka-idc', name: 'IDC Kafka · Demo', kind: 'queue', provider: 'onprem',
        externalId: 'w2-kafka-idc-demo', locationId: 'location-idc-sg', poolId: 'pool-idc-sg', ownerTeamId: 'team-platform',
        visibilityProjectIds: ['project-store', 'project-data'], lifecycle: 'active', health: 'unknown', tags: { mode: 'demo', shared: 'true' },
        attributes: { engine: 'kafka', versionLabel: '3-demo', endpointLabel: 'kafka-idc.example.invalid' }, customFields: {}, source: 'manual', observedAt: null },
      { ...scoped, id: 'w2-ci-kafka-aws', name: 'AWS Kafka · Demo', kind: 'queue', provider: 'aws',
        externalId: 'w2-kafka-aws-demo', accountId: 'account-aws-demo', locationId: 'location-aws-sg', poolId: 'pool-aws-sg', ownerTeamId: 'team-platform',
        visibilityProjectIds: ['project-store', 'project-payments'], lifecycle: 'active', health: 'unknown', tags: { mode: 'demo', shared: 'true' },
        attributes: { engine: 'kafka', versionLabel: '3-demo', endpointLabel: 'kafka-aws.example.invalid' }, customFields: {}, source: 'manual', observedAt: null },
      { ...scoped, id: 'w2-ci-k8s-aws', name: 'AWS Kubernetes · Readonly Demo', kind: 'cluster', provider: 'aws',
        externalId: 'w2-kubernetes-aws-demo', accountId: 'account-aws-demo', locationId: 'location-aws-sg', poolId: 'pool-aws-sg', ownerTeamId: 'team-platform',
        visibilityProjectIds: ['project-store'], lifecycle: 'active', health: 'unknown', tags: { mode: 'demo', access: 'readonly' },
        attributes: { orchestrator: 'kubernetes', versionLabel: '1-demo' }, customFields: {}, source: 'manual', observedAt: STALE },
    ],
    catalogs: [
      { ...scoped, id: 'w2-catalog-redis', name: 'Redis allocation', description: 'Demo Redis allocation binding and quota resize; no key browser or real execution',
        revision: 1, status: 'published', allowedProjectIds: ['project-store', 'project-data'],
        template: { resourceKind: 'redis', allowedProviders: ['onprem'], allowedStages: ['dev', 'staging', 'prod'], allowedPoolIds: ['pool-idc-sg'],
          allowedParentCiIds: ['ci-idc-redis-01'], requiresApproval: true,
          accessProfiles: [{ id: 'w2-profile-redis-runtime', label: 'Redis runtime · Demo reference', purposes: ['runtime'] }],
          defaults: { quotaMiB: 512 }, limits: { minQuotaMiB: 128, maxQuotaMiB: 8192 } } },
      { ...scoped, id: 'w2-catalog-kafka', name: 'Kafka topic', description: 'Demo topic creation and producer/consumer binding; no messages or topic deletion',
        revision: 1, status: 'published', allowedProjectIds: ['project-store', 'project-data', 'project-payments'],
        template: { resourceKind: 'kafka', allowedProviders: ['onprem', 'aws'], allowedStages: ['dev', 'staging', 'prod'], allowedPoolIds: ['pool-idc-sg', 'pool-aws-sg'],
          allowedParentCiIds: ['w2-ci-kafka-idc', 'w2-ci-kafka-aws'], requiresApproval: true,
          accessProfiles: [
            { id: 'w2-profile-kafka-producer', label: 'Kafka producer · Demo reference', purposes: ['producer'] },
            { id: 'w2-profile-kafka-consumer', label: 'Kafka consumer · Demo reference', purposes: ['consumer'] },
          ], defaults: { partitions: 3, retentionHours: 72, throughputKiBPerSecond: 512 },
          limits: { minPartitions: 1, maxPartitions: 16, minRetentionHours: 1, maxRetentionHours: 720,
            minThroughputKiBPerSecond: 128, maxThroughputKiBPerSecond: 4096 } } },
    ],
    navigation: [
      { ...scoped, id: 'w2-nav-ops-caches', routeKey: 'ops.caches', label: 'Redis 快取', group: '資源', order: 28, enabled: true },
      { ...scoped, id: 'w2-nav-ops-messaging', routeKey: 'ops.messaging', label: 'Kafka 訊息', group: '資源', order: 29, enabled: true },
      { ...scoped, id: 'w2-nav-ops-clusters', routeKey: 'ops.clusters', label: 'Kubernetes 叢集', group: '資源', order: 30, enabled: true },
    ],
    resourceQuotas: [
      { ...scoped, id: 'w2-quota-redis', parentCiId: 'ci-idc-redis-01', resourceKind: 'redis', capacity: { quotaMiB: 8192 }, observedAt: null, observedUsage: { quotaMiB: null } },
      ...['idc', 'aws'].map((provider) => ({ ...scoped, id: `w2-quota-kafka-${provider}`, parentCiId: `w2-ci-kafka-${provider}`, resourceKind: 'kafka' as const,
        capacity: { topics: 8, partitions: 32, throughputKiBPerSecond: 8192 }, observedAt: null,
        observedUsage: { topics: null, partitions: null, throughputKiBPerSecond: null } })),
    ],
  }
}

/** New demo actors are fresh-only; a migrated user's assignments are never changed. */
export function buildW2Assignments(): Snapshot['entities']['assignments'] {
  return [
    ...projectIds.map((projectId) => ({ ...scoped, id: `w2-grant-secondary-${projectId}`, userId: 'w2-user-ops-secondary', role: 'ops' as const, scopeType: 'project' as const, scopeId: projectId })),
    ...['pool-aws-sg', 'pool-aliyun-sg', 'pool-idc-sg'].map((poolId) => ({ ...scoped, id: `w2-grant-secondary-${poolId}`, userId: 'w2-user-ops-secondary', role: 'ops' as const, scopeType: 'pool' as const, scopeId: poolId })),
    { ...scoped, id: 'w2-grant-multi-rd-store', userId: 'w2-user-multi', role: 'rd', scopeType: 'project', scopeId: 'project-store' },
    { ...scoped, id: 'w2-grant-multi-ops-store', userId: 'w2-user-multi', role: 'ops', scopeType: 'project', scopeId: 'project-store' },
    ...['pool-aws-sg', 'pool-aliyun-sg', 'pool-idc-sg'].map((poolId) => ({ ...scoped, id: `w2-grant-multi-${poolId}`, userId: 'w2-user-multi', role: 'ops' as const, scopeType: 'pool' as const, scopeId: poolId })),
  ]
}

/** These are explicit fresh fixtures, never inferred from migrated legacy Placements. */
export function buildW2BusinessSeed(legacyPlacements: Snapshot['entities']['placements']): Pick<Snapshot['entities'], 'resourceObjects' | 'resourceBindings' | 'placements' | 'changes' | 'changeExecutions'> {
  const resourceObjects: Snapshot['entities']['resourceObjects'] = [
    { ...scoped, id: 'w2-object-redis-commerce', parentCiId: 'ci-idc-redis-01', kind: 'cache_allocation', externalRef: 'commerce-dev', name: 'Commerce shared allocation', lifecycle: 'active', observedAt: null, spec: { quotaMiB: 1024 } },
    { ...scoped, id: 'w2-object-redis-data', parentCiId: 'ci-idc-redis-01', kind: 'cache_allocation', externalRef: 'data-dev', name: 'Data private allocation', lifecycle: 'active', observedAt: null, spec: { quotaMiB: 2048 } },
    ...['idc', 'aws'].map((provider) => ({ ...scoped, id: `w2-object-kafka-${provider}-orders`, parentCiId: `w2-ci-kafka-${provider}`, kind: 'kafka_topic' as const,
      externalRef: 'orders-events', name: 'orders-events', lifecycle: 'active' as const, observedAt: null,
      spec: { partitions: 3, retentionHours: 72, throughputKiBPerSecond: 512 } })),
    { ...scoped, id: 'w2-object-k8s-checkout', parentCiId: 'w2-ci-k8s-aws', kind: 'kubernetes_namespace', externalRef: 'checkout-dev', name: 'checkout-dev', namespace: 'checkout-dev', lifecycle: 'active', observedAt: STALE,
      spec: { workloads: [{ name: 'checkout-api', kind: 'Deployment', replicas: 2, requests: { cpuMilli: 1000, memoryMiB: 1024 }, limits: { cpuMilli: 2000, memoryMiB: 2048 } }],
        nodes: [{ name: 'demo-worker-01', allocatable: { cpuMilli: 8000, memoryMiB: 16384 }, requested: { cpuMilli: 1000, memoryMiB: 1024 } }] } },
  ]
  const placements: Snapshot['entities']['placements'] = []
  const resourceBindings: Snapshot['entities']['resourceBindings'] = []
  const bind = (suffix: string, appSuffix: string, ciId: string, resourceObjectId: string,
    purpose: 'runtime' | 'producer' | 'consumer', accessProfileRef: string) => {
    const applicationId = `app-${appSuffix}`, environmentId = `env-${appSuffix}-dev`
    let placement = [...legacyPlacements, ...placements].find(p => p.applicationId === applicationId && p.environmentId === environmentId && p.ciId === ciId)
    if (!placement) {
      placement = { ...scoped, id: `w2-placement-${suffix}`, applicationId, environmentId, ciId, role: 'dependency' }
      placements.push(placement)
    }
    resourceBindings.push({ ...scoped, id: `w2-binding-${suffix}`, applicationId, environmentId, ciId, resourceObjectId, placementId: placement.id,
      purpose, accessProfileRef, state: 'active', requestRef: { sourceType: 'seed', sourceId: 'w2-seed-explicit-bindings' } })
  }
  bind('checkout-redis', 'checkout', 'ci-idc-redis-01', 'w2-object-redis-commerce', 'runtime', 'w2-profile-redis-runtime')
  bind('storefront-redis', 'storefront', 'ci-idc-redis-01', 'w2-object-redis-commerce', 'runtime', 'w2-profile-redis-runtime')
  bind('data-redis', 'data', 'ci-idc-redis-01', 'w2-object-redis-data', 'runtime', 'w2-profile-redis-runtime')
  bind('checkout-kafka-idc', 'checkout', 'w2-ci-kafka-idc', 'w2-object-kafka-idc-orders', 'producer', 'w2-profile-kafka-producer')
  bind('storefront-kafka-idc', 'storefront', 'w2-ci-kafka-idc', 'w2-object-kafka-idc-orders', 'consumer', 'w2-profile-kafka-consumer')
  bind('checkout-kafka-aws', 'checkout', 'w2-ci-kafka-aws', 'w2-object-kafka-aws-orders', 'producer', 'w2-profile-kafka-producer')
  bind('checkout-k8s', 'checkout', 'w2-ci-k8s-aws', 'w2-object-k8s-checkout', 'runtime', 'w2-profile-k8s-reader')
  return { resourceObjects, resourceBindings, placements, changes: [], changeExecutions: [] }
}

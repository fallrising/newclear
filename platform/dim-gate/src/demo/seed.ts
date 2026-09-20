import { personaSchema, snapshotSchema, type Persona, type Snapshot } from '../domain/schemas'

export const SEED_BASELINE = '2026-09-20T09:00:00Z'
const stamp = { version: 1, createdAt: SEED_BASELINE, updatedAt: SEED_BASELINE }
const scoped = { ...stamp, orgId: 'org-demo' }

export const personas: Persona[] = [
  { id: 'user-rd-commerce', displayName: '林予安 · Commerce RD', description: 'Store 專案的應用與環境', centers: ['rd'] },
  { id: 'user-rd-data', displayName: '陳以晴 · Data RD', description: 'Data 專案的應用與環境', centers: ['rd'] },
  { id: 'user-ops', displayName: '周柏宇 · Platform Ops', description: '三個資源池與兩個專案的維運範圍', centers: ['ops'] },
  { id: 'user-admin', displayName: '吳知行 · Platform Admin', description: '企業配置與授權管理；未授予發布權', centers: ['admin'] },
].map((persona) => personaSchema.parse(persona))

/** M0's minimal seed: three synthetic CIs, two applications, four existing environments. */
export function createSeed(sessionId: string): Snapshot {
  return snapshotSchema.parse({
    schemaVersion: 1, seedVersion: 'dim-gate-v1', sessionId, logicalClock: 0,
    sequence: 0, storeRevision: 0, policyVersion: 1, commandCount: 0,
    entities: {
      organizations: [{ ...stamp, id: 'org-demo', name: 'Dim Commerce' }],
      businessUnits: [
        { ...scoped, id: 'bu-commerce', name: 'Commerce' },
        { ...scoped, id: 'bu-technology', name: 'Technology' },
      ],
      teams: [
        { ...scoped, id: 'team-commerce', businessUnitId: 'bu-commerce', name: 'Commerce' },
        { ...scoped, id: 'team-platform', businessUnitId: 'bu-technology', name: 'Platform' },
        { ...scoped, id: 'team-data', businessUnitId: 'bu-technology', name: 'Data' },
      ],
      projects: [
        { ...scoped, id: 'project-store', teamId: 'team-commerce', name: 'Store', slug: 'store' },
        { ...scoped, id: 'project-data', teamId: 'team-data', name: 'Data', slug: 'data' },
      ],
      users: personas.map((persona) => ({
        ...scoped, id: persona.id, displayName: persona.displayName, enabled: true,
        teamIds: [persona.id === 'user-rd-commerce' ? 'team-commerce' : persona.id === 'user-rd-data' ? 'team-data' : 'team-platform'],
      })),
      applications: [
        { ...scoped, id: 'app-checkout', projectId: 'project-store', ownerTeamId: 'team-commerce', name: 'checkout-api', slug: 'checkout-api', tier: 'critical', description: '示範結帳 API；M0 尚未開放交付流程' },
        { ...scoped, id: 'app-data', projectId: 'project-data', ownerTeamId: 'team-data', name: 'data-worker', slug: 'data-worker', tier: 'standard', description: '示範資料作業；用於專案權限範圍驗證' },
      ],
      environments: [
        { ...scoped, id: 'env-checkout-dev', applicationId: 'app-checkout', name: 'dev', stage: 'dev', status: 'ready', activeReleaseId: null },
        { ...scoped, id: 'env-checkout-prod', applicationId: 'app-checkout', name: 'prod', stage: 'prod', status: 'ready', activeReleaseId: null },
        { ...scoped, id: 'env-data-dev', applicationId: 'app-data', name: 'dev', stage: 'dev', status: 'ready', activeReleaseId: null },
        { ...scoped, id: 'env-data-prod', applicationId: 'app-data', name: 'prod', stage: 'prod', status: 'ready', activeReleaseId: null },
      ],
      accounts: [
        { ...scoped, id: 'account-aws-demo', provider: 'aws', displayName: 'AWS · Demo', externalAccountRef: 'demo-aws-account', connectionState: 'demo' },
        { ...scoped, id: 'account-aliyun-demo', provider: 'aliyun', displayName: 'Aliyun · Demo', externalAccountRef: 'demo-aliyun-account', connectionState: 'demo' },
      ],
      locations: [
        { ...scoped, id: 'location-aws-sg', provider: 'aws', region: 'ap-southeast-1', zone: 'ap-southeast-1a' },
        { ...scoped, id: 'location-aliyun-sg', provider: 'aliyun', region: 'ap-southeast-1', zone: 'ap-southeast-1a' },
        { ...scoped, id: 'location-idc-sg', provider: 'onprem', site: 'demo-sg-site', rack: 'demo-rack-01' },
      ],
      pools: [
        { ...scoped, id: 'pool-aws-sg', name: 'AWS Singapore · Demo', provider: 'aws', locationId: 'location-aws-sg', accountId: 'account-aws-demo', scopeProjectIds: ['project-store', 'project-data'], cpuCapacity: 64, memoryCapacityMiB: 131072, provisionDefaults: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', subnetId: 'subnet-demo' } },
        { ...scoped, id: 'pool-aliyun-sg', name: 'Aliyun Singapore · Demo', provider: 'aliyun', locationId: 'location-aliyun-sg', accountId: 'account-aliyun-demo', scopeProjectIds: ['project-store', 'project-data'], cpuCapacity: 64, memoryCapacityMiB: 131072, provisionDefaults: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', vSwitchId: 'vsw-demo' } },
        { ...scoped, id: 'pool-idc-sg', name: 'IDC Singapore · Demo', provider: 'onprem', locationId: 'location-idc-sg', scopeProjectIds: ['project-store', 'project-data'], cpuCapacity: 64, memoryCapacityMiB: 131072, provisionDefaults: { hypervisor: 'kvm' } },
      ],
      cis: [
        { ...scoped, id: 'ci-aws-checkout-01', name: 'checkout-demo-01', kind: 'compute', provider: 'aws', externalId: 'i-demo-checkout-01', accountId: 'account-aws-demo', locationId: 'location-aws-sg', poolId: 'pool-aws-sg', ownerTeamId: 'team-commerce', visibilityProjectIds: ['project-store'], lifecycle: 'active', health: 'unknown', tags: { mode: 'demo' }, attributes: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', subnetId: 'subnet-demo', cpu: 2, memoryMiB: 4096, privateIp: '192.0.2.10' }, customFields: {}, source: 'discovered', observedAt: null },
        { ...scoped, id: 'ci-aliyun-worker-01', name: 'data-demo-01', kind: 'compute', provider: 'aliyun', externalId: 'i-demo-data-01', accountId: 'account-aliyun-demo', locationId: 'location-aliyun-sg', poolId: 'pool-aliyun-sg', ownerTeamId: 'team-data', visibilityProjectIds: ['project-data'], lifecycle: 'active', health: 'unknown', tags: { mode: 'demo' }, attributes: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', vSwitchId: 'vsw-demo', cpu: 2, memoryMiB: 4096, privateIp: '198.51.100.10' }, customFields: {}, source: 'discovered', observedAt: null },
        { ...scoped, id: 'ci-idc-redis-01', name: 'shared-redis-demo', kind: 'cache', provider: 'onprem', externalId: 'demo-redis-01', locationId: 'location-idc-sg', poolId: 'pool-idc-sg', ownerTeamId: 'team-platform', visibilityProjectIds: ['project-store', 'project-data'], lifecycle: 'active', health: 'unknown', tags: { mode: 'demo' }, attributes: { engine: 'redis', versionLabel: 'demo', endpointLabel: 'redis.example.invalid' }, customFields: {}, source: 'manual', observedAt: null },
      ],
      placements: [
        { ...scoped, id: 'placement-checkout-aws', applicationId: 'app-checkout', environmentId: 'env-checkout-dev', ciId: 'ci-aws-checkout-01', role: 'workload' },
        { ...scoped, id: 'placement-data-aliyun', applicationId: 'app-data', environmentId: 'env-data-dev', ciId: 'ci-aliyun-worker-01', role: 'workload' },
        { ...scoped, id: 'placement-checkout-redis', applicationId: 'app-checkout', environmentId: 'env-checkout-dev', ciId: 'ci-idc-redis-01', role: 'dependency' },
        { ...scoped, id: 'placement-data-redis', applicationId: 'app-data', environmentId: 'env-data-dev', ciId: 'ci-idc-redis-01', role: 'dependency' },
      ],
      relations: [],
      assignments: [
        { ...scoped, id: 'grant-rd-commerce', userId: 'user-rd-commerce', role: 'rd', scopeType: 'project', scopeId: 'project-store' },
        { ...scoped, id: 'grant-rd-data', userId: 'user-rd-data', role: 'rd', scopeType: 'project', scopeId: 'project-data' },
        { ...scoped, id: 'grant-ops-store', userId: 'user-ops', role: 'ops', scopeType: 'project', scopeId: 'project-store' },
        { ...scoped, id: 'grant-ops-data', userId: 'user-ops', role: 'ops', scopeType: 'project', scopeId: 'project-data' },
        { ...scoped, id: 'grant-ops-aws', userId: 'user-ops', role: 'ops', scopeType: 'pool', scopeId: 'pool-aws-sg' },
        { ...scoped, id: 'grant-ops-aliyun', userId: 'user-ops', role: 'ops', scopeType: 'pool', scopeId: 'pool-aliyun-sg' },
        { ...scoped, id: 'grant-ops-idc', userId: 'user-ops', role: 'ops', scopeType: 'pool', scopeId: 'pool-idc-sg' },
        { ...scoped, id: 'grant-admin', userId: 'user-admin', role: 'admin', scopeType: 'org', scopeId: 'org-demo' },
      ],
      navigation: [
        { ...scoped, id: 'nav-rd', routeKey: 'rd.overview', label: '研發概覽', group: '工作區', order: 10, enabled: true },
        { ...scoped, id: 'nav-ops', routeKey: 'ops.overview', label: '維運概覽', group: '工作區', order: 20, enabled: true },
        { ...scoped, id: 'nav-admin', routeKey: 'admin.overview', label: '平台概覽', group: '工作區', order: 30, enabled: true },
        { ...scoped, id: 'nav-guide', routeKey: 'guide', label: '示範控制台', group: '示範', order: 40, enabled: true },
      ],
      modelFields: [],
    },
    jobs: [], events: [], audit: [], idempotency: [], scenarioFlags: {}, scheduler: { tasks: [] },
  })
}

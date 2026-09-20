import type { CI, Provider, Snapshot } from '../../domain/schemas'

const BASELINE = '2026-09-20T09:00:00Z'
const STALE = '2026-09-18T08:00:00Z'
const scoped = { version: 1, createdAt: BASELINE, updatedAt: BASELINE, orgId: 'org-demo' }
const pad = (value: number) => String(value).padStart(2, '0')

function compute(provider: Provider, index: number): CI {
  const projectId = provider === 'aws'
    ? (index % 2 ? 'project-store' : 'project-payments')
    : provider === 'aliyun'
      ? (index % 2 ? 'project-data' : 'project-insights')
      : (index % 2 ? 'project-store' : 'project-data')
  const ownerTeamId = ['project-store', 'project-payments'].includes(projectId) ? 'team-commerce' : 'team-data'
  const providerFields: Pick<CI, 'locationId' | 'poolId' | 'attributes'> & Partial<Pick<CI, 'accountId'>> = provider === 'aws'
    ? { accountId: 'account-aws-demo', locationId: 'location-aws-sg', poolId: 'pool-aws-sg',
        attributes: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', subnetId: 'subnet-demo', cpu: index === 2 ? 0 : 2, memoryMiB: index === 2 ? 0 : 2048, privateIp: `192.0.2.${index}` } }
    : provider === 'aliyun'
      ? { accountId: 'account-aliyun-demo', locationId: 'location-aliyun-sg', poolId: 'pool-aliyun-sg',
          attributes: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', vSwitchId: 'vsw-demo', cpu: 2, memoryMiB: 2048, privateIp: `198.51.100.${index}` } }
      : { locationId: 'location-idc-sg', poolId: 'pool-idc-sg',
          attributes: { assetTag: `asset-${pad(index)}`, serialRef: `serial-${pad(index)}`, hypervisor: 'kvm' as const, cpu: 2, memoryMiB: 2048, managementIp: `203.0.113.${index}` } }
  return {
    ...scoped,
    id: provider === 'aws' && index === 1 ? 'ci-aws-checkout-01'
      : provider === 'aliyun' && index === 1 ? 'ci-aliyun-worker-01'
        : `ci-${provider}-${pad(index)}`,
    name: `${provider}-compute-${pad(index)}`, kind: 'compute', provider,
    externalId: provider === 'aws' && index === 1 ? 'i-demo-checkout-01' : provider === 'aliyun' && index === 1 ? 'i-demo-data-01' : `${provider}-external-${pad(index)}`, ...providerFields, ownerTeamId,
    visibilityProjectIds: [projectId], lifecycle: 'active',
    health: index % 7 === 0 ? 'unknown' : index % 5 === 0 ? 'degraded' : 'healthy',
    tags: { mode: 'demo', provider }, customFields: {}, source: 'discovered',
    observedAt: index === 1 ? null : index === 2 ? STALE : BASELINE,
  }
}

export function buildCmdbSeed(): Pick<Snapshot['entities'], 'accounts' | 'locations' | 'pools' | 'cis'> {
  const accounts: Snapshot['entities']['accounts'] = [
    { ...scoped, id: 'account-aws-demo', provider: 'aws', displayName: 'AWS · Demo', externalAccountRef: 'demo-aws-account', connectionState: 'demo' },
    { ...scoped, id: 'account-aliyun-demo', provider: 'aliyun', displayName: 'Aliyun · Demo', externalAccountRef: 'demo-aliyun-account', connectionState: 'demo' },
  ]
  const locations: Snapshot['entities']['locations'] = [
    { ...scoped, id: 'location-aws-sg', provider: 'aws', region: 'ap-southeast-1', zone: 'ap-southeast-1a' },
    { ...scoped, id: 'location-aliyun-sg', provider: 'aliyun', region: 'ap-southeast-1', zone: 'ap-southeast-1a' },
    { ...scoped, id: 'location-idc-sg', provider: 'onprem', site: 'demo-sg-site', rack: 'demo-rack-01' },
  ]
  const projectIds = ['project-store', 'project-payments', 'project-data', 'project-insights']
  const pools: Snapshot['entities']['pools'] = [
    { ...scoped, id: 'pool-aws-sg', name: 'AWS Singapore · Demo', provider: 'aws', locationId: 'location-aws-sg', accountId: 'account-aws-demo', scopeProjectIds: projectIds, cpuCapacity: 128, memoryCapacityMiB: 262144, provisionDefaults: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', subnetId: 'subnet-demo' } },
    { ...scoped, id: 'pool-aliyun-sg', name: 'Aliyun Singapore · Demo', provider: 'aliyun', locationId: 'location-aliyun-sg', accountId: 'account-aliyun-demo', scopeProjectIds: projectIds, cpuCapacity: 128, memoryCapacityMiB: 262144, provisionDefaults: { instanceType: 'demo.compute.small', vpcId: 'vpc-demo', vSwitchId: 'vsw-demo' } },
    { ...scoped, id: 'pool-idc-sg', name: 'IDC Singapore · Demo', provider: 'onprem', locationId: 'location-idc-sg', scopeProjectIds: projectIds, cpuCapacity: 128, memoryCapacityMiB: 262144, provisionDefaults: { hypervisor: 'kvm' } },
  ]
  const aws = Array.from({ length: 20 }, (_, index) => compute('aws', index + 1))
  const aliyun = Array.from({ length: 20 }, (_, index) => compute('aliyun', index + 1))
  const onprem = Array.from({ length: 19 }, (_, index) => compute('onprem', index + 2))
  const sharedRedis: CI = {
    ...scoped, id: 'ci-idc-redis-01', name: 'shared-redis-demo', kind: 'cache', provider: 'onprem',
    externalId: 'demo-redis-01', locationId: 'location-idc-sg', poolId: 'pool-idc-sg',
    ownerTeamId: 'team-platform', visibilityProjectIds: ['project-store', 'project-data'],
    lifecycle: 'active', health: 'unknown', tags: { mode: 'demo', shared: 'true' },
    attributes: { engine: 'redis', versionLabel: '7-demo', endpointLabel: 'redis.example.invalid' },
    customFields: {}, source: 'manual', observedAt: null,
  }
  return { accounts, locations, pools, cis: [...aws, ...aliyun, sharedRedis, ...onprem] }
}

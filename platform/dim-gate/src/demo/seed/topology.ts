import type { Snapshot } from '../../domain/schemas'

const BASELINE = '2026-09-20T09:00:00Z'
const scoped = { version: 1, createdAt: BASELINE, updatedAt: BASELINE, orgId: 'org-demo' }

export function buildTopologySeed(
  applications: Snapshot['entities']['applications'],
  environments: Snapshot['entities']['environments'],
): Pick<Snapshot['entities'], 'placements' | 'relations'> {
  const workloadIds = [
    'ci-aws-checkout-01', 'ci-aws-03', 'ci-aws-05', 'ci-aws-07', 'ci-aws-02', 'ci-aws-04',
    'ci-aliyun-worker-01', 'ci-aliyun-03', 'ci-aliyun-05', 'ci-aliyun-07', 'ci-aliyun-02', 'ci-aliyun-04',
  ]
  const placements: Snapshot['entities']['placements'] = environments.map((environment, index) => {
    const application = applications.find((entry) => entry.id === environment.applicationId)!
    return {
      ...scoped, id: `placement-${environment.id.slice(4)}-workload`, applicationId: application.id,
      environmentId: environment.id, ciId: workloadIds[index], role: 'workload',
    }
  })
  placements.push(
    { ...scoped, id: 'placement-checkout-redis', applicationId: 'app-checkout', environmentId: 'env-checkout-dev', ciId: 'ci-idc-redis-01', role: 'dependency' },
    { ...scoped, id: 'placement-data-redis', applicationId: 'app-data', environmentId: 'env-data-dev', ciId: 'ci-idc-redis-01', role: 'dependency' },
  )
  const relation = (id: string, sourceCiId: string, targetCiId: string, type: 'runs_on' | 'depends_on' | 'connects_to') => ({
    ...scoped, id, sourceCiId, targetCiId, type, source: 'manual' as const, confidence: 'verified' as const,
  })
  const relations: Snapshot['entities']['relations'] = [
    relation('relation-checkout-redis', 'ci-aws-checkout-01', 'ci-idc-redis-01', 'depends_on'),
    relation('relation-data-redis', 'ci-aliyun-worker-01', 'ci-idc-redis-01', 'depends_on'),
    relation('relation-cycle-1', 'ci-aws-checkout-01', 'ci-aws-02', 'depends_on'),
    relation('relation-cycle-2', 'ci-aws-02', 'ci-aws-03', 'depends_on'),
    relation('relation-cycle-3', 'ci-aws-03', 'ci-aws-checkout-01', 'depends_on'),
    relation('relation-commerce-host', 'ci-aws-04', 'ci-aws-05', 'runs_on'),
    relation('relation-data-host', 'ci-aliyun-02', 'ci-aliyun-03', 'runs_on'),
  ]
  return { placements, relations }
}

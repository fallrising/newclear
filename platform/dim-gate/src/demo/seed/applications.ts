import type { Snapshot } from '../../domain/schemas'

const BASELINE = '2026-09-20T09:00:00Z'
const scoped = { version: 1, createdAt: BASELINE, updatedAt: BASELINE, orgId: 'org-demo' }

export function buildApplicationSeed(): Pick<Snapshot['entities'], 'applications' | 'environments'> {
  const applications: Snapshot['entities']['applications'] = [
    ['app-checkout', 'project-store', 'team-commerce', 'checkout-api', 'critical'],
    ['app-storefront', 'project-store', 'team-commerce', 'storefront-web', 'critical'],
    ['app-payments', 'project-payments', 'team-commerce', 'payments-api', 'critical'],
    ['app-data', 'project-data', 'team-data', 'data-worker', 'standard'],
    ['app-analytics', 'project-data', 'team-data', 'analytics-api', 'standard'],
    ['app-recommendations', 'project-insights', 'team-data', 'recommendation-api', 'standard'],
  ].map(([id, projectId, ownerTeamId, name, tier]) => ({
    ...scoped, id, projectId, ownerTeamId, name, slug: name, tier: tier as 'critical' | 'standard',
    description: `Synthetic demo application ${name}`,
  }))
  const environments: Snapshot['entities']['environments'] = applications.flatMap((application) =>
    (['dev', 'prod'] as const).map((stage) => ({
      ...scoped, id: `env-${application.id.slice(4)}-${stage}`, applicationId: application.id,
      name: stage, stage, status: 'ready' as const, activeReleaseId: null,
    })))
  return { applications, environments }
}

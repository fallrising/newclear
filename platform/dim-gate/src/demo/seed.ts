import { snapshotSchema, type Snapshot } from '../domain/schemas'
import { buildApplicationSeed } from './seed/applications'
import { buildCmdbSeed } from './seed/cmdb'
import { personas } from './seed/core'
import { buildTopologySeed } from './seed/topology'

export { personas } from './seed/core'

export const SEED_BASELINE = '2026-09-20T09:00:00Z'
const stamp = { version: 1, createdAt: SEED_BASELINE, updatedAt: SEED_BASELINE }
const scoped = { ...stamp, orgId: 'org-demo' }

/** M1 deterministic seed: 6 applications, 12 environments and exactly 20 CIs per provider. */
export function createSeed(sessionId: string): Snapshot {
  const applicationSeed = buildApplicationSeed()
  const cmdbSeed = buildCmdbSeed()
  const topologySeed = buildTopologySeed(applicationSeed.applications, applicationSeed.environments)
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
        { ...scoped, id: 'project-payments', teamId: 'team-commerce', name: 'Payments', slug: 'payments' },
        { ...scoped, id: 'project-data', teamId: 'team-data', name: 'Data', slug: 'data' },
        { ...scoped, id: 'project-insights', teamId: 'team-data', name: 'Insights', slug: 'insights' },
      ],
      users: personas.map((persona) => ({
        ...scoped, id: persona.id, displayName: persona.displayName, enabled: true,
        teamIds: [persona.id === 'user-rd-commerce' ? 'team-commerce' : persona.id === 'user-rd-data' ? 'team-data' : 'team-platform'],
      })),
      ...applicationSeed,
      ...cmdbSeed,
      ...topologySeed,
      assignments: [
        { ...scoped, id: 'grant-rd-commerce', userId: 'user-rd-commerce', role: 'rd', scopeType: 'project', scopeId: 'project-store' },
        { ...scoped, id: 'grant-rd-commerce-payments', userId: 'user-rd-commerce', role: 'rd', scopeType: 'project', scopeId: 'project-payments' },
        { ...scoped, id: 'grant-rd-data', userId: 'user-rd-data', role: 'rd', scopeType: 'project', scopeId: 'project-data' },
        { ...scoped, id: 'grant-rd-data-insights', userId: 'user-rd-data', role: 'rd', scopeType: 'project', scopeId: 'project-insights' },
        { ...scoped, id: 'grant-ops-store', userId: 'user-ops', role: 'ops', scopeType: 'project', scopeId: 'project-store' },
        { ...scoped, id: 'grant-ops-payments', userId: 'user-ops', role: 'ops', scopeType: 'project', scopeId: 'project-payments' },
        { ...scoped, id: 'grant-ops-data', userId: 'user-ops', role: 'ops', scopeType: 'project', scopeId: 'project-data' },
        { ...scoped, id: 'grant-ops-insights', userId: 'user-ops', role: 'ops', scopeType: 'project', scopeId: 'project-insights' },
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

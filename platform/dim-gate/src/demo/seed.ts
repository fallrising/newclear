import { snapshotSchema, type Snapshot } from '../domain/schemas'
import { buildApplicationSeed } from './seed/applications'
import { buildCmdbSeed } from './seed/cmdb'
import { personas } from './seed/core'
import { buildTopologySeed } from './seed/topology'
import { buildObservationSeed } from './seed/observations'
import { buildW3BusinessSeed } from './seed/service-delivery'
import { buildW2Assignments, buildW2BusinessSeed, buildW2Metadata } from './seed/resources'

export { personas } from './seed/core'

export const SEED_BASELINE = '2026-09-20T09:00:00Z'
const stamp = { version: 1, createdAt: SEED_BASELINE, updatedAt: SEED_BASELINE }
const scoped = { ...stamp, orgId: 'org-demo' }

/** W3 adds draft service revisions while preserving every accepted entity identity. */
export function createSeed(sessionId: string): Snapshot {
  const applicationSeed = buildApplicationSeed()
  const cmdbSeed = buildCmdbSeed()
  const topologySeed = buildTopologySeed(applicationSeed.applications, applicationSeed.environments)
  const metadata = buildW2Metadata()
  const resources = buildW2BusinessSeed(topologySeed.placements)
  return snapshotSchema.parse({
    schemaVersion: 3, seedVersion: 'dim-gate-w3-v1', sessionId, logicalClock: 0,
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
      ...resources,
      ...buildW3BusinessSeed(applicationSeed.applications),
      cis: [...cmdbSeed.cis, ...metadata.cis],
      placements: [...topologySeed.placements, ...resources.placements],
      resourceQuotas: metadata.resourceQuotas,
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
        ...buildW2Assignments(),
      ],
      navigation: [
        { ...scoped, id: 'nav-rd', routeKey: 'rd.overview', label: '研發概覽', group: '工作區', order: 10, enabled: true },
        { ...scoped, id: 'nav-rd-apps', routeKey: 'rd.apps', label: '應用與環境', group: '研發中心', order: 11, enabled: true },
        { ...scoped, id: 'nav-rd-catalog', routeKey: 'rd.catalog', label: '服務目錄', group: '研發中心', order: 12, enabled: true },
        { ...scoped, id: 'nav-rd-requests', routeKey: 'rd.requests', label: '環境申請', group: '研發中心', order: 13, enabled: true },
        { ...scoped, id: 'nav-rd-pipelines', routeKey: 'rd.pipelines', label: 'Pipeline 發布', group: '研發中心', order: 14, enabled: true },
        { ...scoped, id: 'nav-rd-observability', routeKey: 'rd.observability', label: '可觀測性', group: '研發中心', order: 15, enabled: true },
        { ...scoped, id: 'nav-ops', routeKey: 'ops.overview', label: '維運概覽', group: '工作區', order: 20, enabled: true },
        { ...scoped, id: 'nav-ops-cmdb', routeKey: 'ops.cmdb', label: 'CMDB', group: '維運中心', order: 21, enabled: true },
        { ...scoped, id: 'nav-ops-topology', routeKey: 'ops.topology', label: '依賴拓撲', group: '維運中心', order: 22, enabled: true },
        { ...scoped, id: 'nav-ops-requests', routeKey: 'ops.requests', label: '交付審批', group: '維運中心', order: 23, enabled: true },
        { ...scoped, id: 'nav-ops-jobs', routeKey: 'ops.jobs', label: '交付作業', group: '維運中心', order: 24, enabled: true },
        { ...scoped, id: 'nav-ops-capacity', routeKey: 'ops.capacity', label: '容量', group: '維運中心', order: 25, enabled: true },
        { ...scoped, id: 'nav-ops-releases', routeKey: 'ops.releases', label: '發布審批', group: '維運中心', order: 26, enabled: true },
        { ...scoped, id: 'nav-ops-incidents', routeKey: 'ops.incidents', label: '告警事件', group: '維運中心', order: 27, enabled: true },
        { ...scoped, id: 'nav-admin', routeKey: 'admin.overview', label: '平台概覽', group: '工作區', order: 30, enabled: true },
        { ...scoped, id: 'nav-admin-access', routeKey: 'admin.access', label: '角色與範圍', group: '治理', order: 31, enabled: true },
        { ...scoped, id: 'nav-admin-navigation', routeKey: 'admin.navigation', label: '導航目錄', group: '治理', order: 32, enabled: true },
        { ...scoped, id: 'nav-admin-catalog', routeKey: 'admin.catalog', label: '服務目錄', group: '治理', order: 33, enabled: true },
        { ...scoped, id: 'nav-admin-models', routeKey: 'admin.cmdb-models', label: 'CMDB 欄位', group: '治理', order: 34, enabled: true },
        { ...scoped, id: 'nav-admin-audit', routeKey: 'admin.audit', label: '管理稽核', group: '治理', order: 35, enabled: true },
        { ...scoped, id: 'nav-admin-integrations', routeKey: 'admin.integrations', label: '模擬整合', group: '治理', order: 36, enabled: true },
        { ...scoped, id: 'nav-guide', routeKey: 'guide', label: '示範控制台', group: '示範', order: 40, enabled: true },
        ...metadata.navigation,
      ],
      modelFields: [],
      catalogs: [{
        ...scoped, id: 'catalog-web', name: 'Web service environment', description: 'Synthetic compute environment for the demo workflow',
        revision: 1, status: 'published', allowedProjectIds: ['project-store', 'project-payments', 'project-data', 'project-insights'],
        template: {
          allowedProviders: ['aws', 'aliyun', 'onprem'], allowedStages: ['dev', 'staging', 'prod'],
          allowedPoolIds: ['pool-aws-sg', 'pool-aliyun-sg', 'pool-idc-sg'],
          defaults: { cpu: 2, memoryMiB: 2048 }, limits: { maxCpu: 8, maxMemoryMiB: 16384 },
          requiresApproval: true, resourceKind: 'compute', bootstrapProfile: 'web-service',
        },
      }, ...metadata.catalogs],
      catalogHistory: [],
      requests: [],
      pipelines: [], releases: [], artifacts: [], incidents: [], ...buildObservationSeed(),
    },
    observations: { buckets: [], traces: [], logs: [], recoveries: [] },
    jobs: [], deliveryLogs: [], events: [], audit: [], idempotency: [], scenarioFlags: {}, scheduler: { tasks: [] },
  })
}

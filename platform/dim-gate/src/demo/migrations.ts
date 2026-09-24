import { integrityErrors, legacyIntegrityErrors, legacyV2IntegrityErrors, legacyV3IntegrityErrors, legacyV4IntegrityErrors } from '../domain/integrity'
import { legacySnapshotSchema, legacySnapshotV2Schema, legacySnapshotV3Schema, legacySnapshotV4Schema, snapshotSchema, type LegacySnapshotV4, type Snapshot } from '../domain/schema-models'
import { buildW2Metadata } from './seed/resources'
import { buildW4Navigation } from './seed/monitoring'
import { buildNotificationSeed } from './seed/notifications'
import { demoPersonaIds } from '../domain/policy'

const seedTeamIds = new Set(['team-commerce', 'team-platform', 'team-data'])

/** Pure upgrades. Original bytes remain untouched until the controller's one atomic write. */
export function readStoredSnapshot(value: unknown): Snapshot {
  const current = snapshotSchema.safeParse(value)
  if (current.success) {
    const errors = integrityErrors(current.data)
    if (errors.length) throw new Error(`Invalid W5 relationships: ${errors.join('; ')}`)
    return current.data
  }
  const upgradeV4 = (original: LegacySnapshotV4): Snapshot => {
    const errors = legacyV4IntegrityErrors(original)
    if (errors.length) throw new Error(`Invalid W4 relationships: ${errors.join('; ')}`)
    const notificationOrgId = original.entities.organizations.some(org => org.id === 'org-demo')
      ? 'org-demo' : original.entities.organizations[0]?.id ?? 'org-demo'
    const notificationSeed = buildNotificationSeed(notificationOrgId,
      original.entities.projects.filter(project => project.orgId === notificationOrgId).map(project => project.id))
    const reserved = new Set([...notificationSeed.channels, ...notificationSeed.notificationTemplates,
      ...notificationSeed.notificationPolicies].map(row => row.id))
    if (Object.values(original.entities).some(collection => collection.some(row => reserved.has(row.id))))
      throw new Error('Legacy snapshot conflicts with reserved W5 notification identities')
    const migrated = snapshotSchema.parse({ ...original, schemaVersion: 5, seedVersion: 'dim-gate-w5-v1',
      entities: { ...original.entities,
        users: original.entities.users.map(user => ({ ...user, source: demoPersonaIds.has(user.id) ? 'seed' : 'demo' })),
        teams: original.entities.teams.map(team => ({ ...team, source: seedTeamIds.has(team.id) ? 'seed' : 'demo' })),
        platformFeatures: [], platformRoutes: [],
        ...notificationSeed,
      } })
    const migratedErrors = integrityErrors(migrated)
    if (migratedErrors.length) throw new Error(`Invalid migrated relationships: ${migratedErrors.join('; ')}`)
    return migrated
  }
  const v4 = legacySnapshotV4Schema.safeParse(value)
  if (v4.success) return upgradeV4(v4.data)
  const emptyMonitoring = { monitorPolicies: [], alertRules: [], sloPolicies: [], silences: [], alertEvaluations: [], notificationDeliveries: [], infrastructureIncidents: [] }
  const emptyDelivery = { pipelineDefinitions: [], serviceConfigs: [], trafficPolicies: [], serviceExecutions: [] }
  const v3 = legacySnapshotV3Schema.safeParse(value)
  const v2 = legacySnapshotV2Schema.safeParse(value)
  let entities: unknown
  let observations: unknown
  let original: object
  if (v3.success) {
    const errors = legacyV3IntegrityErrors(v3.data)
    if (errors.length) throw new Error(`Invalid W3 relationships: ${errors.join('; ')}`)
    original = v3.data
    entities = { ...v3.data.entities, ...emptyMonitoring }
    observations = { ...v3.data.observations, infrastructureMetrics: [] }
  } else if (v2.success) {
    const errors = legacyV2IntegrityErrors(v2.data)
    if (errors.length) throw new Error(`Invalid W2 relationships: ${errors.join('; ')}`)
    original = v2.data
    entities = { ...v2.data.entities, ...emptyDelivery, ...emptyMonitoring }
    observations = { ...v2.data.observations, infrastructureMetrics: [] }
  } else {
    const legacy = legacySnapshotSchema.parse(value)
    const errors = legacyIntegrityErrors(legacy)
    if (errors.length) throw new Error(`Invalid W1 relationships: ${errors.join('; ')}`)
    // Validate original associations BEFORE metadata could accidentally rescue them.
    if (Object.values(legacy.entities).some(collection => collection.some(entity => entity.id.startsWith('w2-')))) {
      throw new Error('Legacy snapshot conflicts with reserved W2 fixture identities')
    }
    const metadata = buildW2Metadata()
    original = legacy
    entities = {
      ...legacy.entities,
      cis: [...legacy.entities.cis, ...metadata.cis],
      catalogs: [...legacy.entities.catalogs, ...metadata.catalogs],
      navigation: [...legacy.entities.navigation, ...metadata.navigation],
      resourceQuotas: metadata.resourceQuotas,
      resourceObjects: [], resourceBindings: [], changes: [], changeExecutions: [],
      ...emptyDelivery, ...emptyMonitoring,
    }
    observations = { ...legacy.observations, infrastructureMetrics: [] }
  }
  const candidate = entities as { navigation: Array<{ id: string }>; organizations: Array<{ id: string }> }
  const navigation = buildW4Navigation(candidate.organizations[0].id)
  if (candidate.navigation.some(row => navigation.some(next => row.id === next.id))) {
    throw new Error('Legacy snapshot conflicts with reserved W4 route identities')
  }
  const migrated = legacySnapshotV4Schema.parse({ ...original, schemaVersion: 4, seedVersion: 'dim-gate-w4-v1',
    entities: { ...candidate, navigation: [...candidate.navigation, ...navigation] }, observations })
  return upgradeV4(migrated)
}

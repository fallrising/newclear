import { integrityErrors, legacyIntegrityErrors, legacyV2IntegrityErrors, legacyV3IntegrityErrors } from '../domain/integrity'
import { legacySnapshotSchema, legacySnapshotV2Schema, legacySnapshotV3Schema, snapshotSchema, type Snapshot } from '../domain/schema-models'
import { buildW2Metadata } from './seed/resources'
import { buildW4Navigation } from './seed/monitoring'

/** Pure upgrades. Original bytes remain untouched until the controller's one atomic write. */
export function readStoredSnapshot(value: unknown): Snapshot {
  const current = snapshotSchema.safeParse(value)
  if (current.success) return current.data
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
  const migrated = snapshotSchema.parse({ ...original, schemaVersion: 4, seedVersion: 'dim-gate-w4-v1',
    entities: { ...candidate, navigation: [...candidate.navigation, ...navigation] }, observations })
  const errors = integrityErrors(migrated)
  if (errors.length) throw new Error(`Invalid migrated relationships: ${errors.join('; ')}`)
  return migrated
}

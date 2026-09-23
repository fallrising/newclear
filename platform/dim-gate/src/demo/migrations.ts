import { integrityErrors, legacyIntegrityErrors, legacyV2IntegrityErrors } from '../domain/integrity'
import { legacySnapshotSchema, legacySnapshotV2Schema, snapshotSchema, type Snapshot } from '../domain/schema-models'
import { buildW2Metadata } from './seed/resources'

/** Pure upgrades. Original bytes remain untouched until the controller's one atomic write. */
export function readStoredSnapshot(value: unknown): Snapshot {
  const current = snapshotSchema.safeParse(value)
  if (current.success) return current.data
  const emptyDelivery = { pipelineDefinitions: [], serviceConfigs: [], trafficPolicies: [], serviceExecutions: [] }
  const v2 = legacySnapshotV2Schema.safeParse(value)
  let entities: unknown
  let original: object
  if (v2.success) {
    const errors = legacyV2IntegrityErrors(v2.data)
    if (errors.length) throw new Error(`Invalid W2 relationships: ${errors.join('; ')}`)
    original = v2.data
    entities = { ...v2.data.entities, ...emptyDelivery }
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
      ...emptyDelivery,
    }
  }
  const migrated = snapshotSchema.parse({ ...original, schemaVersion: 3, seedVersion: 'dim-gate-w3-v1', entities })
  const errors = integrityErrors(migrated)
  if (errors.length) throw new Error(`Invalid migrated relationships: ${errors.join('; ')}`)
  return migrated
}

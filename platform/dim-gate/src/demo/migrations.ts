import { integrityErrors, legacyIntegrityErrors } from '../domain/integrity'
import { legacySnapshotSchema, snapshotSchema, type Snapshot } from '../domain/schemas'
import { buildW2Metadata } from './seed/resources'

/**
 * Pure conversion: callers retain the original envelope bytes until validation and
 * the single storage write both succeed. Original associations are never grants.
 */
export function readStoredSnapshot(value: unknown): Snapshot {
  const current = snapshotSchema.safeParse(value)
  if (current.success) return current.data

  const legacy = legacySnapshotSchema.parse(value)
  const originalErrors = legacyIntegrityErrors(legacy)
  if (originalErrors.length) throw new Error(`Invalid legacy relationships: ${originalErrors.join('; ')}`)
  // Every W2 fixture ID is reserved. Never overwrite or silently reinterpret a
  // legacy ID, including an ID in a different collection or historical revision.
  if (Object.values(legacy.entities).some(collection => collection.some(entity => entity.id.startsWith('w2-')))) {
    throw new Error('Legacy snapshot conflicts with reserved W2 fixture identities')
  }
  const metadata = buildW2Metadata()
  const migrated = snapshotSchema.parse({
    ...legacy, schemaVersion: 2, seedVersion: 'dim-gate-w2-v1',
    entities: {
      ...legacy.entities,
      cis: [...legacy.entities.cis, ...metadata.cis],
      catalogs: [...legacy.entities.catalogs, ...metadata.catalogs],
      navigation: [...legacy.entities.navigation, ...metadata.navigation],
      resourceQuotas: metadata.resourceQuotas,
      resourceObjects: [], resourceBindings: [], changes: [], changeExecutions: [],
    },
  })
  const migratedErrors = integrityErrors(migrated)
  if (migratedErrors.length) throw new Error(`Invalid migrated relationships: ${migratedErrors.join('; ')}`)
  return migrated
}

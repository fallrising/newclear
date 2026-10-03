import { z } from 'zod'
import { featureSpecSchema } from './feature-models.ts'
import { versionSchema } from './schema-primitives.ts'

const reason = z.string().trim().min(1).max(500)
export const createFeatureInputSchema = z.strictObject({ spec: featureSpecSchema, reason })
export const reviseFeatureInputSchema = z.strictObject({ expectedVersion: versionSchema, spec: featureSpecSchema, reason })
export const featureActionInputSchema = z.strictObject({ expectedVersion: versionSchema, reason })
export const restoreFeatureInputSchema = z.strictObject({ expectedVersion: versionSchema, revision: versionSchema, reason })

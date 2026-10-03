import { z } from 'zod'

export const idSchema = z.string().min(1).max(160)
export const nameSchema = z.string().trim().min(1).max(80)
export const timestampSchema = z.iso.datetime({ offset: false })
export const versionSchema = z.number().int().min(1)
export const stageSchema = z.enum(['dev', 'staging', 'prod'])
export const scopedBase = { id: idSchema, version: versionSchema, createdAt: timestampSchema, updatedAt: timestampSchema, orgId: idSchema }

import { z } from 'zod'
import { sessionViewSchema } from '../domain/schema-models.ts'

export const personaBodySchema = z.strictObject({ personaId: z.string().min(1).max(128) })
export const resetBodySchema = z.strictObject({ confirm: z.literal(true) })
export const controlResultSchema = z.strictObject({ session: sessionViewSchema })

import type { z } from 'zod'

export interface RequestOptions {
  method?: string
  body?: unknown
  demo?: boolean
  identityControl?: boolean
}

export type ApiRequest = <T>(path: string, schema: z.ZodType<T>, options?: RequestOptions) => Promise<T>

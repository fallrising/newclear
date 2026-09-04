import { z } from 'zod';

export const dataSourceStaticSchema = z.object({
  type: z.literal('STATIC'),
  options: z.array(
    z.object({
      label: z.string().min(1),
      value: z.string().min(1),
    }),
  ),
});

export const dataSourceApiSchema = z.object({
  type: z.literal('API'),
  endpoint: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  params: z.record(z.string(), z.string()).optional(),
  responseMapping: z.object({
    labelField: z.string().min(1),
    valueField: z.string().min(1),
    descriptionField: z.string().optional(),
  }),
});

export const dataSourceSchema = z.discriminatedUnion('type', [
  dataSourceStaticSchema,
  dataSourceApiSchema,
]);

export type DataSourceValue = z.infer<typeof dataSourceSchema>;

export const validationSchema = z
  .object({
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(0).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    patternMessage: z.string().optional(),
  })
  .strict();

export type ValidationValue = z.infer<typeof validationSchema>;

export const dependsOnSchema = z.array(z.string().min(1));
export type DependsOnValue = z.infer<typeof dependsOnSchema>;

export function parseOrNull<T>(raw: string | null, schema: z.ZodType<T>): T | null {
  if (!raw || raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function isValidJsonOfShape<T>(raw: string | null, schema: z.ZodType<T>): boolean {
  if (!raw || raw.trim() === '') return true;
  try {
    return schema.safeParse(JSON.parse(raw)).success;
  } catch {
    return false;
  }
}

export function serialize<T>(value: T | null): string | null {
  if (value == null) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (typeof value === 'object' && Object.keys(value as object).length === 0) return null;
  return JSON.stringify(value);
}

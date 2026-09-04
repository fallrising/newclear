import { z } from 'zod';
import type {
  ComponentType,
  FieldConfigUpdateRequest,
  FormTarget,
  TfFieldNode,
  ValueSource,
} from '@/types/api';

export const FORM_TARGETS: FormTarget[] = ['USER_FORM', 'OPS_FORM', 'HIDDEN', 'RESULT_ONLY'];
export const VALUE_SOURCES: ValueSource[] = [
  'USER_INPUT',
  'OPS_INPUT',
  'FIXED',
  'SYSTEM_DEFAULT',
  'API_DRIVEN',
];
export const COMPONENT_TYPES: ComponentType[] = [
  'INPUT',
  'TEXTAREA',
  'NUMBER',
  'SELECT',
  'MULTI_SELECT',
  'RADIO',
  'CHECKBOX',
  'SWITCH',
  'DATE',
  'PASSWORD',
  'READONLY',
];

const jsonStringSchema = z
  .string()
  .nullable()
  .transform((v) => (v == null || v.trim() === '' ? null : v))
  .superRefine((v, ctx) => {
    if (v == null) return;
    try {
      JSON.parse(v);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JSON' });
    }
  });

const nullableString = z
  .string()
  .nullable()
  .transform((v) => (v == null || v.trim() === '' ? null : v));

export const fieldConfigUpdateSchema = z.object({
  fieldKey: z.string().min(1, '必填').max(100),
  tfPath: nullableString.pipe(z.string().max(200).nullable()),
  displayName: nullableString.pipe(z.string().max(200).nullable()),
  description: nullableString,
  groupKey: nullableString.pipe(z.string().max(50).nullable()),
  formTarget: z.enum(['USER_FORM', 'OPS_FORM', 'HIDDEN', 'RESULT_ONLY']),
  valueSource: z.enum(['FIXED', 'USER_INPUT', 'OPS_INPUT', 'SYSTEM_DEFAULT', 'API_DRIVEN']),
  componentType: z.enum([
    'INPUT',
    'TEXTAREA',
    'NUMBER',
    'SELECT',
    'MULTI_SELECT',
    'RADIO',
    'CHECKBOX',
    'SWITCH',
    'DATE',
    'PASSWORD',
    'READONLY',
  ]),
  required: z.boolean(),
  editable: z.boolean(),
  displayOrder: z.coerce.number().int().min(0),
  fixedValueJson: jsonStringSchema,
  defaultValueJson: jsonStringSchema,
  dataSourceJson: jsonStringSchema,
  validationJson: jsonStringSchema,
  dependsOnJson: jsonStringSchema,
}) satisfies z.ZodType<FieldConfigUpdateRequest, z.ZodTypeDef, unknown>;

export type FieldConfigFormValues = z.input<typeof fieldConfigUpdateSchema>;

function sanitizeFieldKey(tfPath: string): string {
  return tfPath.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 100);
}

function inferComponent(tfType: string): ComponentType {
  const t = tfType.toLowerCase();
  if (t === 'bool' || t === 'boolean') return 'SWITCH';
  if (t === 'number' || t === 'int' || t === 'float') return 'NUMBER';
  if (t.startsWith('list') || t.startsWith('set')) return 'MULTI_SELECT';
  return 'INPUT';
}

export function defaultDraftForTfField(node: TfFieldNode): FieldConfigFormValues {
  return {
    fieldKey: sanitizeFieldKey(node.tfPath),
    tfPath: node.tfPath,
    displayName: node.tfPath,
    description: node.description ?? null,
    groupKey: null,
    formTarget: 'USER_FORM',
    valueSource: 'USER_INPUT',
    componentType: inferComponent(node.tfType),
    required: node.required,
    editable: !node.computed,
    displayOrder: 0,
    fixedValueJson: null,
    defaultValueJson: null,
    dataSourceJson: null,
    validationJson: null,
    dependsOnJson: null,
  };
}

const ALLOWED: Record<FormTarget, ValueSource[]> = {
  USER_FORM: ['USER_INPUT', 'API_DRIVEN', 'SYSTEM_DEFAULT'],
  OPS_FORM: ['OPS_INPUT', 'API_DRIVEN', 'SYSTEM_DEFAULT'],
  HIDDEN: ['FIXED', 'SYSTEM_DEFAULT'],
  RESULT_ONLY: ['SYSTEM_DEFAULT'],
};

export function warnMappingMismatch(
  formTarget: FormTarget | undefined,
  valueSource: ValueSource | undefined,
): string | null {
  if (!formTarget || !valueSource) return null;
  const allowed = ALLOWED[formTarget];
  if (!allowed || allowed.includes(valueSource)) return null;
  return `${formTarget} 通常搭配 ${allowed.join(' / ')}，目前是 ${valueSource}`;
}

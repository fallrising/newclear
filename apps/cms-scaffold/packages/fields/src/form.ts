import type { WorkContentType, WorkField } from "@cms/api";

/** Field types with a W1 widget. Anything else is shown read-only and its value is never patched (surface-back §3.1). */
export const KNOWN_TYPES = ["string", "markdown", "int", "boolean", "enum", "datetime", "ref", "media-ref", "principal-ref"] as const;

export type FormValues = Record<string, unknown>;

export function isKnown(field: WorkField): boolean {
  return (KNOWN_TYPES as readonly string[]).includes(field.type);
}

/** W1 reference widgets are read-only; retain their server representation verbatim. */
export function isEditable(field: WorkField): boolean {
  return isKnown(field) && !["ref", "media-ref", "principal-ref"].includes(field.type);
}

function formValue(field: WorkField, value: unknown): unknown {
  if (!isEditable(field)) return value;
  if (field.type === "boolean") return value === null ? null : value === true;
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function payloadValue(field: WorkField, value: unknown): unknown {
  if (!isEditable(field)) return value;
  if (field.type === "boolean") return value === null ? null : value === true;
  if (typeof value !== "string" || value.trim() === "") return null;
  return field.type === "int" ? Number(value) : value;
}

/** Payload → react-hook-form values. Editable text values become strings; booleans retain null, and read-only values keep their raw representation. */
export function toFormValues(type: WorkContentType, payload: Record<string, unknown>): FormValues {
  return { ...payload, ...Object.fromEntries(type.fields.map((field) => [field.key, formValue(field, payload[field.key])])) };
}

/**
 * Form values → a full payload for create. Empty values become null (G-07), `int` becomes a number, unknown types
 * are sent back unchanged when declared and present; client-only metadata is omitted. Inverse of toFormValues for every representable payload (V2-AC-06).
 */
export function toPayload(type: WorkContentType, values: FormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of type.fields) {
    const value = payloadValue(field, values[field.key]);
    if (isEditable(field) || value !== undefined) payload[field.key] = value;
  }
  return payload;
}

/** Only editable fields whose form value changed, encoded as in toPayload. PATCH merges, so nothing else changes (C-05). */
export function diffPayload(type: WorkContentType, initial: FormValues, values: FormValues): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const field of type.fields) {
    if (!isEditable(field)) continue;
    if (values[field.key] !== initial[field.key]) changes[field.key] = payloadValue(field, values[field.key]);
  }
  return changes;
}

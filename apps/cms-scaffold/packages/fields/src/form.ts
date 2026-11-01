import type { WorkContentType, WorkField } from "@cms/api";

/** Field types with a W1 widget. Anything else is shown read-only and its value is never patched (surface-back §3.1). */
export const KNOWN_TYPES = ["string", "markdown", "int", "boolean", "enum", "datetime", "ref", "media-ref", "principal-ref"] as const;

export type FormValues = Record<string, unknown>;

export function isKnown(field: WorkField): boolean {
  return (KNOWN_TYPES as readonly string[]).includes(field.type);
}

/** Only writable widgets participate in PATCH; read-only and unknown fields remain intact. */
export function isEditable(field: WorkField): boolean {
  return isKnown(field) && field.type !== "principal-ref" && (field.type !== "ref" || !!field.refTarget);
}

function formValue(field: WorkField, value: unknown): unknown {
  if (!isEditable(field)) return value;
  if (field.type === "ref" || field.type === "media-ref") return value;
  if (field.type === "boolean") return value === null ? null : value === true;
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function payloadValue(field: WorkField, value: unknown): unknown {
  if (!isEditable(field)) return value;
  if (field.type === "ref" || field.type === "media-ref") return typeof value === "string" && value.trim() === "" ? null : value;
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
    if (value !== undefined || (isEditable(field) && !["ref", "media-ref"].includes(field.type))) payload[field.key] = value;
  }
  return payload;
}

function mediaIdentity(value: unknown): unknown {
  return value && typeof value === "object" && "mediaId" in value ? value.mediaId : value;
}

/** Only editable fields whose form value changed, encoded as in toPayload. PATCH merges, so nothing else changes (C-05). */
export function diffPayload(type: WorkContentType, initial: FormValues, values: FormValues): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const field of type.fields) {
    if (!isEditable(field)) continue;
    const before = initial[field.key];
    const after = values[field.key];
    // react-hook-form clones nested defaults. A media projection and its chosen id denote the same value.
    const changed = field.type === "media-ref" ? mediaIdentity(before) !== mediaIdentity(after) : before !== after;
    if (changed) changes[field.key] = payloadValue(field, after);
  }
  return changes;
}

import type { WorkContentType, WorkField } from "@cms/api";
import { fieldsCopy } from "./copy";

/**
 * Turns a field or type key into a readable label until the API provides labels (G-05, G-06):
 * "sortOrder" → "Sort order", "clinic_profile" → "Clinic profile", "in_progress" → "In progress".
 */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/** G-05: the API label, else the humanized key. */
export function fieldLabel(field: WorkField): string {
  return field.label ?? humanizeKey(field.key);
}

/** G-06: the API enum label, else the humanized value. */
export function enumLabel(field: WorkField, value: string): string {
  return field.enumLabels[value] ?? humanizeKey(value);
}

const BUILT_IN = ["main", "media", "settings"] as const;

export interface FieldGroup {
  key: string;
  label: string;
  fields: WorkField[];
}

function groupLabel(key: string): string {
  return key === "main" || key === "media" || key === "settings" || key === "relations"
    ? fieldsCopy[`fields.group.${key}`]
    : humanizeKey(key);
}

/**
 * 01 §7.2 B-S3: main-column cards in the order main, media, settings, then custom groups (by first appearance);
 * the titleField first inside main. `relations` is returned separately for the side column. Null group means main.
 */
export function groupFields(type: WorkContentType): { main: FieldGroup[]; relations: FieldGroup | null } {
  const sorted = [...type.fields].sort((a, b) => a.order - b.order);
  const byGroup = new Map<string, WorkField[]>();
  for (const field of sorted) {
    const key = field.group ?? "main";
    byGroup.set(key, [...(byGroup.get(key) ?? []), field]);
  }
  const main = byGroup.get("main") ?? [];
  byGroup.set("main", [...main.filter((f) => f.key === type.titleField), ...main.filter((f) => f.key !== type.titleField)]);
  const custom = [...byGroup.keys()].filter((key) => !BUILT_IN.includes(key as (typeof BUILT_IN)[number]) && key !== "relations");
  const groups = [...BUILT_IN, ...custom]
    .filter((key) => (byGroup.get(key) ?? []).length > 0)
    .map((key) => ({ key, label: groupLabel(key), fields: byGroup.get(key)! }));
  const relations = byGroup.get("relations");
  return { main: groups, relations: relations ? { key: "relations", label: groupLabel("relations"), fields: relations } : null };
}

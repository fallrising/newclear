// @cms/fields — field type → widget registry, zod builder and formatting (01 §6.4). W0 creates the
// package; W1 adds FieldWidget, buildZod, toFormValues and toPayload.

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

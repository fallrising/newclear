import type { PublicListParams } from "./keys";

// `ref.<fieldKey>` is documented in the operation descriptions, but OpenAPI 3.0 cannot name a
// parameter pattern, so it is absent from the generated query type. This is the only place that adds it.
export function listQuery<Q extends object>(typed: Q, params: PublicListParams): Q {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(typed)) {
    if (typeof value === "string" && value !== "") query[key] = value;
  }
  for (const [field, id] of Object.entries(params.ref ?? {})) {
    if (id !== "") query[`ref.${field}`] = id;
  }
  return query as Q;
}

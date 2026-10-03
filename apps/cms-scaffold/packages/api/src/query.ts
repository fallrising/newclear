import type { PublicListParams } from "./keys";
import { ApiError } from "./errors";

// Dynamic filter/ref names cannot be expressed as named OpenAPI 3.0 parameters.
export function listQuery<Q extends object>(typed: Q, params: PublicListParams): Q {
  const query: Record<string, string | number | boolean | readonly string[]> = {};
  for (const [key, value] of Object.entries(typed)) {
    if (value !== undefined && value !== "") query[key] = value;
  }
  for (const [field, value] of Object.entries(params.filter ?? {})) query[`filter.${field}`] = value;
  for (const [field, ids] of Object.entries(params.ref ?? {})) {
    const values = (typeof ids === "string" ? [ids] : ids).filter((id) => id.trim() !== "");
    if (values.length) query[`ref.${field}`] = values;
  }
  return query as Q;
}

type Page<T> = { items: T[]; total: number; page: number; size: number; offset: number; limit: number };
/** Compatibility for consumers needing a full list until their explicit paging UI arrives. */
export async function completeList<T extends { id: string }>(fetchPage: (page: number) => Promise<Page<T>>, signal?: AbortSignal): Promise<{ items: T[]; total: number }> {
  const items: T[] = [];
  const ids = new Set<string>();
  let total: number | undefined;
  for (let page = 1; ; page++) {
    signal?.throwIfAborted();
    const result = await fetchPage(page);
    signal?.throwIfAborted();
    const invalid = () => new ApiError(200, "INVALID_RESPONSE", "Incomplete or inconsistent list page");
    if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page || result.size !== 100 || result.offset !== (page - 1) * 100 || result.limit !== 100 || result.items.length > 100) throw invalid();
    total ??= result.total;
    if (total !== result.total || items.length + result.items.length > total) throw invalid();
    for (const item of result.items) {
      if (!item || typeof item.id !== "string" || ids.has(item.id)) throw invalid();
      ids.add(item.id); items.push(item);
    }
    if (items.length === total) return { items, total };
    if (result.items.length !== 100) throw invalid();
  }
}

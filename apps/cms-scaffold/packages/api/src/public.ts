import { queryOptions } from "@tanstack/react-query";
import type { Transport } from "./core";
import { keys, type PublicListParams } from "./keys";
import { listQuery } from "./query";
import type { PublicEntry, PublicEntryPage } from "./schema";

export function publicApi(t: Transport) {
  return {
    entries(type: string, params: PublicListParams = {}, signal?: AbortSignal): Promise<PublicEntryPage> {
      return t.call(() =>
        t.client.GET("/api/v1/public/content-types/{typeKey}/entries", {
          params: { path: { typeKey: type }, query: listQuery({ q: params.q }, params) },
          signal,
        }),
      );
    },
    bySlug(type: string, slug: string, signal?: AbortSignal): Promise<PublicEntry> {
      return t.call(() =>
        t.client.GET("/api/v1/public/content-types/{typeKey}/slugs/{slug}", {
          params: { path: { typeKey: type, slug } },
          signal,
        }),
      );
    },
    byId(type: string, id: string, signal?: AbortSignal): Promise<PublicEntry> {
      return t.call(() =>
        t.client.GET("/api/v1/public/content-types/{typeKey}/entries/{id}", {
          params: { path: { typeKey: type, id } },
          signal,
        }),
      );
    },
  };
}

export type PublicApi = ReturnType<typeof publicApi>;

export const publicQueries = {
  entries: (api: PublicApi, type: string, params: PublicListParams = {}) =>
    queryOptions({ queryKey: keys.public.entries(type, params), queryFn: ({ signal }) => api.entries(type, params, signal) }),
  bySlug: (api: PublicApi, type: string, slug: string) =>
    queryOptions({ queryKey: keys.public.bySlug(type, slug), queryFn: ({ signal }) => api.bySlug(type, slug, signal) }),
  byId: (api: PublicApi, type: string, id: string) =>
    queryOptions({ queryKey: keys.public.byId(type, id), queryFn: ({ signal }) => api.byId(type, id, signal) }),
};

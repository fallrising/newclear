import { queryOptions } from "@tanstack/react-query";
import type { Transport } from "./core";
import { keys, type WorkListParams } from "./keys";
import { listQuery } from "./query";
import type { EntryWriteRequest, MediaAsset, WorkContentType, WorkContentTypeList, WorkEntry, WorkEntryPage } from "./schema";

export function workApi(t: Transport) {
  return {
    types(signal?: AbortSignal): Promise<WorkContentTypeList> {
      return t.call(() => t.client.GET("/api/v1/content-types", { signal }));
    },
    type(type: string, signal?: AbortSignal): Promise<WorkContentType> {
      return t.call(() => t.client.GET("/api/v1/content-types/{typeKey}", { params: { path: { typeKey: type } }, signal }));
    },
    entries(type: string, params: WorkListParams = {}, signal?: AbortSignal): Promise<WorkEntryPage> {
      return t.call(() =>
        t.client.GET("/api/v1/content-types/{typeKey}/entries", {
          params: { path: { typeKey: type }, query: listQuery({ q: params.q, state: params.state }, params) },
          signal,
        }),
      );
    },
    entry(id: string, signal?: AbortSignal): Promise<WorkEntry> {
      return t.call(() => t.client.GET("/api/v1/entries/{id}", { params: { path: { id } }, signal }));
    },
    create(type: string, body: EntryWriteRequest): Promise<WorkEntry> {
      return t.call(() => t.client.POST("/api/v1/content-types/{typeKey}/entries", { params: { path: { typeKey: type } }, body }));
    },
    patch(id: string, body: EntryWriteRequest): Promise<WorkEntry> {
      return t.call(() => t.client.PATCH("/api/v1/entries/{id}", { params: { path: { id } }, body }));
    },
    publish(id: string): Promise<WorkEntry> {
      return t.call(() => t.client.POST("/api/v1/entries/{id}/publish", { params: { path: { id } } }));
    },
    unpublish(id: string): Promise<WorkEntry> {
      return t.call(() => t.client.POST("/api/v1/entries/{id}/unpublish", { params: { path: { id } } }));
    },
    archive(id: string): Promise<WorkEntry> {
      return t.call(() => t.client.POST("/api/v1/entries/{id}/archive", { params: { path: { id } } }));
    },
    upload(file: File, title?: string): Promise<MediaAsset> {
      const form = new FormData();
      form.append("file", file);
      if (title) form.append("title", title);
      return t.call(() =>
        t.client.POST("/api/v1/media", {
          // MediaUploadRequest is multipart; openapi-fetch sends a FormData body unchanged.
          body: form as unknown as { file: string },
          bodySerializer: (body) => body as unknown as FormData,
        }),
      );
    },
  };
}

export type WorkApi = ReturnType<typeof workApi>;

export const workQueries = {
  types: (api: WorkApi) => queryOptions({ queryKey: keys.types.list(), queryFn: ({ signal }) => api.types(signal) }),
  type: (api: WorkApi, type: string) =>
    queryOptions({ queryKey: keys.types.detail(type), queryFn: ({ signal }) => api.type(type, signal) }),
  entries: (api: WorkApi, type: string, params: WorkListParams = {}) =>
    queryOptions({ queryKey: keys.entries.list(type, params), queryFn: ({ signal }) => api.entries(type, params, signal) }),
  entry: (api: WorkApi, id: string) =>
    queryOptions({ queryKey: keys.entries.detail(id), queryFn: ({ signal }) => api.entry(id, signal) }),
};

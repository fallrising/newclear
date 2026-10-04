import { queryOptions } from "@tanstack/react-query";
import type { Transport } from "./core";
import { keys, type WorkListParams } from "./keys";
import { completeList, listQuery } from "./query";
import type { BatchPatchRequest, EntryPatchRequest, EntryWriteRequest, MediaAsset, MediaAssetList, MediaQuota, RevisionList, WorkEntryList, WorkContentType, WorkContentTypeList, WorkEntry, WorkEntryPage } from "./schema";

export function workApi(t: Transport) {
  return {
    types(signal?: AbortSignal): Promise<WorkContentTypeList> {
      return t.call(() => t.client.GET("/api/v1/content-types", { signal }));
    },
    type(type: string, signal?: AbortSignal): Promise<WorkContentType> {
      return t.call(() => t.client.GET("/api/v1/content-types/{typeKey}", { params: { path: { typeKey: type } }, signal }));
    },
    allEntries(type: string, params: Omit<WorkListParams, "page" | "size"> = {}, signal?: AbortSignal) {
      return completeList((page) => this.entries(type, { ...params, page, size: 100 }, signal), signal);
    },
    entries(type: string, params: WorkListParams = {}, signal?: AbortSignal): Promise<WorkEntryPage> {
      return t.call(() =>
        t.client.GET("/api/v1/content-types/{typeKey}/entries", {
          params: { path: { typeKey: type }, query: listQuery({ q: params.q, state: params.state, page: params.page, size: params.size, sort: params.sort, publishRequested: params.publishRequested, include: params.include }, params) },
          signal,
        }),
      );
    },
    entry(id: string, signal?: AbortSignal): Promise<WorkEntry> {
      return t.call(() => t.client.GET("/api/v1/entries/{id}", { params: { path: { id } }, signal }));
    },
    preview(id: string, signal?: AbortSignal): Promise<WorkEntry> {
      return t.call(() => t.client.GET("/api/v1/preview/entries/{id}", { params: { path: { id } }, signal }));
    },
    create(type: string, body: EntryWriteRequest): Promise<WorkEntry> {
      return t.call(() => t.client.POST("/api/v1/content-types/{typeKey}/entries", { params: { path: { typeKey: type } }, body }));
    },
    patch(id: string, body: EntryPatchRequest): Promise<WorkEntry> {
      return t.call(() => t.client.PATCH("/api/v1/entries/{id}", { params: { path: { id } }, body }));
    },
    batchPatch(items: BatchPatchRequest["items"]): Promise<WorkEntryList> {
      return t.call(() => t.client.POST("/api/v1/entries:batch-patch", { body: { items } }));
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
    restore(id: string): Promise<WorkEntry> {
      return t.call(() => t.client.POST("/api/v1/entries/{id}/restore", { params: { path: { id } } }));
    },
    /** Request publication of the saved work copy. */
    requestPublish(id: string): Promise<WorkEntry> {
      return t.call(() => t.client.POST("/api/v1/entries/{id}/publish-request", { params: { path: { id } } }));
    },
    /** 撤回發布請求. Without a request the entry is returned unchanged. */
    cancelPublishRequest(id: string): Promise<WorkEntry> {
      return t.call(() => t.client.DELETE("/api/v1/entries/{id}/publish-request", { params: { path: { id } } }));
    },
    /** Soft delete ("移到回收"). */
    remove(id: string): Promise<void> {
      return t.call(() => t.client.DELETE("/api/v1/entries/{id}", { params: { path: { id } } }));
    },
    revisions(id: string, signal?: AbortSignal): Promise<RevisionList> {
      return t.call(() => t.client.GET("/api/v1/entries/{id}/revisions", { params: { path: { id } }, signal }));
    },
    /** Copies the revision payload into the work copy; the published copy is unchanged. */
    revert(id: string, revisionNo: number): Promise<WorkEntry> {
      return t.call(() =>
        t.client.POST("/api/v1/entries/{id}/revisions/{revisionNo}/revert", { params: { path: { id, revisionNo } } }),
      );
    },
    /** The whole library, newest first (not paged by the API). Needs manage_media. */
    mediaList(signal?: AbortSignal): Promise<MediaAssetList> {
      return t.call(() => t.client.GET("/api/v1/media", { signal }));
    },
    mediaQuota(signal?: AbortSignal): Promise<MediaQuota> {
      return t.call(() => t.client.GET("/api/v1/media/quota", { signal }));
    },
    media(id: string, signal?: AbortSignal): Promise<MediaAsset> {
      return t.call(() => t.client.GET("/api/v1/media/{id}", { params: { path: { id } }, signal }));
    },
    removeMedia(id: string): Promise<void> {
      return t.call(() => t.client.DELETE("/api/v1/media/{id}", { params: { path: { id } } }));
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
  allEntries: (api: WorkApi, type: string, params: Omit<WorkListParams, "page" | "size"> = {}) =>
    queryOptions({ queryKey: keys.entries.allEntries(type, params), queryFn: ({ signal }) => api.allEntries(type, params, signal) }),
  entries: (api: WorkApi, type: string, params: WorkListParams = {}) =>
    queryOptions({ queryKey: keys.entries.list(type, params), queryFn: ({ signal }) => api.entries(type, params, signal) }),
  preview: (api: WorkApi, id: string) =>
    queryOptions({ queryKey: keys.entries.preview(id), queryFn: ({ signal }) => api.preview(id, signal), staleTime: 0 }),
  revisions: (api: WorkApi, id: string) =>
    queryOptions({ queryKey: keys.entries.revisions(id), queryFn: ({ signal }) => api.revisions(id, signal), staleTime: 0 }),
  mediaList: (api: WorkApi) => queryOptions({ queryKey: keys.media.list(), queryFn: ({ signal }) => api.mediaList(signal) }),
  mediaQuota: (api: WorkApi) => queryOptions({ queryKey: keys.media.quota(), queryFn: ({ signal }) => api.mediaQuota(signal), staleTime: 30_000 }),
  media: (api: WorkApi, id: string) =>
    queryOptions({ queryKey: keys.media.detail(id), queryFn: ({ signal }) => api.media(id, signal) }),
  entry: (api: WorkApi, id: string) =>
    queryOptions({ queryKey: keys.entries.detail(id), queryFn: ({ signal }) => api.entry(id, signal) }),
};

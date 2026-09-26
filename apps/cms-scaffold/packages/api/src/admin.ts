import { queryOptions } from "@tanstack/react-query";
import type { Transport } from "./core";
import { keys } from "./keys";
import type { AdminContentType, AdminContentTypeList, PrincipalList } from "./schema";

export function adminApi(t: Transport) {
  return {
    principals(signal?: AbortSignal): Promise<PrincipalList> {
      return t.call(() => t.client.GET("/api/v1/principals", { signal }));
    },
    types(signal?: AbortSignal): Promise<AdminContentTypeList> {
      return t.call(() => t.client.GET("/api/v1/admin/content-types", { signal }));
    },
    enableType(type: string): Promise<AdminContentType> {
      return t.call(() => t.client.POST("/api/v1/admin/content-types/{typeKey}/enable", { params: { path: { typeKey: type } } }));
    },
    disableType(type: string): Promise<AdminContentType> {
      return t.call(() => t.client.POST("/api/v1/admin/content-types/{typeKey}/disable", { params: { path: { typeKey: type } } }));
    },
  };
}

export type AdminApi = ReturnType<typeof adminApi>;

export const adminQueries = {
  principals: (api: AdminApi) => queryOptions({ queryKey: keys.admin.principals(), queryFn: ({ signal }) => api.principals(signal) }),
  types: (api: AdminApi) => queryOptions({ queryKey: keys.admin.types(), queryFn: ({ signal }) => api.types(signal) }),
};

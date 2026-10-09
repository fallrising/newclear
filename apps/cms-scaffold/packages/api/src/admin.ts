import { queryOptions } from "@tanstack/react-query";
import type { Transport } from "./core";
import { keys, type AuditQuery } from "./keys";
import type {
  AdminContentType,
  AdminContentTypeList,
  AuditEventDetail,
  AuditEventPage,
  AuditSettings,
  CreatedPrincipal,
  CreatePrincipalRequest,
  EffectivePermissionList,
  PatchPrincipalRequest,
  PermissionInput,
  PermissionList,
  Principal,
  PrincipalList,
  PurgeEntryRequest,
  RoleAssignmentInput,
  RoleList,
  TemporaryPassword,
} from "./schema";

export type RetentionDays = AuditSettings["retentionDays"];

function auditParams(query: AuditQuery) {
  const out: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    out[name] = value as string | number;
  }
  return out;
}

export function adminApi(t: Transport) {
  return {
    principals(signal?: AbortSignal): Promise<PrincipalList> {
      return t.call(() => t.client.GET("/api/v1/principals", { signal }));
    },
    principal(id: string, signal?: AbortSignal): Promise<Principal> {
      return t.call(() => t.client.GET("/api/v1/principals/{id}", { params: { path: { id } }, signal }));
    },
    /** The server generates the temporary password when none is sent; it is returned once. */
    createPrincipal(body: CreatePrincipalRequest): Promise<CreatedPrincipal> {
      return t.call(() => t.client.POST("/api/v1/principals", { body }));
    },
    patchPrincipal(id: string, body: PatchPrincipalRequest): Promise<Principal> {
      return t.call(() => t.client.PATCH("/api/v1/principals/{id}", { params: { path: { id } }, body }));
    },
    disablePrincipal(id: string): Promise<Principal> {
      return t.call(() => t.client.POST("/api/v1/principals/{id}/disable", { params: { path: { id } } }));
    },
    unlockPrincipal(id: string): Promise<Principal> {
      return t.call(() => t.client.POST("/api/v1/principals/{id}/unlock", { params: { path: { id } } }));
    },
    /** Replaces every role assignment (204). */
    replacePrincipalRoles(id: string, roles: RoleAssignmentInput[]): Promise<void> {
      return t.call(() => t.client.PUT("/api/v1/principals/{id}/roles", { params: { path: { id } }, body: roles }));
    },
    /** Sets a server-generated temporary password and signs the principal out everywhere. */
    resetPassword(id: string): Promise<TemporaryPassword> {
      return t.call(() => t.client.POST("/api/v1/principals/{id}/password", { params: { path: { id } }, body: {} }));
    },
    effectivePermissions(id: string, signal?: AbortSignal): Promise<EffectivePermissionList> {
      return t.call(() => t.client.GET("/api/v1/principals/{id}/effective-permissions", { params: { path: { id } }, signal }));
    },
    roles(signal?: AbortSignal): Promise<RoleList> {
      return t.call(() => t.client.GET("/api/v1/roles", { signal }));
    },
    rolePermissions(code: string, signal?: AbortSignal): Promise<PermissionList> {
      return t.call(() => t.client.GET("/api/v1/roles/{code}/permissions", { params: { path: { code } }, signal }));
    },
    /** Replaces the whole grant list of the role (204; surface-admin §4.4: never one cell at a time). */
    replaceRolePermissions(code: string, permissions: PermissionInput[]): Promise<void> {
      return t.call(() => t.client.PUT("/api/v1/roles/{code}/permissions", { params: { path: { code } }, body: permissions }));
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
    /** Hard delete with an audit event (admin role only, 204). */
    purgeEntry(id: string, body?: PurgeEntryRequest): Promise<void> {
      return t.call(() => t.client.POST("/api/v1/admin/entries/{id}/purge", { params: { path: { id } }, body }), { retryCsrf: false });
    },
    audit(query: AuditQuery = {}, signal?: AbortSignal): Promise<AuditEventPage> {
      return t.call(() => t.client.GET("/api/v1/admin/audit", { params: { query: auditParams(query) }, signal }));
    },
    auditEvent(id: string, signal?: AbortSignal): Promise<AuditEventDetail> {
      return t.call(() => t.client.GET("/api/v1/admin/audit/{id}", { params: { path: { id } }, signal }));
    },
    auditSettings(signal?: AbortSignal): Promise<AuditSettings> {
      return t.call(() => t.client.GET("/api/v1/admin/settings/audit", { signal }));
    },
    patchAuditSettings(retentionDays: RetentionDays): Promise<AuditSettings> {
      return t.call(() => t.client.PATCH("/api/v1/admin/settings/audit", { body: { retentionDays } }));
    },
  };
}

export type AdminApi = ReturnType<typeof adminApi>;

export const adminQueries = {
  principals: (api: AdminApi) => queryOptions({ queryKey: keys.admin.principals(), queryFn: ({ signal }) => api.principals(signal) }),
  principal: (api: AdminApi, id: string) =>
    queryOptions({ queryKey: keys.admin.principal(id), queryFn: ({ signal }) => api.principal(id, signal) }),
  effectivePermissions: (api: AdminApi, id: string) =>
    queryOptions({ queryKey: keys.admin.effectivePermissions(id), queryFn: ({ signal }) => api.effectivePermissions(id, signal) }),
  roles: (api: AdminApi) => queryOptions({ queryKey: keys.admin.roles(), queryFn: ({ signal }) => api.roles(signal) }),
  rolePermissions: (api: AdminApi, code: string) =>
    queryOptions({ queryKey: keys.admin.rolePermissions(code), queryFn: ({ signal }) => api.rolePermissions(code, signal) }),
  types: (api: AdminApi) => queryOptions({ queryKey: keys.admin.types(), queryFn: ({ signal }) => api.types(signal) }),
  audit: (api: AdminApi, query: AuditQuery) =>
    queryOptions({ queryKey: keys.admin.audit(query), queryFn: ({ signal }) => api.audit(query, signal) }),
  auditEvent: (api: AdminApi, id: string) =>
    queryOptions({ queryKey: keys.admin.auditEvent(id), queryFn: ({ signal }) => api.auditEvent(id, signal) }),
  auditSettings: (api: AdminApi) =>
    queryOptions({ queryKey: keys.admin.auditSettings(), queryFn: ({ signal }) => api.auditSettings(signal) }),
};

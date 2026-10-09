import { http, HttpResponse } from "msw";
import type {
  AdminContentType,
  AdminContentTypeList,
  AuditEventDetail,
  AuditEventPage,
  AuditSettings,
  CmsAction,
  CreatedPrincipal,
  CreatePrincipalRequest,
  EffectivePermissionList,
  MediaQuota,
  PatchPrincipalRequest,
  Permission,
  PermissionInput,
  PermissionList,
  Principal,
  PrincipalList,
  RoleAssignment,
  RoleAssignmentInput,
  RoleList,
  Surface,
  TemporaryPassword,
} from "@cms/api";
import { db } from "../db";
import { mediaQuota, roles } from "../fixtures.gen";
import { canGlobal, currentUser, requireAdmin, requireGovernance, requireWork } from "../guards";
import { apiError } from "../respond";
import { getState } from "../state";

const GOVERNANCE: CmsAction[] = ["manage_types", "manage_principals", "manage_settings", "read_audit"];
const ACTIONS: CmsAction[] = [
  "read_published", "read_draft", "create", "update", "publish", "unpublish", "delete", "archive",
  "manage_media", "manage_types", "manage_principals", "manage_settings", "read_audit",
];
const SURFACES: Surface[] = ["front", "back", "admin"];
const USERNAME = /^[a-z0-9._-]{3,32}$/;
const RETENTION = [30, 90, 365];

function bad(message: string) {
  return apiError(400, "VALIDATION_FAILED", message);
}

function principalOf(id: string): Principal | undefined {
  return db.principals.find((p) => p.id === id);
}

function missingPrincipal() {
  return apiError(404, "PRINCIPAL_NOT_FOUND", "Principal not found");
}

/** Active principals holding the admin role, after applying `change` to one of them (identity: LAST_ADMIN). */
function activeAdminsAfter(id: string, status: Principal["status"], assignments: RoleAssignment[]) {
  return db.principals.filter((p) => {
    const s = p.id === id ? status : p.status;
    const r = p.id === id ? assignments : (db.principalRoles[p.id] ?? []);
    return s === "active" && r.some((a) => a.code === "admin");
  }).length;
}

function lastAdmin() {
  return apiError(403, "LAST_ADMIN", "The change would leave no active admin");
}

function temporary(given: unknown): string {
  if (typeof given === "string") return given;
  db.governanceSequence += 1;
  return `mock-temporary-password-${db.governanceSequence}`;
}

function defaultSurfaces(action: CmsAction): Surface[] {
  if (action === "read_published") return ["front", "back", "admin"];
  if (GOVERNANCE.includes(action)) return ["admin"];
  return ["back", "admin"];
}

/** Admin API rules of BW5: governance actions, LAST_ADMIN, PRINCIPAL_NOT_FOUND, retention (§5.4 of W4.md). */
export const adminHandlers = [
  http.get("*/api/v1/principals", () => {
    const user = requireGovernance("manage_principals");
    if (user instanceof Response) return user;
    const empty = getState().scenario === "empty";
    const items = empty ? [] : [...db.principals].sort((a, b) => a.username.localeCompare(b.username));
    return HttpResponse.json<PrincipalList>({ items, page: 0, size: items.length, total: items.length });
  }),

  http.post("*/api/v1/principals", async ({ request }) => {
    const user = requireGovernance("manage_principals");
    if (user instanceof Response) return user;
    const body = (await request.json()) as CreatePrincipalRequest;
    if (typeof body.username !== "string" || !USERNAME.test(body.username)) return bad("username must match ^[a-z0-9._-]{3,32}$");
    if (db.principals.some((p) => p.username === body.username)) return bad("username is taken");
    if ([...(body.displayName ?? "")].length > 80) return bad("displayName is longer than 80");
    const email = body.email ?? null;
    if (email != null && [...email].length > 254) return bad("email is longer than 254");
    if (email && db.principals.some((p) => p.email?.toLowerCase() === email.toLowerCase())) return bad("email is already used");
    if (typeof body.temporaryPassword === "string" && body.temporaryPassword.length < 12) return bad("temporaryPassword is shorter than 12");
    db.governanceSequence += 1;
    const principal: Principal = {
      id: `10000000-0000-4000-8000-${String(100 + db.governanceSequence).padStart(12, "0")}`,
      username: body.username,
      displayName: body.displayName?.trim() ? body.displayName : body.username,
      email,
      status: "active",
    };
    db.principals.push(principal);
    db.principalRoles[principal.id] = [];
    return HttpResponse.json<CreatedPrincipal>({ ...principal, temporaryPassword: temporary(body.temporaryPassword) }, { status: 201 });
  }),

  // Not an admin route: let the next handler (or the 404 fallback) answer instead of ":id" below.
  http.get("*/api/v1/principals/assignable", () => undefined),

  http.get("*/api/v1/principals/:id", ({ params }) => {
    const user = requireGovernance("manage_principals");
    if (user instanceof Response) return user;
    const principal = principalOf(String(params.id));
    return principal ? HttpResponse.json<Principal>(principal) : missingPrincipal();
  }),

  http.patch("*/api/v1/principals/:id", async ({ request, params }) => {
    const user = requireGovernance("manage_principals");
    if (user instanceof Response) return user;
    const principal = principalOf(String(params.id));
    if (!principal) return missingPrincipal();
    const body = (await request.json()) as PatchPrincipalRequest;
    if (body.status != null && !["active", "disabled", "locked"].includes(body.status)) return bad("status is not a PrincipalStatus");
    if (body.displayName != null && [...body.displayName].length > 80) return bad("displayName is longer than 80");
    if (body.email != null && [...body.email].length > 254) return bad("email is longer than 254");
    if (body.email && db.principals.some((p) => p.id !== principal.id && p.email?.toLowerCase() === body.email!.toLowerCase())) {
      return bad("email is already used");
    }
    const status = body.status ?? principal.status;
    if (status === "disabled" && principal.id === user.principal.id) return apiError(403, "SELF_DISABLE_FORBIDDEN", "Cannot disable your own account");
    if (activeAdminsAfter(principal.id, status, db.principalRoles[principal.id] ?? []) === 0) return lastAdmin();
    if (body.displayName != null) principal.displayName = body.displayName;
    if (body.email != null) principal.email = body.email;
    principal.status = status;
    return HttpResponse.json<Principal>(principal);
  }),

  http.post("*/api/v1/principals/:id/disable", ({ params }) => {
    const user = requireGovernance("manage_principals");
    if (user instanceof Response) return user;
    const principal = principalOf(String(params.id));
    if (!principal) return missingPrincipal();
    if (principal.id === user.principal.id) return apiError(403, "SELF_DISABLE_FORBIDDEN", "Cannot disable your own account");
    if (activeAdminsAfter(principal.id, "disabled", db.principalRoles[principal.id] ?? []) === 0) return lastAdmin();
    principal.status = "disabled";
    return HttpResponse.json<Principal>(principal);
  }),

  http.post("*/api/v1/principals/:id/unlock", ({ params }) => {
    const user = requireGovernance("manage_principals");
    if (user instanceof Response) return user;
    const principal = principalOf(String(params.id));
    if (!principal) return missingPrincipal();
    if (principal.status === "disabled") return apiError(403, "ACCOUNT_DISABLED", "A disabled principal cannot be unlocked");
    principal.status = "active";
    return HttpResponse.json<Principal>(principal);
  }),

  http.put("*/api/v1/principals/:id/roles", async ({ request, params }) => {
    const user = requireGovernance("manage_principals");
    if (user instanceof Response) return user;
    const principal = principalOf(String(params.id));
    if (!principal) return missingPrincipal();
    const body = (await request.json()) as RoleAssignmentInput[];
    if (!Array.isArray(body)) return bad("body must be an array");
    const codes = body.map((r) => r.code);
    if (codes.some((c) => !c)) return bad("role code is required");
    if (new Set(codes).size !== codes.length) return bad("role code is repeated");
    if (codes.some((c) => !roles.items.some((r) => r.code === c))) return bad("unknown role");
    const next: RoleAssignment[] = body.map((r) => ({ code: r.code, contentTypeCodes: r.contentTypeCodes ?? [] }));
    if (next.some((r) => (r.code === "editor" || r.code === "operator") && r.contentTypeCodes.length === 0)) {
      return bad("editor and operator need contentTypeCodes");
    }
    if (principal.id === user.principal.id && (db.principalRoles[principal.id] ?? []).some((role) => role.code === "admin")
        && !next.some((role) => role.code === "admin")) return apiError(403, "SELF_DEMOTION_FORBIDDEN", "Cannot remove your own admin role");
    if (activeAdminsAfter(principal.id, principal.status, next) === 0) return lastAdmin();
    db.principalRoles[principal.id] = next;
    return new HttpResponse(null, { status: 204 });
  }),

  http.post("*/api/v1/principals/:id/password", async ({ request, params }) => {
    const user = requireGovernance("manage_principals");
    if (user instanceof Response) return user;
    const principal = principalOf(String(params.id));
    if (!principal) return missingPrincipal();
    const text = await request.text();
    const given = text ? (JSON.parse(text) as { temporaryPassword?: unknown }).temporaryPassword : undefined;
    if (typeof given === "string" && (given.length < 12 || given === principal.username)) return bad("password is too short or equals the username");
    return HttpResponse.json<TemporaryPassword>({ temporaryPassword: temporary(given) });
  }),

  http.get("*/api/v1/principals/:id/effective-permissions", ({ params }) => {
    const user = requireGovernance("manage_principals");
    if (user instanceof Response) return user;
    const principal = principalOf(String(params.id));
    if (!principal) return missingPrincipal();
    const assignments: RoleAssignment[] = [{ code: "anonymous", contentTypeCodes: [] }, ...(db.principalRoles[principal.id] ?? [])];
    const items = assignments.flatMap((a) =>
      (db.rolePermissions[a.code] ?? []).map((p) => ({
        role: a.code,
        action: p.action,
        contentType: p.contentTypeCode ?? "",
        allowedSurfaces: p.allowedSurfaces,
        allowlist: a.contentTypeCodes,
      })),
    );
    return HttpResponse.json<EffectivePermissionList>({ items });
  }),

  http.get("*/api/v1/roles", () => {
    const user = requireGovernance("manage_principals");
    return user instanceof Response ? user : HttpResponse.json<RoleList>(roles);
  }),

  http.get("*/api/v1/roles/:code/permissions", ({ params }) => {
    const user = requireGovernance("manage_principals");
    if (user instanceof Response) return user;
    const list = db.rolePermissions[String(params.code)];
    return list ? HttpResponse.json<PermissionList>({ items: list }) : bad("unknown role code");
  }),

  http.put("*/api/v1/roles/:code/permissions", async ({ request, params }) => {
    const user = requireGovernance("manage_principals");
    if (user instanceof Response) return user;
    const code = String(params.code);
    if (!db.rolePermissions[code]) return bad("unknown role code");
    const body = (await request.json()) as PermissionInput[];
    if (!Array.isArray(body)) return bad("body must be an array");
    if (code === "anonymous" && body.length === 0) return bad("the anonymous role needs at least one permission");
    const seen = new Set<string>();
    const next: Permission[] = [];
    for (const input of body) {
      if (!ACTIONS.includes(input.action)) return bad("unknown action");
      if ((input.allowedSurfaces ?? []).some((s) => !SURFACES.includes(s))) return bad("unknown surface");
      if (input.predicateJson && !input.contentTypeCode) return bad("a predicate needs contentType");
      const key = `${input.action}|${input.contentTypeCode ?? ""}|${input.predicateJson ?? ""}`;
      if (seen.has(key)) return bad("duplicate permission");
      seen.add(key);
      const kept = db.rolePermissions[code].find((p) => `${p.action}|${p.contentTypeCode ?? ""}|${p.predicateJson ?? ""}` === key);
      db.governanceSequence += 1;
      next.push({
        id: kept?.id ?? `60000000-0000-4000-8000-${String(900 + db.governanceSequence).padStart(12, "0")}`,
        action: input.action,
        contentTypeCode: input.contentTypeCode ?? null,
        predicateJson: input.predicateJson ?? null,
        allowedSurfaces: input.allowedSurfaces ?? defaultSurfaces(input.action),
      });
    }
    db.rolePermissions[code] = next;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get("*/api/v1/admin/content-types", () => {
    const user = requireGovernance("manage_types");
    if (user instanceof Response) return user;
    return HttpResponse.json<AdminContentTypeList>({ items: getState().scenario === "empty" ? [] : db.adminTypes });
  }),

  ...[true, false].map((enabled) =>
    http.post(`*/api/v1/admin/content-types/:type/${enabled ? "enable" : "disable"}`, ({ params }) => {
      const user = requireGovernance("manage_types");
      if (user instanceof Response) return user;
      const type = db.adminTypes.find((t) => t.key === params.type);
      if (!type) return apiError(404, "CONTENT_TYPE_NOT_FOUND", "Content type not found");
      type.enabled = enabled;
      return HttpResponse.json<AdminContentType>(type);
    }),
  ),

  http.post("*/api/v1/admin/entries/:id/purge", async ({ params, request }) => {
    const user = requireAdmin();
    if (user instanceof Response) return user;
    const id = String(params.id);
    const entry = db.workEntries.find((e) => e.id === id);
    if (!entry) return apiError(404, "ENTRY_NOT_FOUND", "Entry not found");
    const text = await request.text();
    let body: { confirmPhrase?: unknown; confirmId?: unknown } | null;
    try { body = text ? JSON.parse(text) : null; }
    catch { return bad("Malformed request"); }
    if (body?.confirmPhrase !== "DELETE" || (body.confirmId !== id && !(entry.slug && body.confirmId === entry.slug))) {
      return apiError(400, "CONFIRMATION_REQUIRED", "Explicit deletion confirmation is required");
    }
    const referenced = db.workEntries.some((e) => e.id !== id && Object.values(e.payload).some((v) => v === id));
    if (referenced) return apiError(409, "REF_CONSTRAINT", "Another entry still references this entry");
    db.workEntries = db.workEntries.filter((e) => e.id !== id);
    db.publicEntries = db.publicEntries.filter((e) => e.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get("*/api/v1/admin/audit", ({ request }) => {
    const user = requireGovernance("read_audit");
    if (user instanceof Response) return user;
    const url = new URL(request.url);
    const text = (name: string) => url.searchParams.get(name)?.trim() || null;
    const page = Number(text("page") ?? 1);
    const size = Number(text("size") ?? 20);
    if (!Number.isInteger(page) || page < 1) return bad("page must be a positive integer");
    if (!Number.isInteger(size) || size < 1 || size > 100) return bad("size must be an integer from 1 to 100");
    const from = text("from");
    const to = text("to");
    if ([from, to].some((v) => v !== null && Number.isNaN(Date.parse(v)))) return bad("from must be an ISO-8601 date-time with offset");
    const action = text("action");
    const matches = (getState().scenario === "empty" ? [] : db.audit).filter((e) => {
      if (from && Date.parse(e.at) < Date.parse(from)) return false;
      if (to && Date.parse(e.at) >= Date.parse(to)) return false;
      if (text("actor") && e.actor?.username !== text("actor")) return false;
      if (action && (action.endsWith(".") ? !e.action.startsWith(action) : e.action !== action)) return false;
      for (const name of ["category", "targetType", "targetId", "outcome"] as const) {
        if (text(name) && e[name] !== text(name)) return false;
      }
      return true;
    });
    matches.sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : b.at.localeCompare(a.at)));
    const offset = (page - 1) * size;
    const items = matches.slice(offset, offset + size).map((e) => {
      const summary: Partial<AuditEventDetail> = { ...e };
      delete summary.detail;
      return summary as AuditEventPage["items"][number];
    });
    return HttpResponse.json<AuditEventPage>({ items, total: matches.length, page, size, offset, limit: size });
  }),

  http.get("*/api/v1/admin/audit/:id", ({ params }) => {
    const user = requireGovernance("read_audit");
    if (user instanceof Response) return user;
    const event = db.audit.find((e) => e.id === params.id);
    return event ? HttpResponse.json<AuditEventDetail>(event) : apiError(404, "AUDIT_EVENT_NOT_FOUND", "Audit event not found");
  }),

  http.get("*/api/v1/admin/settings/audit", () => {
    const user = requireGovernance("manage_settings");
    return user instanceof Response ? user : HttpResponse.json<AuditSettings>(db.auditSettings);
  }),

  http.patch("*/api/v1/admin/settings/audit", async ({ request }) => {
    const user = requireGovernance("manage_settings");
    if (user instanceof Response) return user;
    const body = (await request.json()) as { retentionDays?: unknown };
    const value = body.retentionDays;
    if (!RETENTION.includes(value as number)) {
      const code = value == null ? "REQUIRED" : Number.isInteger(value) ? "NOT_IN_ENUM" : "WRONG_TYPE";
      return HttpResponse.json(
        { error: { code: "FIELD_VALIDATION", message: "retentionDays is invalid", fields: [{ field: "retentionDays", code, message: "retentionDays must be 30, 90 or 365" }] }, requestId: "mock-retention" },
        { status: 422 },
      );
    }
    if (value !== db.auditSettings.retentionDays) {
      db.auditSettings = { ...db.auditSettings, retentionDays: value as AuditSettings["retentionDays"], updatedAt: new Date().toISOString(), updatedBy: currentUser()!.principal.id };
    }
    return HttpResponse.json<AuditSettings>(db.auditSettings);
  }),

  http.get("*/api/v1/media/quota", () => {
    const user = requireWork();
    if (user instanceof Response) return user;
    if (!canGlobal(user, "manage_media")) return apiError(403, "FORBIDDEN", "Missing permission manage_media on content type media");
    const assets = db.media;
    return HttpResponse.json<MediaQuota>({ ...mediaQuota, usedFiles: assets.length, usedBytes: assets.reduce((sum, asset) => sum + Object.values(asset.variants).reduce((bytes, variant) => bytes + (variant?.byteSize ?? 0), 0), 0) });
  }),
];

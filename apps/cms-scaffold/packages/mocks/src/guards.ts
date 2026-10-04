import type { CmsAction, Me } from "@cms/api";
import { capabilities, me as seedUsers } from "./fixtures.gen";
import { db } from "./db";
import { apiError } from "./respond";
import { getState, MOCK_CSRF_TOKEN } from "./state";

export function currentUser(): Me | null {
  const name = getState().user;
  const user = name ? seedUsers[name] : null;
  if (!name || !user) return null;
  const capability = capabilities[name][getState().surface];
  return { ...user, capabilities: { ...capability,
    types: capability.types.filter((type) => db.adminTypes.some((item) => item.key === type.key && item.enabled)),
  } };
}

export function isAdmin(user: Me) {
  return user.roles.some((r) => r.code === "admin");
}

/** Capabilities are the action contract on the current surface, including type disabling. */
export function can(user: Me, action: CmsAction, type: string) {
  return user.capabilities.types.some((capability) => capability.key === type && capability.actions.includes(action));
}

export function canGlobal(user: Me, action: CmsAction) {
  return user.capabilities.global.includes(action);
}

export function allowedType(user: Me, type: string) {
  return isAdmin(user) || user.roles.some((r) => r.contentTypeCodes.includes(type));
}

export function canPublish(user: Me) {
  return user.roles.some((r) => r.code === "admin" || r.code === "operator");
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 403 CSRF_FAILED when a signed-in unsafe request lacks the mock token (login is exempt). */
export function csrfFailure(request: Request) {
  if (!UNSAFE.has(request.method) || getState().user === null) return null;
  if (new URL(request.url).pathname === "/api/v1/auth/login") return null;
  return request.headers.get("X-CSRF-Token") === MOCK_CSRF_TOKEN
    ? null
    : apiError(403, "CSRF_FAILED", "CSRF token mismatch");
}

/** Work surface rules: signed in, Back or Admin surface, not a member. Returns the user or an error response. */
export function requireWork(): Me | Response {
  const user = currentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Authentication required");
  if (getState().surface === "front") return apiError(403, "SURFACE_FORBIDDEN", "Surface front is not allowed");
  if (!user.surfaces[getState().surface]) return apiError(403, "FORBIDDEN", "Missing permission");
  return user;
}

/** Admin surface rules: signed in, Admin surface, admin role. */
export function requireAdmin(): Me | Response {
  const user = currentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Authentication required");
  if (getState().surface !== "admin") return apiError(403, "SURFACE_FORBIDDEN", "Admin surface required");
  if (!isAdmin(user)) return apiError(403, "FORBIDDEN", "Missing permission");
  return user;
}

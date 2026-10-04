import type { CmsAction, Me } from "@cms/api";
import type { NavSection } from "@cms/ui";
import { copy } from "./copy";

/** Route patterns a login may return to (safeReturnTo). Keep in sync with routes.tsx. */
export const ADMIN_RETURN_ROUTES = [
  "/",
  "/types",
  "/types/:key",
  "/roles",
  "/roles/:code",
  "/principals",
  "/principals/new",
  "/principals/:id",
  "/audit",
  "/audit/:id",
  "/media",
  "/settings",
  "/settings/audit",
  "/entries",
  "/entries/:id",
] as const;

/** True when me.capabilities (Admin surface) holds the governance action. The only permission check in web-admin. */
export function canGlobal(me: Me, action: CmsAction): boolean {
  return me.capabilities.global.includes(action);
}

/** Purge (POST /admin/entries/{id}/purge) needs the admin role itself, not a capability (BW5 purgeEntry). */
export function hasAdminRole(me: Me): boolean {
  return me.roles.some((r) => r.code === "admin");
}

/** Settings index: shown when at least one of its cards is. */
export function canSettings(me: Me): boolean {
  return canGlobal(me, "manage_settings") || canGlobal(me, "manage_media") || hasAdminRole(me);
}

/** surface-admin §4.3: the governance menu in fixed order; an item appears only with its capability (§4.5). */
export function navFor(me: Me): NavSection[] {
  const items = [
    { label: copy["nav.overview"], to: "/", end: true, testId: "nav-overview", show: true },
    { label: copy["nav.types"], to: "/types", testId: "nav-types", show: canGlobal(me, "manage_types") },
    { label: copy["nav.roles"], to: "/roles", testId: "nav-roles", show: canGlobal(me, "manage_principals") },
    { label: copy["nav.principals"], to: "/principals", testId: "nav-principals", show: canGlobal(me, "manage_principals") },
    { label: copy["nav.audit"], to: "/audit", testId: "nav-audit", show: canGlobal(me, "read_audit") },
    { label: copy["nav.media"], to: "/media", testId: "nav-media", show: canGlobal(me, "manage_media") },
    { label: copy["nav.settings"], to: "/settings", testId: "nav-settings", show: canSettings(me) },
  ];
  return [{ items: items.filter((item) => item.show).map(({ show: _show, ...item }) => item) }];
}

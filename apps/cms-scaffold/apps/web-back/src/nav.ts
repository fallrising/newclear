import type { Me } from "@cms/api";
import type { NavSection } from "@cms/ui";
import { copy } from "./copy";

/** Route patterns a login may return to (safeReturnTo). Keep in sync with routes.tsx. */
export const BACK_RETURN_ROUTES = [
  "/",
  "/entries/:type",
  "/entries/:type/new",
  "/entries/:type/:id",
  "/views/album.composer",
  "/views/clinic.schedule",
  "/views/projects.board",
] as const;

// GAP(G-01): v1 behaviour kept in W0. W1 replaces this with me.capabilities (C-07).
const ADMIN_TYPES = ["album", "photo", "page", "clinic_profile", "owner", "pet", "vet", "visit", "project", "issue", "milestone"];

export function allowedTypes(me: Me): string[] {
  if (me.roles.some((r) => r.code === "admin")) return ADMIN_TYPES;
  return [...new Set(me.roles.flatMap((r) => r.contentTypeCodes))];
}

// GAP(G-01): publish buttons follow the role code until capabilities exist (W1).
export function canPublish(me: Me | null): boolean {
  return !!me && me.roles.some((r) => r.code === "operator" || r.code === "admin");
}

export function viewKeysFor(types: string[]): { key: string; label: string; path: string }[] {
  const views = [];
  if (types.includes("album") && types.includes("photo")) {
    views.push({ key: "album.composer", label: copy["view.album.composer"], path: "/views/album.composer" });
  }
  if (types.includes("visit")) {
    views.push({ key: "clinic.schedule", label: copy["view.clinic.schedule"], path: "/views/clinic.schedule" });
  }
  if (types.includes("issue") && types.includes("project")) {
    views.push({ key: "projects.board", label: copy["view.projects.board"], path: "/views/projects.board" });
  }
  return views;
}

export function navFor(me: Me): NavSection[] {
  const types = allowedTypes(me);
  const views = viewKeysFor(types);
  const sections: NavSection[] = [{ items: [{ label: copy["nav.home"], to: "/", end: true }] }];
  if (views.length) sections.push({ label: copy["nav.views"], items: views.map((v) => ({ label: v.label, to: v.path })) });
  sections.push({ label: copy["nav.content"], items: types.map((t) => ({ label: t, to: `/entries/${t}` })) });
  return sections;
}

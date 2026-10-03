import type { CmsAction, Me, WorkContentType } from "@cms/api";
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

/** True when me.capabilities (BW1a §4.4, Back surface) grants `action` on `type`. The only permission check in web-back (C-07). */
export function can(me: Me, type: string, action: CmsAction): boolean {
  return me.capabilities.types.some((t) => t.key === type && t.actions.includes(action));
}

/** 01 §7.2 B-S1: a type is workable when the user has read_draft, create or update on it. Order follows capabilities. */
export function workTypeKeys(me: Me): string[] {
  return me.capabilities.types
    .filter((t) => t.actions.some((a) => a === "read_draft" || a === "create" || a === "update"))
    .map((t) => t.key);
}

export interface ViewLink {
  key: string;
  label: string;
  lead: string;
  path: string;
}

// A view appears only when every type it reads is workable (surface-back §3.3). W2 redoes the views themselves.
const VIEWS = [
  { key: "album.composer", types: ["album", "photo"] },
  { key: "clinic.schedule", types: ["visit"] },
  { key: "projects.board", types: ["project", "issue"] },
] as const;

export function viewsFor(me: Me): ViewLink[] {
  const workable = workTypeKeys(me);
  return VIEWS.filter((view) => view.types.every((t) => workable.includes(t))).map((view) => ({
    key: view.key,
    label: copy[`view.${view.key}`],
    lead: copy[`view.${view.key}.lead`],
    path: `/views/${view.key}`,
  }));
}

/** Workable types in capability order, with their schema; types missing from `types` (still loading) are left out. */
export function workTypes(me: Me, types: WorkContentType[] | undefined): WorkContentType[] {
  const byKey = new Map((types ?? []).map((t) => [t.key, t]));
  return workTypeKeys(me).flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : []));
}

/** Side navigation: 首頁, 內容 (pluralDisplayName, U-02), 視圖. No hard-coded type list (C-07). */
export function navFor(me: Me, types: WorkContentType[] | undefined): NavSection[] {
  const sections: NavSection[] = [{ items: [{ label: copy["nav.home"], to: "/", end: true }] }];
  const content = workTypes(me, types);
  if (content.length) sections.push({ label: copy["nav.content"], items: content.map((t) => ({ label: t.pluralDisplayName, to: `/entries/${t.key}` })) });
  const views = viewsFor(me);
  if (views.length) sections.push({ label: copy["nav.views"], items: views.map((v) => ({ label: v.label, to: v.path })) });
  return sections;
}

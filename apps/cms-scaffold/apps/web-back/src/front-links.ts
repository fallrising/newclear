import type { WorkEntry } from "@cms/api";

// Public detail routes of apps/web-front (01 §7.1). Types without a public detail page have no link.
const DETAIL_PATHS: Record<string, (slug: string) => string> = {
  album: (slug) => `/album/albums/${slug}`,
  photo: (slug) => `/album/photos/${slug}`,
  project: (slug) => `/projects/${slug}`,
};

/** Absolute public URL of an entry, or null when its type has no public page, it has no slug or no origin is set. */
export function publicUrl(entry: Pick<WorkEntry, "contentType" | "slug">, origin = import.meta.env.VITE_FRONT_ORIGIN): string | null {
  const path = DETAIL_PATHS[entry.contentType];
  if (!path || !entry.slug || !origin) return null;
  return `${origin.replace(/\/$/, "")}${path(encodeURIComponent(entry.slug))}`;
}

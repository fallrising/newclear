import { copy, type CopyKey } from "./copy";

// Site registry (01 §6.3, surface-front §4.3): each site declares its scheme, navigation and home sections.
// Data only — home.tsx maps each section kind to a component. The Kernel knows nothing about sites.

export type SiteKey = "album" | "clinic" | "projects";
export type CardKind = "album" | "vet" | "project";

export interface NavEntry {
  to: string;
  label: CopyKey;
  /** true: active only on this exact path (the site home). */
  end: boolean;
}

export type SectionSpec =
  | { section: "Hero"; source: { type: string; slug: string } | null; fallback: { title: CopyKey; lead: CopyKey } }
  | { section: "ClinicProfile"; source: { type: string } }
  | { section: "CollectionGrid"; grid: GridSpec };

export interface GridSpec {
  /** Public content type key. */
  type: string;
  card: CardKind;
  /** Section heading (h2). */
  title: CopyKey;
  /** Items per request; the public API allows 1–100. */
  size: number;
  /** `sort` sent to the API (surface-front §7.2); null keeps the API default (sortField, else -publishedAt). */
  sort: string | null;
  /** true: ?page= drives the page number and a pager is shown; false: first `size` items and the `all` link. */
  paged: boolean;
  all: { to: string; label: CopyKey } | null;
  empty: CopyKey;
  emptyBody: CopyKey | null;
}

export interface SiteDefinition {
  key: SiteKey;
  /** Site name: header brand, document title suffix, not-found link. */
  name: string;
  basePath: string;
  /** data-scheme value; tokens in packages/ui/src/tokens.css (01 §5.3). */
  scheme: "gallery-dark" | "clinic-warm" | "projects-neutral";
  /** Meta description of the site home. */
  description: string;
  /** Header navigation. The public navigation API is not used in W3 (waves/W3.md §1.2). */
  nav: NavEntry[];
  home: SectionSpec[];
}

export const ALBUM_GRID: GridSpec = {
  type: "album",
  card: "album",
  title: "album.section",
  size: 12,
  sort: null,
  paged: true,
  all: null,
  empty: "empty.albums",
  emptyBody: "empty.albums.body",
};

export const VET_GRID: GridSpec = {
  type: "vet",
  card: "vet",
  title: "clinic.vets",
  size: 12,
  sort: "title",
  paged: true,
  all: null,
  empty: "empty.vets",
  emptyBody: null,
};

export const PROJECT_GRID: GridSpec = {
  type: "project",
  card: "project",
  title: "projects.section",
  size: 12,
  sort: null,
  paged: true,
  all: null,
  empty: "empty.projects",
  emptyBody: null,
};

export const SITES: Record<SiteKey, SiteDefinition> = {
  album: {
    key: "album",
    name: copy["site.album"],
    basePath: "/album",
    scheme: "gallery-dark",
    description: copy["selector.album.body"],
    nav: [
      { to: "/album", label: "nav.home", end: true },
      { to: "/album/albums", label: "nav.albums", end: false },
    ],
    home: [
      { section: "Hero", source: { type: "page", slug: "home" }, fallback: { title: "album.hero.title", lead: "album.hero.lead" } },
      { section: "CollectionGrid", grid: { ...ALBUM_GRID, size: 6, paged: false, all: { to: "/album/albums", label: "album.all" } } },
    ],
  },
  clinic: {
    key: "clinic",
    name: copy["site.clinic"],
    basePath: "/clinic",
    scheme: "clinic-warm",
    description: copy["selector.clinic.body"],
    nav: [
      { to: "/clinic", label: "nav.home", end: true },
      { to: "/clinic/vets", label: "nav.vets", end: false },
    ],
    home: [
      { section: "ClinicProfile", source: { type: "clinic_profile" } },
      { section: "CollectionGrid", grid: { ...VET_GRID, size: 6, paged: false, all: { to: "/clinic/vets", label: "clinic.vets.all" } } },
    ],
  },
  projects: {
    key: "projects",
    name: copy["site.projects"],
    basePath: "/projects",
    scheme: "projects-neutral",
    description: copy["selector.projects.body"],
    nav: [{ to: "/projects", label: "nav.projects", end: false }],
    home: [
      { section: "Hero", source: null, fallback: { title: "projects.hero.title", lead: "projects.hero.lead" } },
      { section: "CollectionGrid", grid: PROJECT_GRID },
    ],
  },
};

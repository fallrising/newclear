import type { components } from "@cms/api";
import * as fixtures from "./fixtures.gen";

type S = components["schemas"];

/** A publish snapshot as the mock keeps it: the API shape plus the payload that revert copies back. */
export type RevisionRow = S["Revision"] & { payload: S["EntryPayload"] };

export interface MockDb {
  memberEntries: typeof fixtures.memberEntries;
  workEntries: S["WorkEntry"][];
  publicEntries: S["PublicEntry"][];
  adminTypes: S["AdminContentType"][];
  media: S["MediaAsset"][];
  /** Ids of soft-deleted media: left out of GET /media, still readable by id, files answer 410. */
  deletedMedia: string[];
  /** Entry id → publish snapshots, newest first. */
  revisions: Record<string, RevisionRow[]>;
}

/** revisions.json lists some entries; every other published entry has one snapshot of its current payload. */
function seedRevisions(): Record<string, RevisionRow[]> {
  const rows: Record<string, RevisionRow[]> = { ...fixtures.revisions };
  for (const entry of fixtures.workEntries) {
    if (entry.publicationState !== "published" || rows[entry.id]) continue;
    rows[entry.id] = [{ revisionNo: 1, slug: entry.slug ?? "", publishedAt: entry.publishedAt ?? entry.updatedAt, payload: entry.payload }];
  }
  return rows;
}

function fresh(): MockDb {
  return structuredClone({
    memberEntries: fixtures.memberEntries,
    workEntries: fixtures.workEntries,
    publicEntries: fixtures.publicEntries,
    adminTypes: fixtures.adminContentTypes.items,
    media: fixtures.mediaAssets.items,
    deletedMedia: [],
    revisions: seedRevisions(),
  });
}

/** Mutable copy of the fixtures. Writes (PATCH, publish, upload…) change it; resetDb() restores it. */
export let db: MockDb = fresh();

export function resetDb() {
  db = fresh();
}

export { fixtures };

import type { components } from "@cms/api";
import * as fixtures from "./fixtures.gen";

type S = components["schemas"];

export interface MockDb {
  workEntries: S["WorkEntry"][];
  publicEntries: S["PublicEntry"][];
  adminTypes: S["AdminContentType"][];
  media: S["MediaAsset"][];
}

function fresh(): MockDb {
  return structuredClone({
    workEntries: fixtures.workEntries,
    publicEntries: fixtures.publicEntries,
    adminTypes: fixtures.adminContentTypes.items,
    media: fixtures.mediaAssets.items,
  });
}

/** Mutable copy of the fixtures. Writes (PATCH, publish, upload…) change it; resetDb() restores it. */
export let db: MockDb = fresh();

export function resetDb() {
  db = fresh();
}

export { fixtures };

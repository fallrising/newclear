import { expect, it } from "vitest";
import type { Me, WorkContentType } from "@cms/api";
import { navFor } from "./nav";

it("W1 navigation displays only granted content using plural display metadata", () => {
  const me = { roles: [{ code: "operator", contentTypeCodes: ["album"] }], capabilities: { surface: "back", global: [], types: [{ key: "note", actions: ["read_draft"], scoped: false }] } } as unknown as Me;
  const types = [{ key: "note", displayName: "Note", pluralDisplayName: "Notes" }] as WorkContentType[];
  expect(navFor(me, types).flatMap((section) => section.items.map((item) => item.label))).toEqual(["首頁", "Notes"]);
});

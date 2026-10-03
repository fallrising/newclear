// @vitest-environment node
import type { Me } from "@cms/api";
import { describe, expect, it } from "vitest";
import { publicUrl } from "./front-links";
import { can, navFor, viewsFor, workTypeKeys } from "./nav";

function me(types: [string, string[]][]): Me {
  return {
    principal: { id: "10000000-0000-4000-8000-000000000099", username: "t", displayName: "T", status: "active" },
    roles: [],
    surfaces: { front: true, back: true, admin: false },
    capabilities: { surface: "back", types: types.map(([key, actions]) => ({ key, actions, scoped: false })), global: [] },
  } as unknown as Me;
}

describe("nav from capabilities (C-07, G-01)", () => {
  it("a type is workable with read_draft, create or update; read_published alone is not", () => {
    const user = me([["page", ["read_published"]], ["note", ["read_published", "read_draft"]], ["vet", ["create"]]]);
    expect(workTypeKeys(user)).toEqual(["note", "vet"]);
    expect(can(user, "note", "read_draft")).toBe(true);
    expect(can(user, "note", "publish")).toBe(false);
  });

  it("a view needs every type it reads", () => {
    expect(viewsFor(me([["album", ["read_draft"]]]))).toEqual([]);
    expect(viewsFor(me([["album", ["read_draft"]], ["photo", ["update"]]])).map((v) => v.key)).toEqual(["album.composer"]);
  });

  it("Home and the nav are empty (only 首頁) when nothing is workable", () => {
    expect(navFor(me([["page", ["read_published"]]]), [])).toEqual([{ items: [{ label: "首頁", to: "/", end: true }] }]);
  });
});

describe("public links (01 §7.2 B-S3)", () => {
  it("W1-FM17 a public URL needs a known type, a slug and an origin", () => {
    expect(publicUrl({ contentType: "album", slug: "coast light" }, "http://front.test/")).toBe("http://front.test/album/albums/coast%20light");
    expect(publicUrl({ contentType: "project", slug: "cms" }, "http://front.test")).toBe("http://front.test/projects/cms");
    expect(publicUrl({ contentType: "note", slug: "x" }, "http://front.test")).toBeNull();
    expect(publicUrl({ contentType: "album", slug: null }, "http://front.test")).toBeNull();
    expect(publicUrl({ contentType: "album", slug: "x" }, "")).toBeNull();
  });
});

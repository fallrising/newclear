import { describe, expect, it } from "vitest";
import { adminContentTypes, workContentTypes } from "./fixtures.gen";

describe("content type fixture identity", () => {
  it("returns every content type once in work and governance registries", () => {
    for (const registry of [adminContentTypes, workContentTypes]) {
      const keys = registry.items.map((type) => type.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

import { describe, it, expect } from "vitest";

import { findBlockIds, findRefs } from "./block_id";

describe("findBlockIds", () => {
  it("finds a trailing ^id at end of line", () => {
    const src = "# heading ^h1\nbody text\n";
    const out = findBlockIds(src);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("h1");
    expect(out[0]?.line).toBe(1);
  });

  it("ignores ^id that isn't preceded by whitespace", () => {
    // Per D-9 Obsidian-compatibility, the marker requires a space before ^.
    expect(findBlockIds("inline^badid\n")).toEqual([]);
  });

  it("handles multiple lines", () => {
    const src = "a ^one\nb\nc ^three\n";
    const out = findBlockIds(src);
    expect(out.map((h) => h.id)).toEqual(["one", "three"]);
    expect(out.map((h) => h.line)).toEqual([1, 3]);
  });

  it("returns char offsets that point at the ' ^id' span", () => {
    const src = "abc ^xyz\n";
    const out = findBlockIds(src);
    expect(out).toHaveLength(1);
    const hit = out[0]!;
    expect(src.slice(hit.from, hit.to)).toBe(" ^xyz");
  });
});

describe("findRefs", () => {
  it("finds `[[file#^id]]`", () => {
    const src = "see [[notes.md#^summary]] please";
    const out = findRefs(src);
    expect(out).toHaveLength(1);
    expect(out[0]?.file).toBe("notes.md");
    expect(out[0]?.id).toBe("summary");
  });

  it("finds plain `[[file]]` with empty id", () => {
    const out = findRefs("[[notes.md]]");
    expect(out).toHaveLength(1);
    expect(out[0]?.file).toBe("notes.md");
    expect(out[0]?.id).toBe("");
  });

  it("finds multiple refs in one line", () => {
    const out = findRefs("[[a]] and [[b#^x]] and [[c]]");
    expect(out.map((r) => r.file)).toEqual(["a", "b", "c"]);
    expect(out.map((r) => r.id)).toEqual(["", "x", ""]);
  });

  it("returns char offsets that point at the full `[[…]]` span", () => {
    const src = "see [[notes.md#^x]] yes";
    const out = findRefs(src);
    expect(out).toHaveLength(1);
    const hit = out[0]!;
    expect(src.slice(hit.from, hit.to)).toBe("[[notes.md#^x]]");
  });
});

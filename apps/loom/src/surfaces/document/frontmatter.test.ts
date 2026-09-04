import { describe, it, expect } from "vitest";

import { parseFrontmatter, readRunIn } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("returns empty when there is no frontmatter", () => {
    const r = parseFrontmatter("# heading\n");
    expect(r.fields).toEqual({});
    expect(r.consumed).toBe(0);
  });

  it("parses a simple `key: value` block", () => {
    const src = "---\nrun_in: claude\n---\nbody\n";
    const r = parseFrontmatter(src);
    expect(r.fields).toEqual({ run_in: "claude" });
    expect(r.consumed).toBe("---\nrun_in: claude\n---\n".length);
  });

  it("strips surrounding double quotes", () => {
    const r = parseFrontmatter('---\ntitle: "Loom test plan"\n---\n');
    expect(r.fields.title).toBe("Loom test plan");
  });

  it("strips surrounding single quotes", () => {
    const r = parseFrontmatter("---\ntitle: 'Loom test plan'\n---\n");
    expect(r.fields.title).toBe("Loom test plan");
  });

  it("parses multiple keys", () => {
    const r = parseFrontmatter(
      "---\ntitle: Foo\nrun_in: claude\n---\nbody\n",
    );
    expect(r.fields).toEqual({ title: "Foo", run_in: "claude" });
  });

  it("ignores comments and blank lines inside the block", () => {
    const r = parseFrontmatter(
      "---\n\n# a comment\nrun_in: x\n---\n",
    );
    expect(r.fields).toEqual({ run_in: "x" });
  });

  it("returns empty when the closing fence is missing", () => {
    const r = parseFrontmatter("---\nrun_in: claude\n# never closes\n");
    expect(r.fields).toEqual({});
    expect(r.consumed).toBe(0);
  });

  it("requires the opening fence on the first line", () => {
    const r = parseFrontmatter("\n---\nrun_in: claude\n---\n");
    expect(r.fields).toEqual({});
  });
});

describe("readRunIn", () => {
  it("returns the value when present", () => {
    expect(readRunIn("---\nrun_in: claude\n---\nbody")).toBe("claude");
  });
  it("returns null when absent", () => {
    expect(readRunIn("---\ntitle: foo\n---\nbody")).toBeNull();
  });
  it("returns null when explicitly empty", () => {
    expect(readRunIn("---\nrun_in: \n---\nbody")).toBeNull();
  });
  it("returns null when no frontmatter", () => {
    expect(readRunIn("# heading")).toBeNull();
  });
});

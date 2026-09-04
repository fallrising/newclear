import { describe, it, expect } from "vitest";

import { findRunnableBlocks } from "./runnable_block";
import { CWD_ARG_PATTERN, RUNNABLE_INFO_PATTERN } from "./config";

describe("RUNNABLE_INFO_PATTERN", () => {
  it("matches `<lang> run`", () => {
    expect("bash run".match(RUNNABLE_INFO_PATTERN)?.[1]).toBe("bash");
    expect("python3 run".match(RUNNABLE_INFO_PATTERN)?.[1]).toBe("python3");
  });
  it("matches `<lang> run <args>` and preserves args group", () => {
    const m = "bash run --foo".match(RUNNABLE_INFO_PATTERN);
    expect(m?.[1]).toBe("bash");
    expect(m?.[2]?.trim()).toBe("--foo");
  });
  it("does not match a static block", () => {
    expect("bash".match(RUNNABLE_INFO_PATTERN)).toBeNull();
    expect("rust".match(RUNNABLE_INFO_PATTERN)).toBeNull();
  });
  it("does not match `runner` or `runtime` look-alikes", () => {
    expect("bash runner".match(RUNNABLE_INFO_PATTERN)).toBeNull();
  });
});

describe("findRunnableBlocks", () => {
  it("returns one entry for a single runnable block", () => {
    const src = [
      "# heading",
      "",
      "```bash run",
      "echo hi",
      "```",
      "",
    ].join("\n");
    const out = findRunnableBlocks(src);
    expect(out).toHaveLength(1);
    expect(out[0]?.lang).toBe("bash");
    expect(out[0]?.body).toBe("echo hi");
    expect(out[0]?.fenceStartLine).toBe(3);
    expect(out[0]?.fenceEndLine).toBe(5);
  });

  it("skips a non-runnable block on the way to a runnable one", () => {
    const src = [
      "```rust",
      "fn main() {}",
      "```",
      "",
      "```bash run",
      "ls",
      "```",
    ].join("\n");
    const out = findRunnableBlocks(src);
    expect(out).toHaveLength(1);
    expect(out[0]?.body).toBe("ls");
  });

  it("handles an unterminated runnable fence (EOF mid-block)", () => {
    const src = ["```bash run", "echo hi"].join("\n");
    const out = findRunnableBlocks(src);
    expect(out).toHaveLength(1);
    // Body is everything after the opener; even if the closing fence is
    // missing, the user can still see the ▶ button.
    expect(out[0]?.body).toBe("echo hi");
  });

  it("returns empty for documents with no fences", () => {
    expect(findRunnableBlocks("plain text only\n")).toEqual([]);
  });

  it("parses cwd= from an unquoted info-string arg", () => {
    const src = ["```bash run cwd=/Users/me/proj", "ls", "```"].join("\n");
    const out = findRunnableBlocks(src);
    expect(out).toHaveLength(1);
    expect(out[0]?.cwd).toBe("/Users/me/proj");
  });

  it("parses cwd= from a quoted path with spaces", () => {
    const src = [
      `\`\`\`bash run cwd="/Users/me/with spaces"`,
      "ls",
      "```",
    ].join("\n");
    const out = findRunnableBlocks(src);
    expect(out).toHaveLength(1);
    expect(out[0]?.cwd).toBe("/Users/me/with spaces");
  });

  it("leaves cwd undefined when not specified", () => {
    const src = ["```bash run", "ls", "```"].join("\n");
    const out = findRunnableBlocks(src);
    expect(out[0]?.cwd).toBeUndefined();
  });

  it("leaves cwd undefined for static (non-runnable) blocks", () => {
    const src = ["```bash", "ls", "```"].join("\n");
    expect(findRunnableBlocks(src)).toEqual([]);
  });
});

describe("CWD_ARG_PATTERN", () => {
  it("matches an unquoted path", () => {
    const m = "cwd=/a/b/c --verbose".match(CWD_ARG_PATTERN);
    expect(m?.[3]).toBe("/a/b/c");
  });
  it("matches a quoted path with spaces", () => {
    const m = `cwd="/a b/c"`.match(CWD_ARG_PATTERN);
    expect(m?.[2]).toBe("/a b/c");
  });
  it("does not match when cwd is absent", () => {
    expect("--foo --bar".match(CWD_ARG_PATTERN)).toBeNull();
  });
});

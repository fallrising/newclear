// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL(".", import.meta.url));
const CJK = /[㐀-鿿＀-￯]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("copy rule", () => {
  it("W0 copy rule: user-visible zh-Hant strings live only in copy.ts", () => {
    const offenders = files(root)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/copy\.ts$|\.test\.tsx?$|test-setup\.ts$/.test(f))
      .filter((f) => CJK.test(readFileSync(f, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")));
    expect(offenders).toEqual([]);
  });
});

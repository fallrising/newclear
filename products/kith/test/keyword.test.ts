import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadKeywords, matchKeywords } from "../src/keyword.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

type KeywordRow = {
  keywords: string[];
  body: string;
  hit: "yes" | "no" | "load-reject";
  reason?: string;
};

describe("keyword matcher", () => {
  it("ATT-02: loadKeywords/matchKeywords match every golden row in keyword-matcher-v1.json", () => {
    const vec = JSON.parse(
      readFileSync(join(root, "contracts/vectors/keyword-matcher-v1.json"), "utf8"),
    ) as { id: string; rows: KeywordRow[] };
    expect(vec.id).toBe("ATT-02");
    expect(vec.rows.length).toBeGreaterThan(0);
    for (const row of vec.rows) {
      if (row.hit === "load-reject") {
        expect(() => loadKeywords(row.keywords), JSON.stringify(row.keywords)).toThrow();
        continue;
      }
      const loaded = loadKeywords(row.keywords);
      expect(matchKeywords(row.body, loaded), row.body).toBe(row.hit === "yes");
    }
  });

  it("empty keywords array never hits", () => {
    const loaded = loadKeywords([]);
    expect(matchKeywords("please Deploy now 今晚部署嗎 GPT-4", loaded)).toBe(false);
  });
});

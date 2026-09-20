import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tokenizeMentions } from "../src/mention.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

type MentionRow = {
  input: string;
  handles: string[];
  mentions: string[];
};

describe("mention tokenizer", () => {
  it("ATT-01: tokenizeMentions matches every golden row in mention-tokenizer-v1.json", () => {
    const vec = JSON.parse(
      readFileSync(join(root, "contracts/vectors/mention-tokenizer-v1.json"), "utf8"),
    ) as { id: string; rows: MentionRow[] };
    expect(vec.id).toBe("ATT-01");
    expect(vec.rows.length).toBeGreaterThan(0);
    for (const row of vec.rows) {
      expect(tokenizeMentions(row.input, row.handles), row.input).toEqual(row.mentions);
    }
  });
});

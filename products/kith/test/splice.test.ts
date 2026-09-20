import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spliceEvents, type SpliceRow } from "../src/splice.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

type ExpectedEvent = { seq: number; kind: string; replay: boolean };

type SpliceCase = {
  id: string;
  after_seq: number;
  live: SpliceRow[];
  expected: ExpectedEvent[];
  gap: boolean;
};

describe("events splice", () => {
  it("EV-01: catch-up replay:true then live replay:false; gap when live min seq > cursor+1", () => {
    const vec = JSON.parse(readFileSync(join(root, "contracts/vectors/ev-01-splice-v1.json"), "utf8")) as {
      id: string;
      d1_persisted: SpliceRow[];
      cases: SpliceCase[];
    };
    expect(vec.id).toBe("EV-01");
    expect(vec.cases).toHaveLength(2);
    for (const c of vec.cases) {
      const result = spliceEvents({
        d1_persisted: vec.d1_persisted,
        after_seq: c.after_seq,
        live: c.live,
      });
      expect(result.events, c.id).toEqual(c.expected);
      expect(result.gap, c.id).toBe(c.gap);
    }
  });
});

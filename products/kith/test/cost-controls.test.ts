import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { paidLimits, reserveLedger, PAID_LEASE_MS, type PaidLedger } from "../worker/cost-controls.ts";
import type { Env } from "../worker/env.ts";

const optIn = { ff_hosted_agent: "on", KITH_PAID_ENABLED: "on", KITH_MAX_PAID_ATTEMPTS_PER_DAY: "3", KITH_MAX_AGENT_ATTEMPTS_PER_DAY: "2", KITH_MAX_PAID_CONCURRENCY: "1" } as Env;
const now = Date.UTC(2026, 9, 10, 23, 59, 59);
const attempt = { generationId: "g1", agentId: "a1", roomId: "r1", attempt: 0 };

describe("paid admission controls", () => {
  it("requires every explicit opt-in and rejects invalid or excessive quotas", () => {
    expect(paidLimits(optIn)).toEqual({ daily: 3, agentDaily: 2, concurrency: 1 });
    for (const field of Object.keys(optIn)) {
      for (const value of [undefined, "", "off", "0", "-1", "1.5", " 1", "NaN", "1001"]) {
        expect(paidLimits({ ...optIn, [field]: value } as Env)).toBeNull();
      }
    }
    expect(paidLimits({ ...optIn, KITH_MAX_AGENT_ATTEMPTS_PER_DAY: "4" })).toBeNull();
    expect(paidLimits({ ...optIn, KITH_MAX_PAID_CONCURRENCY: "9" })).toBeNull();
  });
  it("production configuration defaults fail closed without fake-provider opt-in", () => {
    const config = readFileSync("wrangler.toml", "utf8");
    for (const flag of ["ff_hosted_agent", "ff_ambient", "ff_providers", "KITH_PAID_ENABLED"]) expect(config).toMatch(new RegExp(`${flag} = "off"`));
    for (const cap of ["KITH_MAX_PAID_ATTEMPTS_PER_DAY", "KITH_MAX_AGENT_ATTEMPTS_PER_DAY", "KITH_MAX_PAID_CONCURRENCY"]) expect(config).toMatch(new RegExp(`${cap} = "0"`));
    expect(paidLimits({ ...optIn, KITH_PAID_ENABLED: undefined, FAKE_LLM_TEXT: "fake" })).toBeNull();
  });
  it("idempotently reserves an attempt, binds identity, and counts retries without refunds", () => {
    const caps = paidLimits(optIn)!;
    const first = reserveLedger(undefined, attempt, caps, now)!;
    expect(first.total).toBe(1);
    expect(reserveLedger(first, attempt, caps, now + 1)?.total).toBe(1);
    expect(reserveLedger(first, { ...attempt, agentId: "other" }, caps, now + 1)).toBeNull();
    const retry = reserveLedger(first, { ...attempt, attempt: 1 }, caps, now + 1)!;
    expect(retry.total).toBe(2);
    expect(retry.agents.a1).toBe(2);
    delete retry.leases.g1;
    expect(reserveLedger(retry, attempt, caps, now + 1)).toBeNull();
    expect(reserveLedger(retry, { ...attempt, generationId: "g2" }, caps, now + 1)).toBeNull();
  });
  it("enforces concurrency, daily boundaries, and preserves a live lease across UTC rollover", () => {
    const caps = paidLimits(optIn)!;
    let ledger = reserveLedger(undefined, attempt, caps, now)!;
    expect(reserveLedger(ledger, { ...attempt, generationId: "g2", agentId: "a2" }, caps, now + 1)).toBeNull();
    expect(reserveLedger(ledger, { ...attempt, generationId: "g2", agentId: "a2" }, caps, now + 2000)).toBeNull();
    ledger = reserveLedger(ledger, { ...attempt, generationId: "g2", agentId: "a2" }, caps, now + PAID_LEASE_MS + 1)!;
    expect(ledger.total).toBe(1);
    expect(ledger.day).toBe("2026-10-11");
    delete ledger.leases.g2;
    ledger = reserveLedger(ledger, { ...attempt, generationId: "g3" }, caps, now + PAID_LEASE_MS + 2)!;
    delete ledger.leases.g3;
    ledger = reserveLedger(ledger, { ...attempt, generationId: "g4", agentId: "a3" }, caps, now + PAID_LEASE_MS + 3)!;
    delete ledger.leases.g4;
    expect(reserveLedger(ledger, { ...attempt, generationId: "g5", agentId: "a4" }, caps, now + PAID_LEASE_MS + 4)).toBeNull();
  });
  it("rejects invalid identities and attempts without mutating prior state", () => {
    for (const bad of [{ agentId: "__proto__" }, { generationId: "" }, { roomId: "r".repeat(129) }, { attempt: 2 }]) expect(reserveLedger(undefined, { ...attempt, ...bad }, paidLimits(optIn)!, now)).toBeNull();
    const previous = reserveLedger(undefined, attempt, paidLimits(optIn)!, now) as PaidLedger;
    const copy = structuredClone(previous);
    reserveLedger(previous, { ...attempt, attempt: 1 }, paidLimits(optIn)!, now);
    expect(previous).toEqual(copy);
  });
  it("counts ordinary IDs that match inherited object names and enforces their leases", () => {
    const input = { ...attempt, generationId: "toString", agentId: "valueOf" };
    const caps = { daily: 3, agentDaily: 1, concurrency: 1 };
    const ledger = reserveLedger(undefined, input, caps, now)!;
    expect(ledger.agents.valueOf).toBe(1);
    expect(Object.hasOwn(ledger.leases, "toString")).toBe(true);
    expect(reserveLedger(ledger, { ...input, attempt: 1 }, caps, now)).toBeNull();
    expect(reserveLedger(ledger, { ...attempt, generationId: "other" }, caps, now)).toBeNull();
  });
});

import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../../worker/env.ts";
import type { Room } from "../../worker/room.ts";
import type { PaidAttempt, PaidLedger } from "../../worker/cost-controls.ts";

const bindings = env as Env;
async function fixture(caps = { daily: "3", agent: "2", concurrency: "2" }) {
  const stub = bindings.ROOM.get(bindings.ROOM.idFromName(`accounting-test:${crypto.randomUUID()}`));
  await runInDurableObject(stub, (instance: Room) => {
    (instance as unknown as { env: Env }).env = { ...bindings, ff_hosted_agent: "on", KITH_PAID_ENABLED: "on",
      KITH_MAX_API_REQUESTS_PER_MINUTE: undefined, KITH_MAX_LOGIN_ATTEMPTS_PER_MINUTE: undefined,
      KITH_MAX_PAID_ATTEMPTS_PER_DAY: caps.daily, KITH_MAX_AGENT_ATTEMPTS_PER_DAY: caps.agent, KITH_MAX_PAID_CONCURRENCY: caps.concurrency };
  });
  return stub as unknown as Room;
}
function request(id: string, agentId = "a1"): PaidAttempt { return { generationId: id, agentId, roomId: "r1", attempt: 0 }; }

describe("atomic accounting and room admission", () => {
  it("public API and login gates are atomic, bounded and fail closed", async () => {
    const room = await fixture();
    const attempts = await Promise.all(Array.from({ length: 30 }, () => room.admitApiRequest("test-client", true)));
    expect(attempts.filter(Boolean)).toHaveLength(10);
    expect(await room.admitApiRequest("other-client", true)).toBe(true);
    const calls = await Promise.all(Array.from({ length: 130 }, () => room.admitApiRequest("test-client", false)));
    expect(calls.filter(Boolean)).toHaveLength(120);
  });
  it("fifty simultaneous generations cannot exceed two leases", async () => {
    const room = await fixture({ daily: "100", agent: "100", concurrency: "2" });
    const accepted = await Promise.all(Array.from({ length: 50 }, (_, i) => room.reservePaidAttempt(request(`g${i}`))));
    expect(accepted.filter(Boolean)).toHaveLength(2);
  });
  it("concurrent duplicate reservations count once and release never refunds", async () => {
    const room = await fixture();
    expect((await Promise.all(Array.from({ length: 20 }, () => room.reservePaidAttempt(request("g1"))))).every(Boolean)).toBe(true);
    expect(await room.reservePaidAttempt({ ...request("g1"), attempt: 1 })).toBe(true);
    await room.releasePaidAttempt("g1");
    expect(await room.reservePaidAttempt(request("g1"))).toBe(false);
    expect(await room.reservePaidAttempt(request("g2"))).toBe(false);
    expect(await room.reservePaidAttempt(request("g2", "a2"))).toBe(true);
    await room.releasePaidAttempt("g2");
    expect(await room.reservePaidAttempt(request("g3", "a3"))).toBe(false);
  });
  it("one hosted slot and six per-minute admissions apply to every trigger", async () => {
    const room = await fixture();
    const first = await Promise.all(Array.from({ length: 30 }, (_, i) => room.admitHosted(`g${i}`)));
    expect(first.filter((r) => r.ok)).toHaveLength(1);
    const winner = first.findIndex((r) => r.ok);
    expect(await room.admitHosted(`g${winner}`)).toEqual({ ok: true });
    await room.releaseHosted("different");
    expect((await room.admitHosted("next")).ok).toBe(false);
    await room.releaseHosted(`g${winner}`);
    for (let i = 0; i < 5; i++) { expect((await room.admitHosted(`next${i}`)).ok).toBe(true); await room.releaseHosted(`next${i}`); }
    expect(await room.admitHosted("seventh")).toEqual({ ok: false, code: "wake_budget_exhausted" });
  });
  it("room streams enforce sixteen concurrent leases and release safely", async () => {
    const room = await fixture();
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => room.admitEventStream(`s${i}`)));
    expect(results.filter((r) => r.ok)).toHaveLength(16);
    const winner = results.findIndex((r) => r.ok);
    await room.releaseEventStream(`s${winner}`);
    expect(await room.admitEventStream("replacement")).toEqual({ ok: true });
  });
  it("missing limits deny reservations before storage accounting", async () => {
    const room = await fixture({ daily: "0", agent: "1", concurrency: "1" });
    expect(await room.reservePaidAttempt(request("blocked"))).toBe(false);
  });
});

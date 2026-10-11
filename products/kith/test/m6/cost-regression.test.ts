import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../worker/env.ts";
import { Inbox, type InboxNotifyPayload, AMBIENT_REARM_MAX, INBOX_WAIT_MAX } from "../../worker/inbox.ts";

const bindings = env as Env;
const payload: InboxNotifyPayload = {
  seq: 1, kind: "message", room_id: "cost-room", id: "cost-message", body: "are you there?",
  sender_id: "operator", origin: "local", member_id: "cost-agent", mentions: [], sender_kind: "human",
  created_at: "2026-01-01T00:00:00Z",
};

async function fixture(typing = true) {
  const stub = bindings.INBOX.get(bindings.INBOX.idFromName(`cost-test:${crypto.randomUUID()}`));
  const begin = vi.fn(async () => ({ ok: true as const, generation_id: "fake" }));
  const release = vi.fn(async () => {});
  const consumeBudget = vi.fn(async () => { throw new Error("double counting wake budget"); });
  await runInDurableObject(stub, (instance: Inbox) => {
    const injected = instance as unknown as { env: Env; loadPolicy(): Promise<unknown> };
    injected.env = {
      ...bindings, ff_hosted_agent: "on", ff_ambient: "on", ff_providers: "off", KITH_PAID_ENABLED: "on",
      KITH_MAX_PAID_ATTEMPTS_PER_DAY: "100", KITH_MAX_AGENT_ATTEMPTS_PER_DAY: "10", KITH_MAX_PAID_CONCURRENCY: "1",
      DB: { prepare: () => ({ first: async () => ({ id: "operator" }) }) } as unknown as D1Database,
      ROOM: { idFromName: (name: string) => name, get: () => ({
        activity: async () => ({ humans_typing: typing, last_human_at: "2026-01-01T00:00:00Z", recent_10_has_agent: false }),
        tryAcquireAmbient: async () => ({ ok: true }), releaseAmbient: release, consumeWakeBudget: consumeBudget,
      }) } as unknown as Env["ROOM"],
      HOSTED: { idFromName: (name: string) => name, get: () => ({ begin }) } as unknown as Env["HOSTED"],
    };
    injected.loadPolicy = async () => ({ attention_mode: "ambient", keywords_json: "[]", cooldown_ms: 0, debounce_ms: 0,
      classifier: "heuristic", policy_epoch: 1, quota_class: "api_key", handle: "grok" });
  });
  return { stub, begin, release, consumeBudget };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Inbox persisted cost bounds", () => {
  it("mention notify resolves while Hosted.begin is held unresolved and no model has started", async () => {
    const { stub, begin } = await fixture(false);
    let releaseBegin!: (result: { ok: true; generation_id: string }) => void;
    const held = new Promise<{ ok: true; generation_id: string }>((resolve) => { releaseBegin = resolve; });
    begin.mockReturnValueOnce(held);
    const model = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("model must not start"); });
    await runInDurableObject(stub, async (instance: Inbox) => {
      (instance as unknown as { loadPolicy(): Promise<unknown> }).loadPolicy = async () => ({
        attention_mode: "mention", keywords_json: "[]", cooldown_ms: 0, debounce_ms: 0, classifier: "heuristic",
        policy_epoch: 1, quota_class: "api_key", handle: "grok",
      });
      const notified = await instance.notify({ ...payload, mentions: ["cost-agent"] });
      // This assertion occurs before releasing the remote begin promise: no clock assumption proves it.
      expect(notified.accepted).toBe(true);
      expect(begin).toHaveBeenCalledTimes(1);
      expect(model).not.toHaveBeenCalled();
      releaseBegin({ ok: true, generation_id: "fake" });
      await held;
    });
  });

  it("zero debounce typing cannot re-arm more than eight times, or before one second", async () => {
    vi.useFakeTimers();
    const { stub, begin } = await fixture();
    await runInDurableObject(stub, async (instance: Inbox, state) => {
      await instance.notify(payload);
      for (let attempt = 0; attempt < AMBIENT_REARM_MAX; attempt++) {
        await instance.runScheduled();
        const pending = await state.storage.get<{ rearms: number; deadline: number }>("pending");
        expect(pending?.rearms).toBe(attempt + 1);
        const target = await state.storage.get<number>("last_alarm_at");
        expect(target! - Date.now()).toBeGreaterThanOrEqual(1_000);
        await instance.runScheduled(); // early at-least-once delivery preserves the count and target
        expect((await state.storage.get<{ rearms: number }>("pending"))?.rearms).toBe(attempt + 1);
        await vi.advanceTimersByTimeAsync(target! - Date.now());
      }
      await instance.runScheduled();
      expect(await state.storage.get("pending")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it("new notifications update the candidate without resetting deadline or rearms", async () => {
    const { stub } = await fixture();
    await runInDurableObject(stub, async (instance: Inbox, state) => {
      await instance.notify(payload);
      await instance.runScheduled();
      const first = await state.storage.get<{ deadline: number; rearms: number }>("pending");
      const target = await state.storage.getAlarm();
      await instance.notify({ ...payload, seq: 2, id: "new-message" });
      const next = await state.storage.get<{ deadline: number; rearms: number; envelope: { event: { seq: number } } }>("pending");
      expect(next?.deadline).toBe(first?.deadline);
      expect(next?.rearms).toBe(first?.rearms);
      expect(next?.envelope.event.seq).toBe(2);
      expect(await state.storage.getAlarm()).toBe(target);
    });
  });

  it.each(["kill", "expired", "legacy"])("pending %s fails closed and clears its alarm", async (reason) => {
    const { stub, begin } = await fixture();
    await runInDurableObject(stub, async (instance: Inbox, state) => {
      await instance.notify(payload);
      const stored = await state.storage.get<Record<string, unknown>>("pending");
      if (reason === "kill") (instance as unknown as { env: Env }).env.KITH_PAID_ENABLED = "off";
      else if (reason === "expired") {
        const deadline = Date.now() - 1;
        await state.storage.put("pending", { ...stored, created_at_ms: deadline - 300_000, deadline });
      } else {
        const { created_at_ms: _created, deadline: _deadline, rearms: _rearms, ...legacy } = stored!;
        await state.storage.put("pending", legacy);
      }
      await instance.runScheduled();
      expect(await state.storage.get("pending")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it("paid opt-out prevents ambient scheduling, including a fake provider", async () => {
    const { stub } = await fixture();
    await runInDurableObject(stub, async (instance: Inbox, state) => {
      (instance as unknown as { env: Env }).env.KITH_PAID_ENABLED = "off";
      await instance.notify(payload);
      expect(await state.storage.get("pending")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("an unknown begin result consumes pending and releases ambient without replay or duplicate budget", async () => {
    const { stub, begin, release, consumeBudget } = await fixture(false);
    begin.mockRejectedValueOnce(new Error("unknown remote begin result"));
    await runInDurableObject(stub, async (instance: Inbox, state) => {
      await instance.notify(payload);
      await instance.runScheduled();
      await instance.runScheduled();
      expect(await state.storage.get("pending")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(consumeBudget).not.toHaveBeenCalled();
  });

  it("idle wait does two registration reads and no storage polling, then expires", async () => {
    vi.useFakeTimers();
    const { stub } = await fixture();
    await runInDurableObject(stub, async (instance: Inbox) => {
      const reads = vi.spyOn(instance, "liveAfter");
      const pending = instance.waitAfter(0, "idle", 30_000);
      await instance.liveAfter(0); // let registration finish; this explicit test read is counted separately
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toEqual([]);
      expect(reads).toHaveBeenCalledTimes(3);
    });
  });

  it("16 waiters are bounded; cancellation frees slots and notify settles the live tail", async () => {
    const { stub } = await fixture();
    await runInDurableObject(stub, async (instance: Inbox) => {
      const pending = Array.from({ length: INBOX_WAIT_MAX }, (_, id) => instance.waitAfter(0, `wait-${id}`));
      await instance.liveAfter(0);
      await expect(instance.waitAfter(0, "over-limit")).rejects.toThrow("inbox waiter limit");
      await instance.cancelWait("wait-0");
      expect(await pending[0]).toEqual([]);
      const replacement = instance.waitAfter(0, "replacement");
      await instance.liveAfter(0);
      await instance.notify({ ...payload, kind: "trace" });
      expect((await replacement).map((item) => item.seq)).toEqual([1]);
      for (const waiting of pending.slice(1)) expect((await waiting).map((item) => item.seq)).toEqual([1]);
    });
  });

  it("a cancellation racing registration is remembered without opening a waiter", async () => {
    const { stub } = await fixture();
    await runInDurableObject(stub, async (instance: Inbox) => {
      const waiting = instance.waitAfter(0, "cancel-race");
      await instance.cancelWait("cancel-race");
      expect(await waiting).toEqual([]);
      expect(await instance.waitAfter(0, "cancel-race")).toEqual([]);
    });
  });
});

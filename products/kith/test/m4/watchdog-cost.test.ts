import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../worker/env.ts";
import type { HostedGeneration } from "../../worker/hosted/generation.ts";

type Control = { phase: string; attempt: number; deadline: number; not_before: number };
type ClaimRpc = { claimExecution(): Promise<unknown>; runScheduled(): Promise<void> };
const bindings = env as Env;

async function interrupted(phase: "pending" | "running" | "initializing", v2 = false) {
  const id = crypto.randomUUID();
  const deadline = Date.now() + 300_000;
  const stub = bindings.HOSTED.get(bindings.HOSTED.idFromName(id));
  await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.put({
      execution: { version: 1, generation_id: id, agent_id: "offline-agent", room_id: "offline-room", phase, attempt: 0, deadline, not_before: Date.now() },
      job: { generation_id: id, agent_id: "offline-agent", room_id: "offline-room", handle: "agent", transcript: "offline fixture", trigger_seq: 0,
        ...(v2 ? { v2: { runtime_epoch: 1, attempt: 0 } } : {}) },
      fake_llm: { text: "must not run" },
    });
    // Model the platform having consumed the work alarm before the process was interrupted.
    await state.storage.deleteAlarm();
  });
  return { stub, deadline };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 86_400_000);
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline watchdog test must not fetch"));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("hosted watchdog survives consumed-alarm crash windows", () => {
  it("initialization identity commits with its watchdog before the first RPC", async () => {
    const id = crypto.randomUUID();
    const deadline = Date.now() + 300_000;
    const stub = bindings.HOSTED.get(bindings.HOSTED.idFromName(id));
    await runInDurableObject(stub, async (instance: HostedGeneration, state) => {
      const injected = instance as unknown as { resolveHandle(): Promise<string | null> };
      const original = injected.resolveHandle;
      let reached!: () => void;
      let release!: (value: string | null) => void;
      const paused = new Promise<void>((resolve) => { reached = resolve; });
      injected.resolveHandle = async () => {
        reached();
        return new Promise<string | null>((resolve) => { release = resolve; });
      };
      const initializing = instance.begin({ generation_id: id, agent_id: "offline-agent", room_id: "offline-room" });
      try {
        await paused;
        expect((await state.storage.get<Control>("execution"))?.phase).toBe("initializing");
        expect(await state.storage.get("job")).toBeDefined();
        expect(await state.storage.getAlarm()).toBe(deadline);
      } finally {
        // Let the injected initialization reject cleanly after observing the pre-RPC crash boundary.
        release(null);
        await initializing;
        injected.resolveHandle = original;
      }
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])("v2=%s running claim retains the original watchdog before D1 work", async (v2) => {
    const { stub, deadline } = await interrupted("pending", v2);
    await runInDurableObject(stub, async (instance: HostedGeneration, state) => {
      // Fault injection stops the actual handler immediately after its durable claim, before any D1 work.
      const claimed = await (instance as unknown as ClaimRpc).claimExecution();
      expect(claimed).not.toBeNull();
      expect((await state.storage.get<Control>("execution"))?.phase).toBe("running");
      expect(await state.storage.getAlarm()).toBe(deadline);
    });
    await (stub as unknown as ClaimRpc).runScheduled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.setSystemTime(deadline);
    await (stub as unknown as ClaimRpc).runScheduled();
    await runInDurableObject(stub, async (_instance, state) => {
      expect((await state.storage.get<Control>("execution"))?.phase).toBe("terminal");
      expect(await state.storage.get("job")).toBeUndefined();
      expect(await state.storage.get("fake_llm")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(["running", "initializing"] as const)("pre-deadline %s replay restores cleanup without inference", async (phase) => {
    const { stub, deadline } = await interrupted(phase);
    await (stub as unknown as ClaimRpc).runScheduled();
    await runInDurableObject(stub, async (_instance, state) => {
      expect((await state.storage.get<Control>("execution"))?.phase).toBe(phase);
      expect(await state.storage.getAlarm()).toBe(deadline);
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.setSystemTime(deadline);
    await (stub as unknown as ClaimRpc).runScheduled();
    await runInDurableObject(stub, async (_instance, state) => {
      expect((await state.storage.get<Control>("execution"))?.phase).toBe("terminal");
      expect(await state.storage.get("job")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

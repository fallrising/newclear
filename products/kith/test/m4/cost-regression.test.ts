import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../worker/env.ts";
import type { HostedGeneration, BeginInput, BeginResult } from "../../worker/hosted/generation.ts";
import { beforeHostedDeadline, DraftThrottle } from "../../worker/hosted/generation.ts";
import type { FetchLike } from "../../worker/hosted/llm.ts";

type Rpc = { begin(input: BeginInput): Promise<BeginResult>; runScheduled(): Promise<void> };
type Control = { phase: string; attempt: number; deadline: number; not_before: number };
const bindings = env as Env;
const BASE = "https://cost-test.invalid/v1";

function hosted(id: string) { return bindings.HOSTED.get(bindings.HOSTED.idFromName(id)); }
function rpc(id: string) { return hosted(id) as unknown as Rpc; }

async function seed(v2 = false): Promise<BeginInput> {
  const generation_id = crypto.randomUUID();
  const agent_id = crypto.randomUUID();
  const room_id = crypto.randomUUID();
  const operator = crypto.randomUUID();
  const now = new Date().toISOString();
  await bindings.DB.batch([
    bindings.DB.prepare(`INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
      VALUES (?, 'human', ?, 'Operator', 'test-only', '[]', 'api_key', 1, ?)`)
      .bind(operator, `op_${operator.replaceAll("-", "").slice(0, 10)}`, now),
    bindings.DB.prepare(`INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
      VALUES (?, 'agent', 'grok', 'Grok', NULL, '[]', 'api_key', 0, ?)`)
      .bind(agent_id, now),
    bindings.DB.prepare(`INSERT INTO rooms (id, slug, name, created_by, created_at) VALUES (?, ?, 'Cost test', ?, ?)`)
      .bind(room_id, room_id, operator, now),
    bindings.DB.prepare(`INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'owner', 'silent')`)
      .bind(room_id, operator),
    bindings.DB.prepare(`INSERT INTO room_members (room_id, member_id, role, attention_mode) VALUES (?, ?, 'member', 'silent')`)
      .bind(room_id, agent_id),
  ]);
  if (v2) {
    const connection = crypto.randomUUID();
    await bindings.DB.batch([
      bindings.DB.prepare(`INSERT INTO provider_connections (id, name, preset, api_format, base_url, secret_source, created_at, updated_at)
        VALUES (?, ?, 'custom', 'openai_chat', ?, 'none', ?, ?)`)
        .bind(connection, connection, BASE, now, now),
      bindings.DB.prepare(`INSERT INTO agent_runtimes (agent_id, runtime, connection_id, model, updated_at)
        VALUES (?, 'hosted', ?, 'grok-4.5', ?)`)
        .bind(agent_id, connection, now),
    ]);
  }
  await runInDurableObject(hosted(generation_id), (instance: HostedGeneration) => {
    // Only this test DO instance changes its injectable fetch/config. No provider traffic leaves the test isolate.
    const injectable = instance as unknown as { env: Env; fetchImpl(): Promise<FetchLike> };
    injectable.env = { ...bindings, ff_providers: v2 ? "on" : "off" };
    injectable.fetchImpl = async () => fetch;
  });
  return { generation_id, agent_id, room_id, handle: "grok", transcript: "hello @grok", trigger_seq: 0 };
}

async function control(id: string): Promise<Control | undefined> {
  return runInDurableObject(hosted(id), async (_instance, state) => state.storage.get<Control>("execution"));
}

async function generationState(id: string): Promise<string | undefined> {
  return (await bindings.DB.prepare(`SELECT state FROM generations WHERE id = ?`).bind(id).first<{ state: string }>())?.state;
}

async function changeControl(id: string, changes: Partial<Control>): Promise<void> {
  await runInDurableObject(hosted(id), async (_instance, state) => {
    const stored = await state.storage.get<Control>("execution");
    await state.storage.put("execution", { ...stored, ...changes });
  });
}

function mockProvider(replies: Array<Response | Error> = []): { models: () => number; chats: () => number } {
  let models = 0;
  let chats = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/models")) { models++; return Response.json({ data: [{ id: "grok-4.5" }] }); }
    if (!url.endsWith("/chat/completions")) throw new Error("unexpected test network request");
    chats++;
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply ?? Response.json({ choices: [{ message: { content: "hello" }, finish_reason: "stop" }] });
  });
  return { models: () => models, chats: () => chats };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await bindings.DB.batch([
    "agent_runtime_changes", "agent_runtimes", "provider_connections", "messages", "bot_tokens", "generations", "room_members", "rooms", "members",
  ].map((table) => bindings.DB.prepare(`DELETE FROM ${table}`)));
  const accounting = bindings.ROOM.get(bindings.ROOM.idFromName("cost:global"));
  await runInDurableObject(accounting, async (_instance, state) => state.storage.deleteAll());
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("hosted generation cost safety integration", () => {
  it("expired deadlines refuse a new operation before it starts", async () => {
    const start = vi.fn(async () => "unexpected");
    await expect(beforeHostedDeadline(start, Date.now() - 1)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(start).not.toHaveBeenCalled();
  });

  it("a stalled operation stops local waiting at the original deadline", async () => {
    vi.useFakeTimers();
    const start = vi.fn(() => new Promise<never>(() => {}));
    const waiting = beforeHostedDeadline(start, Date.now() + 1_000);
    const assertion = expect(waiting).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("queued draft sends do not multiply a stalled RPC after the deadline", async () => {
    vi.useFakeTimers();
    const deadline = Date.now() + 1_000;
    const send = vi.fn(() => new Promise<never>(() => {}));
    const drafts = new DraftThrottle(async () => {
      if (Date.now() >= deadline) return;
      try { await beforeHostedDeadline(send, deadline); }
      catch { /* best-effort draft timeout */ }
    });
    drafts.push("a".repeat(64));
    drafts.push("b".repeat(64));
    drafts.push("c".repeat(64));
    const settled = drafts.settle();
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
    expect(send).toHaveBeenCalledTimes(1);
    expect(drafts.sentAny).toBe(true);
  });

  it.each([false, true])("completed v2=%s is terminal and cannot spend again through duplicate alarm/begin", async (v2) => {
    const calls = mockProvider();
    const input = await seed(v2);
    expect((await rpc(input.generation_id).begin(input)).ok).toBe(true);
    await rpc(input.generation_id).runScheduled();
    expect(await generationState(input.generation_id)).toBe("completed");
    await rpc(input.generation_id).runScheduled();
    expect((await rpc(input.generation_id).begin(input)).ok).toBe(false);
    expect(calls.chats()).toBe(1);
    expect(calls.models()).toBe(v2 ? 0 : 1);
    await runInDurableObject(hosted(input.generation_id), async (_instance, state) => {
      expect(await state.storage.get("job")).toBeUndefined();
      expect(await state.storage.get("fake_llm")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect((await control(input.generation_id))?.phase).toBe("terminal");
  });

  it("same DO cannot be rebound to a different generation/agent", async () => {
    const calls = mockProvider();
    const input = await seed();
    await rpc(input.generation_id).begin(input);
    expect((await rpc(input.generation_id).begin({ ...input, generation_id: crypto.randomUUID(), agent_id: "different" })).ok).toBe(false);
    expect(calls.models()).toBe(1);
  });

  it.each(["completed", "dropped", "failed"])("terminal D1 state %s blocks provider before a stored pending job", async (state) => {
    const calls = mockProvider();
    const input = await seed(true);
    await rpc(input.generation_id).begin(input);
    await bindings.DB.prepare(`UPDATE generations SET state = ? WHERE id = ?`).bind(state, input.generation_id).run();
    await rpc(input.generation_id).runScheduled();
    expect(calls.chats()).toBe(0);
    expect((await control(input.generation_id))?.phase).toBe("terminal");
  });

  it("pending work rechecks opt-in and refuses even an injected fake", async () => {
    const calls = mockProvider();
    const input = await seed(true);
    await rpc(input.generation_id).begin(input);
    await runInDurableObject(hosted(input.generation_id), (instance: HostedGeneration) => {
      (instance as unknown as { env: Env }).env.KITH_PAID_ENABLED = "off";
    });
    await rpc(input.generation_id).runScheduled();
    expect(calls.chats()).toBe(0);
    expect(await generationState(input.generation_id)).toBe("failed");
  });

  it("missing mandatory limit fails closed before discovery", async () => {
    const calls = mockProvider();
    const input = await seed();
    await runInDurableObject(hosted(input.generation_id), (instance: HostedGeneration) => {
      (instance as unknown as { env: Env }).env.KITH_MAX_PAID_ATTEMPTS_PER_DAY = undefined;
    });
    expect((await rpc(input.generation_id).begin(input)).ok).toBe(false);
    expect(calls.models()).toBe(0);
    expect(calls.chats()).toBe(0);
  });

  it("expired total deadline cannot call a provider", async () => {
    const calls = mockProvider();
    const input = await seed(true);
    await rpc(input.generation_id).begin(input);
    await changeControl(input.generation_id, { deadline: Date.now() - 1 });
    await rpc(input.generation_id).runScheduled();
    expect(calls.chats()).toBe(0);
    expect(await generationState(input.generation_id)).toBe("failed");
  });

  it("interrupted running phase never replays and expires fail closed", async () => {
    const calls = mockProvider();
    const input = await seed(true);
    await rpc(input.generation_id).begin(input);
    await changeControl(input.generation_id, { phase: "running" });
    await rpc(input.generation_id).runScheduled();
    expect(calls.chats()).toBe(0);
    await changeControl(input.generation_id, { deadline: Date.now() - 1 });
    await rpc(input.generation_id).runScheduled();
    expect(calls.chats()).toBe(0);
    expect((await control(input.generation_id))?.phase).toBe("terminal");
  });

  it.each([429, 503, 529])("explicit HTTP %s schedules one positive bounded retry and no third attempt", async (status) => {
    const calls = mockProvider([Response.json({ error: {} }, { status, headers: { "retry-after": "0" } })]);
    const input = await seed(true);
    await rpc(input.generation_id).begin(input);
    await rpc(input.generation_id).runScheduled();
    const retry = await control(input.generation_id);
    expect(retry?.phase).toBe("retry_wait");
    expect(retry?.attempt).toBe(1);
    expect(retry!.not_before).toBeGreaterThan(Date.now());
    expect(retry!.not_before).toBeLessThanOrEqual(Date.now() + 10_000);
    await rpc(input.generation_id).runScheduled(); // early duplicate must not consume the retry
    expect(calls.chats()).toBe(1);
    await changeControl(input.generation_id, { not_before: Date.now() - 1 });
    await rpc(input.generation_id).runScheduled();
    await rpc(input.generation_id).runScheduled();
    expect(calls.chats()).toBe(2);
    expect(await generationState(input.generation_id)).toBe("completed");
    const accounting = bindings.ROOM.get(bindings.ROOM.idFromName("cost:global"));
    await runInDurableObject(accounting, async (_instance, storage) => {
      const ledger = await storage.storage.get<{ total: number }>("paid_ledger");
      expect(ledger?.total).toBe(2);
    });
  });

  it("network result is unknown and is not retried", async () => {
    const calls = mockProvider([new TypeError("injected network failure")]);
    const input = await seed(true);
    await rpc(input.generation_id).begin(input);
    await rpc(input.generation_id).runScheduled();
    await rpc(input.generation_id).runScheduled();
    expect(calls.chats()).toBe(1);
    expect(await generationState(input.generation_id)).toBe("failed");
    expect((await control(input.generation_id))?.phase).toBe("terminal");
  });

  it("a concurrent duplicate cannot start a second provider call", async () => {
    let started!: () => void;
    let respond!: (response: Response) => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const response = new Promise<Response>((resolve) => { respond = resolve; });
    const send = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { started(); return response; });
    const input = await seed(true);
    await rpc(input.generation_id).begin(input);
    const first = rpc(input.generation_id).runScheduled();
    await ready;
    await rpc(input.generation_id).runScheduled();
    expect(send).toHaveBeenCalledTimes(1);
    respond(Response.json({ choices: [{ message: { content: "hello" }, finish_reason: "stop" }] }));
    await first;
    expect(await generationState(input.generation_id)).toBe("completed");
  });

  it("a generation timeout aborts and cannot schedule another paid attempt", async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const send = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      started();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("injected abort", "AbortError")), { once: true });
      });
    });
    const input = await seed(true);
    await rpc(input.generation_id).begin(input);
    const running = rpc(input.generation_id).runScheduled();
    await ready;
    await vi.advanceTimersByTimeAsync(300_000);
    await running;
    await rpc(input.generation_id).runScheduled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await generationState(input.generation_id)).toBe("failed");
    expect((await control(input.generation_id))?.phase).toBe("terminal");
  });

  it("daily admission failure stops inference before provider fetch", async () => {
    const calls = mockProvider();
    const input = await seed(true);
    await rpc(input.generation_id).begin(input);
    const accounting = bindings.ROOM.get(bindings.ROOM.idFromName("cost:global"));
    await runInDurableObject(accounting, async (_instance, state) => {
      await state.storage.put("paid_ledger", {
        day: new Date().toISOString().slice(0, 10), total: 1000, agents: {}, attempts: {}, leases: {},
      });
    });
    await rpc(input.generation_id).runScheduled();
    expect(calls.chats()).toBe(0);
    expect(await generationState(input.generation_id)).toBe("failed");
  });

  it("a D1 failure after provider acceptance does not make the Alarm spend again", async () => {
    const calls = mockProvider();
    const input = await seed(true);
    await rpc(input.generation_id).begin(input);
    await runInDurableObject(hosted(input.generation_id), (instance: HostedGeneration) => {
      const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => new Proxy(statement, {
        get(target, property) {
          if (property === "bind") return (...args: unknown[]) => wrap(target.bind(...args), sql);
          if (property === "run") return async () => {
            if (calls.chats() > 0 && sql.includes("UPDATE generations")) throw new Error("injected D1 unknown result");
            return target.run();
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const injected = instance as unknown as { env: Env };
      injected.env.DB = new Proxy(bindings.DB, {
        get(target, property) {
          if (property === "prepare") return (sql: string) => wrap(target.prepare(sql), sql);
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
    await expect(rpc(input.generation_id).runScheduled()).rejects.toThrow();
    await rpc(input.generation_id).runScheduled();
    expect(calls.chats()).toBe(1);
    expect((await control(input.generation_id))?.phase).toBe("terminal");
  });

  it("a retry does not bypass a newly activated kill switch", async () => {
    const calls = mockProvider([Response.json({ error: {} }, { status: 429 })]);
    const input = await seed(true);
    await rpc(input.generation_id).begin(input);
    await rpc(input.generation_id).runScheduled();
    await changeControl(input.generation_id, { not_before: Date.now() - 1 });
    await runInDurableObject(hosted(input.generation_id), (instance: HostedGeneration) => {
      (instance as unknown as { env: Env }).env.KITH_PAID_ENABLED = "off";
    });
    await rpc(input.generation_id).runScheduled();
    expect(calls.chats()).toBe(1);
    expect((await control(input.generation_id))?.phase).toBe("terminal");
  });
});

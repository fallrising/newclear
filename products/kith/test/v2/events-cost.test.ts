import type { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../worker/env.ts";
import { EVENT_CATCHUP_MAX_PAGES, EVENT_STREAM_MAX_MS, handleMcpEvents } from "../../worker/events.ts";

function fixture(options: { refuse?: boolean; admissionError?: boolean; catchup?: boolean; oneRow?: boolean } = {}) {
  const requestController = new AbortController();
  const request = new Request("https://cost-test.invalid/mcp/events?room_id=room&after_seq=0", {
    headers: { Authorization: "Bearer fake-only" }, signal: requestController.signal,
  });
  let releaseReady!: () => void;
  let waitReady!: () => void;
  let queryReady!: () => void;
  const released = new Promise<void>((resolve) => { releaseReady = resolve; });
  const waiting = new Promise<void>((resolve) => { waitReady = resolve; });
  const queried = new Promise<void>((resolve) => { queryReady = resolve; });
  const active = new Map<string, { resolve: (items: []) => void; timer: ReturnType<typeof setTimeout> }>();
  const stats = { queries: 0, waits: 0, cancels: 0, releases: 0 };
  const inbox = {
    liveAfter: async () => [],
    waitAfter: async (_cursor: number, id: string, timeoutMs: number) => {
      stats.waits++;
      waitReady();
      return new Promise<[]>((resolve) => {
        const timer = setTimeout(() => { active.delete(id); resolve([]); }, timeoutMs);
        active.set(id, { resolve, timer });
      });
    },
    cancelWait: async (id: string) => {
      stats.cancels++;
      const pending = active.get(id);
      if (pending) { clearTimeout(pending.timer); active.delete(id); pending.resolve([]); }
    },
  };
  const bindings = {
    ff_mcp: "on", ff_providers: "off",
    ROOM: { idFromName: (name: string) => name, get: () => ({
      admitEventStream: async () => {
        if (options.admissionError) throw new Error("injected admission outage");
        return { ok: !options.refuse };
      },
      releaseEventStream: async () => { stats.releases++; releaseReady(); },
    }) },
    INBOX: { idFromName: (name: string) => name, get: () => inbox },
    DB: { prepare: (sql: string) => {
      let values: unknown[] = [];
      return {
        bind(...args: unknown[]) { values = args; return this; },
        first: async () => {
          if (sql.includes("FROM bot_tokens")) return { id: "token", member_id: "agent", expires_at: null, revoked_at: null };
          if (sql.includes("FROM members")) return { id: "agent", kind: "agent", disabled_at: null };
          if (sql.includes("FROM room_members")) return { ok: 1 };
          throw new Error("unexpected test SQL");
        },
        run: async () => ({ success: true }),
        all: async () => {
          stats.queries++;
          queryReady();
          const cursor = Number(values[1]);
          const count = options.catchup ? 50 : options.oneRow && cursor === 0 ? 1 : 0;
          return { results: Array.from({ length: count }, (_, offset) => ({
            id: `m-${cursor + offset + 1}`, room_id: "room", seq: cursor + offset + 1, kind: "message",
            thread_id: null, reply_to: null, sender_id: "operator", body: "hello", mentions_json: "[]",
            generation_id: null, client_message_id: "fake-id", origin: "local", created_at: "2026-01-01T00:00:00Z",
          })) };
        },
      };
    } },
  } as unknown as Env;
  const context = {
    env: bindings, req: { url: request.url, raw: request, header: (name: string) => request.headers.get(name) },
    json: (body: unknown, status: number) => Response.json(body, { status }),
  } as unknown as Context<{ Bindings: Env }>;
  return { context, requestController, released, waiting, queried, stats, active };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("event stream cost bounds", () => {
  it("room stream refusal returns 429 before catch-up or Inbox work", async () => {
    const f = fixture({ refuse: true });
    const response = await handleMcpEvents(f.context);
    expect(response.status).toBe(429);
    expect(f.stats).toEqual({ queries: 0, waits: 0, cancels: 0, releases: 0 });
  });

  it("admission outage fails closed instead of creating an unaccounted stream", async () => {
    const f = fixture({ admissionError: true });
    expect((await handleMcpEvents(f.context)).status).toBe(503);
    expect(f.stats.queries).toBe(0);
  });

  it("catch-up stops at 20 indexed pages and preserves the last seq for reconnect", async () => {
    const f = fixture({ catchup: true });
    const response = await handleMcpEvents(f.context);
    const body = await response.text();
    expect(f.stats.queries).toBe(EVENT_CATCHUP_MAX_PAGES);
    expect(f.stats.waits).toBe(0);
    expect(f.stats.releases).toBe(1);
    expect(body).toContain("id: 1000\nevent: replay");
    expect(body).toContain(": catchup_limit\n\n");
    expect(body).not.toContain('"replay":false');
  });

  it("request abort cancels the registered wait and releases the room lease", async () => {
    const f = fixture();
    const response = await handleMcpEvents(f.context);
    const read = expect(response.text()).rejects.toMatchObject({ name: "AbortError" });
    await f.waiting;
    f.requestController.abort();
    await f.released;
    await read;
    expect(f.stats.waits).toBe(1);
    expect(f.stats.cancels).toBe(1);
    expect(f.active.size).toBe(0);
  });

  it("body cancellation cleans up even if the original request signal stays live", async () => {
    const f = fixture();
    const response = await handleMcpEvents(f.context);
    await f.waiting;
    await response.body!.cancel();
    await f.released;
    expect(f.requestController.signal.aborted).toBe(false);
    expect(f.stats.cancels).toBe(1);
    expect(f.active.size).toBe(0);
  });

  it("idle streams stop at 300 seconds after at most ten bounded waits", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const response = await handleMcpEvents(f.context);
    const read = expect(response.text()).rejects.toMatchObject({ name: "AbortError" });
    await f.waiting;
    await vi.advanceTimersByTimeAsync(EVENT_STREAM_MAX_MS);
    await f.released;
    await read;
    expect(f.stats.waits).toBeLessThanOrEqual(10);
    expect(f.stats.releases).toBe(1);
    expect(f.active.size).toBe(0);
  });

  it("a reader that never drains catch-up cannot hold the writer beyond the deadline", async () => {
    vi.useFakeTimers();
    const f = fixture({ oneRow: true });
    const response = await handleMcpEvents(f.context);
    await f.queried; // deliberately do not consume the body until the deadline expires
    await vi.advanceTimersByTimeAsync(EVENT_STREAM_MAX_MS);
    await f.released;
    await expect(response.text()).rejects.toMatchObject({ name: "AbortError" });
    expect(f.stats.queries).toBe(1);
    expect(f.stats.waits).toBe(0);
    expect(f.stats.releases).toBe(1);
  });

  it("graceful close is bounded even when the stream sink never resolves close", async () => {
    vi.useFakeTimers();
    let closeReady!: () => void;
    const closing = new Promise<void>((resolve) => { closeReady = resolve; });
    const writer = {
      closed: new Promise<never>(() => {}), write: async () => {},
      close: vi.fn(() => { closeReady(); return new Promise<never>(() => {}); }),
      abort: vi.fn(async () => {}),
    };
    vi.stubGlobal("TransformStream", class {
      readable = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
      writable = { getWriter: () => writer };
    });
    const f = fixture({ catchup: true });
    expect((await handleMcpEvents(f.context)).status).toBe(200);
    await closing;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(writer.close).toHaveBeenCalledTimes(1);
    expect(writer.abort).toHaveBeenCalledTimes(1);
    expect(f.stats.releases).toBe(1);
  });
});

import type { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLiveSidecar } from "../../sidecar/loop.ts";
import type { SidecarConfig } from "../../sidecar/config.ts";
import type { SpawnResult } from "../../sidecar/spawn.ts";
import type { Env } from "../../worker/env.ts";
import { EVENT_STREAM_MAX_MS, handleMcpEvents } from "../../worker/events.ts";

const config: SidecarConfig = {
  agent_handle: "codex", room_id: "room", operator_member_id: "operator", quota_class: "operator_personal",
  codex_home: "fake-home", workspace: "fake-workspace", executable: "never-exec", mcp_base_url: "https://offline.invalid",
};
const env = { KITH_BOT_TOKEN: "fake-only" };
const encoder = new TextEncoder();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function event(seq: number, replay = false) {
  return `id: ${seq}\nevent: room\ndata: ${JSON.stringify({ seq, kind: "message", body: "@codex hello", sender_id: "operator", replay })}\n\n`;
}

function workerStream(live = false) {
  const waiting = deferred<void>();
  const released = deferred<void>();
  const waits = new Map<string, { resolve: (items: []) => void; timer: ReturnType<typeof setTimeout> }>();
  const stats = { cancels: 0, releases: 0 };
  const bindings = {
    ff_mcp: "on", ff_providers: "off",
    ROOM: { idFromName: (name: string) => name, get: () => ({
      admitEventStream: async () => ({ ok: true }),
      releaseEventStream: async () => { stats.releases++; released.resolve(); },
    }) },
    INBOX: { idFromName: (name: string) => name, get: () => ({
      liveAfter: async () => live ? [{ id: "message", room_id: "room", seq: 1, kind: "message", body: "@codex hello", sender_id: "operator", sender_kind: "human", mentions: ["agent"], origin: "local" }] : [],
      waitAfter: async (_cursor: number, id: string, timeout: number) => {
        waiting.resolve();
        return new Promise<[]>((resolve) => {
          const timer = setTimeout(() => { waits.delete(id); resolve([]); }, timeout);
          waits.set(id, { resolve, timer });
        });
      },
      cancelWait: async (id: string) => {
        stats.cancels++;
        const pending = waits.get(id);
        if (pending) { clearTimeout(pending.timer); waits.delete(id); pending.resolve([]); }
      },
    }) },
    DB: { prepare: (sql: string) => ({
      bind() { return this; },
      first: async () => {
        if (sql.includes("SELECT rm.attention_mode")) return { attention_mode: "mention", keywords_json: "[]", quota_class: "operator_personal", operator_id: "operator" };
        if (sql.includes("FROM bot_tokens")) return { id: "token", member_id: "agent", expires_at: null, revoked_at: null };
        if (sql.includes("FROM members")) return { id: "agent", kind: "agent", disabled_at: null };
        if (sql.includes("FROM room_members")) return { ok: 1 };
        throw new Error("unexpected test SQL");
      },
      run: async () => ({ success: true }), all: async () => ({ results: [] }),
    }) },
  } as unknown as Env;
  return {
    waiting: waiting.promise, released: released.promise, stats,
    response: (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return handleMcpEvents({ env: bindings,
        req: { url: request.url, raw: request, header: (name: string) => request.headers.get(name) },
        json: (body: unknown, status: number) => Response.json(body, { status }),
      } as unknown as Context<{ Bindings: Env }>);
    },
  };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("live sidecar transport cost recovery", () => {
  it("reconnects after the actual Worker SSE deadline with the retained cursor", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const worker = workerStream();
    const urls: string[] = [];
    const spawn = vi.fn(async () => { throw new Error("must not spawn"); });
    const task = runLiveSidecar({ config, env, maxSeq: 7, signal: controller.signal, spawn, log: () => {},
      fetch: async (input, init) => {
        urls.push(String(input));
        if (urls.length === 1) return worker.response(input, init);
        controller.abort();
        return new Response("");
      },
    });
    await worker.waiting;
    await vi.advanceTimersByTimeAsync(EVENT_STREAM_MAX_MS + 500);
    const result = await task;
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.endsWith("after_seq=7"))).toBe(true);
    expect(result.cursor).toBe(7);
    expect(spawn).not.toHaveBeenCalled();
    expect(worker.stats).toEqual({ cancels: 1, releases: 1 });
  });

  it("finishes an active generation once through rotation before reconnecting or consuming replay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const worker = workerStream(true);
    const started = deferred<void>();
    const finish = deferred<SpawnResult>();
    const sent = deferred<void>();
    const urls: string[] = [];
    const posts: Array<Record<string, unknown>> = [];
    const spawn = vi.fn(async () => { started.resolve(); return finish.promise; });
    const task = runLiveSidecar({ config, env, maxSeq: 0, signal: controller.signal, spawn,
      log: (line) => { if (line === "replay_skip seq=2") controller.abort(); },
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes("/mcp/events")) {
          urls.push(url);
          return urls.length === 1 ? worker.response(input, init) : new Response(event(1) + event(2, true));
        }
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posts.push(body);
        if (body.method === "tools/call" && (body.params as { name?: string }).name === "send_message") sent.resolve();
        return Response.json({ jsonrpc: "2.0", id: 1, result: { ok: true } });
      },
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(EVENT_STREAM_MAX_MS);
    await worker.released;
    expect(urls).toHaveLength(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    finish.resolve({ stdout: "fake reply", stderr: "", exitCode: 0, argv: [], stdin: "" });
    await sent.promise;
    await vi.advanceTimersByTimeAsync(500);
    const result = await task;
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("after_seq=1");
    expect(result.cursor).toBe(2);
    expect(result.cliCount).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(3); // accepted status, trace, final send
    const status = posts[0].params as { arguments: { generation_id: string } };
    const final = posts[2].params as { arguments: { body: string; client_message_id: string } };
    expect(posts[1].generation_id).toBe(status.arguments.generation_id);
    expect(final.arguments.body).toContain(status.arguments.generation_id);
    expect(final.arguments.client_message_id).toBe(`kith${status.arguments.generation_id.replace(/-/g, "").slice(0, 20)}`);
    expect(result.traces[0]).toContain(status.arguments.generation_id);
  });

  it("explicit cancellation closes an idle reader and exits without another fetch", async () => {
    const controller = new AbortController();
    const opened = deferred<void>();
    const cancel = vi.fn();
    const fetch = vi.fn(async () => {
      opened.resolve();
      return new Response(new ReadableStream<Uint8Array>({ cancel }));
    });
    const task = runLiveSidecar({ config, env, maxSeq: 3, signal: controller.signal, fetch, log: () => {} });
    await opened.promise;
    controller.abort();
    expect((await task).cursor).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancellation interrupts the reconnect delay without leaving a timer or opening another stream", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const failed = deferred<void>();
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) { stream.error(new Error("fake read failure")); },
    })));
    const task = runLiveSidecar({ config, env, maxSeq: 4, signal: controller.signal, fetch,
      log: (line) => { if (line === "events read failed; reconnect") failed.resolve(); },
    });
    await failed.promise;
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect((await task).cursor).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("execution failure is not treated as a transport error or retried with another spawn", async () => {
    const controller = new AbortController();
    const spawn = vi.fn(async () => { throw new Error("fake CLI unknown outcome"); });
    const fetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/mcp/events")
      ? new Response(event(1)) : Response.json({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    await expect(runLiveSidecar({ config, env, maxSeq: 0, signal: controller.signal, fetch, spawn, log: () => {} }))
      .rejects.toThrow("fake CLI unknown outcome");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/mcp/events"))).toHaveLength(1);
  });

  it("EOF reconnect retains replay progress and cancellation during fetch returns cleanly", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const replayed = deferred<void>();
    const urls: string[] = [];
    const spawn = vi.fn(async () => { throw new Error("must not spawn"); });
    const task = runLiveSidecar({ config, env, maxSeq: 0, signal: controller.signal, spawn,
      log: (line) => { if (line === "replay_skip seq=5") replayed.resolve(); },
      fetch: async (input) => {
        urls.push(String(input));
        if (urls.length === 1) return new Response(event(5, true));
        controller.abort();
        throw new DOMException("fetch aborted", "AbortError");
      },
    });
    await replayed.promise;
    await vi.advanceTimersByTimeAsync(500);
    expect((await task).cursor).toBe(5);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("after_seq=5");
    expect(spawn).not.toHaveBeenCalled();
  });
});

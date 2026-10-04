import { describe, expect, it, vi } from "vitest";
import type { AiEvent } from "./ai_ipc";
import { AiRequestLifecycle } from "./ai_request_lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function owner(cancel = vi.fn(async (_id: string) => true)) {
  const deliver = vi.fn(), changed = vi.fn(), failed = vi.fn(), submitted = vi.fn();
  const lifecycle = new AiRequestLifecycle(cancel, deliver, changed, failed);
  const submit = (ask = vi.fn(async () => "ours")) => lifecycle.submit(Promise.resolve(), async () => "context", ask, submitted);
  return { lifecycle, cancel, deliver, changed, failed, submitted, submit };
}

function terminal(kind: "done" | "error" | "cancelled", request_id = "ours"): AiEvent {
  if (kind === "done") return { kind, request_id, usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  if (kind === "error") return { kind, request_id, message: "failure" };
  return { kind, request_id };
}

describe("document AI request ownership", () => {
  it("closing cancels only its active request, once, without UI callbacks", async () => {
    const current = owner(), other = owner();
    await current.submit();
    await other.submit(vi.fn(async () => "other"));
    current.changed.mockClear();
    current.lifecycle.close();
    current.lifecycle.close();
    expect(current.cancel).toHaveBeenCalledExactlyOnceWith("ours");
    expect(other.cancel).not.toHaveBeenCalled();
    expect(current.changed).not.toHaveBeenCalled();
  });

  it("cancels an ID returned after close and catches cleanup rejection", async () => {
    const id = deferred<string>(), cancelled = deferred<boolean>();
    const current = owner(vi.fn(() => cancelled.promise));
    const pending = current.submit(vi.fn(() => id.promise));
    await vi.waitFor(() => expect(current.changed).toHaveBeenCalled());
    // Allow ready and context preparation to reach the pending invoke.
    await Promise.resolve(); await Promise.resolve();
    current.lifecycle.close();
    current.changed.mockClear();
    id.resolve("late");
    await pending;
    cancelled.reject(new Error("IPC gone"));
    await Promise.resolve();
    expect(current.cancel).toHaveBeenCalledExactlyOnceWith("late");
    expect(current.changed).not.toHaveBeenCalled();
    expect(current.failed).not.toHaveBeenCalled();
    expect(current.submitted).not.toHaveBeenCalled();
  });

  it.each(["done", "error", "cancelled"] as const)("early buffered %s clears ownership before close", async (kind) => {
    const current = owner();
    await current.submit(vi.fn(async () => {
      current.lifecycle.accept({ kind: "started", request_id: "other" });
      current.lifecycle.accept({ kind: "started", request_id: "ours" });
      current.lifecycle.accept({ kind: "text", request_id: "ours", delta: "你好🙂" });
      current.lifecycle.accept(terminal(kind));
      return "ours";
    }));
    expect(current.deliver.mock.calls.map(([event]) => event.kind)).toEqual(["started", "text", kind]);
    expect(current.changed).toHaveBeenLastCalledWith({ busy: false, requestId: null });
    current.lifecycle.close();
    expect(current.cancel).not.toHaveBeenCalled();
  });

  it.each(["done", "error", "cancelled"] as const)("a later %s clears ownership and permits another request", async (kind) => {
    const current = owner();
    await current.submit();
    current.lifecycle.accept(terminal(kind, "other"));
    expect(current.changed).toHaveBeenLastCalledWith({ busy: true, requestId: "ours" });
    current.lifecycle.accept(terminal(kind));
    await current.submit(vi.fn(async () => "next"));
    current.lifecycle.close();
    expect(current.cancel).toHaveBeenCalledExactlyOnceWith("next");
  });

  it("keeps Cancel available and reports cancellation rejection while open", async () => {
    const error = new Error("cancel transport failed");
    const current = owner(vi.fn(async () => { throw error; }));
    await current.submit();
    await current.lifecycle.cancel();
    expect(current.failed).toHaveBeenCalledExactlyOnceWith(error, "cancel");
    expect(current.changed).toHaveBeenLastCalledWith({ busy: true, requestId: "ours" });
    current.lifecycle.accept(terminal("cancelled"));
    current.lifecycle.close();
    expect(current.cancel).toHaveBeenCalledTimes(1);
  });

  it("successful Cancel waits for a terminal event before releasing ownership", async () => {
    const current = owner();
    await current.submit();
    await current.lifecycle.cancel();
    expect(current.changed).toHaveBeenLastCalledWith({ busy: true, requestId: "ours" });
    current.lifecycle.accept(terminal("cancelled"));
    expect(current.changed).toHaveBeenLastCalledWith({ busy: false, requestId: null });
  });

  it("ignores a cancellation rejection after close", async () => {
    const result = deferred<boolean>();
    const current = owner(vi.fn(() => result.promise));
    await current.submit();
    const pending = current.lifecycle.cancel();
    current.lifecycle.close();
    current.changed.mockClear();
    result.reject(new Error("closed"));
    await pending;
    expect(current.failed).not.toHaveBeenCalled();
    expect(current.changed).not.toHaveBeenCalled();
  });

  it("old listener readiness cannot start work in a replacement lifetime", async () => {
    const ready = deferred<void>(), old = owner(), fresh = owner(), ask = vi.fn(async () => "obsolete");
    const prepare = vi.fn(async () => "context");
    const pending = old.lifecycle.submit(ready.promise, prepare, ask, old.submitted);
    old.lifecycle.close();
    await fresh.submit(vi.fn(async () => "fresh"));
    old.changed.mockClear();
    ready.resolve();
    await pending;
    expect(prepare).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(old.changed).not.toHaveBeenCalled();
    expect(fresh.changed).toHaveBeenLastCalledWith({ busy: true, requestId: "fresh" });
  });

  it("old context preparation cannot invoke AI after close", async () => {
    const context = deferred<string>(), current = owner(), ask = vi.fn(async () => "obsolete");
    const pending = current.lifecycle.submit(Promise.resolve(), () => context.promise, ask, current.submitted);
    await Promise.resolve();
    current.lifecycle.close();
    context.resolve("context");
    await pending;
    expect(ask).not.toHaveBeenCalled();
  });

  it("old late IDs and events cannot activate in a replacement lifetime", async () => {
    const id = deferred<string>(), old = owner(), fresh = owner();
    const ask = vi.fn(() => id.promise);
    const pending = old.submit(ask);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    old.lifecycle.close();
    await fresh.submit(vi.fn(async () => "fresh"));
    old.changed.mockClear();
    id.resolve("old");
    await pending;
    old.lifecycle.accept({ kind: "text", request_id: "fresh", delta: "obsolete listener" });
    fresh.lifecycle.accept(terminal("done", "old"));
    expect(old.cancel).toHaveBeenCalledExactlyOnceWith("old");
    expect(old.changed).not.toHaveBeenCalled();
    expect(old.deliver).not.toHaveBeenCalled();
    expect(fresh.changed).toHaveBeenLastCalledWith({ busy: true, requestId: "fresh" });
    expect(fresh.deliver).not.toHaveBeenCalled();
  });

  it("surfaces event overflow and cancels the admitted request", async () => {
    const current = owner();
    await current.submit(vi.fn(async () => {
      for (let i = 0; i <= 4096; i++) current.lifecycle.accept({ kind: "started", request_id: "ours" });
      return "ours";
    }));
    expect(current.failed).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("overflow") }), "request");
    expect(current.cancel).toHaveBeenCalledExactlyOnceWith("ours");
    expect(current.changed).toHaveBeenLastCalledWith({ busy: false, requestId: null });
  });

  it("serializes submissions before listener readiness and reports preparation failure", async () => {
    const ready = deferred<void>(), current = owner(), ask = vi.fn(async () => "ours");
    const error = new Error("context unreadable");
    const pending = current.lifecycle.submit(ready.promise, async () => { throw error; }, ask, current.submitted);
    await current.submit(ask);
    expect(ask).not.toHaveBeenCalled();
    ready.resolve();
    await pending;
    expect(current.failed).toHaveBeenCalledExactlyOnceWith(error, "request");
    expect(current.changed).toHaveBeenLastCalledWith({ busy: false, requestId: null });
  });
});

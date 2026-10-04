import { describe, expect, it, vi } from "vitest";
import { AiEventGate, collectContext } from "./ai_lifecycle";
import type { AiEvent } from "./ai_ipc";

describe("AI submission", () => {
  it.each(["error", "done", "cancelled"] as const)("delivers Started and early %s before invoke resolves", (kind) => {
    const gate = new AiEventGate(); const deliver = vi.fn();
    const terminal: AiEvent = kind === "error" ? { kind, request_id: "ours", message: "fast failure" } : kind === "done" ? { kind, request_id: "ours", usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } : { kind, request_id: "ours" };
    gate.begin();
    gate.accept({ kind: "started", request_id: "other" }, deliver);
    gate.accept({ kind: "started", request_id: "ours" }, deliver);
    gate.accept({ kind: "text", request_id: "ours", delta: "你好🙂" }, deliver);
    gate.accept(terminal, deliver);
    gate.activate("ours", deliver);
    expect(deliver.mock.calls.map(([event]) => event.kind)).toEqual(["started", "text", kind]);
    gate.accept({ kind: "text", request_id: "ours", delta: "late" }, deliver);
    expect(deliver).toHaveBeenCalledTimes(3);
  });
  it("refreshes document and terminal sources on each submission", async () => {
    let body = "first", output = "first output";
    const sources = [{ kind: "doc", path: "source.md" }, { kind: "terminal", sessionId: "session", label: "shell" }] as const;
    const read = vi.fn(async () => ({ content: body })); const scroll = vi.fn(async () => output);
    await collectContext([...sources], read, scroll);
    body = "changed source"; output = "appended output";
    expect(await collectContext([...sources], read, scroll)).toEqual([{ source: "doc:source.md", content: body }, { source: "term:shell", content: output }]);
    expect(read).toHaveBeenCalledTimes(2); expect(scroll).toHaveBeenCalledTimes(2);
  });
  it("unreadable context fails visibly instead of silently omitting requested input", async () => {
    await expect(collectContext([{ kind: "doc", path: "missing.md" }], async () => { throw new Error("missing"); }, async () => "")).rejects.toThrow("doc:missing.md");
  });
  it("delivers subsequent events normally and ignores a disposed request", () => {
    const gate = new AiEventGate(); const deliver = vi.fn();
    gate.begin(); gate.activate("ours", deliver);
    gate.accept({ kind: "started", request_id: "ours" }, deliver);
    gate.accept({ kind: "text", request_id: "other", delta: "ignore" }, deliver);
    gate.accept({ kind: "text", request_id: "ours", delta: "current" }, deliver);
    gate.reset(); gate.accept({ kind: "error", request_id: "ours", message: "after close" }, deliver);
    expect(deliver.mock.calls.map(([event]) => event.kind)).toEqual(["started", "text"]);
  });
  it("surfaces pre-registration event overflow and can start a fresh request", () => {
    const gate = new AiEventGate(); const deliver = vi.fn(); gate.begin();
    for (let i = 0; i <= 4096; i++) gate.accept({ kind: "started", request_id: "ours" }, deliver);
    expect(() => gate.activate("ours", deliver)).toThrow(/overflow/);
    expect(deliver).not.toHaveBeenCalled();
    gate.begin(); gate.accept({ kind: "started", request_id: "fresh" }, deliver); gate.activate("fresh", deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletion, listModelIds, HOSTED_OUTPUT_DEFAULT, type FetchLike } from "../../worker/hosted/llm.ts";
import { MAX_RESPONSE_BYTES } from "../../worker/providers/http.ts";

afterEach(() => vi.useRealTimers());

describe("hosted legacy provider cost bounds", () => {
  it("sends an explicit output cap, AbortSignal and no redirects", async () => {
    const send = vi.fn<FetchLike>(async () => Response.json({ choices: [{ message: { content: "hello" } }] }));
    expect(await chatCompletion(send, "fake-key", [])).toBe("hello");
    const init = send.mock.calls[0]![1]!;
    expect(JSON.parse(String(init.body)).max_tokens).toBe(HOSTED_OUTPUT_DEFAULT);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe("manual");
  });

  it("aborts a pending completion at its deadline without another fetch", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null = null;
    const send = vi.fn<FetchLike>(async (_url, init) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>(() => {}); // even an uncooperative injected fetch must not stall the caller
    });
    const pending = chatCompletion(send, "fake", [], undefined, { timeoutMs: 1000 });
    const failed = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
    expect(signal!.aborted).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("bounds the model discovery request too", async () => {
    vi.useFakeTimers();
    const send = vi.fn<FetchLike>(async () => new Promise<Response>(() => {}));
    const pending = listModelIds(send, "fake", { timeoutMs: 100 });
    const failed = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(100);
    await failed;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refuses an already-aborted request before fetch", async () => {
    const controller = new AbortController(); controller.abort();
    const send = vi.fn<FetchLike>();
    await expect(chatCompletion(send, "fake", [], undefined, { signal: controller.signal })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([0, -1, 8193, 1.5, Number.NaN])("rejects unsafe output ceiling %s before network", async (maxOutputTokens) => {
    const send = vi.fn<FetchLike>();
    await expect(chatCompletion(send, "fake", [], undefined, { maxOutputTokens })).rejects.toThrow("invalid hosted output limit");
    expect(send).not.toHaveBeenCalled();
  });

  it.each([0, -1, 300001, Number.NaN])("rejects invalid timeout %s before network", async (timeoutMs) => {
    const send = vi.fn<FetchLike>();
    await expect(listModelIds(send, "fake", { timeoutMs })).rejects.toThrow("invalid hosted timeout");
    expect(send).not.toHaveBeenCalled();
  });

  it("cancels a declared oversized response", async () => {
    const cancel = vi.fn();
    const send: FetchLike = async () => new Response(new ReadableStream({ cancel }), { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } });
    await expect(chatCompletion(send, "fake", [])).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("caps an undeclared chunked response", async () => {
    const cancel = vi.fn();
    const send: FetchLike = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1)); }, cancel,
    }));
    await expect(chatCompletion(send, "fake", [])).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not accept non-object provider JSON", async () => {
    await expect(chatCompletion(async () => Response.json([]), "fake", [])).rejects.toThrow("invalid hosted response");
    await expect(listModelIds(async () => Response.json({}), "fake")).rejects.toThrow("invalid hosted model list");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { APIError } from "./model";
import {
  DeliveryPager,
  deliveryPath,
  replayDelivery,
  replayErrorText,
} from "./deliveries";

afterEach(() => vi.unstubAllGlobals());
const response = (items: number[], cursor: string | null = null) =>
  new Response(JSON.stringify({ items, next_cursor: cursor }));

describe("delivery query and replay", () => {
  it("encodes only subscription and state, including opaque cursor bytes", () => {
    expect(deliveryPath("a&b", "dlq", "opaque+/=")).toBe(
      "/v1/deliveries?limit=100&subscription=a%26b&state=dlq&cursor=opaque%2B%2F%3D",
    );
  });
  it("rejects blank replay reasons before any request and sends an encoded ID with credentials only in headers", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ delivery_id: "a:1", state: "pending" }), {
          status: 202,
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      replayDelivery("a:1", "  \n", "synthetic", new AbortController().signal),
    ).rejects.toThrow("reason");
    expect(fetcher).not.toHaveBeenCalled();
    await replayDelivery(
      "a:1",
      "  synthetic fix  ",
      "synthetic",
      new AbortController().signal,
    );
    expect(fetcher.mock.calls[0]).toEqual([
      "/v1/deliveries/a%3A1:replay",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: {
          Authorization: "Bearer synthetic",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "synthetic fix" }),
      }),
    ]);
  });
  it("explains readonly and stale replay failures without exposing server bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("sensitive receiver details", { status: 403 }),
      ),
    );
    await expect(
      replayDelivery("a:1", "fix", "reader", new AbortController().signal),
    ).rejects.toEqual(new APIError(403));
    expect(replayErrorText(new APIError(403))).toContain("owner");
    expect(replayErrorText(new APIError(403))).toContain("唯讀");
    expect(replayErrorText(new APIError(409))).toContain("DLQ");
  });
  it("does not report a replay result after logout aborts a response", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        return new Response(
          JSON.stringify({ delivery_id: "a:1", state: "pending" }),
        );
      }),
    );
    await expect(
      replayDelivery("a:1", "fix", "owner", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("delivery pagination lifecycle", () => {
  it("retains prior rows and the retry cursor when a later page fails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([1], "a&b"))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(response([2]));
    vi.stubGlobal("fetch", fetcher);
    const pager = new DeliveryPager<number>(
      "/v1/deliveries?limit=100&state=dlq",
      "reader",
      vi.fn(),
    );
    await pager.load();
    await pager.load();
    expect(pager.getSnapshot()).toMatchObject({
      items: [1],
      cursor: "a&b",
      error: new APIError(503),
      loading: false,
      more: false,
    });
    await pager.load();
    expect(pager.getSnapshot()).toMatchObject({
      items: [1, 2],
      cursor: null,
      error: null,
    });
    expect(fetcher.mock.calls[2][0]).toBe(
      "/v1/deliveries?limit=100&state=dlq&cursor=a%26b",
    );
    pager.dispose();
    expect(pager.getSnapshot().items).toEqual([]);
  });
  it("ignores late responses after disposal, including authentication errors", async () => {
    let resolve!: (value: Response) => void;
    const denied = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const pager = new DeliveryPager<number>(
      "/v1/deliveries?limit=100",
      "reader",
      denied,
    );
    const pending = pager.load();
    pager.dispose();
    resolve(new Response("", { status: 401 }));
    await pending;
    expect(pager.getSnapshot().items).toEqual([]);
    expect(denied).not.toHaveBeenCalled();
  });
  it("ignores double clicks and fails closed on repeated cursors", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(response([2], "same"));
    vi.stubGlobal("fetch", fetcher);
    const pager = new DeliveryPager<number>(
      "/v1/subscriptions?limit=100",
      "reader",
      vi.fn(),
    );
    const pending = pager.load();
    await pager.load();
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(response([1], "same"));
    await pending;
    await pager.load();
    expect(pager.getSnapshot().items).toEqual([1]);
    expect(pager.getSnapshot().error).toBeInstanceOf(Error);
  });
});

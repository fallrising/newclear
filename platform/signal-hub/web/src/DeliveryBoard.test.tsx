import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LastAttempt, SubscriptionCounts } from "./DeliveryBoard";
import type { Delivery } from "./deliveries";
const delivery: Delivery = {
  delivery_id: "sub:1",
  subscription_id: "sub",
  state: "dlq",
  event_seq: 1,
  window_start: null,
  attempt_count: 4,
  last_attempt: null,
  next_attempt_at: null,
};
describe("delivery presentation", () => {
  it("renders all server subscription counts and channel/mode without inferring success", () => {
    const markup = renderToStaticMarkup(
      <SubscriptionCounts
        items={[
          {
            id: "synthetic",
            mode: "digest",
            channel_kind: "ntfy",
            counts: { pending: 3, inflight: 2, succeeded: 1, dlq: 4 },
          },
        ]}
      />,
    );
    for (const label of [
      "等待／重試中",
      "投遞中",
      "成功",
      "DLQ",
      "ntfy",
      "每日摘要",
    ])
      expect(markup).toContain(label);
    for (const count of [1, 2, 3, 4])
      expect(markup).toContain(`<dd>${count}</dd>`);
  });
  it("distinguishes missing attempts, transport failure and HTTP response, escaping error text", () => {
    expect(renderToStaticMarkup(<LastAttempt delivery={delivery} />)).toContain(
      "尚無嘗試紀錄",
    );
    const attempt = {
      at: "2026-10-13T00:00:00Z",
      http_status: null,
      duration_ms: 17,
      error: "<script>synthetic</script>",
    };
    const markup = renderToStaticMarkup(
      <LastAttempt
        delivery={{
          ...delivery,
          last_attempt: attempt,
          next_attempt_at: "2026-10-13T00:01:00Z",
        }}
      />,
    );
    expect(markup).toContain("未收到 HTTP 回應");
    expect(markup).toContain("17 ms");
    expect(markup).toContain("下次嘗試");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(
      renderToStaticMarkup(
        <LastAttempt
          delivery={{
            ...delivery,
            last_attempt: { ...attempt, http_status: 400 },
          }}
        />,
      ),
    ).toContain("HTTP 400");
  });
});

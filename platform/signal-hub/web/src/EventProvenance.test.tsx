import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RestoredBadge, RestoredNotice } from "./EventProvenance";
import type { StoredEvent } from "./model";

const event: StoredEvent = {
  seq: 42,
  received_at: "2026-01-01T00:00:00Z",
  clock_skew: false,
  event: {
    specversion: "1.0",
    id: "synthetic",
    source: "urn:example:archive",
    type: "demo.event.created",
    time: "2026-01-01T00:00:00Z",
  },
};

describe("restored event provenance", () => {
  it("labels restored history and explains its original identity without changing the CloudEvent", () => {
    const restored = { ...event, restored: true };
    expect(renderToStaticMarkup(<RestoredBadge item={restored} />)).toContain(
      "已從封存匯回",
    );
    const markup = renderToStaticMarkup(<RestoredNotice item={restored} />);
    expect(markup).toContain("已從封存匯回");
    expect(markup).toContain("原始事件內容、序號與接收時間保持不變");
    expect(event.event).not.toHaveProperty("restored");
  });
  it("does not label ordinary events or trust producer-supplied restored extensions", () => {
    for (const item of [
      event,
      { ...event, restored: false },
      { ...event, event: { ...event.event, restored: true } },
    ]) {
      expect(renderToStaticMarkup(<RestoredBadge item={item} />)).toBe("");
      expect(renderToStaticMarkup(<RestoredNotice item={item} />)).toBe("");
    }
  });
});

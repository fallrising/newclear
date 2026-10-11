import assert from "node:assert/strict";
import test from "node:test";
import { Virtualizer } from "@tanstack/virtual-core";
import { timelineAnchoring } from "../src/features/timeline/anchor.ts";

function messages(from, to) {
  return Array.from({ length: to - from + 1 }, (_, i) => ({ key: `s:${from + i}`, size: 58 }));
}

/** Model the React adapter's render/commit and separately delivered scroll echo. */
function timeline(initialItems, offset = 150) {
  let items = initialItems;
  let observeOffset;
  const window = {
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  const element = { scrollTop: offset, scrollHeight: 100_000, clientHeight: 700, window };
  const options = () => {
    const currentItems = items;
    return {
      ...timelineAnchoring,
      count: currentItems.length,
      getItemKey: (index) => currentItems[index].key,
      getScrollElement: () => element,
      estimateSize: () => 64,
      initialRect: { width: 944, height: element.clientHeight },
      initialOffset: offset,
      observeElementRect: (_instance, callback) => {
        callback({ width: 944, height: element.clientHeight });
        return () => {};
      },
      observeElementOffset: (_instance, callback) => {
        observeOffset = callback;
        callback(element.scrollTop, false);
        return () => {};
      },
      scrollToFn: (target, { adjustments }) => {
        element.scrollTop = Math.max(0, Math.min(
          target + (adjustments ?? 0),
          Math.max(0, element.scrollHeight - element.clientHeight),
        ));
        // Browser scroll events arrive later; do not synchronously echo writes.
      },
    };
  };
  const virtualizer = new Virtualizer(options());
  const commit = () => {
    element.scrollHeight = virtualizer.getTotalSize();
    virtualizer._willUpdate();
  };
  const measure = (key, size = items.find((item) => item.key === key).size) => {
    virtualizer.getTotalSize();
    virtualizer.resizeItem(items.findIndex((item) => item.key === key), size);
  };
  commit();
  for (const item of items) measure(item.key);
  commit();
  element.scrollTop = offset;
  observeOffset(offset, false);
  return {
    virtualizer,
    element,
    commit,
    measure,
    render(next) {
      items = next;
      virtualizer.setOptions(options());
      // React commits the rendered sizer before its item-ref measurements.
      element.scrollHeight = virtualizer.getTotalSize();
    },
    echo() { observeOffset(element.scrollTop, false); },
    screenTop(key) {
      virtualizer.getTotalSize();
      return virtualizer.measurementsCache.find((item) => item.key === key).start - element.scrollTop;
    },
  };
}

const top = { key: "top", size: 50 };
const august2 = { key: "d:2026-08-02", size: 32 };

test("first older page keeps its message through 64-to-58 measurements before a scroll echo", () => {
  const view = timeline([top, august2, ...messages(1150, 1199)]);
  const before = view.screenTop("s:1152");
  view.render([{ key: "top", size: 0 }, august2, ...messages(1100, 1199)]);
  // These new rows are measured during commit, before the browser reports the write.
  for (let seq = 1142; seq < 1150; seq++) view.measure(`s:${seq}`);
  view.commit();
  assert.equal(view.screenTop("s:1152"), before);
  // More estimated rows settle later, still without a scroll-event echo.
  for (let seq = 1134; seq < 1142; seq++) view.measure(`s:${seq}`);
  view.commit();
  assert.equal(view.screenTop("s:1152"), before);
  view.echo();
  // The accepted page removes the 50 px loading header when it is remeasured.
  view.measure("top");
  view.commit();
  assert.equal(view.screenTop("s:1152"), before);
});

test("midnight inserts and relocates date dividers without moving the existing message", () => {
  const view = timeline([top, august2, ...messages(1000, 1049)]);
  const before = view.screenTop("s:1002");
  view.render([
    top, { key: "d:2026-08-01", size: 32 }, ...messages(950, 959),
    august2, ...messages(960, 1049),
  ]);
  view.measure("d:2026-08-01");
  for (let seq = 992; seq < 1000; seq++) view.measure(`s:${seq}`);
  view.commit();
  assert.equal(view.screenTop("s:1002"), before);
  view.echo();
  assert.equal(view.screenTop("s:1002"), before);
});

test("a live append preserves history until the existing explicit latest action", () => {
  const view = timeline([top, august2, ...messages(0, 49)]);
  const before = view.screenTop("s:2");
  view.render([top, august2, ...messages(0, 50)]);
  view.commit();
  view.measure("s:50");
  view.commit();
  assert.equal(view.screenTop("s:2"), before);
  assert.ok(view.element.scrollTop < view.element.scrollHeight - view.element.clientHeight);
  view.virtualizer.scrollToIndex(52, { align: "end" });
  assert.equal(view.element.scrollTop, view.element.scrollHeight - view.element.clientHeight);
});

test("delayed remeasurement above the idle reading anchor retains its position", () => {
  const view = timeline([top, august2, ...messages(1000, 1049)]);
  const before = view.screenTop("s:1002");
  view.render([top, august2, ...messages(950, 1049)]);
  view.commit();
  view.echo();
  // Existing content above the fold changes size after the prepend commits.
  view.measure("s:1000", 52);
  view.commit();
  assert.equal(view.screenTop("s:1002"), before);
});

test("empty timelines and bigint decorative keys can load and jump to their latest message", () => {
  const view = timeline([], 0);
  view.render([{ key: 10n, size: 0 }, august2, ...messages(0, 29)]);
  view.commit();
  view.measure(10n);
  view.measure("d:2026-08-02");
  view.commit();
  view.virtualizer.scrollToIndex(31, { align: "end" });
  assert.equal(view.element.scrollTop, view.element.scrollHeight - view.element.clientHeight);
  assert.equal(view.virtualizer.measurementsCache.at(-1).key, "s:29");
});

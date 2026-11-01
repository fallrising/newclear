import {act, screen, waitFor} from "@testing-library/react";
import * as echarts from "echarts";
import {beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {renderApp} from "./render";

describe("dashboard", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("shows active resources and the delivery signal", async () => {
    renderApp("/dashboard");
    expect(await screen.findByText("Delivery readiness", {}, {timeout: 5_000})).toBeVisible();
    expect(screen.getByText("Active topics")).toBeVisible();
    expect(screen.getAllByText("Consumer groups").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Subscriptions").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("Desired configuration published")).toBeVisible();
    expect(await screen.findByText("Kafka control plane")).toBeVisible();
    expect(screen.getByText("Lag watch")).toBeVisible();
  });

  it("resizes the actual chart container and releases the observer on unmount", async () => {
    const previousObserver = globalThis.ResizeObserver;
    const observed: Array<{target?: Element; callback: ResizeObserverCallback; disconnect: Mock<() => void>}> = [];
    class ObservableResizeObserver {
      record: (typeof observed)[number];
      constructor(callback: ResizeObserverCallback) {
        this.record = {callback, disconnect: vi.fn()};
        observed.push(this.record);
      }
      observe(target: Element) { this.record.target = target; }
      unobserve() {}
      disconnect() { this.record.disconnect(); }
    }
    vi.stubGlobal("ResizeObserver", ObservableResizeObserver);
    const charts: Array<{element: HTMLElement; resize: Mock<() => void>; dispose: Mock<() => void>}> = [];
    const init = vi.spyOn(echarts, "init").mockImplementation((element) => {
      if (!element) throw new Error("chart element is required");
      const chart = {element, resize: vi.fn(), dispose: vi.fn(), setOption: vi.fn()};
      charts.push(chart);
      return chart as unknown as ReturnType<typeof echarts.init>;
    });
    const view = renderApp("/dashboard");
    try {
      const element = await screen.findByRole("img", {name: "Active resource chart"});
      await waitFor(() => expect(charts.some(chart => chart.element === element)).toBe(true));
      const chart = charts.filter(item => item.element === element).at(-1)!;
      const observer = observed.filter(item => item.target === element).at(-1);
      expect(observer, "chart must observe its own container without a window resize").toBeDefined();
      act(() => observer!.callback([], {} as ResizeObserver));
      expect(chart.resize).toHaveBeenCalledTimes(1);
      view.unmount();
      expect(observer!.disconnect).toHaveBeenCalledTimes(1);
      expect(chart.dispose).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      init.mockRestore();
      vi.stubGlobal("ResizeObserver", previousObserver);
    }
  });

});

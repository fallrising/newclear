import {screen} from "@testing-library/react";
import {beforeEach, describe, expect, it} from "vitest";
import {renderApp} from "./render";

describe("dashboard", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("shows active resources and the delivery signal", async () => {
    renderApp("/dashboard");
    expect(await screen.findByText("Delivery readiness")).toBeVisible();
    expect(screen.getByText("Active topics")).toBeVisible();
    expect(screen.getAllByText("Consumer groups").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Subscriptions").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("Desired configuration published")).toBeVisible();
    expect(await screen.findByText("Kafka control plane")).toBeVisible();
    expect(screen.getByText("Lag watch")).toBeVisible();
  });
});

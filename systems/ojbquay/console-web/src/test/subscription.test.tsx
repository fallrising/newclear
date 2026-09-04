import {screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it} from "vitest";
import {SubscriptionWizard, subscriptionSpec} from "../pages/SubscriptionsPage";
import {renderWithData} from "./render";

describe("subscription wizard", () => {
  it("builds a validated pull specification", () => {
    expect(subscriptionSpec({
      groupId: 1,
      topicId: 1,
      mode: "PULL",
      concurrency: 32,
      maxTps: 500,
      maxBatch: 16,
      ackTimeoutMs: 30_000,
      maxRetry: 4,
      ordered: false,
      transit: "{}",
      shadowTraffic: false,
      dlqEnabled: true,
    })).toMatchObject({
      mode: "PULL",
      concurrency: 32,
      dlqEnabled: true,
      pull: {maxBatch: 16, ackTimeoutMs: 30_000, maxRetry: 4},
    });
  });

  it("previews a push subscription without creating it", async () => {
    const user = userEvent.setup();
    renderWithData(<SubscriptionWizard open close={() => undefined} />);
    await user.click(await screen.findByLabelText("Topic"));
    await user.click(await screen.findByText("orders.created"));
    await user.click(screen.getByLabelText("Consumer group"));
    await user.click(await screen.findByText("fulfilment"));
    await user.click(screen.getByRole("button", {name: "Continue"}));
    await user.type(screen.getByLabelText("HTTP endpoints"), "https://service.example/events");
    await user.click(screen.getByRole("button", {name: "Continue"}));
    await user.click(screen.getByRole("button", {name: "Continue"}));
    await user.click(screen.getByRole("button", {name: /Run preview$/}));
    await waitFor(() => expect(screen.getByText("DELIVER")).toBeVisible());
    expect(screen.getAllByText('{"event":"preview"}').length).toBe(2);
  });
});

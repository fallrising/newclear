import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

test(
  "E2E-W2-03 previews, order, search, unread counts and the new-messages divider",
  { tag: ["@W2"] },
  async ({ page, browser, recorder, api }, info) => {
    const rand = Date.now().toString(36);
    await loginViaUi(page, ACCOUNTS.ada);
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await ben.page.goto("/r/lobby");
      await expectLive(ben.page);

      for (const n of [1, 2, 3]) {
        const sent = await api.call("POST", "/api/rooms/room-quiet/messages", {
          body: "q" + n,
          client_message_id: "e2e-w2u-" + rand + "-" + n,
        });
        expect(sent.status).toBe(200);
      }

      await ben.page.locator('[data-testid="room-list-item"][data-slug="long-history"]').click();
      const quiet = ben.page.locator('[data-testid="room-list-item"][data-slug="quiet"]');
      await expect(quiet.getByTestId("room-list-unread")).toHaveText("3");
      await expect(quiet).toHaveAttribute("data-unread", "3");
      await expect(quiet.getByTestId("room-list-preview")).toContainText("Ada Lin:");
      await expect(quiet.getByTestId("room-list-preview")).toContainText("q3");
      await expect(ben.page.getByTestId("room-list-item").first()).toHaveAttribute("data-slug", "quiet");
      await shot(ben.page, info, "01-unread");

      await ben.page.getByTestId("room-search").fill("安靜");
      await expect(ben.page.getByTestId("room-list-item")).toHaveCount(1);
      await expect(ben.page.getByTestId("room-list-item")).toHaveAttribute("data-slug", "quiet");
      await ben.page.getByTestId("room-search").fill("zzz-" + rand);
      await expect(ben.page.getByTestId("room-list-no-match")).toBeVisible();
      await ben.page.getByTestId("room-search").fill("");

      await quiet.click();
      await expectLive(ben.page);
      const divider = ben.page.getByTestId("timeline-new-divider");
      await expect(divider).toBeVisible();
      const afterDivider = await ben.page.evaluate(() => {
        const timeline = document.querySelector('[data-testid="timeline"]');
        if (!timeline) return "";
        const nodes = [...timeline.querySelectorAll('[data-testid="timeline-new-divider"], [data-testid="message-row"]')];
        const index = nodes.findIndex((node) => node.getAttribute("data-testid") === "timeline-new-divider");
        const next = nodes.slice(index + 1).find((node) => node.getAttribute("data-testid") === "message-row");
        return next?.textContent ?? "";
      });
      expect(afterDivider).toContain("q1");
      const divBox = await divider.boundingBox();
      const tlBox = await ben.page.getByTestId("timeline").boundingBox();
      expect(divBox).not.toBeNull();
      expect(tlBox).not.toBeNull();
      expect(divBox!.y).toBeGreaterThanOrEqual(tlBox!.y - 1);
      expect(divBox!.y + divBox!.height).toBeLessThanOrEqual(tlBox!.y + tlBox!.height + 1);
      await shot(ben.page, info, "02-divider");

      await ben.page.getByTestId("timeline").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await ben.page.locator('[data-testid="room-list-item"][data-slug="lobby"]').click();
      await expect(quiet.getByTestId("room-list-unread")).toHaveCount(0);
      note(info, "unread cleared after reading; divider marked the first unread message");

      await quiet.click();
      await expectLive(ben.page);
      await expect(ben.page.getByTestId("timeline-new-divider")).toHaveCount(0);
    } finally {
      await ben.context.close();
    }
  },
);

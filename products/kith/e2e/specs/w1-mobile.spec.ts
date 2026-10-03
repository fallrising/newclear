import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, sendViaComposer, uniqueText } from "../fixtures/actors.ts";
import { shot } from "../harness/evidence.ts";

async function expectLive(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

test(
  "E2E-W1-06 mobile list, room and back; reload keeps the room",
  { tag: ["@W1", "@mobile"] },
  async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "mobile only");

    await loginViaUi(page, ACCOUNTS.ben);
    await page.goto("/");
    await expect(page.getByTestId("room-list")).toBeVisible();
    await expect(page.getByTestId("timeline")).not.toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await shot(page, info, "list");

    await page.locator('[data-testid="room-list-item"][data-slug="lobby"]').click();
    await page.waitForURL((u) => u.pathname === "/r/lobby");
    await expect(page.getByTestId("timeline")).toBeVisible();
    await expectLive(page);
    await expect(page.getByTestId("room-list")).not.toBeVisible();
    await expect(page.getByTestId("room-back")).toBeVisible();
    await expect(page.getByTestId("composer-send")).toBeVisible();
    await shot(page, info, "room");

    const text = uniqueText("mobile");
    await sendViaComposer(page, text);
    await expect(page.getByTestId("message-row").filter({ hasText: text })).toHaveCount(1);
    await expect(page.getByTestId("pending-row").filter({ hasText: text })).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("timeline")).toBeVisible();
    await expectLive(page);
    expect(new URL(page.url()).pathname).toBe("/r/lobby");
    await expect(page.getByTestId("room-title")).toHaveText("Lobby");
    await shot(page, info, "reloaded");

    await page.getByTestId("room-back").click();
    await page.waitForURL((u) => u.pathname === "/");
    await expect(page.getByTestId("room-list")).toBeVisible();
  },
);

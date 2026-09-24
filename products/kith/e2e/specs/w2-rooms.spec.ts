import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

test(
  "E2E-W2-02 renames propagate and people edit their display name",
  { tag: ["@W2"] },
  async ({ page, browser, recorder, api }, info) => {
    const rand = Date.now().toString(36);
    const slug = "w2-rename-" + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const created = await api.call("POST", "/api/rooms", { slug, name: "Old " + rand });
    expect(created.status).toBe(200);
    const roomId = (created.json as { id: string }).id;
    const invited = await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" });
    expect(invited.status).toBe(200);

    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await ben.page.goto("/");
      const benItem = ben.page.locator(`[data-testid="room-list-item"][data-slug="${slug}"]`);
      await expect(benItem).toBeVisible();
      await expect(benItem.getByTestId("room-list-name")).toHaveText("Old " + rand);

      await page.goto("/console/rooms");
      const adminRow = page.locator(`[data-testid="console-room-row"][data-slug="${slug}"]`);
      await adminRow.getByTestId("console-room-rename").click();
      await page.getByTestId("rename-input").fill("New " + rand);
      await page.getByTestId("rename-submit").click();
      await expect(adminRow).toContainText("New " + rand);
      await expect(page.locator(`[data-testid="room-list-item"][data-slug="${slug}"]`).getByTestId("room-list-name")).toHaveText("New " + rand);
      await shot(page, info, "01-renamed-admin");

      await ben.page.locator('[data-testid="room-list-item"][data-slug="lobby"]').click();
      await expect(benItem.getByTestId("room-list-name")).toHaveText("New " + rand);
      note(info, "rename reached the other member on refetch");
      await shot(ben.page, info, "02-renamed-ben");

      await ben.page.goto("/settings");
      await ben.page.getByTestId("settings-display-name").fill("Ben " + rand);
      await ben.page.getByTestId("settings-display-name-save").click();
      await expect(ben.page.getByTestId("settings-display-name-saved")).toBeVisible();
      await expect(ben.page.getByTestId("app-shell-user")).toHaveText("Ben " + rand);
      await shot(ben.page, info, "03-ben-renamed");

      await page.goto("/r/" + slug);
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);
      await sendViaComposer(ben.page, "hello");
      await expect(page.getByTestId("message-row").filter({ hasText: "hello" }).getByTestId("message-sender")).toHaveText("Ben " + rand);

      await ben.page.goto("/settings");
      await ben.page.getByTestId("settings-display-name").fill("Ben Okafor");
      await ben.page.getByTestId("settings-display-name-save").click();
      await expect(ben.page.getByTestId("settings-display-name-saved")).toBeVisible();
    } finally {
      await ben.context.close();
    }
  },
);

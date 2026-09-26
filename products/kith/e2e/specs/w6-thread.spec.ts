// E2E-W6-03 (docs/v2/milestones/W6.md §7.3). Desktop is zh-TW; the mobile project is en.
import type { Page, TestInfo } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test, expect, type ApiClient } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { shot } from "../harness/evidence.ts";

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

function repliesLabel(info: TestInfo): string {
  return info.project.name === "mobile" ? "1 replies" : "1 則回覆";
}

async function messageByBody(api: ApiClient, roomId: string, body: string): Promise<{ id: string; body: string; thread_reply_count?: number }> {
  const res = await api.call("GET", "/api/rooms/" + roomId + "/messages?order=desc&limit=50");
  expect(res.status).toBe(200);
  const rows = (res.json as { messages: { id: string; body: string }[] }).messages;
  const found = rows.find((row) => row.body === body);
  if (!found) throw new Error("missing message " + body);
  return found;
}

test(
  "E2E-W6-03 threads keep the main timeline to roots and reply counts",
  { tag: ["@W6", "@mobile"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(120_000);
    const rand = randomBytes(3).toString("hex");
    const rootText = "root " + rand;
    const replyText = "reply " + rand;
    const label = repliesLabel(info);
    await loginViaUi(page, ACCOUNTS.ada);
    const slug = "w6-thread-" + rand;
    const room = await api.call("POST", "/api/rooms", { slug, name: "Thread " + rand });
    expect(room.status).toBe(200);
    const roomId = (room.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);

    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await page.goto("/r/" + slug);
      await expectLive(page);
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);

      await sendViaComposer(page, rootText);
      const rootRow = ben.page.getByTestId("message-row").filter({ hasText: rootText });
      await expect(rootRow).toBeVisible();
      const root = await messageByBody(api, roomId, rootText);

      const timeline = ben.page.getByTestId("timeline");
      await expect(async () => {
        await rootRow.hover({ timeout: 1_000 });
        await expect(rootRow.getByTestId("message-actions")).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await rootRow.getByTestId("message-actions").click();
      await ben.page.getByTestId("message-action-thread").click();
      await expect(ben.page.getByTestId("thread-panel")).toBeVisible();
      await expect(ben.page).toHaveURL(new RegExp("/t/"));
      await shot(ben.page, info, "01-panel");

      const input = ben.page.getByTestId("thread-composer-input");
      await input.fill(replyText);
      await input.press("Enter");
      await expect(ben.page.getByTestId("thread-replies")).toContainText(replyText);
      await expect(timeline.getByTestId("message-body").filter({ hasText: replyText })).toHaveCount(0);
      await expect(rootRow.getByTestId("thread-summary")).toContainText(label);
      await shot(ben.page, info, "02-replied");

      await expect(page.getByTestId("message-row").filter({ hasText: rootText }).getByTestId("thread-summary")).toContainText(label);
      await expect(page.getByTestId("timeline").getByTestId("message-body").filter({ hasText: replyText })).toHaveCount(0);

      await ben.page.reload();
      await expect(ben.page.getByTestId("thread-panel")).toBeVisible();
      await expect(ben.page.getByTestId("thread-root")).toContainText(rootText);
      await expect(ben.page.getByTestId("thread-replies")).toContainText(replyText);
      await shot(ben.page, info, "03-deep-link");

      await ben.page.getByTestId("thread-close").click();
      await expect(ben.page.getByTestId("thread-panel")).toHaveCount(0);
      await expect(ben.page).toHaveURL(new RegExp("/r/" + slug + "$"));

      const top = await api.call("GET", "/api/rooms/" + roomId + "/messages?top_level=1&order=desc&limit=5");
      expect(top.status).toBe(200);
      const topRows = (top.json as { messages: { body: string; thread_reply_count?: number }[] }).messages;
      const listed = topRows.find((row) => row.body === rootText);
      expect(listed?.thread_reply_count).toBe(1);
      expect(topRows.some((row) => row.body === replyText)).toBe(false);
      const thread = await api.call("GET", "/api/rooms/" + roomId + "/messages?thread_id=" + root.id + "&order=asc&limit=50");
      expect(thread.status).toBe(200);
      expect((thread.json as { messages: unknown[] }).messages).toHaveLength(2);
      const exclusive = await api.call("GET", "/api/rooms/" + roomId + "/messages?thread_id=x&top_level=1");
      expect(exclusive.status).toBe(400);

      await ben.page.goto("/r/" + slug + "/t/does-not-exist");
      await expect(ben.page.getByTestId("thread-not-found")).toBeVisible();
    } finally {
      await ben.context.close();
    }
  },
);

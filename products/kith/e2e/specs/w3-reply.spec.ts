import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { createWsChaos } from "../harness/ws-chaos.ts";
import { note, shot } from "../harness/evidence.ts";

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

function lastBody(json: unknown): string {
  const messages = (json as { messages: { body: string }[] }).messages;
  return messages[messages.length - 1]?.body ?? "";
}

test(
  "E2E-W3-03 hosted replies show a placeholder, failures and typing",
  { tag: ["@W3"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(240_000);
    const rand = Date.now().toString(36);
    await loginViaUi(page, ACCOUNTS.ada);
    const slug = "w3-reply-" + rand;
    const created = await api.call("POST", "/api/rooms", { slug, name: "Reply " + rand });
    expect(created.status).toBe(200);
    const roomId = (created.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "grok" })).status).toBe(200);
    expect(
      (await api.call("PATCH", "/api/rooms/" + roomId + "/members/m-grok/attention", { cooldown_ms: 0 })).status,
    ).toBe(200);
    await page.goto("/r/" + slug);
    await expectLive(page);

    const chaos = createWsChaos();
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben", chaos });
    try {
      await ben.page.clock.install();
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);

      await sendViaComposer(ben.page, "@grok [[fake:delay_ms=2000;text=done%20" + rand + "]]");
      const placeholder = ben.page.locator('[data-testid="reply-placeholder"][data-member="m-grok"]');
      await expect(placeholder).toBeVisible({ timeout: 20_000 });
      await expect(placeholder).toHaveAttribute("aria-label", /Grok/);
      await shot(ben.page, info, "01-placeholder");

      const done = "done " + rand;
      await expect(ben.page.getByTestId("message-row").filter({ hasText: done })).toBeVisible({ timeout: 20_000 });
      await expect(ben.page.getByTestId("reply-placeholder")).toHaveCount(0);
      await expect(page.getByTestId("message-row").filter({ hasText: done })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("reply-placeholder")).toHaveCount(0);
      note(info, "placeholder replaced by the persisted reply");
      await shot(page, info, "02-replied");

      const trigger = "@grok [[fake:status=503]]";
      await sendViaComposer(ben.page, trigger);
      await expect(ben.page.locator('[data-testid="reply-failed"][data-member="m-grok"]')).toBeVisible({ timeout: 20_000 });
      await expect(ben.page.locator('[data-testid="reply-failed"][data-member="m-grok"]')).toHaveText("Grok 回覆失敗");
      await expect(page.locator('[data-testid="reply-failed"][data-member="m-grok"]')).toHaveText("Grok 回覆失敗：上游忙碌");
      await expect(ben.page.getByTestId("reply-placeholder")).toHaveCount(0);
      await expect(page.getByTestId("reply-placeholder")).toHaveCount(0);
      const history = await api.call("GET", "/api/rooms/" + roomId + "/messages?order=desc&limit=1");
      expect(history.status).toBe(200);
      expect(lastBody(history.json)).toBe(trigger);
      await shot(page, info, "03-failed-ada");
      await shot(ben.page, info, "04-failed-ben");

      await expect(ben.page.getByTestId("reply-failed")).toHaveCount(0, { timeout: 10_000 });

      await page.getByTestId("composer-input").fill("thinking");
      await expect(ben.page.getByTestId("typing-indicator")).toBeVisible();
      await expect(ben.page.getByTestId("typing-indicator")).toHaveText("Ada Lin 正在輸入…");
      await shot(ben.page, info, "05-typing");

      await page.getByTestId("composer-input").fill("");
      await expect(ben.page.getByTestId("typing-indicator")).toHaveCount(0, { timeout: 6_000 });

      await sendViaComposer(ben.page, "@grok [[fake:delay_ms=30000;text=late]]");
      await expect(ben.page.locator('[data-testid="reply-placeholder"][data-member="m-grok"]')).toBeVisible({ timeout: 20_000 });
      await ben.page.clock.fastForward(301_000);
      await expect(ben.page.getByTestId("reply-placeholder")).toHaveCount(0);
      await expect(ben.page.getByTestId("reply-failed")).toHaveCount(0);
      note(info, "stale replying state expired after 300 s of client time");

      await expect(ben.page.getByTestId("message-row").filter({ hasText: "late" })).toBeVisible({ timeout: 40_000 });

      await sendViaComposer(ben.page, "@grok [[fake:delay_ms=5000;text=after-drop]]");
      await expect(ben.page.getByTestId("reply-placeholder")).toBeVisible({ timeout: 20_000 });
      chaos.closeFromServer(4004);
      await expect(ben.page.getByTestId("reply-placeholder")).toHaveCount(0);
      await expectLive(ben.page);
      await expect(ben.page.getByTestId("reply-placeholder")).toHaveCount(0);
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "after-drop" })).toBeVisible({ timeout: 30_000 });
      note(info, "disconnect clears statuses; the reply still arrives");
    } finally {
      await ben.context.close();
    }
  },
);

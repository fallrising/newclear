import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { createHostedAgentViaApi, createProviderViaApi, fakeProviderLog, inviteAgentViaApi } from "../fixtures/console.ts";
import { shot } from "../harness/evidence.ts";

const OTHER = "回覆失敗：回覆失敗";

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

test(
  "E2E-W5-03 a stream cut mid-way shows a failure and persists nothing",
  { tag: ["@W5"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(120_000);
    const rand = randomBytes(3).toString("hex");
    const handle = "w5c_" + rand;
    const display = "Cut " + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const pid = await createProviderViaApi(api, { name: "w5c-" + rand, format: "openai_chat" });
    const aid = await createHostedAgentViaApi(api, {
      handle,
      display_name: display,
      providerId: pid,
      model: "fake-chat",
      stream: true,
    });
    const slug = "w5-cut-" + rand;
    const created = await api.call("POST", "/api/rooms", { slug, name: "Cut " + rand });
    expect(created.status).toBe(200);
    const roomId = (created.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    await inviteAgentViaApi(api, roomId, handle, aid);
    await page.goto("/r/" + slug);
    await expectLive(page);
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);

      const before = (await fakeProviderLog()).length;
      const trigger = "@" + handle + " [[fake:text=abcdefghijkl;chunks=6;chunk_ms=300;cut_after=3]]";
      await sendViaComposer(ben.page, trigger);
      const draft = ben.page.getByTestId("reply-draft");
      await expect(draft).toBeVisible({ timeout: 30_000 });
      const partial = ((await draft.textContent()) ?? "").trim();
      expect("abcdefghijkl".startsWith(partial)).toBe(true);
      expect(partial.length).toBeGreaterThan(0);
      await shot(ben.page, info, "01-partial");

      await expect(ben.page.getByTestId("reply-failed")).toBeVisible({ timeout: 30_000 });
      await expect(ben.page.getByTestId("reply-draft")).toHaveCount(0);
      await expect(ben.page.getByTestId("reply-placeholder")).toHaveCount(0);
      await expect(ben.page.getByTestId("reply-failed")).toHaveText(display + " 回覆失敗");
      await shot(ben.page, info, "02-failed-ben");
      await expect(page.getByTestId("reply-failed")).toBeVisible();
      await expect(page.getByTestId("reply-failed")).toContainText(OTHER);
      await shot(page, info, "03-failed-ada");

      const history = await api.call("GET", "/api/rooms/" + roomId + "/messages?order=desc&limit=1");
      const last = (history.json as { messages: { body: string }[] }).messages.at(-1);
      expect(last?.body).toBe(trigger);

      const cut = (await fakeProviderLog()).slice(before);
      expect(cut).toHaveLength(1);

      const beforeOverload = (await fakeProviderLog()).length;
      await sendViaComposer(ben.page, "@" + handle + " [[fake:status=529]]");
      await expect(page.getByTestId("reply-failed")).toContainText("上游忙碌", { timeout: 30_000 });
      const overloaded = (await fakeProviderLog()).slice(beforeOverload).filter((entry) => entry.status === 529);
      expect(overloaded).toHaveLength(2);
    } finally {
      await ben.context.close();
    }
  },
);

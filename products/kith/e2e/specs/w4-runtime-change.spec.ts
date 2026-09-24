import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { createHostedAgentViaApi, createProviderViaApi, fakeProviderLog, inviteAgentViaApi } from "../fixtures/console.ts";
import { shot } from "../harness/evidence.ts";

const EFFECT_INFLIGHT = "正在進行的回覆會被丟棄，不會以新設定送出。";
const EFFECT_NO_DISPATCH = "Kith 不會替它呼叫模型；它要自己連進來。";
const EXTERNAL_LIMIT = "外部程式，Kith 不保證它遵守喚醒規則";

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
  "E2E-W4-08 changing runtime mid-reply drops the reply and keeps identity",
  { tag: ["@W4"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(180_000);
    const rand = randomBytes(3).toString("hex");
    const handle = "w4r_" + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const pid = await createProviderViaApi(api, { name: "w4r-openai-" + rand, format: "openai_chat" });
    const aid = await createHostedAgentViaApi(api, {
      handle,
      display_name: "Runtime " + rand,
      providerId: pid,
      model: "fake-chat",
    });
    const issued = async () => {
      const res = await api.call("POST", "/api/agents/" + aid + "/tokens");
      expect(res.status).toBe(200);
      return (res.json as { token: string }).token;
    };
    const t1 = await issued();
    const t2 = await issued();
    const slug = "w4-runtime-" + rand;
    const created = await api.call("POST", "/api/rooms", { slug, name: "Runtime " + rand });
    expect(created.status).toBe(200);
    const roomId = (created.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    await inviteAgentViaApi(api, roomId, handle, aid);
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);

      await sendViaComposer(ben.page, "@" + handle + " before");
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "hello from fake-chat" })).toBeVisible({ timeout: 30_000 });

      const trigger = "@" + handle + " [[fake:delay_ms=6000;text=too-late-" + rand + "]]";
      await sendViaComposer(ben.page, trigger);
      await expect(ben.page.locator(`[data-testid="reply-placeholder"][data-member="${aid}"]`)).toBeVisible({ timeout: 20_000 });
      await shot(ben.page, info, "01-replying");

      await page.goto("/console/agents/" + aid + "?tab=runtime");
      await page.getByTestId("runtime-kind-external").click();
      await expect(page.getByTestId("runtime-quota-api_key")).not.toBeChecked();
      await expect(page.getByTestId("runtime-quota-operator_personal")).not.toBeChecked();
      await expect(page.getByTestId("runtime-submit")).toBeDisabled();

      await page.getByTestId("runtime-quota-api_key").click();
      await page.getByTestId("runtime-submit").click();
      await expect(page.getByTestId("runtime-change-effects")).toBeVisible();
      await expect(page.getByTestId("runtime-change-effects")).toContainText(EFFECT_INFLIGHT);
      await expect(page.getByTestId("runtime-change-effects")).toContainText(EFFECT_NO_DISPATCH);
      await expect(page.getByTestId("runtime-revoke-tokens")).toBeVisible();
      await expect(page.getByTestId("runtime-revoke-tokens")).not.toBeChecked();
      await shot(page, info, "02-dialog");

      await page.getByTestId("runtime-revoke-tokens").check();
      await page.getByTestId("runtime-change-confirm").click();
      await expect(page.getByTestId("runtime-saved")).toBeVisible();
      await expect(page.getByTestId("runtime-saved")).toContainText("2");

      await expect(ben.page.locator(`[data-testid="reply-placeholder"][data-member="${aid}"]`)).toHaveCount(0, { timeout: 10_000 });
      await ben.page.waitForTimeout(3_000);
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "too-late-" + rand })).toHaveCount(0);
      await expect(page.getByTestId("message-row").filter({ hasText: "too-late-" + rand })).toHaveCount(0);
      const history = await api.call("GET", "/api/rooms/" + roomId + "/messages?order=desc&limit=1");
      expect(history.status).toBe(200);
      expect(lastBody(history.json)).toBe(trigger);
      await shot(ben.page, info, "03-dropped");

      for (const token of [t1, t2]) {
        const me = await api.call("GET", "/api/me", undefined, { Authorization: "Bearer " + token });
        expect(me.status).toBe(401);
        expect((me.json as { error: { code: string } }).error.code).toBe("token_revoked");
      }

      const agent = await api.call("GET", "/api/agents/" + aid);
      expect(agent.status).toBe(200);
      const detail = agent.json as {
        id: string;
        handle: string;
        runtime: string;
        runtime_epoch: number;
        rooms: string[];
        runtime_changes: { from_runtime: string; to_runtime: string; created_at: string }[];
      };
      expect(detail.id).toBe(aid);
      expect(detail.handle).toBe(handle);
      expect(detail.runtime).toBe("external");
      expect(detail.runtime_epoch).toBe(2);
      expect(detail.rooms.some((room) => room === roomId || room === slug)).toBe(true);
      expect(detail.runtime_changes).toHaveLength(2);
      const latest = [...detail.runtime_changes].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      expect(latest?.from_runtime).toBe("hosted");
      expect(latest?.to_runtime).toBe("external");

      await expect(ben.page.getByTestId("message-row").filter({ hasText: "hello from fake-chat" })).toBeVisible();

      const before = (await fakeProviderLog()).length;
      await sendViaComposer(ben.page, "@" + handle + " still there?");
      await ben.page.waitForTimeout(3_000);
      await expect(ben.page.getByTestId("reply-placeholder")).toHaveCount(0);
      expect((await fakeProviderLog()).length).toBe(before);
      await expect(ben.page.locator(`[data-testid="members-row"][data-handle="${handle}"]`).getByTestId("members-limit")).toHaveText(EXTERNAL_LIMIT);
      await shot(ben.page, info, "04-external");
    } finally {
      await ben.context.close();
    }
  },
);

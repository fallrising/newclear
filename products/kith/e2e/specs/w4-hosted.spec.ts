import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { createHostedAgentViaApi, createProviderViaApi, fakeProviderLog, inviteAgentViaApi } from "../fixtures/console.ts";
import { shot } from "../harness/evidence.ts";

const DONE_HOSTED = "已建立。把它邀請進房間後，@ 它就會回覆。";
const UNCONFIGURED = "尚未設定，不會回覆";

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

function lastBody(json: unknown): string {
  const messages = (json as { messages: { body: string }[] }).messages;
  return messages[messages.length - 1]?.body ?? "";
}

async function agentId(api: { call: (method: "GET", path: string) => Promise<{ json: unknown }> }, handle: string): Promise<string> {
  const listed = await api.call("GET", "/api/agents");
  const body = listed.json as { agents?: { id: string; handle: string }[] } | { id: string; handle: string }[];
  const agents = Array.isArray(body) ? body : (body.agents ?? []);
  const found = agents.find((agent) => agent.handle === handle);
  if (!found) throw new Error("agent not listed: " + handle);
  return found.id;
}

test(
  "E2E-W4-02 operator creates a hosted agent in the console and it replies",
  { tag: ["@W4"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(180_000);
    const rand = randomBytes(3).toString("hex");
    const handle = "w4h_" + rand;
    const providerName = "w4h-openai-" + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const pid = await createProviderViaApi(api, { name: providerName, format: "openai_chat" });
    const slug = "w4-hosted-" + rand;
    const created = await api.call("POST", "/api/rooms", { slug, name: "Hosted " + rand });
    expect(created.status).toBe(200);
    const roomId = (created.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);

      await page.goto("/console/agents");
      await page.getByTestId("agents-add").click();
      await expect(page.getByTestId("wizard-steps").locator("li").first()).toHaveAttribute("aria-current", "step");

      await page.getByTestId("agent-create-handle").fill(handle);
      await page.getByTestId("agent-create-display-name").fill("GPT " + rand);
      await page.getByTestId("wizard-next").click();
      await expect(page.getByTestId("runtime-kind-hosted")).toBeChecked();

      await page.getByTestId("runtime-connection").selectOption(pid);
      await expect(page.getByTestId("runtime-model")).toBeVisible();
      const models = await page.getByTestId("runtime-model").locator("option").evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value).filter((value) => value !== ""),
      );
      expect(models).toEqual(["fake-chat", "fake-chat-mini"]);
      await expect(page.getByTestId("runtime-quota-api_key")).toBeChecked();
      await shot(page, info, "01-runtime-step");

      await page.getByTestId("runtime-model").selectOption("fake-chat");
      await page.getByTestId("runtime-submit").click();
      await expect(page.getByTestId("wizard-done-step")).toBeVisible();
      await expect(page.getByTestId("wizard-done-step")).toHaveText(DONE_HOSTED);
      await expect(page.getByTestId("wizard-token")).toHaveCount(0);
      await shot(page, info, "02-done");

      await page.getByTestId("wizard-open-agent").click();
      await page.getByTestId("agent-tab-rooms").click();
      await page.getByTestId("agent-room-add-select").selectOption(roomId);
      await page.getByTestId("agent-room-add").click();
      await expect(page.getByTestId("agent-room-row")).toHaveCount(1);

      await page.goto("/console/agents");
      const row = page.locator(`[data-testid="agent-row"][data-handle="${handle}"]`);
      await expect(row).toHaveAttribute("data-runtime", "hosted");
      await expect(row).toHaveAttribute("data-status", "ok");
      await expect(row.getByTestId("agent-runtime")).toHaveText("Hosted · " + providerName + " · fake-chat");
      await shot(page, info, "03-agents-list");

      const aid = await agentId(api, handle);
      expect((await api.call("PATCH", "/api/rooms/" + roomId + "/members/" + aid + "/attention", { mode: "mention", cooldown_ms: 0 })).status).toBe(200);
      await sendViaComposer(ben.page, "@" + handle + " hi");
      await expect(ben.page.locator(`[data-testid="reply-placeholder"][data-member="${aid}"]`)).toBeVisible({ timeout: 20_000 });
      const reply = ben.page.getByTestId("message-row").filter({ hasText: "hello from fake-chat" });
      await expect(reply).toBeVisible({ timeout: 20_000 });
      await expect(reply.getByTestId("message-sender")).toHaveText("GPT " + rand);
      await shot(ben.page, info, "04-reply");

      await ben.page.locator(`[data-testid="members-row"][data-handle="${handle}"]`).getByTestId("members-open-agent").click();
      await expect(ben.page.getByTestId("agent-detail")).toBeVisible();
      await expect(ben.page.getByTestId("agent-detail-runtime")).toHaveText("Hosted · " + providerName + " · fake-chat");
      await expect(ben.page.getByTestId("agent-detail-console")).toHaveCount(0);
      await expect(ben.page.locator(`[data-testid="members-row"][data-handle="${handle}"] svg`)).toHaveCount(1);
      await shot(ben.page, info, "05-member-detail");
    } finally {
      await ben.context.close();
    }
  },
);

test(
  "E2E-W4-03 the same flow on anthropic_messages, with a retried overload",
  { tag: ["@W4"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(180_000);
    const rand = randomBytes(3).toString("hex");
    const handle = "w4a_" + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const pid = await createProviderViaApi(api, { name: "w4a-anthropic-" + rand, format: "anthropic_messages" });
    const aid = await createHostedAgentViaApi(api, {
      handle,
      display_name: "Claude " + rand,
      providerId: pid,
      model: "fake-claude",
    });
    const slug = "w4-anthropic-" + rand;
    const created = await api.call("POST", "/api/rooms", { slug, name: "Anthropic " + rand });
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

      await sendViaComposer(ben.page, "@" + handle + " hi");
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "hello from fake-claude" })).toBeVisible({ timeout: 30_000 });
      await shot(ben.page, info, "01-reply");

      const afterHi = await fakeProviderLog();
      const last = afterHi[afterHi.length - 1];
      expect(last?.path).toBe("/anthropic/v1/messages");
      expect(last?.model).toBe("fake-claude");
      expect(last?.auth_ok).toBe(true);

      const beforeOverload = afterHi.length;
      await sendViaComposer(ben.page, "@" + handle + " [[fake:status=529]]");
      await expect(page.getByTestId("reply-failed")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("reply-failed")).toContainText("上游忙碌");
      const overloaded = (await fakeProviderLog()).slice(beforeOverload).filter((entry) => entry.status === 529);
      expect(overloaded).toHaveLength(2);
      await shot(page, info, "02-overloaded");

      const beforeUnknown = (await fakeProviderLog()).length;
      const trigger = "@" + handle + " [[fake:status=500]]";
      await sendViaComposer(ben.page, trigger);
      await expect(page.getByTestId("reply-failed")).toBeVisible();
      const unknown = (await fakeProviderLog()).slice(beforeUnknown).filter((entry) => entry.status === 500);
      expect(unknown).toHaveLength(1);

      const history = await api.call("GET", "/api/rooms/" + roomId + "/messages?order=desc&limit=1");
      expect(history.status).toBe(200);
      expect(lastBody(history.json)).toBe(trigger);
    } finally {
      await ben.context.close();
    }
  },
);

test(
  "E2E-W4-06 a disabled provider stops wakes but keeps mentions",
  { tag: ["@W4"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(180_000);
    const rand = randomBytes(3).toString("hex");
    const handle = "w4d_" + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const pid = await createProviderViaApi(api, { name: "w4d-openai-" + rand, format: "openai_chat" });
    const aid = await createHostedAgentViaApi(api, {
      handle,
      display_name: "Disabled " + rand,
      providerId: pid,
      model: "fake-chat",
    });
    const slug = "w4-disabled-" + rand;
    const created = await api.call("POST", "/api/rooms", { slug, name: "Disabled " + rand });
    expect(created.status).toBe(200);
    const roomId = (created.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    await inviteAgentViaApi(api, roomId, handle, aid);
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);
      await expect(ben.page.getByTestId("members-panel")).toBeVisible();

      await sendViaComposer(ben.page, "@" + handle + " one");
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "hello from fake-chat" })).toBeVisible({ timeout: 30_000 });

      await page.goto("/console/providers/" + pid);
      await page.getByTestId("provider-toggle-disabled").click();
      await expect(page.getByTestId("provider-toggle-disabled")).toHaveText("啟用");

      const before = (await fakeProviderLog()).length;
      await sendViaComposer(ben.page, "@" + handle + " two");
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "two" })).toBeVisible();
      await page.goto("/r/" + slug);
      await expect(page.getByTestId("message-row").filter({ hasText: "two" })).toBeVisible();
      await expect(
        ben.page.waitForSelector(`[data-testid="reply-placeholder"][data-member="${aid}"]`, { timeout: 4_000 }),
      ).rejects.toThrow();
      expect((await fakeProviderLog()).length).toBe(before);
      const history = await api.call("GET", "/api/rooms/" + roomId + "/messages?order=desc&limit=1");
      expect(lastBody(history.json)).toBe("@" + handle + " two");

      await ben.page.locator(`[data-testid="members-row"][data-handle="${handle}"]`).getByTestId("members-open-agent").click();
      await ben.page.getByTestId("agent-detail-back").click();
      await expect(ben.page.locator(`[data-testid="members-row"][data-handle="${handle}"]`).getByTestId("members-limit")).toHaveText(UNCONFIGURED);
      await shot(ben.page, info, "01-unconfigured");

      await page.goto("/console/agents");
      await expect(page.locator(`[data-testid="agent-row"][data-handle="${handle}"]`)).toHaveAttribute("data-status", "unconfigured");

      await page.goto("/console/providers/" + pid);
      await page.getByTestId("provider-toggle-disabled").click();
      await sendViaComposer(ben.page, "@" + handle + " three");
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "hello from fake-chat" })).toHaveCount(2, { timeout: 30_000 });

      const removed = await api.call("DELETE", "/api/providers/" + pid);
      expect(removed.status).toBe(409);
      expect((removed.json as { error: { code: string } }).error.code).toBe("in_use");

      await page.getByTestId("provider-delete").click();
      await expect(page.getByTestId("provider-delete-in-use")).toContainText("1");
      await page.getByTestId("provider-delete-confirm").click();
      await expect(page).toHaveURL(/\/console\/providers$/);
      await expect(page.locator(`[data-testid="provider-row"][data-name="w4d-openai-${rand}"]`)).toHaveCount(0);
      const agent = await api.call("GET", "/api/agents/" + aid);
      expect(agent.status).toBe(200);
      const detail = agent.json as { runtime_status: string; connection_id: string | null };
      expect(detail.runtime_status).toBe("unconfigured");
      expect(detail.connection_id).toBeNull();
      await shot(page, info, "02-deleted");
    } finally {
      await ben.context.close();
    }
  },
);

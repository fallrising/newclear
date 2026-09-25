import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS, PROVIDER_CANARY } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { FAKE, createHostedAgentViaApi, fakeProviderLog, inviteAgentViaApi } from "../fixtures/console.ts";
import { shot } from "../harness/evidence.ts";

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

test(
  "E2E-W5-05 Responses and Gemini connections work streamed and not",
  { tag: ["@W5"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(240_000);
    const rand = randomBytes(3).toString("hex");
    await loginViaUi(page, ACCOUNTS.ada);
    const slug = "w5-fmt-" + rand;
    const created = await api.call("POST", "/api/rooms", { slug, name: "Formats " + rand });
    expect(created.status).toBe(200);
    const roomId = (created.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);

      await page.goto("/console/providers/new");
      await page.getByTestId("provider-preset").selectOption("openai");
      await page.getByTestId("provider-format").selectOption("openai_responses");
      await page.getByTestId("provider-name").fill("w5r-" + rand);
      await page.getByTestId("provider-base-url").fill(FAKE().openai);
      await page.getByTestId("provider-secret").fill(PROVIDER_CANARY);
      await page.getByTestId("provider-test").click();
      await expect(page.getByTestId("provider-test-result")).toHaveAttribute("data-ok", "true", { timeout: 30_000 });
      await expect(page.getByTestId("provider-test-models")).toContainText("fake-chat");
      await shot(page, info, "01-responses-test");
      await page.getByTestId("provider-quota-api_key").click();
      await page.getByTestId("provider-save").click();
      await expect(page.locator(`[data-testid="provider-row"][data-name="w5r-${rand}"]`)).toBeVisible();
      await expect(page.locator(`[data-testid="provider-row"][data-name="w5r-${rand}"]`)).toContainText("OpenAI Responses");

      await page.goto("/console/providers/new");
      await page.getByTestId("provider-preset").selectOption("google");
      await expect(page.getByTestId("provider-format")).toHaveCount(0);
      await expect(page.getByTestId("provider-base-url")).toHaveValue("https://generativelanguage.googleapis.com/v1beta");
      await page.getByTestId("provider-base-url").fill(FAKE().google);
      await page.getByTestId("provider-name").fill("w5g-" + rand);
      await page.getByTestId("provider-secret").fill(PROVIDER_CANARY);
      await page.getByTestId("provider-quota-api_key").click();
      await page.getByTestId("provider-test").click();
      await expect(page.getByTestId("provider-test-result")).toHaveAttribute("data-ok", "true", { timeout: 30_000 });
      const models = page.getByTestId("provider-test-models");
      await expect(models).toContainText("fake-gemini");
      await expect(models).toContainText("fake-gemini-flash");
      await shot(page, info, "02-gemini-test");
      await page.getByTestId("provider-save").click();

      const providers = await api.call("GET", "/api/providers");
      const list = (providers.json as { providers: { id: string; name: string }[] }).providers;
      const responsesId = list.find((row) => row.name === "w5r-" + rand)?.id;
      const geminiId = list.find((row) => row.name === "w5g-" + rand)?.id;
      expect(responsesId).toBeTruthy();
      expect(geminiId).toBeTruthy();

      const agents: { handle: string; providerId: string; stream: boolean }[] = [
        { handle: "w5rs_" + rand, providerId: responsesId ?? "", stream: true },
        { handle: "w5rn_" + rand, providerId: responsesId ?? "", stream: false },
        { handle: "w5gs_" + rand, providerId: geminiId ?? "", stream: true },
        { handle: "w5gn_" + rand, providerId: geminiId ?? "", stream: false },
      ];
      for (const agent of agents) {
        const model = agent.handle.startsWith("w5g") ? "fake-gemini" : "fake-chat";
        const aid = await createHostedAgentViaApi(api, {
          handle: agent.handle,
          display_name: agent.handle,
          providerId: agent.providerId,
          model,
          stream: agent.stream,
        });
        await inviteAgentViaApi(api, roomId, agent.handle, aid);
      }

      for (const agent of agents) {
        const text = "fmt " + agent.handle;
        let sawDraft = false;
        const watch = (async () => {
          const draft = ben.page.getByTestId("reply-draft");
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            if (await draft.count()) sawDraft = true;
            if (await ben.page.getByTestId("message-row").filter({ hasText: text }).count()) return;
            await ben.page.waitForTimeout(50);
          }
        })();
        await sendViaComposer(ben.page, "@" + agent.handle + " [[fake:text=" + encodeURIComponent(text) + ";chunks=5;chunk_ms=300]]");
        await watch;
        await expect(ben.page.getByTestId("message-row").filter({ hasText: text })).toBeVisible({ timeout: 30_000 });
        expect(sawDraft).toBe(agent.stream);
        await shot(ben.page, info, "03-" + agent.handle);
      }

      const log = await fakeProviderLog();
      const done = log.filter((entry) => entry.path !== "/__log" && entry.model !== null).slice(-4);
      expect(done.map((entry) => entry.format)).toEqual(["openai_responses", "openai_responses", "gemini", "gemini"]);
      expect(done.map((entry) => entry.stream)).toEqual([true, false, true, false]);
      expect(done.every((entry) => entry.auth_ok)).toBe(true);
    } finally {
      await ben.context.close();
    }
  },
);

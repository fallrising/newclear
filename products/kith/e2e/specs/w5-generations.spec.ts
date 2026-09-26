import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { createHostedAgentViaApi, createProviderViaApi, inviteAgentViaApi } from "../fixtures/console.ts";
import { shot } from "../harness/evidence.ts";

const PROTOCOL = "回應格式不對";

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

test(
  "E2E-W5-04 the operator sees generation failures; members don't",
  { tag: ["@W5"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(120_000);
    const rand = randomBytes(3).toString("hex");
    const handle = "w5g_" + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const pid = await createProviderViaApi(api, { name: "w5g-" + rand, format: "anthropic_messages" });
    const aid = await createHostedAgentViaApi(api, {
      handle,
      display_name: "Gen " + rand,
      providerId: pid,
      model: "fake-claude",
      stream: true,
    });
    const slug = "w5-gen-" + rand;
    const created = await api.call("POST", "/api/rooms", { slug, name: "Gen " + rand });
    expect(created.status).toBe(200);
    const roomId = (created.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    await inviteAgentViaApi(api, roomId, handle, aid);
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);
      for (const body of ["@" + handle + " ok", "@" + handle + " [[fake:status=529]]", "@" + handle + " [[fake:chunks=4;chunk_ms=200;cut_after=2]]"]) {
        await sendViaComposer(ben.page, body);
        await expect(ben.page.getByTestId("message-row").filter({ hasText: body })).toBeVisible();
        const placeholder = ben.page.locator(`[data-testid="reply-placeholder"][data-member="${aid}"]`);
        await expect(placeholder).toBeVisible({ timeout: 30_000 });
        await expect(placeholder).toHaveCount(0, { timeout: 30_000 });
      }

      await page.goto("/console/agents/" + aid + "?tab=generations");
      const rows = page.getByTestId("generation-row");
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toHaveAttribute("data-state", "failed");
      await expect(rows.nth(1)).toHaveAttribute("data-state", "failed");
      await expect(rows.nth(2)).toHaveAttribute("data-state", "completed");
      await expect(rows.nth(0)).toHaveAttribute("data-error-class", "protocol");
      await expect(rows.nth(1)).toHaveAttribute("data-error-class", "overloaded");
      await expect(rows.nth(2)).toHaveAttribute("data-error-class", "");
      await expect(rows.nth(0).getByTestId("generation-error")).toHaveText(PROTOCOL);
      await expect(rows.nth(2).getByTestId("generation-tokens")).toContainText("11");
      await expect(rows.nth(2).getByTestId("generation-tokens")).toContainText("3");
      await shot(page, info, "01-generations");

      const denied = await ben.page.request.get("/api/agents/" + aid + "/generations");
      expect(denied.status()).toBe(403);

      await ben.page.goto("/console/agents/" + aid + "?tab=generations");
      await expect(ben.page.getByTestId("console-forbidden")).toBeVisible();
      await expect(ben.page.getByTestId("generations-list")).toHaveCount(0);
      await shot(ben.page, info, "02-forbidden");

      const bad = await api.call("GET", "/api/agents/" + aid + "/generations?limit=0");
      expect(bad.status).toBe(400);
    } finally {
      await ben.context.close();
    }
  },
);

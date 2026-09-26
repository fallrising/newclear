// E2E-W6-02 (docs/v2/milestones/W6.md §7.2).
import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { readMcpEvents } from "../fixtures/console.ts";
import { shot } from "../harness/evidence.ts";
import { expectRunnerAlive, startRunner, waitForRunnerOnline } from "../harness/runner.ts";

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

function sseEvents(raw: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(5).replace(/^ /, ""));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) out.push(parsed as Record<string, unknown>);
    } catch {
      // Partial or non-JSON frame.
    }
  }
  return out;
}

test(
  "E2E-W6-02 a personal runner never starts for someone else",
  { tag: ["@W6"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(120_000);
    const rand = randomBytes(3).toString("hex");
    const handle = "w6p_" + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const created = await api.call("POST", "/api/agents", {
      handle,
      display_name: "Personal " + rand,
      quota_class: "operator_personal",
    });
    expect(created.status).toBeGreaterThanOrEqual(200);
    expect(created.status).toBeLessThan(300);
    const aid = (created.json as { id: string }).id;
    const runtime = await api.call("PUT", "/api/agents/" + aid + "/runtime", {
      runtime: "runner",
      quota_class: "operator_personal",
      adapter_kind: "command",
    });
    expect(runtime.status).toBeGreaterThanOrEqual(200);
    expect(runtime.status).toBeLessThan(300);
    const slug = "w6-personal-" + rand;
    const room = await api.call("POST", "/api/rooms", { slug, name: "Personal " + rand });
    expect(room.status).toBe(200);
    const roomId = (room.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle })).status).toBe(200);
    const issued = await api.call("POST", "/api/agents/" + aid + "/tokens");
    expect(issued.status).toBeGreaterThanOrEqual(200);
    expect(issued.status).toBeLessThan(300);
    const token = (issued.json as { token: string }).token;

    const runner = await startRunner({
      name: "w6p",
      token,
      quota: "operator_personal",
      operatorId: ACCOUNTS.ada.id,
      rooms: [roomId],
    });
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await expectRunnerAlive(runner);
      await page.goto("/r/" + slug);
      await expectLive(page);
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);
      await waitForRunnerOnline(api, aid);
      await sendViaComposer(ben.page, "warmup " + rand);
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "warmup " + rand })).toBeVisible();
      const beforePage = await api.call("GET", "/api/rooms/" + roomId + "/messages?order=desc&limit=1");
      const before = (beforePage.json as { messages: { seq: number }[] }).messages.at(-1)?.seq;
      expect(before).toBeGreaterThanOrEqual(0);
      const eventsPromise = readMcpEvents(token, roomId, before ?? 0, 30_000);

      await sendViaComposer(ben.page, `@${handle} please [[cli:text=nope]]`);
      await new Promise((r) => setTimeout(r, 4_000));
      expect(runner.invocations()).toHaveLength(0);
      await expect(ben.page.getByTestId("reply-placeholder")).toHaveCount(0);
      await expect(page.getByTestId("reply-placeholder")).toHaveCount(0);
      expect(readFileSync(runner.logFile, "utf8")).toContain('"event":"wake_skip"');
      await expect(
        ben.page.locator(`[data-testid="members-row"][data-handle="${handle}"]`).getByTestId("members-badge-operator-only"),
      ).toBeVisible();
      await shot(ben.page, info, "01-ben-no-run");

      await sendViaComposer(page, `@${handle} please [[cli:text=from-ada-${rand}]]`);
      await expect(page.getByTestId("message-body").filter({ hasText: "from-ada-" + rand })).toBeVisible({ timeout: 30_000 });
      expect(runner.invocations()).toHaveLength(1);
      await shot(page, info, "02-ada-runs");

      const events = sseEvents(await eventsPromise);
      const benEvent = events.find((event) => event.replay === false && typeof event.body === "string" && event.body.includes("[[cli:text=nope]]"));
      const adaEvent = events.find((event) => event.replay === false && typeof event.body === "string" && event.body.includes("[[cli:text=from-ada-"));
      expect(benEvent?.wake).toEqual({ mentioned: true, wake_allowed: false });
      expect((adaEvent?.wake as { wake_allowed?: boolean } | undefined)?.wake_allowed).toBe(true);
    } finally {
      await ben.context.close();
      await runner.stop();
    }
  },
);

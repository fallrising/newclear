// E2E-W6-01 (docs/v2/milestones/W6.md §7.1).
import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect, type ApiClient } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { shot } from "../harness/evidence.ts";
import { expectRunnerAlive, startRunner, waitForRunnerOnline, type RunnerHandle } from "../harness/runner.ts";

type RoomMessage = { id: string; seq: number; body: string; kind: string; thread_id: string | null };

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

async function messages(api: ApiClient, roomId: string, query: string): Promise<RoomMessage[]> {
  const res = await api.call("GET", "/api/rooms/" + roomId + "/messages?" + query);
  expect(res.status).toBe(200);
  return (res.json as { messages: RoomMessage[] }).messages;
}

async function waitForMessage(api: ApiClient, roomId: string, pred: (row: RoomMessage) => boolean): Promise<RoomMessage> {
  let found: RoomMessage | undefined;
  await expect.poll(async () => {
    const rows = await messages(api, roomId, "order=desc&limit=50&kind=message,trace");
    found = rows.find(pred);
    return found ? 1 : 0;
  }, { timeout: 30_000, intervals: [200] }).toBe(1);
  if (!found) throw new Error("message not found");
  return found;
}

test(
  "E2E-W6-01 a runner agent accepts, runs, leaves traces in a thread and replies",
  { tag: ["@W6"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(180_000);
    const rand = randomBytes(3).toString("hex");
    const handle = "w6r_" + rand;
    const name = "Runner " + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const created = await api.call("POST", "/api/agents", { handle, display_name: name, quota_class: "api_key" });
    expect(created.status).toBeGreaterThanOrEqual(200);
    expect(created.status).toBeLessThan(300);
    const aid = (created.json as { id: string }).id;
    const runtime = await api.call("PUT", "/api/agents/" + aid + "/runtime", {
      runtime: "runner",
      quota_class: "api_key",
      adapter_kind: "command",
    });
    expect(runtime.status).toBeGreaterThanOrEqual(200);
    expect(runtime.status).toBeLessThan(300);
    const slug = "w6-runner-" + rand;
    const room = await api.call("POST", "/api/rooms", { slug, name: "Runner " + rand });
    expect(room.status).toBe(200);
    const roomId = (room.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle })).status).toBe(200);
    const issued = await api.call("POST", "/api/agents/" + aid + "/tokens");
    expect(issued.status).toBeGreaterThanOrEqual(200);
    expect(issued.status).toBeLessThan(300);
    const token = (issued.json as { token: string }).token;
    expect(token).toMatch(/^kith_bot_[0-9a-f]{64}$/);

    const runner: RunnerHandle = await startRunner({ name: "w6r", token, quota: "api_key", rooms: [roomId] });
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await expectRunnerAlive(runner);
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);
      await waitForRunnerOnline(api, aid);
      const agent = await api.call("GET", "/api/agents/" + aid);
      expect((agent.json as { agent: { runner_last_seen_at: string | null } }).agent.runner_last_seen_at).not.toBeNull();
      const row = ben.page.locator(`[data-testid="members-row"][data-handle="${handle}"]`);
      await expect(row.getByTestId("members-limit")).toHaveCount(0);

      const trigger = `@${handle} hello [[cli:text=hi%20${rand};traces=2;sleep_ms=1500]] $(rm -rf ~) "; \`x\``;
      await sendViaComposer(ben.page, trigger);
      const placeholder = ben.page.locator(`[data-testid="reply-placeholder"][data-member="${aid}"]`);
      const labels: string[] = [];
      let shotRunning = false;
      await expect.poll(async () => {
        if (await placeholder.count()) {
          const label = (await placeholder.first().getAttribute("aria-label")) ?? "";
          if (label !== "" && labels.at(-1) !== label) labels.push(label);
          if (!shotRunning && label.includes("執行中")) {
            shotRunning = true;
            await shot(ben.page, info, "01-running");
          }
        }
        const bodies = await ben.page.getByTestId("message-body").allTextContents();
        return bodies.some((body) => body.trim() === "hi " + rand) ? 1 : 0;
      }, { timeout: 30_000, intervals: [50] }).toBe(1);
      expect(labels.findIndex((label) => label.includes("已接受"))).toBeGreaterThanOrEqual(0);
      expect(labels.findIndex((label) => label.includes("已接受"))).toBeLessThan(labels.findIndex((label) => label.includes("執行中")));
      await expect(placeholder).toHaveCount(0);
      const triggerRow = ben.page.getByTestId("message-row").filter({ hasText: "$(rm -rf ~)" });
      await expect(triggerRow.getByTestId("thread-summary")).toContainText("2 則回覆");
      await expect(ben.page.getByTestId("timeline").getByTestId("trace-card")).toHaveCount(0);
      await shot(ben.page, info, "02-replied");

      const calls = runner.invocations();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.argv).toEqual([]);
      const stdin = JSON.parse(calls[0]?.stdin ?? "{}") as { trigger?: { body?: string } };
      expect(stdin.trigger?.body ?? "").toContain("$(rm -rf ~)");
      expect(JSON.stringify(calls[0]?.argv)).not.toContain("rm -rf");

      const triggerMessage = await waitForMessage(api, roomId, (m) => m.kind === "message" && m.body.includes("$(rm -rf ~)"));
      await triggerRow.getByTestId("thread-summary").click();
      await expect(ben.page.getByTestId("thread-panel")).toBeVisible();
      await expect(ben.page).toHaveURL(new RegExp("/r/" + slug + "/t/" + triggerMessage.id + "$"));
      await expect(ben.page.getByTestId("thread-root")).toContainText("$(rm -rf ~)");
      await expect(ben.page.getByTestId("trace-card")).toHaveCount(2);
      await expect(ben.page.getByTestId("trace-summary")).toHaveCount(0);
      await shot(ben.page, info, "03-thread");

      await ben.page.getByTestId("trace-toggle").first().click();
      await ben.page.getByTestId("trace-load-full").click();
      await expect(ben.page.getByTestId("trace-full")).toContainText("step 1 full log");
      const notTrace = await api.call("GET", "/api/rooms/" + roomId + "/traces/" + triggerMessage.id);
      expect(notTrace.status).toBe(404);
      await shot(ben.page, info, "04-trace-full");

      await sendViaComposer(ben.page, `@${handle} [[cli:exit=3;stderr=boom]]`);
      const failed = ben.page.locator(`[data-testid="reply-failed"][data-member="${aid}"]`);
      await expect(failed).toBeVisible({ timeout: 30_000 });
      await expect(failed).toContainText(name + " 沒有完成");
      await expect(ben.page.getByTestId("message-body").filter({ hasText: `（@${handle} 沒有完成：exit 3）` })).toBeVisible();
      await shot(ben.page, info, "05-blocked");
      const failRow = ben.page.getByTestId("message-row").filter({ hasText: "[[cli:exit=3;stderr=boom]]" });
      await failRow.getByTestId("thread-summary").click();
      await expect(ben.page.getByTestId("thread-panel")).toBeVisible();
      const cards = ben.page.getByTestId("trace-card");
      const cardCount = await cards.count();
      for (let i = 0; i < cardCount; i++) await cards.nth(i).getByTestId("trace-toggle").click();
      await expect(ben.page.getByTestId("trace-summary").filter({ hasText: "boom" })).toBeVisible();

      await sendViaComposer(ben.page, `@${handle} [[cli:big=1;traces=0]]`);
      await expect(ben.page.getByTestId("message-body").filter({ hasText: "（已截斷）" })).toBeVisible({ timeout: 30_000 });
      const truncated = await waitForMessage(api, roomId, (m) => m.kind === "message" && m.body.endsWith("（已截斷）"));
      expect(new TextEncoder().encode(truncated.body).length).toBe(8192);
      const bigRow = ben.page.getByTestId("message-row").filter({ hasText: "[[cli:big=1;traces=0]]" });
      await bigRow.getByTestId("thread-summary").click();
      await ben.page.getByTestId("trace-toggle").first().click();
      await ben.page.getByTestId("trace-load-full").click();
      const full = ((await ben.page.getByTestId("trace-full").textContent()) ?? "").trim();
      expect(full).toBe("x".repeat(10_000));

      expect(readFileSync(runner.logFile, "utf8")).not.toContain(token);
    } finally {
      await ben.context.close();
      await runner.stop();
    }
  },
);

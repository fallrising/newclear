// E2E-W6-04 (docs/v2/milestones/W6.md §7.4).
import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type ApiClient } from "../fixtures/kith.ts";
import { ACCOUNTS, canaryBotToken } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { note } from "../harness/evidence.ts";
import { startKithStub, waitForMcp } from "../harness/kith-stub.ts";
import { expectRunnerAlive, startRunner, waitForRunnerOnline, type RunnerHandle } from "../harness/runner.ts";

type RoomMessage = { id: string; seq: number; body: string; kind: string };

async function expectExactBody(page: Page, text: string): Promise<void> {
  await expect.poll(async () => {
    const bodies = await page.getByTestId("message-body").allTextContents();
    return bodies.some((body) => body.trim() === text) ? 1 : 0;
  }, { timeout: 30_000, intervals: [100] }).toBe(1);
}

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

async function waitForBody(api: ApiClient, roomId: string, needle: string): Promise<RoomMessage> {
  let found: RoomMessage | undefined;
  await expect.poll(async () => {
    const res = await api.call("GET", "/api/rooms/" + roomId + "/messages?order=desc&limit=50");
    expect(res.status).toBe(200);
    const rows = (res.json as { messages: RoomMessage[] }).messages;
    found = rows.find((row) => row.body.includes(needle));
    return found ? 1 : 0;
  }, { timeout: 30_000, intervals: [200] }).toBe(1);
  if (!found) throw new Error("missing message " + needle);
  return found;
}

test(
  "E2E-W6-04 a restarted runner does not re-run and stops on a revoked token",
  { tag: ["@W6"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(180_000);
    const rand = randomBytes(3).toString("hex");
    const handle = "w6s_" + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const created = await api.call("POST", "/api/agents", { handle, display_name: "Restart " + rand, quota_class: "api_key" });
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
    const slug = "w6-restart-" + rand;
    const room = await api.call("POST", "/api/rooms", { slug, name: "Restart " + rand });
    expect(room.status).toBe(200);
    const roomId = (room.json as { id: string }).id;
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
    expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle })).status).toBe(200);
    const issued = await api.call("POST", "/api/agents/" + aid + "/tokens");
    expect(issued.status).toBeGreaterThanOrEqual(200);
    expect(issued.status).toBeLessThan(300);
    const token = (issued.json as { token: string }).token;

    let runner: RunnerHandle | null = null;
    let runner2: RunnerHandle | null = null;
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      runner = await startRunner({ name: "w6s", token, quota: "api_key", rooms: [roomId] });
      await expectRunnerAlive(runner);
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);
      await waitForRunnerOnline(api, aid);
      await sendViaComposer(ben.page, `@${handle} one [[cli:text=one-${rand}]]`);
      await expectExactBody(ben.page, "one-" + rand);
      expect(runner.invocations()).toHaveLength(1);

      expect(await runner.stop()).toBe(0);
      await sendViaComposer(ben.page, `@${handle} while-off [[cli:text=should-not-run]]`);
      const off = await waitForBody(api, roomId, "while-off");

      runner2 = await startRunner({ name: "w6s", token, quota: "api_key", rooms: [roomId], root: runner.root });
      await expectRunnerAlive(runner2);
      await waitForRunnerOnline(api, aid);
      await new Promise((r) => setTimeout(r, 4_000));
      expect(runner2.invocations()).toHaveLength(1);
      await expect(ben.page.getByTestId("reply-placeholder")).toHaveCount(0);
      const state = JSON.parse(readFileSync(join(runner2.root, "state", "state.json"), "utf8")) as {
        rooms?: Record<string, { cursor?: number }>;
      };
      expect(state.rooms?.[roomId]?.cursor ?? -1).toBeGreaterThanOrEqual(off.seq);

      await sendViaComposer(ben.page, `@${handle} two [[cli:text=two-${rand}]]`);
      await expectExactBody(ben.page, "two-" + rand);
      expect(runner2.invocations()).toHaveLength(2);

      await page.goto("/console/agents/" + aid + "?tab=tokens");
      await page.getByTestId("token-revoke").click();
      await page.getByTestId("token-revoke-confirm").click();
      await expect(page.locator('[data-testid="token-row"][data-state="revoked"]')).toHaveCount(1);
      await sendViaComposer(ben.page, `@${handle} are you there`);
      const exit = await Promise.race([
        runner2.exited,
        new Promise<number>((resolve) => setTimeout(() => resolve(-1), 15_000)),
      ]);
      expect(exit).toBe(3);
      const log = readFileSync(runner2.logFile, "utf8");
      expect(log).toContain('"reason":"token_rejected"');
      expect(log.match(/"event":"events_retry"/g)?.length ?? 0).toBe(0);
      note(info, "restart skipped the offline mention; revoked token exited 3");
    } finally {
      await ben.context.close();
      await runner2?.stop();
      await runner?.stop();
    }
  },
);

test("E2E-W6-04 FM-RUN-02/05 gap and duplicate live events against a stub Kith", { tag: ["@W6"] }, async ({}, info) => {
  test.setTimeout(60_000);
  const stub = await startKithStub();
  const runner = await startRunner({
    name: "w6gap",
    token: canaryBotToken(),
    quota: "api_key",
    rooms: ["r1"],
    kithUrl: stub.url,
  });
  try {
    await expectRunnerAlive(runner);
    await waitForMcp(stub, "send_message", 2, 10_000);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(stub.afterSeq).toEqual([10, 11]);
    const calls = runner.invocations();
    expect(calls).toHaveLength(2);
    const seqs = calls.map((call) => (JSON.parse(call.stdin) as { trigger: { seq: number } }).trigger.seq);
    expect(seqs).toEqual([11, 12]);
    expect(readFileSync(runner.logFile, "utf8")).toContain('"event":"gap"');
    note(info, "stub after_seq [10, 11]; replay and the resent live event did not run");
  } finally {
    await runner.stop();
    await stub.close();
  }
});

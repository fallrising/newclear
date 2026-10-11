import type { Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer, uniqueText } from "../fixtures/actors.ts";
import { note, saveFile, shot } from "../harness/evidence.ts";
import { KITH_DIR, WRANGLER_BIN } from "../harness/paths.ts";
import { redactText } from "../harness/redact.ts";
import { wranglerEnv } from "../harness/server.ts";

type Page_ = { messages: { seq: number }[]; has_more: boolean };

function seqRange(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

async function settleTimeline(page: Page): Promise<void> {
  await page.waitForFunction(() => document.fonts.status === "loaded", undefined, { timeout: 5000 });
  await page.evaluate(async () => {
    const timeline = document.querySelector<HTMLElement>('[data-testid="timeline"]')!;
    const deadline = performance.now() + 5000;
    let previous = "";
    let stableFrames = 0;
    while (stableFrames < 3) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const geometry = JSON.stringify([
        timeline.scrollTop,
        timeline.scrollHeight,
        [...timeline.querySelectorAll<HTMLElement>('[data-testid="message-row"]')].map((row) => {
          const box = row.getBoundingClientRect();
          return [row.dataset.seq, row.parentElement?.dataset.index, box.top, box.height];
        }),
      ]);
      const animating = timeline.getAnimations({ subtree: true }).some(
        (animation) => animation.playState === "running" && animation.effect?.getComputedTiming().iterations !== Infinity,
      );
      stableFrames = !animating && geometry === previous ? stableFrames + 1 : 0;
      previous = geometry;
      if (performance.now() > deadline) throw new Error("timeline layout did not settle");
    }
  });
}

test(
  "E2E-W1-04 long rooms open at the latest page and page back to the start",
  { tag: ["@W1"] },
  async ({ page, api, browser, recorder }, info) => {
    test.setTimeout(300_000);

    // 1. B-01 pages.
    await loginViaUi(page, ACCOUNTS.ada);
    const p1 = (await api.call("GET", "/api/rooms/room-long/messages?order=desc&before_seq=1200&kind=message,trace")).json as Page_;
    expect(p1.messages.map((m) => m.seq)).toEqual(seqRange(1150, 1199));
    expect(p1.has_more).toBe(true);
    const p2 = (await api.call("GET", "/api/rooms/room-long/messages?order=desc&before_seq=50")).json as Page_;
    expect(p2.messages.map((m) => m.seq)).toEqual(seqRange(0, 49));
    expect(p2.has_more).toBe(false);
    const p3 = (await api.call("GET", "/api/rooms/room-long/messages?order=asc&after_seq=1189&before_seq=1200&limit=10")).json as Page_;
    expect(p3.messages.map((m) => m.seq)).toEqual(seqRange(1190, 1199));
    expect(p3.has_more).toBe(false);
    const bad = await api.call("GET", "/api/rooms/room-long/messages?order=newest");
    expect(bad.status).toBe(400);
    const badJson = bad.json as { error: { code: string; message: string } };
    expect(badJson.error.code).toBe("invalid_request");
    expect(badJson.error.message).toBe("invalid order");
    note(info, "B-01 pages and has_more are correct");

    // 2. Opens at the latest message.
    await page.goto("/r/long-history");
    const latest = page.locator('[data-testid="message-row"][data-seq="1199"]');
    await expect(latest).toBeVisible();
    const tl = page.getByTestId("timeline");
    const lb = (await latest.boundingBox())!;
    const tb = (await tl.boundingBox())!;
    expect(lb.y).toBeGreaterThanOrEqual(tb.y - 1);
    expect(lb.y + lb.height).toBeLessThanOrEqual(tb.y + tb.height + 1);
    expect(await page.getByTestId("message-row").count()).toBeLessThanOrEqual(100);
    await shot(page, info, "latest");

    // 3–4. Page back to the start with a stable anchor.
    let loads = 0;
    let maxJump = 0;
    let maxRows = 0;
    let oldestLoaded = p1.messages[0]!.seq;
    const origin = new URL(page.url()).origin;
    await settleTimeline(page);
    for (let i = 0; i < 30; i++) {
      if (await page.getByTestId("timeline-start").isVisible()) break;
      const beforeSeq = oldestLoaded;
      const olderPage = (url: URL): boolean => url.origin === origin && url.pathname === "/api/rooms/room-long/messages" &&
        url.searchParams.get("order") === "desc" && url.searchParams.get("before_seq") === String(beforeSeq);
      let release!: () => void;
      const released = new Promise<void>((resolve) => { release = resolve; });
      let held!: () => void;
      const requestHeld = new Promise<void>((resolve) => { held = resolve; });
      await page.route(olderPage, async (route) => {
        held();
        await released;
        await route.continue();
      }, { times: 1 });
      try {
        const requested = page.waitForRequest((request) => olderPage(new URL(request.url())), { timeout: 5000 });
        await tl.evaluate((el) => { el.scrollTop = 150; });
        await requested;
        await requestHeld;
        await settleTimeline(page);
        const anchor = await page.evaluate(() => {
          const timeline = document.querySelector<HTMLElement>('[data-testid="timeline"]')!;
          const viewport = timeline.getBoundingClientRect();
          const first = [...timeline.querySelectorAll<HTMLElement>('[data-testid="message-row"]')].find((row) => {
            const box = row.getBoundingClientRect();
            return box.top >= viewport.top && box.bottom <= viewport.bottom;
          });
          return first ? {
            seq: first.dataset.seq!,
            top: first.getBoundingClientRect().top - viewport.top,
            index: Number(first.parentElement!.dataset.index),
          } : null;
        });
        expect(anchor, "visible anchor after the deliberate scroll").not.toBeNull();
        const response = page.waitForResponse((res) => olderPage(new URL(res.url())), { timeout: 5000 });
        release();
        const olderResponse = await response;
        expect(olderResponse.status()).toBe(200);
        const older = await olderResponse.json() as Page_;
        expect(older.messages.map((message) => message.seq)).toEqual(seqRange(beforeSeq - 50, beforeSeq - 1));
        await page.waitForFunction(
          ({ seq, index }) => {
            const row = document.querySelector<HTMLElement>(`[data-testid="message-row"][data-seq="${seq}"]`);
            // Date dividers can add more items than the verified message count.
            return row && Number(row.parentElement!.dataset.index) >= index;
          },
          { seq: anchor!.seq, index: anchor!.index + older.messages.length },
          { timeout: 5000 },
        );
        await settleTimeline(page);
        const newTop = await page.evaluate((seq) => {
          const timeline = document.querySelector<HTMLElement>('[data-testid="timeline"]')!;
          const row = timeline.querySelector<HTMLElement>(`[data-testid="message-row"][data-seq="${seq}"]`);
          return row ? row.getBoundingClientRect().top - timeline.getBoundingClientRect().top : null;
        }, anchor!.seq);
        expect(newTop, "same anchor after the committed older page").not.toBeNull();
        const jump = Math.abs(newTop! - anchor!.top);
        maxJump = Math.max(maxJump, jump);
        expect(jump).toBeLessThanOrEqual(2);
        loads++;
        oldestLoaded = older.messages[0]!.seq;
        if (!older.has_more) {
          await tl.evaluate((el) => { el.scrollTop = 0; });
          await settleTimeline(page);
        }
      } finally {
        release();
        await page.unroute(olderPage);
      }
      const rows = await page.getByTestId("message-row").count();
      maxRows = Math.max(maxRows, rows);
      expect(rows).toBeLessThanOrEqual(100);
    }
    await expect(page.getByTestId("timeline-start")).toBeVisible();
    await expect(page.locator('[data-testid="message-row"][data-seq="0"]')).toHaveCount(1);
    expect(loads).toBeGreaterThanOrEqual(23);
    note(info, `paged to the start in ${loads} loads, max anchor jump ${maxJump.toFixed(1)} px, max ${maxRows} DOM rows`);
    await shot(page, info, "start");

    // 5–6. A new message while reading history shows the jump button.
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    await ben.page.goto("/r/long-history");
    await expectLive(ben.page);
    const q = uniqueText("while reading");
    await sendViaComposer(ben.page, q);
    await expect(page.getByTestId("timeline-jump-latest")).toBeVisible();
    await expect(page.getByTestId("timeline-jump-latest")).toContainText("1");
    await expect(page.getByTestId("timeline-start")).toBeVisible();
    await shot(page, info, "jump-button");
    await page.getByTestId("timeline-jump-latest").click();
    await expect(page.getByTestId("message-row").filter({ hasText: q })).toBeVisible();
    await expect(page.getByTestId("timeline-jump-latest")).toHaveCount(0);

    // 7–10. More than 1,000 missed messages jump to the latest page.
    const slug = "w1-jump-" + Date.now().toString(36);
    const room = await api.call("POST", "/api/rooms", { slug, name: "W1 jump" });
    const roomId = (room.json as { id: string }).id;
    await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" });
    await ben.page.goto("/r/" + slug);
    await expectLive(ben.page);
    await expect(ben.page.getByTestId("timeline-empty")).toBeVisible();
    await api.call("POST", "/api/rooms/" + roomId + "/messages", { body: "jump start", client_message_id: "e2e-jump-start" });
    await expect(ben.page.getByTestId("message-row").filter({ hasText: "jump start" })).toBeVisible();
    await ben.context.setOffline(true);
    await expect(ben.page.getByTestId("room-offline-strip")).toBeVisible();
    // Pagination needs missed rows, not a burst through the production HTTP quota.
    const runDir = process.env.KITH_E2E_RUN_DIR;
    if (process.env.KITH_E2E_SETUP_OK !== "1" || !runDir) throw new Error("isolated E2E setup is required");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) throw new Error("invalid fixture room id");
    const sql = `WITH RECURSIVE missed(i) AS (
  VALUES (0) UNION ALL SELECT i + 1 FROM missed WHERE i < 1000
)
INSERT INTO messages
  (id, room_id, seq, kind, thread_id, reply_to, sender_id, body,
   mentions_json, generation_id, client_message_id, origin, created_at)
SELECT 'e2e-jump-${roomId}-' || printf('%04d', i), '${roomId}', i + 1,
       'message', NULL, NULL, 'm-ada', 'jump ' || i, '[]', NULL,
       'e2e-jump-' || printf('%04d', i), 'local', '${new Date().toISOString()}'
FROM missed;\n`;
    const fixture = saveFile(info, "missed-messages.sql", sql);
    const seeded = spawnSync(WRANGLER_BIN, [
      "d1", "execute", "kith", "--local", "--persist-to", join(runDir, "state"),
      "--file", join(runDir, fixture), "-y",
    ], { cwd: KITH_DIR, env: wranglerEnv(), encoding: "utf8", timeout: 30_000 });
    saveFile(info, "missed-messages.log", redactText((seeded.stdout ?? "") + (seeded.stderr ?? "") + (seeded.error?.message ?? "")));
    expect(seeded.status, "bounded local D1 missed-message fixture").toBe(0);
    await ben.context.setOffline(false);
    await expect(ben.page.getByTestId("timeline-jumped")).toBeVisible({ timeout: 30_000 });
    await expect(ben.page.getByTestId("message-row").filter({ hasText: "jump 1000" })).toBeVisible();
    await expect(ben.page.locator('[data-testid="message-row"][data-seq="0"]')).toHaveCount(0);
    note(info, "more than 1,000 missed messages jumped to the latest page (FM-SYNC-13)");
    await shot(ben.page, info, "jumped");
    await ben.page.getByTestId("timeline-jumped-dismiss").click();
    await expect(ben.page.getByTestId("timeline-jumped")).toHaveCount(0);
    await ben.context.close();
  },
);

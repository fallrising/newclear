import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer, uniqueText } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";

type Page_ = { messages: { seq: number }[]; has_more: boolean };

function seqRange(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
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
    for (let i = 0; i < 30; i++) {
      if (await page.getByTestId("timeline-start").isVisible()) break;
      const anchor = await page.evaluate(() => {
        const t = document.querySelector('[data-testid="timeline"]')!.getBoundingClientRect().top;
        const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="message-row"]')];
        const first = rows.find((r) => r.getBoundingClientRect().top >= t);
        return first ? { seq: first.dataset.seq!, top: first.getBoundingClientRect().top } : null;
      });
      const firstSeq = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="message-row"]')];
        return Math.min(...rows.map((r) => Number(r.dataset.seq)));
      });
      await tl.evaluate((el) => {
        el.scrollTop = 150;
      });
      await page.waitForFunction(
        (prev) => {
          if (document.querySelector('[data-testid="timeline-start"]')) return true;
          const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="message-row"]')];
          return Math.min(...rows.map((r) => Number(r.dataset.seq))) !== prev;
        },
        firstSeq,
        { timeout: 5000 },
      );
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
      loads++;
      if (anchor) {
        const newTop = await page.evaluate(
          (seq) => document.querySelector<HTMLElement>(`[data-testid="message-row"][data-seq="${seq}"]`)?.getBoundingClientRect().top ?? null,
          anchor.seq,
        );
        if (newTop !== null) {
          const jump = Math.abs(newTop - anchor.top);
          maxJump = Math.max(maxJump, jump);
          expect(jump).toBeLessThanOrEqual(2);
        }
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
    for (let i = 0; i <= 1000; i++) {
      const r = await api.call("POST", "/api/rooms/" + roomId + "/messages", {
        body: "jump " + i,
        client_message_id: "e2e-jump-" + String(i).padStart(4, "0"),
      });
      expect(r.status).toBe(200);
    }
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

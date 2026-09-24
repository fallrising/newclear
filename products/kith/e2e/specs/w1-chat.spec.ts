import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer, uniqueText } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";
import { createWsChaos } from "../harness/ws-chaos.ts";

const FIXED_NOW = new Date("2026-09-22T12:00:00+08:00");

function row(page: Page, text: string) {
  return page.getByTestId("message-row").filter({ hasText: text });
}

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

/** Exactly one message row with the text and no pending row with it. */
async function once(page: Page, text: string): Promise<void> {
  await expect(row(page, text)).toHaveCount(1);
  await expect(page.getByTestId("pending-row").filter({ hasText: text })).toHaveCount(0);
}

async function sendAndSee(page: Page, text: string): Promise<void> {
  await sendViaComposer(page, text);
  await expect(row(page, text)).toHaveCount(1);
}

async function seqOf(page: Page, text: string): Promise<number> {
  return Number(await row(page, text).getAttribute("data-seq"));
}

async function lastSeqs(page: Page, n: number): Promise<number[]> {
  const all = await page.getByTestId("message-row").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-seq"))));
  return all.sort((a, b) => a - b).slice(-n);
}

test(
  "E2E-W1-02 two humans see the same messages in the same seq order",
  { tag: ["@W1"] },
  async ({ page, browser, recorder }, info) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await loginViaUi(page, ACCOUNTS.ada);
    await page.goto("/r/lobby");
    await expect(page.locator('[data-testid="message-row"][data-seq="11"]')).toBeVisible();
    await expectLive(page);
    await expect(page.locator('[data-testid="date-divider"][data-date="2026-09-21"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="date-divider"][data-date="2026-09-22"]')).toHaveCount(1);
    await expect(page.locator('[data-seq="0"] [data-testid="message-sender"]')).toHaveCount(1);
    await expect(page.locator('[data-seq="1"] [data-testid="message-sender"]')).toHaveCount(0);
    await expect(page.locator('[data-seq="4"] strong')).toHaveText("Bold");
    await expect(page.locator('[data-seq="4"] em')).toHaveText("italic");
    await expect(page.locator('[data-seq="4"] code')).toHaveText("inline code");
    await shot(page, info, "ada-lobby");

    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    await ben.page.clock.setFixedTime(FIXED_NOW);
    await ben.page.goto("/r/lobby");
    await expectLive(ben.page);

    const a = uniqueText("from ada");
    await sendViaComposer(page, a);
    await expect(row(page, a)).toHaveCount(1);
    await expect(row(ben.page, a)).toHaveCount(1);
    expect(await seqOf(page, a)).toBe(await seqOf(ben.page, a));
    await expect(row(page, a).getByTestId("message-sender")).toHaveText("你");

    const b = uniqueText("from ben");
    await sendViaComposer(ben.page, b);
    await expect(row(page, b)).toHaveCount(1);
    await expect(row(ben.page, b)).toHaveCount(1);
    const bSeq = await seqOf(page, b);
    expect(bSeq).toBe(await seqOf(ben.page, b));
    expect(bSeq).toBeGreaterThan(await seqOf(page, a));
    expect(await lastSeqs(page, 5)).toEqual(await lastSeqs(ben.page, 5));
    await shot(page, info, "both-ada");
    await shot(ben.page, info, "both-ben");

    const input = page.getByTestId("composer-input");
    await input.fill("line one");
    await input.press("Shift+Enter");
    await input.pressSequentially("line two");
    await input.press("Enter");
    const multi = row(page, "line one").last();
    await expect(multi).toBeVisible();
    expect(await multi.getByTestId("message-body").evaluate((el) => (el as HTMLElement).innerText)).toBe("line one\nline two");

    await input.fill("組字中");
    await input.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true }),
      ),
    );
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await expect(input).toHaveValue("組字中");
    await expect(page.getByTestId("pending-row")).toHaveCount(0);
    note(info, "Enter during IME composition does not send");
    await input.fill("");

    await ben.context.close();
  },
);

test(
  "E2E-W1-03 reconnect, reorder, loss and errors keep the timeline exact",
  { tag: ["@W1"] },
  async ({ page, browser, recorder }, info) => {
    test.setTimeout(240_000);
    await loginViaUi(page, ACCOUNTS.ada);
    await page.goto("/r/lobby");
    await expectLive(page);

    const chaos = createWsChaos();
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben", chaos });
    let afterSeqRequests = 0;
    let posts = 0;
    ben.page.on("request", (r) => {
      if (!r.url().includes("/api/rooms/room-lobby/messages")) return;
      if (r.method() === "POST") posts++;
      else if (r.url().includes("order=asc")) afterSeqRequests++;
    });
    const benAfterSeqRequests = (): number => afterSeqRequests;
    const benPosts = (): number => posts;
    await ben.page.goto("/r/lobby");
    await expectLive(ben.page);

    // A. Offline, draft, catch-up (UJ-02, FM-SYNC-01)
    const draft = uniqueText("draft");
    await ben.page.getByTestId("composer-input").fill(draft);
    await ben.context.setOffline(true);
    await expect(ben.page.getByTestId("room-offline-strip")).toBeVisible();
    await expect(ben.page.getByTestId("composer-offline")).toBeVisible();
    await expect(ben.page.getByTestId("composer-send")).toBeDisabled();
    await shot(ben.page, info, "ben-offline");
    const aTexts = [uniqueText("a1"), uniqueText("a2"), uniqueText("a3")];
    for (const t of aTexts) await sendAndSee(page, t);
    await ben.page.route(
      /\/api\/rooms\/room-lobby\/messages\?.*order=asc/,
      async (r) => {
        await new Promise((res) => setTimeout(res, 1000));
        await r.fallback();
      },
      { times: 1 },
    );
    await ben.context.setOffline(false);
    const a4 = uniqueText("a4");
    await sendAndSee(page, a4);
    await expect(row(ben.page, a4)).toHaveCount(1);
    await expect(ben.page.getByTestId("room-offline-strip")).toHaveCount(0);
    const all = [...aTexts, a4];
    for (const t of all) await once(ben.page, t);
    const seqs = await Promise.all(all.map((t) => seqOf(ben.page, t)));
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
    await expect(ben.page.getByTestId("composer-input")).toHaveValue(draft);
    note(info, "offline catch-up merged with an early event, no duplicates, draft kept");
    await shot(ben.page, info, "ben-caught-up");
    await ben.page.getByTestId("composer-input").fill("");

    // B. Reorder (FM-SYNC-02)
    const n0 = benAfterSeqRequests();
    const x1 = uniqueText("x1");
    const x2 = uniqueText("x2");
    const h1 = chaos.add({ kind: "hold", match: { dir: "in", type: "event", bodyIncludes: x1 } });
    const h2 = chaos.add({ kind: "hold", match: { dir: "in", type: "event", bodyIncludes: x2 } });
    await sendAndSee(page, x1);
    await sendAndSee(page, x2);
    await chaos.waitForFrame({ dir: "in", type: "event", bodyIncludes: x2 }, 5000);
    chaos.release(h2);
    chaos.release(h1);
    await expect(row(ben.page, x1)).toHaveCount(1);
    await expect(row(ben.page, x2)).toHaveCount(1);
    await ben.page.waitForTimeout(1000);
    await once(ben.page, x1);
    await once(ben.page, x2);
    expect(await seqOf(ben.page, x1)).toBeLessThan(await seqOf(ben.page, x2));
    expect(benAfterSeqRequests()).toBe(n0);
    chaos.remove(h1);
    chaos.remove(h2);
    note(info, "reordered events did not trigger a gap fill");

    // C. Loss and gap fill (FM-SYNC-03)
    const n1 = benAfterSeqRequests();
    const y1 = uniqueText("y1");
    const y2 = uniqueText("y2");
    const d = chaos.add({ kind: "drop", match: { dir: "in", type: "event", bodyIncludes: y1 } });
    await sendAndSee(page, y1);
    await sendAndSee(page, y2);
    await expect(row(ben.page, y2)).toHaveCount(1);
    await expect(row(ben.page, y1)).toHaveCount(1);
    await once(ben.page, y1);
    await once(ben.page, y2);
    expect(benAfterSeqRequests() - n1).toBe(1);
    chaos.remove(d);
    note(info, "dropped event recovered by exactly one gap fill");

    // D. Disconnect right after send (FM-SYNC-06)
    const c = chaos.add({ kind: "closeAfter", match: { dir: "out", type: "send" }, code: 4002 });
    const z = uniqueText("z");
    await sendViaComposer(ben.page, z);
    await expect(row(ben.page, z)).toHaveCount(1);
    await once(ben.page, z);
    await once(page, z);
    chaos.remove(c);

    // E. Lost ack, REST resend (FM-SYNC-07)
    const w = uniqueText("w");
    const d2 = chaos.add({ kind: "drop", match: { dir: "in", type: "event", bodyIncludes: w } });
    const p0 = benPosts();
    await sendViaComposer(ben.page, w);
    await expect(ben.page.getByTestId("pending-row").filter({ hasText: w })).toHaveAttribute("data-state", "sending");
    await ben.page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/api/rooms/room-lobby/messages"),
      { timeout: 15_000 },
    );
    await expect(row(ben.page, w)).toHaveCount(1);
    expect(benPosts() - p0).toBe(1);
    await once(ben.page, w);
    await once(page, w);
    chaos.remove(d2);
    note(info, "lost ack resolved by idempotent REST resend");

    // F. Bad frame (FM-SYNC-16)
    chaos.inject("not json");
    const v = uniqueText("v");
    await sendAndSee(page, v);
    await expect(row(ben.page, v)).toHaveCount(1);
    await expectLive(ben.page);
    await once(ben.page, v);

    // G. Server rejects a send (FM-SYNC-08)
    const h = chaos.add({ kind: "hold", match: { dir: "out", type: "send" } });
    const p1 = benPosts();
    const u = uniqueText("u");
    await sendViaComposer(ben.page, u);
    await chaos.waitForFrame({ dir: "out", type: "send", bodyIncludes: u }, 5000);
    chaos.inject('{"v":1,"type":"error","code":"forbidden"}');
    const failed = ben.page.getByTestId("pending-row").filter({ hasText: u });
    await expect(failed).toHaveAttribute("data-state", "failed");
    await expect(failed.getByTestId("pending-status")).not.toHaveText("");
    expect(benPosts()).toBe(p1);
    await expect(failed.getByTestId("pending-retry")).toBeVisible();
    await expect(failed.getByTestId("pending-discard")).toBeVisible();
    await shot(ben.page, info, "ben-failed");
    await failed.getByTestId("pending-discard").click();
    chaos.remove(h);
    await expect(ben.page.getByTestId("pending-row").filter({ hasText: u })).toHaveCount(0);
    await expect(row(page, u)).toHaveCount(0);

    // H. Same person, two tabs (FM-SYNC-11)
    const ada2 = await page.context().newPage();
    recorder.watch(ada2, "ada-tab2");
    await ada2.goto("/r/lobby");
    await expectLive(ada2);
    const t = uniqueText("t");
    await sendAndSee(page, t);
    await expect(row(ada2, t)).toHaveCount(1);
    await once(page, t);
    await once(ada2, t);
    await ada2.close();

    // I. Switching rooms aborts the old room's request (FM-SYNC-10)
    await ben.page.route(
      /\/api\/rooms\/room-long\/messages\?.*order=desc/,
      async (r) => {
        await new Promise((res) => setTimeout(res, 1500));
        try {
          await r.fallback();
        } catch {
          // The app already aborted the request.
        }
      },
      { times: 1 },
    );
    const aborted = ben.page.waitForEvent("requestfailed", (r) => r.url().includes("/api/rooms/room-long/messages"));
    await ben.page.locator('[data-testid="room-list-item"][data-slug="long-history"]').click();
    await ben.page.locator('[data-testid="room-list-item"][data-slug="quiet"]').click();
    await aborted;
    await expectLive(ben.page);
    await ben.page.waitForTimeout(2000);
    await expect(ben.page.getByTestId("message-row").filter({ hasText: "長歷史" })).toHaveCount(0);
    await expect(ben.page.getByTestId("room-title")).toHaveText("安靜的房間 Quiet");
    note(info, "the previous room's request was aborted and never written");

    // K. Gap fill answers with an empty page (FM-SYNC-04)
    await ben.page.locator('[data-testid="room-list-item"][data-slug="lobby"]').click();
    await expectLive(ben.page);
    const n2 = benAfterSeqRequests();
    const k1 = uniqueText("k1");
    const k2 = uniqueText("k2");
    const dk = chaos.add({ kind: "drop", match: { dir: "in", type: "event", bodyIncludes: k1 } });
    await ben.page.route(
      /\/api\/rooms\/room-lobby\/messages\?.*order=asc/,
      (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"messages":[],"has_more":false}' }),
      { times: 1 },
    );
    const gapRequest = ben.page.waitForRequest(/order=asc/);
    await sendAndSee(page, k1);
    await sendAndSee(page, k2);
    await expect(row(ben.page, k2)).toHaveCount(1);
    await gapRequest;
    await ben.page.waitForTimeout(1500);
    expect(benAfterSeqRequests() - n2).toBe(1);
    await expect(row(ben.page, k1)).toHaveCount(0);
    chaos.remove(dk);
    const k3 = uniqueText("k3");
    await sendAndSee(page, k3);
    await expect(row(ben.page, k3)).toHaveCount(1);
    note(info, "empty gap fill is accepted as a confirmed hole without retry");

    // J. 401 (FM-SYNC-09)
    await ben.context.clearCookies();
    chaos.closeFromServer(4003);
    await ben.page.waitForURL(/\/login\?next=/, { timeout: 30_000 });
    await expect(ben.page.getByTestId("login-page")).toBeVisible();
    await shot(ben.page, info, "ben-auth-lost");

    await ben.context.close();
  },
);

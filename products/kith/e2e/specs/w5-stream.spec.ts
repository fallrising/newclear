import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor, sendViaComposer } from "../fixtures/actors.ts";
import { createHostedAgentViaApi, createProviderViaApi, inviteAgentViaApi, readMcpEvents } from "../fixtures/console.ts";
import { note, saveFile, shot } from "../harness/evidence.ts";
import { createWsChaos } from "../harness/ws-chaos.ts";

function enc(text: string): string {
  return encodeURIComponent(text);
}

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

async function roomFor(api: { call: (method: "POST", path: string, body?: unknown) => Promise<{ status: number; json: unknown }> }, slug: string, name: string): Promise<string> {
  const created = await api.call("POST", "/api/rooms", { slug, name });
  expect(created.status).toBe(200);
  const roomId = (created.json as { id: string }).id;
  expect((await api.call("POST", "/api/rooms/" + roomId + "/members", { handle: "ben" })).status).toBe(200);
  return roomId;
}

function messagesOf(json: unknown): { seq: number; body: string; generation_id: string | null }[] {
  return (json as { messages: { seq: number; body: string; generation_id: string | null }[] }).messages;
}

test(
  "E2E-W5-01 a streamed reply grows in the placeholder and is replaced by the message",
  { tag: ["@W5"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(180_000);
    const rand = randomBytes(3).toString("hex");
    const handle = "w5s_" + rand;
    const T = "The quick brown fox jumps over the lazy dog " + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const pid = await createProviderViaApi(api, { name: "w5s-" + rand, format: "openai_chat" });
    const aid = await createHostedAgentViaApi(api, {
      handle,
      display_name: "Streamer " + rand,
      providerId: pid,
      model: "fake-chat",
      stream: true,
    });
    const slug = "w5-stream-" + rand;
    const roomId = await roomFor(api, slug, "Stream " + rand);
    await inviteAgentViaApi(api, roomId, handle, aid);
    const chaos = createWsChaos();
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben", chaos });
    try {
      await page.goto("/r/" + slug);
      await expectLive(page);
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);

      await sendViaComposer(ben.page, "@" + handle + " [[fake:text=" + enc(T) + ";chunks=8;chunk_ms=400]]");
      await expect(ben.page.getByTestId("reply-draft")).toBeVisible({ timeout: 30_000 });
      await shot(ben.page, info, "01-first-draft");

      const seen: string[] = [];
      let shotMid = false;
      await expect.poll(async () => {
        const draft = ben.page.getByTestId("reply-draft");
        if (await draft.count()) {
          const text = ((await draft.textContent()) ?? "").trim();
          if (text.length > 0 && seen.at(-1) !== text) {
            seen.push(text);
            if (seen.length === 2 && !shotMid) {
              shotMid = true;
              await shot(ben.page, info, "02-mid-draft");
            }
          }
        }
        return await ben.page.getByTestId("message-row").filter({ hasText: rand }).count();
      }, { timeout: 15_000, intervals: [100] }).toBeGreaterThan(0);
      expect(seen.length).toBeGreaterThanOrEqual(3);
      let prev = 0;
      for (const text of seen) {
        expect(T.startsWith(text)).toBe(true);
        expect(text.length).toBeGreaterThan(prev);
        prev = text.length;
      }
      note(info, "draft grew in " + seen.length + " steps");

      const row = ben.page.getByTestId("message-row").filter({ hasText: T });
      await expect(row.getByTestId("message-body")).toHaveText(T);
      await expect(ben.page.getByTestId("reply-placeholder")).toHaveCount(0);
      await expect(ben.page.getByTestId("reply-draft")).toHaveCount(0);
      await expect(page.getByTestId("message-row").filter({ hasText: T }).getByTestId("message-body")).toHaveText(T);
      await expect(page.getByTestId("reply-draft")).toHaveCount(0);
      await shot(ben.page, info, "03-final");

      const frames = chaos.frames();
      const drafts = frames.filter((frame) => frame.dir === "in" && (frame.json as { type?: string } | null)?.type === "draft");
      const finalEvent = frames.filter((frame) => {
        const json = frame.json as { type?: string; event?: { body?: string; generation_id?: string | null } } | null;
        return frame.dir === "in" && json?.type === "event" && json.event?.body === T;
      }).at(-1);
      const generationId = (finalEvent?.json as { event?: { generation_id?: string | null } } | undefined)?.event?.generation_id;
      expect(generationId).toBeTruthy();
      for (const frame of drafts) {
        expect((frame.json as { generation_id?: string }).generation_id).toBe(generationId);
      }
      expect(drafts.at(-1)?.at ?? Number.POSITIVE_INFINITY).toBeLessThan(finalEvent?.at ?? 0);

      const held = chaos.add({ kind: "hold", match: { dir: "in", type: "draft" } });
      await sendViaComposer(ben.page, "@" + handle + " [[fake:text=late-" + rand + ";chunks=4;chunk_ms=200]]");
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "late-" + rand })).toBeVisible({ timeout: 30_000 });
      chaos.release(held);
      await ben.page.waitForTimeout(500);
      await expect(ben.page.getByTestId("reply-draft")).toHaveCount(0);
      await expect(ben.page.getByTestId("reply-placeholder")).toHaveCount(0);
      note(info, "late drafts after the final event were ignored");
      await shot(ben.page, info, "04-late-draft-ignored");
    } finally {
      await ben.context.close();
    }
  },
);

test(
  "E2E-W5-02 drafts are never persisted and never reach /mcp/events",
  { tag: ["@W5"] },
  async ({ page, browser, recorder, api }, info) => {
    test.setTimeout(180_000);
    const rand = randomBytes(3).toString("hex");
    const handle = "w5p_" + rand;
    const watch = "w5w_" + rand;
    const T = "The quick brown fox jumps over the lazy dog " + rand;
    await loginViaUi(page, ACCOUNTS.ada);
    const pid = await createProviderViaApi(api, { name: "w5p-" + rand, format: "openai_chat" });
    const aid = await createHostedAgentViaApi(api, {
      handle,
      display_name: "Persist " + rand,
      providerId: pid,
      model: "fake-chat",
      stream: true,
    });
    const watcher = await api.call("POST", "/api/agents", { handle: watch, display_name: "Watch " + rand, quota_class: "api_key" });
    expect(watcher.status).toBeGreaterThanOrEqual(200);
    expect(watcher.status).toBeLessThan(300);
    const watchId = (watcher.json as { id: string }).id;
    const external = await api.call("PUT", "/api/agents/" + watchId + "/runtime", { runtime: "external", quota_class: "api_key" });
    expect(external.status).toBeGreaterThanOrEqual(200);
    expect(external.status).toBeLessThan(300);
    const issued = await api.call("POST", "/api/agents/" + watchId + "/tokens");
    expect(issued.status).toBeGreaterThanOrEqual(200);
    expect(issued.status).toBeLessThan(300);
    const tok = (issued.json as { token: string }).token;

    const slug = "w5-persist-" + rand;
    const roomId = await roomFor(api, slug, "Persist " + rand);
    await inviteAgentViaApi(api, roomId, handle, aid);
    await inviteAgentViaApi(api, roomId, watch, watchId);
    const ben = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "ben" });
    try {
      await ben.page.goto("/r/" + slug);
      await expectLive(ben.page);
      await sendViaComposer(ben.page, "warmup " + rand);
      await expect(ben.page.getByTestId("message-row").filter({ hasText: "warmup " + rand })).toBeVisible();
      const beforePage = await api.call("GET", "/api/rooms/" + roomId + "/messages?order=desc&limit=1");
      const before = messagesOf(beforePage.json).at(-1)?.seq;
      expect(before).toBeGreaterThan(0);

      const eventsPromise = readMcpEvents(tok, roomId, before ?? 0, 12_000);
      await sendViaComposer(ben.page, "@" + handle + " [[fake:text=" + enc(T) + ";chunks=8;chunk_ms=300]]");
      await expect(ben.page.getByTestId("message-row").filter({ hasText: T })).toBeVisible({ timeout: 30_000 });

      const afterPage = await api.call("GET", "/api/rooms/" + roomId + "/messages?after_seq=" + before + "&limit=50");
      const after = messagesOf(afterPage.json);
      expect(after).toHaveLength(2);
      expect(after[0]?.seq).toBe((before ?? 0) + 1);
      expect(after[0]?.body).toContain("[[fake:");
      expect(after[1]?.seq).toBe((before ?? 0) + 2);
      expect(after[1]?.body).toBe(T);
      expect(after[1]?.generation_id).toBeTruthy();

      const events = await eventsPromise;
      expect(events).not.toContain("draft");
      const messageEvents = events.split("\n").filter((line) => line.includes('"kind":"message"'));
      expect(messageEvents).toHaveLength(2);
      expect(partialBody(events, T)).toBe(false);
      saveFile(info, "mcp-events.txt", events);
    } finally {
      await ben.context.close();
    }
  },
);

function partialBody(raw: string, full: string): boolean {
  for (let k = 1; k < full.length; k++) {
    const needle = '"body":"' + full.slice(0, k);
    let from = 0;
    for (;;) {
      const at = raw.indexOf(needle, from);
      if (at < 0) break;
      if (raw[at + needle.length] !== full[k]) return true;
      from = at + 1;
    }
  }
  return false;
}

import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, uniqueText } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";
import { startLegacyWeb } from "../harness/legacy-web.ts";

type Row = Record<string, unknown> & { seq: number; body: string; sender_id: string; mentions_json?: string };

test(
  "E2E-W1-01 legacy frontend still logs in and sends after B-01",
  { tag: ["@W1"] },
  async ({ page, api, browser, recorder }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    test.setTimeout(180_000);

    // 1. Without `order` the response is v1.
    await loginViaUi(page, ACCOUNTS.ada);
    const r = await api.call("GET", "/api/rooms/room-lobby/messages?before_seq=12");
    expect(r.status).toBe(200);
    const json = r.json as { messages: Row[] };
    expect(Object.keys(json)).toEqual(["messages"]);
    expect(json.messages.map((m) => m.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const m of json.messages) {
      expect(Object.keys(m).sort()).toEqual([
        "body", "client_message_id", "created_at", "generation_id", "id", "kind", "mentions_json",
        "origin", "reply_to", "room_id", "sender_id", "seq", "thread_id",
      ]);
    }
    expect(json.messages.find((m) => m.seq === 5)?.mentions_json).toBe('["m-ben"]');
    note(info, "v1 query without order is unchanged (V2-INV-04)");

    // 2. order=desc returns ascending rows with has_more.
    const r2 = await api.call("GET", "/api/rooms/room-lobby/messages?order=desc&before_seq=12&limit=5");
    const j2 = r2.json as { messages: Row[]; has_more: boolean };
    expect(j2.has_more).toBe(true);
    expect(j2.messages.map((m) => m.seq)).toEqual([7, 8, 9, 10, 11]);
    note(info, "order=desc returns ascending rows with has_more");

    // 3–6. The legacy frontend still logs in and sends.
    const legacy = await startLegacyWeb(process.env.KITH_E2E_API_ORIGIN!);
    const ctx = await browser.newContext({ baseURL: legacy.url, viewport: { width: 1280, height: 800 } });
    try {
      const lp = await ctx.newPage();
      recorder.watch(lp, "legacy");
      await lp.goto("/");
      await expect(lp.getByLabel(/handle/i)).toBeVisible();
      await lp.getByLabel(/handle/i).fill("ada");
      await lp.getByLabel(/password/i).fill(ACCOUNTS.ada.password);
      await lp.getByRole("button", { name: /sign in/i }).click();
      await lp.getByRole("button", { name: "安靜的房間 Quiet" }).click();
      await expect(lp.getByText("live", { exact: true })).toBeVisible();
      await shot(lp, info, "legacy-room");

      const text = uniqueText("legacy");
      await lp.getByLabel("Message 安靜的房間 Quiet").fill(text);
      await lp.getByLabel("Message 安靜的房間 Quiet").press("Enter");
      await expect(lp.getByText(text)).toBeVisible();
      await shot(lp, info, "legacy-sent");

      const r3 = await api.call("GET", "/api/rooms/room-quiet/messages?order=desc&limit=1");
      const last = (r3.json as { messages: Row[] }).messages.at(-1);
      expect(last?.body).toBe(text);
      expect(last?.sender_id).toBe("m-ada");
      note(info, "legacy send persisted");
    } finally {
      await ctx.close();
      await legacy.close();
    }
  },
);

import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi } from "../fixtures/actors.ts";
import { note } from "../harness/evidence.ts";

type Row = Record<string, unknown> & { seq: number; body: string; sender_id: string; mentions_json?: string };

test(
  "E2E-W1-01 v1 message queries are unchanged (V2-INV-04)",
  { tag: ["@W1"] },
  async ({ page, api }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    test.setTimeout(60_000);

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
  },
);

// Seed base-v1 (docs/v2/milestones/W0.md §4.4). Test-only, non-secret credentials; deterministic output.
import { createHash } from "node:crypto";
import { ACCOUNTS } from "./accounts.ts";

export type SeedDescription = {
  schema: "kith-e2e-seed/v1";
  id: string;
  sha256: string;
  generated_by: "e2e/fixtures/seed.ts";
  counts: { members: number; rooms: number; room_members: number; messages: number; bot_tokens: number };
  members: {
    id: string;
    kind: "human" | "agent";
    handle: string;
    display_name: string;
    is_operator: boolean;
    quota_class: "api_key" | "operator_personal";
    disabled: boolean;
  }[];
  rooms: {
    id: string;
    slug: string;
    name: string;
    member_ids: string[];
    message_count: number;
    first_seq: number | null;
    last_seq: number | null;
  }[];
};

export type SeedBuild = { id: "base-v1"; sql: string; sha256: string; description: SeedDescription };

type MemberRow = {
  id: string;
  kind: "human" | "agent";
  handle: string;
  display_name: string;
  password: string | null;
  is_operator: 0 | 1;
  quota_class: "api_key" | "operator_personal";
  disabled_at: string | null;
};

type RoomRow = { id: string; slug: string; name: string; created_at: string; owner: string; members: string[] };

type MessageRow = {
  id: string;
  room_id: string;
  seq: number;
  sender_id: string;
  body: string;
  mentions: string[];
  client_message_id: string;
  created_at: string;
};

const MEMBER_CREATED_AT = "2026-07-01T00:00:00.000Z";

const MEMBERS: MemberRow[] = [
  { id: "m-ada", kind: "human", handle: "ada", display_name: "Ada Lin", password: ACCOUNTS.ada.password, is_operator: 1, quota_class: "api_key", disabled_at: null },
  { id: "m-ben", kind: "human", handle: "ben", display_name: "Ben Okafor", password: ACCOUNTS.ben.password, is_operator: 0, quota_class: "api_key", disabled_at: null },
  { id: "m-chen", kind: "human", handle: "chen", display_name: "陳怡君", password: ACCOUNTS.chen.password, is_operator: 0, quota_class: "api_key", disabled_at: null },
  { id: "m-dora", kind: "human", handle: "dora", display_name: "Dora Silva", password: ACCOUNTS.dora.password, is_operator: 0, quota_class: "api_key", disabled_at: "2026-09-02T00:00:00.000Z" },
  { id: "m-grok", kind: "agent", handle: "grok", display_name: "Grok", password: null, is_operator: 0, quota_class: "api_key", disabled_at: null },
  { id: "m-codex", kind: "agent", handle: "codex", display_name: "Codex", password: null, is_operator: 0, quota_class: "operator_personal", disabled_at: null },
];

// Owner first; the others in member-table order.
const ROOMS: RoomRow[] = [
  { id: "room-long", slug: "long-history", name: "長歷史 Long history", created_at: "2026-07-31T00:00:00.000Z", owner: "m-ada", members: ["m-ben"] },
  { id: "room-lobby", slug: "lobby", name: "Lobby", created_at: "2026-09-01T00:00:00.000Z", owner: "m-ada", members: ["m-ben", "m-chen", "m-grok", "m-codex"] },
  { id: "room-quiet", slug: "quiet", name: "安靜的房間 Quiet", created_at: "2026-09-10T00:00:00.000Z", owner: "m-ada", members: ["m-ben"] },
  { id: "room-ada-private", slug: "ada-private", name: "Ada 的筆記 Ada's notes", created_at: "2026-09-15T00:00:00.000Z", owner: "m-ada", members: [] },
];

const LOBBY_BODY_4 = "**Bold**, *italic* and `inline code` render as Markdown.";
const LOBBY_BODY_9 = "```\nnpm run e2e -- --grep @W1\n```";

const LOBBY: [string, string, string, string[]][] = [
  ["m-ada", "2026-09-21T01:00:00.000Z", "歡迎來到 Kith，這裡是 Lobby。", []],
  ["m-ada", "2026-09-21T01:01:00.000Z", "有任何問題都可以在這裡問。", []],
  ["m-ben", "2026-09-21T01:10:00.000Z", "Hi Ada, glad to be here.", []],
  ["m-chen", "2026-09-21T01:12:00.000Z", "大家好，我是怡君。", []],
  ["m-ben", "2026-09-21T01:20:00.000Z", LOBBY_BODY_4, []],
  ["m-ada", "2026-09-21T01:30:00.000Z", "@ben 可以幫忙看一下週末的行程嗎？", ["m-ben"]],
  ["m-ben", "2026-09-22T02:00:00.000Z", "@ada 沒問題，我今天整理好。", ["m-ada"]],
  ["m-ben", "2026-09-22T02:02:00.000Z", "- 週六：爬山\n- 週日：休息", []],
  ["m-chen", "2026-09-22T02:15:00.000Z", "> 週六：爬山\n\n我也要去！", []],
  ["m-ada", "2026-09-22T02:20:00.000Z", LOBBY_BODY_9, []],
  ["m-chen", "2026-09-22T02:40:00.000Z", "路線在這裡：https://example.com/trail", []],
  ["m-ada", "2026-09-22T03:00:00.000Z", "好，就這樣決定。", []],
];

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function messages(): MessageRow[] {
  const out: MessageRow[] = [];
  LOBBY.forEach(([sender, at, body, mentions], seq) => {
    out.push({
      id: "msg-lobby-" + pad(seq, 2),
      room_id: "room-lobby",
      seq,
      sender_id: sender,
      body,
      mentions,
      client_message_id: "seed-lobby-" + pad(seq, 2),
      created_at: at,
    });
  });
  const longStart = Date.parse("2026-08-01T00:00:00.000Z");
  for (let seq = 0; seq < 1200; seq++) {
    const n = pad(seq, 4);
    out.push({
      id: "msg-long-" + n,
      room_id: "room-long",
      seq,
      sender_id: seq % 2 === 0 ? "m-ada" : "m-ben",
      body: "長歷史 #" + n + " — Long history message " + n,
      mentions: [],
      client_message_id: "seed-long-" + n,
      created_at: new Date(longStart + seq * 60_000).toISOString(),
    });
  }
  out.push({
    id: "msg-private-00",
    room_id: "room-ada-private",
    seq: 0,
    sender_id: "m-ada",
    body: "只有我在這裡。",
    mentions: [],
    client_message_id: "seed-private-00",
    created_at: "2026-09-20T00:00:00.000Z",
  });
  return out;
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function hashPassword(password: string, memberId: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = enc.encode("kith-e2e-salt:" + memberId);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return "pbkdf2-sha256$100000$" + b64url(salt) + "$" + b64url(new Uint8Array(bits));
}

/** Single-quoted SQL literal; newlines become `|| char(10) ||` so each statement stays on one line. */
function lit(value: string | null): string {
  if (value === null) return "NULL";
  return value
    .split("\n")
    .map((part) => "'" + part.replaceAll("'", "''") + "'")
    .join(" || char(10) || ");
}

export async function buildSeed(): Promise<SeedBuild> {
  const lines: string[] = ["-- kith e2e seed base-v1 (generated by e2e/fixtures/seed.ts; test-only credentials)"];

  for (const m of MEMBERS) {
    const hash = m.password === null ? null : await hashPassword(m.password, m.id);
    lines.push(
      "INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at, disabled_at) VALUES (" +
        [lit(m.id), lit(m.kind), lit(m.handle), lit(m.display_name), lit(hash), lit("[]"), lit(m.quota_class), String(m.is_operator), lit(MEMBER_CREATED_AT), lit(m.disabled_at)].join(", ") +
        ");",
    );
  }
  for (const r of ROOMS) {
    lines.push(
      "INSERT INTO rooms (id, slug, name, created_by, created_at) VALUES (" +
        [lit(r.id), lit(r.slug), lit(r.name), lit(r.owner), lit(r.created_at)].join(", ") +
        ");",
    );
  }
  let roomMembers = 0;
  for (const r of ROOMS) {
    for (const [memberId, role] of [[r.owner, "owner"], ...r.members.map((id) => [id, "member"])] as [string, string][]) {
      roomMembers++;
      lines.push(
        "INSERT INTO room_members (room_id, member_id, role, attention_mode, keywords_json, cooldown_ms, debounce_ms, classifier, policy_epoch) VALUES (" +
          [lit(r.id), lit(memberId), lit(role), lit("mention"), lit("[]"), "15000", "2000", lit("heuristic"), "1"].join(", ") +
          ");",
      );
    }
  }
  const msgs = messages();
  for (const m of msgs) {
    if (m.body.includes(";")) throw new Error("seed body must not contain ';': " + m.id);
    lines.push(
      "INSERT INTO messages (id, room_id, seq, kind, thread_id, reply_to, sender_id, body, mentions_json, generation_id, client_message_id, origin, created_at) VALUES (" +
        [lit(m.id), lit(m.room_id), String(m.seq), lit("message"), "NULL", "NULL", lit(m.sender_id), lit(m.body), lit(JSON.stringify(m.mentions)), "NULL", lit(m.client_message_id), lit("local"), lit(m.created_at)].join(", ") +
        ");",
    );
  }

  const sql = lines.join("\n") + "\n";
  const sha256 = createHash("sha256").update(sql, "utf8").digest("hex");

  const description: SeedDescription = {
    schema: "kith-e2e-seed/v1",
    id: "base-v1",
    sha256,
    generated_by: "e2e/fixtures/seed.ts",
    counts: { members: MEMBERS.length, rooms: ROOMS.length, room_members: roomMembers, messages: msgs.length, bot_tokens: 0 },
    members: MEMBERS.map((m) => ({
      id: m.id,
      kind: m.kind,
      handle: m.handle,
      display_name: m.display_name,
      is_operator: m.is_operator === 1,
      quota_class: m.quota_class,
      disabled: m.disabled_at !== null,
    })),
    rooms: ROOMS.map((r) => {
      const seqs = msgs.filter((m) => m.room_id === r.id).map((m) => m.seq);
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        member_ids: [r.owner, ...r.members],
        message_count: seqs.length,
        first_seq: seqs.length > 0 ? Math.min(...seqs) : null,
        last_seq: seqs.length > 0 ? Math.max(...seqs) : null,
      };
    }),
  };
  return { id: "base-v1", sql, sha256, description };
}

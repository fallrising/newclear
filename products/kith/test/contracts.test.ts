import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractsDir = join(root, "contracts");

type JsonObject = Record<string, unknown>;

function loadJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(root, rel), "utf8")) as unknown;
}

function asObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walkFiles(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });

function compile(schema: object) {
  return ajv.compile(schema);
}

const SEND_MESSAGE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["room_id", "body", "client_message_id"],
  properties: {
    room_id: { type: "string", minLength: 1, maxLength: 64 },
    body: { type: "string", minLength: 1, maxLength: 8192 },
    thread_id: { type: ["string", "null"] },
    client_message_id: { type: "string", minLength: 8, maxLength: 64 },
    generation_id: { type: ["string", "null"] },
  },
};

const ATT_01_ROWS = [
  { input: "hello @grok", handles: ["grok", "codex"], mentions: ["grok"] },
  { input: "＠codex please", handles: ["grok", "codex"], mentions: ["codex"] },
  { input: "email foo@bar.com", handles: ["bar"], mentions: [] },
  { input: "@all", handles: ["grok"], mentions: [] },
  { input: "@nobody", handles: ["grok"], mentions: [] },
  { input: "a@grok", handles: ["grok"], mentions: [] },
  { input: "@Grok", handles: ["grok"], mentions: ["grok"] },
];

const ATT_02_ROWS = [
  { keywords: ["deploy"], body: "please Deploy now", hit: "yes" },
  { keywords: ["deploy"], body: "undeployed", hit: "no" },
  { keywords: ["部署"], body: "今晚部署嗎", hit: "yes" },
  {
    keywords: ["部"],
    body: "部署",
    hit: "load-reject",
    reason: "CJK keyword shorter than 2 code points rejected at load",
  },
  { keywords: ["gpt"], body: "GPT-4", hit: "yes" },
];

describe("contracts", () => {
  it("MCP-SCH-01: mcp-tools-v1.json has exactly four tools and no subscribe_events", () => {
    const rel = "contracts/mcp-tools-v1.json";
    const text = readFileSync(join(root, rel), "utf8");
    const parsed = asObject(loadJson(rel), rel);
    const tools = asArray(parsed.tools, "mcp-tools-v1.tools");
    const names = tools.map((tool) => {
      const obj = asObject(tool, "tool");
      return obj.name;
    });

    expect(tools).toHaveLength(4);
    expect(names).toEqual(["list_rooms", "read_history", "send_message", "post_status"]);
    expect(text.includes("subscribe_events")).toBe(false);
    expect(JSON.stringify(parsed).includes("subscribe_events")).toBe(false);

    const send = asObject(
      tools.find((tool) => asObject(tool, "tool").name === "send_message"),
      "send_message",
    );
    expect(send.inputSchema).toEqual(SEND_MESSAGE_INPUT_SCHEMA);

    const listRooms = asObject(
      tools.find((tool) => asObject(tool, "tool").name === "list_rooms"),
      "list_rooms",
    );
    const listSchema = asObject(listRooms.inputSchema, "list_rooms.inputSchema");
    expect(listSchema.additionalProperties).toBe(false);
    expect(listSchema.required).toBeUndefined();

    const readHistory = asObject(
      tools.find((tool) => asObject(tool, "tool").name === "read_history"),
      "read_history",
    );
    const readSchema = asObject(readHistory.inputSchema, "read_history.inputSchema");
    expect(readSchema.required).toEqual(["room_id"]);
    const readProps = asObject(readSchema.properties, "read_history.properties");
    expect(asObject(readProps.limit, "limit").default).toBe(50);
    expect(asObject(readProps.limit, "limit").maximum).toBe(50);
    expect(asObject(readProps.kind, "kind").default).toBe("message");

    const postStatus = asObject(
      tools.find((tool) => asObject(tool, "tool").name === "post_status"),
      "post_status",
    );
    const postSchema = asObject(postStatus.inputSchema, "post_status.inputSchema");
    expect(postSchema.required).toEqual(["room_id", "state"]);
    expect(postSchema.additionalProperties).toBe(false);
    expect(asObject(asObject(postSchema.properties, "post_status.properties").state, "state").enum).toEqual([
      "accepted",
      "running",
      "blocked",
      "idle",
    ]);
  });

  it("contracts/ file contents do not include subscribe_events", () => {
    const files = walkFiles(contractsDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text.includes("subscribe_events"), file).toBe(false);
      if (file.endsWith(".json")) {
        const parsed = JSON.parse(text) as unknown;
        expect(JSON.stringify(parsed).includes("subscribe_events"), file).toBe(false);
      }
    }
  });

  it("Ajv validates golden vectors and sample payloads against schemas", () => {
    const eventsSchema = asObject(loadJson("contracts/mcp-events-v1.json"), "mcp-events");
    const errorSchema = asObject(loadJson("contracts/http-error-v1.json"), "http-error");
    const sendHttpSchema = asObject(loadJson("contracts/http-send-message-v1.json"), "http-send");
    const wsClientSchema = asObject(loadJson("contracts/ws-client-v1.json"), "ws-client");
    const wsServerSchema = asObject(loadJson("contracts/ws-server-v1.json"), "ws-server");
    const notifySchema = asObject(loadJson("contracts/notify-envelope-v1.json"), "notify");
    const toolsDoc = asObject(loadJson("contracts/mcp-tools-v1.json"), "mcp-tools");
    const heuristic = asObject(loadJson("contracts/ambient-heuristic-v1.json"), "heuristic");
    const mention = asObject(loadJson("contracts/vectors/mention-tokenizer-v1.json"), "ATT-01");
    const keyword = asObject(loadJson("contracts/vectors/keyword-matcher-v1.json"), "ATT-02");
    const splice = asObject(loadJson("contracts/vectors/ev-01-splice-v1.json"), "EV-01");
    const recovery = asObject(loadJson("contracts/vectors/d1-recovery-v1.json"), "ST-D1");

    const validateEvent = compile(eventsSchema);
    const validateError = compile(errorSchema);
    const validateHttpSend = compile(sendHttpSchema);
    const validateWsClient = compile(wsClientSchema);
    const validateWsServer = compile(wsServerSchema);
    const validateNotify = compile(notifySchema);

    const toolSchemas = new Map<string, ReturnType<typeof compile>>();
    for (const tool of asArray(toolsDoc.tools, "tools")) {
      const obj = asObject(tool, "tool");
      toolSchemas.set(String(obj.name), compile(asObject(obj.inputSchema, String(obj.name))));
    }

    expect(validateEvent({ replay: true, seq: 1, kind: "message" })).toBe(true);
    expect(validateEvent({ replay: false, seq: 6, kind: "trace", hint: "mention_self" })).toBe(true);
    expect(validateEvent({ replay: true, seq: 1, kind: "status" })).toBe(false);
    expect(validateEvent({ replay: true, seq: 1, kind: "message", extra: true })).toBe(false);

    expect(validateError({ error: { code: "payload_too_large", message: "body exceeds 8 KiB" } })).toBe(true);
    expect(validateError({ error: { code: "payload_too_large", message: "x", extra: true } })).toBe(false);
    expect(validateError({ error: { code: "payload_too_large" } })).toBe(false);
    expect(validateError({ error: { code: "nope", message: "x" }, extra: true })).toBe(false);

    expect(
      validateHttpSend({
        body: "hello @grok",
        client_message_id: "01JABCDEFG",
        thread_id: null,
        generation_id: null,
      }),
    ).toBe(true);
    expect(validateHttpSend({ body: "hello @grok", client_message_id: "01JABCDEFG", extra: 1 })).toBe(false);

    expect(
      validateWsClient({
        v: 1,
        type: "send",
        client_message_id: "01JABCDEFG",
        body: "hello @grok",
        thread_id: null,
      }),
    ).toBe(true);
    expect(validateWsClient({ v: 1, type: "ack", seq: 42 })).toBe(true);
    expect(validateWsClient({ v: 1, type: "status", body: "typing" })).toBe(true);
    expect(validateWsClient({ v: 1, type: "send", client_message_id: "01JABCDEFG", body: "x", extra: true })).toBe(
      false,
    );

    expect(
      validateWsServer({
        v: 1,
        type: "event",
        event: { seq: 42, kind: "message", body: "hello @grok" },
      }),
    ).toBe(true);
    expect(validateWsServer({ v: 1, type: "status", member_id: "01JMEMBER", body: "typing" })).toBe(true);
    expect(validateWsServer({ v: 1, type: "error", code: "payload_too_large" })).toBe(true);
    expect(validateWsServer({ v: 1, type: "event", event: { seq: 42, kind: "status", body: "x" } })).toBe(false);

    const envelope = {
      room_id: "01JROOM",
      event: {
        id: "01JMSG",
        seq: 42,
        kind: "message",
        sender_id: "01JHUMAN",
        sender_kind: "human",
        body: "hello @grok",
        mentions: ["01JGROK"],
        thread_id: null,
        origin: "local",
      },
      policy: {
        mode: "mention",
        keywords: [],
        cooldown_ms: 15000,
        debounce_ms: 2000,
        quota_class: "api_key",
        policy_epoch: 7,
      },
      operator_member_id: "01JOP",
      trigger_member_id: "01JHUMAN",
      last_human_seq: 42,
      last_human_at: "2026-09-20T12:00:00.000Z",
      humans_typing: false,
      wake_budget_remaining: 4,
    };
    expect(validateNotify(envelope)).toBe(true);
    expect(validateNotify({ ...envelope, extra: true })).toBe(false);

    const listValidate = toolSchemas.get("list_rooms");
    const readValidate = toolSchemas.get("read_history");
    const sendValidate = toolSchemas.get("send_message");
    const statusValidate = toolSchemas.get("post_status");
    expect(listValidate).toBeTypeOf("function");
    expect(readValidate).toBeTypeOf("function");
    expect(sendValidate).toBeTypeOf("function");
    expect(statusValidate).toBeTypeOf("function");

    expect(listValidate!({})).toBe(true);
    expect(listValidate!({ extra: true })).toBe(false);
    expect(readValidate!({ room_id: "01JROOM" })).toBe(true);
    expect(readValidate!({ room_id: "01JROOM", limit: 50, kind: "message" })).toBe(true);
    expect(readValidate!({ room_id: "01JROOM", limit: 51 })).toBe(false);
    expect(readValidate!({})).toBe(false);
    expect(
      sendValidate!({
        room_id: "01JROOM",
        body: "hello",
        client_message_id: "01JCLIENT",
        thread_id: null,
        generation_id: null,
      }),
    ).toBe(true);
    expect(
      sendValidate!({
        room_id: "01JROOM",
        body: "hello",
        client_message_id: "01JCLIENT",
        extra: true,
      }),
    ).toBe(false);
    expect(statusValidate!({ room_id: "01JROOM", state: "running" })).toBe(true);
    expect(statusValidate!({ room_id: "01JROOM", state: "nope" })).toBe(false);

    const rules = asArray(heuristic.rules, "heuristic.rules");
    expect(rules.map((rule) => asObject(rule, "rule").id)).toEqual(["H1", "H2", "H3", "H4", "H5"]);
    expect(asObject(rules[0], "H1").pass).toBe(true);
    expect(asObject(rules[0], "H1").any_of_substrings).toEqual(["?", "？"]);
    expect(asObject(rules[0], "H1").min_body_length).toBe(8);
    expect(asObject(rules[1], "H2").phrases).toEqual(["有人", "幫我", "can someone", "please look"]);
    expect(asObject(rules[2], "H3").literals).toEqual(["@all", "＠all"]);
    expect(asObject(rules[3], "H4").pass).toBe(false);
    expect(asObject(rules[3], "H4").veto).toEqual(["H1", "H2", "H3"]);
    expect(asObject(rules[3], "H4").recent_message_window).toBe(10);
    expect(asObject(rules[4], "H5").sender_kind).toBe("agent");
    expect(asObject(rules[4], "H5").pass).toBe(false);

    expect(mention.id).toBe("ATT-01");
    expect(asArray(mention.rows, "ATT-01.rows")).toEqual(ATT_01_ROWS);
    expect(keyword.id).toBe("ATT-02");
    expect(asArray(keyword.rows, "ATT-02.rows")).toEqual(ATT_02_ROWS);

    const d1 = asArray(splice.d1_persisted, "EV-01.d1");
    expect(d1).toHaveLength(5);
    const cases = asArray(splice.cases, "EV-01.cases").map((item) => asObject(item, "case"));
    const liveCase = cases.find((item) => item.id === "EV-01-replay-then-live");
    const gapCase = cases.find((item) => item.id === "EV-01-gap");
    expect(liveCase).toBeDefined();
    expect(gapCase).toBeDefined();
    expect(asArray(liveCase!.live, "live").length).toBe(2);
    expect(asArray(gapCase!.live, "gap-live").length).toBe(2);
    expect(gapCase!.gap).toBe(true);

    for (const item of asArray(liveCase!.expected, "expected")) {
      expect(validateEvent(item), JSON.stringify(item)).toBe(true);
    }
    const expected = asArray(liveCase!.expected, "expected").map((item) => asObject(item, "sse"));
    expect(expected.filter((item) => item.replay === true).length).toBe(5);
    expect(expected.filter((item) => item.replay === false).length).toBe(2);
    const liveMin = Math.min(
      ...asArray(gapCase!.live, "gap-live").map((item) => Number(asObject(item, "live").seq)),
    );
    const cursor = Math.max(...d1.map((item) => Number(asObject(item, "d1").seq)));
    expect(liveMin > cursor + 1).toBe(true);

    const recoveryCases = asArray(recovery.cases, "ST-D1.cases").map((item) => asObject(item, "st"));
    expect(recoveryCases.map((item) => item.id)).toEqual(["ST-D1-01", "ST-D1-02", "ST-D1-03", "ST-D1-04"]);
    expect(asObject(asObject(recoveryCases[0], "01").then, "01.then").formula).toBe("MAX(seq)+1");
    expect(asObject(asObject(recoveryCases[1], "02").then, "02.then").broadcast_before_insert).toBe(false);
    expect(asObject(asObject(recoveryCases[1], "02").then, "02.then").unique_hit_returns).toBe("original row");
    expect(asObject(asObject(recoveryCases[2], "03").then, "03.then").broadcast_only_after_insert).toBe(true);
    expect(asObject(asObject(recoveryCases[3], "04").then, "04.then").new_seq).toBe(3);
    expect(asObject(asObject(recoveryCases[3], "04").then, "04.then").not_count_plus_one).toBe(2);
  });
});
